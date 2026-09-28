/* 3D 員工餐廳：廚房設備（爐灶、排油煙罩、洗碗機、備料台、冷凍庫）、廚師與服務人員、
 * 自助餐檯與收銀台（POS）、美食街攤位與燈箱、用餐座位與人潮、排隊、蒸氣與爐火。
 * 由 floor3d 在餐廳樓層呼叫：M3.canteen(ctx) → { sync(st), tick(dt, t), tip(p), dispose() }
 * 座標：平面圖 (x, y) → 世界 (wx(x), 高度, wz(y))，1 格 = 1 m。
 */
(function (G) {
  'use strict';
  const U = G.U, M3 = G.M3;
  if (!M3) return;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const SHIRT = ['#5aa9f0', '#e8e4dc', '#43c59e', '#f2c14e', '#8f7cf0', '#e86fa8', '#2f3a44', '#c85a4a', '#9aa7ad', '#3f6f8f', '#d9d4c7', '#6d8f5a'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b65', '#8d5a3f', '#f6d7bd'];
  const FOOD = ['#d9a441', '#6aa84f', '#c0392b', '#f5e6c8', '#8e5a3c', '#f0d060', '#e67e22', '#9bc26b'];
  const noop = () => {};

  M3.canteen = (ctx) => {
    const { api, K, fx, L, fid, root, wx, wz, batch } = ctx;
    const T = api.T, TY = L.T, W = L.W, H = L.H;
    const f = G.BLD.byId[fid], ft = G.FT[f.type];
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? TY.EXT : L.type[y * W + x]);
    const C = (hex) => K.col(hex);
    const dummy = new T.Object3D();
    const mats = [], geos = [], texs = [];
    const own = (m) => { mats.push(m); return m; };
    const g = new T.Group();
    root.add(g);

    const SPOT = { kind: 'spot' };
    const cylG = new T.CylinderGeometry(0.5, 0.42, 1, 18);
    geos.push(cylG);
    const B = {
      steel: batch(own(K.std('#c9d0d4', { metalness: 0.75, roughness: 0.3 })), SPOT),
      steelDk: batch(own(K.std('#8a949a', { metalness: 0.7, roughness: 0.42 })), SPOT),
      stove: batch(own(K.std('#2a2f33', { metalness: 0.5, roughness: 0.5 })), SPOT),
      hood: batch(own(K.std('#b8c0c5', { metalness: 0.85, roughness: 0.25 })), SPOT),
      pot: batch(own(K.std('#aeb6bb', { metalness: 0.85, roughness: 0.3 })), SPOT, cylG),
      wok: batch(own(K.std('#34393d', { metalness: 0.6, roughness: 0.45 })), SPOT, cylG),
      board: batch(own(K.std('#b88b5a', { roughness: 0.7 })), SPOT),
      table: batch(own(K.std('#e2d6c0', { roughness: 0.55 })), SPOT),
      leg: batch(own(K.std('#4b4f53', { metalness: 0.5, roughness: 0.5 })), SPOT),
      chair: batch(own(K.std('#7a5a40', { roughness: 0.75 })), SPOT),
      glass: batch(own(K.std('#d6ecf7', { transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.1, depthWrite: false })), null),
      food: batch(own(K.std('#ffffff', { roughness: 0.75 })), SPOT),
      crate: batch(own(K.std('#ffffff', { roughness: 0.8 })), SPOT),
      shelf: batch(own(K.std('#9fb2bb', { metalness: 0.6, roughness: 0.4 })), { kind: 'cold' }),
      belt: batch(own(K.std('#1e252b', { metalness: 0.3, roughness: 0.6 })), SPOT),
      lamp: batch(own(K.glow('#ffb35c', 1.3)), null),
      dark: batch(own(K.std('#1e252b', { metalness: 0.4, roughness: 0.5 })), SPOT),
    };
    const burners = [];      /* 爐口：[x, y, z]（爐火與蒸氣） */
    const cookSpots = [];    /* 廚師站位 */
    const counterSpots = []; /* 餐檯、收銀、攤位櫃台的服務人員 */
    const washSpots = [];    /* 洗碗、備料 */
    const seats = [];        /* 用餐座位 { x, z, dx, dz } */
    const queue = [];        /* 排隊位置 */
    const posPts = [];       /* 收銀機螢幕 */

    /* ---------- 廚房 ---------- */
    const rooms = L.rooms.filter((r) => r.kind === TY.KITCHEN);
    for (const r of rooms) {
      const ix0 = r.x0 + 1, ix1 = r.x1 - 1, iy0 = r.y0 + 1, iy1 = r.y1 - 1;
      const xs = wx(ix0) - 0.3, xe = wx(ix1) + 0.3, zb = wz(iy0) - 0.05, zf = wz(iy1) + 0.3;
      const kind = /洗碗/.test(r.label) ? 'wash' : /備料/.test(r.label) ? 'prep' : 'cook';
      const small = ix1 - ix0 < 10;
      if (kind === 'cook') {
        /* 靠後牆一排爐灶，上方一整條排油煙罩 */
        /* 美食街的攤位廚房小：三個爐口、兩位廚師 */
        const n = small ? 3 : Math.max(2, Math.floor((xe - xs) / 1.35));
        const step = (xe - xs) / n;
        for (let k = 0; k < n; k++) {
          const x = xs + (k + 0.5) * step;
          const pot = hash(r.x0 * 7 + k) < 0.35;
          B.stove.add(x, 0.45, zb, step - 0.12, 0.9, 0.85);
          B.steelDk.add(x, 0.905, zb, step - 0.16, 0.02, 0.8);
          if (pot) B.pot.add(x, 1.14, zb, 0.62, 0.46, 0.62);
          else B.wok.add(x, 0.98, zb + 0.05, 0.72, 0.1, 0.72);
          if (small && k >= 2) continue;
          burners.push({ p: [x, 0.93, zb + 0.05], pot });
          cookSpots.push({ x, z: zb + 0.95, dx: 0, dz: -1, hat: true });
        }
        B.hood.add((xs + xe) / 2, 2.45, zb + 0.05, xe - xs + 0.2, 0.42, 1.15);
        B.steelDk.add((xs + xe) / 2, 2.95, zb - 0.1, 0.5, 0.6, 0.5);
        /* 中島備料台（大廚房）或出餐台（攤位） */
        if (!small && iy1 - iy0 >= 5) {
          const cz = (wz(iy0) + wz(iy1)) / 2 + 0.9, len = Math.min(10, xe - xs - 3);
          B.steel.add((xs + xe) / 2, 0.45, cz, len, 0.9, 1.1);
          for (let x = (xs + xe) / 2 - len / 2 + 0.8; x <= (xs + xe) / 2 + len / 2 - 0.8; x += 1.6) {
            B.board.add(x, 0.915, cz, 0.5, 0.03, 0.35);
            B.food.add(x + 0.35, 0.95, cz + 0.2, 0.25, 0.08, 0.2, FOOD[Math.floor(hash(x * 3.1) * FOOD.length)]);
            washSpots.push({ x, z: cz + 0.8, dx: 0, dz: -1, hat: true });
          }
        } else {
          B.steel.add((xs + xe) / 2, 0.45, zf - 0.35, xe - xs - 0.6, 0.9, 0.6);
          washSpots.push({ x: (xs + xe) / 2 + 0.6, z: zf - 1.05, dx: 0, dz: 1, hat: true });
        }
      } else if (kind === 'wash') {
        /* 隧道式洗碗機 + 水槽 + 碗盤架 */
        B.steel.add((xs + xe) / 2 - 1, 0.7, zb + 0.1, Math.min(4.5, xe - xs - 2), 1.4, 0.9);
        B.steelDk.add((xs + xe) / 2 - 1, 1.45, zb + 0.1, Math.min(4.5, xe - xs - 2) + 0.1, 0.1, 0.95);
        B.steel.add(xs + 0.5, 0.45, (zb + zf) / 2, 0.8, 0.9, 3);
        B.dark.add(xs + 0.5, 0.905, (zb + zf) / 2, 0.6, 0.02, 2.6);
        for (let k = 0; k < 3; k++) {
          B.shelf.add(xe - 0.4, 0.2 + k * 0.6, (zb + zf) / 2, 0.5, 0.04, 3.2);
          for (let j = 0; j < 7; j++) B.food.add(xe - 0.4, 0.3 + k * 0.6, (zb + zf) / 2 - 1.4 + j * 0.45, 0.4, 0.14, 0.05, '#f2f2ee');
        }
        washSpots.push({ x: (xs + xe) / 2 - 1, z: zb + 1.05, dx: 0, dz: -1 }, { x: xs + 1.4, z: (zb + zf) / 2, dx: -1, dz: 0 });
      } else {
        /* 備料區：兩張備料台、砧板、一箱箱蔬菜 */
        for (const cz of [zb + 1.1, (zb + zf) / 2 + 1]) {
          B.steel.add((xs + xe) / 2, 0.45, cz, xe - xs - 1.2, 0.9, 0.8);
          for (let x = xs + 1.2; x <= xe - 1.2; x += 1.5) {
            B.board.add(x, 0.915, cz, 0.45, 0.03, 0.32);
            washSpots.push({ x, z: cz + 0.75, dx: 0, dz: -1, hat: true });
          }
        }
        for (let k = 0; k < 6; k++) B.crate.add(xs + 0.4 + (k % 3) * 0.55, 0.15 + Math.floor(k / 3) * 0.3, zf - 0.3, 0.5, 0.28, 0.4, ['#6aa84f', '#e67e22', '#c0392b', '#9bc26b', '#f0d060', '#8e5a3c'][k]);
      }
    }
    /* 冷凍庫：四周不鏽鋼層架 */
    for (const r of L.rooms.filter((x) => x.kind === TY.COLD)) {
      const ix0 = r.x0 + 1, ix1 = r.x1 - 1, iy0 = r.y0 + 1, iy1 = r.y1 - 1;
      for (let k = 0; k < 4; k++) {
        B.shelf.add(wx(ix0) - 0.1, 0.25 + k * 0.5, (wz(iy0) + wz(iy1)) / 2, 0.5, 0.04, iy1 - iy0 + 0.6);
        B.shelf.add(wx(ix1) + 0.1, 0.25 + k * 0.5, (wz(iy0) + wz(iy1)) / 2, 0.5, 0.04, iy1 - iy0 + 0.6);
        for (let j = 0; j < iy1 - iy0; j++) {
          B.crate.add(wx(ix0) - 0.1, 0.4 + k * 0.5, wz(iy0) + j + 0.2, 0.42, 0.22, 0.6, hash(j * 5 + k) < 0.5 ? '#e8eef1' : '#c9d9e0');
          B.crate.add(wx(ix1) + 0.1, 0.4 + k * 0.5, wz(iy0) + j + 0.2, 0.42, 0.22, 0.6, hash(j * 7 + k + 3) < 0.5 ? '#d8e4ea' : '#b7ccd6');
        }
      }
    }

    /* ---------- 餐檯、收銀、攤位櫃台、餐具回收 ---------- */
    const signs = [];
    for (const r of L.rooms.filter((x) => x.kind === TY.SERVE)) {
      const x0 = wx(r.x0) - 0.5, x1 = wx(r.x1) + 0.5, z0 = wz(r.y0) - 0.5, z1 = wz(r.y1) + 0.5;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, lx = x1 - x0, lz = z1 - z0;
      if (r.line) {
        /* 自助餐檯：保溫餐檯 + 一格格菜色 + 防噴罩 + 保溫燈；服務人員在廚房那一側 */
        B.steel.add(cx, 0.45, cz + 0.2, lx, 0.9, 1.1);
        let k = 0;
        for (let x = x0 + 0.45; x <= x1 - 0.45; x += 0.62) B.food.add(x, 0.93, cz + 0.2, 0.52, 0.07, 0.42, FOOD[(k++ * 5 + 3) % FOOD.length]);
        B.glass.add(cx, 1.3, cz + 0.55, lx - 0.2, 0.02, 0.5);
        B.lamp.add(cx, 1.62, cz + 0.2, lx - 0.4, 0.05, 0.12);
        for (let x = x0 + 1.4; x <= x1 - 1; x += 2.6) counterSpots.push({ x, z: z0 - 0.35, dx: 0, dz: 1, hat: true });
        for (let x = x0 + 0.6; x <= x1 - 0.4; x += 0.72) queue.push({ x, z: z1 + 0.55, dx: 0, dz: -1 });
        signs.push({ text: '自助餐 BUFFET', x: cx, y: 2.55, z: z0 - 0.35, w: 6, face: 1 });
      } else if (r.ret) {
        /* 餐具回收：輸送帶 + 疊起來的餐盤 */
        B.steel.add(cx, 0.45, cz, lx, 0.9, lz);
        B.belt.add(cx, 0.92, cz, lx - 0.2, 0.04, Math.min(0.7, lz - 0.2));
        for (let k = 0; k < 5; k++) B.food.add(x0 + 0.4 + k * (lx - 0.8) / 4, 1.0 + (k % 2) * 0.05, cz, 0.36, 0.06 + (k % 3) * 0.05, 0.28, '#e9e2d4');
        washSpots.push({ x: x1 + 0.1, z: cz - (lz / 2) - 0.4, dx: 0, dz: 1 });
      } else if (r.pos) {
        /* 收銀台 / 攤位櫃台：台面 + 收銀機（POS） */
        if (r.stall) {
          B.steel.add(cx, 0.52, cz + 0.05, lx, 1.04, 0.7);
          B.board.add(cx, 1.055, cz + 0.05, lx + 0.05, 0.03, 0.74);
          posPts.push([x0 + 0.9, 1.2, cz + 0.2]);
          counterSpots.push({ x: x0 + 0.9, z: z0 - 0.75, dx: 0, dz: 1 });
          for (let q = 0; q < 3; q++) queue.push({ x: cx + (q - 1) * 0.7, z: z1 + 0.5 + (q % 2) * 0.3, dx: 0, dz: -1 });
          signs.push({ text: r.stall, x: cx, y: 2.35, z: z0 - 0.62, w: Math.min(5.6, lx - 0.6), face: 1 });
        } else {
          B.board.add(cx, 1.02, cz, lx, 0.06, lz);
          B.steelDk.add(cx, 0.5, cz, lx - 0.1, 1, lz - 0.1);
          for (let k = 0; k < 3; k++) {
            posPts.push([x0 + 0.5 + k * (lx - 1) / 2, 1.2, z1 - 0.2]);
            counterSpots.push({ x: x0 + 0.5 + k * (lx - 1) / 2, z: z0 - 0.35, dx: 0, dz: 1 });
          }
          signs.push({ text: '收銀台', x: cx, y: 2.45, z: z1 + 0.02, w: 2.6, face: 1 });
        }
      }
    }
    /* ---------- 用餐區：六人桌，美食街南側另有景觀吧台 ---------- */
    const barRoom = L.rooms.find((r) => r.kind === TY.DINE && r.bar);
    const isDine = (x, y) => at(x, y) === TY.DINE;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (x % 3 !== 1 || y % 3 !== 1) continue;
        if (barRoom && y >= barRoom.y1 - 1 && x >= barRoom.x0 && x <= barRoom.x1) continue;
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) for (let dx = -1; dx <= 1 && ok; dx++) if (!isDine(x + dx, y + dy)) ok = false;
        if (!ok) continue;
        const cx = wx(x), cz = wz(y);
        B.table.add(cx, 0.74, cz, 1.8, 0.05, 0.8);
        B.leg.add(cx, 0.36, cz, 0.08, 0.72, 0.08);
        B.leg.add(cx, 0.02, cz, 0.6, 0.04, 0.4);
        for (const s of [-1, 1]) {
          for (const ox of [-0.6, 0, 0.6]) {
            B.chair.add(cx + ox, 0.45, cz + s * 0.66, 0.42, 0.06, 0.42);
            B.chair.add(cx + ox, 0.72, cz + s * 0.88, 0.42, 0.5, 0.06);
            seats.push({ x: cx + ox, z: cz + s * 0.66, dx: 0, dz: -s });
          }
        }
      }
    }
    if (barRoom) {
      const zb = wz(barRoom.y1) + 0.1;
      const xa = wx(barRoom.x0), xb = wx(barRoom.x1);
      B.table.add((xa + xb) / 2, 1.05, zb, xb - xa, 0.05, 0.5);
      B.leg.add((xa + xb) / 2, 0.52, zb + 0.1, xb - xa, 1.0, 0.08);
      for (let x = xa + 0.4; x <= xb - 0.4; x += 0.75) {
        B.leg.add(x, 0.36, zb - 0.55, 0.06, 0.72, 0.06);
        B.chair.add(x, 0.74, zb - 0.55, 0.36, 0.05, 0.36);
        seats.push({ x, z: zb - 0.55, dx: 0, dz: 1, bar: true });
      }
    }
    const furnG = new T.Group();
    g.add(furnG);
    for (const b of Object.values(B)) b.build(furnG);

    /* ---------- 燈箱（菜單招牌） ---------- */
    for (const sg of signs) {
      const tex = K.makeTex(320, 64, (c) => { K.D.rect(c, 0, 0, 320, 64, '#1d1a16'); K.D.rect(c, 4, 4, 312, 56, '#2b241c'); K.D.txt(c, sg.text, 160, 34, 30, '#ffe2a8', 'center', 800); }, 1.5);
      texs.push(tex);
      const m = own(K.texMat(tex, { metalness: 0, roughness: 0.6, emissive: C('#ffffff'), emissiveIntensity: 0.55 }));
      const p = K.plane(sg.w, sg.w / 5, m);
      p.position.set(sg.x, sg.y, sg.z);
      if (sg.face < 0) p.rotation.y = Math.PI;
      p.raycast = noop;
      g.add(p);
    }

    /* ---------- 收銀機螢幕（綠 = 可刷卡、紅 = 連不上金流） ---------- */
    const posM = own(new T.MeshBasicMaterial({ color: C('#8fe3a8') }));
    const posMesh = new T.InstancedMesh(new T.BoxGeometry(0.3, 0.22, 0.03), posM, Math.max(1, posPts.length));
    geos.push(posMesh.geometry);
    posPts.forEach((p, i) => { dummy.position.set(p[0], p[1], p[2]); dummy.rotation.set(-0.35, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); posMesh.setMatrixAt(i, dummy.matrix); });
    posMesh.count = posPts.length;
    posMesh.userData.pick = { kind: 'pos' };
    posMesh.userData.pickPoint = true;
    g.add(posMesh);

    /* ---------- 爐火 ---------- */
    const flameG = new T.CircleGeometry(0.22, 16);
    flameG.rotateX(-Math.PI / 2);
    geos.push(flameG);
    const flameM = own(new T.MeshBasicMaterial({ color: C('#ff8a2a'), transparent: true, opacity: 0.9, depthWrite: false, blending: T.AdditiveBlending }));
    const flames = new T.InstancedMesh(flameG, flameM, Math.max(1, burners.length));
    flames.count = 0;
    flames.raycast = noop;
    flames.frustumCulled = false;
    g.add(flames);
    const steam = fx.emitter(420, 0.9);
    g.add(steam.obj);
    const steamSt = {};
    const STEAM0 = fx.rgb('#f4f6f7'), STEAM1 = fx.rgb('#c9d0d4');

    /* ---------- 人：站著的（廚師、服務人員、排隊）與坐著的（用餐） ---------- */
    const standBody = new T.CylinderGeometry(0.17, 0.21, 0.92, 10); standBody.translate(0, 0.96, 0);
    const standHead = new T.SphereGeometry(0.12, 12, 9); standHead.translate(0, 1.56, 0);
    const hatG = new T.CylinderGeometry(0.11, 0.1, 0.24, 12); hatG.translate(0, 1.78, 0);
    const puffG = new T.SphereGeometry(0.14, 12, 8); puffG.translate(0, 1.92, 0);
    const sitBody = new T.CylinderGeometry(0.15, 0.2, 0.6, 10); sitBody.translate(0, 0.8, 0);
    const sitHead = new T.SphereGeometry(0.115, 12, 9); sitHead.translate(0, 1.22, 0);
    const trayG = new T.BoxGeometry(0.4, 0.03, 0.3); trayG.translate(0, 0.78, 0);
    geos.push(standBody, standHead, hatG, puffG, sitBody, sitHead, trayG);
    const crewSpots = cookSpots.concat(counterSpots, washSpots);
    const nCrew = Math.max(1, crewSpots.length), nQ = Math.max(1, queue.length), nSeat = Math.max(1, seats.length);
    /* 注意：three r128 的 setColorAt 以 mesh.count 配置顏色緩衝區，要先上色、之後才把 count 歸零 */
    const mk = (geo, n, hex, pick) => {
      const m = new T.InstancedMesh(geo, own(K.std(hex, { metalness: 0, roughness: 0.8 })), n);
      m.frustumCulled = false;
      if (pick) { m.userData.pick = pick; m.userData.pickPoint = true; } else m.raycast = noop;
      g.add(m);
      return m;
    };
    const crewB = mk(standBody, nCrew, '#ffffff', { kind: 'crew' }), crewH = mk(standHead, nCrew, '#ffffff', { kind: 'crew' });
    const hats = mk(hatG, nCrew, '#fbfbf8', null), puffs = mk(puffG, nCrew, '#fbfbf8', null);
    const qB = mk(standBody, nQ, '#ffffff', { kind: 'person' }), qH = mk(standHead, nQ, '#ffffff', { kind: 'person' });
    const dB = mk(sitBody, nSeat, '#ffffff', { kind: 'person' }), dH = mk(sitHead, nSeat, '#ffffff', { kind: 'person' });
    const trays = mk(trayG, nSeat, '#ffffff', null);
    for (let i = 0; i < nCrew; i++) {
      const sp = crewSpots[i];
      crewB.setColorAt(i, C(sp && sp.hat ? '#f7f7f4' : '#2f3a44'));
      crewH.setColorAt(i, C(SKIN[Math.floor(hash(i * 2.3 + 9) * SKIN.length)]));
    }
    for (let i = 0; i < nQ; i++) { qB.setColorAt(i, C(SHIRT[Math.floor(hash(i * 3.3 + 4) * SHIRT.length)])); qH.setColorAt(i, C(SKIN[Math.floor(hash(i * 1.7 + 5) * SKIN.length)])); }
    for (let i = 0; i < nSeat; i++) {
      dB.setColorAt(i, C(SHIRT[Math.floor(hash(i * 3.7 + 1) * SHIRT.length)]));
      dH.setColorAt(i, C(SKIN[Math.floor(hash(i * 5.3 + 2) * SKIN.length)]));
      trays.setColorAt(i, C(FOOD[Math.floor(hash(i * 2.9 + 7) * FOOD.length)]));
    }
    for (const m of [crewB, crewH, hats, puffs, qB, qH, dB, dH, trays]) m.count = 0;
    /* 依固定的亂數順序入座，人數變化時只改前 N 個 */
    const order = seats.map((s, i) => i).sort((a, b) => hash(seats[a].x * 13.1 + seats[a].z * 71.7) - hash(seats[b].x * 13.1 + seats[b].z * 71.7));
    /* 廚房先滿（爐台 → 櫃台 → 洗碗備料），用固定順序 */
    const put = (m, i, x, z, ry) => { dummy.position.set(x, 0, z); dummy.rotation.set(0, ry || 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); };
    let sig = '', cooking = false, nChef = 0;
    function place(crewN, qN, dN) {
      const hatIdx = [];
      for (let i = 0; i < crewN; i++) {
        const sp = crewSpots[i];
        const ry = Math.atan2(sp.dx, sp.dz);
        put(crewB, i, sp.x, sp.z, ry); put(crewH, i, sp.x, sp.z, ry);
        if (sp.hat) hatIdx.push(i);
      }
      hatIdx.forEach((i, k) => { const sp = crewSpots[i]; put(hats, k, sp.x, sp.z); put(puffs, k, sp.x, sp.z); });
      crewB.count = crewH.count = crewN;
      hats.count = puffs.count = hatIdx.length;
      for (let i = 0; i < qN; i++) { const sp = queue[i]; put(qB, i, sp.x, sp.z, Math.atan2(sp.dx, sp.dz)); put(qH, i, sp.x, sp.z, Math.atan2(sp.dx, sp.dz)); }
      qB.count = qH.count = qN;
      for (let k = 0; k < dN; k++) {
        const s = seats[order[k]];
        put(dB, k, s.x, s.z); put(dH, k, s.x, s.z);
        dummy.position.set(s.x + s.dx * 0.38, 0, s.z + s.dz * 0.38); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
        trays.setMatrixAt(k, dummy.matrix);
      }
      dB.count = dH.count = trays.count = dN;
      for (const m of [crewB, crewH, hats, puffs, qB, qH, dB, dH, trays]) m.instanceMatrix.needsUpdate = true;
      nChef = cookSpots.length ? Math.min(crewN, cookSpots.length) : 0;
    }
    let posOk = true;

    return {
      counts: () => ({ seats: seats.length, crew: crewSpots.length, queue: queue.length, pos: posPts.length, burners: burners.length }),
      sync(st) {
        const crew = st ? st.crew || 0 : 0, diners = st ? st.diners || 0 : 0;
        const crewN = Math.min(crewSpots.length, Math.round(crew / f.staff * crewSpots.length));
        const qN = Math.min(queue.length, Math.round(diners * 0.05));
        const dN = Math.min(seats.length, Math.round(diners * 0.85));
        const s2 = crewN + ':' + qN + ':' + dN;
        if (s2 !== sig) { sig = s2; place(crewN, qN, dN); }
        cooking = crewN > 0 && crew > 1;
        const ok = !st || st.posOk !== false;
        if (ok !== posOk) { posOk = ok; posM.color.copy(C(ok ? '#8fe3a8' : '#ff5a4f')); }
      },
      tick(dt, t) {
        /* 爐火：有廚師在的爐口才點火，火焰會跳動 */
        let k = 0;
        if (cooking) {
          burners.forEach((b, i) => {
            if (i >= nChef) return;
            const s = 0.75 + 0.35 * Math.sin(t * 17 + i * 2.1) * Math.sin(t * 5.3 + i);
            dummy.position.set(b.p[0], b.p[1] + 0.005, b.p[2]); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, 1, s); dummy.updateMatrix();
            flames.setMatrixAt(k++, dummy.matrix);
            const n = steam.rate(steamSt, 'b' + i, b.pot ? 5 : 2.5, dt);
            for (let j = 0; j < n; j++) steam.emit([b.p[0] + U.rand(-0.15, 0.15), b.p[1] + (b.pot ? 0.45 : 0.12), b.p[2] + U.rand(-0.15, 0.15)], { v: [0, 0.55, 0.05], spread: 0.25, life: 2.2, c0: STEAM0, c1: STEAM1, s0: 0.25, s1: 0.9, a: 0.4 });
          });
        }
        flames.count = k;
        flames.instanceMatrix.needsUpdate = true;
        steam.tick(dt);
        /* 收銀機斷線：螢幕閃紅 */
        if (!posOk) posM.color.setRGB(Math.sin(t * 6) > 0 ? 1 : 0.35, 0.2, 0.18).convertSRGBToLinear();
      },
      tip(p) {
        if (p.kind === 'pos') return ['收銀機（POS）', posOk ? '已連線：可以刷卡 / 行動支付' : '⚠ 連不上金流閘道：只能收現金，結帳大排長龍', '刷卡資料屬於 PCI DSS 規範的持卡人資料：實務上收銀機要放在獨立的 VLAN，只允許連到金流閘道。'];
        if (p.kind === 'cold') return ['冷凍庫（−18°C）', '金屬牆 + 保溫層：Wi-Fi 訊號幾乎穿不透（衰減 12 dB 以上）', '冷凍庫的溫度感測器要用有線或 LoRa 回傳，別指望 Wi-Fi。'];
        if (p.kind === 'crew') return [cooking ? '廚房工作人員（備餐中）' : '廚房工作人員', `${f.id} 共 ${f.staff} 位廚師、廚工、收銀與清潔人員`, '一早 6 點就開始備料；廚房的平板點單、出餐顯示器（KDS）也要連網'];
        return null;
      },
      dispose() {
        for (const m of mats) m.dispose();
        for (const x of geos) x.dispose();
        for (const x of texs) x.dispose();
      },
    };
  };
})(window.G = window.G || {});
