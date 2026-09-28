/* 3D 設備模型（程序化建模）
 * 用 Three.js 以程式產生路由器、防火牆、交換器、伺服器、AP、線材、光模組、機櫃、UPS、空調、發電機。
 * 外殼是立體幾何；面板上的連接埠、指示燈、硬碟槽用 Canvas 畫成貼圖（單位：mm），再貼到外殼上。
 * 模型座標：1 單位 = 100 mm。Three.js 在第一次需要 3D 時才從 CDN 載入。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const M3 = G.M3 = G.M3 || {};
  const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let T = null, loadP = null;

  M3.load = () => {
    if (T) return Promise.resolve(T);
    if (window.THREE) { T = window.THREE; return Promise.resolve(T); }
    if (!loadP) {
      loadP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = THREE_URL;
        s.async = true;
        s.onload = () => { if (window.THREE) { T = window.THREE; resolve(T); } else { loadP = null; reject(new Error('3D 引擎載入異常')); } };
        s.onerror = () => { loadP = null; s.remove(); reject(new Error('無法下載 3D 引擎，請確認網路連線')); };
        document.head.appendChild(s);
      });
    }
    return loadP;
  };
  M3.T = () => T;

  /* ---------- 小工具 ---------- */
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const rgba = (hex, a) => { const v = parseInt(hex.slice(1), 16); return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a})`; };
  const LEDC = { g: '#3fe07a', a: '#ffb13b', b: '#4aa8ff', r: '#ff5a4f', w: '#e8f4ff' };
  const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  const MONO = '"IBM Plex Mono", Consolas, monospace';

  /* ---------- 2D 面板繪圖（單位 mm） ---------- */
  const D = {
    rect(g, x, y, w, hh, fill) { g.fillStyle = fill; g.fillRect(x, y, w, hh); },
    rr(g, x, y, w, hh, r, fill, stroke, lw) {
      r = Math.max(0, Math.min(r, w / 2, hh / 2));
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + hh, r);
      g.arcTo(x + w, y + hh, x, y + hh, r);
      g.arcTo(x, y + hh, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 0.35; g.stroke(); }
    },
    circ(g, x, y, r, fill, stroke, lw) {
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (fill) { g.fillStyle = fill; g.fill(); }
      if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 0.35; g.stroke(); }
    },
    txt(g, s, x, y, size, color, align, weight, family) {
      g.font = `${weight || 700} ${size}px ${family || FONT}`;
      g.fillStyle = color; g.textAlign = align || 'left'; g.textBaseline = 'middle';
      g.fillText(s, x, y);
    },
    led(g, x, y, r, color, on) {
      if (on !== false) {
        const gr = g.createRadialGradient(x, y, 0, x, y, r * 3.2);
        gr.addColorStop(0, rgba(color, 0.85)); gr.addColorStop(0.35, rgba(color, 0.3)); gr.addColorStop(1, rgba(color, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 3.2, 0, Math.PI * 2); g.fill();
      }
      D.circ(g, x, y, r, on === false ? '#1e2429' : color);
    },
    screw(g, x, y, r) {
      D.circ(g, x, y, r, '#8f989f', '#3b4247', 0.3);
      g.strokeStyle = '#3b4247'; g.lineWidth = r * 0.3;
      g.beginPath(); g.moveTo(x - r * 0.6, y); g.lineTo(x + r * 0.6, y); g.stroke();
    },
    hex(g, x, y, r) {
      g.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (k) g.lineTo(px, py); else g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    },
    vent(g, x, y, w, hh, hole, r) {
      if (w <= 2 || hh <= 2) return;
      g.save(); g.beginPath(); g.rect(x, y, w, hh); g.clip();
      g.fillStyle = hole || '#05070a';
      r = r || 1.05;
      const dx = r * 2.75, dy = r * 2.38;
      let row = 0;
      for (let yy = y + r * 1.4; yy < y + hh - r * 0.6; yy += dy, row++) {
        for (let xx = x + r * 1.4 + (row % 2) * dx / 2; xx < x + w - r * 0.6; xx += dx) D.hex(g, xx, yy, r);
      }
      g.restore();
    },
    cage(g, x, y, w, hh) {
      const gr = g.createLinearGradient(0, y, 0, y + hh);
      gr.addColorStop(0, '#e3e7ea'); gr.addColorStop(1, '#8c959c');
      g.fillStyle = gr; g.fillRect(x, y, w, hh);
    },
  };
  /* RJ45（上排倒裝：卡榫朝上） */
  D.rj45 = (g, x, y, o) => {
    o = o || {};
    const W = 13.6, H = 12, up = !!o.flip;
    D.rr(g, x, y, W, H, 0.7, o.shield || '#a9b1b7');
    g.fillStyle = '#06080a';
    g.fillRect(x + 1.1, up ? y + 3.1 : y + 1.1, W - 2.2, H - 4.2);
    g.fillRect(x + 4.3, up ? y + 1.1 : y + H - 3.2, W - 8.6, 2.2);
    g.fillStyle = '#c9a646';
    const py = up ? y + H - 3.7 : y + 1.6;
    for (let i = 0; i < 8; i++) g.fillRect(x + 2.45 + i * 1.12, py, 0.5, 2.1);
    if (o.accent) { g.fillStyle = o.accent; g.fillRect(x + 1.1, up ? y + H - 1.15 : y + 0.35, W - 2.2, 0.75); }
    if (o.leds !== false) {
      const ly = up ? y + 1.9 : y + H - 1.9;
      D.led(g, x + 2.2, ly, 0.55, LEDC.g, !!o.lit);
      D.led(g, x + W - 2.2, ly, 0.55, o.poe ? LEDC.a : LEDC.g, !!o.lit2);
    }
    if (o.num) D.txt(g, String(o.num), x + W / 2, y - 1.5, 1.9, '#d7dde1', 'center', 700);
  };
  D.sfp = (g, x, y, o) => {
    o = o || {};
    const W = 13.8, H = 9.4, up = !!o.flip;
    D.cage(g, x, y, W, H);
    if (o.module) {
      D.rect(g, x + 0.8, y + 0.8, W - 1.6, H - 1.6, '#474d53');
      const hy = y + H / 2 - 2.1 + (up ? 0.7 : -0.7);
      D.rr(g, x + 1.9, hy, 4.3, 4.2, 0.6, '#0a0c0e');
      D.rr(g, x + 7.6, hy, 4.3, 4.2, 0.6, '#0a0c0e');
      D.rect(g, x + 1.1, up ? y + 0.9 : y + H - 2, W - 2.2, 1.1, o.bail || '#1b1b1b');
    } else {
      D.rect(g, x + 0.8, y + 1, W - 1.6, H - 2, '#07090b');
      g.fillStyle = 'rgba(255,255,255,0.28)';
      for (let i = 0; i < 5; i++) g.fillRect(x + 1.8 + i * 2.35, up ? y + H - 1.8 : y + 1, 1, 0.8);
    }
    if (o.leds !== false) D.led(g, x + W / 2, up ? y - 1.4 : y + H + 1.4, 0.5, LEDC.g, !!o.lit);
  };
  D.qsfp = (g, x, y, o) => {
    o = o || {};
    const W = 19.2, H = 9.4, up = !!o.flip;
    D.cage(g, x, y, W, H);
    if (o.module) {
      D.rect(g, x + 0.8, y + 0.8, W - 1.6, H - 1.6, '#474d53');
      const hy = y + H / 2 + (up ? 0.6 : -0.6);
      if (o.mpo) D.rr(g, x + 4, hy - 1.4, W - 8, 2.8, 0.5, '#0a0c0e');
      else { D.rr(g, x + 3.6, hy - 2.1, 4.3, 4.2, 0.6, '#0a0c0e'); D.rr(g, x + W - 7.9, hy - 2.1, 4.3, 4.2, 0.6, '#0a0c0e'); }
      D.rect(g, x + 1.1, up ? y + 0.9 : y + H - 2, W - 2.2, 1.1, o.bail || '#d8ceb0');
    } else {
      D.rect(g, x + 0.8, y + 1, W - 1.6, H - 2, '#07090b');
    }
    if (o.leds !== false) D.led(g, x + W / 2, up ? y - 1.4 : y + H + 1.4, 0.5, LEDC.g, !!o.lit);
  };
  D.usb = (g, x, y) => {
    D.rr(g, x, y, 12, 5, 0.6, '#b9c0c6');
    D.rect(g, x + 1, y + 1, 10, 3, '#0b0d0f');
    D.rect(g, x + 1.6, y + 1.2, 8.8, 1.1, '#2f6fd6');
  };
  D.c13 = (g, x, y) => {
    D.rr(g, x, y, 9, 6.6, 1.1, '#0c0e10', '#2b3035', 0.3);
    g.fillStyle = '#000';
    g.fillRect(x + 2.1, y + 1.6, 0.9, 2.6); g.fillRect(x + 6, y + 1.6, 0.9, 2.6); g.fillRect(x + 4.05, y + 4.4, 0.9, 1.4);
  };
  D.fan = (g, cx, cy, r) => {
    D.circ(g, cx, cy, r, '#0e1114');
    g.strokeStyle = '#4a535a'; g.lineWidth = Math.max(0.25, r * 0.055);
    for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(cx, cy, r * k / 3.2, 0, Math.PI * 2); g.stroke(); }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.3;
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
    }
    D.circ(g, cx, cy, r * 0.22, '#2b3238');
  };
  D.psu = (g, x, y, w, hh) => {
    D.rr(g, x, y, w, hh, 1, '#394047', '#1a1e22', 0.4);
    const fr = Math.min(hh * 0.36, w * 0.2);
    D.fan(g, x + fr + 2.5, y + hh / 2, fr);
    const iw = Math.min(14, hh * 0.5), ih = iw * 0.72, ix = x + w - iw - 8, iy = y + hh / 2 - ih / 2;
    g.fillStyle = '#0c0e10';
    g.beginPath(); g.moveTo(ix + 1.5, iy); g.lineTo(ix + iw - 1.5, iy); g.lineTo(ix + iw, iy + 1.5); g.lineTo(ix + iw, iy + ih); g.lineTo(ix, iy + ih); g.lineTo(ix, iy + 1.5); g.closePath(); g.fill();
    g.fillStyle = '#c9ced2';
    [0.28, 0.5, 0.72].forEach((t, i) => g.fillRect(ix + iw * t - 0.5, iy + ih * (i === 1 ? 0.2 : 0.45), 1, ih * 0.35));
    D.led(g, x + w - 4, y + 3, 0.6, LEDC.g, true);
    g.strokeStyle = '#9aa3aa'; g.lineWidth = 1.1;
    g.beginPath(); g.moveTo(x + fr * 2 + 6, y + hh - 2.6); g.lineTo(x + w - iw - 12, y + hh - 2.6); g.stroke();
    D.rect(g, x + w - 5, y + hh - 6.5, 3, 4, '#e07b24');
  };
  D.drive = (g, x, y, w, hh, o) => {
    o = o || {};
    D.rr(g, x, y, w, hh, 0.7, '#2e3439', '#121518', 0.35);
    if (hh > w) {
      D.vent(g, x + 1.1, y + 3.5, w - 2.2, hh * 0.52, '#0a0d10', 0.75);
      D.rr(g, x + 1, y + hh * 0.64, w - 2, hh * 0.3, 0.5, '#434a51');
      D.rect(g, x + 1.6, y + hh - 3, w - 3.2, 1.1, o.tab || '#2f6fd6');
      D.led(g, x + w * 0.3, y + 1.8, 0.45, LEDC.g, o.lit !== false);
      D.led(g, x + w * 0.7, y + 1.8, 0.45, LEDC.b, true);
    } else {
      D.vent(g, x + 3.5, y + 1.1, w * 0.55, hh - 2.2, '#0a0d10', Math.min(0.9, hh * 0.08));
      D.rr(g, x + w * 0.62, y + 1, w * 0.34, hh - 2, 0.5, '#434a51');
      D.rect(g, x + w - 3, y + 1.6, 1.1, hh - 3.2, o.tab || '#2f6fd6');
      D.led(g, x + 1.8, y + hh * 0.3, 0.45, LEDC.g, o.lit !== false);
      D.led(g, x + 1.8, y + hh * 0.7, 0.45, LEDC.b, true);
    }
  };
  D.lcd = (g, x, y, w, hh, lines, color) => {
    D.rr(g, x, y, w, hh, 1, '#0a151b', '#26333b', 0.5);
    const c = color || '#7fe3ff';
    const n = Math.max(1, lines.length);
    const lh = (hh - 2.4) / n;
    lines.forEach((ln, i) => D.txt(g, ln, x + 1.8, y + 1.2 + lh * (i + 0.5), Math.min(3.2, lh * 0.7), c, 'left', 600, MONO));
  };

  /* ---------- 面板區塊 ---------- */
  const PORT = { rj45: [13.6, 12], sfp: [13.8, 9.4], qsfp: [19.2, 9.4] };
  function portGeom(s) {
    const pw = PORT[s.kind][0], ph = PORT[s.kind][1];
    const k = s.scale || 1, rows = s.rows || 1;
    const cols = Math.ceil(s.count / rows);
    const group = s.group || cols;
    const gg = Math.ceil(cols / group) - 1;
    const px = 1.1, py = s.kind === 'rj45' ? 1.4 : 3.2;
    return { k, rows, cols, group, pw, ph, px, py, w: (cols * (pw + px) - px + gg * 3.5) * k, h: (rows * ph + (rows - 1) * py) * k };
  }
  const SEC = {};
  SEC.brand = {
    w: (s, H) => s.w || (H >= 60 ? 70 : 56),
    draw(g, s, x, y, w, H) {
      D.rect(g, x, y + H * 0.16, 2, H * 0.68, s.accent || '#2fc6b8');
      const fs = Math.min(5.4, H * 0.15);
      D.txt(g, s.brand || '', x + 4.5, y + H / 2 - fs * 0.55, fs, s.ink || '#e9edf0', 'left', 800);
      D.txt(g, s.model || '', x + 4.5, y + H / 2 + fs * 0.75, fs * 0.72, s.ink2 || '#9aa4ab', 'left', 700);
    },
  };
  SEC.leds = {
    per: (H) => Math.max(1, Math.min(4, Math.floor((H - 3) / 5))),
    w: (s, H) => Math.ceil(s.items.length / SEC.leds.per(H)) * 12.5 + 1,
    draw(g, s, x, y, w, H) {
      const per = SEC.leds.per(H);
      const rowH = (H - 3) / per;
      s.items.forEach((it, i) => {
        const cx = x + 1.5 + Math.floor(i / per) * 12.5, cy = y + 1.5 + rowH * (i % per + 0.5);
        D.led(g, cx + 1, cy, 0.75, LEDC[it[1]] || LEDC.g, it[2] !== false);
        D.txt(g, it[0], cx + 2.7, cy, 1.9, s.ink || '#b9c1c7', 'left', 700);
      });
    },
  };
  SEC.ports = {
    w: (s) => portGeom(s).w,
    draw(g, s, x, y, w, H) {
      const L = portGeom(s);
      const y0 = y + (H - L.h) / 2 + (s.numbers ? 1.2 : 0);
      for (let c = 0; c < L.cols; c++) {
        const gx = x + (c * (L.pw + L.px) + Math.floor(c / L.group) * 3.5) * L.k;
        for (let r = 0; r < L.rows; r++) {
          const idx = c * L.rows + r;
          if (idx >= s.count) continue;
          const gy = y0 + r * (L.ph + L.py) * L.k;
          const lit = hash(idx * 7 + s.count) < (s.lit === undefined ? 0.72 : s.lit);
          g.save(); g.translate(gx, gy); g.scale(L.k, L.k);
          D[s.kind](g, 0, 0, {
            flip: L.rows > 1 && r === 0, lit, lit2: !!s.poe && lit && hash(idx * 13 + 1) < 0.55,
            module: s.modules !== undefined && idx < s.modules, bail: s.bail, mpo: s.mpo, poe: s.poe,
            accent: s.mgig ? '#4aa8ff' : null, leds: s.leds, shield: s.shield, num: s.numbers ? idx + 1 : 0,
          });
          g.restore();
        }
      }
    },
  };
  SEC.console = {
    w: () => 16,
    draw(g, s, x, y, w, H) {
      const cy = y + H / 2;
      if (H >= 36) {
        D.rj45(g, x + 1.2, cy - 12.5, { leds: false, shield: '#6f9fd8' });
        D.txt(g, 'CONSOLE', x + 8, cy + 1.6, 1.7, '#9ab8e0', 'center', 800);
        D.usb(g, x + 2, cy + 4.5);
      } else D.rj45(g, x + 1.2, cy - 6, { leds: false, shield: '#6f9fd8' });
    },
  };
  SEC.mgmt = {
    w: () => 16,
    draw(g, s, x, y, w, H) {
      const cy = y + H / 2;
      D.rj45(g, x + 1.2, cy - 8.5, { lit: true, lit2: true });
      D.txt(g, s.text || 'MGMT', x + 8, cy + 6, 1.9, '#b9c1c7', 'center', 800);
    },
  };
  SEC.lcd = {
    w: (s) => s.w || 38,
    draw(g, s, x, y, w, H) { const lh = Math.min(s.h || H * 0.55, H - 4); D.lcd(g, x, y + (H - lh) / 2, w, lh, s.lines || [], s.color); },
  };
  SEC.vent = { flex: true, w: (s) => s.w || 0, draw(g, s, x, y, w, H) { if (w > 3) D.vent(g, x, y + 2.2, w, H - 4.4, s.hole, s.r); } };
  SEC.blank = { w: (s) => s.w || 8, draw() {} };
  SEC.badge = {
    w: (s) => s.w || Math.max(10, s.text.length * 2.3 + 4),
    draw(g, s, x, y, w, H) {
      D.rr(g, x, y + H / 2 - 3.2, w, 6.4, 1.2, s.bg || 'rgba(255,255,255,0.08)', s.stroke || 'rgba(255,255,255,0.35)', 0.35);
      D.txt(g, s.text, x + w / 2, y + H / 2, 2.6, s.color || '#e6ecef', 'center', 800);
    },
  };
  SEC.text = {
    w: (s) => s.w || 24,
    draw(g, s, x, y, w, H) {
      const n = s.lines.length;
      s.lines.forEach((ln, i) => D.txt(g, ln, x + w / 2, y + H / 2 + (i - (n - 1) / 2) * (s.size || 3.2) * 1.5, s.size || 3.2, s.color || '#d9dee2', 'center', 800));
    },
  };
  SEC.ctrl = {
    w: () => 13,
    draw(g, s, x, y, w, H) {
      const cx = x + 6.5, top = y + H / 2 - 12;
      D.circ(g, cx, top + 4, 3.2, '#23292e', '#9aa3aa', 0.5);
      g.strokeStyle = '#3fe07a'; g.lineWidth = 0.5; g.beginPath(); g.arc(cx, top + 4, 1.6, -Math.PI * 0.35, Math.PI * 1.35); g.stroke();
      D.led(g, cx, top + 11.5, 0.7, LEDC.g, true);
      D.led(g, cx, top + 16, 0.7, LEDC.b, true);
      D.led(g, cx, top + 20.5, 0.7, LEDC.g, true);
    },
  };
  SEC.io = { w: () => 15, draw(g, s, x, y, w, H) { D.usb(g, x + 1.5, y + H / 2 - 7); D.usb(g, x + 1.5, y + H / 2 + 2); } };
  SEC.drives = {
    w: (s) => s.cols * (s.dw + 1.2) - 1.2,
    draw(g, s, x, y, w, H) {
      const th = s.rows * (s.dh + 1.2) - 1.2;
      const y0 = y + (H - th) / 2;
      for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) {
        const i = r * s.cols + c;
        D.drive(g, x + c * (s.dw + 1.2), y0 + r * (s.dh + 1.2), s.dw, s.dh, { lit: hash(i + 3) < 0.8, tab: s.tab });
      }
    },
  };
  SEC.psu = { w: (s, H) => s.w || Math.min(78, 30 + H * 0.9), draw(g, s, x, y, w, H) { D.psu(g, x, y + 2, w, H - 4); } };
  SEC.fan = {
    w: (s, H) => s.w || Math.min(H - 6, 56),
    draw(g, s, x, y, w, H) {
      D.rr(g, x, y + 2, w, H - 4, 1, '#2b3136', '#15191c', 0.4);
      D.fan(g, x + w / 2, y + H / 2, Math.min(w, H - 4) * 0.42);
    },
  };
  SEC.pcie = {
    w: (s) => s.w || 60,
    draw(g, s, x, y, w, H) {
      const n = s.n || 2, ph = (H - 6) / n;
      for (let i = 0; i < n; i++) {
        D.rr(g, x, y + 3 + i * ph, w, ph - 1.2, 0.6, '#3a4147', '#20252a', 0.3);
        for (let k = 0; k < Math.floor(w / 4); k++) D.rect(g, x + 3 + k * 4, y + 3 + i * ph + ph * 0.3, 1.4, ph * 0.4, '#15191c');
      }
    },
  };
  SEC.nic = {
    w: (s) => s.w || (s.count || 2) * 15.5 + 8,
    draw(g, s, x, y, w, H) {
      D.rr(g, x, y + H / 2 - 9, w, 18, 0.8, '#3d454c', '#1b1f23', 0.3);
      for (let i = 0; i < (s.count || 2); i++) D.sfp(g, x + 4 + i * 15.5, y + H / 2 - 5.5, { module: true, bail: s.bail, lit: true });
    },
  };
  SEC.outlets = {
    w: (s) => (s.cols || 4) * 11 + 2,
    draw(g, s, x, y, w, H) {
      const rows = s.rows || 2, cols = s.cols || 4;
      const y0 = y + H / 2 - rows * 4.4;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) D.c13(g, x + 1 + c * 11, y0 + r * 8.8);
    },
  };
  SEC.punch = {
    flex: true, w: () => 0,
    draw(g, s, x, y, w, H) {
      const n = s.count || 24, cw = w / n;
      const cols = ['#f08a24', '#3aa655', '#2f6fd6', '#8a5a36'];
      for (let i = 0; i < n; i++) {
        const px = x + i * cw;
        D.rr(g, px + 0.6, y + 6, cw - 1.2, H - 11, 0.8, '#e9e5dc');
        cols.forEach((cc, k) => D.rect(g, px + 1.4, y + 8 + k * (H - 15) / 4, cw - 2.8, (H - 15) / 4 - 0.8, cc));
        D.txt(g, String(i + 1), px + cw / 2, y + 3.2, 2.1, '#cfd5da', 'center', 700);
      }
    },
  };
  SEC.rings = {
    flex: true, w: () => 0,
    draw(g, s, x, y, w, H) {
      const n = 6;
      for (let i = 0; i < n; i++) { const cx = x + (i + 0.5) * w / n; D.rr(g, cx - 20, y + 5, 40, H - 10, 7, null, '#66707a', 2.4); }
    },
  };
  SEC.sc = {
    w: () => 16,
    draw(g, s, x, y, w, H) {
      const cy = y + H / 2;
      D.rr(g, x + 1, cy - 6.5, 14, 12, 1, '#b9c0c6');
      D.rr(g, x + 3, cy - 4.5, 10, 8, 0.8, '#3aa655');
      D.circ(g, x + 8, cy - 0.5, 1.4, '#f4f2ea');
      D.txt(g, 'PON', x + 8, cy + 8.5, 2.1, '#39424a', 'center', 800);
    },
  };
  SEC.dc = { w: () => 12, draw(g, s, x, y, w, H) { const cy = y + H / 2; D.circ(g, x + 6, cy - 1.5, 3.4, '#0c0e10', '#8f989f', 0.6); D.circ(g, x + 6, cy - 1.5, 0.9, '#c9ced2'); D.txt(g, '12V', x + 6, cy + 5, 2, '#39424a', 'center', 800); } };
  SEC.btns = {
    w: () => 13,
    draw(g, s, x, y, w, H) {
      ['ON', 'OFF', 'ESC'].forEach((t, k) => {
        const cy = y + H / 2 - 9 + k * 9;
        D.circ(g, x + 6.5, cy, 3.3, '#2a3136', '#8d979e', 0.5);
        D.txt(g, t, x + 6.5, cy, 1.8, '#d5dbdf', 'center', 800);
      });
    },
  };
  SEC.batt = {
    flex: true, w: () => 0,
    draw(g, s, x, y, w, H) {
      const n = s.n || 2, bw = (w - (n - 1) * 3) / n;
      for (let i = 0; i < n; i++) {
        const bx = x + i * (bw + 3);
        D.rr(g, bx, y + 5, bw, H - 10, 2, '#262c31', '#3a4248', 0.5);
        D.vent(g, bx + 6, y + 11, bw - 12, H - 42, '#101316', 1.6);
        D.txt(g, 'BATTERY PACK ' + (i + 1), bx + bw / 2, y + H - 20, 4, '#9aa4ab', 'center', 800);
        D.rr(g, bx + bw / 2 - 16, y + H - 12.5, 32, 4, 1.5, '#8f989f');
      }
    },
  };
  SEC.card = {
    w: () => 44,
    draw(g, s, x, y, w, H) {
      D.rr(g, x, y + H / 2 - 12, w, 24, 1, '#3d454c', '#1b1f23', 0.3);
      D.rj45(g, x + 4, y + H / 2 - 6, { lit: true, lit2: true });
      D.txt(g, 'NMC', x + 31, y + H / 2 - 3, 3, '#cfd5da', 'center', 800);
      D.txt(g, 'SNMP', x + 31, y + H / 2 + 3, 2.2, '#9aa4ab', 'center', 700);
    },
  };
  SEC.term = {
    w: () => 40,
    draw(g, s, x, y, w, H) {
      D.rr(g, x, y + H / 2 - 14, w, 28, 1.2, '#15181b', '#3a4248', 0.4);
      ['L', 'N', 'PE'].forEach((t, k) => { D.screw(g, x + 8 + k * 12, y + H / 2 - 2, 3); D.txt(g, t, x + 8 + k * 12, y + H / 2 + 8, 2.4, '#cfd5da', 'center', 800); });
      D.txt(g, 'AC INPUT', x + w / 2, y + H / 2 - 10.5, 2.2, '#9aa4ab', 'center', 800);
    },
  };

  /** 組合面板：由左到右排列區塊；連接埠太多時自動縮小；有標示的區塊輸出為 3D 標示點 */
  function compose(spec, W, H, sp) {
    const rows = spec.rows ? spec.rows : [{ s: spec.s }];
    const fixedH = rows.reduce((a, r) => a + (r.h || 0), 0);
    const autoN = rows.filter((r) => !r.h).length;
    const rowsH = rows.map((r) => Object.assign({}, r, { h: r.h || (H - fixedH) / Math.max(1, autoN) }));
    const layouts = [], regions = [];
    let y = 0;
    for (const row of rowsH) {
      const rh = row.h;
      const pad = row.pad !== undefined ? row.pad : (row.module ? 9 : 7);
      const gap = row.gap !== undefined ? row.gap : 5;
      let secs = row.s.map((s) => (s.t === 'brand' ? Object.assign({ brand: sp.brand, model: sp.model, accent: sp.accent, ink: sp.ink, ink2: sp.ink2 }, s) : Object.assign({}, s)));
      const measure = () => secs.map((s) => (SEC[s.t].flex && !s.w ? 0 : SEC[s.t].w(s, rh)));
      let widths = measure();
      let avail = W - pad * 2 - gap * (secs.length - 1);
      let fixed = widths.reduce((a, b) => a + b, 0);
      const portW = secs.reduce((a, s, i) => a + (s.t === 'ports' ? widths[i] : 0), 0);
      if (fixed > avail && portW > 0) {
        const k = Math.max(0.5, (avail - (fixed - portW)) / portW);
        secs.forEach((s) => { if (s.t === 'ports') s.scale = (s.scale || 1) * k; });
        widths = measure();
        fixed = widths.reduce((a, b) => a + b, 0);
      }
      while (fixed > avail && secs.length > 1) {
        const drop = secs.map((s, i) => i).reverse().find((i) => !secs[i].label && secs[i].t !== 'ports' && secs[i].t !== 'brand');
        if (drop === undefined) break;
        secs.splice(drop, 1); widths.splice(drop, 1);
        avail = W - pad * 2 - gap * (secs.length - 1);
        fixed = widths.reduce((a, b) => a + b, 0);
      }
      const flexN = secs.filter((s, i) => SEC[s.t].flex && !widths[i]).length;
      const flexW = flexN ? Math.max(0, (avail - fixed) / flexN) : 0;
      let x = pad;
      secs.forEach((s, i) => {
        const w = widths[i] || flexW;
        layouts.push({ s, x, y, w, h: rh });
        if (s.label) regions.push({ x: x + w / 2, y: y + rh / 2, label: s.label });
        x += w + gap;
      });
      y += rh;
    }
    const bg = spec.bg || sp.bezel || '#1d2227';
    return {
      regions,
      draw(g) {
        D.rect(g, 0, 0, W, H, bg);
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, 'rgba(255,255,255,0.07)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.14)');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        let yy = 0;
        rowsH.forEach((r, i) => {
          if (r.bg) D.rect(g, 0, yy, W, r.h, r.bg);
          if (i > 0) D.rect(g, 0, yy - 0.35, W, 0.7, 'rgba(0,0,0,0.6)');
          if (r.module) { D.screw(g, 3.6, yy + r.h / 2, 1.6); D.screw(g, W - 3.6, yy + r.h / 2, 1.6); }
          yy += r.h;
        });
        for (const L of layouts) SEC[L.s.t].draw(g, L.s, L.x, L.y, L.w, L.h);
      },
    };
  }

  /* ---------- 3D 工具 ---------- */
  let maxAniso = 8;
  const col = (hex) => new T.Color(hex).convertSRGBToLinear();
  const std = (hex, o) => new T.MeshStandardMaterial(Object.assign({ color: col(hex), metalness: 0.35, roughness: 0.55 }, o || {}));
  const glow = (hex, k) => new T.MeshStandardMaterial({ color: col(hex), emissive: col(hex), emissiveIntensity: k || 1.2, roughness: 0.3 });
  const texMat = (t, o) => new T.MeshStandardMaterial(Object.assign({ map: t, metalness: 0.2, roughness: 0.62 }, o || {}));
  const box = (w, hh, d, m) => new T.Mesh(new T.BoxGeometry(w, hh, d), m);
  const plane = (w, hh, m) => new T.Mesh(new T.PlaneGeometry(w, hh), m);
  const cylY = (r, hgt, m, seg) => new T.Mesh(new T.CylinderGeometry(r, r, hgt, seg || 24), m);
  /** 沿 X 軸的圓柱：x0 端半徑 r0、x1 端半徑 r1 */
  function cylX(r0, r1, x0, x1, m, y, z, seg) {
    const mesh = new T.Mesh(new T.CylinderGeometry(r1, r0, x1 - x0, seg || 24), m);
    mesh.rotation.z = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, y || 0, z || 0);
    return mesh;
  }
  function tube(points, r, m, seg, radial) {
    const curve = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(p[0], p[1], p[2])));
    return new T.Mesh(new T.TubeGeometry(curve, seg || 48, r, radial || 10, false), m);
  }
  function roundedRect(w, hh, r) {
    const s = new T.Shape();
    const x = -w / 2, y = -hh / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + hh - r); s.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    s.lineTo(x + r, y + hh); s.quadraticCurveTo(x, y + hh, x, y + hh - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  /** Canvas 貼圖：以 mm 為單位繪製 */
  function makeTex(wmm, hmm, draw, maxPpm) {
    const ppm = U.clamp(1300 / Math.max(wmm, hmm), 0.3, maxPpm || 24);
    const c = document.createElement('canvas');
    c.width = Math.max(4, Math.round(wmm * ppm));
    c.height = Math.max(4, Math.round(hmm * ppm));
    const g = c.getContext('2d');
    g.scale(c.width / wmm, c.height / hmm);
    draw(g, wmm, hmm);
    const t = new T.CanvasTexture(c);
    t.encoding = T.sRGBEncoding;
    t.anisotropy = maxAniso;
    return t;
  }
  const note = (p, n, text) => ({ p: new T.Vector3(p[0], p[1], p[2]), n: new T.Vector3(n[0], n[1], n[2]), text });
  M3.setAniso = (n) => { maxAniso = n; };

  /* ---------- 機架式設備（外殼 + 前後面板） ---------- */
  function chassis(sp) {
    const W = sp.w || 440;
    const Hm = sp.hmm || sp.u * 44.45 - 0.8;
    const Dm = sp.depth || 400;
    const g = new T.Group();
    g.add(box(W / 100, Hm / 100, Dm / 100, std(sp.body || '#2c3238', { metalness: 0.55, roughness: 0.42 })));
    const notes = [];
    const regions = { front: [], rear: [] };
    const panel = (spec, rear) => {
      if (!spec) return;
      const P = compose(spec, W, Hm, sp);
      const t = makeTex(W, Hm, (c) => P.draw(c));
      const m = plane(W / 100, Hm / 100, texMat(t, { metalness: 0.25, roughness: 0.58 }));
      if (rear) { m.rotation.y = Math.PI; m.position.z = -Dm / 200 - 0.002; } else m.position.z = Dm / 200 + 0.002;
      g.add(m);
      for (const r of P.regions) {
        const x = (r.x - W / 2) / 100, y = (Hm / 2 - r.y) / 100;
        const n = note([rear ? -x : x, y, (rear ? -1 : 1) * (Dm / 200 + 0.003)], [0, 0, rear ? -1 : 1], r.label);
        notes.push(n);
        regions[rear ? 'rear' : 'front'].push(n);
      }
    };
    panel(sp.front, false);
    panel(sp.rear, true);
    if (sp.ears !== false) {
      const earM = std(sp.ear || sp.bezel || '#1d2227', { metalness: 0.5, roughness: 0.45 });
      const holeM = std('#0a0c0e', { metalness: 0.2, roughness: 0.8 });
      const n = Math.max(1, Math.round((Hm + 0.8) / 44.45));
      for (const sx of [-1, 1]) {
        const ex = sx * (W / 200 + 0.105);
        const ear = box(0.21, Hm / 100, 0.025, earM);
        ear.position.set(ex, 0, Dm / 200 - 0.0125);
        g.add(ear);
        for (let i = 0; i < n; i++) {
          const hole = cylY(0.03, 0.03, holeM, 14);
          hole.rotation.x = Math.PI / 2;
          hole.position.set(ex + sx * 0.03, Hm / 200 - (i + 0.5) * 0.4445, Dm / 200 + 0.002);
          g.add(hole);
        }
        if (sp.handles) {
          const hm = std('#c5ccd2', { metalness: 0.8, roughness: 0.3 });
          const hh = Math.min(Hm / 100 * 0.7, 1.2);
          const bar = box(0.04, hh, 0.035, hm);
          bar.position.set(ex - sx * 0.02, 0, Dm / 200 + 0.085);
          g.add(bar);
          for (const yy of [-1, 1]) { const st = box(0.04, 0.04, 0.08, hm); st.position.set(ex - sx * 0.02, yy * hh * 0.45, Dm / 200 + 0.045); g.add(st); }
        }
      }
    }
    if (sp.sticker !== false && Dm >= 250) {
      const tt = makeTex(70, 34, (c) => {
        D.rect(c, 0, 0, 70, 34, '#f1f2ee');
        D.txt(c, sp.brand || '', 3, 5.5, 4.2, '#1d2227', 'left', 800);
        D.txt(c, sp.model || '', 3, 11.5, 3.4, '#39424a', 'left', 700);
        D.txt(c, 'S/N NX' + ((sp.model || 'X').length * 7919 % 100000), 3, 17, 2.4, '#4b555d', 'left', 600, MONO);
        for (let i = 0; i < 38; i++) D.rect(c, 3 + i * 1.6, 21, hash(i + 5) > 0.5 ? 0.9 : 0.45, 10, '#1d2227');
      });
      const st = plane(0.7, 0.34, texMat(tt, { metalness: 0, roughness: 0.75 }));
      st.rotation.x = -Math.PI / 2;
      st.position.set(W / 200 - 0.55, Hm / 200 + 0.002, -Dm / 200 + 0.4);
      g.add(st);
    }
    return { obj: g, notes, regions, dims: [W, Hm, Dm], view: sp.view };
  }

  /* ---------- 設備規格（面板配置與零件說明） ---------- */
  const NET = { body: '#2d3339', bezel: '#1c2126' };
  const FW = { body: '#2d3339', bezel: '#7c1c22', brand: 'SENTRIX', accent: '#ff8a80', ink2: '#f1b9b5' };
  const SVR = { body: '#b3bac0', bezel: '#1b1f23', brand: 'KORVEN', accent: '#5aa9f0', handles: true };
  const ACC = { body: '#aeb5bb', bezel: '#2a3036', brand: 'ARCLINE', accent: '#2fc6b8' };
  const WLC = { body: '#2d3339', bezel: '#1c2126', brand: 'SKYLUME', accent: '#e6a23c' };
  const R = (o) => Object.assign({}, NET, { brand: 'ARCLINE', accent: '#8f7cf0' }, o);
  const SW = (o) => Object.assign({}, NET, { brand: 'ARCLINE', accent: '#2fc6b8' }, o);
  const SPEC = {
    'NR-1100': R({ u: 1, depth: 300,
      front: { s: [{ t: 'brand' }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['WAN', 'a']] },
        { t: 'ports', kind: 'rj45', count: 4, label: '4 × 1G 銅纜埠（WAN / LAN）' },
        { t: 'ports', kind: 'sfp', count: 2, modules: 1, label: '2 × SFP+ 光纖埠（10G）' },
        { t: 'console', label: 'Console / USB：本機設定' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '單電源（沒有備援）' }, { t: 'vent' }, { t: 'fan', label: '散熱風扇' }, { t: 'fan' }] } }),
    'NR-5500': R({ u: 2, depth: 480,
      front: { s: [{ t: 'brand' }, { t: 'lcd', w: 36, lines: ['NR-5500', 'BGP 2/2 UP', 'CPU 23%'], label: 'LCD 狀態面板' },
        { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['FAN', 'g'], ['PSU', 'g'], ['BGP', 'b'], ['ALM', 'r', false]] },
        { t: 'console' }, { t: 'mgmt', label: 'MGMT 頻外管理埠' },
        { t: 'ports', kind: 'sfp', count: 8, rows: 2, group: 4, modules: 5, label: '8 × SFP28（最高 25G）：接 ISP 與防火牆' },
        { t: 'ports', kind: 'qsfp', count: 2, rows: 2, modules: 1, mpo: true, label: '2 × QSFP28（100G）' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（1+1 備援，可熱插拔）' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan', label: '熱插拔風扇模組' }, { t: 'fan' }, { t: 'fan' }] } }),
    'NR-9000': R({ u: 4, depth: 600,
      front: { rows: [
        { h: 44.45, module: true, s: [{ t: 'brand', label: '路由引擎 RP：負責控制平面（BGP 路由計算）' }, { t: 'lcd', w: 40, lines: ['NR-9000', 'BGP 4 PEERS', 'RIB 912K'] },
          { t: 'leds', items: [['PWR', 'g'], ['RP', 'g'], ['FAN', 'g'], ['ALM', 'r', false]] }, { t: 'console' }, { t: 'mgmt' }, { t: 'vent' }] },
        { h: 66.1, module: true, bg: '#20262b', s: [{ t: 'badge', text: 'LC1' }, { t: 'ports', kind: 'sfp', count: 16, rows: 2, group: 8, modules: 10, label: '線卡 1：16 × SFP28（可熱插拔）' }, { t: 'vent' }] },
        { h: 66.1, module: true, bg: '#20262b', s: [{ t: 'badge', text: 'LC2' }, { t: 'ports', kind: 'qsfp', count: 8, rows: 2, group: 4, modules: 5, mpo: true, label: '線卡 2：8 × QSFP28 100G' }, { t: 'vent' }] },
      ] },
      rear: { s: [{ t: 'psu', label: '4 組電源（N+N 備援）' }, { t: 'psu' }, { t: 'psu' }, { t: 'psu' }, { t: 'fan', w: 70, label: '風扇匣' }] } }),
    'SG-300': Object.assign({}, FW, { u: 1, depth: 300,
      front: { s: [{ t: 'brand' }, { t: 'leds', items: [['PWR', 'g'], ['HA', 'b'], ['ALM', 'r', false]] },
        { t: 'ports', kind: 'rj45', count: 8, group: 4, label: '8 × 1G：外部 / 內部 / DMZ 介面' },
        { t: 'ports', kind: 'sfp', count: 2, label: '2 × SFP+' }, { t: 'console' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '單電源' }, { t: 'vent' }, { t: 'fan' }] } }),
    'SG-3000': Object.assign({}, FW, { u: 2, depth: 500,
      front: { s: [{ t: 'brand' }, { t: 'lcd', w: 34, lines: ['SG-3000', 'SESS 812K', 'IPS ON'], label: 'LCD：連線數、IPS 狀態' },
        { t: 'mgmt', label: 'MGMT 管理埠' }, { t: 'ports', kind: 'rj45', count: 2, rows: 2, label: 'HA1 / HA2：高可用同步埠' },
        { t: 'ports', kind: 'rj45', count: 8, rows: 2, group: 4, label: '8 × 1G 介面' },
        { t: 'ports', kind: 'sfp', count: 12, rows: 2, group: 6, modules: 6, label: '12 × SFP28：外部 / 內部 / DMZ 區域' },
        { t: 'ports', kind: 'qsfp', count: 2, rows: 2, modules: 1, mpo: true, label: '2 × QSFP28 100G' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（備援）' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan', label: '風扇' }, { t: 'fan' }, { t: 'fan' }] } }),
    'SG-9000': Object.assign({}, FW, { u: 3, depth: 600,
      front: { rows: [
        { h: 44.45, s: [{ t: 'brand' }, { t: 'lcd', w: 44, lines: ['SG-9000  IPS ON', 'SESS 6.2M  CPS 180K'], label: 'LCD 狀態面板' },
          { t: 'leds', items: [['PWR', 'g'], ['HA', 'b'], ['IPS', 'g'], ['ALM', 'r', false]] }, { t: 'console' }, { t: 'mgmt' },
          { t: 'ports', kind: 'rj45', count: 4, rows: 2, label: 'HA / 管理埠' }, { t: 'vent' }] },
        { s: [{ t: 'ports', kind: 'sfp', count: 16, rows: 2, group: 8, modules: 12, label: '16 × SFP28 介面' },
          { t: 'ports', kind: 'qsfp', count: 8, rows: 2, group: 4, modules: 6, mpo: true, label: '8 × QSFP28 100G：萬人規模出口' }, { t: 'vent' }] },
      ] },
      rear: { s: [{ t: 'psu', label: '4 組電源' }, { t: 'psu' }, { t: 'psu' }, { t: 'psu' }, { t: 'fan', label: '風扇' }] } }),
    'CX-3200': SW({ u: 1, depth: 350,
      front: { s: [{ t: 'brand' }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['STK', 'b']] },
        { t: 'ports', kind: 'rj45', count: 24, rows: 2, group: 12, label: '24 × 1G RJ45' },
        { t: 'ports', kind: 'sfp', count: 8, rows: 2, group: 4, modules: 3, label: '8 × SFP+ 10G：接樓層與上游' },
        { t: 'console', label: 'Console 管理埠' }] },
      rear: { s: [{ t: 'psu', label: '電源' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }] } }),
    'CX-6400': SW({ u: 1, depth: 450,
      front: { s: [{ t: 'brand', w: 44 }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['FAN', 'g']] },
        { t: 'ports', kind: 'sfp', count: 48, rows: 2, group: 12, modules: 26, label: '48 × SFP28（25G）：接各樓層 IDF 與伺服器' },
        { t: 'ports', kind: 'qsfp', count: 8, rows: 2, group: 4, modules: 4, mpo: true, label: '8 × QSFP28（100G）：核心互連 / 防火牆' }] },
      rear: { s: [{ t: 'console', label: 'Console / 管理埠在背面' }, { t: 'mgmt' }, { t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan', label: '風扇模組（前進後出）' }, { t: 'fan' }, { t: 'fan' }, { t: 'fan' }] } }),
    'CX-9600': SW({ u: 7, depth: 650,
      front: { rows: [
        { h: 44.45, module: true, s: [{ t: 'brand', label: '雙引擎 Supervisor：一台故障另一台接手' }, { t: 'lcd', w: 36, lines: ['SUP-A ACTIVE', 'SUP-B STANDBY'] },
          { t: 'leds', items: [['PWR', 'g'], ['SUP', 'g'], ['FAN', 'g']] }, { t: 'console' }, { t: 'mgmt' }, { t: 'vent' }, { t: 'badge', text: 'SUP-B' }, { t: 'console' }, { t: 'mgmt' }] },
        { h: 55, module: true, bg: '#22282d', s: [{ t: 'badge', text: 'LC1' }, { t: 'ports', kind: 'sfp', count: 48, rows: 2, group: 12, modules: 34, label: '線卡：48 × SFP28（可熱插拔）' }, { t: 'vent' }] },
        { h: 55, module: true, bg: '#22282d', s: [{ t: 'badge', text: 'LC2' }, { t: 'ports', kind: 'sfp', count: 48, rows: 2, group: 12, modules: 20 }, { t: 'vent' }] },
        { h: 55, module: true, bg: '#22282d', s: [{ t: 'badge', text: 'LC3' }, { t: 'ports', kind: 'qsfp', count: 16, rows: 2, group: 8, modules: 10, mpo: true, label: '線卡：16 × QSFP28 100G' }, { t: 'vent' }] },
        { h: 55, module: true, bg: '#22282d', s: [{ t: 'badge', text: 'LC4' }, { t: 'ports', kind: 'qsfp', count: 16, rows: 2, group: 8, modules: 4, mpo: true }, { t: 'vent' }] },
        { s: [{ t: 'psu', w: 92, label: '前置電源模組 ×4' }, { t: 'psu', w: 92 }, { t: 'psu', w: 92 }, { t: 'psu', w: 92 }] },
      ] },
      rear: { s: [{ t: 'fan', w: 120, label: '大型風扇匣（前進後出風流）' }, { t: 'fan', w: 120 }, { t: 'fan', w: 120 }] } }),
    'DX-2400': SW({ u: 1, depth: 300, body: '#3a4147', bezel: '#262c31',
      front: { s: [{ t: 'brand' }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g']] },
        { t: 'ports', kind: 'rj45', count: 24, rows: 2, group: 12, label: '24 × 1G：接 DMZ 伺服器' },
        { t: 'ports', kind: 'sfp', count: 4, rows: 2, modules: 2, label: '4 × SFP+ 上行（接防火牆 DMZ 介面）' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '電源' }, { t: 'vent' }, { t: 'fan' }] } }),
    'DX-4800': SW({ u: 1, depth: 450,
      front: { s: [{ t: 'brand', w: 44 }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['FAN', 'g']] },
        { t: 'ports', kind: 'sfp', count: 48, rows: 2, group: 12, modules: 30, label: '48 × SFP28：機櫃內伺服器接入' },
        { t: 'ports', kind: 'qsfp', count: 6, rows: 2, group: 3, modules: 2, mpo: true, label: '6 × QSFP28 上行到核心' }] },
      rear: { s: [{ t: 'console' }, { t: 'mgmt' }, { t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }, { t: 'fan' }] } }),
    'AX-24P': Object.assign({}, ACC, { u: 1, depth: 300,
      front: { s: [{ t: 'brand' }, { t: 'badge', text: 'PoE+', label: 'PoE+：網路線同時供電給 AP 與 IP 電話' },
        { t: 'ports', kind: 'rj45', count: 24, rows: 2, group: 12, poe: true, label: '24 × 1G PoE+：接座位與 AP' },
        { t: 'ports', kind: 'sfp', count: 4, rows: 2, modules: 2, label: '4 × SFP+ 上行埠：光纖接 B1 核心' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '電源（PoE 需要大瓦數）' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }] } }),
    'AX-48P': Object.assign({}, ACC, { u: 1, depth: 350,
      front: { s: [{ t: 'brand', w: 44 }, { t: 'badge', text: 'PoE+', label: 'PoE+：網路線同時供電給 AP 與 IP 電話' },
        { t: 'ports', kind: 'rj45', count: 48, rows: 2, group: 12, poe: true, label: '48 × 1G PoE+（總預算 740W）' },
        { t: 'ports', kind: 'sfp', count: 4, rows: 2, modules: 2, label: '4 × SFP+ 上行埠（10G 光纖接 B1）' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '電源（PoE 需要大瓦數）' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }] } }),
    'AX-48M': Object.assign({}, ACC, { u: 1, depth: 380,
      front: { s: [{ t: 'brand', w: 44 }, { t: 'badge', text: 'mGig', color: '#9fd0ff', label: 'mGig：同一個埠可跑 1 / 2.5 / 5G' },
        { t: 'ports', kind: 'rj45', count: 48, rows: 2, group: 12, poe: true, mgig: true, label: '48 × mGig PoE++（Wi-Fi 6E / 7 AP 用）' },
        { t: 'ports', kind: 'sfp', count: 4, rows: 2, modules: 2, bail: '#2f6fd6', label: '4 × SFP28 25G 上行' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（PoE++ 總預算 1,440W）' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }] } }),
    'SV-1U': Object.assign({}, SVR, { u: 1, depth: 700,
      front: { s: [{ t: 'ctrl', label: '電源鍵與健康狀態燈' }, { t: 'drives', cols: 4, rows: 2, dw: 72, dh: 16.4, label: '8 × 2.5 吋熱插拔硬碟槽' }, { t: 'vent' }, { t: 'io' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（熱插拔）' }, { t: 'psu' }, { t: 'pcie', w: 56, n: 1, label: 'PCIe 擴充槽' }, { t: 'nic', count: 2, label: '2 × 10G SFP+ 網卡：接核心交換器' }, { t: 'mgmt', text: 'BMC', label: 'BMC 遠端管理埠（開關機、看螢幕）' }, { t: 'vent' }] } }),
    'SV-2U': Object.assign({}, SVR, { u: 2, depth: 720,
      front: { s: [{ t: 'ctrl', label: '電源鍵與健康狀態燈' }, { t: 'drives', cols: 24, rows: 1, dw: 14.4, dh: 72, label: '24 × 2.5 吋 NVMe / SAS 硬碟槽' }, { t: 'io' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（熱插拔）' }, { t: 'psu' }, { t: 'pcie', w: 70, n: 3, label: 'PCIe 擴充槽（GPU / HBA）' }, { t: 'nic', count: 2, bail: '#1b1b1b', label: '2 × 25G 網卡' }, { t: 'mgmt', text: 'BMC' }, { t: 'vent' }] } }),
    'ST-4U': Object.assign({}, SVR, { u: 4, depth: 680,
      front: { s: [{ t: 'ctrl', label: '電源鍵與狀態燈' }, { t: 'drives', cols: 4, rows: 6, dw: 96, dh: 26.5, tab: '#e07b24', label: '24 × 3.5 吋大容量硬碟（熱插拔，RAID 保護）' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'nic', count: 4, label: '4 × 25G 網卡：大量檔案 / 備份流量' }, { t: 'mgmt', text: 'BMC' }, { t: 'fan', label: '風扇' }, { t: 'fan' }] } }),
    'WC-500': Object.assign({}, WLC, { u: 1, depth: 350,
      front: { s: [{ t: 'brand' }, { t: 'lcd', w: 40, lines: ['APs 212/250', 'CLIENTS 3.4K'], label: '控制器狀態：管理中的 AP 與用戶數' },
        { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['RRM', 'b']] }, { t: 'ports', kind: 'rj45', count: 2, label: '管理 / 服務埠' },
        { t: 'ports', kind: 'sfp', count: 2, modules: 2, label: '2 × SFP+：上連核心交換器' }, { t: 'console' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }] } }),
    'WC-3000': Object.assign({}, WLC, { u: 2, depth: 500,
      front: { s: [{ t: 'brand' }, { t: 'lcd', w: 44, lines: ['APs 1,204/1,500', 'CLIENTS 11.8K', 'RRM AUTO'], label: '控制器狀態' },
        { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['HA', 'b'], ['RRM', 'b']] }, { t: 'console' }, { t: 'mgmt' },
        { t: 'ports', kind: 'sfp', count: 4, rows: 2, modules: 4, label: '4 × SFP28 上連' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }, { t: 'fan' }] } }),
    'UPS-10K': { u: 5, depth: 650, body: '#1f2327', bezel: '#23282c', brand: 'VOLTARA', accent: '#46d17f',
      front: { rows: [
        { h: 62, s: [{ t: 'brand', w: 70 }, { t: 'lcd', w: 74, h: 36, lines: ['ONLINE  LOAD 42%', 'BATT 100%  18 MIN', 'IN 230V  OUT 230V'], color: '#8ff0c0', label: 'LCD：負載、電池電量、剩餘時間' },
          { t: 'btns', label: '操作按鈕' }, { t: 'leds', items: [['ONLINE', 'g'], ['BATT', 'a', false], ['BYPASS', 'a', false], ['FAULT', 'r', false]] }, { t: 'vent' }] },
        { s: [{ t: 'batt', n: 2, label: '電池模組（前方可抽換）' }] },
      ] },
      rear: { s: [{ t: 'term', label: '市電輸入端子' }, { t: 'outlets', cols: 4, rows: 3, label: '輸出插座：接 PDU 或設備' }, { t: 'card', label: '網路管理卡：透過 SNMP 送出停電告警' }, { t: 'vent' }, { t: 'fan' }] } },
    'patch24': { u: 1, depth: 110, body: '#15181b', bezel: '#17191c', sticker: false,
      front: { s: [{ t: 'text', w: 20, lines: ['CAT6', '24P'], size: 3 },
        { t: 'ports', kind: 'rj45', count: 24, group: 6, leds: false, shield: '#c0c6cb', numbers: true, label: '24 個 RJ45 插座：每個對應一個座位的網路線' },
        { t: 'text', w: 20, lines: ['PANEL', 'A'], size: 3 }] },
      rear: { s: [{ t: 'punch', count: 24, label: '背面打線模組：水平布線的網路線接在這裡' }] } },
    'cm1u': { u: 1, depth: 90, body: '#15181b', bezel: '#17191c', sticker: false, front: { s: [{ t: 'rings' }] } },
  };
  const DEFAULT_VIEW = { yaw: 0.4, pitch: 0.26 };

  /* ---------- 無線基地台 ---------- */
  function apModel(id) {
    const m = CAT.aps[id];
    const C = { 'AP-500': { s: 2.0, t: 0.36, round: true, led: '#46e27a' }, 'AP-600': { s: 2.2, t: 0.44, led: '#46e27a' },
      'AP-610E': { s: 2.3, t: 0.47, led: '#4aa8ff' }, 'AP-700': { s: 2.5, t: 0.5, led: '#b18cff', trim: '#30363c' } }[id];
    const g = new T.Group();
    const shell = std('#f1f3f4', { metalness: 0.02, roughness: 0.42 });
    const topY = C.t / 2;
    let side;
    if (C.round) {
      g.add(new T.Mesh(new T.CylinderGeometry(C.s / 2 * 0.95, C.s / 2, C.t, 72), shell));
      side = C.s / 2;
    } else {
      const geo = new T.ExtrudeGeometry(roundedRect(C.s, C.s, C.s * 0.2), { depth: C.t * 0.7, bevelEnabled: true, bevelThickness: C.t * 0.15, bevelSize: C.s * 0.025, bevelSegments: 5, curveSegments: 20 });
      geo.center();
      const body = new T.Mesh(geo, shell);
      body.rotation.x = -Math.PI / 2;
      g.add(body);
      side = C.s / 2 + C.s * 0.025;
    }
    const S = C.s * 100;
    const decal = makeTex(S, S, (c) => {
      D.circ(c, S / 2, S / 2, S * 0.36, null, 'rgba(0,0,0,0.06)', 1.2);
      D.txt(c, 'SKYLUME', S / 2, S * 0.78, S * 0.055, '#8a939a', 'center', 800);
      D.rr(c, S / 2 - S * 0.12, S * 0.17, S * 0.24, S * 0.075, S * 0.02, C.trim || '#e2e7ea');
      D.txt(c, m.gen.toUpperCase(), S / 2, S * 0.2075, S * 0.042, C.trim ? '#e8ecef' : '#5b666e', 'center', 800);
    });
    const top = new T.Mesh(C.round ? new T.CircleGeometry(C.s / 2 * 0.93, 64) : new T.PlaneGeometry(C.s * 0.9, C.s * 0.9), texMat(decal, { transparent: true, metalness: 0, roughness: 0.45 }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = topY + 0.002;
    g.add(top);
    const led = new T.Mesh(new T.TorusGeometry(C.s * 0.045, C.s * 0.007, 12, 48), glow(C.led, 1.6));
    led.rotation.x = -Math.PI / 2;
    led.position.set(0, topY + 0.004, -C.s * 0.06);
    g.add(led);
    if (C.trim) {
      const ring = new T.Mesh(new T.TorusGeometry(C.s * 0.4, C.s * 0.012, 12, 96), std(C.trim, { metalness: 0.4, roughness: 0.35 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = topY + 0.003;
      g.add(ring);
    }
    const bm = std('#a9b1b7', { metalness: 0.75, roughness: 0.32 });
    const br = box(C.s * 0.5, 0.035, C.s * 0.5, bm);
    br.position.y = -C.t / 2 - 0.018;
    g.add(br);
    const clip = box(C.s * 0.66, 0.02, 0.09, bm);
    clip.position.set(0, -C.t / 2 - 0.046, 0);
    g.add(clip);
    const portT = makeTex(34, 18, (c) => {
      D.rect(c, 0, 0, 34, 18, '#e9ecee');
      D.rj45(c, 2, 3, { lit: true, lit2: true, poe: true });
      D.txt(c, 'PoE', 25, 6.5, 3.4, '#39424a', 'center', 800);
      D.txt(c, 'ETH0', 25, 12.5, 2.8, '#6b7780', 'center', 800);
    });
    const pp = plane(0.34, 0.18, texMat(portT));
    pp.rotation.y = Math.PI;
    pp.position.set(0, -C.t * 0.08, -side - 0.004);
    g.add(pp);
    g.add(tube([[0, -C.t * 0.08, -side - 0.02], [0, -C.t * 0.1, -side - 0.3], [0, -C.t - 0.15, -side - 0.55], [0, -C.t - 0.8, -side - 0.65]], 0.03, std('#2f6fd6', { roughness: 0.6 }), 40));
    const notes = [
      note([0, topY, -C.s * 0.06], [0, 1, 0], '狀態燈（' + (C.led === '#46e27a' ? '綠' : C.led === '#4aa8ff' ? '藍' : '紫') + '燈 = 正常服務）'),
      note([C.s * 0.24, topY, C.s * 0.2], [0, 1, 0], '天線藏在外殼裡：朝下 360° 發射訊號'),
      note([0, topY, -C.s * 0.33], [0, 1, 0], `${m.gen}：${U.bw(m.cap)}、建議 ${m.maxClients} 台同時連線`),
      note([0, -C.t * 0.08, -side - 0.004], [0, 0, -1], 'PoE 網路埠：一條網路線同時供電與傳資料'),
      note([C.s * 0.33, -C.t / 2 - 0.046, 0], [1, 0, 0], '吸頂支架：扣在天花板輕鋼架上（這面朝下安裝）'),
    ];
    return { obj: g, notes, view: { yaw: 0.55, pitch: 0.62 } };
  }

  /* ---------- 銅纜（RJ45 接頭 + 剝開的雙絞線） ---------- */
  function rj45Plug(shielded) {
    const g = new T.Group();
    const clear = std('#dfe9ef', { transparent: true, opacity: 0.42, roughness: 0.12, metalness: 0 });
    const shell = shielded ? std('#c9ced3', { metalness: 0.85, roughness: 0.3 }) : clear;
    const gold = std('#d8b048', { metalness: 0.9, roughness: 0.25 });
    g.add(box(0.24, 0.083, 0.119, shell));
    for (let i = 0; i < 8; i++) { const c = box(0.05, 0.006, 0.0075, gold); c.position.set(-0.085, 0.036, -0.0525 + i * 0.015); g.add(c); }
    if (!shielded) {
      const cols = ['#f2f2f2', '#f08a24', '#f2f2f2', '#2f6fd6', '#f2f2f2', '#3aa655', '#f2f2f2', '#8a5a36'];
      cols.forEach((cc, i) => g.add(cylX(0.0046, 0.0046, -0.075, 0.11, std(cc, { roughness: 0.5 }), 0.012, -0.0525 + i * 0.015, 10)));
    }
    const latch = box(0.15, 0.007, 0.05, shell);
    latch.position.set(0.01, -0.05, 0);
    latch.rotation.z = 0.12;
    g.add(latch);
    return g;
  }
  function jacketTex(text, color) {
    const t = makeTex(40, 400, (c) => {
      D.rect(c, 0, 0, 40, 400, color);
      c.save(); c.translate(20, 200); c.rotate(-Math.PI / 2);
      for (let k = -2; k <= 2; k++) D.txt(c, text, k * 80, 0, 9, 'rgba(255,255,255,0.85)', 'center', 700);
      c.restore();
    }, 4);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
  }
  function copperCable(shielded) {
    const g = new T.Group();
    const jr = shielded ? 0.038 : 0.031;
    const jc = shielded ? '#5aa0e8' : '#2f6fd6';
    const jt = jacketTex(shielded ? 'CAT6A F/UTP 23AWG' : 'CAT6 U/UTP 23AWG', jc);
    g.add(cylX(jr, jr, -0.38, 0.3, texMat(jt, { metalness: 0.02, roughness: 0.6 }), 0, 0, 32));
    g.add(cylX(0.036, jr + 0.004, -0.62, -0.38, std(jc, { transparent: true, opacity: 0.9, roughness: 0.4 })));
    const plug = rj45Plug(shielded);
    plug.position.x = -0.74;
    g.add(plug);
    if (shielded) {
      g.add(cylX(jr - 0.005, jr - 0.005, 0.3, 0.4, std('#dfe3e6', { metalness: 0.95, roughness: 0.25 }), 0, 0, 32));
      g.add(cylX(0.0022, 0.0022, 0.3, 0.7, std('#c9ced2', { metalness: 0.9, roughness: 0.3 }), jr - 0.012, 0.004, 8));
    }
    const sp = std('#f4f6f7', { transparent: true, opacity: 0.85, roughness: 0.4 });
    const s1 = box(0.16, 0.004, 0.024, sp); s1.position.x = 0.38; g.add(s1);
    const s2 = box(0.16, 0.024, 0.004, sp); s2.position.x = 0.38; g.add(s2);
    [['#2f6fd6', 0], ['#f08a24', 1], ['#3aa655', 2], ['#8a5a36', 3]].forEach(([c, k]) => {
      const ang = Math.PI / 4 + k * Math.PI / 2;
      const cy = Math.sin(ang) * 0.0135, cz = Math.cos(ang) * 0.0135;
      const pitch = 0.07 + k * 0.012;
      for (const ph of [0, Math.PI]) {
        const pts = [];
        for (let i = 0; i <= 60; i++) {
          const x = 0.28 + (i / 60) * 0.44;
          const spread = 1 + Math.max(0, x - 0.46) * 2.6;
          const a = ph + (x / pitch) * Math.PI * 2;
          pts.push([x, cy * spread + Math.sin(a) * 0.0052, cz * spread + Math.cos(a) * 0.0052]);
        }
        g.add(tube(pts, 0.0047, std(ph ? c : '#f2f2f2', { metalness: 0.05, roughness: 0.5 }), 90, 8));
      }
    });
    const notes = [
      note([-0.86, 0, 0], [-1, 0, 0], shielded ? '屏蔽式 RJ45 接頭：金屬外殼接地' : 'RJ45 接頭：8 根金屬接點'),
      note([-0.5, jr + 0.005, 0], [0, 1, 0], '防拔護套'),
      note([0, jr, 0], [0, 1, 0], shielded ? 'Cat6A：10G 可跑 100m、線徑較粗' : 'Cat6：1G 可跑 100m（10G 只到 55m）'),
      note([0.62, 0.03, 0.03], [0, 1, 0], '4 對雙絞線：每對絞距不同，降低串音干擾'),
      note([0.38, 0.013, 0], [0, 0, 1], '十字隔離骨架：把 4 對線隔開'),
    ];
    if (shielded) notes.push(note([0.35, jr - 0.005, 0], [0, 1, 0], '鋁箔屏蔽：擋住外部電磁干擾'));
    return { obj: g, notes, view: { yaw: 0.42, pitch: 0.42 } };
  }

  /* ---------- 光纖跳線（LC 雙芯 + 剝開的光纖結構） ---------- */
  function fiberCable(kind) {
    const om4 = kind === 'om4';
    const jc = om4 ? '#26bfc9' : '#f0c02c', cc = om4 ? '#1fa9b6' : '#2f6fd6';
    const g = new T.Group();
    const jm = std(jc, { roughness: 0.55, metalness: 0.02 }), cm = std(cc, { roughness: 0.4, metalness: 0.05 });
    const zs = [-0.012, 0.012];
    g.add(cylX(0.01, 0.01, -0.24, 0.55, jm, 0, zs[0]));
    g.add(cylX(0.01, 0.01, -0.24, 0.3, jm, 0, zs[1]));
    const web = box(0.54, 0.004, 0.012, jm); web.position.set(0.03, 0, 0); g.add(web);
    zs.forEach((z) => {
      const zc = z * 2.6;
      g.add(tube([[-0.24, 0, z], [-0.29, 0, z * 1.7], [-0.34, 0, zc]], 0.01, jm, 16));
      g.add(cylX(0.016, 0.011, -0.5, -0.33, cm, 0, zc));
      const lc = box(0.14, 0.046, 0.046, cm); lc.position.set(-0.57, 0, zc); g.add(lc);
      const arm = box(0.1, 0.006, 0.02, cm); arm.position.set(-0.57, 0.03, zc); arm.rotation.z = -0.25; g.add(arm);
      g.add(cylX(0.00625, 0.00625, -0.675, -0.64, std('#f5f3ec', { roughness: 0.25 }), 0, zc, 16));
    });
    const clip = box(0.05, 0.016, 0.1, cm); clip.position.set(-0.52, 0.03, 0); g.add(clip);
    const z = zs[1];
    g.add(cylX(0.0082, 0.0082, 0.3, 0.38, std('#e8c96a', { transparent: true, opacity: 0.8, roughness: 0.9 }), 0, z));
    g.add(cylX(0.0045, 0.0045, 0.3, 0.48, std('#f4f4f2', { roughness: 0.4 }), 0, z));
    g.add(cylX(0.0026, 0.0026, 0.48, 0.6, std('#bfe9f2', { transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.1 }), 0, z));
    const coreR = om4 ? 0.00105 : 0.00042;
    g.add(cylX(coreR, coreR, 0.48, 0.615, glow(om4 ? '#ff9d3a' : '#ff5a4f', 1.4), 0, z, 12));
    const notes = [
      note([-0.66, 0, zs[1] * 2.6], [-1, 0, 0], `LC 雙芯接頭（${om4 ? '多模用水藍色' : '單模 UPC 用藍色'}）：一芯發、一芯收`),
      note([-0.675, 0, zs[0] * 2.6], [0, 0, -1], '陶瓷插芯：直徑 1.25mm，光從中心射出'),
      note([0.1, 0.01, 0], [0, 1, 0], om4 ? 'OM4 多模光纖（水藍色外被）：10G 可跑 400m' : 'OS2 單模光纖（黃色外被）：可跑 10km 以上'),
      note([0.34, 0.0082, z], [0, 1, 0], '克維拉纖維：承受拉力，保護玻璃光纖'),
      note([0.42, 0.0045, z], [0, 0, 1], '緊套緩衝層 900µm'),
      note([0.55, 0.0026, z], [0, 1, 0], '玻璃包層 125µm（把光關在纖芯裡）'),
      note([0.61, 0, z], [1, 0, 0], om4 ? '纖芯 50µm：多種光路（多模），放大示意' : '纖芯只有 9µm：單一光路（單模），放大示意'),
    ];
    return { obj: g, notes, view: { yaw: 0.35, pitch: 0.5 } };
  }

  /* ---------- 光模組 ---------- */
  function optic(o) {
    const g = new T.Group();
    const q = o.kind === 'qsfp';
    const w = q ? 0.1835 : 0.137, hh = 0.085, d = q ? 0.724 : 0.565;
    g.add(box(w, hh, d, std('#c7cdd2', { metalness: 0.8, roughness: 0.32 })));
    const lt = makeTex(d * 62, w * 86, (c, W, H) => {
      D.rect(c, 0, 0, W, H, '#f3f4f1');
      D.txt(c, 'ARCLINE', 2.5, H * 0.2, H * 0.14, '#1d2227', 'left', 800);
      o.lines.forEach((ln, i) => D.txt(c, ln, 2.5, H * (0.42 + i * 0.19), H * 0.12, '#2c3238', 'left', 700));
      for (let i = 0; i < 26; i++) D.rect(c, W - 17 + i * 0.55, H * 0.15, hash(i + 9) > 0.5 ? 0.35 : 0.18, H * 0.5, '#1d2227');
    });
    const lab = plane(d * 0.62, w * 0.86, texMat(lt, { metalness: 0, roughness: 0.7 }));
    lab.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    lab.position.set(0, hh / 2 + 0.001, -d * 0.08);
    g.add(lab);
    const ft = makeTex(w * 100, hh * 100, (c, W, H) => {
      D.rect(c, 0, 0, W, H, '#8f989f');
      D.rect(c, 0.8, 0.8, W - 1.6, H - 1.6, '#474d53');
      if (o.mpo) D.rr(c, W * 0.22, H / 2 - 1.5, W * 0.56, 3, 0.5, '#0a0c0e');
      else { D.rr(c, W * 0.14, H / 2 - 2.2, 4.3, 4.4, 0.6, '#0a0c0e'); D.rr(c, W * 0.86 - 4.3, H / 2 - 2.2, 4.3, 4.4, 0.6, '#0a0c0e'); D.circ(c, W * 0.14 + 2.15, H / 2, 0.65, '#f5f3ec'); D.circ(c, W * 0.86 - 2.15, H / 2, 0.65, '#f5f3ec'); }
    });
    const front = plane(w, hh, texMat(ft));
    front.position.z = d / 2 + 0.001;
    g.add(front);
    const bm = std(o.bail, { metalness: 0.2, roughness: 0.45 });
    if (!q) {
      for (const sx of [-1, 1]) { const b = box(0.008, 0.008, 0.11, bm); b.position.set(sx * (w / 2 - 0.01), -0.028, d / 2); g.add(b); }
      const fb = box(w - 0.012, 0.012, 0.012, bm); fb.position.set(0, -0.028, d / 2 + 0.055); g.add(fb);
    } else {
      const tab = box(0.11, 0.005, 0.32, bm); tab.position.set(0, hh / 2 + 0.003, d / 2 + 0.1); g.add(tab);
      const ring = new T.Mesh(new T.TorusGeometry(0.03, 0.007, 10, 32), bm); ring.rotation.x = Math.PI / 2; ring.position.set(0, hh / 2 + 0.003, d / 2 + 0.28); g.add(ring);
    }
    const pt = makeTex(w * 80, 7, (c, W, H) => { D.rect(c, 0, 0, W, H, '#1e6b3a'); for (let i = 0; i < 10; i++) D.rect(c, 0.6 + i * (W - 1.2) / 10, 1, (W - 1.2) / 10 - 0.35, H - 1.5, '#d8b048'); });
    const pcb = box(w * 0.8, 0.012, 0.07, texMat(pt, { metalness: 0.4, roughness: 0.4 }));
    pcb.position.z = -d / 2 - 0.03;
    g.add(pcb);
    const notes = [
      note([0, 0.004, d / 2 + 0.002], [0, 0, 1], o.mpo ? 'MPO 接孔：12 芯光纖（4 發 4 收）' : 'LC 雙芯接孔：一芯發送（Tx）、一芯接收（Rx）'),
      note(q ? [0.05, hh / 2 + 0.006, d / 2 + 0.2] : [w / 2 - 0.01, -0.028, d / 2 + 0.03], q ? [0, 1, 0] : [1, 0, 0], o.bailText),
      note([0, hh / 2, -d * 0.08], [0, 1, 0], '標籤：規格、波長、傳輸距離'),
      note([0, 0, -d / 2 - 0.06], [0, 0, -1], '金手指：插進交換器的 ' + (q ? 'QSFP' : 'SFP') + ' 槽'),
      note([w / 2, 0, -d * 0.2], [1, 0, 0], '金屬外殼：散熱與電磁屏蔽'),
    ];
    return { obj: g, notes, view: { yaw: 0.75, pitch: 0.38 } };
  }

  /* ---------- 精密空調 ---------- */
  function crac(id, wmm, kw) {
    const Hm = 1950, Dm = 890;
    const g = new T.Group();
    g.add(box(wmm / 100, Hm / 100, Dm / 100, std('#dfe3e6', { metalness: 0.18, roughness: 0.5 })));
    const doors = Math.max(1, Math.round(wmm / 425)), dw = wmm / doors;
    const ft = makeTex(wmm, Hm, (c) => {
      D.rect(c, 0, 0, wmm, Hm, '#e3e7ea');
      for (let i = 0; i < doors; i++) {
        const x = i * dw;
        D.rr(c, x + 8, 8, dw - 16, Hm - 16, 4, '#eceff1', '#b8c0c6', 1.5);
        for (let k = 0; k < 16; k++) D.rr(c, x + 30, 36 + k * 28, dw - 60, 13, 3, '#a3acb3');
        D.vent(c, x + 30, Hm * 0.53, dw - 60, Hm * 0.38, '#9aa3aa', 4.2);
        D.rr(c, x + dw - 34, Hm * 0.43, 10, 90, 4, '#59626a');
      }
      D.rr(c, 36, 520, 170, 110, 6, '#20282e');
      D.lcd(c, 46, 530, 150, 90, ['SUPPLY 18.0C', 'RETURN 29.4C', 'RH 45% FAN 72%'], '#8ff0c0');
      D.txt(c, 'FROSTLINE', 36, 675, 30, '#2c3238', 'left', 800);
      D.txt(c, `${id}  ${kw} kW`, 36, 712, 20, '#5b6770', 'left', 700);
    });
    const fp = plane(wmm / 100, Hm / 100, texMat(ft, { metalness: 0.15, roughness: 0.5 }));
    fp.position.z = Dm / 200 + 0.003;
    g.add(fp);
    const tt = makeTex(wmm, Dm, (c) => { D.rect(c, 0, 0, wmm, Dm, '#d7dce0'); for (let k = 0; k < 20; k++) D.rr(c, 40, 40 + k * 40, wmm - 80, 18, 4, '#8f989f'); });
    const tp = plane(wmm / 100, Dm / 100, texMat(tt));
    tp.rotation.x = -Math.PI / 2;
    tp.position.y = Hm / 200 + 0.003;
    g.add(tp);
    const fz = Dm / 200 + 0.004;
    const notes = [
      note([(-wmm / 2 + dw / 2) / 100, (Hm / 2 - 260) / 100, fz], [0, 0, 1], '出風口：冷風往前吹進冷通道'),
      note([(121 - wmm / 2) / 100, (Hm / 2 - 575) / 100, fz], [0, 0, 1], '控制面板：送風 / 回風溫度、濕度'),
      note([0, Hm / 200, 0], [0, 1, 0], '頂部回風口：吸入熱通道的熱空氣'),
      note([(-wmm / 2 + dw / 2) / 100, (Hm / 2 - Hm * 0.72) / 100, fz], [0, 0, 1], '濾網與送風機'),
      note([wmm / 200, 0, 0], [1, 0, 0], `冷卻能力 ${kw} kW：要大於機房設備總發熱`),
    ];
    return { obj: g, notes, view: { yaw: 0.6, pitch: 0.2 } };
  }

  /* ---------- 模組化 UPS 機櫃 ---------- */
  function upsCabinet() {
    const Wm = 600, Hm = 1950, Dm = 900;
    const g = new T.Group();
    g.add(box(Wm / 100, Hm / 100, Dm / 100, std('#1c2126', { metalness: 0.45, roughness: 0.5 })));
    const ft = makeTex(Wm, Hm, (c) => {
      D.rect(c, 0, 0, Wm, Hm, '#20262b');
      D.rr(c, 10, 10, Wm - 20, Hm - 20, 6, null, '#3a4248', 2);
      D.txt(c, 'VOLTARA', 40, 70, 34, '#e9edf0', 'left', 800);
      D.txt(c, 'UPS 80 kVA  MODULAR', 40, 104, 17, '#9aa4ab', 'left', 700);
      D.rect(c, 40, 60 - 16, 6, 44, '#46d17f');
      D.rr(c, 110, 140, 380, 240, 8, '#0b1419', '#2d3a42', 2);
      c.strokeStyle = '#46d17f'; c.lineWidth = 4;
      c.beginPath(); c.moveTo(150, 250); c.lineTo(250, 250); c.moveTo(350, 250); c.lineTo(450, 250); c.moveTo(300, 280); c.lineTo(300, 330); c.stroke();
      D.rr(c, 250, 215, 100, 70, 6, '#12222a', '#46d17f', 3);
      D.txt(c, 'UPS', 300, 250, 22, '#8ff0c0', 'center', 800, MONO);
      D.txt(c, 'INPUT', 175, 225, 15, '#8ff0c0', 'left', 700, MONO);
      D.txt(c, 'OUTPUT 42%', 360, 225, 15, '#8ff0c0', 'left', 700, MONO);
      D.rr(c, 270, 330, 60, 34, 4, '#12222a', '#46d17f', 2);
      D.txt(c, 'BATT 100%', 300, 190, 15, '#8ff0c0', 'center', 700, MONO);
      for (let i = 0; i < 5; i++) {
        const y = 440 + i * 150;
        D.rr(c, 40, y, 520, 128, 6, '#2b3238', '#15191c', 2);
        D.vent(c, 60, y + 16, 300, 96, '#0d1013', 5);
        D.led(c, 400, y + 40, 7, LEDC.g, true);
        D.txt(c, 'POWER MODULE ' + (i + 1), 420, y + 40, 14, '#cfd5da', 'left', 800);
        D.txt(c, '16 kW', 420, y + 70, 14, '#9aa4ab', 'left', 700);
        D.rr(c, 390, y + 92, 150, 18, 8, '#8f989f');
      }
      D.vent(c, 40, 1230, 520, 640, '#0d1013', 7);
    });
    const fp = plane(Wm / 100, Hm / 100, texMat(ft, { metalness: 0.3, roughness: 0.5 }));
    fp.position.z = Dm / 200 + 0.003;
    g.add(fp);
    const fz = Dm / 200 + 0.004;
    const notes = [
      note([0, (Hm / 2 - 260) / 100, fz], [0, 0, 1], '觸控螢幕：市電、電池、輸出負載一目了然'),
      note([-1.2, (Hm / 2 - 800) / 100, fz], [0, 0, 1], '功率模組：故障時可線上抽換（N+1 備援）'),
      note([0, (Hm / 2 - 1550) / 100, fz], [0, 0, 1], '通風口'),
      note([Wm / 200, 0, 0], [1, 0, 0], '80 kVA：撐住整間機房，直到發電機啟動'),
    ];
    return { obj: g, notes, view: { yaw: 0.55, pitch: 0.18 } };
  }

  /* ---------- 柴油發電機（隔音箱型） ---------- */
  function generator() {
    const L = 36, Hc = 16.5, Wd = 12.5, base = 1.8;
    const g = new T.Group();
    const skid = box(L + 1, base, Wd + 0.8, std('#2a2f33', { metalness: 0.6, roughness: 0.5 }));
    skid.position.y = base / 2;
    g.add(skid);
    const yellow = '#d4ad3f';
    const sideTex = (doorsLabel) => makeTex(L * 100, Hc * 100, (c, W, H) => {
      D.rect(c, 0, 0, W, H, yellow);
      for (let i = 0; i < 3; i++) {
        const x = 300 + i * 1050;
        D.rr(c, x, 160, 900, 1330, 10, '#ddb84a', '#a7852b', 5);
        D.rr(c, x + 800, 700, 36, 180, 10, '#3b3f42');
        D.vent(c, x + 100, 1000, 700, 380, '#6b5518', 16);
      }
      if (doorsLabel) {
        D.rr(c, 470, 330, 560, 330, 14, '#1b2025', '#3b3f42', 6);
        D.lcd(c, 510, 370, 480, 250, ['AUTO  READY', 'U 400V  F 50Hz', 'FUEL 92%'], '#8ff0c0');
        D.txt(c, 'GENMARK', 1650, 380, 120, '#2a2f33', 'left', 800);
        D.txt(c, '250 kVA DIESEL GENERATOR', 1650, 520, 64, '#2a2f33', 'left', 800);
      }
    });
    const endTex = (radiator) => makeTex(Wd * 100, Hc * 100, (c, W, H) => {
      D.rect(c, 0, 0, W, H, yellow);
      D.rr(c, 100, 150, W - 200, H - 300, 10, '#3a3a36', '#a7852b', 5);
      for (let k = 0; k < 26; k++) D.rect(c, 120, 180 + k * 48, W - 240, 26, radiator ? '#1c1c1a' : '#2a2a27');
    });
    const mats = [texMat(endTex(true)), texMat(endTex(false)), std(yellow, { metalness: 0.3, roughness: 0.5 }), std(yellow), texMat(sideTex(true)), texMat(sideTex(false))];
    const canopy = new T.Mesh(new T.BoxGeometry(L, Hc, Wd), mats);
    canopy.position.y = base + Hc / 2;
    g.add(canopy);
    const ex = cylY(0.9, 4, std('#5a5f63', { metalness: 0.8, roughness: 0.35 }), 24);
    ex.position.set(L / 2 - 5, base + Hc + 2, 2);
    g.add(ex);
    const cap = cylY(1.3, 0.25, std('#4a4f53', { metalness: 0.8, roughness: 0.35 }), 24);
    cap.position.set(L / 2 - 5, base + Hc + 4.2, 2);
    cap.rotation.z = 0.35;
    g.add(cap);
    const eyeM = std('#2a2f33', { metalness: 0.7, roughness: 0.4 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const eye = new T.Mesh(new T.TorusGeometry(0.45, 0.12, 10, 24), eyeM);
      eye.position.set(sx * (L / 2 - 1.2), base + Hc + 0.35, sz * (Wd / 2 - 1.2));
      g.add(eye);
    }
    const notes = [
      note([-L / 2 + 7.5, base + Hc - 4.9, Wd / 2 + 0.01], [0, 0, 1], '控制面板：市電中斷時由 ATS 自動啟動'),
      note([L / 2 - 5, base + Hc + 4, 2], [0, 1, 0], '排氣管'),
      note([L / 2, base + Hc / 2, 0], [1, 0, 0], '散熱器出風口'),
      note([0, base + Hc * 0.8, Wd / 2 + 0.01], [0, 0, 1], '隔音罩：降低運轉噪音'),
      note([0, base / 2, Wd / 2 + 0.4], [0, 0, 1], '底座油箱：可連續供電 8～24 小時'),
    ];
    return { obj: g, notes, view: { yaw: 0.7, pitch: 0.25 } };
  }

  /* ---------- 42U 機櫃（含設備） ---------- */
  function rack42() {
    const g = new T.Group();
    const RW = 6.0, RH = 20.0, RD = 10.0, U0 = 0.86, UH = 0.4445;
    const frameM = std('#1b1f23', { metalness: 0.55, roughness: 0.45 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = box(0.35, RH, 0.35, frameM);
      p.position.set(sx * (RW / 2 - 0.175), RH / 2, sz * (RD / 2 - 0.175));
      g.add(p);
    }
    const top = box(RW, 0.35, RD, frameM); top.position.y = RH - 0.175; g.add(top);
    const base = box(RW, 0.8, RD, frameM); base.position.y = 0.4; g.add(base);
    const sideM = std('#22272c', { metalness: 0.45, roughness: 0.55 });
    for (const sx of [-1, 1]) {
      const sp = box(0.03, RH - 1.15, RD - 0.7, sideM);
      sp.position.set(sx * (RW / 2 - 0.02), 0.8 + (RH - 1.15) / 2, 0);
      g.add(sp);
    }
    const zRail = RD / 2 - 1.2;
    const railT = makeTex(18, 1870, (c, W, H) => {
      D.rect(c, 0, 0, W, H, '#2b3136');
      for (let u = 0; u < 42; u++) {
        const y = H - (u + 0.5) * 44.45;
        for (const dy of [-15.9, 0, 15.9]) D.rr(c, W / 2 - 4.5, y + dy - 4.5, 9, 9, 1, '#07090b');
        if (u % 5 === 0 || u === 41) D.txt(c, String(u + 1), W / 2, y - 22, 5, '#e6ecef', 'center', 800);
      }
    }, 2.5);
    for (const sx of [-1, 1]) {
      const rail = box(0.18, 18.7, 0.05, std('#2b3136', { metalness: 0.6, roughness: 0.4 }));
      rail.position.set(sx * 2.33, U0 + 18.7 / 2, zRail);
      g.add(rail);
      const rp = plane(0.18, 18.7, texMat(railT, { metalness: 0.4 }));
      rp.position.set(sx * 2.33, U0 + 18.7 / 2, zRail + 0.026);
      g.add(rp);
    }
    const placements = [['UPS-10K', 1], ['ST-4U', 10], ['ST-4U', 14], ['SV-2U', 19], ['SV-2U', 21], ['SV-1U', 23], ['SV-1U', 24], ['SV-1U', 25], ['SV-1U', 26],
      ['WC-500', 34], ['NR-5500', 35], ['SG-3000', 37], ['CX-6400', 40], ['cm1u', 41], ['patch24', 42]];
    const used = new Set();
    const pos = {};
    for (const [id, u] of placements) {
      const sp = Object.assign({ model: id }, SPEC[id], { sticker: false });
      const c = chassis(sp);
      const y = U0 + (u - 1) * UH + sp.u * UH / 2;
      c.obj.position.set(0, y, zRail + 0.03 - c.dims[2] / 200);
      g.add(c.obj);
      for (let k = 0; k < sp.u; k++) used.add(u + k);
      pos[id] = pos[id] || { y, z: zRail + 0.03, u };
    }
    const blankM = std('#16191c', { metalness: 0.4, roughness: 0.55 });
    let firstBlank = null;
    for (let u = 1; u <= 42; u++) {
      if (used.has(u)) continue;
      const b = box(4.4, UH - 0.012, 0.02, blankM);
      b.position.set(0, U0 + (u - 0.5) * UH, zRail + 0.03);
      g.add(b);
      if (firstBlank === null && u > 26) firstBlank = u;
    }
    const pduT = makeTex(50, 1650, (c, W, H) => {
      D.rect(c, 0, 0, W, H, '#15181b');
      D.rr(c, 5, 20, W - 10, 60, 4, '#0a151b', '#26333b', 1);
      D.txt(c, '6.2kW', W / 2, 50, 11, '#8ff0c0', 'center', 800, MONO);
      for (let i = 0; i < 24; i++) D.c13(c, W / 2 - 4.5, 110 + i * 62);
    }, 2);
    const pduX = RW / 2 - 0.45;
    for (const sx of [-1, 1]) {
      const pdu = box(0.4, 16.5, 0.5, std('#15181b', { metalness: 0.4 }));
      pdu.position.set(sx * pduX, U0 + 9.2, -RD / 2 + 0.6);
      g.add(pdu);
      const pp = plane(0.5, 16.5, texMat(pduT));
      pp.rotation.y = -sx * Math.PI / 2;
      pp.position.set(sx * (pduX - 0.202), U0 + 9.2, -RD / 2 + 0.6);
      g.add(pp);
    }
    const cabM = [std('#2f6fd6', { roughness: 0.6 }), std('#f0c02c', { roughness: 0.6 }), std('#26bfc9', { roughness: 0.6 })];
    const ySw = pos['CX-6400'].y, yPp = pos.patch24.y, zf = zRail + 0.05;
    for (let i = 0; i < 9; i++) {
      const xs = -1.5 + i * 0.36, xp = -1.55 + i * 0.37;
      g.add(tube([[xs, ySw - 0.08, zf], [xs + 0.02, ySw - 0.05, zf + 0.35], [xp, (ySw + yPp) / 2 + 0.2, zf + 0.5], [xp, yPp + 0.04, zf + 0.3], [xp, yPp + 0.02, zf]], 0.028, cabM[i % 3], 40, 8));
    }
    const fz = zRail + 0.06;
    const notes = [
      note([-1.7, pos.patch24.y, fz], [0, 0, 1], '配線架：樓層水平布線在這裡終結'),
      note([1.8, pos['CX-6400'].y, fz], [0, 0, 1], '核心交換器'),
      note([-1.7, pos['SG-3000'].y, fz], [0, 0, 1], '防火牆'),
      note([1.8, pos['NR-5500'].y, fz], [0, 0, 1], '邊界路由器'),
      note([-1.7, pos['SV-1U'].y, fz], [0, 0, 1], '1U 伺服器 × 4'),
      note([1.8, pos['SV-2U'].y + UH, fz], [0, 0, 1], '2U 伺服器 × 2'),
      note([-1.7, pos['ST-4U'].y, fz], [0, 0, 1], '4U 儲存伺服器'),
      note([1.8, pos['UPS-10K'].y, fz], [0, 0, 1], '機架式 UPS：最重，放最下面'),
      note([0, U0 + ((firstBlank || 28) - 0.5) * UH, fz], [0, 0, 1], '盲板：封住空位，避免熱風回流'),
      note([-2.33, U0 + 30 * UH, zRail + 0.03], [0, 0, 1], 'U 刻度：1U = 44.45 mm，共 42U'),
      note([pduX, U0 + 12, -RD / 2 + 0.35], [0, 0, -1], '直立式 PDU：每座機櫃 8 kW 上限'),
      note([0.4, (ySw + yPp) / 2 + 0.2, zf + 0.5], [0, 0, 1], '跳線：交換器 ⇄ 配線架'),
    ];
    return { obj: g, notes, view: { yaw: 0.5, pitch: 0.1 } };
  }

  /* ---------- 防火牆 HA 配對 ---------- */
  function haPair() {
    const g = new T.Group();
    const sp = Object.assign({ model: 'SG-3000' }, SPEC['SG-3000']);
    const a = chassis(sp), b = chassis(Object.assign({}, sp, { sticker: false }));
    const hU = sp.u * 0.4445;
    a.obj.position.y = hU / 2 + 0.04;
    b.obj.position.y = -hU / 2 - 0.04;
    g.add(a.obj, b.obj);
    const ha = a.regions.front.find((n) => n.text.indexOf('HA') >= 0);
    const hx = ha ? ha.p.x : -0.3, hy = ha ? ha.p.y : 0, hz = ha ? ha.p.z : 2.5;
    g.add(tube([[hx, hy + a.obj.position.y, hz], [hx + 0.1, hy + a.obj.position.y, hz + 0.35], [hx + 0.35, 0, hz + 0.55], [hx + 0.1, hy + b.obj.position.y, hz + 0.35], [hx, hy + b.obj.position.y, hz]], 0.03, std('#e84a4a', { roughness: 0.5 }), 48));
    const notes = [
      note([-1.9, a.obj.position.y, hz], [0, 0, 1], 'Active：主要防火牆，處理所有流量'),
      note([-1.9, b.obj.position.y, hz], [0, 0, 1], 'Standby：備援，主要那台故障時秒級接手'),
      note([hx + 0.35, 0, hz + 0.55], [0, 0, 1], 'HA 同步線：心跳偵測 + 連線狀態同步'),
    ];
    const dp = a.regions.front.find((n) => n.text.indexOf('SFP28') >= 0);
    if (dp) notes.push(note([dp.p.x, dp.p.y + a.obj.position.y, dp.p.z], [0, 0, 1], '兩台的外部 / 內部介面接法完全相同'));
    return { obj: g, notes, view: { yaw: 0.45, pitch: 0.22 } };
  }

  /* ---------- ISP 光纖終端設備 ---------- */
  function ont() {
    const c = chassis({ model: 'OPTICAL CPE', brand: 'ISP', w: 220, hmm: 38, depth: 160, ears: false, sticker: false,
      body: '#eceff1', bezel: '#f3f5f6', accent: '#f07b5a', ink: '#2c3238', ink2: '#6b7780',
      front: { s: [{ t: 'brand', w: 58 }, { t: 'leds', items: [['PWR', 'g'], ['PON', 'g'], ['LOS', 'r', false], ['WAN', 'g'], ['LAN', 'g'], ['10G', 'b']], ink: '#39424a', label: '狀態燈：PON 亮 = 光纖正常；LOS 亮紅 = 斷光' }] },
      rear: { s: [{ t: 'sc', label: 'SC/APC 光纖入口：ISP 拉進來的單模光纖' }, { t: 'ports', kind: 'sfp', count: 1, modules: 1, bail: '#2f6fd6', label: '10G SFP+ 交接埠：接你的邊界路由器' },
        { t: 'ports', kind: 'rj45', count: 2, label: '1G 交接埠' }, { t: 'dc' }] } });
    const sc = c.regions.rear.find((n) => n.text.indexOf('SC/APC') >= 0);
    if (sc) c.obj.add(tube([[sc.p.x, sc.p.y, sc.p.z - 0.02], [sc.p.x, sc.p.y, sc.p.z - 0.4], [sc.p.x + 0.3, sc.p.y - 0.1, sc.p.z - 0.9], [sc.p.x + 1.2, sc.p.y - 0.15, sc.p.z - 1.2]], 0.015, std('#f0c02c', { roughness: 0.5 }), 40));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const f = cylY(0.06, 0.03, std('#20252a'), 12); f.position.set(sx * 0.85, -0.2, sz * 0.6); c.obj.add(f); }
    c.view = { yaw: 2.6, pitch: 0.35 };
    return c;
  }

  /* ---------- 模型登錄表 ---------- */
  const BUILD = {};
  for (const id of Object.keys(SPEC)) if (id !== 'cm1u') BUILD[id] = () => chassis(Object.assign({ model: id }, SPEC[id]));
  for (const id of Object.keys(CAT.aps)) BUILD[id] = () => apModel(id);
  BUILD['CRAC-25'] = () => crac('CRAC-25', 850, 25);
  BUILD['CRAC-60'] = () => crac('CRAC-60', 1700, 60);
  BUILD['UPS-80K'] = upsCabinet;
  BUILD['GEN-250'] = generator;
  BUILD.rack42 = rack42;
  BUILD['ha-pair'] = haPair;
  BUILD.ont = ont;
  BUILD.cat6 = () => copperCable(false);
  BUILD.cat6a = () => copperCable(true);
  BUILD.om4 = () => fiberCable('om4');
  BUILD.os2 = () => fiberCable('os2');
  BUILD['sfp-sr'] = () => optic({ kind: 'sfp', bail: '#1b1b1b', bailText: '黑色拉環 = 850nm 多模（SR）', lines: ['10GBASE-SR', '850nm  MMF  LC', 'OM4 400m'] });
  BUILD['sfp-lr'] = () => optic({ kind: 'sfp', bail: '#2f6fd6', bailText: '藍色拉環 = 1310nm 單模（LR）', lines: ['10GBASE-LR', '1310nm  SMF  LC', '10 km'] });
  BUILD['qsfp-sr4'] = () => optic({ kind: 'qsfp', mpo: true, bail: '#d8ceb0', bailText: '拉帶：拔除時往外拉', lines: ['100GBASE-SR4', '850nm  MMF  MPO', 'OM4 100m'] });
  BUILD['qsfp-lr4'] = () => optic({ kind: 'qsfp', bail: '#2f6fd6', bailText: '藍色拉帶 = 單模（LR4）', lines: ['100GBASE-LR4', '1310nm  SMF  LC', '10 km'] });

  const EXTRA = {
    rack42: { name: '42U 標準機櫃', cap: '寬 600、深 1000、高 2000 mm 的 19 吋機櫃。重的設備放下面、網路設備放上面，空位用盲板封住。' },
    'ha-pair': { name: '防火牆 HA 配對', cap: '兩台同型防火牆以 HA 線互連，一台 Active 處理流量、一台 Standby 待命。' },
    patch24: { name: '24 埠配線架（Patch Panel）', cap: '水平布線的每條網路線都終結在配線架背面，前面再用短跳線接到交換器。' },
    ont: { name: 'ISP 光纖終端設備（CPE）', cap: 'ISP 拉進機房的單模光纖接在這台設備上，再交接給你的邊界路由器。' },
    cat6: { name: 'Cat6 網路線', cap: '最常見的網路線：4 對雙絞線，1G 可跑 100m。' },
    cat6a: { name: 'Cat6A 屏蔽網路線', cap: '更粗、有屏蔽，10G 可跑滿 100m。' },
    om4: { name: 'OM4 多模光纖跳線', cap: '水藍色外被、LC 雙芯接頭。短距離高速首選。' },
    os2: { name: 'OS2 單模光纖跳線', cap: '黃色外被、藍色 LC 接頭。纖芯只有 9µm，可傳 10 公里以上。' },
    'sfp-sr': { name: 'SFP+ 光模組（10GBASE-SR）', cap: '插進交換器的 SFP 槽，把電訊號轉成光訊號。SR 搭配多模光纖。' },
    'sfp-lr': { name: 'SFP+ 光模組（10GBASE-LR）', cap: 'LR 搭配單模光纖，可跑 10 公里，價格比 SR 貴。' },
    'qsfp-sr4': { name: 'QSFP28 光模組（100GBASE-SR4）', cap: '100G 模組，SR4 用 MPO 接頭的多模光纖（4 發 4 收）。' },
    'qsfp-lr4': { name: 'QSFP28 光模組（100GBASE-LR4）', cap: '100G 單模模組，一顆就要數萬元。' },
  };
  M3.has = (id) => !!BUILD[id];
  M3.info = (id) => {
    if (EXTRA[id]) return EXTRA[id];
    const m = CAT.devices[id] || CAT.access[id] || CAT.aps[id] || CAT.room[id];
    return m ? { name: m.name, cap: m.desc } : { name: id, cap: '' };
  };
  /** 建立模型：{ obj, notes:[{p,n,text}], view:{yaw,pitch} } */
  M3.build = (id) => {
    const b = BUILD[id]();
    b.view = Object.assign({}, DEFAULT_VIEW, b.view || {});
    return b;
  };

  /** 知識卡對應的模型 */
  M3.KB = {
    'k-router': ['NR-5500', 'NR-1100', 'NR-9000'],
    'k-switch': ['CX-6400', 'AX-48P', 'CX-9600'],
    'k-firewall': ['SG-3000', 'SG-300'],
    'k-isp': ['ont', 'os2'],
    'k-hier': ['CX-6400', 'AX-48P'],
    'k-rack': ['rack42', 'SV-2U'],
    'k-mdf': ['patch24', 'rack42'],
    'k-cable': ['cat6', 'cat6a', 'om4', 'os2'],
    'k-optics': ['sfp-sr', 'sfp-lr', 'qsfp-sr4', 'qsfp-lr4'],
    'k-poe': ['AX-48P', 'AP-600'],
    'k-wifi': ['AP-600', 'AP-700', 'AP-500'],
    'k-channel': ['AP-610E'],
    'k-wlc': ['WC-500', 'AP-600'],
    'k-power': ['UPS-10K', 'UPS-80K', 'GEN-250'],
    'k-cooling': ['CRAC-25', 'CRAC-60'],
    'k-ha': ['ha-pair'],
    'k-lacp': ['om4', 'sfp-sr'],
    'k-dhcpdns': ['SV-1U'],
    'k-nms': ['SV-1U'],
    'k-siem': ['SV-2U'],
    'k-ransom': ['ST-4U'],
    'k-ips': ['SG-9000'],
    'k-oversub': ['AX-48P', 'CX-6400'],
  };
  M3.forKb = (id) => (M3.KB[id] || []).filter((x) => M3.has(x));
})(window.G = window.G || {});
