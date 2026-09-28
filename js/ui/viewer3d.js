/* 3D 檢視器：可拖曳旋轉、縮放的設備模型，附零件標示；以及採購頁用的縮圖 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, M3 = G.M3;
  const active = new Set();
  const saved = new Map();
  let loopOn = false;

  function loop(now) {
    for (const v of active) {
      if (!v.root.isConnected) { v.dispose(); continue; }
      try { v.frame(now); } catch (e) { console.error(e); v.dispose(); }
    }
    if (active.size) requestAnimationFrame(loop); else loopOn = false;
  }
  function startLoop() { if (!loopOn) { loopOn = true; requestAnimationFrame(loop); } }

  function makeRenderer(canvas, preserve) {
    const T = M3.T();
    const r = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: !!preserve, powerPreference: 'low-power' });
    r.outputEncoding = T.sRGBEncoding;
    r.setClearColor(0x000000, 0);
    M3.setAniso(Math.min(8, r.capabilities.getMaxAnisotropy()));
    return r;
  }
  /** 簡易攝影棚環境光（讓金屬外殼有反光） */
  function makeEnv(renderer) {
    const T = M3.T();
    const pm = new T.PMREMGenerator(renderer);
    const s = new T.Scene();
    const trash = [];
    const add = (geo, color, pos, side) => {
      const mat = new T.MeshBasicMaterial({ color, side: side || T.DoubleSide });
      const m = new T.Mesh(geo, mat);
      if (pos) { m.position.set(pos[0], pos[1], pos[2]); m.lookAt(0, 0, 0); }
      s.add(m); trash.push(geo, mat);
    };
    add(new T.BoxGeometry(12, 12, 12), 0x3a434b, null, T.BackSide);
    add(new T.PlaneGeometry(7, 7), 0xffffff, [0, 5.8, 0]);
    add(new T.PlaneGeometry(4, 5), 0xcfe6ff, [5.8, 1, 2]);
    add(new T.PlaneGeometry(4, 5), 0xffe9d2, [-5.8, 0.5, -1]);
    add(new T.PlaneGeometry(10, 3), 0x6d7880, [0, -5.8, 0]);
    const rt = pm.fromScene(s, 0.035);
    pm.dispose();
    trash.forEach((x) => x.dispose());
    return rt;
  }
  function addLights(scene) {
    const T = M3.T();
    scene.add(new T.HemisphereLight(0xffffff, 0x2a3036, 0.45));
    const key = new T.DirectionalLight(0xffffff, 0.85); key.position.set(3, 6, 5); scene.add(key);
    const fill = new T.DirectionalLight(0xbfdfff, 0.3); fill.position.set(-5, 2, 2); scene.add(fill);
    const back = new T.DirectionalLight(0xffffff, 0.35); back.position.set(0, 3, -6); scene.add(back);
  }
  let shadowTex = null;
  function contactShadow(bbox) {
    const T = M3.T();
    if (!shadowTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.16)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
      shadowTex = new T.CanvasTexture(c);
      shadowTex.m3dShared = true;
    }
    const size = bbox.getSize(new T.Vector3());
    const m = new T.Mesh(new T.PlaneGeometry(size.x * 1.5 + 0.2, size.z * 1.5 + 0.2), new T.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set((bbox.min.x + bbox.max.x) / 2, bbox.min.y - 0.005, (bbox.min.z + bbox.max.z) / 2);
    return m;
  }
  function disposeObj(obj) {
    obj.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) { if (m.map && !m.map.m3dShared) m.map.dispose(); m.dispose(); }
    });
  }
  function camAt(cam, center, dist, yaw, pitch) {
    const cp = Math.cos(pitch);
    cam.position.set(center.x + dist * cp * Math.sin(yaw), center.y + dist * Math.sin(pitch), center.z + dist * cp * Math.cos(yaw));
    cam.near = Math.max(0.001, dist / 200);
    cam.far = dist * 20;
    cam.updateProjectionMatrix();
    cam.lookAt(center);
    cam.updateMatrixWorld();
  }
  /** 讓模型的外框在畫面中佔 fill 比例的攝影機距離（投影外框 8 個角點後迭代修正） */
  function fitDist(cam, f, yaw, pitch, fill) {
    const T = M3.T();
    const vfov = cam.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    let dist = f.radius / Math.sin(Math.min(vfov, hfov) / 2);
    const b = f.bbox, pts = [];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) pts.push(new T.Vector3(x, y, z));
    const tmp = new T.Vector3();
    for (let it = 0; it < 3; it++) {
      camAt(cam, f.center, dist, yaw, pitch);
      let m = 0;
      for (const p of pts) { tmp.copy(p).project(cam); m = Math.max(m, Math.abs(tmp.x), Math.abs(tmp.y)); }
      if (!(m > 0)) break;
      dist *= m / fill;
    }
    return dist;
  }
  function framing(obj) {
    const T = M3.T();
    const bbox = new T.Box3().setFromObject(obj);
    return { bbox, center: bbox.getCenter(new T.Vector3()), radius: bbox.getBoundingSphere(new T.Sphere()).radius };
  }

  /* ---------- 互動檢視器 ---------- */
  M3.viewer = (ids, opts) => {
    opts = opts || {};
    ids = (Array.isArray(ids) ? ids : [ids]).filter((id) => M3.has(id));
    const root = h('div', { class: 'm3d' });
    const stage = h('div', { class: 'm3d-stage', style: { height: (opts.height || 320) + 'px' } });
    const canvas = h('canvas', { 'aria-label': '3D 模型：拖曳旋轉、滾輪縮放' });
    const pins = h('div', { class: 'm3d-pins' });
    const msg = h('div', { class: 'm3d-msg' }, '正在載入 3D 模型…');
    stage.append(canvas, pins, msg);
    const bar = h('div', { class: 'm3d-bar' });
    const cap = h('div', { class: 'm3d-cap' });
    root.append(stage, bar, cap);
    const v = { root, idx: 0, yaw: 0.6, pitch: 0.3, zoom: 1, auto: opts.auto !== false, labels: opts.labels !== false, dragging: false, needs: true, last: 0, idle: 0 };
    if (!ids.length) { msg.textContent = '這個項目沒有 3D 模型'; return root; }

    let tabs = null;
    if (ids.length > 1) {
      tabs = h('div', { class: 'seg' }, ids.map((id, i) => h('button', { class: i === 0 ? 'on' : '', onclick: () => show(i) }, shortName(id))));
      bar.appendChild(tabs);
    }
    const setView = (yaw, pitch) => { v.yaw = yaw; v.pitch = pitch; v.auto = false; autoBtn.classList.remove('on'); v.needs = true; save(); };
    const autoBtn = h('button', { class: 'btn xs' + (v.auto ? ' on' : ''), onclick: () => { v.auto = !v.auto; autoBtn.classList.toggle('on', v.auto); v.idle = 0; v.needs = true; } }, '自動旋轉');
    const lblBtn = h('button', { class: 'btn xs' + (v.labels ? ' on' : ''), onclick: () => { v.labels = !v.labels; lblBtn.classList.toggle('on', v.labels); v.needs = true; } }, '零件標示');
    bar.append(
      h('button', { class: 'btn xs', onclick: () => { if (v.model) setView(v.model.view.yaw, v.model.view.pitch); } }, '斜角'),
      h('button', { class: 'btn xs', onclick: () => setView(0, 0.08) }, '正面'),
      h('button', { class: 'btn xs', onclick: () => setView(Math.PI, 0.08) }, '背面'),
      h('button', { class: 'btn xs', onclick: () => setView(Math.PI / 2, 0.12) }, '側面'),
      autoBtn, lblBtn,
      h('span', { class: 'm3d-hint' }, '拖曳旋轉・滾輪 / 雙指縮放・雙擊重設'));

    function save() { if (v.model) saved.set(ids[v.idx], { yaw: v.yaw, pitch: v.pitch, zoom: v.zoom }); }
    function show(i) {
      const T = M3.T();
      if (!v.renderer) return;
      if (v.model) { v.scene.remove(v.model.obj); disposeObj(v.model.obj); v.model = null; }
      if (v.shadow) { v.scene.remove(v.shadow); disposeObj(v.shadow); v.shadow = null; }
      v.idx = i;
      const id = ids[i];
      try { v.model = M3.build(id); } catch (e) { console.error(e); msg.hidden = false; msg.textContent = '模型建立失敗'; return; }
      v.scene.add(v.model.obj);
      v.model.obj.updateMatrixWorld(true);
      const f = framing(v.model.obj);
      v.fit = f;
      v.center = f.center;
      v.baseDist = fitDist(v.camera, f, v.model.view.yaw, v.model.view.pitch, 0.72);
      v.shadow = contactShadow(f.bbox);
      v.scene.add(v.shadow);
      const sv = saved.get(id);
      v.yaw = sv ? sv.yaw : v.model.view.yaw;
      v.pitch = sv ? sv.pitch : v.model.view.pitch;
      v.zoom = sv ? sv.zoom : 1;
      U.clear(pins);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'm3d-lines');
      const labLayer = h('div', {}), dotLayer = h('div', {});
      pins.append(svg, labLayer, dotLayer);
      v.pinEls = v.model.notes.map((n) => {
        const P = { line: document.createElementNS('http://www.w3.org/2000/svg', 'line'), dot: h('div', { class: 'm3d-dot' }), lab: h('div', { class: 'm3d-lab' }, n.text), w: 0, h: 0, last: null };
        svg.appendChild(P.line); dotLayer.appendChild(P.dot); labLayer.appendChild(P.lab);
        return P;
      });
      if (document.fonts) document.fonts.ready.then(() => { v.pinEls.forEach((P) => { P.w = 0; }); v.needs = true; });
      v.world = v.model.notes.map((n) => v.model.obj.localToWorld(n.p.clone()));
      const b = f.bbox;
      v.corners = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) v.corners.push(new T.Vector3(x, y, z));
      const info = M3.info(id);
      U.mount(cap, h('b', {}, info.name), info.cap ? '　' + info.cap : '');
      if (tabs) Array.from(tabs.children).forEach((b, k) => b.classList.toggle('on', k === i));
      v.idle = performance.now();
      v.needs = true;
    }
    function resize() {
      if (!v.renderer) return;
      const w = Math.max(10, stage.clientWidth), hh = Math.max(10, stage.clientHeight);
      v.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      v.renderer.setSize(w, hh, false);
      v.camera.aspect = w / hh;
      if (v.model && v.fit) v.baseDist = fitDist(v.camera, v.fit, v.model.view.yaw, v.model.view.pitch, 0.72);
      v.needs = true;
    }
    /**
     * 零件標示排版：只顯示面向鏡頭的零件；標籤優先放在模型外框的上下（或左右）空白處，
     * 彼此不重疊，並以引線連回零件。上一幀的位置優先沿用，旋轉時標籤不會亂跳。
     */
    function updatePins() {
      const T = M3.T();
      const W = stage.clientWidth, H = stage.clientHeight;
      const cam = v.camera;
      const tmp = new T.Vector3(), dir = new T.Vector3();
      const hide = (P) => { P.dot.style.display = P.lab.style.display = 'none'; P.line.style.display = 'none'; };
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (const c of v.corners) {
        tmp.copy(c).project(cam);
        const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      }
      bx0 = U.clamp(bx0, 0, W); bx1 = U.clamp(bx1, 0, W); by0 = U.clamp(by0, 0, H); by1 = U.clamp(by1, 0, H);
      const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
      const wide = (bx1 - bx0) / W >= (by1 - by0) / H;
      const vis = [];
      v.model.notes.forEach((n, i) => {
        const P = v.pinEls[i];
        if (!v.labels) return hide(P);
        const wp = v.world[i];
        dir.copy(cam.position).sub(wp);
        if (n.n.dot(dir) <= 0) return hide(P);
        tmp.copy(wp).project(cam);
        const x = (tmp.x + 1) / 2 * W, y = (1 - tmp.y) / 2 * H;
        if (tmp.z > 1 || x < 4 || x > W - 4 || y < 4 || y > H - 4) return hide(P);
        P.dot.style.display = P.lab.style.display = ''; P.line.style.display = '';
        if (!P.w) { P.w = P.lab.offsetWidth; P.h = P.lab.offsetHeight; }
        vis.push({ P, x, y, w: P.w || 120, h: P.h || 20 });
      });
      const placed = vis.map((p) => ({ x: p.x - 7, y: p.y - 7, w: 14, h: 14 }));
      const free = (r) => r.x >= 2 && r.y >= 2 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2 &&
        !placed.some((q) => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 3 && r.y + r.h + 3 > q.y);
      for (const p of vis) {
        const cands = [];
        const vOrd = p.y < cy ? ['t', 'b'] : ['b', 't'], hOrd = p.x < cx ? ['l', 'r'] : ['r', 'l'];
        const sides = wide ? [vOrd[0], vOrd[1], hOrd[0], hOrd[1]] : [hOrd[0], hOrd[1], vOrd[0], vOrd[1]];
        const xs = p.x < cx ? [p.x - p.w + 18, p.x - p.w / 2, p.x - 18] : [p.x - 18, p.x - p.w / 2, p.x - p.w + 18];
        for (const s of sides) {
          for (let k = 0; k < 5; k++) {
            if (s === 't' || s === 'b') {
              const y = s === 't' ? by0 - 12 - p.h - k * (p.h + 5) : by1 + 12 + k * (p.h + 5);
              xs.forEach((x, j) => cands.push({ key: s + k + j, x: U.clamp(x, 4, W - 4 - p.w), y }));
            } else {
              const x = s === 'l' ? bx0 - 16 - p.w : bx1 + 16;
              cands.push({ key: s + k, x, y: U.clamp(p.y - p.h / 2 + [0, -1, 1, -2, 2][k] * (p.h + 5), 4, H - 4 - p.h) });
            }
          }
        }
        [[1, 0], [-1, 0], [1, -1], [1, 1], [-1, -1], [-1, 1], [1, -2], [1, 2], [-1, -2], [-1, 2]].forEach(([sx, sy], j) =>
          cands.push({ key: 'n' + j, near: true, x: sx > 0 ? p.x + 14 : p.x - 14 - p.w, y: p.y - p.h / 2 + sy * (p.h + 6) }));
        if (p.P.last) {
          const k = cands.findIndex((c) => c.key === p.P.last && !c.near);
          if (k > 0) cands.unshift(cands.splice(k, 1)[0]);
        }
        let best = null;
        for (const c of cands) { const r = { x: c.x, y: c.y, w: p.w, h: p.h }; if (free(r)) { best = c; break; } }
        if (!best) best = cands[cands.length - 10];
        p.P.last = best.key;
        const r = { x: best.x, y: best.y, w: p.w, h: p.h };
        placed.push(r);
        const tx = U.clamp(p.x, r.x, r.x + r.w), ty = U.clamp(p.y, r.y, r.y + r.h);
        p.P.dot.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        p.P.lab.style.transform = `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`;
        const L = p.P.line;
        L.setAttribute('x1', p.x.toFixed(1)); L.setAttribute('y1', p.y.toFixed(1));
        L.setAttribute('x2', tx.toFixed(1)); L.setAttribute('y2', ty.toFixed(1));
      }
    }
    v.frame = (now) => {
      const dt = v.last ? Math.min(0.1, (now - v.last) / 1000) : 0;
      v.last = now;
      if (!v.model) return;
      if (v.auto && !v.dragging && now - v.idle > 2500) { v.yaw += dt * 0.32; v.needs = true; }
      if (!v.needs) return;
      v.needs = false;
      camAt(v.camera, v.center, v.baseDist * v.zoom, v.yaw, v.pitch);
      v.renderer.render(v.scene, v.camera);
      updatePins();
    };
    v.dispose = () => {
      active.delete(v);
      root.m3dDead = true;
      if (v.ro) v.ro.disconnect();
      if (v.model) disposeObj(v.model.obj);
      if (v.shadow) disposeObj(v.shadow);
      if (v.env) v.env.dispose();
      if (v.renderer) { v.renderer.dispose(); v.renderer.forceContextLoss(); v.renderer = null; }
    };
    function bind() {
      const ptrs = new Map();
      stage.addEventListener('pointerdown', (e) => {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        v.dragging = true; v.idle = performance.now();
      });
      stage.addEventListener('pointermove', (e) => {
        const p = ptrs.get(e.pointerId);
        if (!p) return;
        if (ptrs.size === 1) {
          v.yaw -= (e.clientX - p.x) * 0.009;
          v.pitch = U.clamp(v.pitch + (e.clientY - p.y) * 0.007, -1.35, 1.45);
        } else if (ptrs.size === 2) {
          const other = Array.from(ptrs.entries()).find(([k]) => k !== e.pointerId)[1];
          const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(e.clientX - other.x, e.clientY - other.y);
          if (d0 > 0 && d1 > 0) v.zoom = U.clamp(v.zoom * d0 / d1, 0.2, 3);
        }
        p.x = e.clientX; p.y = e.clientY;
        v.needs = true; v.idle = performance.now();
      });
      const up = (e) => { ptrs.delete(e.pointerId); if (!ptrs.size) { v.dragging = false; save(); } };
      stage.addEventListener('pointerup', up);
      stage.addEventListener('pointercancel', up);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        v.zoom = U.clamp(v.zoom * Math.exp(e.deltaY * 0.0012), 0.2, 3);
        v.needs = true; v.idle = performance.now(); save();
      }, { passive: false });
      stage.addEventListener('dblclick', () => {
        if (!v.model) return;
        v.yaw = v.model.view.yaw; v.pitch = v.model.view.pitch; v.zoom = 1;
        v.needs = true; save();
      });
    }
    M3.load().then(() => {
      const T = M3.T();
      try { v.renderer = makeRenderer(canvas, false); } catch (e) { msg.textContent = '這個瀏覽器無法使用 WebGL，所以看不到 3D 模型。'; return; }
      v.env = makeEnv(v.renderer);
      v.scene = new T.Scene();
      v.scene.environment = v.env.texture;
      addLights(v.scene);
      v.camera = new T.PerspectiveCamera(30, 1, 0.01, 1000);
      msg.hidden = true;
      bind();
      if (window.ResizeObserver) { v.ro = new ResizeObserver(() => resize()); v.ro.observe(stage); }
      resize();
      show(0);
      active.add(v);
      startLoop();
    }).catch((e) => { msg.textContent = '無法載入 3D 模型：' + e.message; });
    return root;
  };
  function shortName(id) {
    const n = M3.info(id).name;
    return n.replace(/（.*?）/g, '').replace(/\s*\(.*?\)/g, '').split(' ').slice(0, 2).join(' ');
  }

  /** 以對話框開啟 3D 檢視 */
  M3.open = (ids, title) => {
    ids = (Array.isArray(ids) ? ids : [ids]).filter((id) => M3.has(id));
    if (!ids.length) return;
    const hgt = Math.round(U.clamp(window.innerHeight * 0.52, 240, 480));
    G.UI.modal({ kicker: '3D 模型', title: title || M3.info(ids[0]).name, wide: true, body: M3.viewer(ids, { height: hgt }) });
  };

  /* ---------- 縮圖（共用一個離屏渲染器） ---------- */
  const thumbs = new Map();
  let tq = Promise.resolve(), TR = null;
  M3.thumb = (id) => {
    if (thumbs.has(id)) return Promise.resolve(thumbs.get(id));
    const p = tq.then(() => M3.load()).then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
      if (thumbs.has(id)) return thumbs.get(id);
      const T = M3.T();
      if (!TR) {
        const c = document.createElement('canvas');
        const renderer = makeRenderer(c, true);
        renderer.setPixelRatio(1);
        renderer.setSize(480, 300, false);
        const scene = new T.Scene();
        TR = { renderer, env: makeEnv(renderer), scene, camera: new T.PerspectiveCamera(30, 480 / 300, 0.01, 1000) };
        scene.environment = TR.env.texture;
        addLights(scene);
      }
      const b = M3.build(id);
      b.obj.updateMatrixWorld(true);
      const f = framing(b.obj);
      const sh = contactShadow(f.bbox);
      TR.scene.add(b.obj, sh);
      camAt(TR.camera, f.center, fitDist(TR.camera, f, b.view.yaw, b.view.pitch, 0.86), b.view.yaw, b.view.pitch);
      TR.renderer.render(TR.scene, TR.camera);
      const url = TR.renderer.domElement.toDataURL('image/png');
      TR.scene.remove(b.obj, sh);
      disposeObj(b.obj); disposeObj(sh);
      thumbs.set(id, url);
      return url;
    });
    tq = p.catch(() => {});
    return p;
  };
  /** 採購卡片用的縮圖按鈕：點擊開啟 3D 檢視 */
  M3.thumbButton = (id, title) => {
    const img = h('img', { alt: `${title} 的 3D 模型` });
    const b = h('button', { class: 'm3d-thumb loading', type: 'button', title: '查看 3D 模型', onclick: () => M3.open([id], title) }, img, h('span', { class: 'm3d-badge' }, '3D'));
    M3.thumb(id).then((url) => { img.src = url; b.classList.remove('loading'); }).catch(() => { b.classList.remove('loading'); b.classList.add('failed'); });
    return b;
  };
})(window.G = window.G || {});
