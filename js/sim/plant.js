/* 廠務（第十一章）：晶圓廠的電力、純水與廢水、氣體與排氣、化學品、FMCS 廠務監控
 * - 第十一章開始時，晶圓廠還靠統包商的臨時供應（臨時電源、純水車、鋼瓶車、化學品桶槽）；統包商撤場（tempUntil）之後，就全靠你建的廠務系統。
 * - 每個製程區要用到的供應（CAT.plant.area）只要有一項不足，這一區就跟著減產或停線：Fab.measure 會乘上 Plant.areaAvail()。
 * - 電力：主變壓器（長期負載九成）要大於需量，而且要 N+1；台電停電時，接在 DUPS 後面的製程區照常生產，其他區停線；
 *   電壓驟降時，沒有 DUPS 的區跳機，要重新開機、升溫、校正（擴散爐管要 4 小時），製程中的晶圓報廢。
 * - 配電盤 DP-UT1（js/sim/panel.js）帶著純水泵、排氣風機、洗滌塔、化學品泵浦、特殊氣體櫃與 GDS：迴路沒電，那套系統就停。
 * - 純水：RO → 純水槽 → 拋光迴路 → 機台；RO 停了，純水槽還能撐一陣子。
 * - FMCS：每一套廠務設備都有 PLC，接在 FAB IDF 的交換器上（佔埠），用 Modbus / BACnet 送到 FMCS 伺服器（OT 區）。
 * s.plant = { on, t0, tempUntil, eq: { 設備: [完工時間…] }, dupsOn: { 製程區: bool }, trip: { 製程區: 恢復時間 }, tank, grid, src, panel, stats }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Plant = {};
  G.Plant = Plant;
  const PC = () => CAT.plant;
  const ok = (msg) => ({ ok: true, msg }), err = (msg) => ({ ok: false, msg });
  const changed = () => G.bus.emit('change', { what: 'plant' });
  const SG = ['etch', 'dep', 'clean', 'dope'];
  Plant.SG = SG;
  const AREAS = () => Object.keys(CAT.fab.areas);

  Plant.newState = () => ({ on: false, t0: 0, tempUntil: 0, eq: {}, dupsOn: {}, trip: {}, tank: 70, grid: { st: 'ok', since: 0 }, src: { N: true, E: true }, panel: null, stats: { sags: 0, outages: 0, scrap: 0 } });
  Plant.ensure = () => {
    const s = G.S;
    if (!s) return;
    if (!s.plant) s.plant = Plant.newState();
    if (!s.plant.panel) s.plant.panel = G.Panel.newState();
    PW = null;
  };
  Plant.active = () => !!(G.S && G.S.plant && G.S.plant.on);
  /** 還在用統包商的臨時供應 */
  Plant.temp = () => Plant.active() && G.S.time < G.S.plant.tempUntil;

  /* ---------- 設備：每一項都是完工時間的清單（可以買好幾組） ---------- */
  Plant.def = (k) => PC().eq[k.indexOf('gc:') === 0 ? 'gc' : k];
  Plant.label = (k) => (k.indexOf('gc:') === 0 ? `${PC().sg[k.slice(3)].name}櫃` : Plant.def(k).name);
  Plant.count = (k) => { const P = G.S && G.S.plant; if (!P || !P.eq[k]) return 0; const t = G.S.time; return P.eq[k].filter((x) => x <= t).length; };
  Plant.total = (k) => { const P = G.S && G.S.plant; return P && P.eq[k] ? P.eq[k].length : 0; };
  Plant.building = (k) => Plant.total(k) - Plant.count(k);
  Plant.readyAt = (k) => { const P = G.S.plant; return P.eq[k] && P.eq[k].length ? Math.max(...P.eq[k]) : 0; };
  Plant.buy = (k) => {
    const s = G.S, P = s.plant, it = Plant.def(k);
    if (!it || (k.indexOf('gc:') === 0 && !PC().sg[k.slice(3)])) return err('未知設備');
    if (!Q.unlocked(PC())) return err(`第 ${PC().unlock} 章開放`);
    if (!P.on) return err('晶圓廠的廠務還是由統包商代管');
    if (Plant.total(k) >= it.max) return err(it.max === 1 ? `${it.name}已經${Plant.building(k) ? '在施工了' : '裝好了'}` : `${Plant.label(k)}最多 ${it.max} 組`);
    if (it.needs && !Plant.total(it.needs)) return err(`要先建置${PC().eq[it.needs].name}`);
    if (!G.Act.spend(it.price, Plant.label(k))) return err(`預算不足：需要 ${U.money(it.price)}`);
    (P.eq[k] = P.eq[k] || []).push(s.time + it.buildMin);
    G.Act.log(`廠務：${Plant.label(k)} 開始施工（約 ${U.dur(it.buildMin)}）`, 'info');
    changed();
    return ok(`${Plant.label(k)}：施工中，約 ${U.dur(it.buildMin)} 後啟用`);
  };
  Plant.sell = (k) => {
    const s = G.S, list = s.plant.eq[k], it = Plant.def(k);
    if (!list || !list.length) return err('沒有可以拆的');
    if (k === 'gds' && Plant.total('eso')) return err('緊急遮斷連鎖（ESO）接在 GDS 上：要先拆 ESO');
    const t = list.pop();
    const back = Math.round(it.price * (t > s.time ? 0.8 : 0.4));
    G.Act.refund(back, `${t > s.time ? '取消' : '拆除'}${Plant.label(k)}`);
    changed();
    return ok(`${t > s.time ? '取消施工' : '拆除'}：${Plant.label(k)}（回收 ${U.money(back)}）`);
  };
  /** 配電盤迴路的負載在不在（那套設備建好了沒） */
  Plant.hasLoad = (sys) => {
    if (!sys) return true;
    switch (sys) {
      case 'ro': return Plant.count('ro') > 0;
      case 'polish': return Plant.count('polish') > 0;
      case 'scrub': return Plant.count('scrub') > 0;
      case 'chem': return Plant.count('acid') + Plant.count('solv') + Plant.count('slurry') > 0;
      case 'wwt': return Plant.count('wwt') > 0;
      case 'gas': return SG.some((g) => Plant.count('gc:' + g) > 0);
      case 'gds': return Plant.count('gds') > 0;
      default: return true;
    }
  };

  /* ---------- 需求（all = 全部機台的設計值；否則只算已連網、沒停機的機台） ---------- */
  Plant.demand = (all) => {
    const T = PC().tool, F = G.S.fab, slots = G.Fab.slots();
    const d = { kw: 0, upw: 0, bulk: 0, scrub: 0, sg: { etch: 0, dep: 0, clean: 0, dope: 0 }, areaKW: {}, areaN: {} };
    const list = F && F.tools.length ? F.tools : null;
    if (!list && !all) return d;
    (list || slots).forEach((x, i) => {
      if (!all && (x.st !== 'online' || x.down)) return;
      const ty = slots[i].type, p = T[ty], a = CAT.fab.types[ty].area;
      d.kw += p.kw; d.upw += p.upw; d.bulk += p.bulk;
      if (p.scrub) d.scrub++;
      for (const g of p.sg || []) d.sg[g]++;
      d.areaKW[a] = (d.areaKW[a] || 0) + p.kw;
      d.areaN[a] = (d.areaN[a] || 0) + 1;
    });
    /* 天車（OHT）算在自動搬運區 */
    if (d.areaN.amhs) { d.areaKW.amhs += 40; d.kw += 40; }
    return d;
  };
  /** 每一區用到哪幾類特殊氣體 */
  Plant.areaSg = (() => {
    let cache = null;
    return (a) => {
      if (!cache) { cache = {}; for (const [ty, p] of Object.entries(PC().tool)) { const ar = CAT.fab.types[ty].area; for (const g of p.sg || []) { cache[ar] = cache[ar] || []; if (!cache[ar].includes(g)) cache[ar].push(g); } } }
      return cache[a] || [];
    };
  })();
  Plant.needBulk = () => Math.ceil(Plant.demand(true).bulk / PC().eq.bulk.cap);
  Plant.needSg = (g) => Math.ceil(Plant.demand(true).sg[g] / PC().sg[g].per);
  Plant.needScrub = () => Math.ceil(Plant.demand(true).scrub / PC().eq.scrub.cap);
  Plant.needRo = () => Math.ceil(Plant.demand(true).upw / PC().eq.ro.cap);
  Plant.needPolish = () => Math.ceil(Plant.demand(true).upw / PC().eq.polish.cap);
  /** 用電（kW / kVA）：製程機台 + 空調冰水 + 大宗氣體站的空壓機 + 配電盤 DP-UT1 + 照明資訊 */
  Plant.load = (all) => {
    const d = Plant.demand(all), b = PC().base;
    const bulkN = all ? Math.max(Plant.total('bulk'), Plant.needBulk()) : Plant.count('bulk');
    const panelKW = all ? G.Panel.kw() : G.Panel.kwRunning();
    const kw = d.kw + b.hvac + b.misc + bulkN * b.bulkKW + panelKW;
    return { kw, kva: kw / PC().pf, proc: d.kw, areaKW: d.areaKW, panelKW, hvac: b.hvac, misc: b.misc, bulkKW: bulkN * b.bulkKW };
  };
  /** 需要幾台主變壓器（不含備援） */
  Plant.needTx = () => Math.ceil(Plant.load(true).kva / (PC().eq.tx.kva * PC().txLoad));
  /** DUPS：保護哪幾個製程區（有 DUPS 時，配電盤的緊急電源區也由它供電），容量夠不夠 */
  Plant.dups = () => {
    const P = G.S.plant, cap = Plant.count('dups') * PC().eq.dups.kva;
    const d = Plant.demand(true);
    let kva = cap > 0 ? G.Panel.kw('E') / 0.85 : 0;
    const areas = [];
    for (const a of AREAS()) if (P.dupsOn[a]) { kva += (d.areaKW[a] || 0) / PC().pf; areas.push(a); }
    return { cap, kva, areas, ok: cap > 0 && kva <= cap, over: cap > 0 && kva > cap };
  };
  Plant.setDups = (a, on) => {
    const P = G.S.plant;
    P.dupsOn[a] = !!on;
    changed();
    const D = Plant.dups();
    return D.over ? err(`${CAT.fab.areas[a].name}接上 DUPS 之後超過容量（${U.num(Math.round(D.kva))} / ${U.num(D.cap)} kVA）：DUPS 會過載跳到旁路，什麼都保護不了`) : ok(`${CAT.fab.areas[a].name}：${on ? '接到 DUPS（電壓驟降、停電時照常運轉）' : '改回一般電源'}`);
  };
  /** 緊急發電機：要撐得起緊急電源區（配電盤）+ 無塵室的緊急照明、排煙與資訊設備 */
  Plant.gen = () => {
    const kw = Plant.count('gen') * PC().eq.gen.kw;
    const need = Math.round(G.Panel.kw('E') + PC().base.life);
    return { kw, need, ok: kw >= need };
  };

  /* ---------- 電力 ---------- */
  let PW = null;
  function powerNow(s, mods) {
    const P = s.plant, t = s.time, temp = t < P.tempUntil;
    const f2 = Plant.count('feeder2') > 0;
    const grid = mods.fabGrid || 'ok';
    const out = grid === 'out' && !f2;
    const txN = Math.max(0, Plant.count('tx') - (mods.fabTxOut || 0));
    const normal = (temp || txN > 0) && !out;
    const D = Plant.dups(), g = Plant.gen();
    /* 發電機大約 1 分鐘後才接手；容量不夠就過載跳脫 */
    const genRun = out && g.kw > 0 && g.ok && t - (P.grid.since || t) >= 1;
    const emerg = D.ok || normal || genRun;
    const cap = temp ? Infinity : txN * PC().eq.tx.kva * PC().txLoad;
    /* 先定好「哪一區有電」，再算實際負載（負載要看配電盤的迴路有沒有電，會回頭問電源狀態） */
    PW = { temp, f2, grid, out, txN, normal, emerg, dups: D, gen: g, genRun, load: null, cap, shed: 1 };
    const load = Plant.load(false);
    PW.load = load;
    PW.shed = load.kva > 0 && cap < load.kva ? Math.max(0, cap / load.kva) : 1;
    return PW;
  }
  Plant.pw = () => PW || powerNow(G.S, G.R.mods || {});
  /** 讀檔之後、還沒跑過一分鐘：先算一次電力與供應（不推進時間，純水槽不變） */
  Plant.refresh = () => {
    if (!Plant.active()) { G.R.plant = null; PW = null; return; }
    PW = null;
    powerNow(G.S, G.R.mods || {});
    measure(G.S, G.R.mods || {}, true);
  };
  /** 配電盤進線的上游有沒有電：一般電源 = 台電 + 主變壓器；緊急電源 = DUPS，或經 ATS 由一般電源 / 發電機供電 */
  Plant.busSource = (bus) => { if (!Plant.active()) return false; const p = Plant.pw(); return bus === 'N' ? p.normal : p.emerg; };
  /** FAB IDF 的交換器（有自己的 UPS）：晶圓廠有電就有電 */
  Plant.idfLive = () => { if (!Plant.active()) return true; const p = Plant.pw(); return p.normal || p.emerg; };
  /** 電壓驟降、停電、切換回路的瞬間：沒有 DUPS 撐住的製程區跳機，馬達失壓脫扣 */
  function applyTrip(s, kind) {
    const P = s.plant, t = s.time, D = Plant.dups(), d = Plant.demand(false);
    const producing = !!G.R.fab && G.R.fab.rate > 0;
    const hit = [];
    let scrap = 0;
    for (const a of AREAS()) {
      if (!d.areaN[a] || (D.ok && P.dupsOn[a])) continue;
      P.trip[a] = Math.max(P.trip[a] || 0, t + PC().recover[a]);
      hit.push(a);
      if (producing) scrap += PC().wip[a];
    }
    const delay = Plant.fmcs().ok ? 5 : 30;
    G.Panel.dropout('N', t + delay);
    if (!D.ok) G.Panel.dropout('E', t + delay);
    if (kind === 'out') P.stats.outages++; else P.stats.sags++;
    if (scrap && s.fab) { s.fab.scrap += scrap; P.stats.scrap += scrap; }
    if (hit.length) s.rating = Math.max(0, s.rating - 2);
    const K = { sag: '電壓驟降', transfer: '台電線路故障，切換到第二回路的瞬間電壓驟降', out: '台電停電' };
    const names = hit.map((a) => CAT.fab.areas[a].name).join('、');
    const text = hit.length ? `${K[kind]}：${names}跳機${scrap ? `，製程中的晶圓報廢約 ${scrap} 片` : ''}` : `${K[kind]}：接在 DUPS 的製程區都撐住了`;
    G.Act.log(text, hit.length ? 'bad' : 'good');
    G.bus.emit('notice', { kind: hit.length ? 'bad' : 'good', text, goto: 'plant:power' });
    return hit;
  }

  /* ---------- FMCS ---------- */
  /** PLC 數量（每一套廠務設備一台，加上配電盤的電力監控）：接在 FAB IDF 的交換器上 */
  Plant.plcCount = () => {
    if (!Plant.active()) return 0;
    let n = 1;
    for (const k of ['ro', 'polish', 'upwmon', 'reclaim', 'wwt', 'bulk', 'gds', 'eso', 'scrub', 'acid', 'solv', 'slurry', 'leak', 'dups', 'gen']) if (Plant.total(k)) n++;
    for (const g of SG) if (Plant.total('gc:' + g)) n++;
    return n;
  };
  /** FMCS 看不看得到廠務設備：伺服器在、網路通（FAB → FMCS 的 Modbus / BACnet）、PLC 盤有電 */
  Plant.fmcs = () => {
    const srv = Q.roleServers('fmcs').filter((d) => (d.rack || d.host) && G.Net.devUp(d));
    const net = !!(G.R.fab && G.R.fab.fmcs);
    const plc = Plant.active() && G.Panel.running('PLC');
    return { srv: srv.length, net, plc, ok: srv.length > 0 && net && plc };
  };

  /* ---------- 每分鐘（Net.simulate 之前） ---------- */
  Plant.tick = (s) => {
    const P = s.plant;
    if (!P) return;
    if (!P.on) {
      /* 沙盒：晶圓廠開廠時一起接手（統包商的臨時供應撐到機台都進廠之後） */
      if (s.mode === 'sandbox' && s.fab && s.fab.open) {
        Plant.begin(s, { tempUntil: G.Fab.workday(s.time, 5) + 8 * 60 });
        G.Act.log('晶圓廠廠務：統包商的臨時供應撐到 ' + U.stamp(P.tempUntil) + '，之前要建好永久的電力、純水、氣體與化學品系統', 'warn');
        G.bus.emit('notice', { kind: 'warn', text: `晶圓廠的廠務由你接手：統包商的臨時供應撐到 ${U.stamp(P.tempUntil)}`, goto: 'plant' });
      } else { G.R.plant = null; PW = null; return; }
    }
    const t = s.time, mods = G.R.mods || {};
    /* 設備完工 */
    for (const [k, list] of Object.entries(P.eq)) {
      if (!list.includes(t)) continue;
      G.Act.log(`廠務：${Plant.label(k)} 完工啟用`, 'good');
      G.bus.emit('notice', { kind: 'good', text: `${Plant.label(k)} 完工啟用`, goto: 'plant' });
      changed();
    }
    /* 統包商撤場 */
    if (t === P.tempUntil - 240) G.bus.emit('notice', { kind: 'warn', text: '統包商 4 小時後撤場：臨時電源、純水車、鋼瓶車都會撤走', goto: 'plant' });
    if (t === P.tempUntil) {
      G.Act.log('統包商撤場：晶圓廠的電、水、氣體與化學品，從現在起全靠你的廠務系統', 'warn');
      G.bus.emit('notice', { kind: 'warn', text: '統包商撤場：臨時供應結束，晶圓廠改由你的廠務系統供應', goto: 'plant' });
      changed();
    }
    /* 電網：驟降、停電 / 切換、變壓器故障 */
    const prev = P.grid.st, gridNow = mods.fabGrid || 'ok';
    if (gridNow !== prev) { P.grid.st = gridNow; P.grid.since = t; }
    PW = powerNow(s, mods);
    if (gridNow !== prev && (gridNow === 'sag' || gridNow === 'out')) applyTrip(s, gridNow === 'sag' ? 'sag' : PW.f2 ? 'transfer' : 'out');
    /* 停電結束：沒有 DUPS 的區從現在起重新開機 */
    if (prev === 'out' && gridNow !== 'out' && !PW.f2) {
      const D = PW.dups, d = Plant.demand(false);
      for (const a of AREAS()) if (d.areaN[a] && !(D.ok && P.dupsOn[a])) P.trip[a] = Math.max(P.trip[a] || 0, t + PC().recover[a]);
      G.Act.log('台電復電：製程區開始重新開機、升溫、校正', 'info');
    }
    /* 電源恢復 → 馬達要重新起動（FMCS 依序自動復歸約 5 分鐘；沒有 FMCS 要人工一台一台復歸，約 30 分鐘） */
    for (const b of ['N', 'E']) {
      const live = Plant.busSource(b);
      if (P.src[b] === false && live) G.Panel.dropout(b, t + (Plant.fmcs().ok ? 5 : 30));
      P.src[b] = live;
    }
    G.Panel.tick(s);
    measure(s, mods);
  };

  /** 第十一章開始（或沙盒開廠）：統包商的臨時供應撐到 tempUntil；配電盤是統包商剛配好線、還沒送電的樣子 */
  Plant.begin = (s, opt) => {
    opt = opt || {};
    const P = s.plant;
    if (P.on) return;
    P.on = true; P.t0 = s.time;
    P.tempUntil = opt.tempUntil || (G.Fab.workday(s.time, 2) + 8 * 60);
    P.panel = G.Panel.newState();
    P.tank = PC().tank * 0.6;
    P.grid = { st: 'ok', since: s.time };
    P.src = { N: true, E: true };
    PW = null;
    changed();
  };

  /* ---------- 供應計算 ---------- */
  function measure(s, mods, dry) {
    const P = s.plant, t = s.time, pw = PW, temp = pw.temp;
    const d = Plant.demand(false), dAll = Plant.demand(true);
    /* 純水：RO → 純水槽 → 拋光迴路；限水時沒有回收水只剩七成的原水 */
    const drought = mods.drought ? (Plant.count('reclaim') ? 1 : 0.7) : 1;
    const roCap = Plant.count('ro') * PC().eq.ro.cap, polCap = Plant.count('polish') * PC().eq.polish.cap;
    const roRate = roCap * G.Panel.sys('ro') * drought;
    const polOut = polCap * G.Panel.sys('polish');
    const dem = d.upw;
    const avail = P.tank > 0.5 ? polOut : Math.min(polOut, roRate);
    const deliver = Math.min(dem, avail);
    if (!dry) P.tank = U.clamp(P.tank + (roRate - deliver) / 60, 0, PC().tank);
    const upwBad = mods.upwBad || 0;
    const water = {
      demand: dem, need: dAll.upw, roCap, roRate, roF: G.Panel.sys('ro'), polCap, polOut, polF: G.Panel.sys('polish'), deliver, tank: P.tank, tankCap: PC().tank,
      ratio: dem > 0 ? deliver / dem : 1, resist: polCap > 0 ? 18.2 - upwBad * 3.2 : 0, bad: upwBad, drought: !!mods.drought, reclaim: Plant.count('reclaim') > 0,
      mon: Plant.count('upwmon') > 0, wwt: Plant.count('wwt') ? G.Panel.sys('wwt') : 0, city: dem * (Plant.count('reclaim') ? 0.55 : 1.35),
    };
    /* 氣體：大宗氣體要有空壓機（一般電源）；特殊氣體要 GDS（工安規定）、氣瓶櫃有電；GDS 斷電時 ESO 失效安全關閉 */
    const bulkCap = Plant.count('bulk') * PC().eq.bulk.cap * (pw.normal ? 1 : 0);
    const gdsOk = Plant.count('gds') > 0, eso = Plant.count('eso') > 0, gdsRun = G.Panel.factor('GDS') > 0;
    const gate = !gdsOk ? 0 : eso && !gdsRun ? 0 : 1;
    const gcPow = G.Panel.sys('gas');
    const sg = {};
    for (const g of SG) {
      const need = d.sg[g], have = Plant.count('gc:' + g) * PC().sg[g].per;
      sg[g] = { need, have, tools: dAll.sg[g], cab: Plant.count('gc:' + g), needCab: Math.ceil(dAll.sg[g] / PC().sg[g].per), ratio: need > 0 ? Math.min(1, have / need) * gate * gcPow * (mods.sgOut === g ? 0 : 1) : 1, out: mods.sgOut === g };
    }
    const scrubCap = Plant.count('scrub') * PC().eq.scrub.cap;
    const gas = {
      bulkDemand: d.bulk, bulkNeed: dAll.bulk, bulkCap, bulk: d.bulk > 0 ? Math.min(1, bulkCap / d.bulk) : 1,
      gds: gdsOk, eso, gdsRun, gate, gcPow, sg,
      scrubNeed: d.scrub, scrubCap, scrub: d.scrub > 0 ? Math.min(1, scrubCap / d.scrub) * G.Panel.sys('scrub') : 1,
      exh: G.Panel.sys('exh'), ef: { EF1: G.Panel.factor('EF1'), EF2: G.Panel.factor('EF2') },
    };
    /* 化學品：供應系統建好、化學品泵浦有電 */
    const cds = G.Panel.sys('chem');
    const chem = { acid: Plant.count('acid') ? cds : 0, solv: Plant.count('solv') ? cds : 0, slurry: Plant.count('slurry') ? cds : 0, cds, leak: Plant.count('leak') > 0 };
    /* 每一區的供應：電力（跳電重開、停電、變壓器卸載）× 各項廠務供應（臨時供應期間由統包商包辦） */
    const util = (u, a) => {
      switch (u) {
        case 'upw': return water.ratio;
        case 'bulk': return gas.bulk;
        case 'sg': return Math.min(1, ...Plant.areaSg(a).map((g) => gas.sg[g].ratio));
        case 'scrub': return gas.scrub;
        case 'exh': return gas.exh;
        case 'acid': case 'solv': case 'slurry': return chem[u];
        case 'wwt': return water.wwt;
        default: return 1;
      }
    };
    const U_NAME = { upw: '純水', bulk: '大宗氣體', sg: '特殊氣體', scrub: '洗滌塔', exh: '排氣', acid: '酸鹼化學品', solv: '溶劑 / 顯影液', slurry: '研磨液', wwt: '廢水處理' };
    const D = pw.dups;
    const areaF = {}, areaWhy = {}, areaU = {};
    for (const a of AREAS()) {
      const prot = D.ok && P.dupsOn[a];
      const why = [];
      let pwr = 1;
      if ((P.trip[a] || 0) > t) { pwr = 0; why.push(`跳電後重新開機中（還要 ${U.dur(P.trip[a] - t)}）`); }
      else if (!pw.normal && !prot) { pwr = 0; why.push('停電'); }
      else if (!prot && pw.shed < 1) { pwr = pw.shed; why.push('變壓器容量不足，卸載'); }
      let f = pwr;
      const us = { pwr };
      for (const u of PC().area[a]) {
        const v = temp ? 1 : util(u, a);
        us[u] = v;
        if (v < 0.995) why.push(`${U_NAME[u]} ${U.pct(v)}`);
        f = Math.min(f, v);
      }
      areaF[a] = f; areaWhy[a] = why; areaU[a] = us;
    }
    /* 告警 */
    const al = [];
    const A = (sev, tab, text) => al.push({ sev, tab, text });
    const sv = temp ? 'warn' : 'crit';
    if (temp) A('info', 'ov', `統包商的臨時供應到 ${U.stamp(P.tempUntil)}（剩 ${U.dur(P.tempUntil - t)}）：之後就靠你的廠務系統`);
    if (!temp && pw.txN === 0) A('crit', 'power', '沒有主變壓器：晶圓廠沒有電');
    else if (pw.shed < 1) A('crit', 'power', `主變壓器容量不足：需量 ${U.num(Math.round(pw.load.kva))} kVA，容量 ${U.num(Math.round(pw.cap))} kVA，製程區卸載`);
    if (pw.out) A('crit', 'power', pw.emerg ? '台電停電：緊急電源供電中' : '台電停電：緊急電源也沒電！排氣與氣體偵測都停了');
    const tripped = AREAS().filter((a) => (P.trip[a] || 0) > t);
    if (tripped.length) A('crit', 'power', `${tripped.map((a) => CAT.fab.areas[a].name).join('、')}：跳電後重新開機中`);
    if (D.over) A('warn', 'power', `DUPS 過載（${U.num(Math.round(D.kva))} / ${U.num(D.cap)} kVA）：保護不了任何負載`);
    const pn = G.Panel.st();
    if (!pn.inc.N.on || !pn.inc.E.on) A(sv, 'panel', '配電盤 DP-UT1 還沒送電：純水泵、排氣風機、洗滌塔、化學品泵浦都沒電');
    for (const x of G.Panel.DEF) { const c = pn.cir[x.id]; if (c.trip) A('crit', 'panel', `${x.id} ${x.name}：斷路器跳脫`); }
    if (water.ratio < 0.95 && dem > 0) A(sv, 'water', `純水供應 ${water.deliver.toFixed(0)} / 需求 ${dem.toFixed(0)} m³/h`);
    if (water.roF > 0 && water.roF < 0.5) A('warn', 'water', 'RO 產水量只有三成多：高壓泵可能在反轉（量相序）');
    if (water.tank < PC().tank * 0.25 && roCap > 0) A('warn', 'water', `純水槽只剩 ${U.pct(water.tank / PC().tank)}`);
    if (upwBad > 0.05) A('crit', 'water', `超純水電阻率降到 ${water.resist.toFixed(1)} MΩ·cm：晶圓缺陷增加`);
    if (!water.wwt && d.areaN.cmp) A(sv, 'water', '廢水處理沒有運轉：CMP 與濕式清洗不能生產');
    if (!gdsOk) A(sv, 'gas', '沒有氣體偵測系統：特殊氣體不准供氣');
    else if (eso && !gdsRun) A('crit', 'gas', 'GDS 主機沒電：緊急遮斷閥自動關閉，特殊氣體全部停止供應');
    for (const g of SG) if (gas.sg[g].need > 0 && gas.sg[g].ratio < 0.995 && gdsOk) A(sv, 'gas', `${PC().sg[g].name}供應 ${U.pct(gas.sg[g].ratio)}（氣瓶櫃 ${gas.sg[g].cab} / 需要 ${gas.sg[g].needCab}）`);
    if (gas.bulk < 0.995) A(sv, 'gas', `大宗氣體供應 ${U.pct(gas.bulk)}`);
    if (gas.scrub < 0.995 && d.scrub) A(sv, 'gas', `洗滌塔 ${U.pct(gas.scrub)}：有毒廢氣處理不完`);
    if (gas.exh < 0.995) A(sv, 'gas', `排氣風量只剩 ${U.pct(gas.exh)}`);
    for (const k of ['acid', 'solv', 'slurry']) if (chem[k] < 0.995) A(sv, 'chem', `${PC().eq[k].name}${Plant.count(k) ? '沒有運轉（化學品泵浦沒電）' : '還沒建置'}`);
    const fm = Plant.fmcs();
    G.R.plant = {
      on: true, temp, tempUntil: P.tempUntil, power: pw, water, gas, chem, areaF, areaWhy, areaU, alarms: al, fmcs: fm,
      yieldLoss: temp ? 0 : upwBad * 0.08, tripped,
    };
  }
  /** Fab.measure 用：每一區的廠務供應比例（沒有啟動廠務時是 null） */
  Plant.areaAvail = () => (Plant.active() && G.R.plant ? G.R.plant.areaF : null);
  Plant.yieldLoss = () => (Plant.active() && G.R.plant ? G.R.plant.yieldLoss : 0);
  /** 產線是不是因為廠務停下來（報修、評價用） */
  Plant.stopWhy = () => {
    const R = G.R.plant;
    if (!R) return null;
    const bad = AREAS().filter((a) => R.areaF[a] < 0.5 && (Plant.demand(false).areaN[a] || 0) > 0);
    return bad.length ? `${bad.map((a) => CAT.fab.areas[a].name).join('、')}：${R.areaWhy[bad[0]][0] || '廠務供應中斷'}` : null;
  };
})(window.G = window.G || {});
