/* 據點與雲端：地圖（總部、台中、高雄、越南、東京、MPLS 骨幹、網際網路、公有雲）與即時的線路流量，
 * 各據點的線路申請、SD-WAN / VPN、每類應用走哪條路；總部的 WAN 出口；雲端服務與 Direct Connect。 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { sel: 'overview', order: {} };
  G.Views.wan = V;
  /* 示意地圖座標（viewBox 900 × 520） */
  const POS = { HQ: [626, 214], tc: [596, 300], ks: [578, 402], jp: [812, 108], vn: [168, 452], MPLS: [438, 262], INET: [388, 104], CLOUD: [648, 58] };
  const CLS = [['erp', 'ERP / MES'], ['file', '檔案'], ['ad', 'AD 登入'], ['inet', '上網 / SaaS']];
  const PATH_NAME = { mpls: 'MPLS', iplc: 'IPLC', tun: '網際網路隧道', dia: '本地直接上網', null: '不通' };
  const TYPE_COL = { mpls: '#8f7cf0', iplc: '#f2c14e', inet: '#5aa9f0', lte: '#9aa7ad', hq: '#8f7cf0', isp: '#5aa9f0', dx: '#2fc6b8' };
  const kbBtn = (id) => h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(id) }, G.KB.byId[id] ? G.KB.byId[id].title : id);
  const satCol = (v) => (v === null || v === undefined ? 'var(--text-3)' : v >= 0.8 ? 'var(--ok)' : v >= 0.6 ? 'var(--warn)' : 'var(--bad)');
  const tile = (k, v, sub, cls) => h('div', { class: 'tile gauge' }, h('div', { class: 'k' }, k), h('div', { class: 'big ' + (cls || '') }, v), h('div', { class: 's small muted' }, sub || ''));

  V.mount = (el, param) => {
    if (param && (param === 'hq' || param === 'cloud' || G.SITES[param])) V.sel = param;
    V.el = el;
    const s = G.S;
    const locked = !Q.unlocked(CAT.wan);
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '據點與雲端（WAN）'), h('div', { class: 'desc' }, '集團的工廠與海外辦公室要連回總部的 ERP、檔案與電話；員工也越來越依賴雲端服務。選擇專線（MPLS、IPLC）、網際網路 VPN 或 SD-WAN，在成本、延遲與可靠度之間取捨。')),
      h('div', { class: 'row wrap' }, kbBtn('k-mpls'), kbBtn('k-sdwan'), kbBtn('k-cloud'))));
    if (locked) el.appendChild(h('div', { class: 'note', style: { marginBottom: '10px' } }, `第 ${CAT.wan.unlock} 章解鎖：現在可以先看看，等劇情到了據點才會開始營運。`));
    V.tiles = h('div', { class: 'tiles', style: { marginBottom: '12px' } });
    el.appendChild(V.tiles);
    const mapCard = h('div', { class: 'topo-wrap wan-map' });
    V.svg = U.s('svg', { viewBox: '0 0 900 520', role: 'img', 'aria-label': '據點與線路地圖' });
    mapCard.appendChild(V.svg);
    V.side = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'split' }, h('div', { class: 'col', style: { gap: '10px' } }, mapCard, legend()), V.side));
    drawMap();
    renderSide();
    renderTiles();
  };
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 1200) return;
    V.last = now;
    applyLive();
    renderTiles();
    if (now - (V.lastSide || 0) > 2500 && V.side && !V.side.contains(document.activeElement)) { V.lastSide = now; renderSide(); }
  };

  function legend() {
    const it = (c, t, dash) => h('span', {}, h('i', { style: { background: dash ? 'none' : c, borderTop: dash ? '2px dashed ' + c : null, height: dash ? '0' : '3px', width: '18px', verticalAlign: '3px', borderRadius: '2px' } }), t);
    return h('div', { class: 'legend' }, it(TYPE_COL.mpls, 'MPLS'), it(TYPE_COL.iplc, 'IPLC 國際專線'), it(TYPE_COL.inet, '網際網路 / 寬頻', true), it(TYPE_COL.lte, '4G/5G 備援', true), it(TYPE_COL.dx, '雲端專線'), it('var(--bad)', '中斷 / 滿載'));
  }

  function renderTiles() {
    if (!V.tiles) return;
    const s = G.S, R = G.R.wan || { sites: {} };
    const open = G.Wan.openIds();
    const sats = open.map((id) => R.sites[id]).filter((x) => x && x.sat !== null && x.sat !== undefined);
    const avg = sats.length ? U.sum(sats, (x) => x.sat * x.pres) / Math.max(1, U.sum(sats, (x) => x.pres)) : null;
    const down = open.filter((id) => R.sites[id] && !R.sites[id].up).length;
    let cloud = 0;
    for (const id of ['m365', 'cloudweb', 'cspm', 'cloudbk']) if (Q.hasService(id)) cloud += Q.monthlyServiceCost(id);
    if (s.wan.dx.bw) cloud += CAT.wan.dx.monthly[s.wan.dx.bw];
    U.mount(V.tiles,
      tile('營運中的據點', `${open.length} / ${G.SITE_IDS.length}`, down ? `${down} 個連不回總部` : open.length ? '都連得回總部' : '還沒有據點開幕', down ? 'bad-t' : ''),
      tile('據點滿意度', avg === null ? '—' : U.pct(avg), '依在座人數加權', avg === null ? '' : avg >= 0.8 ? 'ok-t' : avg >= 0.6 ? 'warn-t' : 'bad-t'),
      tile('WAN 月租', U.money(G.Wan.monthly()), '專線、寬頻、SD-WAN 授權'),
      tile('雲端月費', U.money(cloud), Q.hasService('m365') ? '含 Microsoft 365' : '公有雲與 SaaS'));
  }

  /* ---------- 地圖 ---------- */
  function curve(a, b, bend) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    const cx = mx - (dy / L) * bend, cy = my + (dx / L) * bend;
    return { d: `M${a[0]} ${a[1]} Q${cx} ${cy} ${b[0]} ${b[1]}`, mx: (a[0] + 2 * cx + b[0]) / 4, my: (a[1] + 2 * cy + b[1]) / 4 };
  }
  function drawMap() {
    const s = G.S, svg = V.svg;
    U.clear(svg);
    V.refs = { links: [], nodes: {} };
    /* 海與陸地（示意） */
    svg.appendChild(U.s('rect', { x: 0, y: 0, width: 900, height: 520, fill: 'var(--bg-2)' }));
    const land = (d) => svg.appendChild(U.s('path', { d, fill: 'var(--bg-4)', stroke: 'var(--line-2)', 'stroke-width': 1 }));
    land('M612 196 C 640 214, 650 282, 634 336 C 618 390, 588 432, 572 446 C 556 426, 552 374, 560 326 C 568 274, 588 210, 612 196 Z');
    land('M744 30 C 790 52, 836 84, 872 130 L 890 160 C 858 132, 816 104, 772 78 C 758 66, 748 48, 744 30 Z');
    land('M862 176 C 874 186, 884 200, 886 214 C 872 206, 864 194, 862 176 Z');
    land('M170 250 C 196 284, 212 340, 198 392 C 186 436, 160 474, 124 500 L 104 490 C 136 464, 160 430, 168 392 C 176 350, 168 300, 150 268 Z');
    land('M0 40 C 90 60, 200 90, 300 120 C 360 138, 420 170, 470 190 L 480 205 C 420 186, 350 160, 290 142 C 190 110, 90 84, 0 70 Z');
    svg.appendChild(U.s('text', { x: 520, y: 470, 'font-size': 11, fill: 'var(--text-3)', 'letter-spacing': 2 }, '台 灣'));
    svg.appendChild(U.s('text', { x: 118, y: 250, 'font-size': 11, fill: 'var(--text-3)', 'letter-spacing': 2 }, '越 南'));
    svg.appendChild(U.s('text', { x: 780, y: 24, 'font-size': 11, fill: 'var(--text-3)', 'letter-spacing': 2 }, '日 本'));
    const edgeG = U.s('g', {}), nodeG = U.s('g', {});
    svg.append(edgeG, nodeG);
    const mkLink = (a, b, type, bend, info) => {
      const p = curve(a, b, bend);
      const g = U.s('g', { class: 'edge', style: { cursor: 'pointer' } });
      const base = U.s('path', { d: p.d, fill: 'none', stroke: TYPE_COL[type], 'stroke-width': 2.5, 'stroke-dasharray': type === 'inet' ? '7 5' : type === 'lte' ? '2 5' : null, opacity: 0.9, 'stroke-linecap': 'round' });
      const flow = U.s('path', { d: p.d, fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.3, opacity: 0.65, 'stroke-dasharray': '3 9', class: 'flow' });
      const label = U.s('text', { x: p.mx + 4, y: p.my - 4, 'font-size': 10, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, '');
      g.append(base, flow, label);
      if (info.click) g.addEventListener('click', info.click);
      edgeG.appendChild(g);
      V.refs.links.push(Object.assign({ base, flow, label, type }, info));
    };
    /* 總部的出口：ISP、MPLS 匯接、雲端專線 */
    mkLink(POS.HQ, POS.INET, 'isp', 20, { key: 'isp', click: () => sel('hq') });
    if (s.wan.hq.mpls || s.wan.hq.next) mkLink(POS.HQ, POS.MPLS, 'hq', -18, { key: 'wan:hq', click: () => sel('hq') });
    if (s.wan.dx.bw || s.wan.dx.next) mkLink(POS.HQ, POS.CLOUD, 'dx', -14, { key: 'wan:dx', click: () => sel('cloud') });
    mkLink(POS.INET, POS.CLOUD, 'inet', 10, { key: 'wan:cloud', click: () => sel('cloud') });
    for (const id of G.SITE_IDS) {
      const w = s.wan.sites[id];
      for (const l of w.links) {
        const bend = { mpls: 16, iplc: -40, inet: 22, lte: -22 }[l.type];
        const to = l.type === 'mpls' ? POS.MPLS : l.type === 'iplc' ? POS.HQ : POS.INET;
        mkLink(POS[id], to, l.type, bend, { key: `wan:${id}:${l.type === 'lte' ? 'inet' : l.type}`, site: id, l, click: () => sel(id) });
      }
    }
    /* 節點 */
    const node = (id, label, sub, kind) => {
      const [x, y] = POS[id];
      const g = U.s('g', { class: 'node', style: { cursor: 'pointer' } });
      if (kind === 'cloud') {
        for (const [dx, dy, r] of [[-16, 4, 15], [0, -6, 19], [18, 3, 15], [2, 8, 16]]) g.appendChild(U.s('circle', { cx: x + dx, cy: y + dy, r, fill: 'var(--bg-3)', stroke: 'var(--line-2)' }));
      } else if (kind === 'hq') {
        g.appendChild(U.s('rect', { x: x - 13, y: y - 20, width: 26, height: 34, rx: 2, fill: 'var(--bg-3)', stroke: 'var(--accent)', 'stroke-width': 2 }));
        for (let k = 0; k < 4; k++) g.appendChild(U.s('rect', { x: x - 8, y: y - 15 + k * 7, width: 16, height: 4, fill: 'var(--accent-soft)' }));
      } else {
        const ring = U.s('circle', { cx: x, cy: y, r: kind === 'site' ? 13 : 10, fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 2.5 });
        g.appendChild(ring);
        V.refs.nodes[id] = { ring };
      }
      const t1 = U.s('text', { x, y: y + (kind === 'cloud' ? 34 : 30), 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: 'var(--text)' }, label);
      const t2 = U.s('text', { x, y: y + (kind === 'cloud' ? 47 : 43), 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, sub || '');
      g.append(t1, t2);
      if (V.refs.nodes[id]) V.refs.nodes[id].sub = t2; else V.refs.nodes[id] = { sub: t2 };
      g.addEventListener('click', () => sel(id === 'HQ' || id === 'INET' || id === 'MPLS' ? 'hq' : id === 'CLOUD' ? 'cloud' : id));
      nodeG.appendChild(g);
    };
    node('INET', '網際網路', '', 'cloud');
    node('CLOUD', '公有雲', '', 'cloud');
    node('MPLS', 'MPLS 骨幹', '電信業者私有網路', 'wan');
    node('HQ', '總部（台北）', '新曜大樓', 'hq');
    for (const id of G.SITE_IDS) node(id, G.SITES[id].name, '', 'site');
    applyLive();
  }
  function sel(x) { V.sel = x; renderSide(); }

  function applyLive() {
    if (!V.refs) return;
    const s = G.S, R = G.R.wan || { sites: {}, links: {} }, sim = G.R.sim || { wan: {} };
    for (const e of V.refs.links) {
      let util = 0, down = false, lbl = '';
      if (e.key === 'isp') { const w = sim.wan || {}; util = w.cap ? Math.max(w.in, w.out) / w.cap : 0; down = !w.cap; lbl = w.cap ? `ISP ${U.bw(w.cap)} · ${U.pct(util)}` : '沒有 ISP'; }
      else {
        const L = R.links[e.key];
        if (e.l) {
          const T = CAT.wan.types[e.l.type];
          down = e.l.status !== 'active' || e.l.outage || !G.Wan.open(e.site);
          util = L && !down ? L.util : 0;
          const inUse = e.l.type !== 'lte' || (G.Wan.underlay(e.site) && G.Wan.underlay(e.site).type === 'lte');
          lbl = e.l.status === 'pending' ? `${T.short} 開通倒數 ${U.dur(e.l.readyAt - s.time)}` : e.l.outage ? `${T.short} ✖ 中斷` : !inUse ? `${T.short} 待命` : `${T.short} ${U.speed(e.l.bw)} · ${U.pct(util)}`;
        } else if (e.key === 'wan:hq') { const hq = s.wan.hq; down = !hq.mpls || hq.out; util = L ? L.util : 0; lbl = hq.next && !hq.mpls ? `開通倒數 ${U.dur(hq.at - s.time)}` : hq.out ? '✖ 中斷' : `匯接 ${U.speed(hq.mpls)} · ${U.pct(util)}`; }
        else if (e.key === 'wan:dx') { const dx = s.wan.dx; down = !dx.bw || dx.out; util = L ? L.util : 0; lbl = dx.next && !dx.bw ? `開通倒數 ${U.dur(dx.at - s.time)}` : `雲端專線 ${U.speed(dx.bw)} · ${U.pct(util)}`; }
        else if (e.key === 'wan:cloud') { util = 0; lbl = ''; }
      }
      const col = down ? 'var(--text-3)' : util >= 0.9 ? 'var(--bad)' : util >= 0.7 ? 'var(--warn)' : TYPE_COL[e.type];
      e.base.setAttribute('stroke', e.l && e.l.outage ? 'var(--bad)' : col);
      e.base.setAttribute('opacity', down ? 0.45 : 0.9);
      e.flow.style.display = down || util < 0.004 ? 'none' : '';
      e.flow.style.animationDuration = (2.6 - 2.2 * Math.min(1, util)).toFixed(2) + 's';
      e.label.textContent = lbl;
      e.label.setAttribute('fill', util >= 0.9 || (e.l && e.l.outage) ? 'var(--bad)' : 'var(--text-2)');
    }
    for (const id of G.SITE_IDS) {
      const r = V.refs.nodes[id];
      if (!r) continue;
      const x = R.sites[id];
      const open = G.Wan.open(id);
      r.ring.setAttribute('stroke', !open ? 'var(--line-2)' : x && !x.up ? 'var(--bad)' : satCol(x ? x.sat : null));
      r.ring.setAttribute('fill', V.sel === id ? 'var(--accent-soft)' : 'var(--bg-3)');
      const w = s.wan.sites[id];
      r.sub.textContent = !open ? (w.openAt !== null ? `${U.stamp(w.openAt)} 開幕` : '尚未開幕') : x && !x.up ? '連不回總部' : x && x.sat !== null && x.sat !== undefined ? `${U.pct(x.sat)} · ${G.Wan.localClock(id, s.time)}` : G.Wan.localClock(id, s.time);
    }
  }

  /* ---------- 右側面板 ---------- */
  function renderSide() {
    if (!V.side) return;
    const sc = V.side.scrollTop;
    U.clear(V.side);
    if (G.SITES[V.sel]) V.side.appendChild(siteCard(V.sel));
    else if (V.sel === 'hq') V.side.appendChild(hqCard());
    else if (V.sel === 'cloud') V.side.appendChild(cloudCard());
    else V.side.appendChild(overview());
    V.side.scrollTop = sc;
    applyLive();
  }
  function overview() {
    const s = G.S, R = G.R.wan || { sites: {} };
    const card = h('div', { class: 'card col', style: { gap: '8px' } }, h('h3', {}, '據點一覽'), h('div', { class: 'small muted' }, '點地圖上的據點、總部或公有雲看詳情。'));
    for (const id of G.SITE_IDS) {
      const st = G.SITES[id], x = R.sites[id] || {}, w = s.wan.sites[id];
      card.appendChild(h('button', { class: 'btn', 'data-hint': 'wan-site:' + id, style: { justifyContent: 'space-between' }, onclick: () => sel(id) },
        h('span', {}, h('b', {}, st.name), h('span', { class: 'muted small' }, `　${st.city} · ${U.num(st.staff)} 人`)),
        h('span', { class: 'mono small', style: { color: satCol(x.sat) } }, !G.Wan.open(id) ? (w.openAt !== null ? '即將開幕' : '尚未開幕') : x.up === false ? '斷線' : x.sat !== null && x.sat !== undefined ? U.pct(x.sat) : '—')));
    }
    card.append(h('div', { class: 'hr' }),
      h('button', { class: 'btn', 'data-hint': 'wan-site:hq', onclick: () => sel('hq') }, '總部的 WAN 出口（ISP、MPLS 匯接、SD-WAN 集中器）'),
      h('button', { class: 'btn', 'data-hint': 'wan-site:cloud', onclick: () => sel('cloud') }, '雲端服務（Microsoft 365、官網上雲、雲端專線）'));
    return card;
  }

  function siteCard(id) {
    const s = G.S, st = G.SITES[id], w = s.wan.sites[id], x = (G.R.wan && G.R.wan.sites[id]) || {};
    const open = G.Wan.open(id);
    const card = h('div', { class: 'card col', style: { gap: '10px' } });
    card.appendChild(h('div', { class: 'row between' },
      h('div', { class: 'col', style: { gap: 0 } }, h('b', { style: { fontSize: '16px' } }, st.name), h('span', { class: 'small muted' }, `${st.city} · ${U.num(st.staff)} 人 · 當地時間 ${G.Wan.localClock(id, s.time)}`)),
      h('button', { class: 'btn ghost xs', onclick: () => sel('overview') }, '✕')));
    card.appendChild(h('div', { class: 'small muted' }, st.desc));
    if (!open) card.appendChild(h('div', { class: 'note info small' }, w.openAt !== null ? `預計 ${U.stamp(w.openAt)} 開始營運：線路要提早申請（專線要一兩天才開通）。` : '還沒有排定開幕（劇情第七章）。可以先規劃線路。'));
    if (open) {
      card.appendChild(h('div', { class: 'kv' },
        h('span', { class: 'k' }, '在座'), h('span', { class: 'v mono' }, `${Math.round(x.pres || 0)} 人`),
        h('span', { class: 'k' }, '滿意度'), h('span', { class: 'v mono', style: { color: satCol(x.sat) } }, x.sat !== null && x.sat !== undefined ? U.pct(x.sat) : '—'),
        h('span', { class: 'k' }, 'ERP 往返延遲'), h('span', { class: 'v mono ' + (x.erpRtt > 100 ? 'bad-t' : x.erpRtt > 60 ? 'warn-t' : '') }, x.cls && x.cls.erp && x.cls.erp.path ? `${Math.round(x.erpRtt)} ms` : '—'),
        x.mos !== undefined ? h('span', { class: 'k' }, '分機通話 MOS') : null, x.mos !== undefined ? h('span', { class: 'v mono' }, x.mos.toFixed(2)) : null));
      if (x.lineStop) card.appendChild(h('div', { class: 'note bad small' }, '產線的 MES 查不到總部的 ERP：產線停擺中！'));
      if (x.converging) card.appendChild(h('div', { class: 'note warn small' }, '主線路中斷：路由收斂中，約幾分鐘後改走備援（有 SD-WAN 的話會瞬間切換）。'));
      const rows = CLS.map(([k, nm]) => {
        const c = x.cls ? x.cls[k] : null;
        const ok = c && c.path && !c.blocked && c.ratio > 0.05;
        return h('tr', {}, h('td', {}, nm), h('td', { class: 'small' }, c ? PATH_NAME[c.path] : '—'),
          h('td', { class: 'mono small ' + (!c || !c.path || c.blocked ? 'bad-t' : c.ratio < 0.9 ? 'warn-t' : 'ok-t') }, !c ? '—' : c.blocked ? (c.blocked === 'fw' ? '防火牆擋下' : '不通') : !c.path ? '不通' : U.pct(c.ratio)),
          h('td', { class: 'mono small' }, ok ? `${Math.round(c.rtt)} ms` : '—'));
      });
      card.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '4px' } }, '每類應用走哪條路'),
        h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['應用', '路徑', '送達', '延遲'].map((t) => h('th', {}, t)))), h('tbody', {}, rows)))));
      const blockedFw = CLS.some(([k]) => x.cls && x.cls[k] && x.cls[k].blocked === 'fw');
      if (blockedFw) card.appendChild(h('div', { class: 'note warn small' }, '防火牆擋下了據點的流量：新增 WAN → SERVERS 的 SQL、SMB、LDAP、DNS（拉回總部上網的話，還要 WAN → INTERNET：WEB）。', h('button', { class: 'btn xs', style: { marginLeft: '6px' }, onclick: () => UI.go('fw') }, '前往防火牆')));
    }
    /* 線路 */
    const lines = h('div', { class: 'col', style: { gap: '6px' } }, h('div', { class: 'label' }, '線路'));
    if (!w.links.length) lines.appendChild(h('div', { class: 'small dim' }, '還沒有任何線路。'));
    for (const l of w.links) {
      const T = CAT.wan.types[l.type], L = G.R.wan && G.R.wan.links[`wan:${id}:${l.type === 'lte' ? 'inet' : l.type}`];
      const stt = l.status === 'pending' ? `開通倒數 ${U.dur(l.readyAt - s.time)}` : l.outage ? '中斷' : L ? `使用率 ${U.pct(L.util)}` : '待命';
      lines.appendChild(h('div', { class: 'row between small' },
        h('span', {}, h('i', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: T.color, marginRight: '6px' } }), h('b', {}, `${T.short} ${U.speed(l.bw)}`), h('span', { class: 'muted' }, `　${U.money(CAT.wan.price(l.type, l.bw, st.intl))}/月`)),
        h('span', { class: 'row' }, h('span', { class: 'mono ' + (l.outage ? 'bad-t' : L && L.util >= 0.9 ? 'bad-t' : '') }, stt),
          h('button', { class: 'btn xs danger', onclick: () => UI.confirm('終止線路', `終止 ${st.name} 的 ${T.name}？`, '終止', () => UI.res(G.Wan.cancel(id, l.id)), 'danger') }, '終止'))));
    }
    card.appendChild(lines);
    /* 申請 */
    const o = V.order[id] || (V.order[id] = { type: st.intl ? 'iplc' : 'mpls', bw: 100 });
    const types = Object.entries(CAT.wan.types).filter(([k, T]) => !T.intlOnly || st.intl);
    if (!CAT.wan.types[o.type].bws.includes(o.bw)) o.bw = CAT.wan.types[o.type].bws[0];
    const T = CAT.wan.types[o.type];
    card.appendChild(h('div', { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'label' }, '申請線路'),
      h('div', { class: 'seg' }, types.map(([k, t]) => h('button', { class: o.type === k ? 'on' : '', 'data-hint': 'wan-type:' + k + '@' + id, onclick: () => { o.type = k; renderSide(); } }, t.short))),
      h('div', { class: 'small muted' }, T.desc),
      h('div', { class: 'row wrap' },
        h('div', { class: 'seg' }, T.bws.map((b) => h('button', { class: o.bw === b ? 'on' : '', onclick: () => { o.bw = b; renderSide(); } }, U.speed(b)))),
        h('span', { class: 'mono small' }, `${U.money(CAT.wan.price(o.type, o.bw, st.intl))}/月 · 開通 ${U.dur(T.lead)}`),
        h('button', { class: 'btn primary sm', 'data-hint': 'wan-order@' + id, disabled: !Q.unlocked(CAT.wan) || null, onclick: () => UI.res(G.Wan.order(id, o.type, o.bw)) }, '申請'))));
    /* SD-WAN / VPN */
    const hub = G.Wan.hubs().length > 0;
    card.appendChild(h('div', { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'label' }, '連回總部的方式'),
      h('label', { class: 'row small', 'data-hint': 'sdwan:' + id }, h('input', { type: 'checkbox', checked: w.sdwan, disabled: !Q.unlocked(CAT.wan) || null, onchange: (e) => UI.res(G.Wan.setSdwan(id, e.target.checked)) }),
        `SD-WAN（${U.money(CAT.wan.sdwan.perSite)}/月）：依應用程式自動選路、斷線瞬間切換、上網就近從據點出去`),
      w.sdwan && !hub ? h('div', { class: 'note warn small' }, '總部還沒有 SD-WAN 集中器（SDW-1，或 SD-WAN 角色的 VM）：據點的隧道沒有地方可以連。') : null,
      h('label', { class: 'row small', 'data-hint': 'vpn:' + id }, h('input', { type: 'checkbox', checked: w.vpn, onchange: (e) => UI.res(G.Wan.setVpn(id, e.target.checked)) }),
        'IPsec VPN（免費）：經網際網路連回總部防火牆，當作專線的備援（要等路由收斂才切換）')));
    return card;
  }

  function hqCard() {
    const s = G.S, hq = s.wan.hq, L = G.R.wan && G.R.wan.links['wan:hq'];
    const hubs = G.Wan.hubs();
    const card = h('div', { class: 'card col', style: { gap: '10px' } },
      h('div', { class: 'row between' }, h('b', { style: { fontSize: '16px' } }, '總部的 WAN 出口'), h('button', { class: 'btn ghost xs', onclick: () => sel('overview') }, '✕')));
    const sim = G.R.sim || { wan: {} };
    card.appendChild(h('div', { class: 'kv' },
      h('span', { class: 'k' }, 'ISP 對外頻寬'), h('span', { class: 'v mono' }, sim.wan && sim.wan.cap ? `${U.bw(sim.wan.cap)} · 使用率 ${U.pct(Math.max(sim.wan.in, sim.wan.out) / sim.wan.cap)}` : '沒有 ISP'),
      h('span', { class: 'k' }, 'MPLS 匯接'), h('span', { class: 'v mono' }, hq.mpls ? `${U.speed(hq.mpls)}${L ? ' · 使用率 ' + U.pct(L.util) : ''}${hq.out ? '（中斷）' : ''}` : hq.next ? `開通倒數 ${U.dur(hq.at - s.time)}` : '沒有'),
      h('span', { class: 'k' }, 'SD-WAN 集中器'), h('span', { class: 'v' }, hubs.length ? hubs.map((d) => `${d.name}（${UI.devStatus(d).t}）`).join('、') : '沒有')));
    card.appendChild(h('div', { class: 'small muted' }, '走網際網路的 VPN / SD-WAN 隧道，會用到總部的 ISP 頻寬與防火牆效能；MPLS 與 IPLC 則是另外的線路，接在邊界路由器上。據點進來的流量在防火牆上是「WAN」區域。'));
    card.appendChild(h('div', { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'label' }, 'MPLS 匯接（所有 MPLS 據點共用）'),
      h('div', { class: 'row wrap' }, CAT.wan.hqMpls.bws.map((b) => h('button', { class: 'btn xs' + (hq.mpls === b ? ' on' : ''), 'data-hint': 'hqmpls:' + b, disabled: !Q.unlocked(CAT.wan) || null, onclick: () => UI.res(G.Wan.orderHq(b)) }, `${U.speed(b)} · ${U.money(b * CAT.wan.hqMpls.perMbps)}/月`))),
      hq.mpls ? h('button', { class: 'btn danger xs', style: { alignSelf: 'flex-start' }, onclick: () => UI.confirm('終止 MPLS 匯接', '所有 MPLS 據點都會斷線。', '終止', () => UI.res(G.Wan.cancelHq()), 'danger') }, '終止') : null));
    card.appendChild(h('div', { class: 'row wrap' },
      h('button', { class: 'btn sm', onclick: () => UI.go('shop:isp') }, 'ISP 專線'),
      h('button', { class: 'btn sm', onclick: () => UI.go('shop:sys') }, '採購 SD-WAN 集中器'),
      Q.unlocked(CAT.devices.VM) && G.VM.hosts().length ? h('button', { class: 'btn sm', onclick: () => UI.res(G.VM.create('sdwan')) }, '建立 SD-WAN VM') : null,
      h('button', { class: 'btn sm', onclick: () => UI.go('fw') }, '防火牆規則')));
    return card;
  }

  function cloudCard() {
    const s = G.S, dx = s.wan.dx, L = G.R.wan && G.R.wan.links['wan:dx'];
    const card = h('div', { class: 'card col', style: { gap: '10px' } },
      h('div', { class: 'row between' }, h('b', { style: { fontSize: '16px' } }, '雲端服務'), h('button', { class: 'btn ghost xs', onclick: () => sel('overview') }, '✕')),
      h('div', { class: 'small muted' }, '上雲不是把問題丟給雲端：網路頻寬、存取權限、資料備份、費用控管，都還是 IT 的責任（責任共擔模型）。'));
    for (const id of ['m365', 'cloudweb', 'cloudbk', 'cspm']) {
      const svc = CAT.services[id], on = Q.hasService(id), locked = !Q.unlocked(svc);
      card.appendChild(h('div', { class: 'col', style: { gap: '4px', borderTop: '1px solid var(--line)', paddingTop: '8px' } },
        h('div', { class: 'row between' }, h('b', { class: 'small' }, svc.name), h('button', { class: 'btn xs ' + (on ? 'danger' : 'primary'), 'data-hint': 'svc:' + id, disabled: locked || null, onclick: () => UI.res(on ? G.Act.unsubscribe(id) : G.Act.subscribe(id)) }, on ? '停用' : locked ? `第 ${svc.unlock} 章` : `啟用（${U.money(Q.monthlyServiceCost(id))}/月）`)),
        h('div', { class: 'tiny muted' }, svc.desc)));
    }
    card.appendChild(h('div', { class: 'col', style: { gap: '6px', borderTop: '1px solid var(--line)', paddingTop: '8px' } },
      h('b', { class: 'small' }, '雲端專線（Direct Connect / ExpressRoute）'),
      h('div', { class: 'tiny muted' }, '從總部路由器拉一條專線直接進雲端：官網連回資料庫、雲端備份都走這條，不佔用網際網路頻寬、延遲穩定。'),
      h('div', { class: 'row wrap' }, CAT.wan.dx.bws.map((b) => h('button', { class: 'btn xs' + (dx.bw === b ? ' on' : ''), disabled: !Q.unlocked(CAT.wan) || null, onclick: () => UI.res(G.Wan.orderDx(b)) }, `${U.speed(b)} · ${U.money(CAT.wan.dx.monthly[b])}/月`)),
        dx.bw ? h('button', { class: 'btn danger xs', onclick: () => UI.res(G.Wan.cancelDx()) }, '終止') : null),
      h('div', { class: 'small mono' }, dx.bw ? `${U.speed(dx.bw)} · ${L ? '使用率 ' + U.pct(L.util) : '待命'}` : dx.next ? `開通倒數 ${U.dur(dx.at - s.time)}` : '沒有雲端專線')));
    return card;
  }
})(window.G = window.G || {});
