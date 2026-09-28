/* 3D 特效工具：發光粒子、折線路徑、冷熱氣流
 * 3D 機房、3D 大樓與知識庫動畫共用。粒子用自訂 shader，每個點有自己的顏色、透明度與大小。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  const fx = M3.fx = {};

  /** 目前是否為深色主題（深色背景用加法混色的發光效果，淺色背景用一般混色） */
  fx.isDark = () => U.isDark();
  /* 切換明暗主題時，已經在畫面上的粒子也跟著換混色方式 */
  const liveMats = new Set();
  G.bus.on('theme', () => {
    const T = M3.T();
    if (!T) return;
    const add = fx.isDark();
    for (const m of liveMats) { m.blending = add ? T.AdditiveBlending : T.NormalBlending; m.needsUpdate = true; }
  });
  /** '#rrggbb' → [r, g, b]（0～1，sRGB） */
  fx.rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  fx.mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  let dot = null;
  fx.dotTex = () => {
    if (dot) return dot;
    const T = M3.T();
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    dot = new T.CanvasTexture(c);
    dot.m3dShared = true;
    return dot;
  };

  /* 太靠近鏡頭的粒子淡出，並限制最大尺寸，避免拉近時遮住畫面 */
  const VS = [
    'attribute vec4 rgba; attribute float size; varying vec4 vC; uniform float scale;',
    'void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;',
    '  vC = vec4(rgba.rgb, rgba.a * clamp((d - size * 4.0) / (size * 8.0), 0.0, 1.0));',
    '  gl_PointSize = clamp(size * scale / d, 1.5, 40.0); gl_Position = projectionMatrix * mv; }',
  ].join('\n');
  const FS = [
    'uniform sampler2D map; varying vec4 vC;',
    'void main() { float a = vC.a * texture2D(map, gl_PointCoord).a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }',
  ].join('\n');

  /**
   * 粒子池：n 個點，每幀 begin() → push(...) → end()。
   * size 是世界座標的直徑（會隨距離縮放）。顏色為 sRGB 0～1。
   */
  fx.points = (n, size, opts) => {
    const T = M3.T();
    opts = opts || {};
    const pos = new Float32Array(n * 3), rgba = new Float32Array(n * 4), sz = new Float32Array(n);
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(pos, 3));
    geo.setAttribute('rgba', new T.BufferAttribute(rgba, 4));
    geo.setAttribute('size', new T.BufferAttribute(sz, 1));
    geo.setDrawRange(0, 0);
    const additive = opts.additive !== undefined ? opts.additive : fx.isDark();
    const mat = new T.ShaderMaterial({
      uniforms: { map: { value: fx.dotTex() }, scale: { value: 300 } },
      vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, depthTest: opts.depthTest !== false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
    });
    if (opts.additive === undefined) {
      liveMats.add(mat);
      mat.addEventListener('dispose', () => liveMats.delete(mat));
    }
    const obj = new T.Points(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = opts.order || 5;
    const tmp = new T.Vector2();
    obj.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(tmp);
      mat.uniforms.scale.value = tmp.y / (2 * Math.tan(camera.fov * Math.PI / 360));
    };
    let k = 0;
    return {
      obj, n,
      begin() { k = 0; },
      /** c = [r, g, b]（0～1），a = 透明度，s = 大小倍率 */
      push(x, y, z, c, a, s) {
        if (k >= n) return false;
        const i = k * 3, j = k * 4;
        pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
        rgba[j] = c[0]; rgba[j + 1] = c[1]; rgba[j + 2] = c[2]; rgba[j + 3] = a;
        sz[k] = size * (s || 1);
        k++;
        return true;
      },
      end() {
        geo.setDrawRange(0, k);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.rgba.needsUpdate = true;
        geo.attributes.size.needsUpdate = true;
      },
    };
  };

  /**
   * 粒子發射器（火花、煙、熱浪）：emit(pos, opts) 產生一顆粒子，tick(dt) 更新並繪製。
   * opts：{ v:[vx,vy,vz], spread, life, g（重力）, c0, c1（顏色 0→1）, s0, s1（大小倍率）, a（透明度） }
   */
  fx.emitter = (n, size) => {
    const P = fx.points(n, size);
    const parts = [];
    const c = [0, 0, 0];
    return {
      obj: P.obj,
      emit(p, o) {
        if (parts.length >= n) parts.shift();
        const sp = o.spread || 0, v = o.v || [0, 0, 0];
        parts.push({ x: p[0], y: p[1], z: p[2], vx: v[0] + (Math.random() - 0.5) * sp, vy: v[1] + (Math.random() - 0.5) * sp, vz: v[2] + (Math.random() - 0.5) * sp,
          t: 0, life: (o.life || 1) * (0.7 + Math.random() * 0.6), g: o.g || 0, c0: o.c0, c1: o.c1 || o.c0, s0: o.s0 || 1, s1: o.s1 === undefined ? (o.s0 || 1) : o.s1, a: o.a === undefined ? 1 : o.a });
      },
      /** 依速率（每秒幾顆）持續發射：回傳本幀要發幾顆 */
      rate(state, key, perSec, dt) {
        state[key] = (state[key] || 0) + perSec * dt;
        const k = Math.floor(state[key]);
        state[key] -= k;
        return k;
      },
      tick(dt) {
        P.begin();
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i];
          q.t += dt / q.life;
          if (q.t >= 1) { parts.splice(i, 1); continue; }
          q.vy -= q.g * dt;
          q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
          for (let k = 0; k < 3; k++) c[k] = q.c0[k] + (q.c1[k] - q.c0[k]) * q.t;
          P.push(q.x, q.y, q.z, c, q.a * Math.min(1, q.t / 0.08) * (1 - q.t), q.s0 + (q.s1 - q.s0) * q.t);
        }
        P.end();
      },
    };
  };

  /** 折線路徑：依長度比例取點（t = 0～1） */
  fx.path = (pts) => {
    const P = pts.map((p) => (Array.isArray(p) ? p : [p.x, p.y, p.z]));
    const L = [0];
    for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1], P[i][2] - P[i - 1][2]));
    const len = L[L.length - 1] || 1e-6;
    return {
      pts: P, len,
      at(t, out) {
        out = out || [0, 0, 0];
        const d = U.clamp(t, 0, 1) * len;
        let i = 1;
        while (i < L.length - 1 && L[i] < d) i++;
        const seg = L[i] - L[i - 1] || 1e-6, f = (d - L[i - 1]) / seg;
        const a = P[i - 1], b = P[i];
        out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
        return out;
      },
    };
  };

  /** 沿折線的圓管（直角轉折，適合線槽與豎井裡的線路） */
  fx.tubeAlong = (pts, r, mat, radial) => {
    const T = M3.T();
    const cp = new T.CurvePath();
    let n = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = new T.Vector3(...pts[i - 1]), b = new T.Vector3(...pts[i]);
      if (a.distanceTo(b) < 1e-4) continue;
      cp.add(new T.LineCurve3(a, b));
      n += Math.max(2, Math.ceil(a.distanceTo(b) / (r * 6)));
    }
    return new T.Mesh(new T.TubeGeometry(cp, Math.min(600, Math.max(8, n)), r, radial || 6, false), mat);
  };

  /**
   * 冷熱通道氣流：
   *   racks() → [{ x, y0, y1, front, back, dir, heat(0～1), on }]（dir = 機櫃正面朝向 +z 為 1、-z 為 -1）
   *   cooling() → 0～1（冷氣是否運轉、冷卻是否足夠）；warm() → 0～1（機房越熱、熱風越紅）
   */
  fx.airflow = (opts) => {
    const P = fx.points(opts.n || 420, opts.size || 0.9);
    const parts = [];
    const COLD = fx.rgb('#5fc4ff'), HOT0 = fx.rgb('#ffb04f'), HOT1 = fx.rgb('#ff3b30');
    let acc = 0;
    const tmp = [0, 0, 0];
    const bez = (p, t, o) => {
      const u = 1 - t;
      for (let i = 0; i < 3; i++) o[i] = u * u * p[0][i] + 2 * u * t * p[1][i] + t * t * p[2][i];
      return o;
    };
    return {
      obj: P.obj,
      tick(dt) {
        const racks = opts.racks();
        const cool = opts.cooling(), warm = opts.warm();
        const ceil = opts.ceil || 26;
        acc += dt;
        const steps = Math.min(6, Math.floor(acc / 0.05));
        acc -= steps * 0.05;
        for (let s = 0; s < steps; s++) {
          for (const r of racks) {
            if (cool > 0 && Math.random() < 0.55 * cool) {
              const x = r.x + U.rand(-2.3, 2.3), y = U.rand(r.y0 + 0.6, r.y1);
              parts.push({ hot: false, t: 0, life: U.rand(1.6, 2.4), p: [[x + U.rand(-1, 1), 0.3, r.front + r.dir * U.rand(3, 5.5)], [x, y * 0.35, r.front + r.dir * U.rand(2, 3)], [x, y, r.front + r.dir * 0.3]] });
            }
            if (r.on && r.heat > 0 && Math.random() < 0.18 + r.heat * 0.7) {
              const x = r.x + U.rand(-2.2, 2.2), y = U.rand(r.y0 + 0.6, r.y1);
              parts.push({ hot: true, t: 0, life: U.rand(1.8, 2.8), p: [[x, y, r.back - r.dir * 0.2], [x, y + U.rand(1, 3), r.back - r.dir * U.rand(2.5, 4)], [x + U.rand(-1.5, 1.5), ceil, r.back - r.dir * U.rand(3.5, 6)]] });
            }
          }
        }
        while (parts.length > P.n) parts.shift();
        P.begin();
        const hot = fx.mix(HOT0, HOT1, U.clamp(warm, 0, 1));
        const am = opts.alpha ? opts.alpha() : 1;
        for (let i = parts.length - 1; i >= 0; i--) {
          const q = parts[i];
          q.t += dt / q.life;
          if (q.t >= 1) { parts.splice(i, 1); continue; }
          bez(q.p, q.t, tmp);
          const a = Math.min(1, q.t / 0.15) * Math.min(1, (1 - q.t) / 0.3);
          if (am > 0.02) P.push(tmp[0], tmp[1], tmp[2], q.hot ? hot : COLD, a * am * (q.hot ? 0.75 : 0.85));
        }
        P.end();
      },
    };
  };
})(window.G = window.G || {});
