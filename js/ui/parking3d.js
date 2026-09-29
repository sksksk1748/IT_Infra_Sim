/* 3D 員工停車場（B2）：結構柱、停車格標線、往地面的車道、柵欄機與車牌辨識攝影機、電動車充電樁、PoE 監視器、
 * 停好的汽車與機車（跟著上下班時段增減）、進出車道的車子（柵欄機連不上系統時就在閘門前回堵）、
 * 走向電梯廳的人（手機亮綠燈 = 打卡成功、紅燈 = 打卡失敗）。
 * 由 floor3d 在停車場樓層呼叫：M3.parking(ctx) → { sync(st), tick(dt, t), tip(p), dispose() }
 * 座標：平面圖 (x, y) → 世界 (wx(x), 高度, wz(y))，1 格 = 1 m。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  if (!M3) return;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const CAR = ['#f2f3f3', '#c8ccd0', '#2a2e33', '#8d949a', '#f2f3f3', '#1f3552', '#c0392b', '#d8d2c4', '#5b6770', '#f2f3f3', '#3b4a3f', '#7b1f24'];
  const BIKE = ['#f2f3f3', '#c8ccd0', '#2a2e33', '#c0392b', '#3f6f8f', '#e8c547', '#8fb3c9', '#f2f3f3', '#6d8f5a'];
  const SHIRT = ['#5aa9f0', '#e8e4dc', '#43c59e', '#f2c14e', '#8f7cf0', '#e86fa8', '#2f3a44', '#c85a4a', '#9aa7ad', '#3f6f8f'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b65', '#8d5a3f', '#f6d7bd'];
  const noop = () => {};
  const RAMP_H = 3.2;

  /** 停車場的車位使用率（0～1）：早上陸續停滿、傍晚陸續開走、半夜只剩幾台 */
  M3.parkFill = (t) => {
    const h = U.hourOf(t);
    const up = U.clamp((h - 7.2) / 2.2, 0, 1), down = U.clamp((h - 17.3) / 2.6, 0, 1);
    const v = 0.04 + 0.9 * up * (1 - 0.88 * down);
    return U.isWeekend(t) ? Math.min(v, 0.1) : v;
  };

  M3.parking = (ctx) => {
    const { api, K, fx, L, fid, root, wx, wz, batch } = ctx;
    const T = api.T, TY = L.T, W = L.W, H = L.H;
    const f = G.BLD.byId[fid], ft = G.FT[f.type];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? TY.EXT : L.type[y * W + x]);
    const C = (hex) => K.col(hex);
    const dummy = new T.Object3D();
    const mats = [], geos = [];
    const own = (m) => { mats.push(m); return m; };
    const g = new T.Group();
    root.add(g);
    const tags = [];
    const tag = (text, cls, align, prio) => { const x = api.tag(text, cls, align, prio); tags.push(x); return x; };

    /* ---------- 標線、結構柱、燈管、風管 ---------- */
    const B = {
      paint: batch(own(K.std('#e9ecee', { roughness: 0.6 })), null),
      evPaint: batch(own(K.std('#2f8f5a', { roughness: 0.7 })), null),
      yellow: batch(own(K.std('#e8c547', { roughness: 0.6 })), null),
      pillar: batch(own(K.std('#9aa2a8', { roughness: 0.92, metalness: 0.02 })), { kind: 'pillar' }),
      hazard: batch(own(K.std('#e8c547', { roughness: 0.6 })), { kind: 'pillar' }),
      hazardDk: batch(own(K.std('#23272b', { roughness: 0.6 })), { kind: 'pillar' }),
      lamp: batch(own(K.glow('#eaf4ff', 1.15)), null),
      duct: batch(own(K.std('#7d868c', { metalness: 0.5, roughness: 0.5 })), null),
      wall: batch(own(K.std('#6b7378', { roughness: 0.95 })), null),
      ramp: batch(own(K.std('#3a4046', { roughness: 0.95 })), { kind: 'ramp' }),
      dark: batch(own(K.std('#1e252b', { metalness: 0.4, roughness: 0.5 })), null),
      post: batch(own(K.std('#e8c547', { metalness: 0.2, roughness: 0.5 })), { kind: 'gate' }),
      ev: batch(own(K.std('#e9ecee', { metalness: 0.2, roughness: 0.5 })), { kind: 'ev' }),
      cam: batch(own(K.std('#f1f3f4', { metalness: 0.2, roughness: 0.5 })), { kind: 'cam' }),
    };
    /* 停車格：兩側白線 + 靠牆那一端；充電位漆成綠色 */
    for (const sp of L.spaces) {
      const xa = wx(sp.x0) - 0.5, xb = wx(sp.x1) + 0.5, za = wz(sp.y0) - 0.5, zb = wz(sp.y1) + 0.5;
      B.paint.add(xa, 0.012, (za + zb) / 2, 0.1, 0.01, zb - za);
      B.paint.add(xb, 0.012, (za + zb) / 2, 0.1, 0.01, zb - za);
      B.paint.add((xa + xb) / 2, 0.012, sp.dir === 'N' ? za + 0.05 : zb - 0.05, xb - xa, 0.01, 0.1);
      if (sp.ev) B.evPaint.add((xa + xb) / 2, 0.01, (za + zb) / 2, xb - xa - 0.3, 0.008, zb - za - 0.3);
    }
    /* 機車格：每一排的前緣畫白線 */
    const bikeSlots = [];
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W; x++) {
        if (at(x, y) !== TY.MOTO || at(x, y + 1) !== TY.MOTO || at(x, y - 1) === TY.MOTO) continue;
        bikeSlots.push({ x: wx(x), z: (wz(y) + wz(y + 1)) / 2 });
      }
    }
    for (const r of L.rooms.filter((q) => q.kind === TY.MOTO)) {
      for (let y = r.y0; y <= r.y1; y++) {
        let x0 = -1;
        for (let x = r.x0; x <= r.x1 + 1; x++) {
          const on = x <= r.x1 && at(x, y) === TY.MOTO && at(x, y - 1) !== TY.MOTO;
          if (on && x0 < 0) x0 = x;
          if (!on && x0 >= 0) { B.paint.add((wx(x0) + wx(x - 1)) / 2, 0.012, wz(y) - 0.5, x - x0, 0.01, 0.08); x0 = -1; }
        }
      }
    }
    /* 結構柱：1m 見方的鋼筋混凝土柱，底部漆黃黑警示 */
    const pillars = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (at(x, y) !== TY.PILLAR) continue;
        const px = wx(x), pz = wz(y);
        pillars.push([px, pz]);
        B.pillar.add(px, 1.6, pz, 0.8, 3.2, 0.8);
        B.hazard.add(px, 0.15, pz, 0.84, 0.3, 0.84);
        B.hazardDk.add(px, 0.42, pz, 0.84, 0.24, 0.84);
        B.hazard.add(px, 0.66, pz, 0.84, 0.24, 0.84);
      }
    }
    /* 車道燈管與天花板下的排風管（沿著北、南兩條車道） */
    for (const zc of [wz(8) + 0.5, wz(25)]) {
      for (let x = -30; x <= 32; x += 3.2) B.lamp.add(x, 2.78, zc, 1.3, 0.05, 0.12);
      B.duct.add(1, 3.1, zc + 1.3, 64, 0.3, 0.5);
    }
    for (let x = -34; x <= -26; x += 3.2) B.lamp.add(x, 2.78, wz(19), 1.3, 0.05, 0.12);
    for (let x = 12; x <= 32; x += 3.2) B.lamp.add(x, 2.78, wz(17), 1.3, 0.05, 0.12);

    /* ---------- 往地面的車道：斜坡 + 中間分隔島 ---------- */
    const rx0 = wx(1) - 0.5, rx1 = wx(13) + 0.5, rz0 = wz(1) - 0.5, rz1 = wz(5) + 0.5;
    const rampLen = Math.hypot(rx1 - rx0, RAMP_H), rampAng = Math.atan2(RAMP_H, rx1 - rx0);
    const ramp = new T.Mesh(new T.BoxGeometry(rampLen, 0.2, rz1 - rz0), own(K.std('#3a4046', { roughness: 0.95 })));
    geos.push(ramp.geometry);
    ramp.position.set((rx0 + rx1) / 2, RAMP_H / 2 - 0.1, (rz0 + rz1) / 2);
    ramp.rotation.z = -rampAng;
    ramp.userData.pick = { kind: 'ramp' };
    g.add(ramp);
    const island = new T.Mesh(new T.BoxGeometry(rampLen, 0.18, 0.5), own(K.std('#e8c547', { roughness: 0.6 })));
    geos.push(island.geometry);
    island.position.set((rx0 + rx1) / 2, RAMP_H / 2 + 0.05, wz(3));
    island.rotation.z = -rampAng;
    island.raycast = noop;
    g.add(island);
    /* 斜坡兩側的擋土牆 */
    for (const zz of [rz0 - 0.1, rz1 + 0.1]) B.wall.add((rx0 + rx1) / 2, 1.6, zz, rx1 - rx0, 3.2, 0.2);
    const rampY = (x) => U.clamp((rx1 - x) / (rx1 - rx0), 0, 1) * RAMP_H;

    /* ---------- 柵欄機 + 車牌辨識攝影機 ---------- */
    const gates = L.gates.map((gt) => {
      const gx = wx(gt.x), gz = wz(gt.y);
      const side = gt.lane === 'in' ? -1 : 1;
      const hz = gz + side * 0.95;
      B.post.add(gx, 0.55, hz, 0.36, 1.1, 0.32);
      B.dark.add(gx - 0.9, 1.0, hz + side * 0.1, 0.1, 2.0, 0.1);
      B.cam.add(gx - 0.95, 2.02, hz, 0.36, 0.22, 0.22);
      const pivot = new T.Group();
      pivot.position.set(gx, 1.02, hz);
      const arm = new T.Mesh(new T.BoxGeometry(0.09, 0.09, 1.9), own(K.std('#e8412f', { roughness: 0.5 })));
      geos.push(arm.geometry);
      arm.position.z = -side * 0.95;
      arm.userData.pick = { kind: 'gate' };
      pivot.add(arm);
      g.add(pivot);
      const light = new T.Mesh(new T.SphereGeometry(0.07, 10, 8), own(K.glow('#3fe07a', 1.8)));
      geos.push(light.geometry);
      light.position.set(gx, 1.2, hz);
      light.raycast = noop;
      g.add(light);
      return { lane: gt.lane, x: gx, z: gz, pivot, light, open: 0, want: 0 };
    });
    const gateTag = tag('柵欄機 · 車牌辨識', 'info', 'center', 2);
    gateTag.pos.set(wx(14), 2.8, wz(3));

    /* ---------- 電動車充電樁（靠北牆） ---------- */
    const evLights = [];
    for (const e of L.ev) {
      const ex = wx(e.x), ez = wz(e.y) - 0.3;
      B.ev.add(ex, 0.75, ez, 0.5, 1.5, 0.28);
      B.dark.add(ex, 1.05, ez + 0.15, 0.3, 0.36, 0.02);
      evLights.push([ex, 1.3, ez + 0.15]);
    }
    const evLed = new T.InstancedMesh(new T.BoxGeometry(0.26, 0.05, 0.02), own(new T.MeshBasicMaterial({ color: 0xffffff })), Math.max(1, evLights.length));
    geos.push(evLed.geometry);
    evLights.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); evLed.setMatrixAt(i, dummy.matrix); evLed.setColorAt(i, C('#3fe07a')); });
    evLed.count = evLights.length;
    evLed.raycast = noop;
    g.add(evLed);

    /* ---------- 監視器：每根柱子上一台，對著車道；沒有 PoE / 沒有埠的會亮紅燈 ---------- */
    const camPts = pillars.slice(0, ft.cams || 0).map((p, i) => [p[0], 2.72, p[1] + (i % 2 ? 0.48 : -0.48)]);
    for (const p of camPts) { B.cam.add(p[0], p[1], p[2], 0.2, 0.2, 0.34); B.dark.add(p[0], p[1] - 0.06, p[2] + (p[2] > 0 ? 0.18 : -0.18), 0.12, 0.1, 0.06); }
    const camLed = new T.InstancedMesh(new T.SphereGeometry(0.035, 8, 6), own(new T.MeshBasicMaterial({ color: 0xffffff })), Math.max(1, camPts.length));
    geos.push(camLed.geometry);
    camPts.forEach((p, i) => { dummy.position.set(p[0] + 0.12, p[1] + 0.05, p[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); camLed.setMatrixAt(i, dummy.matrix); camLed.setColorAt(i, C('#3fe07a')); });
    camLed.count = camPts.length;
    camLed.raycast = noop;
    g.add(camLed);

    for (const b of Object.values(B)) b.build(g);

    /* ---------- 車子：車身 + 車窗；停好的車依固定的亂數順序停進車格 ---------- */
    const bodyG = new T.BoxGeometry(1.8, 0.62, 4.3); bodyG.translate(0, 0.52, 0);
    const cabG = new T.BoxGeometry(1.58, 0.52, 2.2); cabG.translate(0, 1.08, 0.25);
    const bikeG = new T.BoxGeometry(0.34, 0.5, 1.55); bikeG.translate(0, 0.5, 0);
    const bikeTopG = new T.BoxGeometry(0.3, 0.14, 0.7); bikeTopG.translate(0, 0.82, 0.18);
    geos.push(bodyG, cabG, bikeG, bikeTopG);
    const glassM = own(K.std('#1b2733', { metalness: 0.5, roughness: 0.15 }));
    const mkInst = (geo, n, mat, pick) => {
      const m = new T.InstancedMesh(geo, mat, Math.max(1, n));
      m.frustumCulled = false;
      if (pick) { m.userData.pick = pick; m.userData.pickPoint = true; } else m.raycast = noop;
      g.add(m);
      return m;
    };
    const nSp = L.spaces.length;
    const cars = mkInst(bodyG, nSp, own(K.std('#ffffff', { metalness: 0.55, roughness: 0.35 })), { kind: 'car' });
    const cabs = mkInst(cabG, nSp, glassM, { kind: 'car' });
    /* 注意：three r128 的 setColorAt 以 mesh.count 配置顏色緩衝區，要先上色、之後才把 count 歸零 */
    for (let i = 0; i < nSp; i++) cars.setColorAt(i, C(CAR[Math.floor(hash(i * 3.1 + 7) * CAR.length)]));
    const nBk = bikeSlots.length;
    const bikes = mkInst(bikeG, nBk, own(K.std('#ffffff', { metalness: 0.4, roughness: 0.45 })), { kind: 'moto' });
    const seats = mkInst(bikeTopG, nBk, own(K.std('#1e252b', { roughness: 0.7 })), { kind: 'moto' });
    for (let i = 0; i < nBk; i++) bikes.setColorAt(i, C(BIKE[Math.floor(hash(i * 2.7 + 3) * BIKE.length)]));
    cars.count = cabs.count = bikes.count = seats.count = 0;
    const carOrder = L.spaces.map((s, i) => i).sort((a, b) => hash(a * 7.3 + 1) - hash(b * 7.3 + 1));
    const bikeOrder = bikeSlots.map((s, i) => i).sort((a, b) => hash(a * 5.9 + 2) - hash(b * 5.9 + 2));
    function park(nc, nb) {
      for (let k = 0; k < nc; k++) {
        const sp = L.spaces[carOrder[k]];
        const cx = (wx(sp.x0) + wx(sp.x1)) / 2, cz = (wz(sp.y0) + wz(sp.y1)) / 2;
        dummy.position.set(cx, 0, cz); dummy.rotation.set(0, sp.dir === 'N' ? 0 : Math.PI, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        cars.setMatrixAt(k, dummy.matrix); cabs.setMatrixAt(k, dummy.matrix);
      }
      for (let k = 0; k < nb; k++) {
        const s = bikeSlots[bikeOrder[k]];
        dummy.position.set(s.x, 0, s.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        bikes.setMatrixAt(k, dummy.matrix); seats.setMatrixAt(k, dummy.matrix);
      }
      cars.count = cabs.count = nc;
      bikes.count = seats.count = nb;
      for (const m of [cars, cabs, bikes, seats]) m.instanceMatrix.needsUpdate = true;
    }

    /* ---------- 進出車道的車子：柵欄機比對車牌後抬桿；連不上系統就一台台卡在閘門前 ---------- */
    const MOV = 8;
    const mBody = mkInst(bodyG, MOV, own(K.std('#ffffff', { metalness: 0.55, roughness: 0.35 })), { kind: 'car' });
    const mCab = mkInst(cabG, MOV, glassM, null);
    for (let i = 0; i < MOV; i++) mBody.setColorAt(i, C(CAR[(i * 5 + 2) % CAR.length]));
    mBody.count = mCab.count = 0;
    const movers = [];
    const inGate = gates.find((x) => x.lane === 'in'), outGate = gates.find((x) => x.lane === 'out');
    let spawnIn = 0, spawnOut = 0;

    /* ---------- 走向電梯廳的人：手機亮綠燈 = 打卡成功，紅燈 = 失敗 ---------- */
    const WALK = 40;
    const standBody = new T.CylinderGeometry(0.17, 0.21, 0.92, 10); standBody.translate(0, 0.96, 0);
    const standHead = new T.SphereGeometry(0.12, 12, 9); standHead.translate(0, 1.56, 0);
    const phoneG = new T.BoxGeometry(0.09, 0.15, 0.02); phoneG.translate(0, 1.3, 0.24);
    geos.push(standBody, standHead, phoneG);
    const pB = mkInst(standBody, WALK, own(K.std('#ffffff', { roughness: 0.8 })), { kind: 'walker' });
    const pH = mkInst(standHead, WALK, own(K.std('#ffffff', { roughness: 0.7 })), { kind: 'walker' });
    const pP = mkInst(phoneG, WALK, own(new T.MeshBasicMaterial({ color: 0xffffff })), null);
    for (let i = 0; i < WALK; i++) {
      pB.setColorAt(i, C(SHIRT[Math.floor(hash(i * 3.3 + 4) * SHIRT.length)]));
      pH.setColorAt(i, C(SKIN[Math.floor(hash(i * 1.7 + 5) * SKIN.length)]));
      pP.setColorAt(i, C('#3fe07a'));
    }
    pB.count = pH.count = pP.count = 0;
    const lobbyDoor = [wx(35) + 0.5, wz(27) + 1.2], lobbyIn = [wx(35) + 0.5, wz(24)];
    const aisleZ = [wz(8) + 0.5, wz(25) + 0.5];
    const walkers = [];
    const PH_OK = C('#3fe07a'), PH_BAD = C('#ff4a3d'), PH_IDLE = C('#9fd8ff');
    function newWalker(toLobby) {
      /* 從停好的車 / 機車出發（或從電梯廳走回去取車） */
      const useBike = hash(Math.random() * 999) < 0.45 && bikeSlots.length;
      let sx, sz;
      if (useBike) { const s = bikeSlots[Math.floor(Math.random() * bikeSlots.length)]; sx = s.x; sz = s.z + 1.3; }
      else { const sp = L.spaces[Math.floor(Math.random() * L.spaces.length)]; sx = (wx(sp.x0) + wx(sp.x1)) / 2 + 1.2; sz = sp.dir === 'N' ? wz(sp.y1) + 1 : wz(sp.y0) - 1; }
      const az = Math.abs(sz - aisleZ[0]) < Math.abs(sz - aisleZ[1]) ? aisleZ[0] : aisleZ[1];
      /* 北邊車道的人繞過核心筒西側走到電梯廳門口 */
      const pts = az === aisleZ[0] ? [[sx, sz], [sx, az], [wx(27), az], [wx(27), lobbyDoor[1]], lobbyDoor, lobbyIn] : [[sx, sz], [sx, az], [lobbyDoor[0], az], lobbyDoor, lobbyIn];
      if (!toLobby) pts.reverse();
      const segs = [];
      let len = 0;
      for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(d); len += d; }
      return { pts, segs, len, s: 0, v: 1.15 + Math.random() * 0.4, ok: Math.random() < clockOk, clocked: false };
    }
    function posOn(w, out) {
      let d = w.s;
      for (let i = 0; i < w.segs.length; i++) {
        if (d <= w.segs[i] || i === w.segs.length - 1) {
          const k = w.segs[i] > 0 ? U.clamp(d / w.segs[i], 0, 1) : 1;
          const a = w.pts[i], b = w.pts[i + 1];
          out[0] = a[0] + (b[0] - a[0]) * k; out[1] = a[1] + (b[1] - a[1]) * k; out[2] = Math.atan2(b[0] - a[0], b[1] - a[1]);
          return out;
        }
        d -= w.segs[i];
      }
      return out;
    }

    /* ---------- 標籤 ---------- */
    const clockTag = tag('電梯廳 · 手機打卡', 'info', 'center', 2);
    clockTag.pos.set(lobbyIn[0], 3.3, lobbyIn[1]);

    let sig = '', gateOk = true, camOk = 1, clockOk = 1, parkers = 0, up = true, evSig = '', camSig = '';
    const tmp = [0, 0, 0];
    return {
      sync(st) {
        const s = G.S, fs = s.floors[fid];
        const open = fs.movedIn > 0;
        const fill = open ? M3.parkFill(s.time) * Math.min(1, 0.3 + G.Q.officeStaff() / 6000) : 0;
        const nc = Math.min(nSp, Math.round(fill * nSp)), nb = Math.min(nBk, Math.round(fill * 1.05 * nBk));
        const s2 = nc + ':' + nb;
        if (s2 !== sig) { sig = s2; park(nc, nb); }
        up = !!(st && st.up);
        gateOk = !st || !open ? true : st.gateOk !== false;
        camOk = st ? (st.camOk === undefined ? 1 : st.camOk) : 1;
        clockOk = st ? (st.clockOk === undefined ? 1 : st.clockOk) : 1;
        parkers = st ? st.parkers || 0 : 0;
        for (const gt of gates) gt.light.material.color.copy(C(gateOk ? '#3fe07a' : '#ff4a3d'));
        gateTag.set(!open ? '柵欄機（停車場尚未啟用）' : gateOk ? '柵欄機 ✓ 車牌辨識連線中' : '⚠ 柵欄機連不上系統：車子卡在閘門', !open ? 'info' : gateOk ? 'info' : 'bad');
        const win = G.Net.clockWindow(s.time);
        clockTag.show = open;
        clockTag.set(!up ? '⚠ 電梯廳：沒有網路，無法打卡' : win && parkers > 3 ? (clockOk >= 0.9 ? `電梯廳 · 手機打卡成功 ${U.pct(clockOk)}` : `⚠ 手機打卡成功率只有 ${U.pct(clockOk)}`) : '電梯廳 · 手機打卡', !up || (win && parkers > 3 && clockOk < 0.9) ? 'bad' : 'info');
        /* 充電樁：有網路才能刷卡計費；有車在充電時亮藍燈 */
        const eS = up + ':' + nc;
        if (eS !== evSig) {
          evSig = eS;
          L.ev.forEach((e, i) => { const k = L.spaces.findIndex((sp) => sp.ev && Math.abs((sp.x0 + sp.x1) / 2 - e.x) < 0.6); const busy = carOrder.indexOf(k) >= 0 && carOrder.indexOf(k) < nc; evLed.setColorAt(i, C(!up ? '#ff4a3d' : busy ? '#4aa8ff' : '#3fe07a')); });
          if (evLed.instanceColor) evLed.instanceColor.needsUpdate = true;
        }
        const cS = Math.round(camOk * camPts.length) + ':' + up;
        if (cS !== camSig) {
          camSig = cS;
          const nOk = up ? Math.round(camOk * camPts.length) : 0;
          camPts.forEach((p, i) => camLed.setColorAt(i, C(i < nOk ? '#3fe07a' : '#ff4a3d')));
          if (camLed.instanceColor) camLed.instanceColor.needsUpdate = true;
        }
      },
      tick(dt, t) {
        const s = G.S, open = s.floors[fid].movedIn > 0;
        const h = U.hourOf(s.time), wk = U.isWeekend(s.time);
        const speed = Math.max(1, Math.min(4, s.speed || 1));
        /* 進出的車：早上進場為主、傍晚出場為主 */
        const inRate = open && !wk ? U.clamp(parkers / 150, 0, 1) * (h < 13 ? 1 : 0.25) : 0;
        const outRate = open && !wk ? U.clamp(parkers / 150, 0, 1) * (h >= 13 ? 1 : 0.2) : 0;
        spawnIn += dt * inRate * 0.45 * speed; spawnOut += dt * outRate * 0.4 * speed;
        const EAST = wx(66);
        if (spawnIn >= 1) { spawnIn = 0; if (movers.length < MOV && movers.filter((m) => m.lane === 'in' && m.x < inGate.x - 4).length < 4) movers.push({ lane: 'in', x: rx0 - 1, v: 0 }); }
        if (spawnOut >= 1) { spawnOut = 0; if (movers.length < MOV && movers.filter((m) => m.lane === 'out' && m.x > outGate.x + 4).length < 3) movers.push({ lane: 'out', x: EAST, v: 0 }); }
        /* 閘門：車開到停止線才抬桿（系統正常時）；用「前進方向的座標」p = dir × x 計算，前車在前 */
        for (const gt of gates) gt.want = 0;
        for (const lane of ['in', 'out']) {
          const gt = lane === 'in' ? inGate : outGate, dir = lane === 'in' ? 1 : -1;
          const stopP = dir * gt.x - 1.4, gateP = dir * gt.x;
          const list = movers.filter((m) => m.lane === lane).sort((a, b) => dir * b.x - dir * a.x);
          let prevP = null;
          for (const m of list) {
            const p = dir * m.x;
            const passed = p > gateP - 0.2;
            let limitP = passed ? Infinity : stopP;
            if (!passed && prevP === null && stopP - p < 0.35) { if (gateOk) gt.want = 1; if (gt.open > 0.9) limitP = Infinity; }
            if (prevP !== null) limitP = Math.min(limitP, prevP - 5);
            m.v = Math.min(3.2 * speed, m.v + dt * 4 * speed);
            let np = p + m.v * dt;
            if (np > limitP) { np = Math.max(p, limitP); m.v = 0; }
            m.x = dir * np;
            prevP = np;
          }
        }
        for (const gt of gates) { gt.open = U.clamp(gt.open + (gt.want ? 1 : -1) * dt * 1.6 * speed, 0, 1); gt.pivot.rotation.x = (gt.lane === 'in' ? 1 : -1) * gt.open * Math.PI * 0.47; }
        /* 進場的車開到車道盡頭就「停好了」；出場的車爬上斜坡就離開 */
        for (let i = movers.length - 1; i >= 0; i--) { const m = movers[i]; if ((m.lane === 'in' && m.x > EAST) || (m.lane === 'out' && m.x < rx0 - 2)) movers.splice(i, 1); }
        movers.forEach((m, i) => {
          const z = m.lane === 'in' ? wz(2) : wz(4);
          const onRamp = m.x < rx1;
          /* 過了閘門往東開到北側車道 */
          const zz = !onRamp && m.lane === 'in' ? z + U.clamp((m.x - (rx1 + 3)) / 4, 0, 1) * (wz(8) - z) : !onRamp && m.lane === 'out' ? z + U.clamp((m.x - (rx1 + 3)) / 4, 0, 1) * (wz(9) - z) : z;
          dummy.position.set(m.x, rampY(m.x) + 0.02, zz);
          dummy.rotation.set(0, 0, 0);
          dummy.rotation.y = m.lane === 'in' ? Math.PI / 2 : -Math.PI / 2;
          dummy.rotateX(onRamp ? (m.lane === 'in' ? -1 : 1) * -rampAng : 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mBody.setMatrixAt(i, dummy.matrix); mCab.setMatrixAt(i, dummy.matrix);
        });
        mBody.count = mCab.count = movers.length;
        mBody.instanceMatrix.needsUpdate = mCab.instanceMatrix.needsUpdate = true;
        /* 走路的人 */
        const want = open ? Math.min(WALK, Math.round(parkers * 0.28)) : 0;
        const toLobby = h < 14;
        while (walkers.length < want) { const w = newWalker(toLobby); w.s = Math.random() * w.len * 0.8; walkers.push(w); }
        if (walkers.length > want) walkers.length = want;
        const win = G.Net.clockWindow(s.time);
        walkers.forEach((w, i) => {
          w.s += w.v * dt * Math.min(speed, 2.5);
          if (w.s >= w.len) { walkers[i] = newWalker(toLobby); return; }
          posOn(w, tmp);
          dummy.position.set(tmp[0], 0, tmp[1]); dummy.rotation.set(0, tmp[2], 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
          pB.setMatrixAt(i, dummy.matrix); pH.setMatrixAt(i, dummy.matrix); pP.setMatrixAt(i, dummy.matrix);
          /* 快到電梯廳時打卡：成功亮綠燈、失敗亮紅燈 */
          const near = toLobby ? w.s > w.len * 0.55 : w.s < w.len * 0.3;
          pP.setColorAt(i, !win || !near ? PH_IDLE : w.ok && up ? PH_OK : (Math.sin(t * 9 + i) > 0 ? PH_BAD : PH_IDLE));
        });
        pB.count = pH.count = pP.count = walkers.length;
        pB.instanceMatrix.needsUpdate = pH.instanceMatrix.needsUpdate = pP.instanceMatrix.needsUpdate = true;
        if (pP.instanceColor) pP.instanceColor.needsUpdate = true;
      },
      tip(p) {
        const st = G.R.sim && G.R.sim.floors[fid];
        if (p.kind === 'gate') return ['車道柵欄機 + 車牌辨識攝影機（LPR）', gateOk ? '✓ 連線中：比對員工車牌後自動抬桿' : '⚠ 連不上停車管理系統：柵欄打不開，車子一路回堵到馬路上', '要接有線網路：IDF 接入交換器要留 4 個埠給車道設備'];
        if (p.kind === 'car') return ['員工的車', `汽車停車格 ${L.spaces.length} 格（其中 ${L.ev.length} 格有充電樁）`, '停好車、走向電梯廳時打開 App 打卡'];
        if (p.kind === 'moto') return ['機車停車區', `約 ${bikeSlots.length} 格：台灣上班族很多人騎機車`, '機車族一脫下安全帽就要打卡——停車區也要有 Wi-Fi 訊號'];
        if (p.kind === 'ev') return ['電動車充電樁', up ? '✓ 已連網：用 OCPP 協定連到雲端，刷卡 / App 計費' : '⚠ 充電樁離線：無法刷卡充電', '藍燈 = 有車正在充電'];
        if (p.kind === 'cam') return [`監視器（${ft.cams} 台，PoE 供電）`, camOk >= 1 && up ? '✓ 全部有畫面' : `⚠ 只有 ${Math.round((up ? camOk : 0) * (ft.cams || 0))} 台有畫面：交換器的埠數或 PoE 預算不夠`, '每台約 7 W，畫面錄到保全室的 NVR'];
        if (p.kind === 'pillar') return ['結構柱（鋼筋混凝土）', 'Wi-Fi 穿過一根柱子就衰減約 13 dB：柱子後面容易有訊號死角', '停車場的 AP 常裝在柱子上或車道正上方'];
        if (p.kind === 'ramp') return ['車道（往地面）', '上方車道進場、下方出場，閘門前各有一支車牌辨識攝影機'];
        if (p.kind === 'walker') return ['剛停好車的同事', G.Net.clockWindow(G.S.time) ? (clockOk >= 0.9 ? '手機打卡成功（綠燈）' : `⚠ 打卡成功率 ${U.pct(clockOk)}：紅燈的人打卡失敗，會被記遲到`) : '走向電梯廳', st && st.parkers ? `停車場裡現在約 ${Math.round(st.parkers)} 人` : ''];
        return null;
      },
      dispose() {
        for (const x of tags) x.remove();
        for (const m of mats) m.dispose();
        for (const x of geos) x.dispose();
      },
    };
  };
})(window.G = window.G || {});
