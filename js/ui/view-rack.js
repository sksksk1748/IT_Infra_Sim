/* B1 機房：機櫃正視圖（42U）、上架 / 下架、倉庫、電力與冷卻、機房設施 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { rack: null, sel: null, armed: null };
  G.Views.rack = V;
  const UH = 15, TOP = 14, LEFT = 30, RW = 300;

  V.mount = (el) => {
    const s = G.S;
    V.el = el;
    if (!V.rack || !s.racks.find((r) => r.id === V.rack)) V.rack = s.racks.length ? s.racks[0].id : null;
    if (V.sel && !s.devices[V.sel]) V.sel = null;
    if (V.armed && (!s.devices[V.armed] || s.devices[V.armed].rack)) V.armed = null;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, 'B1 主機房（MDF）'), h('div', { class: 'desc' }, '所有核心設備都要安裝在機櫃中才能通電運作。注意每座機櫃的電力上限，以及整間機房的 UPS 與冷卻能力。')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => UI.openKb('k-rack') }, '機櫃與 U 數'), h('button', { class: 'btn', onclick: () => UI.openKb('k-power') }, '電力'), h('button', { class: 'btn', onclick: () => UI.openKb('k-cooling') }, '冷卻'))));
    V.bar = h('div', { class: 'room-bar' });
    el.appendChild(V.bar);
    const tabs = h('div', { class: 'racks-row' });
    for (const r of s.racks) {
      const fr = G.R.fac && G.R.fac.racks[r.id];
      tabs.appendChild(h('button', { class: 'rack-tab' + (r.id === V.rack ? ' on' : ''), onclick: () => { V.rack = r.id; UI.refresh(); } },
        h('div', { class: 'n' }, r.id), h('div', { class: 'm mono' }, fr ? `${fr.used}U · ${(fr.load / 1000).toFixed(1)} kW` : '')));
    }
    if (s.racks.length < CAT.rack.maxRacks) tabs.appendChild(h('button', { class: 'rack-tab', onclick: () => { const r = UI.res(G.Act.buyRack()); if (r.ok) V.rack = r.id; } }, h('div', { class: 'n' }, '＋ 機櫃'), h('div', { class: 'm mono' }, U.money(CAT.rack.price))));
    el.appendChild(tabs);
    const left = h('div', { class: 'card' });
    const right = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'rack-layout' }, left, right));
    if (!V.rack) left.appendChild(h('div', { class: 'empty' }, h('p', {}, '機房裡還沒有機櫃。'), h('button', { class: 'btn primary', style: { marginTop: '10px' }, onclick: () => { const r = UI.res(G.Act.buyRack()); if (r.ok) V.rack = r.id; } }, `採購 42U 機櫃（${U.money(CAT.rack.price)}）`)));
    else { V.svgWrap = h('div', {}); left.appendChild(V.svgWrap); V.drawRack(); }
    /* 倉庫 */
    const inv = Object.values(s.devices).filter((d) => !d.rack);
    const invCard = h('div', { class: 'card col', style: { gap: '6px' } }, h('div', { class: 'card-h', style: { marginBottom: '2px' } }, h('h3', {}, `倉庫（未上架 ${inv.length}）`), h('button', { class: 'btn ghost xs', onclick: () => UI.go('shop') }, '去採購')));
    if (!inv.length) invCard.appendChild(h('div', { class: 'small dim' }, '買來的設備會先放在這裡，點選後再點機櫃空位安裝。'));
    for (const d of inv) {
      const m = CAT.devices[d.model];
      invCard.appendChild(h('div', { class: 'inv-item' + (V.armed === d.id ? ' armed' : ''), onclick: () => { V.armed = V.armed === d.id ? null : d.id; V.sel = d.id; UI.refresh(); } },
        h('span', { class: 'dot', style: { background: CAT.categories[m.cat].color } }),
        h('span', { class: 'grow' }, h('b', {}, d.name), h('span', { class: 'small muted' }, '　' + m.name)),
        h('span', { class: 'mono small' }, `${m.u}U`),
        h('button', { class: 'btn xs', onclick: (e) => { e.stopPropagation(); UI.res(G.Act.autoInstall(d.id)); } }, '自動上架')));
    }
    if (V.armed) {
      const am = CAT.devices[s.devices[V.armed].model];
      const left = V.rack ? CAT.rack.powerLimit - G.Act.rackLoad(V.rack, V.armed) : 0;
      invCard.appendChild(h('div', { class: 'note ' + (left < am.watts ? 'bad' : 'info') }, left < am.watts
        ? `機櫃 ${V.rack} 的電力只剩 ${Math.max(0, left)} W，放不下 ${s.devices[V.armed].name}（${am.watts} W）。請換一座機櫃或再買一座。`
        : `點選機櫃中亮起的空位來安裝 ${s.devices[V.armed].name}（需要 ${am.u}U、${am.watts} W；這座機櫃還剩 ${left} W）`));
    }
    right.appendChild(invCard);
    if (V.sel && s.devices[V.sel]) right.appendChild(UI.deviceCard(V.sel, { onConnect: (id) => { G.Views.topo.startConnect(id); UI.go('topo'); } }));
    right.appendChild(roomCard());
    V.renderBar();
  };

  V.renderBar = () => {
    const s = G.S, f = G.R.fac;
    if (!f || !V.bar) return;
    const tile = (k, v, sub, cls) => h('div', { class: 'tile gauge' }, h('div', { class: 'k' }, k), h('div', { class: 'big ' + (cls || '') }, v), h('div', { class: 's small muted' }, sub));
    const cool = f.coolingOn ? f.coolCap : 0;
    U.mount(V.bar,
      tile('IT 負載', `${(f.itLoad / 1000).toFixed(1)} kW`, `機櫃 ${s.racks.length} 座 · PUE ${CAT.power.pue}`),
      tile('冷卻能力', `${cool} kW`, `熱負載 ${f.heat.toFixed(1)} kW · N+1 ${f.coolN1 >= f.heat && f.heat > 0 ? '✓' : '✗'}`, f.heat > cool ? 'bad-t' : f.heat > cool * 0.85 ? 'warn-t' : ''),
      tile('機房溫度', `${s.temp.toFixed(1)}°C`, s.temp >= 35 ? '危險！設備開始故障' : s.temp >= 27 ? '偏高（建議 18～27°C）' : '正常', s.temp >= 35 ? 'bad-t' : s.temp >= 27 ? 'warn-t' : 'ok-t'),
      tile('停電續航', f.upsCap <= 0 ? '無 UPS' : f.upsCap < f.itLoad ? 'UPS 不足' : f.gen ? 'UPS + 發電機' : `${Math.round(f.runtime)} 分鐘`, `UPS ${(f.upsCap / 1000).toFixed(0)} kW${f.outage ? ` · 停電中 ${Math.round(s.power.upsCharge * 100)}%` : ''}`, f.upsCap < f.itLoad ? 'bad-t' : ''));
  };
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 1000) return;
    V.last = now;
    V.renderBar();
    if (V.svgWrap) V.drawRack();
  };

  V.drawRack = () => {
    const s = G.S;
    const units = CAT.rack.units;
    const H = TOP * 2 + units * UH + 30;
    const svg = U.s('svg', { class: 'rack-svg', viewBox: `0 0 ${LEFT + RW + 20} ${H}`, role: 'img', 'aria-label': `機櫃 ${V.rack}` });
    svg.appendChild(U.s('rect', { x: LEFT - 8, y: TOP - 8, width: RW + 16, height: units * UH + 16, rx: 4, fill: 'var(--bg-4)', stroke: 'var(--line-2)' }));
    svg.appendChild(U.s('rect', { x: LEFT, y: TOP, width: RW, height: units * UH, fill: 'var(--jack)' }));
    const occ = G.Act.rackOccupancy(V.rack);
    const armedM = V.armed ? CAT.devices[s.devices[V.armed].model] : null;
    for (let u = 1; u <= units; u++) {
      const y = TOP + (units - u) * UH;
      svg.appendChild(U.s('text', { x: LEFT - 12, y: y + UH / 2 + 1, 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': 8, fill: 'var(--text-3)', 'font-family': 'var(--font-mono)' }, String(u)));
      if (!occ[u]) {
        const fits = armedM && G.Act.fits(V.rack, u, armedM.u);
        const slot = U.s('rect', { class: 'slot', x: LEFT + 1, y: y + 0.5, width: RW - 2, height: UH - 1, fill: fits ? 'var(--accent-soft)' : 'transparent', stroke: fits ? 'var(--accent)' : 'var(--line)', 'stroke-width': 0.5, 'stroke-dasharray': fits ? '3 2' : null });
        slot.addEventListener('click', () => {
          if (!V.armed) return;
          const r = UI.res(G.Act.installDevice(V.armed, V.rack, u));
          if (r.ok) { V.sel = V.armed; V.armed = null; }
        });
        svg.appendChild(slot);
      }
    }
    for (const d of Object.values(s.devices)) {
      if (d.rack !== V.rack) continue;
      svg.appendChild(faceplate(d));
    }
    const fr = G.R.fac && G.R.fac.racks[V.rack];
    if (fr) {
      const u = fr.load / fr.limit;
      const by = TOP + units * UH + 14;
      svg.appendChild(U.s('text', { x: LEFT, y: by, 'font-size': 9, fill: 'var(--text-2)' }, `PDU 用電 ${(fr.load / 1000).toFixed(2)} / ${(fr.limit / 1000).toFixed(0)} kW · 已用 ${fr.used}U / ${units}U`));
      svg.appendChild(U.s('rect', { x: LEFT, y: by + 5, width: RW, height: 5, rx: 2, fill: 'var(--bg-4)' }));
      svg.appendChild(U.s('rect', { x: LEFT, y: by + 5, width: Math.min(1, u) * RW, height: 5, rx: 2, fill: u > 1 ? 'var(--bad)' : u > 0.85 ? 'var(--warn)' : 'var(--ok)' }));
    }
    U.mount(V.svgWrap, svg);
  };

  function faceplate(d) {
    const s = G.S, m = CAT.devices[d.model];
    const units = CAT.rack.units;
    const y = TOP + (units - (d.u + m.u - 1)) * UH;
    const hgt = m.u * UH;
    const g = U.s('g', { class: 'dev' });
    g.addEventListener('click', () => { V.sel = d.id; V.armed = null; UI.refresh(); });
    const cc = CAT.categories[m.cat].color;
    g.appendChild(U.s('rect', { x: LEFT + 1, y: y + 0.5, width: RW - 2, height: hgt - 1, rx: 1.5, fill: 'var(--bg-3)', stroke: V.sel === d.id ? 'var(--accent)' : 'var(--line-2)', 'stroke-width': V.sel === d.id ? 2 : 0.8 }));
    g.appendChild(U.s('rect', { x: LEFT + 1, y: y + 0.5, width: 5, height: hgt - 1, fill: cc }));
    const st = UI.devStatus(d);
    const led = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)' }[st.c] || 'var(--text-3)';
    g.appendChild(U.s('circle', { cx: LEFT + 13, cy: y + hgt / 2, r: 2.4, fill: led }));
    g.appendChild(U.s('text', { x: LEFT + 20, y: y + Math.min(hgt / 2, 8) + (m.u > 1 ? 2 : 1), 'dominant-baseline': 'middle', 'font-size': 8.5, 'font-weight': 700, fill: 'var(--text)' }, d.name + (d.role ? ` · ${CAT.roles[d.role].short}` : '')));
    if (m.u > 1) g.appendChild(U.s('text', { x: LEFT + 20, y: y + 20, 'dominant-baseline': 'middle', 'font-size': 7.5, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, d.model));
    /* 連接埠示意：亮燈 = 已接線 */
    const P = Q.ports(d.id);
    const ports = [];
    for (let i = 0; i < m.ports.rj45; i++) ports.push({ k: 'rj45', used: i < P.rj45.used });
    for (let i = 0; i < m.ports.sfp; i++) ports.push({ k: 'sfp', used: i < P.sfp.used });
    for (let i = 0; i < m.ports.qsfp; i++) ports.push({ k: 'qsfp', used: i < P.qsfp.used });
    const maxShow = Math.min(ports.length, 48);
    const pw = 4.2, gap = 1.3;
    const perRow = m.u > 1 ? 24 : 24;
    const rows = Math.min(m.u > 1 ? 2 : 1, Math.ceil(maxShow / perRow));
    const startX = LEFT + RW - 6 - perRow * (pw + gap);
    const running = st.c === 'ok';
    for (let i = 0; i < maxShow && i < perRow * rows; i++) {
      const r = Math.floor(i / perRow), c = i % perRow;
      const px = startX + c * (pw + gap);
      const py = y + 3 + r * 6.5;
      const p = ports[i];
      g.appendChild(U.s('rect', { x: px, y: py, width: pw, height: 4.5, fill: p.k === 'rj45' ? '#0b0f12' : p.k === 'qsfp' ? '#1d2a33' : '#16222a', stroke: 'var(--line-2)', 'stroke-width': 0.3 }));
      if (p.used && running) g.appendChild(U.s('rect', { x: px + 1, y: py - 1.6, width: 2.2, height: 1.2, fill: 'var(--ok)' }));
    }
    if (m.cat === 'ups') {
      g.appendChild(U.s('text', { x: LEFT + RW - 10, y: y + hgt / 2, 'text-anchor': 'end', 'dominant-baseline': 'middle', 'font-size': 9, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, `${(m.capW / 1000).toFixed(0)} kW · ${Math.round(s.power.upsCharge * 100)}%`));
    }
    g.appendChild(U.s('title', {}, `${d.name}（${m.name}）${st.t}`));
    return g;
  }

  function roomCard() {
    const s = G.S;
    const card = h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: '2px' } }, h('h3', {}, '機房設施'), h('button', { class: 'btn ghost xs', onclick: () => UI.go('shop:facility') }, '採購設施')));
    for (const r of s.room) {
      const m = CAT.room[r.model];
      const building = s.time < (r.readyAt || 0);
      const st = r.status === 'failed' ? { t: '故障', c: 'bad' } : building ? { t: `安裝中 ${U.dur(r.readyAt - s.time)}`, c: 'warn' } : { t: '運作中', c: 'ok' };
      const spec = m.kind === 'cooling' ? `冷卻 ${m.coolKW} kW` : m.kind === 'ups' ? `UPS ${(m.capW / 1000).toFixed(0)} kW · ${m.runtime} 分` : '發電機';
      card.appendChild(h('div', { class: 'row between small' },
        h('span', {}, h('b', {}, m.name), h('span', { class: 'muted' }, '　' + spec)),
        h('span', { class: 'row' }, h('span', { class: 'chip ' + st.c }, st.t),
          r.status === 'failed' ? h('button', { class: 'btn xs warn', onclick: () => UI.res(G.Act.repairRoom(r.id)) }, '叫修') : null,
          m.price ? h('button', { class: 'btn xs ghost', onclick: () => UI.confirm('拆除設施', `拆除 ${m.name}？回收 30%。`, '拆除', () => UI.res(G.Act.removeRoom(r.id)), 'danger') }, '拆除') : null)));
    }
    card.appendChild(h('div', { class: 'small dim' }, '空調與 UPS 屬於機房設施，不佔機櫃空間。機架式 UPS（UPS-10K）則安裝在機櫃內。'));
    return card;
  }
})(window.G = window.G || {});
