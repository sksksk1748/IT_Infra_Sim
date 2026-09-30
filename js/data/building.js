/* 新曜大樓：樓層定義、樓層類型、平面圖產生器
 * 平面圖以 1m × 1m 格子表示（72m × 36m），用來計算 Wi-Fi 訊號與容量。
 */
(function (G) {
  'use strict';

  /* ---------- 樓層類型 ----------
   * wired  = 使用有線網路（桌機 / 擴充座）的員工比例，其餘用 Wi-Fi
   * phones = 每位員工額外連上 Wi-Fi 的手機數
   * inet / intra = 尖峰時每位在座員工的 [下行, 上行] Mbps（網際網路 / 內部伺服器）
   */
  G.FT = {
    lobby:      { name: '大廳', wired: 0.5, phones: 0.8, inet: [0.8, 0.25], intra: [0.3, 0.1], guestPeak: 260, color: '#9aa7ad' },
    office:     { name: '一般辦公', wired: 0.65, phones: 0.6, inet: [1.0, 0.28], intra: [0.8, 0.25], color: '#5aa9f0' },
    rnd:        { name: '研發', wired: 0.75, phones: 0.6, inet: [1.2, 0.45], intra: [2.2, 0.9], color: '#8f7cf0' },
    callcenter: { name: '客服中心', wired: 0.95, phones: 0.5, inet: [0.55, 0.3], intra: [0.5, 0.2], voip: true, night: 0.22, color: '#e6a23c' },
    creative:   { name: '行銷設計', wired: 0.55, phones: 0.8, inet: [1.8, 0.8], intra: [1.8, 1.1], color: '#e86fa8' },
    conference: { name: '會議訓練', wired: 0.1, phones: 0.9, inet: [1.4, 0.55], intra: [0.3, 0.1], guestPeak: 120, color: '#43c59e' },
    exec:       { name: '高階主管', wired: 0.3, phones: 1.0, inet: [1.5, 0.6], intra: [0.6, 0.2], color: '#f2c14e' },
    /* 員工餐廳：編制人數是廚師、收銀與清潔人員；用餐尖峰時全公司的員工上來吃飯（diners = 尖峰同時用餐人數），
     * 人人拿著手機滑影片 → 高密度 Wi-Fi。pos = 收銀機（有線、要能連到金流閘道） */
    canteen:    { name: '員工餐廳', wired: 0.5, phones: 0.7, inet: [0.35, 0.1], intra: [0.3, 0.1], diners: 760, pos: 10, dine: true, color: '#e07b54' },
    foodcourt:  { name: '美食街', wired: 0.5, phones: 0.7, inet: [0.35, 0.1], intra: [0.3, 0.1], diners: 700, pos: 16, dine: true, color: '#d9a441' },
    /* 員工停車場：編制人數是管理員與保全；上下班尖峰時開車、騎車的員工進出（parkPeak = 尖峰同時在停車場裡的人數）。
     * 地下室收不到 GPS、手機訊號也很差 → 手機打卡要靠公司 Wi-Fi 確認位置。
     * gates = 車道的車牌辨識攝影機與柵欄機（有線）；cams = 監視器（PoE 供電） */
    parking:    { name: '停車場', wired: 0.5, phones: 1.0, inet: [0.2, 0.05], intra: [0.1, 0.05], parkPeak: 150, gates: 4, cams: 24, park: true, color: '#7d8a93' },
    /* 晶圓廠無塵室（第十章，js/sim/fab.js）：編制是輪班的操作員與工程師（24 小時運轉）；
     * 有線的是控制室的 MES 終端機，機台另外算（每台 1～2 個埠）；現場人員用 Wi-Fi 手持裝置查 MES。
     * 不走一般樓層的上網 / 內部流量：機台 ⇄ EAP（SECS/GEM）、機台 → FDC、手持裝置 → MES */
    fab:        { name: '晶圓廠無塵室', wired: 0.1, phones: 0, inet: [0, 0], intra: [0, 0], fab: true, night: 0.85, color: '#d6b84a' },
  };

  /* ---------- 大樓 ---------- */
  G.BLD = {
    name: '新曜大樓',
    floorHeight: 4.2,   /* 每層樓高 (m) */
    mdfHoriz: 30,       /* 機房到弱電豎井 + IDF 內的水平距離 (m) */
    /* level：地上樓層 = 樓層數；地下室用負數（B1 機房 = −1，不在清單裡；B2 停車場 = −2） */
    floors: [
      { id: 'B2',  level: -2, type: 'parking',    dept: '員工停車場（汽車 / 機車）', staff: 6 },
      { id: '1F',  level: 1,  type: 'lobby',      dept: '大廳 / 接待 / 保全', staff: 40 },
      { id: '2F',  level: 2,  type: 'office',     dept: '資訊部 / 總務部', staff: 527 },
      { id: '3F',  level: 3,  type: 'office',     dept: '人資 / 財務', staff: 527 },
      { id: '4F',  level: 4,  type: 'office',     dept: '業務一部', staff: 527 },
      { id: '5F',  level: 5,  type: 'callcenter', dept: '客服中心', staff: 527 },
      { id: '6F',  level: 6,  type: 'rnd',        dept: '研發一部', staff: 527 },
      { id: '7F',  level: 7,  type: 'rnd',        dept: '研發二部', staff: 527 },
      { id: '8F',  level: 8,  type: 'creative',   dept: '行銷設計', staff: 527 },
      { id: '9F',  level: 9,  type: 'office',     dept: '業務二部', staff: 527 },
      { id: '10F', level: 10, type: 'office',     dept: '業務三部', staff: 527 },
      { id: '11F', level: 11, type: 'callcenter', dept: '客服中心二', staff: 527 },
      { id: '12F', level: 12, type: 'rnd',        dept: '研發三部', staff: 527 },
      { id: '13F', level: 13, type: 'rnd',        dept: '研發四部', staff: 527 },
      { id: '14F', level: 14, type: 'rnd',        dept: '研發五部 (AI)', staff: 528 },
      { id: '15F', level: 15, type: 'conference', dept: '會議與訓練中心', staff: 400 },
      { id: '16F', level: 16, type: 'office',     dept: '採購 / 物流', staff: 527 },
      { id: '17F', level: 17, type: 'office',     dept: '法務 / 稽核', staff: 527 },
      { id: '18F', level: 18, type: 'creative',   dept: '品牌 / 公關', staff: 527 },
      { id: '19F', level: 19, type: 'office',     dept: '專案管理處', staff: 527 },
      { id: '20F', level: 20, type: 'exec',       dept: '行政高管', staff: 300 },
      { id: '21F', level: 21, type: 'exec',       dept: '董事會 / 總經理室', staff: 300 },
      { id: '22F', level: 22, type: 'canteen',    dept: '員工餐廳（自助餐）', staff: 56 },
      { id: '23F', level: 23, type: 'foodcourt',  dept: '員工餐廳（美食街）', staff: 48 },
      /* 大樓後方的晶圓廠（第十章）：另一棟建築，IDF 經地下的校園光纖管道連回總部 B1 */
      { id: 'FAB', level: 1, bldg: 'fab', type: 'fab', dept: 'Fab 1 無塵室（12 吋試產線）', staff: 150 },
    ],
    /** 校園光纖：總部 B1 機房 → 地下管道 → 晶圓廠 FAB IDF 的距離 (m) */
    campus: 380,
  };
  G.BLD.byId = {};
  for (const f of G.BLD.floors) G.BLD.byId[f.id] = f;
  /** 總部大樓的樓層（大樓剖面、3D 大樓只畫這些）與晶圓廠的樓層 */
  G.BLD.hq = G.BLD.floors.filter((f) => !f.bldg);
  G.BLD.fab = G.BLD.floors.filter((f) => f.bldg === 'fab');
  G.BLD.isFab = (fid) => { const f = G.BLD.byId[fid]; return !!f && f.bldg === 'fab'; };
  G.BLD.totalStaff = G.BLD.floors.reduce((s, f) => s + f.staff, 0);
  G.BLD.hqStaff = G.BLD.hq.reduce((s, f) => s + f.staff, 0); /* 10,000 名員工 + 104 位餐廳人員 + 6 位停車場管理員 */
  G.BLD.top = G.BLD.hq.reduce((m, f) => Math.max(m, f.level), 0);
  /** 樓層 IDF 到 B1 機房的主幹線長度 (m)：地上樓層往上數，B2 在 B1 正下方一層；晶圓廠走校園光纖 */
  G.BLD.riserLength = (floorId) => {
    const f = G.BLD.byId[floorId];
    if (!f) return 10;
    if (f.bldg === 'fab') return G.BLD.campus;
    const up = f.level > 0 ? f.level : -f.level - 1;
    return Math.round((up * G.BLD.floorHeight + G.BLD.mdfHoriz) * 10) / 10;
  };

  /* ---------- 平面圖產生器 ---------- */
  const W = 72, H = 36;
  /* KITCHEN 廚房、DINE 用餐區、SERVE 餐檯 / 收銀台、COLD 冷藏冷凍庫（金屬牆，Wi-Fi 幾乎穿不透）
   * RAMP 車道、PARK 汽車停車格、MOTO 機車停車格、PILLAR 結構柱（鋼筋混凝土，擋訊號） */
  /* 晶圓廠：CR 無塵室走道（操作員走動的地方）、TOOL 製程機台（金屬機殼，很擋訊號）、STOCK 晶圓倉儲（整座金屬櫃） */
  const T = { OPEN: 0, DESK: 1, MEET: 2, CORE: 3, IDF: 4, OFFICE: 5, LAB: 6, LOBBY: 7, CAFE: 8, WALL: 9, GLASS: 10, EXT: 11, KITCHEN: 12, DINE: 13, SERVE: 14, COLD: 15, RAMP: 16, PARK: 17, MOTO: 18, PILLAR: 19, WC: 20, CR: 21, TOOL: 22, STOCK: 23 };
  /* 廁所（每層樓都在核心筒裡）：北側是男廁、女廁（門開向北側走道），IDF 東邊是無障礙廁所（門開向南側走道）。
   * 無障礙廁所和 IDF 弱電室只隔一道牆：漏水沒被發現，就會淹進 IDF。 */
  const WC = [
    { k: 'M', name: '男廁', x0: 31, y0: 14, x1: 34, y1: 17, door: [32, 13] },
    { k: 'F', name: '女廁', x0: 36, y0: 14, x1: 40, y1: 17, door: [38, 13] },
    { k: 'A', name: '無障礙廁所', x0: 34, y0: 19, x1: 35, y1: 21, door: [34, 22] },
  ];
  const STAFF_W = { 0: 0.04, 1: 1.0, 2: 0.35, 5: 0.5, 6: 0.8, 7: 0.03, 8: 0.25, 12: 1.0, 13: 0.01, 14: 0.9, 15: 0.05 };
  const GUEST_W = { 0: 0.1, 2: 0.5, 7: 1.0, 8: 0.7 };
  /* 餐廳的用餐人潮：坐在用餐區、在餐檯前排隊、包廂 */
  const DINER_W = { 0: 0.12, 2: 0.6, 13: 1.0, 14: 0.3 };
  /* 停車場的人潮：剛停好車、走向電梯廳（在電梯廳等電梯、打卡的人最多） */
  const PARK_W = { 0: 0.3, 7: 1.4, 16: 0.03, 17: 0.3, 18: 0.4 };
  const CORE = { x0: 30, y0: 13, x1: 41, y1: 22 };

  function blank() {
    const L = { W, H, T, type: new Uint8Array(W * H), att: new Float32Array(W * H), rooms: [] };
    for (let x = 0; x < W; x++) { set(L, x, 0, T.EXT, 10); set(L, x, H - 1, T.EXT, 10); }
    for (let y = 0; y < H; y++) { set(L, 0, y, T.EXT, 10); set(L, W - 1, y, T.EXT, 10); }
    return L;
  }
  function set(L, x, y, t, att) { const i = y * W + x; L.type[i] = t; L.att[i] = att; }
  function get(L, x, y) { return L.type[y * W + x]; }

  /** 房間：邊界為牆（可指定各邊衰減），內部為指定類型 */
  function room(L, x0, y0, x1, y1, kind, wallAtt, label, doors, sideAtt) {
    sideAtt = sideAtt || {};
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        const cur = get(L, x, y);
        if (edge) {
          if (cur === T.EXT || cur === T.CORE || cur === T.IDF) continue;
          let a = wallAtt;
          if (y === y1 && sideAtt.bottom !== undefined) a = sideAtt.bottom;
          else if (y === y0 && sideAtt.top !== undefined) a = sideAtt.top;
          else if (x === x0 && sideAtt.left !== undefined) a = sideAtt.left;
          else if (x === x1 && sideAtt.right !== undefined) a = sideAtt.right;
          set(L, x, y, a <= 2 ? T.GLASS : T.WALL, a);
        } else {
          set(L, x, y, kind, 0);
        }
      }
    }
    for (const d of doors || []) if (get(L, d[0], d[1]) !== T.EXT) set(L, d[0], d[1], T.OPEN, 0);
    if (label) L.rooms.push({ x0, y0, x1, y1, kind, label });
  }

  function core(L) {
    for (let y = CORE.y0; y <= CORE.y1; y++) {
      for (let x = CORE.x0; x <= CORE.x1; x++) {
        const edge = x === CORE.x0 || x === CORE.x1 || y === CORE.y0 || y === CORE.y1;
        set(L, x, y, T.CORE, edge ? 15 : 8);
      }
    }
    for (let y = 19; y <= 21; y++) for (let x = 31; x <= 33; x++) set(L, x, y, T.IDF, 8);
    L.rooms.push({ x0: CORE.x0, y0: CORE.y0, x1: CORE.x1, y1: CORE.y1, kind: T.CORE, label: '核心筒（電梯 / 樓梯）' });
    L.idf = { x: 32, y: 20 };
    /* 廁所：磁磚牆 + 給排水管，訊號衰減和核心筒差不多；門口在核心筒外牆上開一格 */
    for (const w of WC) {
      for (let y = w.y0; y <= w.y1; y++) for (let x = w.x0; x <= w.x1; x++) set(L, x, y, T.WC, 9);
      set(L, w.door[0], w.door[1], T.OPEN, 0);
      L.rooms.push({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1, kind: T.WC, label: w.name, wc: w.k });
    }
    L.wc = WC;
  }

  function inCoreMargin(x, y) { return x >= CORE.x0 - 2 && x <= CORE.x1 + 2 && y >= CORE.y0 - 2 && y <= CORE.y1 + 2; }

  /** 開放式座位區：每 rowPeriod 列中有 deskRows 列座位，每 colEvery 欄留一條走道 */
  function desks(L, x0, y0, x1, y1, rowPeriod, deskRows, colEvery) {
    for (let y = y0; y <= y1; y++) {
      if ((y - y0) % rowPeriod >= deskRows) continue;
      for (let x = x0; x <= x1; x++) {
        if (colEvery && (x - x0) % colEvery === colEvery - 1) continue;
        if (inCoreMargin(x, y)) continue;
        if (get(L, x, y) === T.OPEN) set(L, x, y, T.DESK, 0);
      }
    }
  }
  function fill(L, x0, y0, x1, y1, from, to) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (get(L, x, y) === from && !inCoreMargin(x, y)) set(L, x, y, to, 0);
  }
  /** 直接鋪設一塊區域（餐檯、收銀台）：不動外牆與核心筒 */
  function paint(L, x0, y0, x1, y1, t) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = get(L, x, y); if (c !== T.EXT && c !== T.CORE && c !== T.IDF) set(L, x, y, t, 0); }
  }
  function bandRooms(L, xs, y0, y1, kind, att, label, doorY, sideAtt) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1];
      room(L, a, y0, b, y1, kind, att, label, [[Math.floor((a + b) / 2), doorY]], sideAtt);
    }
  }

  const BUILDERS = {
    office(L) {
      bandRooms(L, [0, 10, 20, 30, 40, 50, 60, 71], 0, 7, T.MEET, 4, '會議室', 7, { bottom: 2 });
      bandRooms(L, [0, 10, 20, 30], 28, 35, T.MEET, 4, '會議室', 28, { top: 2 });
      room(L, 41, 28, 51, 35, T.MEET, 4, '會議室', [[46, 28]], { top: 2 });
      room(L, 51, 28, 61, 35, T.CAFE, 4, '茶水間', [[56, 28]]);
      room(L, 61, 28, 71, 35, T.MEET, 4, '電話亭', [[66, 28]], { top: 2 });
      desks(L, 2, 9, 69, 26, 3, 2, 12);
    },
    rnd(L) {
      bandRooms(L, [0, 14, 28, 42, 56, 71], 0, 7, T.MEET, 4, '討論室', 7, { bottom: 2 });
      bandRooms(L, [0, 10, 20, 30], 28, 35, T.MEET, 4, '會議室', 28, { top: 2 });
      room(L, 41, 25, 71, 35, T.LAB, 7, '實驗室 / 測試機房', [[56, 25], [44, 25]]);
      desks(L, 2, 9, 69, 26, 3, 2, 12);
    },
    callcenter(L) {
      bandRooms(L, [0, 24, 48, 71], 0, 7, T.MEET, 4, '訓練教室', 7, { bottom: 2 });
      bandRooms(L, [0, 15, 30], 28, 35, T.MEET, 4, '督導室', 28, { top: 2 });
      room(L, 41, 28, 71, 35, T.CAFE, 3, '休息區', [[50, 28], [62, 28]]);
      desks(L, 2, 9, 69, 26, 4, 3, 16);
    },
    creative(L) {
      bandRooms(L, [0, 18, 36, 54, 71], 0, 7, T.MEET, 5, '攝影棚 / 工作室', 7);
      room(L, 0, 28, 15, 35, T.MEET, 4, '會議室', [[8, 28]], { top: 2 });
      room(L, 15, 28, 30, 35, T.MEET, 4, '會議室', [[22, 28]], { top: 2 });
      room(L, 41, 28, 56, 35, T.OFFICE, 5, '剪輯室', [[48, 28]]);
      room(L, 56, 28, 71, 35, T.MEET, 4, '提案室', [[63, 28]], { top: 2 });
      desks(L, 2, 9, 69, 26, 3, 2, 8);
    },
    conference(L) {
      bandRooms(L, [0, 18, 36, 54, 71], 0, 7, T.MEET, 5, '訓練教室', 7);
      room(L, 0, 8, 27, 27, T.MEET, 5, '國際會議廳', [[27, 17], [27, 18]]);
      room(L, 44, 8, 71, 17, T.MEET, 4, '訓練教室', [[44, 12]]);
      room(L, 44, 17, 71, 27, T.MEET, 4, '訓練教室', [[44, 22]]);
      bandRooms(L, [0, 14, 28], 28, 35, T.MEET, 4, '會議室', 28, { top: 2 });
      bandRooms(L, [43, 57, 71], 28, 35, T.MEET, 4, '會議室', 28, { top: 2 });
      desks(L, 30, 25, 41, 26, 2, 1, 0);
    },
    exec(L) {
      bandRooms(L, [0, 10, 20, 30, 40, 50, 60, 71], 0, 7, T.OFFICE, 5, '主管室', 7);
      bandRooms(L, [0, 10, 20, 30, 41, 51, 61, 71], 28, 35, T.OFFICE, 5, '主管室', 28);
      room(L, 2, 10, 24, 25, T.MEET, 6, '董事會議室', [[24, 17]]);
      desks(L, 45, 10, 69, 25, 4, 1, 6);
    },
    lobby(L) {
      bandRooms(L, [0, 10, 20, 30], 0, 9, T.MEET, 4, '訪客會議室', 9, { bottom: 2 });
      room(L, 44, 0, 57, 9, T.OFFICE, 5, '保全室', [[50, 9]]);
      room(L, 57, 0, 71, 9, T.OFFICE, 5, '收發室', [[64, 9]]);
      room(L, 50, 24, 71, 35, T.CAFE, 2, '咖啡廳', [[50, 29], [50, 30]]);
      fill(L, 1, 10, 70, 34, T.OPEN, T.LOBBY);
      for (let y = 27; y <= 28; y++) for (let x = 33; x <= 39; x++) set(L, x, y, T.DESK, 0);
      L.rooms.push({ x0: 12, y0: 16, x1: 26, y1: 30, kind: T.LOBBY, label: '挑高大廳' });
      L.rooms.push({ x0: 32, y0: 26, x1: 40, y1: 29, kind: T.DESK, label: '接待櫃台' });
    },
    /* 22F 員工餐廳（自助餐）：北側是中央廚房，出菜線接自助餐檯與收銀台，其餘都是用餐區 */
    canteen(L) {
      room(L, 0, 0, 11, 9, T.KITCHEN, 6, '洗碗區', [[6, 9]]);
      room(L, 11, 0, 31, 9, T.KITCHEN, 6, '中央廚房', [[16, 9], [26, 9]]);
      room(L, 31, 0, 39, 9, T.KITCHEN, 6, '備料區', [[35, 9]]);
      room(L, 39, 0, 46, 9, T.COLD, 12, '冷凍庫', [[42, 9]]);
      room(L, 46, 0, 56, 9, T.OFFICE, 5, '驗收 / 辦公室', [[51, 9]]);
      bandRooms(L, [56, 64, 71], 0, 9, T.MEET, 4, '用餐包廂', 9, { bottom: 2 });
      paint(L, 3, 11, 22, 12, T.SERVE);
      L.rooms.push({ x0: 3, y0: 11, x1: 22, y1: 12, kind: T.SERVE, label: '自助餐檯', line: true });
      paint(L, 24, 11, 26, 13, T.SERVE);
      L.rooms.push({ x0: 24, y0: 11, x1: 26, y1: 13, kind: T.SERVE, label: '收銀台', pos: true });
      room(L, 0, 27, 12, 35, T.CAFE, 3, '飲料 / 甜點吧', [[12, 30], [12, 31]]);
      paint(L, 46, 31, 54, 33, T.SERVE);
      L.rooms.push({ x0: 46, y0: 31, x1: 54, y1: 33, kind: T.SERVE, label: '餐具回收', ret: true });
      fill(L, 27, 10, 70, 12, T.OPEN, T.DINE);
      fill(L, 1, 14, 70, 34, T.OPEN, T.DINE);
      L.rooms.push({ x0: 13, y0: 14, x1: 29, y1: 34, kind: T.DINE, label: '用餐區' });
    },
    /* 23F 員工餐廳（美食街）：八個攤位各有自己的小廚房與櫃台，中間是共用座位，南側是景觀吧台 */
    foodcourt(L) {
      const stalls = [[0, 9, '麵食館'], [9, 18, '日式定食'], [18, 27, '韓式料理'], [27, 36, '滷味小吃'], [36, 45, '西式簡餐'], [45, 54, '健康餐盒'], [54, 63, '港式燒臘'], [63, 71, '飲料 / 咖啡']];
      for (const [a, b, label] of stalls) {
        room(L, a, 0, b, 6, T.KITCHEN, 5, label, [[Math.floor((a + b) / 2), 6]], { bottom: 2 });
        paint(L, a + 1, 7, b - 1, 7, T.SERVE);
        L.rooms.push({ x0: a + 1, y0: 7, x1: b - 1, y1: 7, kind: T.SERVE, label: '', pos: true, stall: label });
      }
      room(L, 59, 26, 71, 35, T.MEET, 4, '用餐包廂', [[59, 30]], { left: 2 });
      paint(L, 1, 29, 4, 33, T.SERVE);
      L.rooms.push({ x0: 1, y0: 29, x1: 4, y1: 33, kind: T.SERVE, label: '餐具回收', ret: true });
      fill(L, 1, 9, 70, 34, T.OPEN, T.DINE);
      L.rooms.push({ x0: 8, y0: 30, x1: 56, y1: 34, kind: T.DINE, label: '景觀吧台座位', bar: true });
    },
    /* B2 員工停車場：西北角是從地面下來的車道與柵欄機，北側與南側是汽車格，東側是機車停車區；
     * 電梯廳在核心筒南側（打卡、等電梯的人最多）。每 9m 一根結構柱。 */
    parking(L) {
      L.spaces = [];
      L.gates = [];
      L.ev = [];
      paint(L, 1, 1, 13, 5, T.RAMP);
      L.rooms.push({ x0: 1, y0: 1, x1: 13, y1: 5, kind: T.RAMP, label: '車道（往地面）', ramp: true });
      /* 柵欄機：上方車道進場、下方出場；各有一支車牌辨識攝影機 */
      L.gates.push({ x: 14, y: 2, lane: 'in' }, { x: 14, y: 4, lane: 'out' });
      room(L, 1, 6, 8, 11, T.OFFICE, 5, '管理室', [[8, 8], [4, 6]]);
      /* 汽車格：3m × 5m，車頭朝牆 */
      const cars = (x0, x1, y0, y1, dir, ev) => {
        for (let x = x0; x + 2 <= x1; x += 3) {
          paint(L, x, y0, x + 2, y1, T.PARK);
          L.spaces.push({ x0: x, y0, x1: x + 2, y1, dir, ev: !!(ev && x >= ev) });
          if (ev && x >= ev) L.ev.push({ x: x + 1, y: dir === 'N' ? y0 : y1, dir });
        }
      };
      cars(16, 70, 1, 5, 'N', 58);
      cars(2, 26, 12, 16, 'N');
      cars(2, 26, 17, 21, 'S');
      cars(2, 43, 30, 34, 'S');
      L.rooms.push({ x0: 16, y0: 1, x1: 57, y1: 5, kind: T.PARK, label: '汽車停車格' });
      L.rooms.push({ x0: 58, y0: 1, x1: 69, y1: 5, kind: T.PARK, label: '電動車充電位' });
      L.rooms.push({ x0: 2, y0: 12, x1: 25, y1: 21, kind: T.PARK, label: '汽車停車格' });
      L.rooms.push({ x0: 2, y0: 30, x1: 43, y1: 34, kind: T.PARK, label: '汽車停車格' });
      /* 機車停車區：一排排 1m 寬的格子，中間是走道 */
      for (const y of [12, 16, 20]) paint(L, 45, y, 70, y + 1, T.MOTO);
      for (const y of [29, 33]) paint(L, 46, y, 70, y + 1, T.MOTO);
      L.rooms.push({ x0: 45, y0: 12, x1: 70, y1: 21, kind: T.MOTO, label: '機車停車區' });
      L.rooms.push({ x0: 46, y0: 29, x1: 70, y1: 34, kind: T.MOTO, label: '機車停車區' });
      /* 電梯廳：玻璃門隔出來，員工在這裡等電梯、用手機打卡 */
      room(L, 29, 22, 42, 27, T.LOBBY, 2, '電梯廳（打卡）', [[35, 27], [36, 27], [29, 25], [42, 25]]);
      /* 結構柱：鋼筋混凝土柱，一根就擋掉 12 dB 以上 */
      for (const x of [10, 19, 26, 47, 56, 65]) {
        for (const y of [6, 11, 22, 29]) {
          const c = get(L, x, y);
          if (c === T.CORE || c === T.IDF || c === T.EXT || c === T.RAMP || c === T.WALL || c === T.GLASS || c === T.OFFICE || c === T.LOBBY || inCoreMargin(x, y)) continue;
          set(L, x, y, T.PILLAR, 13);
        }
      }
    },
  };

  /* ---------- 晶圓廠 Fab 1 ----------
   * 西側是支援區：入口大廳（安檢門）→ 更衣室（手機置物櫃）→ 風淋室 → 無塵室；另有 FAB IDF 弱電室、機台進廠掃毒站、控制室。
   * 無塵室：中間東西向的主走道（天車 OHT 主軌道），南北各五個製程 bay（隔牆是金屬壁板，很擋訊號）；
   * 機台沿著 bay 兩側排列，中間是 bay 內的走道（天車支線）。W / E = bay 西側、東側的機台位置（由外牆往主走道），* = 大型機台佔兩格 */
  const FAB_BAYS = [
    { id: 'N1', name: '黃光區', x0: 17, north: true, W: ['scanner', 'scanner', 'scanner', null], E: ['track', 'track', 'track', null] },
    { id: 'N2', name: '蝕刻區', x0: 28, north: true, W: ['etch', 'etch', 'etch', 'etch'], E: ['etch', 'etch', 'etch', 'etch'] },
    { id: 'N3', name: '薄膜區', x0: 39, north: true, W: ['cvd', 'cvd', 'cvd', 'cvd'], E: ['pvd', 'pvd', 'pvd', 'pvd'] },
    { id: 'N4', name: '擴散 / 爐管區', x0: 50, north: true, W: ['furnace', 'furnace', 'furnace', 'furnace'], E: ['furnace', 'furnace', 'rtp', 'rtp'] },
    { id: 'N5', name: '離子植入區', x0: 61, north: true, W: ['implant*', null, 'implant*', null], E: ['implant*', null, 'implant*', null] },
    { id: 'S1', name: 'CMP / 濕式清洗', x0: 17, north: false, W: ['cmp', 'cmp', 'cmp', null], E: ['wet', 'wet', 'wet', null] },
    { id: 'S2', name: '量測區', x0: 28, north: false, W: ['cdsem', 'cdsem', 'thick', null], E: ['overlay', 'overlay', 'thick', null] },
    { id: 'S3', name: '蝕刻二區', x0: 39, north: false, W: ['etch', 'etch', 'etch', null], E: ['etch', 'etch', 'etch', null] },
    { id: 'S4', name: '薄膜二 / 缺陷檢測', x0: 50, north: false, W: ['ald', 'ald', 'cvd', 'cvd'], E: ['inspect', 'inspect', null, null] },
    { id: 'S5', name: '晶圓倉儲（AMHS）', x0: 61, north: false, W: ['stocker*', null, 'stocker*', null], E: ['stocker*', null, 'stocker*', null] },
  ];
  BUILDERS.fab = (L) => {
    L.tools = [];
    L.bays = [];
    L.oht = [];
    const mark = (o) => Object.assign(L.rooms[L.rooms.length - 1], o);
    /* 支援區 */
    room(L, 0, 0, 15, 8, T.LOBBY, 4, '入口大廳 · 安檢門', [[5, 8]]); mark({ gate: true });
    room(L, 0, 8, 11, 20, T.MEET, 4, '更衣室 · 手機置物櫃', [[5, 8], [11, 11], [11, 16], [8, 20]]); mark({ lockers: true, fabRoom: true });
    room(L, 11, 8, 16, 14, T.OFFICE, 5, '無塵衣倉庫', [[11, 11]]); mark({ fabRoom: true });
    room(L, 11, 14, 16, 18, T.MEET, 6, '風淋室', [[11, 16], [16, 17]]); mark({ shower: true, fabRoom: true });
    room(L, 0, 20, 7, 27, T.LAB, 5, '機台進廠掃毒站', [[7, 24]]); mark({ scan: true, fabRoom: true });
    room(L, 9, 21, 14, 26, T.IDF, 7, 'FAB IDF 弱電室', [[9, 24]]); mark({ fabRoom: true });
    L.idf = { x: 11, y: 23 };
    room(L, 0, 27, 15, 35, T.OFFICE, 5, 'FAB 控制室（MES / 天車監控）', [[8, 27]]); mark({ control: true, fabRoom: true });
    for (const y of [30, 32]) for (let x = 2; x <= 13; x++) if (x % 4 !== 1) set(L, x, y, T.DESK, 0);
    /* 無塵室：和支援區之間的外牆、主走道、bay 隔牆（金屬壁板） */
    for (let y = 1; y <= 34; y++) set(L, 16, y, T.WALL, 8);
    for (let x = 17; x <= 70; x++) { set(L, x, 15, T.WALL, 8); set(L, x, 19, T.WALL, 8); for (let y = 16; y <= 18; y++) set(L, x, y, T.CR, 0); }
    for (const bx of [27, 38, 49, 60]) { for (let y = 1; y <= 14; y++) set(L, bx, y, T.WALL, 8); for (let y = 20; y <= 34; y++) set(L, bx, y, T.WALL, 8); }
    set(L, 16, 17, T.OPEN, 0);
    L.rooms.push({ x0: 17, y0: 16, x1: 70, y1: 18, kind: T.CR, label: '主走道（天車 OHT 主軌道）', aisle: true });
    L.oht.push({ x0: 17.5, y0: 17.5, x1: 70.5, y1: 17.5, main: true });
    for (const b of FAB_BAYS) {
      const y0 = b.north ? 1 : 20, y1 = b.north ? 14 : 34;
      for (let y = y0; y <= y1; y++) for (let x = b.x0; x <= b.x0 + 9; x++) set(L, x, y, T.CR, 0);
      /* bay 入口：接到主走道 */
      for (let x = b.x0 + 3; x <= b.x0 + 6; x++) set(L, x, b.north ? 15 : 19, T.CR, 0);
      L.rooms.push({ x0: b.x0, y0, x1: b.x0 + 9, y1, kind: T.CR, label: b.name, bay: b.id });
      L.bays.push({ id: b.id, name: b.name, x0: b.x0, x1: b.x0 + 9, y0, y1, north: b.north });
      L.oht.push({ x0: b.x0 + 5, y0: 17.5, x1: b.x0 + 5, y1: b.north ? 1.5 : 34.5, bay: b.id });
      const SL = b.north ? [[1, 3], [5, 7], [9, 11], [13, 14]] : [[21, 23], [25, 27], [29, 31], [33, 34]];
      for (const side of ['W', 'E']) {
        const xs = side === 'W' ? b.x0 : b.x0 + 7;
        b[side].forEach((ty, k) => {
          if (!ty) return;
          const big = ty.endsWith('*'), type = big ? ty.slice(0, -1) : ty;
          const ya = SL[k][0], yb = big ? SL[k + 1][1] : SL[k][1];
          const t = type === 'stocker' ? T.STOCK : T.TOOL;
          for (let y = ya; y <= yb; y++) for (let x = xs; x <= xs + 2; x++) set(L, x, y, t, t === T.STOCK ? 14 : 10);
          L.tools.push({ i: L.tools.length, type, bay: b.id, side, x0: xs, y0: ya, x1: xs + 2, y1: yb });
        });
      }
    }
  };
  G.FAB_BAYS = FAB_BAYS;

  function finalize(L, type) {
    const n = W * H;
    L.occ = new Float32Array(n);
    L.guest = new Float32Array(n);
    const sw = Object.assign({}, STAFF_W);
    /* 晶圓廠：操作員在無塵室的走道與 bay 裡走動，控制室有人盯著 MES 與天車 */
    if (G.FT[type] && G.FT[type].fab) { for (const k in sw) sw[k] = 0; sw[T.CR] = 1.0; sw[T.DESK] = 0.6; sw[T.OFFICE] = 0.12; sw[T.LAB] = 0.2; sw[T.MEET] = 0.08; sw[T.LOBBY] = 0.03; }
    if (type === 'conference') sw[T.MEET] = 1.0;
    if (type === 'exec') sw[T.MEET] = 0.3;
    if (type === 'lobby') { sw[T.DESK] = 2.5; sw[T.OFFICE] = 1.0; sw[T.MEET] = 0.05; }
    const dine = !!(G.FT[type] && G.FT[type].dine);
    if (dine) { sw[T.MEET] = 0.02; sw[T.OPEN] = 0.02; }
    const park = !!(G.FT[type] && G.FT[type].park);
    /* 停車場：管理員坐在管理室，偶爾巡場 */
    if (park) { for (const k in sw) sw[k] = 0; sw[T.OFFICE] = 1.0; sw[T.OPEN] = 0.004; }
    let so = 0, sg = 0;
    for (let i = 0; i < n; i++) {
      const t = L.type[i];
      L.occ[i] = sw[t] || 0;
      L.guest[i] = dine ? (DINER_W[t] || 0) : park ? (PARK_W[t] || 0) : (type === 'lobby' || type === 'conference') ? (GUEST_W[t] || 0) : 0;
      so += L.occ[i]; sg += L.guest[i];
    }
    /* 正規化為機率分佈 */
    for (let i = 0; i < n; i++) { L.occ[i] /= so || 1; L.guest[i] /= sg || 1; }
    L.hasGuests = sg > 0;
  }

  const cache = {};
  G.Layout = {
    W, H, T,
    get(type) {
      if (!cache[type]) {
        const L = blank();
        /* 晶圓廠是另一棟建築：沒有總部的核心筒（電梯、廁所），IDF 在支援區 */
        const fab = !!(G.FT[type] && G.FT[type].fab);
        if (!fab) core(L);
        L.hasCore = !fab;
        (BUILDERS[type] || BUILDERS.office)(L);
        /* 廁所門口一定要通（停車場的電梯廳玻璃牆剛好蓋過無障礙廁所的門） */
        for (const w of L.wc || []) set(L, w.door[0], w.door[1], T.OPEN, 0);
        finalize(L, type);
        cache[type] = L;
      }
      return cache[type];
    },
    /** AP 可安裝的位置（天花板）：不能在牆上、核心筒、外牆，也不裝在廁所裡（隱私與衛生；走道的 AP 就蓋得到） */
    canPlaceAp(L, x, y) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const t = L.type[y * W + x];
      return t !== T.WALL && t !== T.GLASS && t !== T.CORE && t !== T.IDF && t !== T.EXT && t !== T.COLD && t !== T.WC && t !== T.TOOL && t !== T.STOCK;
    },
    WC,
    /** AP 到 IDF 的線長估算（曼哈頓距離 + 上下天花板 4m） */
    cableToIdf(L, x, y) { return Math.abs(x - L.idf.x) + Math.abs(y - L.idf.y) + 4; },
  };
})(window.G = window.G || {});
