/* 提示機制：把目前的任務拆成一步一步，下一步要點的地方用黃色邊框閃爍標出來，旁邊有提示泡泡；
 * 任務面板的「帶我去」會直接跳到那一頁，之後每一步都會自動標示（引導模式）。
 * 卡在同一步太久（25 秒）也會自動亮起來；「選單 → 提示」可以改成「點了才提示」或關閉。
 * 步驟定義在 js/data/hints.js：{ text, short?, go, path: [data-hint…] 或 () => [...], done() }
 * path 由粗到細（例如 導覽列 → 分頁 → 購買按鈕）：畫面上找得到的最細那一個會被標出來。
 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h;
  const Hint = {};
  G.Hint = Hint;
  const KEY = 'infraops.hint', IDLE = 25000;
  const st = { key: '', since: 0, active: false, follow: false, dismissed: '', el: null, bubble: null, scrolled: '' };

  Hint.MODES = [['auto', '自動（卡住時提示）'], ['click', '點了才提示'], ['off', '關閉']];
  Hint.mode = () => { const m = U.store.get(KEY); return m === 'click' || m === 'off' ? m : 'auto'; };
  Hint.setMode = (m) => {
    if (m === 'auto') U.store.del(KEY); else U.store.set(KEY, m);
    st.active = false; st.follow = false;
    clear();
    G.bus.emit('hint');
  };
  const safe = (fn) => { try { return !!fn(); } catch (e) { return false; } };

  /** 目前的任務與下一步：{ o, step, idx, total } */
  Hint.current = () => {
    const s = G.S;
    if (!s || s.scen || s.gameOver || !G.HINTS) return null;
    let o = null, steps = [];
    const ch = G.Campaign.current();
    if (ch && !s.won) {
      o = ch.objectives.find((x) => !s.obj[x.id] && !G.Campaign.ready(x));
      if (!o) return null;
      try { steps = G.HINTS[o.id] ? G.HINTS[o.id](s) : []; } catch (e) { console.error(e); steps = []; }
    } else if (s.mode === 'sandbox' && G.HINTS.__sandbox) {
      try { steps = G.HINTS.__sandbox(s) || []; } catch (e) { console.error(e); steps = []; }
      steps = steps.filter(Boolean);
      if (!steps.length) return null;
      o = { id: '__sandbox', text: '建議下一步', hint: steps[0].text, goto: steps[0].go };
    } else return null;
    steps = steps.filter(Boolean);
    /* 緊急狀況（嚴重事件、整層斷線的報修、機房過熱）比任務優先 */
    const u = urgent(s);
    if (u) return { o, step: u, idx: -1, total: Math.max(steps.length, 1), urgent: true };
    let idx = steps.findIndex((x) => !safe(x.done));
    let step = idx >= 0 ? steps[idx] : null;
    /* 具體步驟都做完了、任務還沒達成（例如要等員工進駐、累積時間）：回到任務本身的提示 */
    if (!step) { step = { text: o.hint, go: o.goto, path: Hint.defaultPath(o.goto), wait: true }; idx = steps.length; }
    return { o, step, idx, total: Math.max(steps.length, 1) };
  };
  function urgent(s) {
    const inc = G.Ev.visible().find((i) => i.status === 'active' && (i.sev === 'crit' || i.sev === 'high'));
    if (inc) return { text: `緊急：${inc.title}——到「事件」看事件紀錄，選擇應變行動`, short: '先處理這個事件', go: 'inc:' + inc.id, path: ['nav:inc'], done: () => inc.status !== 'active' };
    const tk = s.tickets.find((t) => !t.resolvedAt && t.sev === 'crit');
    if (tk) return { text: `緊急報修：${tk.text}。${tk.hint}`, short: tk.text, go: tk.goto, path: Hint.defaultPath(tk.goto), done: () => !!tk.resolvedAt };
    if (s.temp >= 30 && s.racks.length) return { text: `機房 ${s.temp.toFixed(1)}°C 過熱：到「採購 → 機房設施」加裝精密空調`, short: '加裝精密空調', go: 'shop:facility', path: ['nav:shop', 'tab:shop:facility', 'buy:CRAC-25'], done: () => G.S.temp < 29 };
    return null;
  }
  /** 只有「前往哪一頁」的時候：導覽列 → 分頁 / 樓層 / 據點 */
  Hint.defaultPath = (go) => {
    if (!go) return [];
    const [v, p] = go.split(':');
    const out = ['nav:' + v];
    if (p && ['shop', 'fw', 'sys'].includes(v)) out.push(`tab:${v}:${p}`);
    if (p && v === 'floor') out.push('floor:' + p);
    if (p && v === 'wan') out.push('wan-site:' + p);
    return out;
  };

  /** 「帶我去」：跳到下一步的頁面，並開始引導 */
  Hint.go = () => {
    const c = Hint.current();
    if (!c) return;
    st.active = true; st.follow = true; st.dismissed = ''; st.scrolled = '';
    const go = c.step.go || (c.step.wait ? c.o.goto : null);
    if (typeof go === 'function') go(); else if (go) G.UI.go(go);
    tick();
  };
  Hint.dismiss = () => { st.active = false; st.follow = false; st.dismissed = st.key; clear(); };
  Hint.isActive = () => st.active;

  const pathOf = (step) => ((typeof step.path === 'function' ? safe0(step.path) : step.path) || []).filter(Boolean);
  function safe0(fn) { try { return fn(); } catch (e) { return []; } }
  function findEl(key) {
    for (const el of document.querySelectorAll(`[data-hint="${key.replace(/"/g, '\\"')}"]`)) if (el.getClientRects().length && !el.disabled) return el;
    return null;
  }
  function target(step) {
    const keys = pathOf(step);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i], key = typeof k === 'string' ? k : k.k;
      const el = findEl(key);
      if (el) return { el, key, last: i === keys.length - 1, t: typeof k === 'string' ? null : k.t };
    }
    return null;
  }
  function tabName(view, k) { const V = G.Views[view]; const t = V && V.TABS ? V.TABS.find((x) => x[0] === k) : null; return t ? t[1] : k; }
  function label(t, step) {
    if (t.t) return t.t;
    if (t.last) return step.short || step.text;
    const [a, b, c] = t.key.split(':');
    if (a === 'nav') { const n = G.UI.NAV.find((x) => x.id === b); return `先到「${n ? n.label : b}」`; }
    if (a === 'tab') return `切換到「${tabName(b, c)}」`;
    if (a === 'floor') return `選 ${b}`;
    if (a === 'wan-site') return b === 'hq' ? '打開「總部的 WAN 出口」' : b === 'cloud' ? '打開「雲端服務」' : `選「${G.SITES[b] ? G.SITES[b].name : b}」`;
    return step.short || step.text;
  }

  function clear() {
    if (st.el) st.el.classList.remove('hint-glow');
    st.el = null;
    if (st.bubble) st.bubble.hidden = true;
  }
  function inView(el) {
    const r = el.getBoundingClientRect();
    return r.top >= 60 && r.bottom <= window.innerHeight - 10;
  }
  function place() {
    const b = st.bubble, el = st.el;
    if (!b || !el || b.hidden) return;
    const r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
    let x = r.left + r.width / 2 - bw / 2, y = r.bottom + 10, above = false;
    if (y + bh > window.innerHeight - 8) { y = r.top - bh - 10; above = true; }
    x = U.clamp(x, 8, window.innerWidth - bw - 8);
    y = U.clamp(y, 8, window.innerHeight - bh - 8);
    b.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    b.style.setProperty('--ax', `${Math.round(U.clamp(r.left + r.width / 2 - x, 14, bw - 14))}px`);
    b.classList.toggle('above', above);
  }
  function show(t, text) {
    if (st.el !== t.el) { clear(); st.el = t.el; t.el.classList.add('hint-glow'); }
    const sk = st.key + '|' + t.key;
    /* 要點的東西不在畫面上：捲過去（畫面重繪可能會打斷捲動，所以剛換步驟時多試幾次） */
    if (st.scrolled !== sk) { st.scrolled = sk; st.tries = 0; }
    if (st.tries < 4 && !inView(t.el)) { st.tries++; t.el.scrollIntoView({ block: 'center' }); }
    if (!st.bubble) {
      st.bubble = h('div', { class: 'hint-bubble', role: 'status', title: '點一下關閉提示' });
      st.bubble.addEventListener('click', () => Hint.dismiss());
      document.body.appendChild(st.bubble);
    }
    const b = st.bubble;
    const txt = '💡 ' + text;
    if (b.textContent !== txt) b.textContent = txt;
    b.hidden = false;
    place();
  }

  function tick() {
    const c = G.UI && G.UI.cur && document.getElementById('app') && !document.getElementById('title') ? Hint.current() : null;
    if (!c || Hint.mode() === 'off') { clear(); return; }
    const key = c.o.id + '#' + c.idx + (c.urgent ? ':' + c.step.text : '');
    if (key !== st.key) {
      st.key = key; st.since = performance.now(); st.scrolled = '';
      st.active = st.follow;
      G.bus.emit('hint');
    }
    if (!st.active && Hint.mode() === 'auto' && st.dismissed !== key && (c.urgent || performance.now() - st.since > IDLE)) st.active = true;
    if (!st.active) { clear(); return; }
    const t = target(c.step);
    if (!t) { clear(); return; }
    /* 對話框開著、而下一步不在對話框裡：先不打擾 */
    const modal = document.querySelector('.modal-back');
    if (modal && !modal.contains(t.el)) { clear(); return; }
    /* 已經在這一頁、但要點的東西不在畫面上（例如 3D 機房裡的伺服器）：由提示幫忙打開（每一步只做一次） */
    if (t.key === 'nav:' + G.UI.cur.view && typeof c.step.go === 'function' && st.assisted !== key) { st.assisted = key; c.step.go(); return; }
    show(t, label(t, c.step));
  }
  setInterval(tick, 300);
  window.addEventListener('scroll', () => place(), true);
  window.addEventListener('resize', () => place());

  /** 任務面板裡的「下一步」卡片 */
  Hint.card = (o) => {
    if (Hint.mode() === 'off') return null;
    const c = Hint.current();
    if (!c || c.o.id !== o.id) return null;
    const n = c.urgent || c.step.wait ? '' : c.total > 1 ? `（${Math.min(c.idx + 1, c.total)}/${c.total}）` : '';
    return h('div', { class: 'hint-card' },
      h('div', { class: 'row between' }, h('b', { class: 'small' + (c.urgent ? ' bad-t' : '') }, c.urgent ? '⚠ 先處理緊急狀況' : `💡 下一步${n}`),
        st.active ? h('button', { class: 'btn ghost xs', onclick: () => { Hint.dismiss(); G.bus.emit('hint'); } }, '先不用') : null),
      h('div', { class: 'small' }, c.step.text),
      h('button', { class: 'btn primary sm', style: { marginTop: '6px' }, onclick: () => Hint.go() }, st.active ? '再帶我去一次' : '帶我去'));
  };
})(window.G = window.G || {});
