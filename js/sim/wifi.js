/* Wi-Fi 模型：訊號傳播（路徑損耗 + 牆壁衰減）、覆蓋、AP 容量、同頻干擾
 * RSSI = 發射功率 − [46 + 33·log10(距離)] − 穿越的牆壁衰減
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const Wifi = {};
  G.Wifi = Wifi;

  const PL0 = 46, PLN = 33, MAXD = 48;
  Wifi.TH = { good: -67, usable: -75, assoc: -78, cci: -82 };
  const rssiCache = new Map();

  /** 單一 AP 在整個樓層的 RSSI 分佈（依樓層類型與位置快取） */
  function apMap(type, x, y, tx) {
    const key = type + '|' + x + '|' + y + '|' + tx;
    const hit = rssiCache.get(key);
    if (hit) return hit;
    const L = G.Layout.get(type);
    const W = L.W, H = L.H, att = L.att;
    const m = new Float32Array(W * H);
    const x0 = x + 0.5, y0 = y + 0.5;
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        const i = cy * W + cx;
        const dx = cx + 0.5 - x0, dy = cy + 0.5 - y0;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > MAXD) { m[i] = -120; continue; }
        let loss = 0;
        if (cx !== x || cy !== y) {
          /* Amanatides–Woo 格點追蹤：累加射線穿過的每一格衰減 */
          let gx = x, gy = y;
          const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
          const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
          const tdx = sx ? Math.abs(1 / dx) : Infinity;
          const tdy = sy ? Math.abs(1 / dy) : Infinity;
          let tmx = sx ? 0.5 * tdx : Infinity;
          let tmy = sy ? 0.5 * tdy : Infinity;
          let guard = 0;
          while ((gx !== cx || gy !== cy) && guard++ < 220) {
            if (tmx < tmy) { gx += sx; tmx += tdx; } else { gy += sy; tmy += tdy; }
            loss += att[gy * W + gx];
            if (loss > 70) break;
          }
        }
        m[i] = tx - (PL0 + PLN * Math.log10(Math.max(d, 1))) - loss;
      }
    }
    rssiCache.set(key, m);
    return m;
  }
  Wifi.apMap = apMap;

  /** 訊號強度 → 相對傳輸速率（MCS 簡化） */
  function rateF(r) {
    return r >= -55 ? 1 : r >= -62 ? 0.85 : r >= -67 ? 0.7 : r >= -72 ? 0.5 : r >= -75 ? 0.36 : r >= -78 ? 0.22 : 0;
  }
  Wifi.rateF = rateF;

  /** 樓層 AP 的 PoE 供電：依預算由先到後供電（客服中心的 IP 電話優先） */
  Wifi.powered = (fid, floorUp) => {
    const fs = G.S.floors[fid];
    const set = new Set();
    if (!floorUp) return set;
    const poe = G.Q.floorPoe(fid);
    let left = poe.budget - poe.phones - (poe.cams || 0) - (poe.iot || 0);
    for (const a of fs.aps) {
      const w = CAT.aps[a.model].poe;
      if (left >= w) { set.add(a.id); left -= w; }
    }
    return set;
  };

  /** AP 上行（交換器埠 × 水平布線）的可用頻寬 */
  Wifi.backhaul = (fid) => {
    const fs = G.S.floors[fid];
    const port = CAT.access[fs.idf.model].portSpeed;
    const cab = fs.cabling.std ? CAT.horizontal[fs.cabling.std].maxSpeed : 1000;
    return Math.min(port, cab) * 0.94;
  };

  function compute(fid, powered) {
    const f = G.BLD.byId[fid], fs = G.S.floors[fid];
    const L = G.Layout.get(f.type);
    const W = L.W, n = W * L.H;
    const aps = fs.aps.filter((a) => powered.has(a.id));
    const maps = aps.map((a) => apMap(f.type, a.x, a.y, CAT.aps[a.model].tx));
    const best = new Float32Array(n).fill(-120);
    const bestIdx = new Int16Array(n).fill(-1);
    for (let k = 0; k < maps.length; k++) {
      const m = maps[k];
      for (let i = 0; i < n; i++) if (m[i] > best[i]) { best[i] = m[i]; bestIdx[i] = k; }
    }
    const st = aps.map((a) => ({ id: a.id, w: 0, gw: 0, inv: 0, cci: 0, capEff: 0 }));
    let good = 0, usable = 0, cover = 0, gcover = 0, gusable = 0;
    /* 覆蓋率：一般樓層看員工座位；餐廳看廚房（員工）與用餐區（人潮）各半；停車場看的是停車格、走道與電梯廳（人潮） */
    const wcOf = coverWeight(f.type);
    for (let i = 0; i < n; i++) {
      const w = L.occ[i], g = L.guest[i];
      if (w === 0 && g === 0) continue;
      const r = best[i];
      const wc = wcOf(w, g);
      if (r >= Wifi.TH.good) good += wc;
      if (r >= Wifi.TH.usable) { usable += wc; gusable += g; }
      if (r >= Wifi.TH.assoc) {
        cover += w; gcover += g;
        const k = bestIdx[i];
        const s = st[k];
        s.w += w; s.gw += g; s.inv += (w + g) / rateF(r);
      }
    }
    /* 同頻干擾：同頻道、且在彼此位置收得到 ≥ −82 dBm 的 AP */
    const conflicts = [];
    for (let k = 0; k < aps.length; k++) {
      const idx = aps[k].y * W + aps[k].x;
      for (let j = 0; j < aps.length; j++) {
        if (j === k || aps[j].ch !== aps[k].ch) continue;
        if (maps[j][idx] >= Wifi.TH.cci) {
          st[k].cci++;
          if (j > k) conflicts.push([aps[k].id, aps[j].id]);
        }
      }
    }
    const bh = Wifi.backhaul(fid);
    for (let k = 0; k < aps.length; k++) {
      const m = CAT.aps[aps[k].model];
      const s = st[k];
      const tw = s.w + s.gw;
      const rateEff = tw > 0 ? tw / s.inv : 1;
      s.rate = rateEff;
      s.cciF = 1 / (1 + 0.5 * s.cci);
      s.capEff = m.cap * rateEff * s.cciF;
      s.backhaul = bh;
      s.maxClients = m.maxClients;
    }
    return { aps: st, apIds: aps.map((a) => a.id), best, bestIdx, good, usable, cover, gcover, gusable, conflicts, unpowered: fs.aps.length - aps.length };
  }
  /** 覆蓋率要看哪些人：w = 員工分布、g = 人潮分布（訪客 / 用餐 / 停車） */
  function coverWeight(type) {
    const ft = G.FT[type];
    if (ft.dine) return (w, g) => (w + g) / 2;
    if (ft.park) return (w, g) => w * 0.1 + g * 0.9;
    return (w) => w;
  }

  /** 取得樓層 Wi-Fi 結果（有變動才重算） */
  Wifi.get = (fid, powered) => {
    const fs = G.S.floors[fid];
    const key = fs.idf.model + '|' + (fs.cabling.std || '') + '|' +
      fs.aps.map((a) => `${a.id}:${a.x},${a.y},${a.model},${a.ch},${powered.has(a.id) ? 1 : 0}`).join(';');
    G.R.wifi = G.R.wifi || {};
    const c = G.R.wifi[fid];
    if (c && c.key === key) return c.res;
    const res = compute(fid, powered);
    G.R.wifi[fid] = { key, res };
    return res;
  };
  Wifi.invalidate = (fid) => { if (G.R.wifi) delete G.R.wifi[fid]; };

  /** 自動頻道規劃（RRM）：貪婪著色，讓鄰近 AP 盡量不同頻道 */
  Wifi.autoChannels = (fid) => {
    const f = G.BLD.byId[fid], fs = G.S.floors[fid];
    const aps = fs.aps;
    if (!aps.length) return;
    const L = G.Layout.get(f.type);
    const maps = aps.map((a) => apMap(f.type, a.x, a.y, CAT.aps[a.model].tx));
    const deg = aps.map((a, k) => {
      let d = 0;
      for (let j = 0; j < aps.length; j++) if (j !== k && maps[j][a.y * L.W + a.x] > -85) d++;
      return d;
    });
    const order = aps.map((a, k) => k).sort((p, q) => deg[q] - deg[p] || p - q);
    const assigned = new Map();
    for (const k of order) {
      const pool = CAT.channels[CAT.aps[aps[k].model].band];
      const idx = aps[k].y * L.W + aps[k].x;
      let bestCh = pool[0], bestCost = Infinity;
      for (const ch of pool) {
        let cost = 0;
        for (const [j, cj] of assigned) {
          if (cj !== ch) continue;
          const r = Math.max(maps[j][idx], maps[k][aps[j].y * L.W + aps[j].x]);
          if (r > -95) cost += r + 95;
        }
        if (cost < bestCost - 1e-6) { bestCost = cost; bestCh = ch; }
      }
      assigned.set(k, bestCh);
    }
    aps.forEach((a, k) => { a.ch = assigned.get(k); });
    Wifi.invalidate(fid);
  };

  /** 自動規劃 AP 位置：同時考慮容量（人數、流量）與覆蓋 */
  Wifi.autoPlan = (fid, model) => {
    const f = G.BLD.byId[fid];
    const ft = G.FT[f.type];
    const L = G.Layout.get(f.type);
    const m = CAT.aps[model];
    /* 大廳的訪客、餐廳的用餐人潮、停車場的上下班人潮都要算進容量 */
    const guests = (ft.guestPeak || 0) + (ft.diners || 0) + (ft.parkPeak || 0);
    const clients = f.staff * ((1 - ft.wired) + ft.phones) + guests;
    const perUser = ft.inet[0] + ft.inet[1] + ft.intra[0] + ft.intra[1];
    const demand = f.staff * (1 - ft.wired) * perUser * 1.3 + guests * 1.5;
    const nCap = Math.ceil(clients / (m.maxClients * 0.7));
    const nThr = Math.ceil(demand / (m.cap * 0.42));
    const n = Math.max(6, nCap, nThr);
    const rows = Math.max(2, Math.round(Math.sqrt(n / 2)));
    const cols = Math.ceil(n / rows);
    const out = [];
    const used = new Set();
    for (let r = 0; r < rows; r++) {
      const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
      for (let c = 0; c < inRow; c++) {
        const tx = Math.floor(((c + 0.5) / inRow) * L.W);
        const ty = Math.floor(((r + 0.5) / rows) * L.H);
        const p = nearestPlaceable(L, tx, ty, used);
        if (p) { used.add(p.x + ',' + p.y); out.push(p); }
      }
    }
    /* 補強：牆多的樓層（主管室、會議室）在訊號最差、人最多的位置補 AP，直到良好覆蓋 ≥ 93% */
    const cells = L.W * L.H;
    const best = new Float32Array(cells).fill(-120);
    const addMap = (p) => { const mp = apMap(f.type, p.x, p.y, m.tx); for (let i = 0; i < cells; i++) if (mp[i] > best[i]) best[i] = mp[i]; };
    out.forEach(addMap);
    /* 餐廳：用餐區（人潮分布）和廚房（員工分布）一樣重要；停車場以人潮為主 */
    const wcOf = coverWeight(f.type);
    const wt = (i) => wcOf(L.occ[i], L.guest[i]);
    const goodCov = () => { let g = 0; for (let i = 0; i < cells; i++) if (best[i] >= Wifi.TH.good) g += wt(i); return g; };
    for (let extra = 0; extra < 10 && goodCov() < 0.93; extra++) {
      let worst = -1, ww = 0;
      for (let i = 0; i < cells; i++) {
        if (best[i] >= Wifi.TH.good || wt(i) <= 0) continue;
        const w = wt(i) * (Wifi.TH.good - best[i]);
        if (w > ww) { ww = w; worst = i; }
      }
      if (worst < 0) break;
      const p = nearestPlaceable(L, worst % L.W, Math.floor(worst / L.W), used);
      if (!p) break;
      used.add(p.x + ',' + p.y);
      out.push(p);
      addMap(p);
    }
    return out;
  };
  function nearestPlaceable(L, x, y, used) {
    for (let rad = 0; rad < 20; rad++) {
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const px = x + dx, py = y + dy;
          if (G.Layout.canPlaceAp(L, px, py) && !used.has(px + ',' + py)) return { x: px, y: py };
        }
      }
    }
    return null;
  }
})(window.G = window.G || {});
