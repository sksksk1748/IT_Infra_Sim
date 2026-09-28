/* 3D 大樓剖面：21 層樓 + B1 機房、弱電豎井裡的主幹線、ISP 進線、即時流量與駭客攻擊路徑
 * 單位：公尺。窗戶亮燈 = 進駐人數、顏色 = 滿意度；線上的光點 = 流量（越多越滿）；紅色 = 中斷或攻擊。
 * 攻擊路徑只顯示「已偵測到」的資安事件，並沿著模擬中實際的路由（ISP → 路由器 → 防火牆 → 核心 → 樓層）移動。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q, M3 = G.M3;
  const W = 46, D = 22, FH = 4.2, NF = 21, B1 = -5;
  const RX = W / 2 - 3.2, RZ = D / 2 - 3.2;
  const CLOUD = [-40, 60, 16];
  const RACKZ = -D / 2 + 2.3, RACKF = RACKZ + 1.1;
  const HEX = { ok: '#46d17f', warn: '#f0a63a', bad: '#f25f5c', info: '#5aa9f0', none: '#6b808b' };
  const PANES = [];

  /** opts: { height, onFloor(fid), onRack(), onDev(id), onTopo(), onInc() } */
  M3.tower = (opts) => M3.stage({ height: opts.height, label: '3D 大樓剖面', fov: 32, pitchMin: -0.3, create: (api) => createTower(api, opts) });

  const yOf = (level) => (level - 1) * FH;
  const idfPt = (level) => [RX - 2.9, yOf(level) + 1.65, RZ];
  const lane = (k) => [((k % 7) - 3) * 0.5, ((Math.floor(k / 7) % 6) - 2.5) * 0.5];
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const seatPt = (fid) => { const f = G.BLD.byId[fid], k = f.level * 7.3; return [-W / 2 + 5 + hash(k) * (W - 18), yOf(f.level) + 1.3, -D / 2 + 3 + hash(k + 1) * (D - 9)]; };
  const rev = (a) => a.slice().reverse();

  /* 窗戶位置（前後各 14 扇、左右各 6 扇；右前角是弱電豎井，保持透明） */
  (function () {
    for (let i = 0; i < 14; i++) {
      const x = -W / 2 + 1.8 + (i + 0.5) * (W - 3.6) / 14;
      if (x < RX - 4.2) PANES.push({ x, z: D / 2 + 0.06, ry: 0 });
      PANES.push({ x, z: -D / 2 - 0.06, ry: Math.PI });
    }
    for (let j = 0; j < 6; j++) {
      const z = -D / 2 + 1.6 + (j + 0.5) * (D - 3.2) / 6;
      if (z < RZ - 3.2) PANES.push({ x: W / 2 + 0.06, z, ry: Math.PI / 2 });
      PANES.push({ x: -W / 2 - 0.06, z, ry: -Math.PI / 2 });
    }
  })();

  function createTower(api, opts) {
    const T = api.T, K = M3.kit, fx = M3.fx;
    const root = new T.Group();
    const V = (a) => new T.Vector3(a[0], a[1], a[2]);
    const C = (hex) => K.col(hex);
    const matCache = new Map();
    const lineMat = (hex, op) => {
      const k = hex + op;
      if (!matCache.has(k)) matCache.set(k, K.std(hex, op < 1 ? { transparent: true, opacity: op, depthWrite: false, roughness: 0.5, metalness: 0.1 } : { roughness: 0.45, metalness: 0.15, emissive: C(hex), emissiveIntensity: 0.18 }));
      return matCache.get(k);
    };

    /* ---------- 地面剖面 ---------- */
    const earthT = K.makeTex(400, 140, (c) => {
      K.D.rect(c, 0, 0, 400, 140, '#3a2f27');
      for (let i = 0; i < 9; i++) K.D.rect(c, 0, 14 + i * 14 + hash(i) * 6, 400, 1.2, 'rgba(0,0,0,0.25)');
      K.D.rect(c, 0, 0, 400, 5, '#56646c');
    }, 2);
    earthT.wrapS = T.RepeatWrapping;
    const earthM = K.texMat(earthT, { metalness: 0, roughness: 0.95 });
    const secL = K.plane(90 - W / 2, 7, earthM); secL.position.set(-(90 + W / 2) / 2, -3.5, D / 2); root.add(secL);
    const secR = K.plane(90 - W / 2, 7, earthM); secR.position.set((90 + W / 2) / 2, -3.5, D / 2); root.add(secR);
    const secB = K.plane(W, 1.6, K.std('#3a2f27', { roughness: 0.95 })); secB.position.set(0, -6.2, D / 2); root.add(secB);
    const gs = new T.Shape();
    [[-90, 70], [90, 70], [90, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, -D / 2], [-90, -D / 2]].forEach(([x, y], i) => (i ? gs.lineTo(x, y) : gs.moveTo(x, y)));
    const ground = new T.Mesh(new T.ShapeGeometry(gs), K.std('#27313a', { roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    root.add(ground);

    /* ---------- B1 機房 ---------- */
    const concrete = K.std('#39434b', { roughness: 0.9, metalness: 0.05 });
    const b1Pick = new T.Group();
    b1Pick.userData.pick = { kind: 'b1' };
    const b1Floor = K.box(W, 0.4, D, concrete); b1Floor.position.set(0, B1 - 0.2, 0); b1Pick.add(b1Floor);
    const b1Back = K.plane(W, 5, K.std('#2b353d', { roughness: 0.9 })); b1Back.position.set(0, B1 + 2.5, -D / 2); b1Pick.add(b1Back);
    const b1L = K.plane(D, 5, K.std('#2b353d', { roughness: 0.9 })); b1L.rotation.y = Math.PI / 2; b1L.position.set(-W / 2, B1 + 2.5, 0); b1Pick.add(b1L);
    const b1R = K.plane(D, 5, K.std('#2b353d', { roughness: 0.9 })); b1R.rotation.y = -Math.PI / 2; b1R.position.set(W / 2, B1 + 2.5, 0); b1Pick.add(b1R);
    root.add(b1Pick);

    /* ---------- 樓層 ---------- */
    const slabG = new T.BoxGeometry(W + 0.5, 0.35, D + 0.5);
    const glassG = new T.BoxGeometry(W, FH - 0.35, D);
    const edgeG = new T.EdgesGeometry(glassG);
    const glassM = K.std('#8fb8d4', { transparent: true, opacity: 0.07, roughness: 0.12, metalness: 0.2, depthWrite: false });
    const edgeM = new T.LineBasicMaterial({ color: C('#5c7686'), transparent: true, opacity: 0.5 });
    const floors = [];
    for (const f of G.BLD.floors) {
      const y = yOf(f.level);
      const slab = new T.Mesh(slabG, concrete);
      slab.position.set(0, y + 0.175, 0);
      slab.userData.pick = { kind: 'floor', id: f.id };
      root.add(slab);
      const glass = new T.Mesh(glassG, glassM);
      glass.position.set(0, y + 0.35 + (FH - 0.35) / 2, 0);
      glass.renderOrder = 2;
      root.add(glass);
      const edges = new T.LineSegments(edgeG, edgeM);
      edges.position.copy(glass.position);
      root.add(edges);
      const idf = new T.Group();
      const body = K.box(1.0, 2.2, 0.9, K.std('#1b2126', { metalness: 0.4 }));
      idf.add(body);
      const led = new T.Mesh(new T.PlaneGeometry(0.7, 0.14), new T.MeshBasicMaterial({ color: C(HEX.none) }));
      led.position.set(0, 0.8, 0.46);
      idf.add(led);
      idf.position.set(RX - 3.4, y + 0.35 + 1.1, RZ);
      idf.userData.pick = { kind: 'floor', id: f.id };
      root.add(idf);
      const tag = api.tag(f.id, '', 'right', 1, true);
      tag.pos.set(-W / 2 - 1, y + FH / 2, D / 2);
      floors.push({ f, y, slab, glass, idf, led, tag, col: HEX.none, lit: 0 });
    }
    const roof = K.box(W + 0.8, 0.6, D + 0.8, concrete); roof.position.set(0, NF * FH + 0.3, 0); root.add(roof);
    const mast = K.cylY(0.18, 9, K.std('#8f989f', { metalness: 0.7 }), 10); mast.position.set(-W / 2 + 8, NF * FH + 5, -D / 2 + 5); root.add(mast);
    const beacon = new T.Mesh(new T.SphereGeometry(0.45, 12, 10), K.glow('#ff5a4f', 2)); beacon.position.set(-W / 2 + 8, NF * FH + 9.6, -D / 2 + 5); root.add(beacon);
    const logoT = K.makeTex(700, 120, (c) => { K.D.rect(c, 0, 0, 700, 120, '#10171c'); K.D.txt(c, 'NOVALUX', 350, 64, 84, '#dce7ec', 'center', 800); }, 1.5);
    const logo = K.plane(14, 2.4, K.texMat(logoT, { metalness: 0, roughness: 0.5, emissive: C('#ffffff'), emissiveIntensity: 0.15 }));
    logo.position.set(-6, NF * FH + 2, D / 2 + 0.45);
    root.add(logo);

    /* 窗戶（一個 InstancedMesh） */
    const per = PANES.length;
    const win = new T.InstancedMesh(new T.PlaneGeometry(2.3, 2.5), new T.MeshBasicMaterial({ color: 0xffffff }), per * NF);
    const dummy = new T.Object3D();
    const DARK = C('#1a2733'), tmpC = new T.Color();
    floors.forEach((fl, L) => {
      PANES.forEach((p, i) => {
        dummy.position.set(p.x, fl.y + 0.35 + 1.95, p.z);
        dummy.rotation.set(0, p.ry, 0);
        dummy.updateMatrix();
        win.setMatrixAt(L * per + i, dummy.matrix);
        win.setColorAt(L * per + i, DARK);
      });
      fl.order = PANES.map((p, i) => i).sort((a, b) => hash(L * 131 + a) - hash(L * 131 + b));
    });
    win.userData.pick = { kind: 'pane' };
    root.add(win);

    /* 弱電豎井 */
    const shaftH = NF * FH - B1;
    const shaft = K.box(4.4, shaftH, 4.4, K.std('#2fc6b8', { transparent: true, opacity: 0.06, depthWrite: false, roughness: 0.3 }));
    shaft.position.set(RX, B1 + shaftH / 2, RZ);
    root.add(shaft);
    const shaftE = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(4.4, shaftH, 4.4)), new T.LineBasicMaterial({ color: C('#2fc6b8'), transparent: true, opacity: 0.45 }));
    shaftE.position.copy(shaft.position);
    root.add(shaftE);
    const shaftTag = api.tag('弱電豎井（主幹線）', 'info');
    shaftTag.pos.set(RX, NF * FH + 2.2, RZ);

    /* 網際網路（雲） */
    const cloud = new T.Group();
    const cloudM = K.std('#e8f2f8', { roughness: 0.9, metalness: 0, emissive: C('#9fc6e0'), emissiveIntensity: 0.25 });
    [[0, 0, 0, 5], [-5.5, -1.2, 0.5, 3.8], [5.5, -1.4, -0.3, 3.9], [-2.4, 2.6, 0, 3.6], [2.8, 2.2, 0.4, 3.4], [0, -1.8, 2.2, 3.4]].forEach(([x, y, z, r]) => {
      const s = new T.Mesh(new T.SphereGeometry(r, 20, 14), cloudM);
      s.position.set(x, y, z);
      cloud.add(s);
    });
    cloud.position.set(CLOUD[0], CLOUD[1], CLOUD[2]);
    cloud.userData.pick = { kind: 'inet' };
    root.add(cloud);
    const inetTag = api.tag('網際網路', 'info');
    inetTag.pos.set(CLOUD[0], CLOUD[1] + 8.5, CLOUD[2]);
    const hh = K.box(2.2, 0.5, 1.6, K.std('#59636b', { metalness: 0.4 }));
    hh.position.set(-W / 2 - 8, 0.25, D / 2 + 0.2);
    root.add(hh);
    const ispTag = api.tag('ISP 專線進線', 'info');
    ispTag.pos.set(-W / 2 - 8, 3, D / 2 + 0.3);
    const b1Tag = api.tag('B1 主機房', 'info', 'left');
    b1Tag.pos.set(-W / 2 + 1, B1 + 4.3, D / 2);
    /* 預設取景：大樓 + 雲（不含大片地面） */
    const frameBox = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ visible: false }));
    frameBox.scale.set(W / 2 + 52, NF * FH + 18, D / 2 + 24);
    frameBox.position.set((W / 2 - 52) / 2, (NF * FH + 10 - 8) / 2, (24 - D / 2) / 2);
    frameBox.raycast = () => {};
    root.add(frameBox);

    /* ---------- 動態：MDF 機櫃、主幹線、ISP、攻擊 ---------- */
    const mdfG = new T.Group(), cableG = new T.Group(), ispG = new T.Group(), atkG = new T.Group();
    root.add(mdfG, cableG, ispG, atkG);
    const P = fx.points(1600, 1.1);
    root.add(P.obj);
    const stripM = {};
    const stripMat = (hex) => stripM[hex] || (stripM[hex] = new T.MeshBasicMaterial({ color: C(hex) }));
    let devPts = new Map(), strips = [], cables = new Map(), isps = new Map(), atks = [], alertFloors = new Map(), marks = [];
    let sigM = '', sigC = '', sigI = '', sigA = '';
    const rackX = (i) => -W / 2 + 8 + i * 3.1;
    const devPt = (id) => devPts.get(id) || [0, B1 + 2.5, RACKF + 0.5];
    const clearG = (g) => {
      for (const o of g.children.slice()) {
        g.remove(o);
        o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.userData.ownMat && x.material) x.material.dispose(); });
      }
    };

    function buildMdf() {
      const s = G.S;
      clearG(mdfG);
      devPts = new Map();
      strips = [];
      const bodyM = K.std('#161a1e', { metalness: 0.4, roughness: 0.5 });
      s.racks.forEach((r, i) => {
        const x = rackX(i);
        const body = K.box(1.3, 3.9, 2.2, bodyM);
        body.position.set(x, B1 + 1.95, RACKZ);
        body.userData.pick = { kind: 'rack', id: r.id };
        mdfG.add(body);
      });
      for (const d of Object.values(s.devices)) {
        if (!d.rack) continue;
        const i = s.racks.findIndex((r) => r.id === d.rack);
        if (i < 0) continue;
        const m = CAT.devices[d.model];
        const hgt = m.u / 42 * 3.6;
        const y = B1 + 0.15 + ((d.u - 1) / 42) * 3.6 + hgt / 2;
        const st = new T.Mesh(new T.PlaneGeometry(1.05, Math.max(0.05, hgt - 0.025)), stripMat('#20262b'));
        st.position.set(rackX(i), y, RACKF + 0.02);
        st.userData.pick = { kind: 'dev', id: d.id };
        mdfG.add(st);
        strips.push({ id: d.id, st, blink: 0 });
        devPts.set(d.id, [rackX(i), y, RACKF + 0.08]);
      }
      let z = D / 2 - 2.5;
      for (const r of s.room) {
        const m = CAT.room[r.model];
        if (m.kind === 'generator') continue;
        const cool = m.kind === 'cooling';
        const w = r.model === 'CRAC-60' ? 3.4 : r.model === 'AC-8' ? 1.2 : 1.8;
        const b = K.box(1.6, cool ? (r.model === 'AC-8' ? 1 : 3.4) : 3.4, w, K.std(cool ? '#dfe3e6' : '#1c2126', { roughness: 0.6 }));
        b.position.set(-W / 2 + 1.1, r.model === 'AC-8' ? B1 + 4 : B1 + 1.7, z - w / 2);
        b.userData.pick = { kind: 'b1' };
        b.userData.ownMat = true;
        mdfG.add(b);
        z -= w + 0.8;
      }
    }
    function cablePts(L, k, dp) {
      const [lx, lz] = lane(k);
      const yf = yOf(L) + 1.65, yc = B1 + 4.35 - (k % 4) * 0.12;
      const pts = [idfPt(L), [RX + lx, yf, RZ + lz], [RX + lx, yc, RZ + lz], [RX + lx, yc, RACKF + 1.6 + lz * 0.3]];
      const x = (dp ? dp[0] : 0) + lx * 0.2;
      pts.push([x, yc, RACKF + 1.6 + lz * 0.3], [x, yc, RACKF + 0.45], dp ? [x, dp[1], RACKF + 0.1] : [x, B1 + 2.5, RACKF + 0.45]);
      return pts;
    }
    function buildCables() {
      const s = G.S;
      clearG(cableG);
      cables = new Map();
      const links = Object.values(s.links).filter((l) => l.a.startsWith('F:') || l.b.startsWith('F:'));
      links.sort((a, b) => G.BLD.byId[(a.a.startsWith('F:') ? a.a : a.b).slice(2)].level - G.BLD.byId[(b.a.startsWith('F:') ? b.a : b.b).slice(2)].level || a.id.localeCompare(b.id));
      links.forEach((l, k) => {
        const fn = l.a.startsWith('F:') ? l.a : l.b, other = Q.other(l, fn);
        const f = G.BLD.byId[fn.slice(2)];
        const pts = cablePts(f.level, k, devPts.get(other));
        const mesh = fx.tubeAlong(pts, 0.17, lineMat(CAT.cables[l.cable].color, 1));
        mesh.userData.pick = { kind: 'link', id: l.id };
        cableG.add(mesh);
        const cb = { l, fid: f.id, pts, path: fx.path(pts), mesh, dn: 0, up: 0, on: true };
        cableCols(cb);
        cables.set(l.id, cb);
      });
    }
    /* 流量光點的顏色：深色背景用亮色，淺色背景改用較深的顏色才看得到 */
    let dark = fx.isDark();
    const palette = () => ({ ispD: fx.rgb(dark ? '#ffe08a' : '#b87800'), ispU: fx.rgb(dark ? '#f2c14e' : '#8a5a00'), hot: fx.rgb(dark ? '#ffb13b' : '#d45d00') });
    let PAL = palette();
    function cableCols(cb) {
      const base = fx.rgb(CAT.cables[cb.l.cable].color);
      cb.c1 = dark ? fx.mix(base, [1, 1, 1], 0.5) : fx.mix(base, [0, 0, 0], 0.15);
      cb.c2 = dark ? base : fx.mix(base, [0, 0, 0], 0.35);
    }
    const offTheme = G.bus.on('theme', () => { dark = fx.isDark(); PAL = palette(); for (const cb of cables.values()) cableCols(cb); });
    function buildIsps() {
      const s = G.S;
      clearG(ispG);
      isps = new Map();
      s.isp.forEach((c, i) => {
        const ox = i * 0.9, oy = i * 0.35;
        const sky = new T.CatmullRomCurve3([V([CLOUD[0] + ox, CLOUD[1] - 4.5, CLOUD[2]]), V([CLOUD[0] + 4 + ox, 30, (CLOUD[2] + D / 2) / 2 + 1]), V([-W / 2 - 10 + ox * 0.3, 7, D / 2 + 0.3]), V([-W / 2 - 8 + ox * 0.3, 0.5, D / 2 + 0.3])]).getPoints(28).map((p) => [p.x, p.y, p.z]);
        const rp = c.router && devPts.get(c.router);
        const yc = B1 + 4.55 - oy * 0.3;
        const ground = [[-W / 2 - 8 + ox * 0.3, 0.5, D / 2 + 0.3], [-W / 2 - 8 + ox * 0.3, -2.2 - oy, D / 2 + 0.15], [-W / 2 - 0.2, -2.2 - oy, D / 2 + 0.15], [-W / 2 + 0.8 + ox * 0.2, yc, D / 2 - 1.5 - oy], [rp ? rp[0] + 0.25 : -W / 2 + 6, yc, D / 2 - 1.5 - oy]];
        if (rp) ground.push([rp[0] + 0.25, yc, RACKF + 0.5], [rp[0] + 0.25, rp[1], RACKF + 0.1]);
        const pts = sky.concat(ground.slice(1));
        const mesh = fx.tubeAlong(pts, 0.2, lineMat('#f2c14e', 1));
        mesh.userData.pick = { kind: 'isp', id: c.id };
        ispG.add(mesh);
        isps.set(c.id, { c, sky, ground, pts, path: fx.path(pts), mesh, dn: 0, up: 0, on: false });
      });
    }

    /* 攻擊路徑：依模擬中實際的路由節點產生座標 */
    const kind = (n) => (n === 'INET' ? 'inet' : n.startsWith('isp:') ? 'isp' : n.startsWith('F:') ? 'floor' : 'dev');
    function segPts(a, b) {
      const ka = kind(a), kb = kind(b);
      if (ka === 'inet' && kb === 'isp') { const x = isps.get(b.slice(4)); return x ? x.sky : [CLOUD]; }
      if (ka === 'isp' && kb === 'inet') { const x = isps.get(a.slice(4)); return x ? rev(x.sky) : [CLOUD]; }
      if (ka === 'isp') { const x = isps.get(a.slice(4)); return x ? x.ground.concat([devPt(b)]) : [devPt(b)]; }
      if (kb === 'isp') { const x = isps.get(b.slice(4)); return x ? rev(x.ground.concat([devPt(a)])) : [devPt(a)]; }
      if (ka === 'floor' || kb === 'floor') {
        const l = Q.linkBetween(a, b)[0];
        const cb = l && cables.get(l.id);
        const pts = cb ? cb.pts : [idfPt(G.BLD.byId[(ka === 'floor' ? a : b).slice(2)].level), [RX, B1 + 4.3, RZ], devPt(ka === 'floor' ? b : a)];
        return ka === 'floor' ? pts : rev(pts);
      }
      const pa = devPt(a), pb = devPt(b), yc = B1 + 4.1;
      return [pa, [pa[0], yc, RACKF + 0.9], [pb[0], yc, RACKF + 0.9], pb];
    }
    function routePts(nodes) {
      const out = [];
      const push = (pts) => { for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) > 0.05) out.push(p); } };
      if (kind(nodes[0]) === 'floor') push([seatPt(nodes[0].slice(2))]);
      if (nodes.length === 1) push([kind(nodes[0]) === 'inet' ? CLOUD : kind(nodes[0]) === 'floor' ? idfPt(G.BLD.byId[nodes[0].slice(2)].level) : devPt(nodes[0])]);
      for (let i = 0; i + 1 < nodes.length; i++) push(segPts(nodes[i], nodes[i + 1]));
      const last = nodes[nodes.length - 1];
      if (kind(last) === 'floor') push([seatPt(last.slice(2))]);
      return out;
    }
    const flowNodes = (fl) => {
      if (!fl.legs || fl.legs.some((l) => !l)) return null;
      let ns = [];
      for (const leg of fl.legs) {
        const best = leg.reduce((a, p) => (!a || p.frac > a.frac ? p : a), null);
        ns = ns.length ? ns.concat(best.nodes.slice(1)) : best.nodes.slice();
      }
      return ns.filter((n) => !n.startsWith('ROLE:'));
    };
    const firstOf = (cat) => Q.devices(cat).find((d) => d.rack);
    const inetTo = (id) => { const c = G.S.isp.find((x) => x.router && Net().ispUp(x)); return c && id ? ['INET', 'isp:' + c.id, c.router, id].filter((n, i, a) => a.indexOf(n) === i) : ['INET']; };
    const Net = () => G.Net;
    function attackPlans() {
      const s = G.S, sim = G.R.sim;
      const plans = [];
      alertFloors = new Map();
      const marks2 = [];
      for (const inc of G.Ev.visible()) {
        const def = G.INC[inc.type];
        if (!def || def.cat !== 'sec') continue;
        const d = inc.data || {};
        const flows = sim && sim.flows ? sim.flows.filter((f) => f.incId === inc.id) : [];
        for (const fl of flows) {
          let ns = flowNodes(fl);
          if (!ns || !ns.length) continue;
          let blocked = false, label = fl.label || inc.title;
          if (fl.blocked === 'fw') { const k = ns.findIndex((n) => Q.nodeKind(n) === 'firewall'); if (k >= 0) { ns = ns.slice(0, k + 1); blocked = true; } }
          /* 洪水攻擊就算防火牆丟棄，流量仍塞滿防火牆之前的 ISP 線路；只有上游清洗才算擋下 */
          if (fl.volumetric) { blocked = !!d.mitigated; label = d.mitigated ? 'DDoS 已由 ISP 在上游清洗' : 'DDoS 洪水流量：塞滿對外線路'; }
          plans.push({ inc, ns, blocked, label });
        }
        if (inc.type === 'scan' || inc.type === 'brute') {
          const fw = firstOf('firewall'), rt = firstOf('router');
          if (rt) {
            /* 掃描：管理服務沒有對外開放 = 一無所獲；暴力破解：被防火牆擋下 = d.blocked */
            const mgmt = G.Sec.posture().mgmtExposed;
            const exposed = inc.type === 'brute' ? !d.blocked : mgmt;
            const srv = inc.type === 'brute' && exposed ? (Q.roleServers('ad')[0] || firstOf('server')) : null;
            let ns = inetTo(fw ? fw.id : rt.id);
            if (fw && !Q.linkBetween(rt.id, fw.id).length) ns = inetTo(rt.id);
            if (srv && srv.rack) ns = ns.concat([srv.id]);
            const label = inc.type === 'scan' ? (exposed ? '連接埠掃描：發現對外開放的管理服務' : '連接埠掃描') : '暴力破解';
            plans.push({ inc, ns, blocked: !exposed, label });
          }
        }
        if (inc.type === 'guest-probe') {
          const fw = firstOf('firewall');
          const up = Q.linksOf('F:1F')[0];
          if (up) {
            const core = Q.other(up, 'F:1F');
            const ns = ['F:1F', core];
            if (fw) ns.push(fw.id);
            const fs = Q.roleServers('file').find((x) => x.rack);
            if (!d.blocked && fs) ns.push(fs.id);
            plans.push({ inc, ns, blocked: !!d.blocked, label: '訪客網路掃描內網' });
          }
          if (!d.blocked) alertFloors.set('1F', 1);
        }
        if (inc.type === 'phish' && !d.blocked && !d.contained && d.floor) alertFloors.set(d.floor, 1);
        if (inc.type === 'ransomware' && !d.blocked) for (const f of d.infected || []) alertFloors.set(f, d.contained ? 0.5 : 1);
        if (inc.type === 'rogue-ap' && d.floor && !d.removed) marks2.push({ inc, fid: d.floor });
      }
      return { plans, marks: marks2 };
    }
    function buildAttacks(plan) {
      clearG(atkG);
      for (const a of atks) if (a.tag) a.tag.remove();
      for (const m of marks) if (m.tag) m.tag.remove();
      atks = [];
      marks = [];
      const redM = lineMat('#ff4d4d', 0.35);
      for (const p of plan.plans) {
        const pts = routePts(p.ns);
        if (pts.length < 2) continue;
        const mesh = fx.tubeAlong(pts, 0.14, redM);
        mesh.userData.pick = { kind: 'atk', id: p.inc.id };
        atkG.add(mesh);
        const end = pts[pts.length - 1];
        let ring = null;
        if (p.blocked) {
          ring = new T.Mesh(new T.RingGeometry(0.9, 1.25, 40), new T.MeshBasicMaterial({ color: C('#46d17f'), transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false }));
          ring.userData.ownMat = true;
          ring.position.set(end[0], end[1], end[2]);
          atkG.add(ring);
        }
        const tag = api.tag((p.blocked ? '🛡 已擋下：' : '⚠ ') + p.label, p.blocked ? 'ok' : 'bad', 'center', p.blocked ? 2 : 3);
        tag.pos.set(end[0], end[1] + 1.6, end[2] + 0.5);
        atks.push({ p, path: fx.path(pts), ring, tag });
      }
      for (const m of plan.marks) {
        const f = G.BLD.byId[m.fid];
        const s = new T.Mesh(new T.SphereGeometry(0.8, 16, 12), K.glow('#ff4d4d', 2));
        s.userData.ownMat = true;
        s.position.set(-W / 2 + 9, yOf(f.level) + 2.2, D / 2 - 2.5);
        atkG.add(s);
        const tag = api.tag(`⚠ ${m.fid} 偽冒基地台`, 'bad', 'center', 3);
        tag.pos.set(s.position.x, s.position.y + 1.6, s.position.z);
        marks.push({ s, tag });
      }
    }

    /* ---------- 狀態同步 ---------- */
    const floorHex = (f) => {
      const s = G.S, sim = G.R.sim || { floors: {} };
      const fs = s.floors[f.id], st = sim.floors[f.id];
      const up = G.Net.floorUp(f.id);
      const sat = st && st.present > 1 ? st.sat : null;
      if (fs.movedIn > 0 && !up) return HEX.bad;
      const v = sat === null ? (up ? 0.9 : null) : sat;
      return v === null ? HEX.none : v >= 0.8 ? HEX.ok : v >= 0.6 ? HEX.warn : HEX.bad;
    };
    const colC = new Map();
    const cc = (hex) => colC.get(hex) || (colC.set(hex, C(hex)), colC.get(hex));
    function paintFloor(L, pulse) {
      const fl = floors[L];
      const lit = fl.lit, redK = alertFloors.get(fl.f.id);
      const base = cc(fl.col), EMG = cc('#3a2a1a'), REDC = cc('#ff3b30');
      const outage = G.R.fac && G.R.fac.outage && !G.R.fac.genRunning;
      for (let r = 0; r < per; r++) {
        const i = fl.order[r];
        if (outage) tmpC.copy(DARK).lerp(EMG, r < lit ? 0.35 : 0);
        else tmpC.copy(r < lit ? base : DARK);
        if (redK) tmpC.lerp(REDC, (r < lit ? 0.85 : 0.45) * redK * pulse);
        win.setColorAt(L * per + i, tmpC);
      }
    }
    function sync(first) {
      const s = G.S, sim = G.R.sim || { floors: {}, links: {}, isp: {} };
      const sM = s.racks.map((r) => r.id).join(',') + '|' + Object.values(s.devices).filter((d) => d.rack).map((d) => `${d.id}:${d.rack}:${d.u}`).join(',') + '|' + s.room.map((r) => r.id).join(',');
      let rebuilt = false;
      if (sM !== sigM) { sigM = sM; buildMdf(); rebuilt = true; }
      const sC = Object.values(s.links).filter((l) => l.a.startsWith('F:') || l.b.startsWith('F:')).map((l) => `${l.id}:${l.a}:${l.b}:${l.cable}`).join(',');
      if (sC !== sigC || rebuilt) { sigC = sC; buildCables(); }
      const sI = s.isp.map((c) => `${c.id}:${c.router}`).join(',');
      if (sI !== sigI || rebuilt) { sigI = sI; buildIsps(); }
      /* 樓層 */
      floors.forEach((fl, L) => {
        const fs = s.floors[fl.f.id];
        fl.col = floorHex(fl.f);
        fl.lit = Math.round(U.clamp(fs.movedIn / fl.f.staff, 0, 1) * per);
        const stt = G.Views.building.floorStatus(fl.f.id);
        fl.led.material.color.copy(C(HEX[stt.c] || HEX.none));
        fl.idf.visible = fs.idf.count > 0 || fs.cabling.status !== 'none';
        fl.tag.set(fl.f.id, stt.c || '');
      });
      /* 主幹線 */
      for (const cb of cables.values()) {
        const l = cb.l, ls = sim.links[l.id];
        const building = G.Net.linkBuilding(l), up = G.Net.linkUp(l);
        cb.on = up;
        cb.mesh.material = building ? lineMat('#7d8b94', 0.35) : l.status !== 'up' ? lineMat('#f25f5c', 1) : lineMat(CAT.cables[l.cable].color, up ? 1 : 0.5);
        const fn = 'F:' + cb.fid;
        const toFloor = ls ? (l.b === fn ? ls.ab : ls.ba) : 0, fromFloor = ls ? (l.b === fn ? ls.ba : ls.ab) : 0;
        cb.dn = ls && ls.cap ? toFloor / ls.cap : 0;
        cb.up = ls && ls.cap ? fromFloor / ls.cap : 0;
      }
      /* ISP */
      for (const x of isps.values()) {
        const c = x.c, st = sim.isp[c.id];
        const active = c.status === 'active' && !!c.router;
        x.on = !!(st && st.up);
        x.mesh.material = c.outage ? lineMat('#f25f5c', 1) : !active ? lineMat('#7d8b94', 0.35) : st && st.standby ? lineMat('#f2c14e', 0.45) : lineMat('#f2c14e', 1);
        x.dn = st && st.cap ? st.in / st.cap : 0;
        x.up = st && st.cap ? st.out / st.cap : 0;
      }
      /* MDF 設備燈 */
      const fac = G.R.fac;
      for (const sp of strips) {
        const d = s.devices[sp.id];
        if (!d) continue;
        const m = CAT.devices[d.model];
        let hex = CAT.categories[m.cat].color, blink = 0;
        if (d.status === 'failed' || d.status === 'rma' || d.encrypted) { hex = '#ff4d4d'; blink = 4; }
        else if (fac && (!fac.mdfPowered || fac.rackTripped[d.rack])) hex = '#20262b';
        else if (s.time < (d.bootUntil || 0)) { hex = '#ffb13b'; blink = 2; }
        sp.st.material = stripMat(hex);
        sp.blink = blink;
      }
      b1Tag.set(`B1 主機房 · ${s.racks.length} 座機櫃 · ${s.temp.toFixed(1)}°C`, fac && !fac.mdfPowered ? 'bad' : s.temp >= 27 ? 'warn' : 'info');
      /* 攻擊 */
      const plan = attackPlans();
      const sA = plan.plans.map((p) => p.inc.id + ':' + p.ns.join('>') + ':' + p.blocked).join('|') + '#' + plan.marks.map((m) => m.fid).join(',');
      if (sA !== sigA || rebuilt) { sigA = sA; buildAttacks(plan); }
      floors.forEach((fl, L) => paintFloor(L, 1));
      win.instanceColor.needsUpdate = true;
      refreshSel();
    }

    /* ---------- 圖例 ---------- */
    const sw = (hex) => U.h('i', { style: { background: hex } });
    U.mount(api.hud, U.h('div', { class: 'm3d-legend' },
      U.h('div', {}, sw('#7aa2f7'), 'Cat6A', sw('#2fc6b8'), 'OM4', sw('#f2c14e'), 'OS2 / ISP'),
      U.h('div', {}, U.h('b', { class: 'dotp' }), '移動的光點 = 流量（越密越滿）'),
      U.h('div', {}, sw('#f25f5c'), '紅色 = 中斷 / 攻擊路徑　', sw('#46d17f'), '綠圈 = 被擋下')));
    let showFlow = true;
    const flowBtn = U.h('button', { class: 'btn xs on', onclick: () => { showFlow = !showFlow; flowBtn.classList.toggle('on', showFlow); api.request(); } }, '流量動畫');
    api.bar.insertBefore(flowBtn, api.bar.firstChild.nextSibling);

    /* ---------- 選取：外框 + 資訊卡（點一下選取、點兩下拉近，要進入樓層請按卡片上的按鈕） ---------- */
    let sel = null, selEls = null;
    const selLine = new T.LineSegments(new T.EdgesGeometry(new T.BoxGeometry(1, 1, 1)), new T.LineBasicMaterial({ color: C('#2fc6b8') }));
    selLine.visible = false;
    selLine.raycast = () => {};
    root.add(selLine);
    const norm = (p) => (p.kind === 'pane' ? { kind: 'floor', id: (floors[Math.floor(p.inst / per)] || floors[0]).f.id } : p.kind === 'rack' ? { kind: 'b1' } : p);
    function info(p) {
      const s = G.S, sim = G.R.sim || { floors: {}, links: {}, isp: {} };
      if (p.kind === 'floor') {
        const fl = floors.find((x) => x.f.id === p.id);
        if (!fl) return null;
        const f = fl.f, fs = s.floors[f.id], st = sim.floors[f.id];
        const stt = G.Views.building.floorStatus(f.id);
        const links = Q.linksOf('F:' + f.id);
        const cap = U.sum(links.filter((l) => l.status === 'up'), (l) => l.speed * l.count);
        const util = Math.max(0, ...links.map((l) => (sim.links[l.id] ? sim.links[l.id].util : 0)));
        return [`${f.id}　${f.dept}`, `進駐 ${U.num(fs.movedIn)} / ${U.num(f.staff)} 人 · ${stt.t}`,
          st && st.present > 1 && st.sat !== null ? `滿意度 ${U.pct(st.sat)}` : '尚無使用者',
          links.length ? `上行 ${U.bw(cap)} · 使用率 ${U.pct(util)}` : '還沒有上行主幹線'];
      }
      if (p.kind === 'link') {
        const l = s.links[p.id];
        if (!l) return null;
        const fn = l.a.startsWith('F:') ? l.a : l.b, ls = sim.links[l.id];
        const st = G.Net.linkBuilding(l) ? '施工中' : l.status !== 'up' ? '中斷！' : G.Net.linkUp(l) ? '正常' : '一端設備離線';
        return [`${fn.slice(2)} ⇄ ${Q.nodeName(Q.other(l, fn))}`, `${CAT.cables[l.cable].name} · ${U.bw(l.speed)} × ${l.count} · ${G.BLD.riserLength(fn.slice(2))} m`, `狀態：${st}`, ls ? `使用率 ${U.pct(ls.util)}` : ''];
      }
      if (p.kind === 'isp') {
        const c = s.isp.find((x) => x.id === p.id);
        if (!c) return null;
        const st = sim.isp[c.id];
        const state = c.outage ? '中斷！' : c.status !== 'active' ? '申請中' : !c.router ? '尚未接上路由器' : st && st.standby ? '備援待命' : '使用中';
        return [`${CAT.isp.providers[c.provider].name} ${c.plan}`, `頻寬 ${U.bw(c.bw)} · ${state}`, st && st.up ? `下行 ${U.pct(st.in / st.cap)} · 上行 ${U.pct(st.out / st.cap)}` : ''];
      }
      if (p.kind === 'b1') {
        const fac = G.R.fac || { itLoad: 0 };
        return ['B1 主機房（MDF）', `${s.racks.length} 座機櫃 · IT 負載 ${(fac.itLoad / 1000).toFixed(1)} kW`, `機房溫度 ${s.temp.toFixed(1)}°C`];
      }
      if (p.kind === 'dev') {
        const d = s.devices[p.id];
        if (!d) return null;
        return [d.name + (d.role ? ` · ${CAT.roles[d.role].short}` : ''), CAT.devices[d.model].name, `狀態：${G.UI.devStatus(d).t}`];
      }
      if (p.kind === 'atk') {
        const inc = s.incidents.find((x) => x.id === p.id);
        return inc && inc.status === 'active' ? [inc.title, '沿著實際路由移動的紅點 = 攻擊流量'] : null;
      }
      if (p.kind === 'inet') return ['網際網路', '所有外部流量（包含攻擊）都從這裡進來'];
      return null;
    }
    function renderSel() {
      const panel = api.panel;
      const L = sel && info(sel);
      if (!L) { sel = null; selEls = null; panel.hidden = true; selLine.visible = false; api.request(); return; }
      const cur = sel;
      const btn = (label, fn, primary) => U.h('button', { class: 'btn xs' + (primary ? ' primary' : ''), onclick: fn }, label);
      const acts = [];
      if (cur.kind === 'floor') {
        acts.push(btn(`進入 ${cur.id} 規劃`, () => opts.onFloor && opts.onFloor(cur.id), true));
        acts.push(btn('拉近', () => { const fl = floors.find((x) => x.f.id === cur.id); if (fl) api.focus(fl.glass, 0.55); }));
      } else if (cur.kind === 'b1') acts.push(btn('進入機房', () => opts.onRack && opts.onRack(), true));
      else if (cur.kind === 'dev') acts.push(btn('到機房查看', () => opts.onDev && opts.onDev(cur.id), true));
      else if (cur.kind === 'link' || cur.kind === 'isp') acts.push(btn('到拓撲圖', () => opts.onTopo && opts.onTopo(), true));
      else if (cur.kind === 'atk') acts.push(btn('前往事件中心', () => opts.onInc && opts.onInc(), true));
      const title = U.h('b', {}, L[0]), lines = U.h('div', { class: 'ls' });
      U.mount(panel, U.h('div', { class: 'hd' }, title, U.h('button', { class: 'btn ghost xs', 'aria-label': '取消選取', onclick: () => { sel = null; renderSel(); } }, '✕')), lines, U.h('div', { class: 'row wrap' }, ...acts));
      selEls = { title, lines };
      panel.hidden = false;
      refreshSel();
      if (cur.kind === 'floor') {
        const fl = floors.find((x) => x.f.id === cur.id);
        selLine.scale.set(W + 1, FH + 0.15, D + 1);
        selLine.position.set(0, fl.y + FH / 2, 0);
        selLine.visible = true;
      } else if (cur.kind === 'b1' || cur.kind === 'dev') {
        selLine.scale.set(W + 0.7, 5.4, D + 0.7);
        selLine.position.set(0, B1 + 2.5, 0);
        selLine.visible = true;
      } else selLine.visible = false;
      api.request();
    }
    /** 每次同步只更新卡片上的數字，不重建按鈕（避免點到一半按鈕被換掉） */
    function refreshSel() {
      if (!sel || !selEls) return;
      const L = info(sel);
      if (!L) { renderSel(); return; }
      if (selEls.title.textContent !== L[0]) selEls.title.textContent = L[0];
      U.mount(selEls.lines, ...L.slice(1).filter(Boolean).map((x) => U.h('div', {}, x)));
    }

    const tmp = [0, 0, 0];
    const RED = fx.rgb('#ff4d4d');
    return {
      obj: root, frame: frameBox, view: { yaw: 0.5, pitch: 0.14, fill: 0.94 },
      sync,
      animating: () => true,
      tick(dt, t) {
        P.begin();
        if (showFlow) {
          for (const cb of cables.values()) {
            if (!cb.on) continue;
            const L = cb.path.len;
            const nd = cb.dn > 0.0005 ? Math.min(12, 2 + Math.round(cb.dn * 10)) : 0;
            const nu = cb.up > 0.0005 ? Math.min(6, 1 + Math.round(cb.up * 5)) : 0;
            const hot = cb.dn >= 0.9 || cb.up >= 0.9;
            const vd = (10 + cb.dn * 26) / L, vu = (8 + cb.up * 20) / L;
            for (let i = 0; i < nd; i++) { cb.path.at(1 - ((t * vd + i / nd) % 1), tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : cb.c1, 0.95, 1); }
            for (let i = 0; i < nu; i++) { cb.path.at((t * vu + i / nu + 0.5 / nu) % 1, tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : cb.c2, 0.75, 0.75); }
          }
          for (const x of isps.values()) {
            if (!x.on) continue;
            const L = x.path.len;
            const nd = Math.min(12, 2 + Math.round(x.dn * 10)), nu = Math.min(6, 1 + Math.round(x.up * 5));
            const vd = (18 + x.dn * 30) / L, vu = (14 + x.up * 24) / L;
            for (let i = 0; i < nd; i++) { x.path.at((t * vd + i / nd) % 1, tmp); P.push(tmp[0], tmp[1], tmp[2], x.dn >= 0.9 ? PAL.hot : PAL.ispD, 0.95, 1.1); }
            for (let i = 0; i < nu; i++) { x.path.at(1 - ((t * vu + i / nu) % 1), tmp); P.push(tmp[0], tmp[1], tmp[2], PAL.ispU, 0.7, 0.8); }
          }
        }
        for (const a of atks) {
          const n = 7, v = 26 / Math.max(20, a.path.len);
          for (let i = 0; i < n; i++) {
            const u = (t * v + i / n) % 1;
            a.path.at(u, tmp);
            P.push(tmp[0], tmp[1], tmp[2], RED, a.p.blocked && u > 0.9 ? (1 - u) * 10 : 1, 1.5);
          }
          if (a.ring) {
            a.ring.quaternion.copy(api.camera.quaternion);
            const k = (t * 0.9) % 1;
            a.ring.scale.setScalar(1 + k * 1.6);
            a.ring.material.opacity = 0.85 * (1 - k);
          }
        }
        P.end();
        for (const m of marks) m.s.material.emissiveIntensity = Math.sin(t * 6) > 0 ? 2.4 : 0.3;
        for (const sp of strips) if (sp.blink) sp.st.visible = Math.sin(t * Math.PI * sp.blink) > -0.2; else if (!sp.st.visible) sp.st.visible = true;
        beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 2.4 : 0.3;
        if (alertFloors.size) {
          const pulse = 0.55 + 0.45 * Math.sin(t * 5);
          floors.forEach((fl, L) => { if (alertFloors.has(fl.f.id)) paintFloor(L, pulse); });
          win.instanceColor.needsUpdate = true;
        }
      },
      pickables: () => [root],
      focusObj: (p) => {
        p = norm(p);
        if (p.kind === 'floor') { const fl = floors.find((x) => x.f.id === p.id); return fl ? fl.glass : null; }
        if (p.kind === 'b1' || p.kind === 'dev' || p.kind === 'rack') return b1Floor;
        return null;
      },
      clickable: (p) => p.kind !== 'inet',
      tip(p) { const L = info(norm(p)); return L ? L.concat([p.kind === 'inet' ? '' : '點一下選取・點兩下拉近']).filter(Boolean) : null; },
      click(p) {
        p = norm(p);
        if (p.kind === 'inet' || !info(p)) return false;
        sel = p;
        renderSel();
        return true;
      },
      clickEmpty() { sel = null; renderSel(); },
      dispose() {
        offTheme();
        for (const fl of floors) fl.tag.remove();
        for (const a of atks) if (a.tag) a.tag.remove();
        for (const m of marks) if (m.tag) m.tag.remove();
        for (const t of [shaftTag, inetTag, ispTag, b1Tag]) t.remove();
        for (const m of Object.values(stripM)) m.dispose();
        for (const m of matCache.values()) m.dispose();
      },
    };
  }
})(window.G = window.G || {});
