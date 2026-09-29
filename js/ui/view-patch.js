/* 實體接線工作台（機房 → 實體接線）
 * 左邊：目前這座機櫃裡每台網路設備的大面板（每個埠都能點）、ODF 光纖配線架（往各樓層的主幹）
 * 右邊：割接計畫（第九章）、手上拿著的線、埠詳情（show interface）與動作、懸空的線、迴圈 / STP 警示、燈號說明
 * 操作：點埠 → 看詳情；「從這裡接新線」再點另一個埠 → 選跳線與模組；「拔掉這一端」→ 線的另一端還插著、可以拿起來插到別的埠
 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const PU = { sel: null, from: null, hold: null };
  G.PatchUI = PU;
  const P = () => G.Phys;

  const LED_T = { on: '綠：連線正常', blk: '琥珀：STP 阻擋', err: '紅：埠被停用', off: '暗：沒有連線', storm: '狂閃：廣播風暴' };
  const MEDIA_FILL = { mmf: '#1b1b1b', smf: '#3f7fe6', copper: '#8e979e' };
  const ROLE_C = { floor: '#2fc6b8', srv: '#a78bfa', fw: '#f25f5c', core: '#f0a63a' };
  const cls = (pid) => P().cls(pid);
  const clsName = (nodeId, pid) => {
    const c = cls(pid), sp = P().spec(nodeId);
    if (c === 'rj45') return 'RJ45';
    if (c === 'sfp') return sp.sfpMax >= 25000 ? 'SFP28' : sp.sfpMax >= 10000 ? 'SFP+' : 'SFP';
    return sp.qsfpMax >= 400000 ? 'QSFP-DD' : sp.qsfpMax >= 100000 ? 'QSFP28' : 'QSFP+';
  };
  const winMin = (min) => (G.Cut && G.Cut.inWindow() && min ? `（⏱ ${min} 分）` : '');
  const hasPorts = (d) => { const sp = P().spec(d.id); return !!sp && sp.r + sp.s + sp.q > 0 && !CAT.infra(CAT.devices[d.model]); };

  /* ---------- 一個埠現在的樣子 ---------- */
  function portView(n, p) {
    const o = P().at(n, p);
    const v = { o, mod: P().mod(n, p), led: 'off', cord: null, lab: true, st: null, far: null, end: 0, l: null, m: null };
    if (!o) return v;
    if (o.t === 'm') {
      v.l = o.l; v.m = o.m; v.st = P().mState(o.l, o.m); v.end = o.end === 'a' ? 0 : 1;
      v.led = v.st.led[v.end]; v.cord = o.m.cord; v.lab = o.m.lab;
      v.far = o.end === 'a' ? [o.l.b, o.m.bp] : [o.l.a, o.m.ap];
    } else if (o.t === 'self') {
      v.st = P().selfState(o.x); v.end = o.end === 'a' ? 0 : 1; v.led = v.st.led[v.end]; v.cord = o.x.cord; v.lab = o.x.lab;
      v.far = [n, o.end === 'a' ? o.x.bp : o.x.ap]; v.self = o.x;
    } else if (o.t === 'loose') {
      v.cord = o.x.cord; v.lab = o.x.lab; v.loose = o.x;
    } else if (o.t === 'isp') {
      const c = o.c;
      v.isp = c; v.cord = c.port === 'rj45' ? 'cat6' : 'os2'; v.led = G.Net.ispUp(c) ? 'on' : 'off';
    }
    return v;
  }

  /** 這個埠的燈號（機櫃的小面板也用） */
  PU.led = (n, p) => (P().at(n, p) ? portView(n, p).led : 'off');

  /* ---------- 設備面板（SVG） ---------- */
  const PW = { r: 24, s: 22, q: 32 }, PH = { r: 17, s: 12, q: 12 };
  /** 面板排版寬度：窄螢幕時把埠分成兩排以上，不要縮得太小 */
  const maxW = () => (window.innerWidth < 1000 ? 600 : 940);
  function faceplate(nodeId) {
    const sp = P().spec(nodeId);
    const groups = [['r', sp.r], ['s', sp.s], ['q', sp.q], ['u', sp.u]].filter((g) => g[1] > 0);
    const items = [];
    let x = 12, y = 6, lineH = 0, W = 0;
    for (const [k, n] of groups) {
      const kk = k === 'u' ? 's' : k;
      const pw = PW[kk], ph = PH[kk];
      const rows = n > 1 ? 2 : 1;
      const cols = Math.ceil(n / rows);
      const pitch = pw + 5;
      const colX = (c) => c * pitch + Math.floor(c / 6) * 6;
      const fit = Math.max(6, Math.floor((maxW() - 24) / (pitch + 1)));
      /* 埠太多就平均分成幾排（每排 6 的倍數，像真的交換器一樣分組） */
      const banks = Math.ceil(cols / fit);
      const maxCols = banks > 1 ? Math.ceil(cols / banks / 6) * 6 : cols;
      const rowH = ph + 26;
      for (let c0 = 0; c0 < cols; c0 += maxCols) {
        const bc = Math.min(maxCols, cols - c0);
        const bw = colX(bc - 1) + pw;
        if (x > 12 && x + bw > maxW() - 12) { x = 12; y += lineH + 10; lineH = 0; }
        for (let c = 0; c < bc; c++) for (let r = 0; r < rows; r++) {
          const i = (c0 + c) * rows + r;
          if (i >= n) continue;
          items.push({ pid: k + (i + 1), x: x + colX(c), y: y + r * rowH, pw, ph });
        }
        lineH = Math.max(lineH, rows * rowH);
        W = Math.max(W, x + bw);
        x += bw + 22;
      }
    }
    const H = y + lineH + 4;
    /* 放大 1.6 倍：埠才點得到；大台的設備會依卡片寬度縮小（窄螢幕可以左右捲動） */
    const Wn = Math.max(W + 12, 200), K = 1.6;
    const svg = U.s('svg', { class: 'pp-face', viewBox: `0 0 ${Wn} ${H}`, width: Math.round(Wn * K), style: `min-width:${Math.round(Math.min(Wn * K, 600))}px`, role: 'group', 'aria-label': `${Q.nodeName(nodeId)} 的連接埠` });
    const d = G.S.devices[nodeId];
    const plan = d && d.plan;
    for (const it of items) svg.appendChild(portEl(nodeId, it, plan));
    return svg;
  }
  function portEl(nodeId, it, plan) {
    const { pid, pw, ph } = it;
    const v = portView(nodeId, pid);
    const c = cls(pid);
    const sel = PU.sel && PU.sel.n === nodeId && PU.sel.p === pid;
    const isFrom = PU.from && PU.from.n === nodeId && PU.from.p === pid;
    const target = (PU.hold || PU.from) && !v.o && !isFrom;
    const g = U.s('g', { class: 'pp-port' + (sel ? ' sel' : '') + (target ? ' target' : '') + (isFrom ? ' from' : ''), transform: `translate(${it.x},${it.y})`, 'data-hint': `port:${nodeId}:${pid}`, tabindex: 0, role: 'button' });
    const nm = P().name(nodeId, pid);
    const tip = [nm, v.mod ? CAT.xcvr[v.mod].name : c !== 'rj45' ? '空槽（沒有模組）' : 'RJ45', v.st ? v.st.text : v.loose ? '另一端懸空' : v.isp ? 'ISP 專線' : '沒有接線'];
    g.appendChild(U.s('title', {}, tip.join('\n')));
    /* 燈號 */
    g.appendChild(U.s('circle', { class: 'pp-led ' + v.led + (v.st && v.st.code === 'vlan' ? ' vlan' : ''), cx: 4, cy: 3, r: 2.6 }));
    /* 埠本體 */
    const cy = 7;
    g.appendChild(U.s('rect', { class: 'pp-cage ' + c, x: 0, y: cy, width: pw, height: ph, rx: 1.6 }));
    if (c === 'rj45') {
      g.appendChild(U.s('path', { class: 'pp-rj', d: `M${pw * 0.28} ${cy + ph - 2} v-${ph * 0.45} h${pw * 0.44} v${ph * 0.45}` }));
    } else if (v.o && v.cord === 'dac') {
      g.appendChild(U.s('rect', { x: 1.5, y: cy + 1.5, width: pw - 3, height: ph - 3, rx: 1, fill: '#2f353b', stroke: '#6b7780', 'stroke-width': 0.5 }));
    } else if (v.mod) {
      const x = CAT.xcvr[v.mod];
      g.appendChild(U.s('rect', { x: 1.5, y: cy + 1.5, width: pw - 3, height: ph - 3, rx: 1, fill: '#c9d0d5' }));
      g.appendChild(U.s('rect', { x: 1.5, y: cy + ph - 4, width: pw - 3, height: 2.5, rx: 0.8, fill: MEDIA_FILL[x.media] || '#999' }));
      if (x.conn === 'mpo') g.appendChild(U.s('rect', { x: pw / 2 - 4, y: cy + 3, width: 8, height: 3, rx: 0.8, fill: '#3a4248' }));
      else if (x.conn === 'lc') for (const dx of [-2.6, 2.6]) g.appendChild(U.s('circle', { cx: pw / 2 + dx, cy: cy + 4.6, r: 1.1, fill: '#3a4248' }));
      else g.appendChild(U.s('rect', { x: pw / 2 - 3.5, y: cy + 2.5, width: 7, height: 4, fill: '#3a4248' }));
    } else {
      g.appendChild(U.s('text', { class: 'pp-num', x: pw / 2, y: cy + ph / 2 + 0.5 }, pid.slice(1)));
    }
    /* 埠的用途（割接的新核心） */
    if (plan) {
      const r = plan[pid];
      g.appendChild(U.s('rect', { x: 0, y: cy + ph + 0.8, width: pw, height: 1.8, fill: r ? ROLE_C[r] : 'var(--line-2)', opacity: r ? 0.95 : 0.5 }));
    }
    /* 插著的跳線：往下拉出一小段、貼標籤 */
    if (v.o) {
      const col = (CAT.cords[v.cord] || {}).color || '#888';
      const x0 = pw / 2 - 2.6;
      g.appendChild(U.s('rect', { class: 'pp-cord', x: x0, y: cy + ph + 1, width: 5.2, height: v.loose ? 8 : 12, rx: 1.5, fill: col }));
      if (v.loose) g.appendChild(U.s('path', { class: 'pp-dangle', d: `M${pw / 2} ${cy + ph + 9} q 4 4 0 7`, stroke: col }));
      if (!v.isp) {
        if (v.lab) g.appendChild(U.s('rect', { x: pw / 2 - 4.2, y: cy + ph + 6, width: 8.4, height: 3.6, rx: 0.6, fill: '#f4f4ef', stroke: '#9aa4ab', 'stroke-width': 0.3 }));
        else g.appendChild(U.s('text', { class: 'pp-q', x: pw / 2 + 5.5, y: cy + ph + 10 }, '?'));
      }
      if (v.self && v.self.tag === 'burnin') g.appendChild(U.s('text', { class: 'pp-q warn', x: pw / 2 + 5.5, y: cy + ph + 10 }, '!'));
    }
    if (sel || isFrom) g.appendChild(U.s('rect', { class: 'pp-ring', x: -2.5, y: cy - 2.5, width: pw + 5, height: ph + 5, rx: 3 }));
    const click = () => onPort(nodeId, pid);
    g.addEventListener('click', click);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
    return g;
  }

  /* ---------- 點埠 ---------- */
  function onPort(n, p) {
    const o = P().at(n, p);
    if (PU.hold && !o) { plugHere(n, p); return; }
    if (PU.from && !o && !(PU.from.n === n && PU.from.p === p)) { openPatch(PU.from, { n, p }); return; }
    PU.sel = { n, p };
    UI.refresh();
  }
  /** 結果提示：動作訊息 + 插上去之後的燈號 */
  function report(r, n, p) {
    if (!r) return;
    if (!r.ok) { UI.toast(r.msg, 'bad'); return; }
    const v = n ? portView(n, p) : null;
    const st = v && v.st;
    if (st && !st.fwd && st.code !== 'blk' && st.code !== 'stby') UI.toast(`${r.msg}。⚠ ${st.text}`, 'warn', { ms: 7000 });
    else if (st && st.code === 'blk') UI.toast(`${r.msg}。燈號琥珀色：${st.text}`, 'warn', { ms: 6000 });
    else UI.toast(r.msg + (st && st.fwd ? '。✓ Link up' : ''), 'ok');
  }
  function plugHere(n, p) {
    const x = P().st().loose.find((y) => y.id === PU.hold);
    if (!x) { PU.hold = null; UI.refresh(); return; }
    const cord = CAT.cords[x.cord];
    /* 跳線不夠長（例如同機櫃用的 3 m 線要拉到別座機櫃）：收掉，從另一端接一條新的 */
    const need = x.node === n || x.node.startsWith('F:') ? 0 : G.Act.linkLength(x.node, n);
    if (need > x.len) {
      const far = { n: x.node, p: x.pid };
      UI.confirm('跳線不夠長', `這條跳線只有 ${x.len} m，從 ${P().label(x.node, x.pid)} 拉不到 ${Q.nodeName(n)}（要 ${need} m）。把它收掉，從 ${P().label(x.node, x.pid)} 接一條新的 ${need} m 跳線到 ${P().name(n, p)}？`, '換一條新跳線', () => {
        const r = P().unplug(x.node, x.pid);
        if (!r.ok) { UI.toast(r.msg, 'bad'); return; }
        PU.hold = null;
        openPatch(far, { n, p }, Object.assign({ lacp: !!x.lacp }, x.zone ? { zone: x.zone } : {}));
      });
      return;
    }
    const needMod = cls(p) !== 'rj45' && cord.media !== 'dac' && !P().mod(n, p);
    const go = (mk) => {
      const r = P().plug(x.id, n, p, mk);
      if (r.ok) { PU.hold = null; PU.sel = { n, p }; }
      report(r, n, p);
      G.bus.emit('change', { what: 'links' });
    };
    if (!needMod) { go(null); return; }
    /* 空的 SFP / QSFP 槽：先選模組（預設和另一端一樣） */
    const farMod = P().mod(x.node, x.pid);
    const opts = Object.entries(CAT.xcvr).filter(([k, m]) => m.form === cls(p) && m.conn === cord.conn);
    if (!opts.length) { UI.toast(`${cord.name}的接頭插不進 ${P().name(n, p)} 的任何模組`, 'bad'); return; }
    let pick = opts.some(([k]) => k === farMod) ? farMod : opts[0][0];
    const body = h('div', { class: 'col', style: { gap: '10px' } });
    const draw = () => {
      U.clear(body);
      const pv = P().plugPreview(x.id, n, p, pick);
      body.append(
        h('div', { class: 'small' }, `${P().label(n, p)} 是空的 ${clsName(n, p)} 槽，先插一個光模組。另一端（${x.lab ? P().label(x.node, x.pid) : '？沒有標籤'}）是 ${farMod ? CAT.xcvr[farMod].name : '—'}。`),
        h('select', { 'aria-label': '光模組', 'data-hint': 'pp-plugmod', onchange: (e) => { pick = e.target.value; draw(); } },
          opts.map(([k, m]) => h('option', { value: k, selected: k === pick || null }, `${m.name}（${P().MEDIA[m.media]}${m.wl ? ' ' + m.wl + ' nm' : ''}）· ${U.money(m.price)}${P().speeds(n, p).includes(m.speed) ? '' : ' · 這個埠不支援'}`))),
        ...pv.errs.map((e) => h('div', { class: 'note bad small' }, e)),
        ...pv.warns.map((w) => h('div', { class: 'note warn small' }, w)),
        pv.ok && pv.state && pv.state.fwd ? h('div', { class: 'note ok small' }, '插上去就會通：' + pv.state.text) : null);
    };
    draw();
    UI.modal({ kicker: '插線', title: `插到 ${P().label(n, p)}`, body, blocking: true,
      actions: [{ label: '取消', kind: 'ghost' }, { label: `插上模組和跳線${winMin(CAT.physMin.plug + CAT.physMin.module)}`, kind: 'primary', hint: 'pp-plug-ok', onClick: () => go(pick) }] });
  }

  /* ---------- 接新線的對話框 ---------- */
  function defaults(A, B) {
    const o = { cord: 'om4', modA: null, modB: null, ds: 10000, lacp: false, zone: G.Act.defaultZone(A.n, B.n) };
    const ca = cls(A.p), cb = cls(B.p);
    const ma = P().mod(A.n, A.p), mb = P().mod(B.n, B.p);
    const sa = P().speeds(A.n, A.p), sb = P().speeds(B.n, B.p);
    const common = sa.filter((v) => sb.includes(v));
    const len = A.n === B.n ? 3 : G.Act.linkLength(A.n, B.n);
    if (ca === 'rj45' || cb === 'rj45') {
      o.cord = 'cat6a';
      if (ca !== 'rj45' && !ma) o.modA = '1G-T';
      if (cb !== 'rj45' && !mb) o.modB = '1G-T';
      return o;
    }
    const ref = ma || mb;
    if (ref) {
      const x = CAT.xcvr[ref];
      o.cord = P().cordFor(x.media === 'copper' ? 'cat6a' : x.media === 'smf' ? 'os2' : 'om4', ref);
      const pickFor = (n, p) => (CAT.xcvr[ref].form === cls(p) ? ref : P().modFor(x.media === 'copper' ? 'copper' : x.media, x.speed, cls(p)));
      if (!ma) o.modA = pickFor(A.n, A.p);
      if (!mb) o.modB = pickFor(B.n, B.p);
      return o;
    }
    const sp = common.length ? common[common.length - 1] : sa[sa.length - 1] || 10000;
    if (ca === cb && len <= (CAT.cables.dac.max[sp] || 0)) { o.cord = 'dac'; o.ds = sp; return o; }
    const media = len <= (CAT.cables.om4.max[sp] || 0) ? 'mmf' : 'smf';
    o.modA = P().modFor(media, sp, ca); o.modB = P().modFor(media, sp, cb);
    o.cord = P().cordFor(media === 'smf' ? 'os2' : 'om4', o.modA);
    return o;
  }
  function openPatch(A, B, init) {
    /* init：換掉太短的舊跳線時，沿用原本線路的 LACP 與防火牆介面設定 */
    const opt = Object.assign(defaults(A, B), init || {});
    const body = h('div', { class: 'col', style: { gap: '12px' } });
    let m = null;
    const endBox = (E, key) => {
      const c = cls(E.p), mod = P().mod(E.n, E.p);
      const sp = P().speeds(E.n, E.p);
      const dac = CAT.cords[opt.cord] && CAT.cords[opt.cord].media === 'dac';
      let inner;
      if (c === 'rj45') inner = h('div', { class: 'small muted' }, '內建 RJ45（不用模組）');
      else if (dac) inner = h('div', { class: 'small muted' }, mod ? `插著 ${CAT.xcvr[mod].name}：DAC 要插空槽` : 'DAC 兩端自己就是模組');
      else if (mod) inner = h('div', { class: 'small' }, `已插 ${CAT.xcvr[mod].name}`);
      else {
        const opts = Object.entries(CAT.xcvr).filter(([k, x]) => x.form === c);
        inner = h('select', { 'aria-label': '光模組', 'data-hint': 'pp-dlg-' + key, onchange: (e) => { opt[key] = e.target.value || null; render(); } },
          h('option', { value: '' }, '— 選光模組 —'),
          opts.map(([k, x]) => h('option', { value: k, selected: opt[key] === k || null }, `${x.name}（${P().MEDIA[x.media]}）· ${U.money(x.price)}${sp.includes(x.speed) ? '' : ' · 不支援'}`)));
      }
      return h('div', { class: 'tile col', style: { gap: '4px' } },
        h('b', {}, Q.nodeName(E.n)), h('span', { class: 'mono small' }, `${P().name(E.n, E.p)} · ${clsName(E.n, E.p)}（${sp.map(U.speed).join(' / ')}）`), inner);
    };
    const render = () => {
      const pv = P().preview(A.n, A.p, B.n, B.p, opt);
      U.clear(body);
      body.appendChild(h('div', { class: 'grid c2' }, endBox(A, 'modA'), endBox(B, 'modB')));
      const cords = h('div', { class: 'grid c3' });
      for (const [k, c] of Object.entries(CAT.cords)) {
        cords.appendChild(h('button', { class: 'btn' + (opt.cord === k ? ' on' : ''), 'data-hint': 'pp-cord:' + k, style: { justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }, onclick: () => { opt.cord = k; if (c.media === 'dac') { opt.modA = null; opt.modB = null; } render(); } },
          h('span', { style: { width: '8px', height: '26px', borderRadius: '3px', background: c.color, flex: 'none' } }),
          h('span', { class: 'col', style: { gap: '0' } }, h('b', { class: 'small' }, c.short), h('span', { class: 'tiny dim' }, `${c.conn === 'mpo' ? 'MPO' : c.conn === 'lc' ? 'LC-LC' : c.conn === 'dac' ? '兩端模組' : 'RJ45'} · ${U.money(P().cordPrice(k, opt.ds))}`))));
      }
      body.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, `跳線（這段約 ${pv.len} m）`), cords));
      if (CAT.cords[opt.cord] && CAT.cords[opt.cord].media === 'dac') {
        const sa = P().speeds(A.n, A.p).filter((v) => P().speeds(B.n, B.p).includes(v) && CAT.cables.dac.max[v]);
        if (!sa.includes(opt.ds)) opt.ds = sa[sa.length - 1] || opt.ds;
        body.appendChild(h('div', { class: 'row wrap' }, h('span', { class: 'label' }, 'DAC 速率'), h('div', { class: 'seg' }, sa.map((v) => h('button', { class: opt.ds === v ? 'on' : '', onclick: () => { opt.ds = v; render(); } }, U.speed(v))))));
      }
      if (pv.existing && A.n !== B.n) {
        body.appendChild(h('label', { class: 'row small', style: { gap: '8px', cursor: 'pointer' } },
          h('input', { type: 'checkbox', 'data-hint': 'pp-dlg-lacp', checked: opt.lacp || pv.existing.lacp || null, disabled: pv.existing.lacp || null, onchange: (e) => { opt.lacp = e.target.checked; render(); } }),
          h('span', {}, h('b', {}, '設定 LACP（port-channel）'), `　${Q.nodeName(A.n)} ⇄ ${Q.nodeName(B.n)} 已經有 ${pv.existing.members.length} 條線：LACP 讓它們合成一條、一起轉送${pv.existing.lacp ? '（已經設定）' : ''}`)));
      }
      const fw = [A.n, B.n].filter((x) => Q.nodeKind(x) === 'firewall').length === 1 && !pv.existing;
      if (fw) body.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '防火牆介面區域'),
        h('div', { class: 'seg' }, ['outside', 'inside', 'dmz'].map((z) => h('button', { class: opt.zone === z ? 'on' : '', onclick: () => { opt.zone = z; render(); } }, UI.ZONE_NAMES[z])))));
      for (const e of pv.errs) body.appendChild(h('div', { class: 'note bad' }, e));
      for (const w of pv.warns) body.appendChild(h('div', { class: 'note warn' }, w));
      if (pv.ok && pv.state && pv.state.fwd) body.appendChild(h('div', { class: 'note ok' }, `插上去就會通：${U.speed(pv.state.speed)} Link up`));
      body.appendChild(h('div', { class: 'row between' },
        h('span', { class: 'mono small muted' }, `費用 ${U.money(pv.cost)}${G.Cut && G.Cut.inWindow() ? ` · 花 ${pv.min} 分鐘` : ''}`),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'),
          h('button', { class: 'btn primary', 'data-hint': 'pp-dlg-ok', disabled: !pv.ok || null, onclick: () => {
            const r = P().patch(A.n, A.p, B.n, B.p, opt);
            if (r.ok) { m.close(); PU.from = null; PU.sel = { n: B.n, p: B.p }; }
            report(r, B.n, B.p);
            G.bus.emit('change', { what: 'links' });
          } }, '接上'))));
    };
    m = UI.modal({ kicker: '接新線', title: `${P().label(A.n, A.p)} ⇄ ${P().label(B.n, B.p)}`, wide: true, body, blocking: true });
    render();
  }

  /* ---------- 埠詳情：show interface ---------- */
  const FIX = {
    nomod: '插上和另一端同一種的光模組。',
    unsup: '換成這個埠支援的速率（看埠的種類：SFP+ 最高 10G、SFP28 最高 25G）。',
    speed: '兩端的模組速率要一樣：換成成對的模組。',
    media: 'SR / SX（多模）配 OM4 水藍色跳線；LR / LX / FR（單模）配 OS2 黃色跳線。',
    wl: '兩端要同一種模組：SR ↔ SR、LR ↔ LR。',
    reach: '距離太遠：改用單模光纖（OS2）+ LR 模組。',
    pol: '按「翻轉極性」把其中一端的 LC 接頭 A/B 對調。',
    shut: '依 MOP 插到指定的埠，或把這個埠設定成正確的用途。',
    vlan: '依 MOP 插到指定的埠，或把這個埠改成正確的用途（VLAN）。',
    blk: '要兩條一起用，就把這對設備之間的線設定 LACP；不需要的話就拔掉多餘的線。',
    storm: '立刻開啟 STP，或拔掉造成迴圈的線。',
    down: '先讓對端設備恢復運作（電源、故障、開機中）。',
    stby: '伺服器接兩條線要一起用，要設定 LACP（網卡綁定）。',
  };
  function showInt(n, p, v) {
    const nm = P().name(n, p), st = v.st;
    const lines = [];
    let s1;
    if (v.isp) s1 = `${nm} is ${v.led === 'on' ? 'up' : 'down'}, line protocol is ${v.led === 'on' ? 'up' : 'down'} (ISP 專線交接)`;
    else if (!v.o) s1 = `${nm} is down, line protocol is down (notconnect)`;
    else if (v.loose) s1 = `${nm} is down, line protocol is down (notconnect：另一端懸空)`;
    else if (st.code === 'shut') s1 = `${nm} is administratively down, line protocol is down (disabled)`;
    else if (st.code === 'unsup') s1 = `${nm} is down, line protocol is down (err-disabled)`;
    else if (st.up) s1 = `${nm} is up, line protocol is up (${st.code === 'blk' ? 'blocking' : st.code === 'storm' ? 'broadcast storm' : st.code === 'stby' ? 'standby' : 'connected'})`;
    else s1 = `${nm} is down, line protocol is down (notconnect)`;
    lines.push(s1);
    const mod = v.mod ? CAT.xcvr[v.mod] : null;
    const cord = v.cord ? CAT.cords[v.cord] : null;
    lines.push(`  Hardware: ${clsName(n, p)}${mod ? `, ${mod.name} · ${P().MEDIA[mod.media]}${mod.wl ? ' ' + mod.wl + 'nm' : ''} · ${mod.conn.toUpperCase()}` : cls(p) === 'rj45' ? ', 1000BASE-T' : cord && cord.media === 'dac' ? `, DAC ${U.speed((v.m || v.self || v.loose || {}).ds || 0)}` : ', (空槽：沒有模組)'}`);
    if (v.o && !v.isp) lines.push(`  Description: ${v.lab ? (v.far ? P().label(v.far[0], v.far[1]) : v.loose ? '（另一端懸空）' : '') : '（沒有標籤）'}`);
    if (st && st.up) lines.push(`  Speed: ${U.speed(st.speed)}b/s, full-duplex`);
    if (mod && st) lines.push(`  Rx power: ${st.rx[v.end].toFixed(1).replace("-", "−")} dBm   Tx power: −1.9 dBm`);
    if (cord && !v.isp) lines.push(`  Cable: ${cord.name}${(v.m || v.self || v.loose) ? ` · ${(v.m || v.self || v.loose).len} m` : ''}${cord.conn === 'lc' || cord.conn === 'mpo' ? ` · 極性 ${(v.m || v.self || v.loose || {}).pol === false ? '反（A-A）' : '正（A-B）'}` : ''}`);
    const d = G.S.devices[n];
    if (d && Q.nodeKind(n) === 'switch') lines.push(`  Spanning-tree: ${d.stp === false ? 'disabled' : st && st.code === 'blk' && st.led[v.end] === 'blk' ? 'BLK（阻擋）' : st && st.up ? 'FWD（轉送）' : '—'}`);
    if (d && d.plan) lines.push(`  Config: ${d.plan[p] ? P().ROLES[d.plan[p]].cfg + '（' + P().ROLES[d.plan[p]].name + '）' : 'shutdown'}`);
    return h('pre', { class: 'pp-sh' }, lines.join('\n'));
  }
  function portCard() {
    const { n, p } = PU.sel;
    if (!P().exists(n, p)) { PU.sel = null; return null; }
    const v = portView(n, p);
    const s = G.S, d = s.devices[n];
    const card = h('div', { class: 'card col pp-portcard', style: { gap: '8px' } });
    card.appendChild(h('div', { class: 'card-h', style: { marginBottom: '0' } },
      h('h3', {}, `${Q.nodeName(n)} ${P().name(n, p)}`), h('button', { class: 'btn ghost xs', onclick: () => { PU.sel = null; UI.refresh(); } }, '✕')));
    card.appendChild(showInt(n, p, v));
    const st = v.st;
    if (st) card.appendChild(h('div', { class: 'note small ' + (st.fwd ? 'ok' : st.code === 'blk' || st.code === 'stby' || st.code === 'vlan' ? 'warn' : 'bad') }, st.text, FIX[st.code] ? h('div', { class: 'tiny', style: { marginTop: '3px' } }, '👉 ' + FIX[st.code]) : null));
    if (v.self && v.self.tag === 'burnin') card.appendChild(h('div', { class: 'note warn small' }, '這是原廠燒機測試時留下的測試線（把兩個埠接在一起）。上線前一定要拆掉！'));
    const acts = h('div', { class: 'row wrap' });
    const btn = (label, hint, fn, kind) => h('button', { class: 'btn sm ' + (kind || ''), 'data-hint': hint, onclick: fn }, label);
    if (v.o && (v.m || v.self)) {
      acts.appendChild(btn(`拔掉這一端${winMin(CAT.physMin.unplug)}`, 'pp-unplug', () => unplug(n, p), 'warn'));
      const cord = CAT.cords[v.cord];
      if (cord && (cord.conn === 'lc' || cord.conn === 'mpo')) acts.appendChild(btn(`翻轉極性${winMin(CAT.physMin.flip)}`, 'pp-flip', () => { report(P().flip(n, p), n, p); }));
      if (!v.lab) acts.appendChild(btn(`循線追蹤並貼標籤${winMin(CAT.physMin.trace + CAT.physMin.label)}`, 'pp-tag', () => { const r = P().tag(n, p); UI.res(r); }, 'primary'));
      if (v.lab && v.far && !(v.far[0] === n && v.far[1] === p)) acts.appendChild(btn('跳到另一端', 'pp-far', () => goPort(v.far[0], v.far[1])));
      if (v.l) {
        const par = v.l.members.length >= 2 || v.l.lacp;
        if (par) acts.appendChild(btn(v.l.lacp ? `取消 LACP${winMin(CAT.physMin.config)}` : `設定 LACP${winMin(CAT.physMin.config)}`, 'pp-lacp', () => UI.res(P().setLacp(v.l.id, !v.l.lacp)), v.l.lacp ? 'ghost' : 'primary'));
      }
    } else if (v.loose) {
      card.appendChild(h('div', { class: 'small' }, '這一端插著，另一端懸空（被拔起來還沒插）。'));
      acts.appendChild(btn('拿起懸空的那一端', 'pp-take', () => { PU.hold = v.loose.id; PU.from = null; UI.refresh(); }, 'primary'));
      acts.appendChild(btn(`整條收掉${winMin(CAT.physMin.unplug)}`, 'pp-remove', () => { report(P().unplug(n, p)); }, 'ghost'));
    } else if (v.isp) {
      card.appendChild(h('div', { class: 'small muted' }, 'ISP 專線的交接埠：要換路由器請到拓撲的 ISP 節點。'));
    } else {
      if (PU.hold) acts.appendChild(btn('把手上的線插到這裡', 'pp-plug', () => plugHere(n, p), 'primary'));
      if (PU.from && !(PU.from.n === n && PU.from.p === p)) acts.appendChild(btn('接到這裡', 'pp-to', () => openPatch(PU.from, { n, p }), 'primary'));
      if (!PU.from && !PU.hold) acts.appendChild(btn('從這裡接一條新線', 'pp-from', () => { PU.from = { n, p }; PU.hold = null; UI.refresh(); }, 'primary'));
      if (cls(p) !== 'rj45') {
        const opts = Object.entries(CAT.xcvr).filter(([k, x]) => x.form === cls(p));
        const sp = P().speeds(n, p);
        const sel = h('select', { 'aria-label': '選光模組', 'data-hint': 'pp-mod' }, h('option', { value: '' }, v.mod ? '— 換成別的模組 —' : '— 選光模組 —'),
          opts.map(([k, x]) => h('option', { value: k, selected: null }, `${x.name}（${P().MEDIA[x.media]}）· ${U.money(x.price)}${sp.includes(x.speed) ? '' : ' · 不支援'}`)));
        const want = modWanted(n, p);
        if (want) sel.value = want;
        card.appendChild(h('div', { class: 'row wrap' }, sel,
          h('button', { class: 'btn sm', 'data-hint': 'pp-mod-ok', onclick: () => { if (sel.value) UI.res(P().insertModule(n, p, sel.value)); } }, `插上模組${winMin(CAT.physMin.module)}`),
          v.mod ? h('button', { class: 'btn sm ghost', 'data-hint': 'pp-rmmod', onclick: () => UI.res(P().removeModule(n, p)) }, '拔掉模組') : null));
        if (want && v.mod !== want) card.appendChild(h('div', { class: 'tiny accent-t' }, `MOP：這個埠要插 ${CAT.xcvr[want].name}`));
      }
    }
    if (acts.children.length) card.appendChild(acts);
    /* 割接的新核心：埠的用途設定 */
    if (d && d.plan) {
      const sel = h('select', { 'aria-label': '埠的設定', 'data-hint': 'pp-role', onchange: (e) => UI.res(P().setRole(n, p, e.target.value || null)) },
        h('option', { value: '' }, 'shutdown（沒有設定）'),
        Object.entries(P().ROLES).map(([k, r]) => h('option', { value: k, selected: d.plan[p] === k || null }, `${r.name}：${r.cfg}`)));
      card.appendChild(h('label', { class: 'field' }, h('span', {}, `埠的設定${winMin(CAT.physMin.config)}`), sel));
    }
    return card;
  }
  /** 割接：MOP 上這個埠要插的模組 */
  function modWanted(n, p) {
    const c = G.S.cut;
    if (!c || c.done || n !== c.neu) return null;
    const row = c.rows.find((r) => r.newPid === p);
    return row ? row.mod : null;
  }
  function unplug(n, p) {
    const c = G.S.cut;
    const doIt = () => { const r = P().unplug(n, p); if (r.ok) { const x = P().st().loose.find((y) => y.fromNode === n && y.fromPid === p); if (x) PU.hold = x.id; } report(r); G.bus.emit('change', { what: 'links' }); };
    if (c && !c.done && n === c.old && G.S.time < c.win.start && c.rows.some((r) => r.oldPid === p)) {
      UI.confirm('還沒到維護窗口', `現在是上班時間，維護窗口是 ${U.dayLabel(c.win.start)} 02:00。提前拔舊核心的線會影響正在使用的同事，也違反變更管理（變更單只核准窗口內施工）。確定要現在拔嗎？`, '還是要拔', doIt, 'danger');
      return;
    }
    doIt();
  }
  function goPort(n, p) {
    const V = G.Views.rack;
    const d = G.S.devices[n];
    if (d && d.rack) V.rack = d.rack;
    PU.sel = { n, p };
    UI.refresh();
    setTimeout(() => { const el = document.querySelector(`[data-hint="port:${n}:${p}"]`); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); }, 60);
  }
  PU.goPort = goPort;

  /* ---------- 手上的線 / 起點 ---------- */
  function holdCard() {
    if (PU.hold) {
      const x = P().st().loose.find((y) => y.id === PU.hold);
      if (!x) { PU.hold = null; return null; }
      const cord = CAT.cords[x.cord];
      const fm = P().mod(x.node, x.pid);
      return h('div', { class: 'card col pp-hold', style: { gap: '6px' } },
        h('b', {}, '✋ 手上拿著一條線的一端'),
        h('div', { class: 'small' }, h('span', { class: 'swatch', style: { background: cord.color } }), ` ${cord.name} · ${x.len} m`),
        h('div', { class: 'small' }, '另一端插在：', h('b', {}, x.lab ? P().label(x.node, x.pid) : '？（沒有標籤：不知道通往哪裡）'), fm ? h('span', { class: 'muted' }, `（${CAT.xcvr[fm].name}）`) : null),
        x.fromNode ? h('div', { class: 'small muted' }, `原本接在：${P().label(x.fromNode, x.fromPid)}`) : null,
        h('div', { class: 'small accent-t' }, `→ 點一個空的埠插上去${cls(x.pid) !== 'rj45' && cord.media !== 'dac' && fm ? `（那個埠要有 ${CAT.xcvr[fm].name}）` : ''}`),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { PU.hold = null; UI.refresh(); } }, '先放下（線留著懸空）')));
    }
    if (PU.from) {
      if (P().at(PU.from.n, PU.from.p)) { PU.from = null; return null; }
      return h('div', { class: 'card col pp-hold', style: { gap: '6px' } },
        h('b', {}, '➕ 接一條新線'),
        h('div', { class: 'small' }, '起點：', h('b', {}, P().label(PU.from.n, PU.from.p))),
        h('div', { class: 'small accent-t' }, '→ 點另一個空的埠當終點（可以切換到別的機櫃）'),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', 'data-hint': 'pp-cancel', onclick: () => { PU.from = null; UI.refresh(); } }, '取消')));
    }
    return null;
  }

  /* ---------- 懸空的線、迴圈 ---------- */
  function looseCard() {
    const L = P().st().loose;
    if (!L.length) return null;
    const card = h('div', { class: 'card col', style: { gap: '6px' } }, h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, `懸空的線（${L.length}）`)));
    for (const x of L) {
      const cord = CAT.cords[x.cord];
      card.appendChild(h('div', { class: 'row between small' },
        h('span', {}, h('span', { class: 'swatch', style: { background: cord.color } }), ' ', x.lab ? P().label(x.node, x.pid) : '？沒有標籤的線', h('span', { class: 'dim' }, x.fromNode ? `（原本接 ${P().label(x.fromNode, x.fromPid)}）` : '')),
        h('span', { class: 'row' },
          h('button', { class: 'btn xs' + (PU.hold === x.id ? ' on' : ''), 'data-hint': 'pp-take:' + x.id, onclick: () => { PU.hold = PU.hold === x.id ? null : x.id; PU.from = null; UI.refresh(); } }, PU.hold === x.id ? '拿著' : '拿起'),
          !x.node.startsWith('F:') ? h('button', { class: 'btn xs ghost', onclick: () => goPort(x.node, x.pid) }, '看') : null)));
    }
    return card;
  }
  function loopCard() {
    const R = G.R.l2;
    if (!R || (!R.loops.length && !R.standby.size)) return null;
    const card = h('div', { class: 'card col', style: { gap: '6px' } }, h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '迴圈與 STP'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-stp') }, 'STP 是什麼')));
    if (R.stormNodes.size) card.appendChild(h('div', { class: 'note bad small' }, `廣播風暴！${R.stormNodes.size} 台設備受影響：迴圈上的交換器都沒開 STP。`));
    for (const lp of R.loops) {
      const where = lp.self ? `${Q.nodeName(lp.self.node)} ${P().name(lp.self.node, lp.self.ap)} ⇄ ${P().name(lp.self.node, lp.self.bp)}（同一台）` : `${Q.nodeName(lp.a)} ⇄ ${Q.nodeName(lp.b)}`;
      const at = lp.self ? [lp.self.node, lp.self.ap] : lp.l && lp.m ? [lp.l.a, lp.m.ap] : null;
      card.appendChild(h('div', { class: 'row between small' },
        h('span', { class: lp.kind === 'storm' ? 'bad-t' : 'warn-t' }, lp.kind === 'storm' ? '⚡ 風暴 ' : '⏸ 阻擋 ', where),
        at ? h('button', { class: 'btn xs ghost', onclick: () => goPort(at[0], at[1]) }, '看') : null));
    }
    if (R.standby.size) card.appendChild(h('div', { class: 'tiny dim' }, `另有 ${R.standby.size} 條伺服器 / 防火牆的備援線待命（沒有 LACP，只用一條）。`));
    return card;
  }
  function legendCard() {
    return h('details', { class: 'card pp-legend' }, h('summary', { class: 'small' }, '燈號與顏色說明'),
      h('div', { class: 'col small', style: { gap: '4px', marginTop: '6px' } },
        Object.entries(LED_T).map(([k, t]) => h('div', { class: 'row' }, U.s('svg', { width: 12, height: 12, viewBox: '0 0 12 12' }, U.s('circle', { class: 'pp-led ' + k, cx: 6, cy: 6, r: 4 })), t)),
        h('div', { class: 'row' }, h('span', { class: 'swatch', style: { background: MEDIA_FILL.mmf } }), '黑色拉環：SR / SX 多模模組（配 OM4 水藍色光纖）'),
        h('div', { class: 'row' }, h('span', { class: 'swatch', style: { background: MEDIA_FILL.smf } }), '藍色拉環：LR / LX / FR 單模模組（配 OS2 黃色光纖）'),
        h('div', { class: 'row' }, h('span', { class: 'swatch', style: { background: MEDIA_FILL.copper } }), '灰色：電口模組（插網路線）'),
        h('div', { class: 'row' }, h('span', { class: 'swatch', style: { background: '#f4f4ef', border: '1px solid #9aa4ab' } }), '白色標籤 = 有貼標籤；', h('b', { class: 'warn-t' }, '?'), ' = 沒標籤'),
        h('div', { class: 'row' }, h('span', { class: 'swatch', style: { background: ROLE_C.floor } }), h('span', { class: 'swatch', style: { background: ROLE_C.srv } }), h('span', { class: 'swatch', style: { background: ROLE_C.fw } }), h('span', { class: 'swatch', style: { background: ROLE_C.core } }), '新核心的埠設定：樓層 / 伺服器 / 防火牆 / 核心互連')));
  }

  /* ---------- 設備卡片 ---------- */
  function devCard(d) {
    const m = CAT.devices[d.model];
    const st = UI.devStatus(d);
    const sw = Q.nodeKind(d.id) === 'switch';
    const P0 = P();
    const unl = P0.ports(d.id).filter((p) => { const o = P0.at(d.id, p); if (!o || o.t === 'isp') return false; const x = o.t === 'm' ? o.m : o.x; return !x.lab; }).length;
    const c = G.S.cut;
    const tag = c && !c.done ? (d.id === c.old ? h('span', { class: 'chip warn' }, '舊核心（要汰換）') : d.id === c.neu ? h('span', { class: 'chip accent' }, '新核心') : null) : null;
    const head = h('div', { class: 'row between wrap', style: { gap: '6px' } },
      h('div', { class: 'row wrap', style: { gap: '6px' } }, h('b', {}, d.name), h('span', { class: 'small muted' }, `${m.name} · ${d.rack} U${d.u}${m.u > 1 ? '–' + (d.u + m.u - 1) : ''}`), h('span', { class: 'chip ' + st.c }, st.t), tag),
      h('div', { class: 'row wrap', style: { gap: '6px' } },
        sw ? h('div', { class: 'seg', role: 'group', 'aria-label': 'STP' },
          h('button', { class: d.stp !== false ? 'on' : '', 'data-hint': 'pp-stp-on:' + d.id, onclick: () => UI.res(P0.setStp(d.id, true)) }, 'STP 開'),
          h('button', { class: d.stp === false ? 'on bad' : '', 'data-hint': 'pp-stp-off:' + d.id, onclick: () => UI.res(P0.setStp(d.id, false)) }, '關')) : null,
        unl ? h('button', { class: 'btn xs', 'data-hint': 'pp-tagall:' + d.id, onclick: () => UI.res(P0.tagAll(d.id)) }, `全部循線貼標籤（${unl}）${winMin(unl * (CAT.physMin.trace + CAT.physMin.label))}`) : null));
    const wrap = h('div', { class: 'pp-scroll' }, faceplate(d.id));
    return h('div', { class: 'card col pp-dev' + (c && !c.done && (d.id === c.old || d.id === c.neu) ? ' hl' : ''), 'data-hint': 'pp-dev:' + d.id, style: { gap: '8px' } }, head, wrap);
  }

  /* ---------- ODF：往各樓層的主幹 ---------- */
  function odfCard() {
    const rows = [];
    for (const f of G.BLD.floors) {
      const fn = 'F:' + f.id;
      const items = [];
      for (const l of Q.linksOf(fn)) for (const m of l.members || []) {
        const fe = l.a === fn ? m.ap : m.bp, dn = l.a === fn ? l.b : l.a, dp = l.a === fn ? m.bp : m.ap;
        const st = P().mState(l, m);
        items.push({ fe, dn, dp, st, lab: m.lab });
      }
      const loose = P().st().loose.filter((x) => x.node === fn);
      if (!items.length && !loose.length) continue;
      rows.push({ f, items, loose });
    }
    if (!rows.length) return null;
    const list = h('div', { class: 'col', style: { gap: '4px' } });
    for (const r of rows) {
      for (const it of r.items) {
        list.appendChild(h('div', { class: 'row between small pp-odf' },
          h('span', {}, h('b', { class: 'mono' }, r.f.id), ' ', h('span', { class: 'mono dim' }, P().name('F:' + r.f.id, it.fe))),
          h('span', { class: 'row' }, U.s('svg', { width: 10, height: 10, viewBox: '0 0 10 10' }, U.s('circle', { class: 'pp-led ' + it.st.led[0], cx: 5, cy: 5, r: 3.5 })),
            h('button', { class: 'btn xs ghost', onclick: () => goPort(it.dn, it.dp) }, it.lab ? P().label(it.dn, it.dp) : `？（${P().label(it.dn, it.dp)}）`))));
      }
      for (const x of r.loose) {
        list.appendChild(h('div', { class: 'row between small pp-odf loose' },
          h('span', {}, h('b', { class: 'mono' }, r.f.id), ' ', h('span', { class: 'mono dim' }, P().name(x.node, x.pid)), h('span', { class: 'warn-t' }, '　懸空（待接）')),
          h('button', { class: 'btn xs' + (PU.hold === x.id ? ' on' : ''), 'data-hint': 'pp-take:' + x.id, onclick: () => { PU.hold = PU.hold === x.id ? null : x.id; PU.from = null; UI.refresh(); } }, PU.hold === x.id ? '拿著' : '拿起')));
      }
    }
    return h('details', { class: 'card pp-odfcard', open: rows.some((r) => r.loose.length) || null },
      h('summary', {}, h('b', {}, 'ODF 光纖配線架 · 往各樓層的主幹'), h('span', { class: 'small muted' }, `　${rows.length} 層樓`)),
      h('div', { class: 'small dim', style: { margin: '6px 0' } }, '主幹光纖從 B1 經弱電豎井到各樓層 IDF。這裡是機房這一端：跳線從 ODF 接到核心交換器的埠。'),
      list);
  }

  /* ---------- 狀態列 ---------- */
  function statusStrip() {
    const s = G.S;
    let total = 0, ok = 0, bad = 0, blk = 0;
    for (const l of Object.values(s.links)) for (const m of l.members || []) {
      total++;
      const st = P().mState(l, m);
      if (st.fwd) ok++; else if (st.code === 'blk' || st.code === 'stby') blk++; else bad++;
    }
    const R = G.R.l2 || { stormNodes: new Set() };
    const loose = P().st().loose.length;
    const t = (k, v, c) => h('div', { class: 'tile gauge' }, h('div', { class: 'k' }, k), h('div', { class: 'big ' + (c || '') }, v));
    return h('div', { class: 'room-bar' },
      t('跳線', String(total)), t('正常轉送', String(ok), 'ok-t'), t('阻擋 / 待命', String(blk), blk ? 'warn-t' : ''), t('不通', String(bad), bad ? 'bad-t' : ''), t('懸空', String(loose), loose ? 'warn-t' : ''),
      t('廣播風暴', R.stormNodes.size ? '發生中！' : '沒有', R.stormNodes.size ? 'bad-t' : 'ok-t'));
  }

  /* ---------- 掛載 ---------- */
  PU.mount = (el, V) => {
    const s = G.S;
    if (PU.sel && !P().exists(PU.sel.n, PU.sel.p)) PU.sel = null;
    if (PU.hold && !P().st().loose.some((x) => x.id === PU.hold)) PU.hold = null;
    if (PU.from && (!P().exists(PU.from.n, PU.from.p) || P().at(PU.from.n, PU.from.p))) PU.from = null;
    if (G.CutUI) { const b = G.CutUI.banner(); if (b) el.appendChild(b); }
    el.appendChild(statusStrip());
    const left = h('div', { class: 'col', style: { gap: '10px', minWidth: '0' } });
    const right = h('div', { class: 'col pp-side', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'pp-layout' }, left, right));
    const devs = Object.values(s.devices).filter((d) => d.rack === V.rack && !d.host && hasPorts(d)).sort((a, b) => b.u - a.u);
    if (!V.rack) left.appendChild(h('div', { class: 'card empty' }, '機房裡還沒有機櫃。'));
    else if (!devs.length) left.appendChild(h('div', { class: 'card empty' }, `機櫃 ${V.rack} 裡沒有網路設備。上面的機櫃分頁可以切換。`));
    for (const d of devs) left.appendChild(devCard(d));
    const odf = odfCard();
    if (odf) left.appendChild(odf);
    if (G.CutUI) { const c = G.CutUI.card(); if (c) right.appendChild(c); }
    const hc = holdCard();
    if (hc) right.appendChild(hc);
    if (PU.sel) { const pc = portCard(); if (pc) right.appendChild(pc); }
    else right.appendChild(h('div', { class: 'card small muted' }, '點面板上的任何一個埠，看它的狀態（show interface）、插拔跳線或光模組。'));
    for (const c of [looseCard(), loopCard(), legendCard()]) if (c) right.appendChild(c);
    PU.sigL = PU.sig(V);
  };
  /** 燈號有變才重畫（設備開機、故障、ISP 開通……） */
  PU.sig = (V) => {
    const out = [];
    for (const d of Object.values(G.S.devices)) {
      if (d.rack !== V.rack || d.host) continue;
      for (const p of P().ports(d.id)) { const o = P().at(d.id, p); if (o) out.push(portView(d.id, p).led); }
      out.push(UI.devStatus(d).c);
    }
    const R = G.R.l2;
    return out.join('') + '|' + (R ? R.loops.length + ':' + R.stormNodes.size : '');
  };
  PU.update = (V) => {
    if (G.CutUI) G.CutUI.tick();
    const sig = PU.sig(V);
    if (sig !== PU.sigL) { PU.sigL = sig; UI.refresh(); }
  };
})(window.G = window.G || {});
