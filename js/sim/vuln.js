/* 弱點管理：伺服器、虛擬化主機、網路設備、官網都會陸續出現已知漏洞（CVE）；
 * 有弱點掃描（VS 角色）才看得見、才知道先修哪個（CVSS、是否已遭利用 KEV）。
 * 修補要重開機：沒有備援的設備會中斷，所以通常排在晚上的維護窗口；VM 可以先線上遷移、HA 的設備輪流修。
 * 對外的設備（防火牆、路由器、SBC、SD-WAN 集中器、DMZ 的官網）有沒修補的嚴重漏洞 → 會被入侵（exploit 事件）。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Vuln = {};
  G.Vuln = Vuln;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = () => G.bus.emit('change', { what: 'vuln' });

  Vuln.newState = () => ({ list: [], lastScan: null, scanUntil: 0, seq: 1 });
  Vuln.active = () => { const s = G.S; return s.mode === 'sandbox' || Q.chapterNum() >= 8; };
  Vuln.scannerUp = () => Q.roleServers('vscan').some((d) => G.Net.devUp(d));
  Vuln.sevOf = (cvss) => (cvss >= 9 ? 'crit' : cvss >= 7 ? 'high' : cvss >= 4 ? 'med' : 'low');
  Vuln.SLA = { crit: 7, high: 30, med: 90, low: 180 };
  Vuln.SEV = { crit: '嚴重', high: '高', med: '中', low: '低' };

  /* 漏洞樣本（名稱是虛構的，但類型都是真實常見的） */
  const POOL = {
    server: [['作業系統核心權限提升', 7.8], ['遠端桌面服務遠端執行程式碼', 9.8], ['SMB 協定遠端執行程式碼', 8.8], ['OpenSSL 記憶體讀取越界', 7.5], ['Web 伺服器路徑穿越', 7.5], ['.NET 遠端執行程式碼', 8.1]],
    hv: [['Hypervisor 虛擬機逃逸', 9.3], ['管理介面驗證繞過', 9.8]],
    firewall: [['SSL VPN 遠端執行程式碼', 9.8], ['管理介面驗證繞過', 9.6], ['IPsec 服務阻斷', 7.5]],
    router: [['BGP 處理阻斷', 7.5], ['Web 管理介面命令注入', 8.8]],
    switch: [['SNMP 資訊洩漏', 6.5], ['管理介面跨站請求偽造', 6.8]],
    other: [['韌體預設帳號', 9.1], ['SIP 協定處理記憶體損毀', 8.6], ['管理介面命令注入', 8.8]],
  };
  const EXPOSED = (d) => {
    const m = CAT.devices[d.model];
    if (m.cat === 'firewall' || m.cat === 'router') return true;
    if (d.role === 'sbc' || d.role === 'sdwan') return true;
    if (d.role === 'web') { const z = G.Net.zones().get(d.id); return !!z && (z.zone === 'DMZ' || z.zone === 'EXPOSED'); }
    return false;
  };
  Vuln.exposed = EXPOSED;
  const assets = () => Object.values(G.S.devices).filter((d) => {
    if (!d.rack) return false;
    const m = CAT.devices[d.model];
    return !CAT.infra(m) && m.cat !== 'storage';
  });
  function add(d, name, cvss, kev) {
    const s = G.S, v = s.vuln;
    if (v.list.some((x) => x.dev === d.id && x.name === name && !x.fixed)) return null;
    const year = 2026;
    const x = { id: 'v' + (v.seq++), dev: d.id, cve: `CVE-${year}-${U.randInt(1000, 49999)}`, name, cvss, sev: Vuln.sevOf(cvss), kev: !!kev, since: s.time, known: false, fixed: false, patchAt: 0 };
    v.list.push(x);
    return x;
  }
  Vuln.add = add;
  /** 每週的更新發布：新的漏洞 */
  function release() {
    for (const d of assets()) {
      const m = CAT.devices[d.model];
      const kind = m.hv ? 'hv' : m.cat === 'server' ? (d.role === 'sbc' || d.role === 'sdwan' || d.role === 'pbx' ? 'other' : 'server') : m.cat === 'firewall' ? 'firewall' : m.cat === 'router' ? 'router' : m.cat === 'switch' || m.cat === 'wlc' ? 'switch' : 'other';
      const p = kind === 'server' || kind === 'hv' ? 0.6 : 0.12;
      if (Math.random() < p) { const [nm, c] = U.pick(POOL[kind]); add(d, nm, c, false); }
    }
  }
  /** 重大漏洞公告（KEV：已遭大規模利用）：打在所有同類型的對外設備上 */
  Vuln.kev = (cat) => {
    const out = [];
    for (const d of assets()) {
      const m = CAT.devices[d.model];
      if (cat === 'firewall' ? m.cat === 'firewall' : cat === 'router' ? m.cat === 'router' : d.role === cat) {
        const x = add(d, cat === 'firewall' ? 'SSL VPN 遠端執行程式碼（已遭大規模利用）' : cat === 'router' ? 'Web 管理介面命令注入（已遭利用）' : '遠端執行程式碼（已遭利用）', 9.8, true);
        if (x) { x.known = true; out.push(x); }
      }
    }
    changed();
    return out;
  };

  Vuln.open = () => G.S.vuln.list.filter((x) => !x.fixed && G.S.devices[x.dev]);
  Vuln.known = () => Vuln.open().filter((x) => x.known);
  Vuln.overdue = (x) => (G.S.time - x.since) / 1440 > Vuln.SLA[x.sev];
  /** 對外設備上沒修補的嚴重 / 已遭利用漏洞（不管有沒有掃到） */
  Vuln.exposedCrit = () => Vuln.open().filter((x) => !x.mitig && (x.sev === 'crit' || x.kev) && EXPOSED(G.S.devices[x.dev]));

  Vuln.scan = () => {
    const s = G.S;
    if (!Vuln.scannerUp()) return err('沒有運作中的弱點掃描伺服器（VS 角色）');
    if (s.vuln.scanUntil > s.time) return err('掃描進行中');
    s.vuln.scanUntil = s.time + 60;
    changed();
    return ok('開始掃描所有設備（約 1 小時）');
  };

  /** 修補一台設備：重開機會中斷，除非有備援（HA、雙核心）或是 VM（先線上遷移） */
  Vuln.downtime = (d) => {
    const m = CAT.devices[d.model];
    if (d.host) return 5;
    if (m.hv) return 0;
    if (m.cat === 'firewall' && G.R.graph && Q.devices('firewall').filter((x) => x.rack).length >= 2) return 0;
    if (m.cat === 'switch' && Q.isL3(d) && Q.devices('switch').filter((x) => x.rack && Q.isL3(x)).length >= 2) return 0;
    if (m.cat === 'server' && d.role && Q.roleServers(d.role).filter((x) => x.rack && x.id !== d.id).length) return 0;
    return m.cat === 'server' ? 15 : 8;
  };
  function applyPatch(d) {
    const s = G.S, m = CAT.devices[d.model];
    if (m.hv) G.VM.evacuate(d.id);
    const dt = Vuln.downtime(d);
    d.bootUntil = Math.max(d.bootUntil || 0, s.time + (dt || 6));
    let n = 0;
    for (const x of Vuln.open()) if (x.dev === d.id) { x.fixed = true; x.fixedAt = s.time; n++; }
    return n;
  }
  /** now = 立即；否則排到今晚 02:00 的維護窗口 */
  Vuln.patch = (devId, now) => {
    const s = G.S, d = s.devices[devId];
    if (!d) return err('找不到設備');
    const list = Vuln.open().filter((x) => x.dev === devId);
    if (!list.length) return ok('這台設備沒有已知的弱點');
    const cost = 8000 * list.length;
    if (!G.Act.spend(cost, `修補 ${d.name}（${list.length} 個弱點）`)) return err(`預算不足：需要 ${U.money(cost)}`);
    if (now) {
      const dt = Vuln.downtime(d);
      const n = applyPatch(d);
      G.R.topoVer++;
      changed();
      return ok(`${d.name} 修補完成（${n} 個弱點）${dt ? `，重開機中斷約 ${dt} 分鐘` : '，有備援所以沒有中斷'}`);
    }
    const day = U.dayOf(s.time);
    let at = U.at(day, 2);
    if (at <= s.time) at = U.at(day + 1, 2);
    for (const x of list) x.patchAt = at;
    changed();
    return ok(`${d.name} 排入 ${U.stamp(at)} 的維護窗口`);
  };
  Vuln.patchAllTonight = () => {
    const devs = new Set(Vuln.known().filter((x) => (x.sev === 'crit' || x.sev === 'high') && !x.patchAt).map((x) => x.dev));
    let n = 0;
    for (const id of devs) if (Vuln.patch(id, false).ok) n++;
    return n ? ok(`${n} 台設備排入今晚 02:00 的維護窗口`) : ok('沒有需要排程的嚴重 / 高風險弱點');
  };

  /** 每分鐘：每週新漏洞、每天凌晨掃描、維護窗口修補、對外漏洞被利用 */
  Vuln.tick = () => {
    const s = G.S, v = s.vuln, t = s.time;
    if (!Vuln.active()) return;
    if (G.Ep && G.Ep.isRelease(t)) release();
    /* 掃描：每天 03:00 自動掃描，或手動掃描 1 小時後完成 */
    const auto = t % 1440 === 180 && Vuln.scannerUp();
    if (auto || (v.scanUntil && t === v.scanUntil)) {
      let n = 0;
      for (const x of Vuln.open()) if (!x.known) { x.known = true; n++; }
      v.lastScan = t;
      if (n) G.Act.log(`弱點掃描完成：新發現 ${n} 個弱點`, 'info');
      const crit = Vuln.known().filter((x) => x.sev === 'crit').length;
      if (crit) G.Ops && G.Ops.alert('warn', `弱點掃描：${crit} 個嚴重弱點尚未修補`, 'vuln');
      changed();
    }
    /* 維護窗口 */
    const due = new Set(Vuln.open().filter((x) => x.patchAt && t >= x.patchAt).map((x) => x.dev));
    for (const id of due) { const d = s.devices[id]; if (d) applyPatch(d); }
    if (due.size) { G.Act.log(`維護窗口：修補了 ${due.size} 台設備`, 'good'); G.R.topoVer++; changed(); }
    /* 對外設備的嚴重漏洞會被利用（已遭利用的 KEV 更快）；IPS 的虛擬修補能擋掉大部分 */
    if (t % 60 === 0) {
      const ex = Vuln.exposedCrit();
      if (ex.length && !G.Ev.active().some((i) => i.type === 'exploit')) {
        const ips = Q.hasService('ips');
        const p = U.sum(ex, (x) => (x.kev ? 0.08 : 0.012) * (s.time - x.since > 1440 ? 1 : 0.3)) * (ips ? 0.25 : 1);
        if (Math.random() < p) G.Ev.start('exploit', { vuln: U.pick(ex).id });
      }
    }
  };
})(window.G = window.G || {});
