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
  };

  /* ---------- 大樓 ---------- */
  G.BLD = {
    name: '新曜大樓',
    floorHeight: 4.2,   /* 每層樓高 (m) */
    mdfHoriz: 30,       /* 機房到弱電豎井 + IDF 內的水平距離 (m) */
    floors: [
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
    ],
  };
  G.BLD.byId = {};
  for (const f of G.BLD.floors) G.BLD.byId[f.id] = f;
  G.BLD.totalStaff = G.BLD.floors.reduce((s, f) => s + f.staff, 0); /* = 10,000 */
  /** 樓層 IDF 到 B1 機房的主幹線長度 (m) */
  G.BLD.riserLength = (floorId) => {
    const f = G.BLD.byId[floorId];
    return f ? Math.round((f.level * G.BLD.floorHeight + G.BLD.mdfHoriz) * 10) / 10 : 10;
  };

  /* ---------- 平面圖產生器 ---------- */
  const W = 72, H = 36;
  const T = { OPEN: 0, DESK: 1, MEET: 2, CORE: 3, IDF: 4, OFFICE: 5, LAB: 6, LOBBY: 7, CAFE: 8, WALL: 9, GLASS: 10, EXT: 11 };
  const STAFF_W = { 0: 0.04, 1: 1.0, 2: 0.35, 5: 0.5, 6: 0.8, 7: 0.03, 8: 0.25 };
  const GUEST_W = { 0: 0.1, 2: 0.5, 7: 1.0, 8: 0.7 };
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
  };

  function finalize(L, type) {
    const n = W * H;
    L.occ = new Float32Array(n);
    L.guest = new Float32Array(n);
    const sw = Object.assign({}, STAFF_W);
    if (type === 'conference') sw[T.MEET] = 1.0;
    if (type === 'exec') sw[T.MEET] = 0.3;
    if (type === 'lobby') { sw[T.DESK] = 2.5; sw[T.OFFICE] = 1.0; sw[T.MEET] = 0.05; }
    let so = 0, sg = 0;
    for (let i = 0; i < n; i++) {
      const t = L.type[i];
      L.occ[i] = sw[t] || 0;
      L.guest[i] = (type === 'lobby' || type === 'conference') ? (GUEST_W[t] || 0) : 0;
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
        core(L);
        (BUILDERS[type] || BUILDERS.office)(L);
        finalize(L, type);
        cache[type] = L;
      }
      return cache[type];
    },
    /** AP 可安裝的位置（天花板）：不能在牆上、核心筒或外牆 */
    canPlaceAp(L, x, y) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false;
      const t = L.type[y * W + x];
      return t !== T.WALL && t !== T.GLASS && t !== T.CORE && t !== T.IDF && t !== T.EXT;
    },
    /** AP 到 IDF 的線長估算（曼哈頓距離 + 上下天花板 4m） */
    cableToIdf(L, x, y) { return Math.abs(x - L.idf.x) + Math.abs(y - L.idf.y) + 4; },
  };
})(window.G = window.G || {});
