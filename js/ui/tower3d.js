/* 3D 大樓剖面：23 層樓（22F、23F 員工餐廳）+ B1 機房 + B2 員工停車場、弱電豎井裡的主幹線、ISP 進線、即時流量與駭客攻擊路徑
 * 單位：公尺。窗戶亮燈 = 進駐人數、顏色 = 滿意度；線上的光點 = 流量（越多越滿）；紅色 = 中斷或攻擊。
 * 攻擊路徑只顯示「已偵測到」的資安事件，並沿著模擬中實際的路由（ISP → 路由器 → 防火牆 → 核心 → 樓層）移動。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q, M3 = G.M3;
  const W = 46, D = 22, FH = 4.2, B1 = -5;
  const NF = G.BLD.top;
  const RX = W / 2 - 3.2, RZ = D / 2 - 3.2;
  const CLOUD = [-40, 60, 16];
  const RACKZ = -D / 2 + 2.3, RACKF = RACKZ + 1.1;
  const HEX = { ok: '#46d17f', warn: '#f0a63a', bad: '#f25f5c', info: '#5aa9f0', none: '#6b808b' };
  const PANES = [];

  /** opts: { height, onFloor(fid), onRack(), onDev(id), onTopo(), onInc() } */
  M3.tower = (opts) => M3.stage({ height: opts.height, label: '3D 大樓剖面', fov: 32, pitchMin: -0.3, minFar: 2600, create: (api) => createTower(api, opts) });

  /* 地上樓層從 0 往上；地下室在 B1 機房下面（B2 = −2） */
  const yOf = (level) => (level > 0 ? (level - 1) * FH : B1 - FH * (-level - 1));
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
    const DEEP = -B1 + FH + 2.4;
    const secL = K.plane(90 - W / 2, DEEP, earthM); secL.position.set(-(90 + W / 2) / 2, -DEEP / 2, D / 2); root.add(secL);
    const secR = K.plane(90 - W / 2, DEEP, earthM); secR.position.set((90 + W / 2) / 2, -DEEP / 2, D / 2); root.add(secR);
    const secB = K.plane(W, 1.6, K.std('#3a2f27', { roughness: 0.95 })); secB.position.set(0, B1 - FH - 1.2, D / 2); root.add(secB);
    const gs = new T.Shape();
    [[-90, 70], [90, 70], [90, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, -D / 2], [-90, -D / 2]].forEach(([x, y], i) => (i ? gs.lineTo(x, y) : gs.moveTo(x, y)));
    const ground = new T.Mesh(new T.ShapeGeometry(gs), K.std('#27313a', { roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    root.add(ground);
    /* 周邊街景：大道、斑馬線、行人與車流、行道樹、路燈、對面街廓、公園 */
    const city = M3.city ? M3.city(api) : null;
    if (city) root.add(city.obj);
    let nightK = 0;

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
    for (const f of G.BLD.hq) {
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
      const rec = { f, y, slab, glass, idf, led, tag, col: HEX.none, lit: 0, under: f.level < 0 };
      /* 地下停車場：擋土牆 + 一排排停好的車（跟著上下班時段增減） */
      if (rec.under) {
        glass.visible = edges.visible = false;
        const wallM = K.std('#2b353d', { roughness: 0.9 });
        const bk = K.plane(W, FH, wallM); bk.position.set(0, y + FH / 2, -D / 2); root.add(bk);
        for (const sx of [-1, 1]) { const sd = K.plane(D, FH, wallM); sd.rotation.y = sx * -Math.PI / 2; sd.position.set(sx * W / 2, y + FH / 2, 0); root.add(sd); }
        const ramp = K.box(8, 0.25, 3.2, concrete); ramp.position.set(-W / 2 - 3.6, y + FH / 2 + 0.6, -D / 2 + 2.2); ramp.rotation.z = -0.5; root.add(ramp);
        const slots = [];
        for (const zz of [-D / 2 + 2.2, -1.6, 1.6, D / 2 - 2.4]) for (let x = -W / 2 + 3; x <= W / 2 - 6; x += 2.7) if (!(Math.abs(zz) < 3 && x > RX - 6)) slots.push([x, zz]);
        slots.sort((a, b) => hash(a[0] * 5.1 + a[1] * 3.3) - hash(b[0] * 5.1 + b[1] * 3.3));
        const carM = new T.InstancedMesh(new T.BoxGeometry(1.8, 1.1, 4.2), K.std('#ffffff', { metalness: 0.5, roughness: 0.4 }), slots.length);
        const CARC = ['#f2f3f3', '#c8ccd0', '#2a2e33', '#8d949a', '#1f3552', '#c0392b', '#d8d2c4'];
        const dm = new T.Object3D();
        slots.forEach((p, i) => { dm.position.set(p[0], y + 0.35 + 0.55, p[1]); dm.updateMatrix(); carM.setMatrixAt(i, dm.matrix); carM.setColorAt(i, C(CARC[Math.floor(hash(i * 3.7 + 1) * CARC.length)])); });
        carM.count = 0;
        carM.userData.pick = { kind: 'floor', id: f.id };
        root.add(carM);
        rec.cars = carM; rec.carSlots = slots.length;
      }
      floors.push(rec);
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
    const win = new T.InstancedMesh(new T.PlaneGeometry(2.3, 2.5), new T.MeshBasicMaterial({ color: 0xffffff }), per * floors.length);
    const dummy = new T.Object3D();
    const DARK = C('#1a2733'), tmpC = new T.Color();
    floors.forEach((fl, L) => {
      PANES.forEach((p, i) => {
        dummy.position.set(p.x, fl.y + 0.35 + 1.95, p.z);
        dummy.rotation.set(0, p.ry, 0);
        /* 地下室沒有窗戶 */
        dummy.scale.setScalar(fl.under ? 0 : 1);
        dummy.updateMatrix();
        win.setMatrixAt(L * per + i, dummy.matrix);
        win.setColorAt(L * per + i, DARK);
      });
      fl.order = PANES.map((p, i) => i).sort((a, b) => hash(L * 131 + a) - hash(L * 131 + b));
    });
    win.userData.pick = { kind: 'pane' };
    root.add(win);

    /* 弱電豎井 */
    const BOT = Math.min(B1, ...floors.map((fl) => fl.y));
    const shaftH = NF * FH - BOT;
    const shaft = K.box(4.4, shaftH, 4.4, K.std('#2fc6b8', { transparent: true, opacity: 0.06, depthWrite: false, roughness: 0.3 }));
    shaft.position.set(RX, BOT + shaftH / 2, RZ);
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
    /* 戶外的柴油發電機（有安裝才出現），運轉時冒排氣 */
    const genG = new T.Group();
    const genBody = K.box(6, 2.6, 2.4, K.std('#d4ad3f', { metalness: 0.3, roughness: 0.5 }));
    genBody.position.y = 1.3 + 0.3;
    const genBase = K.box(6.4, 0.3, 2.8, K.std('#2a2f33', { metalness: 0.6 }));
    genBase.position.y = 0.15;
    const genPipe = K.cylY(0.18, 1.6, K.std('#5a5f63', { metalness: 0.8, roughness: 0.35 }), 12);
    genPipe.position.set(1.8, 3.4, 0.3);
    genG.add(genBody, genBase, genPipe);
    genG.position.set(W / 2 + 7, 0, -3);
    genG.userData.pick = { kind: 'gen' };
    genG.visible = false;
    root.add(genG);
    const GEN_TOP = [W / 2 + 7 + 1.8, 4.3, -3 + 0.3];
    const genTag = api.tag('發電機', 'info');
    genTag.pos.set(W / 2 + 7, 5.4, -3);
    genTag.show = false;
    const alertTag = api.tag('', 'bad', 'center', 4);
    alertTag.pos.set(0, NF * FH + 6, 0);
    alertTag.show = false;

    /* ---------- 大樓後方：晶圓廠 Fab 1（第十章開廠）；之前是圍起來的預定地，動工後是依工程進度長高的工地 ----------
     * 西側是支援區（入口、更衣室、FAB IDF、控制室，有窗戶），東側是沒有窗戶的無塵室廠房；屋頂有外氣空調箱（MAU）與廢氣洗滌塔的排氣管。
     * FAB IDF 經地面上的光纖管溝連回總部 B1（校園主幹） */
    const FB = { x0: -20, x1: 22, z0: -62, z1: -25, h: 15, ax: -10 };
    const TRX = 9;
    const FAB_IDF = [FB.x0 + 3.2, 1.3, FB.z1 - 2.4];
    /* lotG = 工地圍籬與告示牌（開廠前都在）；siteG = 興建中的廠房（地基 → 鋼構 → 外牆，旁邊一台塔式起重機）；fabG = 完工的廠房 */
    const lotG = new T.Group(), siteG = new T.Group(), fabG = new T.Group();
    root.add(lotG, siteG, fabG);
    /* 工地範圍：廠房四周留一點空地，北側（後面）放起重機與工務所；東邊不能超過公園（x = 24） */
    const SB = { x0: FB.x0 - 1.5, x1: FB.x1 + 1.5, z0: FB.z0 - 8, z1: FB.z1 + 2 };
    const signTex = {};
    let lotSign = null, signKind = '';
    {
      const postM = K.std('#c9cdd1', { metalness: 0.5, roughness: 0.5 }), meshM = K.std('#8f969b', { transparent: true, opacity: 0.35, metalness: 0.3, depthWrite: false });
      const fence = (x0, z0, x1, z1) => {
        const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
        const m = K.box(len, 1.8, 0.05, meshM); m.position.set((x0 + x1) / 2, 0.9, (z0 + z1) / 2); m.rotation.y = -ang; m.raycast = () => {}; lotG.add(m);
        for (let k = 0; k <= Math.round(len / 4); k++) { const u = k / Math.round(len / 4); const p = K.box(0.1, 2, 0.1, postM); p.position.set(x0 + (x1 - x0) * u, 1, z0 + (z1 - z0) * u); p.raycast = () => {}; lotG.add(p); }
      };
      fence(SB.x0, SB.z0, SB.x1, SB.z0); fence(SB.x1, SB.z0, SB.x1, SB.z1); fence(SB.x1, SB.z1, SB.x0, SB.z1); fence(SB.x0, SB.z1, SB.x0, SB.z0);
      /* 告示牌：預定地 / 興建中（第二行是預計完工） */
      signTex.lot = K.makeTex(360, 160, (c) => { K.D.rect(c, 0, 0, 360, 160, '#1c3a5a'); K.D.txt(c, 'NOVALUX Fab 1', 180, 62, 40, '#e8f0f5', 'center', 800); K.D.txt(c, '12 吋晶圓廠預定地', 180, 116, 30, '#f2c14e', 'center', 700); }, 1.5);
      const building = (eta) => K.makeTex(360, 160, (c) => {
        K.D.rect(c, 0, 0, 360, 160, '#1c3a5a');
        K.D.rect(c, 0, 0, 360, 12, '#f2c14e');
        for (let x = -12; x < 360; x += 24) K.D.rect(c, x, 0, 12, 12, '#1d2227');
        K.D.txt(c, 'NOVALUX Fab 1', 180, 58, 38, '#e8f0f5', 'center', 800);
        K.D.txt(c, '12 吋晶圓廠 興建中', 180, 100, 28, '#f2c14e', 'center', 700);
        K.D.txt(c, eta, 180, 138, 20, '#c8d6df', 'center', 600);
      }, 1.5);
      signTex.sandbox = building('預計第 6 天完工');
      signTex.campaign = building('預計第十章完工啟用');
      lotSign = K.plane(7, 3.1, K.texMat(signTex.lot, { metalness: 0, roughness: 0.6 }));
      lotSign.position.set((FB.x0 + FB.x1) / 2, 2.6, SB.z1 + 0.1);
      lotSign.userData.pick = { kind: 'fablot' };
      lotG.add(lotSign);
      const legs = K.box(6.6, 0.1, 0.1, postM); legs.position.set(lotSign.position.x, 1, SB.z1 + 0.05); lotG.add(legs);
    }
    /* 興建中的廠房：每一根鋼柱、每一面牆都是單位高度的方塊，用 scale.y 長高 */
    const site = { cols: [], beams: [], walls: [], brace: [], jib: null, trolley: null, cable: null, hook: null, light: null };
    {
      const pick = { kind: 'fablot' };
      const slab = K.box(FB.x1 - FB.x0, 0.3, FB.z1 - FB.z0, K.std('#9ea5aa', { roughness: 0.95, metalness: 0 }));
      slab.position.set((FB.x0 + FB.x1) / 2, 0.15, (FB.z0 + FB.z1) / 2);
      slab.userData.pick = pick;
      siteG.add(slab);
      /* 鋼構（紅色防鏽底漆） */
      const steelM = K.std('#b0532f', { metalness: 0.55, roughness: 0.5 });
      const unit = new T.BoxGeometry(1, 1, 1);
      const colAt = (x, z, hMax) => { const m = new T.Mesh(unit, steelM); m.scale.set(0.5, 0.01, 0.5); m.position.set(x, 0.3, z); m.userData.hMax = hMax; m.userData.pick = pick; siteG.add(m); site.cols.push(m); };
      const xs = [0, 1, 2, 3, 4].map((i) => FB.ax + (FB.x1 - FB.ax) * i / 4), zs = [0, 1, 2, 3, 4, 5].map((j) => FB.z0 + (FB.z1 - FB.z0) * j / 5);
      for (const x of xs) for (const z of zs) colAt(x, z, FB.h);
      for (const x of [FB.x0, (FB.x0 + FB.ax) / 2]) for (const z of zs) colAt(x, z, 8.4);
      /* 橫梁：到了那個高度才出現 */
      /* frac = 鋼構要長到幾成才會出現這根梁 */
      const beamAt = (x0, z0, x1, z1, y, frac, d) => {
        const m = new T.Mesh(unit, steelM);
        m.scale.set(Math.max(0.35, Math.abs(x1 - x0)), d || 0.45, Math.max(0.35, Math.abs(z1 - z0)));
        m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
        m.userData.frac = frac; m.raycast = () => {};
        siteG.add(m); site.beams.push(m);
      };
      for (const y of [5, 10, FB.h]) {
        beamAt(FB.ax, FB.z0, FB.x1, FB.z0, y, y / FB.h); beamAt(FB.ax, FB.z1, FB.x1, FB.z1, y, y / FB.h);
        beamAt(FB.ax, FB.z0, FB.ax, FB.z1, y, y / FB.h); beamAt(FB.x1, FB.z0, FB.x1, FB.z1, y, y / FB.h);
      }
      for (const y of [4.2, 8.4]) { beamAt(FB.x0, FB.z0, FB.ax, FB.z0, y, y / 8.4); beamAt(FB.x0, FB.z1, FB.ax, FB.z1, y, y / 8.4); beamAt(FB.x0, FB.z0, FB.x0, FB.z1, y, y / 8.4); }
      /* 屋頂桁架（鋼構到頂才有） */
      for (const x of xs.slice(1, -1)) beamAt(x, FB.z0, x, FB.z1, FB.h, 1, 0.9);
      for (const z of zs.slice(1, -1)) beamAt(FB.ax, z, FB.x1, z, FB.h + 0.2, 1, 0.3);
      /* 正面兩格的交叉斜撐 */
      for (const [xa, xb] of [[xs[0], xs[1]], [xs[3], xs[4]]]) for (const [ya, yb] of [[0.3, 5], [5, 10]]) for (const sgn of [1, -1]) {
        const len = Math.hypot(xb - xa, yb - ya);
        const m = new T.Mesh(unit, steelM);
        m.scale.set(len, 0.2, 0.2);
        m.position.set((xa + xb) / 2, (ya + yb) / 2, FB.z1 + 0.1);
        m.rotation.z = sgn * Math.atan2(yb - ya, xb - xa);
        m.userData.frac = yb / FB.h; m.raycast = () => {};
        siteG.add(m); site.brace.push(m);
      }
      /* 外牆（由下往上封板，上面是開的：看得到裡面的鋼構）；牆比鋼柱厚，封好的地方就把鋼構包起來 */
      const wallAt = (x0, z0, x1, z1, hMax, mat) => {
        const m = new T.Mesh(unit, mat);
        m.scale.set(Math.max(0.6, Math.abs(x1 - x0) + 0.6), 0.01, Math.max(0.6, Math.abs(z1 - z0) + 0.6));
        m.position.set((x0 + x1) / 2, 0.3, (z0 + z1) / 2);
        m.userData.hMax = hMax; m.userData.pick = pick;
        siteG.add(m); site.walls.push(m);
      };
      const cladM = K.std('#dfe3e6', { metalness: 0.25, roughness: 0.55 }), annexM = K.std('#b9c3c9', { metalness: 0.2, roughness: 0.6 });
      wallAt(FB.ax, FB.z0, FB.x1, FB.z0, FB.h, cladM); wallAt(FB.ax, FB.z1, FB.x1, FB.z1, FB.h, cladM);
      wallAt(FB.ax, FB.z0, FB.ax, FB.z1, FB.h, cladM); wallAt(FB.x1, FB.z0, FB.x1, FB.z1, FB.h, cladM);
      wallAt(FB.x0, FB.z0, FB.ax, FB.z0, 8.4, annexM); wallAt(FB.x0, FB.z1, FB.ax, FB.z1, 8.4, annexM); wallAt(FB.x0, FB.z0, FB.x0, FB.z1, 8.4, annexM);
      /* 工務所：北側兩個疊起來的貨櫃屋 */
      const boxM = K.std('#2f6fa3', { metalness: 0.4, roughness: 0.55 });
      for (const [x, y] of [[FB.x0 + 4, 1.3], [FB.x0 + 4, 3.9], [FB.x0 + 11, 1.3]]) { const c = K.box(6, 2.6, 2.4, boxM); c.position.set(x, y, FB.z0 - 4); c.userData.pick = pick; siteG.add(c); }
      /* 塔式起重機：格子桁架的塔身與吊臂（黃色）、配重、駕駛室、頂端的航空障礙燈 */
      const latT = K.makeTex(64, 64, (c) => {
        c.clearRect(0, 0, 64, 64);
        c.strokeStyle = '#f2b822'; c.lineWidth = 6;
        c.strokeRect(3, 3, 58, 58);
        c.beginPath(); c.moveTo(3, 61); c.lineTo(61, 3); c.stroke();
      }, 1);
      const lat = (rx, ry) => { const t = latT.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx, ry); return K.texMat(t, { transparent: true, alphaTest: 0.4, side: T.DoubleSide, metalness: 0.4, roughness: 0.5 }); };
      const CR = { x: FB.x1 - 9, z: FB.z0 - 4.5, h: FB.h + 17 };
      const craneG = new T.Group();
      craneG.position.set(CR.x, 0, CR.z);
      siteG.add(craneG);
      const base = K.box(4, 0.8, 4, K.std('#8d9398', { roughness: 0.9 })); base.position.y = 0.4; craneG.add(base);
      const mast = K.box(1.6, CR.h, 1.6, lat(1, CR.h / 1.6)); mast.position.y = CR.h / 2 + 0.8; mast.userData.pick = pick; craneG.add(mast);
      const jib = new T.Group(); jib.position.y = CR.h + 0.8; craneG.add(jib);
      site.jibY = CR.h + 0.8;
      const arm = K.box(34, 1.3, 1.3, lat(34 / 1.3, 1)); arm.position.x = 17; jib.add(arm);
      const counter = K.box(10, 1.1, 1.3, lat(10 / 1.1, 1)); counter.position.x = -5; jib.add(counter);
      const weight = K.box(2.4, 2.2, 2, K.std('#6f757a', { roughness: 0.9 })); weight.position.set(-8.6, -1.2, 0); jib.add(weight);
      const cab = K.box(1.8, 1.8, 1.8, K.std('#e9edf0', { metalness: 0.3 })); cab.position.set(1.8, -1.6, 1.4); jib.add(cab);
      const head = K.box(1, 5, 1, lat(1, 4)); head.position.y = 3.1; jib.add(head);
      const tieM = new T.LineBasicMaterial({ color: 0xd8b64a });
      jib.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-9.5, 0.6, 0), new T.Vector3(0, 5.6, 0), new T.Vector3(33.5, 0.6, 0)]), tieM));
      site.light = new T.Mesh(new T.SphereGeometry(0.35, 10, 8), K.glow('#ff3b30', 2.4));
      site.light.position.y = 5.8; jib.add(site.light);
      /* 吊車與吊鉤（吊著一根鋼梁） */
      const trolley = K.box(1.4, 0.5, 1.5, K.std('#3a4046')); trolley.position.set(20, -0.9, 0); jib.add(trolley);
      const cable = new T.Mesh(unit, new T.MeshBasicMaterial({ color: 0x2b3035 })); jib.add(cable);
      const hook = K.box(2.2, 0.35, 0.35, steelM); jib.add(hook);
      site.jib = jib; site.trolley = trolley; site.cable = cable; site.hook = hook;
    }
    /** 依工程進度長高：前半段吊鋼構，後半段由下往上封外牆 */
    function growSite(p) {
      const fr = U.clamp(p / 0.5, 0, 1), cl = U.clamp((p - 0.45) / 0.5, 0, 1);
      for (const c of site.cols) { const h = Math.max(0.01, c.userData.hMax * fr); c.scale.y = h; c.position.y = 0.3 + h / 2; }
      for (const b of site.beams) b.visible = fr >= b.userData.frac - 1e-6;
      for (const b of site.brace) b.visible = fr >= b.userData.frac - 1e-6;
      for (const w of site.walls) { const h = Math.max(0.01, w.userData.hMax * cl); w.scale.y = h; w.position.y = 0.3 + h / 2; w.visible = cl > 0; }
      site.top = 0.3 + FB.h * fr;
    }
    const fabBody = K.box(FB.x1 - FB.ax, FB.h, FB.z1 - FB.z0, K.std('#dfe3e6', { metalness: 0.25, roughness: 0.55 }));
    fabBody.position.set((FB.x1 + FB.ax) / 2, FB.h / 2, (FB.z0 + FB.z1) / 2);
    fabBody.userData.pick = { kind: 'fabb' };
    fabG.add(fabBody);
    {
      const bandM = K.std('#5b6770', { metalness: 0.4, roughness: 0.5 });
      for (const y of [5, 11]) { const b = K.box(FB.x1 - FB.ax + 0.12, 0.35, FB.z1 - FB.z0 + 0.12, bandM); b.position.set(fabBody.position.x, y, fabBody.position.z); b.raycast = () => {}; fabG.add(b); }
      /* 支援區（有窗戶的兩層樓） */
      const annex = K.box(FB.ax - FB.x0, 8.4, FB.z1 - FB.z0, K.std('#b9c3c9', { metalness: 0.2, roughness: 0.6 }));
      annex.position.set((FB.x0 + FB.ax) / 2, 4.2, (FB.z0 + FB.z1) / 2);
      annex.userData.pick = { kind: 'fabb' };
      fabG.add(annex);
      const winM = K.glow('#9fd8ff', 0.35);
      for (const y of [2.4, 6.2]) for (let z = FB.z0 + 2.5; z < FB.z1 - 1; z += 3.2) { const wn = K.box(0.06, 1.3, 2.2, winM); wn.position.set(FB.x0 - 0.04, y, z); wn.raycast = () => {}; fabG.add(wn); }
      for (const y of [2.4, 6.2]) for (let x = FB.x0 + 1.6; x < FB.ax - 1; x += 3) { const wn = K.box(2, 1.3, 0.06, winM); wn.position.set(x, y, FB.z1 + 0.04); wn.raycast = () => {}; fabG.add(wn); }
      /* 屋頂：外氣空調箱、廢氣洗滌塔的排氣管 */
      const mauM = K.std('#aab4ba', { metalness: 0.5, roughness: 0.45 }), stackM = K.std('#e6e8ea', { metalness: 0.6, roughness: 0.35 });
      for (let k = 0; k < 4; k++) { const m = K.box(4.2, 2.2, 6, mauM); m.position.set(FB.ax + 5 + k * 7.6, FB.h + 1.1, FB.z0 + 8); m.raycast = () => {}; fabG.add(m); }
      for (let k = 0; k < 3; k++) { const st = K.cylY(0.55, 7, stackM, 14); st.position.set(FB.ax + 8 + k * 9, FB.h + 3.5, FB.z1 - 6); st.raycast = () => {}; fabG.add(st); }
      const logoT = K.makeTex(520, 120, (c) => { K.D.rect(c, 0, 0, 520, 120, '#10171c'); K.D.txt(c, 'NOVALUX FAB 1', 260, 64, 64, '#dce7ec', 'center', 800); }, 1.5);
      const lg = K.plane(13, 3, K.texMat(logoT, { metalness: 0, roughness: 0.5, emissive: C('#ffffff'), emissiveIntensity: 0.12 }));
      lg.rotation.y = Math.PI / 2;
      lg.position.set(FB.x1 + 0.06, FB.h - 2.4, (FB.z0 + FB.z1) / 2);
      lg.raycast = () => {};
      fabG.add(lg);
    }
    /* 屋頂的狀態燈：綠 = 量產中、橘 = 機台還在進廠 / 產能不足、紅 = IT 造成停線 */
    const fabLamp = new T.Mesh(new T.SphereGeometry(0.7, 14, 10), K.glow('#6b808b', 1.8));
    fabLamp.position.set(FB.x1 - 3, FB.h + 1.4, FB.z1 - 3);
    fabG.add(fabLamp);
    /* 光纖管溝（地面上的蓋板）：總部後牆 → 晶圓廠 */
    const trench = K.box(2.4, 0.14, FB.z1 - (-D / 2) + 0.6, K.std('#59636b', { roughness: 0.9 }));
    trench.position.set(TRX, 0.07, (FB.z1 - D / 2) / 2);
    trench.raycast = () => {};
    fabG.add(trench);
    const fabTag = api.tag('Fab 1 晶圓廠', 'info', 'center', 2);
    fabTag.pos.set((FB.x0 + FB.x1) / 2 + 6, FB.h + 5, (FB.z0 + FB.z1) / 2);
    const campusTag = api.tag(`校園光纖 ${G.BLD.campus} m（地下管溝）`, 'info', 'center', 1);
    campusTag.pos.set(TRX, 1.4, (FB.z1 - D / 2) / 2);

    /* ---------- 中央廠務區（第十一章）：晶圓廠北側的變電站、DUPS 與發電機、液氮儲槽、冷卻水塔、化學品槽區 ----------
     * 蓋了幾組就出現幾組（主變壓器、DUPS、發電機、大宗氣體站、化學品系統） */
    const cubG = new T.Group();
    root.add(cubG);
    const CZ = FB.z0 - 4;
    const cub = { tx: [], dups: [], gen: [], n2: [], chem: [], towers: [], fans: [] };
    {
      const pick = { kind: 'cub' };
      const pad = K.box(FB.x1 - FB.x0, 0.2, 7.6, K.std('#9ea5aa', { roughness: 0.95, metalness: 0 }));
      pad.position.set((FB.x0 + FB.x1) / 2, 0.1, CZ);
      pad.userData.pick = pick;
      cubG.add(pad);
      /* 主變壓器：本體 + 散熱片 + 套管 */
      const txM = K.std('#7d8a93', { metalness: 0.5, roughness: 0.5 }), finM = K.std('#5d6870', { metalness: 0.5, roughness: 0.5 }), bushM = K.std('#c79a5a', { roughness: 0.6 });
      for (let i = 0; i < 4; i++) {
        const g = new T.Group();
        g.position.set(FB.x0 + 1.8 + i * 2.9, 0, CZ + 1.7);
        const b = K.box(2, 2.3, 1.5, txM); b.position.y = 1.35; b.userData.pick = pick; g.add(b);
        for (let k = -3; k <= 3; k++) { const f = K.box(0.07, 1.7, 2.1, finM); f.position.set(k * 0.28, 1.25, 0); f.raycast = () => {}; g.add(f); }
        for (const x of [-0.5, 0, 0.5]) { const u = K.cylY(0.09, 0.6, bushM, 8); u.position.set(x, 2.8, 0); u.raycast = () => {}; g.add(u); }
        cubG.add(g); cub.tx.push(g);
      }
      /* DUPS（紫色條紋的貨櫃）與緊急發電機（黃色） */
      const dupsM = K.std('#3b4450', { metalness: 0.4, roughness: 0.5 }), dupsS = K.glow('#a78bfa', 0.5), genM = K.std('#d4ad3f', { metalness: 0.3, roughness: 0.5 });
      for (let i = 0; i < 4; i++) {
        const g = new T.Group();
        g.position.set(FB.x0 + 1.9 + i * 3.1, 0, CZ - 2);
        const b = K.box(2.8, 2.4, 2.1, dupsM); b.position.y = 1.4; b.userData.pick = pick; g.add(b);
        const st = K.box(2.82, 0.18, 2.12, dupsS); st.position.y = 2.1; st.raycast = () => {}; g.add(st);
        cubG.add(g); cub.dups.push(g);
      }
      for (let i = 0; i < 3; i++) {
        const g = new T.Group();
        g.position.set(-5.2 + i * 3.4, 0, CZ - 2);
        const b = K.box(3, 2.3, 2, genM); b.position.y = 1.35; b.userData.pick = pick; g.add(b);
        const p = K.cylY(0.14, 1.1, K.std('#5a5f63', { metalness: 0.8 }), 10); p.position.set(0.9, 3, 0.3); p.raycast = () => {}; g.add(p);
        cubG.add(g); cub.gen.push(g);
      }
      /* 大宗氣體站：液氮儲槽（直立白色） */
      const tankM = K.std('#eef1f3', { metalness: 0.35, roughness: 0.35 });
      for (let i = 0; i < 4; i++) {
        const g = new T.Group();
        g.position.set(-5.5 + i * 2.6, 0, CZ + 1.6);
        const c = K.cylY(0.95, 6.5, tankM, 20); c.position.y = 3.65; c.userData.pick = pick; g.add(c);
        const top = new T.Mesh(new T.SphereGeometry(0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), tankM); top.position.y = 6.9; top.raycast = () => {}; g.add(top);
        cubG.add(g); cub.n2.push(g);
      }
      /* 冷卻水塔（無塵室空調的冰水主機散熱）：頂上的風扇在轉 */
      const towM = K.std('#c3cbd0', { metalness: 0.2, roughness: 0.7 }), fanM = K.std('#2c3136', { metalness: 0.5 });
      for (let i = 0; i < 2; i++) {
        const g = new T.Group();
        g.position.set(6.5 + i * 4, 0, CZ);
        const b = K.box(3.4, 3.2, 3.4, towM); b.position.y = 1.8; b.userData.pick = pick; g.add(b);
        const sh = K.cylY(1.3, 0.8, fanM, 20); sh.position.y = 3.8; sh.raycast = () => {}; g.add(sh);
        const fan = K.box(2.2, 0.06, 0.3, K.std('#8b949a')); fan.position.y = 4.25; fan.raycast = () => {}; g.add(fan);
        cubG.add(g); cub.towers.push(g); cub.fans.push(fan);
      }
      /* 化學品槽區：防溢堤裡的儲槽 */
      const dike = K.box(7, 0.5, 5.4, K.std('#8b99a3', { roughness: 0.9, metalness: 0 }));
      dike.position.set(17.6, 0.35, CZ);
      dike.userData.pick = pick;
      cubG.add(dike);
      const CC = ['#f1ecd9', '#f1ecd9', '#e3eef7', '#e3eef7', '#d9d2c3', '#d9d2c3'];
      for (let i = 0; i < 6; i++) {
        const c = K.cylY(0.6, 2.2, K.std(CC[i], { roughness: 0.55 }), 16);
        c.position.set(15.4 + (i % 3) * 2.2, 1.7, CZ - 1.2 + Math.floor(i / 3) * 2.4);
        c.userData.pick = pick;
        cubG.add(c); cub.chem.push(c);
      }
    }
    const cubTag = api.tag('中央廠務區', 'info', 'center', 1);
    cubTag.pos.set(FB.x0 + 12, 9, CZ);
    const FX = fx.emitter(700, 1.1);
    root.add(FX.obj);
    const fxState = {};
    const SPARK0 = fx.rgb('#fff3b0'), SPARK1 = fx.rgb('#ff5a1f'), SMK0 = fx.rgb('#7b8288'), SMK1 = fx.rgb('#2b3035'), HEAT0 = fx.rgb('#ff9a4a'), HEAT1 = fx.rgb('#ff3b30');
    function tickFx(dt) {
      const s = G.S, fac = G.R.fac;
      for (const cb of cables.values()) {
        if (cb.l.status !== 'cut') continue;
        const k = FX.rate(fxState, 'cut' + cb.l.id, 36, dt);
        for (let i = 0; i < k; i++) FX.emit(cb.cutPt, { v: [0, 2, 0], spread: 8, life: 0.6, g: 14, c0: SPARK0, c1: SPARK1, s0: 0.55, s1: 0.15, a: 1 });
      }
      for (const x of isps.values()) {
        if (!x.c.outage) continue;
        const k = FX.rate(fxState, 'isp' + x.c.id, 24, dt);
        for (let i = 0; i < k; i++) FX.emit([-W / 2 - 8, 0.8, D / 2 + 0.4], { v: [0, 3, 0.5], spread: 7, life: 0.6, g: 14, c0: SPARK0, c1: SPARK1, s0: 0.55, s1: 0.15, a: 1 });
      }
      if (fac && fac.genRunning && genG.visible) {
        const k = FX.rate(fxState, 'gen', 9, dt);
        for (let i = 0; i < k; i++) FX.emit(GEN_TOP, { v: [0.8, 3.6, 0], spread: 1.2, life: 3.4, c0: SMK0, c1: SMK1, s0: 1.2, s1: 4.2, a: 0.6 });
      }
      if (s.temp >= 30) {
        const k = FX.rate(fxState, 'heat', Math.min(24, (s.temp - 29) * 2.5), dt);
        for (let i = 0; i < k; i++) FX.emit([U.rand(-W / 2 + 4, W / 2 - 4), B1 + 3.9, U.rand(-D / 2 + 2, D / 2 - 2)], { v: [0, 0.7, 0], spread: 0.4, life: 2.2, c0: HEAT0, c1: HEAT1, s0: 1.4, s1: 3, a: 0.32 });
      }
      FX.tick(dt);
    }
    /* 預設取景：大樓 + 雲（不含大片地面） */
    const frameBox = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ visible: false }));
    frameBox.scale.set(W / 2 + 52, NF * FH + 18 - (BOT - B1), D / 2 + 24);
    frameBox.position.set((W / 2 - 52) / 2, (NF * FH + 10 - 8 + (BOT - B1)) / 2, (24 - D / 2) / 2);
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
        if (!d.rack || d.host) continue;
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
    /** 晶圓廠的上行：B1 機櫃 → 天花板線槽 → 穿出總部後牆 → 地面管溝 → 晶圓廠的 FAB IDF */
    function fabCablePts(k, dp) {
      const lx = ((k % 5) - 2) * 0.32;
      const yc = B1 + 4.35 - (k % 4) * 0.12;
      const x = (dp ? dp[0] : 0) + lx * 0.2;
      const pts = [];
      if (dp) pts.push([x, dp[1], RACKF + 0.1]);
      pts.push([x, yc, RACKF + 0.45], [x, yc, -D / 2 + 0.7], [TRX + lx, yc, -D / 2 + 0.7], [TRX + lx, 0.25, -D / 2 - 0.9], [TRX + lx, 0.25, FB.z1 + 1.2], [FAB_IDF[0] + lx * 0.4, FAB_IDF[1], FB.z1 + 1.2], [FAB_IDF[0] + lx * 0.4, FAB_IDF[1], FAB_IDF[2]]);
      return pts.reverse();
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
        const pts = f.bldg ? fabCablePts(k, devPts.get(other)) : cablePts(f.level, k, devPts.get(other));
        const mesh = fx.tubeAlong(pts, 0.17, lineMat(CAT.cables[l.cable].color, 1));
        mesh.userData.pick = { kind: 'link', id: l.id };
        cableG.add(mesh);
        /* 斷線時冒火花的位置：豎井裡、這層樓下方不遠處 */
        const cutPt = [pts[1][0], pts[1][1] + (pts[2][1] - pts[1][1]) * Math.min(0.5, 6 / Math.max(6, pts[1][1] - pts[2][1])), pts[1][2]];
        const cb = { l, fid: f.id, pts, path: fx.path(pts), mesh, dn: 0, up: 0, on: true, cutPt };
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
      if (fl.under) return;
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
      /* 樓層（停電時：沒有 UPS 的 IDF 熄燈） */
      const facP = G.R.fac;
      floors.forEach((fl, L) => {
        const fs = s.floors[fl.f.id];
        fl.col = floorHex(fl.f);
        /* 亮燈的窗 = 現在真的在座的人（上班時間多、半夜只剩客服夜班） */
        const stp = sim.floors[fl.f.id];
        const present = stp && stp.up ? stp.present : fs.movedIn * G.Net.presence(s.time, fl.f.type);
        const fty = G.FT[fl.f.type];
        /* 餐廳：工作人員點亮一小部分，用餐人潮越多越亮 */
        const litK = fty.dine ? (stp ? 0.25 * U.clamp((stp.crew || 0) / fl.f.staff, 0, 1) + 0.75 * U.clamp((stp.diners || 0) / fty.diners, 0, 1) : 0) : present / fl.f.staff;
        fl.lit = fl.under ? 0 : Math.round(U.clamp(litK, 0, 1) * per);
        /* 地下停車場：停好的車跟著上下班時段增減 */
        if (fl.cars) { const n = fs.movedIn > 0 && M3.parkFill ? Math.round(M3.parkFill(s.time) * Math.min(1, 0.3 + Q.officeStaff() / 6000) * fl.carSlots) : 0; if (fl.cars.count !== n) fl.cars.count = n; }
        const stt = G.Views.building.floorStatus(fl.f.id);
        const unpowered = facP && facP.idfPowered && facP.idfPowered[fl.f.id] === false;
        fl.led.material.color.copy(C(unpowered ? '#20262b' : HEX[stt.c] || HEX.none));
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
      /* 晶圓廠：預定地 → 工地（依工程進度長高）→ 完工的廠房；屋頂燈號 = 產線狀況 */
      const prog = G.Fab.buildProgress();
      const fabOpen = prog >= 1;
      fabG.visible = fabOpen; lotG.visible = !fabOpen; siteG.visible = !fabOpen && prog > 0;
      const sk = prog > 0 ? (s.mode === 'sandbox' ? 'sandbox' : 'campaign') : 'lot';
      if (!fabOpen && sk !== signKind) { signKind = sk; lotSign.material.map = signTex[sk]; lotSign.material.needsUpdate = true; }
      if (siteG.visible) growSite(prog);
      fabTag.show = prog > 0;
      campusTag.show = fabOpen && Q.linksOf('F:FAB').length > 0;
      if (fabOpen) {
        const R = G.R.fab;
        const hex = !R || !R.online ? HEX.none : R.itStop ? HEX.bad : R.rate >= CAT.fab.wspd * 0.8 ? HEX.ok : HEX.warn;
        fabLamp.material.color.copy(C(hex)); fabLamp.material.emissive.copy(C(hex));
        fabTag.set(R && R.online ? `Fab 1 · ${U.num(Math.round(R.rate))} 片 / 日 · 機台 ${R.online} / ${R.total}` : 'Fab 1 晶圓廠（機台進廠中）', R && R.itStop ? 'bad' : 'info');
      } else if (prog > 0) fabTag.set(`Fab 1 晶圓廠 · 興建中 ${U.pct(prog)}`, 'info');
      /* 中央廠務區（第十一章起）：蓋了幾組就出現幾組 */
      const cubOn = fabOpen && !!(s.plant && s.plant.on);
      cubG.visible = cubOn; cubTag.show = cubOn;
      if (cubOn) {
        const cnt = (k) => G.Plant.count(k);
        cub.tx.forEach((g, i) => { g.visible = i < cnt('tx'); });
        cub.dups.forEach((g, i) => { g.visible = i < cnt('dups'); });
        cub.gen.forEach((g, i) => { g.visible = i < cnt('gen'); });
        cub.n2.forEach((g, i) => { g.visible = i < cnt('bulk'); });
        const chemN = ['acid', 'solv', 'slurry'].filter((k) => cnt(k)).length * 2;
        cub.chem.forEach((c, i) => { c.visible = i < chemN; });
        const PR = G.R.plant;
        cubTag.set(PR ? `中央廠務區 · ${(PR.power.load.kw / 1000).toFixed(1)} MW${PR.temp ? ' · 臨時供應中' : ''}` : '中央廠務區', PR && !PR.temp && PR.alarms.some((a) => a.sev === 'crit') ? 'bad' : 'info');
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
        else if (fac && G.Net.rackDown(d.rack)) hex = '#20262b';
        else if (s.time < (d.bootUntil || 0)) { hex = '#ffb13b'; blink = 2; }
        sp.st.material = stripMat(hex);
        sp.blink = blink;
      }
      b1Tag.set(`B1 主機房 · ${s.racks.length} 座機櫃 · ${s.temp.toFixed(1)}°C`, fac && !fac.mdfPowered ? 'bad' : s.temp >= 27 ? 'warn' : 'info');
      /* 發電機與停電警示 */
      const gen = s.room.some((r) => CAT.room[r.model].kind === 'generator' && r.status === 'ok' && s.time >= (r.readyAt || 0));
      genG.visible = gen;
      genTag.show = gen && !!(fac && fac.genRunning);
      if (genTag.show) genTag.set('⚡ 發電機運轉中', 'warn');
      let alert = '';
      if (fac && fac.outage) {
        alert = fac.genRunning ? '⚡ 市電中斷：發電機供電中' : fac.onBattery ? `⚡ 市電中斷：機房靠 UPS 撐住（${Math.round(s.power.upsCharge * 100)}%）` : !fac.mdfPowered ? '⚡ 大樓停電：機房也斷電了' : '⚡ 大樓停電';
      } else if (fac && fac.overheat) alert = '🔥 機房過熱：設備緊急關機';
      alertTag.show = !!alert;
      if (alert) alertTag.set(alert, 'bad');
      /* 攻擊 */
      const plan = attackPlans();
      const sA = plan.plans.map((p) => p.inc.id + ':' + p.ns.join('>') + ':' + p.blocked).join('|') + '#' + plan.marks.map((m) => m.fid).join(',');
      if (sA !== sigA || rebuilt) { sigA = sA; buildAttacks(plan); }
      floors.forEach((fl, L) => paintFloor(L, 1));
      win.instanceColor.needsUpdate = true;
      refreshSel();
      syncSky();
      if (city) city.sync(s.time, nightK);
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
        return ['B1 主機房（MDF）', `${s.racks.length} 座機櫃 · IT 負載 ${((fac.itLoad + (fac.aiLoad || 0)) / 1000).toFixed(1)} kW`, `機房溫度 ${s.temp.toFixed(1)}°C${fac.pue ? ' · PUE ' + fac.pue.toFixed(2) : ''}`, G.R.ai ? `AI 算力 ${G.R.ai.pflops.toFixed(1)} PFLOPS` : ''];
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
      if (p.kind === 'fabb') {
        const R = G.R.fab, c = G.Fab.counts();
        return ['Fab 1 晶圓廠（12 吋試產線）', R && R.online ? `產能 ${U.num(Math.round(R.rate))} 片 / 日 · 良率 ${U.pct(R.yield, 1)}` : '機台陸續進廠中', `機台 ${c.online} / ${s.fab.tools.length} 連網 · 等掃毒 ${c.scan} · 等交換器埠 ${c.ready}`, `經 ${G.BLD.campus} m 校園光纖連回總部 B1`];
      }
      if (p.kind === 'cub') {
        const R = G.R.plant;
        if (!R) return ['中央廠務區（CUB）', '第十一章啟用'];
        return ['中央廠務區（CUB）', `主變壓器 ${G.Plant.count('tx')} 台 · 晶圓廠用電 ${(R.power.load.kw / 1000).toFixed(1)} MW`, `DUPS ${G.Plant.count('dups')} 組 · 發電機 ${G.Plant.count('gen')} 台 · 液氮 / CDA ${G.Plant.count('bulk')} 組`,
          R.temp ? `統包商的臨時供應到 ${U.stamp(R.tempUntil)}` : `超純水 ${R.water.deliver.toFixed(0)} / ${R.water.demand.toFixed(0)} m³/h · 化學品系統 ${['acid', 'solv', 'slurry'].filter((k) => G.Plant.count(k)).length} / 3`];
      }
      if (p.kind === 'fablot') {
        const pr = G.Fab.buildProgress();
        /* 完工了：工地不見了，選取的卡片跟著關掉 */
        if (pr >= 1) return null;
        if (pr <= 0) return ['大樓後方的空地', '集團規劃中的 12 吋晶圓廠 Fab 1 預定地'];
        return ['Fab 1 晶圓廠（興建中）', `工程進度 ${U.pct(pr)} · ${pr < 0.5 ? '鋼構吊裝中' : pr < 0.9 ? '外牆封板、無塵室裝修中' : '收尾：機電與無塵室測試'}`, G.Fab.buildEta(), `完工後經 ${G.BLD.campus} m 校園光纖連回總部 B1`];
      }
      if (p.kind === 'gen') {
        const fac = G.R.fac || {};
        return ['柴油發電機（戶外）', fac.genRunning ? '運轉中：市電中斷，由發電機供電' : '待命中：市電中斷約 1 分鐘內自動啟動', 'UPS 負責撐過發電機啟動前的空檔'];
      }
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
        if (opts.onFloor3d) acts.push(btn('走進樓層（3D）', () => opts.onFloor3d(cur.id)));
        acts.push(btn('拉近', () => { const fl = floors.find((x) => x.f.id === cur.id); if (fl) api.focus(fl.glass, 0.55); }));
      } else if (cur.kind === 'b1') acts.push(btn('進入機房', () => opts.onRack && opts.onRack(), true));
      else if (cur.kind === 'dev') acts.push(btn('到機房查看', () => opts.onDev && opts.onDev(cur.id), true));
      else if (cur.kind === 'link' || cur.kind === 'isp') acts.push(btn('到拓撲圖', () => opts.onTopo && opts.onTopo(), true));
      else if (cur.kind === 'atk') acts.push(btn('前往事件中心', () => opts.onInc && opts.onInc(), true));
      else if (cur.kind === 'fabb') {
        acts.push(btn('進入晶圓廠', () => opts.onFab && opts.onFab(), true));
        if (opts.onFloor3d) acts.push(btn('走進無塵室（3D）', () => opts.onFloor3d('FAB')));
        acts.push(btn('拉近', () => api.focus(fabBody, 0.5)));
      } else if (cur.kind === 'fablot') acts.push(btn('拉近', () => api.focus(fabBody, 0.5), true));
      else if (cur.kind === 'cub') acts.push(btn('廠務（電力、純水、氣體、化學品）', () => opts.onPlant && opts.onPlant(), true), btn('拉近', () => api.focus(cub.towers[0], 0.35)));
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
      } else if (cur.kind === 'fabb' || cur.kind === 'fablot') {
        selLine.scale.set(FB.x1 - FB.x0 + 0.8, FB.h + 0.6, FB.z1 - FB.z0 + 0.8);
        selLine.position.set((FB.x0 + FB.x1) / 2, FB.h / 2, (FB.z0 + FB.z1) / 2);
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

    /* ---------- 日夜：天空顏色、太陽 / 月亮、星星、燈光亮度隨遊戲時間變化 ---------- */
    const skyC = document.createElement('canvas');
    skyC.width = 4; skyC.height = 256;
    const skyT = new T.CanvasTexture(skyC);
    skyT.encoding = T.sRGBEncoding;
    const sky = new T.Mesh(new T.SphereGeometry(900, 32, 16), new T.MeshBasicMaterial({ map: skyT, side: T.BackSide, depthWrite: false }));
    sky.raycast = () => {};
    sky.renderOrder = -10;
    root.add(sky);
    const sun = new T.Mesh(new T.SphereGeometry(22, 20, 14), new T.MeshBasicMaterial({ color: C('#fff1c2') }));
    const moon = new T.Mesh(new T.SphereGeometry(13, 20, 14), new T.MeshBasicMaterial({ color: C('#dfe7ff') }));
    sun.raycast = moon.raycast = () => {};
    root.add(sun, moon);
    const STARS = fx.points(260, 2.2, { additive: true });
    STARS.obj.renderOrder = -9;
    root.add(STARS.obj);
    const starDir = [];
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.asin(0.12 + Math.random() * 0.86);
      starDir.push([Math.cos(e) * Math.cos(a) * 840, Math.sin(e) * 840, Math.cos(e) * Math.sin(a) * 840, 0.4 + Math.random() * 0.6]);
    }
    const WHITE = [1, 1, 1];
    const KEYS = [
      [0, '#060a14', '#141b33'], [4.8, '#060a14', '#141b33'], [6, '#2b3a67', '#f0a66a'], [7.6, '#4f8fd6', '#bcdcf2'],
      [16.4, '#4f8fd6', '#bcdcf2'], [18, '#39407c', '#f0895c'], [19.6, '#0b1122', '#1e2748'], [24, '#060a14', '#141b33'],
    ];
    const lerpHex = (a, b, t) => { const A = fx.rgb(a), B = fx.rgb(b); return `rgb(${Math.round((A[0] + (B[0] - A[0]) * t) * 255)},${Math.round((A[1] + (B[1] - A[1]) * t) * 255)},${Math.round((A[2] + (B[2] - A[2]) * t) * 255)})`; };
    const lights = api.scene.children.filter((o) => o.isLight);
    const lightBase = lights.map((l) => l.intensity);
    let skyHour = -1;
    function syncSky() {
      const hr = U.hourOf(G.S.time);
      if (Math.abs(hr - skyHour) < 0.1) return;
      skyHour = hr;
      let k = 0;
      while (k < KEYS.length - 2 && KEYS[k + 1][0] <= hr) k++;
      const a = KEYS[k], b = KEYS[k + 1], f = (hr - a[0]) / Math.max(0.01, b[0] - a[0]);
      /* 鏡頭多半往下看，地平線以下（遠方霧氣）也跟著時間變色，整個背景才看得出日夜 */
      const top = lerpHex(a[1], b[1], f), hor = lerpHex(a[2], b[2], f);
      const g = skyC.getContext('2d');
      const gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, top);
      gr.addColorStop(0.42, hor);
      gr.addColorStop(0.62, hor);
      gr.addColorStop(1, top);
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
      g.fillStyle = 'rgba(8,11,15,0.45)';
      g.fillRect(0, 150, 4, 106);
      skyT.needsUpdate = true;
      /* 太陽 6 點升起、18 點落下；月亮相反 */
      const sa = (hr - 6) / 12 * Math.PI, ma = (hr - 18) / 12 * Math.PI;
      sun.position.set(Math.cos(sa) * -620, Math.sin(sa) * 520, -420);
      moon.position.set(Math.cos(ma) * -620, Math.sin(ma) * 480, -420);
      sun.visible = sun.position.y > -30;
      moon.visible = moon.position.y > -20;
      const day = U.clamp(Math.sin(sa) * 2.2 + 0.2, 0, 1);
      lights.forEach((l, i) => { l.intensity = lightBase[i] * (0.42 + 0.58 * day); });
      const night = 1 - U.clamp(Math.sin(sa) * 3 + 0.6, 0, 1);
      nightK = night;
      STARS.begin();
      if (night > 0.02) for (const s of starDir) STARS.push(s[0], s[1], s[2], WHITE, s[3] * night, 1);
      STARS.end();
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
        tickFx(dt);
        if (city) city.tick(dt, t);
        for (const m of marks) m.s.material.emissiveIntensity = Math.sin(t * 6) > 0 ? 2.4 : 0.3;
        for (const sp of strips) if (sp.blink) sp.st.visible = Math.sin(t * Math.PI * sp.blink) > -0.2; else if (!sp.st.visible) sp.st.visible = true;
        beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.6 ? 2.4 : 0.3;
        /* 冷卻水塔的風扇：有電才轉 */
        if (cubG.visible && G.R.plant && G.R.plant.power.normal) for (const f of cub.fans) f.rotation.y = t * 2.4;
        /* 工地的塔式起重機：吊臂在工地上方來回轉、吊車前後移動，吊鉤吊著鋼梁到鋼構的最上面 */
        if (siteG.visible && site.jib) {
          site.jib.rotation.y = -2 + 0.6 * Math.sin(t * 0.045);
          const r = 18 + 9 * Math.sin(t * 0.07 + 1);
          site.trolley.position.x = r;
          const hy = Math.max(3, (site.top || 1) + 2.5) - site.jibY;
          const len = -1.15 - hy;
          site.cable.scale.set(0.07, Math.max(0.1, len), 0.07);
          site.cable.position.set(r, -1.15 - len / 2, 0);
          site.hook.position.set(r, hy - 0.2, 0);
          site.light.material.emissiveIntensity = Math.sin(t * 4) > 0.3 ? 2.6 : 0.2;
        }
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
        if (p.kind === 'fabb' || p.kind === 'fablot') return fabBody;
        if (p.kind === 'cub') return cub.towers[0];
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
        if (city) city.dispose();
        for (const fl of floors) fl.tag.remove();
        for (const a of atks) if (a.tag) a.tag.remove();
        for (const m of marks) if (m.tag) m.tag.remove();
        for (const t of [shaftTag, inetTag, ispTag, b1Tag, genTag, alertTag, fabTag, campusTag, cubTag]) t.remove();
        for (const m of Object.values(stripM)) m.dispose();
        for (const m of matCache.values()) m.dispose();
      },
    };
  }
})(window.G = window.G || {});
