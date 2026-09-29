/* 實體接線：連接埠、光模組、跳線、LACP 與生成樹（STP）
 * 每條線路（link）由一條或多條實體跳線（member）組成：
 *   l.members = [{ id, ap, bp, cord, pol, lab, len, ds? }]
 *   ap / bp：兩端的埠（'r3' = RJ45 第 3 埠、's12' = SFP 第 12 埠、'q2' = QSFP 第 2 埠、'u1' = 樓層 IDF 的上行埠）
 *   cord = 跳線種類（CAT.cords）、pol = 光纖極性正確、lab = 有貼標籤、len = 線長 (m)、ds = DAC 的速率
 * 光模組插在埠上：s.phys.xcvr[節點][埠] = 型號（拔線時模組會留在埠上）
 * 拔掉一端的跳線：s.phys.loose（另一端還插著）；同一台設備的兩個埠互接：s.phys.self
 * 線路容量 = 正常運作、而且沒有被 STP 擋下的跳線速率總和
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Phys = {};
  G.Phys = Phys;

  const CLS = { r: 'rj45', s: 'sfp', q: 'qsfp', u: 'sfp' };
  const SFP_SP = [1000, 10000, 25000], QSFP_SP = [40000, 100000, 400000];
  /** 線材種類 × 速率 → 光模組 */
  const MOD = {
    mmf: { 1000: '1G-SX', 10000: '10G-SR', 25000: '25G-SR', 40000: '40G-SR4', 100000: '100G-SR4', 400000: '400G-SR8' },
    smf: { 1000: '1G-LX', 10000: '10G-LR', 25000: '25G-LR', 40000: '40G-LR4', 100000: '100G-LR4', 400000: '400G-FR4' },
    copper: { 1000: '1G-T', 10000: '10G-T' },
  };
  Phys.MOD = MOD;
  Phys.MEDIA = { copper: '銅纜', mmf: '多模光纖', smf: '單模光纖', dac: 'DAC 直連銅纜' };
  /** 埠的用途設定（割接時原廠預先設定好的新核心） */
  Phys.ROLES = {
    floor: { name: '樓層上行', cfg: 'switchport mode trunk（VLAN 10,20,30,40）' },
    srv: { name: '伺服器', cfg: 'switchport access vlan 50' },
    fw: { name: '防火牆', cfg: 'no switchport · ip address 10.0.0.x/30' },
    core: { name: '核心互連', cfg: 'channel-group 1 mode active（LACP）' },
  };

  /** 狀態的簡短說法（拓撲圖的標籤用） */
  Phys.SHORT = { up: '正常', blk: 'STP 阻擋', stby: '備援待命', pol: '極性接反', nomod: '沒插模組', unsup: '模組不支援', speed: '速率不同', media: '跳線不對',
    wl: '模組不成對', reach: '距離太遠', shut: '埠未設定', vlan: 'VLAN 不符', storm: '廣播風暴', down: '設備沒運作', noport: '埠不存在', cut: '中斷', build: '施工中' };
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });

  Phys.st = () => {
    const s = G.S;
    if (!s.phys) s.phys = { xcvr: {}, loose: [], self: [], seq: 1 };
    return s.phys;
  };
  const nid = () => { const P = Phys.st(); return 'p' + (P.seq++); };
  function touch() { G.R.topoVer++; G.R.physVer = (G.R.physVer || 0) + 1; }
  Phys.touch = touch;

  /* ---------- 連接埠 ---------- */
  /** 節點的連接埠數量與速率上限 */
  Phys.spec = (nodeId) => {
    if (!nodeId || !G.S) return null;
    if (nodeId.startsWith('F:')) {
      const fs = G.S.floors[nodeId.slice(2)];
      if (!fs) return null;
      const am = CAT.access[fs.idf.model];
      return { floor: true, r: 0, s: 0, q: 0, u: fs.idf.count * am.uplinks, per: am.uplinks, sfpMax: am.uplinkMax, qsfpMax: 0, cat: 'floor' };
    }
    const d = G.S.devices[nodeId];
    if (!d || d.host) return null;
    const m = CAT.devices[d.model];
    return { floor: false, r: m.ports.rj45 || 0, s: m.ports.sfp || 0, q: m.ports.qsfp || 0, u: 0, sfpMax: m.sfpMax || 0, qsfpMax: m.qsfpMax || 0, cat: m.cat };
  };
  const num = (pid) => parseInt(pid.slice(1), 10) || 0;
  Phys.cls = (pid) => CLS[pid[0]];
  Phys.exists = (nodeId, pid) => {
    const sp = Phys.spec(nodeId);
    if (!sp || !pid || !CLS[pid[0]]) return false;
    const n = num(pid);
    return n >= 1 && n <= (sp[pid[0]] || 0);
  };
  /** 這個埠支援的速率 */
  Phys.speeds = (nodeId, pid) => {
    const sp = Phys.spec(nodeId);
    if (!sp) return [];
    const c = CLS[pid[0]];
    if (c === 'rj45') return [1000];
    if (c === 'sfp') return SFP_SP.filter((v) => v <= sp.sfpMax);
    return QSFP_SP.filter((v) => v <= sp.qsfpMax);
  };
  /** 介面名稱：網路設備用 Gi / Te / Twe / Hu / FH，伺服器用 Linux 網卡名稱 */
  Phys.name = (nodeId, pid) => {
    const sp = Phys.spec(nodeId);
    if (!sp || !pid) return pid || '';
    const n = num(pid), c = CLS[pid[0]];
    if (sp.floor) {
      const k = Math.ceil(n / sp.per), j = (n - 1) % sp.per + 1;
      return `${sp.sfpMax >= 25000 ? 'Twe' : 'Te'}${k}/1/${j}`;
    }
    if (sp.cat === 'server' || sp.cat === 'storage' || sp.cat === 'wlc') return c === 'rj45' ? `eno${n}` : c === 'sfp' ? `ens1f${n - 1}` : `ens2f${n - 1}`;
    if (c === 'rj45') return `Gi1/0/${n}`;
    if (c === 'sfp') return `${sp.sfpMax >= 25000 ? 'Twe' : sp.sfpMax >= 10000 ? 'Te' : 'Gi'}1/1/${n}`;
    return `${sp.qsfpMax >= 400000 ? 'FH' : sp.qsfpMax >= 100000 ? 'Hu' : 'Fo'}1/2/${n}`;
  };
  /** 「設備名 介面名」 */
  Phys.label = (nodeId, pid) => `${Q.nodeName(nodeId)} ${Phys.name(nodeId, pid)}`;
  Phys.ports = (nodeId) => {
    const sp = Phys.spec(nodeId);
    const out = [];
    if (!sp) return out;
    for (const k of ['r', 's', 'q', 'u']) for (let n = 1; n <= (sp[k] || 0); n++) out.push(k + n);
    return out;
  };

  /* ---------- 哪個埠被什麼佔用（快取，拓撲一改就重建） ---------- */
  function index() {
    const key = G.R.topoVer + ':' + (G.R.physVer || 0);
    if (G.R.physIdx && G.R.physIdx.key === key && G.R.physIdx.s === G.S) return G.R.physIdx;
    const at = new Map(), byNode = new Map();
    const put = (node, pid, o) => {
      if (!node || !pid) return;
      at.set(node + '|' + pid, o);
      if (!byNode.has(node)) byNode.set(node, []);
      byNode.get(node).push(pid);
    };
    for (const l of Object.values(G.S.links)) {
      for (const m of l.members || []) { put(l.a, m.ap, { t: 'm', l, m, end: 'a' }); put(l.b, m.bp, { t: 'm', l, m, end: 'b' }); }
    }
    const P = Phys.st();
    for (const x of P.loose) put(x.node, x.pid, { t: 'loose', x });
    for (const x of P.self) { put(x.node, x.ap, { t: 'self', x, end: 'a' }); put(x.node, x.bp, { t: 'self', x, end: 'b' }); }
    for (const c of G.S.isp) if (c.router && c.pid) put(c.router, c.pid, { t: 'isp', c });
    G.R.physIdx = { key, at, byNode, s: G.S };
    return G.R.physIdx;
  }
  /** 埠上接的東西：{ t: 'm' | 'loose' | 'self' | 'isp', ... } 或 null */
  Phys.at = (nodeId, pid) => index().at.get(nodeId + '|' + pid) || null;
  /** 已使用的埠數（依種類） */
  Phys.used = (nodeId) => {
    const out = { rj45: 0, sfp: 0, qsfp: 0 };
    for (const pid of index().byNode.get(nodeId) || []) out[CLS[pid[0]]]++;
    return out;
  };
  /** 找空的埠：依序優先「用途符合的埠」→「沒有插模組的埠」 */
  Phys.free = (nodeId, cls, n, other, avoid) => {
    const cands = [];
    for (const pid of Phys.ports(nodeId)) {
      if (CLS[pid[0]] !== cls || Phys.at(nodeId, pid) || (avoid && avoid.has(pid))) continue;
      const pr = other ? Phys.planFit(nodeId, pid, other) : 1;
      cands.push({ pid, sc: pr * 10 + (Phys.mod(nodeId, pid) ? 0 : 1), n: num(pid) });
    }
    cands.sort((a, b) => b.sc - a.sc || a.n - b.n);
    return cands.slice(0, n || 1).map((c) => c.pid);
  };

  /* ---------- 光模組 ---------- */
  Phys.mod = (nodeId, pid) => { const x = Phys.st().xcvr[nodeId]; return (x && x[pid]) || null; };
  function setMod(nodeId, pid, key) {
    const P = Phys.st();
    if (key) (P.xcvr[nodeId] = P.xcvr[nodeId] || {})[pid] = key;
    else if (P.xcvr[nodeId]) { delete P.xcvr[nodeId][pid]; if (!Object.keys(P.xcvr[nodeId]).length) delete P.xcvr[nodeId]; }
  }
  /** 這種線材、速率、埠要用哪個模組（RJ45 埠內建、DAC 自帶模組 → null） */
  Phys.modFor = (medium, speed, cls) => {
    if (cls === 'rj45' || medium === 'dac') return null;
    return (MOD[medium] || {})[speed] || null;
  };
  /** 線材 + 模組 → 跳線種類 */
  Phys.cordFor = (cable, modKey) => {
    const c = CAT.cables[cable];
    if (!c) return 'om4';
    if (c.medium === 'copper') return cable;
    if (c.medium === 'dac') return 'dac';
    if (c.medium === 'smf') return 'os2';
    return modKey && CAT.xcvr[modKey] && CAT.xcvr[modKey].conn === 'mpo' ? 'om4-mpo' : 'om4';
  };
  Phys.cordPrice = (cordKey, ds) => { const c = CAT.cords[cordKey]; return c ? (c.priceBy ? c.priceBy[ds] || c.price : c.price) : 0; };

  /** 一端的實體狀態 */
  function endOf(nodeId, pid, cordKey, ds) {
    const cls = CLS[pid[0]];
    const cord = CAT.cords[cordKey];
    const sp = Phys.speeds(nodeId, pid);
    if (cls === 'rj45') return { cls, speed: 1000, media: 'copper', conn: 'rj45', ok: true, label: '內建 RJ45' };
    if (cord && cord.media === 'dac') return { cls, speed: ds, media: 'dac', conn: 'dac', dac: true, ok: sp.includes(ds), label: `DAC ${U.speed(ds)}` };
    const mk = Phys.mod(nodeId, pid);
    if (!mk) return { cls, speed: 0, media: null, conn: null, nomod: true, ok: false, label: '沒有模組' };
    const x = CAT.xcvr[mk];
    return { cls, speed: x.speed, media: x.media, conn: x.conn, wl: x.wl || 0, mod: mk, ok: sp.includes(x.speed), label: x.name };
  }
  Phys.endOf = endOf;

  /* ---------- 割接時的埠設定（新核心由原廠預先設定用途） ---------- */
  /** 對端是什麼 → 這個埠應該設成什麼用途 */
  Phys.roleFor = (otherId) => {
    const k = Q.nodeKind(otherId);
    if (k === 'floor') return 'floor';
    if (k === 'firewall' || k === 'router') return 'fw';
    if (k === 'switch') return 'core';
    return 'srv';
  };
  /** 設定不符：'shut'（沒有設定）/ 'vlan'（用途不對）/ null */
  function planErr(nodeId, pid, otherId) {
    const d = G.S.devices[nodeId];
    if (!d || !d.plan) return null;
    const r = d.plan[pid];
    if (!r) return 'shut';
    return r === Phys.roleFor(otherId) ? null : 'vlan';
  }
  Phys.planErr = planErr;
  /** 快速連線挑埠用：用途符合 2、沒有設定限制 1、不符 0 */
  Phys.planFit = (nodeId, pid, otherId) => {
    const d = G.S.devices[nodeId];
    if (!d || !d.plan) return 1;
    return d.plan[pid] === Phys.roleFor(otherId) ? 2 : 0;
  };

  /* ---------- 跳線狀態 ---------- */
  const TXT = {
    noport: '這個埠已經不存在（接入交換器變少了？）',
    cut: '光纖斷了',
    build: '主幹線施工中',
    shut: '埠沒有設定（shutdown）',
  };
  const res = (code, text, o) => Object.assign({ code, text, up: false, fwd: false, speed: 0, led: ['off', 'off'], rx: [-40, -40] }, o || {});
  /** 實體層 + 設定：還不含 STP / 風暴 */
  function phyState(l, m) {
    const na = l.a, nb = l.b;
    if (!Phys.exists(na, m.ap) || !Phys.exists(nb, m.bp)) return res('noport', TXT.noport);
    if (l.status === 'cut') return res('cut', '光纖斷了（等待熔接搶修）');
    if (l.status === 'repair') return res('cut', '光纖熔接修復中');
    if (G.Net.linkBuilding(l)) return res('build', TXT.build);
    const upA = G.Net.nodeUp(na), upB = G.Net.nodeUp(nb);
    if (!upA || !upB) return res('down', `${Q.nodeName(!upA ? na : nb)} 沒有運作（沒電、故障或開機中）：對面沒有訊號`);
    const A = endOf(na, m.ap, m.cord, m.ds), B = endOf(nb, m.bp, m.cord, m.ds);
    const p = phyCheck(A, B, m, [na, m.ap], [nb, m.bp]);
    if (p) return p;
    const vA = planErr(na, m.ap, nb), vB = planErr(nb, m.bp, na);
    if (vA === 'shut' || vB === 'shut') {
      const [n, pid] = vA === 'shut' ? [na, m.ap] : [nb, m.bp];
      return res('shut', `${Phys.label(n, pid)} 還沒有設定（shutdown）：原廠只開了割接計畫裡的埠`, { cfgAt: n, cfgPid: pid });
    }
    const rx = [-2.1 - (m.len || 0) * 0.004, -2.3 - (m.len || 0) * 0.004];
    if (vA === 'vlan' || vB === 'vlan') {
      const [n, pid, o] = vA === 'vlan' ? [na, m.ap, nb] : [nb, m.bp, na];
      const d = G.S.devices[n];
      const r = Phys.ROLES[d.plan[pid]], want = Phys.ROLES[Phys.roleFor(o)];
      return res('vlan', `${Phys.label(n, pid)} 設定的用途是「${r ? r.name : '?'}」，但接的是 ${Q.nodeName(o)}（應該是「${want.name}」）：燈亮了、流量卻過不去`, { up: true, speed: A.speed, led: ['on', 'on'], rx, cfgAt: n, cfgPid: pid });
    }
    return res('up', 'Link up · 正常轉送', { up: true, fwd: true, speed: A.speed, led: ['on', 'on'], rx });
  }
  function phyCheck(A, B, m, ea, eb) {
    const cord = CAT.cords[m.cord] || {};
    for (const [E, e] of [[A, ea], [B, eb]]) {
      if (E.nomod) return res('nomod', `${Phys.label(e[0], e[1])} 沒有插光模組`);
      if (!E.ok) {
        const led = E === A ? ['err', 'off'] : ['off', 'err'];
        return res('unsup', `${Phys.label(e[0], e[1])} 不支援 ${E.label}（${U.speed(E.speed)}）：埠被停用（err-disabled）`, { led });
      }
    }
    if (A.speed !== B.speed) return res('speed', `兩端速率不同（${A.label} ${U.speed(A.speed)} ↔ ${B.label} ${U.speed(B.speed)}）：光模組要成對`);
    const mOk = (E) => E.media === cord.media;
    if (!mOk(A) || !mOk(B)) {
      const E = !mOk(A) ? A : B;
      return res('media', `${E.label} 是${Phys.MEDIA[E.media] || '?'}的模組，卻接了${cord.name || '?'}：光纖種類不對，收不到訊號`);
    }
    if (A.wl && B.wl && A.wl !== B.wl) return res('wl', `兩端的光模組不同（${A.label} ${A.wl} nm ↔ ${B.label} ${B.wl} nm）：波長不同，彼此收不到光`);
    const cab = CAT.cables[cord.cable];
    const max = cab && cab.max[A.speed];
    if (!max) return res('media', `${cord.name || '?'} 不支援 ${U.speed(A.speed)}`);
    if ((m.len || 0) > max) return res('reach', `距離 ${m.len} m 超過 ${cab.short} 跑 ${U.speed(A.speed)} 的上限 ${max} m：光功率太弱（Rx −18 dBm）`, { rx: [-18.2, -18.6], led: ['off', 'off'] });
    if ((cord.conn === 'lc' || cord.conn === 'mpo') && m.pol === false) return res('pol', '光纖極性接反（Tx 接到 Tx）：兩端都收不到光。把其中一端的 LC 接頭 A/B 對調');
    return null;
  }
  Phys.phyState = phyState;

  /** 完整狀態（含 STP 阻擋、備援待命、廣播風暴） */
  Phys.mState = (l, m) => {
    const st = phyState(l, m);
    if (!st.up || st.code === 'vlan') return st;
    const R = G.R.l2;
    if (!R) return st;
    if (R.stormNodes.has(l.a) || R.stormNodes.has(l.b)) return Object.assign(st, { code: 'storm', text: '廣播風暴：迴圈上的交換器都沒有開 STP，廣播封包無限循環、塞爆所有連線', fwd: false, led: ['storm', 'storm'] });
    const b = R.blocked.get(m.id);
    if (b) return Object.assign(st, { code: 'blk', text: 'STP 阻擋（Blocking）：這條是迴圈上多出來的路徑，暫時不轉送、當作備援', fwd: false, led: b === 'a' ? ['blk', 'on'] : ['on', 'blk'] });
    if (R.standby.has(m.id)) return Object.assign(st, { code: 'stby', text: '備援待命：沒有設定 LACP，伺服器網卡只用一條（active-backup）', fwd: false });
    return st;
  };
  /** 線路目前能用的頻寬 */
  Phys.cap = (l) => {
    if (!l.members) return l.speed * l.count;
    let c = 0;
    for (const m of l.members) { const st = Phys.mState(l, m); if (st.fwd) c += st.speed; }
    return c;
  };
  /** 設計頻寬（所有跳線都正常時） */
  Phys.nominal = (l) => (l.members ? U.sum(l.members, (m) => memberSpeed(l, m)) : l.speed * l.count);
  function memberSpeed(l, m) {
    const A = Phys.exists(l.a, m.ap) ? endOf(l.a, m.ap, m.cord, m.ds) : null;
    const B = Phys.exists(l.b, m.bp) ? endOf(l.b, m.bp, m.cord, m.ds) : null;
    return (A && A.speed) || (B && B.speed) || l.speed || 0;
  }

  /* ---------- 同一台設備兩個埠互接（自我迴圈） ---------- */
  Phys.selfState = (x) => {
    if (!Phys.exists(x.node, x.ap) || !Phys.exists(x.node, x.bp)) return res('noport', TXT.noport);
    if (!G.Net.nodeUp(x.node)) return res('down', `${Q.nodeName(x.node)} 沒有運作`);
    const A = endOf(x.node, x.ap, x.cord, x.ds), B = endOf(x.node, x.bp, x.cord, x.ds);
    const p = phyCheck(A, B, x, [x.node, x.ap], [x.node, x.bp]);
    if (p) return p;
    const R = G.R.l2;
    if (R && R.stormNodes.has(x.node)) return res('storm', '自我迴圈：STP 沒開，這台交換器把廣播封包無限循環（廣播風暴）', { up: true, speed: A.speed, led: ['storm', 'storm'] });
    if (R && R.selfBlk.has(x.id)) return res('blk', '自我迴圈：STP 發現自己送出的 BPDU 又收回來，把其中一個埠擋下（Blocking）', { up: true, speed: A.speed, led: ['on', 'blk'] });
    return res('up', '兩個埠互接（沒有接到其他設備）', { up: true, speed: A.speed, led: ['on', 'on'] });
  };

  /* ---------- 生成樹（STP）與迴圈 ----------
   * 橋接設備 = 交換器與樓層 IDF。L3 核心之間視為 MLAG / 路由互連：同一台設備分別接到不同核心不算迴圈。
   * 迴圈來源：同一對設備之間多條沒有 LACP 的跳線、跨設備的環狀連線、同一台交換器兩個埠互接。
   * 迴圈上只要有一台交換器開著 STP，它就會擋下多出來的路徑；全部都沒開 → 廣播風暴，整個 L2 網域癱瘓。 */
  Phys.stpOn = (id) => { if (id.startsWith('F:')) return true; const d = G.S.devices[id]; return !!d && d.stp !== false; };
  const isBridge = (id) => id.startsWith('F:') || Q.nodeKind(id) === 'switch';
  const isCore = (id) => { const d = G.S.devices[id]; return !!d && Q.isL3(d); };
  Phys.l2 = () => {
    const s = G.S;
    const out = { blocked: new Map(), standby: new Set(), stormNodes: new Set(), seeds: [], loops: [], selfBlk: new Set() };
    const groups = new Map();
    for (const l of Object.values(s.links)) {
      if (!l.members) continue;
      for (const m of l.members) {
        const st = phyState(l, m);
        if (!st.fwd) continue;
        const k = l.a < l.b ? l.a + '|' + l.b : l.b + '|' + l.a;
        if (!groups.has(k)) groups.set(k, { a: l.a, b: l.b, items: [] });
        groups.get(k).items.push({ l, m, sp: st.speed });
      }
    }
    const logical = [], extra = [];
    for (const g of groups.values()) {
      g.items.sort((x, y) => y.sp - x.sp || String(x.l.id).localeCompare(String(y.l.id)) || String(x.m.id).localeCompare(String(y.m.id)));
      const bA = isBridge(g.a), bB = isBridge(g.b);
      const lacp = g.items.every((x) => x.l.lacp);
      const main = lacp ? g.items : [g.items[0]];
      const rest = lacp ? [] : g.items.slice(1);
      if (!bA || !bB) { for (const x of rest) out.standby.add(x.m.id); continue; }
      logical.push({ a: g.a, b: g.b, items: main, sp: U.sum(main, (x) => x.sp), id: String(main[0].l.id) });
      for (const x of rest) extra.push({ a: g.a, b: g.b, item: x, nodes: [g.a, g.b] });
    }
    /* 合併 L3 核心（MLAG）後做 union-find：接上已連通的兩點 = 迴圈 */
    const cmap = (id) => (isCore(id) ? '#CORE' : id);
    const parent = new Map();
    const find = (x) => { while (parent.has(x) && parent.get(x) !== x) x = parent.get(x); return x; };
    const adj = new Map();
    const link = (u, v) => { if (!adj.has(u)) adj.set(u, []); if (!adj.has(v)) adj.set(v, []); adj.get(u).push(v); adj.get(v).push(u); };
    const seenMlag = new Set();
    logical.sort((x, y) => ((cmap(y.a) === '#CORE' || cmap(y.b) === '#CORE') - (cmap(x.a) === '#CORE' || cmap(x.b) === '#CORE')) || y.sp - x.sp || x.id.localeCompare(y.id));
    for (const e of logical) {
      const u = cmap(e.a), v = cmap(e.b);
      if (u === v) continue;
      /* 同一台設備接到不同核心：MLAG，算同一條邏輯連線 */
      const other = u === '#CORE' ? v : v === '#CORE' ? u : null;
      if (other) {
        const coreDev = u === '#CORE' ? e.a : e.b;
        const k = other + '>' + coreDev;
        if (seenMlag.has(other + '>*') && !seenMlag.has(k)) { seenMlag.add(k); continue; }
        seenMlag.add(k); seenMlag.add(other + '>*');
      }
      for (const x of [u, v]) if (!parent.has(x)) parent.set(x, x);
      const ru = find(u), rv = find(v);
      if (ru !== rv) { parent.set(ru, rv); link(u, v); continue; }
      /* 迴圈：找出環上的節點（樹上 u → v 的路徑） */
      const path = treePath(adj, u, v);
      for (const it of e.items) extra.push({ a: e.a, b: e.b, item: it, nodes: path.map((n) => (n === '#CORE' ? coreRep(path, e) : n)) });
    }
    const stp = (n) => (n === '#CORE' ? Q.devices('switch').some((d) => d.rack && Q.isL3(d) && d.stp !== false) : Phys.stpOn(n));
    for (const x of extra) {
      const anyOn = x.nodes.some(stp);
      if (anyOn) {
        /* 擋在「離核心遠、而且有開 STP」的那一端 */
        const cand = [x.a, x.b].filter((n) => Phys.stpOn(n));
        let at = cand.find((n) => !isCore(n)) || cand[0] || x.b;
        const end = at === x.item.l.a ? 'a' : 'b';
        out.blocked.set(x.item.m.id, end);
        out.loops.push({ kind: 'blk', a: x.a, b: x.b, l: x.item.l, m: x.item.m, nodes: x.nodes });
      } else {
        out.seeds.push(...x.nodes.filter((n) => n !== '#CORE'));
        out.loops.push({ kind: 'storm', a: x.a, b: x.b, l: x.item.l, m: x.item.m, nodes: x.nodes });
      }
    }
    for (const x of Phys.st().self) {
      if (!isBridge(x.node)) continue;
      const st = Phys.selfState(x);
      if (!st.up && st.code !== 'storm' && st.code !== 'blk') continue;
      if (Phys.stpOn(x.node)) { out.selfBlk.add(x.id); out.loops.push({ kind: 'blk', self: x, a: x.node, b: x.node, nodes: [x.node] }); }
      else { out.seeds.push(x.node); out.loops.push({ kind: 'storm', self: x, a: x.node, b: x.node, nodes: [x.node] }); }
    }
    /* 風暴擴散：沿著正常的跳線，經過所有橋接設備 */
    if (out.seeds.length) {
      const nb = new Map();
      for (const g of groups.values()) {
        if (!isBridge(g.a) || !isBridge(g.b)) continue;
        if (!nb.has(g.a)) nb.set(g.a, []); if (!nb.has(g.b)) nb.set(g.b, []);
        nb.get(g.a).push(g.b); nb.get(g.b).push(g.a);
      }
      const q = out.seeds.slice();
      for (const n of q) out.stormNodes.add(n);
      for (let i = 0; i < q.length; i++) for (const t of nb.get(q[i]) || []) if (!out.stormNodes.has(t)) { out.stormNodes.add(t); q.push(t); }
    }
    return out;
  };
  function treePath(adj, u, v) {
    const prev = new Map([[u, null]]);
    const q = [u];
    for (let i = 0; i < q.length; i++) {
      if (q[i] === v) break;
      for (const t of adj.get(q[i]) || []) if (!prev.has(t)) { prev.set(t, q[i]); q.push(t); }
    }
    if (!prev.has(v)) return [u, v];
    const out = [];
    for (let x = v; x !== null; x = prev.get(x)) out.push(x);
    return out;
  }
  const coreRep = (path, e) => (isCore(e.a) ? e.a : isCore(e.b) ? e.b : '#CORE');
  /** 重新計算 STP / 風暴（動作之後立刻反映在燈號上） */
  Phys.refresh = () => { if (G.S) G.R.l2 = Phys.l2(); return G.R.l2; };

  /* ---------- 快速連線：依線路規格自動配埠、插模組、接跳線 ---------- */
  function newMember(l, ap, bp) {
    const cab = CAT.cables[l.cable] || CAT.cables.om4;
    const ma = Phys.modFor(cab.medium, l.speed, CLS[ap[0]]);
    const mb = Phys.modFor(cab.medium, l.speed, CLS[bp[0]]);
    setMod(l.a, ap, ma); setMod(l.b, bp, mb);
    const m = { id: nid(), ap, bp, cord: Phys.cordFor(l.cable, ma || mb), pol: true, lab: true, len: l.len || Act().linkLength(l.a, l.b) };
    if (cab.medium === 'dac') m.ds = l.speed;
    return m;
  }
  const Act = () => G.Act;
  Phys.autoWire = (l) => {
    if (!l) return;
    l.members = l.members || [];
    const need = (l.count || 1) - l.members.length;
    const avoidA = new Set(), avoidB = new Set();
    for (let i = 0; i < need; i++) {
      touch();
      const ap = Phys.free(l.a, l.aPort, 1, l.b, avoidA)[0];
      const bp = Phys.free(l.b, l.bPort, 1, l.a, avoidB)[0];
      if (!ap || !bp) break;
      avoidA.add(ap); avoidB.add(bp);
      l.members.push(newMember(l, ap, bp));
    }
    if ((l.count || 1) > 1) l.lacp = true;
    touch();
  };
  /** 線路規格變更（拓撲的「升級線路」）：同種類的埠沿用，換上新規格的模組與跳線 */
  Phys.rewire = (l) => {
    if (!l) return;
    const old = l.members || [];
    const keep = [];
    for (const m of old) {
      if (keep.length < l.count && CLS[m.ap[0]] === l.aPort && CLS[m.bp[0]] === l.bPort && Phys.exists(l.a, m.ap) && Phys.exists(l.b, m.bp)) keep.push(m);
      else { setMod(l.a, m.ap, null); setMod(l.b, m.bp, null); }
    }
    l.members = keep.map((m) => { setMod(l.a, m.ap, null); setMod(l.b, m.bp, null); return Object.assign(newMember(l, m.ap, m.bp), { id: m.id, lab: m.lab }); });
    touch();
    Phys.autoWire(l);
    Phys.sync(l);
  };
  /** 拆除線路（快速模式）：跳線與模組一起移除 */
  Phys.release = (l) => {
    for (const m of l.members || []) { setMod(l.a, m.ap, null); setMod(l.b, m.bp, null); }
    l.members = [];
    touch();
  };
  /** 設備出售：模組、懸空的線、自我迴圈一起清掉 */
  Phys.dropNode = (id) => {
    const P = Phys.st();
    delete P.xcvr[id];
    P.loose = P.loose.filter((x) => x.node !== id);
    P.self = P.self.filter((x) => x.node !== id);
    touch();
  };
  /** 依跳線更新線路的規格欄位（舊介面與快速連線用） */
  Phys.sync = (l) => {
    if (!l.members) return;
    l.count = l.members.length;
    if (!l.members.length) return;
    const m0 = l.members[0];
    l.speed = Math.max(...l.members.map((m) => memberSpeed(l, m))) || l.speed;
    l.cable = (CAT.cords[m0.cord] || {}).cable || l.cable;
    l.aPort = CLS[m0.ap[0]]; l.bPort = CLS[m0.bp[0]];
  };
  /** 樓層接入交換器變少：上行跳線搬到還存在的埠（模組一起搬） */
  Phys.normalize = (nodeId) => {
    const moveTo = (pid) => {
      const np = Phys.free(nodeId, CLS[pid[0]], 1)[0];
      if (!np) return pid;
      setMod(nodeId, np, Phys.mod(nodeId, pid));
      setMod(nodeId, pid, null);
      touch();
      return np;
    };
    for (const l of Q.linksOf(nodeId)) for (const m of l.members || []) {
      if (l.a === nodeId && !Phys.exists(nodeId, m.ap)) m.ap = moveTo(m.ap);
      if (l.b === nodeId && !Phys.exists(nodeId, m.bp)) m.bp = moveTo(m.bp);
    }
    for (const x of Phys.st().loose) if (x.node === nodeId && !Phys.exists(nodeId, x.pid)) x.pid = moveTo(x.pid);
    touch();
  };
  /** ISP 線路接到路由器的哪個埠 */
  Phys.ispPort = (c) => {
    if (!c.router || !c.port) { c.pid = null; return; }
    if (c.pid && Phys.exists(c.router, c.pid)) return;
    touch();
    c.pid = Phys.free(c.router, c.port, 1)[0] || null;
    /* 電信業者的光纖交接：單模 LR 模組 */
    if (c.pid && CLS[c.pid[0]] !== 'rj45' && !Phys.mod(c.router, c.pid)) setMod(c.router, c.pid, c.bw > 1000 ? '10G-LR' : '1G-LX');
    touch();
  };

  /** 舊存檔 / 讀檔：每條線路都要有實體跳線 */
  Phys.ensure = () => {
    const s = G.S;
    if (!s) return;
    Phys.st();
    let n = 0;
    /* ISP 交接埠先配（路由器的 WAN 埠通常是前面幾個） */
    for (const c of s.isp) if (c.router && !c.pid) Phys.ispPort(c);
    const links = Object.values(s.links).sort((a, b) => (parseInt(String(a.id).slice(1), 10) || 0) - (parseInt(String(b.id).slice(1), 10) || 0));
    for (const l of links) {
      if (l.members) continue;
      if (l.count > 1 && l.lacp === undefined) l.lacp = true;
      Phys.autoWire(l);
      n++;
    }
    touch();
    Phys.refresh();
    return n;
  };

  /* ---------- 玩家動作（實體接線工作台） ---------- */
  const spend = (min) => { if (min > 0 && G.Cut && G.Cut.spend) G.Cut.spend(min); };
  const emit = (kind, data) => G.bus.emit('phys', Object.assign({ kind }, data || {}));
  function after(what, min, msg, data) {
    touch();
    Phys.refresh();
    G.bus.emit('change', { what: 'links' });
    emit(what, data);
    spend(min);
    return ok(msg, data);
  }
  const inRack = (id) => { if (id.startsWith('F:')) return true; const d = G.S.devices[id]; return !!d && !!d.rack; };
  /** 兩個節點能不能直接接（和拓撲連線相同的規則） */
  Phys.kindErr = (a, b) => {
    const s = G.S;
    const ka = Q.nodeKind(a), kb = Q.nodeKind(b);
    const infra = (id) => { const d = s.devices[id]; return !!d && CAT.infra(CAT.devices[d.model]); };
    if (infra(a) || infra(b)) return 'UPS、電源櫃、BBU 與儲存擴充櫃不是網路設備';
    if (ka === 'floor' && kb === 'floor') return '樓層之間不直接互連，請各自上連到 B1 核心';
    const endpoint = (k) => k === 'server' || k === 'wlc' || k === 'storage';
    if ((ka === 'floor' && endpoint(kb)) || (kb === 'floor' && endpoint(ka))) return '樓層 IDF 應上連到交換器（核心），不是伺服器';
    if (a !== b && endpoint(ka) && endpoint(kb)) return '伺服器之間請透過交換器互連';
    for (const id of [a, b]) if (!inRack(id)) return `${Q.nodeName(id)} 尚未安裝到機櫃`;
    return null;
  };
  /** 這條跳線插得進這個埠嗎（接頭、模組） */
  function plugErr(nodeId, pid, cordKey, modKey) {
    if (!Phys.exists(nodeId, pid)) return '這個埠不存在';
    if (Phys.at(nodeId, pid)) return `${Phys.label(nodeId, pid)} 已經插著線了`;
    const cls = CLS[pid[0]], cord = CAT.cords[cordKey];
    if (!cord) return '請選擇跳線';
    if (cls === 'rj45') return cord.conn === 'rj45' ? null : `${Phys.name(nodeId, pid)} 是 RJ45 網路孔，只能插網路線`;
    if (cord.conn === 'dac') return Phys.mod(nodeId, pid) ? `${Phys.name(nodeId, pid)} 插著 ${CAT.xcvr[Phys.mod(nodeId, pid)].name}：DAC 兩端自己就是模組，要先把光模組拔掉` : null;
    const mk = Phys.mod(nodeId, pid) || modKey;
    if (!mk) return `${Phys.name(nodeId, pid)} 是空的 ${cls === 'qsfp' ? 'QSFP' : 'SFP'} 槽：要先插光模組`;
    const x = CAT.xcvr[mk];
    if (x.form !== cls) return `${x.name} 是 ${x.form === 'qsfp' ? 'QSFP' : 'SFP'} 模組，插不進 ${cls === 'qsfp' ? 'QSFP' : 'SFP'} 槽`;
    if (x.conn !== cord.conn) return `${x.name} 是 ${x.conn === 'mpo' ? 'MPO 多芯' : x.conn === 'rj45' ? 'RJ45' : 'LC 雙芯'}接頭，${cord.name}插不進去`;
    return null;
  }
  Phys.plugErr = plugErr;
  const needLen = (a, b) => (a === b ? 3 : Act().linkLength(a, b));

  /**
   * 預覽一條新跳線：{ ok, errs, warns, cost, min, state }
   * opt = { cord, ds, modA, modB, lacp, zone }
   */
  Phys.preview = (a, ap, b, bp, opt) => {
    opt = opt || {};
    const errs = [], warns = [];
    const cord = CAT.cords[opt.cord];
    if (a === b && ap === bp) errs.push('同一個埠');
    const ke = Phys.kindErr(a, b);
    if (ke) errs.push(ke);
    if (a.startsWith('F:') || b.startsWith('F:')) errs.push('樓層的上行要經過弱電豎井的主幹光纖：請在「樓層」或「拓撲」新增上行');
    for (const [n, p, mk] of [[a, ap, opt.modA], [b, bp, opt.modB]]) { const e = plugErr(n, p, opt.cord, mk); if (e) errs.push(e); }
    const len = needLen(a, b);
    if (cord && cord.media === 'dac') {
      if (CLS[ap[0]] !== CLS[bp[0]]) errs.push('DAC 兩端的模組一樣：SFP 對 SFP、QSFP 對 QSFP');
      const max = CAT.cables.dac.max[opt.ds];
      if (!max) errs.push('請選 DAC 的速率');
      else if (len > max) errs.push(`DAC 最長 ${max} m，這段要 ${len} m：只能接同一座機櫃裡的設備，改用光纖`);
    }
    let cost = 0, min = CAT.physMin.plug;
    if (cord) cost += Phys.cordPrice(opt.cord, opt.ds);
    for (const [n, p, mk] of [[a, ap, opt.modA], [b, bp, opt.modB]]) {
      if (mk && !Phys.mod(n, p) && CLS[p[0]] !== 'rj45' && !(cord && cord.media === 'dac')) { cost += CAT.xcvr[mk].price; min += CAT.physMin.module; }
    }
    const ex = a !== b ? Q.linkBetween(a, b)[0] : null;
    if (ex && opt.lacp && !ex.lacp) min += CAT.physMin.config;
    let state = null;
    if (!errs.length) {
      /* 模擬插上去之後的樣子 */
      const fake = { id: '#pv', a, b, status: 'up', readyAt: 0, members: [] };
      const m = { id: '#pv', ap, bp, cord: opt.cord, pol: true, lab: true, len, ds: opt.ds };
      const P = Phys.st();
      const tmp = [];
      for (const [n, p, mk] of [[a, ap, opt.modA], [b, bp, opt.modB]]) if (mk && !Phys.mod(n, p)) { setMod(n, p, mk); tmp.push([n, p]); }
      try { state = a === b ? Phys.selfState(Object.assign({ node: a, id: '#pv' }, m)) : phyState(fake, m); } finally { for (const [n, p] of tmp) setMod(n, p, null); }
      void P;
      if (state && !state.up) warns.push('插上去之後不會通：' + state.text);
      if (state && state.code === 'vlan') warns.push(state.text);
      if (a === b) warns.push(Phys.stpOn(a) ? '同一台交換器的兩個埠互接：STP 會把其中一個埠擋下' : '同一台交換器的兩個埠互接、又沒有開 STP：會造成廣播風暴！');
      if (ex && !opt.lacp && !ex.lacp && isBridge(a) && isBridge(b)) warns.push(`${Q.nodeName(a)} ⇄ ${Q.nodeName(b)} 已經有 ${ex.members.length} 條線：沒有設定 LACP，多出來的線會形成迴圈${Phys.stpOn(a) || Phys.stpOn(b) ? '（STP 會擋下它）' : '，兩台都沒開 STP → 廣播風暴！'}`);
    }
    return { ok: !errs.length, errs, warns, cost: Math.round(cost), min, state, len, existing: ex };
  };

  /** 接一條新跳線 */
  Phys.patch = (a, ap, b, bp, opt) => {
    const s = G.S;
    opt = opt || {};
    const pv = Phys.preview(a, ap, b, bp, opt);
    if (!pv.ok) return err(pv.errs[0]);
    if (!Act().spend(pv.cost, `實體接線：${Phys.label(a, ap)} ⇄ ${Phys.label(b, bp)}`)) return err(`預算不足：需要 ${U.money(pv.cost)}`);
    const cord = CAT.cords[opt.cord];
    for (const [n, p, mk] of [[a, ap, opt.modA], [b, bp, opt.modB]]) if (mk && !Phys.mod(n, p) && CLS[p[0]] !== 'rj45' && cord.media !== 'dac') setMod(n, p, mk);
    const m = { id: nid(), ap, bp, cord: opt.cord, pol: true, lab: true, len: pv.len };
    if (cord.media === 'dac') m.ds = opt.ds;
    /* 割接：廠商附的新跳線裡，有一條是極性接反的（A-A）——插上去不通，要自己翻 */
    if (s.cut && !s.cut.done && s.cut.badCord > 0 && (cord.conn === 'lc' || cord.conn === 'mpo')) { s.cut.badCord--; m.pol = false; m.badCord = true; }
    if (a === b) {
      Phys.st().self.push(Object.assign({ node: a }, m));
      return after('patch', pv.min, `${Q.nodeName(a)} 的 ${Phys.name(a, ap)} ⇄ ${Phys.name(a, bp)} 互接了`, { a, ap, b, bp });
    }
    let l = pv.existing;
    if (l) {
      if (l.a !== a) { const t = m.ap; m.ap = m.bp; m.bp = t; }
      l.members = l.members || [];
      l.members.push(m);
      if (opt.lacp) l.lacp = true;
    } else {
      const id = Q.nextId('L');
      const zone = zoneFor(a, b, opt.zone);
      l = { id, a, b, cable: cord.cable, speed: 0, count: 1, len: pv.len, aPort: CLS[ap[0]], bPort: CLS[bp[0]], zone, status: 'up', readyAt: 0, cost: pv.cost, lacp: !!opt.lacp, members: [m] };
      s.links[id] = l;
    }
    Phys.sync(l);
    return after('patch', pv.min, `${Phys.label(a, ap)} ⇄ ${Phys.label(b, bp)} 接好了`, { a, ap, b, bp, l: l.id });
  };
  function zoneFor(a, b, want) {
    const fa = Q.nodeKind(a) === 'firewall', fb = Q.nodeKind(b) === 'firewall';
    if (fa && fb) return 'ha';
    if (!fa && !fb) return null;
    return want && want !== 'ha' ? want : Act().defaultZone(a, b);
  }

  /** 拔掉這個埠上的跳線：另一端還插著（懸空）；自己也懸空的線就整條收走 */
  Phys.unplug = (nodeId, pid) => {
    const o = Phys.at(nodeId, pid);
    if (!o) return err('這個埠沒有插線');
    const P = Phys.st();
    if (o.t === 'isp') return err('這是 ISP 專線的交接埠：請到 ISP 線路卡片變更');
    if (nodeId.startsWith('F:')) return err('樓層那一端在 IDF 機櫃裡，不在 B1 機房');
    if (o.t === 'loose') {
      P.loose = P.loose.filter((x) => x !== o.x);
      return after('remove', CAT.physMin.unplug, '整條跳線收掉了', { node: nodeId, pid });
    }
    if (o.t === 'self') {
      const x = o.x;
      P.self = P.self.filter((y) => y !== x);
      const keep = o.end === 'a' ? x.bp : x.ap;
      P.loose.push({ id: x.id, node: x.node, pid: keep, cord: x.cord, pol: x.pol, lab: x.lab, len: x.len, ds: x.ds, fromNode: nodeId, fromPid: pid, tag: x.tag });
      return after('unplug', CAT.physMin.unplug, `拔掉了 ${Phys.label(nodeId, pid)}`, { node: nodeId, pid });
    }
    const l = o.l, m = o.m;
    const farNode = o.end === 'a' ? l.b : l.a, farPid = o.end === 'a' ? m.bp : m.ap;
    l.members = l.members.filter((x) => x !== m);
    P.loose.push({ id: m.id, node: farNode, pid: farPid, cord: m.cord, pol: m.pol, lab: m.lab, len: m.len, ds: m.ds, fromNode: nodeId, fromPid: pid, zone: l.zone, lacp: l.lacp, fromLink: l.id });
    if (!l.members.length) delete G.S.links[l.id];
    else Phys.sync(l);
    return after('unplug', CAT.physMin.unplug, `拔掉了 ${Phys.label(nodeId, pid)}（另一端還接在 ${Phys.label(farNode, farPid)}）`, { node: nodeId, pid, farNode, farPid, lab: m.lab });
  };

  /** 把懸空的那一端插進某個埠 */
  Phys.plugPreview = (looseId, nodeId, pid, modKey) => {
    const P = Phys.st();
    const x = P.loose.find((y) => y.id === looseId);
    const errs = [], warns = [];
    if (!x) return { ok: false, errs: ['找不到這條線'], warns };
    if (x.node.startsWith('F:') && nodeId.startsWith('F:')) errs.push('樓層之間不直接互連');
    const ke = Phys.kindErr(x.node, nodeId);
    if (ke) errs.push(ke);
    const e = plugErr(nodeId, pid, x.cord, modKey);
    if (e) errs.push(e);
    const cord = CAT.cords[x.cord];
    const floor = x.node.startsWith('F:');
    const need = floor ? x.len : needLen(x.node, nodeId);
    if (!floor && need > x.len) errs.push(`這條跳線只有 ${x.len} m，拉不到那裡（要 ${need} m）${cord && cord.media === 'dac' ? '：DAC 只能接同一座機櫃' : ''}`);
    if (cord && cord.media === 'dac' && CLS[pid[0]] !== CLS[x.pid[0]]) errs.push('DAC 兩端的模組一樣：SFP 對 SFP、QSFP 對 QSFP');
    let min = CAT.physMin.plug, cost = 0;
    if (modKey && !Phys.mod(nodeId, pid) && CLS[pid[0]] !== 'rj45' && !(cord && cord.media === 'dac')) { min += CAT.physMin.module; cost += CAT.xcvr[modKey].price; }
    let state = null;
    if (!errs.length) {
      const tmp = modKey && !Phys.mod(nodeId, pid) && CLS[pid[0]] !== 'rj45' && !(cord && cord.media === 'dac');
      if (tmp) setMod(nodeId, pid, modKey);
      try {
        const m = { id: '#pv', ap: x.pid, bp: pid, cord: x.cord, pol: x.pol, lab: x.lab, len: x.len, ds: x.ds };
        state = nodeId === x.node ? Phys.selfState(Object.assign({ node: nodeId }, m)) : phyState({ id: '#pv', a: x.node, b: nodeId, status: 'up', readyAt: 0 }, m);
      } finally { if (tmp) setMod(nodeId, pid, null); }
      if (state && !state.up) warns.push('插上去之後不會通：' + state.text);
      if (state && state.code === 'vlan') warns.push(state.text);
      if (nodeId === x.node) warns.push(Phys.stpOn(nodeId) ? '兩端插在同一台交換器：STP 會擋下其中一個埠' : '兩端插在同一台交換器、又沒開 STP：會造成廣播風暴！');
      const ex = nodeId !== x.node ? Q.linkBetween(x.node, nodeId)[0] : null;
      if (ex && !ex.lacp && isBridge(x.node) && isBridge(nodeId)) warns.push(`${Q.nodeName(x.node)} ⇄ ${Q.nodeName(nodeId)} 已經有線了、而且沒有設定 LACP：這條會形成迴圈`);
    }
    return { ok: !errs.length, errs, warns, min, cost, state, x };
  };
  Phys.plug = (looseId, nodeId, pid, modKey) => {
    const s = G.S, P = Phys.st();
    const pv = Phys.plugPreview(looseId, nodeId, pid, modKey);
    if (!pv.ok) return err(pv.errs[0]);
    const x = pv.x;
    if (pv.cost && !Act().spend(pv.cost, `光模組 ${CAT.xcvr[modKey].name}`)) return err(`預算不足：需要 ${U.money(pv.cost)}`);
    const cord = CAT.cords[x.cord];
    if (modKey && !Phys.mod(nodeId, pid) && CLS[pid[0]] !== 'rj45' && cord.media !== 'dac') setMod(nodeId, pid, modKey);
    P.loose = P.loose.filter((y) => y !== x);
    const m = { id: x.id, ap: x.pid, bp: pid, cord: x.cord, pol: x.pol, lab: x.lab, len: x.len, ds: x.ds };
    if (x.tag) m.tag = x.tag;
    if (nodeId === x.node) {
      P.self.push(Object.assign({ node: nodeId }, m));
      return after('plug', pv.min, `插進 ${Phys.label(nodeId, pid)}：兩端都在同一台設備上`, { node: nodeId, pid, farNode: x.node, farPid: x.pid });
    }
    let l = Q.linkBetween(x.node, nodeId)[0];
    if (l) {
      if (l.a !== x.node) { m.ap = pid; m.bp = x.pid; }
      l.members = l.members || [];
      l.members.push(m);
    } else {
      const id = Q.nextId('L');
      const floor = x.node.startsWith('F:');
      /* 原本是 LACP 的線：新的那一端也照原本的設定（MOP 上的 port-channel） */
      l = { id, a: x.node, b: nodeId, cable: cord.cable, speed: 0, count: 1, len: floor ? x.len : needLen(x.node, nodeId), aPort: CLS[x.pid[0]], bPort: CLS[pid[0]], zone: zoneFor(x.node, nodeId, x.zone), status: 'up', readyAt: 0, cost: 0, lacp: !!x.lacp, members: [m] };
      s.links[id] = l;
    }
    Phys.sync(l);
    return after('plug', pv.min, `插進 ${Phys.label(nodeId, pid)}（另一端是 ${Phys.label(x.node, x.pid)}）`, { node: nodeId, pid, farNode: x.node, farPid: x.pid, l: l.id });
  };

  /** 插 / 換光模組（埠上不能有線） */
  Phys.insertModule = (nodeId, pid, key) => {
    const x = CAT.xcvr[key];
    if (!x) return err('未知的模組');
    if (!Phys.exists(nodeId, pid)) return err('這個埠不存在');
    if (!inRack(nodeId)) return err(`${Q.nodeName(nodeId)} 尚未安裝到機櫃`);
    const cls = CLS[pid[0]];
    if (cls === 'rj45') return err('RJ45 網路孔不用插模組');
    if (x.form !== cls) return err(`${x.name} 是 ${x.form === 'qsfp' ? 'QSFP' : 'SFP'} 模組，插不進 ${cls === 'qsfp' ? 'QSFP' : 'SFP'} 槽`);
    if (Phys.at(nodeId, pid)) return err('埠上還插著跳線：先拔線才能換模組');
    if (Phys.mod(nodeId, pid) === key) return ok('已經是這個模組');
    if (!Act().spend(x.price, `光模組 ${x.name}`)) return err(`預算不足：需要 ${U.money(x.price)}`);
    setMod(nodeId, pid, key);
    const warn = !Phys.speeds(nodeId, pid).includes(x.speed) ? `（注意：${Phys.name(nodeId, pid)} 不支援 ${U.speed(x.speed)}）` : '';
    return after('module', CAT.physMin.module, `${Phys.label(nodeId, pid)} 插上 ${x.name}${warn}`, { node: nodeId, pid, mod: key });
  };
  Phys.removeModule = (nodeId, pid) => {
    if (!Phys.mod(nodeId, pid)) return err('這個埠沒有模組');
    if (Phys.at(nodeId, pid)) return err('埠上還插著跳線：先拔線才能拔模組');
    setMod(nodeId, pid, null);
    return after('module', CAT.physMin.module, `拔掉了 ${Phys.label(nodeId, pid)} 的光模組`, { node: nodeId, pid, mod: null });
  };
  /** 光纖極性：把 LC 接頭 A/B 對調 */
  Phys.flip = (nodeId, pid) => {
    const o = Phys.at(nodeId, pid);
    if (!o || o.t === 'isp') return err('這個埠沒有插跳線');
    const x = o.t === 'm' ? o.m : o.x;
    const cord = CAT.cords[x.cord];
    if (!cord || (cord.conn !== 'lc' && cord.conn !== 'mpo')) return err('銅纜與 DAC 沒有極性問題（網路線會自動交換收發：Auto-MDIX）');
    x.pol = x.pol === false;
    return after('flip', CAT.physMin.flip, x.pol ? '極性翻正了（Tx → Rx）' : '極性對調了', { node: nodeId, pid });
  };
  /** 循線追蹤並貼標籤 */
  Phys.tag = (nodeId, pid) => {
    const o = Phys.at(nodeId, pid);
    if (!o || o.t === 'isp') return err('這個埠沒有插跳線');
    const x = o.t === 'm' ? o.m : o.x;
    if (x.lab) return ok('已經有標籤了');
    x.lab = true;
    return after('label', CAT.physMin.trace + CAT.physMin.label, `循線追蹤完成，貼上標籤：${Phys.farText(nodeId, pid)}`, { node: nodeId, pid });
  };
  /** 一台設備上所有沒標籤的線：逐條循線、貼標籤 */
  Phys.tagAll = (nodeId) => {
    let n = 0;
    for (const pid of Phys.ports(nodeId)) {
      const o = Phys.at(nodeId, pid);
      if (!o || o.t === 'isp') continue;
      const x = o.t === 'm' ? o.m : o.x;
      if (x.lab) continue;
      x.lab = true; n++;
    }
    if (!n) return ok('這台設備的線都有標籤了');
    return after('label', n * (CAT.physMin.trace + CAT.physMin.label), `循線追蹤 ${n} 條線、全部貼好標籤`, { node: nodeId, n });
  };
  /** 這條線的另一端（沒有標籤就不知道） */
  Phys.farText = (nodeId, pid) => {
    const o = Phys.at(nodeId, pid);
    if (!o) return '';
    if (o.t === 'isp') return `ISP 專線（${CAT.isp.providers[o.c.provider].name} ${o.c.plan}）`;
    if (o.t === 'loose') return '另一端懸空（還沒插）';
    if (o.t === 'self') return `同一台設備的 ${Phys.name(nodeId, o.end === 'a' ? o.x.bp : o.x.ap)}`;
    const far = o.end === 'a' ? [o.l.b, o.m.bp] : [o.l.a, o.m.ap];
    return Phys.label(far[0], far[1]);
  };

  /** 交換器的生成樹（STP） */
  Phys.setStp = (devId, on) => {
    const d = G.S.devices[devId];
    if (!d || Q.nodeKind(devId) !== 'switch') return err('只有交換器有 STP');
    if ((d.stp !== false) === !!on) return ok(on ? 'STP 已經是開啟的' : 'STP 已經是關閉的');
    d.stp = !!on;
    return after('stp', CAT.physMin.config, on ? `${d.name} 啟用 STP（spanning-tree mode rapid-pvst）` : `${d.name} 關閉 STP`, { node: devId, on: !!on });
  };
  /** 線路的 LACP（兩端都要設 port-channel） */
  Phys.setLacp = (linkId, on) => {
    const l = G.S.links[linkId];
    if (!l) return err('找不到線路');
    if (!!l.lacp === !!on) return ok('');
    l.lacp = !!on;
    return after('lacp', CAT.physMin.config, on ? `${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)} 設定 LACP：${l.members.length} 條線合成一條 port-channel` : '已取消 LACP', { l: linkId, on: !!on });
  };
  /** 設定埠的用途（割接的新核心） */
  Phys.setRole = (devId, pid, role) => {
    const d = G.S.devices[devId];
    if (!d || !d.plan) return err('這台設備的埠不用另外設定');
    if (role && !Phys.ROLES[role]) return err('未知的設定');
    if ((d.plan[pid] || null) === (role || null)) return ok('');
    if (role) d.plan[pid] = role; else delete d.plan[pid];
    return after('config', CAT.physMin.config, `${Phys.label(devId, pid)} 設定為「${role ? Phys.ROLES[role].name : 'shutdown'}」`, { node: devId, pid, role });
  };

  /** 每分鐘：廣播風暴擴散到其他設備 → 事件 */
  Phys.watch = () => {
    const R = G.R.l2;
    if (R && R.stormNodes.size > 1 && !G.Ev.active().some((i) => i.type === 'storm')) G.Ev.start('storm');
  };

  /** 所有懸空的線（依插著的那一端） */
  Phys.loose = () => Phys.st().loose;
  Phys.selfLoops = () => Phys.st().self;
})(window.G = window.G || {});
