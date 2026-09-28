/* 3D 模型：AI 伺服器、AI 交換器與儲存、電源櫃（PSU）與 BBU、AI 機櫃，
 * 以及機房設施：液冷 CDU、VESDA 極早期偵煙、潔淨氣體滅火、環境監控、冷熱通道封閉。
 * 機架式設備沿用 models3d 的面板區塊（連接埠、PSU、風扇、硬碟槽…）；其他用程式直接建模。
 */
(function (G) {
  'use strict';
  const M3 = G.M3;
  if (!M3 || !M3.kit) return;
  const K = M3.kit, D = K.D;

  /* ---------- 機架式：面板規格（加進共用的 SPEC，3D 機房也會用簡化版） ---------- */
  const GPU = { body: '#2a2f33', bezel: '#15191c', brand: 'KORVEN AI', accent: '#76b900', handles: true };
  const SPECS = {
    'GX-8': Object.assign({}, GPU, { u: 8, depth: 850,
      front: { rows: [
        { h: 46, s: [{ t: 'brand', w: 70 }, { t: 'lcd', w: 64, lines: ['GX-8  8 x GPU', 'NVLINK 900GB/s  OK', 'GPU 71C  PWR 9.8kW'], color: '#b6f36a', label: '狀態面板：GPU 溫度、功耗、NVLink 狀態' },
          { t: 'leds', items: [['PWR', 'g'], ['GPU', 'g'], ['NVL', 'b'], ['FAN', 'g'], ['LIQ', 'b'], ['ALM', 'r', false]] }, { t: 'ctrl' }, { t: 'vent' }] },
        { h: 190, bg: '#1b2024', s: [{ t: 'fan', w: 60, label: '前方進風風扇牆：帶走記憶體、NVMe 與電源的熱' }, { t: 'fan', w: 60 }, { t: 'fan', w: 60 }, { t: 'fan', w: 60 }, { t: 'fan', w: 60 }, { t: 'fan', w: 60 }] },
        { s: [{ t: 'drives', cols: 8, rows: 1, dw: 20, dh: 90, tab: '#76b900', label: '8 × NVMe（E1.S）：本機快取訓練資料' }, { t: 'badge', text: 'HGX 8-GPU', color: '#b6f36a', label: '8 顆資料中心 GPU 以 NVLink 互連，像一顆超大 GPU' }, { t: 'vent' }] },
      ] },
      rear: { rows: [
        { h: 80, s: [{ t: 'ports', kind: 'qsfp', count: 8, rows: 1, modules: 8, mpo: true, bail: '#76b900', label: '8 × 400G OSFP：每顆 GPU 一個，接 AI 後端網路' },
          { t: 'nic', count: 2, label: '2 × 25G 前端網卡：接企業核心' }, { t: 'mgmt', text: 'BMC' }] },
        { s: [{ t: 'badge', text: '54V BUSBAR', w: 44, color: '#f2c14e', label: '54V 匯流排接頭：從機櫃背面的銅排取電（沒有電源線）' },
          { t: 'badge', text: 'LIQUID IN  OUT', w: 52, color: '#7fd6ff', label: '液冷快接頭：冷卻液進 / 出，接機櫃歧管' }, { t: 'fan', w: 52 }, { t: 'fan', w: 52 }, { t: 'fan', w: 52 }, { t: 'vent' }] },
      ] } }),
    'GX-4': Object.assign({}, GPU, { u: 4, depth: 800,
      front: { s: [{ t: 'brand' }, { t: 'leds', items: [['PWR', 'g'], ['GPU', 'g'], ['FAN', 'g'], ['ALM', 'r', false]] }, { t: 'ctrl' },
        { t: 'drives', cols: 8, rows: 2, dw: 34, dh: 16, label: '16 × 2.5 吋 NVMe' }, { t: 'vent' }] },
      rear: { s: [{ t: 'pcie', w: 110, n: 4, label: '4 張推論 GPU（PCIe 卡、氣冷）' }, { t: 'ports', kind: 'qsfp', count: 2, rows: 2, modules: 2, label: '2 × 400G：接 AI 後端網路' },
        { t: 'nic', count: 2, label: '2 × 25G：接企業核心' }, { t: 'psu', label: '雙電源（接一般 PDU）' }, { t: 'psu' }, { t: 'mgmt', text: 'BMC' }] } }),
    'ST-AI': { u: 2, depth: 750, body: '#b3bac0', bezel: '#1b1f23', brand: 'KORVEN AI', accent: '#76b900', handles: true,
      front: { s: [{ t: 'ctrl', label: '電源鍵與健康狀態燈' }, { t: 'drives', cols: 24, rows: 1, dw: 14.4, dh: 72, tab: '#76b900', label: '24 × NVMe SSD（全快閃）：每秒數十 GB 的讀取' }] },
      rear: { s: [{ t: 'ports', kind: 'qsfp', count: 4, rows: 2, modules: 4, label: '4 × 400G：接 AI 後端網路' }, { t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'mgmt', text: 'BMC' }, { t: 'fan' }, { t: 'fan' }] } },
    'AF-6400': { u: 2, depth: 600, body: '#2d3339', bezel: '#1c2126', brand: 'ARCLINE AI', accent: '#76b900',
      front: { s: [{ t: 'brand', w: 50 }, { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['PFC', 'b'], ['FAN', 'g']], label: 'PFC 燈：無損乙太網路（RoCE）的流量控制' },
        { t: 'ports', kind: 'qsfp', count: 64, rows: 2, group: 16, modules: 40, mpo: true, bail: '#76b900', label: '64 × 400G OSFP：51.2 Tbps，接 GPU 伺服器與 AI 儲存' }, { t: 'mgmt' }] },
      rear: { s: [{ t: 'psu', label: '4 組電源（2+2 備援）' }, { t: 'psu' }, { t: 'psu' }, { t: 'psu' }, { t: 'fan', label: '熱插拔風扇' }, { t: 'fan' }, { t: 'fan' }, { t: 'fan' }] } },
    'PS-33': { u: 1, depth: 700, body: '#2c3136', bezel: '#1a1e22', brand: 'VOLTARA', accent: '#f2c14e', sticker: false,
      front: { s: [{ t: 'leds', items: [['AC', 'g'], ['DC', 'g']] },
        { t: 'psu', w: 60, label: 'PSU 模組 × 6（每個 5.5 kW，可熱插拔）：AC 轉 54V 直流' }, { t: 'psu', w: 60 }, { t: 'psu', w: 60 }, { t: 'psu', w: 60 }, { t: 'psu', w: 60 }, { t: 'psu', w: 60 }] },
      rear: { s: [{ t: 'term', label: '三相 AC 輸入' }, { t: 'badge', text: '54V DC OUT → BUSBAR', w: 70, color: '#f2c14e', label: '直流輸出接到機櫃背面的銅排（busbar）' }, { t: 'vent' }] } },
    'BBU-6': { u: 1, depth: 700, body: '#26292d', bezel: '#1a1d20', brand: 'VOLTARA', accent: '#e86fa8', sticker: false,
      front: { s: [{ t: 'leds', items: [['CHG', 'g'], ['DIS', 'a', false]] }, { t: 'batt', n: 6, label: '6 個鋰電池模組（每個 3 kW）：停電時瞬間放電' }] },
      rear: { s: [{ t: 'badge', text: '54V BUSBAR', w: 44, color: '#f2c14e', label: '直接掛在 54V 匯流排上：不經過 UPS' }, { t: 'card', label: '電池管理（BMS）：電量、健康度、溫度' }, { t: 'vent' }] } },
  };
  for (const [id, sp] of Object.entries(SPECS)) {
    K.SPEC[id] = sp;
    M3.register(id, () => K.chassis(Object.assign({ model: id }, sp)));
  }

  /* ---------- AI 機櫃（ORv3）：電源櫃、BBU、GPU 伺服器、背面的銅排與液冷歧管 ---------- */
  function rackAi() {
    const T = M3.T();
    const R = K.RACK;
    const g = K.rackFrame();
    const U0 = R.U0, UH = R.UH, zRail = R.zRail, RD = R.D;
    const place = [['PS-33', 1], ['BBU-6', 2], ['BBU-6', 3], ['GX-8', 4], ['GX-8', 12], ['ST-AI', 20], ['AF-6400', 41]];
    const used = new Set(), pos = {};
    for (const [id, u] of place) {
      const sp = Object.assign({ model: id }, K.SPEC[id], { sticker: false });
      const c = K.chassis(sp);
      const y = U0 + (u - 1) * UH + sp.u * UH / 2;
      c.obj.position.set(0, y, zRail + 0.03 - c.dims[2] / 200);
      g.add(c.obj);
      for (let k = 0; k < sp.u; k++) used.add(u + k);
      if (!pos[id]) pos[id] = { y, u };
    }
    const blankM = K.std('#16191c', { metalness: 0.4, roughness: 0.55 });
    for (let u = 1; u <= 42; u++) {
      if (used.has(u)) continue;
      const b = K.box(4.4, UH - 0.012, 0.02, blankM);
      b.position.set(0, U0 + (u - 0.5) * UH, zRail + 0.03);
      g.add(b);
    }
    /* 背面：兩條 54V 銅排 + 藍（供）紅（回）液冷歧管，GPU 伺服器以快接頭軟管接上 */
    const zb = -RD / 2 + 0.55;
    const cu = K.std('#c8773a', { metalness: 0.9, roughness: 0.3 });
    for (const x of [-0.35, 0.35]) { const bar = K.box(0.28, 17.6, 0.1, cu); bar.position.set(x, U0 + 8.8, zb); g.add(bar); }
    const blue = K.std('#2f86d6', { roughness: 0.4, metalness: 0.2 }), red = K.std('#d94a3a', { roughness: 0.4, metalness: 0.2 });
    for (const [x, m] of [[-2.1, blue], [2.1, red]]) {
      const pipe = K.cylY(0.14, 17, m, 16); pipe.position.set(x, U0 + 8.5, zb); g.add(pipe);
      const top = K.tube([[x, U0 + 17, zb], [x, U0 + 19.6, zb], [x * 0.6, 21.2, zb - 0.3]], 0.14, m, 20, 10); g.add(top);
      for (const u of [4, 12]) {
        const y = U0 + (u + 3) * UH;
        g.add(K.tube([[x, y, zb], [x * 0.7, y + 0.1, zb + 0.25], [x * 0.35, y, zb + 0.55]], 0.06, m, 16, 8));
      }
    }
    const notes = [
      K.note([1.8, pos['PS-33'].y, zRail + 0.06], [0, 0, 1], '電源櫃 PS-33：6 個 PSU，把 AC 轉成 54V 直流'),
      K.note([-1.8, pos['BBU-6'].y + UH / 2, zRail + 0.06], [0, 0, 1], 'BBU × 2：停電時撐到發電機啟動'),
      K.note([1.8, pos['GX-8'].y, zRail + 0.06], [0, 0, 1], 'GX-8 AI 伺服器 × 2：每台約 10 kW'),
      K.note([-1.8, pos['ST-AI'].y, zRail + 0.06], [0, 0, 1], 'AI 全快閃儲存'),
      K.note([1.8, pos['AF-6400'].y, zRail + 0.06], [0, 0, 1], 'AI 後端交換器（400G）'),
      K.note([0.35, U0 + 12, zb - 0.06], [0, 0, -1], '背面：54V 銅排（busbar），伺服器直接插上取電'),
      K.note([-2.1, U0 + 6, zb - 0.15], [0, 0, -1], '藍色歧管：冷卻液送往 GPU 冷板'),
      K.note([2.1, U0 + 6, zb - 0.15], [0, 0, -1], '紅色歧管：帶走熱量的冷卻液回到 CDU'),
    ];
    return { obj: g, notes, view: { yaw: 2.6, pitch: 0.12 } };
  }

  /* ---------- 液冷分配單元 CDU ---------- */
  function cdu() {
    const Wm = 600, Hm = 1950, Dm = 1200;
    const g = new (M3.T().Group)();
    const body = K.box(Wm / 100, Hm / 100, Dm / 100, K.std('#d9dee2', { metalness: 0.2, roughness: 0.5 }));
    g.add(body);
    const ft = K.makeTex(Wm, Hm, (c) => {
      D.rect(c, 0, 0, Wm, Hm, '#e2e6e9');
      D.rr(c, 10, 10, Wm - 20, Hm - 20, 6, null, '#b8c0c6', 2);
      D.txt(c, 'HYDRA', 40, 70, 34, '#2c3238', 'left', 800);
      D.txt(c, 'CDU-100  LIQUID COOLING', 40, 104, 17, '#5b6770', 'left', 700);
      D.rect(c, 40, 44, 6, 44, '#2f86d6');
      D.rr(c, 90, 150, 420, 300, 8, '#0b1419', '#2d3a42', 2);
      D.lcd(c, 110, 170, 380, 260, ['SUPPLY  32.0C', 'RETURN  44.6C', 'FLOW    118 LPM', 'LOAD    82 kW', 'PUMP A RUN  B STBY'], '#7fd6ff');
      for (let i = 0; i < 2; i++) {
        const y = 520 + i * 330;
        D.rr(c, 60, y, 480, 290, 8, '#cfd5da', '#9aa3aa', 2);
        D.vent(c, 80, y + 20, 300, 250, '#8f989f', 6);
        D.led(c, 430, y + 60, 8, i === 0 ? '#3fe07a' : '#ffb13b', true);
        D.txt(c, i === 0 ? 'PUMP A  RUN' : 'PUMP B  STANDBY', 410, y + 110, 15, '#39424a', 'center', 800);
      }
      D.rr(c, 60, 1220, 480, 640, 8, '#d0d6da', '#9aa3aa', 2);
      D.txt(c, 'HEAT EXCHANGER', 300, 1540, 22, '#5b6770', 'center', 800);
    });
    const fp = K.plane(Wm / 100, Hm / 100, K.texMat(ft, { metalness: 0.15, roughness: 0.5 }));
    fp.position.z = Dm / 200 + 0.003;
    g.add(fp);
    const blue = K.std('#2f86d6', { roughness: 0.4, metalness: 0.2 }), red = K.std('#d94a3a', { roughness: 0.4, metalness: 0.2 });
    [[-1.4, blue], [-0.5, blue], [0.5, red], [1.4, red]].forEach(([x, m]) => {
      const p = K.cylY(0.22, 3, m, 16);
      p.position.set(x, Hm / 200 + 1.5, -1.5);
      g.add(p);
    });
    const fz = Dm / 200 + 0.004;
    const notes = [
      K.note([0, (Hm / 2 - 300) / 100, fz], [0, 0, 1], '螢幕：送 / 回水溫度、流量、帶走的熱量'),
      K.note([-1, (Hm / 2 - 660) / 100, fz], [0, 0, 1], '雙泵浦：一台運轉、一台備援（N+1）'),
      K.note([0, (Hm / 2 - 1540) / 100, fz], [0, 0, 1], '熱交換器：把熱交給大樓冰水，機櫃內的冷卻液不直接接觸冰水'),
      K.note([-1, Hm / 100 / 2 + 3, -1.5], [0, 1, 0], '藍管送出冷的冷卻液'),
      K.note([1, Hm / 100 / 2 + 3, -1.5], [0, 1, 0], '紅管收回熱的冷卻液'),
    ];
    return { obj: g, notes, view: { yaw: 0.55, pitch: 0.2 } };
  }

  /* ---------- VESDA 極早期偵煙 ---------- */
  function vesda() {
    const T = M3.T();
    const g = new T.Group();
    const bw = 3.6, bh = 2.8, bd = 1.3;
    g.add(K.box(bw, bh, bd, K.std('#e9ecee', { metalness: 0.05, roughness: 0.45 })));
    const ft = K.makeTex(360, 280, (c) => {
      D.rect(c, 0, 0, 360, 280, '#eef1f3');
      D.txt(c, 'VESDA', 24, 36, 28, '#c0392b', 'left', 800);
      D.txt(c, 'ASPIRATING SMOKE DETECTOR', 24, 64, 11, '#5b6770', 'left', 700);
      const lv = [['FIRE 2', '#ff3b30'], ['FIRE 1', '#ff7a1a'], ['ACTION', '#ffb13b'], ['ALERT', '#f2d34e']];
      lv.forEach(([t, col], i) => { D.led(c, 40, 100 + i * 34, 7, col, i === 3); D.txt(c, t, 58, 100 + i * 34, 13, '#39424a', 'left', 800); });
      for (let i = 0; i < 10; i++) D.rr(c, 190 + i * 15, 230 - (i + 1) * 12, 11, (i + 1) * 12, 1, i < 3 ? '#46d17f' : '#d5dbdf');
      D.txt(c, 'SMOKE LEVEL', 262, 250, 11, '#5b6770', 'center', 800);
    });
    const fp = K.plane(bw, bh, K.texMat(ft, { metalness: 0, roughness: 0.5 }));
    fp.position.z = bd / 2 + 0.003;
    g.add(fp);
    const red = K.std('#d23a2c', { roughness: 0.45, metalness: 0.1 });
    g.add(K.tube([[0, bh / 2, 0], [0, bh / 2 + 3, 0], [0, bh / 2 + 3.4, -0.4]], 0.16, red, 20, 10));
    const pipe = K.cylX(0.16, 0.16, -9, 9, red, bh / 2 + 3.4, -0.4, 14);
    g.add(pipe);
    for (let i = -8; i <= 8; i += 2.4) {
      const hole = new T.Mesh(new T.TorusGeometry(0.2, 0.05, 8, 20), K.std('#1b1f23'));
      hole.position.set(i, bh / 2 + 3.2, -0.4);
      hole.rotation.x = Math.PI / 2;
      g.add(hole);
    }
    const notes = [
      K.note([4.8, bh / 2 + 3.4, -0.4], [1, 0, 0], '取樣管：每隔幾公尺一個取樣孔，持續抽機房的空氣'),
      K.note([-1, 0.3, bd / 2 + 0.01], [0, 0, 1], '四段警報：Alert → Action → Fire 1 → Fire 2'),
      K.note([1.2, -0.6, bd / 2 + 0.01], [0, 0, 1], '雷射偵測腔：一般偵煙器看不到的微粒也測得到'),
    ];
    return { obj: g, notes, view: { yaw: 0.35, pitch: 0.15 } };
  }

  /* ---------- 潔淨氣體滅火系統 ---------- */
  function gasSystem() {
    const T = M3.T();
    const g = new T.Group();
    const redM = K.std('#c0392b', { metalness: 0.35, roughness: 0.38 });
    const valveM = K.std('#b9c0c6', { metalness: 0.85, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 3.2;
      const cyl = K.cylY(1.3, 13, redM, 32); cyl.position.set(x, 6.5 + 0.4, 0); g.add(cyl);
      const cap = new T.Mesh(new T.SphereGeometry(1.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), redM); cap.position.set(x, 13.4, 0); g.add(cap);
      const v = K.cylY(0.35, 1.2, valveM, 16); v.position.set(x, 15, 0); g.add(v);
      g.add(K.tube([[x, 15.6, 0], [x, 16.6, 0], [x * 0.9, 17.4, 0]], 0.12, valveM, 16, 8));
      const lab = K.plane(1.6, 2.2, K.texMat(K.makeTex(160, 220, (c) => { D.rect(c, 0, 0, 160, 220, '#f4f2ea'); D.txt(c, 'IG-541', 80, 50, 24, '#c0392b', 'center', 800); D.txt(c, 'INERT GAS', 80, 90, 14, '#39424a', 'center', 800); D.txt(c, '200 bar', 80, 130, 14, '#39424a', 'center', 700); D.txt(c, '⚠', 80, 180, 30, '#c0392b', 'center', 800); })));
      lab.position.set(x, 7, 1.31);
      g.add(lab);
    }
    const man = K.cylX(0.18, 0.18, -3.6, 3.6, valveM, 17.4, 0, 14); g.add(man);
    g.add(K.tube([[3.6, 17.4, 0], [5, 17.4, 0], [5, 21, 0], [8, 21, 0]], 0.18, valveM, 30, 10));
    const noz = K.cylY(0.35, 0.5, valveM, 16); noz.position.set(8, 20.6, 0); g.add(noz);
    const frame = K.box(10.4, 0.4, 3.2, K.std('#3a4248', { metalness: 0.5 })); frame.position.set(0, 0.2, 0); g.add(frame);
    const strap = K.box(10.2, 0.25, 2.9, K.std('#2b3136', { metalness: 0.5 })); strap.position.set(0, 10, 0); g.add(strap);
    const panel = K.box(3, 4, 0.8, K.std('#e9ecee', { roughness: 0.5 }));
    panel.position.set(8.5, 9, 0);
    g.add(panel);
    const pt = K.makeTex(300, 400, (c) => {
      D.rect(c, 0, 0, 300, 400, '#eef1f3');
      D.txt(c, '滅火控制盤', 150, 40, 26, '#2c3238', 'center', 800);
      [['電源', '#3fe07a', true], ['警報', '#ffb13b', false], ['釋放延遲 30 秒', '#ff3b30', false], ['已釋放', '#ff3b30', false]].forEach(([t, col, on], i) => { D.led(c, 50, 100 + i * 60, 10, col, on); D.txt(c, t, 76, 100 + i * 60, 20, '#39424a', 'left', 800); });
      D.rr(c, 90, 330, 120, 46, 8, '#c0392b'); D.txt(c, '手動釋放', 150, 353, 18, '#fff', 'center', 800);
    });
    const pp = K.plane(3, 4, K.texMat(pt, { metalness: 0, roughness: 0.5 }));
    pp.position.set(8.5, 9, 0.41);
    g.add(pp);
    const notes = [
      K.note([0, 8, 1.31], [0, 0, 1], '惰性氣體鋼瓶（IG-541）：把氧氣濃度降到燃燒不了'),
      K.note([8, 20.6, 0], [0, 1, 0], '噴頭：幾十秒內讓整個機房充滿滅火氣體'),
      K.note([8.5, 10.4, 0.42], [0, 0, 1], '控制盤：警報後延遲 30 秒釋放，讓人員先撤離'),
      K.note([-3.2, 16.5, 0], [0, 1, 0], '釋放後要補充鋼瓶，否則下次火災就沒有保護'),
    ];
    return { obj: g, notes, view: { yaw: 0.5, pitch: 0.12 } };
  }

  /* ---------- 環境監控：觸控面板、溫濕度感測器、漏水偵測線、門禁 ---------- */
  function ems() {
    const T = M3.T();
    const g = new T.Group();
    const wall = K.box(12, 6.5, 0.2, K.std('#cfd5da', { roughness: 0.9, metalness: 0 })); wall.position.set(0, 3.25, -0.2); g.add(wall);
    const scr = K.box(4.2, 2.8, 0.25, K.std('#1b2024', { metalness: 0.4 })); scr.position.set(-2.8, 4, 0.05); g.add(scr);
    const st = K.makeTex(420, 280, (c) => {
      D.rect(c, 0, 0, 420, 280, '#0b1419');
      D.txt(c, 'B1 MDF  環境監控', 16, 26, 20, '#e9edf0', 'left', 800);
      [['溫度', '22.4°C', '#46d17f'], ['濕度', '47%', '#46d17f'], ['漏水', '正常', '#46d17f'], ['煙霧', '正常', '#46d17f'], ['門禁', '關閉', '#5aa9f0'], ['UPS', '100%', '#46d17f']].forEach(([k, v, col], i) => {
        const x = 16 + (i % 3) * 136, y = 60 + Math.floor(i / 3) * 104;
        D.rr(c, x, y, 124, 92, 8, '#12222a', col, 2);
        D.txt(c, k, x + 12, y + 24, 16, '#9aa4ab', 'left', 700);
        D.txt(c, v, x + 12, y + 62, 26, col, 'left', 800);
      });
    });
    const sp = K.plane(4, 2.6, K.texMat(st, { metalness: 0, roughness: 0.4, emissive: K.col('#ffffff'), emissiveIntensity: 0.25 }));
    sp.position.set(-2.8, 4, 0.19);
    g.add(sp);
    const sensor = K.box(0.9, 1.3, 0.35, K.std('#f4f6f7', { roughness: 0.5 })); sensor.position.set(1.4, 4.4, 0.05); g.add(sensor);
    for (let i = 0; i < 6; i++) { const s2 = K.box(0.6, 0.05, 0.02, K.std('#9aa3aa')); s2.position.set(1.4, 4.1 + i * 0.12, 0.23); g.add(s2); }
    const reader = K.box(0.8, 1.2, 0.2, K.std('#2b3136', { metalness: 0.4 })); reader.position.set(4.4, 3.4, 0.05); g.add(reader);
    const rl = new T.Mesh(new T.CircleGeometry(0.22, 20), K.glow('#46d17f', 1.4)); rl.position.set(4.4, 3.7, 0.16); g.add(rl);
    const rope = [];
    for (let i = 0; i <= 40; i++) { const a = i / 40 * Math.PI * 3.2; rope.push([2 + Math.cos(a) * (1.6 - i * 0.02), 0.08, 1.6 + Math.sin(a) * (1.1 - i * 0.012)]); }
    rope.push([6, 0.08, 1.2]);
    g.add(K.tube(rope, 0.06, K.std('#f2c14e', { roughness: 0.6 }), 120, 8));
    const floor = K.box(12, 0.1, 4, K.std('#8f989f', { roughness: 0.9 })); floor.position.set(0, 0, 1.8); g.add(floor);
    const notes = [
      K.note([-2.8, 4.8, 0.2], [0, 0, 1], '監控面板：溫度、濕度、漏水、煙霧、門禁一次看'),
      K.note([1.4, 4.9, 0.22], [0, 0, 1], '溫濕度感測器：放在機櫃進風口'),
      K.note([4.4, 3.9, 0.16], [0, 0, 1], '門禁讀卡機：誰進出機房都有紀錄'),
      K.note([2.4, 0.15, 2.4], [0, 1, 0], '漏水偵測線：沿著空調與水管佈線，碰到水就告警'),
    ];
    return { obj: g, notes, view: { yaw: 0.35, pitch: 0.3 } };
  }

  /* ---------- 冷熱通道封閉 ---------- */
  function containment() {
    const T = M3.T();
    const g = new T.Group();
    const rackM = K.std('#1b2024', { metalness: 0.4, roughness: 0.5 });
    for (const z of [-4.2, 4.2]) for (let i = 0; i < 4; i++) { const r = K.box(3, 10, 5, rackM); r.position.set((i - 1.5) * 3.2, 5, z + Math.sign(z) * 0.4); g.add(r); }
    const glass = K.std('#9fd3ee', { transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false });
    const roof = K.box(13, 0.12, 7.6, glass); roof.position.set(0, 10.1, 0); g.add(roof);
    const frameM = K.std('#59636b', { metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const door = K.box(0.12, 9.9, 3.6, glass); door.position.set(sx * 6.5, 5, sx * 0.9); g.add(door);
      const door2 = K.box(0.12, 9.9, 3.6, glass); door2.position.set(sx * 6.5, 5, -sx * 1.9); g.add(door2);
      const fr = K.box(0.2, 0.2, 7.6, frameM); fr.position.set(sx * 6.5, 10, 0); g.add(fr);
    }
    const notes = [
      K.note([0, 10.2, 0], [0, 1, 0], '頂板：把通道上方封住，冷熱空氣不會混在一起'),
      K.note([6.5, 5, 0.9], [1, 0, 0], '兩端滑門：人可以進出，平常保持關閉'),
      K.note([-4.8, 6, 4.6], [0, 0, 1], '機櫃背面朝向封閉通道：熱風集中送回空調'),
    ];
    return { obj: g, notes, view: { yaw: 0.8, pitch: 0.45 } };
  }

  M3.register('rackai', rackAi, { name: 'ORv3 AI 機櫃', cap: '沒有 PDU：電源櫃把 AC 轉成 54V 直流送上背面的銅排；BBU 掛在同一條匯流排上；GPU 用液冷歧管散熱。' });
  M3.register('CDU-100', cdu);
  M3.register('VESDA', vesda);
  M3.register('GAS-FS', gasSystem);
  M3.register('EMS-1', ems);
  M3.register('CONTAIN', containment);

  Object.assign(M3.KB, {
    'k-fire': ['GAS-FS', 'VESDA'],
    'k-ems': ['EMS-1'],
    'k-pue': ['CONTAIN', 'anim-aisle'],
    'k-gpu': ['GX-8', 'GX-4'],
    'k-aipower': ['rackai', 'PS-33', 'BBU-6'],
    'k-liquid': ['CDU-100', 'GX-8'],
    'k-aifabric': ['AF-6400', 'ST-AI'],
  });
})(window.G = window.G || {});
