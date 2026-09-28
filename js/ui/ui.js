/* 介面外殼：頂部狀態列、交換器面板導覽、任務面板、對話框、提示訊息、開始畫面、選單 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q;
  const UI = {};
  G.UI = UI;
  G.Views = G.Views || {};

  const NAV = [
    { id: 'building', label: '大樓' },
    { id: 'floor', label: '樓層' },
    { id: 'rack', label: '機房' },
    { id: 'topo', label: '拓撲' },
    { id: 'noc', label: '監控' },
    { id: 'fw', label: '防火牆' },
    { id: 'inc', label: '事件' },
    { id: 'shop', label: '採購' },
    { id: 'kb', label: '知識' },
  ];
  UI.NAV = NAV;
  UI.cur = { view: 'building', param: null };
  const modals = [];
  let els = {};
  let dirty = false, sideDirty = false, lastSide = 0, navCache = {}, lastAuditAt = 0, auditCrit = false;

  UI.blocking = () => modals.some((m) => m.blocking);

  /* ---------- 圖示 ---------- */
  UI.logo = (size) => U.s('svg', { width: size || 30, height: size || 30, viewBox: '0 0 32 32', 'aria-hidden': 'true' },
    U.s('rect', { x: 5, y: 2, width: 22, height: 28, rx: 2.5, fill: 'var(--bg-4)', stroke: 'var(--line-2)' }),
    U.s('rect', { x: 8, y: 6, width: 16, height: 4, rx: 1, fill: 'var(--jack)' }),
    U.s('rect', { x: 8, y: 12, width: 16, height: 4, rx: 1, fill: 'var(--jack)' }),
    U.s('rect', { x: 8, y: 18, width: 16, height: 4, rx: 1, fill: 'var(--jack)' }),
    U.s('circle', { cx: 21, cy: 8, r: 1.1, fill: 'var(--ok)' }),
    U.s('circle', { cx: 21, cy: 14, r: 1.1, fill: 'var(--accent)' }),
    U.s('circle', { cx: 21, cy: 20, r: 1.1, fill: 'var(--warn)' }),
    U.s('path', { d: 'M10 26h12', stroke: 'var(--accent-2)', 'stroke-width': 1.6, 'stroke-linecap': 'round' }));
  function jack() {
    return U.s('svg', { width: 36, height: 26, viewBox: '0 0 36 26', 'aria-hidden': 'true' },
      U.s('path', { d: 'M3 3h30v15h-9v5H12v-5H3z', fill: 'var(--jack)', stroke: 'var(--line-2)', 'stroke-width': 1.2 }),
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => U.s('rect', { x: 8.2 + i * 2.6, y: 5, width: 1.2, height: 4, fill: 'var(--pin)' })));
  }

  /* ---------- 明暗主題：跟隨系統 / 淺色 / 深色（存在這台瀏覽器） ---------- */
  const THEME_KEY = 'infraops.theme';
  const THEMES = [['auto', '跟隨系統'], ['light', '淺色'], ['dark', '深色']];
  UI.theme = () => { const t = U.store.get(THEME_KEY); return t === 'light' || t === 'dark' ? t : 'auto'; };
  UI.setTheme = (t) => {
    if (t === 'light' || t === 'dark') { U.store.set(THEME_KEY, t); document.documentElement.setAttribute('data-theme', t); }
    else { U.store.del(THEME_KEY); document.documentElement.removeAttribute('data-theme'); }
    themeChanged();
  };
  function themeChanged() {
    G.bus.emit('theme', U.isDark());
    renderThemeBtn();
    for (const seg of document.querySelectorAll('[data-theme-seg]')) syncThemeSeg(seg);
    if (els.main && G.S) UI.refresh();
  }
  function syncThemeSeg(seg) {
    const cur = UI.theme();
    for (const b of seg.children) { const on = b.dataset.k === cur; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  }
  /** 三選一的外觀切換（選單與開始畫面使用） */
  UI.themeSeg = () => {
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': '畫面外觀', 'data-theme-seg': '1' },
      THEMES.map(([k, label]) => h('button', { 'data-k': k, onclick: () => UI.setTheme(k) }, label)));
    syncThemeSeg(seg);
    return seg;
  };
  const ico = (kind) => {
    const svg = U.s('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'aria-hidden': 'true' });
    if (kind === 'sun') {
      svg.appendChild(U.s('circle', { cx: 12, cy: 12, r: 4.2 }));
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
        svg.appendChild(U.s('path', { d: `M${(12 + c * 7.2).toFixed(2)} ${(12 + s * 7.2).toFixed(2)}L${(12 + c * 9.6).toFixed(2)} ${(12 + s * 9.6).toFixed(2)}` }));
      }
    } else svg.appendChild(U.s('path', { d: 'M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7z' }));
    return svg;
  };
  /** 頂部列的快速切換：目前是深色就顯示太陽（切到淺色），反之顯示月亮 */
  function renderThemeBtn() {
    const b = els.themeBtn;
    if (!b) return;
    const dark = U.isDark();
    const label = dark ? '切換成淺色背景' : '切換成深色背景';
    U.mount(b, ico(dark ? 'sun' : 'moon'));
    b.title = label;
    b.setAttribute('aria-label', label);
  }
  try {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onSys = () => { if (UI.theme() === 'auto') themeChanged(); };
    if (mq.addEventListener) mq.addEventListener('change', onSys); else if (mq.addListener) mq.addListener(onSys);
  } catch (e) { /* 舊瀏覽器不支援就算了 */ }

  /* ---------- 殼層 ---------- */
  UI.build = () => {
    const root = document.getElementById('root');
    U.clear(root);
    els.clockDay = h('span', { class: 'day' });
    els.clockTime = h('span', { class: 'time' });
    els.speed = h('div', { class: 'speed', role: 'group', 'aria-label': '遊戲速度' });
    els.kpis = h('div', { class: 'kpis' });
    els.missionBtn = h('button', { class: 'btn sm', onclick: () => UI.toggleSide() }, '任務');
    els.themeBtn = h('button', { class: 'btn sm icon', onclick: () => UI.setTheme(U.isDark() ? 'light' : 'dark') });
    renderThemeBtn();
    const top = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, UI.logo(30), h('div', {}, h('div', { class: 'name' }, '萬人網管'), h('div', { class: 'sub' }, 'NOVALUX HQ · 21F + B1 MDF'))),
      h('div', { class: 'clock' }, h('div', { class: 'col', style: { gap: '0' } }, els.clockDay, els.clockTime), els.speed),
      els.kpis,
      h('div', { class: 'top-actions' }, els.themeBtn, els.missionBtn, h('button', { class: 'btn sm', onclick: () => UI.menu(), 'aria-label': '選單' }, '選單')));
    els.rail = h('nav', { class: 'rail', 'aria-label': '主要功能' }, h('div', { class: 'plate' }, 'NX-CORE 48P'));
    NAV.forEach((n, i) => {
      const b = h('button', { class: 'port', onclick: () => UI.go(n.id), title: n.label },
        h('span', { class: 'pn' }, U.pad2(i + 1)),
        h('span', { class: 'leds' }, h('i', { class: 'led link' }), h('i', { class: 'led act' })),
        jack(),
        h('span', { class: 'lbl' }, n.label),
        h('span', { class: 'badge' }, ''));
      navCache[n.id] = b;
      els.rail.appendChild(b);
    });
    els.main = h('main', { id: 'main' });
    els.side = h('aside', { id: 'side', 'aria-label': '任務' });
    els.app = h('div', { id: 'app' }, top, els.rail, els.main, els.side);
    els.toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    els.modals = h('div', {});
    root.append(els.app, els.toasts, els.modals);
    UI.renderSpeed();
    UI.go(UI.cur.view, UI.cur.param);
    UI.renderSide();
    UI.update();
  };

  UI.toggleSide = (force) => {
    const open = force !== undefined ? force : !els.side.classList.contains('open');
    els.side.classList.toggle('open', open);
  };

  UI.go = (target, param) => {
    if (!els.main) return;
    let view = target, p = param;
    if (typeof target === 'string' && target.includes(':')) { [view, p] = target.split(':'); }
    if (!G.Views[view]) view = 'building';
    const prev = G.Views[UI.cur.view];
    if (prev && prev.unmount) prev.unmount();
    UI.cur = { view, param: p === undefined ? null : p };
    for (const n of NAV) navCache[n.id].classList.toggle('on', n.id === view);
    U.clear(els.main);
    els.main.scrollTop = 0;
    try { G.Views[view].mount(els.main, UI.cur.param); } catch (e) { console.error(e); els.main.appendChild(h('div', { class: 'note bad' }, '畫面載入失敗：' + e.message)); }
    if (window.innerWidth <= 1240) UI.toggleSide(false);
  };
  UI.refresh = () => {
    if (!els.main) return;
    const v = G.Views[UI.cur.view];
    if (!v) return;
    const st = els.main.scrollTop;
    if (v.refresh) v.refresh();
    else { if (v.unmount) v.unmount(); U.clear(els.main); v.mount(els.main, UI.cur.param); }
    els.main.scrollTop = st;
  };

  /* ---------- 2D / 3D 檢視切換（每個畫面各自記住，存在這台瀏覽器） ---------- */
  UI.pref3d = (key, val) => {
    const k = 'infraops.view3d.' + key;
    if (val === undefined) return !!G.M3 && U.store.get(k) === '1';
    U.store.set(k, val ? '1' : '0');
    return !!val;
  };
  UI.toggle3d = (key) => {
    if (!G.M3) return null;
    const on = UI.pref3d(key);
    const set = (v) => { if (v !== UI.pref3d(key)) { UI.pref3d(key, v); UI.refresh(); } };
    return h('div', { class: 'seg', role: 'group', 'aria-label': '檢視方式' },
      h('button', { class: on ? '' : 'on', 'aria-pressed': String(!on), onclick: () => set(false) }, '2D'),
      h('button', { class: on ? 'on' : '', 'aria-pressed': String(on), onclick: () => set(true) }, '3D'));
  };

  UI.renderSpeed = () => {
    if (!els.speed || !G.S) return;
    U.clear(els.speed);
    const s = G.S;
    for (const sp of G.Engine.SPEEDS) {
      const on = sp.v === 0 ? s.speed === 0 : s.speed === sp.v;
      els.speed.appendChild(h('button', { class: (sp.v === 0 ? 'pause ' : '') + (on ? 'on' : ''), title: `${sp.label}（鍵盤 ${sp.key}）`, onclick: () => G.Engine.setSpeed(sp.v) }, sp.v === 0 ? '❚❚' : sp.label));
    }
    els.speed.appendChild(h('button', { class: s.skipUntil ? 'on' : '', title: '快轉到下一個早上 08:00', onclick: () => {
      const d = U.dayOf(s.time);
      let t = U.at(d, 8);
      if (t <= s.time) t = U.at(d + 1, 8);
      G.Engine.skipTo(t);
    } }, '⏭'));
  };

  /* ---------- 每幀更新 ---------- */
  UI.update = () => {
    const s = G.S;
    if (!s || !els.clockTime) return;
    els.clockDay.textContent = U.dayLabel(s.time);
    els.clockTime.textContent = U.clock(s.time);
    const sim = G.R.sim || {};
    const sat = sim.sat;
    const wan = sim.wan || { in: 0, cap: 0 };
    const emp = Q.employees();
    const k = (label, value, cls, click) => h('div', { class: 'kpi' + (click ? ' click' : ''), onclick: click || null }, h('span', { class: 'k' }, label), h('span', { class: 'v ' + (cls || '') }, value));
    U.mount(els.kpis,
      k('預算', U.money(s.money), s.money < 0 ? 'bad-t' : ''),
      k('在線 / 員工', `${U.num(Math.round(sim.users || 0))} / ${U.num(emp)}`),
      k('滿意度', sat === null || sat === undefined ? '—' : U.pct(sat), sat === null || sat === undefined ? '' : sat >= 0.8 ? 'ok-t' : sat >= 0.6 ? 'warn-t' : 'bad-t', () => UI.go('noc')),
      k('評價', String(Math.round(s.rating)), s.rating >= 60 ? '' : s.rating >= 35 ? 'warn-t' : 'bad-t'),
      k('WAN', wan.cap ? `${U.bw(wan.in)} · ${U.pct(wan.in / wan.cap)}` : '未連線', wan.cap && wan.in / wan.cap > 0.9 ? 'bad-t' : '', () => UI.go('noc')),
      k('機房', `${s.temp.toFixed(1)}°C`, s.temp >= 35 ? 'bad-t' : s.temp >= 28 ? 'warn-t' : ''));
    updateNav();
    const now = performance.now();
    if (now - lastSide > 1000 || sideDirty) { lastSide = now; sideDirty = false; UI.renderSide(); }
    const v = G.Views[UI.cur.view];
    if (v && v.update) { try { v.update(); } catch (e) { console.error(e); } }
  };

  function led(id, cls, badge) {
    const b = navCache[id];
    if (!b) return;
    const act = b.querySelector('.led.act');
    act.classList.toggle('blink', cls === 'blink');
    act.classList.toggle('crit', cls === 'crit');
    b.querySelector('.badge').textContent = badge || '';
  }
  function updateNav() {
    const s = G.S, sim = G.R.sim;
    if (!sim) return;
    const t = s.time;
    const floorsBad = G.BLD.floors.some((f) => sim.floors[f.id] && sim.floors[f.id].present > 20 && !sim.floors[f.id].up);
    const soon = G.BLD.floors.some((f) => { const fs = s.floors[f.id]; return fs.moveInAt !== null && fs.moveInAt > t && fs.moveInAt - t < 720 && !G.Net.floorUp(f.id); });
    led('building', floorsBad ? 'crit' : soon ? 'blink' : '');
    const failed = Object.values(s.devices).some((d) => d.rack && d.status !== 'ok');
    const inv = Object.values(s.devices).filter((d) => !d.rack).length;
    led('rack', failed || s.temp >= 32 ? 'crit' : inv ? 'blink' : '', inv ? String(inv) : '');
    const cut = Object.values(s.links).some((l) => l.status !== 'up');
    led('topo', cut ? 'crit' : '');
    const critA = s.alerts.some((a) => a.sev === 'crit' && t - a.t < 30);
    led('noc', critA ? 'crit' : '');
    if (performance.now() - lastAuditAt > 5000) { lastAuditAt = performance.now(); try { auditCrit = G.Sec.audit().findings.some((f) => f.sev === 'crit'); } catch (e) { auditCrit = false; } }
    led('fw', auditCrit ? 'blink' : '');
    const incs = G.Ev.visible();
    const tks = s.tickets.filter((x) => !x.resolvedAt).length;
    led('inc', incs.some((i) => i.sev === 'crit' || i.sev === 'high') ? 'crit' : incs.length || tks ? 'blink' : '', incs.length + tks ? String(incs.length + tks) : '');
    const unseen = Object.keys(s.kb.unlocked).filter((id) => !s.kb.seen[id]).length;
    led('kb', unseen ? 'blink' : '', unseen ? String(unseen) : '');
  }

  /* ---------- 任務面板 ---------- */
  UI.renderSide = () => {
    const s = G.S;
    if (!s || !els.side) return;
    const side = els.side;
    const scroll = side.scrollTop;
    U.clear(side);
    const wrap = h('div', { class: 'mission' });
    const closeBtn = h('button', { class: 'btn ghost sm close-side', onclick: () => UI.toggleSide(false) }, '關閉');
    const ch = G.Campaign.current();
    if (s.scen && UI.scenSide) {
      UI.scenSide(wrap, closeBtn);
    } else if (ch) {
      const done = ch.objectives.filter((o) => s.obj[o.id]).length;
      wrap.append(
        h('div', { class: 'row between' }, h('span', { class: 'label' }, s.won ? '劇情完成 · 自由營運中' : `劇情模式 · 第 ${s.chapter + 1} / ${G.Campaign.chapters.length} 章`), closeBtn),
        h('div', { class: 'ch-title' }, ch.title),
        h('div', { class: 'prog' }, h('div', { class: 'bar grow' }, h('i', { style: { width: (done / ch.objectives.length) * 100 + '%' } })), h('span', { class: 'mono small' }, `${done}/${ch.objectives.length}`)),
      );
      let curShown = false;
      for (const o of ch.objectives) {
        const isDone = !!s.obj[o.id];
        const isCur = !isDone && !curShown;
        if (isCur) curShown = true;
        const pg = G.Campaign.objectiveProgress(o);
        const node = h('div', { class: 'obj' + (isDone ? ' done' : '') + (isCur ? ' cur' : '') },
          h('div', { class: 'ck' }, isDone ? '✓' : ''),
          h('div', {},
            h('div', { class: 't' }, o.text),
            pg ? h('div', { class: 'pg' }, pg) : null,
            isCur ? h('div', { class: 'hint' }, o.hint) : null,
            isCur ? h('div', { class: 'acts' },
              o.goto ? h('button', { class: 'btn primary sm', onclick: () => UI.go(o.goto) }, '前往') : null,
              o.kb ? h('button', { class: 'btn sm', onclick: () => UI.openKb(o.kb) }, '相關知識') : null) : null));
        if (!isCur && !isDone) node.addEventListener('click', () => { if (o.goto) UI.go(o.goto); });
        wrap.appendChild(node);
      }
      if (s.flags['done-' + ch.id] && !s.won) wrap.appendChild(h('button', { class: 'btn primary', style: { marginTop: '10px', width: '100%' }, onclick: () => UI.chapterDone(s.chapter) }, '本章完成 → 繼續'));
    } else {
      wrap.append(h('div', { class: 'row between' }, h('span', { class: 'label' }, '沙盒模式'), closeBtn),
        h('div', { class: 'ch-title' }, '自由建設'),
        h('p', { class: 'muted small', style: { margin: '6px 0 10px' } }, '預算充足、全部設備解鎖。依進駐時程完成所有樓層，並撐過隨機的維運與資安事件。'));
    }
    const up = G.BLD.floors.filter((f) => { const fs = s.floors[f.id]; return fs.moveInAt !== null && fs.movedIn < f.staff; }).sort((a, b) => s.floors[a.id].moveInAt - s.floors[b.id].moveInAt);
    if (up.length) {
      const list = h('div', { class: 'upcoming' });
      for (const f of up.slice(0, 8)) {
        const fs = s.floors[f.id];
        const ready = G.Net.floorUp(f.id);
        const dt = fs.moveInAt - s.time;
        list.appendChild(h('div', { class: 'it' },
          h('span', {}, h('span', { class: 'dot ' + (ready ? 'ok' : dt < 720 ? 'bad' : 'warn') }), ' ', h('b', { class: 'mono' }, f.id), ' ', h('span', { class: 'muted' }, f.dept)),
          h('span', { class: 'mono small ' + (dt < 0 ? 'accent-t' : '') }, dt > 0 ? `${U.stamp(fs.moveInAt)}（${U.dur(dt)}）` : `進駐中 ${Math.round(fs.movedIn / f.staff * 100)}%`)));
      }
      wrap.append(h('div', { class: 'hr' }), h('div', { class: 'label', style: { marginBottom: '6px' } }, '進駐時程'), list);
    }
    const tks = s.tickets.filter((t) => !t.resolvedAt).slice(-4).reverse();
    if (tks.length) {
      wrap.append(h('div', { class: 'hr' }), h('div', { class: 'row between', style: { marginBottom: '6px' } }, h('span', { class: 'label' }, '使用者報修'), h('button', { class: 'btn ghost xs', onclick: () => UI.go('inc:tickets') }, '全部')));
      for (const t of tks) wrap.appendChild(h('div', { class: 'note ' + (t.sev === 'crit' ? 'bad' : 'warn'), style: { marginBottom: '6px', cursor: 'pointer' }, onclick: () => UI.go(t.goto) }, h('div', { style: { fontWeight: 600 } }, t.text), h('div', { class: 'small muted' }, t.hint)));
    }
    side.appendChild(wrap);
    side.scrollTop = scroll;
  };

  /* ---------- 對話框 ---------- */
  UI.modal = (opt) => {
    /* 開始畫面時遊戲介面還沒建立：先在 body 放一個對話框容器 */
    if (!els.modals || !els.modals.isConnected) { els.modals = h('div', {}); document.body.appendChild(els.modals); }
    const back = h('div', { class: 'modal-back' });
    const m = h('div', { class: 'modal' + (opt.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    const entry = { back, blocking: opt.blocking !== false, dismissible: opt.dismissible !== false, onClose: opt.onClose };
    const close = () => {
      const i = modals.indexOf(entry);
      if (i >= 0) modals.splice(i, 1);
      back.remove();
      if (entry.onClose) entry.onClose();
    };
    entry.close = close;
    const head = h('div', { class: 'm-h' }, h('div', {}, opt.kicker ? h('div', { class: 'label', style: { marginBottom: '4px' } }, opt.kicker) : null, h('h3', {}, opt.title || '')),
      entry.dismissible ? h('button', { class: 'btn ghost sm', onclick: close, 'aria-label': '關閉' }, '✕') : null);
    const body = h('div', { class: 'm-b' });
    const content = typeof opt.body === 'function' ? opt.body(close) : opt.body;
    if (Array.isArray(content)) content.forEach((c) => c && body.appendChild(typeof c === 'string' ? h('p', {}, c) : c));
    else if (content) body.appendChild(typeof content === 'string' ? h('p', {}, content) : content);
    m.append(head, body);
    if (opt.actions && opt.actions.length) {
      const foot = h('div', { class: 'm-f' });
      for (const a of opt.actions) {
        foot.appendChild(h('button', { class: 'btn ' + (a.kind || ''), disabled: a.disabled || null, onclick: () => { const r = a.onClick ? a.onClick(close) : undefined; if (a.close !== false && r !== false) close(); } }, a.label));
      }
      m.appendChild(foot);
    }
    back.appendChild(m);
    back.addEventListener('mousedown', (e) => { if (e.target === back && entry.dismissible) close(); });
    els.modals.appendChild(back);
    modals.push(entry);
    const f = m.querySelector('.m-f .btn.primary') || m.querySelector('button');
    if (f) setTimeout(() => f.focus(), 30);
    return entry;
  };
  UI.confirm = (title, text, okLabel, onOk, kind) => UI.modal({
    title, body: text, blocking: true,
    actions: [{ label: '取消', kind: 'ghost' }, { label: okLabel || '確定', kind: kind || 'primary', onClick: onOk }],
  });
  UI.closeTop = () => { const m = modals[modals.length - 1]; if (m && m.dismissible) m.close(); };

  UI.toast = (text, kind, opt) => {
    if (!els.toasts) return;
    opt = opt || {};
    const t = h('div', { class: 'toast ' + (kind || 'info') + (opt.goto ? ' click' : '') }, text);
    if (opt.goto) t.addEventListener('click', () => { UI.go(opt.goto); t.remove(); });
    els.toasts.appendChild(t);
    while (els.toasts.children.length > 5) els.toasts.firstChild.remove();
    setTimeout(() => t.remove(), opt.ms || 4200);
  };
  /** 顯示動作結果 */
  UI.res = (r, okKind) => {
    if (!r) return r;
    if (r.msg) UI.toast(r.msg, r.ok ? (okKind || 'ok') : 'bad');
    return r;
  };

  /* ---------- 知識卡 ---------- */
  UI.kbBody = (card) => {
    const out = [h('div', { class: 'sum' }, card.sum)];
    let ul = null;
    for (const line of card.body) {
      if (line.startsWith('• ')) { if (!ul) { ul = h('ul', {}); out.push(ul); } ul.appendChild(h('li', {}, line.slice(2))); }
      else { ul = null; out.push(h('p', {}, line)); }
    }
    if (card.tip) out.push(h('div', { class: 'tip' }, h('b', {}, '實務提醒　'), card.tip));
    return h('div', { class: 'kb-card' }, out);
  };
  UI.openKb = (id) => {
    const c = G.KB.byId[id];
    if (!c) return;
    const s = G.S;
    if (s.kb.unlocked[id] === undefined) G.Ev.unlockKb(id);
    s.kb.seen[id] = true;
    const models = G.M3 ? G.M3.forKb(id) : [];
    UI.modal({ kicker: '知識庫 · ' + c.cat, title: c.title, wide: models.length > 0, body: [models.length ? G.M3.viewer(models, { height: 260 }) : null, UI.kbBody(c)], blocking: true, actions: [{ label: '在知識庫中查看', kind: 'ghost', onClick: () => UI.go('kb:' + id) }, { label: '了解', kind: 'primary' }] });
  };

  /* ---------- 章節、勝利、失敗 ---------- */
  UI.chapterIntro = (idx) => {
    const ch = G.Campaign.chapters[idx];
    const s = G.S;
    s.flags.introShown = true;
    UI.modal({
      kicker: `劇情模式 · 第 ${idx + 1} 章`, title: ch.title.split('｜')[1] || ch.title, wide: true, dismissible: false,
      body: [
        ...ch.story.map((p) => h('p', {}, p)),
        h('div', { class: 'note info' }, h('b', {}, '本章預算撥款　'), h('span', { class: 'mono' }, U.money(ch.grant)), '　·　目前預算 ', h('span', { class: 'mono' }, U.money(s.money))),
        h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '你將學到'), h('div', { class: 'row wrap' }, ch.learn.map((x) => h('span', { class: 'chip accent' }, x)))),
        idx === 0 ? h('div', { class: 'note' }, '操作提示：右側「任務」面板會一步步引導你；遊戲開始時是暫停的，按上方 ▶ 讓時間前進。建設時可以隨時暫停。') : null,
      ],
      actions: [{ label: idx === 0 ? '開始建設' : '開始', kind: 'primary', onClick: () => { if (s.speed === 0 && idx > 0) G.Engine.setSpeed(5); } }],
    });
  };
  UI.chapterDone = (idx) => {
    const ch = G.Campaign.chapters[idx];
    const s = G.S;
    if (UI._doneOpen) return;
    UI._doneOpen = true;
    G.Engine.setSpeed(0);
    const last = idx === G.Campaign.chapters.length - 1;
    UI.modal({
      kicker: '章節完成', title: ch.title, wide: true, dismissible: false, onClose: () => { UI._doneOpen = false; },
      body: [...ch.outro.map((p) => h('p', {}, p)), statsBlock(),
        h('div', { class: 'note info' }, h('b', {}, '章節小測驗　'), '用 5 題檢查這一章的觀念，答錯會附上解說與知識卡。')],
      actions: [
        { label: '做本章小測驗', kind: 'ghost', close: false, onClick: () => { UI.quiz(idx); return false; } },
        { label: last ? '查看結局' : '前往下一章', kind: 'primary', onClick: () => { G.Campaign.nextChapter(s); UI.renderSide(); } }],
    });
  };
  function statsBlock() {
    const s = G.S;
    const avg = (a) => (a.length ? U.dur(U.sum(a) / a.length) : '—');
    return h('div', { class: 'grid c3' },
      h('div', { class: 'tile' }, h('div', { class: 'k' }, 'IT 部門評價'), h('div', { class: 'v' }, String(Math.round(s.rating)))),
      h('div', { class: 'tile' }, h('div', { class: 'k' }, '員工'), h('div', { class: 'v' }, U.num(Q.employees()))),
      h('div', { class: 'tile' }, h('div', { class: 'k' }, '預算餘額'), h('div', { class: 'v' }, U.money(s.money))),
      h('div', { class: 'tile' }, h('div', { class: 'k' }, '處理事件 / 失敗'), h('div', { class: 'v' }, `${s.stats.incResolved} / ${s.stats.incFailed}`)),
      h('div', { class: 'tile' }, h('div', { class: 'k' }, '平均偵測時間 MTTD'), h('div', { class: 'v' }, avg(s.stats.mttd))),
      h('div', { class: 'tile' }, h('div', { class: 'k' }, '平均處理時間 MTTR'), h('div', { class: 'v' }, avg(s.stats.mttr))));
  }
  UI.victory = () => {
    const s = G.S;
    const g = G.Sec.audit().grade;
    const score = Math.round(s.rating * 10 + (s.money > 0 ? Math.min(2000, s.money / 50000) : 0) - s.stats.breaches * 150 + s.stats.incResolved * 20);
    UI.modal({
      kicker: '全劇情完成', title: '萬人企業網路，建設完成', wide: true, dismissible: false,
      body: [
        h('p', {}, '從一間空蕩蕩的 B1 機房開始，你規劃了機櫃、路由、防火牆、21 層樓的布線與 Wi-Fi、DMZ、備援與縱深防禦，並在攻擊中守住了公司。'),
        h('div', { class: 'row wrap', style: { gap: '16px' } }, h('div', {}, h('div', { class: 'label' }, '最終分數'), h('div', { class: 'grade mono' }, U.num(score))), h('div', {}, h('div', { class: 'label' }, '資安健檢'), h('div', { class: 'grade' }, g))),
        statsBlock(),
        h('p', { class: 'muted' }, '你可以繼續營運這個網路（隨機事件仍會發生），或回到標題畫面挑戰沙盒模式。'),
      ],
      actions: [{ label: '回到標題', kind: 'ghost', onClick: () => UI.title() }, { label: '繼續營運', kind: 'primary' }],
    });
  };
  UI.gameOver = (go) => {
    const reason = go.reason === 'money' ? '預算嚴重超支，財務長凍結了所有 IT 支出。' : '全公司的網路體驗長期低落，IT 部門評價歸零。';
    UI.modal({
      kicker: 'GAME OVER', title: '你被資遣了', dismissible: false,
      body: [h('p', {}, reason), h('p', { class: 'muted' }, '別灰心：回顧監控中心與事件紀錄，找出問題出在哪裡，再挑戰一次。'), statsBlock()],
      actions: [{ label: '回到標題', kind: 'primary', onClick: () => UI.title() }],
    });
  };

  /* ---------- 選單 ---------- */
  UI.menu = () => {
    const s = G.S;
    UI.modal({
      title: '選單', blocking: true,
      body: (close) => [
        h('div', { class: 'grid c2' },
          h('button', { class: 'btn', onclick: () => { const ok = G.State.save(); UI.res({ ok, msg: ok ? '已存檔（瀏覽器本機）' : '存檔失敗：瀏覽器封鎖了本機儲存，請改用「匯出存檔」' }); } }, '存檔'),
          h('button', { class: 'btn', onclick: () => { close(); UI.exportSave(); } }, '匯出存檔（文字）'),
          h('button', { class: 'btn', onclick: () => { close(); UI.importSave(); } }, '匯入存檔'),
          h('button', { class: 'btn', onclick: () => { close(); UI.help(); } }, '操作說明'),
          h('button', { class: 'btn', onclick: () => { close(); UI.go('noc'); UI.showLog(); } }, '營運日誌'),
          h('button', { class: 'btn danger', onclick: () => { close(); UI.confirm('回到標題畫面', '目前進度會先自動存檔。', '回到標題', () => { G.State.save(); UI.title(); }); } }, '回到標題')),
        h('div', { class: 'row wrap', style: { marginTop: '4px' } }, h('span', {}, '畫面外觀'), UI.themeSeg()),
        h('label', { class: 'row', style: { marginTop: '4px' } }, h('input', { type: 'checkbox', id: 'opt-autopause', checked: s.settings.autoPause, onchange: (e) => { s.settings.autoPause = e.target.checked; } }), '重大事件發生時自動暫停'),
        h('p', { class: 'small dim' }, '存檔保存在這個瀏覽器中；換裝置或清除瀏覽資料前，請先匯出存檔。'),
      ],
    });
  };
  UI.showLog = () => {
    const s = G.S;
    const list = h('div', { class: 'alog', style: { maxHeight: '60vh' } }, s.log.slice().reverse().map((l) => h('div', { class: 'l' }, h('span', { class: 'dim' }, U.stamp(l.t)), h('span', { class: l.kind === 'good' ? 'ok-t' : l.kind === 'warn' ? 'warn-t' : '' }, l.text))));
    UI.modal({ title: '營運日誌', wide: true, body: list, blocking: true });
  };
  UI.exportSave = () => {
    const str = G.State.exportStr();
    const ta = h('textarea', { id: 'export-save', rows: 8, readonly: true }, str);
    UI.modal({
      title: '匯出存檔', blocking: true,
      body: [h('p', { class: 'muted' }, '複製下面整段文字保存起來，之後可用「匯入存檔」還原進度。'), ta],
      actions: [{ label: '複製', kind: 'primary', close: false, onClick: () => {
        ta.select();
        try { navigator.clipboard.writeText(str).then(() => UI.toast('已複製到剪貼簿', 'ok'), () => UI.toast('請手動選取文字後複製', 'warn')); } catch (e) { UI.toast('請手動選取文字後複製', 'warn'); }
        return false;
      } }, { label: '關閉', kind: 'ghost' }],
    });
  };
  UI.importSave = () => {
    const ta = h('textarea', { id: 'import-save', rows: 8, placeholder: '貼上匯出的存檔文字' });
    UI.modal({
      title: '匯入存檔', blocking: true, body: [ta],
      actions: [{ label: '取消', kind: 'ghost' }, { label: '匯入', kind: 'primary', onClick: () => {
        try {
          const st = G.State.importStr(ta.value);
          if (!st) throw new Error('bad');
          G.Engine.boot(st);
          G.State.save(st);
          UI.hideTitle();
          UI.build();
          UI.toast('存檔已匯入', 'ok');
        } catch (e) { UI.toast('存檔格式不正確', 'bad'); return false; }
      } }],
    });
  };
  UI.help = () => {
    UI.modal({
      title: '操作說明', wide: true, blocking: true,
      body: [
        h('div', { class: 'grid c2' },
          h('div', { class: 'note' }, h('b', {}, '時間　'), '上方 ❚❚ 暫停、1×～60× 調整速度、⏭ 快轉到早上。鍵盤 0～4 也能切換。員工上班時間（09:00～18:00）網路最忙。'),
          h('div', { class: 'note' }, h('b', {}, '建設流程　'), '採購設備 → 在機房上架 → 在拓撲連線 → 設定伺服器角色與防火牆規則 → 樓層布線、交換器、AP、上行主幹。'),
          h('div', { class: 'note' }, h('b', {}, '找問題　'), '使用者報修會告訴你哪裡出錯；部署 NMS 後，監控中心能直接標出滿載的鏈路與異常流量。'),
          h('div', { class: 'note' }, h('b', {}, '資安事件　'), '事件頁列出正在發生的攻擊與故障。選擇正確的應變行動：先遏制、再根除、最後復原。錯誤的行動會浪費時間與評價。'),
          h('div', { class: 'note' }, h('b', {}, '評價與預算　'), '員工滿意度影響 IT 部門評價；評價影響每日營運預算。評價歸零或預算嚴重超支就會 Game Over。'),
          h('div', { class: 'note' }, h('b', {}, '知識庫　'), '每個任務都附有相關知識卡。遇到不懂的名詞，先去知識庫看看。')),
      ],
    });
  };

  /* ---------- 開始畫面 ---------- */
  function rackArt() {
    const svg = U.s('svg', { class: 'rack-art', viewBox: '0 0 300 360', 'aria-hidden': 'true' });
    svg.appendChild(U.s('rect', { x: 40, y: 10, width: 220, height: 340, rx: 8, fill: 'var(--bg-3)', stroke: 'var(--line-2)', 'stroke-width': 2 }));
    svg.appendChild(U.s('rect', { x: 52, y: 22, width: 196, height: 316, fill: 'var(--jack)' }));
    const rows = [
      { h: 14, c: 'var(--bg-4)', leds: 8, kind: 'sw' }, { h: 14, c: 'var(--bg-4)', leds: 8, kind: 'sw' }, { h: 22, c: '#3a2d55', leds: 2, kind: 'rt' },
      { h: 22, c: '#4a2626', leds: 3, kind: 'fw' }, { h: 14, c: 'var(--bg-4)', leds: 12, kind: 'sw' }, { h: 30, c: '#1f3647', leds: 2, kind: 'sv' },
      { h: 30, c: '#1f3647', leds: 2, kind: 'sv' }, { h: 44, c: '#22323c', leds: 4, kind: 'st' }, { h: 44, c: '#2c2c2c', leds: 1, kind: 'ups' },
    ];
    let y = 30;
    rows.forEach((r, i) => {
      svg.appendChild(U.s('rect', { x: 58, y, width: 184, height: r.h, rx: 2, fill: r.c, stroke: 'var(--line-2)', 'stroke-width': 0.6 }));
      for (let k = 0; k < r.leds; k++) {
        const col = k % 5 === 3 ? 'var(--warn)' : 'var(--ok)';
        const dot = U.s('rect', { x: 66 + k * 12, y: y + r.h / 2 - 2, width: 4, height: 4, rx: 1, fill: col });
        dot.style.animation = `blink ${0.6 + ((i * 7 + k * 3) % 9) / 10}s steps(2, start) infinite`;
        svg.appendChild(dot);
      }
      if (r.kind === 'sw') for (let k = 0; k < 10; k++) svg.appendChild(U.s('rect', { x: 150 + k * 8.5, y: y + 3, width: 6, height: 8, fill: 'var(--jack)', stroke: 'var(--line-2)', 'stroke-width': 0.4 }));
      y += r.h + 6;
    });
    for (let k = 0; k < 6; k++) svg.appendChild(U.s('path', { d: `M${242 + k * 2} ${38 + k * 16} C ${290} ${60 + k * 20}, ${280} ${250}, ${270 + k * 3} 350`, fill: 'none', stroke: k % 2 ? 'var(--accent)' : 'var(--accent-2)', 'stroke-width': 2.2, opacity: 0.8 }));
    return svg;
  }
  UI.title = () => {
    if (G.S) G.S.speed = 0;
    UI.hideTitle();
    const peek = G.State.peek();
    const topics = ['Router 路由器', 'Switch 交換器', '機櫃與 U 數', '跨樓層光纖主幹', 'Wi-Fi 覆蓋與容量', '外網 / DMZ / 內網', '防火牆規則', '即時流量監控', 'DDoS', '勒索軟體', '事件應變'];
    const menu = h('div', { class: 'menu' });
    if (peek) {
      const sd = peek.scen && G.Scen ? G.Scen.def(peek.scen) : null;
      const where = sd ? `情境挑戰：${sd.title}` : peek.mode === 'sandbox' ? '沙盒模式' : `第 ${peek.chapter + 1} 章`;
      menu.appendChild(h('button', { class: 'btn primary', onclick: () => { const st = G.State.load(); if (!st) { UI.toast('存檔讀取失敗', 'bad'); return; } G.Engine.boot(st); UI.hideTitle(); UI.build(); if (st.gameOver) UI.gameOver(st.gameOver); } },
        '繼續遊戲', h('small', {}, `${where} · ${U.dayLabel(peek.time)} ${U.clock(peek.time)}`)));
    }
    const startNew = (mode) => {
      const go = () => { G.Engine.newGame(mode); UI.hideTitle(); UI.build(); if (mode === 'campaign') UI.chapterIntro(0); else UI.sandboxIntro(); };
      if (peek) UI.confirm('開始新遊戲', '目前的存檔會被覆蓋。確定要開始新遊戲嗎？', '開始新遊戲', go, 'danger');
      else go();
    };
    menu.append(
      h('button', { class: 'btn' + (peek ? '' : ' primary'), onclick: () => startNew('campaign') }, '劇情模式', h('small', {}, '五章，從空機房到萬人企業')),
      h('button', { class: 'btn', onclick: () => startNew('sandbox') }, '沙盒模式', h('small', {}, '預算 1.5 億，自由建設')),
      h('button', { class: 'btn', onclick: () => UI.scenPicker() }, '情境挑戰', h('small', {}, '限時處理事件 · 評分')),
      h('button', { class: 'btn ghost', onclick: () => UI.importSave() }, '匯入存檔', h('small', {}, '')));
    const scr = h('div', { class: 'title-screen', id: 'title' },
      h('div', { class: 'title-inner' },
        h('div', {},
          h('h1', {}, h('span', { class: 'en' }, 'INFRAOPS · IT INFRASTRUCTURE SIM'), '萬人網管'),
          h('p', { class: 'lead' }, '一棟 21 層的新總部、一萬名員工、一間空蕩蕩的 B1 機房。從機櫃、路由器、防火牆、樓層光纖到 Wi-Fi，親手打造整間公司的網路，並在流量高峰與駭客攻擊中守住它。'),
          menu,
          h('div', { class: 'row wrap theme-row' }, h('span', { class: 'small muted' }, '畫面外觀'), UI.themeSeg()),
          h('div', { class: 'topics' }, topics.map((t) => h('span', { class: 'chip' }, t)))),
        rackArt()));
    document.body.appendChild(scr);
  };
  UI.hideTitle = () => { const t = document.getElementById('title'); if (t) t.remove(); };
  UI.sandboxIntro = () => UI.modal({
    kicker: '沙盒模式', title: '自由建設', dismissible: false,
    body: [h('p', {}, '你有 1.5 億預算、所有設備都已解鎖。員工會在第 3～6 天分批進駐全部 21 層樓，官網於第 4 天上線，維運與資安事件會隨機發生。'), h('p', { class: 'muted' }, '目標：讓一萬人的網路又快又穩又安全。')],
    actions: [{ label: '開始', kind: 'primary' }],
  });

  /* ---------- 事件掛勾 ---------- */
  UI.hook = () => {
    G.bus.on('tick', () => UI.update());
    G.bus.on('speed', () => UI.renderSpeed());
    G.bus.on('change', () => {
      sideDirty = true;
      if (dirty) return;
      dirty = true;
      requestAnimationFrame(() => { dirty = false; UI.refresh(); });
    });
    G.bus.on('notice', (n) => UI.toast(n.text, n.kind || 'info', { goto: n.goto }));
    G.bus.on('alert', (a) => { if (a.sev === 'crit') UI.toast('告警：' + a.text, 'bad', { goto: 'noc' }); });
    G.bus.on('ticket', (t) => {
      if (t.resolvedAt) UI.toast(`已解決：${t.text}`, 'ok');
      else UI.toast(`報修：${t.text}`, t.sev === 'crit' ? 'bad' : 'warn', { goto: 'inc:tickets' });
      sideDirty = true;
    });
    G.bus.on('objective', (e) => { UI.toast('任務完成：' + e.o.text, 'ok'); sideDirty = true; });
    G.bus.on('kb', (e) => { const c = G.KB.byId[e.id]; if (c) UI.toast('新知識：' + c.title, 'info', { goto: 'kb:' + e.id }); });
    G.bus.on('movein', (e) => {
      const f = G.BLD.byId[e.fid];
      UI.toast(e.ready ? `${e.fid} ${f.dept} 開始進駐` : `${e.fid} ${f.dept} 進駐了，但網路還沒準備好！`, e.ready ? 'ok' : 'bad', { goto: 'floor:' + e.fid });
    });
    G.bus.on('incident', (e) => {
      const s = G.S, inc = e.inc, def = G.INC[inc.type];
      if (e.kind === 'new') {
        UI.toast(`${def.cat === 'sec' ? '資安事件' : '維運事件'}：${inc.title}`, inc.sev === 'crit' || inc.sev === 'high' ? 'bad' : 'warn', { goto: 'inc:' + inc.id, ms: 6000 });
        if (s.settings.autoPause && (inc.sev === 'crit' || inc.sev === 'high') && s.speed > 0) { G.Engine.setSpeed(0); UI.toast('重大事件：遊戲已自動暫停', 'warn'); }
      } else if (e.kind === 'end') {
        const good = inc.outcome !== 'fail';
        UI.toast(`事件結束（${G.Ev.OUTCOME[inc.outcome]}）：${inc.title}`, good ? 'ok' : 'bad', { goto: 'inc:' + inc.id });
      }
      sideDirty = true;
      if (UI.cur.view === 'inc') UI.refresh();
    });
    G.bus.on('chapter', (e) => {
      if (e.kind === 'start' && G.S.mode === 'campaign' && e.idx > 0) UI.chapterIntro(e.idx);
      if (e.kind === 'done') UI.chapterDone(e.idx);
      if (e.kind === 'won') UI.victory();
      sideDirty = true;
    });
    G.bus.on('gameover', (go) => UI.gameOver(go));
    document.addEventListener('keydown', (e) => {
      if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'Escape') { UI.closeTop(); return; }
      if (!G.S || document.getElementById('title')) return;
      const sp = G.Engine.SPEEDS.find((x) => x.key === e.key);
      if (sp) { G.Engine.setSpeed(sp.v); e.preventDefault(); }
      if (e.key === ' ') { G.Engine.setSpeed(G.S.speed ? 0 : 5); e.preventDefault(); }
    });
    window.addEventListener('beforeunload', () => { if (G.S) G.State.save(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.S) G.State.save(); });
  };
})(window.G = window.G || {});
