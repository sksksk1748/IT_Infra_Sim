/* 網路拓撲：自動分層排版（外網 → ISP → 路由器 → 防火牆 → 核心 → 樓層 / DMZ / 伺服器區）
 * 線條顏色 = 線材（藍 = 銅纜、水藍 = 多模光纖、黃 = 單模光纖），流動速度 = 使用率，紅 / 橘 = 壅塞
 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { sel: null, connecting: false, from: null, vb: null, refs: null, pos: null };
  G.Views.topo = V;
  const VW = 1240, VH = 780;
  const ZCOL = { outside: '#f07b5a', inside: '#5aa9f0', dmz: '#f2c14e', servers: '#2fc6b8' };

  V.startConnect = (id) => { V.connecting = true; V.from = id || null; if (id) V.sel = { type: 'node', id }; };
  V.stopConnect = () => { V.connecting = false; V.from = null; };

  /* ---------- 排版 ---------- */
  function spread(n, cx, gap) { const out = []; for (let i = 0; i < n; i++) out.push(cx + (i - (n - 1) / 2) * gap); return out; }
  function layout() {
    const s = G.S;
    const pos = {};
    const zones = G.Net.zones();
    const devs = Object.values(s.devices).filter((d) => d.rack && CAT.devices[d.model].cat !== 'ups');
    const cat = (d) => CAT.devices[d.model].cat;
    const hasLinks = (id) => Q.linksOf(id).length > 0 || s.isp.some((c) => c.router === id);
    const byNum = (a, b) => parseInt(a.id.slice(1), 10) - parseInt(b.id.slice(1), 10);
    const routers = devs.filter((d) => cat(d) === 'router').sort(byNum);
    const fws = devs.filter((d) => cat(d) === 'firewall').sort(byNum);
    const core = [], dmz = [], srvSw = [], srv = [], dmzSrv = [], lone = [];
    for (const d of devs.filter((x) => cat(x) === 'switch').sort(byNum)) {
      const ls = Q.linksOf(d.id);
      if (!ls.length) { lone.push(d); continue; }
      if (ls.some((l) => l.zone === 'dmz' && Q.nodeKind(Q.other(l, d.id)) === 'firewall')) dmz.push(d);
      else if (Q.isL3(d) || ls.some((l) => ['floor', 'firewall', 'router'].includes(Q.nodeKind(Q.other(l, d.id))))) core.push(d);
      else srvSw.push(d);
    }
    for (const d of devs.filter((x) => cat(x) === 'server' || cat(x) === 'wlc').sort(byNum)) {
      if (!hasLinks(d.id)) { lone.push(d); continue; }
      const z = zones.get(d.id);
      if (z && z.zone === 'DMZ') dmzSrv.push(d); else srv.push(d);
    }
    for (const d of routers.concat(fws)) if (!hasLinks(d.id)) { /* 仍放在各自層級，方便連線 */ }
    const MAIN = 500;
    pos.INET = { x: MAIN, y: 44, w: 170, h: 48, kind: 'internet' };
    const isps = s.isp.slice();
    spread(isps.length, MAIN, 190).forEach((x, i) => { pos['isp:' + isps[i].id] = { x, y: 132, w: 156, h: 36, kind: 'isp' }; });
    spread(routers.length, MAIN, 210).forEach((x, i) => { pos[routers[i].id] = { x, y: 222, w: 150, h: 44, kind: 'dev' }; });
    spread(fws.length, MAIN, 210).forEach((x, i) => { pos[fws[i].id] = { x, y: 318, w: 150, h: 44, kind: 'dev' }; });
    spread(core.length, MAIN, 230).forEach((x, i) => { pos[core[i].id] = { x, y: 420, w: 150, h: 44, kind: 'dev' }; });
    const floors = G.BLD.floors;
    const perRow = 11;
    floors.forEach((f, i) => {
      const row = Math.floor(i / perRow), col = i % perRow;
      const n = row === 0 ? Math.min(perRow, floors.length) : floors.length - perRow;
      const x = 40 + (col + (perRow - n) / 2) * 88 + 16;
      pos['F:' + f.id] = { x, y: 548 + row * 56, w: 66, h: 32, kind: 'floor' };
    });
    const RX = 1080;
    spread(dmz.length, RX, 150).forEach((x, i) => { pos[dmz[i].id] = { x, y: 300, w: 140, h: 40, kind: 'dev' }; });
    dmzSrv.forEach((d, i) => { pos[d.id] = { x: RX - 70 + (i % 2) * 140, y: 366 + Math.floor(i / 2) * 50, w: 130, h: 40, kind: 'dev' }; });
    const srvTop = Math.max(470, 366 + Math.ceil(dmzSrv.length / 2) * 50 + 50);
    spread(srvSw.length, RX, 150).forEach((x, i) => { pos[srvSw[i].id] = { x, y: srvTop, w: 140, h: 40, kind: 'dev' }; });
    const srvStart = srvSw.length ? srvTop + 64 : srvTop;
    srv.forEach((d, i) => { pos[d.id] = { x: RX - 70 + (i % 2) * 140, y: srvStart + Math.floor(i / 2) * 50, w: 130, h: 40, kind: 'dev' }; });
    const loneY = Math.max(700, srvStart + Math.ceil(srv.length / 2) * 50 + 30);
    lone.forEach((d, i) => { pos[d.id] = { x: 90 + i * 150, y: loneY, w: 136, h: 40, kind: 'dev', lone: true }; });
    const groups = {
      outside: ['INET'].concat(isps.map((c) => 'isp:' + c.id), routers.map((d) => d.id)),
      inside: core.map((d) => d.id).concat(floors.map((f) => 'F:' + f.id)),
      dmz: dmz.concat(dmzSrv).map((d) => d.id),
      servers: srvSw.concat(srv).map((d) => d.id),
    };
    const H = Math.max(VH, loneY + 50);
    return { pos, groups, lone: lone.length, loneY, H };
  }

  /* ---------- 掛載 ---------- */
  V.mount = (el) => {
    V.el = el;
    if (V.sel && V.sel.type === 'node' && !nodeExists(V.sel.id)) V.sel = null;
    if (V.sel && V.sel.type === 'link' && !G.S.links[V.sel.id]) V.sel = null;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '網路拓撲'), h('div', { class: 'desc' }, '點「連線」後依序點選兩個節點即可拉線。線條顏色代表線材，流動速度代表流量，紅色代表壅塞。拖曳空白處平移、滾輪縮放。')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => UI.openKb('k-hier') }, '分層架構'), h('button', { class: 'btn', onclick: () => UI.openKb('k-zones') }, '外網 / DMZ / 內網'))));
    const lay = layout();
    V.pos = lay.pos;
    if (!V.vb || V.vb.baseH !== lay.H) V.vb = { x: 0, y: 0, w: VW, h: lay.H, baseH: lay.H };
    V.svg = U.s('svg', { viewBox: `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`, class: V.connecting ? 'connecting' : '', role: 'img', 'aria-label': '網路拓撲圖' });
    V.hint = h('div', { class: 'topo-hint' + (V.connecting ? '' : ' hidden') }, hintText());
    const tools = h('div', { class: 'topo-tools' },
      h('button', { class: 'btn sm ' + (V.connecting ? 'primary' : ''), onclick: () => { if (V.connecting) V.stopConnect(); else V.startConnect(V.sel && V.sel.type === 'node' ? V.sel.id : null); UI.refresh(); } }, V.connecting ? '取消連線' : '連線'),
      h('button', { class: 'btn sm', onclick: () => zoom(0.8) }, '＋'),
      h('button', { class: 'btn sm', onclick: () => zoom(1.25) }, '－'),
      h('button', { class: 'btn sm', onclick: () => { V.vb = { x: 0, y: 0, w: VW, h: lay.H, baseH: lay.H }; setVb(); } }, '全覽'));
    const wrap = h('div', { class: 'topo-wrap' }, tools, V.svg, V.hint);
    V.insp = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'split' }, h('div', { class: 'col' }, wrap, legend()), V.insp));
    draw(lay);
    bindPanZoom();
    V.renderInsp();
  };
  V.unmount = () => {};

  function nodeExists(id) {
    if (id === 'INET' || id.startsWith('F:')) return true;
    if (id.startsWith('isp:')) return G.S.isp.some((c) => 'isp:' + c.id === id);
    return !!G.S.devices[id];
  }
  function hintText() {
    if (!V.connecting) return '';
    return V.from ? `從「${Q.nodeName(V.from)}」連到…（點選目標節點，Esc 取消）` : '點選第一個節點';
  }
  function legend() {
    const it = (c, t, dash) => h('span', {}, h('i', { style: { background: c, height: '3px', width: '18px', verticalAlign: '3px', borderRadius: '2px', ...(dash ? { background: 'none', borderTop: '2px dashed ' + c } : {}) } }), t);
    return h('div', { class: 'legend' },
      it(CAT.cables.cat6.color, '銅纜 Cat6/6A'), it(CAT.cables.om4.color, '多模光纖 OM4'), it(CAT.cables.os2.color, '單模光纖 OS2'),
      it('var(--warn)', '使用率 ≥ 70%'), it('var(--bad)', '≥ 90% / 中斷'), it('var(--text-3)', '施工中 / 未運作', true));
  }

  /* ---------- 繪製 ---------- */
  function anchor(A, B) {
    const vertical = Math.abs(B.y - A.y) > 26;
    if (vertical) {
      const down = B.y > A.y;
      const ox = U.clamp((B.x - A.x) * 0.12, -A.w / 2 + 10, A.w / 2 - 10);
      return { x: A.x + ox, y: A.y + (down ? A.h / 2 : -A.h / 2), v: true };
    }
    const right = B.x > A.x;
    return { x: A.x + (right ? A.w / 2 : -A.w / 2), y: A.y, v: false };
  }
  function pathBetween(A, B, off) {
    const a = anchor(A, B), b = anchor(B, A);
    a.x += off; b.x += off;
    if (a.v) { const my = (a.y + b.y) / 2; return { d: `M${a.x} ${a.y} C${a.x} ${my} ${b.x} ${my} ${b.x} ${b.y}`, mx: (a.x + b.x) / 2, my, a, b }; }
    const mx = (a.x + b.x) / 2;
    return { d: `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`, mx, my: (a.y + b.y) / 2, a, b };
  }

  function draw(lay) {
    const s = G.S, pos = lay.pos;
    U.clear(V.svg);
    V.refs = { links: {}, nodes: {}, isp: {} };
    const zl = { outside: '外網 INTERNET', inside: '內網 LAN', dmz: 'DMZ 非軍事區', servers: '伺服器區 SERVERS' };
    for (const [k, ids] of Object.entries(lay.groups)) {
      const ps = ids.map((id) => pos[id]).filter(Boolean);
      if (!ps.length) continue;
      const x0 = Math.min(...ps.map((p) => p.x - p.w / 2)) - 16, x1 = Math.max(...ps.map((p) => p.x + p.w / 2)) + 16;
      const y0 = Math.min(...ps.map((p) => p.y - p.h / 2)) - 24, y1 = Math.max(...ps.map((p) => p.y + p.h / 2)) + 12;
      V.svg.appendChild(U.s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 12, fill: G.Charts.withAlpha(ZCOL[k], 0.05), stroke: G.Charts.withAlpha(ZCOL[k], 0.35), 'stroke-dasharray': '6 5' }));
      V.svg.appendChild(U.s('text', { x: x0 + 10, y: y0 + 14, 'font-size': 11, fill: ZCOL[k], 'font-weight': 700, 'letter-spacing': 0.5 }, zl[k]));
    }
    if (lay.lone) V.svg.appendChild(U.s('text', { x: 20, y: lay.loneY - 34, 'font-size': 11, fill: 'var(--text-3)' }, '尚未連線的設備（點選後按「連線」）'));
    const edgeG = U.s('g', {});
    const nodeG = U.s('g', {});
    V.svg.append(edgeG, nodeG);
    /* ISP 邊 */
    for (const c of s.isp) {
      const P = pos['isp:' + c.id];
      if (!P) continue;
      const p1 = pathBetween(pos.INET, P, 0);
      const e1 = mkEdge(edgeG, p1, { color: CAT.cables.os2.color, width: 2 + Math.log2(c.bw / 1000 + 1), key: 'isp:' + c.id, click: () => select({ type: 'node', id: 'isp:' + c.id }) });
      V.refs.isp[c.id] = e1;
      if (c.router && pos[c.router]) {
        const p2 = pathBetween(P, pos[c.router], 0);
        const e2 = mkEdge(edgeG, p2, { color: CAT.cables.os2.color, width: 2, key: 'isph:' + c.id, click: () => select({ type: 'node', id: 'isp:' + c.id }) });
        V.refs.isp[c.id + '#h'] = e2;
      }
    }
    /* 線路 */
    const pairCount = {};
    for (const l of Object.values(s.links)) {
      const A = pos[l.a], B = pos[l.b];
      if (!A || !B) continue;
      const pk = [l.a, l.b].sort().join('|');
      const k = pairCount[pk] = (pairCount[pk] || 0) + 1;
      const off = (k - 1) * 7;
      const p = pathBetween(A, B, off);
      const e = mkEdge(edgeG, p, { color: CAT.cables[l.cable].color, width: 1.2 + Math.log2((l.speed * l.count) / 1000 + 1) * 0.8, key: l.id, click: () => select({ type: 'link', id: l.id }) });
      const fwEnd = Q.nodeKind(l.a) === 'firewall' ? p.a : Q.nodeKind(l.b) === 'firewall' ? p.b : null;
      if (fwEnd && l.zone) {
        const other = fwEnd === p.a ? p.b : p.a;
        const tx = fwEnd.x + (other.x - fwEnd.x) * 0.22, ty = fwEnd.y + (other.y - fwEnd.y) * 0.22;
        edgeG.appendChild(U.s('text', { x: tx + 4, y: ty, 'font-size': 9, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)', 'font-weight': 600 }, { outside: 'OUT', inside: 'IN', dmz: 'DMZ', ha: 'HA' }[l.zone]));
      }
      e.link = l;
      V.refs.links[l.id] = e;
    }
    /* 節點 */
    const inet = pos.INET;
    const gi = U.s('g', { class: 'node' + (V.sel && V.sel.id === 'INET' ? ' sel' : '') });
    gi.appendChild(U.s('rect', { class: 'body', x: inet.x - inet.w / 2, y: inet.y - inet.h / 2, width: inet.w, height: inet.h, rx: 24, fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 1.5 }));
    gi.appendChild(U.s('text', { x: inet.x, y: inet.y - 5, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: 'var(--text)' }, '網際網路'));
    V.refs.inetSub = U.s('text', { x: inet.x, y: inet.y + 12, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, '');
    gi.appendChild(V.refs.inetSub);
    gi.addEventListener('click', (e) => { e.stopPropagation(); nodeClick('INET'); });
    nodeG.appendChild(gi);
    for (const [id, P] of Object.entries(pos)) {
      if (id === 'INET') continue;
      nodeG.appendChild(mkNode(id, P));
    }
    applyLive();
  }

  function mkEdge(parent, p, o) {
    const g = U.s('g', { class: 'edge' });
    const base = U.s('path', { d: p.d, fill: 'none', stroke: o.color, 'stroke-width': o.width, opacity: 0.9, 'stroke-linecap': 'round' });
    const flow = U.s('path', { d: p.d, fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.2, opacity: 0.6, 'stroke-dasharray': '3 9', class: 'flow' });
    const hit = U.s('path', { d: p.d, fill: 'none', stroke: 'transparent', 'stroke-width': 14 });
    const label = U.s('text', { x: p.mx + 5, y: p.my - 4, 'font-size': 9.5, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, '');
    g.append(base, flow, hit, label);
    g.addEventListener('click', (e) => { e.stopPropagation(); o.click(); });
    parent.appendChild(g);
    const sel = V.sel && ((V.sel.type === 'link' && V.sel.id === o.key) || (V.sel.type === 'node' && o.key.startsWith('isp') && V.sel.id === 'isp:' + o.key.split(':')[1]));
    if (sel) base.setAttribute('stroke-width', o.width + 2);
    return { g, base, flow, label, color: o.color, width: o.width, key: o.key };
  }

  function mkNode(id, P) {
    const s = G.S;
    const g = U.s('g', { class: 'node' + (V.sel && V.sel.id === id ? ' sel' : '') + (V.connecting && V.from && V.from !== id && canTarget(V.from, id) ? ' target' : '') });
    const x = P.x - P.w / 2, y = P.y - P.h / 2;
    const body = U.s('rect', { class: 'body', x, y, width: P.w, height: P.h, rx: P.kind === 'floor' ? 5 : 7, fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 1.3 });
    g.appendChild(body);
    const ref = { g, body };
    if (P.kind === 'floor') {
      const fid = id.slice(2);
      ref.fill = U.s('rect', { x: x + 1, y: y + P.h - 5, width: 0, height: 4, rx: 1.5, fill: 'var(--ok)' });
      g.append(U.s('text', { x: P.x, y: P.y - 3, 'text-anchor': 'middle', 'font-size': 11.5, 'font-weight': 700, fill: 'var(--text)', 'font-family': 'var(--font-mono)' }, fid), ref.fill);
      ref.sub = U.s('text', { x: P.x, y: P.y + 9, 'text-anchor': 'middle', 'font-size': 8.5, fill: 'var(--text-3)', 'font-family': 'var(--font-mono)' }, '');
      g.appendChild(ref.sub);
      ref.floor = fid;
    } else if (P.kind === 'isp') {
      const c = s.isp.find((z) => 'isp:' + z.id === id);
      g.appendChild(U.s('rect', { x, y, width: 5, height: P.h, fill: '#f07b5a' }));
      g.appendChild(U.s('text', { x: x + 12, y: P.y - 3, 'font-size': 11, 'font-weight': 700, fill: 'var(--text)' }, `${CAT.isp.providers[c.provider].name} ${c.plan}`));
      ref.sub = U.s('text', { x: x + 12, y: P.y + 11, 'font-size': 9, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, '');
      g.appendChild(ref.sub);
      ref.isp = c.id;
    } else {
      const d = s.devices[id], m = CAT.devices[d.model];
      g.appendChild(U.s('rect', { x, y, width: 5, height: P.h, fill: CAT.categories[m.cat].color }));
      g.appendChild(U.s('text', { x: x + 12, y: P.y - 4, 'font-size': 11.5, 'font-weight': 700, fill: 'var(--text)' }, d.name + (d.role ? ' · ' + CAT.roles[d.role].short : '')));
      ref.sub = U.s('text', { x: x + 12, y: P.y + 11, 'font-size': 9, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, d.model);
      g.appendChild(ref.sub);
      ref.dot = U.s('circle', { cx: x + P.w - 9, cy: y + 9, r: 3.2, fill: 'var(--ok)' });
      g.appendChild(ref.dot);
      ref.dev = id;
    }
    g.addEventListener('click', (e) => { e.stopPropagation(); nodeClick(id); });
    V.refs.nodes[id] = ref;
    return g;
  }

  /* ---------- 即時更新（不重建元素） ---------- */
  function styleEdge(e, util, down, building, dirRev) {
    let col = e.color;
    if (down) col = 'var(--text-3)';
    else if (util >= 0.9) col = 'var(--bad)';
    else if (util >= 0.7) col = 'var(--warn)';
    e.base.setAttribute('stroke', col);
    e.base.setAttribute('stroke-dasharray', down || building ? '5 5' : '');
    e.base.setAttribute('opacity', down ? 0.55 : 0.9);
    if (down || util < 0.005) e.flow.style.display = 'none';
    else {
      e.flow.style.display = '';
      e.flow.style.animationDuration = (2.6 - 2.2 * Math.min(1, util)).toFixed(2) + 's';
      e.flow.style.animationDirection = dirRev ? 'reverse' : 'normal';
    }
  }
  function applyLive() {
    if (!V.refs) return;
    const s = G.S, sim = G.R.sim || { links: {}, isp: {}, floors: {}, nodes: {}, wan: { in: 0, out: 0, cap: 0 } };
    for (const e of Object.values(V.refs.links)) {
      const l = e.link;
      const ls = sim.links[l.id];
      const building = G.Net.linkBuilding(l);
      const down = l.status !== 'up' || building || !(ls && ls.up);
      const util = ls ? ls.util : 0;
      styleEdge(e, util, down, building, ls && ls.ba > ls.ab);
      const isFloor = l.a.startsWith('F:') || l.b.startsWith('F:');
      const selected = V.sel && V.sel.type === 'link' && V.sel.id === l.id;
      const show = !isFloor || selected || util >= 0.7 || l.status === 'cut';
      e.label.textContent = show ? (l.status === 'cut' ? '✖ 中斷' : building ? `施工中 ${U.dur(l.readyAt - s.time)}` : `${U.speed(l.speed)}${l.count > 1 ? '×' + l.count : ''} ${U.pct(util)}`) : '';
      e.label.setAttribute('fill', l.status === 'cut' || util >= 0.9 ? 'var(--bad)' : 'var(--text-2)');
    }
    for (const c of s.isp) {
      const e = V.refs.isp[c.id];
      const is = sim.isp[c.id];
      const up = c.status === 'active' && !c.outage;
      if (e) {
        styleEdge(e, is ? is.util : 0, !up || !(is && is.up), c.status === 'pending', false);
        e.label.textContent = c.status === 'pending' ? `開通倒數 ${U.dur(c.readyAt - s.time)}` : c.outage ? '✖ 中斷' : is && is.standby ? '備援待命' : is ? `↓${U.bw(is.in)} ${U.pct(is.util)}` : '';
      }
      const e2 = V.refs.isp[c.id + '#h'];
      if (e2) styleEdge(e2, is ? is.util : 0, !up || !(is && is.up), false, false);
    }
    if (V.refs.inetSub) V.refs.inetSub.textContent = sim.wan.cap ? `WAN ↓${U.bw(sim.wan.in)} ↑${U.bw(sim.wan.out)}` : '尚未連線';
    for (const [id, r] of Object.entries(V.refs.nodes)) {
      let stroke = 'var(--line-2)';
      if (r.floor) {
        const st = sim.floors[r.floor];
        const fs = s.floors[r.floor];
        const up = G.Net.floorUp(r.floor);
        const util = Math.max(0, ...Q.linksOf(id).map((l) => (sim.links[l.id] ? sim.links[l.id].util : 0)));
        if (fs.movedIn > 0 && !up) stroke = 'var(--bad)';
        else if (up && Q.linksOf(id).some((l) => G.Net.linkUp(l))) stroke = 'var(--ok)';
        else if (fs.idf.count > 0) stroke = 'var(--warn)';
        r.sub.textContent = st && st.present > 1 && st.sat !== null ? `${U.pct(st.sat)} 滿意` : fs.idf.count ? `${fs.idf.count} 台交換器` : '未佈建';
        r.fill.setAttribute('width', Math.max(0, Math.min(1, util)) * 64);
        r.fill.setAttribute('fill', util >= 0.9 ? 'var(--bad)' : util >= 0.7 ? 'var(--warn)' : 'var(--ok)');
      } else if (r.isp) {
        const c = s.isp.find((z) => z.id === r.isp);
        if (!c) continue;
        stroke = c.status === 'pending' ? 'var(--warn)' : c.outage ? 'var(--bad)' : c.router ? 'var(--ok)' : 'var(--warn)';
        r.sub.textContent = c.status === 'pending' ? `開通中 ${U.dur(c.readyAt - s.time)}` : c.outage ? '線路中斷' : c.router ? `→ ${s.devices[c.router] ? s.devices[c.router].name : ''}` : '未接路由器';
      } else if (r.dev) {
        const d = s.devices[r.dev];
        if (!d) continue;
        const st = UI.devStatus(d);
        const standby = sim.graph && sim.graph.standby && sim.graph.standby.has(d.id);
        r.dot.setAttribute('fill', standby ? 'var(--info)' : { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }[st.c] || 'var(--text-3)');
        if (st.c === 'bad') stroke = 'var(--bad)';
        const ni = sim.nodes[d.id];
        const m = CAT.devices[d.model];
        r.sub.textContent = standby ? `${d.model} · Standby` : ni ? `${d.model} · ${U.pct(ni.util)}` : st.c !== 'ok' ? `${d.model} · ${st.t}` : d.role ? m.name.split(' ')[0] : d.model;
        if (ni && ni.util >= 0.9) stroke = 'var(--bad)';
      }
      if (!(V.sel && V.sel.id === id)) r.body.setAttribute('stroke', stroke);
    }
  }
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 700) return;
    V.last = now;
    applyLive();
    if (now - (V.lastInsp || 0) > 1500 && V.insp && !V.insp.contains(document.activeElement)) { V.lastInsp = now; V.renderInsp(); }
  };

  /* ---------- 互動 ---------- */
  function canTarget(from, to) {
    if (from === to) return false;
    const kf = Q.nodeKind(from), kt = Q.nodeKind(to);
    if ((kf === 'isp' && kt === 'router') || (kt === 'isp' && kf === 'router')) return true;
    if (kf === 'isp' || kt === 'isp' || kf === 'internet' || kt === 'internet') return false;
    if (kf === 'floor' && kt === 'floor') return false;
    return true;
  }
  function nodeClick(id) {
    if (V.connecting) {
      if (!V.from) {
        if (id === 'INET') { UI.toast('網際網路節點不能直接連線，請使用 ISP 線路', 'warn'); return; }
        V.from = id; V.sel = { type: 'node', id }; UI.refresh(); return;
      }
      if (id === V.from) { V.from = null; UI.refresh(); return; }
      const a = V.from, b = id;
      const ka = Q.nodeKind(a), kb = Q.nodeKind(b);
      if (ka === 'isp' || kb === 'isp') {
        const ispId = (ka === 'isp' ? a : b).slice(4), rtr = ka === 'isp' ? b : a;
        if (Q.nodeKind(rtr) !== 'router') { UI.toast('ISP 線路只能接到路由器', 'bad'); return; }
        UI.res(G.Act.connectIsp(ispId, rtr));
        V.stopConnect();
        return;
      }
      if (!canTarget(a, b)) { UI.toast('這兩個節點不能直接連線', 'bad'); return; }
      V.stopConnect();
      V.sel = { type: 'node', id: a };
      UI.linkDialog(a, b, null, () => {});
      UI.refresh();
      return;
    }
    select({ type: 'node', id });
  }
  function select(sel) {
    V.sel = sel;
    UI.refresh();
  }
  function setVb() { V.svg.setAttribute('viewBox', `${V.vb.x} ${V.vb.y} ${V.vb.w} ${V.vb.h}`); }
  function zoom(f, cx, cy) {
    const vb = V.vb;
    const nw = U.clamp(vb.w * f, 300, VW * 2), nh = nw * (vb.h / vb.w);
    const px = cx === undefined ? vb.x + vb.w / 2 : cx, py = cy === undefined ? vb.y + vb.h / 2 : cy;
    vb.x = px - (px - vb.x) * (nw / vb.w);
    vb.y = py - (py - vb.y) * (nh / vb.h);
    vb.w = nw; vb.h = nh;
    setVb();
  }
  function bindPanZoom() {
    const svg = V.svg;
    let pan = null;
    svg.addEventListener('pointerdown', (e) => {
      if (e.target.closest && (e.target.closest('.node') || e.target.closest('.edge'))) return;
      pan = { x: e.clientX, y: e.clientY, vx: V.vb.x, vy: V.vb.y, moved: false };
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pan) return;
      const r = svg.getBoundingClientRect();
      const sc = Math.max(V.vb.w / r.width, V.vb.h / r.height);
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
      V.vb.x = pan.vx - dx * sc; V.vb.y = pan.vy - dy * sc;
      setVb();
    });
    const up = () => {
      if (pan && !pan.moved) { if (V.connecting && V.from) { V.from = null; UI.refresh(); } else if (V.sel) { V.sel = null; UI.refresh(); } }
      pan = null;
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', () => { pan = null; });
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM().inverse());
      zoom(Math.pow(1.0015, e.deltaY), p.x, p.y);
    }, { passive: false });
  }

  /* ---------- 檢視器 ---------- */
  V.renderInsp = () => {
    const s = G.S;
    if (!V.insp) return;
    const box = V.insp;
    const sc = box.parentElement ? box.parentElement.scrollTop : 0;
    U.clear(box);
    const sel = V.sel;
    if (!sel) {
      box.appendChild(h('div', { class: 'card' }, h('h3', {}, '拓撲操作'),
        h('ul', { class: 'small muted', style: { paddingLeft: '18px', margin: '8px 0 0' } },
          h('li', {}, '點選節點或線路查看詳細資訊與使用率'),
          h('li', {}, '按「連線」再依序點選兩個節點拉線（樓層 IDF → 核心、核心 → 防火牆、防火牆 → 路由器…）'),
          h('li', {}, '把 ISP 節點連到路由器即可接上專線'),
          h('li', {}, '防火牆的每個介面要指定區域：外部、內部或 DMZ'))));
      return;
    }
    if (sel.type === 'link') {
      const l = s.links[sel.id];
      if (!l) return;
      const ls = (G.R.sim && G.R.sim.links[l.id]) || { ab: 0, ba: 0, util: 0 };
      const cap = l.speed * l.count;
      const dirRow = (from, to, v) => h('div', {},
        h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `${Q.nodeName(from)} → ${Q.nodeName(to)}`), h('span', { class: 'mono' }, `${U.bw(v)} · ${U.pct(v / cap)}`)),
        h('div', { class: 'bar ' + U.utilClass(v / cap) }, h('i', { style: { width: Math.min(100, (v / cap) * 100) + '%' } })));
      box.appendChild(h('div', { class: 'card col', style: { gap: '10px' } },
        h('div', { class: 'row between' }, h('b', {}, '線路'), h('span', { class: 'chip ' + (l.status === 'cut' ? 'bad' : G.Net.linkBuilding(l) ? 'warn' : ls.up ? 'ok' : '') }, l.status === 'cut' ? '中斷' : l.status === 'repair' ? '搶修中' : G.Net.linkBuilding(l) ? `施工中 ${U.dur(l.readyAt - s.time)}` : ls.up ? '運作中' : '未運作')),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '兩端'), h('span', { class: 'v' }, `${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)}`),
          h('span', { class: 'k' }, '規格'), h('span', { class: 'v mono' }, `${CAT.cables[l.cable].name} · ${U.speed(l.speed)} × ${l.count}`),
          h('span', { class: 'k' }, '總頻寬'), h('span', { class: 'v mono' }, U.bw(cap)),
          h('span', { class: 'k' }, '長度'), h('span', { class: 'v mono' }, `${l.len} m`),
          l.zone ? h('span', { class: 'k' }, '防火牆介面') : null, l.zone ? h('span', { class: 'v' }, UI.ZONE_NAMES[l.zone]) : null),
        dirRow(l.a, l.b, ls.ab), dirRow(l.b, l.a, ls.ba),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary sm', onclick: () => UI.linkDialog(l.a, l.b, l.id) }, '編輯 / 升級'),
          l.status === 'cut' ? h('button', { class: 'btn warn sm', onclick: () => UI.res(G.Act.repairLink(l.id)) }, '派員搶修（3 萬）') : null,
          h('button', { class: 'btn danger sm', onclick: () => UI.confirm('拆除線路', '確定拆除這條線路？（不退費）', '拆除', () => { UI.res(G.Act.deleteLink(l.id)); V.sel = null; }, 'danger') }, '拆除'))));
      return;
    }
    const id = sel.id;
    if (id === 'INET') {
      const sim = G.R.sim || { wan: { in: 0, out: 0, cap: 0 } };
      box.appendChild(h('div', { class: 'card col', style: { gap: '8px' } }, h('b', {}, '網際網路'),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, '下行'), h('span', { class: 'v mono' }, U.bw(sim.wan.in)), h('span', { class: 'k' }, '上行'), h('span', { class: 'v mono' }, U.bw(sim.wan.out)), h('span', { class: 'k' }, '可用頻寬'), h('span', { class: 'v mono' }, U.bw(sim.wan.cap))),
        h('button', { class: 'btn primary sm', onclick: () => UI.go('shop:isp') }, '申請 ISP 專線')));
      return;
    }
    if (id.startsWith('isp:')) {
      const c = s.isp.find((z) => 'isp:' + z.id === id);
      if (c) { box.appendChild(UI.ispCard(c)); box.appendChild(h('button', { class: 'btn sm', onclick: () => { V.startConnect(id); UI.refresh(); } }, '在圖上點選路由器來連接')); }
      return;
    }
    if (id.startsWith('F:')) {
      const fid = id.slice(2), f = G.BLD.byId[fid];
      const st = G.R.sim && G.R.sim.floors[fid];
      box.appendChild(h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between' }, h('b', {}, `${fid} ${f.dept}`), h('span', { class: 'chip ' + G.Views.building.floorStatus(fid).c }, G.Views.building.floorStatus(fid).t)),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '在座'), h('span', { class: 'v mono' }, st ? U.num(Math.round(st.present)) : '—'),
          h('span', { class: 'k' }, '滿意度'), h('span', { class: 'v mono' }, st && st.present > 1 && st.sat !== null ? U.pct(st.sat) : '—'),
          h('span', { class: 'k' }, '主幹距離'), h('span', { class: 'v mono' }, `${G.BLD.riserLength(fid)} m`)),
        h('div', {}, h('div', { class: 'label', style: { marginBottom: '4px' } }, '上行埠'), UI.portBars(id)),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn primary sm', onclick: () => UI.go('floor:' + fid) }, '樓層規劃'),
          h('button', { class: 'btn sm', onclick: () => { V.startConnect(id); UI.refresh(); } }, '連線到…'))));
      return;
    }
    if (s.devices[id]) box.appendChild(UI.deviceCard(id, { onConnect: (x) => { V.startConnect(x); UI.refresh(); }, onLink: (lid) => select({ type: 'link', id: lid }) }));
    if (box.parentElement) box.parentElement.scrollTop = sc;
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && V.connecting && G.UI.cur.view === 'topo') { V.stopConnect(); UI.refresh(); }
  });
})(window.G = window.G || {});
