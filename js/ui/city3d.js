/* 3D 大樓周邊街景：新曜大道（四線道）、斑馬線與紅綠燈、行人、汽車 / 公車 / 機車、公車站、
 * 行道樹、路燈、對面街廓，以及大樓右側的小公園。
 * 單位：公尺（與 3D 大樓相同）。行人與車流的多寡跟著遊戲時間變化（上下班尖峰、午餐、深夜、週末）；
 * 走路、開車與紅綠燈用真實時間播放，所以遊戲暫停時街景仍然會動。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const noop = () => {};

  /* ---------- 版面 ---------- */
  const Z0 = -70, Z1 = 11;                       /* 街道南北範圍（前緣是大樓剖面的切面） */
  const ROAD = { x0: -47, x1: -33 };             /* 新曜大道 */
  const NEAR = { x0: -33, x1: -29, c: -31 };     /* 大樓這一側的人行道 */
  const FAR = { x0: -51, x1: -47, c: -49 };      /* 對面人行道 */
  const XW = { z0: -6, z1: -2 };                 /* 斑馬線 */
  const DOOR = [-23.3, 3.5];                     /* 大樓側門 */
  const BUS = -21;                               /* 公車站 */
  /* 車道：面向 +z 時右手邊是 −x，靠右行駛 */
  const LANES = [{ x: -45.2, dir: 1, curb: true }, { x: -41.7, dir: 1 }, { x: -38.3, dir: -1 }, { x: -34.8, dir: -1, curb: true }];
  const STOP = { 1: XW.z0 - 1.6, '-1': XW.z1 + 1.6 };
  const CYCLE = 38;
  /** 紅綠燈（真實秒數）：車 綠 20 s → 黃 3 s → 全紅 → 行人綠燈 → 行人閃爍 → 全紅 */
  const phase = (t) => {
    const u = t % CYCLE;
    if (u < 20) return { car: 'g', ped: 'r' };
    if (u < 23) return { car: 'y', ped: 'r' };
    if (u < 24.5) return { car: 'r', ped: 'r' };
    if (u < 33) return { car: 'r', ped: 'g' };
    if (u < 36) return { car: 'r', ped: 'f' };
    return { car: 'r', ped: 'r' };
  };

  M3.city = (api) => {
    const T = api.T, K = M3.kit;
    const C = (hex) => K.col(hex);
    const root = new T.Group();
    const dummy = new T.Object3D();
    const unit = new T.BoxGeometry(1, 1, 1);
    const own = [];
    const mat = (m) => { own.push(m); return m; };
    const add = (o) => { o.raycast = noop; root.add(o); return o; };
    function inst(geo, m, n, colors) {
      const im = new T.InstancedMesh(geo, m, n);
      im.frustumCulled = false;
      im.raycast = noop;
      if (colors) for (let i = 0; i < n; i++) im.setColorAt(i, C(colors(i)));
      root.add(im);
      return im;
    }
    function setM(im, i, x, y, z, sx, sy, sz, ry) {
      dummy.position.set(x, y, z); dummy.scale.set(sx, sy, sz); dummy.rotation.set(0, ry || 0, 0); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }

    /* ---------- 路面（車道線、斑馬線、停止線畫在貼圖上） ---------- */
    const RW = ROAD.x1 - ROAD.x0, RL = Z1 - Z0;
    const roadT = K.makeTex(RW * 10, RL * 10, (c) => {
      K.D.rect(c, 0, 0, RW * 10, RL * 10, '#2e3337');
      for (let i = 0; i < 400; i++) K.D.rect(c, hash(i) * RW * 10, hash(i + 7) * RL * 10, 1.2, 1.2, 'rgba(255,255,255,0.05)');
      const zy = (z) => (z - Z0) * 10;
      const xx = (x) => (x - ROAD.x0) * 10;
      K.D.rect(c, xx(-40) - 2.2, 0, 1.6, RL * 10, '#e0b83a');
      K.D.rect(c, xx(-40) + 0.6, 0, 1.6, RL * 10, '#e0b83a');
      for (const lx of [-43.5, -36.5]) for (let z = Z0; z < Z1; z += 9) if (z + 4 < XW.z0 - 2 || z > XW.z1 + 2) K.D.rect(c, xx(lx) - 0.8, zy(z), 1.6, 40, '#e8ecef');
      K.D.rect(c, 2, 0, 1.4, RL * 10, '#e8ecef');
      K.D.rect(c, RW * 10 - 3.4, 0, 1.4, RL * 10, '#e8ecef');
      for (let x = ROAD.x0 + 0.6; x < ROAD.x1 - 0.4; x += 1.1) K.D.rect(c, xx(x), zy(XW.z0), 5.5, (XW.z1 - XW.z0) * 10, '#eef1f3');
      K.D.rect(c, xx(-47) + 3, zy(STOP[1]) - 2, (7 - 0.6) * 10, 4, '#eef1f3');
      K.D.rect(c, xx(-40) + 3, zy(STOP[-1]) - 2, (7 - 0.6) * 10, 4, '#eef1f3');
      K.D.txt(c, '慢', xx(-45.2), zy(-30), 22, 'rgba(238,241,243,0.8)', 'center', 800);
      K.D.txt(c, '機車', xx(-34.8), zy(-50), 16, 'rgba(238,241,243,0.8)', 'center', 800);
    }, 8);
    const road = add(K.plane(RW, RL, K.texMat(roadT, { metalness: 0, roughness: 0.95 })));
    road.rotation.x = -Math.PI / 2;
    road.position.set((ROAD.x0 + ROAD.x1) / 2, 0.02, (Z0 + Z1) / 2);

    /* 人行道、廣場、公園草地 */
    const paverT = K.makeTex(200, 200, (c) => {
      K.D.rect(c, 0, 0, 200, 200, '#8d9296');
      for (let y = 0; y < 200; y += 25) for (let x = (y / 25) % 2 ? 12 : 0; x < 200; x += 25) K.D.rr(c, x + 1, y + 1, 23, 23, 2, (x + y) % 50 ? '#979ca0' : '#868b8f');
    }, 2);
    paverT.wrapS = paverT.wrapT = T.RepeatWrapping;
    const paveMat = (sx, sz) => { const t = paverT.clone(); t.needsUpdate = true; t.repeat.set(sx / 2.5, sz / 2.5); return mat(K.texMat(t, { metalness: 0, roughness: 0.9 })); };
    const slab = (x0, x1, z0, z1, m, y) => { const p = add(K.plane(x1 - x0, z1 - z0, m)); p.rotation.x = -Math.PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); return p; };
    slab(NEAR.x0, NEAR.x1, Z0, Z1, paveMat(4, RL), 0.14);
    slab(FAR.x0, FAR.x1, Z0, Z1, paveMat(4, RL), 0.14);
    slab(-29, -23, Z0, Z1, paveMat(6, RL), 0.1);
    const lawnT = K.makeTex(200, 200, (c) => { K.D.rect(c, 0, 0, 200, 200, '#3e6b45'); for (let i = 0; i < 900; i++) K.D.rect(c, hash(i + 3) * 200, hash(i + 9) * 200, 2, 3, hash(i) > 0.5 ? '#46784d' : '#37603e'); }, 2);
    lawnT.wrapS = lawnT.wrapT = T.RepeatWrapping;
    lawnT.repeat.set(12, 14);
    slab(24, 90, Z0, -12, mat(K.texMat(lawnT, { metalness: 0, roughness: 1 })), 0.06);
    slab(24, 90, -12, Z1, mat(K.texMat(lawnT, { metalness: 0, roughness: 1 })), 0.06);
    slab(38.5, 41.5, Z0, Z1, paveMat(3, RL), 0.09);
    slab(24, 90, -33.5, -30.5, paveMat(66, 3), 0.09);
    const curbM = mat(K.std('#b7bcc0', { metalness: 0, roughness: 0.85 }));
    for (const x of [ROAD.x0, ROAD.x1]) { const cb = add(K.box(0.25, 0.16, RL, curbM)); cb.position.set(x + (x === ROAD.x0 ? -0.12 : 0.12), 0.08, (Z0 + Z1) / 2); }

    /* ---------- 對面街廓（夜晚窗戶會亮） ---------- */
    const winC = document.createElement('canvas');
    winC.width = winC.height = 128;
    const wg = winC.getContext('2d');
    wg.fillStyle = '#2b3238'; wg.fillRect(0, 0, 128, 128);
    const litC = document.createElement('canvas');
    litC.width = litC.height = 128;
    const lg = litC.getContext('2d');
    lg.fillStyle = '#000'; lg.fillRect(0, 0, 128, 128);
    for (let r = 0; r < 8; r++) for (let k = 0; k < 8; k++) {
      wg.fillStyle = '#56666f'; wg.fillRect(k * 16 + 3, r * 16 + 4, 10, 9);
      if (hash(r * 8 + k + 1) > 0.52) { lg.fillStyle = hash(r + k * 3) > 0.3 ? '#ffd79a' : '#cfe6ff'; lg.fillRect(k * 16 + 3, r * 16 + 4, 10, 9); }
    }
    const winT = new T.CanvasTexture(winC), litT = new T.CanvasTexture(litC);
    winT.encoding = litT.encoding = T.sRGBEncoding;
    winT.wrapS = winT.wrapT = litT.wrapS = litT.wrapT = T.RepeatWrapping;
    const blockMats = [];
    [[-70, -49, 34, '#5d666d'], [-47, -29, 20, '#6e6a63'], [-27, -9, 48, '#56606a'], [-7, 10, 26, '#646b72']].forEach(([z0, z1, hgt, hex], i) => {
      const w = 26, d = z1 - z0;
      const t1 = winT.clone(), t2 = litT.clone();
      t1.needsUpdate = t2.needsUpdate = true;
      t1.repeat.set(d / 8, hgt / 8); t2.repeat.copy(t1.repeat);
      const m = mat(new T.MeshStandardMaterial({ color: C(hex), map: t1, emissive: C('#ffffff'), emissiveMap: t2, emissiveIntensity: 0, roughness: 0.8, metalness: 0.1 }));
      blockMats.push(m);
      const b = add(new T.Mesh(new T.BoxGeometry(w, hgt, d), m));
      b.position.set(-53 - w / 2 - (i % 2) * 3, hgt / 2, (z0 + z1) / 2);
      const roofB = add(K.box(w - 2, 1.2, d - 2, mat(K.std('#3b4248', { roughness: 0.9 }))));
      roofB.position.set(b.position.x, hgt + 0.6, b.position.z);
    });

    /* ---------- 行道樹、公園的樹 ---------- */
    const trees = [];
    for (let z = Z0 + 4; z < Z1 - 2; z += 9) {
      if (Math.abs(z - (XW.z0 + XW.z1) / 2) < 5 || Math.abs(z - BUS) < 4) continue;
      trees.push([NEAR.x1 - 0.8, z], [FAR.x0 + 0.8, z + 4]);
    }
    for (let i = 0; i < 26; i++) {
      const x = 28 + hash(i * 3.3) * 58, z = Z0 + 4 + hash(i * 7.1) * 72;
      if (Math.abs(x - 40) < 3 || Math.abs(z + 32) < 3 || (x < 38 && z > -10 && z < 6)) continue;
      trees.push([x, z]);
    }
    const trunk = inst(new T.CylinderGeometry(0.16, 0.22, 1, 8), mat(K.std('#5a4636', { roughness: 0.9 })), trees.length);
    const crown = inst(new T.IcosahedronGeometry(1, 1), mat(K.std('#ffffff', { roughness: 0.9, metalness: 0 })), trees.length, (i) => ['#3f7f4a', '#4a8a52', '#367043', '#5a9458'][Math.floor(hash(i + 0.5) * 4)]);
    trees.forEach(([x, z], i) => {
      const s = 0.85 + hash(i * 1.7) * 0.5;
      setM(trunk, i, x, 1.3 * s, z, s, 2.6 * s, s);
      setM(crown, i, x, 3.4 * s, z, 1.9 * s, 1.7 * s, 1.9 * s);
    });
    /* 公園長椅 */
    const benchM = mat(K.std('#8a6a4e', { roughness: 0.8 }));
    const benches = [[37.2, -18], [37.2, -44], [42.8, -58], [55, -29], [70, -29]];
    const bench = inst(unit, benchM, benches.length * 2);
    benches.forEach(([x, z], i) => {
      const alongZ = Math.abs(x - 40) < 4;
      setM(bench, i * 2, x, 0.45, z, alongZ ? 0.5 : 1.8, 0.08, alongZ ? 1.8 : 0.5);
      setM(bench, i * 2 + 1, x + (alongZ ? (x < 40 ? -0.22 : 0.22) : 0), 0.75, z + (alongZ ? 0 : -0.22), alongZ ? 0.06 : 1.8, 0.5, alongZ ? 1.8 : 0.06);
    });

    /* ---------- 路燈（晚上會亮，路面出現光暈） ---------- */
    const lamps = [];
    for (let z = Z0 + 6; z < Z1; z += 17) { lamps.push([NEAR.x0 + 0.5, z, -1]); lamps.push([FAR.x1 - 0.5, z + 8, 1]); }
    const poleM = mat(K.std('#4d565d', { metalness: 0.6, roughness: 0.4 }));
    const pole = inst(new T.CylinderGeometry(0.09, 0.12, 1, 8), poleM, lamps.length);
    const arm = inst(unit, poleM, lamps.length);
    const lampHeadM = mat(new T.MeshBasicMaterial({ color: C('#6d7479') }));
    const head = inst(unit, lampHeadM, lamps.length);
    const glowC = document.createElement('canvas');
    glowC.width = glowC.height = 64;
    const gg = glowC.getContext('2d');
    const grd = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,214,150,0.9)'); grd.addColorStop(1, 'rgba(255,214,150,0)');
    gg.fillStyle = grd; gg.fillRect(0, 0, 64, 64);
    const glowT = new T.CanvasTexture(glowC);
    const poolM = mat(new T.MeshBasicMaterial({ map: glowT, transparent: true, depthWrite: false, opacity: 0, blending: T.AdditiveBlending }));
    const pool = inst(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolM, lamps.length);
    lamps.forEach(([x, z, dir], i) => {
      setM(pole, i, x, 3.2, z, 1, 6.4, 1);
      setM(arm, i, x + dir * 1.1, 6.35, z, 2.2, 0.12, 0.14);
      setM(head, i, x + dir * 2.1, 6.2, z, 0.9, 0.18, 0.45);
      setM(pool, i, x + dir * 2.1, 0.17, z, 9, 1, 9);
    });

    /* ---------- 公車站 ---------- */
    const shelterM = mat(K.std('#3b4248', { metalness: 0.5, roughness: 0.45 }));
    const glassM = mat(K.std('#a9d6ef', { transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }));
    const roof = add(K.box(1.8, 0.12, 5, shelterM)); roof.position.set(NEAR.c + 0.3, 2.6, BUS);
    for (const dz of [-2.3, 2.3]) { const p = add(K.box(0.1, 2.6, 0.1, shelterM)); p.position.set(NEAR.c + 1.05, 1.3, BUS + dz); }
    const back = add(K.box(0.05, 1.9, 4.6, glassM)); back.position.set(NEAR.c + 1.05, 1.45, BUS);
    const sb = add(K.box(0.45, 0.08, 3, benchM)); sb.position.set(NEAR.c + 0.7, 0.55, BUS);
    const sign = add(K.box(0.05, 0.6, 0.9, mat(new T.MeshBasicMaterial({ color: C('#2f8f6f') })))); sign.position.set(NEAR.c - 0.7, 2.4, BUS + 2.8);
    const signPole = add(K.box(0.08, 2.4, 0.08, shelterM)); signPole.position.set(NEAR.c - 0.7, 1.2, BUS + 2.8);

    /* ---------- 紅綠燈（車用三色燈 + 行人燈） ---------- */
    const housingM = mat(K.std('#22272c', { metalness: 0.4, roughness: 0.5 }));
    const lampMats = {};
    for (const k of ['r', 'y', 'g', 'pr', 'pg']) lampMats[k] = mat(new T.MeshBasicMaterial({ color: C('#1c2126') }));
    const LIT = { r: C('#ff3b30'), y: C('#ffb13b'), g: C('#3fe07a'), pr: C('#ff4d4d'), pg: C('#46e27a') }, OFF = C('#1c2126');
    const lightG = new T.Group();
    root.add(lightG);
    const bulb = new T.SphereGeometry(0.16, 10, 8);
    /* 往 +z 開的車看的燈在路口前方（z 較大）的那一側；往 −z 開的反之 */
    for (const [px, pz, face] of [[ROAD.x0 - 0.4, XW.z1 + 1.2, -1], [ROAD.x1 + 0.4, XW.z0 - 1.2, 1]]) {
      const g = new T.Group();
      const p = K.box(0.14, 5.2, 0.14, housingM); p.position.y = 2.6; g.add(p);
      const armB = K.box(4.5, 0.12, 0.12, housingM); armB.position.set(face * -2.2, 5.1, 0); g.add(armB);
      const hs = K.box(0.4, 1.2, 0.35, housingM); hs.position.set(face * -3.6, 4.6, 0); g.add(hs);
      ['r', 'y', 'g'].forEach((k, j) => { const b = new T.Mesh(bulb, lampMats[k]); b.position.set(face * -3.6, 5.0 - j * 0.38, face * -0.19); g.add(b); });
      const ph = K.box(0.3, 0.6, 0.25, housingM); ph.position.set(0, 2.6, 0); g.add(ph);
      for (const [k, dy] of [['pr', 0.14], ['pg', -0.14]]) { const b = new T.Mesh(bulb, lampMats[k]); b.scale.setScalar(0.8); b.position.set(face * 0.16, 2.6 + dy, 0); g.add(b); }
      g.position.set(px, 0.14, pz);
      g.traverse((o) => { o.raycast = noop; });
      lightG.add(g);
    }

    /* ---------- 行人 ---------- */
    const MAXP = 90;
    const pantsG = new T.CylinderGeometry(0.15, 0.13, 0.52, 8); pantsG.translate(0, 0.26, 0);
    const bodyG = new T.CylinderGeometry(0.19, 0.23, 0.78, 8); bodyG.translate(0, 0.9, 0);
    const headG = new T.SphereGeometry(0.13, 10, 8); headG.translate(0, 1.47, 0);
    const SHIRT = ['#5aa9f0', '#e8e4dc', '#43c59e', '#f2c14e', '#8f7cf0', '#e86fa8', '#2f3a44', '#c85a4a', '#9aa7ad', '#3f6f8f', '#f0823a', '#6d8f5a'];
    const PANTS = ['#2b3238', '#3a4a66', '#4d4a45', '#1f2327', '#6b7780'];
    const SKIN = ['#f1c9a5', '#e0ac85', '#c68b65', '#8d5a3f', '#f6d7bd'];
    const whiteM = () => mat(K.std('#ffffff', { roughness: 0.8, metalness: 0 }));
    const pPants = inst(pantsG, whiteM(), MAXP, (i) => PANTS[Math.floor(hash(i * 2.1) * PANTS.length)]);
    const pBody = inst(bodyG, whiteM(), MAXP, (i) => SHIRT[Math.floor(hash(i * 3.7) * SHIRT.length)]);
    const pHead = inst(headG, whiteM(), MAXP, (i) => SKIN[Math.floor(hash(i * 5.3) * SKIN.length)]);
    const peds = [];
    const pedFree = [];
    for (let i = MAXP - 1; i >= 0; i--) { pedFree.push(i); for (const im of [pPants, pBody, pHead]) setM(im, i, 0, -50, 0, 0, 0, 0); }
    const walkX = (side) => (side === 'near' ? NEAR.c : FAR.c) + U.rand(-1.2, 1.2);
    const endZ = (dir) => (dir > 0 ? Z1 - 0.5 : Z0 + 0.5);
    function newPed(kind) {
      const zc = U.rand(XW.z0 + 0.6, XW.z1 - 0.6);
      let pts, wait = -1;
      if (kind === 'walk') {
        const side = Math.random() < 0.55 ? 'near' : 'far', dir = Math.random() < 0.5 ? 1 : -1, x = walkX(side);
        pts = [[x, endZ(-dir)], [x, endZ(dir)]];
      } else if (kind === 'cross') {
        const fromNear = Math.random() < 0.5;
        const xa = walkX(fromNear ? 'near' : 'far'), xb = walkX(fromNear ? 'far' : 'near');
        const za = U.rand(Z0 + 2, Z1 - 2), zb = U.rand(Z0 + 2, Z1 - 2);
        const c0 = fromNear ? ROAD.x1 + 0.35 : ROAD.x0 - 0.35, c1 = fromNear ? ROAD.x0 - 0.35 : ROAD.x1 + 0.35;
        pts = [[xa, za], [xa, zc], [c0, zc], [c1, zc], [xb, zc], [xb, zb]];
        wait = 2;
      } else if (kind === 'in' || kind === 'out') {
        /* 上班：從人行道或對面（過馬路）走進大樓側門；下班反過來 */
        const viaCross = Math.random() < 0.45;
        const dz = U.rand(-0.9, 0.9);
        const door = [DOOR[0], DOOR[1] + dz];
        if (viaCross) {
          const xf = walkX('far'), zf = U.rand(Z0 + 2, Z1 - 2);
          pts = [[xf, zf], [xf, zc], [ROAD.x0 - 0.35, zc], [ROAD.x1 + 0.35, zc], [NEAR.c + U.rand(-1, 1), zc], [-27, DOOR[1] + dz], door];
          wait = 2;
        } else {
          const x = walkX('near'), z = U.rand(Z0 + 2, Z1 - 2);
          pts = [[x, z], [x, DOOR[1] + dz], [-27, DOOR[1] + dz], door];
        }
        if (kind === 'out') { pts.reverse(); if (wait >= 0) wait = pts.length - 1 - 3; }
      } else if (kind === 'bus') {
        const x = NEAR.c + 0.4 + U.rand(-0.3, 0.6), z = U.rand(Z0 + 2, Z1 - 2);
        pts = [[x, z], [x, BUS + U.rand(-2, 2)]];
      } else {
        /* 公園散步 */
        const x = 40 + U.rand(-0.9, 0.9), dir = Math.random() < 0.5 ? 1 : -1;
        pts = Math.random() < 0.6 ? [[x, endZ(-dir)], [x, endZ(dir)]] : [[24.5, -32 + U.rand(-0.9, 0.9)], [89, -32 + U.rand(-0.9, 0.9)]];
        if (Math.random() < 0.5) pts.reverse();
      }
      return { pts, seg: 0, d: 0, v: U.rand(1.15, 1.55), wait, slot: pedFree.pop(), ph: Math.random() * 6, stay: kind === 'bus' ? U.rand(20, 60) : 0 };
    }
    /** 在路口等紅燈：走到路緣（這一段還沒開始走）且行人燈不是綠燈 */
    const waiting = (p, canWalk) => p.seg === p.wait && p.d < 0.01 && !canWalk;

    /* ---------- 車輛 ---------- */
    const VT = {
      car: { len: 4.5, w: 1.8, h: 0.8, cab: 0.62, cabLen: 0.55, v: [10, 14], cols: ['#e8e8e8', '#2b2f33', '#8a959e', '#b33a3a', '#2f5d8a', '#d9d4c7', '#3f6f48', '#c0c6cb'] },
      taxi: { len: 4.6, w: 1.8, h: 0.8, cab: 0.62, cabLen: 0.55, v: [10, 14], cols: ['#f2c14e'] },
      suv: { len: 4.8, w: 1.9, h: 1.0, cab: 0.75, cabLen: 0.62, v: [10, 13], cols: ['#1f2327', '#e8e8e8', '#5d666d', '#7a2f2f'] },
      bus: { len: 12, w: 2.5, h: 2.6, cab: 0.45, cabLen: 0.94, v: [8, 10], cols: ['#2f8f6f', '#3a6fb8'] },
      scooter: { len: 1.9, w: 0.7, h: 0.55, cab: 0, cabLen: 0, v: [9, 13], cols: ['#e8e8e8', '#b33a3a', '#2f5d8a', '#1f2327', '#f2c14e', '#8a959e'], rider: true },
    };
    const MAXV = 48;
    const vBody = inst(unit, whiteM(), MAXV, () => '#ffffff');
    const vCab = inst(unit, mat(K.std('#1d2730', { metalness: 0.4, roughness: 0.25 })), MAXV);
    const vUnder = inst(unit, mat(K.std('#141719', { roughness: 0.9 })), MAXV);
    const headM = mat(new T.MeshBasicMaterial({ color: C('#fff4d6') }));
    const tailM = mat(new T.MeshBasicMaterial({ color: C('#ff3b30') }));
    const vHead = inst(unit, headM, MAXV * 2), vTail = inst(unit, tailM, MAXV * 2);
    const rBody = inst(bodyG, whiteM(), MAXV, (i) => SHIRT[Math.floor(hash(i * 9.1) * SHIRT.length)]);
    const rHead = inst(new T.SphereGeometry(0.17, 10, 8).translate(0, 1.47, 0), mat(K.std('#ffffff', { roughness: 0.5 })), MAXV, (i) => ['#e8e8e8', '#2b2f33', '#b33a3a', '#f2c14e', '#2f5d8a'][Math.floor(hash(i * 4.3) * 5)]);
    const cars = [];
    const vFree = [];
    for (let i = MAXV - 1; i >= 0; i--) vFree.push(i);
    const laneLast = LANES.map(() => null);
    const tc = new T.Color();
    function newCar(li) {
      const L = LANES[li];
      const r = Math.random();
      const type = L.curb ? (r < 0.62 ? 'scooter' : r < 0.72 ? 'bus' : r < 0.86 ? 'taxi' : 'car') : (r < 0.08 ? 'bus' : r < 0.22 ? 'taxi' : r < 0.42 ? 'suv' : r < 0.52 ? 'scooter' : 'car');
      const vt = VT[type];
      const slot = vFree.pop();
      tc.copy(C(vt.cols[Math.floor(Math.random() * vt.cols.length)]));
      vBody.setColorAt(slot, tc);
      vBody.instanceColor.needsUpdate = true;
      return { li, type, vt, z: L.dir > 0 ? Z0 - vt.len : Z1 + vt.len, v: U.rand(vt.v[0], vt.v[1]), vmax: U.rand(vt.v[0], vt.v[1]), slot, x: L.x + (type === 'scooter' ? U.rand(-0.7, 0.7) : 0), busStop: type === 'bus' && L.dir < 0 && L.curb ? 0 : -1 };
    }

    /* ---------- 密度：跟著遊戲時間 ---------- */
    let hour = 9, weekend = false, night = 0, pedTarget = 20, carRate = 0.5;
    const PED = [3, 2, 1, 1, 1, 2, 5, 14, 34, 22, 12, 12, 30, 20, 12, 12, 14, 24, 34, 18, 10, 7, 5, 4];
    const CAR = [0.12, 0.08, 0.06, 0.06, 0.08, 0.15, 0.35, 0.8, 1, 0.7, 0.55, 0.55, 0.65, 0.6, 0.55, 0.6, 0.7, 0.9, 1, 0.75, 0.55, 0.4, 0.3, 0.2];
    function pedMix() {
      const r = Math.random();
      if (!weekend && hour >= 7.3 && hour < 9.6) return r < 0.62 ? 'in' : r < 0.75 ? 'cross' : r < 0.85 ? 'bus' : 'walk';
      if (!weekend && hour >= 17.3 && hour < 19.6) return r < 0.6 ? 'out' : r < 0.75 ? 'cross' : r < 0.85 ? 'bus' : 'walk';
      if (!weekend && hour >= 11.8 && hour < 13.4) return r < 0.25 ? 'out' : r < 0.45 ? 'in' : r < 0.6 ? 'park' : r < 0.78 ? 'cross' : 'walk';
      return r < 0.5 ? 'walk' : r < 0.72 ? 'cross' : r < 0.85 ? 'bus' : 'park';
    }

    /** 每次同步：遊戲時間 → 目標人數與車流；夜晚程度 → 路燈、車燈、窗戶 */
    function sync(t, nightK) {
      hour = U.hourOf(t);
      weekend = U.isWeekend(t);
      night = nightK;
      const i = Math.floor(hour), f = hour - i;
      pedTarget = U.lerp(PED[i], PED[(i + 1) % 24], f) * (weekend ? (hour > 10 && hour < 20 ? 0.8 : 0.5) : 1) * (weekend && hour >= 7 && hour < 10 ? 0.4 : 1);
      carRate = U.lerp(CAR[i], CAR[(i + 1) % 24], f) * (weekend ? 0.7 : 1);
      lampHeadM.color.copy(C('#6d7479')).lerp(C('#ffe2a8'), night);
      poolM.opacity = night * 0.55;
      headM.color.copy(C('#8b8f8f')).lerp(C('#fff4d6'), 0.35 + night * 0.65);
      tailM.color.copy(C('#6e1f1a')).lerp(C('#ff3b30'), 0.4 + night * 0.6);
      for (const m of blockMats) m.emissiveIntensity = night * 1.1;
    }

    /* ---------- 每幀 ---------- */
    let spawnAcc = 0, prevPhase = '';
    const laneAcc = LANES.map(() => Math.random());
    function tick(dt, t) {
      if (dt <= 0) return;
      dt = Math.min(dt, 0.1);
      const ph = phase(t);
      /* 紅綠燈 */
      const key = ph.car + ph.ped + (ph.ped === 'f' ? (Math.sin(t * 8) > 0 ? 1 : 0) : '');
      if (key !== prevPhase) {
        prevPhase = key;
        lampMats.r.color.copy(ph.car === 'r' ? LIT.r : OFF);
        lampMats.y.color.copy(ph.car === 'y' ? LIT.y : OFF);
        lampMats.g.color.copy(ph.car === 'g' ? LIT.g : OFF);
        const pedGreen = ph.ped === 'g' || (ph.ped === 'f' && Math.sin(t * 8) > 0);
        lampMats.pr.color.copy(ph.ped === 'r' ? LIT.pr : OFF);
        lampMats.pg.color.copy(pedGreen ? LIT.pg : OFF);
      }
      /* 行人 */
      spawnAcc += dt * Math.max(0.1, pedTarget) / 25;
      while (spawnAcc >= 1 && pedFree.length && peds.length < Math.round(pedTarget) + 2) { spawnAcc -= 1; peds.push(newPed(pedMix())); }
      if (spawnAcc > 1) spawnAcc = 1;
      const canWalk = ph.ped === 'g';
      for (let i = peds.length - 1; i >= 0; i--) {
        const p = peds[i];
        if (p.seg >= p.pts.length - 1) {
          if (p.stay > 0) { p.stay -= dt; continue; }
          for (const im of [pPants, pBody, pHead]) setM(im, p.slot, 0, -50, 0, 0, 0, 0);
          pedFree.push(p.slot);
          peds.splice(i, 1);
          continue;
        }
        if (waiting(p, canWalk)) continue;
        const a = p.pts[p.seg], b = p.pts[p.seg + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.01;
        /* 行人燈閃爍時，還在斑馬線上的人加快腳步 */
        p.d += p.v * dt * (p.seg === p.wait && ph.ped !== 'g' ? 1.6 : 1);
        if (p.d >= L) { p.d -= L; p.seg++; }
      }
      for (const p of peds) {
        const s0 = Math.min(p.seg, p.pts.length - 2);
        const a = p.pts[s0], b = p.pts[s0 + 1];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.01;
        const k = p.seg >= p.pts.length - 1 ? 1 : Math.min(1, p.d / L);
        const x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k;
        const moving = !waiting(p, canWalk) && p.seg < p.pts.length - 1;
        const bob = moving ? Math.abs(Math.sin(t * 7 + p.ph)) * 0.05 : 0;
        const y = (x > ROAD.x0 && x < ROAD.x1) ? 0.03 : 0.14;
        const ry = Math.atan2(b[0] - a[0], b[1] - a[1]);
        for (const im of [pPants, pBody, pHead]) setM(im, p.slot, x, y + (im === pPants ? 0 : bob), z, 1, im === pPants && moving ? 1 - bob * 2 : 1, 1, ry);
      }
      pPants.instanceMatrix.needsUpdate = pBody.instanceMatrix.needsUpdate = pHead.instanceMatrix.needsUpdate = true;

      /* 車輛：跟車、停紅燈、公車靠站 */
      LANES.forEach((Ln, li) => {
        laneAcc[li] += dt * carRate * (Ln.curb ? 0.45 : 0.32);
        const last = laneLast[li];
        const clear = !last || cars.indexOf(last) < 0 || (Ln.dir > 0 ? last.z - Z0 : Z1 - last.z) > last.vt.len + 6;
        if (laneAcc[li] >= 1 && clear && vFree.length) { laneAcc[li] = 0; const c = newCar(li); cars.push(c); laneLast[li] = c; }
        else if (laneAcc[li] > 1.5) laneAcc[li] = 1.5;
      });
      const byLane = LANES.map(() => []);
      for (const c of cars) byLane[c.li].push(c);
      for (const list of byLane) {
        if (!list.length) continue;
        const dir = LANES[list[0].li].dir;
        list.sort((p, q) => (dir > 0 ? q.z - p.z : p.z - q.z));
        for (let k = 0; k < list.length; k++) {
          const c = list[k], ahead = k > 0 ? list[k - 1] : null;
          let limit = Infinity;
          if (ahead) limit = (dir > 0 ? ahead.z - c.z : c.z - ahead.z) - (ahead.vt.len + c.vt.len) / 2 - 1.8;
          const front = c.z + dir * c.vt.len / 2;
          const stopZ = STOP[dir];
          const before = dir > 0 ? front <= stopZ + 0.2 : front >= stopZ - 0.2;
          /* 路口淨空：斑馬線另一頭排不下這台車，就算綠燈也先停在停止線前 */
          let boxBlocked = false;
          if (before && ahead && ahead.v < 3) {
            const exitZ = dir > 0 ? XW.z1 + 0.5 : XW.z0 - 0.5;
            const aheadRear = ahead.z - dir * ahead.vt.len / 2;
            const room = dir > 0 ? aheadRear - exitZ : exitZ - aheadRear;
            if (room < c.vt.len + 1.8) boxBlocked = true;
          }
          if (before && (ph.car !== 'g' || boxBlocked)) {
            const dist = dir > 0 ? stopZ - front : front - stopZ;
            if (ph.car === 'r' || boxBlocked || dist > c.v * 1.2) limit = Math.min(limit, dist);
          }
          if (c.busStop === 0) {
            const dist = (c.z - c.vt.len / 2) - (BUS - 3);
            if (dist <= 0.2) { c.busStop = U.rand(5, 9); }
            else limit = Math.min(limit, dist);
          } else if (c.busStop > 0) { c.busStop -= dt; limit = 0; if (c.busStop <= 0) c.busStop = -1; }
          const want = limit <= 0.3 ? 0 : Math.min(c.vmax, Math.sqrt(Math.max(0, limit) * 6));
          c.v += U.clamp(want - c.v, -8 * dt, 3 * dt);
          if (c.v < 0) c.v = 0;
          c.z += dir * Math.min(c.v * dt, Math.max(0, limit));
        }
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i], dir = LANES[c.li].dir;
        if ((dir > 0 && c.z > Z1 + c.vt.len) || (dir < 0 && c.z < Z0 - c.vt.len)) { vFree.push(c.slot); cars.splice(i, 1); }
      }
      for (const c of cars) {
        const dir = LANES[c.li].dir, vt = c.vt;
        /* 剖面切在 z = 11，超出的部分不畫 */
        const vis = c.z - vt.len / 2 < Z1 && c.z + vt.len / 2 > Z0;
        const s = vis ? 1 : 0;
        const sc = c.slot;
        setM(vBody, sc, c.x, 0.35 + vt.h / 2 + (vt.rider ? 0 : 0.1), c.z, vt.w * s, vt.h * s, vt.len * s);
        setM(vUnder, sc, c.x, 0.3, c.z, vt.w * 0.9 * s, vt.rider ? 0.5 * s : 0.45 * s, vt.len * 0.84 * s);
        setM(vCab, sc, c.x, 0.45 + vt.h + vt.cab / 2, c.z - dir * vt.len * (vt.type === 'bus' ? 0 : 0.06), vt.w * 0.92 * s * (vt.cab ? 1 : 0), vt.cab * s, vt.len * vt.cabLen * s);
        const fz = c.z + dir * (vt.len / 2 + 0.02), bz = c.z - dir * (vt.len / 2 + 0.02);
        const lw = vt.rider ? 0 : vt.w / 2 - 0.25;
        setM(vHead, sc * 2, c.x - lw, 0.62, fz, 0.32 * s, 0.14 * s, 0.05 * s);
        setM(vHead, sc * 2 + 1, c.x + lw, 0.62, fz, (vt.rider ? 0 : 0.32) * s, 0.14 * s, 0.05 * s);
        setM(vTail, sc * 2, c.x - lw, 0.7, bz, 0.26 * s, 0.12 * s, 0.05 * s);
        setM(vTail, sc * 2 + 1, c.x + lw, 0.7, bz, (vt.rider ? 0 : 0.26) * s, 0.12 * s, 0.05 * s);
        if (vt.rider) { setM(rBody, sc, c.x, 0.2, c.z - dir * 0.15, s, 0.85 * s, s); setM(rHead, sc, c.x, 0.2, c.z - dir * 0.15, s, 0.85 * s, s); }
        else { setM(rBody, sc, 0, -50, 0, 0, 0, 0); setM(rHead, sc, 0, -50, 0, 0, 0, 0); }
      }
      /* 空的車位藏起來 */
      const used = new Set(cars.map((c) => c.slot));
      for (let sc = 0; sc < MAXV; sc++) {
        if (used.has(sc)) continue;
        for (const im of [vBody, vUnder, vCab, rBody, rHead]) setM(im, sc, 0, -50, 0, 0, 0, 0);
        for (const im of [vHead, vTail]) { setM(im, sc * 2, 0, -50, 0, 0, 0, 0); setM(im, sc * 2 + 1, 0, -50, 0, 0, 0, 0); }
      }
      for (const im of [vBody, vUnder, vCab, vHead, vTail, rBody, rHead]) im.instanceMatrix.needsUpdate = true;
    }

    /* 除錯用：在主控台可以從場景找到街景的狀態 */
    root.userData.city = { cars, peds, phase, STOP, XW };
    return {
      obj: root, sync, tick,
      stats: () => ({ peds: peds.length, cars: cars.length, pedTarget, carRate }),
      dispose() { for (const m of own) m.dispose(); winT.dispose(); litT.dispose(); glowT.dispose(); },
    };
  };
})(window.G = window.G || {});
