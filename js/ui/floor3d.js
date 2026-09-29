/* 3D 樓層內部：依平面圖產生隔間牆、座位與會議室；天花板上的 AP、訊號覆蓋、到 IDF 的線路與流量
 * 單位：公尺（平面圖 1 格 = 1 m），平面圖 (x, y) → 世界座標 (x + 0.5 − 36, 高度, y + 0.5 − 18)。
 * 地板上的彩色覆蓋層與 2D 平面圖相同（訊號 / AP 負載 / 同頻干擾）；座位上的人跟著目前在座人數變化。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q, M3 = G.M3;
  const AP_Y = 2.9, WALL_H = 2.4, CORE_H = 3.2, PLENUM = 3.4, FAC_H = 3.1, RMAX = 9;
  const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const HEAT = [[-60, '#46d17f', '極佳'], [-67, '#a0d650', '良好'], [-72, '#f0be3a', '普通'], [-75, '#f0823a', '偏弱'], [-78, '#f25050', '很弱']];
  const heatOf = (r) => HEAT.find((x) => r >= x[0]) || null;
  const loadHex = (u) => (u >= 1 ? '#f25f5c' : u >= 0.7 ? '#f0a63a' : '#46d17f');
  /* 同頻干擾圖層：相同顏色 = 相同頻道 */
  const CH_COL = ['#5aa9f0', '#f2c14e', '#e86fa8', '#43c59e', '#8f7cf0', '#f0823a', '#2fc6b8', '#c7d36b', '#ff8a80', '#80d8ff', '#b388ff', '#ffd180', '#a7ffeb', '#ea80fc', '#ccff90', '#ff9e80'];
  const chHex = (ch) => { const k = CAT.channels.ext.indexOf(String(ch)); return CH_COL[(k < 0 ? 0 : k) % CH_COL.length]; };
  const SHIRT = ['#5aa9f0', '#e8e4dc', '#43c59e', '#f2c14e', '#8f7cf0', '#e86fa8', '#2f3a44', '#c85a4a', '#9aa7ad', '#3f6f8f', '#d9d4c7', '#6d8f5a'];
  const SKIN = ['#f1c9a5', '#e0ac85', '#c68b65', '#8d5a3f', '#f6d7bd'];
  const noop = () => {};

  /** opts: { height, fid, sel() → { ap, tool, layer, apModel }, onAp(id | null), onPlace(x, y), onInc() } */
  M3.floor = (opts) => M3.stage({ height: opts.height, label: `${opts.fid} 樓層 3D`, fov: 34, pitchMin: 0.2, create: (api) => createFloor(api, opts) });

  function createFloor(api, opts) {
    const T = api.T, K = M3.kit, fx = M3.fx, UI = G.UI;
    const fid = opts.fid, f = G.BLD.byId[fid], L = G.Layout.get(f.type), TY = L.T;
    const W = L.W, H = L.H;
    const wx = (x) => x + 0.5 - W / 2, wz = (y) => y + 0.5 - H / 2;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? TY.EXT : L.type[y * W + x]);
    const cellOf = (pt) => ({ x: U.clamp(Math.floor(pt[0] + W / 2), 0, W - 1), y: U.clamp(Math.floor(pt[2] + H / 2), 0, H - 1) });
    const root = new T.Group();
    const C = (hex) => K.col(hex);
    const dummy = new T.Object3D();
    const unit = new T.BoxGeometry(1, 1, 1);
    const allTags = [];
    const tag = (text, cls, align, prio) => { const t = api.tag(text, cls, align, prio); allTags.push(t); return t; };
    const mats = [];
    const own = (m) => { mats.push(m); return m; };
    /* 「俯視」：從正上方看整層樓，跟 2D 平面圖的方向一樣 */
    api.bar.append(U.h('button', { class: 'btn xs', onclick: () => api.setView(0, 1.45, 0.98) }, '俯視'));

    /** 同材質的方塊合成一個 InstancedMesh（牆面、家具） */
    function batch(mat, pick, geo) {
      const it = [];
      return {
        add(x, y, z, sx, sy, sz, hex) { it.push([x, y, z, sx, sy, sz, hex]); },
        build(parent) {
          if (!it.length) return null;
          const m = new T.InstancedMesh(geo || unit, mat, it.length);
          it.forEach((q, i) => {
            dummy.position.set(q[0], q[1], q[2]); dummy.scale.set(q[3], q[4], q[5]); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            m.setMatrixAt(i, dummy.matrix);
            if (q[6]) m.setColorAt(i, C(q[6]));
          });
          m.frustumCulled = false;
          if (pick) { m.userData.pick = pick; m.userData.pickPoint = true; } else m.raycast = noop;
          parent.add(m);
          return m;
        },
      };
    }

    /* ---------- 樓板、地板（房間名稱畫在地上） ---------- */
    const FC = {};
    FC[TY.OPEN] = '#5b646c'; FC[TY.DESK] = '#4f5b66'; FC[TY.MEET] = '#61584e'; FC[TY.OFFICE] = '#5f554b'; FC[TY.LAB] = '#6d777d';
    FC[TY.LOBBY] = '#8d9296'; FC[TY.CAFE] = '#7b6a55'; FC[TY.CORE] = '#474e54'; FC[TY.IDF] = '#2b353c'; FC[TY.WALL] = '#56606a'; FC[TY.GLASS] = '#56606a'; FC[TY.EXT] = '#394148';
    FC[TY.KITCHEN] = '#78848b'; FC[TY.SERVE] = '#6f6253'; FC[TY.DINE] = '#8b7a64'; FC[TY.COLD] = '#a9c3cd';
    FC[TY.RAMP] = '#40474d'; FC[TY.PARK] = '#4a5157'; FC[TY.MOTO] = '#4f565c'; FC[TY.PILLAR] = '#6b7378'; FC[TY.WC] = '#8e9ca4';
    const floorT = K.makeTex(W * 10, H * 10, (c) => {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) K.D.rect(c, x * 10, y * 10, 10.3, 10.3, FC[L.type[y * W + x]] || FC[TY.OPEN]);
      c.fillStyle = 'rgba(255,255,255,0.045)';
      for (let x = 0; x <= W; x++) c.fillRect(x * 10 - 0.2, 0, 0.4, H * 10);
      for (let y = 0; y <= H; y++) c.fillRect(0, y * 10 - 0.2, W * 10, 0.4);
      /* 廁所地磚：每格再分成 2 × 2 小塊 */
      c.fillStyle = 'rgba(255,255,255,0.14)';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (L.type[y * W + x] === TY.WC) { c.fillRect(x * 10 + 4.8, y * 10, 0.4, 10); c.fillRect(x * 10, y * 10 + 4.8, 10, 0.4); }
      for (const r of L.rooms) {
        if (r.kind === TY.CORE || r.x1 - r.x0 < 6) continue;
        const cy = r.y0 === 0 ? r.y1 - 1.2 : r.y1 === H - 1 ? r.y0 + 1.7 : (r.y0 + r.y1 + 1) / 2;
        K.D.txt(c, r.label, ((r.x0 + r.x1 + 1) / 2) * 10, cy * 10, 7.5, 'rgba(240,244,247,0.55)', 'center', 700);
      }
    }, 2);
    const floor = K.plane(W, H, K.texMat(floorT, { metalness: 0, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.userData.pick = { kind: 'floor' };
    floor.userData.pickPoint = true;
    root.add(floor);
    const slab = K.box(W + 0.8, 0.45, H + 0.8, K.std('#5a6269', { roughness: 0.9, metalness: 0.05 }));
    slab.position.y = -0.225;
    slab.raycast = noop;
    root.add(slab);

    /* 訊號覆蓋層（每格一個像素，線性內插成平滑的熱圖） */
    const ovC = document.createElement('canvas');
    ovC.width = W; ovC.height = H;
    const ovT = new T.CanvasTexture(ovC);
    ovT.encoding = T.sRGBEncoding;
    ovT.generateMipmaps = false;
    ovT.minFilter = ovT.magFilter = T.LinearFilter;
    const overlay = new T.Mesh(new T.PlaneGeometry(W, H), new T.MeshBasicMaterial({ map: ovT, transparent: true, depthWrite: false }));
    overlay.rotation.x = -Math.PI / 2;
    overlay.position.y = 0.03;
    overlay.renderOrder = 1;
    overlay.raycast = noop;
    root.add(overlay);

    /* ---------- 隔間牆：依衰減分三種（玻璃 / 石膏板 / 加厚牆），連續的格子合成一道牆 ---------- */
    const wallCls = (a) => (a <= 2 ? 0 : a >= 10 ? 3 : a >= 6 ? 2 : 1);
    const WALLDEF = [
      { mat: K.std('#a9d6ef', { transparent: true, opacity: 0.3, roughness: 0.1, metalness: 0.2, depthWrite: false }), t: 0.08, name: '玻璃隔間', att: '約 2 dB' },
      { mat: K.std('#d9dde0', { roughness: 0.85, metalness: 0 }), t: 0.14, name: '隔間牆（石膏板）', att: '約 4～5 dB' },
      { mat: K.std('#b3a898', { roughness: 0.9, metalness: 0 }), t: 0.22, name: '加厚牆（隔音 / 實驗室 / 廚房）', att: '約 6～7 dB' },
      { mat: K.std('#cdd6db', { roughness: 0.3, metalness: 0.8 }), t: 0.2, name: '冷凍庫金屬牆（不鏽鋼 + 保溫層）', att: '12 dB 以上（金屬幾乎擋住 Wi-Fi）' },
    ];
    const WB = WALLDEF.map((d, i) => batch(d.mat, { kind: 'wall', cls: i }));
    const isWall = (x, y) => { const t = at(x, y); return t === TY.WALL || t === TY.GLASS; };
    const clsAt = (x, y) => wallCls(L.att[y * W + x]);
    /* 一道牆的末端要延伸多少：碰到外牆延伸到帷幕、碰到核心筒或其他牆補滿、轉角只補半個牆厚、門口留 1m 開口 */
    const endExt = (nx, ny, ex, ey, horiz, t) => {
      const n = at(nx, ny);
      if (n === TY.EXT) return 1;
      if (n === TY.CORE || n === TY.IDF || isWall(nx, ny)) return 0.5;
      const corner = horiz ? (isWall(ex, ey - 1) || isWall(ex, ey + 1)) : (isWall(ex - 1, ey) || isWall(ex + 1, ey));
      return corner ? t / 2 : 0.5;
    };
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1;) {
        if (!isWall(x, y)) { x++; continue; }
        const c = clsAt(x, y);
        let x1 = x;
        while (x1 + 1 < W - 1 && isWall(x1 + 1, y) && clsAt(x1 + 1, y) === c) x1++;
        const lone = !(isWall(x, y - 1) && clsAt(x, y - 1) === c) && !(isWall(x, y + 1) && clsAt(x, y + 1) === c);
        if (x1 > x || lone) {
          const t = WALLDEF[c].t;
          const xa = wx(x) - endExt(x - 1, y, x, y, true, t), xb = wx(x1) + endExt(x1 + 1, y, x1, y, true, t);
          WB[c].add((xa + xb) / 2, WALL_H / 2, wz(y), xb - xa, WALL_H, t);
        }
        x = x1 + 1;
      }
    }
    for (let x = 1; x < W - 1; x++) {
      for (let y = 1; y < H - 1;) {
        if (!isWall(x, y)) { y++; continue; }
        const c = clsAt(x, y);
        let y1 = y;
        while (y1 + 1 < H - 1 && isWall(x, y1 + 1) && clsAt(x, y1 + 1) === c) y1++;
        if (y1 > y) {
          const t = WALLDEF[c].t;
          const za = wz(y) - endExt(x, y - 1, x, y, false, t), zb = wz(y1) + endExt(x, y1 + 1, x, y1, false, t);
          WB[c].add(wx(x), WALL_H / 2, (za + zb) / 2, t, WALL_H, zb - za);
        }
        y = y1 + 1;
      }
    }
    const wallG = new T.Group();
    root.add(wallG);
    WB.forEach((b, i) => { const m = b.build(wallG); if (m && i === 0) m.renderOrder = 2; });

    /* ---------- 核心筒（電梯 / 樓梯）與 IDF 弱電室 ---------- */
    const bb = (pred) => { const b = { x0: W, y0: H, x1: -1, y1: -1 }; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (pred(L.type[y * W + x])) { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); } return b; };
    const cb = bb((t) => t === TY.CORE || t === TY.IDF), ib = bb((t) => t === TY.IDF);
    const coreM = K.std('#747c83', { roughness: 0.9, metalness: 0.05 });
    const coreB = batch(coreM, { kind: 'core' });
    const coreBox = (x0, y0, x1, y1) => { if (x1 < x0 || y1 < y0) return; coreB.add((wx(x0) + wx(x1)) / 2, CORE_H / 2, (wz(y0) + wz(y1)) / 2, x1 - x0 + 1, CORE_H, y1 - y0 + 1); };
    /* 一排一排把核心筒的格子連成方塊：IDF、廁所與門口留空 */
    for (let y = cb.y0; y <= cb.y1; y++) {
      for (let x = cb.x0; x <= cb.x1;) {
        if (at(x, y) !== TY.CORE) { x++; continue; }
        let x1 = x;
        while (x1 + 1 <= cb.x1 && at(x1 + 1, y) === TY.CORE) x1++;
        coreBox(x, y, x1, y);
        x = x1 + 1;
      }
    }
    /* IDF 和隔壁廁所之間的隔間牆；廁所門口上方的門楣 */
    for (let y = ib.y0; y <= ib.y1; y++) for (let x = ib.x0; x <= ib.x1; x++) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (at(x + dx, y + dy) !== TY.WC) continue;
        coreB.add(wx(x) + dx * 0.5, CORE_H / 2, wz(y) + dy * 0.5, dx ? 0.14 : 1, CORE_H, dy ? 0.14 : 1);
      }
    }
    for (const w of L.wc || []) coreB.add(wx(w.door[0]), (2.2 + CORE_H) / 2, wz(w.door[1]), 1, CORE_H - 2.2, 1);
    coreB.build(root);
    /* 電梯門（核心筒朝南的那一面，無障礙廁所門口的東邊） */
    const doorB = batch(K.std('#aeb6bc', { metalness: 0.6, roughness: 0.35 }), null);
    for (let k = 0; k < 3; k++) doorB.add(wx(cb.x1 - 4.4) + k * 1.75, 1.1, wz(cb.y1) + 0.51, 1.2, 2.1, 0.04);
    doorB.build(root);
    const coreTag = tag('核心筒（電梯 / 樓梯）', '', 'center', 0);
    coreTag.pos.set(wx(cb.x1 - 2.5), CORE_H + 0.6, (wz(ib.y0) + wz(cb.y1)) / 2);
    /* IDF 機櫃與通往 B1 的豎井開口 */
    const IDF = [wx(L.idf.x) + 0.3, wz(L.idf.y) - 0.2];
    const CAB_TOP = 2.05;
    const cab = new T.Group();
    const cabBody = K.box(0.8, 2, 1, K.std('#1b2126', { metalness: 0.4, roughness: 0.5 }));
    cabBody.position.y = 1;
    const cabLed = new T.Mesh(new T.PlaneGeometry(0.56, 0.08), own(new T.MeshBasicMaterial({ color: C('#6b808b') })));
    cabLed.position.set(0, 1.6, 0.505);
    const cabLed2 = cabLed.clone();
    cabLed2.position.y = 1.35;
    cab.add(cabBody, cabLed, cabLed2);
    cab.position.set(IDF[0], 0, IDF[1]);
    cab.userData.pick = { kind: 'idf' };
    root.add(cab);
    const RISER = [wx(ib.x0) + 0.05, wz(ib.y1) - 0.05];
    const hole = K.plane(0.9, 0.9, K.std('#090c0f', { roughness: 1, metalness: 0 }));
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(RISER[0], 0.015, RISER[1]);
    hole.userData.pick = { kind: 'riser' };
    root.add(hole);
    const idfTag = tag('IDF 弱電室', 'info', 'center', 2);
    idfTag.pos.set(IDF[0], CAB_TOP + 0.9, IDF[1]);
    const riserTag = tag('↓ 弱電豎井：主幹線往 B1', 'info', 'right', 1);
    riserTag.pos.set(RISER[0] - 0.4, 0.4, RISER[1] + 0.3);

    /* ---------- 帷幕玻璃外牆（靠近鏡頭的那一面自動隱藏，方便看進室內）；地下室是鋼筋混凝土擋土牆 ---------- */
    const FW = W - 1, FD = H - 1;
    const park = !!G.FT[f.type].park;
    const facM = own(park ? new T.MeshStandardMaterial({ color: C('#7a8388'), roughness: 0.95, metalness: 0.02, side: T.DoubleSide })
      : new T.MeshStandardMaterial({ color: C('#a8d8f5'), transparent: true, opacity: 0.14, roughness: 0.1, metalness: 0.3, depthWrite: false, side: T.DoubleSide }));
    const mullM = K.std('#3b444b', { metalness: 0.6, roughness: 0.4 });
    const sides = [];
    for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const g = new T.Group();
      const len = nx ? FD : FW;
      const p = K.plane(len, FAC_H, facM);
      p.renderOrder = 3;
      p.raycast = noop;
      g.add(p);
      const mb = batch(mullM, null);
      if (!park) for (let k = 0; k <= Math.round(len / 3); k++) mb.add(-len / 2 + k * (len / Math.round(len / 3)), FAC_H / 2, 0, 0.09, FAC_H, 0.09);
      mb.add(0, FAC_H, 0, len, 0.12, 0.14);
      mb.add(0, 0.06, 0, len, 0.12, 0.14);
      mb.build(g);
      g.position.set(nx * FW / 2, 0, nz * FD / 2);
      p.position.y = FAC_H / 2;
      if (nx) g.rotation.y = Math.PI / 2;
      root.add(g);
      sides.push({ g, nx, nz });
    }

    /* ---------- 家具與座位 ---------- */
    const SPOT = { kind: 'spot' };
    const B = {
      top: batch(K.std('#d9d3c5', { metalness: 0, roughness: 0.7 }), SPOT),
      panel: batch(K.std('#7f878d', { metalness: 0.1, roughness: 0.8 }), SPOT),
      seat: batch(K.std('#34404a', { metalness: 0.05, roughness: 0.8 }), SPOT),
      wood: batch(K.std('#9b7a58', { metalness: 0, roughness: 0.65 }), SPOT),
      white: batch(K.std('#e9e6df', { metalness: 0, roughness: 0.6 }), SPOT),
      dark: batch(K.std('#1e252b', { metalness: 0.4, roughness: 0.5 }), SPOT),
      sofa: batch(K.std('#4a7596', { metalness: 0, roughness: 0.9 }), SPOT),
      led: batch(K.glow('#3fe07a', 1.4), null),
      pot: batch(K.std('#8a6a4e', { metalness: 0, roughness: 0.8 }), SPOT),
      leaf: batch(K.std('#3f8f5a', { metalness: 0, roughness: 0.9 }), SPOT, new T.SphereGeometry(0.5, 10, 8)),
      round: batch(K.std('#e9e6df', { metalness: 0, roughness: 0.6 }), SPOT, new T.CylinderGeometry(0.5, 0.5, 1, 20)),
    };
    const deskSeats = [], otherSeats = [], monPos = [];
    /** 椅子：(dx, dz) = 坐著的人面向的方向 */
    function chair(x, z, dx, dz, other, mon) {
      B.seat.add(x, 0.46, z, 0.46, 0.08, 0.46);
      B.seat.add(x - dx * 0.25, 0.76, z - dz * 0.25, dz ? 0.46 : 0.07, 0.46, dz ? 0.07 : 0.46);
      (other ? otherSeats : deskSeats).push({ x: x + dx * 0.05, z: z + dz * 0.05, mon: mon === undefined ? -1 : mon });
    }
    function monitor(x, z, alongX) { monPos.push([x, 1.0, z, alongX]); return monPos.length - 1; }
    /* 開放式座位：椅子放在走道那一側，螢幕面向椅子 */
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (at(x, y) !== TY.DESK) continue;
        const upFree = at(x, y - 1) !== TY.DESK, dnFree = at(x, y + 1) !== TY.DESK;
        const d = upFree && !dnFree ? -1 : 1;
        const cx = wx(x), cz = wz(y);
        B.top.add(cx, 0.74, cz - d * 0.08, 0.96, 0.04, 0.74);
        B.panel.add(cx, 0.4, cz - d * 0.43, 0.94, 0.62, 0.03);
        const mon = monitor(cx, cz - d * 0.3, true);
        chair(cx, cz + d * 0.5, 0, -d, false, mon);
      }
    }
    for (const r of L.rooms) {
      const ix0 = r.x0 + 1, ix1 = r.x1 - 1, iy0 = r.y0 + 1, iy1 = r.y1 - 1;
      const iw = ix1 - ix0 + 1, ih = iy1 - iy0 + 1;
      if (iw < 2 || ih < 2) continue;
      const cx = (wx(ix0) + wx(ix1)) / 2, cz = (wz(iy0) + wz(iy1)) / 2;
      const zDoor = r.y0 === 0 ? 1 : -1;
      if (r.kind === TY.MEET && /教室|會議廳/.test(r.label)) {
        /* 教室：一排排桌子面向前方的投影幕 */
        const front = zDoor > 0 ? wz(iy0) : wz(iy1), dir = zDoor > 0 ? 1 : -1;
        for (let z = front + dir * 2.3; dir > 0 ? z <= wz(iy1) - 0.8 : z >= wz(iy0) + 0.8; z += dir * 1.9) {
          for (let x = wx(ix0) + 1.3; x <= wx(ix1) - 1.2; x += 2.1) {
            B.white.add(x, 0.72, z, 1.6, 0.05, 0.5);
            chair(x - 0.4, z + dir * 0.55, 0, -dir, true);
            chair(x + 0.4, z + dir * 0.55, 0, -dir, true);
          }
        }
        B.dark.add(cx, 1.6, front - dir * 0.2, Math.min(iw * 0.5, 7), 1.3, 0.06);
      } else if (r.kind === TY.MEET) {
        /* 會議室：長桌 + 兩側椅子 + 螢幕 */
        const long = iw >= ih;
        const tl = U.clamp((long ? iw : ih) - 2.8, 1.4, 9), tw = U.clamp((long ? ih : iw) - 3.6, 0.9, 2.2);
        B.wood.add(cx, 0.74, cz, long ? tl : tw, 0.06, long ? tw : tl);
        B.panel.add(cx, 0.37, cz, long ? tl * 0.4 : tw * 0.4, 0.7, long ? tw * 0.4 : tl * 0.4);
        const n = Math.max(1, Math.floor(tl / 0.95));
        for (let k = 0; k < n; k++) {
          const t = ((k + 0.5) / n - 0.5) * tl;
          if (long) { chair(cx + t, cz - tw / 2 - 0.42, 0, 1, true); chair(cx + t, cz + tw / 2 + 0.42, 0, -1, true); }
          else { chair(cx - tw / 2 - 0.42, cz + t, 1, 0, true); chair(cx + tw / 2 + 0.42, cz + t, -1, 0, true); }
        }
        if (long) B.dark.add(wx(ix0) + 0.12, 1.5, cz, 0.06, 0.8, Math.min(1.8, ih - 1));
        else B.dark.add(cx, 1.5, wz(iy0) + 0.12, Math.min(1.8, iw - 1), 0.8, 0.06);
      } else if (r.kind === TY.OFFICE) {
        /* 主管室 / 值班室：一張大辦公桌面向門口 + 沙發 */
        const dz = zDoor;
        const z = dz > 0 ? wz(iy0) + 1.6 : wz(iy1) - 1.6;
        B.wood.add(cx, 0.74, z, Math.min(2, iw - 2), 0.05, 0.9);
        B.panel.add(cx, 0.37, z + dz * 0.4, Math.min(1.9, iw - 2.1), 0.7, 0.04);
        const mon = monitor(cx, z + dz * 0.2, true);
        chair(cx, z - dz * 0.75, 0, dz, true, mon);
        if (ih >= 5 && iw >= 4) {
          const sz = dz > 0 ? wz(iy1) - 0.6 : wz(iy0) + 0.6;
          B.sofa.add(cx, 0.28, sz, Math.min(2.2, iw - 2), 0.45, 0.8);
          B.sofa.add(cx, 0.62, sz + dz * 0.32, Math.min(2.2, iw - 2), 0.5, 0.18);
        }
      } else if (r.kind === TY.LAB) {
        /* 實驗室：兩排測試機櫃 + 靠牆的工作台 */
        for (const rz of [cz - 1.5, cz + 1.3]) {
          for (let x = wx(ix0) + 2; x <= wx(ix1) - 2; x += 0.64) {
            if (Math.floor((x - wx(ix0)) / 6) % 2) continue;
            B.dark.add(x, 1, rz, 0.6, 2, 1);
            B.led.add(x, 1.7, rz + 0.51, 0.3, 0.04, 0.01);
          }
        }
        const bz = (zDoor > 0 ? wz(iy0) : wz(iy1)) + zDoor * 0.45;
        B.white.add(cx, 0.8, bz, Math.max(2, iw - 5), 0.05, 0.75);
        for (let x = cx - (iw - 6) / 2; x <= cx + (iw - 6) / 2; x += 1.6) chair(x, bz + zDoor * 0.7, 0, -zDoor, true, monitor(x, bz - zDoor * 0.15, true));
      } else if (r.kind === TY.CAFE) {
        /* 茶水間 / 咖啡廳：吧台 + 圓桌 */
        const bz = zDoor > 0 ? wz(iy0) + 0.35 : wz(iy1) - 0.35;
        B.wood.add(cx, 0.5, bz, Math.min(6, iw - 1.5), 1, 0.6);
        for (let z = wz(iy0) + 1.6; z <= wz(iy1) - 1.4; z += 2.3) {
          for (let x = wx(ix0) + 1.4; x <= wx(ix1) - 1.2; x += 2.5) {
            B.round.add(x, 0.74, z, 0.9, 0.05, 0.9);
            B.panel.add(x, 0.37, z, 0.08, 0.72, 0.08);
            chair(x - 0.72, z, 1, 0, true);
            chair(x + 0.72, z, -1, 0, true);
          }
        }
      } else if (r.kind === TY.LOBBY) {
        /* 挑高大廳：幾組沙發 + 茶几 */
        for (let k = 0; k < 3; k++) {
          const sx = wx(ix0) + 2.5 + k * (iw - 5) / 2, sz = cz + (k % 2 ? 2.5 : -2.5);
          B.white.add(sx, 0.4, sz, 1.2, 0.06, 0.7);
          for (const s of [-1, 1]) {
            B.sofa.add(sx, 0.28, sz + s * 1.2, 2.2, 0.45, 0.8);
            B.sofa.add(sx, 0.62, sz + s * 1.55, 2.2, 0.5, 0.18);
            otherSeats.push({ x: sx - 0.5, z: sz + s * 1.2, mon: -1 }, { x: sx + 0.5, z: sz + s * 1.2, mon: -1 });
          }
        }
      }
    }
    /* 盆栽：放在靠牆的走道邊 */
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const t = at(x, y);
        if (t !== TY.OPEN && t !== TY.LOBBY) continue;
        const nearWall = isWall(x - 1, y) || isWall(x + 1, y) || at(x, y - 1) === TY.EXT || at(x, y + 1) === TY.EXT;
        if (!nearWall || hash(x * 31.7 + y * 7.9 + f.level) > 0.035) continue;
        B.pot.add(wx(x), 0.25, wz(y), 0.42, 0.5, 0.42);
        B.leaf.add(wx(x), 0.95, wz(y), 0.9, 1.1, 0.9);
      }
    }
    const furnG = new T.Group();
    root.add(furnG);
    for (const b of Object.values(B)) b.build(furnG);
    /* 餐廳樓層：廚房、餐檯、收銀台、用餐座位與人潮（canteen3d.js） */
    const dineMod = G.FT[f.type].dine && M3.canteen ? M3.canteen({ api, K, fx, L, fid, root, wx, wz, batch }) : null;
    /* 停車場樓層：汽機車、柵欄機、監視器、充電樁、走向電梯廳打卡的人（parking3d.js） */
    const parkMod = park && M3.parking ? M3.parking({ api, K, fx, L, fid, root, wx, wz, batch }) : null;
    /* 廁所：隔間、清潔人員、智慧廁所感測器、漏水積水（restroom3d.js） */
    const restMod = M3.restroom ? M3.restroom({ api, K, L, fid, root, wx, wz, batch }) : null;
    /* 螢幕：亮 = 有人在用；紅色 = 受感染；橘色 = 網路斷線 */
    const MON = { off: C('#1a2228'), on: C('#9fd8ff'), red: C('#ff4a3d'), amber: C('#f0a63a') };
    const monitors = new T.InstancedMesh(unit, own(new T.MeshBasicMaterial({ color: 0xffffff })), Math.max(1, monPos.length));
    monPos.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]); dummy.scale.set(p[3] ? 0.56 : 0.035, 0.34, p[3] ? 0.035 : 0.56); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
      monitors.setMatrixAt(i, dummy.matrix);
      monitors.setColorAt(i, MON.off);
    });
    monitors.count = monPos.length;
    monitors.frustumCulled = false;
    monitors.userData.pick = SPOT;
    monitors.userData.pickPoint = true;
    root.add(monitors);
    /* 人：依隨機順序入座，在座人數變化時只改前 N 個 */
    const byRank = (a, b) => hash(a.x * 13.1 + a.z * 71.7) - hash(b.x * 13.1 + b.z * 71.7);
    deskSeats.sort(byRank);
    otherSeats.sort(byRank);
    const nSeat = deskSeats.length + otherSeats.length;
    const bodyG = new T.CylinderGeometry(0.15, 0.2, 0.6, 10);
    bodyG.translate(0, 0.8, 0);
    const headG = new T.SphereGeometry(0.115, 12, 9);
    headG.translate(0, 1.22, 0);
    const bodies = new T.InstancedMesh(bodyG, K.std('#ffffff', { metalness: 0, roughness: 0.85 }), Math.max(1, nSeat));
    const heads = new T.InstancedMesh(headG, K.std('#ffffff', { metalness: 0, roughness: 0.7 }), Math.max(1, nSeat));
    for (let i = 0; i < Math.max(1, nSeat); i++) {
      bodies.setColorAt(i, C(SHIRT[Math.floor(hash(i * 3.7 + 1) * SHIRT.length)]));
      heads.setColorAt(i, C(SKIN[Math.floor(hash(i * 5.3 + 2) * SKIN.length)]));
    }
    for (const m of [bodies, heads]) { m.count = 0; m.frustumCulled = false; m.userData.pick = { kind: 'person' }; m.userData.pickPoint = true; root.add(m); }
    let occSig = '';
    const occupied = new Set();
    function placePeople(nd, no) {
      let k = 0;
      occupied.clear();
      const put = (s) => {
        dummy.position.set(s.x, 0, s.z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        bodies.setMatrixAt(k, dummy.matrix); heads.setMatrixAt(k, dummy.matrix);
        if (s.mon >= 0) occupied.add(s.mon);
        k++;
      };
      for (let i = 0; i < nd; i++) put(deskSeats[i]);
      for (let i = 0; i < no; i++) put(otherSeats[i]);
      bodies.count = heads.count = k;
      bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
    }

    /* ---------- AP、線路、訊號波紋 ---------- */
    const apG = new T.Group(), cableG = new T.Group(), cciG = new T.Group();
    root.add(apG, cableG, cciG);
    const apBodyG = new T.CylinderGeometry(0.27, 0.3, 0.07, 28), apRingG = new T.TorusGeometry(0.3, 0.028, 6, 32);
    const markG = new T.RingGeometry(0.3, 0.4, 32);
    markG.rotateX(-Math.PI / 2);
    const apBodyM = K.std('#eef1f3', { metalness: 0.05, roughness: 0.45 });
    const LEDM = { ok: K.glow('#3fe07a', 1.6), warn: K.glow('#ffb13b', 1.6), bad: K.glow('#ff5a4f', 1.8), off: K.std('#39424a') };
    const chMats = new Map();
    const chMat = (ch) => { if (!chMats.has(ch)) chMats.set(ch, K.glow(chHex(ch), 1.5)); return chMats.get(ch); };
    const markM = own(new T.MeshBasicMaterial({ color: C('#e8f4ff'), transparent: true, opacity: 0.35, depthWrite: false }));
    const dropM = own(new T.LineBasicMaterial({ color: C('#e8f4ff'), transparent: true, opacity: 0.18 }));
    const cableMats = new Map();
    const cableMat = (hex, op) => { const k = hex + op; if (!cableMats.has(k)) cableMats.set(k, K.std(hex, op < 1 ? { transparent: true, opacity: op, depthWrite: false } : { roughness: 0.5, metalness: 0.1, emissive: C(hex), emissiveIntensity: 0.15 })); return cableMats.get(k); };
    const ringGeo = new T.RingGeometry(0.93, 1, 56);
    ringGeo.rotateX(-Math.PI / 2);
    /* 加法混色但不改變畫布的透明度：波紋超出樓板時不會在背景上留下黑邊 */
    const ripM = own(new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: T.DoubleSide,
      blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.SrcAlphaFactor, blendDst: T.OneFactor, blendSrcAlpha: T.ZeroFactor, blendDstAlpha: T.OneFactor }));
    let ripples = null;
    let aps = [], ups = [], chTags = [];
    const clearG = (g) => {
      for (const o of g.children.slice()) {
        g.remove(o);
        o.traverse((x) => { if (x.geometry && x.userData.ownGeo) x.geometry.dispose(); });
      }
    };
    function buildAps() {
      const s = G.S, fs = s.floors[fid];
      clearG(apG); clearG(cableG);
      if (ripples) { root.remove(ripples); ripples = null; }
      aps = [];
      ups = [];
      const cabOk = fs.cabling.status === 'done';
      const hz = (CAT.cables[fs.cabling.std] || CAT.cables.cat6a).color;
      fs.aps.forEach((a, k) => {
        const x = wx(a.x), z = wz(a.y);
        const g = new T.Group();
        const body = new T.Mesh(apBodyG, apBodyM);
        const ring = new T.Mesh(apRingG, LEDM.off);
        ring.rotation.x = Math.PI / 2;
        const rod = new T.Mesh(new T.CylinderGeometry(0.02, 0.02, PLENUM - AP_Y, 6), mullM);
        rod.userData.ownGeo = true;
        rod.position.y = (PLENUM - AP_Y) / 2;
        g.add(body, ring, rod);
        g.position.set(x, AP_Y, z);
        g.userData.pick = { kind: 'ap', id: a.id };
        apG.add(g);
        const mark = new T.Mesh(markG, markM);
        mark.position.set(x, 0.045, z);
        mark.raycast = noop;
        apG.add(mark);
        const dg = new T.BufferGeometry().setFromPoints([new T.Vector3(x, 0.05, z), new T.Vector3(x, AP_Y - 0.05, z)]);
        const drop = new T.Line(dg, dropM);
        drop.userData.ownGeo = true;
        drop.raycast = noop;
        apG.add(drop);
        let path = null;
        if (cabOk) {
          /* 天花板上方走線：先沿 x、再沿 z 到 IDF（和平面圖估算的曼哈頓距離一致） */
          const ln = ((k % 9) - 4) * 0.07;
          const pts = [[x, AP_Y + 0.05, z], [x, PLENUM + ln * 0.3, z], [IDF[0] + ln, PLENUM + ln * 0.3, z], [IDF[0] + ln, PLENUM + ln * 0.3, IDF[1]], [IDF[0] + ln, CAB_TOP, IDF[1]]];
          const tube = fx.tubeAlong(pts, 0.03, cableMat(hz, 1));
          tube.userData.ownGeo = true;
          tube.raycast = noop;
          cableG.add(tube);
          path = fx.path(pts);
        }
        aps.push({ a, g, ring, path, x, z, on: false, load: 0 });
      });
      /* 上行主幹：IDF → 天花板 → 豎井往下 */
      Q.linksOf('F:' + fid).forEach((l, k) => {
        const off = (k - 0.5) * 0.12;
        const pts = [[IDF[0] + off, CAB_TOP, IDF[1] - 0.3], [IDF[0] + off, PLENUM + 0.25, IDF[1] - 0.3], [RISER[0] + off, PLENUM + 0.25, IDF[1] - 0.3], [RISER[0] + off, PLENUM + 0.25, RISER[1]], [RISER[0] + off, -2.4, RISER[1]]];
        const tube = fx.tubeAlong(pts, 0.06, cableMat(CAT.cables[l.cable].color, 1));
        tube.userData.ownGeo = true;
        tube.raycast = noop;
        cableG.add(tube);
        ups.push({ l, tube, path: fx.path(pts), dn: 0, up: 0, on: false });
      });
      const cap = Math.max(2, aps.length * 2 + 4);
      ripples = new T.InstancedMesh(ringGeo, ripM, cap);
      for (let i = 0; i < cap; i++) ripples.setColorAt(i, new T.Color(0, 0, 0));
      ripples.count = 0;
      ripples.frustumCulled = false;
      ripples.raycast = noop;
      ripples.renderOrder = 4;
      root.add(ripples);
    }
    const cciM = own(new T.MeshBasicMaterial({ color: C('#ff3b30'), transparent: true, opacity: 0.9 }));
    function buildCci(conflicts) {
      clearG(cciG);
      for (const t of chTags) t.remove();
      chTags = [];
      if (layer !== 'cci') return;
      const pos = {};
      for (const r of aps) pos[r.a.id] = r;
      const bad = new Set();
      for (const [p, q] of conflicts) {
        const A = pos[p], Bq = pos[q];
        if (!A || !Bq) continue;
        bad.add(p); bad.add(q);
        const tube = fx.tubeAlong([[A.x, AP_Y + 0.02, A.z], [Bq.x, AP_Y + 0.02, Bq.z]], 0.16, cciM, 8);
        tube.userData.ownGeo = true;
        tube.raycast = noop;
        cciG.add(tube);
      }
      for (const r of aps) {
        const t = api.tag('ch ' + r.a.ch, bad.has(r.a.id) ? 'bad' : '', 'center', 1);
        t.pos.set(r.x, AP_Y + 0.55, r.z);
        chTags.push(t);
      }
    }

    /* ---------- 選取、放置預覽、偽冒 AP ---------- */
    const selRing = new T.Mesh(new T.TorusGeometry(0.52, 0.04, 8, 40), K.glow('#2fc6b8', 1.8));
    selRing.rotation.x = Math.PI / 2;
    selRing.visible = false;
    selRing.raycast = noop;
    root.add(selRing);
    const selBeam = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, AP_Y, 8), own(new T.MeshBasicMaterial({ color: C('#2fc6b8'), transparent: true, opacity: 0.45, depthWrite: false })));
    selBeam.visible = false;
    selBeam.raycast = noop;
    root.add(selBeam);
    const selTag = tag('', 'info', 'center', 3);
    selTag.show = false;
    const ghostM = own(new T.MeshBasicMaterial({ color: C('#2fc6b8'), transparent: true, opacity: 0.6, depthWrite: false }));
    const ghost = new T.Mesh(apBodyG, ghostM);
    ghost.visible = false;
    ghost.raycast = noop;
    root.add(ghost);
    const rogue = new T.Group();
    const rogueBody = K.box(0.34, 0.1, 0.24, K.std('#26292c', { metalness: 0.3 }));
    const rogueLed = new T.Mesh(new T.SphereGeometry(0.06, 10, 8), K.glow('#ff4d4d', 2.2));
    rogueLed.position.set(0.1, 0.07, 0);
    const rogueAnt = K.cylY(0.012, 0.35, K.std('#26292c'), 6);
    rogueAnt.position.set(-0.12, 0.2, 0);
    rogue.add(rogueBody, rogueLed, rogueAnt);
    rogue.visible = false;
    root.add(rogue);
    const rogueTag = tag('⚠ 偽冒基地台', 'bad', 'center', 3);
    rogueTag.show = false;
    const rogueSpot = (() => {
      const cafe = L.rooms.find((r) => r.kind === TY.CAFE) || L.rooms.find((r) => r.kind === TY.MEET);
      if (cafe) return [(wx(cafe.x0 + 1) + wx(cafe.x1 - 1)) / 2 + 1.2, (wz(cafe.y0 + 1) + wz(cafe.y1 - 1)) / 2 - 0.6];
      return [wx(10), wz(10)];
    })();
    rogue.position.set(rogueSpot[0], 0.8, rogueSpot[1]);
    rogueTag.pos.set(rogueSpot[0], 1.9, rogueSpot[1]);
    let rogueInc = null;
    const alertTag = tag('', 'bad', 'center', 4);
    alertTag.pos.set(0, 4.6, -H / 2 + 1);
    alertTag.show = false;

    /* ---------- 圖例與開關 ---------- */
    let layer = 'rssi', tool = 'select', showRip = true, showCab = true, legendKey = '';
    const sw = (hex) => U.h('i', { style: { background: hex } });
    function legend() {
      if (legendKey === layer) return;
      legendKey = layer;
      const rows = [];
      if (layer === 'rssi') rows.push(U.h('div', {}, '地板顏色 = 訊號：', ...HEAT.map(([v, c, t]) => U.h('span', {}, sw(c), t))));
      else if (layer === 'load') rows.push(U.h('div', {}, '地板顏色 = 服務這裡的 AP 負載：', sw('#46d17f'), '< 70%', sw('#f0a63a'), '70～100%', sw('#f25f5c'), '超載'));
      else if (layer === 'cci') rows.push(U.h('div', {}, '同一種顏色 = 同一個頻道；', sw('#ff4d4d'), '紅線 = 兩台 AP 同頻道又聽得到彼此（同頻干擾）'));
      rows.push(U.h('div', {}, '天花板白色圓盤 = AP（燈號：', sw('#3fe07a'), '正常', sw('#ffb13b'), '忙碌', sw('#ff5a4f'), '超載）・線上的光點 = 流量'));
      U.mount(api.hud, U.h('div', { class: 'm3d-legend' }, ...rows));
    }
    const ripBtn = U.h('button', { class: 'btn xs on', onclick: () => { showRip = !showRip; ripBtn.classList.toggle('on', showRip); api.request(); } }, '訊號波紋');
    const cabBtn = U.h('button', { class: 'btn xs on', onclick: () => { showCab = !showCab; cabBtn.classList.toggle('on', showCab); cableG.visible = showCab; api.request(); } }, '線路');
    api.bar.insertBefore(cabBtn, api.bar.firstChild.nextSibling);
    api.bar.insertBefore(ripBtn, cabBtn);

    /* ---------- 資訊卡 ---------- */
    let panelSel = null, panelEls = null, selAp = null;
    const apRec = (id) => aps.find((r) => r.a.id === id);
    function info(p) {
      const s = G.S, fs = s.floors[fid], sim = G.R.sim || { floors: {}, links: {} };
      const st = sim.floors[fid];
      if (p.kind === 'ap') {
        const r = apRec(p.id);
        if (!r) return null;
        const a = r.a, m = CAT.aps[a.model];
        const as = st && st.apStats[a.id];
        return [`${m.name}`, `位置 (${a.x}, ${a.y}) · 頻道 ${a.ch}`, r.on ? (as ? `連線裝置 ${Math.round(as.clients)} 台 · 負載 ${U.pct(as.load)}` : '供電中 · 目前沒有使用者') : '沒有供電（等布線、接入交換器或 PoE 預算）', `線長到 IDF ${G.Layout.cableToIdf(L, a.x, a.y)} m`];
      }
      if (p.kind === 'idf' || p.kind === 'riser') {
        const am = CAT.access[fs.idf.model];
        const links = Q.linksOf('F:' + fid);
        const cap = U.sum(links.filter((l) => l.status === 'up'), (l) => l.speed * l.count);
        const util = Math.max(0, ...links.map((l) => (sim.links[l.id] ? sim.links[l.id].util : 0)));
        const poe = Q.floorPoe(fid);
        return [`${fid} IDF 弱電室`, fs.idf.count ? `${am.name} × ${fs.idf.count}` : '還沒有安裝接入交換器',
          fs.idf.count ? `PoE ${U.num(poe.used)} / ${U.num(fs.idf.count * am.poe)} W` : '',
          links.length ? `上行到 B1：${U.bw(cap)} · 使用率 ${U.pct(util)}` : '還沒有上行主幹線到 B1'];
      }
      if (p.kind === 'rogue') {
        const inc = rogueInc && s.incidents.find((i) => i.id === rogueInc);
        return inc && inc.status === 'active' ? ['⚠ 偽冒基地台（Evil Twin）', inc.title, '廣播和公司一模一樣的 SSID，騙員工輸入帳號密碼'] : null;
      }
      return null;
    }
    function renderSel() {
      const panel = api.panel;
      const Ls = panelSel && info(panelSel);
      if (!Ls) { panelSel = null; panelEls = null; panel.hidden = true; api.request(); return; }
      const cur = panelSel;
      const btn = (label, fn, primary) => U.h('button', { class: 'btn xs' + (primary ? ' primary' : ''), onclick: fn }, label);
      const acts = [];
      if (cur.kind === 'ap') {
        const r = apRec(cur.id);
        acts.push(btn('拉近', () => { if (r) api.focus(r.g, 0.08); }, true));
        if (r) acts.push(btn('3D 外觀', () => M3.open([r.a.model], CAT.aps[r.a.model].name)));
      } else if (cur.kind === 'idf' || cur.kind === 'riser') acts.push(btn('拉近', () => api.focus(cab, 0.3), true));
      else if (cur.kind === 'rogue') acts.push(btn('前往事件中心', () => opts.onInc && opts.onInc(), true));
      const title = U.h('b', {}, Ls[0]), lines = U.h('div', { class: 'ls' });
      const close = () => { if (cur.kind === 'ap' && opts.onAp) opts.onAp(null); panelSel = null; renderSel(); syncSel(); };
      U.mount(panel, U.h('div', { class: 'hd' }, title, U.h('button', { class: 'btn ghost xs', 'aria-label': '取消選取', onclick: close }, '✕')), lines, U.h('div', { class: 'row wrap' }, ...acts));
      panelEls = { title, lines };
      panel.hidden = false;
      refreshSel();
    }
    function refreshSel() {
      if (!panelSel || !panelEls) return;
      const Ls = info(panelSel);
      if (!Ls) { renderSel(); return; }
      if (panelEls.title.textContent !== Ls[0]) panelEls.title.textContent = Ls[0];
      U.mount(panelEls.lines, ...Ls.slice(1).filter(Boolean).map((x) => U.h('div', {}, x)));
    }
    /** 選取的 AP：外圈 + 光柱（照到地板，看得出它在平面圖上的位置）+ 標籤 */
    function syncSel() {
      const r = selAp && apRec(selAp);
      selRing.visible = selBeam.visible = selTag.show = !!r;
      if (r) {
        selRing.position.set(r.x, AP_Y, r.z);
        selBeam.position.set(r.x, AP_Y / 2, r.z);
        selTag.pos.set(r.x, AP_Y + 0.9, r.z);
        const st = G.R.sim && G.R.sim.floors[fid];
        const as = st && st.apStats[r.a.id];
        selTag.set(`${r.a.model} · ch ${r.a.ch}${as ? ' · 負載 ' + U.pct(as.load) : ''}`, 'info');
      }
      api.request();
    }

    /* ---------- 狀態同步 ---------- */
    let sigAp = '', sigOv = '', sigCci = '', sigMon = '', skyHour = -1;
    const rgb255 = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    function drawOverlay(plan, st) {
      const g = ovC.getContext('2d');
      const img = g.createImageData(W, H);
      const d = img.data;
      const selIdx = selAp ? plan.apIds.indexOf(selAp) : -1;
      const apBy = {};
      for (const a of G.S.floors[fid].aps) apBy[a.id] = a;
      for (let i = 0; i < W * H; i++) {
        if (L.type[i] === TY.EXT || L.type[i] === TY.WC) continue;
        const r = plan.best[i], k = plan.bestIdx[i], served = r >= G.Wifi.TH.assoc && k >= 0;
        let hex = '#6e7882', a = 0.22;
        if (layer === 'rssi') { const hh = heatOf(r); if (hh) { hex = hh[1]; a = 0.5; } else a = 0.28; }
        else if (layer === 'load' && served) { const as = st && st.apStats[plan.apIds[k]]; hex = loadHex(as ? as.load : 0); a = 0.45; }
        else if (layer === 'cci' && served) { const ap = apBy[plan.apIds[k]]; hex = chHex(ap ? ap.ch : '36'); a = 0.42; }
        if (selIdx >= 0) a *= served && k === selIdx ? 1.4 : 0.45;
        const c = rgb255(hex), o = i * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(Math.min(1, a) * 255);
      }
      g.putImageData(img, 0, 0);
      ovT.needsUpdate = true;
    }
    /* 帷幕玻璃的顏色跟著時間：白天淡藍、傍晚偏橘、晚上變暗 */
    function syncSky() {
      const hr = U.hourOf(G.S.time);
      if (Math.abs(hr - skyHour) < 0.1) return;
      skyHour = hr;
      const day = U.clamp(Math.sin((hr - 6) / 12 * Math.PI) * 2.2 + 0.2, 0, 1);
      const dusk = Math.max(0, 1 - Math.min(Math.abs(hr - 18), Math.abs(hr - 6)) / 1.3);
      const c = fx.mix(fx.mix(fx.rgb('#101a2e'), fx.rgb('#a8d8f5'), day), fx.rgb('#f0a066'), dusk * 0.6);
      facM.color.setRGB(c[0], c[1], c[2]).convertSRGBToLinear();
      facM.opacity = 0.14 + (1 - day) * 0.26;
    }
    function sync() {
      const s = G.S, fs = s.floors[fid], sim = G.R.sim || { floors: {}, links: {} };
      const cur = opts.sel ? opts.sel() : {};
      const layerNow = cur.layer || 'rssi';
      const layerChanged = layerNow !== layer;
      layer = layerNow;
      tool = cur.tool || 'select';
      if (tool !== 'place') ghost.visible = false;
      const up = G.Net.floorUp(fid);
      const powered = G.Wifi.powered(fid, up);
      const plan = G.Wifi.get(fid, new Set(fs.aps.map((a) => a.id)));
      const st = sim.floors[fid];
      const fac = G.R.fac;
      /* AP 與線路（有變動才重建） */
      const sA = fs.aps.map((a) => `${a.id}:${a.x},${a.y},${a.model},${a.ch}`).join(';') + '|' + fs.cabling.status + (fs.cabling.std || '') + '|' + Q.linksOf('F:' + fid).map((l) => l.id + l.cable).join(',');
      if (sA !== sigAp) { sigAp = sA; buildAps(); sigCci = '#'; }
      const sC = layer + '|' + plan.conflicts.map((c) => c.join('-')).join(',') + '|' + fs.aps.map((a) => a.ch).join(',');
      if (sC !== sigCci) { sigCci = sC; buildCci(plan.conflicts); }
      const idfDark = !!(fac && fac.idfPowered && fac.idfPowered[fid] === false);
      for (const r of aps) {
        r.on = powered.has(r.a.id) && !idfDark;
        const as = st && st.apStats[r.a.id];
        r.load = as ? U.clamp(as.load, 0, 1.5) : 0;
        r.ring.material = !r.on ? LEDM.off : layer === 'cci' ? chMat(r.a.ch) : r.load >= 1 ? LEDM.bad : r.load >= 0.7 ? LEDM.warn : LEDM.ok;
      }
      for (const u of ups) {
        const l = u.l, ls = sim.links[l.id];
        const building = G.Net.linkBuilding(l);
        u.on = G.Net.linkUp(l);
        u.tube.material = building ? cableMat('#7d8b94', 0.35) : l.status !== 'up' ? cableMat('#f25f5c', 1) : cableMat(CAT.cables[l.cable].color, u.on ? 1 : 0.5);
        const fn = 'F:' + fid;
        u.dn = ls && ls.cap ? (l.b === fn ? ls.ab : ls.ba) / ls.cap : 0;
        u.up = ls && ls.cap ? (l.b === fn ? ls.ba : ls.ab) / ls.cap : 0;
      }
      /* IDF 燈號 */
      const stt = G.Views.building.floorStatus(fid);
      const ledHex = idfDark ? '#20262b' : { ok: '#46d17f', warn: '#f0a63a', bad: '#f25f5c', info: '#5aa9f0' }[stt.c] || '#6b808b';
      cabLed.material.color.copy(C(ledHex));
      cab.visible = fs.idf.count > 0;
      /* 覆蓋層 */
      overlay.visible = layer !== 'none' && fs.aps.length > 0;
      if (overlay.visible) {
        const loads = layer === 'load' && st ? fs.aps.map((a) => (st.apStats[a.id] ? Math.round(st.apStats[a.id].load * 20) : 0)).join(',') : '';
        const sO = layer + '|' + sA + '|' + (selAp || '') + '|' + loads;
        if (sO !== sigOv || layerChanged) { sigOv = sO; drawOverlay(plan, st); }
      }
      /* 在座人數與螢幕 */
      const present = st && st.up ? st.present : fs.movedIn * G.Net.presence(s.time, f.type);
      const p = U.clamp(present / f.staff, 0, 1);
      const gp = st && st.guests && G.FT[f.type].guestPeak ? U.clamp(st.guests / G.FT[f.type].guestPeak, 0, 1) : 0;
      let nd = Math.round(p * deskSeats.length);
      let no = Math.round(U.clamp(p * 0.4 + gp * 0.7, 0, 1) * otherSeats.length);
      if (dineMod) {
        /* 餐廳：廚房人員與用餐人潮由 canteen3d 負責；包廂與飲料吧的座位跟著用餐人潮 */
        dineMod.sync(st);
        nd = 0;
        no = Math.round(U.clamp((st ? st.diners || 0 : 0) / G.FT[f.type].diners, 0, 1) * otherSeats.length);
      }
      if (parkMod) parkMod.sync(st);
      if (restMod) restMod.sync(st);
      if (nd + ':' + no !== occSig) { occSig = nd + ':' + no; placePeople(nd, no); }
      /* 資安事件：受感染的電腦螢幕變紅、偽冒 AP */
      let redN = 0, alert = '', rogueNow = null;
      for (const inc of G.Ev.visible()) {
        const d = inc.data || {};
        if (inc.type === 'ransomware' && !d.blocked && (d.infected || []).includes(fid) && !d.rebuilt) { redN = 1e9; alert = d.contained ? '🔒 受感染的電腦已隔離，等待重灌' : '🔒 勒索軟體正在加密這層樓的電腦'; }
        if (inc.type === 'phish' && d.floor === fid && !d.blocked && !d.contained) { redN = Math.max(redN, d.infected || 0); if (!alert) alert = `⚠ 釣魚郵件：${d.infected} 台電腦被植入惡意程式`; }
        if (inc.type === 'rogue-ap' && d.floor === fid && !d.removed) rogueNow = inc.id;
      }
      rogueInc = rogueNow;
      rogue.visible = rogueTag.show = !!rogueNow;
      /* 整層斷線：停電（IDF 沒有 UPS）、上行中斷、交換器故障…… 螢幕變橘色 */
      const netDown = idfDark || (fs.movedIn > 0 && stt.c === 'bad');
      if (fac && fac.outage && idfDark) alert = '⚡ 停電：IDF 沒有 UPS，整層網路中斷';
      else if (netDown) alert = `⚠ ${fid} ${stt.t}：整層樓都連不上網路`;
      alertTag.show = !!alert;
      if (alert) alertTag.set(alert, 'bad');
      const sM = occSig + '|' + redN + '|' + netDown;
      if (sM !== sigMon) {
        sigMon = sM;
        let reds = 0;
        for (let i = 0; i < monPos.length; i++) {
          let c = MON.off;
          if (occupied.has(i)) {
            if (redN && reds < redN) { c = MON.red; reds++; } else c = netDown ? MON.amber : MON.on;
          }
          monitors.setColorAt(i, c);
        }
        if (monitors.instanceColor) monitors.instanceColor.needsUpdate = true;
      }
      /* 標籤與圖例 */
      idfTag.set(fs.idf.count ? `IDF 弱電室 · ${fs.idf.count} 台交換器` : 'IDF 弱電室（還沒有交換器）', fs.idf.count ? (stt.c === 'bad' ? 'bad' : 'info') : 'warn');
      const nUp = Q.linksOf('F:' + fid).length;
      riserTag.set(nUp ? `↓ 弱電豎井：${nUp} 條主幹線往 B1` : '↓ 弱電豎井（還沒有主幹線）', nUp ? 'info' : 'warn');
      if ((cur.ap || null) !== selAp) {
        selAp = cur.ap || null;
        if (selAp) panelSel = { kind: 'ap', id: selAp };
        else if (panelSel && panelSel.kind === 'ap') panelSel = null;
        renderSel();
        sigOv = '';
      }
      syncSel();
      refreshSel();
      legend();
      if (!park) syncSky();
    }

    /* ---------- 提示 ---------- */
    const TNAME = {};
    TNAME[TY.OPEN] = '走道'; TNAME[TY.DESK] = '開放式座位區'; TNAME[TY.MEET] = '會議室'; TNAME[TY.OFFICE] = '辦公室'; TNAME[TY.LAB] = '實驗室';
    TNAME[TY.LOBBY] = '大廳'; TNAME[TY.CAFE] = '茶水間'; TNAME[TY.CORE] = '核心筒'; TNAME[TY.IDF] = 'IDF 弱電室'; TNAME[TY.WALL] = '牆'; TNAME[TY.GLASS] = '玻璃隔間'; TNAME[TY.EXT] = '外牆';
    TNAME[TY.KITCHEN] = '廚房'; TNAME[TY.DINE] = '用餐區'; TNAME[TY.SERVE] = '餐檯 / 櫃台'; TNAME[TY.COLD] = '冷凍庫';
    TNAME[TY.RAMP] = '車道'; TNAME[TY.PARK] = '汽車停車格'; TNAME[TY.MOTO] = '機車停車格'; TNAME[TY.PILLAR] = '結構柱'; TNAME[TY.WC] = '廁所';
    const roomAt = (x, y) => L.rooms.find((r) => r.kind !== TY.CORE && x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
    function spotTip(pt) {
      const s = G.S, fs = s.floors[fid];
      const c = cellOf(pt), i = c.y * W + c.x;
      const room = L.type[i] === TY.WC && L.wc ? { label: (L.wc.find((w) => c.x >= w.x0 && c.x <= w.x1 && c.y >= w.y0 && c.y <= w.y1) || { name: '廁所' }).name } : roomAt(c.x, c.y);
      const out = [`${room ? room.label : TNAME[L.type[i]] || ''}（${c.x}, ${c.y}）`];
      if (fs.aps.length) {
        const plan = G.Wifi.get(fid, new Set(fs.aps.map((a) => a.id)));
        const r = plan.best[i], hh = heatOf(r);
        out.push(r > -110 ? `訊號 ${r.toFixed(0)} dBm（${hh ? hh[2] : '無法連線'}）` : '收不到任何 AP 的訊號');
        const k = plan.bestIdx[i];
        if (k >= 0 && r >= G.Wifi.TH.assoc) { const a = fs.aps.find((x) => x.id === plan.apIds[k]); if (a) out.push(`由 AP (${a.x}, ${a.y})・頻道 ${a.ch} 服務`); }
      } else out.push('這層樓還沒有安裝 AP');
      if (tool === 'place') {
        const ok = G.Layout.canPlaceAp(L, c.x, c.y);
        out.push(ok ? `點一下在這裡安裝 ${CAT.aps[(opts.sel && opts.sel().apModel) || 'AP-600'].name}` : '這裡不能安裝 AP（牆上、核心筒或外牆）');
        ghost.visible = true;
        ghost.position.set(wx(c.x), AP_Y, wz(c.y));
        ghostM.color.copy(C(ok ? '#2fc6b8' : '#f25f5c'));
        api.request();
      }
      return out;
    }
    const focusBox = new T.Mesh(unit, new T.MeshBasicMaterial({ visible: false }));
    focusBox.raycast = noop;
    root.add(focusBox);
    const frameBox = new T.Mesh(unit, new T.MeshBasicMaterial({ visible: false }));
    frameBox.scale.set(W + 1, 3.4, H + 1);
    frameBox.position.y = 1.5;
    frameBox.raycast = noop;
    root.add(frameBox);

    const P = fx.points(1600, 0.3);
    root.add(P.obj);
    const tmp = [0, 0, 0];
    let dark = fx.isDark();
    const pal = () => ({ dn: fx.rgb(dark ? '#cfe0ff' : '#3259b8'), up: fx.rgb(dark ? '#8fb3ff' : '#1d3f8f'), hot: fx.rgb(dark ? '#ffb13b' : '#d45d00') });
    let PAL = pal();
    const offTheme = G.bus.on('theme', () => { dark = fx.isDark(); PAL = pal(); });
    const RIP_BASE = fx.rgb('#5fd4ff'), RED = fx.rgb('#ff4d4d');
    const ripC = new T.Color();
    const PARK_KINDS = ['gate', 'car', 'moto', 'ev', 'cam', 'pillar', 'ramp', 'walker'];
    const floorLike = (k) => k === 'floor' || k === 'spot' || k === 'person' || k === 'wall' || k === 'core' || k === 'crew' || k === 'pos' || k === 'cold' || k === 'wc' || k === 'cleaner' || k === 'wetsign' || k === 'leak' || PARK_KINDS.includes(k);

    return {
      /* 預設視角：從南側正面看進去（yaw 0），平面圖的長邊和畫面平行，不會歪一邊 */
      obj: root, frame: frameBox, view: { yaw: 0, pitch: 0.92, fill: 0.96, balance: true },
      sync,
      animating: () => true,
      tick(dt, t) {
        /* 鏡頭在外面時，擋在前面的那片帷幕玻璃先藏起來 */
        const cp = api.camera.position;
        for (const sd of sides) sd.g.visible = !(sd.nz ? cp.z * sd.nz > FD / 2 : cp.x * sd.nx > FW / 2);
        /* 訊號波紋 */
        if (ripples) {
          let k = 0;
          const push = (x, y, z, col, ph, rmax, amp) => {
            const u = (t * 0.42 + ph) % 1;
            const r = 0.4 + u * rmax;
            dummy.position.set(x, y, z); dummy.scale.set(r, 1, r); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
            ripples.setMatrixAt(k, dummy.matrix);
            const a = Math.pow(1 - u, 1.6) * amp;
            ripC.setRGB(col[0] * a, col[1] * a, col[2] * a);
            ripples.setColorAt(k, ripC);
            k++;
          };
          if (showRip) {
            aps.forEach((r, i) => {
              if (!r.on || k + 2 > ripples.instanceMatrix.count) return;
              const col = layer === 'cci' ? fx.rgb(chHex(r.a.ch)) : layer === 'load' ? fx.rgb(loadHex(r.load)) : RIP_BASE;
              for (let j = 0; j < 2; j++) push(r.x, AP_Y - 0.08, r.z, col, hash(i + 0.3) + j * 0.5, RMAX, 0.36);
            });
          }
          if (rogue.visible && k + 2 <= ripples.instanceMatrix.count) for (let j = 0; j < 2; j++) push(rogue.position.x, 0.9, rogue.position.z, RED, j * 0.5, 7, 0.9);
          ripples.count = k;
          ripples.instanceMatrix.needsUpdate = true;
          if (ripples.instanceColor) ripples.instanceColor.needsUpdate = true;
        }
        /* 線上的流量光點：AP ⇄ IDF、IDF ⇄ B1 */
        P.begin();
        if (showCab) {
          for (const r of aps) {
            if (!r.on || !r.path || r.load <= 0.002) continue;
            const L2 = r.path.len;
            const nd = Math.min(7, 1 + Math.round(r.load * 6)), nu = Math.min(4, 1 + Math.round(r.load * 3));
            const hot = r.load >= 1;
            const vd = (4 + r.load * 8) / L2, vu = (3 + r.load * 6) / L2;
            for (let i = 0; i < nd; i++) { r.path.at(1 - ((t * vd + i / nd) % 1), tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : PAL.dn, 0.95, 1); }
            for (let i = 0; i < nu; i++) { r.path.at((t * vu + i / nu + 0.5 / nu) % 1, tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : PAL.up, 0.75, 0.8); }
          }
          for (const u of ups) {
            if (!u.on) continue;
            const L2 = u.path.len;
            const nd = u.dn > 0.0005 ? Math.min(12, 2 + Math.round(u.dn * 10)) : 0, nu = u.up > 0.0005 ? Math.min(6, 1 + Math.round(u.up * 5)) : 0;
            const hot = u.dn >= 0.9 || u.up >= 0.9;
            const vd = (5 + u.dn * 10) / L2, vu = (4 + u.up * 8) / L2;
            for (let i = 0; i < nd; i++) { u.path.at(1 - ((t * vd + i / nd) % 1), tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : PAL.dn, 0.95, 1.5); }
            for (let i = 0; i < nu; i++) { u.path.at((t * vu + i / nu) % 1, tmp); P.push(tmp[0], tmp[1], tmp[2], hot ? PAL.hot : PAL.up, 0.75, 1.2); }
          }
        }
        P.end();
        if (dineMod) dineMod.tick(dt, t);
        if (parkMod) parkMod.tick(dt, t);
        if (restMod) restMod.tick(dt, t);
        /* 閃爍：偽冒 AP、選取外圈 */
        if (rogue.visible) rogueLed.material.emissiveIntensity = Math.sin(t * 8) > 0 ? 2.6 : 0.3;
        if (selRing.visible) selRing.scale.setScalar(1 + 0.12 * Math.sin(t * 4));
      },
      pickables: () => [root],
      focusObj: (p) => {
        if (p.kind === 'ap') { const r = apRec(p.id); return r ? r.g : null; }
        if (p.kind === 'idf' || p.kind === 'riser') return cab;
        if (p.kind === 'rogue') return rogue;
        if (p.pt) { focusBox.position.set(p.pt[0], 1.2, p.pt[2]); focusBox.scale.set(7, 2.4, 7); focusBox.updateMatrixWorld(true); return focusBox; }
        return null;
      },
      focusFill: (p) => (p.kind === 'ap' ? 0.08 : p.kind === 'idf' || p.kind === 'riser' || p.kind === 'rogue' ? 0.3 : 0.55),
      clickable: (p) => p.kind === 'ap' || p.kind === 'idf' || p.kind === 'riser' || p.kind === 'rogue' || (tool === 'place' && floorLike(p.kind)),
      tip(p) {
        if (p.kind === 'ap' || p.kind === 'idf' || p.kind === 'riser' || p.kind === 'rogue') { const Ls = info(p); return Ls ? Ls.filter(Boolean).concat(['點一下選取・點兩下拉近']) : null; }
        if (dineMod && (p.kind === 'pos' || p.kind === 'cold' || p.kind === 'crew')) {
          const Ls = dineMod.tip(p);
          if (Ls) return Ls.concat(p.pt && tool === 'place' ? spotTip(p.pt).slice(-1) : p.pt ? spotTip(p.pt).slice(1, 2) : []);
        }
        if (parkMod && PARK_KINDS.includes(p.kind)) {
          const Ls = parkMod.tip(p);
          if (Ls) return Ls.filter(Boolean).concat(p.pt && tool === 'place' ? spotTip(p.pt).slice(-1) : p.pt ? spotTip(p.pt).slice(1, 2) : []);
        }
        if (restMod && restMod.kinds.includes(p.kind)) {
          const Ls = restMod.tip(p);
          if (Ls) return Ls.filter(Boolean).concat(p.pt && tool === 'place' ? spotTip(p.pt).slice(-1) : []);
        }
        if (p.kind === 'wall') { const d = WALLDEF[p.cls]; return [d.name, `Wi-Fi 訊號穿過時衰減${d.att}`].concat(p.pt && tool === 'place' ? spotTip(p.pt).slice(-1) : []); }
        if (p.kind === 'core') return ['核心筒（電梯 / 樓梯）', '鋼筋混凝土：訊號衰減 8～15 dB，幾乎穿不透', 'IDF 弱電室就在核心筒裡、緊鄰弱電豎井'];
        if (p.pt) return spotTip(p.pt);
        return null;
      },
      click(p) {
        if (tool === 'place' && floorLike(p.kind) && p.pt) {
          const c = cellOf(p.pt);
          if (opts.onPlace) opts.onPlace(c.x, c.y);
          return true;
        }
        if (p.kind === 'ap') {
          selAp = p.id;
          panelSel = { kind: 'ap', id: p.id };
          if (opts.onAp) opts.onAp(p.id);
          sigOv = '';
          renderSel(); syncSel();
          return true;
        }
        if (p.kind === 'idf' || p.kind === 'riser' || p.kind === 'rogue') { panelSel = { kind: p.kind === 'riser' ? 'idf' : p.kind }; renderSel(); return true; }
        if (selAp && opts.onAp) opts.onAp(null);
        selAp = null;
        panelSel = null;
        sigOv = '';
        renderSel(); syncSel();
        return false;
      },
      clickEmpty() { if (selAp && opts.onAp) opts.onAp(null); selAp = null; panelSel = null; sigOv = ''; renderSel(); syncSel(); },
      dispose() {
        offTheme();
        if (dineMod) dineMod.dispose();
        if (parkMod) parkMod.dispose();
        if (restMod) restMod.dispose();
        for (const t of allTags) t.remove();
        for (const t of chTags) t.remove();
        for (const m of mats) m.dispose();
        for (const m of chMats.values()) m.dispose();
        for (const m of cableMats.values()) m.dispose();
        for (const m of Object.values(LEDM)) m.dispose();
        ovT.dispose();
      },
    };
  }
})(window.G = window.G || {});
