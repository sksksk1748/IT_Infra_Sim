/* 機房設施：機櫃電力、UPS、發電機、冷卻與溫度、樓層 IDF 供電 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const Fac = {};
  G.Fac = Fac;

  function roomUnits(kind) {
    const s = G.S;
    return s.room.filter((r) => CAT.room[r.model].kind === kind && r.status === 'ok' && s.time >= (r.readyAt || 0));
  }
  Fac.roomUnits = roomUnits;

  /** 目前負載下 UPS 可撐的分鐘數 */
  Fac.runtimeAt = (upsCap, baseRuntime, loadW) => {
    if (loadW <= 0) return 999;
    if (upsCap < loadW) return 0;
    return Math.min(240, baseRuntime * Math.pow(upsCap / loadW, 1.15));
  };

  Fac.update = (dt) => {
    const s = G.S, t = s.time;
    const prev = G.R.fac;
    const racks = {};
    for (const r of s.racks) racks[r.id] = { load: 0, limit: CAT.rack.powerLimit, used: 0 };
    let upsCap = 0, runW = 0;
    for (const d of Object.values(s.devices)) {
      if (!d.rack || !racks[d.rack]) continue;
      const m = CAT.devices[d.model];
      racks[d.rack].used += m.u;
      if (m.cat === 'ups') { if (d.status === 'ok') { upsCap += m.capW; runW += m.capW * m.runtime; } continue; }
      if (d.status === 'ok') racks[d.rack].load += m.watts;
    }
    for (const r of roomUnits('ups')) { const m = CAT.room[r.model]; upsCap += m.capW; runW += m.capW * m.runtime; }
    const baseRuntime = upsCap > 0 ? runW / upsCap : 0;
    const rackTripped = {};
    let itLoad = 0;
    for (const id in racks) {
      rackTripped[id] = racks[id].load > racks[id].limit;
      if (!rackTripped[id]) itLoad += racks[id].load;
    }
    const coolers = roomUnits('cooling');
    const coolCap = U.sum(coolers, (r) => CAT.room[r.model].coolKW);
    const maxCooler = coolers.reduce((m, r) => Math.max(m, CAT.room[r.model].coolKW), 0);
    const gen = roomUnits('generator').length > 0;

    const outage = t < s.power.outageUntil;
    const since = t - s.power.outageStart;
    let mdfPowered = true, coolingOn = true, onBattery = false, genRunning = false;
    if (outage) {
      if (gen && since >= 1) {
        genRunning = true;
      } else {
        coolingOn = false;
        if (itLoad <= 0) { /* 沒有負載 */ }
        else if (upsCap >= itLoad && s.power.upsCharge > 0) {
          onBattery = true;
          const rt = Fac.runtimeAt(upsCap, baseRuntime, itLoad);
          s.power.upsCharge = Math.max(0, s.power.upsCharge - dt / Math.max(rt, 0.1));
          if (s.power.upsCharge <= 0) mdfPowered = false;
        } else mdfPowered = false;
      }
    } else {
      s.power.upsCharge = Math.min(1, s.power.upsCharge + dt / 120);
    }
    let overheat = prev ? prev.overheat : false;
    if (s.temp >= 42) overheat = true;
    else if (s.temp <= 30) overheat = false;
    if (overheat) mdfPowered = false;

    /* 溫度：熱負載 vs 冷卻能力 */
    const heat = mdfPowered ? itLoad / 1000 : 0;
    const cool = coolingOn ? coolCap : 0;
    let teq, tau = 20;
    if (cool <= 0) { teq = 27 + heat * 1.6; tau = 12; }
    else {
      const r = heat / cool;
      teq = r <= 1 ? 19 + 7 * r : 26 + (r - 1) * 30;
    }
    teq = Math.min(teq, 65);
    s.temp += (teq - s.temp) * (1 - Math.exp(-dt / tau));

    /* 樓層 IDF 供電 */
    const idfPowered = {};
    let idfLoad = 0;
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id];
      let on = true;
      if (outage) {
        if (fs.idf.ups && since < 30) on = true;
        else if (gen && since >= 1) on = true;
        else on = false;
      }
      idfPowered[f.id] = on;
      if (on && fs.idf.count > 0) {
        idfLoad += fs.idf.count * CAT.access[fs.idf.model].watts + G.Q.floorPoe(f.id).used;
      }
      if (prev && prev.idfPowered && prev.idfPowered[f.id] === false && on) fs.idf.bootUntil = t + 4;
    }

    /* 復電 / 斷路器復歸 → 設備重新開機 */
    if (prev) {
      const restored = !prev.mdfPowered && mdfPowered;
      for (const d of Object.values(s.devices)) {
        if (!d.rack) continue;
        const wasTripped = prev.rackTripped && prev.rackTripped[d.rack];
        if (restored || (wasTripped && !rackTripped[d.rack])) {
          d.bootUntil = t + (CAT.bootMin[CAT.devices[d.model].cat] || 5);
        }
      }
      if (restored) G.Ops && G.Ops.alert('info', '機房恢復供電，設備重新開機中', 'power');
      if (prev.mdfPowered && !mdfPowered) G.Ops && G.Ops.alert('crit', overheat ? '機房過熱！設備緊急關機保護' : '機房斷電！所有設備停止運作', 'power');
      for (const id in rackTripped) if (rackTripped[id] && !(prev.rackTripped || {})[id]) G.Ops && G.Ops.alert('crit', `機櫃 ${id} 用電超過上限，斷路器跳脫！`, 'power');
    }

    /* 電費（含冷卻 PUE） */
    const kw = (heat * CAT.power.pue) + idfLoad / 1000;
    s.power.kwh = (s.power.kwh || 0) + kw * dt / 60;

    G.R.fac = {
      racks, rackTripped, itLoad, upsCap, baseRuntime, runtime: Fac.runtimeAt(upsCap, baseRuntime, itLoad),
      coolCap, coolN1: coolCap - maxCooler, heat: itLoad / 1000, gen, outage, onBattery, genRunning,
      mdfPowered, coolingOn, overheat, idfPowered, idfLoad, kw,
    };
    return G.R.fac;
  };
})(window.G = window.G || {});
