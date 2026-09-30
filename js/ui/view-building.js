/* 大樓總覽：大樓剖面（亮燈 = 進駐人數、顏色 = 滿意度、右側 = 弱電豎井的主幹線）與樓層清單 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = {};
  G.Views.building = V;

  V.floorStatus = (fid) => {
    const s = G.S, fs = s.floors[fid];
    if (fs.cabling.status === 'none' && fs.idf.count === 0 && !fs.aps.length) return { t: '未佈建', c: '' };
    if (fs.cabling.status === 'building') return { t: `布線中 ${U.dur(fs.cabling.readyAt - s.time)}`, c: 'info' };
    if (fs.cabling.status === 'diy') { const p = G.Diy.progress(fid); return { t: `自己布線中 ${p.pulled}/${p.total}`, c: 'info' }; }
    if (fs.cabling.status === 'none') return { t: '缺水平布線', c: 'warn' };
    if (fs.idf.count === 0) return { t: '缺接入交換器', c: 'warn' };
    const ups = Q.linksOf('F:' + fid);
    if (!ups.length) return { t: '缺上行主幹', c: 'warn' };
    if (!G.Net.floorUp(fid)) return { t: fs.movedIn ? '斷線' : '離線', c: 'bad' };
    if (!ups.some((l) => G.Net.linkUp(l))) return { t: ups.some((l) => G.Net.linkBuilding(l)) ? '主幹施工中' : '上行中斷', c: ups.some((l) => G.Net.linkBuilding(l)) ? 'info' : 'bad' };
    return { t: '上線', c: 'ok' };
  };
  const satColor = (v) => (v === null || v === undefined ? 'var(--text-3)' : v >= 0.8 ? 'var(--ok)' : v >= 0.6 ? 'var(--warn)' : 'var(--bad)');

  V.mount = (el) => {
    V.el = el;
    const use3d = UI.pref3d('bld');
    V.sum = h('div', { class: 'row wrap' });
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '大樓總覽'), h('div', { class: 'desc' }, use3d
        ? '3D 剖面：窗戶亮燈 = 進駐人數、顏色 = 滿意度。右前角的弱電豎井裡是各樓層連回 B1 的主幹線，光點代表流量；已偵測到的駭客攻擊會以紅色路徑顯示。點一下樓層看資訊並可進入規劃，點兩下拉近。'
        : `新曜大樓地上 ${G.BLD.top} 層（22F、23F 是員工餐廳）+ B1 機房 + B2 員工停車場。每層樓的 IDF 透過弱電豎井裡的主幹線，連回 B1 機房的核心交換器。點選樓層進入規劃。`)),
      h('div', { class: 'row wrap' }, UI.toggle3d('bld'), V.sum)));
    V.table = h('div', { class: 'card', style: { padding: '4px 6px' } });
    if (use3d) {
      V.tower = null;
      el.appendChild(h('div', { class: 'bld b3d' }, h('div', { class: 'card card-3d' }, tower3d()), V.table));
    } else {
      V.tower = h('div', { class: 'tower card' });
      el.appendChild(h('div', { class: 'bld' }, V.tower, V.table));
    }
    V.last = 0;
    V.render();
  };
  /** 3D 大樓：畫面重繪時沿用同一個場景 */
  function tower3d() {
    if (V.m3d && !V.m3d.m3dDead) { V.m3d.m3dStage.poke(); return V.m3d; }
    V.m3d = G.M3.tower({
      height: window.innerWidth < 760 ? '460px' : 'clamp(480px, 72vh, 760px)',
      onFloor: (fid) => UI.go('floor:' + fid),
      onFloor3d: (fid) => { UI.pref3d('floor', true); UI.go('floor:' + fid); },
      onRack: () => UI.go('rack'),
      onDev: (id) => { const d = G.S.devices[id], R = G.Views.rack; if (d && R) { R.sel = id; if (d.rack) R.rack = d.rack; } UI.go('rack'); },
      onTopo: () => UI.go('topo'),
      onInc: () => UI.go('inc'),
      onFab: () => UI.go('fab'),
    });
    return V.m3d;
  }
  V.update = () => { const now = performance.now(); if (now - V.last < 1000) return; V.render(); };

  V.render = () => {
    V.last = performance.now();
    const s = G.S, sim = G.R.sim || { floors: {} };
    const emp = Q.employees();
    const upN = G.BLD.hq.filter((f) => G.Net.floorUp(f.id)).length;
    const hqEmp = U.sum(G.BLD.hq, (f) => s.floors[f.id].movedIn);
    U.mount(V.sum,
      h('span', { class: 'chip' }, `員工 ${U.num(hqEmp)} / ${U.num(G.BLD.hqStaff)}`),
      h('span', { class: 'chip ' + (upN === G.BLD.hq.length ? 'ok' : '') }, `上線樓層 ${upN} / ${G.BLD.hq.length}`),
      sim.sat !== null && sim.sat !== undefined ? h('span', { class: 'chip ' + (sim.sat >= 0.8 ? 'ok' : sim.sat >= 0.6 ? 'warn' : 'bad') }, `滿意度 ${U.pct(sim.sat)}`) : null);
    if (V.tower) U.mount(V.tower, tower());
    U.mount(V.table, table());
  };

  function tower() {
    const s = G.S, sim = G.R.sim || { floors: {}, links: {} };
    /* 地上樓層由上往下畫，B1 機房在地面線下，地下停車場再往下 */
    const floors = G.BLD.hq.filter((f) => f.level > 0).reverse();
    const under = G.BLD.hq.filter((f) => f.level < 0).sort((a, b) => b.level - a.level);
    /* 晶圓廠動工後：右邊多畫大樓後方的晶圓廠（開廠後校園光纖從 B1 接過去） */
    const showFab = Q.unlocked(CAT.fab) || G.Fab.buildProgress() > 0;
    const FH = 17, top = 30, W = showFab ? 300 : 214;
    const baseY = top + floors.length * FH;
    const H = baseY + 64 + under.length * (FH + 4);
    const svg = U.s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '大樓剖面圖' });
    svg.appendChild(U.s('path', { d: `M24 ${top - 3} L30 ${top - 16} H150 L156 ${top - 3} Z`, fill: 'var(--bg-4)', stroke: 'var(--line-2)' }));
    svg.appendChild(U.s('text', { x: 90, y: top - 6.5, 'text-anchor': 'middle', 'font-size': 8, fill: 'var(--text-3)', 'font-family': 'var(--font-mono)', 'letter-spacing': 2 }, 'NOVALUX'));
    svg.appendChild(U.s('line', { x1: 140, y1: top - 16, x2: 140, y2: 4, stroke: 'var(--line-2)' }));
    svg.appendChild(U.s('circle', { cx: 140, cy: 4, r: 1.8, fill: 'var(--bad)' }));
    svg.appendChild(U.s('rect', { x: 164, y: top - 2, width: 44, height: baseY - top + 12, fill: 'var(--bg)', stroke: 'var(--line)', rx: 2 }));
    svg.appendChild(U.s('text', { x: 186, y: top - 5, 'text-anchor': 'middle', 'font-size': 6.5, fill: 'var(--text-3)' }, '弱電豎井'));
    let lane = 0;
    const rowY = (f, i) => (f.level > 0 ? top + i * FH : baseY + 58 + i * (FH + 4));
    floors.concat(under).forEach((f, idx) => {
      const i = f.level > 0 ? idx : idx - floors.length;
      const y = rowY(f, i);
      const fs = s.floors[f.id], st = sim.floors[f.id];
      const up = G.Net.floorUp(f.id);
      const sat = st && st.present > 1 ? st.sat : null;
      const fty = G.FT[f.type];
      /* 餐廳：開張後亮一點，用餐人潮越多越亮 */
      const lit = fty.dine ? (fs.movedIn > 0 ? Math.round(2 + 8 * Math.min(1, (st ? st.diners || 0 : 0) / fty.diners)) : 0)
        : fty.park ? (fs.movedIn > 0 && G.M3 && G.M3.parkFill ? Math.round(1 + 9 * G.M3.parkFill(s.time)) : 0) : Math.round((fs.movedIn / f.staff) * 10);
      const col = fs.movedIn > 0 && !up ? 'var(--bad)' : satColor(sat === null ? (up ? 0.9 : null) : sat);
      const g = U.s('g', { class: 'fl', onclick: () => UI.go('floor:' + f.id) });
      g.appendChild(U.s('title', {}, `${f.id} ${f.dept}`));
      g.appendChild(U.s('rect', { x: 24, y, width: 132, height: FH - 3, fill: 'var(--bg-3)', stroke: 'var(--line)' }));
      for (let k = 0; k < 10; k++) {
        g.appendChild(U.s('rect', { class: 'win', x: 27 + k * 12.8, y: y + 2.5, width: 10, height: FH - 8, rx: 1, fill: k < lit ? col : 'var(--bg-4)', stroke: 'none' }));
      }
      g.appendChild(U.s('text', { x: 19, y: y + FH / 2 + 1, 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': 8.5, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, f.id));
      const stt = V.floorStatus(f.id);
      const dc = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)' }[stt.c] || 'var(--line-2)';
      g.appendChild(U.s('circle', { cx: 160, cy: y + FH / 2 - 1, r: 2.3, fill: dc }));
      svg.appendChild(g);
      for (const l of Q.linksOf('F:' + f.id)) {
        const ls = sim.links[l.id];
        const x = 168 + (lane % 22) * 1.75;
        lane++;
        const bad = l.status !== 'up' || (ls && ls.util >= 0.9);
        const stroke = bad ? 'var(--bad)' : G.Net.linkBuilding(l) ? 'var(--text-3)' : CAT.cables[l.cable].color;
        svg.appendChild(U.s('path', { d: `M156 ${y + FH / 2 - 1} H${x} V${baseY + 12}`, fill: 'none', stroke, 'stroke-width': Math.min(1.6, 0.7 + l.count * 0.25), opacity: 0.9, 'stroke-dasharray': G.Net.linkBuilding(l) ? '2 2' : null }));
      }
    });
    const b1 = U.s('g', { class: 'fl', onclick: () => UI.go('rack') });
    b1.appendChild(U.s('rect', { x: 12, y: baseY + 12, width: 196, height: 40, rx: 3, fill: 'var(--bg-4)', stroke: 'var(--accent)' }));
    b1.appendChild(U.s('text', { x: 22, y: baseY + 28, 'font-size': 10, fill: 'var(--text)', 'font-weight': 700 }, 'B1 主機房 MDF'));
    const fac = G.R.fac || { itLoad: 0 };
    b1.appendChild(U.s('text', { x: 22, y: baseY + 43, 'font-size': 8, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, `${s.racks.length} 座機櫃 · ${((fac.itLoad + (fac.aiLoad || 0)) / 1000).toFixed(1)} kW · ${s.temp.toFixed(1)}°C`));
    for (let k = 0; k < Math.min(8, s.racks.length); k++) b1.appendChild(U.s('rect', { x: 150 + k * 6.5, y: baseY + 18, width: 5, height: 28, fill: 'var(--jack)', stroke: 'var(--line-2)', 'stroke-width': 0.5 }));
    svg.appendChild(b1);
    svg.appendChild(U.s('line', { x1: 0, y1: baseY + 8, x2: W, y2: baseY + 8, stroke: 'var(--line-2)', 'stroke-dasharray': '3 2' }));
    if (showFab) {
      const open = !!(s.fab && s.fab.open), R = G.R.fab;
      const fx0 = 226, fw = 68, fh = 54, fy = baseY + 8 - fh;
      const g = U.s('g', { class: 'fl', onclick: () => UI.go(open ? 'fab' : 'building') });
      g.appendChild(U.s('title', {}, 'Fab 1 晶圓廠（大樓後方）'));
      /* 開廠前：工程進度由下往上填滿（虛線框 = 還是工地） */
      const prog = G.Fab.buildProgress();
      g.appendChild(U.s('rect', { x: fx0, y: fy, width: fw, height: fh, rx: 2, fill: open ? 'var(--bg-3)' : 'none', stroke: open ? 'var(--accent)' : 'var(--line-2)', 'stroke-dasharray': open ? null : '3 2' }));
      if (!open && prog > 0) g.appendChild(U.s('rect', { x: fx0 + 1, y: fy + fh - (fh - 2) * prog - 1, width: fw - 2, height: (fh - 2) * prog, fill: 'var(--warn)', opacity: 0.16 }));
      g.appendChild(U.s('text', { x: fx0 + fw / 2, y: fy + 15, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: 'var(--text)' }, 'Fab 1'));
      g.appendChild(U.s('text', { x: fx0 + fw / 2, y: fy + 27, 'text-anchor': 'middle', 'font-size': 7, fill: 'var(--text-2)' }, open ? '晶圓廠' : prog > 0 ? `興建中 ${U.pct(prog)}` : '預定地'));
      if (open) {
        const c = R && R.itStop ? 'var(--bad)' : R && R.rate >= CAT.fab.wspd * 0.8 ? 'var(--ok)' : 'var(--warn)';
        g.appendChild(U.s('circle', { cx: fx0 + fw - 7, cy: fy + 7, r: 2.6, fill: c }));
        g.appendChild(U.s('text', { x: fx0 + fw / 2, y: fy + 42, 'text-anchor': 'middle', 'font-size': 7.5, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, R && R.online ? `${U.num(Math.round(R.rate))} 片/日` : '進機中'));
      }
      svg.appendChild(g);
      /* 校園光纖：B1 → 地下管溝 → FAB IDF */
      Q.linksOf('F:FAB').forEach((l, k) => {
        const ls = sim.links[l.id];
        const bad = l.status !== 'up' || (ls && ls.util >= 0.9);
        const stroke = bad ? 'var(--bad)' : G.Net.linkBuilding(l) ? 'var(--text-3)' : CAT.cables[l.cable].color;
        svg.appendChild(U.s('path', { d: `M208 ${baseY + 30 + k * 2} H${218 + k * 2} V${baseY + 4} H${fx0 + 8}`, fill: 'none', stroke, 'stroke-width': 1.2, 'stroke-dasharray': G.Net.linkBuilding(l) ? '2 2' : null }));
      });
    }
    return svg;
  }

  function table() {
    const s = G.S, sim = G.R.sim || { floors: {}, links: {} };
    const tb = h('tbody', {});
    /* 大樓樓層由上往下；第十章起最後面是大樓後方的晶圓廠 */
    const list = G.BLD.hq.slice().reverse();
    if (Q.unlocked(CAT.fab) || (s.fab && s.fab.open)) list.push(...G.BLD.fab);
    for (const f of list) {
      const fs = s.floors[f.id], st = sim.floors[f.id], ft = G.FT[f.type];
      if (ft.fab) tb.appendChild(h('tr', { class: 'sep' }, h('td', { colspan: 7, class: 'small muted' }, '大樓後方 · Fab 1 晶圓廠（經校園光纖連回 B1）')));
      const stt = V.floorStatus(f.id);
      let people;
      if (fs.movedIn >= f.staff) people = U.num(f.staff);
      else if (fs.movedIn > 0) people = `${U.num(fs.movedIn)} / ${U.num(f.staff)}`;
      else if (fs.moveInAt !== null) people = h('span', { class: fs.moveInAt - s.time < 720 && stt.c !== 'ok' ? 'bad-t' : 'muted' }, `${U.stamp(fs.moveInAt)} 進駐`);
      else people = h('span', { class: 'dim' }, `${U.num(f.staff)}（未排定）`);
      const sat = st && st.present > 1 ? st.sat : null;
      const up = G.Net.floorUp(f.id);
      const wr = G.Wifi.get(f.id, G.Wifi.powered(f.id, up));
      const links = Q.linksOf('F:' + f.id);
      const cap = U.sum(links.filter((l) => l.status === 'up'), (l) => l.speed * l.count);
      const util = Math.max(0, ...links.map((l) => (sim.links[l.id] ? sim.links[l.id].util : 0)));
      tb.appendChild(h('tr', { class: 'click', onclick: () => UI.go('floor:' + f.id) },
        h('td', { class: 'mono' }, h('b', {}, f.id)),
        h('td', {}, h('span', { class: 'ftype', style: { background: ft.color } }), f.dept),
        h('td', { class: 'mono small' }, people),
        h('td', {}, h('span', { class: 'chip ' + stt.c }, stt.t)),
        ft.fab ? h('td', { class: 'mono small' }, G.R.fab && G.R.fab.online ? `產能 ${U.num(Math.round(G.R.fab.rate))} 片 / 日` : h('span', { class: 'dim' }, '—'))
          : h('td', {}, sat === null ? h('span', { class: 'dim' }, '—') : h('div', { class: 'row' }, h('div', { class: 'bar ' + (sat >= 0.8 ? 'ok' : sat >= 0.6 ? 'warn' : 'bad'), style: { width: '54px' } }, h('i', { style: { width: sat * 100 + '%' } })), h('span', { class: 'mono small' }, U.pct(sat)))),
        h('td', { class: 'mono small' }, fs.aps.length ? h('span', { class: wr.good >= 0.9 ? '' : 'warn-t' }, `${U.pct(wr.good)} · ${fs.aps.length} AP`) : h('span', { class: 'dim' }, '—')),
        h('td', { class: 'mono small' }, links.length ? h('span', { class: util >= 0.9 ? 'bad-t' : util >= 0.7 ? 'warn-t' : '' }, `${U.bw(cap)} · ${U.pct(util)}`) : h('span', { class: 'dim' }, '—'))));
    }
    return h('div', { class: 'table-wrap' }, h('table', { class: 't' },
      h('thead', {}, h('tr', {}, ['樓層', '部門', '人數', '狀態', '滿意度', 'Wi-Fi 覆蓋', '上行（使用率）'].map((x) => h('th', {}, x)))), tb));
  }
})(window.G = window.G || {});
