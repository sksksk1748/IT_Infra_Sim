/* 監控圖表：以 Canvas 繪製折線 / 面積圖與迷你走勢圖，顏色取自主題色票 */
(function (G) {
  'use strict';
  const U = G.U;
  const Charts = {};
  G.Charts = Charts;

  Charts.setup = (canvas) => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 150;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  };

  function niceStep(max, n) {
    const raw = max / n;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function withAlpha(color, a) {
    const c = color.trim();
    if (c.startsWith('#') && c.length === 7) {
      const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
      return `rgba(${r},${g},${b},${a})`;
    }
    return c;
  }
  Charts.withAlpha = withAlpha;

  /**
   * 折線圖
   * opt: { t:[時間], series:[{data, color, fill, dash, width}], yMax, yFmt, minY }
   */
  Charts.line = (canvas, opt) => {
    const { ctx, w, h } = Charts.setup(canvas);
    const tk = U.tokens();
    const padL = 48, padR = 10, padT = 10, padB = 20;
    const pw = w - padL - padR, ph = h - padT - padB;
    const n = opt.t.length;
    ctx.font = `11px ${tk.mono}`;
    if (n < 2) {
      ctx.fillStyle = tk.text3;
      ctx.textAlign = 'center';
      ctx.fillText('資料收集中…', w / 2, h / 2);
      return;
    }
    let max = opt.minY || 0;
    for (const s of opt.series) for (const v of s.data) if (v !== null && v !== undefined && v > max) max = v;
    if (opt.yMax) max = opt.yMax;
    if (max <= 0) max = 1;
    let step, top;
    if (opt.yMax) { top = opt.yMax; step = top / 4; }
    else { step = niceStep(max * 1.05, 4); top = Math.ceil((max * 1.05) / step) * step; }
    const x = (i) => padL + (i / (n - 1)) * pw;
    const y = (v) => padT + ph - (v / top) * ph;
    ctx.strokeStyle = tk.line;
    ctx.lineWidth = 1;
    ctx.fillStyle = tk.text3;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= top + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(w - padR, yy); ctx.stroke();
      ctx.fillText(opt.yFmt ? opt.yFmt(v) : String(v), padL - 6, yy);
    }
    /* X 軸：整點時間 */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const span = opt.t[n - 1] - opt.t[0];
    const every = span > 2000 ? 720 : span > 700 ? 240 : span > 300 ? 120 : 60;
    for (let i = 0; i < n; i++) {
      const t = opt.t[i];
      if (t % every === 0) {
        const xx = x(i);
        if (xx < padL + 14 || xx > w - padR - 14) continue;
        ctx.fillText(t % 1440 === 0 ? `D${U.dayOf(t)}` : U.clock(t), xx, h - padB + 5);
        ctx.strokeStyle = tk.line;
        ctx.beginPath(); ctx.moveTo(Math.round(xx) + 0.5, padT); ctx.lineTo(Math.round(xx) + 0.5, padT + ph); ctx.stroke();
      }
    }
    for (const s of opt.series) {
      const col = s.color;
      ctx.setLineDash(s.dash || []);
      ctx.lineWidth = s.width || 1.8;
      ctx.strokeStyle = col;
      ctx.beginPath();
      let started = false, lastI = -1;
      for (let i = 0; i < n; i++) {
        const v = s.data[i];
        if (v === null || v === undefined) { started = false; continue; }
        if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v));
        lastI = i;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.fill) {
        ctx.beginPath();
        let first = -1;
        for (let i = 0; i < n; i++) { const v = s.data[i]; if (v === null || v === undefined) continue; if (first < 0) { first = i; ctx.moveTo(x(i), y(v)); } else ctx.lineTo(x(i), y(v)); }
        if (first >= 0) {
          ctx.lineTo(x(lastI), y(0)); ctx.lineTo(x(first), y(0)); ctx.closePath();
          const g = ctx.createLinearGradient(0, padT, 0, padT + ph);
          g.addColorStop(0, withAlpha(col, 0.28)); g.addColorStop(1, withAlpha(col, 0.02));
          ctx.fillStyle = g; ctx.fill();
        }
      }
      if (lastI >= 0 && !s.dash) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x(lastI), y(s.data[lastI]), 3, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  /** 迷你走勢圖 */
  Charts.spark = (canvas, data, color, maxV) => {
    const { ctx, w, h } = Charts.setup(canvas);
    const vals = data.filter((v) => v !== null && v !== undefined);
    if (vals.length < 2) return;
    const max = maxV || Math.max(...vals, 1e-6);
    const n = data.length;
    const x = (i) => (i / (n - 1)) * (w - 4) + 2;
    const y = (v) => h - 2 - (v / max) * (h - 4);
    ctx.beginPath();
    let started = false, last = -1;
    for (let i = 0; i < n; i++) {
      const v = data[i];
      if (v === null || v === undefined) continue;
      if (!started) { ctx.moveTo(x(i), y(v)); started = true; } else ctx.lineTo(x(i), y(v));
      last = i;
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(x(last), h); ctx.lineTo(x(data.findIndex((v) => v !== null && v !== undefined)), h); ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.15); ctx.fill();
  };
})(window.G = window.G || {});
