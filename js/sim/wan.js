/* 廣域網路：分支據點的專線（MPLS、IPLC、企業寬頻 + VPN、4G/5G 備援）、SD-WAN、總部 MPLS 匯接、
 * 雲端（Direct Connect）。據點的流量真的跑在模擬的路由圖上：
 *   MPLS / IPLC → 總部路由器 → 防火牆（WAN 區域）→ 核心 → 伺服器
 *   網際網路隧道（VPN / SD-WAN）→ 據點寬頻 + 總部 ISP 線路 → 防火牆 / SD-WAN 集中器 → 伺服器
 *   SD-WAN 的本地出口（DIA）→ 據點寬頻直接上網
 * 沒有 SD-WAN 的據點：主線路斷了，要等路由收斂（約 5 分鐘）才切到 VPN 備援；SD-WAN 則是瞬間切換、依應用程式選路。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Wan = {};
  G.Wan = Wan;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = () => G.bus.emit('change', { what: 'wan' });
  const need = (n) => err(`預算不足：需要 ${U.money(n)}，目前只有 ${U.money(G.S.money)}`);
  const TZ = { tc: 0, ks: 0, vn: -1, jp: 1 };

  Wan.newState = () => {
    const sites = {};
    for (const id of G.SITE_IDS) sites[id] = { openAt: null, links: [], sdwan: false, vpn: false, path: null, switchAt: 0 };
    return { sites, hq: { mpls: 0, next: 0, at: 0, out: false }, dx: { bw: 0, next: 0, at: 0, out: false } };
  };
  Wan.site = (id) => G.S.wan.sites[id];
  Wan.open = (id) => { const w = Wan.site(id); return !!w && w.openAt !== null && G.S.time >= w.openAt; };
  Wan.openIds = () => G.SITE_IDS.filter(Wan.open);
  Wan.linkUp = (c) => c.status === 'active' && !c.outage;
  Wan.has = (id, type) => Wan.site(id).links.find((l) => l.type === type && Wan.linkUp(l));
  /** 據點的網際網路：寬頻優先，斷了才用 4G / 5G */
  Wan.underlay = (id) => {
    const L = Wan.site(id).links.filter((l) => (l.type === 'inet' || l.type === 'lte') && Wan.linkUp(l));
    return L.sort((a, b) => (a.type === 'inet' ? 0 : 1) - (b.type === 'inet' ? 0 : 1) || b.bw - a.bw)[0] || null;
  };
  Wan.presence = (id, t) => {
    const st = G.SITES[id], lt = t + (TZ[id] || 0) * 60;
    const h = U.hourOf(lt), wk = U.isWeekend(lt);
    if (st.kind === 'factory') return (h >= 7.5 && h < 19.5 ? 0.85 : 0.45) * (wk ? 0.55 : 1);
    return G.Net.presence(lt, 'office');
  };
  Wan.localClock = (id, t) => U.clock(t + (TZ[id] || 0) * 60);
  Wan.routers = () => Q.devices('router').filter((d) => d.rack).sort((a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10));
  Wan.hubs = () => Q.roleServers('sdwan').filter((d) => d.rack);

  /* ---------- 申請 / 取消 ---------- */
  Wan.order = (siteId, type, bw) => {
    const s = G.S, st = G.SITES[siteId], w = Wan.site(siteId), T = CAT.wan.types[type];
    if (!Q.unlocked(CAT.wan)) return err(`第 ${CAT.wan.unlock} 章解鎖`);
    if (!st || !T || !T.bws.includes(bw)) return err('方案錯誤');
    if (T.intlOnly && !st.intl) return err('IPLC 是國際專線：國內據點用 MPLS 就好');
    if (w.links.some((l) => l.type === type)) return err(`${st.name} 已經有${T.name}了（可以先終止再換頻寬）`);
    if (!G.Act.spend(T.setup, `${st.name} ${T.short} ${bw}M 開通費`)) return need(T.setup);
    w.links.push({ id: Q.nextId('w'), type, bw, status: 'pending', readyAt: s.time + T.lead, outage: false });
    changed();
    return ok(`已向電信業者申請 ${st.name} ${T.short} ${U.speed(bw)}，約 ${U.dur(T.lead)} 後開通`);
  };
  Wan.cancel = (siteId, linkId) => {
    const w = Wan.site(siteId), i = w.links.findIndex((l) => l.id === linkId);
    if (i < 0) return err('找不到線路');
    const l = w.links[i];
    w.links.splice(i, 1);
    changed();
    return ok(`已終止 ${G.SITES[siteId].name} 的 ${CAT.wan.types[l.type].short}`);
  };
  Wan.setSdwan = (siteId, on) => {
    if (on && !Q.unlocked(CAT.wan)) return err(`第 ${CAT.wan.unlock} 章解鎖`);
    Wan.site(siteId).sdwan = !!on;
    changed();
    return ok(on ? `${G.SITES[siteId].name} 啟用 SD-WAN（每月 ${U.money(CAT.wan.sdwan.perSite)}）：需要總部的 SD-WAN 集中器與據點的網際網路` : `${G.SITES[siteId].name} 停用 SD-WAN`);
  };
  Wan.setVpn = (siteId, on) => { Wan.site(siteId).vpn = !!on; changed(); return ok(on ? `${G.SITES[siteId].name} 設定 IPsec VPN：經網際網路連回總部防火牆（主線路的備援）` : 'VPN 已移除'); };
  Wan.orderHq = (bw) => {
    const s = G.S, hq = s.wan.hq, P = CAT.wan.hqMpls;
    if (!Q.unlocked(CAT.wan)) return err(`第 ${CAT.wan.unlock} 章解鎖`);
    if (!P.bws.includes(bw)) return err('方案錯誤');
    if (!G.Act.spend(P.setup, `總部 MPLS 匯接 ${U.speed(bw)} 開通費`)) return need(P.setup);
    hq.next = bw; hq.at = s.time + (hq.mpls ? 60 : P.lead);
    changed();
    return ok(hq.mpls ? `總部 MPLS 匯接調整為 ${U.speed(bw)}，約 1 小時後生效` : `已申請總部 MPLS 匯接 ${U.speed(bw)}，約 ${U.dur(P.lead)} 後開通（接在總部的邊界路由器）`);
  };
  Wan.cancelHq = () => { const hq = G.S.wan.hq; hq.mpls = 0; hq.next = 0; changed(); return ok('已終止總部 MPLS 匯接'); };
  Wan.orderDx = (bw) => {
    const s = G.S, dx = s.wan.dx, P = CAT.wan.dx;
    if (!Q.unlocked(CAT.wan)) return err(`第 ${CAT.wan.unlock} 章解鎖`);
    if (!P.bws.includes(bw)) return err('方案錯誤');
    if (!G.Act.spend(P.setup, `雲端專線 Direct Connect ${U.speed(bw)} 開通費`)) return need(P.setup);
    dx.next = bw; dx.at = s.time + (dx.bw ? 60 : P.lead);
    changed();
    return ok(`已申請雲端專線 ${U.speed(bw)}，約 ${U.dur(dx.at - s.time)} 後開通`);
  };
  Wan.cancelDx = () => { const dx = G.S.wan.dx; dx.bw = 0; dx.next = 0; changed(); return ok('已終止雲端專線'); };

  Wan.monthly = () => {
    const s = G.S;
    if (!s.wan) return 0;
    let m = 0;
    for (const id of G.SITE_IDS) {
      const st = G.SITES[id], w = s.wan.sites[id];
      for (const l of w.links) m += CAT.wan.price(l.type, l.bw, st.intl);
      if (w.sdwan) m += CAT.wan.sdwan.perSite;
    }
    if (s.wan.hq.mpls) m += s.wan.hq.mpls * CAT.wan.hqMpls.perMbps;
    if (s.wan.dx.bw) m += CAT.wan.dx.monthly[s.wan.dx.bw];
    return m;
  };

  /* ---------- 每分鐘：開通、據點啟用 ---------- */
  Wan.tick = () => {
    const s = G.S, t = s.time;
    for (const id of G.SITE_IDS) {
      const st = G.SITES[id], w = s.wan.sites[id];
      if (w.openAt !== null && t === w.openAt) {
        G.Act.log(`${st.name}（${st.staff} 人）開始營運，要連回總部的 ERP、檔案與 AD`, 'info');
        G.bus.emit('notice', { kind: 'info', text: `${st.name} 開始營運`, goto: 'wan' });
      }
      for (const l of w.links) {
        if (l.status === 'pending' && t >= l.readyAt) {
          l.status = 'active';
          G.Act.log(`${st.name} ${CAT.wan.types[l.type].short} ${U.speed(l.bw)} 開通`, 'good');
          G.bus.emit('notice', { kind: 'good', text: `${st.name} ${CAT.wan.types[l.type].short} 開通`, goto: 'wan' });
          G.R.topoVer++;
        }
      }
    }
    for (const [k, nm] of [['hq', '總部 MPLS 匯接'], ['dx', '雲端專線 Direct Connect']]) {
      const x = s.wan[k];
      if (x.next && t >= x.at) {
        if (k === 'hq') x.mpls = x.next; else x.bw = x.next;
        x.next = 0;
        G.Act.log(`${nm} ${U.speed(k === 'hq' ? x.mpls : x.bw)} 開通`, 'good');
        G.bus.emit('notice', { kind: 'good', text: `${nm} 開通`, goto: 'wan' });
        G.R.topoVer++;
      }
    }
  };

  /* ---------- 路由圖：據點、MPLS 骨幹、公有雲 ---------- */
  Wan.graph = (g, add, edge) => {
    const s = G.S;
    if (!s.wan) return;
    const router = Wan.routers().map((d) => d.id).find((id) => g.nodes.has(id)) || null;
    g.hqRouter = router;
    const hq = s.wan.hq;
    const mplsHub = !!router && hq.mpls > 0 && !hq.out;
    if (mplsHub) { add('WAN:mpls', { kind: 'wan', transit: true }); edge('WAN:mpls', router, 'wan:hq', hq.mpls, 1); }
    for (const id of G.SITE_IDS) {
      if (!Wan.open(id)) continue;
      const st = G.SITES[id], n = 'S:' + id;
      add(n, { kind: 'site', transit: false, site: id });
      const mp = Wan.has(id, 'mpls'), ip = Wan.has(id, 'iplc'), un = Wan.underlay(id);
      if (mp && mplsHub) edge(n, 'WAN:mpls', `wan:${id}:mpls`, mp.bw, st.lat.mpls);
      if (ip && router) edge(n, router, `wan:${id}:iplc`, ip.bw, st.lat.iplc);
      if (un) edge(n, 'INET', `wan:${id}:inet`, un.bw, un.type === 'lte' ? st.lat.lte : st.lat.inet);
    }
    add('CLOUD', { kind: 'cloud', transit: false });
    edge('INET', 'CLOUD', 'wan:cloud', 1e6, 3);
    const dx = s.wan.dx;
    if (router && dx.bw > 0 && !dx.out) edge('CLOUD', router, 'wan:dx', dx.bw, 1.5);
  };

  /** 每個據點、每類應用走哪條路 */
  Wan.plan = (id, g) => {
    const s = G.S, w = Wan.site(id);
    const mpls = g.edges.has(`wan:${id}:mpls`), iplc = g.edges.has(`wan:${id}:iplc`), und = g.edges.has(`wan:${id}:inet`);
    const hub = Wan.hubs().map((d) => d.id).find((x) => g.nodes.has(x)) || null;
    const fw = Array.from(g.nodes.values()).find((n) => n.kind === 'firewall');
    const P = { router: g.hqRouter, fw: fw ? fw.dev.id : null, hub, sd: !!(w.sdwan && hub && und), mpls, iplc, und };
    if (w.sdwan && hub) {
      /* SD-WAN：延遲敏感（ERP、語音、AD）走延遲最低的；大檔案走便宜的網際網路；上網就近從據點出去 */
      const best = [iplc && 'iplc', mpls && 'mpls', und && 'tun'].filter(Boolean);
      P.erp = P.ad = P.voice = best[0] || null;
      P.file = und ? 'tun' : best[0] || null;
      P.inet = und ? 'dia' : best[0] || null;
      w.path = P.erp; w.switchAt = 0;
      return P;
    }
    /* 傳統：專線優先；有設定 VPN 才能改走網際網路。主線路斷了要等路由收斂 */
    const vpn = w.vpn && und && !!P.fw;
    const want = mpls ? 'mpls' : iplc ? 'iplc' : vpn ? 'tun' : null;
    if (want !== w.path) {
      if (!w.path) { w.path = want; w.switchAt = 0; }
      else if (!w.switchAt) w.switchAt = s.time + 5;
      else if (s.time >= w.switchAt) { w.path = want; w.switchAt = 0; }
    } else w.switchAt = 0;
    const cur = w.path === 'mpls' ? mpls : w.path === 'iplc' ? iplc : w.path === 'tun' ? vpn : false;
    const p = cur ? w.path : null;
    P.erp = P.ad = P.voice = P.file = p;
    /* 上網：傳統架構拉回總部再出去（backhaul）；完全沒有路回總部、但有寬頻時，至少還能直接上網 */
    P.inet = p || (und ? 'dia' : null);
    P.converging = !!w.switchAt;
    return P;
  };

  /** 依路徑建立流量（MPLS / IPLC 一條；網際網路隧道 = 據點寬頻 + 總部入口兩條） */
  function build(id, P, path, base, dst) {
    const n = 'S:' + id, fs = [];
    const back = dst === 'INET';
    if (path === 'dia') fs.push(Object.assign({}, base, { id: base.id, src: n, dst: 'INET', svc: [], zs: null, inetPath: true }));
    else if (path === 'mpls') fs.push(Object.assign({}, base, { src: n, dst, vias: back ? ['WAN:mpls', P.fw].filter(Boolean) : ['WAN:mpls'] }));
    else if (path === 'iplc') fs.push(Object.assign({}, base, { src: n, dst, vias: back ? [P.router, P.fw].filter(Boolean) : [P.router] }));
    else if (path === 'tun') {
      fs.push(Object.assign({}, base, { id: base.id + ':u', src: n, dst: 'INET', svc: [], zs: null, inetPath: true, underlay: true }));
      const hop = P.sd ? P.hub : back ? P.fw : null;
      fs.push(Object.assign({}, base, { src: 'INET', dst, vias: hop ? [hop] : undefined }));
    }
    return fs;
  }

  /** Net.simulate 路由之前：各據點的流量 */
  Wan.flows = (g, flows, t) => {
    const s = G.S, ctx = { sites: {} };
    G.R.wanPlans = {};
    if (!s.wan) return ctx;
    const saas = Q.hasService('m365') ? 1 : 0;
    for (const id of Wan.openIds()) {
      const st = G.SITES[id], n = 'S:' + id;
      const pres = st.staff * Wan.presence(id, t);
      const rec = { pres, cls: {}, P: null };
      ctx.sites[id] = rec;
      if (!g.nodes.has(n)) continue;
      const P = Wan.plan(id, g);
      rec.P = P;
      G.R.wanPlans[id] = P;
      const CL = [
        { k: 'erp', dst: 'ROLE:db', svc: ['SQL'], v: st.erp * pres },
        { k: 'file', dst: 'ROLE:file', svc: ['SMB'], v: st.file * pres * (saas ? 0.7 : 1) },
        { k: 'ad', dst: 'ROLE:ad', svc: ['LDAP', 'DNS'], v: 0.012 * pres },
        { k: 'inet', dst: 'INET', svc: ['WEB'], v: (st.inet + 0.25 * saas) * pres },
      ];
      for (const c of CL) {
        if (c.v < 0.05) continue;
        const path = P[c.k];
        if (!path) { rec.cls[c.k] = { path: null, flows: [] }; continue; }
        const base = { id: `wan:${id}:${c.k}`, stage: 2, kind: 'wan', site: id, cls: c.k, fwd: c.v * 0.3, rev: c.v * 0.7, zs: 'WAN', zd: c.dst === 'INET' ? 'INTERNET' : null, svc: c.svc };
        const fs = build(id, P, path, base, c.dst);
        for (const f of fs) flows.push(f);
        rec.cls[c.k] = { path, flows: fs };
      }
    }
    return ctx;
  };

  /** 據點的分機也註冊到總部的電話交換機（Voice.flows 呼叫） */
  Wan.voiceFlows = (g, flows, vctx, kb) => {
    vctx.sites = {};
    if (!G.S.wan) return;
    for (const id of Wan.openIds()) {
      const P = G.R.wanPlans && G.R.wanPlans[id];
      if (!P || !P.voice || !g.nodes.has('ROLE:pbx')) continue;
      const st = G.SITES[id];
      const calls = st.staff * Wan.presence(id, G.S.time) * st.calls;
      if (calls < 0.2) continue;
      vctx.total += calls; vctx.ext += calls * 0.5;
      const base = { id: `wan:${id}:voice`, stage: 1, kind: 'voice', site: id, fwd: calls * kb, rev: calls * kb, zs: 'WAN', zd: null, svc: ['SIP'], prio: true, calls };
      const fs = build(id, P, P.voice, base, 'ROLE:pbx');
      for (const f of fs) { f.prio = true; flows.push(f); }
      vctx.sites[id] = { calls, flows: fs, path: P.voice };
    }
  };

  /** 網際網路的品質：據點的基本掉包率，晚上國際線更塞；SD-WAN 的前向錯誤更正（FEC）能補回大部分 */
  Wan.inetLoss = (id, t, sd) => {
    const st = G.SITES[id], lt = t + (TZ[id] || 0) * 60, h = U.hourOf(lt);
    let l = st.loss;
    if (st.eve && h >= 19 && h < 23.5) l *= 3.2;
    const mods = G.R.mods || {};
    if (st.intl && mods.cableCut) l += 0.05;
    return l * (sd ? 0.3 : 1);
  };

  /** 路由之後：各據點、各應用的送達率、延遲 → 據點滿意度；線路使用率 */
  Wan.measure = (ctx, t, loadOf, g) => {
    const s = G.S, R = { sites: {}, links: {} };
    G.R.satEma = G.R.satEma || {};
    const V = G.R.voice && G.R.voice.sites ? G.R.voice.sites : {};
    for (const id of G.SITE_IDS) {
      const st = G.SITES[id];
      if (!Wan.open(id)) { R.sites[id] = { open: false }; continue; }
      const rec = ctx.sites[id] || { pres: st.staff * Wan.presence(id, t), cls: {} };
      const P = rec.P || {};
      const out = { open: true, pres: rec.pres, cls: {}, sd: !!P.sd, path: s.wan.sites[id].path, converging: !!P.converging };
      let up = false;
      const W = st.kind === 'factory' ? { erp: 0.5, file: 0.1, ad: 0.1, inet: 0.3 } : { erp: 0.25, file: 0.2, ad: 0.1, inet: 0.45 };
      let q = 0;
      for (const k of ['erp', 'file', 'ad', 'inet']) {
        const c = rec.cls[k];
        let ratio = 0, rtt = 0, blocked = null;
        if (c && c.flows.length) {
          ratio = 1;
          for (const f of c.flows) {
            if (f.blocked) { blocked = f.blocked; ratio = 0; break; }
            const off = f.fwd + f.rev;
            ratio = Math.min(ratio, off > 0 ? (f.dFwd + f.dRev) / off : 1);
            rtt += f.rtt || 0;
          }
          if (!blocked && c.flows.some((f) => f.inetPath)) ratio *= 1 - Math.min(0.6, Wan.inetLoss(id, t, P.sd) * 4);
          if (ratio > 0.05) up = true;
        }
        out.cls[k] = { path: c ? c.path : null, ratio, rtt, blocked };
        q += W[k] * (0.1 + 0.9 * Math.pow(U.clamp(ratio, 0, 1), 1.3)) * (c && c.path ? 1 : 0.1);
      }
      const erp = out.cls.erp;
      if (erp.path && erp.rtt > 100) q *= Math.max(0.55, 1 - (erp.rtt - 100) / 320);
      if (st.kind === 'factory' && erp.ratio < 0.5) { q *= 0.6; out.lineStop = true; }
      const v = V[id];
      if (v && v.mos !== null && v.mos !== undefined) { out.mos = v.mos; q *= U.clamp((v.mos - 2.4) / 1.6, 0.85, 1); }
      q = U.clamp(q, 0, 1);
      const key = 'S:' + id, prev = G.R.satEma[key];
      const sat = rec.pres < 3 ? (prev === undefined ? null : prev) : prev === undefined || prev === null ? q : prev + (q - prev) * 0.18;
      if (rec.pres >= 3) G.R.satEma[key] = sat;
      Object.assign(out, { up, sat, erpRtt: erp.rtt });
      R.sites[id] = out;
    }
    /* 線路使用率（兩個方向取大的） */
    if (g) {
      for (const [k, e] of g.edges) {
        if (!k.startsWith('wan:')) continue;
        const ab = loadOf(k + '>' + e.b), ba = loadOf(k + '>' + e.a);
        R.links[k] = { ab, ba, cap: e.cap, util: e.cap > 0 && isFinite(e.cap) ? Math.max(ab, ba) / e.cap : 0 };
      }
    }
    G.R.wan = R;
    return R;
  };
})(window.G = window.G || {});
