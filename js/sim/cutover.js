/* 第九章「割接之夜」：汰換停止支援的舊核心交換器
 * 章節開始：原廠把新核心 CX-9600 上架、灌好出廠設定（STP 關閉、只開 MOP 上的埠），還留了一條燒機測試線；
 *          舊核心上六成的線沒有標籤。
 * 維護窗口：隔天凌晨 02:00–05:00（至少留一個白天準備），時間一到自動暫停；窗口內每個實體動作都要花遊戲時間（拔線 1 分、循線 5 分……）。
 * 評分：窗口內影響的人分鐘、接錯次數、廣播風暴、提前動線（違反變更管理）、超時、準備工作。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Cut = {};
  G.Cut = Cut;

  Cut.on = () => !!(G.S && G.S.cut && !G.S.cut.done);
  Cut.dev = (k) => (G.S && G.S.cut ? G.S.devices[G.S.cut[k]] || null : null);
  /** 維護窗口進行中（開始之後、搬完之前） */
  Cut.inWindow = () => { const c = G.S && G.S.cut; return !!c && !c.done && G.S.time >= c.win.start && !c.moved; };
  Cut.phase = () => {
    const c = G.S && G.S.cut;
    if (!c) return null;
    if (c.done) return 'done';
    if (G.S.time < c.win.start) return 'prep';
    if (!c.moved) return G.S.time <= c.win.end ? 'window' : 'over';
    return 'after';
  };

  /** 維護窗口：第一個「距離現在至少 14 小時」的凌晨 02:00（留一個白天做準備） */
  function nextWindow(t) {
    for (let d = U.dayOf(t); d < U.dayOf(t) + 4; d++) {
      const w = U.at(d, 2);
      if (w - t >= 14 * 60) return w;
    }
    return t + 1440;
  }

  /* 新核心的埠規劃：用途 → 依序使用的埠 */
  const POOLS = {
    floor: { sfp: [1, 48], qsfp: [5, 20] },
    srv: { sfp: [49, 80], qsfp: [21, 24] },
    core: { sfp: [81, 88], qsfp: [25, 28] },
    fw: { sfp: [89, 94], qsfp: [1, 4] },
  };

  /** 章節開始：原廠到府上架新核心、產生 MOP */
  Cut.begin = (s) => {
    const P = G.Phys.st();
    const cores = Q.devices('switch').filter((d) => d.rack && Q.isL3(d));
    /* 萬一沒有 L3 核心（例如被賣掉了）：改汰換接最多線的交換器；連交換器都沒有就跳過本章 */
    const cands = cores.length ? cores : Q.devices('switch').filter((d) => d.rack && Q.linksOf(d.id).length);
    if (!cands.length) { s.flags.c9skip = true; G.Act.log('沒有可以汰換的核心交換器：割接任務直接完成', 'warn'); return; }
    const idn = (d) => parseInt(String(d.id).replace(/\D/g, ''), 10) || 0;
    /* 舊核心：接最多線的那台（通常是第一章買的 CORE-1） */
    const mcount = (d) => U.sum(Q.linksOf(d.id), (l) => (l.members || []).length);
    const old = cands.slice().sort((a, b) => mcount(b) - mcount(a) || idn(a) - idn(b))[0];
    const peer = cores.filter((d) => d.id !== old.id).sort((a, b) => idn(a) - idn(b))[0] || null;
    /* 新核心：集團採購、原廠上架（不花預算） */
    const price = CAT.devices['CX-9600'].price;
    s.money += price;
    const r = G.Act.buyDevice('CX-9600');
    const neu = s.devices[r.ids[0]];
    neu.name = 'CORE-NEW';
    let placed = false;
    const tryRack = (rid) => { for (let u = CAT.rack.units - 6; u >= 1; u--) if (G.Act.fits(rid, u, 7, neu.id) && !G.Act.rackCheck(neu, rid)) { neu.rack = rid; neu.u = u; return true; } return false; };
    placed = tryRack(old.rack) || s.racks.filter((x) => x.type !== 'ai').some((x) => tryRack(x.id));
    if (!placed) {
      s.money += CAT.rack.price;
      const rr = G.Act.buyRack();
      if (rr.ok) placed = tryRack(rr.id);
    }
    neu.bootUntil = s.time + 10;
    neu.stp = false;
    neu.plan = {};
    neu.vendor = true;
    /* 原廠的燒機測試線：兩個埠互接（沒開 STP 的交換器 = 自我迴圈） */
    (P.xcvr[neu.id] = P.xcvr[neu.id] || {}).s95 = '25G-SR';
    P.xcvr[neu.id].s96 = '25G-SR';
    P.self.push({ id: 'p' + (P.seq++), node: neu.id, ap: 's95', bp: 's96', cord: 'om4', pol: true, lab: true, len: 1, tag: 'burnin' });
    neu.plan.s95 = 'floor'; neu.plan.s96 = 'floor';
    /* MOP：舊核心上的每一條線（和其他核心的互連除外），依用途分配到新核心的埠 */
    const used = { sfp: {}, qsfp: {} };
    const take = (role, cls) => {
      const [a, b] = POOLS[role][cls];
      for (let n = a; n <= b; n++) { const pid = (cls === 'qsfp' ? 'q' : 's') + n; if (!used[cls][pid]) { used[cls][pid] = true; return pid; } }
      return null;
    };
    const rows = [];
    let i = 0;
    for (const l of Q.linksOf(old.id)) {
      const far = Q.other(l, old.id);
      if (far === neu.id) continue;
      const fd = s.devices[far];
      if (fd && Q.isL3(fd)) continue;
      for (const m of l.members || []) {
        const oldPid = l.a === old.id ? m.ap : m.bp, farPid = l.a === old.id ? m.bp : m.ap;
        const cord = CAT.cords[m.cord] || {};
        const role = G.Phys.roleFor(far);
        const cls = oldPid[0] === 'q' ? 'qsfp' : 'sfp';
        const newPid = take(role, cls) || take(role, cls === 'qsfp' ? 'sfp' : 'qsfp');
        if (!newPid) continue;
        const fm = G.Phys.mod(far, farPid);
        const mod = cord.media === 'dac' ? null : farPid[0] === 'r' ? '1G-T' : fm || G.Phys.mod(old.id, oldPid);
        neu.plan[newPid] = role;
        /* 六成的線沒有標籤（施工時沒貼、或早就掉了） */
        if ((i * 7 + 3) % 5 < 3) m.lab = false;
        i++;
        /* 新核心在別座機櫃：同機櫃用的 3 m 跳線拉不過去，要換一條新的 */
        const need = far.startsWith('F:') ? 0 : G.Act.linkLength(far, neu.id);
        rows.push({ id: 'r' + i, far, farPid, oldPid, newPid, role, mod, cord: m.cord, len: m.len, short: need > (m.len || 0) ? need : 0 });
      }
    }
    /* 和 CORE-2 的互連：新核心最後四個 QSFP 保留給核心互連 */
    for (const q of ['q29', 'q30', 'q31', 'q32']) neu.plan[q] = 'core';
    s.cut = {
      old: old.id, neu: neu.id, peer: peer ? peer.id : null,
      win: { start: 0, end: 0 }, rows, badCord: 1, mopRead: false, moved: null, done: false, report: null,
      st: { impWin: 0, impOut: 0, errors: 0, storms: 0, early: 0, over: 0, unlab0: null, moves: 0 },
      log: [],
    };
    const w = nextWindow(s.time);
    s.cut.win = { start: w, end: w + 180 };
    Cut.log(`原廠工程師把 ${neu.name}（CX-9600）裝在 ${neu.rack} 的 U${neu.u}–U${neu.u + 6}，灌好出廠設定`);
    Cut.log(`維護窗口：${U.dayLabel(w)} 02:00–05:00（變更單 CHG-${U.dayOf(w)}-0917）`);
    G.Phys.touch();
    G.Phys.refresh();
  };
  Cut.log = (text) => { const c = G.S.cut; if (c) { c.log.push({ t: G.S.time, text }); if (c.log.length > 80) c.log.shift(); } };

  /* ---------- MOP 每一列的狀態 ---------- */
  /** { st: 'todo' | 'moving' | 'done' | 'bad' | 'gone' | 'other', text, l, m } */
  Cut.rowState = (row) => {
    const c = G.S.cut;
    const o = G.Phys.at(row.far, row.farPid);
    if (!o) return { st: 'gone', text: `${G.Phys.label(row.far, row.farPid)} 沒有接線了：要接一條新跳線到新核心` };
    if (o.t === 'loose') return { st: 'moving', text: '另一端拔起來了（懸空）：插到新核心' };
    if (o.t !== 'm') return { st: 'other', text: '這個埠接著別的東西' };
    const other = o.end === 'a' ? o.l.b : o.l.a;
    const otherPid = o.end === 'a' ? o.m.bp : o.m.ap;
    if (other === c.old) return { st: 'todo', text: '還接在舊核心', l: o.l, m: o.m };
    if (other === c.neu) {
      const ms = G.Phys.mState(o.l, o.m);
      if (ms.fwd) return { st: 'done', text: otherPid === row.newPid ? '已搬到新核心 ✓' : `已搬到新核心 ✓（接在 ${G.Phys.name(c.neu, otherPid)}，MOP 是 ${G.Phys.name(c.neu, row.newPid)}）`, l: o.l, m: o.m, alt: otherPid !== row.newPid };
      return { st: 'bad', text: ms.text, l: o.l, m: o.m };
    }
    return { st: 'other', text: `接到 ${G.Phys.label(other, otherPid)} 了（不在 MOP 上）`, l: o.l, m: o.m };
  };
  /** 還需要搬的列（對端設備被賣掉、樓層接入交換器拆掉的就不算了） */
  Cut.rows = () => { const c = G.S.cut; return c ? c.rows.filter((r) => G.Phys.exists(r.far, r.farPid)) : []; };
  Cut.progress = () => {
    const rows = Cut.rows();
    return { done: rows.filter((r) => Cut.rowState(r).st === 'done').length, total: rows.length };
  };
  /** 新核心的準備：STP 開啟、燒機測試線拆掉 */
  Cut.prepOk = () => {
    const c = G.S.cut, n = Cut.dev('neu');
    if (!c || !n) return false;
    const P = G.Phys.st();
    return n.stp !== false && !P.self.some((x) => x.node === n.id) && !P.loose.some((x) => x.node === n.id && x.tag === 'burnin');
  };
  /** 舊核心上沒標籤的線 */
  Cut.unlabeled = () => {
    const c = G.S.cut;
    if (!c) return [];
    const out = [];
    for (const pid of G.Phys.ports(c.old)) {
      const o = G.Phys.at(c.old, pid);
      if (!o || o.t === 'isp') continue;
      const x = o.t === 'm' ? o.m : o.x;
      if (!x.lab) out.push(pid);
    }
    return out;
  };
  Cut.labelsOk = () => { const c = G.S.cut; return !!c && Cut.unlabeled().length === 0; };
  /** 新核心上 MOP 指定的埠有沒有插對的模組 */
  Cut.modOk = (row) => {
    const c = G.S.cut;
    if (!row.mod) return true;
    const st = Cut.rowState(row);
    if (st.st === 'done') return true;
    return G.Phys.mod(c.neu, row.newPid) === row.mod;
  };
  Cut.modsReady = () => Cut.rows().filter(Cut.modOk).length;
  Cut.modsOk = () => { const rows = Cut.rows(); return !!G.S.cut && rows.filter(Cut.modOk).length === rows.length; };
  /** 新核心 ⇄ CORE-2：兩條以上、LACP、都在轉送 */
  Cut.lagOk = () => {
    const c = G.S.cut;
    if (!c) return false;
    if (!c.peer || !G.S.devices[c.peer]) return true;
    return Q.linkBetween(c.neu, c.peer).some((l) => l.lacp && (l.members || []).filter((m) => G.Phys.mState(l, m).fwd).length >= 2);
  };
  Cut.movedAll = () => { const p = Cut.progress(); return !!G.S.cut && p.done === p.total; };
  /** 沒有核心可以汰換（本章直接完成） */
  Cut.skip = () => !!(G.S && G.S.flags && G.S.flags.c9skip);
  /** 舊核心已下架（沒有任何線、不在機櫃上或已出售） */
  Cut.removed = () => {
    const c = G.S.cut;
    if (!c) return false;
    const d = G.S.devices[c.old];
    if (!d) return true;
    return !d.rack && !Q.linksOf(c.old).length;
  };
  /** 所有樓層、服務都正常 */
  Cut.healthy = () => {
    const sim = G.R.sim;
    if (!sim || !G.R.l2 || G.R.l2.stormNodes.size) return false;
    for (const f of G.BLD.floors) {
      const st = sim.floors[f.id];
      if (!st || G.S.floors[f.id].movedIn <= 0) continue;
      if (!st.up) return false;
      if (st.flows.some((fl) => fl.blocked === 'noroute' || fl.blocked === 'nosvc')) return false;
    }
    return true;
  };

  /* ---------- 時間：窗口內每個動作都要花時間 ---------- */
  Cut.spend = (min) => {
    if (!Cut.inWindow() || min <= 0) return;
    G.Engine.advance(min);
  };

  /* ---------- 每分鐘（模擬之後） ---------- */
  Cut.tick = (s) => {
    const c = s.cut;
    if (!c || c.done) return;
    const ph = Cut.phase();
    if (s.time === c.win.start) {
      c.st.unlab0 = Cut.unlabeled().length;
      s.speed = 0; s.skipUntil = null;
      G.bus.emit('speed');
      Cut.log('維護窗口開始：變更單核准，開始割接');
      G.Act.log('維護窗口開始（02:00–05:00）：開始割接', 'warn');
      G.bus.emit('cut', { kind: 'start' });
    }
    if (s.time === c.win.end && !c.moved) {
      Cut.log('05:00 維護窗口結束了，還有線沒搬完：開始超時');
      G.bus.emit('notice', { kind: 'bad', text: '維護窗口結束了！還沒搬完的每一分鐘都算超時；07:00 同事就要上班', goto: 'rack:patch' });
    }
    /* 影響：離線的樓層人數（窗口內、窗口外分開算） */
    const sim = G.R.sim;
    if (sim) {
      let imp = 0;
      for (const f of G.BLD.floors) {
        const st = sim.floors[f.id];
        if (!st || st.present < 0.5) continue;
        if (!st.up || st.flows.some((fl) => fl.blocked === 'noroute' || fl.blocked === 'nosvc')) imp += st.present;
      }
      /* 窗口外只算割接造成的（廣播風暴）：停電、ISP 中斷這類無關的事件不算在割接頭上 */
      if (ph === 'window' || ph === 'over') c.st.impWin += imp;
      else if (G.R.l2 && G.R.l2.stormNodes.size > 1) c.st.impOut += imp;
    }
    /* 廣播風暴（剛發生的那一分鐘算一次） */
    const storm = !!(G.R.l2 && G.R.l2.stormNodes.size > 1);
    if (storm && !c.storming) { c.st.storms++; Cut.log('⚠ 廣播風暴！'); }
    c.storming = storm;
    if (!c.moved && Cut.movedAll()) {
      c.moved = s.time;
      c.st.over = Math.max(0, s.time - c.win.end);
      Cut.log(`MOP 上的 ${c.rows.length} 條線全部搬到新核心${c.st.over ? `（超時 ${U.dur(c.st.over)}）` : ''}`);
      G.bus.emit('notice', { kind: 'good', text: '最後一條線也搬完了！接著驗證、再把舊核心下架', goto: 'rack:patch' });
    }
  };

  /* ---------- 接線動作的紀錄：接錯、提前動線 ---------- */
  G.bus.on('phys', (e) => {
    const s = G.S, c = s && s.cut;
    if (!c || c.done) return;
    if (e.kind === 'unplug' && e.node === c.old && s.time < c.win.start && c.rows.some((r) => r.oldPid === e.pid)) {
      c.st.early++;
      Cut.log(`⚠ 還沒到維護窗口就拔了 ${G.Phys.label(e.node, e.pid)}（違反變更管理）`);
    }
    if (e.kind === 'unplug' && e.node === c.old) c.st.moves++;
    if ((e.kind === 'plug' || e.kind === 'patch') && (e.node || e.b)) {
      const node = e.node || e.b, pid = e.pid || e.bp;
      const o = G.Phys.at(node, pid);
      if (o && o.t === 'm') {
        const ms = G.Phys.mState(o.l, o.m);
        const involved = [o.l.a, o.l.b].includes(c.neu) || [o.l.a, o.l.b].includes(c.old);
        /* 廠商附的那條極性接反的新跳線不算玩家接錯（翻過來就好） */
        if (involved && !ms.fwd && !o.m.badCord && !['blk', 'stby', 'down', 'build'].includes(ms.code)) {
          c.st.errors++;
          Cut.log(`✗ ${G.Phys.label(node, pid)}：${ms.text}`);
        }
      }
    }
  });

  /** 割接成績 */
  Cut.report = () => {
    const c = G.S.cut;
    if (!c) return null;
    const S = c.st;
    const items = [
      { k: '維護窗口內的影響', v: `${U.num(Math.round(S.impWin))} 人分鐘`, pen: Math.min(40, S.impWin / 40) },
      { k: '上班時間的影響', v: `${U.num(Math.round(S.impOut))} 人分鐘`, pen: Math.min(30, S.impOut / 100) },
      { k: '接錯 / 不通的線', v: `${S.errors} 次`, pen: S.errors * 3 },
      { k: '廣播風暴', v: `${S.storms} 次`, pen: S.storms * 20 },
      { k: '沒到窗口就動線', v: `${S.early} 條`, pen: S.early * 6 },
      { k: '超過維護窗口', v: S.over ? U.dur(S.over) : '沒有', pen: Math.min(25, S.over / 4) },
      { k: '窗口開始時沒標籤的線', v: S.unlab0 === null ? '—' : `${S.unlab0} 條`, pen: Math.min(10, S.unlab0 || 0) },
    ];
    const pts = Math.max(0, Math.round(100 - U.sum(items, (x) => x.pen)));
    const grade = pts >= 95 ? 'S' : pts >= 85 ? 'A' : pts >= 70 ? 'B' : pts >= 55 ? 'C' : 'D';
    return { pts, grade, items, rows: c.rows.length, moved: c.moved, win: c.win };
  };
  Cut.finish = () => {
    const c = G.S.cut;
    if (!c || c.done) return;
    c.report = Cut.report();
    c.done = true;
    const n = Cut.dev('neu');
    if (n) { delete n.plan; n.vendor = false; }
    G.Phys.touch();
  };
})(window.G = window.G || {});
