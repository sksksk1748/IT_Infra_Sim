/* 封包旅程：追蹤一個請求在公司網路裡走過的每一站，並說明每一站做了什麼判斷
 * 路徑來自模擬中實際的路由圖（Net.paths），防火牆判斷來自實際的規則表（Sec.match），
 * 所以玩家看到的就是「現在這個網路」真正的行為：哪裡會被擋、為什麼、要怎麼修。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const J = {};
  G.Journey = J;

  J.SCENARIOS = [
    { id: 'web', label: '員工上網（瀏覽網站）', floor: true },
    { id: 'dns', label: '員工查詢網址（DNS）', floor: true },
    { id: 'file', label: '員工開啟共用資料夾（SMB）', floor: true },
    { id: 'site', label: '客戶從外網連上公司官網' },
    { id: 'guest', label: '大廳訪客用 Wi-Fi 上網' },
    { id: 'rdp', label: '駭客從外網嘗試 RDP 連進伺服器', attack: true },
  ];
  const ROLE_NAME = (r) => (CAT.roles[r] ? CAT.roles[r].name : r);
  const zoneTxt = (z) => (G.ZONES[z] ? `${G.ZONES[z].name}（${z}）` : z);
  const svcTxt = (svc) => `${svc}（${G.SVC[svc] ? G.SVC[svc].port : ''}）`;
  const devName = (id) => Q.nodeName(id);
  const firstUp = (role) => Q.roleServers(role).find((d) => G.Net.devUp(d));
  const qdelay = (u) => (u < 0.6 ? 0.02 : u < 1 ? 0.02 + Math.pow((u - 0.6) / 0.4, 2) * 25 : 30 + Math.min(70, (u - 1) * 120));

  /** 情境 → 分段（每段：來源、目的、服務、來源區域） */
  function legsOf(id, fid) {
    const F = 'F:' + fid;
    switch (id) {
      case 'web': return [{ src: F, dst: 'INET', svc: 'WEB', zs: 'LAN' }];
      case 'dns': {
        const ad = firstUp('ad');
        return ad
          ? [{ src: F, dst: 'ROLE:ad', svc: 'DNS', zs: 'LAN', intro: '員工電腦先問公司內部的 DNS（AD 伺服器）' },
            { src: ad.id, dst: 'INET', svc: 'DNS', intro: 'AD 查不到外部網址，轉送給網際網路上的 DNS 伺服器' }]
          : [{ src: F, dst: 'INET', svc: 'DNS', zs: 'LAN', intro: '公司沒有 AD，員工電腦直接問網際網路上的 DNS' }];
      }
      case 'file': return [{ src: F, dst: 'ROLE:file', svc: 'SMB', zs: 'LAN' }];
      case 'site': {
        const legs = [{ src: 'INET', dst: 'ROLE:web', svc: 'WEB', zs: 'INTERNET' }];
        const web = firstUp('web');
        if (web) legs.push({ src: web.id, dst: 'ROLE:db', svc: 'SQL', intro: '官網要顯示會員資料，再向內部資料庫查詢' });
        return legs;
      }
      case 'guest': return [{ src: 'F:1F', dst: 'INET', svc: 'WEB', zs: 'GUEST' }];
      case 'rdp': {
        const t = firstUp('ad') || firstUp('file') || firstUp('db') || Q.devices('server').find((d) => G.Net.devUp(d));
        return [{ src: 'INET', dst: t ? t.id : null, svc: 'RDP', zs: 'INTERNET', attack: true }];
      }
    }
    return [];
  }

  /** 實體線路找路徑（不管設備有沒有運作），用來說明「哪一站斷了」 */
  function physicalPath(src, dst) {
    const s = G.S;
    const adj = new Map();
    const add = (a, b, why) => { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push({ to: b, why }); adj.get(b).push({ to: a, why }); };
    for (const l of Object.values(s.links)) add(l.a, l.b, { link: l });
    for (const c of s.isp) { add('INET', 'isp:' + c.id, { isp: c }); if (c.router) add('isp:' + c.id, c.router, { isp: c }); }
    const role = dst && dst.startsWith('ROLE:') ? dst.slice(5) : null;
    const isDst = (n) => (role ? (s.devices[n] && s.devices[n].role === role) : n === dst);
    const prev = new Map([[src, null]]);
    const q = [src];
    let hit = null;
    while (q.length && !hit) {
      const n = q.shift();
      for (const e of adj.get(n) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, { n, e });
        if (isDst(e.to)) { hit = e.to; break; }
        q.push(e.to);
      }
    }
    if (!hit) return null;
    const out = [];
    for (let n = hit; n; n = prev.get(n) ? prev.get(n).n : null) out.unshift({ n, via: prev.get(n) ? prev.get(n).e.why : null });
    return out;
  }
  /** 找不到路由時，說明原因 */
  function diagnose(leg) {
    const s = G.S, g = G.R.graph;
    if (leg.src && leg.src.startsWith('F:')) {
      const fid = leg.src.slice(2);
      if (!g.nodes.has(leg.src)) {
        const st = G.Views && G.Views.building ? G.Views.building.floorStatus(fid) : { t: '離線' };
        return { title: `${fid} 的網路還沒通`, text: `${fid} 目前狀態是「${st.t}」，封包連樓層都出不去。`, fix: `到「樓層」完成水平布線與接入交換器，再到「拓撲」把 ${fid} 的上行主幹接到核心交換器。`, go: 'floor:' + fid };
      }
    }
    if (leg.dst && leg.dst.startsWith('ROLE:')) {
      const role = leg.dst.slice(5);
      if (!Q.roleServers(role).some((d) => G.Net.devUp(d))) return { title: `沒有運作中的${ROLE_NAME(role)}`, text: `目的地是${ROLE_NAME(role)}，但目前沒有任何這個角色的伺服器在運作。`, fix: '到「機房」上架伺服器、在設備詳情設定角色，並接上核心交換器。', go: 'rack' };
    }
    if (leg.dst === 'INET' && !G.S.isp.some((c) => G.Net.ispUp(c))) return { title: '公司還沒有對外線路', text: '沒有任何開通且接上路由器的 ISP 專線，封包出不了公司。', fix: '到「採購 → ISP 專線」申請線路，開通後在拓撲把 ISP 接到路由器。', go: 'shop:isp' };
    if (!leg.dst) return { title: '沒有可攻擊的目標', text: '機房裡還沒有運作中的伺服器。', fix: '', go: null };
    const pp = physicalPath(leg.src, leg.dst);
    if (!pp) return { title: '實體線路沒有接通', text: `從「${devName(leg.src)}」到「${leg.dst.startsWith('ROLE:') ? ROLE_NAME(leg.dst.slice(5)) : devName(leg.dst)}」之間少了一段線路。`, fix: '到「拓撲」依序檢查：樓層 → 核心交換器 → 防火牆 → 路由器 → ISP，把缺的那一段連起來。', go: 'topo' };
    for (const st of pp) {
      if (st.via && st.via.link) {
        const l = st.via.link;
        if (l.status !== 'up') return { title: '線路中斷', text: `${devName(l.a)} ⇄ ${devName(l.b)} 這條線路中斷了。`, fix: '到「事件」或拓撲的線路詳情派員搶修。', go: 'topo' };
        if (G.Net.linkBuilding(l)) return { title: '線路還在施工', text: `${devName(l.a)} ⇄ ${devName(l.b)} 的主幹還在施工，完工後就會通。`, fix: '', go: 'topo' };
      }
      if (!g.nodes.has(st.n) && !st.n.startsWith('isp:') && st.n !== 'INET' && s.devices[st.n]) {
        const d = s.devices[st.n];
        return { title: `${d.name} 沒有在運作`, text: `路徑會經過 ${d.name}，但它目前「${G.UI ? G.UI.devStatus(d).t : '停止'}」。`, fix: '到「機房」確認它已上架、供電正常並完成開機；故障請送修。', go: 'rack' };
      }
      if (st.n.startsWith('isp:')) {
        const c = s.isp.find((x) => 'isp:' + x.id === st.n);
        if (c && !G.Net.ispUp(c)) return { title: 'ISP 線路沒有運作', text: `${CAT.isp.providers[c.provider].name} ${c.plan} 目前${c.status !== 'active' ? '還在開通中' : c.outage ? '中斷' : '沒有接上路由器'}。`, fix: '等待開通，或在拓撲把 ISP 接到路由器。', go: 'topo' };
      }
    }
    return { title: '找不到可用的路徑', text: '有實體線路，但中間的某台設備不轉送這類流量（例如單 WAN 路由器只用一條專線、或 Standby 防火牆）。', fix: '', go: 'topo' };
  }

  /** 每一站的說明 */
  function describe(n, ctx) {
    const s = G.S;
    const kind = Q.nodeKind(n);
    const next = ctx.next, prev = ctx.prev;
    const nk = next ? Q.nodeKind(next) : null;
    const nextName = next ? (next.startsWith('ROLE:') ? ROLE_NAME(next.slice(5)) : devName(next)) : '';
    if (kind === 'floor') {
      const fid = n.slice(2), fs = s.floors[fid], am = CAT.access[fs.idf.model];
      if (ctx.first) {
        const zone = ctx.zs === 'GUEST' ? '訪客網路（GUEST，與員工網路分開的 VLAN）' : '員工內網（LAN）';
        return { title: `${fid} ${ctx.zs === 'GUEST' ? '訪客手機' : '員工電腦'}`, text: `封包從 ${fid} 出發，來源位址是${zone}的私有 IP（10.x.x.x）。${ctx.zs === 'GUEST' ? '手機先連上 AP，' : '有線座位經由網路線、無線則經由 AP，'}到本層 IDF 的接入交換器（${am ? am.name : '接入交換器'}）——L2 交換器依 MAC 位址轉送，再往上行埠送出。` };
      }
      return { title: `抵達 ${fid}`, text: `封包沿主幹回到 ${fid} 的 IDF，接入交換器再轉送給目標電腦。` };
    }
    if (kind === 'switch') {
      const d = s.devices[n];
      if (Q.isL3(d)) {
        let why = '';
        if (nk === 'firewall') why = '目的地在公司外面（或另一個安全區域），依路由表交給防火牆';
        else if (nk === 'floor') why = `目的地在 ${next.slice(2)}，往該樓層的主幹送下去`;
        else if (nk === 'server' || (next && next.startsWith('ROLE:'))) why = '目的地是機房裡的伺服器，同一個網路內直接轉送';
        else if (nk === 'switch') why = '依路由表轉給下一台交換器';
        return { title: `核心交換器 ${d.name}（L3）`, text: `核心交換器查路由表：${why}。下一站：${nextName}。` };
      }
      return { title: `交換器 ${d.name}（L2）`, text: `L2 交換器只看 MAC 位址，把封包轉送到 ${nextName}。` };
    }
    if (kind === 'router') {
      const d = s.devices[n], m = CAT.devices[d.model];
      const out = nk === 'isp';
      const wan = m.multiWan === 'bgp' ? '這台路由器支援 BGP，多條專線可以同時分擔流量' : '這台路由器只能主備援：一次只用一條專線';
      return out
        ? { title: `邊界路由器 ${d.name}`, text: `路由器做 NAT：把私有 IP（10.x.x.x）換成公司的公有 IP，網際網路才知道回應要送回哪裡。接著依預設路由送往 ISP（${wan}）。` }
        : { title: `邊界路由器 ${d.name}`, text: '封包打的是公司的公有 IP。路由器依 NAT 對應（通訊埠轉送）把目的地換成內部伺服器的位址，再交給防火牆檢查。' };
    }
    if (kind === 'isp') {
      const c = s.isp.find((x) => 'isp:' + x.id === n);
      const nm = c ? `${CAT.isp.providers[c.provider].name} ${c.plan}` : 'ISP';
      return nk === 'internet' || !next
        ? { title: `ISP 專線 ${nm}`, text: `封包經由 ${nm} 專線離開公司，進入網際網路（這一段約 ${CAT.isp.latency} ms）。` }
        : { title: `ISP 專線 ${nm}`, text: `來自網際網路的封包經由 ${nm} 專線進入公司。` };
    }
    if (kind === 'internet') {
      return ctx.first
        ? { title: ctx.attack ? '網際網路上的攻擊者' : '網際網路上的客戶', text: ctx.attack ? '攻擊者掃描到公司的公有 IP，嘗試用 RDP（遠端桌面）直接連進來。' : '客戶在瀏覽器輸入公司官網網址，DNS 查到公司的公有 IP，請求從網際網路送過來。' }
        : { title: '抵達網際網路', text: '封包抵達網際網路上的伺服器。回應封包沿原路回來：防火牆認得這是「已建立連線」的回應，直接放行（Stateful 狀態檢查）；路由器再把公有 IP 換回員工電腦的私有 IP。' };
    }
    if (kind === 'server' || kind === 'wlc') {
      const d = s.devices[n];
      const zone = G.Net.ruleZone(n);
      const role = d.role ? ROLE_NAME(d.role) : '伺服器';
      if (ctx.first) return { title: `${d.name}（${role}）`, text: `${d.name} 位於${zoneTxt(zone)}，由它發出下一段查詢。` };
      const extra = d.role === 'web' ? '官網伺服器放在 DMZ：就算被攻破，攻擊者也碰不到內網。' : d.role === 'ad' ? 'AD 伺服器同時提供 DNS、DHCP 與帳號驗證。' : d.role === 'file' ? '檔案伺服器回傳共用資料夾的內容，這是內部流量的大宗。' : d.role === 'db' ? '資料庫只接受內部查詢，絕不直接對外開放。' : '';
      return { title: `抵達 ${d.name}（${role}）`, text: `目的地伺服器位於${zoneTxt(zone)}，收到請求並回應。${extra}` };
    }
    return { title: devName(n), text: '' };
  }

  /** 防火牆那一站：依實際規則表判斷 */
  function firewallStep(n, zs, zd, svc, attack) {
    const s = G.S, d = s.devices[n];
    const standby = G.R.graph && G.R.graph.standby && Array.from(G.R.graph.standby);
    const r = G.Sec.match(zs, zd, svc);
    const idx = r ? s.fw.rules.indexOf(r) + 1 : 0;
    const head = `防火牆 ${d.name}：來源區域 ${zoneTxt(zs)} → 目的區域 ${zoneTxt(zd)}，服務 ${svcTxt(svc)}。由上而下比對 ${s.fw.rules.filter((x) => x.on).length} 條規則，`;
    const ips = Q.hasService('ips') ? '另外 IPS 會深入檢查封包內容，擋下夾帶在允許流量中的攻擊。' : '';
    const ha = standby && standby.length ? `（HA：${standby.map(devName).join('、')} 是 Standby，只同步狀態、不轉送。）` : '';
    if (r && r.action === 'allow') {
      return {
        pass: true, rule: r,
        step: { kind: attack ? 'bad' : 'ok', title: `防火牆 ${d.name}`, text: `${head}第 ${idx} 條「允許 ${r.src} → ${r.dst}：${r.svc}」最先符合 → 放行，並把這條連線記進狀態表。${ips}${ha}`, rule: idx,
          fix: attack ? `這條規則讓外網可以直接 ${svc} 進來！到「防火牆」刪除或停用第 ${idx} 條，遠端管理改用 VPN + MFA。` : '' },
      };
    }
    const why = r ? `第 ${idx} 條「拒絕 ${r.src} → ${r.dst}：${r.svc}」最先符合 → 丟棄。` : `沒有任何規則符合 ${zs} → ${zd}：${svc}，落入最後的「預設拒絕」→ 丟棄。`;
    return {
      pass: false, rule: r,
      step: { kind: attack ? 'ok' : 'bad', title: `防火牆 ${d.name}`, text: head + why + (attack ? '這正是我們要的：沒有明確允許的連線一律擋下。' : '') + ha, rule: idx || null, blocked: true,
        fix: attack ? '' : `如果這是業務需要的連線，到「防火牆」新增「允許 ${zs} → ${zd}：${svc}」，並放在任何會擋住它的規則之前。`, go: attack ? null : 'fw' },
    };
  }

  /**
   * 產生封包旅程：{ ok, steps:[{ node, kind, title, text, link, util, fix, go }], nodes, summary, rtt }
   * steps[i].node 是那一站的節點 id（用來在拓撲圖上標示），第 0 站是出發點。
   */
  J.build = (scId, fid) => {
    const s = G.S, g = G.R.graph;
    const sc = J.SCENARIOS.find((x) => x.id === scId) || J.SCENARIOS[0];
    const res = { sc, steps: [], ok: true, attack: !!sc.attack, rtt: 0, legs: [] };
    if (!g) { res.ok = false; res.steps.push({ node: null, kind: 'bad', title: '網路還沒開始運作', text: '先讓時間走一下，模擬會建立路由表。' }); return res; }
    if (scId === 'guest' && !s.fw.guestWifi) res.note = '目前還沒開放訪客 Wi-Fi（防火牆頁可以啟用）；以下示範開放後封包會怎麼走。';
    const legs = legsOf(sc.id, fid);
    let oneWay = 0;
    for (const leg of legs) {
      const intro = leg.intro ? { node: leg.src, kind: 'info', title: `第 ${res.legs.length + 1} 段：${leg.intro}`, text: '', leg: true } : null;
      if (intro) res.steps.push(intro);
      if (!leg.dst || !g.nodes.has(leg.src)) { const dg = diagnose(leg); res.steps.push(Object.assign({ node: leg.src, kind: leg.attack ? 'ok' : 'bad', blocked: true }, dg, leg.attack ? { title: '攻擊到不了', fix: '' } : {})); res.ok = false; break; }
      const fwNode = Array.from(g.nodes.values()).find((x) => x.kind === 'firewall');
      const via = s.fw.segmentation && fwNode && leg.zs === 'LAN' && leg.dst.startsWith('ROLE:') ? fwNode.dev.id : null;
      const route = via ? [G.Net.paths(leg.src, via), G.Net.paths(via, leg.dst)] : [G.Net.paths(leg.src, leg.dst)];
      if (route.some((r) => !r)) {
        const dg = diagnose(leg);
        res.steps.push(Object.assign({ node: leg.src, kind: leg.attack ? 'ok' : 'bad', blocked: true }, dg, leg.attack ? { title: '攻擊到不了', text: '從網際網路根本沒有路徑可以到達這台伺服器。', fix: '' } : {}));
        res.ok = false;
        break;
      }
      let nodes = [], edges = [];
      for (const r of route) {
        const best = r.reduce((a, p) => (!a || p.frac > a.frac ? p : a), null);
        nodes = nodes.length ? nodes.concat(best.nodes.slice(1)) : best.nodes.slice();
        edges = edges.concat(best.edges);
      }
      const real = nodes.filter((n) => !n.startsWith('ROLE:'));
      const dstNode = real[real.length - 1];
      const zs = leg.zs || G.Net.ruleZone(leg.src);
      const zd = leg.dst === 'INET' ? 'INTERNET' : G.Net.ruleZone(dstNode);
      const crossFw = real.some((n) => Q.nodeKind(n) === 'firewall');
      res.legs.push({ nodes: real, zs, zd, svc: leg.svc });
      let stop = false;
      for (let i = 0; i < nodes.length && !stop; i++) {
        const n = nodes[i];
        if (n.startsWith('ROLE:')) continue;
        const e = i > 0 ? edges[i - 1] : null;
        const ed = e ? g.edges.get(e.key) : null;
        let link = null, util = 0;
        if (ed) {
          util = (G.R.sim && G.R.sim.util && G.R.sim.util.get(e.key + '>' + n)) || 0;
          oneWay += ed.lat + qdelay(util);
          if (ed.link) link = `${CAT.cables[ed.link.cable].short} ${U.speed(ed.link.speed)}${ed.link.count > 1 ? ' ×' + ed.link.count : ''} · ${ed.link.len} m · 使用率 ${U.pct(util)}`;
          else if (e.key.includes('#wan')) link = `ISP 專線 · 使用率 ${U.pct(util)}`;
        }
        if (i > 0 && res.steps.length && res.steps[res.steps.length - 1].node === n) continue;
        const nextIdx = nodes.findIndex((x, k) => k > i && !x.startsWith('ROLE:'));
        const ctx = { first: i === 0, next: nextIdx >= 0 ? nodes[nextIdx] : null, prev: i > 0 ? nodes[i - 1] : null, zs, attack: leg.attack };
        if (Q.nodeKind(n) === 'firewall' && crossFw) {
          const fw = firewallStep(n, zs, zd, leg.svc, leg.attack);
          res.steps.push(Object.assign({ node: n, link, util }, fw.step));
          if (!fw.pass) { res.ok = false; stop = true; }
          continue;
        }
        const d = describe(n, ctx);
        const step = { node: n, kind: 'ok', title: d.title, text: d.text, link, util };
        if (util >= 0.9) { step.kind = 'warn'; step.text += ` ⚠ 這段線路已經塞車（${U.pct(util)}），封包要排隊。`; }
        if (i === 0 && !crossFw && zs === 'LAN' && zd === 'SERVERS') step.text += '（目前沒有內部分段：員工到伺服器的流量不經過防火牆，勒索軟體也能直接擴散。）';
        res.steps.push(step);
      }
      if (stop) break;
    }
    res.rtt = oneWay * 2 + (res.ok && legs.some((l) => l.dst === 'INET' || l.src === 'INET') ? 20 : 0);
    const last = res.steps[res.steps.length - 1];
    if (res.attack) res.summary = res.ok ? { kind: 'bad', text: '⚠ 攻擊可以一路連到伺服器！' } : { kind: 'ok', text: '✔ 攻擊被擋下了' };
    else res.summary = res.ok ? { kind: 'ok', text: `✔ 連得通 · ${res.steps.filter((x) => !x.leg).length} 站 · 往返約 ${Math.max(1, Math.round(res.rtt))} ms` } : { kind: 'bad', text: `✖ 在「${last ? last.title : ''}」卡住了` };
    return res;
  };
})(window.G = window.G || {});
