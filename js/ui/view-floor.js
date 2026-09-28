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
    for (const x of G.BLD.floors.slice().reverse()) {
      const stt = G.Views.building.floorStatus(x.id);
      pick.appendChild(h('button', { class: x.id === V.fid ? 'on' : '', onclick: () => { if (x.id !== V.fid) { V.fid = x.id; V.selAp = null; V.stage = null; UI.refresh(); } } },
        h('span', { class: 'dot ' + stt.c }), x.id));
    }
    el.appendChild(pick);
    const mi = fs.moveInAt !== null && fs.movedIn < f.staff ? (fs.moveInAt > s.time ? `預計 ${U.stamp(fs.moveInAt)} 進駐（${U.dur(fs.moveInAt - s.time)} 後）` : '進駐中') : fs.movedIn ? '已進駐' : '尚未排定進駐';
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, `${f.id} ${f.dept}`), h('div', { class: 'desc' }, `${ft.name}樓層 · 編制 ${U.num(f.staff)} 人 · 有線座位約 ${U.pct(ft.wired)} · ${mi}`)),
      h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, `主幹距離 B1 ${G.BLD.riserLength(f.id)} m`), G.BLD.riserLength(f.id) > 100 ? h('span', { class: 'chip warn' }, '超過 100m：銅纜無法使用') : null)));

    const left = h('div', { class: 'col', style: { gap: '10px' } });
    V.right = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'split' }, left, V.right));

    /* 工具列 */
    const toolSeg = h('div', { class: 'seg' },
      h('button', { class: V.tool === 'select' ? 'on' : '', onclick: () => { V.tool = 'select'; UI.refresh(); } }, '選取 / 拖曳'),
      h('button', { class: V.tool === 'place' ? 'on' : '', onclick: () => { V.tool = 'place'; UI.refresh(); } }, '放置 AP'));
    const modelSel = h('select', { id: 'ap-model', onchange: (e) => { V.apModel = e.target.value; } },
      Object.entries(CAT.aps).map(([id, m]) => h('option', { value: id, selected: id === V.apModel || null, disabled: !Q.unlocked(m) || null }, `${m.name} · ${U.money(m.price + CAT.apInstallFee)}${Q.unlocked(m) ? '' : '（第 ' + m.unlock + ' 章）'}`)));
    const layerSeg = h('div', { class: 'seg' }, [['rssi', '訊號'], ['load', 'AP 負載'], ['cci', '同頻干擾'], ['none', '平面']].map(([k, t]) =>
      h('button', { class: V.layer === k ? 'on' : '', onclick: () => { V.layer = k; UI.refresh(); } }, t)));
    V.canvas = h('canvas', { style: { aspectRatio: '2 / 1' }, 'aria-label': `${f.id} 平面圖` });
    V.tip = h('div', { class: 'small mono muted', style: { minHeight: '18px', marginTop: '6px' } }, V.tool === 'place' ? '點擊平面圖放置 AP（天花板安裝，不能裝在牆上或核心筒）' : '點選 AP 查看詳情，拖曳可移動位置');
    left.appendChild(h('div', { class: 'plan-wrap' },
      h('div', { class: 'plan-tools' }, toolSeg, modelSel, h('span', { class: 'grow' }), layerSeg),
      V.canvas, V.tip, legend()));
    bindCanvas();
    requestAnimationFrame(() => V.draw());
    if (V.ro) V.ro.disconnect();
    V.ro = new ResizeObserver(() => V.draw());
    V.ro.observe(V.canvas);
    V.renderSide();
  };
  V.unmount = () => { if (V.ro) { V.ro.disconnect(); V.ro = null; } };

  function legend() {
    if (V.layer === 'rssi') return h('div', { class: 'legend' }, [['rgba(70,209,127,0.8)', '≥ −60 極佳'], ['rgba(160,214,80,0.8)', '≥ −67 良好（語音 / 視訊）'], ['rgba(240,190,58,0.8)', '≥ −72 普通'], ['rgba(240,130,58,0.8)', '≥ −75 偏弱'], ['rgba(242,80,80,0.8)', '≥ −78 很弱'], ['rgba(110,120,130,0.6)', '無法連線']].map(([c, t]) => h('span', {}, h('i', { style: { background: c } }), t)));
    if (V.layer === 'load') return h('div', { class: 'legend' }, [['rgba(70,209,127,0.8)', 'AP 負載 < 70%'], ['rgba(240,166,58,0.8)', '70～100%'], ['rgba(242,95,92,0.8)', '超載']].map(([c, t]) => h('span', {}, h('i', { style: { background: c } }), t)), h('span', { class: 'dim' }, '（依目前在座人數計算）'));
    if (V.layer === 'cci') return h('div', { class: 'legend' }, h('span', {}, h('i', { style: { background: 'var(--bad)' } }), '紅色虛線：兩台 AP 使用相同頻道且互相聽得到（同頻干擾）'));
    return h('div', { class: 'legend' }, h('span', { class: 'dim' }, '灰色格：座位區　深色：核心筒（電梯 / 樓梯，訊號幾乎無法穿透）'));
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
    for (let y = 0; y < L.H; y++) {
      for (let x = 0; x < L.W; x++) {
        const t = L.type[y * L.W + x];
        ctx.fillStyle = col[t];
        ctx.fillRect(x * cs, y * cs, cs + 0.6, cs + 0.6);
        if (t === T.DESK && cs >= 6) { ctx.fillStyle = tk.bg3; ctx.fillRect(x * cs + cs * 0.18, y * cs + cs * 0.22, cs * 0.64, cs * 0.5); }
      }
    }
    if (V.layer === 'rssi' || V.layer === 'load') {
      for (let y = 0; y < L.H; y++) {
        for (let x = 0; x < L.W; x++) {
          const i = y * L.W + x;
          const t = L.type[i];
          if (t === T.WALL || t === T.GLASS || t === T.CORE || t === T.IDF || t === T.EXT) continue;
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
        if (wpx < 40) continue;
        ctx.fillText(r.label, ((r.x0 + r.x1 + 1) / 2) * cs, ((r.y0 + r.y1 + 1) / 2) * cs);
      }
    }
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
  };

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
      V.tip.textContent = r > -110 ? `(${c.x}, ${c.y}) m　訊號 ${r.toFixed(0)} dBm${wr.bestIdx[i] >= 0 ? '' : ''}` : `(${c.x}, ${c.y}) m　沒有訊號`;
    });
    const end = () => {
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
        h('span', { class: 'k' }, '已進駐 / 編制'), h('span', { class: 'v mono' }, `${U.num(fs.movedIn)} / ${U.num(f.staff)}`),
        h('span', { class: 'k' }, '目前在座'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x ? U.num(Math.round(x.present)) + ' 人' + (x.guests > 1 ? `＋訪客 ${Math.round(x.guests)}` : '') : '—'; })),
        h('span', { class: 'k' }, '可連線比例'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.conn) : '—'; })),
        h('span', { class: 'k' }, '頻寬滿足率'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.thr) : '—'; })),
        h('span', { class: 'k' }, '延遲'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? `${x.lat.toFixed(1)} ms` : '—'; })),
        h('span', { class: 'k' }, '滿意度'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.sat !== null && x.present > 1 ? U.pct(x.sat) : '—'; })))));

    /* ① 水平布線 */
    const cab = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '① 水平布線'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-mdf') }, '什麼是水平布線？')));
    if (fs.cabling.status === 'none') {
      const drops = G.Act.floorDrops(V.fid);
      const seg = h('div', { class: 'seg' }, Object.entries(CAT.horizontal).map(([k, hz]) => h('button', { class: V.cabStd === k ? 'on' : '', onclick: () => { V.cabStd = k; V.renderSide(); } }, hz.name)));
      const hz = CAT.horizontal[V.cabStd];
      cab.append(seg,
        h('p', { class: 'small muted', style: { margin: '8px 0' } }, hz.desc),
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '資訊點'), h('span', { class: 'v mono' }, `${drops} 個（座位 + 印表機 + 40 個 AP 點）`),
          h('span', { class: 'k' }, '費用'), h('span', { class: 'v mono' }, U.money(drops * hz.perDrop)),
          h('span', { class: 'k' }, '工期'), h('span', { class: 'v mono' }, U.dur(hz.buildMin))),
        h('button', { class: 'btn primary', style: { marginTop: '10px', width: '100%' }, onclick: () => UI.res(G.Act.startCabling(V.fid, V.cabStd)) }, '發包施工'));
    } else if (fs.cabling.status === 'building') {
      const tot = CAT.horizontal[fs.cabling.std].buildMin;
      cab.append(h('div', { class: 'row between small' }, h('span', {}, `${CAT.horizontal[fs.cabling.std].name} 施工中`), live(() => `剩 ${U.dur(fs.cabling.readyAt - G.S.time)}`, 'mono')),
        h('div', { class: 'bar', style: { marginTop: '6px' } }, h('i', { style: { width: U.clamp(100 - ((fs.cabling.readyAt - s.time) / tot) * 100, 0, 100) + '%' } })));
    } else cab.appendChild(h('div', { class: 'note ok' }, `✓ ${CAT.horizontal[fs.cabling.std].name}完成（${G.Act.floorDrops(V.fid)} 個資訊點）`));
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
        h('button', { class: 'btn sm', onclick: () => { stg.count = Math.max(1, Math.ceil((need.seats + need.printers + Math.max(need.aps, 20)) * 1.1 / am.ports)); V.renderSide(); } }, '建議數量')),
      barRow('埠數', portsAvail, need.total, `座位 ${need.seats} + AP ${need.aps} + 印表機 ${need.printers}`),
      barRow('PoE', budget, poe.used, poe.phones ? `IP 電話 ${poe.phones}W + AP ${poe.aps}W` : `AP ${poe.aps}W`, 'W'),
      h('div', { class: 'small muted mono' }, `上行埠：${stg.count * am.uplinks} 個（≤${U.speed(am.uplinkMax)}）　AP 上行：${U.bw(Math.min(am.portSpeed, fs.cabling.std ? CAT.horizontal[fs.cabling.std].maxSpeed : 1000))}`),
      changed ? h('button', { class: 'btn primary', onclick: () => { const r = UI.res(G.Act.setAccess(V.fid, stg.model, stg.count)); if (!r.ok) { V.stage = null; } } }, delta >= 0 ? `套用（${U.money(delta)}）` : `套用（回收 ${U.money(-delta)}）`) : null,
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
    upl.appendChild(h('button', { class: 'btn primary', disabled: fs.idf.count === 0 || null, onclick: () => UI.pickTarget('F:' + V.fid, (d) => CAT.devices[d.model].cat === 'switch', `${V.fid} 上行到哪台交換器？`) }, fs.idf.count === 0 ? '先安裝接入交換器' : '新增上行'));
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
        h('span', { class: 'k' }, '良好覆蓋（≥ −67 dBm）'), h('span', { class: 'v mono ' + (plan.good >= 0.9 ? 'ok-t' : 'warn-t') }, partial ? `預測 ${U.pct(plan.good)}・實際 ${U.pct(wr.good)}` : U.pct(wr.good)),
        h('span', { class: 'k' }, '可連線（≥ −78 dBm）'), h('span', { class: 'v mono' }, U.pct(partial ? plan.cover : wr.cover)),
        h('span', { class: 'k' }, '同頻干擾'), h('span', { class: 'v mono ' + (plan.conflicts.length ? 'warn-t' : '') }, `${plan.conflicts.length} 組`),
        h('span', { class: 'k' }, '連線裝置'), h('span', { class: 'v mono' }, live(() => { const x = st(); if (!x) return '—'; return U.num(Math.round(U.sum(Object.values(x.apStats), (a) => a.clients))); })),
        h('span', { class: 'k' }, '容量滿足率'), h('span', { class: 'v mono' }, live(() => { const x = st(); return x && x.present > 1 ? U.pct(x.capRatio) : '—'; })),
        h('span', { class: 'k' }, '管理方式'), h('span', { class: 'v' }, wlc ? '無線控制器（自動頻道）' : '獨立式 AP（手動頻道）')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => autoPlanDialog() }, '自動規劃 AP'),
        h('button', { class: 'btn sm', onclick: () => UI.res(G.Act.autoChannels(V.fid)) }, 'WLC 自動頻道'),
        h('button', { class: 'btn sm', onclick: () => copyDialog() }, '複製此樓層設計…')));
    R.appendChild(wifi);

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
        h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'), h('button', { class: 'btn primary', onclick: () => { const r = UI.res(G.Act.autoPlan(V.fid, model)); if (r.ok) m.close(); } }, '執行規劃')));
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
