/* 配電盤實作（廠務 → 配電盤）：DP-UT1 的正面（兩條進線、R / S / T / N / E 匯流排、每一個斷路器與出線）、
 * 選取的迴路（規格、LOTO 停電作業、施工、量測）、三相電流與平衡、驗收清單、施工紀錄、規則與公式。
 * 操作：點斷路器 → 看詳情 → 斷電、上鎖掛牌、驗電 → 施工 → 拆除掛牌 → 送電。沒停電就施工，會跳出警告（硬做就是電弧閃絡）。 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, UI = G.UI;
  const PU = { sel: null, msg: null, heat: true };
  G.PanelUI = PU;
  const Pn = () => G.Panel;
  const COL = () => Pn().COL;

  /* ---------- 動作：不安全的施工要先確認 ---------- */
  function act(id, a, arg) {
    const r = Pn().act(id, a, arg);
    if (!r.ok && r.unsafe) {
      UI.confirm(r.live ? '⚠ 帶電作業' : '⚠ 沒有完成停電作業程序',
        `${r.msg}。${r.live ? '在有電的狀態下動手，工具一碰到端子就會產生電弧閃絡（上萬度的高溫與爆風），施工的人會嚴重灼傷。' : '沒有上鎖掛牌、驗電：別人隨時可能把它送電，施工的人就會感電。'}`,
        r.live ? '還是要帶電施工（危險）' : '不上鎖直接施工（違規）', () => { PU.msg = UI.res(Pn().act(id, a, arg, { force: true })); }, 'danger');
      return;
    }
    PU.msg = UI.res(r);
  }
  PU.act = act;

  /* ---------- 配電盤正面（SVG） ---------- */
  function panelSvg() {
    const st = Pn().st(), t = G.S.time;
    const defs = Pn().DEF;
    const secs = ['N', 'E'].map((b) => ({ b, c3: defs.filter((d) => d.ph === 3 && st.cir[d.id].bus === b), c1: defs.filter((d) => d.ph === 1 && st.cir[d.id].bus === b) }));
    const W3 = 70, W1 = 44;
    for (const sc of secs) sc.w = Math.max(210, 24 + Math.max(sc.c3.length * W3, sc.c1.length * W1));
    const W = secs[0].w + secs[1].w + 36, H = 452;
    const svg = U.s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '配電盤 DP-UT1 正面' });
    const R = (x, y, w, hh, a) => svg.appendChild(U.s('rect', Object.assign({ x, y, width: w, height: hh }, a)));
    const T = (x, y, txt, a) => svg.appendChild(U.s('text', Object.assign({ x, y, 'font-size': 10, fill: 'var(--text-2)' }, a), txt));
    /* 盤體 */
    R(4, 4, W - 8, H - 8, { rx: 6, fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 2 });
    R(12, 10, W - 24, 22, { rx: 3, fill: '#1c2a36' });
    T(22, 25, 'DP-UT1　廠務動力分電盤', { fill: '#e8f0f5', 'font-size': 12, 'font-weight': 700 });
    T(W - 22, 25, '3φ4W 380 / 220 V 60 Hz', { fill: '#9fb6c4', 'font-size': 11, 'text-anchor': 'end', 'font-family': 'var(--font-mono)' });
    const scan = st.scan && t - st.scan.at < 360 ? st.scan.spots : null;
    const place = [];
    let x0 = 18;
    for (const sc of secs) {
      const b = sc.b, I = st.inc[b], live = Pn().busLive(b), src = G.Plant.busSource(b);
      const w = sc.w;
      /* 區塊框 */
      R(x0 - 4, 38, w, H - 50, { rx: 4, fill: 'none', stroke: b === 'E' ? '#c0392b' : 'var(--line)', 'stroke-dasharray': b === 'E' ? '5 3' : null });
      T(x0 + w - 10, 52, b === 'E' ? '緊急電源區（維生負載）' : '一般電源區', { 'text-anchor': 'end', 'font-size': 10.5, 'font-weight': 700, fill: b === 'E' ? '#e0645a' : 'var(--text-2)' });
      T(x0 + w - 10, 66, b === 'E' ? (G.Plant.count('dups') ? '由 DUPS 供電' : '經 ATS：一般電源 / 發電機') : '主變壓器 → 低壓主配電盤', { 'text-anchor': 'end', 'font-size': 9, fill: 'var(--text-3)' });
      /* 進線斷路器 */
      const g = U.s('g', { 'data-hint': 'pn-inc:' + b, style: 'cursor:pointer' });
      g.addEventListener('click', () => { PU.sel = b; UI.refresh(); });
      g.appendChild(U.s('title', {}, `${Pn().INC[b].name}（${Pn().INC[b].at} A）`));
      const ix = x0 + 4, iy = 44;
      g.appendChild(U.s('rect', { x: ix, y: iy, width: 74, height: 50, rx: 4, fill: '#cfd3d1', stroke: PU.sel === b ? 'var(--accent)' : '#5f666b', 'stroke-width': PU.sel === b ? 3 : 1.2 }));
      g.appendChild(U.s('text', { x: ix + 37, y: iy + 12, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#1d2227' }, `${Pn().INC[b].at}A`));
      handle(g, ix + 22, iy + 16, 30, I.on, false);
      if (I.lock) lock(g, ix + 60, iy + 26);
      g.appendChild(U.s('circle', { cx: ix + 8, cy: iy + 8, r: 3.5, fill: live ? '#2fa84f' : src ? '#f0a63a' : '#5b6167' }));
      g.appendChild(U.s('text', { x: ix + 82, y: iy + 44, 'font-size': 9, fill: 'var(--text-3)' }, b === 'E' ? '緊急電源進線' : '主斷路器（一般電源進線）'));
      svg.appendChild(g);
      /* 匯流排 R S T N E */
      const bars = ['R', 'S', 'T', 'N', 'E'];
      bars.forEach((k, j) => {
        const y = 110 + j * 9;
        R(x0 + 2, y - 2.5, w - 12, 5, { rx: 1.5, fill: COL()[k], stroke: k === 'N' ? '#9aa2a8' : 'none', opacity: live || k === 'E' ? 1 : 0.35 });
        T(x0 - 2, y + 3, k, { 'font-size': 8.5, 'font-weight': 700, 'text-anchor': 'end', fill: 'var(--text-3)', 'font-family': 'var(--font-mono)' });
      });
      if (scan && scan.N && b === 'N') hot(svg, x0 + w / 2, 137, scan.N, '中性線');
      svg.appendChild(U.s('line', { x1: ix + 37, y1: iy + 50, x2: ix + 37, y2: 108, stroke: '#5f666b', 'stroke-width': 3 }));
      /* 三相迴路在上排、單相迴路在下排（先記下位置：接線畫在最底層，斷路器蓋在上面） */
      sc.c3.forEach((d, k) => place.push([d, x0 + 10 + k * W3, 176, 58, 70]));
      sc.c1.forEach((d, k) => place.push([d, x0 + 10 + k * W1, 318, 34, 56]));
      x0 += w + 12;
    }
    for (const [d, x, y, w, hh] of place) drops(svg, d, x, y, w);
    for (const [d, x, y, w, hh] of place) breaker(svg, d, x, y, w, hh, scan);
    return svg;
  }
  /** 從匯流排接到斷路器的線（三相 R S T；單相接它的那一相） */
  function drops(svg, d, x, y, w) {
    const c = Pn().st().cir[d.id];
    const ks = d.ph === 3 ? ['R', 'S', 'T'] : [c.phase];
    ks.forEach((k, j) => {
      const bx = d.ph === 3 ? x + 14 + j * 15 : x + w / 2;
      const by = 110 + Pn().PH.indexOf(k) * 9;
      svg.appendChild(U.s('line', { x1: bx, y1: by, x2: bx, y2: y, stroke: COL()[k], 'stroke-width': 2.2, opacity: Pn().busLive(c.bus) ? 0.9 : 0.35 }));
      svg.appendChild(U.s('circle', { cx: bx, cy: by, r: 2, fill: '#c9ced1' }));
    });
  }
  /** 斷路器的把手：ON 在上、OFF 在下、跳脫停在中間 */
  function handle(g, x, y, hh, on, trip) {
    g.appendChild(U.s('rect', { x, y, width: 14, height: hh, rx: 3, fill: '#2b3036' }));
    const py = trip ? y + hh / 2 - 6 : on ? y + 2 : y + hh - 14;
    g.appendChild(U.s('rect', { x: x + 1.5, y: py, width: 11, height: 12, rx: 2, fill: trip ? '#e0453a' : on ? '#43b05c' : '#8c9398' }));
  }
  function lock(g, x, y) {
    g.appendChild(U.s('path', { d: `M${x - 4} ${y} v-4 a4 4 0 0 1 8 0 v4`, fill: 'none', stroke: '#c0392b', 'stroke-width': 1.8 }));
    g.appendChild(U.s('rect', { x: x - 6, y, width: 12, height: 9, rx: 1.5, fill: '#e0453a' }));
    g.appendChild(U.s('rect', { x: x - 5, y: y + 11, width: 10, height: 13, fill: '#f2c14e', stroke: '#8a6d1f', 'stroke-width': 0.6 }));
    g.appendChild(U.s('text', { x, y: y + 20, 'text-anchor': 'middle', 'font-size': 5.5, 'font-weight': 700, fill: '#7a1d14' }, '禁止'));
  }
  function hot(svg, x, y, temp, label) {
    const c = temp >= 80 ? '#ff3b30' : temp >= 60 ? '#ff8a3d' : '#ffc14d';
    svg.appendChild(U.s('circle', { cx: x, cy: y, r: 16, fill: c, opacity: 0.35 }));
    svg.appendChild(U.s('circle', { cx: x, cy: y, r: 7, fill: c, opacity: 0.8 }));
    svg.appendChild(U.s('text', { x, y: y - 18, 'text-anchor': 'middle', 'font-size': 9.5, 'font-weight': 700, fill: c, 'font-family': 'var(--font-mono)' }, `${label ? label + ' ' : ''}${temp}°C`));
  }
  function breaker(svg, d, x, y, w, hh, scan) {
    const st = Pn().st(), c = st.cir[d.id];
    const loadLive = Pn().loadLive(d.id), run = Pn().running(d.id), sel = PU.sel === d.id;
    const g = U.s('g', { 'data-hint': 'pn-cir:' + d.id, style: 'cursor:pointer' });
    g.addEventListener('click', () => { PU.sel = d.id; UI.refresh(); });
    g.appendChild(U.s('title', {}, `${d.id} ${d.name}（${c.at} A${c.elcb ? '，漏電斷路器' : ''}）`));
    g.appendChild(U.s('rect', { x, y, width: w, height: hh, rx: 4, fill: c.elcb ? '#e3e6d9' : '#d5d8d6', stroke: sel ? 'var(--accent)' : '#5f666b', 'stroke-width': sel ? 3 : 1.2 }));
    g.appendChild(U.s('text', { x: x + w / 2, y: y + 11, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 700, fill: '#1d2227', 'font-family': 'var(--font-mono)' }, `${c.at}A`));
    handle(g, x + w / 2 - 7, y + 15, hh - 36, c.on, c.trip);
    if (c.elcb) {
      g.appendChild(U.s('rect', { x: x + w - 12, y: y + hh - 18, width: 8, height: 8, rx: 1.5, fill: '#f2c14e', stroke: '#8a6d1f', 'stroke-width': 0.6 }));
      g.appendChild(U.s('text', { x: x + 3, y: y + hh - 11, 'font-size': 6.5, fill: '#5a4a10', 'font-weight': 700 }, '30mA'));
    }
    if (d.ph === 1) g.appendChild(U.s('text', { x: x + w / 2, y: y + hh - 3, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: COL()[c.phase] === '#2b2e33' ? '#2b2e33' : COL()[c.phase], 'font-family': 'var(--font-mono)' }, c.phase));
    /* 狀態燈：運轉綠、送電但沒有負載琥珀、跳脫紅、沒電暗 */
    g.appendChild(U.s('circle', { cx: x + 6, cy: y + 6, r: 3, fill: c.trip ? '#ff3b30' : run ? '#2fa84f' : loadLive ? '#f0a63a' : '#5b6167' }));
    if (c.lock) lock(g, x + w - 7, y + 20);
    svg.appendChild(g);
    /* 出線：三相 R S T + 接地 E；單相 相線 + 中性線 N + 接地 E */
    const wires = d.ph === 3 ? ['R', 'S', 'T', 'E'] : [c.phase, 'N', 'E'];
    const order = d.ph === 3 && d.motor && !c.seq ? ['T', 'S', 'R', 'E'] : wires;
    order.forEach((k, j) => {
      const wx = x + (w - (order.length - 1) * 7) / 2 + j * 7;
      svg.appendChild(U.s('line', { x1: wx, y1: y + hh, x2: wx, y2: y + hh + 26, stroke: COL()[k], 'stroke-width': 3, 'stroke-linecap': 'round' }));
    });
    svg.appendChild(U.s('text', { x: x + w / 2, y: y + hh + 38, 'text-anchor': 'middle', 'font-size': 8.5, fill: Pn().amp(c.mm2) < c.at ? '#e0645a' : 'var(--text-3)', 'font-family': 'var(--font-mono)' }, `${c.mm2}mm²`));
    svg.appendChild(U.s('text', { x: x + w / 2, y: y + hh + 50, 'text-anchor': 'middle', 'font-size': d.ph === 3 ? 10 : 8.5, 'font-weight': 700, fill: sel ? 'var(--accent)' : 'var(--text)' }, d.id));
    if (c.meg && c.meg.val < 1 && c.ins < 1) svg.appendChild(U.s('text', { x: x + w / 2, y: y + hh + 61, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: '#e0453a' }, `${c.ins}MΩ`));
    if (d.motor && c.seqKnown) svg.appendChild(U.s('text', { x: x + w / 2, y: y + hh + 61, 'text-anchor': 'middle', 'font-size': 8, 'font-weight': 700, fill: c.seq ? '#2fa84f' : '#e0453a' }, c.seq ? '正轉' : '反轉！'));
    if (scan && scan[d.id] && PU.heat) hot(svg, x + w / 2, y + hh + 10, scan[d.id]);
  }

  /* ---------- 選取的迴路 / 進線 ---------- */
  const btn = (label, hint, fn, cls, dis) => h('button', { class: 'btn sm ' + (cls || ''), 'data-hint': hint, disabled: dis || null, onclick: fn }, label);
  function lotoBar(id, o) {
    const on = o.on && !o.trip;
    return h('div', { class: 'loto' },
      h('div', { class: 'tiny dim', style: { width: '100%' } }, '停電作業（LOTO）：① 斷電 → ② 上鎖掛牌 → ③ 驗電 → 施工 → ④ 拆除掛牌 → ⑤ 送電'),
      btn(o.trip ? '① 扳到 OFF（復歸）' : '① 斷電 OFF', 'pn-off:' + id, () => act(id, 'off'), '', !o.on && !o.trip),
      btn('② 上鎖掛牌', 'pn-lock:' + id, () => act(id, 'lock'), '', o.on || o.lock),
      btn('③ 驗電', 'pn-ver:' + id, () => act(id, 'verify'), '', !o.lock || o.ver),
      btn('④ 拆除掛牌', 'pn-unlock:' + id, () => act(id, 'unlock'), '', !o.lock),
      btn('⑤ 送電 ON', 'pn-on:' + id, () => act(id, 'on'), 'primary', on || o.lock));
  }
  function detailCard() {
    const id = PU.sel, st = Pn().st();
    if (!id) return h('div', { class: 'card small muted' }, '點配電盤上的斷路器（或上面的進線），看它的規格、量測結果與停電作業步驟。');
    if (id === 'N' || id === 'E') {
      const I = st.inc[id], live = Pn().busLive(id), src = G.Plant.busSource(id);
      const pw = G.Plant.pw();
      const srcTxt = id === 'N' ? (pw.temp ? '統包商的臨時電源' : `主變壓器 ${pw.txN} 台`) + (pw.out ? '（台電停電中）' : '') : G.Plant.count('dups') && pw.dups.ok ? 'DUPS（飛輪 + 柴油引擎）' : pw.genRun ? '緊急發電機（經 ATS）' : '經 ATS 由一般電源供電';
      const list = Pn().DEF.filter((d) => st.cir[d.id].bus === id).map((d) => d.id).join('、');
      return h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, `${Pn().INC[id].name}（${Pn().INC[id].at} A）`), h('span', { class: 'chip ' + (live ? 'ok' : src ? 'warn' : 'bad') }, live ? '匯流排有電' : src ? '上游有電、進線 OFF' : '上游沒電')),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '電源'), h('span', { class: 'v' }, srcTxt),
          h('span', { class: 'k' }, '這一區的迴路'), h('span', { class: 'v small' }, list || '—'),
          h('span', { class: 'k' }, '狀態'), h('span', { class: 'v' }, [I.on ? 'ON' : 'OFF', I.lock ? '🔒 上鎖掛牌' : '', I.ver ? '✓ 已驗電' : ''].filter(Boolean).join(' · '))),
        id === 'E' ? h('div', { class: 'note warn small' }, '緊急電源區是另一個電源（DUPS / 發電機）：把一般電源的主斷路器關掉，這一區還是有電！要施工，這條進線也要停電、上鎖掛牌、驗電。') : h('div', { class: 'tiny dim' }, '進線停電、上鎖掛牌、驗電之後，這一區所有迴路都可以施工（包括換斷路器、改接相位這種要動到匯流排的工作）。'),
        lotoBar(id, I),
        PU.msg ? h('div', { class: 'small ' + (PU.msg.ok ? 'muted' : 'bad-t') }, PU.msg.msg) : null);
    }
    const d = Pn().def(id), c = st.cir[id];
    if (!d) { PU.sel = null; return h('div', {}); }
    const flc = Pn().flc(d), r = Pn().range(d), sug = Pn().suggest(d);
    const loadLive = Pn().loadLive(id), run = Pn().running(id), present = Pn().present(d);
    const scan = st.scan && G.S.time - st.scan.at < 360 ? st.scan.spots[id] : null;
    const tags = [d.ph === 3 ? '三相 380 V' : '單相 220 V', d.motor ? '馬達' : '', d.wet ? '濕區' : '', d.life ? '維生負載' : ''].filter(Boolean);
    const sfL = Pn().safety(id, 'load'), sfN = Pn().safety(id, 'line');
    const work = h('div', { class: 'col', style: { gap: '6px' } },
      h('div', { class: 'tiny dim' }, `施工：負載側（電纜、端子、相序）${sfL.ok ? '✓ 可以施工' : '✗ ' + sfL.why}；電源側（換斷路器、改接相位 / 電源區）${sfN.ok ? '✓ 可以施工' : '✗ ' + sfN.why}`),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        h('label', { class: 'field inline' }, h('span', {}, '斷路器'), h('select', { 'data-hint': 'pn-at:' + id, onchange: (e) => act(id, 'at', +e.target.value) }, Pn().AT.map((a) => h('option', { value: a, selected: a === c.at || null }, `${a} A${a === sug.at ? '（建議）' : ''}`)))),
        h('label', { class: 'field inline' }, h('span', {}, '電纜'), h('select', { 'data-hint': 'pn-cable:' + id, onchange: (e) => act(id, 'cable', +e.target.value) }, Pn().SIZES.map((m) => h('option', { value: m, selected: m === c.mm2 || null }, `${m} mm²（${Pn().amp(m)} A）${m === c.mm2 ? '　← 目前' : ''}`)))),
        d.ph === 1 ? h('label', { class: 'field inline' }, h('span', {}, '接在'), h('select', { 'data-hint': 'pn-phase:' + id, onchange: (e) => act(id, 'phase', e.target.value) }, Pn().PH.map((p) => h('option', { value: p, selected: p === c.phase || null }, `${p} 相`)))) : null),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        btn(c.elcb ? '換回一般斷路器' : '換成漏電斷路器（30 mA）', 'pn-elcb:' + id, () => act(id, 'elcb', !c.elcb)),
        btn(`改接到${c.bus === 'N' ? '緊急' : '一般'}電源區`, 'pn-bus:' + id, () => act(id, 'bus', c.bus === 'N' ? 'E' : 'N')),
        btn('換新電纜（同線徑）', 'pn-recable:' + id, () => act(id, 'cable', c.mm2)),
        btn('鎖緊端子（依規定扭力）', 'pn-torque:' + id, () => act(id, 'torque')),
        d.motor ? btn('對調兩相（改變轉向）', 'pn-swap:' + id, () => act(id, 'swap')) : null));
    const meas = h('div', { class: 'row wrap', style: { gap: '6px' } },
      btn('絕緣電阻測試（500 V）', 'pn-meg:' + id, () => act(id, 'meg')),
      d.motor ? btn('測相序', 'pn-seq:' + id, () => act(id, 'seq')) : null,
      btn('鉤表量電流', 'pn-clamp:' + id, () => act(id, 'clamp')));
    return h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, `${d.id} ${d.name}`), h('span', { class: 'chip ' + (c.trip ? 'bad' : run ? 'ok' : loadLive ? 'warn' : '') }, c.trip ? '跳脫' : run ? '運轉中' : loadLive ? (present ? '送電（馬達停止中）' : '送電（設備還沒建置）') : c.on ? '上游沒電' : '停電')),
      h('div', { class: 'row wrap', style: { gap: '4px' } }, tags.map((x) => h('span', { class: 'chip' }, x))),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '負載'), h('span', { class: 'v mono' }, `${d.kw} kW · 額定電流 ${flc.toFixed(1)} A`),
        h('span', { class: 'k' }, '斷路器'), h('span', { class: 'v mono ' + (c.at < r.min || c.at > r.max ? 'bad-t' : '') }, `${c.at} A${c.elcb ? '（漏電斷路器 30 mA）' : ''}　合理 ${Math.ceil(r.min)}～${r.max > 900 ? '∞' : Math.floor(r.max)} A`),
        h('span', { class: 'k' }, '電纜'), h('span', { class: 'v mono ' + (Pn().amp(c.mm2) < c.at ? 'bad-t' : '') }, `${c.mm2} mm²（安培容量 ${Pn().amp(c.mm2)} A）${Pn().amp(c.mm2) < c.at ? '　< 斷路器' : ''}`),
        h('span', { class: 'k' }, d.ph === 3 ? '相序' : '相位'), h('span', { class: 'v mono ' + (d.motor && c.seqKnown && !c.seq ? 'bad-t' : '') }, d.ph === 3 ? (d.motor ? (c.seqKnown ? (c.seq ? '正相序 R→S→T（正轉）' : '反相序（馬達反轉）') : '還沒量（送電後用相序計）') : 'R · S · T') : `${c.phase} 相 + 中性線`),
        h('span', { class: 'k' }, '電源區'), h('span', { class: 'v ' + (d.life && c.bus !== 'E' ? 'bad-t' : '') }, `${Pn().BUS[c.bus]}${d.life && c.bus !== 'E' ? '（維生負載應接緊急電源）' : ''}`),
        h('span', { class: 'k' }, '絕緣電阻'), h('span', { class: 'v mono ' + (c.meg && c.meg.val < 1 ? 'bad-t' : '') }, c.meg ? (c.meg.val >= 1 ? '> 500 MΩ ✓' : `${c.meg.val} MΩ ✗（< 1 MΩ）`) : '還沒測'),
        h('span', { class: 'k' }, '熱像'), h('span', { class: 'v mono ' + (scan ? 'bad-t' : '') }, scan ? `${scan}°C 過熱！` : st.scan ? '正常' : '還沒掃描'),
        h('span', { class: 'k' }, '狀態'), h('span', { class: 'v' }, [c.on ? 'ON' : 'OFF', c.trip ? '跳脫' : '', c.lock ? '🔒 上鎖掛牌' : '', c.ver ? '✓ 已驗電' : ''].filter(Boolean).join(' · '))),
      lotoBar(id, c),
      h('div', { class: 'label' }, '施工'), work,
      h('div', { class: 'label' }, '量測'), meas,
      PU.msg ? h('div', { class: 'small ' + (PU.msg.ok ? (PU.msg.bad ? 'warn-t' : 'muted') : 'bad-t') }, PU.msg.msg) : null);
  }

  /* ---------- 三相電流與平衡 ---------- */
  function balanceCard() {
    const st = Pn().st();
    const dz = Pn().phases(true), now = Pn().phases(false);
    const max = Math.max(dz.R, dz.S, dz.T, 1);
    const bar = (k, v, m) => h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } },
      h('b', { class: 'mono', style: { width: '14px', color: COL()[k] === '#2b2e33' ? 'var(--text)' : COL()[k] } }, k),
      h('div', { class: 'meter grow' }, h('i', { style: { width: U.pct(Math.min(1, v / m)), background: COL()[k] === '#2b2e33' ? 'var(--text-2)' : COL()[k] } })),
      h('span', { class: 'mono tiny', style: { width: '64px', textAlign: 'right' } }, `${v.toFixed(0)} A`));
    const ones = { R: [], S: [], T: [] };
    for (const d of Pn().DEF) if (d.ph === 1) ones[st.cir[d.id].phase].push(d.id);
    const cl = st.clamp && G.S.time - st.clamp.at < 240 ? st.clamp : null;
    return h('div', { class: 'card col', style: { gap: '6px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '三相電流與平衡'), h('span', { class: 'chip ' + (dz.unbal <= Pn().UNBAL ? 'ok' : 'bad') }, `不平衡 ${U.pct(dz.unbal, 1)}`)),
      h('div', { class: 'tiny dim' }, '設計負載（每一個迴路都滿載）時各相的電流：三相負載平均分在三相，單相負載只加在它接的那一相。'),
      bar('R', dz.R, max), bar('S', dz.S, max), bar('T', dz.T, max),
      h('div', { class: 'small' }, `中性線電流 ${dz.N.toFixed(0)} A（單相負載越集中在同一相，中性線電流越大）`),
      h('div', { class: 'kv' }, ...Pn().PH.flatMap((p) => [h('span', { class: 'k' }, `${p} 相的單相迴路`), h('span', { class: 'v small mono' }, ones[p].join('、') || '—')])),
      h('div', { class: 'tiny dim' }, cl ? `鉤表實測（${U.clock(cl.at)}）：R ${cl.R.toFixed(0)} A · S ${cl.S.toFixed(0)} A · T ${cl.T.toFixed(0)} A · 中性線 ${cl.N.toFixed(0)} A` : `目前實際：R ${now.R.toFixed(0)} · S ${now.S.toFixed(0)} · T ${now.T.toFixed(0)} · N ${now.N.toFixed(0)} A（用鉤表量才看得到）`));
  }

  /* ---------- 驗收清單 ---------- */
  function checkCard() {
    const st = Pn().st(), df = Pn().defects(), energized = Pn().busLive('N') || Pn().busLive('E');
    const scanDone = !!st.scan && st.energized && st.scan.at >= st.energized;
    const rows = Pn().CHECKS.map((ck) => {
      let items = df.filter((x) => ck.keys.includes(x.k));
      let state = items.length ? 'bad' : 'ok', sub = '';
      /* 看不到的缺失：要量過才知道 */
      if (ck.k === 'ins') {
        const untested = Pn().DEF.filter((d) => !st.cir[d.id].meg).length;
        const bad = Pn().DEF.filter((d) => st.cir[d.id].meg && st.cir[d.id].meg.val < 1 && st.cir[d.id].ins < 1).map((d) => d.id);
        state = bad.length ? 'bad' : untested ? 'todo' : 'ok';
        sub = bad.length ? `${bad.join('、')} 絕緣不良` : untested ? `${untested} 個迴路還沒測` : '';
      } else if (ck.k === 'seq') {
        const motors = Pn().DEF.filter((d) => d.motor);
        const unknown = motors.filter((d) => !st.cir[d.id].seqKnown && st.cir[d.id].seq).length + motors.filter((d) => !st.cir[d.id].seqKnown && !st.cir[d.id].seq).length;
        const bad = motors.filter((d) => st.cir[d.id].seqKnown && !st.cir[d.id].seq).map((d) => d.id);
        state = bad.length ? 'bad' : unknown ? 'todo' : 'ok';
        sub = bad.length ? `${bad.join('、')} 反轉` : unknown ? `${unknown} 台馬達還沒量（送電後）` : '';
      } else if (ck.k === 'loose') {
        const spots = scanDone ? Object.keys(st.scan.spots) : [];
        state = spots.length ? 'bad' : !scanDone ? 'todo' : items.length ? 'todo' : 'ok';
        sub = spots.length ? `熱像過熱：${spots.map((k) => (k === 'N' ? '中性線' : k)).join('、')}` : !scanDone ? (energized ? '送電帶載之後做熱像掃描' : '送電之後才能做') : items.length ? '有迴路沒在運轉，看不出來' : '';
      } else if (items.length) sub = items.map((x) => (x.id && x.id.length > 1 ? x.id : x.id === 'N' || x.id === 'E' ? Pn().INC[x.id].short + '進線' : '')).filter(Boolean).slice(0, 6).join('、');
      return h('div', { class: 'row small chk' + (state === 'ok' ? ' ok' : ''), style: { alignItems: 'flex-start' } },
        h('span', { class: 'ck', style: { color: state === 'bad' ? 'var(--bad)' : state === 'todo' ? 'var(--warn)' : null } }, state === 'ok' ? '✓' : state === 'bad' ? '✗' : '?'),
        h('span', { class: 'grow' }, ck.t, sub ? h('div', { class: 'tiny ' + (state === 'bad' ? 'bad-t' : 'dim') }, sub) : null));
    });
    return h('div', { class: 'card col', style: { gap: '4px' } },
      h('div', { class: 'card-h', style: { marginBottom: '2px' } }, h('h3', {}, '驗收清單'), h('span', { class: 'chip ' + (df.length ? 'warn' : 'ok') }, df.length ? `${df.length} 項未完成` : '✓ 驗收合格')), rows);
  }
  function logCard() {
    const st = Pn().st();
    return h('div', { class: 'card col', style: { gap: '4px' } },
      h('div', { class: 'card-h', style: { marginBottom: '2px' } }, h('h3', {}, '施工紀錄'), h('span', { class: 'tiny dim' }, `LOTO 施工 ${st.stats.loto} 次 · 違規 ${st.stats.viol} · 帶電作業 ${st.stats.live}`)),
      st.log.length ? st.log.slice(-8).reverse().map((l) => h('div', { class: 'tiny' }, h('span', { class: 'mono dim' }, U.clock(l.t) + '　'), l.text)) : h('div', { class: 'tiny dim' }, '還沒有紀錄'));
  }
  function rulesCard() {
    return h('div', { class: 'card col small', style: { gap: '4px' } },
      h('div', { class: 'card-h', style: { marginBottom: '2px' } }, h('h3', {}, '公式與規則'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-panel') }, '配電盤')),
      h('div', {}, '三相電流 I = P ÷ (√3 × 380 V × 功率因數 × 效率)；單相 I = P ÷ (220 V × 功率因數)'),
      h('div', {}, '線電壓 380 V（R-S、S-T、T-R）＝ √3 × 相電壓 220 V（R-N）'),
      h('div', {}, '斷路器：馬達 1.5～2.5 倍額定電流（躲過約 6 倍的起動電流）；其他負載 ≥ 1.25 倍'),
      h('div', {}, '電纜的安培容量 ≥ 斷路器額定（斷路器才保護得了電纜）'),
      h('div', {}, '濕區、插座、沖淋加熱：漏電斷路器 30 mA；維生負載接緊急電源'),
      h('div', {}, `單相負載平均分到 R / S / T：不平衡 ≤ ${Math.round(Pn().UNBAL * 100)}%`),
      h('div', {}, '三相馬達反轉：停電後對調任意兩相'),
      h('div', { class: 'tiny dim' }, '導線顏色（台灣常見）：R 紅、S 黑、T 藍、中性線白、接地線綠'));
  }

  /* ---------- 掛上畫面 ---------- */
  PU.mount = (el, V) => {
    const st = Pn().st();
    if (PU.sel && PU.sel !== 'N' && PU.sel !== 'E' && !Pn().def(PU.sel)) PU.sel = null;
    const df = Pn().defects();
    const panelBox = h('div', { class: 'pnl-svg' });
    V.liveNode(panelBox, panelSvg);
    const tool = h('div', { class: 'row wrap', style: { gap: '6px', marginBottom: '8px' } },
      h('button', { class: 'btn sm', 'data-hint': 'pn-scan', onclick: () => act(null, 'scan') }, '紅外線熱像掃描（10 分）'),
      h('button', { class: 'btn sm', 'data-hint': 'pn-meg-all', onclick: () => act(null, 'megAll') }, '全部絕緣電阻測試'),
      h('button', { class: 'btn sm', 'data-hint': 'pn-clamp-all', onclick: () => act('N', 'clamp') }, '鉤表量進線電流'),
      h('button', { class: 'btn sm', 'data-hint': 'pn-seq-all', onclick: () => act(null, 'seqAll') }, '全部馬達測相序'),
      h('button', { class: 'btn sm primary', 'data-hint': 'pn-all-on', onclick: () => act(null, 'allOn') }, '依序送電（全部迴路）'),
      h('label', { class: 'row small', style: { gap: '4px' } }, h('input', { type: 'checkbox', checked: PU.heat || null, onchange: (e) => { PU.heat = e.target.checked; UI.refresh(); } }), '顯示熱像'),
      h('span', { class: 'grow' }),
      h('span', { class: 'chip ' + (Pn().busLive('N') ? 'ok' : '') }, `一般電源區 ${Pn().busLive('N') ? '有電' : '停電'}`),
      h('span', { class: 'chip ' + (Pn().busLive('E') ? 'ok' : '') }, `緊急電源區 ${Pn().busLive('E') ? '有電' : '停電'}`),
      h('span', { class: 'chip ' + (df.length ? 'warn' : 'ok') }, df.length ? `驗收 ${df.length} 項未完成` : '驗收合格'));
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'card-h' }, h('h3', {}, '配電盤 DP-UT1（統包商交接）'), h('span', { class: 'small muted' }, '點斷路器或進線 · 綠燈運轉、琥珀送電待機、紅燈跳脫')),
      tool, panelBox,
      h('div', { class: 'legend' }, [['R', 'R 相（紅）'], ['S', 'S 相（黑）'], ['T', 'T 相（藍）'], ['N', '中性線（白）'], ['E', '接地（綠）']].map(([k, t]) => h('span', {}, h('i', { style: { background: COL()[k], border: k === 'N' ? '1px solid #9aa2a8' : null } }), t)))));
    const left = h('div', { class: 'col', style: { gap: '10px' } });
    V.liveNode(left, () => [detailCard()], true);
    const right = h('div', { class: 'col', style: { gap: '10px' } });
    V.liveNode(right, () => [balanceCard(), checkCard(), logCard()]);
    el.appendChild(h('div', { class: 'split' }, left, h('div', { class: 'col', style: { gap: '10px' } }, right, rulesCard())));
  };
})(window.G = window.G || {});
