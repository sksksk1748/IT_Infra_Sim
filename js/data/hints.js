/* 提示的步驟資料：每個任務拆成一步一步（提示機制見 js/ui/hint.js）
 * 每一步 { text, short?, go, path, done() }：
 *   text  = 任務面板上的說明；short = 提示泡泡上的短句
 *   go    = 「帶我去」跳到哪一頁（字串，或會先幫你選好設備的函式）
 *   path  = 要標示的元素（data-hint），由粗到細；也可以是依畫面狀態回傳陣列的函式
 *   done  = 這一步做完了沒（做完就換下一步）
 */
(function (G) {
  'use strict';
  const CAT = G.CAT, Q = G.Q;
  const S = () => G.S;
  const devs = () => Object.values(G.S.devices);
  const mOf = (d) => CAT.devices[d.model];
  const catIs = (cat) => (d) => mOf(d).cat === cat;
  const isCore = (d) => catIs('switch')(d) && Q.isL3(d);
  const own = (pred) => devs().some(pred);
  const inRack = (pred) => devs().some((d) => d.rack && pred(d));
  const first = (pred) => devs().find((d) => d.rack && pred(d)) || null;
  const canRole = (d, r) => (mOf(d).roles || []).includes(r);
  const linkedTo = (d, pred) => !!d && Q.linksOf(d.id).some((l) => { const o = G.S.devices[Q.other(l, d.id)]; return !!o && pred(o); });
  const serverLinked = (d) => (d.host ? !!G.S.devices[d.host] && serverLinked(G.S.devices[d.host]) : Q.linksOf(d.id).some((l) => ['switch', 'firewall'].includes(Q.nodeKind(Q.other(l, d.id)))));
  const roleUp = (r, n) => Q.roleServers(r).filter((d) => (d.rack || d.host) && serverLinked(d)).length >= (n || 1);
  const fwLink = (pred, zone) => Object.values(G.S.links).some((l) => {
    const a = G.S.devices[l.a], b = G.S.devices[l.b];
    const fa = a && catIs('firewall')(a), fb = b && catIs('firewall')(b);
    if (fa === fb) return false;
    const other = fa ? b : a;
    return !!other && pred(other) && (!zone || l.zone === zone);
  });
  const coverage = (fid) => G.Wifi.get(fid, G.Wifi.powered(fid, G.Net.floorUp(fid))).good;
  /** 可用覆蓋（≥ −75 dBm）：無塵室的手持裝置只要這個 */
  const usableCov = (fid) => G.Wifi.get(fid, G.Wifi.powered(fid, G.Net.floorUp(fid))).usable;
  const portsOk = (fid) => G.S.floors[fid].idf.count > 0 && Q.floorPorts(fid) >= Q.floorPortNeed(fid).total;
  const uplinked = (fid) => Q.linksOf('F:' + fid).some((l) => Q.nodeKind(Q.other(l, 'F:' + fid)) === 'switch');
  const TAB = { net: '網路設備', srv: '伺服器', sys: '系統', wifi: '無線網路', facility: '機房設施', ai: 'AI 運算', isp: 'ISP 專線' };
  const tabOf = (model) => {
    const m = CAT.devices[model];
    if (!m) return CAT.room[model] && CAT.room[model].kind === 'cdu' ? 'ai' : 'facility';
    return m.ai ? 'ai' : m.sys ? 'sys' : m.cat === 'server' ? 'srv' : m.cat === 'wlc' ? 'wifi' : m.cat === 'ups' ? 'facility' : 'net';
  };
  const nameOf = (model) => (CAT.devices[model] || CAT.room[model] || { name: model }).name;

  /* ---------- 步驟產生器 ---------- */
  /** 採購一台設備 / 一項機房設施 */
  const buy = (model, done, why) => {
    const tab = tabOf(model);
    return { text: `到「採購 → ${TAB[tab]}」買 ${nameOf(model)}${why ? `（${why}）` : ''}`, short: `買這個：${nameOf(model)}`, go: 'shop:' + tab, path: ['nav:shop', 'tab:shop:' + tab, 'buy:' + model], done };
  };
  /** 上架：到機房，在「倉庫」點「自動上架」 */
  const install = (cat, done, name) => ({ text: `到「機房」把${name}裝上機櫃：在「倉庫」裡點它的「自動上架」`, short: '點「自動上架」', go: 'rack', path: ['nav:rack', 'install:' + cat], done });
  /** 設定伺服器角色（帶我去時會先幫你選好那台伺服器） */
  const roleStep = (r, done) => {
    const pickDev = () => devs().find((d) => d.rack && canRole(d, r) && !d.role) || devs().find((d) => d.rack && canRole(d, r) && d.role !== r);
    return { text: `在「機房」點選一台伺服器，把「角色」設成 ${CAT.roles[r].name}`, short: `角色選「${CAT.roles[r].name}」`,
      go: () => { const d = pickDev(); if (d) { G.Views.rack.sel = d.id; G.Views.rack.rack = d.rack; } G.UI.go('rack'); },
      path: () => { const d = pickDev(); return d ? ['nav:rack', 'inv:' + d.id, 'dev:' + d.id, 'role:' + d.id] : ['nav:rack']; }, done };
  };
  /** 在拓撲連線：先按「連線」，依序點兩個節點，再按「建立連線」 */
  const link = (text, getA, getB, done) => ({ text, short: text.replace(/^在「拓撲」/, ''), go: 'topo',
    path: () => {
      if (document.querySelector('[data-hint="link-ok"]')) return [{ k: 'link-ok', t: '確認線材與介面後，按「建立連線」' }];
      const V = G.Views.topo, A = getA(), B = getB();
      if (!A || !B) return ['nav:topo'];
      const a = typeof A === 'string' ? A : A.id, b = typeof B === 'string' ? B : B.id;
      if (!V.connecting) return ['nav:topo', { k: 'topo-link', t: '按「連線」' }];
      if (V.from && V.from !== a && V.from !== b) return ['nav:topo', { k: 'node:' + V.from, t: '先點這台，取消目前的連線起點' }];
      if (!V.from) return ['nav:topo', { k: 'node:' + a, t: `點「${Q.nodeName(a)}」` }];
      const nx = V.from === a ? b : a;
      return ['nav:topo', { k: 'node:' + nx, t: `再點「${Q.nodeName(nx)}」` }];
    }, done });
  /** 防火牆規則：用快速範本新增 */
  const TPL = { 'LAN>INTERNET:WEB': '員工上網', 'LAN>INTERNET:DNS': '員工 DNS', 'SERVERS>INTERNET:DNS': 'AD 轉送 DNS', 'INTERNET>DMZ:WEB': '客戶連官網', 'DMZ>SERVERS:SQL': '官網查資料庫',
    'GUEST>INTERNET:WEB': '訪客上網', 'GUEST>INTERNET:DNS': '訪客 DNS', 'IOT>SERVERS:MQTT': '智慧廁所感測器', 'WAN>SERVERS:SQL': '據點連 ERP', 'WAN>SERVERS:SMB': '據點檔案', 'WAN>SERVERS:LDAP': '據點登入', 'WAN>SERVERS:DNS': '據點 DNS', 'WAN>SERVERS:SIP': '據點分機', 'LAN>SERVERS:SIP': '分機註冊',
    'LAN>OT:WEB': '工程師看 MES', 'OT>SERVERS:SQL': 'MES 連 ERP', 'DMZ>OT:RDP': '跳板機連機台' };
  const rule = (src, dst, svc) => {
    const k = `${src}>${dst}:${svc}`, t = TPL[k];
    return { text: t ? `到「防火牆」按快速範本「${t}」，新增允許 ${src} → ${dst}：${svc}` : `到「防火牆」選來源 ${src}、目的 ${dst}、服務 ${svc}、動作「允許」，按「加到最下方」`,
      short: t ? `按「${t}」` : `新增 ${src} → ${dst}：${svc}`, go: 'fw:rules', path: ['nav:fw', 'tab:fw:rules', t ? 'fw-tpl:' + k : 'fw-add'], done: () => G.Sec.allows(src, dst, svc) };
  };
  /** 訂閱服務（資安、雲端、端點管理） */
  const svc = (id, where) => {
    const tab = where || 'fw:svc';
    const [v, p] = tab.split(':');
    return { text: `啟用「${CAT.services[id].name}」`, short: `啟用 ${CAT.services[id].name}`, go: tab, path: v === 'wan' ? ['nav:wan', 'wan-site:cloud', 'svc:' + id] : ['nav:' + v, p ? `tab:${v}:${p}` : null, 'svc:' + id], done: () => Q.hasService(id) };
  };
  const skip = (text, done) => ({ text, short: '按 ⏭ 快轉', go: null, path: ['speed-skip'], done });
  const look = (text, go, done) => ({ text, go, path: G.Hint ? G.Hint.defaultPath(go) : ['nav:' + go.split(':')[0]], done });

  /** 一台有特定角色、而且接上網路的伺服器：買 → 上架 → 設角色 → 接到核心 */
  const serverRole = (r, model, why, n, linkTo) => {
    n = n || 1;
    const withRole = () => devs().filter((d) => d.role === r && (d.rack || d.host)).length;
    const free = (d) => canRole(d, r) && !d.role;
    const target = linkTo || ((o) => isCore(o) || catIs('switch')(o) || catIs('firewall')(o));
    return [
      buy(model, () => withRole() + devs().filter(free).length >= n, why),
      install(mOf({ model }).cat, () => withRole() + devs().filter((d) => d.rack && free(d)).length >= n, `新的 ${nameOf(model)}`),
      roleStep(r, () => withRole() >= n),
      link(`在「拓撲」把 ${CAT.roles[r].name}伺服器接到${linkTo ? '對應的交換器' : '核心交換器'}：按「連線」，依序點兩台，再按「建立連線」`,
        () => devs().find((d) => d.role === r && d.rack && !serverLinked(d)), () => first(linkTo || isCore), () => roleUp(r, n)),
    ];
  };

  /** 一層樓的佈建：布線 → 接入交換器 → 上行 → AP（→ 等布線完工） */
  const floorSteps = (fid, cov) => {
    const fs = () => G.S.floors[fid];
    const out = [
      { id: 'cab', text: `到「樓層 → ${fid}」做水平布線：「發包施工」最省事，「自己布線」可以親手體驗`, short: '選一種布線方式', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'cabling@' + fid], done: () => fs().cabling.status !== 'none' },
    ];
    if (fs().cabling.status === 'diy') {
      const p = () => G.Diy.progress(fid) || { routed: 1, total: 1, pulled: 1 };
      out.push(
        { id: 'diy', text: `自己布線：在 ${fid} 平面圖上從 IDF（綠圈）拖曳到每個配線區，避開紅色電力線槽（或按「其餘自動規劃」）`, short: '從 IDF 拖曳到配線區', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'diy-tool@' + fid, 'diy-canvas@' + fid], done: () => p().routed >= p().total },
        skip(`等 IT 團隊把 ${fid} 的線拉完（可以按 ⏭ 快轉）`, () => p().pulled >= p().total),
        { id: 'diy', text: '端接打線：依 T568B 色序（白橙、橙、白綠、藍、白藍、綠、白棕、棕）', short: '開始打線', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'diy-term@' + fid], done: () => !!(G.Diy.job(fid) || {}).term || fs().cabling.status === 'done' },
        { id: 'diy', text: '用測試儀做認證測試，FAIL 的配線區照報告修正', short: '按「測試」', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'diy-test@' + fid], done: () => fs().cabling.status === 'done' });
    }
    out.push(
      { id: 'idf', text: `${fid} 的 IDF：按「建議數量」算出需要幾台接入交換器，再按「套用」`, short: '按「建議數量」再「套用」', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'idf-suggest@' + fid, 'idf-apply@' + fid], done: () => portsOk(fid) },
      { id: 'uplink', text: `把 ${fid} 上行到 B1 的核心交換器：按「新增上行」→ 選核心交換器 →「建立連線」（人多的樓層用 10G 光纖）`, short: '新增上行到核心', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'uplink@' + fid, 'pick:core', 'link-ok'], done: () => uplinked(fid) },
      { id: 'ap', text: `${fid} 佈建 AP：按「自動規劃 AP」讓無線顧問算好數量與位置（也可以自己放）`, short: '按「自動規劃 AP」', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'autoplan@' + fid, 'autoplan-ok'], done: () => fs().aps.length > 0 && G.Wifi.get(fid, new Set(fs().aps.map((a) => a.id))).good >= (cov || 0.85) },
      skip(`等 ${fid} 的布線施工完成（可以按 ⏭ 快轉）`, () => fs().cabling.status === 'done'),
      look(`${fid} 的 Wi-Fi 覆蓋還不夠：在平面圖的「訊號」圖層找紅色、灰色的地方補 AP`, 'floor:' + fid, () => coverage(fid) >= (cov || 0.85)));
    return out;
  };
  const nextFloor = (ids, cov) => ids.find((id) => { const fs = G.S.floors[id]; return !(fs.cabling.status === 'done' && portsOk(id) && uplinked(id) && coverage(id) >= cov); });

  /** 在拓撲接 ISP：等開通 → 接到路由器 */
  const ispSteps = () => [
    skip('等 ISP 專線開通（開通要十幾個小時以上：按 ⏭ 快轉）', () => G.S.isp.length > 0 && G.S.isp.every((c) => c.status === 'active')),
    link('在「拓撲」把 ISP 節點接到路由器：按「連線」，點 ISP 再點路由器', () => { const c = G.S.isp.find((x) => x.status === 'active' && !x.router); return c ? 'isp:' + c.id : null; }, () => first(catIs('router')),
      () => !G.S.isp.some((c) => c.status === 'active' && !c.router)),
  ];

  /* ---------- 滿意度不夠：自動診斷最主要的原因 ---------- */
  const THR = { router: 'thr', firewall: 'fw' };
  const BIG = { router: ['NR-5500', 'NR-9000'], firewall: ['SG-3000', 'SG-9000'] };
  /** 換一台更大的路由器 / 防火牆：買 → 上架 → 賣掉舊的（連線一起拆掉）→ 重新接線 */
  const upgradeSteps = (u) => {
    const better = (d) => catIs(u.cat)(d) && mOf(d)[THR[u.cat]] > u.thr;
    const next = BIG[u.cat].find((m) => CAT.devices[m][THR[u.cat]] >= u.thr * 4) || BIG[u.cat][BIG[u.cat].length - 1];
    const oldAlive = () => !!G.S.devices[u.oldId];
    const steps = [
      buy(next, () => own(better), `${u.oldName} 效能不夠，要換大一點的`),
      install(u.cat, () => inRack(better), `新的${u.cat === 'router' ? '路由器' : '防火牆'}`),
      { text: `出售舊的 ${u.oldName}（它的連線會一起拆掉，回收 4 成）`, short: '出售舊設備', go: () => { const d = G.S.devices[u.oldId]; if (d) { G.Views.rack.sel = d.id; G.Views.rack.rack = d.rack; } G.UI.go('rack'); },
        path: () => ['nav:rack', 'dev:' + u.oldId, 'sell:' + u.oldId, 'confirm-ok'], done: () => !oldAlive() },
    ];
    if (u.cat === 'router') {
      steps.push(link('在「拓撲」把新的路由器接到防火牆（防火牆介面選「外部 OUTSIDE」）', () => first(better), () => first(catIs('firewall')), () => fwLink(better, 'outside')), ...ispSteps());
    } else {
      steps.push(link('在「拓撲」把路由器接到新的防火牆（外部 OUTSIDE）', () => first(catIs('router')), () => first(better), () => fwLink(catIs('router'), 'outside')),
        link('在「拓撲」把新的防火牆接到核心交換器（內部 INSIDE）', () => first(better), () => first(isCore), () => fwLink(isCore, 'inside')));
      const dmz = first((d) => catIs('switch')(d) && !Q.isL3(d) && !mOf(d).ai);
      if (dmz) steps.push(link('把 DMZ 交換器也接回新的防火牆（介面選「DMZ」）', () => dmz, () => first(better), () => fwLink((o) => o.id === dmz.id, 'dmz')));
    }
    return steps;
  };
  const diagnose = () => {
    const sim = G.R.sim;
    if (!sim) return [];
    /* 換機的流程一旦開始，就跟到做完為止（換機途中流量會暫時歸零，不要被別的問題打斷） */
    const cur = G.R.hintUpgrade;
    if (cur) {
      const st = upgradeSteps(cur);
      if (st.some((x) => !x.done())) return st;
      G.R.hintUpgrade = null;
    }
    /* 正在發生的嚴重事件（設備故障、斷線、攻擊…）最優先 */
    const inc = G.Ev.visible().find((i) => i.status === 'active' && (i.sev === 'crit' || i.sev === 'high'));
    if (inc) return [{ text: `先處理事件：${inc.title}（到「事件」選擇應變行動）`, short: '先處理這個事件', go: 'inc:' + inc.id, path: ['nav:inc'], done: () => inc.status !== 'active' }];
    const hot = Object.entries(sim.nodes).filter(([, n]) => n.util >= 0.95).map(([id]) => G.S.devices[id]).filter(Boolean);
    const r = hot.find(catIs('router')), f = hot.find(catIs('firewall'));
    const fwN = devs().filter((d) => d.rack && catIs('firewall')(d)).length;
    const pick = r || (f && fwN === 1 ? f : null);
    if (pick) {
      G.R.hintUpgrade = { cat: mOf(pick).cat, oldId: pick.id, oldName: pick.name, thr: mOf(pick)[THR[mOf(pick).cat]] };
      return upgradeSteps(G.R.hintUpgrade);
    }
    if (f) return [look('兩台防火牆都滿載：HA 的兩台都要換成更大的型號（採購 → 網路設備）', 'shop:net', () => false)];
    if (sim.wan.cap > 0 && sim.wan.in >= sim.wan.cap * 0.9) return [{ text: 'ISP 頻寬不夠：到「採購 → ISP 專線」再申請一條（路由器要支援 BGP 才能同時用兩條）', short: '再申請一條專線', go: 'shop:isp', path: ['nav:shop', 'tab:shop:isp', 'isp:10G'], done: () => false }];
    const tk = G.S.tickets.find((t) => !t.resolvedAt && (t.sev === 'crit' || t.sev === 'high')) || G.S.tickets.find((t) => !t.resolvedAt);
    /* 廁所的報修：清潔人員不夠就加人；夠了就等清潔人員巡到 */
    if (tk && /^wc/.test(tk.kind)) {
      return G.S.rest.staff < G.Rest.recommend()
        ? [{ text: `報修：${tk.text}。清潔人員巡不過來：到「樓層」頁的「⑤ 廁所與清潔」把白班清潔人員加到建議人數`, short: '清潔人員加到建議人數', go: 'floor:' + tk.fid, path: ['nav:floor', 'floor:' + tk.fid, 'rest-add'], done: () => !!tk.resolvedAt || G.S.rest.staff >= G.Rest.recommend() }]
        : [skip(`報修：${tk.text}。清潔人員正在巡，等他們處理（可以按 ⏭ 快轉）`, () => !!tk.resolvedAt)];
    }
    /* 員工 Wi-Fi 位址池不夠：直接標出網段選單，算好要調成多大 */
    if (tk && tk.kind === 'dhcpwifi' && sim.dhcp) {
      let p = S().subnets.wifi;
      while (p > 16 && Q.hosts(p) - 1 < sim.dhcp.wifi.need) p--;
      return [{ text: `報修：${tk.text}。員工 Wi-Fi 的位址池不夠（尖峰要 ${G.U.num(sim.dhcp.wifi.need)} 個）：到「防火牆 → 網段規劃」把「員工無線」調大到 /${p}`, short: `調成「/${p}」`, go: 'fw:net',
        path: ['nav:fw', 'tab:fw:net', 'subnet:wifi'], done: () => !!tk.resolvedAt || Q.hosts(S().subnets.wifi) - 1 >= G.R.sim.dhcp.wifi.need }];
    }
    if (tk) return [{ text: `報修：${tk.text}。${tk.hint}`, short: tk.text, go: tk.goto, path: G.Hint ? G.Hint.defaultPath(tk.goto) : [], done: () => !!tk.resolvedAt }];
    return [];
  };

  const H = {};
  G.HINTS = H;
  H.diagnose = diagnose;
  /** 一層樓的佈建步驟（緊急報修「整層斷線」時用） */
  H.floorFix = (fid) => (G.BLD.isFab(fid) ? H['c10-fab']() : floorSteps(fid, G.FT[G.BLD.byId[fid].type].park ? 0.9 : 0.85));

  /* ---------- 第一章 ---------- */
  H['c1-rack'] = () => [{ text: '到「機房」按「＋ 機櫃」買一座 42U 機櫃（網路設備都要裝在機櫃裡才能通電）', short: '買一座機櫃', go: 'rack', path: ['nav:rack', 'buy:rack'], done: () => S().racks.length > 0 }];
  H['c1-isp'] = () => [{ text: '到「採購 → ISP 專線」申請一條 1G 專線（開通要十幾個小時，要先申請！）', short: '申請 1G 專線', go: 'shop:isp', path: ['nav:shop', 'tab:shop:isp', 'isp:1G'], done: () => S().isp.length > 0 }];
  H['c1-router'] = () => [buy('NR-1100', () => own(catIs('router')), '分支路由器就夠 527 人用'), install('router', () => inRack(catIs('router')), '路由器')];
  H['c1-fw'] = () => [buy('SG-300', () => own(catIs('firewall')), '2 Gbps 以內夠用'), install('firewall', () => inRack(catIs('firewall')), '防火牆')];
  H['c1-core'] = () => [buy('CX-6400', () => own(isCore), '48 個光纖埠，以後接很多樓層也夠'), install('switch', () => inRack(isCore), '核心交換器')];
  H['c1-wire'] = () => [
    link('在「拓撲」連線：路由器 ⇄ 防火牆（防火牆介面選「外部 OUTSIDE」）', () => first(catIs('router')), () => first(catIs('firewall')), () => fwLink(catIs('router'), 'outside')),
    link('在「拓撲」連線：防火牆 ⇄ 核心交換器（防火牆介面選「內部 INSIDE」）', () => first(catIs('firewall')), () => first(isCore), () => fwLink(isCore, 'inside')),
  ];
  H['c1-isplink'] = ispSteps;
  H['c1-ad'] = () => serverRole('ad', 'SV-1U', '通用伺服器就能當 AD / DNS / DHCP');
  H['c1-cabling'] = () => floorSteps('2F', 0.9).slice(0, G.S.floors['2F'].cabling.status === 'diy' ? 5 : 1).concat([skip('等 2F 的布線施工完成（可以按 ⏭ 快轉）', () => G.S.floors['2F'].cabling.status === 'done')]);
  H['c1-access'] = () => floorSteps('2F', 0.9).filter((x) => x.id === 'idf');
  H['c1-uplink'] = () => floorSteps('2F', 0.9).filter((x) => x.id === 'uplink');
  H['c1-wifi'] = () => floorSteps('2F', 0.9).filter((x) => x.id === 'ap');
  H['c1-rules'] = () => [rule('LAN', 'INTERNET', 'WEB'), rule('LAN', 'INTERNET', 'DNS')];
  H['c1-live'] = () => [skip('等週一 09:00 員工進駐（按 ⏭ 快轉到早上），再到「大樓」看 2F 的滿意度', () => (G.R.sim && G.R.sim.floors['2F'] ? G.R.sim.floors['2F'].present > 100 : false)), ...diagnose(), look('2F 的滿意度要維持 80% 以上 2 小時：到「大樓」觀察', 'building', () => false)];

  /* ---------- 第二章 ---------- */
  H['c2-file'] = () => serverRole('file', 'ST-4U', '儲存伺服器，有 25G 網卡');
  H['c2-nms'] = () => serverRole('nms', 'SV-1U', '網管監控用');
  H['c2-wan'] = () => [{ text: '到「採購 → ISP 專線」申請一條 10G 專線（3,600 人尖峰約需 4～5 Gbps）', short: '申請 10G 專線', go: 'shop:isp', path: ['nav:shop', 'tab:shop:isp', 'isp:10G'], done: () => S().isp.reduce((t, c) => t + c.bw, 0) >= 5000 }].concat(ispSteps());
  H['c2-floors'] = () => { const fid = nextFloor(['3F', '4F', '5F', '6F', '7F', '8F'], 0.85); return fid ? floorSteps(fid, 0.85) : []; };
  H['c2-park'] = () => floorSteps('B2', 0.9);
  H['c2-wlc'] = () => [buy('WC-500', () => own(catIs('wlc'))), install('wlc', () => inRack(catIs('wlc')), '無線控制器'),
    link('在「拓撲」把無線控制器接到核心交換器', () => devs().find((d) => d.rack && catIs('wlc')(d) && !serverLinked(d)), () => first(isCore), () => devs().some((d) => d.rack && catIs('wlc')(d) && serverLinked(d)))];
  H['c2-dhcp'] = () => [{ text: '到「防火牆 → 網段規劃」把「員工無線」網段調大（例如 /20），讓每支手機、筆電都拿得到 IP', short: '把員工無線調大', go: 'fw:net', path: ['nav:fw', 'tab:fw:net', 'subnet:wifi'], done: () => !G.R.sim || Q.hosts(S().subnets.wifi) - 1 >= G.R.sim.dhcp.wifi.need },
    { text: '「員工有線」網段也要夠大（每層樓一個 VLAN）', short: '調整員工有線', go: 'fw:net', path: ['nav:fw', 'tab:fw:net', 'subnet:wired'], done: () => !G.R.sim || Q.hosts(S().subnets.wired) - 1 >= G.R.sim.dhcp.wired.worst }];
  H['c2-sat'] = () => [...diagnose(), look('到「監控」找出瓶頸：WAN、樓層上行、Wi-Fi 容量或防火牆效能', 'noc', () => false)];
  H['c2-rest'] = () => [
    { text: '到「樓層」頁的「⑤ 廁所與清潔」按「＋」，把白班清潔人員加到建議人數（樓層越多，要巡的廁所越多）', short: '清潔人員加到建議人數', go: 'floor', path: ['nav:floor', 'rest-add'], done: () => S().rest.staff >= G.Rest.recommend() },
    skip('等 3,000 人以上進駐後，撐過一整個工作天（09:00～18:00）：每間廁所都要有衛生紙、整潔 ≥ 60%（可以按 ⏭ 快轉）', () => false),
  ];

  /* ---------- 第三章 ---------- */
  H['c3-lobby'] = () => floorSteps('1F', 0.9);
  H['c3-guest'] = () => [{ text: '到「防火牆 → 網段規劃」按「訪客 Wi-Fi」的「啟用」', short: '啟用訪客 Wi-Fi', go: 'fw:net', path: ['nav:fw', 'tab:fw:net', 'guest-wifi'], done: () => S().fw.guestWifi }];
  H['c3-guestiso'] = () => [rule('GUEST', 'INTERNET', 'WEB'), rule('GUEST', 'INTERNET', 'DNS')];
  H['c3-dmz'] = () => [
    buy('DX-2400', () => own((d) => catIs('switch')(d) && !Q.isL3(d)), '接官網伺服器用的 DMZ 交換器'),
    install('switch', () => inRack((d) => catIs('switch')(d) && !Q.isL3(d)), 'DMZ 交換器'),
    link('在「拓撲」把 DMZ 交換器接到防火牆（防火牆介面選「DMZ」）', () => first((d) => catIs('switch')(d) && !Q.isL3(d)), () => first(catIs('firewall')), () => fwLink((o) => catIs('switch')(o) && !Q.isL3(o), 'dmz')),
  ].concat(serverRole('web', 'SV-1U', '官網伺服器', 1, (o) => catIs('switch')(o) && !Q.isL3(o)));
  H['c3-db'] = () => serverRole('db', 'SV-1U', '資料庫要放在內部伺服器區');
  H['c3-rules'] = () => [rule('INTERNET', 'DMZ', 'WEB'), rule('DMZ', 'SERVERS', 'SQL')];
  H['c3-iot'] = () => {
    const fid = G.Rest.occupied().map((f) => f.id).find((id) => !G.Rest.hasIot(id));
    const steps = [];
    /* IoT 閘道器要佔 IDF 交換器的一個埠：埠數剛好用完的樓層，先多加一台交換器 */
    if (fid && Q.floorPorts(fid) < Q.floorPortNeed(fid).total + 1) steps.push({ id: 'idf', text: `${fid} 的接入交換器沒有空的埠給 IoT 閘道器：在「② IDF 接入交換器」按「建議數量」再「套用」`, short: '按「建議數量」再「套用」', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'idf-suggest@' + fid, 'idf-apply@' + fid], done: () => Q.floorPorts(fid) >= Q.floorPortNeed(fid).total + 1 });
    if (fid) steps.push({ text: `到「樓層 → ${fid}」的「⑤ 廁所與清潔」按「安裝智慧廁所」（IoT 閘道器接在 IDF 的交換器上，每間廁所裝感測器）`, short: '安裝智慧廁所', go: 'floor:' + fid, path: ['nav:floor', 'floor:' + fid, 'rest-iot@' + fid], done: () => G.Rest.hasIot(fid) });
    return steps.concat(serverRole('iot', 'SV-1U', 'IoT 管理平台'), [
      { text: '到「防火牆 → 網段規劃」啟用「IoT 獨立網段」（VLAN 600）：IoT 裝置不要和員工電腦放在同一個網段', short: '啟用 IoT 獨立網段', go: 'fw:net', path: ['nav:fw', 'tab:fw:net', 'iot-vlan'], done: () => S().fw.iotVlan },
      rule('IOT', 'SERVERS', 'MQTT'),
      look('IoT 網段只能連到 IoT 管理平台：到「防火牆」刪掉 IOT 連到 LAN、網際網路或其他區域的規則', 'fw:rules', () => G.Sec.posture().iotIsolated),
      look('到「樓層」頁確認每層樓的智慧廁所都連得上 IoT 平台', 'floor', () => false),
    ]);
  };
  H['c3-audit'] = () => [look('到「防火牆 → 資安健檢」照著每一項的建議修正', 'fw:audit', () => false)];
  H['c3-web'] = () => [...diagnose(), look('到「監控」看官網的可用率：WEB、DB、DMZ 規則與 ISP 頻寬缺一不可', 'noc', () => false)];

  /* ---------- 第四章 ---------- */
  H['c4-floors'] = () => { const fid = nextFloor(G.BLD.floors.filter((f) => f.level >= 9 && f.level <= 21).map((f) => f.id), 0.85); return fid ? floorSteps(fid, 0.85) : []; };
  H['c4-isp2'] = () => [{ text: '到「採購 → ISP 專線」上方換一家業者（乙寬頻或丙通信），再申請一條 10G 專線', short: '換業者、申請 10G', go: 'shop:isp', path: ['nav:shop', 'tab:shop:isp', 'isp:10G'], done: () => new Set(S().isp.map((c) => c.provider)).size >= 2 }].concat(ispSteps());
  H['c4-core2'] = () => [buy('CX-6400', () => devs().filter(isCore).length >= 2, '第二台核心，做備援'), install('switch', () => devs().filter((d) => d.rack && isCore(d)).length >= 2, '第二台核心交換器'),
    look('每層樓再拉一條上行到「另一台」核心：在樓層頁按「新增上行」', 'floor', () => false)];
  H['c4-fwha'] = () => {
    const fw0 = first(catIs('firewall'));
    return [buy(fw0 ? fw0.model : 'SG-3000', () => devs().filter(catIs('firewall')).length >= 2, '跟現有的同型號'), install('firewall', () => devs().filter((d) => d.rack && catIs('firewall')(d)).length >= 2, '第二台防火牆'),
      link('在「拓撲」把兩台防火牆互連（HA 同步線）', () => devs().filter((d) => d.rack && catIs('firewall')(d))[0], () => devs().filter((d) => d.rack && catIs('firewall')(d))[1],
        () => Object.values(S().links).some((l) => Q.nodeKind(l.a) === 'firewall' && Q.nodeKind(l.b) === 'firewall')),
      look('第二台防火牆也要接到路由器（外部）與核心（內部）', 'topo', () => false)];
  };
  H['c4-power'] = () => [buy('UPS-80K', () => G.Fac.roomUnits('ups').length > 0), buy('GEN-250', () => G.Fac.roomUnits('generator').length > 0)];
  H['c4-cool'] = () => [buy('CRAC-60', () => !!G.R.fac && G.R.fac.coolN1 >= G.R.fac.heat, '多一台備援')];
  H['c4-ad2'] = () => serverRole('ad', 'SV-1U', '第二台 AD', 2);
  H['c4-sat'] = () => [...diagnose(), look('到「監控」找出瓶頸：萬人規模的 WAN 尖峰超過 10 Gbps，防火牆開 IPS 後效能也要夠', 'noc', () => false)];

  /* ---------- 第五章 ---------- */
  H['c5-siem'] = () => serverRole('siem', 'SV-2U', '日誌分析要效能');
  H['c5-backup'] = () => serverRole('backup', 'ST-4U', '備份要大容量').concat([svc('immutable')]);
  H['c5-defense'] = () => ['ips', 'edr', 'mfa', 'mailsec'].filter((id) => !Q.hasService(id)).slice(0, Math.max(0, 4 - ['ips', 'edr', 'mfa', 'mailsec', 'url', 'nac'].filter((x) => Q.hasService(x)).length)).map((id) => svc(id));
  H['c5-seg'] = () => [rule('LAN', 'SERVERS', 'LDAP'), rule('LAN', 'SERVERS', 'DNS'), rule('LAN', 'SERVERS', 'SMB'), rule('LAN', 'SERVERS', 'SQL'),
    { text: '規則都補好了，到「防火牆 → 網段規劃」啟用「內部分段」', short: '啟用內部分段', go: 'fw:net', path: ['nav:fw', 'tab:fw:net', 'seg'], done: () => S().fw.segmentation }];
  H['c5-survive'] = () => [look('到「事件」處理正在發生的攻擊：先遏制、再根除、最後復原', 'inc', () => false)];
  H['c5-grade'] = () => [look('到「防火牆 → 資安健檢」逐項處理', 'fw:audit', () => false)];
  H['c5-rating'] = () => [...diagnose(), look('穩定的服務與正確的事件處理都會提升評價：到「監控」看看還有哪裡不穩', 'noc', () => false)];

  /* ---------- 第六章 ---------- */
  const aiRack = () => S().racks.some((r) => r.type === 'ai');
  H['c6-rack'] = () => [{ text: '到「採購 → AI 運算」買一座 ORv3 AI 機櫃', short: '買 AI 機櫃', go: 'shop:ai', path: ['nav:shop', 'tab:shop:ai', 'buy:rackai'], done: aiRack },
    buy('PS-33', () => own((d) => d.model === 'PS-33'), 'AI 機櫃的電源櫃'), buy('BBU-6', () => own((d) => d.model === 'BBU-6'), '撐過發電機啟動前的空窗'),
    install('power', () => inRack((d) => d.model === 'PS-33'), '電源櫃'), install('bbu', () => inRack((d) => d.model === 'BBU-6'), 'BBU')];
  H['c6-gpu'] = () => [buy('GX-8', () => devs().filter((d) => d.model === 'GX-8').length >= 2, '要兩台'), install('server', () => devs().filter((d) => d.rack && d.model === 'GX-8').length >= 2, 'GX-8（只能裝在 AI 機櫃）')];
  H['c6-n1'] = () => [buy('PS-33', () => false, '負載超過（PSU 數 − 1）× 5.5 kW 就再加一台'), look('到「機房」看每座 AI 機櫃的電源櫃 N+1', 'rack', () => false)];
  H['c6-bbu'] = () => [buy('BBU-6', () => false, 'BBU 容量要 ≥ 機櫃負載'), buy('GEN-250', () => G.Fac.roomUnits('generator').length > 0)];
  H['c6-cdu'] = () => [buy('CDU-100', () => !!G.R.fac && G.R.fac.cduCap >= G.R.fac.liquidHeat && G.R.fac.liquidHeat > 0)];
  H['c6-fabric'] = () => [buy('AF-6400', () => own((d) => d.model === 'AF-6400')), install('switch', () => inRack((d) => d.model === 'AF-6400'), 'AI 後端交換器'),
    link('在「拓撲」把每台 GX-8 接到 AF-6400，速率選 400G', () => devs().find((d) => d.rack && d.model === 'GX-8' && !linkedTo(d, (o) => o.model === 'AF-6400')), () => first((d) => d.model === 'AF-6400'),
      () => devs().filter((d) => d.rack && d.model === 'GX-8').every((d) => linkedTo(d, (o) => o.model === 'AF-6400')))];
  H['c6-store'] = () => [buy('ST-AI', () => own((d) => d.model === 'ST-AI')), install('server', () => inRack((d) => d.model === 'ST-AI'), 'AI 儲存'),
    link('在「拓撲」把 ST-AI 接到 AF-6400（400G）', () => first((d) => d.model === 'ST-AI'), () => first((d) => d.model === 'AF-6400'), () => roleUp('aistore'))];
  H['c6-fire'] = () => [buy('VESDA', () => G.S.room.some((r) => r.model === 'VESDA')), buy('GAS-FS', () => G.S.room.some((r) => r.model === 'GAS-FS'))];
  H['c6-ems'] = () => [buy('EMS-1', () => G.S.room.some((r) => r.model === 'EMS-1'))];
  H['c6-perf'] = () => [look('到「機房」看 AI 算力利用率：供電、散熱、後端網路、儲存哪一項拖後腿就補哪一項', 'rack', () => false)];

  /* ---------- 第七章 ---------- */
  H['c7-canteen'] = () => { const fid = nextFloor(['22F', '23F'], 0.9); return fid ? floorSteps(fid, 0.9) : []; };
  H['c7-lunch'] = () => [{ text: '午餐尖峰 AP 不夠：到 22F / 23F 按「自動規劃 AP」（照人數規劃），或改用 Wi-Fi 6E', short: '按「自動規劃 AP」', go: 'floor:22F', path: ['nav:floor', 'floor:22F', 'autoplan@22F', 'autoplan-ok'], done: () => false }];
  H['c7-pbx'] = () => [buy('PX-500', () => own((d) => d.model === 'PX-500' || d.role === 'pbx')), install('server', () => inRack((d) => d.model === 'PX-500' || d.role === 'pbx'), '電話交換機'),
    link('在「拓撲」把電話交換機接到核心交換器', () => devs().find((d) => d.rack && (d.model === 'PX-500') && !serverLinked(d)), () => first(isCore), () => roleUp('pbx')),
    { text: '到「系統 → 語音」申請 SIP 中繼（外線），客服中心建議 240 路', short: '申請外線', go: 'sys:voice', path: ['nav:sys', 'tab:sys:voice', 'trunk:240'], done: () => S().voice.trunk > 0 || S().voice.next > 0 }];
  H['c7-sbc'] = () => [buy('SBC-2', () => own((d) => d.model === 'SBC-2')), install('server', () => inRack((d) => d.model === 'SBC-2'), 'SBC'),
    link('在「拓撲」把 SBC 接到防火牆的 DMZ 介面', () => first((d) => d.model === 'SBC-2'), () => first(catIs('firewall')), () => G.Sec.serverZones('sbc').some((x) => x.zone === 'DMZ')),
    { text: '防火牆：新增 INTERNET → DMZ：SIP 與 DMZ → SERVERS：SIP（選好來源、目的、服務後按「加到最下方」）', short: '新增 SIP 規則', go: 'fw:rules', path: ['nav:fw', 'tab:fw:rules', 'fw-add'], done: () => G.Sec.allows('INTERNET', 'DMZ', 'SIP') && G.Sec.allows('DMZ', 'SERVERS', 'SIP') }];
  H['c7-voice'] = () => [{ text: '到「系統 → 語音」啟用語音 QoS', short: '啟用語音 QoS', go: 'sys:voice', path: ['nav:sys', 'tab:sys:voice', 'qos'], done: () => S().voice.qos },
    look('用「系統 → 語音」的 Erlang B 試算調整外線路數，讓阻塞率 < 2%', 'sys:voice', () => false)];
  const wanLine = (id, type, done) => ({ text: `到「據點」選${G.SITES[id].name}，申請 ${CAT.wan.types[type].name}`, short: `申請 ${CAT.wan.types[type].short || type}`, go: 'wan:' + id,
    path: () => ['nav:wan', 'wan-site:' + id, 'wan-type:' + type + '@' + id, (G.Views.wan && document.querySelector(`[data-hint="wan-type:${type}@${id}"].on`)) ? 'wan-order@' + id : null], done });
  const hasLine = (id, type) => (S().wan.sites[id].links || []).some((l) => l.type === type);
  H['c7-tc'] = () => [wanLine('tc', 'mpls', () => hasLine('tc', 'mpls')),
    { text: '到「據點 → 總部的 WAN 出口」申請 MPLS 匯接（總部也要接上 MPLS）', short: '申請總部 MPLS 匯接', go: 'wan:hq', path: ['nav:wan', 'wan-site:hq', 'hqmpls:1000'], done: () => !!S().wan.hq.mpls },
    rule('WAN', 'SERVERS', 'SQL'), rule('WAN', 'SERVERS', 'SMB'), rule('WAN', 'SERVERS', 'LDAP'), rule('WAN', 'SERVERS', 'DNS'),
    skip('等專線開通（專線要一兩天：可以按 ⏭ 快轉）', () => (S().wan.sites.tc.links || []).some((l) => l.type === 'mpls' && l.status === 'active'))];
  H['c7-vn'] = () => [wanLine('vn', 'iplc', () => hasLine('vn', 'iplc')), wanLine('vn', 'inet', () => hasLine('vn', 'inet')),
    { text: '越南廠勾選「VPN」（或 SD-WAN），寬頻當備援路線', short: '勾選 VPN', go: 'wan:vn', path: ['nav:wan', 'wan-site:vn', 'vpn:vn'], done: () => S().wan.sites.vn.vpn || S().wan.sites.vn.sdwan }];
  H['c7-sdwan'] = () => [buy('SDW-HUB', () => own((d) => d.model === 'SDW-HUB' || d.role === 'sdwan')), install('server', () => inRack((d) => d.model === 'SDW-HUB'), 'SD-WAN 集中器'),
    link('在「拓撲」把 SD-WAN 集中器接到防火牆的 DMZ', () => first((d) => d.model === 'SDW-HUB'), () => first(catIs('firewall')), () => devs().some((d) => d.model === 'SDW-HUB' && d.rack && serverLinked(d))),
    ...['tc', 'ks'].map((id) => ({ text: `到「據點」選${G.SITES[id].name}，勾選「SD-WAN」`, short: '勾選 SD-WAN', go: 'wan:' + id, path: ['nav:wan', 'wan-site:' + id, 'sdwan:' + id], done: () => S().wan.sites[id].sdwan }))];
  H['c7-cloud'] = () => [svc('m365', 'wan:cloud'), svc('mfa')];
  H['c7-sites'] = () => [look('到「據點」看哪一類應用卡住了：頻寬、延遲、防火牆規則，還是晚上的國際網路', 'wan', () => false)];

  /* ---------- 第八章 ---------- */
  H['c8-cluster'] = () => [buy('HV-2U', () => devs().filter((d) => d.model === 'HV-2U').length >= 3, '要三台'), buy('SAN-5K', () => own((d) => d.model === 'SAN-5K')),
    install('server', () => devs().filter((d) => d.rack && d.model === 'HV-2U').length >= 3, '虛擬化主機'), install('storage', () => inRack((d) => d.model === 'SAN-5K'), 'SAN'),
    link('在「拓撲」把虛擬化主機與 SAN 接到核心交換器（25G）', () => devs().find((d) => d.rack && (d.model === 'HV-2U' || d.model === 'SAN-5K') && !serverLinked(d)), () => first(isCore),
      () => devs().filter((d) => d.rack && (d.model === 'HV-2U' || d.model === 'SAN-5K')).every(serverLinked)),
    { text: '到「系統 → 虛擬化」確認 HA 已開啟', short: '開啟 HA', go: 'sys:vm', path: ['nav:sys', 'tab:sys:vm', 'vm-ha'], done: () => S().vm.ha }];
  H['c8-vms'] = () => [{ text: '到「系統 → 虛擬化」選角色、按「建立 VM」；或在實體伺服器按「轉成 VM」（P2V）', short: '建立 VM 或 P2V', go: 'sys:vm', path: ['nav:sys', 'tab:sys:vm', 'p2v', 'vm-create'], done: () => false }];
  H['c8-n1'] = () => [look('到「系統 → 虛擬化」：壞掉一台主機後，剩下的記憶體要放得下所有 VM；本機硬碟的 VM 要搬到 SAN', 'sys:vm', () => false)];
  H['c8-raid'] = () => [look('到「系統 → 儲存」把 RAID 5 改成 RAID 6 或 RAID 10；空間不夠就加擴充櫃', 'sys:stor', () => false)];
  H['c8-321'] = () => [buy('TL-48', () => own((d) => d.model === 'TL-48') || Q.hasService('cloudbk'), '或改用雲端備份'), look('到「系統 → 備份」啟用磁帶異地保管，或雲端備份', 'sys:bkp', () => false)];
  H['c8-drill'] = () => [{ text: '到「系統 → 備份」按「進行還原演練」（約 2 小時）', short: '進行還原演練', go: 'sys:bkp', path: ['nav:sys', 'tab:sys:bkp', 'bkp-drill'], done: () => S().bkp.drillUntil > S().time }];
  H['c8-uem'] = () => [svc('uem', 'sys:ep'),
    { text: '勾選「分批派送」', short: '勾選分批派送', go: 'sys:ep', path: ['nav:sys', 'tab:sys:ep', 'ep-rings'], done: () => S().ep.rings },
    { text: '勾選「BitLocker」', short: '勾選 BitLocker', go: 'sys:ep', path: ['nav:sys', 'tab:sys:ep', 'ep-bitlocker'], done: () => S().ep.bitlocker }];
  H['c8-patch'] = () => [{ text: '先建一台更新快取（UPD 角色的 VM），一萬台電腦才不會一起從網際網路下載', short: '建立更新快取 VM', go: 'sys:ep', path: ['nav:sys', 'tab:sys:ep', 'vm-upd'], done: () => roleUp('upd') },
    skip('等更新發布（每週三凌晨 1:00）後由端點管理平台派送', () => false)];
  H['c8-vuln'] = () => [{ text: '到「系統 → 虛擬化」角色選「弱點掃描」，建立一台 VM', short: '建立弱點掃描 VM', go: 'sys:vm', path: ['nav:sys', 'tab:sys:vm', 'vm-create'], done: () => G.Vuln.scannerUp() },
    { text: '到「防火牆 → 弱點管理」把嚴重與高風險的弱點排入今晚的維護窗口', short: '排入維護窗口', go: 'fw:vuln', path: ['nav:fw', 'tab:fw:vuln', 'vuln-tonight'], done: () => false }];
  H['c8-access'] = () => [buy(G.Acc.level() ? 'ACS-MFA' : 'ACS-CARD', () => G.S.room.some((r) => CAT.room[r.model].kind === 'access'), '機房要有門禁系統'),
    skip('等門禁系統安裝完成（可以按 ⏭ 快轉）', () => G.Acc.level() >= 1),
    ...[['vendor', '需 IT 陪同'], ['clean', '需 IT 陪同'], ['mgr', '不能進入']].map(([g, t]) => ({ text: `到「機房 → 機房門禁」把「${G.Acc.groupName(g)}」改成「${t}」`, short: `改成「${t}」`, go: 'rack', path: ['nav:rack', 'acl:' + g],
      done: () => (G.Acc.GROUPS.find((x) => x.id === g) || { best: [] }).best.includes(G.S.access.list[g]) }))];
  H['c8-audit'] = () => [look('到「防火牆 → 資安健檢」逐項處理：備份、修補、弱點、門禁、雲端 MFA……', 'fw:audit', () => false)];

  /* ---------- 第九章：割接之夜（機房 → 實體接線） ---------- */
  const PU = () => G.PatchUI;
  const pn = (n, p) => G.Phys.name(n, p);
  /** 先切到「機房 → 實體接線」、選對機櫃，再標出那個埠（last = 埠詳情裡要按的按鈕） */
  /* 機櫃分頁在兩種模式都有：還在「機櫃」模式時，先標「實體接線」切換鈕 */
  const needPatch = () => G.Views.rack.mode !== 'patch';
  const toPatch = ['nav:rack', { k: 'mode:patch', t: '切到「實體接線」' }];
  const portPath = (n, p, ...last) => {
    if (needPatch()) return toPatch;
    const d = S().devices[n];
    const out = ['nav:rack', 'mode:patch'];
    if (d && d.rack) out.push('racktab:' + d.rack);
    out.push({ k: `port:${n}:${p}`, t: `點 ${Q.nodeName(n)} 的 ${pn(n, p)}` });
    /* 埠詳情裡的按鈕是共用的：選到的是這個埠，才標按鈕 */
    const sel = PU().sel;
    return sel && sel.n === n && sel.p === p ? out.concat(last.filter(Boolean)) : out;
  };
  const devPath = (n, key) => { if (needPatch()) return toPatch; const d = S().devices[n]; return ['nav:rack', 'mode:patch', d && d.rack ? 'racktab:' + d.rack : null, key].filter(Boolean); };
  const openPort = (n, p) => () => { const V = G.Views.rack, d = S().devices[n]; V.mode = 'patch'; if (d && d.rack) V.rack = d.rack; if (p) PU().sel = { n, p }; G.UI.go('rack'); };
  /** 對話框開著時先標對話框裡的按鈕 */
  const dlg = () => (document.querySelector('[data-hint="confirm-ok"]') ? ['confirm-ok'] : document.querySelector('[data-hint="pp-plug-ok"]') ? ['pp-plug-ok'] : document.querySelector('[data-hint="pp-dlg-ok"]') ? ['pp-dlg-ok'] : null);
  /** 接一條新線：選起點 →「從這裡接一條新線」→ 點終點 → 對話框按「接上」 */
  const patchStep = (A, getB, text, done, lacp) => ({ text, short: '接一條新線', go: openPort(A.n, A.p),
    path: () => {
      const box = document.querySelector('[data-hint="pp-dlg-lacp"]');
      if (lacp && box && !box.checked && !box.disabled) return [{ k: 'pp-dlg-lacp', t: '勾選「設定 LACP」' }];
      const d = dlg();
      if (d) return d.map((k) => ({ k, t: '按「接上」' }));
      const B = getB();
      const f = PU().from;
      if (f && f.n === A.n && f.p === A.p && B) return portPath(B.n, B.p);
      if (f) return [{ k: 'pp-cancel', t: '先按「取消」放掉目前的起點' }];
      return portPath(A.n, A.p, { k: 'pp-from', t: '按「從這裡接一條新線」' });
    }, done });
  H['c9-mop'] = () => [{ text: '到「機房」切換到「實體接線」，在「割接計畫」卡片按「打開 MOP」', short: '打開 MOP', go: 'rack:patch', path: ['nav:rack', 'mode:patch', 'cut-mop'], done: () => !!S().cut && S().cut.mopRead }];
  H['c9-prep'] = () => {
    const c = S().cut;
    if (!c) return [];
    const n = S().devices[c.neu];
    const self = G.Phys.st().self.find((x) => x.node === c.neu);
    const lx = G.Phys.st().loose.find((x) => x.node === c.neu && x.tag === 'burnin');
    return [
      { text: `在新核心 ${n.name} 的面板右上角把 STP 切到「開」（原廠出貨預設關閉）`, short: '按「STP 開」', go: openPort(c.neu), path: devPath(c.neu, 'pp-stp-on:' + c.neu), done: () => n.stp !== false },
      self ? { text: `點 ${n.name} 上標著紅色「!」的燒機測試線（${pn(c.neu, self.ap)} ⇄ ${pn(c.neu, self.bp)}），按「拔掉這一端」`, short: '拔掉這一端', go: openPort(c.neu, self.ap), path: portPath(c.neu, self.ap, 'pp-unplug'), done: () => !G.Phys.st().self.some((x) => x.node === c.neu) } : null,
      lx || self ? { text: '測試線的另一端還插著：點那個埠，按「整條收掉」', short: '整條收掉', go: openPort(c.neu, lx ? lx.pid : self.bp), path: portPath(c.neu, lx ? lx.pid : self.bp, 'pp-remove'), done: () => G.Cut.prepOk() } : null,
    ];
  };
  H['c9-label'] = () => {
    const c = S().cut;
    if (!c) return [];
    return [{ text: `在舊核心 ${Q.nodeName(c.old)} 的面板右上角按「全部循線貼標籤」（窗口前做不花時間；窗口內每條要 6 分鐘）`, short: '全部循線貼標籤', go: openPort(c.old), path: devPath(c.old, 'pp-tagall:' + c.old), done: () => G.Cut.labelsOk() }];
  };
  H['c9-mods'] = () => {
    const c = S().cut;
    if (!c) return [];
    const rows = G.Cut.rows();
    const i = rows.findIndex((x) => !G.Cut.modOk(x));
    if (i < 0) return [];
    const r = rows[i];
    return [{ text: `MOP 第 ${i + 1} 條：點新核心的 ${pn(c.neu, r.newPid)}，插上 ${CAT.xcvr[r.mod].name}（和對端 ${Q.nodeName(r.far)} 同一種）`, short: `插上 ${CAT.xcvr[r.mod].name}`,
      go: openPort(c.neu, r.newPid), path: portPath(c.neu, r.newPid, { k: 'pp-mod-ok', t: `按「插上模組」（${CAT.xcvr[r.mod].name}）` }), done: () => G.Cut.modOk(r) }];
  };
  H['c9-lag'] = () => {
    const c = S().cut;
    if (!c || !c.peer || !S().devices[c.peer]) return [];
    const L = Q.linkBetween(c.neu, c.peer)[0];
    const ms = L ? L.members : [];
    const peerFree = () => { const p = G.Phys.free(c.peer, 'qsfp', 1)[0]; return p ? { n: c.peer, p } : null; };
    const out = [];
    const bad = ms.find((m) => G.Phys.mState(L, m).code === 'pol');
    if (bad) {
      const [n, p] = L.a === c.neu ? [L.a, bad.ap] : [L.b, bad.bp];
      out.push({ text: '新跳線不通：兩端都收不到光（極性接反）。點新核心這一端，按「翻轉極性」', short: '按「翻轉極性」', go: openPort(n, p), path: portPath(n, p, 'pp-flip'), done: () => G.Phys.mState(L, bad).code !== 'pol' });
      return out;
    }
    for (const q of ['q31', 'q32']) {
      if (G.Phys.at(c.neu, q)) continue;
      const second = ms.length >= 1;
      out.push(patchStep({ n: c.neu, p: q }, peerFree, `新核心 ${pn(c.neu, q)} ⇄ ${Q.nodeName(c.peer)} 的空 QSFP 埠：接一條 100G${second ? '，勾選「設定 LACP」' : ''}`, () => !!G.Phys.at(c.neu, q), second));
      return out;
    }
    if (L && !L.lacp) out.push({ text: '兩條互連還沒有 LACP：點其中一條，按「設定 LACP」', short: '按「設定 LACP」', go: openPort(c.neu, 'q31'), path: portPath(c.neu, L.a === c.neu ? ms[0].ap : ms[0].bp, 'pp-lacp'), done: () => !!L.lacp });
    return out;
  };
  H['c9-window'] = () => [{ text: '準備好了：在「割接計畫」卡片按「快轉到維護窗口」（凌晨 02:00 一到會自動暫停）', short: '快轉到維護窗口', go: 'rack:patch',
    path: () => (S().skipUntil ? [] : ['nav:rack', 'mode:patch', 'cut-skip']), wait: false, done: () => !!S().cut && S().time >= S().cut.win.start }];
  H['c9-move'] = () => {
    const c = S().cut;
    if (!c) return [];
    const r = G.CutUI.next();
    if (!r) return [];
    const i = c.rows.indexOf(r) + 1;
    const st = G.Cut.rowState(r);
    const far = `${Q.nodeName(r.far)} ${pn(r.far, r.farPid)}`;
    if (st.st === 'todo') return [{ text: `MOP 第 ${i} 條（${far}）：點舊核心的 ${pn(c.old, r.oldPid)}，按「拔掉這一端」`, short: '拔掉這一端', go: openPort(c.old, r.oldPid), path: portPath(c.old, r.oldPid, 'pp-unplug'), done: () => G.Cut.rowState(r).st !== 'todo' }];
    /* 新核心上的模組不對（或被拔掉了）：先換好模組，再插線 */
    const modFix = () => ({ text: `新核心 ${pn(c.neu, r.newPid)} 的模組不對（要 ${CAT.xcvr[r.mod].name}）：先換上正確的模組`, short: `插上 ${CAT.xcvr[r.mod].name}`, go: openPort(c.neu, r.newPid),
      path: portPath(c.neu, r.newPid, { k: 'pp-mod-ok', t: `按「插上模組」（${CAT.xcvr[r.mod].name}）` }), done: () => G.Phys.mod(c.neu, r.newPid) === r.mod });
    if ((st.st === 'moving' || st.st === 'gone') && r.mod && !G.Phys.at(c.neu, r.newPid) && G.Phys.mod(c.neu, r.newPid) !== r.mod && !dlg()) return [modFix()];
    if (st.st === 'moving') {
      const x = G.Phys.st().loose.find((y) => y.node === r.far && y.pid === r.farPid);
      if (x && PU().hold !== x.id && !dlg()) return [{ text: `拿起 ${far} 那條線懸空的一端`, short: '按「拿起」', go: 'rack:patch', path: ['nav:rack', 'mode:patch', 'pp-take:' + x.id], done: () => PU().hold === (x && x.id) || G.Cut.rowState(r).st !== 'moving' }];
      return [{ text: `把手上的線插到新核心的 ${pn(c.neu, r.newPid)}${r.short ? `（原本的跳線太短，會請你換一條 ${r.short} m 的新跳線）` : ''}`, short: '插到這個埠', go: openPort(c.neu, r.newPid),
        path: () => dlg() || portPath(c.neu, r.newPid), done: () => G.Cut.rowState(r).st !== 'moving' }];
    }
    if (st.st === 'gone') return [patchStep({ n: r.far, p: r.farPid }, () => ({ n: c.neu, p: r.newPid }), `${far} 沒有接線了：從這個埠接一條新跳線到新核心的 ${pn(c.neu, r.newPid)}`, () => G.Cut.rowState(r).st !== 'gone')];
    if (st.st === 'bad') {
      const o = G.Phys.at(r.far, r.farPid);
      const ms = o && o.t === 'm' ? G.Phys.mState(o.l, o.m) : null;
      const np = o && o.t === 'm' ? (o.end === 'a' ? o.m.bp : o.m.ap) : r.newPid;
      const again = () => G.Cut.rowState(r).st !== 'bad';
      if (ms && ms.code === 'pol') return [{ text: '插上去了，但兩端都收不到光（極性接反）：按「翻轉極性」', short: '按「翻轉極性」', go: openPort(c.neu, np), path: portPath(c.neu, np, 'pp-flip'), done: again }];
      /* 兩條線接同一台、沒有 LACP：只用一條（另一條待命或被 STP 擋下） */
      if (ms && (ms.code === 'stby' || ms.code === 'blk')) return [{ text: `${Q.nodeName(r.far)} 和新核心之間有兩條線、但沒有設定 LACP：按「設定 LACP」讓兩條一起轉送`, short: '按「設定 LACP」', go: openPort(c.neu, np), path: portPath(c.neu, np, 'pp-lacp'), done: again }];
      if (ms && np === r.newPid && (ms.code === 'vlan' || ms.code === 'shut')) {
        const rn = G.Phys.ROLES[r.role].name;
        return [{ text: `${pn(c.neu, np)} 的埠設定被改掉了：把「埠的設定」改回「${rn}」`, short: `改成「${rn}」`, go: openPort(c.neu, np), path: portPath(c.neu, np, 'pp-role'), done: again }];
      }
      if (ms && np === r.newPid && r.mod && G.Phys.mod(c.neu, np) !== r.mod) return [{ text: `${far} 還不通：${st.text}。新核心這一頭的模組不對：先拔線，換上 ${CAT.xcvr[r.mod].name}`, short: '拔掉這一端', go: openPort(c.neu, np), path: portPath(c.neu, np, 'pp-unplug'), done: again }];
      return [{ text: `${far} 還不通：${st.text}。拔掉，改插到 MOP 指定的 ${pn(c.neu, r.newPid)}`, short: '拔掉重插', go: openPort(c.neu, np), path: portPath(c.neu, np, 'pp-unplug'), done: again }];
    }
    if (st.st === 'other' && st.l) {
      const o = G.Phys.at(r.far, r.farPid);
      const [n, p] = o.end === 'a' ? [o.l.b, o.m.bp] : [o.l.a, o.m.ap];
      return [{ text: `${far} 接錯地方了（${st.text}）：拔掉重插`, short: '拔掉這一端', go: openPort(n, p), path: portPath(n, p, 'pp-unplug'), done: () => G.Cut.rowState(r).st !== 'other' }];
    }
    return [];
  };
  H['c9-verify'] = () => [look('到「監控」確認每層樓都上線、沒有中斷的服務，觀察 30 分鐘（可以開 5× 讓時間走）', 'noc', () => false)];
  H['c9-remove'] = () => {
    const c = S().cut;
    if (!c) return [];
    const old = S().devices[c.old];
    if (!old) return [];
    const pid = G.Phys.ports(c.old).find((p) => G.Phys.at(c.old, p));
    if (pid) return [{ text: `拔掉舊核心 ${pn(c.old, pid)} 上剩下的線（${G.Phys.farText(c.old, pid)}）`, short: '拔掉這一端', go: openPort(c.old, pid), path: portPath(c.old, pid, 'pp-unplug'), done: () => !G.Phys.at(c.old, pid) }];
    const lx = G.Phys.st().loose.find((x) => x.fromNode === c.old);
    if (lx) return [{ text: '另一端還插在別台設備上：點那個埠，按「整條收掉」', short: '整條收掉', go: openPort(lx.node, lx.pid), path: portPath(lx.node, lx.pid, 'pp-remove'), done: () => !G.Phys.st().loose.includes(lx) }];
    if (old.rack) return [{ text: `切回「機櫃」檢視，點舊核心 ${old.name}，按「下架」`, short: '按「下架」', go: () => { const V = G.Views.rack; V.mode = 'rack'; V.sel = c.old; V.rack = old.rack; G.UI.go('rack'); },
      path: () => (G.Views.rack.mode !== 'rack' ? ['nav:rack', { k: 'mode:rack', t: '切回「機櫃」' }] : ['nav:rack', 'racktab:' + old.rack, 'dev:' + c.old, 'uninstall:' + c.old]), done: () => !old.rack }];
    return [];
  };

  /* ---------- 第十章：晶圓廠（OT 網路、機台連網、無塵室保密） ---------- */
  /** OT 核心 = 接在防火牆「OT 生產網路」介面上的 L3 交換器；還沒接任何線的 L3 交換器可以拿來當 OT 核心 */
  const isOtCore = (d) => !!d && isCore(d) && Q.linksOf(d.id).some((l) => l.zone === 'ot');
  const otCand = (d) => isCore(d) && (isOtCore(d) || !Q.linksOf(d.id).length);
  const hasOtCore = () => devs().some((d) => d.rack && isOtCore(d));
  const zoneOf = (id) => { const z = G.Net.zones().get(id); return z ? z.zone : null; };
  const inOt = (r) => Q.roleServers(r).filter((d) => (d.rack || d.host) && G.Net.devUp(d) && zoneOf(d.id) === 'OT').length;
  const FAB = () => S().fab;
  const fabUp = () => Q.linksOf('F:FAB').filter((l) => isOtCore(S().devices[Q.other(l, 'F:FAB')])).length;
  /** 連到防火牆、而且介面要選對（對話框開著時先標介面的按鈕） */
  const linkZ = (text, getA, getB, zone, done) => {
    const st = link(text, getA, getB, done);
    const base = st.path;
    st.path = () => {
      const btn = document.querySelector(`[data-hint="zone:${zone}"]`);
      if (document.querySelector('[data-hint="link-ok"]') && btn && !btn.classList.contains('on')) return [{ k: 'zone:' + zone, t: `介面選「${G.UI.ZONE_NAMES[zone]}」` }];
      return base();
    };
    return st;
  };
  const fabUplink = (n) => ({ text: n > 1 ? '再拉第二條上行到 OT 核心：一條光纖斷了，無塵室也不會停線' : '把 FAB 上行到 OT 核心（不是總部的核心）：按「新增上行」→ 選標著「OT」的交換器 →「建立連線」（380 m 的校園光纖）',
    short: '上行到 OT 核心', go: 'floor:FAB', path: ['nav:floor', 'floor:FAB', 'uplink@FAB', { k: 'pick:otcore', t: '選標著「OT」的交換器' }, 'link-ok'], done: () => fabUp() >= n });
  const fabAp = { text: 'FAB 佈建 AP：按「自動規劃 AP」（機台與金屬壁板很擋訊號，每個 bay 都要有 AP）', short: '按「自動規劃 AP」', go: 'floor:FAB', path: ['nav:floor', 'floor:FAB', 'autoplan@FAB', 'autoplan-ok'],
    done: () => { const fs = S().floors.FAB; return fs.aps.length > 0 && G.Wifi.get('FAB', new Set(fs.aps.map((a) => a.id))).usable >= 0.9; } };
  const fabBuy = (k, text) => ({ text: `到「晶圓廠」建置${text}`, short: `建置${text}`, go: 'fab', path: ['nav:fab', 'fab-buy:' + k], done: () => FAB()[k] > 0 });

  H['c10-otcore'] = () => [
    buy('CX-6400', () => own(otCand), 'OT 核心：和總部的核心分開'),
    install('switch', () => inRack(otCand), 'OT 核心交換器'),
    linkZ('在「拓撲」把 OT 核心接到防火牆，防火牆介面選「OT 生產網路」', () => first((d) => otCand(d) && !isOtCore(d)) || first(isOtCore), () => first(catIs('firewall')), 'ot', hasOtCore),
  ];
  H['c10-fab'] = () => {
    const fs = () => S().floors.FAB;
    const steps = [
      { text: '到「樓層 → FAB」發包布線（無塵室只能由合格的廠商施工）', short: '按「發包施工」', go: 'floor:FAB', path: ['nav:floor', 'floor:FAB', 'cabling@FAB'], done: () => fs().cabling.status !== 'none' },
      { text: 'FAB 的 IDF：按「建議數量」再「套用」（光是機台就要 99 埠，AP 另外算）', short: '按「建議數量」再「套用」', go: 'floor:FAB', path: ['nav:floor', 'floor:FAB', 'idf-suggest@FAB', 'idf-apply@FAB'], done: () => portsOk('FAB') },
    ];
    if (!hasOtCore()) steps.push(...H['c10-otcore']());
    steps.push(fabUplink(1), fabUplink(2), fabAp,
      skip('等 FAB 的布線施工完成（可以按 ⏭ 快轉）', () => fs().cabling.status === 'done'),
      look('FAB 還接在總部的核心上（IT 和 OT 直接相連）：到「拓撲」刪掉那條上行，只留接到 OT 核心的', 'topo', () => zoneOf('F:FAB') === 'OT'),
      look('FAB 的 Wi-Fi 可用覆蓋還不夠 90%：在平面圖的「訊號」圖層找紅色、灰色的地方補 AP', 'floor:FAB', () => usableCov('FAB') >= 0.9));
    return steps;
  };
  H['c10-servers'] = () => {
    for (const [r, model, why, n] of [['mes', 'SV-2U', 'MES 要效能', 1], ['eap', 'SV-1U', '一台管 40 台機台，要兩台', 2], ['fdc', 'SV-2U', '感測資料量大', 1]]) {
      if (inOt(r) >= n) continue;
      if (!hasOtCore()) return H['c10-otcore']();
      /* 接到 OT 核心的（開機中的也算） */
      const onOt = () => Q.roleServers(r).filter((d) => d.rack && linkedTo(d, isOtCore)).length >= n;
      return serverRole(r, model, why, n, isOtCore).concat([
        look(`${CAT.roles[r].name}伺服器要接在 OT 核心上（OT 區）：接到總部核心的，到「拓撲」刪掉那條線、改接 OT 核心`, 'topo', () => inOt(r) >= n || onOt()),
        skip(`等 ${CAT.roles[r].name}伺服器開機（可以按 ⏭ 快轉）`, () => inOt(r) >= n)]);
    }
    return [];
  };
  H['c10-rules'] = () => [rule('LAN', 'OT', 'WEB'), rule('OT', 'SERVERS', 'SQL'),
    look('其他一律不開：LAN → OT 只留 WEB，刪掉 OT 連到網際網路、員工電腦（LAN），以及網際網路直接連進 OT 的規則', 'fw:rules',
      () => G.Sec.posture().otIsolated && !G.Sec.allowedSvcs('LAN', 'OT').some((x) => x !== 'WEB'))];
  H['c10-scan'] = () => [fabBuy('kiosk', '「機台進廠掃毒站」'), skip('等進廠掃毒站完工（可以按 ⏭ 快轉）', () => G.Fab.kioskReady()),
    { text: '有機台沒掃毒就接上網路了：在「晶圓廠」按「斷線重掃」', short: '按「斷線重掃」', go: 'fab', path: ['nav:fab', 'fab-rescan'], done: () => !G.Fab.counts().skipped }];
  H['c10-tools'] = () => {
    const F = FAB(), c = G.Fab.counts(), R = G.R.fab;
    if (!F.open) return [];
    const needEap = Math.ceil(F.tools.length / CAT.roles.eap.capTools);
    if (inOt('eap') < needEap) return serverRole('eap', 'SV-1U', `一台管 ${CAT.roles.eap.capTools} 台機台`, needEap, isOtCore);
    if (c.scan && !G.Fab.kioskReady()) return H['c10-scan']().slice(0, 2);
    const fs = S().floors.FAB;
    if ((c.ready || c.scan) && !(fs.cabling.status === 'done' && fs.idf.count > 0 && fabUp() > 0)) return H['c10-fab']();
    if (c.ready) return [{ text: `${c.ready} 台機台在等交換器埠：到「樓層 → FAB」按「建議數量」再「套用」`, short: '按「建議數量」再「套用」', go: 'floor:FAB', path: ['nav:floor', 'floor:FAB', 'idf-suggest@FAB', 'idf-apply@FAB'], done: () => !G.Fab.counts().ready }];
    if (R && R.online > R.auto) return [look('有機台連不上 EAP（只能人工操作）：EAP 要在 OT 區、接在 OT 核心上，到「晶圓廠」看 Purdue 圖哪一段是紅的', 'fab', () => { const x = G.R.fab; return !!x && x.auto >= x.online; })];
    return [skip('機台分三個工作天陸續進廠、裝機、掃毒（可以按 ⏭ 快轉）', () => { const x = G.R.fab; return !!x && x.total > 0 && x.auto >= x.total; })];
  };
  H['c10-phone'] = () => [fabBuy('gate', '「安檢門與手機置物櫃」'), skip('等安檢門與置物櫃完工（可以按 ⏭ 快轉）', () => G.Fab.gateReady()),
    { text: '在「晶圓廠」把私人手機改成「禁止（鎖在置物櫃）」', short: '按「禁止」', go: 'fab', path: ['nav:fab', 'fab-phone:ban'], done: () => FAB().phone === 'ban' },
    { text: `配發無相機的公司手持裝置：按「補到 ${G.Fab.handNeed()} 台」`, short: '補到建議數量', go: 'fab', path: ['nav:fab', 'fab-hand-fill'], done: () => FAB().hand >= G.Fab.handNeed() },
    fabAp, look('FAB 的 Wi-Fi 可用覆蓋還不夠 90%（手持裝置要連 Wi-Fi 才查得到 MES）：在平面圖的「訊號」圖層補 AP', 'floor:FAB', () => usableCov('FAB') >= 0.9)];
  H['c10-vendor'] = () => {
    const dmzSw = (o) => catIs('switch')(o) && !Q.isL3(o) && Q.linksOf(o.id).some((l) => l.zone === 'dmz');
    const out = [];
    if (!G.Sec.serverZones('jump').some((x) => x.zone === 'DMZ')) out.push(...serverRole('jump', 'SV-1U', '原廠遠端維護的唯一入口', 1, dmzSw),
      look('跳板機要接在 DMZ 交換器上（DMZ 區），不能在內網或 OT 裡', 'topo', () => G.Sec.serverZones('jump').some((x) => x.zone === 'DMZ')));
    return out.concat([rule('DMZ', 'OT', 'RDP'), svc('mfa'),
      look('刪掉網際網路直接連進 OT 的規則（INTERNET → OT）：原廠只能經過跳板機', 'fw:rules', () => !G.Sec.allowedSvcs('INTERNET', 'OT').length)]);
  };
  H['c10-output'] = () => [...diagnose(), look('到「晶圓廠」看產能的瓶頸：每一區的機台都要自動化，MES、ERP、FDC 都要連得上', 'fab', () => false)];

  /* ---------- 沙盒：依序檢查基本建設，再來是快要進駐的樓層，最後是緊急報修 ---------- */
  H.__sandbox = (s) => {
    const out = [];
    if (!s.racks.length) out.push(...H['c1-rack']());
    if (!s.isp.length) out.push({ text: '到「採購 → ISP 專線」申請 10G 專線（開通要十幾個小時，要先申請！）', short: '申請 10G 專線', go: 'shop:isp', path: ['nav:shop', 'tab:shop:isp', 'isp:10G'], done: () => S().isp.length > 0 });
    out.push(buy('NR-5500', () => own(catIs('router'))), install('router', () => inRack(catIs('router')), '路由器'));
    out.push(buy('SG-3000', () => own(catIs('firewall'))), install('firewall', () => inRack(catIs('firewall')), '防火牆'));
    out.push(buy('CX-6400', () => own(isCore)), install('switch', () => inRack(isCore), '核心交換器'));
    out.push(...H['c1-wire'](), ...ispSteps(), ...serverRole('ad', 'SV-1U'), rule('LAN', 'INTERNET', 'WEB'), rule('LAN', 'INTERNET', 'DNS'));
    const soon = G.BLD.floors.filter((f) => s.floors[f.id].moveInAt !== null && !G.Net.floorUp(f.id)).sort((a, b) => s.floors[a.id].moveInAt - s.floors[b.id].moveInAt);
    for (const f of soon.slice(0, 2)) out.push(...(G.BLD.isFab(f.id) ? H['c10-fab']() : floorSteps(f.id, 0.85)));
    /* 晶圓廠開廠之後：OT 核心、MES / EAP / FDC、進廠掃毒站 */
    if (s.fab && s.fab.open) out.push(...H['c10-otcore'](), ...H['c10-servers'](), H['c10-scan']()[0]);
    out.push(...diagnose());
    return out;
  };
})(window.G = window.G || {});
