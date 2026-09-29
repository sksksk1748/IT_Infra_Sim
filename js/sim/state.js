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
  /** 每一局遊戲的識別碼（雲端存檔用來分辨「同一局」還是「另一局」，避免自動同步蓋掉別的遊戲） */
  const newGid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  G.State = {
    SAVE_KEY,
    create(mode) {
      const s = {
        v: 1, mode, seq: 1, gid: newGid(),
        time: U.at(1, 8), speed: 0,
        money: 0, rating: 60,
        chapter: 0, chapterStart: U.at(1, 8), obj: {}, objT: {}, flags: {}, sched: [],
        racks: [], devices: {}, links: {}, isp: [],
        room: [{ id: 'rm0', model: 'AC-8', status: 'ok', readyAt: 0 }],
        floors: {},
        fw: { rules: [], segmentation: false, guestWifi: false, iotVlan: false },
        subnets: { wired: 23, wifi: 22, guest: 23, servers: 24, dmz: 28, iot: 26 },
        services: {}, trainingUntil: 0,
        power: { outageUntil: 0, outageStart: 0, upsCharge: 1 },
        temp: 22, hum: 55, coolSet: 21,
        vm: { ha: true },
        wan: G.Wan.newState(),
        ep: G.Ep.newState(),
        vuln: G.Vuln.newState(),
        access: G.Acc.newState(),
        /* 實體接線：光模組、懸空的線、自我迴圈（phys.js） */
        phys: { xcvr: {}, loose: [], self: [], seq: 1 },
        /* 廁所與清潔（restroom.js）：沙盒一開始就有 4 位白班清潔人員；劇情模式第一章只有 2F，1 位就夠 */
        rest: G.Rest.newState(mode === 'sandbox' ? 4 : 1),
        /* 電話：沙盒模式從週一上班開始要有自己的電話交換機（之前用大樓的舊總機） */
        voice: { qos: false, trunk: 0, next: 0, nextAt: 0, graceUntil: mode === 'sandbox' ? U.at(3, 9) : 0 },
        stor: { snap: false, extraTB: 0 },
        bkp: { freq: 24, keep: 30, jobs: [], lastOk: null, lastTape: null, lastCloud: null, fault: null, drillAt: null, drillOk: null, drillUntil: 0 },
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
      try { const s = JSON.parse(str); return { mode: s.mode, time: s.time, chapter: s.chapter, money: s.money, scen: s.scen ? s.scen.id : null, gid: s.gid || null, won: !!s.won }; } catch (e) { return null; }
    },
    load() {
      const str = U.store.get(SAVE_KEY);
      if (!str) return null;
      try {
        const raw = JSON.parse(str);
        const hadGid = !!raw.gid;
        const s = G.State.migrate(raw);
        /* 舊存檔剛拿到識別碼：馬上寫回去，下次讀取才會是同一局 */
        if (s && !hadGid) U.store.set(SAVE_KEY, JSON.stringify(s));
        return s;
      } catch (e) { console.error(e); return null; }
    },
    clear() { U.store.del(SAVE_KEY); },
    migrate(s) {
      if (!s || s.v !== 1) return null;
      s.gid = s.gid || newGid();
      for (const f of G.BLD.floors) {
        if (s.floors[f.id]) continue;
        s.floors[f.id] = newFloorState();
        /* 新版本加入的樓層：沙盒模式下一個工作天啟用；
         * 劇情模式的 22F、23F 餐廳在第七章開張，B2 停車場在第二章啟用（已經過了第二章的存檔：下一個工作天一早啟用） */
        if (s.mode === 'sandbox') s.floors[f.id].moveInAt = U.nextWeekdayAt(s.time, f.id === 'B2' ? 7 : 9, 1);
        else if (f.id === 'B2' && s.mode === 'campaign' && s.chapter >= 1) s.floors[f.id].moveInAt = U.nextWeekdayAt(s.time, 7, 1);
      }
      s.sched = s.sched || [];
      if (s.hum === undefined) s.hum = 55;
      if (!s.coolSet) s.coolSet = 21;
      s.vm = s.vm || { ha: true };
      s.ep = s.ep || G.Ep.newState();
      s.vuln = s.vuln || G.Vuln.newState();
      s.access = s.access || G.Acc.newState();
      /* 智慧廁所的 IoT 網段（廁所與清潔本身在讀檔後由 Rest.ensure 補上） */
      if (s.fw.iotVlan === undefined) s.fw.iotVlan = false;
      s.subnets.iot = s.subnets.iot || 26;
      /* 沙盒模式全部知識卡都開放：新版本加入的卡片也要解鎖 */
      if (s.mode === 'sandbox') for (const c of G.KB.cards) if (s.kb.unlocked[c.id] === undefined) s.kb.unlocked[c.id] = s.time;
      /* 舊存檔：加入分支據點；沙盒模式接下來幾天陸續開幕 */
      if (!s.wan) {
        s.wan = G.Wan.newState();
        if (s.mode === 'sandbox') G.SITE_IDS.forEach((id, i) => { s.wan.sites[id].openAt = U.nextWeekdayAt(s.time, 9, 1 + Math.floor(i / 2)); });
      }
      /* 舊存檔：沙盒給兩天的時間換掉舊總機 */
      s.voice = s.voice || { qos: false, trunk: 0, next: 0, nextAt: 0, graceUntil: s.mode === 'sandbox' ? s.time + 2880 : 0 };
      s.stor = s.stor || { snap: false, extraTB: 0 };
      s.bkp = s.bkp || { freq: 24, keep: 30, jobs: [], lastOk: null, lastTape: null, lastCloud: null, fault: null, drillAt: null, drillOk: null, drillUntil: 0 };
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
    if (id === 'CLOUD') return 'cloud';
    if (id.startsWith('isp:')) return 'isp';
    if (id.startsWith('F:')) return 'floor';
    if (id.startsWith('S:')) return 'site';
    if (id.startsWith('WAN:')) return 'wan';
    const d = G.S.devices[id];
    return d ? CAT.devices[d.model].cat : 'unknown';
  };
  Q.nodeName = (id) => {
    if (id === 'INET') return '網際網路';
    if (id === 'CLOUD') return '公有雲';
    if (id === 'WAN:mpls') return 'MPLS 骨幹';
    if (id.startsWith('S:')) { const st = G.SITES[id.slice(2)]; return st ? st.name : id; }
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
    /* 實際插著線的埠（跳線、懸空的線、自我迴圈、ISP 交接） */
    if (G.Phys && G.S.phys) {
      const u = G.Phys.used(nodeId);
      out.rj45.used = u.rj45; out.sfp.used = u.sfp; out.qsfp.used = u.qsfp;
      return out;
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
    const pos = ft.pos || 0;
    /* 停車場：車道的車牌辨識 / 柵欄機、監視器 */
    const gates = ft.gates || 0, cams = ft.cams || 0;
    /* 智慧廁所的 IoT 閘道器（一台，PoE） */
    const iot = G.Rest && G.Rest.hasIot(fid) ? 1 : 0;
    return { seats, printers, pos, gates, cams, iot, aps: fs.aps.length, total: seats + printers + pos + gates + cams + iot + fs.aps.length };
  };
  /** 辦公樓層的進駐人數（不含餐廳與停車場人員） */
  Q.officeStaff = () => U.sum(G.BLD.floors.filter((f) => !G.FT[f.type].dine && !G.FT[f.type].park), (f) => G.S.floors[f.id].movedIn);
  Q.floorPorts = (fid) => {
    const fs = G.S.floors[fid];
    return fs.idf.count * CAT.access[fs.idf.model].ports;
  };
  Q.floorPoe = (fid) => {
    const f = G.BLD.byId[fid], fs = G.S.floors[fid], ft = G.FT[f.type];
    const budget = fs.idf.count * CAT.access[fs.idf.model].poe;
    const phones = ft.voip ? Math.ceil(f.staff * ft.wired) * 6 : 0;
    /* 監視器：每台約 7 W（PoE Class 2～3） */
    const cams = (ft.cams || 0) * 7;
    const aps = U.sum(fs.aps, (a) => CAT.aps[a.model].poe);
    const iot = G.Rest && G.Rest.hasIot(fid) ? CAT.rest.iotGw.poe : 0;
    return { budget, phones, cams, iot, aps, used: phones + cams + iot + aps };
  };

  /** CIDR 前綴 → 可用主機數 */
  Q.hosts = (prefix) => Math.pow(2, 32 - prefix) - 2;

  Q.monthlyServiceCost = (id) => {
    const svc = CAT.services[id];
    if (!svc) return 0;
    if (svc.perUser) return svc.perUser * Math.max(500, Q.employees());
    if (svc.perTB) return svc.perTB * Math.max(10, G.Stor ? G.Stor.backupTB() : 10);
    return svc.monthly || 0;
  };
  Q.employees = () => U.sum(Object.values(G.S.floors), (f) => f.movedIn);
  Q.hasService = (id) => !!G.S.services[id];
  Q.ispBw = (activeOnly) => U.sum(G.S.isp.filter((c) => !activeOnly || (c.status === 'active' && c.router)), (c) => c.bw);
  Q.fmtNode = (id) => Q.nodeName(id);
})(window.G = window.G || {});
