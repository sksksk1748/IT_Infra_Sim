/* 萬人網管 InfraOps — 共用工具函式
 * 所有模組都掛在全域物件 G 底下（不使用 ES module，雙擊 index.html 即可執行）。
 */
(function (G) {
  'use strict';
  const U = {};
  G.U = U;

  /* ---------- 數學 ---------- */
  U.clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  U.lerp = (a, b, t) => a + (b - a) * t;
  U.sum = (arr, fn) => { let s = 0; for (const x of arr) s += fn ? fn(x) : x; return s; };
  U.rand = (a, b) => a + Math.random() * (b - a);
  U.randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
  U.pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  U.chance = (p) => Math.random() < p;
  U.weightedPick = (items, wfn) => {
    let total = 0;
    for (const it of items) total += Math.max(0, wfn(it));
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const it of items) { r -= Math.max(0, wfn(it)); if (r <= 0) return it; }
    return items[items.length - 1];
  };
  /* 可重現的亂數（樓層平面圖生成用） */
  U.mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /* ---------- 格式化 ---------- */
  const nf0 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 1 });
  U.num = (n, d = 0) => (d ? nf1 : nf0).format(n);
  U.pad2 = (n) => (n < 10 ? '0' : '') + n;

  /** 金額：1,234 萬 / 1.25 億 */
  U.money = (n) => {
    const sign = n < 0 ? '−' : '';
    const a = Math.abs(n);
    if (a >= 1e8) return sign + 'NT$' + (a / 1e8).toFixed(2).replace(/\.?0+$/, '') + ' 億';
    if (a >= 1e4) return sign + 'NT$' + nf1.format(Math.round(a / 1e3) / 10) + ' 萬';
    return sign + 'NT$' + nf0.format(a);
  };
  U.moneyFull = (n) => (n < 0 ? '−' : '') + 'NT$' + nf0.format(Math.abs(Math.round(n)));

  /** 頻寬（輸入單位 Mbps） */
  U.bw = (mbps) => {
    if (!isFinite(mbps)) return '∞';
    if (mbps >= 1000) return (mbps / 1000).toFixed(mbps >= 100000 ? 0 : mbps >= 10000 ? 1 : 2) + ' Gbps';
    if (mbps >= 10) return mbps.toFixed(0) + ' Mbps';
    return mbps.toFixed(1) + ' Mbps';
  };
  /** 圖表座標用的短格式：1500 → 1.5G、300 → 300M */
  U.bwShort = (mbps) => {
    if (mbps >= 1000) { const g = mbps / 1000; return (g >= 10 ? Math.round(g) : Math.round(g * 10) / 10) + 'G'; }
    return Math.round(mbps) + 'M';
  };
  /** 介面速率標籤：1000 → 1G */
  U.speed = (mbps) => (mbps >= 1000 ? (mbps / 1000) + 'G' : mbps + 'M');
  U.pct = (x, d = 0) => (x * 100).toFixed(d) + '%';

  /* ---------- 遊戲時間（單位：分鐘，第 1 天 = 週六） ---------- */
  U.DOW = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  U.dayOf = (min) => Math.floor(min / 1440) + 1;
  U.dowOf = (min) => (6 + U.dayOf(min) - 1) % 7;
  U.isWeekend = (min) => { const d = U.dowOf(min); return d === 0 || d === 6; };
  U.hourOf = (min) => (min % 1440) / 60;
  U.clock = (min) => { const m = Math.floor(min) % 1440; return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60); };
  U.dayLabel = (min) => `第 ${U.dayOf(min)} 天 ${U.DOW[U.dowOf(min)]}`;
  U.stamp = (min) => `D${U.dayOf(min)} ${U.clock(min)}`;
  U.at = (day, hour, minute = 0) => (day - 1) * 1440 + hour * 60 + minute;
  U.dur = (mins) => {
    mins = Math.max(0, Math.round(mins));
    if (mins >= 1440) { const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60); return h ? `${d} 天 ${h} 小時` : `${d} 天`; }
    if (mins >= 60) { const h = Math.floor(mins / 60), m = mins % 60; return m ? `${h} 小時 ${m} 分` : `${h} 小時`; }
    return `${mins} 分鐘`;
  };
  /** 下一個平日（週一～五）的指定時刻 */
  U.nextWeekdayAt = (fromMin, hour, addDays = 1) => {
    let day = U.dayOf(fromMin) + addDays;
    for (let i = 0; i < 14; i++) {
      const t = U.at(day, hour);
      const dw = U.dowOf(t);
      if (dw !== 0 && dw !== 6) return t;
      day++;
    }
    return U.at(day, hour);
  };

  /* ---------- DOM ---------- */
  U.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function applyAttrs(el, attrs, isSvg) {
    if (!attrs) return;
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (!isSvg && (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function appendKids(el, kids) {
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      if (Array.isArray(k)) appendKids(el, k);
      else if (k instanceof Node) el.appendChild(k);
      else el.appendChild(document.createTextNode(String(k)));
    }
  }
  /** 建立 HTML 元素：U.h('div', {class:'x'}, '文字', child) */
  U.h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    applyAttrs(el, attrs, false);
    appendKids(el, kids);
    return el;
  };
  const SVGNS = 'http://www.w3.org/2000/svg';
  /** 建立 SVG 元素 */
  U.s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(SVGNS, tag);
    applyAttrs(el, attrs, true);
    appendKids(el, kids);
    return el;
  };
  U.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  U.mount = (el, ...kids) => { U.clear(el); appendKids(el, kids); return el; };
  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** 讀取 CSS 變數（畫布繪圖時使用，才能跟著明暗主題變色） */
  U.cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  U.tokens = () => {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => cs.getPropertyValue(n).trim();
    return {
      bg: g('--bg'), bg2: g('--bg-2'), bg3: g('--bg-3'), line: g('--line'), line2: g('--line-2'),
      text: g('--text'), text2: g('--text-2'), text3: g('--text-3'),
      accent: g('--accent'), accent2: g('--accent-2'), ok: g('--ok'), warn: g('--warn'), bad: g('--bad'), info: g('--info'),
      floor: g('--floor'), desk: g('--desk'), room: g('--room'), core: g('--core'), wall: g('--wall'), glass: g('--glass'),
      mono: g('--font-mono'), sans: g('--font-sans'),
    };
  };

  /** 目前是否為深色主題（依 --bg 的亮度判斷，「跟隨系統」時也正確） */
  U.isDark = () => {
    const m = /^#([0-9a-f]{6})$/i.exec(U.cssVar('--bg'));
    if (!m) return true;
    const n = parseInt(m[1], 16);
    return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 128;
  };

  /** 使用率 → 狀態色階名稱 */
  U.utilClass = (u) => (u >= 0.9 ? 'bad' : u >= 0.7 ? 'warn' : 'ok');

  /* ---------- 簡易事件匯流排 ---------- */
  const handlers = {};
  G.bus = {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => G.bus.off(evt, fn); },
    off(evt, fn) { const a = handlers[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    emit(evt, data) { const a = handlers[evt]; if (a) for (const fn of a.slice()) { try { fn(data); } catch (e) { console.error(e); } } },
  };

  /* ---------- 安全的 localStorage ---------- */
  U.store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { window.localStorage.setItem(key, val); return true; } catch (e) { return false; } },
    del(key) { try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };
})(window.G = window.G || {});
