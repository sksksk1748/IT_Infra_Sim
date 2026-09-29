/* 自己布線（DIY 水平布線）：不發包，由 IT 團隊自己施工
 * ① 拉線：在平面圖上從 IDF 畫出走線路徑到每個配線區（避開電力線槽：平行太長會有串音干擾；永久鏈路 ≤ 90 m）
 * ② 端接：資訊插座與配線架依 T568B 色序打線（小遊戲）
 * ③ 認證測試：接線圖（wire map）、長度、近端串音（NEXT）全部 PASS 才算完工
 * 比發包便宜（只要材料費 + 一次性的工具組），但要花時間、也要做對。
 * fs.cabling = { std, status: 'diy', readyAt: 0, diy: { zones: { [zid]: { path, len, emi, pullAt, redo } }, term, tested, results } }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const Diy = {};
  G.Diy = Diy;

  /* T568B 色序（1～8）；T568A 把橙、綠兩對對調 */
  Diy.WIRES = { wo: '白橙', o: '橙', wg: '白綠', bl: '藍', wbl: '白藍', g: '綠', wbr: '白棕', br: '棕' };
  Diy.T568B = ['wo', 'o', 'wg', 'bl', 'wbl', 'g', 'wbr', 'br'];
  Diy.T568A = ['wg', 'g', 'wo', 'bl', 'wbl', 'o', 'wbr', 'br'];
  Diy.COLORS = { wo: ['#f4f4f0', '#f08a24'], o: ['#f08a24'], wg: ['#f4f4f0', '#2f9e44'], bl: ['#2d6fd6'], wbl: ['#f4f4f0', '#2d6fd6'], g: ['#2f9e44'], wbr: ['#f4f4f0', '#8b5a2b'], br: ['#8b5a2b'] };
  /* 電力線槽：沿著樓層中段東西向（核心筒兩側），網路線平行靠近會被干擾 */
  Diy.POWER_Y = 17;
  const BAND = 1, EMI_RUN = 5, MAX_LEN = 90;

  /* ---------- 配線區：把樓層切成 4 × 2 塊，有座位 / 人潮的區塊就是一個配線區 ---------- */
  const zoneCache = {};
  Diy.zones = (type) => {
    if (zoneCache[type]) return zoneCache[type];
    const L = G.Layout.get(type), T = L.T, W = L.W, H = L.H;
    const XS = [1, 18, 36, 54, W - 1], YS = [1, 18, H - 1];
    const out = [];
    let tot = 0;
    for (let by = 0; by < 2; by++) {
      for (let bx = 0; bx < 4; bx++) {
        let w = 0, sx = 0, sy = 0;
        for (let y = YS[by]; y < YS[by + 1]; y++) for (let x = XS[bx]; x < XS[bx + 1]; x++) {
          const i = y * W + x, k = L.occ[i] + L.guest[i];
          w += k; sx += k * x; sy += k * y;
        }
        if (w < 0.004) continue;
        const t = nearestFree(L, Math.round(sx / w), Math.round(sy / w), XS[bx], YS[by], XS[bx + 1] - 1, YS[by + 1] - 1);
        out.push({ id: 'z' + (out.length + 1), n: out.length + 1, x0: XS[bx], y0: YS[by], x1: XS[bx + 1] - 1, y1: YS[by + 1] - 1, tx: t.x, ty: t.y, w });
        tot += w;
      }
    }
    for (const z of out) z.share = z.w / tot;
    zoneCache[type] = out;
    return out;
  };
  function nearestFree(L, x, y, x0, y0, x1, y1) {
    for (let r = 0; r < 20; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = x + dx, py = y + dy;
        if (px < x0 || px > x1 || py < y0 || py > y1) continue;
        const t = L.type[py * L.W + px];
        if (t !== L.T.WALL && t !== L.T.GLASS && t !== L.T.CORE && t !== L.T.IDF && t !== L.T.EXT && t !== L.T.PILLAR && t !== L.T.COLD && t !== L.T.WC) return { x: px, y: py };
      }
    }
    return { x, y };
  }
  /** 每個配線區的資訊點數（依座位 / 人潮比例分配整層的資訊點） */
  Diy.drops = (fid) => {
    const f = G.BLD.byId[fid], total = G.Act.floorDrops(fid), zs = Diy.zones(f.type);
    const raw = zs.map((z) => z.share * total), out = raw.map(Math.floor);
    let left = total - U.sum(out, (x) => x);
    raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
    const m = {};
    zs.forEach((z, i) => { m[z.id] = out[i]; });
    return m;
  };

  /* ---------- 路徑 ---------- */
  /** 天花板上可以走線的格子：外牆、核心筒不行；只有 IDF 緊貼核心筒外牆的那幾格可以開孔出線 */
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  Diy.passable = (L, x, y) => {
    if (x < 0 || y < 0 || x >= L.W || y >= L.H) return false;
    const T = L.T, t = L.type[y * L.W + x];
    if (t === T.EXT || t === T.WC) return false;
    if (t === T.CORE) {
      const nb = (dx, dy) => { const nx = x + dx, ny = y + dy; return nx < 0 || ny < 0 || nx >= L.W || ny >= L.H ? T.EXT : L.type[ny * L.W + nx]; };
      return N4.some(([dx, dy]) => nb(dx, dy) === T.IDF) && N4.some(([dx, dy]) => { const q = nb(dx, dy); return q !== T.CORE && q !== T.IDF && q !== T.EXT && q !== T.WC; });
    }
    return true;
  };
  /** 兩格之間最短的可走線路徑（拖曳時游標跳太快、或擋到核心筒時，自動沿著可以走的格子補上） */
  Diy.bridge = (L, from, to, avoid) => {
    const W = L.W, s0 = from[1] * W + from[0], goal = to[1] * W + to[0];
    if (!Diy.passable(L, to[0], to[1])) return null;
    const prev = new Map([[s0, -1]]), q = [s0];
    for (let qi = 0; qi < q.length && q.length < 3000; qi++) {
      const c = q[qi];
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of N4) {
        const nx = cx + dx, ny = cy + dy, ni = ny * W + nx;
        if (prev.has(ni) || !Diy.passable(L, nx, ny) || (avoid && avoid.has(ni))) continue;
        prev.set(ni, c);
        q.push(ni);
      }
    }
    if (!prev.has(goal)) return null;
    const out = [];
    for (let c = goal; c !== s0; c = prev.get(c)) out.push([c % W, (c / W) | 0]);
    return out.reverse();
  };
  Diy.inBand = (L, x, y) => Math.abs(y - Diy.POWER_Y) <= BAND && (x < 28 || x > 43);
  /** 分析一條路徑：長度、跟電力線槽平行的最長距離 */
  Diy.analyze = (fid, zid, path) => {
    const f = G.BLD.byId[fid], L = G.Layout.get(f.type);
    const z = Diy.zones(f.type).find((q) => q.id === zid);
    let run = 0, maxRun = 0;
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i];
      if (y0 === y1 && Diy.inBand(L, x1, y1) && Diy.inBand(L, x0, y0)) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
    }
    /* 永久鏈路長度 = 天花板上的路徑 + IDF 端與插座端上下 7 m + 從集合點到區域內最遠的插座 */
    const reach = z ? Math.max(Math.abs(z.x0 - z.tx), Math.abs(z.x1 - z.tx)) + Math.max(Math.abs(z.y0 - z.ty), Math.abs(z.y1 - z.ty)) : 0;
    const len = Math.max(0, path.length - 1) + 7 + reach;
    return { len, emi: maxRun, lenOk: len <= MAX_LEN, emiOk: maxRun < EMI_RUN };
  };
  /** 自動規劃：最短路徑，但沿著電力線槽走的格子成本很高（會繞開） */
  Diy.autoPath = (fid, zid) => {
    const f = G.BLD.byId[fid], L = G.Layout.get(f.type);
    const z = Diy.zones(f.type).find((q) => q.id === zid);
    if (!z) return null;
    const W = L.W, n = W * L.H, dist = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    const s0 = L.idf.y * W + L.idf.x, goal = z.ty * W + z.tx;
    dist[s0] = 0;
    const open = [s0];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      const c = open.splice(bi, 1)[0];
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!Diy.passable(L, nx, ny)) continue;
        const ni = ny * W + nx;
        const cost = 1 + (dy === 0 && Diy.inBand(L, nx, ny) ? 6 : 0);
        if (dist[c] + cost < dist[ni]) { if (dist[ni] === Infinity) open.push(ni); dist[ni] = dist[c] + cost; prev[ni] = c; }
      }
    }
    if (prev[goal] < 0 && goal !== s0) return null;
    const out = [];
    for (let c = goal; c >= 0; c = prev[c]) { out.push([c % W, (c / W) | 0]); if (c === s0) break; }
    return out.reverse();
  };

  /* ---------- 施工流程 ---------- */
  Diy.kitOwned = () => !!(G.S.flags && G.S.flags.diyKit);
  Diy.cost = (fid, std) => G.Act.floorDrops(fid) * CAT.horizontal[std].diyPerDrop + (Diy.kitOwned() ? 0 : CAT.diyKit);
  Diy.job = (fid) => { const c = G.S.floors[fid].cabling; return c.status === 'diy' ? c.diy : null; };
  Diy.start = (fid, std) => {
    const s = G.S, fs = s.floors[fid];
    if (fs.cabling.status !== 'none') return { ok: false, msg: '這層樓已經有布線工程了' };
    const cost = Diy.cost(fid, std);
    if (!G.Act.spend(cost, `${fid} 自己布線的材料費（${CAT.horizontal[std].name}）${Diy.kitOwned() ? '' : '＋布線工具組'}`)) return { ok: false, msg: `預算不足（需要 ${U.money(cost)}）` };
    s.flags.diyKit = true;
    const zones = {};
    for (const z of Diy.zones(G.BLD.byId[fid].type)) zones[z.id] = { path: null, len: 0, emi: 0, pullAt: 0, redo: false };
    fs.cabling = { std, status: 'diy', readyAt: 0, diy: { zones, term: null, tested: false, results: null, started: s.time } };
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, msg: `${fid} 自己布線開始：先在平面圖上從 IDF 畫出到每個配線區的走線路徑` };
  };
  /** 拉線要花時間：IT 團隊一次拉一個區域（依資訊點數），排在前一個區域之後 */
  const pullMin = (drops) => Math.round(20 + drops * 0.35);
  Diy.setRoute = (fid, zid, path) => {
    const s = G.S, job = Diy.job(fid);
    if (!job || !job.zones[zid]) return { ok: false, msg: '沒有這個配線區' };
    const f = G.BLD.byId[fid], L = G.Layout.get(f.type), z = Diy.zones(f.type).find((q) => q.id === zid);
    if (!path || path.length < 2) return { ok: false, msg: '路徑太短' };
    const [sx, sy] = path[0];
    if (L.type[sy * L.W + sx] !== L.T.IDF) return { ok: false, msg: '線要從 IDF 弱電室拉出去' };
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1], [bx, by] = path[i];
      if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1 || !Diy.passable(L, bx, by)) return { ok: false, msg: '路徑穿過了核心筒或外牆' };
    }
    const [ex, ey] = path[path.length - 1];
    if (ex < z.x0 || ex > z.x1 || ey < z.y0 || ey > z.y1) return { ok: false, msg: `路徑要拉到配線區 ${z.n} 裡面` };
    const et = L.type[ey * L.W + ex];
    if (et === L.T.CORE || et === L.T.IDF || et === L.T.WC) return { ok: false, msg: '線還在核心筒裡：從 IDF 的西側或南側牆面出線，再拉到配線區' };
    const a = Diy.analyze(fid, zid, path);
    const zr = job.zones[zid];
    const queueEnd = Math.max(s.time, ...Object.values(job.zones).map((q) => q.pullAt || 0));
    Object.assign(zr, { path: path.map((p) => [p[0], p[1]]), len: a.len, emi: a.emi, pullAt: queueEnd + pullMin(Diy.drops(fid)[zid]), redo: false });
    job.tested = false; job.results = null;
    G.bus.emit('change', { kind: 'floor', fid });
    const warn = !a.emiOk ? `（⚠ 和電力線槽平行 ${a.emi} m，可能會有干擾）` : !a.lenOk ? `（⚠ 最遠的插座 ${a.len} m，超過 90 m）` : '';
    return { ok: true, msg: `配線區 ${z.n}：路徑 ${a.len} m，拉線約 ${U.dur(zr.pullAt - s.time)} 後完成${warn}` };
  };
  Diy.autoAll = (fid) => {
    const job = Diy.job(fid);
    if (!job) return { ok: false, msg: '沒有進行中的自己布線' };
    let n = 0;
    for (const zid of Object.keys(job.zones)) if (!job.zones[zid].path) { const p = Diy.autoPath(fid, zid); if (p && Diy.setRoute(fid, zid, p).ok) n++; }
    return { ok: true, msg: n ? `其餘 ${n} 個配線區已沿著避開電力線槽的路線開始拉線` : '每個配線區都已經有路徑了' };
  };
  Diy.progress = (fid) => {
    const job = Diy.job(fid), t = G.S.time;
    if (!job) return null;
    const zs = Object.values(job.zones);
    return { total: zs.length, routed: zs.filter((z) => z.path).length, pulled: zs.filter((z) => z.path && t >= z.pullAt).length, term: job.term, tested: job.tested, results: job.results };
  };
  /** 端接：order 是 8 條芯線的排列（1～8） */
  Diy.terminate = (fid, order) => {
    const job = Diy.job(fid), p = Diy.progress(fid);
    if (!job) return { ok: false, msg: '沒有進行中的自己布線' };
    if (p.pulled < p.total) return { ok: false, msg: '還有配線區的線沒拉完，拉完才能打線' };
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    job.term = eq(order, Diy.T568B) ? 'ok' : eq(order, Diy.T568A) ? 'crossed' : 'miswire';
    for (const z of Object.values(job.zones)) z.redo = false;
    job.tested = false; job.results = null;
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, msg: `${fid} 的資訊插座與配線架打線完成，接下來用測試儀驗證` };
  };
  /** 認證測試：每個配線區抽測；全部 PASS 就完工 */
  Diy.test = (fid) => {
    const s = G.S, fs = s.floors[fid], job = Diy.job(fid), p = Diy.progress(fid);
    if (!job) return { ok: false, msg: '沒有進行中的自己布線' };
    if (!job.term) return { ok: false, msg: '還沒打線：先完成端接' };
    const f = G.BLD.byId[fid], zs = Diy.zones(f.type);
    const first = !job.results;
    const results = zs.map((z) => {
      const zr = job.zones[z.id];
      const a = Diy.analyze(fid, z.id, zr.path);
      /* 第一次測試有小機率某一區打線不良（斷路），重新端接那一區就好 */
      if (first && job.term === 'ok' && Math.random() < 0.08) zr.redo = true;
      const map = job.term === 'ok' && !zr.redo;
      return { zid: z.id, n: z.n, len: a.len, lenOk: a.lenOk, emi: a.emi, emiOk: a.emiOk, map, why: map ? '' : job.term === 'crossed' ? '線對交叉（這是 T568A 的色序）' : job.term === 'miswire' ? '接線錯誤（色序不對）' : '斷路：有一芯沒有打好', pass: map && a.lenOk && a.emiOk };
    });
    job.results = results;
    job.tested = true;
    const bad = results.filter((r) => !r.pass);
    if (!bad.length) {
      fs.cabling = { std: fs.cabling.std, status: 'done', readyAt: s.time, diy: null, self: true };
      G.Act.log(`${fid} 自己布線完工：${p.total} 個配線區全部通過認證測試`, 'good');
      G.bus.emit('notice', { kind: 'good', text: `${fid} 自己布線完工，全部 PASS！`, goto: 'floor:' + fid });
      G.bus.emit('change', { kind: 'floor', fid });
      return { ok: true, pass: true, results, msg: `${fid} 全部 PASS：水平布線完工` };
    }
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, pass: false, results, msg: `${bad.length} 個配線區 FAIL：看測試報告修正後再測一次` };
  };
  /** 修正：重拉某一區的線（清掉路徑）或重新端接某一區 */
  Diy.redoZone = (fid, zid) => {
    const job = Diy.job(fid);
    if (!job || !job.zones[zid]) return { ok: false, msg: '沒有這個配線區' };
    Object.assign(job.zones[zid], { path: null, len: 0, emi: 0, pullAt: 0 });
    job.tested = false; job.results = null;
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, msg: '已拆掉這一區的線，重新畫一條路徑' };
  };
  Diy.reterm = (fid, zid) => {
    const job = Diy.job(fid);
    if (!job || !job.zones[zid]) return { ok: false, msg: '沒有這個配線區' };
    job.zones[zid].redo = false;
    job.tested = false;
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, msg: '重新端接完成，再測一次' };
  };
  /** 做不完了：剩下的交給廠商（依還沒完成的比例計價與計工期） */
  Diy.toContract = (fid) => {
    const s = G.S, fs = s.floors[fid], job = Diy.job(fid);
    if (!job) return { ok: false, msg: '沒有進行中的自己布線' };
    const p = Diy.progress(fid), hz = CAT.horizontal[fs.cabling.std];
    const left = job.term ? 0.25 : 1 - (p.pulled / p.total) * 0.6;
    const cost = Math.round(G.Act.cablingCost(fid, fs.cabling.std) * left);
    if (!G.Act.spend(cost, `${fid} 剩下的布線交給廠商`)) return { ok: false, msg: `預算不足（需要 ${U.money(cost)}）` };
    fs.cabling = { std: fs.cabling.std, status: 'building', readyAt: s.time + Math.round(hz.buildMin * left), diy: null };
    G.bus.emit('change', { kind: 'floor', fid });
    return { ok: true, msg: `廠商接手，約 ${U.dur(fs.cabling.readyAt - s.time)} 後完工` };
  };
})(window.G = window.G || {});
