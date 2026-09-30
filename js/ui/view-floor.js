/* 樓層規劃：平面圖（放置 / 拖曳 AP、訊號熱圖、AP 負載、同頻干擾）＋ IDF 設定（布線、接入交換器、上行主幹、Wi-Fi 工具） */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { fid: null, tool: 'select', apModel: 'AP-600', layer: 'rssi', selAp: null, drag: null, stage: null, cabStd: 'cat6', hover: null };
  G.Views.floor = V;
  const T = G.Layout.T;

  function defaultFloor() {
    const s = G.S;
    const cands = G.BLD.floors.filter((f) => s.floors[f.id].moveInAt !== null && !G.Net.floorUp(f.id)).sort((a, b) => s.floors[a.id].moveInAt - s.floors[b.id].moveInAt);
    return cands.length ? cands[0].id : '2F';
  }
  const heat = (r) => (r >= -60 ? 'rgba(70,209,127,0.55)' : r >= -67 ? 'rgba(160,214,80,0.5)' : r >= -72 ? 'rgba(240,190,58,0.5)' : r >= -75 ? 'rgba(240,130,58,0.52)' : r >= -78 ? 'rgba(242,80,80,0.5)' : 'rgba(110,120,130,0.28)');
  const loadCol = (u) => (u >= 1 ? 'rgba(242,95,92,0.5)' : u >= 0.7 ? 'rgba(240,166,58,0.45)' : 'rgba(70,209,127,0.4)');

  V.mount = (el, param) => {
    const s = G.S;
    if (param && G.BLD.byId[param] && param !== V.fid) { V.fid = param; V.selAp = null; V.stage = null; }
    if (!V.fid) V.fid = defaultFloor();
    if (!Q.unlocked(CAT.aps[V.apModel])) V.apModel = 'AP-600';
    const f = G.BLD.byId[V.fid], fs = s.floors[V.fid], ft = G.FT[f.type];
    if (!V.stage || V.stage.fid !== V.fid) V.stage = { fid: V.fid, model: fs.idf.model, count: fs.idf.count };
    V.el = el;
    V.live = [];

    const pick = h('div', { class: 'floor-pick', role: 'tablist' });
    /* B1 是主機房（MDF），沒有座位與 Wi-Fi 平面圖：在 1F 與 B2 之間放一個捷徑，點了到「機房」 */
    const b1Btn = () => {
      const failed = Object.values(s.devices).some((d) => d.rack && !d.host && d.status !== 'ok');
      const c = failed || s.temp >= 35 ? 'bad' : s.temp >= 28 ? 'warn' : s.racks.length ? 'ok' : '';
      return h('button', { class: 'b1', 'data-hint': 'floor:B1', title: 'B1 是主機房（MDF）：機櫃、核心設備與實體接線都在「機房」頁面', onclick: () => UI.go('rack') },
        h('span', { class: 'dot ' + c }), 'B1', h('span', { class: 'go' }, '機房 ↗'));
    };
    let b1Done = false;
    const floorBtn = (x) => {
      const stt = G.Views.building.floorStatus(x.id);
      return h('button', { class: x.id === V.fid ? 'on' : '', 'data-hint': 'floor:' + x.id, onclick: () => { if (x.id !== V.fid) { V.fid = x.id; V.selAp = null; V.stage = null; UI.refresh(); } } },
        h('span', { class: 'dot ' + stt.c }), x.id);
    };
    for (const x of G.BLD.hq.slice().reverse()) {
      if (!b1Done && x.level < 0) { pick.appendChild(b1Btn()); b1Done = true; }
      pick.appendChild(floorBtn(x));
    }
    if (!b1Done) pick.appendChild(b1Btn());
    /* 大樓後方的晶圓廠（第十章） */
    if (Q.unlocked(CAT.fab) || G.BLD.isFab(V.fid)) {
      pick.appendChild(h('span', { class: 'sep' }, '晶圓廠'));
      for (const x of G.BLD.fab) pick.appendChild(floorBtn(x));
    }
    el.appendChild(pick);
    const open = ft.park ? '啟用' : '進駐';
    const mi = fs.moveInAt !== null && fs.movedIn < f.staff ? (fs.moveInAt > s.time ? `預計 ${U.stamp(fs.moveInAt)} ${open}（${U.dur(fs.moveInAt - s.time)} 後）` : `${open}中`) : fs.movedIn ? `已${open}` : `尚未排定${open}`;
    const use3d = UI.pref3d('floor');
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, ft.fab ? f.dept : `${f.id} ${f.dept}`), h('div', { class: 'desc' }, ft.fab
        ? `總部後方的晶圓廠 · ${G.Fab.slots().length} 台製程機台（每台 1～2 個網路埠）· 24 小時兩班制，操作員 ${U.num(f.staff)} 人 · 經 ${G.BLD.campus} m 校園光纖連回總部 B1 · ${mi}`
        : ft.dine
        ? `${ft.name} · 廚師與服務人員 ${U.num(f.staff)} 人 · 午餐尖峰約 ${U.num(ft.diners)} 人同時用餐（人人滑手機）· 收銀機 ${ft.pos} 台 · ${mi}`
        : ft.park
          ? `地下停車場 · 管理員 ${f.staff} 人 · 上下班尖峰約 ${U.num(ft.parkPeak)} 人同時進出（地下室收不到 GPS，手機打卡要靠 Wi-Fi）· 柵欄機 / 車牌辨識 ${ft.gates} 埠 · PoE 監視器 ${ft.cams} 台 · ${mi}`
          : `${ft.name}樓層 · 編制 ${U.num(f.staff)} 人 · 有線座位約 ${U.pct(ft.wired)} · ${mi}`)),
      h('div', { class: 'row wrap' }, UI.toggle3d('floor'), h('span', { class: 'chip' }, `主幹距離 B1 ${G.BLD.riserLength(f.id)} m`), G.BLD.riserLength(f.id) > 100 ? h('span', { class: 'chip warn' }, '超過 100m：銅纜無法使用') : null)));

    const left = h('div', { class: 'col', style: { gap: '10px' } });
    V.right = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'split' }, left, V.right));

    /* 工具列（自己布線進行中時多一個「布線」工具，而且預設就是它） */
    const diy = G.Diy.job(V.fid);
    if (diy && V.diyFloor !== V.fid) { V.diyFloor = V.fid; V.tool = 'cable'; }
    if (!diy && V.tool === 'cable') V.tool = 'select';
    const toolSeg = h('div', { class: 'seg' },
      h('button', { class: V.tool === 'select' ? 'on' : '', onclick: () => { V.tool = 'select'; UI.refresh(); } }, '選取 / 拖曳'),
      h('button', { class: V.tool === 'place' ? 'on' : '', 'data-hint': 'ap-place@' + V.fid, onclick: () => { V.tool = 'place'; UI.refresh(); } }, '放置 AP'),
      diy ? h('button', { class: V.tool === 'cable' ? 'on' : '', 'data-hint': 'diy-tool@' + V.fid, onclick: () => { V.tool = 'cable'; UI.refresh(); } }, '布線') : null);
    const modelSel = h('select', { id: 'ap-model', onchange: (e) => { V.apModel = e.target.value; } },
      Object.entries(CAT.aps).map(([id, m]) => h('option', { value: id, selected: id === V.apModel || null, disabled: !Q.unlocked(m) || null }, `${m.name} · ${U.money(m.price + CAT.apInstallFee)}${Q.unlocked(m) ? '' : '（第 ' + m.unlock + ' 章）'}`)));
    const layerSeg = h('div', { class: 'seg' }, [['rssi', '訊號'], ['load', 'AP 負載'], ['cci', '同頻干擾'], ['none', '平面']].map(([k, t]) =>
      h('button', { class: V.layer === k ? 'on' : '', onclick: () => { V.layer = k; UI.refresh(); } }, t)));
    const tools = h('div', { class: 'plan-tools' }, toolSeg, modelSel, h('span', { class: 'grow' }), layerSeg);
    if (V.ro) { V.ro.disconnect(); V.ro = null; }
    if (use3d) {
      V.canvas = null;
      V.tip = null;
      left.appendChild(h('div', { class: 'plan-wrap' }, tools,
        diy ? h('div', { class: 'note info small', style: { marginBottom: '8px' } }, '自己布線要在 2D 平面圖上畫走線路徑。', h('button', { class: 'btn xs primary', style: { marginLeft: '6px' }, onclick: () => { UI.pref3d('floor', false); V.tool = 'cable'; UI.refresh(); } }, '切到 2D 布線')) : null,
        floor3d(),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, V.tool === 'place' ? '「放置 AP」：點地板就會在正上方的天花板安裝 AP（不能裝在牆上或核心筒）。' : '點 AP 看詳情；滑過地板可以看到那個位置的訊號強度。牆越厚，訊號衰減越多。')));
    } else {
      V.canvas = h('canvas', { style: { aspectRatio: '2 / 1', touchAction: V.tool === 'cable' ? 'none' : null }, 'aria-label': `${f.id} 平面圖`, 'data-hint': V.tool === 'cable' ? 'diy-canvas@' + V.fid : null });
      V.tip = h('div', { class: 'small mono muted', style: { minHeight: '18px', marginTop: '6px' } }, V.tool === 'cable' ? '從 IDF（綠色圓圈）按住拖曳到編號的配線區，放開就開始拉線。紅色虛線是電力線槽：不要跟它平行走（垂直穿過沒關係）。'
        : V.tool === 'place' ? '點擊平面圖放置 AP（天花板安裝，不能裝在牆上或核心筒）' : '點選 AP 查看詳情，拖曳可移動位置');
      left.appendChild(h('div', { class: 'plan-wrap' }, tools, V.canvas, V.tip, legend()));
      bindCanvas();
      requestAnimationFrame(() => V.draw());
      V.ro = new ResizeObserver(() => V.draw());
      V.ro.observe(V.canvas);
    }
    V.renderSide();
  };
  /** 3D 樓層：同一層樓重繪時沿用同一個場景（不重建 WebGL、不重設視角） */
  function floor3d() {
    if (V.m3d && V.m3d.fid === V.fid && !V.m3d.el.m3dDead) { V.m3d.el.m3dStage.poke(); return V.m3d.el; }
    const el = G.M3.floor({
      fid: V.fid,
      height: window.innerWidth < 760 ? '420px' : 'clamp(440px, 62vh, 640px)',
      sel: () => ({ ap: V.selAp, tool: V.tool, layer: V.layer, apModel: V.apModel }),
      onAp: (id) => { V.selAp = id; V.renderSide(); },
      onPlace: (x, y) => { const r = UI.res(G.Act.placeAp(V.fid, x, y, V.apModel)); if (r.ok) V.selAp = r.id; },
      onInc: () => UI.go('inc'),
    });
    V.m3d = { fid: V.fid, el };
    return el;
  }
  V.unmount = () => { if (V.ro) { V.ro.disconnect(); V.ro = null; } };

  function legend() {
    if (V.layer === 'rssi') return h('div', { class: 'legend' }, [['rgba(70,209,127,0.8)', '≥ −60 極佳'], ['rgba(160,214,80,0.8)', '≥ −67 良好（語音 / 視訊）'], ['rgba(240,190,58,0.8)', '≥ −72 普通'], ['rgba(240,130,58,0.8)', '≥ −75 偏弱'], ['rgba(242,80,80,0.8)', '≥ −78 很弱'], ['rgba(110,120,130,0.6)', '無法連線']].map(([c, t]) => h('span', {}, h('i', { style: { background: c } }), t)));
    if (V.layer === 'load') return h('div', { class: 'legend' }, [['rgba(70,209,127,0.8)', 'AP 負載 < 70%'], ['rgba(240,166,58,0.8)', '70～100%'], ['rgba(242,95,92,0.8)', '超載']].map(([c, t]) => h('span', {}, h('i', { style: { background: c } }), t)), h('span', { class: 'dim' }, '（依目前在座人數計算）'));
    if (V.layer === 'cci') return h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--bad)' } }), '紅色虛線：兩台 AP 使用相同頻道且互相聽得到（同頻干擾）'));
    if (G.BLD.isFab(V.fid)) return h('div', { class: 'legend' }, Object.values(CAT.fab.areas).map((a) => h('span', {}, h('i', { style: { background: a.color } }), a.name)),
      h('span', { class: 'dim' }, '外框：綠 = 自動化生產、橘 = 連不上 EAP、紅 = 停機、虛線 = 還沒接上網路　虛線軌道 = 天車（OHT）　金屬機台與 bay 壁板很擋訊號'));
    return h('div', { class: 'legend' }, h('span', { class: 'dim' }, '灰色格：座位區　深色：核心筒（電梯 / 樓梯，訊號幾乎無法穿透）　藍灰：廁所（磁磚牆與水管）'),
      G.Rest.hasIot(V.fid) ? h('span', {}, h('i', { style: { background: 'var(--ok)' } }), '廁所外框：感測器回報的狀況（綠好 / 橘該補 / 紅很糟）') : null,
      h('span', {}, h('i', { style: { background: 'var(--info)', borderRadius: '50%' } }), '清潔人員'));
  }

  function wifiNow() {
    const up = G.Net.floorUp(V.fid);
    const powered = G.Wifi.powered(V.fid, up);
    return { wr: G.Wifi.get(V.fid, powered), powered };
  }
  /** 規劃用的預測覆蓋：所有已放置的 AP（不論是否已供電） */
  function wifiPlan() {
    return G.Wifi.get(V.fid, new Set(G.S.floors[V.fid].aps.map((a) => a.id)));
  }

  V.draw = () => {
    const cv = V.canvas;
    if (!cv || !cv.isConnected) return;
    const s = G.S, f = G.BLD.byId[V.fid], fs = s.floors[V.fid];
    const L = G.Layout.get(f.type);
    const { ctx, w } = G.Charts.setup(cv);
    const cs = w / L.W;
    const tk = U.tokens();
    const { powered } = wifiNow();
    const wr = wifiPlan();
    const st = G.R.sim && G.R.sim.floors[V.fid];
    const col = {};
    col[T.OPEN] = tk.floor; col[T.DESK] = tk.desk; col[T.MEET] = tk.room; col[T.OFFICE] = tk.room; col[T.LAB] = tk.room; col[T.CAFE] = tk.room; col[T.LOBBY] = tk.floor;
    col[T.CORE] = tk.core; col[T.IDF] = tk.core; col[T.WALL] = tk.wall; col[T.GLASS] = tk.glass; col[T.EXT] = tk.line2;
    col[T.KITCHEN] = tk.kitchen; col[T.SERVE] = tk.serve; col[T.DINE] = tk.dine; col[T.COLD] = tk.cold;
    col[T.RAMP] = tk.ramp; col[T.PARK] = tk.park; col[T.MOTO] = tk.moto; col[T.PILLAR] = tk.pillar; col[T.WC] = tk.wc;
    col[T.CR] = tk.bg2; col[T.TOOL] = tk.bg4; col[T.STOCK] = tk.core;
    for (let y = 0; y < L.H; y++) {
      for (let x = 0; x < L.W; x++) {
        const t = L.type[y * L.W + x];
        ctx.fillStyle = col[t] || tk.floor;
        ctx.fillRect(x * cs, y * cs, cs + 0.6, cs + 0.6);
        if (t === T.DESK && cs >= 6) { ctx.fillStyle = tk.bg3; ctx.fillRect(x * cs + cs * 0.18, y * cs + cs * 0.22, cs * 0.64, cs * 0.5); }
        /* 用餐區：每 3 × 3 格一張桌子 */
        if (t === T.DINE && cs >= 5 && x % 3 === 1 && y % 3 === 1) { ctx.fillStyle = tk.serve; ctx.fillRect(x * cs - cs * 0.3, y * cs + cs * 0.1, cs * 1.6, cs * 0.8); }
        /* 機車格：一台台機車 */
        if (t === T.MOTO && cs >= 5) { ctx.fillStyle = tk.text3; ctx.fillRect(x * cs + cs * 0.32, y * cs + cs * 0.1, cs * 0.36, cs * 0.8); }
      }
    }
    /* 停車場：停車格的白線、車道箭頭、柵欄機、充電樁 */
    if (L.spaces) drawParking(ctx, L, cs, tk);
    if ((V.layer === 'rssi' || V.layer === 'load') && V.tool !== 'cable') {
      for (let y = 0; y < L.H; y++) {
        for (let x = 0; x < L.W; x++) {
          const i = y * L.W + x;
          const t = L.type[i];
          if (t === T.WALL || t === T.GLASS || t === T.CORE || t === T.IDF || t === T.EXT || t === T.WC || t === T.TOOL || t === T.STOCK) continue;
          const r = wr.best[i];
          if (V.layer === 'rssi') ctx.fillStyle = heat(r);
          else {
            if (r < G.Wifi.TH.assoc || wr.bestIdx[i] < 0) continue;
            const apId = wr.apIds[wr.bestIdx[i]];
            const as = st && st.apStats[apId];
            ctx.fillStyle = loadCol(as ? as.load : 0);
          }
          ctx.fillRect(x * cs, y * cs, cs + 0.6, cs + 0.6);
        }
      }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(9, Math.min(12, cs * 0.95))}px ${tk.sans}`;
    ctx.fillStyle = tk.text3;
    if (cs >= 5) {
      for (const r of L.rooms) {
        const wpx = (r.x1 - r.x0) * cs;
        if (wpx < 40 || r.wc) continue;
        /* 核心筒的字放在廁所與 IDF 中間那一排 */
        ctx.fillText(r.label, ((r.x0 + r.x1 + 1) / 2) * cs, r.kind === T.CORE ? 18.5 * cs : ((r.y0 + r.y1 + 1) / 2) * cs);
      }
    }
    drawWc(ctx, L, cs, tk);
    if (L.tools) drawFab(ctx, L, cs, tk);
    ctx.fillStyle = tk.accent;
    ctx.font = `bold ${Math.max(9, cs * 0.9)}px ${tk.mono}`;
    ctx.fillText('IDF', (L.idf.x + 0.5) * cs, (L.idf.y + 0.5) * cs);
    const apPos = {};
    for (const a of fs.aps) apPos[a.id] = a;
    if (V.layer === 'cci') {
      ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = tk.bad;
      for (const [p, q] of wr.conflicts) {
        const A = apPos[p], B = apPos[q];
        if (!A || !B) continue;
        ctx.beginPath(); ctx.moveTo((A.x + 0.5) * cs, (A.y + 0.5) * cs); ctx.lineTo((B.x + 0.5) * cs, (B.y + 0.5) * cs); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const R = Math.max(5, cs * 1.05);
    for (const a of fs.aps) {
      let ax = a.x, ay = a.y;
      if (V.drag && V.drag.id === a.id) { ax = V.drag.x; ay = V.drag.y; }
      const px = (ax + 0.5) * cs, py = (ay + 0.5) * cs;
      const pw = powered.has(a.id);
      const as = st && st.apStats[a.id];
      const load = as ? as.load : 0;
      ctx.beginPath(); ctx.arc(px, py, R + 2, 0, Math.PI * 2); ctx.fillStyle = tk.bg; ctx.fill();
      ctx.beginPath(); ctx.arc(px, py, R, 0, Math.PI * 2);
      ctx.fillStyle = !pw ? tk.bg4 : load >= 1 ? tk.bad : load >= 0.7 ? tk.warn : tk.ok;
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = pw ? tk.bg : tk.text3; ctx.stroke();
      ctx.strokeStyle = pw ? tk.bg : tk.text3; ctx.lineWidth = Math.max(1, R * 0.16);
      for (let k = 1; k <= 2; k++) { ctx.beginPath(); ctx.arc(px, py + R * 0.35, R * 0.28 * k, -Math.PI * 0.8, -Math.PI * 0.2); ctx.stroke(); }
      if (V.selAp === a.id) { ctx.beginPath(); ctx.arc(px, py, R + 4, 0, Math.PI * 2); ctx.strokeStyle = tk.accent; ctx.lineWidth = 2.5; ctx.stroke(); }
      if (cs >= 6) {
        ctx.font = `600 ${Math.max(9, cs * 0.85)}px ${tk.mono}`;
        ctx.fillStyle = tk.text;
        ctx.fillText(a.ch, px, py - R - Math.max(6, cs * 0.6));
      }
    }
    if (V.tool === 'place' && V.hover && G.Layout.canPlaceAp(L, V.hover.x, V.hover.y)) {
      ctx.beginPath(); ctx.arc((V.hover.x + 0.5) * cs, (V.hover.y + 0.5) * cs, R, 0, Math.PI * 2);
      ctx.strokeStyle = tk.accent; ctx.setLineDash([3, 3]); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
    if (V.tool === 'cable') drawDiy(ctx, L, cs, tk);
  };

  /* ---------- 晶圓廠：機台（顏色 = 製程區；外框 = 狀態）、天花板上的天車（OHT）軌道 ---------- */
  function fabStroke(i, tk) {
    const F = G.S.fab, x = F && F.tools[i];
    if (!x || x.st === 'coming') return { c: tk.text3, dash: [2, 3], a: 0.25 };
    if (x.down) return { c: tk.bad, a: 1 };
    if (x.st === 'online') { const inf = G.Fab.info(i); return inf.run ? { c: inf.eapOk ? tk.ok : tk.warn, a: 1 } : { c: tk.bad, a: 1 }; }
    if (x.st === 'install') return { c: tk.info, dash: [3, 2], a: 0.7 };
    return { c: tk.accent, dash: [4, 2], a: 0.85 };
  }
  function drawFab(ctx, L, cs, tk) {
    ctx.save();
    /* 天車軌道 */
    ctx.strokeStyle = G.Charts.withAlpha(tk.text2, 0.45);
    ctx.lineWidth = Math.max(1, cs * 0.18);
    ctx.setLineDash([cs * 0.6, cs * 0.4]);
    for (const r of L.oht) { ctx.beginPath(); ctx.moveTo(r.x0 * cs, r.y0 * cs); ctx.lineTo(r.x1 * cs, r.y1 * cs); ctx.stroke(); }
    ctx.setLineDash([]);
    /* 機台 */
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const t of L.tools) {
      const def = CAT.fab.types[t.type], area = CAT.fab.areas[def.area];
      const x0 = t.x0 * cs, y0 = t.y0 * cs, w = (t.x1 - t.x0 + 1) * cs, hh = (t.y1 - t.y0 + 1) * cs;
      const st = fabStroke(t.i, tk);
      ctx.globalAlpha = st.a;
      ctx.fillStyle = G.Charts.withAlpha(area.color, 0.5);
      ctx.fillRect(x0 + 1, y0 + 1, w - 2, hh - 2);
      ctx.strokeStyle = st.c; ctx.lineWidth = Math.max(1.2, cs * 0.18); ctx.setLineDash(st.dash || []);
      ctx.strokeRect(x0 + 1.5, y0 + 1.5, w - 3, hh - 3);
      ctx.setLineDash([]);
      if (cs >= 7) {
        const [ca, cb] = G.Fab.code(t.i).split('-');
        ctx.fillStyle = tk.text; ctx.font = `600 ${Math.max(7, Math.min(10, cs * 0.7))}px ${tk.mono}`;
        ctx.fillText(ca, x0 + w / 2, y0 + hh / 2 - cs * 0.42);
        ctx.fillText(cb, x0 + w / 2, y0 + hh / 2 + cs * 0.42);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ---------- 廁所：男 / 女 / 無障礙的標示；有智慧廁所時外框顏色＝狀況（綠好、橘要補、紅很糟），清潔人員是門口的小圓點 ---------- */
  function drawWc(ctx, L, cs, tk) {
    if (!L.wc) return;
    const fid = V.fid, ok = G.Rest.iotOk(fid), crew = G.Rest.crewAt(fid), t = G.S.time;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const w of L.wc) {
      const r = G.Rest.room(fid, w.k);
      const x0 = w.x0 * cs, y0 = w.y0 * cs, ww = (w.x1 - w.x0 + 1) * cs, hh = (w.y1 - w.y0 + 1) * cs;
      const cx = x0 + ww / 2, cy = y0 + hh / 2;
      ctx.fillStyle = tk.text2;
      ctx.font = `700 ${Math.max(9, Math.min(15, cs * 1.3))}px ${tk.sans}`;
      ctx.fillText(w.k === 'M' ? '男' : w.k === 'F' ? '女' : '♿', cx, cy - (cs >= 8 && w.k !== 'A' ? cs * 0.45 : 0));
      if (cs >= 8 && w.k !== 'A') { ctx.font = `${Math.max(8, cs * 0.75)}px ${tk.sans}`; ctx.fillStyle = tk.text3; ctx.fillText('廁所', cx, cy + cs * 0.75); }
      /* 狀況外框：只有感測器連得到平台時才知道 */
      if (ok) {
        const q = G.Rest.roomQ(r), n = G.Rest.need(r);
        ctx.strokeStyle = r.leak || r.clog || q < 0.7 ? tk.bad : n >= 200 ? tk.warn : tk.ok;
        ctx.lineWidth = Math.max(1.5, cs * 0.22);
        ctx.strokeRect(x0 + 1.5, y0 + 1.5, ww - 3, hh - 3);
        if (r.leak && cs >= 5) { ctx.font = `${Math.max(9, cs * 1.1)}px ${tk.sans}`; ctx.fillText('💧', x0 + ww - cs * 0.7, y0 + cs * 0.7); }
      } else if (G.Rest.hasIot(fid)) {
        ctx.strokeStyle = tk.text3; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeRect(x0 + 1.5, y0 + 1.5, ww - 3, hh - 3); ctx.setLineDash([]);
      }
      /* 清潔人員（在門口推清潔車 / 在裡面打掃） */
      const c = crew.find((q) => q.k === w.k);
      if (c) {
        const inside = t >= c.start;
        const px = inside ? x0 + ww - cs * 0.75 : (w.door[0] + 0.5) * cs, py = inside ? y0 + hh - cs * 0.75 : (w.door[1] + 0.5) * cs;
        ctx.beginPath(); ctx.arc(px, py, Math.max(3, cs * 0.45), 0, Math.PI * 2);
        ctx.fillStyle = tk.info; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = tk.bg; ctx.stroke();
      }
    }
    /* IoT 閘道器：IDF 裡的小方塊（綠：連得到平台） */
    if (G.Rest.hasIot(fid)) {
      const gx = (L.idf.x - 0.5) * cs, gy = (L.idf.y + 1.5) * cs;
      ctx.fillStyle = ok ? tk.ok : tk.bad;
      ctx.fillRect(gx - cs * 0.3, gy - cs * 0.3, cs * 0.6, cs * 0.6);
      if (cs >= 7) { ctx.font = `600 ${Math.max(8, cs * 0.7)}px ${tk.mono}`; ctx.fillStyle = tk.text2; ctx.textAlign = 'left'; ctx.fillText('IoT', gx + cs * 0.5, gy); }
    }
    ctx.restore();
  }

  /* ---------- 自己布線：配線區、電力線槽、已畫好的走線、正在畫的路徑 ---------- */
  function drawDiy(ctx, L, cs, tk) {
    const job = G.Diy.job(V.fid);
    if (!job) return;
    const f = G.BLD.byId[V.fid], zs = G.Diy.zones(f.type), drops = G.Diy.drops(V.fid), t = G.S.time;
    ctx.save();
    const py = (G.Diy.POWER_Y + 0.5) * cs;
    ctx.strokeStyle = tk.bad; ctx.lineWidth = Math.max(2, cs * 0.35); ctx.setLineDash([cs * 1.2, cs * 0.7]);
    ctx.beginPath(); ctx.moveTo(cs, py); ctx.lineTo(28 * cs, py); ctx.moveTo(44 * cs, py); ctx.lineTo(71 * cs, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = tk.bad; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = `600 ${Math.max(9, cs * 0.85)}px ${tk.sans}`;
    ctx.fillText('電力線槽（220V）', 1.5 * cs, py - cs * 0.5);
    const resOf = (zid) => (job.results ? job.results.find((r) => r.zid === zid) : null);
    const line = (path, col, w, dash) => {
      ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.lineJoin = 'round';
      ctx.beginPath(); path.forEach(([x, y], i) => { const X = (x + 0.5) * cs, Y = (y + 0.5) * cs; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }); ctx.stroke();
      ctx.setLineDash([]);
    };
    for (const z of zs) {
      const zr = job.zones[z.id], res = resOf(z.id);
      const col = res ? (res.pass ? tk.ok : tk.bad) : zr.path ? (t >= zr.pullAt ? tk.accent : tk.info) : tk.warn;
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect(z.x0 * cs + 2, z.y0 * cs + 2, (z.x1 - z.x0 + 1) * cs - 4, (z.y1 - z.y0 + 1) * cs - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `700 ${Math.max(9, cs * 0.95)}px ${tk.sans}`;
      ctx.fillText(`配線區 ${z.n} · ${drops[z.id]} 點${res ? (res.pass ? ' ✓ PASS' : ' ✗ FAIL') : zr.path ? (t >= zr.pullAt ? ' ✓ 已拉好' : ' 拉線中') : ''}`, z.x0 * cs + 5, z.y0 * cs + 5);
      ctx.beginPath(); ctx.arc((z.tx + 0.5) * cs, (z.ty + 0.5) * cs, Math.max(4, cs * 0.6), 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    }
    for (const z of zs) {
      const zr = job.zones[z.id], res = resOf(z.id);
      if (!zr.path) continue;
      const bad = res ? !res.pass : zr.emi >= 5 || zr.len > 90;
      line(zr.path, bad ? tk.bad : t >= zr.pullAt ? tk.accent : tk.info, Math.max(2, cs * 0.32), t >= zr.pullAt ? null : [cs * 0.6, cs * 0.4]);
    }
    if (V.cdrag) line(V.cdrag.path, tk.warn, Math.max(3, cs * 0.42));
    ctx.beginPath(); ctx.arc((L.idf.x + 0.5) * cs, (L.idf.y + 0.5) * cs, Math.max(7, cs * 1.5), 0, Math.PI * 2);
    ctx.strokeStyle = tk.ok; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  }
  /* 拖曳畫線：從 IDF 開始，游標經過的格子依序加進路徑（往回拖可以收回），放開時落在哪個配線區就拉到那裡 */
  function cableDown(e) {
    const L = G.Layout.get(G.BLD.byId[V.fid].type), c = cellAt(e);
    if (Math.abs(c.x - L.idf.x) > 2 || Math.abs(c.y - L.idf.y) > 2) { V.tip.textContent = '要從 IDF（綠色圓圈）開始拖曳：每條線都是從 IDF 的配線架拉出去的。'; return; }
    V.cdrag = { path: [[L.idf.x, L.idf.y]] };
    try { V.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    V.draw();
  }
  function cableMove(e) {
    const f = G.BLD.byId[V.fid], L = G.Layout.get(f.type), c = cellAt(e), P = V.cdrag.path;
    const last = P[P.length - 1];
    if (c.x === last[0] && c.y === last[1]) return;
    const k = P.findIndex((p) => p[0] === c.x && p[1] === c.y);
    if (k >= 0) P.length = k + 1;
    else {
      /* 游標經過的格子：相鄰就直接接上；跳太快或擋到核心筒時，自動沿著可以走線的格子補上最短的一段 */
      const avoid = new Set(P.map((p) => p[1] * L.W + p[0]));
      const seg = G.Diy.bridge(L, last, [c.x, c.y], avoid);
      if (seg) for (const q of seg) P.push(q);
    }
    const end = P[P.length - 1], et = L.type[end[1] * L.W + end[0]];
    const z = et === L.T.CORE || et === L.T.IDF || et === L.T.WC ? null : G.Diy.zones(f.type).find((q) => end[0] >= q.x0 && end[0] <= q.x1 && end[1] >= q.y0 && end[1] <= q.y1);
    const a = G.Diy.analyze(V.fid, z ? z.id : null, P);
    V.tip.textContent = `路徑 ${P.length - 1} m${z ? ` → 配線區 ${z.n}（最遠的插座約 ${a.len} m${a.lenOk ? '' : '，超過 90 m！'}）` : ''}${a.emi ? `　與電力線槽平行 ${a.emi} m${a.emiOk ? '' : ' ⚠ 會有串音干擾'}` : ''}`;
    V.draw();
  }
  function cableUp() {
    const P = V.cdrag.path;
    V.cdrag = null;
    const zs = G.Diy.zones(G.BLD.byId[V.fid].type), end = P[P.length - 1];
    const z = zs.find((q) => end[0] >= q.x0 && end[0] <= q.x1 && end[1] >= q.y0 && end[1] <= q.y1);
    if (!z || P.length < 2) { V.draw(); V.tip.textContent = '要拖曳到某一個配線區（虛線框）裡才算數。'; return; }
    UI.res(G.Diy.setRoute(V.fid, z.id, P));
  }

  /** 停車場的標線：停車格白線、充電位、車道方向、柵欄機與車牌辨識攝影機 */
  function drawParking(ctx, L, cs, tk) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = U.isDark() ? 'rgba(235,240,243,0.5)' : 'rgba(40,52,60,0.45)';
    ctx.lineWidth = Math.max(1, cs * 0.08);
    for (const sp of L.spaces) {
      const x0 = sp.x0 * cs, x1 = (sp.x1 + 1) * cs, y0 = sp.y0 * cs, y1 = (sp.y1 + 1) * cs;
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1);
      const yb = sp.dir === 'N' ? y0 : y1;
      ctx.moveTo(x0, yb); ctx.lineTo(x1, yb);
      ctx.stroke();
      if (sp.ev && cs >= 5) { ctx.fillStyle = tk.ok; ctx.font = `bold ${Math.max(8, cs * 1.1)}px ${tk.sans}`; ctx.fillText('⚡', (x0 + x1) / 2, (y0 + y1) / 2); }
    }
    ctx.fillStyle = tk.text3;
    ctx.font = `bold ${Math.max(8, cs * 1.1)}px ${tk.sans}`;
    for (let x = 3; x <= 11; x += 4) { ctx.fillText('→', (x + 0.5) * cs, 2.5 * cs); ctx.fillText('←', (x + 0.5) * cs, 4.5 * cs); }
    for (const g of L.gates) {
      const gx = (g.x + 0.5) * cs, gy = (g.y + 0.5) * cs;
      ctx.strokeStyle = tk.warn; ctx.lineWidth = Math.max(2, cs * 0.28);
      ctx.beginPath(); ctx.moveTo(gx, gy - cs * 0.95); ctx.lineTo(gx, gy + cs * 0.95); ctx.stroke();
      ctx.fillStyle = tk.accent;
      ctx.beginPath(); ctx.arc(gx + cs * 0.85, gy - cs * 0.85, Math.max(2, cs * 0.32), 0, Math.PI * 2); ctx.fill();
    }
    if (cs >= 6) { ctx.fillStyle = tk.warn; ctx.font = `600 ${Math.max(8, cs * 0.8)}px ${tk.sans}`; ctx.fillText('柵欄機', (L.gates[0].x + 0.5) * cs, 0.5 * cs + 1); }
    ctx.restore();
  }

  function cellAt(e) {
    const f = G.BLD.byId[V.fid];
    const L = G.Layout.get(f.type);
    const r = V.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * L.W);
    const y = Math.floor(((e.clientY - r.top) / r.height) * L.H);
    return { x: U.clamp(x, 0, L.W - 1), y: U.clamp(y, 0, L.H - 1) };
  }
  function nearestAp(x, y, maxD) {
    let best = null, bd = maxD;
    for (const a of G.S.floors[V.fid].aps) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= bd) { bd = d; best = a; }
    }
    return best;
  }
  function bindCanvas() {
    const cv = V.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (V.tool === 'cable') { cableDown(e); return; }
      const c = cellAt(e);
      if (V.tool === 'place') {
        const r = G.Act.placeAp(V.fid, c.x, c.y, V.apModel);
        UI.res(r);
        if (r.ok) V.selAp = r.id;
        return;
      }
      const ap = nearestAp(c.x, c.y, 1.8);
      if (ap) {
        V.selAp = ap.id;
        V.drag = { id: ap.id, x: ap.x, y: ap.y, moved: false };
        try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else V.selAp = null;
      V.draw();
      V.renderSide();
    });
    cv.addEventListener('pointermove', (e) => {
      if (V.cdrag) { cableMove(e); return; }
      if (V.tool === 'cable') { V.hover = cellAt(e); return; }
      const c = cellAt(e);
      V.hover = c;
      if (V.drag) {
        if (c.x !== V.drag.x || c.y !== V.drag.y) { V.drag.x = c.x; V.drag.y = c.y; V.drag.moved = true; V.draw(); }
      } else if (V.tool === 'place') V.draw();
      const f = G.BLD.byId[V.fid];
      const L = G.Layout.get(f.type);
      const wr = wifiPlan();
      const i = c.y * L.W + c.x;
      const r = wr.best[i];
      /* 晶圓廠：滑過機台顯示名稱與狀態 */
      const tool = L.tools && (L.type[i] === T.TOOL || L.type[i] === T.STOCK) ? L.tools.find((q) => c.x >= q.x0 && c.x <= q.x1 && c.y >= q.y0 && c.y <= q.y1) : null;
      if (tool && G.S.fab && G.S.fab.tools[tool.i]) { const inf = G.Fab.info(tool.i); V.tip.textContent = `${inf.name}（${inf.area}）　${inf.status}　${inf.def.ports} 埠 · FDC ${inf.def.fdc} Mbps`; return; }
      const wc = L.type[i] === T.WC && L.wc ? L.wc.find((q) => c.x >= q.x0 && c.x <= q.x1 && c.y >= q.y0 && c.y <= q.y1) : null;
      V.tip.textContent = `(${c.x}, ${c.y}) m　${wc ? wc.name + '　' : ''}${r > -110 ? `訊號 ${r.toFixed(0)} dBm` : '沒有訊號'}${wc ? '（廁所裡不裝 AP，靠走道的 AP 蓋進來）' : ''}`;
    });
    const end = () => {
      if (V.cdrag) { cableUp(); return; }
      if (V.drag) {
        const d = V.drag;
        V.drag = null;
        if (d.moved) { const ap = G.S.floors[V.fid].aps.find((a) => a.id === d.id); if (ap && (ap.x !== d.x || ap.y !== d.y)) UI.res(G.Act.moveAp(V.fid, d.id, d.x, d.y)); else V.draw(); }
      }
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { V.hover = null; if (V.tool === 'place') V.draw(); });
  }

  /* ---------- 右側面板 ---------- */
  function live(fn, cls) {
    const el = h('span', { class: cls || '' }, '');
    V.live.push({ el, fn });
    try { el.textContent = fn(); } catch (e) { el.textContent = '—'; }
    return el;
  }
  V.renderSide = () => {
    const s = G.S, f = G.BLD.byId[V.fid], fs = s.floors[V.fid], ft = G.FT[f.type];
    const R = V.right;
    V.live = [];
    U.clear(R);
    const st = () => (G.R.sim && G.R.sim.floors[V.fid]) || null;

    /* 樓層狀態 */
    R.appendChild(h('div', { class: 'card' },
      h('div', { class: 'card-h' }, h('h3', {}, '樓層狀態'), h('span', { class: 'chip ' + G.Views.building.floorStatus(V.fid).c }, G.Views.building.floorStatus(V.fid).t)),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, ft.dine ? '餐廳人員（進駐 / 編制）' : ft.park ? '管理員（到職 / 編制）' : ft.fab ? '操作員與工程師（到職 / 編制）' : '已進駐 / 編制'), h('span', { class: 'v mono' }, `${U.num(fs.movedIn)} / ${U.num(f.staff)}`),
        h('span', { class: 'k' }, ft.dine ? '用餐人數' : ft.park ? '停車場人潮' : ft.fab ? '現場人員（兩班制）' : '目前在座'), h('span', { class: 'v mono' }, live(() => { const x = st(); if (!x) return '—'; if (ft.dine) return `${U.num(Math.round(x.diners || 0))} 人（尖峰約 ${U.num(ft.diners)}）`; if (ft.park) return `${U.num(Math.round(x.parkers || 0))} 人（上班尖峰約 ${U.num(ft.parkPeak)}）`; return U.num(Math.round(x.present)) + ' 人' + (x.guests > 1 ? `＋訪客 ${Math.round(x.guests)}` : ''); })),
        ft.park ? h('span', { class: 'k' }, '手機打卡成功率') : null, ft.park ? h('span', { class: 'v mono' }, live(() => { const x = st(); if (!x || !fs.movedIn) return '—'; if (!x.up) return '0%（整層沒有網路）'; return `${U.pct(x.clockOk)}${x.parkers > 5 ? '' : '（離峰）'}`; })) : null,
        ft.gates ? h('span', { class: 'k' }, '柵欄機 / 車牌辨識') : null, ft.gates ? h('span', { class: 'v mono' }, live(() => { const x = st(); return !x ? '—' : x.gateOk ? '連線中' : '連不上系統'; })) : null,
        ft.cams ? h('span', { class: 'k' }, `監視器（${ft.cams} 台）`) : null, ft.cams ? h('span', { class: 'v mono' }, live(() => { const x = st(); return !x ? '—' : `${Math.round((x.camOk || 0) * ft.cams)} / ${ft.cams} 台有畫面`; })) : null,
        ft.dine ? h('span', { class: 'k' }, '用餐 Wi-Fi 容量') : null, ft.dine ? h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.diners > 5 ? U.pct(x.dinerRatio) : '—（非用餐時間）'; })) : null,
        ft.pos ? h('span', { class: 'k' }, `收銀 POS（${ft.pos} 台）`) : null, ft.pos ? h('span', { class: 'v mono' }, live(() => { const x = st(); return !x || !fs.movedIn ? '—' : x.posOk ? '可刷卡' : '無法連線'; })) : null,
        /* 晶圓廠：看機台連網、自動化與產能，不看員工的上網體驗 */
        ...(ft.fab ? [
          h('span', { class: 'k' }, '機台連網 / 自動化'), h('span', { class: 'v mono' }, live(() => { const R = G.R.fab; const c = G.Fab.counts(); return R ? `${c.online} / ${R.total} 台 · 自動化 ${R.auto}` : `${c.online} 台`; })),
          h('span', { class: 'k' }, '產能'), h('span', { class: 'v mono' }, live(() => { const R = G.R.fab; return R ? `${U.num(Math.round(R.rate))} 片 / 日${R.itStop ? '（' + R.itStop + '）' : ''}` : '—'; })),
          h('span', { class: 'k' }, '手持裝置 Wi-Fi'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.wifi ? `可用覆蓋 ${U.pct(x.wifi.usable || 0)}` : '—'; })),
        ] : [
          h('span', { class: 'k' }, '可連線比例'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.conn) : '—'; })),
          h('span', { class: 'k' }, '頻寬滿足率'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.thr) : '—'; })),
          h('span', { class: 'k' }, '延遲'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? `${x.lat.toFixed(1)} ms` : '—'; })),
          h('span', { class: 'k' }, '滿意度'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.sat !== null && x.present > 1 ? U.pct(x.sat) : '—'; })),
        ]))));

    /* ① 水平布線 */
    const cab = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '① 水平布線'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-mdf') }, '什麼是水平布線？')));
    if (fs.cabling.status === 'none') {
      const drops = G.Act.floorDrops(V.fid);
      const seg = h('div', { class: 'seg' }, Object.entries(CAT.horizontal).map(([k, hz]) => h('button', { class: V.cabStd === k ? 'on' : '', onclick: () => { V.cabStd = k; V.renderSide(); } }, hz.name)));
      const hz = CAT.horizontal[V.cabStd];
      const diyCost = G.Diy.cost(V.fid, V.cabStd);
      cab.append(seg,
        h('p', { class: 'small muted', style: { margin: '8px 0' } }, hz.desc),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '資訊點'), h('span', { class: 'v mono' }, ft.fab ? `${drops} 個（機台 ${G.Fab.portsTotal()} 埠 + 控制室 MES 終端機 + 印表機 + 40 個 AP 點）` : `${drops} 個（座位 + 印表機 + 40 個 AP 點${ft.gates ? ' + 車道設備與監視器' : ft.pos ? ' + 收銀機' : ''}）`)),
        ft.fab ? h('div', { class: 'col', style: { marginTop: '10px', gap: '4px' } },
          h('span', { class: 'tiny muted' }, `${U.money(drops * hz.perDrop)} · 約 ${U.dur(hz.buildMin)}`),
          h('span', { class: 'tiny dim' }, '無塵室裡施工要穿無塵衣、申請施工許可，由合格的無塵室工程廠商在架高地板下走線：只能發包。'),
          h('button', { class: 'btn primary sm', style: { alignSelf: 'flex-start' }, 'data-hint': 'cabling@' + V.fid, onclick: () => UI.res(G.Act.startCabling(V.fid, V.cabStd)) }, '發包施工')) :
        h('div', { class: 'grid c2', style: { marginTop: '10px', gap: '8px' } },
          h('div', { class: 'col', style: { gap: '4px' } },
            h('b', { class: 'small' }, '發包施工'),
            h('span', { class: 'tiny muted' }, `${U.money(drops * hz.perDrop)} · 約 ${U.dur(hz.buildMin)}`),
            h('span', { class: 'tiny dim' }, '廠商負責拉線、打線、測試，等完工就好'),
            h('button', { class: 'btn primary sm', 'data-hint': 'cabling@' + V.fid, onclick: () => UI.res(G.Act.startCabling(V.fid, V.cabStd)) }, '發包施工')),
          h('div', { class: 'col', style: { gap: '4px' } },
            h('b', { class: 'small' }, '自己布線'),
            h('span', { class: 'tiny muted' }, `${U.money(diyCost)}${G.Diy.kitOwned() ? '（材料費）' : `（含工具組 ${U.money(CAT.diyKit)}）`}`),
            h('span', { class: 'tiny dim' }, '自己畫走線路徑、依色序打線、用測試儀驗證'),
            h('button', { class: 'btn sm', 'data-hint': 'cabling-diy@' + V.fid, onclick: () => { const r = UI.res(G.Diy.start(V.fid, V.cabStd)); if (r.ok) { V.tool = 'cable'; V.diyFloor = V.fid; if (UI.pref3d('floor')) UI.pref3d('floor', false); UI.refresh(); } } }, '自己布線'))));
    } else if (fs.cabling.status === 'diy') {
      diyPanel(cab);
    } else if (fs.cabling.status === 'building') {
      const tot = CAT.horizontal[fs.cabling.std].buildMin;
      cab.append(h('div', { class: 'row between small' }, h('span', {}, `${CAT.horizontal[fs.cabling.std].name} 施工中`), live(() => `剩 ${U.dur(fs.cabling.readyAt - G.S.time)}`, 'mono')),
        h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: U.clamp(100 - ((fs.cabling.readyAt - s.time) / tot) * 100, 0, 100) + '%' } })));
    } else cab.appendChild(h('div', { class: 'note ok' }, `✓ ${CAT.horizontal[fs.cabling.std].name}完成（${G.Act.floorDrops(V.fid)} 個資訊點${fs.cabling.self ? '，自己布線、全部通過認證測試' : ''}）`));
    R.appendChild(cab);

    /* ② IDF 接入交換器 */
    const need = Q.floorPortNeed(V.fid);
    const stg = V.stage;
    const am = CAT.access[stg.model];
    const portsAvail = stg.count * am.ports;
    const poe = Q.floorPoe(V.fid);
    const budget = stg.count * am.poe;
    const delta = G.Act.accessCost(V.fid, stg.model, stg.count);
    const changed = stg.model !== fs.idf.model || stg.count !== fs.idf.count;
    const idf = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '② IDF 接入交換器'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-poe') }, 'PoE 是什麼？')),
      h('select', { id: 'acc-model', onchange: (e) => { stg.model = e.target.value; V.renderSide(); } },
        Object.entries(CAT.access).map(([id, m]) => h('option', { value: id, selected: id === stg.model || null, disabled: !Q.unlocked(m) || null }, `${m.name} · ${U.money(m.price)}${Q.unlocked(m) ? '' : '（第 ' + m.unlock + ' 章）'}`))),
      h('div', { class: 'row between small muted', style: { alignItems: 'flex-start' } }, h('span', {}, am.desc), G.M3 ? h('button', { class: 'btn xs', onclick: () => G.M3.open([stg.model], am.name) }, '3D 外觀') : null),
      h('div', { class: 'row between' },
        h('div', { class: 'stepper' },
          h('button', { onclick: () => { stg.count = Math.max(0, stg.count - 1); V.renderSide(); }, 'aria-label': '減少' }, '−'),
          h('span', { class: 'n' }, String(stg.count)),
          h('button', { onclick: () => { stg.count = Math.min(16, stg.count + 1); V.renderSide(); }, 'aria-label': '增加' }, '+')),
        h('button', { class: 'btn sm', 'data-hint': 'idf-suggest@' + V.fid, onclick: () => { stg.count = Math.max(1, Math.ceil((need.total - need.aps + Math.max(need.aps, 20)) * 1.1 / am.ports)); V.renderSide(); } }, '建議數量')),
      barRow('埠數', portsAvail, need.total, `座位 ${need.seats} + AP ${need.aps} + 印表機 ${need.printers}${need.pos ? ` + 收銀機 ${need.pos}` : ''}${need.gates ? ` + 柵欄機 / 車牌辨識 ${need.gates}` : ''}${need.cams ? ` + 監視器 ${need.cams}` : ''}${need.iot ? ` + IoT 閘道器 ${need.iot}` : ''}`),
      barRow('PoE', budget, poe.used, [poe.phones ? `IP 電話 ${poe.phones}W` : '', poe.cams ? `監視器 ${poe.cams}W` : '', poe.iot ? `IoT 閘道器 ${poe.iot}W` : '', `AP ${poe.aps}W`].filter(Boolean).join(' + '), 'W'),
      h('div', { class: 'small muted mono' }, `上行埠：${stg.count * am.uplinks} 個（≤${U.speed(am.uplinkMax)}）　AP 上行：${U.bw(Math.min(am.portSpeed, fs.cabling.std ? CAT.horizontal[fs.cabling.std].maxSpeed : 1000))}`),
      changed ? h('button', { class: 'btn primary', 'data-hint': 'idf-apply@' + V.fid, onclick: () => { const r = UI.res(G.Act.setAccess(V.fid, stg.model, stg.count)); if (!r.ok) { V.stage = null; } } }, delta >= 0 ? `套用（${U.money(delta)}）` : `套用（回收 ${U.money(-delta)}）`) : null,
      h('label', { class: 'row small' }, h('input', { type: 'checkbox', id: 'idf-ups', checked: fs.idf.ups, onchange: (e) => UI.res(G.Act.setIdfUps(V.fid, e.target.checked)) }), `IDF 小型 UPS（${U.money(45000)}，停電可撐 30 分鐘）`));
    R.appendChild(idf);

    /* ③ 上行主幹 */
    const links = Q.linksOf('F:' + V.fid);
    const upl = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '③ 上行主幹（到 B1）'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-cable') }, '銅纜 vs 光纖')),
      h('div', { class: 'small muted' }, `經弱電豎井到 B1 約 ${G.BLD.riserLength(V.fid)} m。${G.BLD.riserLength(V.fid) > 100 ? '超過 100m，只能用光纖。' : ''}${G.BLD.riserLength(V.fid) > 100 ? '100G 需用單模光纖 (OS2)。' : ''}`));
    if (!links.length) upl.appendChild(h('div', { class: 'note warn' }, '尚未連到核心交換器，這層樓無法上網。'));
    for (const l of links) {
      const other = Q.other(l, 'F:' + V.fid);
      upl.appendChild(h('div', { class: 'row between small' },
        h('span', {}, '→ ', h('b', {}, Q.nodeName(other)), '　', h('span', { class: 'mono muted' }, UI.linkLabel(l))),
        h('span', { class: 'row' },
          live(() => { if (l.status === 'cut') return '中斷'; if (G.Net.linkBuilding(l)) return `施工 ${U.dur(l.readyAt - G.S.time)}`; const ls = G.R.sim && G.R.sim.links[l.id]; return ls ? U.pct(ls.util) : '—'; }, 'mono'),
          h('button', { class: 'btn xs', onclick: () => UI.linkDialog(l.a, l.b, l.id) }, '編輯'),
          h('button', { class: 'btn xs danger', onclick: () => UI.confirm('拆除上行', `拆除 ${V.fid} → ${Q.nodeName(other)} 的線路？（不退費）`, '拆除', () => UI.res(G.Act.deleteLink(l.id)), 'danger') }, '拆除'))));
    }
    upl.appendChild(h('button', { class: 'btn primary', 'data-hint': 'uplink@' + V.fid, disabled: fs.idf.count === 0 || null, onclick: () => UI.pickTarget('F:' + V.fid, (d) => CAT.devices[d.model].cat === 'switch', `${V.fid} 上行到哪台交換器？`) }, fs.idf.count === 0 ? '先安裝接入交換器' : '新增上行'));
    R.appendChild(upl);

    /* ④ Wi-Fi */
    const { wr, powered } = wifiNow();
    const plan = wifiPlan();
    const partial = powered.size < fs.aps.length;
    const wlc = Q.devices('wlc').some((d) => G.Net.devUp(d));
    const wifi = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '④ Wi-Fi'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-wifi') }, '覆蓋 vs 容量')),
      partial ? h('div', { class: 'note warn small' }, `${fs.aps.length - powered.size} 台 AP 尚未供電（要等布線完工、裝好接入交換器，且 PoE 預算足夠）。平面圖顯示的是預測訊號。`) : null,
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, 'AP（供電中 / 總數）'), h('span', { class: 'v mono ' + (partial ? 'warn-t' : '') }, `${powered.size} / ${fs.aps.length}`),
        h('span', { class: 'k' }, '良好覆蓋（≥ −67 dBm）'), h('span', { class: 'v mono ' + (ft.fab ? '' : plan.good >= 0.9 ? 'ok-t' : 'warn-t') }, partial ? `預測 ${U.pct(plan.good)}・實際 ${U.pct(wr.good)}` : U.pct(wr.good)),
        /* 無塵室：手持裝置查 MES 只要「可用」的訊號（任務看這一項） */
        ft.fab ? h('span', { class: 'k' }, '可用覆蓋（≥ −75 dBm，手持裝置）') : null,
        ft.fab ? h('span', { class: 'v mono ' + (plan.usable >= 0.9 ? 'ok-t' : 'warn-t') }, partial ? `預測 ${U.pct(plan.usable)}・實際 ${U.pct(wr.usable)}` : U.pct(wr.usable)) : null,
        h('span', { class: 'k' }, '可連線（≥ −78 dBm）'), h('span', { class: 'v mono' }, U.pct(partial ? plan.cover : wr.cover)),
        h('span', { class: 'k' }, '同頻干擾'), h('span', { class: 'v mono ' + (plan.conflicts.length ? 'warn-t' : '') }, `${plan.conflicts.length} 組`),
        h('span', { class: 'k' }, '連線裝置'), h('span', { class: 'v mono' }, live(() => { const x = st(); if (!x) return '—'; return U.num(Math.round(U.sum(Object.values(x.apStats), (a) => a.clients))); })),
        h('span', { class: 'k' }, '容量滿足率'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.capRatio) : '—'; })),
        h('span', { class: 'k' }, '管理方式'), h('span', { class: 'v' }, wlc ? '無線控制器（自動頻道）' : '獨立式 AP（手動頻道）')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', 'data-hint': 'autoplan@' + V.fid, onclick: () => autoPlanDialog() }, '自動規劃 AP'),
        h('button', { class: 'btn sm', 'data-hint': 'autochan@' + V.fid, onclick: () => UI.res(G.Act.autoChannels(V.fid)) }, 'WLC 自動頻道'),
        h('button', { class: 'btn sm', 'data-hint': 'copy-floor@' + V.fid, onclick: () => copyDialog() }, '複製此樓層設計…')));
    R.appendChild(wifi);
    R.appendChild(ft.fab ? fabCard() : restCard());

    /* AP 詳情 */
    if (V.selAp) {
      const ap = fs.aps.find((a) => a.id === V.selAp);
      if (ap) {
        const m = CAT.aps[ap.model];
        const L = G.Layout.get(f.type);
        const idx = plan.apIds.indexOf(ap.id);
        const ast = idx >= 0 ? plan.aps[idx] : null;
        R.appendChild(h('div', { class: 'card col', style: { gap: '8px' } },
          h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, `AP @ (${ap.x}, ${ap.y})`), h('span', { class: 'chip ' + (powered.has(ap.id) ? 'ok' : 'bad') }, powered.has(ap.id) ? '供電中' : '沒有供電')),
          h('label', { class: 'field' }, h('span', {}, '型號'), h('select', { id: 'sel-ap-model', onchange: (e) => UI.res(G.Act.setApModel(V.fid, ap.id, e.target.value)) },
            Object.entries(CAT.aps).map(([id, mm]) => h('option', { value: id, selected: id === ap.model || null, disabled: !Q.unlocked(mm) || null }, mm.name)))),
          h('label', { class: 'field' }, h('span', {}, '頻道'), h('select', { id: 'sel-ap-ch', onchange: (e) => UI.res(G.Act.setApChannel(V.fid, ap.id, e.target.value)) },
            CAT.channels[m.band].map((c) => h('option', { value: c, selected: c === ap.ch || null }, c)))),
          h('div', { class: 'kv' },
            h('span', { class: 'k' }, '容量'), h('span', { class: 'v mono' }, `${U.bw(m.cap)} · ${m.maxClients} 台`),
            h('span', { class: 'k' }, '平均速率係數'), h('span', { class: 'v mono' }, ast ? `${U.pct(ast.rate)}${ast.cci ? `，干擾 ×${ast.cciF.toFixed(2)}` : ''}` : '—'),
            h('span', { class: 'k' }, '連線裝置'), h('span', { class: 'v mono' }, live(() => { const x = st(); const a = x && x.apStats[ap.id]; return a ? Math.round(a.clients) + ' 台' : '—'; })),
            h('span', { class: 'k' }, '負載'), h('span', { class: 'v mono' }, live(() => { const x = st(); const a = x && x.apStats[ap.id]; return a ? U.pct(a.load) : '—'; })),
            h('span', { class: 'k' }, '線長到 IDF'), h('span', { class: 'v mono' }, `${G.Layout.cableToIdf(L, ap.x, ap.y)} m`)),
          h('div', { class: 'row wrap' },
            G.M3 ? h('button', { class: 'btn sm', onclick: () => G.M3.open([ap.model], m.name) }, '3D 外觀') : null,
            h('button', { class: 'btn danger sm', onclick: () => { UI.res(G.Act.removeAp(V.fid, ap.id)); V.selAp = null; } }, `拆除（回收 ${U.money(m.price * 0.3)}）`))));
      }
    }
  };

  /* ---------- ⑤ 機台連網（晶圓廠）：接上交換器的機台、等著的機台、埠數；詳細的在「晶圓廠」頁 ---------- */
  function fabCard() {
    const F = G.S.fab, c = G.Fab.counts();
    const card = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '⑤ 機台連網'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-fab') }, 'SECS/GEM 與 EAP')));
    if (!F || !F.open) { card.appendChild(h('div', { class: 'small muted' }, '晶圓廠還沒開始進機台。')); return card; }
    card.appendChild(h('div', { class: 'kv' },
      h('span', { class: 'k' }, '機台'), h('span', { class: 'v mono' }, live(() => { const x = G.Fab.counts(); return `已連網 ${x.online} · 裝機 ${x.install} · 等掃毒 ${x.scan} · 等交換器埠 ${x.ready}`; })),
      h('span', { class: 'k' }, '機台用掉的埠'), h('span', { class: 'v mono' }, live(() => `${G.Fab.portsUsed()} / ${G.Fab.portsTotal()} 埠（交換器共 ${Q.floorPorts(V.fid)} 埠，AP 先接）`)),
      h('span', { class: 'k' }, '進廠掃毒站'), h('span', { class: 'v' }, G.Fab.kioskReady() ? '✓ 啟用中' : G.Fab.building('kiosk') ? '施工中' : '還沒有')));
    if (c.ready && G.S.floors[V.fid].cabling.status === 'done' && G.S.floors[V.fid].idf.count > 0) card.appendChild(h('div', { class: 'note warn small' }, `${c.ready} 台機台裝好了，卻沒有交換器埠可以接：在「② IDF 接入交換器」增加交換器。`));
    card.appendChild(h('button', { class: 'btn sm primary', style: { alignSelf: 'flex-start' }, 'data-hint': 'fab-go', onclick: () => UI.go('fab') }, '到「晶圓廠」看每一台機台'));
    card.appendChild(h('div', { class: 'tiny dim' }, '機台的網路線從架高地板下拉到 FAB IDF；機台和 MES / EAP 在 OT 網路裡，不和總部的員工電腦混在一起。無塵室不裝監視器以外的攝影設備，也不准帶私人手機。'));
    return card;
  }

  /* ---------- ⑤ 廁所與清潔：清潔人員（全大樓）、智慧廁所（本層）、三間廁所的狀況 ---------- */
  function restCard() {
    const s = G.S, fid = V.fid, R = s.rest, Rest = G.Rest;
    const rs = Rest.rooms(fid);
    const has = Rest.hasIot(fid);
    const unlocked = Q.unlocked({ unlock: CAT.rest.unlock });
    const card = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, '⑤ 廁所與清潔'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-iot') }, '智慧廁所與 IoT')));
    /* 清潔人員（全大樓共用） */
    card.appendChild(h('div', { class: 'row between wrap' },
      h('span', { class: 'small' }, '白班清潔人員（全大樓）', h('span', { class: 'dim' }, live(() => `　建議 ${Rest.recommend()} 人`))),
      h('div', { class: 'stepper' },
        h('button', { 'data-hint': 'rest-sub', onclick: () => UI.res(Rest.setStaff(R.staff - 1)), 'aria-label': '減少清潔人員' }, '−'),
        h('span', { class: 'n' }, String(R.staff)),
        h('button', { 'data-hint': 'rest-add', onclick: () => UI.res(Rest.setStaff(R.staff + 1)), 'aria-label': '增加清潔人員' }, '+'))));
    card.appendChild(h('div', { class: 'tiny dim' }, `外包合約：每人每月 ${U.money(CAT.rest.wage)}；衛生紙與洗手乳每次約 ${CAT.rest.usePrice} 元。22:00 以後由夜班清潔公司整理、清晨補滿耗材。`));
    /* 智慧廁所（本層） */
    if (has) {
      card.appendChild(h('div', { class: 'row between wrap' },
        live(() => (Rest.iotOk(fid) ? '✓ 智慧廁所運作中：感測器資料即時送到 IoT 管理平台，依需要派工' : `⚠ 連不到 IoT 管理平台：${Rest.iotWhy(fid)}`), 'small'),
        h('button', { class: 'btn ghost xs', onclick: () => UI.confirm('拆除智慧廁所', `拆除 ${fid} 的 IoT 閘道器與感測器？回收 30%。`, '拆除', () => UI.res(Rest.removeIot(fid)), 'danger') }, '拆除')));
      card.appendChild(h('div', { class: 'tiny dim' }, `IoT 閘道器接在 IDF 的接入交換器（佔 1 個埠、PoE ${CAT.rest.iotGw.poe} W），用 MQTT 回報到 IoT 管理平台（伺服器角色 IoT）。${s.fw.iotVlan ? '目前在 IoT 獨立網段（IOT 區域）。' : '目前在員工內網（LAN）：建議到「防火牆 → 網段規劃」開啟 IoT 獨立網段。'}`));
    } else {
      card.appendChild(h('div', { class: 'row between wrap' },
        h('span', { class: 'small muted' }, '沒有感測器：看不到衛生紙還剩多少，清潔人員只能照固定路線一間一間巡。'),
        h('button', { class: 'btn sm' + (unlocked ? ' primary' : ''), 'data-hint': 'rest-iot@' + fid, disabled: !unlocked || null, onclick: () => UI.res(Rest.installIot(fid)) },
          unlocked ? `安裝智慧廁所（${U.money(Rest.iotCost())}）` : `第 ${CAT.rest.unlock} 章解鎖`)));
    }
    /* 三間廁所：有感測器才看得到即時數字；沒有的話只知道上次打掃的時間與有人報修的問題 */
    const list = h('div', { class: 'col', style: { gap: '4px' } });
    for (const r of rs) {
      const nm = Rest.RM[r.k].name;
      list.appendChild(h('div', { class: 'row between small wc-row' },
        h('b', {}, nm),
        live(() => {
          const x = Rest.room(fid, r.k);
          const crew = Rest.crewAt(fid).find((c) => c.k === r.k);
          const doing = crew ? (G.S.time < crew.start ? '・清潔人員前往中' : '・清潔中') : '';
          const flags = `${x.leak && Rest.iotOk(fid) ? '・⚠ 漏水' : ''}${x.clog ? '・馬桶堵住' : ''}`;
          if (Rest.iotOk(fid)) return `整潔 ${Math.round(x.clean)}%・衛生紙 ${Math.round(x.paper)}%・洗手乳 ${Math.round(x.soap)}%${flags}${doing}`;
          const ago = x.last ? `上次打掃 ${U.dur(G.S.time - x.last)}前` : '還沒打掃過';
          const heard = x.paper <= 0 ? '・有人報修：沒衛生紙' : x.clean < 35 ? '・有人報修：很髒' : '';
          return `${ago}${heard}${flags}${doing}`;
        }, 'mono tiny')));
    }
    card.appendChild(list);
    card.appendChild(h('div', { class: 'tiny dim' }, live(() => {
      const c = Rest.crewAt(fid).length;
      const day = Rest.dayShift(G.S.time);
      return `${day ? `這層樓現在有 ${c} 位清潔人員` : '夜班清潔公司整理中'}。廁所裡不裝 AP 與監視器；人流計數器裝在門口外側，只算人數。`;
    })));
    return card;
  }

  /* ---------- 自己布線：三個步驟（拉線 → 端接打線 → 認證測試） ---------- */
  function diyPanel(cab) {
    const s = G.S, fs = s.floors[V.fid], job = G.Diy.job(V.fid), p = G.Diy.progress(V.fid);
    const f = G.BLD.byId[V.fid], zs = G.Diy.zones(f.type), drops = G.Diy.drops(V.fid);
    const stepH = (n, title, done, cur) => h('div', { class: 'row between', style: { marginTop: '10px' } },
      h('b', { class: 'small' + (done ? ' ok-t' : cur ? ' accent-t' : ' muted') }, `${done ? '✓' : n} ${title}`));
    cab.appendChild(h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `${CAT.horizontal[fs.cabling.std].name} · 自己布線 · ${p.total} 個配線區、${G.Act.floorDrops(V.fid)} 個資訊點`), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-diy') }, '怎麼自己布線？')));
    /* ① 拉線 */
    cab.appendChild(stepH('1', `拉線：從 IDF 拉到每個配線區（${p.pulled}/${p.total}）`, p.pulled === p.total, p.pulled < p.total));
    cab.appendChild(h('div', { class: 'bar', style: { margin: '4px 0' } }, h('i', { style: { width: (p.pulled / p.total) * 100 + '%' } })));
    const rows = h('div', { class: 'col', style: { gap: '2px' } });
    for (const z of zs) {
      const zr = job.zones[z.id];
      const st = !zr.path ? h('span', { class: 'warn-t' }, '還沒畫路徑') : s.time < zr.pullAt ? live(() => `拉線中（${U.dur(Math.max(0, zr.pullAt - G.S.time))}）`, 'muted') : h('span', { class: 'ok-t' }, '✓ 已拉好');
      rows.appendChild(h('div', { class: 'row between tiny' },
        h('span', {}, h('b', {}, `配線區 ${z.n}`), h('span', { class: 'dim' }, `　${drops[z.id]} 點${zr.path ? ` · ${zr.len} m${zr.emi >= 5 ? ` · ⚠ 與電力線平行 ${zr.emi} m` : ''}` : ''}`)),
        h('span', { class: 'row' }, st, zr.path ? h('button', { class: 'btn ghost xs', onclick: () => UI.res(G.Diy.redoZone(V.fid, z.id)) }, '重拉') : null)));
    }
    cab.appendChild(rows);
    if (p.routed < p.total) cab.appendChild(h('div', { class: 'row wrap', style: { marginTop: '4px' } },
      h('span', { class: 'tiny dim grow' }, '在左邊平面圖上，從 IDF 按住拖曳到配線區；紅色虛線是電力線槽，網路線不要跟它平行走。'),
      h('button', { class: 'btn xs', 'data-hint': 'diy-auto@' + V.fid, onclick: () => UI.res(G.Diy.autoAll(V.fid)) }, '其餘自動規劃')));
    /* ② 端接打線 */
    const pulled = p.pulled === p.total;
    cab.appendChild(stepH('2', '端接打線：資訊插座與配線架（T568B）', !!job.term, pulled && !job.term));
    cab.appendChild(h('div', { class: 'row between tiny' },
      h('span', { class: 'dim' }, job.term ? '打線完成（測試時才知道色序對不對）' : pulled ? '所有的線都拉好了，開始打線' : '線全部拉好才能打線'),
      h('button', { class: 'btn xs' + (pulled && !job.term ? ' primary' : ''), 'data-hint': 'diy-term@' + V.fid, disabled: !pulled || null, onclick: () => termDialog() }, job.term ? '重新打線' : '開始打線')));
    /* ③ 認證測試 */
    cab.appendChild(stepH('3', '認證測試：接線圖、長度、串音全部 PASS', false, !!job.term));
    cab.appendChild(h('div', { class: 'row between tiny' },
      h('span', { class: 'dim' }, job.results ? `上次測試：${job.results.filter((r) => r.pass).length}/${job.results.length} 區 PASS` : '用認證測試儀測每一個配線區'),
      h('button', { class: 'btn xs' + (job.term ? ' primary' : ''), 'data-hint': 'diy-test@' + V.fid, disabled: !job.term || null, onclick: () => { const r = G.Diy.test(V.fid); if (r.ok) testDialog(r); else UI.res(r); } }, '測試')));
    if (job.results) cab.appendChild(h('button', { class: 'btn ghost xs', style: { alignSelf: 'flex-start' }, onclick: () => testDialog({ results: job.results, pass: false }) }, '看測試報告'));
    cab.appendChild(h('div', { class: 'row between tiny', style: { marginTop: '10px' } },
      h('span', { class: 'dim' }, '做不完？剩下的可以交給廠商'),
      h('button', { class: 'btn ghost xs', onclick: () => UI.confirm('交給廠商', '剩下的布線交給廠商施工？會依還沒完成的部分計價與計算工期。', '交給廠商', () => UI.res(G.Diy.toContract(V.fid))) }, '交給廠商')));
  }
  /** 打線小遊戲：把 8 條芯線依 T568B 色序排進資訊插座的 1～8 號 */
  const wireChip = (id, big) => {
    const c = G.Diy.COLORS[id];
    const bg = c.length === 2 ? `repeating-linear-gradient(135deg, ${c[0]} 0 5px, ${c[1]} 5px 10px)` : c[0];
    return h('span', { class: 'wire-chip' + (big ? ' big' : ''), style: { background: bg }, title: G.Diy.WIRES[id] });
  };
  function termDialog() {
    const ids = Object.keys(G.Diy.WIRES);
    const pool = ids.slice().sort(() => Math.random() - 0.5);
    const order = [];
    let hint = false, m = null;
    const body = h('div', { class: 'col' });
    const render = () => {
      U.clear(body);
      body.append(
        h('p', { class: 'small muted' }, '網路線裡有 4 對、8 條芯線。依 T568B 色序，從 1 號到 8 號排進資訊插座（配線架那一端也用一樣的色序，兩端一致才是直通線）。點下面的芯線就會放進下一個位置，點上面的位置可以拿出來。'),
        h('div', { class: 'jack' }, Array.from({ length: 8 }, (_, i) => h('button', { class: 'jack-slot' + (order[i] ? ' on' : ''), onclick: () => { if (order[i]) { order.splice(i, 1); render(); } } },
          h('span', { class: 'n mono' }, String(i + 1)), order[i] ? wireChip(order[i], true) : h('span', { class: 'empty-slot' }), h('span', { class: 'tiny' }, order[i] ? G.Diy.WIRES[order[i]] : '')))),
        h('div', { class: 'row wrap', style: { justifyContent: 'center', gap: '8px' } }, pool.filter((id) => !order.includes(id)).map((id) =>
          h('button', { class: 'wire-btn', onclick: () => { if (order.length < 8) { order.push(id); render(); } } }, wireChip(id, true), h('span', { class: 'tiny' }, G.Diy.WIRES[id])))),
        hint ? h('div', { class: 'note info small' }, 'T568B：白橙、橙、白綠、藍、白藍、綠、白棕、棕。記法：「橙、綠、藍、棕」每一對白色的在前；第 3、6 號是綠色這一對，中間夾著藍色那一對。') : null,
        h('div', { class: 'row between' },
          h('button', { class: 'btn ghost sm', onclick: () => { hint = !hint; render(); } }, hint ? '隱藏提示' : '看色序提示'),
          h('div', { class: 'row' },
            h('button', { class: 'btn ghost sm', onclick: () => { order.length = 0; render(); } }, '清除'),
            h('button', { class: 'btn primary sm', disabled: order.length < 8 || null, onclick: () => { const r = UI.res(G.Diy.terminate(V.fid, order.slice())); if (r.ok) m.close(); } }, '打線完成'))));
    };
    m = UI.modal({ kicker: `${V.fid} 自己布線`, title: '端接打線（T568B）', body, blocking: true });
    render();
  }
  /** 認證測試報告：每個配線區的接線圖、長度、串音 */
  function testDialog(r) {
    const job = G.Diy.job(V.fid);
    const res = r.results || (job && job.results) || [];
    const ok = (b) => h('span', { class: b ? 'ok-t' : 'bad-t' }, b ? '✓' : '✗');
    const body = h('div', { class: 'col' },
      h('div', { class: 'note ' + (r.pass ? 'ok' : res.every((x) => x.pass) ? 'ok' : 'warn') }, r.pass ? '全部 PASS：水平布線完工！每條線兩端都已貼上編號標籤，竣工圖也更新了。' : '有配線區 FAIL：依原因修正後再測一次。'),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' },
        h('thead', {}, h('tr', {}, ['配線區', '接線圖', '長度（≤ 90 m）', '串音 NEXT', '結果', ''].map((x) => h('th', {}, x)))),
        h('tbody', {}, res.map((x) => h('tr', {},
          h('td', { class: 'mono' }, String(x.n)),
          h('td', {}, ok(x.map), x.map ? '' : h('div', { class: 'tiny muted' }, x.why)),
          h('td', { class: 'mono small' }, ok(x.lenOk), ` ${x.len} m`),
          h('td', { class: 'small' }, ok(x.emiOk), x.emiOk ? '' : h('div', { class: 'tiny muted' }, `與電力線平行 ${x.emi} m`)),
          h('td', { class: 'mono ' + (x.pass ? 'ok-t' : 'bad-t') }, x.pass ? 'PASS' : 'FAIL'),
          h('td', {}, x.pass || !job ? null : !x.lenOk || !x.emiOk ? h('button', { class: 'btn xs', onclick: () => { UI.res(G.Diy.redoZone(V.fid, x.zid)); mm.close(); } }, '重拉這一區')
            : job.term !== 'ok' ? h('button', { class: 'btn xs', onclick: () => { mm.close(); termDialog(); } }, '重新打線') : h('button', { class: 'btn xs', onclick: () => { UI.res(G.Diy.reterm(V.fid, x.zid)); mm.close(); } }, '重新端接'))))))),
      h('p', { class: 'tiny dim' }, '接線圖（wire map）：8 芯有沒有接對位置、有沒有斷線或交叉。長度：永久鏈路最長 90 m（加上兩端跳線共 100 m）。串音：網路線和電力線平行太長會被干擾，要保持距離或垂直交叉。'));
    const mm = UI.modal({ kicker: `${V.fid} 自己布線`, title: '認證測試報告', wide: true, body });
  }

  function barRow(label, avail, need, sub, unit) {
    const u = avail > 0 ? need / avail : need > 0 ? 2 : 0;
    const ok = avail >= need;
    return h('div', {},
      h('div', { class: 'row between small' }, h('span', { class: 'muted' }, label), h('span', { class: 'mono ' + (ok ? '' : 'bad-t') }, `需要 ${U.num(need)}${unit || ''} / 可用 ${U.num(avail)}${unit || ''}`)),
      h('div', { class: 'bar ' + (ok ? (u > 0.9 ? 'warn' : 'ok') : 'bad') }, h('i', { style: { width: Math.min(100, u * 100) + '%' } })),
      sub ? h('div', { class: 'tiny dim' }, sub) : null);
  }

  V.update = () => {
    const now = performance.now();
    if (now - (V.lastLive || 0) > 900) {
      V.lastLive = now;
      for (const x of V.live || []) { try { x.el.textContent = x.fn(); } catch (e) { /* ignore */ } }
    }
    if (V.layer === 'load' || now - (V.lastDraw || 0) > 3000) { if (now - (V.lastDraw || 0) > 1500) { V.lastDraw = now; if (!V.drag) V.draw(); } }
  };

  function autoPlanDialog() {
    let model = Q.unlocked(CAT.aps['AP-610E']) ? 'AP-610E' : 'AP-600';
    const body = h('div', { class: 'col' });
    let m = null;
    const render = () => {
      U.clear(body);
      const { pos, cost } = G.Act.autoPlanCost(V.fid, model);
      body.append(
        h('p', { class: 'muted' }, '無線網路顧問會依這層樓的人數、流量與格局，計算需要的 AP 數量並平均佈點，同時完成頻道規劃。現有的 AP 會被替換（回收 30%）。'),
        h('select', { id: 'autoplan-model', onchange: (e) => { model = e.target.value; render(); } }, Object.entries(CAT.aps).map(([id, mm]) => h('option', { value: id, selected: id === model || null, disabled: !Q.unlocked(mm) || null }, mm.name))),
        h('div', { class: 'kv' }, h('span', { class: 'k' }, '規劃數量'), h('span', { class: 'v mono' }, `${pos.length} 台`), h('span', { class: 'k' }, '費用（含顧問費 3 萬）'), h('span', { class: 'v mono' }, U.money(cost))),
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'), h('button', { class: 'btn primary', 'data-hint': 'autoplan-ok', onclick: () => { const r = UI.res(G.Act.autoPlan(V.fid, model)); if (r.ok) m.close(); } }, '執行規劃')));
    };
    m = UI.modal({ title: `${V.fid} 自動規劃 AP`, body, blocking: true });
    render();
  }

  function copyDialog() {
    const s = G.S, from = V.fid, fdef = G.BLD.byId[from];
    const sel = new Set(G.BLD.floors.filter((x) => x.id !== from && x.type === fdef.type && s.floors[x.id].cabling.status === 'none' && s.floors[x.id].idf.count === 0).map((x) => x.id));
    const body = h('div', { class: 'col' });
    let m = null;
    const render = () => {
      U.clear(body);
      body.appendChild(h('p', { class: 'muted small' }, '把這層樓的布線標準、接入交換器、AP 佈點與頻道、上行主幹、IDF UPS 一次套用到其他樓層。同類型樓層的 AP 位置會完全一樣；不同類型的樓層會自動依人數重新規劃 AP。已有上行的樓層不會重複拉線。'));
      const grid = h('div', { class: 'floor-grid' });
      for (const x of G.BLD.floors) {
        if (x.id === from) continue;
        const on = sel.has(x.id);
        grid.appendChild(h('button', { class: 'fcell', style: { borderColor: on ? 'var(--accent)' : null, background: on ? 'var(--accent-soft)' : null }, onclick: () => { if (on) sel.delete(x.id); else sel.add(x.id); render(); } },
          h('div', { class: 'n' }, (on ? '☑ ' : '☐ ') + x.id), h('div', { class: 'v' }, G.FT[x.type].name + (x.type === fdef.type ? ' ✓' : ''))));
      }
      body.appendChild(grid);
      const { plan, total } = G.Act.copyPlan(from, Array.from(sel));
      const list = h('div', { class: 'col small', style: { gap: '4px', maxHeight: '180px', overflow: 'auto' } }, plan.map((p) => h('div', { class: 'row between' }, h('span', {}, h('b', { class: 'mono' }, p.fid), '　', h('span', { class: 'muted' }, p.items.join('、') || '無需變更')), h('span', { class: 'mono' }, U.money(p.cost)))));
      body.append(list, h('div', { class: 'row between' }, h('b', {}, `合計 ${U.money(total)}`), h('div', { class: 'row' },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'),
        h('button', { class: 'btn primary', disabled: !sel.size || null, onclick: () => { const r = UI.res(G.Act.copyFloor(from, Array.from(sel))); if (r.ok) m.close(); } }, '套用'))));
    };
    m = UI.modal({ title: `複製 ${from} 的設計`, wide: true, body, blocking: true });
    render();
  }
})(window.G = window.G || {});
