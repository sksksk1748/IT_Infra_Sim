/* 廁所與清潔（每層樓：男廁、女廁、無障礙廁所，都在核心筒裡）
 * - 每間廁所有整潔度、衛生紙與洗手乳存量：用的人越多掉得越快（上班、午餐尖峰）；太髒、沒衛生紙會扣這層樓的滿意度、有人報修
 * - 清潔人員（白班 07:00–22:00）：沒有感測器的樓層照固定路線輪流巡（不知道哪一間需要，只能每間都去）；
 *   有智慧廁所的樓層依感測器派工，哪裡需要先去哪裡。晚上由夜班清潔公司整理、補滿耗材
 * - 智慧廁所 IoT：每層一台 IoT 閘道器（接在 IDF 的接入交換器，PoE 供電）+ 每間廁所的感測器（人流、衛生紙 / 洗手乳存量、
 *   異味、漏水），經 MQTT 回報給 IoT 管理平台（伺服器角色 IoT）；平台連不到（沒有平台、防火牆沒放行、樓層斷線）就等於沒有感測器
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Rest = {};
  G.Rest = Rest;

  Rest.ROOMS = [
    { k: 'M', name: '男廁', share: 0.46, service: 15 },
    { k: 'F', name: '女廁', share: 0.44, service: 15 },
    { k: 'A', name: '無障礙廁所', share: 0.1, service: 8 },
  ];
  const RM = {};
  for (const r of Rest.ROOMS) RM[r.k] = r;
  Rest.RM = RM;
  const USE = 0.01;                            /* 每人每分鐘上廁所的次數（約每小時 0.6 次） */
  const DIRT = 0.075, PAPER = 0.13, SOAP = 0.09; /* 每次使用：整潔度、衛生紙、洗手乳下降的百分比 */
  const DAY0 = 7, DAY1 = 22;                   /* 白班清潔人員的上班時間 */
  const ROUTE = 150;                           /* 沒有感測器：固定路線每間約 2.5 小時巡一次 */
  const LEAD = 60;                             /* 有感測器：推估會不合格的前 1 小時就要去 */

  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  Rest.newState = (staff) => ({ staff: staff || 1, rooms: {}, crew: [], iot: {}, used: 0 });
  const R0 = () => G.S.rest;

  /** 這層樓三間廁所的狀態（第一次用到時建立） */
  Rest.rooms = (fid) => {
    const R = R0();
    if (!R.rooms[fid]) R.rooms[fid] = Rest.ROOMS.map((r) => ({ k: r.k, clean: 100, paper: 100, soap: 100, clog: false, leak: false, last: 0 }));
    return R.rooms[fid];
  };
  Rest.room = (fid, k) => Rest.rooms(fid).find((r) => r.k === k);
  Rest.hasIot = (fid) => !!(G.S && G.S.rest && G.S.rest.iot[fid]);
  /** 感測器的資料真的送得到 IoT 管理平台 */
  Rest.iotOk = (fid) => { const x = G.R.sim && G.R.sim.floors[fid]; return Rest.hasIot(fid) && !!x && !!x.iotOk; };
  /** IoT 平台連不到的原因 */
  Rest.iotWhy = (fid) => {
    if (!Rest.hasIot(fid)) return '沒有安裝';
    const x = G.R.sim && G.R.sim.floors[fid];
    if (!x || !x.up) return '這層樓的網路斷了';
    const fl = x.iotFlow;
    if (!fl) return '還沒連線';
    if (fl.blocked === 'nosvc') return '沒有 IoT 管理平台（伺服器角色 IoT）';
    if (fl.blocked === 'fw') return `防火牆擋下了 ${fl.zs} → SERVERS：MQTT`;
    if (fl.blocked === 'noroute') return '連不到 IoT 管理平台（路由不通）';
    return '';
  };
  const occupied = () => G.BLD.hq.filter((f) => G.S.floors[f.id].movedIn > 0);
  Rest.occupied = occupied;
  Rest.dayShift = (t) => { const h = U.hourOf(t); return h >= DAY0 && h < DAY1; };
  /** 感測器推估：照現在的使用人次，這間廁所再過幾分鐘會「不合格」（整潔 < 60% 或沒衛生紙）；沒人用 = Infinity */
  Rest.dueIn = (r) => {
    if (r.leak || r.clog) return 0;
    const u = r.rate || 0;
    if (u <= 0.001) return Infinity;
    return Math.max(0, Math.min((r.clean - 60) / (u * DIRT), r.paper / (u * PAPER), r.soap / (u * SOAP) + 60));
  };
  /** 需要處理的程度（畫面上的狀態顏色用） */
  Rest.need = (r) => (r.leak ? 1000 : 0) + (r.clog ? 800 : 0) + (r.paper < 25 ? 400 + (25 - r.paper) * 8 : 0) + (r.soap < 20 ? 200 : 0) + (r.clean < 65 ? 300 + (65 - r.clean) * 6 : 0);
  /** 一間廁所給人的感受（0～1） */
  Rest.roomQ = (r) => (r.clog || r.leak ? 0.4 : 1) * (r.paper <= 0 ? 0.55 : 1) * (r.soap <= 0 ? 0.85 : 1) * U.clamp(0.5 + r.clean / 140, 0.5, 1);
  Rest.floorQ = (fid) => { const rs = R0() && R0().rooms[fid]; return rs ? U.sum(rs, (r) => RM[r.k].share * Rest.roomQ(r)) : 1; };
  /** 樓層滿意度的乘數：廁所很糟最多扣 10% */
  Rest.satMult = (fid) => (G.S.rest && G.S.floors[fid].movedIn > 0 ? 0.9 + 0.1 * Rest.floorQ(fid) : 1);

  function syncCrew() {
    const R = R0();
    while (R.crew.length < R.staff) R.crew.push({ id: R.crew.length + 1, fid: null, k: null, start: 0, until: 0 });
    if (R.crew.length > R.staff) R.crew.length = R.staff;
  }
  /** 建議的清潔人員數：沒有感測器的廁所大約每 2.5 小時要巡一次；有感測器的只在需要時才去（約省四成） */
  Rest.recommend = () => {
    let min = 0;
    for (const f of occupied()) for (const r of Rest.ROOMS) min += (r.service + 3) * (Rest.hasIot(f.id) ? 0.6 : 1);
    return Math.max(1, Math.ceil(min / 150 * 1.1));
  };

  /** 第一間不合格的廁所（沒衛生紙、整潔 < 60%）：任務「一整個工作天都乾淨」用 */
  Rest.firstBad = () => {
    for (const f of occupied()) for (const r of Rest.rooms(f.id)) {
      if (r.paper <= 0) return { fid: f.id, k: r.k, why: '沒有衛生紙' };
      if (r.clean < 60) return { fid: f.id, k: r.k, why: '太髒' };
    }
    return null;
  };
  /* 平日上班時間（09:00–18:00）每分鐘記錄廁所狀況；18:00 結算這一天 */
  function trackDay(s) {
    const R = s.rest, h = U.hourOf(s.time);
    if (U.isWeekend(s.time)) { R.day = null; return; }
    if (h >= 9 && h < 18) {
      const d = R.day || (R.day = { mins: 0, bad: 0, first: null });
      d.mins++;
      const b = Rest.firstBad();
      if (b) { d.bad++; if (!d.first) d.first = Object.assign({ t: s.time }, b); }
    } else if (R.day && h >= 18) {
      const d = R.day;
      R.day = null;
      R.lastDay = { ok: d.mins >= 480 && d.bad === 0, t: s.time, pop: Q.employees(), first: d.first };
    }
  }

  /* ---------- 每分鐘 ---------- */
  Rest.tick = (s) => {
    const R = s.rest;
    if (!R) return;
    const t = s.time, sim = G.R.sim;
    syncCrew();
    trackDay(s);
    /* 使用：整潔度與耗材下降、偶爾堵塞（堵住的那間暫停使用） */
    for (const f of occupied()) {
      const x = sim && sim.floors[f.id];
      const pres = x ? x.present : 0;
      const uses = pres >= 0.5 ? pres * USE : 0;
      R.used += uses;
      for (const r of Rest.rooms(f.id)) {
        /* 每分鐘的使用人次（門口的人流計數器量得到，感測器派工用來推估） */
        const u = r.rate = uses * RM[r.k].share;
        if (r.clog || !u) continue;
        r.clean = Math.max(0, r.clean - u * DIRT);
        r.paper = Math.max(0, r.paper - u * PAPER);
        r.soap = Math.max(0, r.soap - u * SOAP);
        if (Math.random() < u * 0.00004) r.clog = true;
      }
    }
    /* 晚上：夜班清潔公司整理（整潔度慢慢回升），清晨 5 點補滿耗材、通好馬桶 */
    if (!Rest.dayShift(t)) {
      const refill = Math.floor(U.hourOf(t) * 60) === 5 * 60;
      for (const fid of Object.keys(R.rooms)) for (const r of R.rooms[fid]) {
        r.clean = Math.min(100, r.clean + 0.6);
        if (refill) { r.paper = 100; r.soap = 100; r.clog = false; r.last = t; }
      }
      for (const c of R.crew) { c.fid = null; c.k = null; c.until = 0; }
      return;
    }
    /* 白班清潔人員：先把打掃完的結算，再替有空的人派下一間（才不會派到別人剛打掃好的那間） */
    for (const c of R.crew) if (c.k && c.until <= t) finish(c, t);
    const busy = new Set(R.crew.filter((c) => c.k).map((c) => c.fid + ':' + c.k));
    for (const c of R.crew) {
      if (c.k) continue;
      const job = pick(c, busy);
      if (!job) continue;
      busy.add(job.fid + ':' + job.k);
      const r = Rest.room(job.fid, job.k);
      const walk = c.fid === job.fid ? 1 : 4;
      c.fid = job.fid; c.k = job.k; c.start = t + walk;
      c.until = t + walk + RM[job.k].service + (r.clog ? 15 : 0);
    }
  };
  function finish(c, t) {
    const r = Rest.room(c.fid, c.k);
    if (r) {
      r.clean = 100; r.paper = 100; r.soap = 100; r.clog = false; r.last = t;
      /* 清潔人員進去才發現漏水：通報 */
      if (r.leak) {
        const inc = G.Ev.active().find((i) => i.type === 'rest-leak' && i.data.fid === c.fid && i.data.k === c.k);
        if (inc && !inc.detected) G.Ev.detect(inc, '清潔人員打掃時發現');
      }
    }
    c.k = null;
  }
  /** 派下一間：每間廁所都有一個「該去的時間」，最早的先去（同一層的優先一點，省走路）
   * - 沒有感測器：照固定路線，每間大約 2.5 小時巡一次（不管有沒有人用，最久沒去的先去）
   * - 有智慧廁所：照人流推估的「不合格時間」；漏水、堵塞馬上去；還很乾淨、衛生紙還很多的就不去
   *   （沒什麼人用的無障礙廁所一天可能只要去一次，省下的人力拿去顧最忙的那幾間） */
  function pick(c, busy) {
    const floors = occupied();
    if (!floors.length) return null;
    const t = G.S.time;
    let best = null, bs = Infinity;
    for (const f of floors) {
      const iot = Rest.iotOk(f.id);
      for (const r of Rest.rooms(f.id)) {
        if (busy.has(f.id + ':' + r.k)) continue;
        let dl;
        if (iot) {
          if (!(r.leak || r.clog || r.clean < 97 || r.paper < 90 || r.soap < 85)) continue;
          dl = t + Rest.dueIn(r) - LEAD;
        } else dl = (r.last || 0) + ROUTE;
        dl += c.fid === f.id ? 0 : 5;
        if (dl < bs) { bs = dl; best = { fid: f.id, k: r.k }; }
      }
    }
    return best;
  }

  /* ---------- 玩家動作 ---------- */
  Rest.setStaff = (n) => {
    n = U.clamp(n | 0, 0, CAT.rest.maxStaff);
    const R = R0();
    if (n === R.staff) return ok('');
    R.staff = n;
    syncCrew();
    G.bus.emit('change', { what: 'rest' });
    return ok(`白班清潔人員調整為 ${n} 人（外包合約，每人每月 ${U.money(CAT.rest.wage)}）`);
  };
  Rest.iotCost = () => CAT.rest.iotGw.price + Rest.ROOMS.length * CAT.rest.iotKit.price;
  /** 安裝智慧廁所：IoT 閘道器（佔 IDF 一個 PoE 埠）+ 三間廁所的感測器 */
  Rest.installIot = (fid) => {
    const s = G.S, fs = s.floors[fid];
    if (!Q.unlocked({ unlock: CAT.rest.unlock })) return err(`第 ${CAT.rest.unlock} 章解鎖`);
    if (Rest.hasIot(fid)) return err('這層樓已經裝好智慧廁所了');
    if (fs.idf.count <= 0) return err('這層樓的 IDF 還沒有接入交換器：IoT 閘道器要接在交換器上，用 PoE 供電');
    const need = Q.floorPortNeed(fid).total + 1;
    if (Q.floorPorts(fid) < need) return err(`IDF 的接入交換器沒有空的埠了（需要 ${need} 埠，現在只有 ${Q.floorPorts(fid)} 埠）：先增加交換器`);
    const cost = Rest.iotCost();
    if (!G.Act.spend(cost, `${fid} 智慧廁所（IoT 閘道器 + 感測器）`)) return err(`預算不足：需要 ${U.money(cost)}`);
    s.rest.iot[fid] = s.time;
    if (G.Wifi.invalidate) G.Wifi.invalidate(fid);
    G.R.topoVer++;
    G.bus.emit('change', { what: 'rest', fid });
    return ok(`${fid} 智慧廁所裝好了：IoT 閘道器接在 IDF（PoE），三間廁所都有感測器`);
  };
  Rest.removeIot = (fid) => {
    if (!Rest.hasIot(fid)) return err('這層樓沒有智慧廁所');
    delete G.S.rest.iot[fid];
    G.Act.refund(Rest.iotCost() * 0.3, `${fid} 拆除智慧廁所（殘值）`);
    if (G.Wifi.invalidate) G.Wifi.invalidate(fid);
    G.R.topoVer++;
    G.bus.emit('change', { what: 'rest', fid });
    return ok(`${fid} 的智慧廁所拆掉了`);
  };
  /** 每天的清潔費用：清潔人員月薪 + 衛生紙與洗手乳 */
  Rest.dailyCost = () => { const R = G.S && G.S.rest; return R ? R.staff * CAT.rest.wage / 30 + R.used * CAT.rest.usePrice : 0; };
  Rest.resetDay = () => { if (G.S.rest) G.S.rest.used = 0; };
  /** 清潔人員現在在哪裡（介面與 3D 用） */
  Rest.crewAt = (fid) => (R0() ? R0().crew.filter((c) => c.fid === fid && c.k) : []);
  /** 讀檔：舊存檔補上廁所與清潔（清潔人員依目前進駐的樓層給足，不會一讀檔就被抱怨） */
  Rest.ensure = () => {
    const s = G.S;
    if (!s || s.rest) return;
    s.rest = Rest.newState(1);
    s.rest.staff = Rest.recommend();
  };
})(window.G = window.G || {});
