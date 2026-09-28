/* 網路模擬核心
 * 1. 以「目前運作中的設備與線路」建立路由圖（防火牆 HA 只算主要那台、單 WAN 路由器只用一條 ISP）
 * 2. 產生流量需求：各樓層上網 / 內部服務、官網、備份、攻擊流量
 * 3. 以最短路徑 + ECMP 平均分流，累加每條線路「每個方向」的負載
 * 4. 超過容量的線路 / 設備依比例限縮，算出實際吞吐、延遲、封包遺失
 * 5. 算出各樓層使用者滿意度
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Net = {};
  G.Net = Net;

  /* ---------- 節點狀態 ---------- */
  Net.devUp = (d) => {
    const s = G.S;
    if (!d || !d.rack || d.status !== 'ok') return false;
    if (s.time < (d.bootUntil || 0)) return false;
    const fac = G.R.fac;
    if (fac && Net.rackDown(d.rack)) return false;
    return true;
  };
  /** 機櫃斷電：一般機櫃看機房供電與 PDU，AI 機櫃看電源櫃與 BBU */
  Net.rackDown = (rackId) => {
    const fac = G.R.fac;
    if (!fac) return false;
    return fac.rackDown ? !!fac.rackDown[rackId] : (!fac.mdfPowered || !!fac.rackTripped[rackId]);
  };
  Net.floorUp = (fid) => {
    const fs = G.S.floors[fid];
    if (fs.cabling.status !== 'done' || fs.idf.count <= 0) return false;
    if (G.S.time < (fs.idf.bootUntil || 0)) return false;
    const fac = G.R.fac;
    if (fac && fac.idfPowered && fac.idfPowered[fid] === false) return false;
    const mods = G.R.mods;
    if (mods && mods.floorOff && mods.floorOff[fid]) return false;
    return true;
  };
  Net.ispUp = (c) => c.status === 'active' && !c.outage && !!c.router;
  Net.linkBuilding = (l) => G.S.time < (l.readyAt || 0);
  Net.nodeUp = (id) => {
    if (id === 'INET') return true;
    if (id.startsWith('isp:')) { const c = G.S.isp.find((x) => 'isp:' + x.id === id); return !!c && Net.ispUp(c); }
    if (id.startsWith('F:')) return Net.floorUp(id.slice(2));
    return Net.devUp(G.S.devices[id]);
  };
  Net.linkUp = (l) => l.status === 'up' && !Net.linkBuilding(l) && Net.nodeUp(l.a) && Net.nodeUp(l.b);

  const idNum = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

  /* ---------- 路由圖 ---------- */
  function buildGraph() {
    const s = G.S;
    const nodes = new Map(), adj = new Map(), edges = new Map();
    const add = (id, info) => { nodes.set(id, info); adj.set(id, []); };
    const edge = (a, b, key, cap, lat, link) => {
      edges.set(key, { key, a, b, cap, lat, link });
      adj.get(a).push({ to: b, key, fwd: key + '>' + b, rev: key + '>' + a });
      adj.get(b).push({ to: a, key, fwd: key + '>' + a, rev: key + '>' + b });
    };
    add('INET', { kind: 'internet', transit: false });
    for (const d of Object.values(s.devices)) {
      const m = CAT.devices[d.model];
      if (CAT.infra(m) || !Net.devUp(d)) continue;
      add(d.id, { kind: m.cat, transit: m.cat === 'router' || m.cat === 'firewall' || m.cat === 'switch', dev: d, m });
    }
    /* 防火牆 HA：兩台以線路互連 → 編號小的為 Active，另一台 Standby 不參與轉送 */
    const standby = new Set();
    for (const l of Object.values(s.links)) {
      if (Q.nodeKind(l.a) !== 'firewall' || Q.nodeKind(l.b) !== 'firewall') continue;
      if (l.status !== 'up' || Net.linkBuilding(l)) continue;
      if (nodes.has(l.a) && nodes.has(l.b)) standby.add(idNum(l.a) < idNum(l.b) ? l.b : l.a);
    }
    for (const id of standby) { nodes.delete(id); adj.delete(id); }
    for (const f of G.BLD.floors) if (Net.floorUp(f.id)) add('F:' + f.id, { kind: 'floor', transit: false, fid: f.id });
    /* ISP：主備援 (failover) 路由器同時只用一條 */
    const usedFailover = {};
    const isps = s.isp.slice().sort((a, b) => idNum(a.id) - idNum(b.id));
    for (const c of isps) {
      if (!Net.ispUp(c) || !nodes.has(c.router)) continue;
      const rm = nodes.get(c.router).m;
      if (rm.multiWan === 'failover') { if (usedFailover[c.router]) continue; usedFailover[c.router] = true; }
      const id = 'isp:' + c.id;
      add(id, { kind: 'isp', transit: true, c });
      edge('INET', id, id + '#wan', c.bw, CAT.isp.latency);
      edge(id, c.router, id + '#h', c.bw <= 1000 ? 1000 : 10000, 0.05);
    }
    for (const l of Object.values(s.links)) {
      if (l.status !== 'up' || Net.linkBuilding(l)) continue;
      if (!nodes.has(l.a) || !nodes.has(l.b)) continue;
      edge(l.a, l.b, l.id, l.speed * l.count, 0.05, l);
    }
    for (const role of Object.keys(CAT.roles)) {
      const srv = [];
      for (const n of nodes.values()) if (n.kind === 'server' && n.dev.role === role && !n.dev.encrypted) srv.push(n.dev.id);
      if (!srv.length) continue;
      add('ROLE:' + role, { kind: 'role', transit: false, role });
      for (const id of srv) edge(id, 'ROLE:' + role, 'r:' + id, Infinity, 0);
    }
    return { nodes, adj, edges, standby };
  }
  Net.buildGraph = buildGraph;

  function canStep(g, to, dst, role) {
    if (to === dst) return true;
    const info = g.nodes.get(to);
    return info.transit || (!!role && info.kind === 'server' && info.dev.role === role);
  }
  function distTo(g, dst) {
    let d = G.R.distCache.get(dst);
    if (d) return d;
    d = new Map([[dst, 0]]);
    const q = [dst];
    const role = dst.startsWith('ROLE:') ? dst.slice(5) : null;
    for (let i = 0; i < q.length; i++) {
      const n = q[i];
      if (n !== dst && !canStep(g, n, dst, role)) continue;
      const dn = d.get(n);
      for (const e of g.adj.get(n)) if (!d.has(e.to)) { d.set(e.to, dn + 1); q.push(e.to); }
    }
    G.R.distCache.set(dst, d);
    return d;
  }
  /** src → dst 的所有等價最短路徑（ECMP），每條附帶分流比例 frac */
  function pathsBetween(g, src, dst) {
    const key = src + '>' + dst;
    if (G.R.pathCache.has(key)) return G.R.pathCache.get(key);
    let res = null;
    if (g.nodes.has(src) && g.nodes.has(dst) && src !== dst) {
      const dist = distTo(g, dst);
      if (dist.has(src)) {
        res = [];
        const role = dst.startsWith('ROLE:') ? dst.slice(5) : null;
        const walk = (n, frac, es, ns) => {
          if (n === dst) { res.push({ frac, edges: es, nodes: ns }); return; }
          if (res.length >= 32 || ns.length > 24) return;
          const dn = dist.get(n);
          const next = [];
          for (const e of g.adj.get(n)) if (dist.get(e.to) === dn - 1 && canStep(g, e.to, dst, role)) next.push(e);
          /* 依鏈路容量加權分流（例如 1G + 10G 兩條 ISP 以 1:10 分擔） */
          const caps = next.map((e) => { const c = g.edges.get(e.key).cap; return isFinite(c) ? c : 1e9; });
          const tot = caps.reduce((a, b) => a + b, 0) || 1;
          next.forEach((e, i) => walk(e.to, frac * caps[i] / tot, es.concat([e]), ns.concat([e.to])));
        };
        walk(src, 1, [], [src]);
        if (!res.length) res = null;
        else {
          const tot = res.reduce((a, p) => a + p.frac, 0);
          for (const p of res) {
            p.frac /= tot;
            p.fws = p.nodes.filter((n) => g.nodes.get(n).kind === 'firewall');
          }
        }
      }
    }
    G.R.pathCache.set(key, res);
    return res;
  }
  Net.paths = (src, dst) => (G.R.graph ? pathsBetween(G.R.graph, src, dst) : null);

  /* ---------- 安全區域（依實體連線判定，與設備是否開機無關） ---------- */
  Net.zones = () => {
    if (G.R.zonesVer === G.R.topoVer && G.R.zonesCache) return G.R.zonesCache;
    const s = G.S;
    const adj = new Map();
    const push = (a, b, l) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({ to: b, l }); };
    for (const l of Object.values(s.links)) { push(l.a, l.b, l); push(l.b, l.a, l); }
    const hasFw = Q.devices('firewall').some((d) => d.rack);
    const res = new Map();
    const eps = [];
    for (const f of G.BLD.floors) eps.push('F:' + f.id);
    for (const d of Object.values(s.devices)) { const c = CAT.devices[d.model].cat; if (c === 'server' || c === 'wlc') eps.push(d.id); }
    for (const ep of eps) {
      const seen = new Set([ep]);
      const q = [ep];
      const fz = new Set();
      let router = false;
      while (q.length) {
        const n = q.shift();
        for (const { to, l } of adj.get(n) || []) {
          const k = Q.nodeKind(to);
          if (k === 'firewall') { fz.add(l.zone || 'inside'); continue; }
          if (k === 'router') { router = true; continue; }
          if (k === 'switch' && !seen.has(to)) { seen.add(to); q.push(to); }
        }
      }
      const isFloor = ep.startsWith('F:');
      let zone;
      if (fz.has('dmz') && fz.has('inside')) zone = 'BRIDGED';
      else if (fz.has('dmz')) zone = router ? 'BYPASS' : 'DMZ';
      else if (fz.has('inside')) zone = router ? 'BYPASS' : (isFloor ? 'LAN' : 'SERVERS');
      else if (fz.has('outside')) zone = 'EXPOSED';
      else if (router) zone = hasFw ? 'EXPOSED' : (isFloor ? 'LAN' : 'SERVERS');
      else zone = 'ISOLATED';
      res.set(ep, { zone, router, fz: Array.from(fz), linked: (adj.get(ep) || []).length > 0 });
    }
    G.R.zonesCache = res;
    G.R.zonesVer = G.R.topoVer;
    return res;
  };
  /** 防火牆規則使用的區域名稱 */
  Net.ruleZone = (nodeId) => {
    if (nodeId === 'INET') return 'INTERNET';
    const z = Net.zones().get(nodeId);
    const isFloor = nodeId.startsWith('F:');
    if (!z) return isFloor ? 'LAN' : 'SERVERS';
    switch (z.zone) {
      case 'DMZ': return 'DMZ';
      case 'EXPOSED': return 'INTERNET';
      case 'LAN': return 'LAN';
      case 'SERVERS': return 'SERVERS';
      default: return isFloor ? 'LAN' : (z.fz.includes('dmz') && !z.fz.includes('inside') ? 'DMZ' : 'SERVERS');
    }
  };

  /* ---------- 流量曲線 ---------- */
  const PRES = [0.02, 0.02, 0.02, 0.02, 0.02, 0.03, 0.05, 0.15, 0.55, 0.9, 1, 1, 0.75, 0.9, 1, 1, 0.95, 0.75, 0.4, 0.2, 0.1, 0.07, 0.04, 0.03];
  const WEB = [0.25, 0.18, 0.14, 0.12, 0.12, 0.15, 0.25, 0.4, 0.55, 0.65, 0.7, 0.72, 0.75, 0.7, 0.7, 0.72, 0.75, 0.8, 0.85, 0.9, 1, 1, 0.9, 0.5];
  const GUEST = [0, 0, 0, 0, 0, 0, 0, 0.05, 0.3, 0.7, 1, 0.95, 0.7, 0.85, 1, 1, 0.85, 0.5, 0.2, 0.05, 0, 0, 0, 0];
  function curve(arr, t) {
    const h = U.hourOf(t), i = Math.floor(h), fr = h - i;
    return U.lerp(arr[i], arr[(i + 1) % 24], fr);
  }
  Net.presence = (t, type) => {
    let p = curve(PRES, t);
    const wk = U.isWeekend(t);
    if (wk) p *= 0.06;
    const ft = G.FT[type];
    if (ft && ft.night) p = Math.max(p, ft.night * (wk ? 0.5 : 1));
    return p;
  };
  Net.intensity = (t) => {
    const h = U.hourOf(t);
    let inet = 1, intra = 1;
    if (h >= 8.5 && h < 10) { inet = 1.15; intra = 1.15; }
    else if (h >= 12 && h < 13.2) { inet = 1.45; intra = 0.5; }
    else if (h >= 20 || h < 7) { inet = 0.7; intra = 0.6; }
    return { inet, intra };
  };
  Net.guestCurve = (t) => (U.isWeekend(t) ? 0.1 : 1) * curve(GUEST, t);
  Net.webDemand = () => {
    const s = G.S;
    if (!G.Campaign.websiteLive()) return 0;
    const ch = Q.chapterNum();
    const base = ch >= 99 ? 900 : ch >= 5 ? 900 : ch >= 4 ? 600 : 300;
    return base * curve(WEB, s.time) * ((G.R.mods && G.R.mods.webMult) || 1);
  };

  function floorNoise(fid) {
    G.R.noise = G.R.noise || {};
    let n = G.R.noise[fid] || 1;
    n += (Math.random() - 0.5) * 0.06 + (1 - n) * 0.05;
    n = U.clamp(n, 0.8, 1.25);
    G.R.noise[fid] = n;
    return n;
  }

  function qdelay(u) {
    if (u < 0.6) return 0.02;
    if (u < 1) return 0.02 + Math.pow((u - 0.6) / 0.4, 2) * 25;
    return 30 + Math.min(70, (u - 1) * 120);
  }

  const INTRA_SHARE = { file: 0.6, db: 0.3, ad: 0.1 };
  const INTRA_SVC = { file: ['SMB'], db: ['SQL'], ad: ['LDAP', 'DNS'] };

  /* ---------- 主模擬（每遊戲分鐘一次） ---------- */
  Net.simulate = () => {
    const s = G.S, t = s.time;
    const g = buildGraph();
    const sig = Array.from(g.nodes.keys()).join(',') + '|' + Array.from(g.edges.keys()).join(',');
    if (sig !== G.R.sig || !G.R.pathCache) { G.R.sig = sig; G.R.pathCache = new Map(); G.R.distCache = new Map(); }
    G.R.graph = g;
    const zones = Net.zones();
    const mods = G.R.mods || {};
    const inten = Net.intensity(t);
    const flows = [];
    const floorSt = {};
    const fwNode = Array.from(g.nodes.values()).find((n) => n.kind === 'firewall');
    const hasFwInstalled = Q.devices('firewall').some((d) => d.rack);

    /* DHCP 位址池 */
    let wifiDevices = 0, guestPeak = 0;
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id], ft = G.FT[f.type];
      wifiDevices += fs.movedIn * ((1 - ft.wired) + ft.phones);
      if (s.fw.guestWifi && ft.guestPeak && fs.movedIn > 0) guestPeak += ft.guestPeak;
    }
    const wifiPool = Q.hosts(s.subnets.wifi) - 1;
    const dhcpWifi = wifiDevices > 0 ? Math.min(1, wifiPool / wifiDevices) : 1;
    const guestPool = Q.hosts(s.subnets.guest) - 1;
    const dhcpGuest = guestPeak > 0 ? Math.min(1, guestPool / guestPeak) : 1;
    const wiredPool = Q.hosts(s.subnets.wired) - 1;
    const dhcpInfo = { wifi: { pool: wifiPool, need: Math.round(wifiDevices) }, guest: { pool: guestPool, need: guestPeak }, wired: { pool: wiredPool, worst: 0, worstFloor: null } };

    const required = G.Campaign.requiredRoles();
    const shareTot = U.sum(required, (r) => INTRA_SHARE[r] || 0) || 1;
    const segOn = !!(s.fw.segmentation && fwNode);

    /* 伺服器 DNS 轉送（AD → 網際網路） */
    for (const d of Q.roleServers('ad')) {
      if (!g.nodes.has(d.id)) continue;
      flows.push({ id: 'dns:' + d.id, stage: 0, kind: 'dns', src: d.id, dst: 'INET', fwd: 2, rev: 4, zs: Net.ruleZone(d.id), zd: 'INTERNET', svc: ['DNS'] });
    }

    /* 樓層 */
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id], ft = G.FT[f.type];
      const nid = 'F:' + f.id;
      const up = g.nodes.has(nid);
      const pres = fs.movedIn * Net.presence(t, f.type);
      const powered = G.Wifi.powered(f.id, up);
      const wr = G.Wifi.get(f.id, powered);
      const guests = (s.fw.guestWifi && ft.guestPeak && fs.movedIn > 0) ? ft.guestPeak * Net.guestCurve(t) * dhcpGuest : 0;
      const am = CAT.access[fs.idf.model];
      const ports = up ? fs.idf.count * am.ports : 0;
      const printers = Math.ceil(fs.movedIn / 40);
      const seats = fs.movedIn * ft.wired;
      const seatPorts = Math.max(0, ports - fs.aps.length - printers);
      const portFrac = seats > 0 ? Math.min(1, seatPorts / seats) : 1;
      const wiredNeed = Math.ceil(seats * portFrac + printers);
      const dhcpWired = wiredNeed > 0 ? Math.min(1, wiredPool / wiredNeed) : 1;
      if (fs.movedIn > 0 && wiredNeed > dhcpInfo.wired.worst) { dhcpInfo.wired.worst = wiredNeed; dhcpInfo.wired.worstFloor = f.id; }
      const noise = floorNoise(f.id);
      const mI = inten.inet * noise * (mods.inetMult || 1);
      const mN = inten.intra * noise;
      const dI = ft.inet[0] * mI, uI = ft.inet[1] * mI, dN = ft.intra[0] * mN, uN = ft.intra[1] * mN;

      const st = {
        fid: f.id, up, present: pres, guests, wifi: wr, powered: powered.size, ports, portFrac, seats, printers,
        dhcpWired, dhcpWifi, conn: 0, thr: 1, lat: 0, loss: 0, sat: null, demand: 0, delivered: 0, intended: 0, connU: 0, wifiShare: 0,
        uplink: 0, apStats: {}, capRatio: 1, guestRatio: 1, adOk: false, dnsOk: false, blocked: null, flows: [],
      };
      floorSt[f.id] = st;
      if (!up || (pres < 0.5 && guests < 0.5)) continue;

      const wiredU = pres * ft.wired * portFrac * dhcpWired;
      const wifiU = pres * (1 - ft.wired) * dhcpWifi;
      const phonesU = pres * ft.phones * dhcpWifi;
      const cover = wr.cover, gcover = wr.gcover;
      const perUser = dI + uI + dN * (required.length ? 1 : 0) + uN * (required.length ? 1 : 0);
      const staffWifiDem = wifiU * cover * perUser + phonesU * cover * 0.13;
      const guestDem = guests * gcover * 1.4;
      let servedS = 0, servedG = 0;
      wr.aps.forEach((ap) => {
        const w = cover > 0 ? ap.w / cover : 0;
        const gw = gcover > 0 ? ap.gw / gcover : 0;
        const dS = staffWifiDem * w, dG = guestDem * gw;
        const cl = (wifiU + phonesU) * cover * w + guests * gcover * gw;
        const clientF = cl > ap.maxClients ? ap.maxClients / cl : 1;
        const cap = Math.min(ap.capEff * clientF, ap.backhaul);
        const dem = dS + dG;
        const r = dem > 0 ? Math.min(1, cap / dem) : 1;
        servedS += dS * r; servedG += dG * r;
        st.apStats[ap.id] = { clients: cl, load: cap > 0 ? dem / cap : 0, cap, demand: dem };
      });
      const capRatio = staffWifiDem > 0 ? servedS / staffWifiDem : 1;
      const guestRatio = guestDem > 0 ? servedG / guestDem : 1;
      st.capRatio = capRatio; st.guestRatio = guestRatio;
      const effU = wiredU + wifiU * cover * capRatio;
      const phonesEff = phonesU * cover * capRatio;
      st.connU = wiredU + wifiU * cover;
      st.conn = pres > 0 ? st.connU / pres : 1;
      st.wifiShare = st.connU > 0 ? (wifiU * cover) / st.connU : 0;
      st.intended = st.connU * perUser + phonesU * cover * 0.13;

      /* 內部服務流量 */
      for (const r of required) {
        const share = (INTRA_SHARE[r] || 0) / shareTot;
        const fl = { id: nid + '>' + r, stage: 1, kind: 'intra', role: r, floor: f.id, src: nid, dst: 'ROLE:' + r,
          fwd: effU * uN * share, rev: effU * dN * share, zs: 'LAN', zd: null, svc: INTRA_SVC[r] };
        if (segOn) fl.via = fwNode.dev.id;
        flows.push(fl); st.flows.push(fl);
      }
      if (!required.includes('ad')) st.adOk = true;
      /* 上網流量 */
      const inet = { id: nid + '>INET', stage: 2, kind: 'inet', floor: f.id, src: nid, dst: 'INET',
        fwd: effU * uI + phonesEff * 0.03, rev: effU * dI + phonesEff * 0.1, zs: 'LAN', zd: 'INTERNET', svc: ['WEB'], needDns: true };
      flows.push(inet); st.flows.push(inet);
      if (guests > 0.5) {
        const gf = { id: nid + '>INET:g', stage: 2, kind: 'guest', floor: f.id, src: nid, dst: 'INET',
          fwd: guests * gcover * guestRatio * 0.3, rev: guests * gcover * guestRatio * 1.1, zs: 'GUEST', zd: 'INTERNET', svc: ['WEB', 'DNS'] };
        flows.push(gf); st.guestFlow = gf;
      }
    }

    /* 官網 */
    const webDem = Net.webDemand();
    let webFlow = null;
    const webDbFlows = [];
    if (webDem > 0) {
      webFlow = { id: 'web', stage: 3, kind: 'web', src: 'INET', dst: 'ROLE:web', fwd: webDem * 0.1, rev: webDem, zs: 'INTERNET', zd: null, svc: ['WEB'] };
      flows.push(webFlow);
      const webs = Q.roleServers('web').filter((d) => g.nodes.has(d.id));
      for (const w of webs) {
        const f2 = { id: 'webdb:' + w.id, stage: 3, kind: 'webdb', src: w.id, dst: 'ROLE:db', fwd: webDem * 0.03 / webs.length, rev: webDem * 0.12 / webs.length, zs: Net.ruleZone(w.id), zd: null, svc: ['SQL'] };
        flows.push(f2); webDbFlows.push(f2);
      }
    }
    /* 夜間備份（01:00–04:00） */
    const h = U.hourOf(t);
    if (h >= 1 && h < 4) {
      const files = Q.roleServers('file').filter((d) => g.nodes.has(d.id));
      const scale = 0.15 + Q.employees() / 10000;
      for (const fsv of files) flows.push({ id: 'bkp:' + fsv.id, stage: 3, kind: 'backup', src: fsv.id, dst: 'ROLE:backup', fwd: 2600 * scale / files.length, rev: 20, zs: Net.ruleZone(fsv.id), zd: null, svc: ['SMB'] });
    }
    /* AI 訓練：GX-8 之間的環狀 all-reduce（每一步都要同步參數），以及從 AI 儲存讀取訓練資料 */
    const aiSrv = Q.roleServers('ai').filter((d) => d.rack).sort((a, b) => idNum(a.id) - idNum(b.id));
    const aiUp = aiSrv.filter((d) => g.nodes.has(d.id));
    const trainers = aiUp.filter((d) => CAT.devices[d.model].gpu >= 8);
    const aiRing = [], aiData = [];
    if (trainers.length >= 2) {
      trainers.forEach((a, i) => {
        const b = trainers[(i + 1) % trainers.length];
        const f = { id: 'ai:' + a.id, stage: 3, kind: 'ai', src: a.id, dst: b.id, fwd: 200000, rev: 0, zs: Net.ruleZone(a.id), zd: Net.ruleZone(b.id), svc: ['RDMA'] };
        flows.push(f); aiRing.push(f);
      });
    }
    for (const d of aiUp) {
      const f = { id: 'aid:' + d.id, stage: 3, kind: 'aidata', src: d.id, dst: 'ROLE:aistore', fwd: 400, rev: CAT.devices[d.model].gpu >= 8 ? 25000 : 6000, zs: Net.ruleZone(d.id), zd: null, svc: ['NFS'] };
      flows.push(f); aiData.push(f);
    }
    /* 攻擊流量（由資安事件產生） */
    for (const af of G.R.attackFlows || []) flows.push(Object.assign({ stage: 4, kind: 'attack' }, af));

    /* ---- 路由、規則檢查、負載累加 ---- */
    const load = new Map();
    const nodeLoad = new Map();
    const addLoad = (k, v) => { if (v > 0) load.set(k, (load.get(k) || 0) + v); };
    const addNode = (n, v) => { if (v > 0) nodeLoad.set(n, (nodeLoad.get(n) || 0) + v); };
    const hits = s.ruleHits;
    const hit = (rule, amt) => { const k = rule ? rule.id : 'default'; hits[k] = (hits[k] || 0) + amt; };

    let adResolves = false;
    const adOkFloor = {};
    const lanDnsDirect = hasFwInstalled ? G.Sec.allows('LAN', 'INTERNET', 'DNS') : true;

    flows.sort((a, b) => a.stage - b.stage);
    for (const fl of flows) {
      if (fl.fwd + fl.rev <= 0 && fl.kind !== 'attack') { fl.delivered = 0; fl.dFwd = 0; fl.dRev = 0; continue; }
      const legs = fl.via ? [pathsBetween(g, fl.src, fl.via), pathsBetween(g, fl.via, fl.dst)] : [pathsBetween(g, fl.src, fl.dst)];
      fl.legs = legs;
      if (legs.some((l) => !l)) { fl.blocked = g.nodes.has(fl.dst) ? 'noroute' : 'nosvc'; }
      if (!fl.blocked) {
        const last = legs[legs.length - 1][0];
        if (fl.dst.startsWith('ROLE:') && last) fl.zd = Net.ruleZone(last.nodes[last.nodes.length - 2]);
        fl.crossFw = !!fl.via || legs[0].some((p) => p.fws.length > 0);
        if (fl.crossFw && fl.kind === 'attack' && fl.stopAtFw) fl.blocked = 'fw';
        if (fl.crossFw && (fl.kind !== 'attack' || fl.checkFw) && !fl.blocked) {
          for (const svc of fl.svc) {
            const r = G.Sec.match(fl.zs, fl.zd, svc);
            hit(r, (fl.fwd + fl.rev) / 40);
            if (!r || r.action !== 'allow') { fl.blocked = 'fw'; fl.blockedSvc = svc; break; }
          }
        }
        if (!fl.blocked && fl.needDns) {
          const direct = fl.crossFw ? lanDnsDirect : true;
          if (!direct && !(adOkFloor[fl.floor] && adResolves)) fl.blocked = 'dns';
        }
      }
      if (fl.kind === 'dns' && !fl.blocked) adResolves = true;
      if (fl.kind === 'intra' && fl.role === 'ad') adOkFloor[fl.floor] = !fl.blocked;

      /* 負載 */
      if (!fl.blocked) {
        for (const leg of legs) for (const p of leg) {
          for (const e of p.edges) { addLoad(e.fwd, fl.fwd * p.frac); addLoad(e.rev, fl.rev * p.frac); }
          for (let i = 1; i < p.nodes.length - 1; i++) addNode(p.nodes[i], (fl.fwd + fl.rev) * p.frac);
        }
        if (fl.via) addNode(fl.via, fl.fwd + fl.rev);
      } else if (fl.volumetric && fl.legs && fl.legs[0]) {
        /* 被防火牆擋下的洪水攻擊：流量仍會塞滿防火牆之前的線路 */
        for (const p of fl.legs[0]) {
          for (const e of p.edges) {
            addLoad(e.fwd, fl.fwd * p.frac); addLoad(e.rev, fl.rev * p.frac);
            if (g.nodes.get(e.to).kind === 'firewall') { addNode(e.to, (fl.fwd + fl.rev) * p.frac); break; }
            addNode(e.to, (fl.fwd + fl.rev) * p.frac);
          }
        }
      }
    }

    /* ---- 容量限縮因子 ---- */
    const factor = new Map();
    const util = new Map();
    for (const [k, v] of load) {
      const ek = k.slice(0, k.lastIndexOf('>'));
      const e = g.edges.get(ek);
      if (!e) continue;
      const u = v / e.cap;
      util.set(k, u);
      factor.set(k, u > 1 ? 1 / u : 1);
    }
    const nodeF = new Map();
    const nodeInfo = {};
    const ips = Q.hasService('ips');
    for (const [n, v] of nodeLoad) {
      const info = g.nodes.get(n);
      if (!info || !info.m) continue;
      let cap = 0;
      if (info.kind === 'router') cap = info.m.thr;
      else if (info.kind === 'firewall') cap = ips ? info.m.ips : info.m.fw;
      if (!cap) continue;
      nodeInfo[n] = { load: v, cap, util: v / cap };
      nodeF.set(n, v > cap ? cap / v : 1);
    }
    for (const n of g.nodes.values()) {
      if ((n.kind === 'router' || n.kind === 'firewall') && !nodeInfo[n.dev.id]) {
        const cap = n.kind === 'router' ? n.m.thr : (ips ? n.m.ips : n.m.fw);
        nodeInfo[n.dev.id] = { load: 0, cap, util: 0 };
      }
    }

    /* ---- 實際送達量與延遲 ---- */
    for (const fl of flows) {
      fl.dFwd = 0; fl.dRev = 0; fl.rtt = 0;
      if (fl.blocked || !fl.legs) continue;
      let fF = 1, fR = 1, rtt = 0;
      for (const leg of fl.legs) {
        let lf = 0, lr = 0, lrtt = 0;
        for (const p of leg) {
          let pf = 1, pr = 1, pl = 0;
          for (const e of p.edges) {
            pf = Math.min(pf, factor.get(e.fwd) || 1);
            pr = Math.min(pr, factor.get(e.rev) || 1);
            const ed = g.edges.get(e.key);
            pl += ed.lat * 2 + qdelay(util.get(e.fwd) || 0) + qdelay(util.get(e.rev) || 0);
          }
          for (let i = 1; i < p.nodes.length - 1; i++) {
            const nf = nodeF.get(p.nodes[i]);
            if (nf !== undefined) { pf = Math.min(pf, nf); pr = Math.min(pr, nf); if (nf < 1) pl += 20; }
          }
          lf += p.frac * pf; lr += p.frac * pr; lrtt += p.frac * pl;
        }
        fF = Math.min(fF, lf); fR = Math.min(fR, lr); rtt += lrtt;
      }
      fl.dFwd = fl.fwd * fF; fl.dRev = fl.rev * fR; fl.rtt = rtt;
    }

    /* ---- 官網可用率 ---- */
    let web = { demand: webDem, delivered: 0, ratio: 1 };
    if (webFlow) {
      let r = webFlow.rev > 0 ? webFlow.dRev / webFlow.rev : 0;
      if (webDbFlows.length) {
        const okDb = webDbFlows.filter((f) => !f.blocked);
        const dbR = okDb.length ? U.sum(okDb, (f) => (f.rev > 0 ? f.dRev / f.rev : 1)) / webDbFlows.length : 0;
        r *= 0.15 + 0.85 * dbR;
      } else if (Q.roleServers('web').some((d) => g.nodes.has(d.id))) r *= 0.15;
      if (mods.webDown) r = 0;
      web = { demand: webDem, delivered: webDem * r, ratio: r, blocked: webFlow.blocked };
    }

    /* ---- 樓層滿意度 ---- */
    G.R.satEma = G.R.satEma || {};
    let adCap = 0;
    for (const d of Q.roleServers('ad')) if (g.nodes.has(d.id)) adCap += CAT.roles.ad.capUsers;
    let presTot = 0, satSum = 0, latSum = 0, lossSum = 0, demTot = 0;
    for (const f of G.BLD.floors) presTot += floorSt[f.id].present;
    const adCapF = presTot > 0 ? 0.75 + 0.25 * Math.min(1, adCap / presTot) : 1;
    const wlcManaged = G.Q.devices('wlc').some((d) => g.nodes.has(d.id));

    for (const f of G.BLD.floors) {
      const st = floorSt[f.id], ft = G.FT[f.type];
      const fs = s.floors[f.id];
      if (st.present < 0.5) { st.sat = G.R.satEma[f.id] !== undefined ? G.R.satEma[f.id] : null; continue; }
      st.adOk = required.includes('ad') ? !!adOkFloor[f.id] : true;
      let delivered = 0, offered = 0, latW = 0, latAmt = 0;
      for (const fl of st.flows) {
        delivered += fl.dFwd + fl.dRev;
        offered += fl.fwd + fl.rev;
        if (!fl.blocked) { latW += fl.rtt * (fl.fwd + fl.rev); latAmt += fl.fwd + fl.rev; }
        if (fl.blocked && !st.blocked) st.blocked = { kind: fl.kind, role: fl.role, why: fl.blocked, svc: fl.blockedSvc };
        st.uplink += fl.dFwd + fl.dRev;
      }
      if (st.guestFlow) st.uplink += st.guestFlow.dFwd + st.guestFlow.dRev;
      const inetFl = st.flows.find((x) => x.kind === 'inet');
      st.dnsOk = inetFl ? inetFl.blocked !== 'dns' : false;
      st.delivered = delivered;
      st.demand = st.intended;
      const thr = st.intended > 0 ? U.clamp(delivered / st.intended, 0, 1) : 1;
      st.thr = thr;
      let lat = latAmt > 0 ? latW / latAmt : 0;
      lat += st.wifiShare * (st.capRatio < 0.98 ? (1 - st.capRatio) * 80 + 4 : 3);
      st.lat = lat;
      st.loss = offered > 0 ? U.clamp(1 - delivered / Math.max(offered, 1e-9) - (1 - st.capRatio) * st.wifiShare, 0, 1) : 0;
      let q = st.conn * (0.15 + 0.85 * Math.pow(thr, 1.3));
      const lim = ft.voip ? 25 : 60;
      if (lat > lim) q *= Math.max(0.5, 1 - (lat - lim) / (lim * 4));
      if (ft.voip && st.loss > 0.01) q *= Math.max(0.4, 1 - st.loss * 5);
      if (ft.voip) { const poe = Q.floorPoe(f.id); if (poe.phones > poe.budget) q *= 0.55; }
      if (!st.adOk) q *= 0.25;
      else q *= adCapF;
      if (!wlcManaged && fs.aps.length > 3) q *= 0.97;
      if (mods.floorPenalty && mods.floorPenalty[f.id]) q *= mods.floorPenalty[f.id];
      q = U.clamp(q * 0.97, 0, 1);
      const prev = G.R.satEma[f.id];
      const sat = prev === undefined || prev === null ? q : prev + (q - prev) * 0.18;
      G.R.satEma[f.id] = sat;
      st.sat = sat;
      satSum += sat * st.present; latSum += lat * st.present; lossSum += st.loss * st.present; demTot += st.present;
    }

    /* ---- 彙總 ---- */
    const linkSt = {};
    for (const l of Object.values(s.links)) {
      const e = g.edges.get(l.id);
      const cap = l.speed * l.count;
      const ab = load.get(l.id + '>' + l.b) || 0, ba = load.get(l.id + '>' + l.a) || 0;
      linkSt[l.id] = { ab, ba, cap, util: e ? Math.max(ab, ba) / cap : 0, up: !!e };
    }
    const ispSt = {};
    let wanIn = 0, wanOut = 0, wanCap = 0;
    for (const c of s.isp) {
      const k = 'isp:' + c.id + '#wan';
      const e = g.edges.get(k);
      const inn = load.get(k + '>isp:' + c.id) || 0, out = load.get(k + '>INET') || 0;
      ispSt[c.id] = { in: inn, out, cap: c.bw, util: Math.max(inn, out) / c.bw, up: !!e, standby: !e && Net.ispUp(c) };
      if (e) { wanIn += Math.min(inn, c.bw); wanOut += Math.min(out, c.bw); wanCap += c.bw; }
    }
    let intra = 0;
    for (const fl of flows) if (fl.kind === 'intra' || fl.kind === 'backup' || fl.kind === 'webdb') intra += fl.dFwd + fl.dRev;
    const prevSat = G.R.sim ? G.R.sim.sat : null;
    const sat = demTot >= 20 ? satSum / demTot : (prevSat !== null && prevSat !== undefined ? prevSat : null);

    /* ---- AI 算力利用率 = 供電 × 散熱 × 後端網路 × 儲存 ---- */
    G.R.ai = null;
    if (aiSrv.length) {
      const fac = G.R.fac || { thermal: 1 };
      const pfAll = U.sum(aiSrv, (d) => CAT.devices[d.model].pf || 0);
      const pfUp = U.sum(aiUp, (d) => CAT.devices[d.model].pf || 0);
      const ratio = (f) => (f.blocked ? 0 : (f.fwd + f.rev > 0 ? (f.dFwd + f.dRev) / (f.fwd + f.rev) : 1));
      const fabric = aiRing.length ? U.sum(aiRing, ratio) / aiRing.length : 1;
      const hasStore = g.nodes.has('ROLE:aistore');
      const storage = !aiData.length ? 1 : hasStore ? 0.5 + 0.5 * U.sum(aiData, ratio) / aiData.length : 0.5;
      const liquidUp = aiUp.some((d) => CAT.devices[d.model].liquid);
      const thermal = liquidUp ? fac.thermal : 1;
      const capF = mods.gpuCap ? Math.min(1, ...aiUp.map((d) => mods.gpuCap[d.rack] || 1)) : 1;
      const power = pfAll > 0 ? pfUp / pfAll : 0;
      const util = U.clamp(power * thermal * fabric * storage * capF, 0, 1);
      G.R.ai = { servers: aiSrv.length, up: aiUp.length, trainers: trainers.length, gpus: U.sum(aiSrv, (d) => CAT.devices[d.model].gpu || 0),
        pfAll, power, thermal, fabric, storage, hasStore, capF, util, pflops: pfAll * util };
    }

    G.R.sim = {
      t, graph: g, flows, floors: floorSt, links: linkSt, isp: ispSt, nodes: nodeInfo,
      wan: { in: wanIn, out: wanOut, cap: wanCap }, intra, users: demTot, employees: Q.employees(),
      sat, lat: demTot > 0 ? latSum / demTot : 0, loss: demTot > 0 ? lossSum / demTot : 0,
      web, dhcp: dhcpInfo, adResolves, lanDnsDirect, util, load, wlcManaged, ai: G.R.ai,
    };
    return G.R.sim;
  };
})(window.G = window.G || {});
