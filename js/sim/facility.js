/* 機房設施：機櫃電力（一般機櫃的 PDU、AI 機櫃的電源櫃 PSU + BBU）、UPS、發電機、
 * 冷卻（空調、冷熱通道封閉、送風溫度、液冷 CDU）、溫濕度、PUE、消防斷電、樓層 IDF 供電 */
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
  /** 某項設施已安裝完成、而且可用（例如氣體滅火釋放後要補充鋼瓶才算可用） */
  Fac.has = (model) => { const s = G.S; return s.room.some((r) => r.model === model && r.status === 'ok' && s.time >= (r.readyAt || 0)); };
  Fac.isAiRack = (rackId) => { const r = G.S.racks.find((x) => x.id === rackId); return !!r && r.type === 'ai'; };

  /** 目前負載下 UPS 可撐的分鐘數 */
  Fac.runtimeAt = (upsCap, baseRuntime, loadW) => {
    if (loadW <= 0) return 999;
    if (upsCap < loadW) return 0;
    return Math.min(240, baseRuntime * Math.pow(upsCap / loadW, 1.15));
  };

  /** AI 機櫃的電源：電源櫃裡還在運作的 PSU（全部 / 少一個的 N+1 容量）與 BBU */
  Fac.aiRackPower = (rackId) => {
    let total = 0, n = 0, psuW = 0, bbuW = 0, fail = 0;
    for (const d of Object.values(G.S.devices)) {
      if (d.rack !== rackId || d.status !== 'ok') continue;
      const m = CAT.devices[d.model];
      if (m.cat === 'power') { const k = Math.max(0, m.psuN - (d.psuFail || 0)); n += k; fail += m.psuN - k; psuW = m.psuW; total += k * m.psuW; }
      else if (m.cat === 'bbu') bbuW += m.bbuW;
    }
    return { total, n1: n >= 2 ? total - psuW : 0, psuN: n, psuW, fail, bbuW };
  };
  /** 機櫃供電上限：一般機櫃 = PDU 8 kW；AI 機櫃 = 電源櫃總容量 */
  Fac.rackLimit = (rackId) => (Fac.isAiRack(rackId) ? Fac.aiRackPower(rackId).total : CAT.rack.powerLimit);
  /** 設備實際耗電：GPU 功耗上限（power capping）會降低 GPU 伺服器的耗電 */
  Fac.devWatts = (d, m) => {
    const cap = G.R.mods && G.R.mods.gpuCap && G.R.mods.gpuCap[d.rack];
    return m.gpu && cap ? m.watts * cap : m.watts;
  };
  /** 送風溫度與冷熱通道封閉對 PUE 的影響（空氣側冷卻的額外耗電比例） */
  Fac.coolOverhead = (precision, contain, set) => (precision ? 0.5 : 0.9) * (contain ? 0.8 : 1) * (1 + (21 - set) * 0.05);

  Fac.update = (dt) => {
    const s = G.S, t = s.time;
    const prev = G.R.fac;
    const mods = G.R.mods || {};
    const racks = {};
    for (const r of s.racks) {
      const R = { load: 0, limit: CAT.rack.powerLimit, used: 0, ai: r.type === 'ai', liquid: 0 };
      if (R.ai) {
        const p = Fac.aiRackPower(r.id);
        Object.assign(R, { limit: p.total, n1: p.n1, psuN: p.psuN, psuW: p.psuW, psuFail: p.fail, bbuW: p.bbuW });
        if (r.bbu === undefined) r.bbu = 1;
      }
      racks[r.id] = R;
    }
    let upsCap = 0, runW = 0;
    for (const d of Object.values(s.devices)) {
      if (!d.rack || !racks[d.rack]) continue;
      const m = CAT.devices[d.model];
      racks[d.rack].used += m.u;
      if (m.cat === 'ups') { if (d.status === 'ok') { upsCap += m.capW; runW += m.capW * m.runtime; } continue; }
      if (d.status === 'ok') {
        const w = Fac.devWatts(d, m);
        racks[d.rack].load += w;
        if (m.liquid) racks[d.rack].liquid += w * m.liquid;
      }
    }
    for (const r of roomUnits('ups')) { const m = CAT.room[r.model]; upsCap += m.capW; runW += m.capW * m.runtime; }
    const baseRuntime = upsCap > 0 ? runW / upsCap : 0;
    const rackTripped = {};
    let itLoad = 0, aiLoad = 0;
    for (const id in racks) {
      const R = racks[id];
      rackTripped[id] = R.load > R.limit;
      if (rackTripped[id]) continue;
      if (R.ai) aiLoad += R.load; else itLoad += R.load;
    }
    const coolers = roomUnits('cooling');
    const contain = roomUnits('contain').length > 0;
    const coolMul = contain ? 1.2 : 1;
    const coolCap = Math.round(U.sum(coolers, (r) => CAT.room[r.model].coolKW) * coolMul * 10) / 10;
    const maxCooler = coolers.reduce((m, r) => Math.max(m, CAT.room[r.model].coolKW), 0) * coolMul;
    const precision = coolers.some((r) => r.model !== 'AC-8');
    const gen = roomUnits('generator').length > 0;

    const outage = t < s.power.outageUntil;
    const since = t - s.power.outageStart;
    /* 發電機約 1 分鐘後才接手：這段空窗要靠 UPS（一般機櫃）與 BBU（AI 機櫃）撐住 */
    const genUp = gen && since >= 2;
    /* 消防斷電 / 緊急斷電（EPO）：整間機房（含空調）斷電 */
    const fireCut = !!mods.mdfOff;
    let mdfPowered = true, coolingOn = true, onBattery = false, genRunning = false;
    if (outage) {
      if (genUp) {
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
    if (fireCut) { mdfPowered = false; coolingOn = false; }

    /* AI 機櫃不接中央 UPS：停電時由機櫃裡的 BBU 撐到發電機啟動 */
    const aiPowered = {};
    let onBBU = false;
    for (const r of s.racks) {
      const R = racks[r.id];
      if (!R.ai) continue;
      let on = true;
      if (fireCut || overheat) on = false;
      else if (outage && !genRunning) {
        if (R.load <= 0) on = true;
        else if (R.bbuW >= R.load && r.bbu > 0) {
          onBBU = true;
          const rt = 4 * (R.bbuW / R.load);
          r.bbu = Math.max(0, r.bbu - dt / Math.max(rt, 0.1));
          on = r.bbu > 0;
        } else on = false;
      } else r.bbu = Math.min(1, r.bbu + dt / 30);
      aiPowered[r.id] = on;
      R.bbuMin = R.load > 0 && R.bbuW >= R.load ? 4 * (R.bbuW / R.load) * r.bbu : 0;
    }
    const rackDown = {};
    for (const id in racks) rackDown[id] = rackTripped[id] || (racks[id].ai ? !aiPowered[id] : !mdfPowered);

    /* 液冷：GPU 的熱經冷板交給 CDU（CDU 的泵要有電：停電時只能靠發電機） */
    let liquidHeat = 0, aiAir = 0, aiUp = 0;
    for (const id in racks) {
      const R = racks[id];
      if (rackTripped[id]) continue;
      if (R.ai) aiAir += (R.load - R.liquid) / 1000;
      if (rackDown[id]) continue;
      liquidHeat += R.liquid / 1000;
      if (R.ai) aiUp += R.load / 1000;
    }
    const cdus = roomUnits('cdu');
    const cduOn = !fireCut && (!outage || genRunning);
    const cduCap = cduOn ? U.sum(cdus, (r) => CAT.room[r.model].coolKW) : 0;
    const cduMax = cdus.reduce((m, r) => Math.max(m, CAT.room[r.model].coolKW), 0);
    const thermal = liquidHeat <= 0 ? 1 : U.clamp(cduCap / liquidHeat, 0, 1);

    /* 溫度：空氣側熱負載 vs 空調；送風溫度設定越高，平常越暖、出事時也越快過熱 */
    let airHeat = mdfPowered ? itLoad / 1000 : 0;
    for (const id in racks) if (racks[id].ai && !rackDown[id]) airHeat += (racks[id].load - racks[id].liquid) / 1000;
    const cool = coolingOn ? coolCap : 0;
    const shift = (s.coolSet - 21) * 0.9;
    let teq, tau = 20;
    if (cool <= 0) { teq = 27 + airHeat * 1.6; tau = 12; }
    else {
      const r = airHeat / cool;
      teq = r <= 1 ? 19 + shift + 7 * r : 26 + shift + (r - 1) * 30;
    }
    teq = Math.min(teq, 65);
    s.temp += (teq - s.temp) * (1 - Math.exp(-dt / tau));
    /* 濕度：精密空調會控濕（約 45%）；一般舒適型空調只能除一點濕；空調停擺就跟著外面的潮濕空氣走 */
    const hTarget = cool <= 0 ? 74 : precision ? 45 : 62;
    s.hum += (hTarget - s.hum) * (1 - Math.exp(-dt / 90));

    /* 樓層 IDF 供電 */
    const idfPowered = {};
    let idfLoad = 0;
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id];
      let on = true;
      if (outage) {
        if (fs.idf.ups && since < 30) on = true;
        else if (genUp) on = true;
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
        const wasDown = prev.rackDown ? prev.rackDown[d.rack] : (!prev.mdfPowered || prev.rackTripped[d.rack]);
        if (wasDown && !rackDown[d.rack]) d.bootUntil = t + (CAT.bootMin[CAT.devices[d.model].cat] || 5);
      }
      if (restored) G.Ops && G.Ops.alert('info', '機房恢復供電，設備重新開機中', 'power');
      if (prev.mdfPowered && !mdfPowered) G.Ops && G.Ops.alert('crit', fireCut ? '機房緊急斷電（消防 / EPO）！' : overheat ? '機房過熱！設備緊急關機保護' : '機房斷電！所有設備停止運作', 'power');
      for (const id in rackTripped) {
        if (rackTripped[id] && !(prev.rackTripped || {})[id]) G.Ops && G.Ops.alert('crit', racks[id].ai ? `AI 機櫃 ${id} 負載超過電源櫃容量，跳電！` : `機櫃 ${id} 用電超過上限，斷路器跳脫！`, 'power');
        if (racks[id].ai && !rackTripped[id] && !aiPowered[id] && prev.aiPowered && prev.aiPowered[id]) G.Ops && G.Ops.alert('crit', `AI 機櫃 ${id} 斷電：BBU ${racks[id].bbuW >= racks[id].load ? '電力耗盡' : '容量不足以接手'}`, 'bbu:' + id);
      }
    }

    /* PUE = 機房總用電 ÷ IT 設備用電（冷卻越有效率越接近 1） */
    const itKW = (mdfPowered ? itLoad : 0) / 1000 + aiUp;
    const coolOver = Fac.coolOverhead(precision, contain, s.coolSet);
    const liquidRemoved = Math.min(liquidHeat, cduCap);
    const pue = itKW > 0.05 ? 1.08 + (airHeat * coolOver + liquidRemoved * 0.12) / itKW : 1.08 + coolOver;
    const kw = itKW * pue + idfLoad / 1000;
    s.power.kwh = (s.power.kwh || 0) + kw * dt / 60;

    G.R.fac = {
      racks, rackTripped, rackDown, itLoad, aiLoad, upsCap, baseRuntime, runtime: Fac.runtimeAt(upsCap, baseRuntime, itLoad),
      coolCap, coolN1: coolCap - maxCooler, heat: itLoad / 1000 + aiAir, airHeat, gen, outage, onBattery, onBBU, genRunning,
      mdfPowered, coolingOn, overheat, fireCut, idfPowered, idfLoad, kw, pue, contain, precision,
      aiPowered, liquidHeat, cduCap, cduN1: cduCap - cduMax, thermal,
      fire: { vesda: Fac.has('VESDA'), preact: Fac.has('PREACT'), gas: Fac.has('GAS-FS') }, ems: Fac.has('EMS-1'),
    };
    return G.R.fac;
  };
})(window.G = window.G || {});
