/* 遊戲狀態：建立、存檔、讀檔，以及常用查詢 (G.Q)
 * G.S = 目前的遊戲狀態（會被存檔）
 * G.R = 執行期快取（不存檔：路由圖、Wi-Fi 計算結果、每分鐘的模擬數據）
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const SAVE_KEY = 'infraops.save.v1';

  function newFloorState() {
    return {
      movedIn: 0, moveInAt: null,
      cabling: { std: null, status: 'none', readyAt: 0 },
      idf: { model: 'AX-48P', count: 0, ups: false, bootUntil: 0 },
      aps: [],
    };
  }

  G.R = { topoVer: 1 };

  G.State = {
    SAVE_KEY,
    create(mode) {
      const s = {
        v: 1, mode, seq: 1,
        time: U.at(1, 8), speed: 0,
        money: 0, rating: 60,
        chapter: 0, chapterStart: U.at(1, 8), obj: {}, objT: {}, flags: {}, sched: [],
        racks: [], devices: {}, links: {}, isp: [],
        room: [{ id: 'rm0', model: 'AC-8', status: 'ok', readyAt: 0 }],
        floors: {},
        fw: { rules: [], segmentation: false, guestWifi: false },
        subnets: { wired: 23, wifi: 22, guest: 23, servers: 24, dmz: 28 },
        services: {}, trainingUntil: 0,
        power: { outageUntil: 0, outageStart: 0, upsCharge: 1 },
        temp: 22, hum: 55, coolSet: 21,
        incidents: [], tickets: [], alerts: [], log: [],
        hist: { t: [], wanIn: [], wanOut: [], wanCap: [], intra: [], users: [], sat: [], lat: [], loss: [], fw: [], temp: [], kw: [], web: [] },
        stats: { breaches: 0, incResolved: 0, incFailed: 0, ticketsResolved: 0, spent: 0, income: 0, mttd: [], mttr: [], ransomPaid: 0 },
        kb: { unlocked: {}, seen: {} },
        settings: { autoPause: true },
        ruleHits: {},
        gameOver: null, won: false,
      };
      for (const f of G.BLD.floors) s.floors[f.id] = newFloorState();
      for (const id of G.KB.starter) s.kb.unlocked[id] = s.time;
      return s;
    },
    save(s) {
      s = s || G.S;
      if (!s) return false;
      try { return U.store.set(SAVE_KEY, JSON.stringify(s)); } catch (e) { return false; }
    },
    hasSave() { return !!U.store.get(SAVE_KEY); },
    peek() {
      const str = U.store.get(SAVE_KEY);
      if (!str) return null;
      try { const s = JSON.parse(str); return { mode: s.mode, time: s.time, chapter: s.chapter, money: s.money, scen: s.scen ? s.scen.id : null }; } catch (e) { return null; }
    },
    load() {
      const str = U.store.get(SAVE_KEY);
      if (!str) return null;
      try { return G.State.migrate(JSON.parse(str)); } catch (e) { console.error(e); return null; }
    },
    clear() { U.store.del(SAVE_KEY); },
    migrate(s) {
      if (!s || s.v !== 1) return null;
      for (const f of G.BLD.floors) if (!s.floors[f.id]) s.floors[f.id] = newFloorState();
      s.sched = s.sched || [];
      if (s.hum === undefined) s.hum = 55;
      if (!s.coolSet) s.coolSet = 21;
      /* 舊版的內建空調編號（rm1）可能和第一個採購的設施重複：重新編號 */
      const seen = new Set();
      for (const r of s.room) {
        while (seen.has(r.id)) r.id = 'rm' + (s.seq++);
        seen.add(r.id);
      }
      return s;
    },
    exportStr(s) {
      const json = JSON.stringify(s || G.S);
      return btoa(unescape(encodeURIComponent(json)));
    },
    importStr(str) {
      const json = decodeURIComponent(escape(atob(String(str).trim())));
      return G.State.migrate(JSON.parse(json));
    },
  };

  /* ---------- 查詢工具 ---------- */
  const Q = {};
  G.Q = Q;

  Q.nextId = (prefix) => prefix + (G.S.seq++);
  Q.chapterNum = () => (G.S.mode === 'sandbox' ? 99 : G.S.chapter + 1);
  Q.unlocked = (item) => !item || !item.unlock || item.unlock <= Q.chapterNum();
  Q.model = (d) => CAT.devices[d.model];
  Q.dev = (id) => G.S.devices[id];
  Q.devices = (cat) => Object.values(G.S.devices).filter((d) => !cat || CAT.devices[d.model].cat === cat);
  Q.isL3 = (d) => { const m = CAT.devices[d.model]; return m.cat === 'switch' && m.layer === 3; };
  Q.roleServers = (role) => Q.devices('server').filter((d) => d.role === role);

  Q.floorDef = (fid) => G.BLD.byId[fid];
  Q.nodeKind = (id) => {
    if (id === 'INET') return 'internet';
    if (id.startsWith('isp:')) return 'isp';
    if (id.startsWith('F:')) return 'floor';
    const d = G.S.devices[id];
    return d ? CAT.devices[d.model].cat : 'unknown';
  };
  Q.nodeName = (id) => {
    if (id === 'INET') return '網際網路';
    if (id.startsWith('isp:')) {
      const c = G.S.isp.find((x) => 'isp:' + x.id === id);
      return c ? `${CAT.isp.providers[c.provider].name} ${c.plan}` : 'ISP';
    }
    if (id.startsWith('F:')) return id.slice(2) + ' IDF';
    const d = G.S.devices[id];
    if (!d) return id;
    return d.role ? `${d.name}（${CAT.roles[d.role].short}）` : d.name;
  };
  Q.linksOf = (nodeId) => Object.values(G.S.links).filter((l) => l.a === nodeId || l.b === nodeId);
  Q.other = (l, nodeId) => (l.a === nodeId ? l.b : l.a);
  Q.linkBetween = (a, b) => Object.values(G.S.links).filter((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a));

  /** 節點的埠資訊：{ rj45:{total,used,max}, sfp:{...}, qsfp:{...} } */
  Q.ports = (nodeId) => {
    const out = { rj45: { total: 0, used: 0, max: 1000 }, sfp: { total: 0, used: 0, max: 0 }, qsfp: { total: 0, used: 0, max: 0 } };
    if (nodeId.startsWith('F:')) {
      const fs = G.S.floors[nodeId.slice(2)];
      const am = CAT.access[fs.idf.model];
      out.sfp.total = fs.idf.count * am.uplinks;
      out.sfp.max = am.uplinkMax;
    } else if (nodeId.startsWith('isp:') || nodeId === 'INET') {
      out.rj45.total = 1; out.sfp.total = 1; out.sfp.max = 10000;
    } else {
      const d = G.S.devices[nodeId];
      if (!d) return out;
      const m = CAT.devices[d.model];
      out.rj45.total = m.ports.rj45; out.sfp.total = m.ports.sfp; out.qsfp.total = m.ports.qsfp;
      out.sfp.max = m.sfpMax || 0; out.qsfp.max = m.qsfpMax || 0;
    }
    for (const l of Object.values(G.S.links)) {
      if (l.a === nodeId) out[l.aPort].used += l.count;
      else if (l.b === nodeId) out[l.bPort].used += l.count;
    }
    for (const c of G.S.isp) if (c.router === nodeId && c.port) out[c.port].used += 1;
    return out;
  };

  /** 樓層所需的有線埠數（滿編時） */
  Q.floorPortNeed = (fid) => {
    const f = G.BLD.byId[fid], fs = G.S.floors[fid], ft = G.FT[f.type];
    const seats = Math.ceil(f.staff * ft.wired);
    const printers = Math.ceil(f.staff / 40);
    return { seats, printers, aps: fs.aps.length, total: seats + printers + fs.aps.length };
  };
  Q.floorPorts = (fid) => {
    const fs = G.S.floors[fid];
    return fs.idf.count * CAT.access[fs.idf.model].ports;
  };
  Q.floorPoe = (fid) => {
    const f = G.BLD.byId[fid], fs = G.S.floors[fid], ft = G.FT[f.type];
    const budget = fs.idf.count * CAT.access[fs.idf.model].poe;
    const phones = ft.voip ? Math.ceil(f.staff * ft.wired) * 6 : 0;
    const aps = U.sum(fs.aps, (a) => CAT.aps[a.model].poe);
    return { budget, phones, aps, used: phones + aps };
  };

  /** CIDR 前綴 → 可用主機數 */
  Q.hosts = (prefix) => Math.pow(2, 32 - prefix) - 2;

  Q.monthlyServiceCost = (id) => {
    const svc = CAT.services[id];
    if (!svc) return 0;
    if (svc.perUser) return svc.perUser * Math.max(500, Q.employees());
    return svc.monthly || 0;
  };
  Q.employees = () => U.sum(Object.values(G.S.floors), (f) => f.movedIn);
  Q.hasService = (id) => !!G.S.services[id];
  Q.ispBw = (activeOnly) => U.sum(G.S.isp.filter((c) => !activeOnly || (c.status === 'active' && c.router)), (c) => c.bw);
  Q.fmtNode = (id) => Q.nodeName(id);
})(window.G = window.G || {});
