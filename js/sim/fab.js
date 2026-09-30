/* 晶圓廠 Fab 1（第十章）：機台進廠、進廠掃毒、連網、自動化與產能；無塵室的手機管制
 * - 機台由原廠來裝機（install），裝好後要先在「進廠掃毒站」掃過（SEMI E188），才能接上 FAB IDF 的交換器（每台 1～2 個埠）；
 *   沒有掃毒站的話只能等，或是「略過掃毒直接連網」——原廠的筆電、USB 帶著惡意程式進來的風險就由你承擔。
 * - 產出 = 各製程區（黃光、蝕刻、薄膜……）裡「正在生產」的機台比例，取最慢的那一區（瓶頸）
 *          × MES 可用 × 工單（MES ⇄ ERP）× 現場手持裝置 × 工程師看得到 MES；連得上 EAP 的機台才是自動化（連不上只能人工，產能剩四成）。
 *   良率看 FDC 的感測資料有沒有送到（沒有 FDC，製程偏移要等量測才發現，整批報廢）。
 * - 網路流量（Net.simulate 呼叫 Fab.flows / Fab.measure）：機台 → EAP（SECS/GEM）、機台 → FDC、EAP → MES、手持裝置 → MES（Wi-Fi）、
 *   總部研發樓層的工程師 → MES（LAN → OT：WEB）、MES → ERP（OT → SERVERS：SQL）
 * - 手機管制：允許私人手機 → 有機密外洩與手機熱點的風險；禁止 → 要安檢門 + 置物櫃，並配發無相機的公司手持裝置（連無塵室的 OT Wi-Fi）
 * s.fab = { open, tools: [{ st, at, done, scan, scanUntil, inf, down }], kiosk, gate, allow（完工時間，0 = 沒買）, phone, hand, out, good, scrap, day }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Fab = {};
  G.Fab = Fab;
  const FID = 'FAB';
  Fab.FID = FID;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = (what) => G.bus.emit('change', { what: what || 'fab', fid: FID });

  const CODE = { scanner: 'SCN', track: 'TRK', etch: 'ETC', cvd: 'CVD', pvd: 'PVD', ald: 'ALD', furnace: 'FUR', rtp: 'RTP', implant: 'IMP', cmp: 'CMP', wet: 'WET', cdsem: 'SEM', thick: 'THK', overlay: 'OVL', inspect: 'INS', stocker: 'STK' };
  /** 機台狀態的中文 */
  Fab.ST = { coming: '尚未進廠', install: '原廠裝機中', scan: '等待進廠掃毒', ready: '等待接上網路', online: '已連網' };

  Fab.newState = () => ({ open: false, tools: [], kiosk: 0, gate: 0, allow: 0, phone: 'allow', hand: 0, out: 0, good: 0, scrap: 0, day: { out: 0, good: 0 }, outage: false });
  /** 機台位置（平面圖上的靜態資料）與規格 */
  Fab.slots = () => G.Layout.get('fab').tools;
  Fab.type = (i) => CAT.fab.types[Fab.slots()[i].type];
  Fab.area = (i) => Fab.type(i).area;
  Fab.active = () => !!(G.S && G.S.fab && G.S.fab.open);
  Fab.portsTotal = () => U.sum(Fab.slots(), (t) => CAT.fab.types[t.type].ports);
  /** 機台代號：同一種機台依序編號，例如 ETC-07 */
  const codes = (() => {
    let cache = null;
    return () => {
      if (cache) return cache;
      const n = {};
      cache = Fab.slots().map((t) => { n[t.type] = (n[t.type] || 0) + 1; return `${CODE[t.type]}-${String(n[t.type]).padStart(2, '0')}`; });
      return cache;
    };
  })();
  Fab.code = (i) => codes()[i];
  Fab.name = (i) => `${Fab.code(i)} ${Fab.type(i).name}`;
  Fab.tools = () => (G.S && G.S.fab ? G.S.fab.tools : []);
  Fab.floorUp = () => G.Net.floorUp(FID);

  /* ---------- 設施 ---------- */
  const readyOf = (k) => { const F = G.S.fab; return !!F && F[k] > 0 && G.S.time >= F[k]; };
  Fab.kioskReady = () => readyOf('kiosk');
  Fab.gateReady = () => readyOf('gate');
  Fab.allowReady = () => readyOf('allow');
  Fab.building = (k) => { const F = G.S.fab; return !!F && F[k] > 0 && G.S.time < F[k]; };
  /** 需要的公司手持裝置：每班操作員一人一台（約編制的六成） */
  Fab.handNeed = () => Math.ceil(G.BLD.byId[FID].staff * 0.6);

  /* ---------- 開廠：排定機台進廠時程 ----------
   * 第一天：倉儲、黃光、量測；第一天下午：蝕刻；第二天：薄膜、CMP；第二天下午：擴散、薄膜二；第三天：植入、蝕刻二 */
  const WAVES = [['S5', 'N1', 'S2'], ['N2'], ['N3', 'S1'], ['N4', 'S4'], ['N5', 'S3']];
  /** 從 t 算起第 n 個工作天的 09:00 */
  Fab.workday = (t, n) => { let x = t; for (let i = 0; i < n; i++) x = U.nextWeekdayAt(x, 9, 1); return x; };
  Fab.begin = (s, opt) => {
    opt = opt || {};
    const F = s.fab;
    if (F.open && F.tools.length) return;
    F.open = true;
    /* 接下來連續三個工作天的早上 09:00（週末開始也一樣是三個工作天） */
    const d1 = Fab.workday(s.time, 1), d2 = Fab.workday(s.time, 2), d3 = Fab.workday(s.time, 3);
    const fs = s.floors[FID];
    if (fs.movedIn === 0 && fs.moveInAt === null) fs.moveInAt = d1 - 60;
    const waveAt = [d1, d1 + 300, d2, d2 + 300, d3];
    const slots = Fab.slots();
    F.tools = slots.map(() => ({ st: 'coming', at: 0, done: 0, scan: null, scanUntil: 0, inf: false, down: false }));
    WAVES.forEach((bays, w) => {
      let k = 0;
      slots.forEach((t, i) => { if (bays.includes(t.bay)) F.tools[i].at = waveAt[w] + (k++) * 12; });
    });
    /* 原廠的安裝媒體（筆電、USB）偶爾會帶著惡意程式：劇情模式固定有一台（第三天進廠的蝕刻機） */
    F.tools.forEach((x) => { x.inf = Math.random() < 0.03; });
    if (opt.scripted) {
      const i = slots.findIndex((t) => t.bay === 'S3' && t.type === 'etch');
      if (i >= 0) F.tools[i].inf = true;
    }
    G.R.topoVer++;
  };

  /* ---------- 玩家動作 ---------- */
  const FACI = { kiosk: CAT.fab.kiosk, gate: CAT.fab.gate, allow: CAT.fab.allowlist };
  Fab.buy = (k) => {
    const s = G.S, F = s.fab, it = FACI[k];
    if (!it) return err('未知項目');
    if (!Q.unlocked(CAT.fab)) return err(`第 ${CAT.fab.unlock} 章解鎖`);
    if (F[k] > 0) return err(`${it.name}已經${s.time < F[k] ? '在施工了' : '裝好了'}`);
    if (!G.Act.spend(it.price, it.name)) return err(`預算不足：需要 ${U.money(it.price)}`);
    F[k] = s.time + it.buildMin;
    changed();
    return ok(`${it.name}：施工中，約 ${U.dur(it.buildMin)} 後啟用`);
  };
  /** 無塵室的手機政策：ban = 私人手機一律鎖在置物櫃（要先有安檢門與置物櫃） */
  Fab.setPhone = (mode) => {
    const F = G.S.fab;
    if (mode === F.phone) return ok('');
    if (mode === 'ban' && !Fab.gateReady()) return err(Fab.building('gate') ? '安檢門與置物櫃還在施工' : '先裝好安檢門與手機置物櫃，才能落實禁止私人手機');
    F.phone = mode;
    changed();
    return ok(mode === 'ban' ? '無塵室禁止私人手機：一律鎖在更衣室的置物櫃，進出都要過安檢門' : '無塵室允許私人手機（有機密外洩的風險）');
  };
  Fab.setHand = (n) => {
    const F = G.S.fab;
    n = U.clamp(n | 0, 0, 400);
    if (n === F.hand) return ok('');
    const p = CAT.fab.handheld.price;
    if (n > F.hand) { const c = (n - F.hand) * p; if (!G.Act.spend(c, `公司手持裝置 × ${n - F.hand}`)) return err(`預算不足：需要 ${U.money(c)}`); }
    else G.Act.refund((F.hand - n) * p * 0.4, `回收公司手持裝置 × ${F.hand - n}`);
    F.hand = n;
    changed();
    return ok(`無相機的公司手持裝置：${n} 台`);
  };
  /** 拆掉原廠遠端維修時接在機台上的 4G 分享器 */
  Fab.removeG4 = () => {
    const F = G.S.fab;
    if (F.g4 === undefined || F.g4 === null) return err('機台上沒有 4G 分享器');
    const c = Fab.code(F.g4);
    F.g4 = null;
    /* 還沒發作的後門就此關閉 */
    for (const it of G.S.sched) if (!it.fired && it.type === 'fab-malware' && it.data && it.data.via === '4g') it.fired = true;
    G.Act.log(`拆除 ${c} 上的 4G 分享器`, 'good');
    changed();
    return ok(`已拆除 ${c} 上的 4G 分享器：這個繞過防火牆的後門關閉了`);
  };
  /** 沒有掃毒站、又急著生產：略過掃毒直接接上網路（風險自負） */
  Fab.skipScan = (i) => {
    const F = G.S.fab;
    const list = i === 'all' ? F.tools.map((x, k) => k).filter((k) => F.tools[k].st === 'scan' && !F.tools[k].scanUntil) : [i];
    let n = 0;
    for (const k of list) {
      const x = F.tools[k];
      if (!x || x.st !== 'scan' || x.scanUntil) continue;
      x.scan = 'skip'; x.st = 'ready'; n++;
    }
    if (!n) return err('沒有等待掃毒的機台');
    G.Act.log(`略過進廠掃毒：${n} 台機台直接接上 OT 網路`, 'warn');
    changed();
    return ok(`${n} 台機台略過掃毒，直接接上網路（原廠的安裝媒體有沒有帶毒，就不知道了）`);
  };
  /** 略過掃毒的機台：斷線回到掃毒站重掃（帶毒的會在這時被抓到） */
  Fab.rescan = () => {
    const F = G.S.fab;
    if (!Fab.kioskReady()) return err(Fab.building('kiosk') ? '進廠掃毒站還在施工' : '先建置機台進廠掃毒站');
    let n = 0;
    for (const x of F.tools) if (x.scan === 'skip' && (x.st === 'online' || x.st === 'ready')) { x.st = 'scan'; x.scan = null; x.scanUntil = 0; n++; }
    if (!n) return err('沒有略過掃毒的機台');
    G.Act.log(`${n} 台略過掃毒的機台斷線，回到進廠掃毒站重掃`, 'info');
    G.R.topoVer++;
    changed();
    return ok(`${n} 台機台斷線重掃：掃完會自動接回網路`);
  };

  /* ---------- 每分鐘 ---------- */
  Fab.tick = (s) => {
    const F = s.fab;
    if (!F) return;
    if (!F.open) {
      /* 沙盒模式：總部所有樓層進駐完的那天早上宣布開廠 */
      if (s.mode === 'sandbox' && s.time >= SANDBOX_OPEN) { Fab.begin(s); G.Act.log('Fab 1 晶圓廠完工：明天起機台陸續進廠', 'info'); G.bus.emit('notice', { kind: 'info', text: 'Fab 1 晶圓廠完工：明天起機台陸續進廠，每一台都要連上網路', goto: 'fab' }); }
      return;
    }
    const t = s.time, fs = s.floors[FID];
    for (const [k, it] of Object.entries(FACI)) if (F[k] > 0 && F[k] === t) { G.Act.log(`${it.name}完工啟用`, 'good'); G.bus.emit('notice', { kind: 'good', text: `${it.name}完工啟用`, goto: 'fab' }); changed(); }
    /* 事件應變時決定禁止私人手機：安檢門完工就生效 */
    if (F.phoneWant && Fab.gateReady()) { F.phoneWant = false; F.phone = 'ban'; G.Act.log('安檢門完工：無塵室開始禁止私人手機', 'good'); changed(); }
    let scanning = F.tools.filter((x) => x.st === 'scan' && x.scanUntil > t).length;
    const kiosk = Fab.kioskReady();
    let moved = false;
    F.tools.forEach((x, i) => {
      if (x.st === 'coming' && x.at && t >= x.at) { x.st = 'install'; x.done = t + Fab.type(i).install; moved = true; }
      else if (x.st === 'install' && t >= x.done) { x.st = 'scan'; moved = true; }
      else if (x.st === 'scan') {
        if (x.scanUntil && t >= x.scanUntil) {
          x.scanUntil = 0; x.scan = 'ok'; x.st = 'ready'; moved = true;
          if (x.inf) {
            x.inf = false; x.caught = true;
            G.Act.log(`進廠掃毒站在 ${Fab.name(i)} 的原廠安裝媒體裡抓到惡意程式，已清除後才接上網路`, 'good');
            G.bus.emit('notice', { kind: 'good', text: `掃毒站攔下 ${Fab.code(i)} 的原廠 USB 裡的惡意程式`, goto: 'fab' });
            s.rating = Math.min(100, s.rating + 1);
          }
        } else if (!x.scanUntil && kiosk && scanning < CAT.fab.kiosk.slots) { x.scanUntil = t + CAT.fab.kiosk.scanMin; scanning++; }
      }
    });
    /* 接上交換器：AP 先接，剩下的埠依序給機台（控制室的 MES 終端機排最後）；交換器變少時，最後接上的機台先拔掉 */
    const cabled = fs.cabling.status === 'done' && fs.idf.count > 0;
    const cap = cabled ? Math.max(0, Q.floorPorts(FID) - fs.aps.length) : 0;
    let used = Fab.portsUsed();
    if (used > cap) {
      for (let i = F.tools.length - 1; i >= 0 && used > cap; i--) {
        const x = F.tools[i];
        if (x.st !== 'online') continue;
        x.st = 'ready'; used -= Fab.type(i).ports; moved = true;
      }
    }
    F.tools.forEach((x, i) => {
      if (x.st !== 'ready' || !cabled) return;
      const p = Fab.type(i).ports;
      if (used + p > cap) return;
      x.st = 'online'; x.onAt = t; used += p; moved = true;
      /* 帶毒的機台接上網路：過一陣子就發作 */
      if (x.inf && !F.malAt) { F.malAt = t + 30 + Math.floor(Math.random() * 60); F.malTool = i; }
    });
    if (F.malAt && t >= F.malAt) {
      F.malAt = 0;
      /* 發作前就斷線重掃、清掉了：沒事 */
      const x = F.tools[F.malTool];
      if (x && x.inf && x.st === 'online' && !G.Ev.active().some((inc) => inc.type === 'fab-malware')) G.Ev.start('fab-malware', { tool: F.malTool });
    }
    if (moved) { G.R.topoVer++; changed(); }
    /* 產出累計（Net.simulate 算好的 G.R.fab） */
    const R = G.R.fab;
    if (R && R.rate > 0) {
      const w = R.rate / 1440;
      F.out += w; F.good += w * R.yield; F.day.out += w; F.day.good += w * R.yield;
    }
    /* 網路或 MES 中斷、產線突然停下來：正在爐管 / 蝕刻腔體裡的晶圓報廢 */
    if (R) {
      if (R.itStop && F.lastRate > 60 && !F.outage) {
        const n = Math.round(F.lastRate / 1440 * 90);
        F.scrap += n; F.outage = true;
        s.rating = Math.max(0, s.rating - 2);
        G.Act.log(`晶圓廠停線（${R.itStop}）：製程中的晶圓報廢約 ${n} 片`, 'bad');
        G.bus.emit('notice', { kind: 'bad', text: `晶圓廠停線：${R.itStop}，約 ${n} 片晶圓報廢`, goto: 'fab' });
      } else if (!R.itStop && R.rate > 0) F.outage = false;
      F.lastRate = R.rate;
    }
  };

  /* ---------- 網路流量（Net.simulate 裡呼叫） ---------- */
  Fab.flows = (g, flows, st, nid, up) => {
    const s = G.S, F = s.fab;
    if (!F || !F.open) return null;
    const ctx = { eap: {}, fdc: {}, eapMes: [], hand: null, eng: [], erp: [], n: {} };
    const zs = G.Net.ruleZone(nid);
    const slots = Fab.slots();
    if (up) {
      const by = {};
      F.tools.forEach((x, i) => {
        if (x.st !== 'online' || x.down) return;
        const a = CAT.fab.types[slots[i].type].area;
        (by[a] = by[a] || []).push(i);
      });
      for (const [a, ids] of Object.entries(by)) {
        const n = ids.length;
        const fl = { id: nid + '>EAP:' + a, stage: 1, kind: 'secs', floor: FID, area: a, src: nid, dst: 'ROLE:eap', fwd: 0.04 * n, rev: 0.03 * n, zs, zd: null, svc: ['SECS'], n };
        flows.push(fl); ctx.eap[a] = fl;
        const mb = U.sum(ids, (i) => CAT.fab.types[slots[i].type].fdc);
        const f2 = { id: nid + '>FDC:' + a, stage: 3, kind: 'fdc', floor: FID, area: a, src: nid, dst: 'ROLE:fdc', fwd: mb, rev: mb * 0.02, zs, zd: null, svc: ['SECS'] };
        flows.push(f2); ctx.fdc[a] = f2;
        ctx.n[a] = n;
      }
      /* 現場手持裝置 → MES（查批號、叫天車）：要有 Wi-Fi 訊號 */
      const users = F.phone === 'ban' ? Math.min(F.hand, st.present) : 0;
      if (users > 0.5) {
        const cov = st.wifi ? st.wifi.usable || 0 : 0;
        const hf = { id: nid + '>MES:hand', stage: 1, kind: 'hand', floor: FID, src: nid, dst: 'ROLE:mes', fwd: users * cov * 0.02, rev: users * cov * 0.05, zs, zd: null, svc: ['WEB'] };
        flows.push(hf); ctx.hand = hf;
        /* AP 負載（簡化：手持裝置照 AP 覆蓋的比例分配） */
        const tot = st.wifi ? st.wifi.cover : 0;
        for (const ap of st.wifi ? st.wifi.aps : []) {
          const w = tot > 0 ? ap.w / tot : 0;
          const cl = users * cov * w, dem = cl * 0.07;
          st.apStats[ap.id] = { clients: cl, load: ap.capEff > 0 ? dem / ap.capEff : 0, cap: ap.capEff, demand: dem };
        }
      }
    }
    /* 廠務（第十一章）：配電盤、純水、氣體、化學品的 PLC → FMCS（Modbus TCP / BACnet，都在 OT 區） */
    const plc = G.Plant ? G.Plant.plcCount() : 0;
    if (up && plc > 0) {
      const fl = { id: nid + '>FMCS', stage: 3, kind: 'fmcs', floor: FID, src: nid, dst: 'ROLE:fmcs', fwd: 0.02 * plc, rev: 0.01 * plc, zs, zd: null, svc: ['SCADA'] };
      flows.push(fl); ctx.fmcs = fl;
    }
    /* EAP → MES（機台事件、上下貨、配方）；MES → ERP（工單與出貨） */
    for (const d of Q.roleServers('eap')) {
      if (!g.nodes.has(d.id)) continue;
      const fl = { id: 'eap>mes:' + d.id, stage: 1, kind: 'fab', src: d.id, dst: 'ROLE:mes', fwd: 0.3, rev: 0.3, zs: G.Net.ruleZone(d.id), zd: null, svc: ['SQL'] };
      flows.push(fl); ctx.eapMes.push(fl);
    }
    for (const d of Q.roleServers('mes')) {
      if (!g.nodes.has(d.id)) continue;
      const fl = { id: 'mes>erp:' + d.id, stage: 3, kind: 'fab', src: d.id, dst: 'ROLE:db', fwd: 0.4, rev: 0.6, zs: G.Net.ruleZone(d.id), zd: null, svc: ['SQL'] };
      flows.push(fl); ctx.erp.push(fl);
    }
    /* 總部研發樓層的製程工程師：在辦公室看 MES 報表、良率（LAN → OT：WEB） */
    const fabOn = st.present > 1 || F.tools.some((x) => x.st === 'online');
    if (fabOn) {
      for (const f of G.BLD.hq) {
        if (f.type !== 'rnd' || G.S.floors[f.id].movedIn <= 0 || !g.nodes.has('F:' + f.id)) continue;
        const pres = G.S.floors[f.id].movedIn * G.Net.presence(s.time, f.type);
        if (pres < 5) continue;
        const fl = { id: 'F:' + f.id + '>MES', stage: 2, kind: 'fabeng', floor: f.id, src: 'F:' + f.id, dst: 'ROLE:mes', fwd: pres * 0.002, rev: pres * 0.02, zs: 'LAN', zd: null, svc: ['WEB'] };
        flows.push(fl); ctx.eng.push(fl);
      }
    }
    return ctx;
  };

  const ratio = (f) => (!f || f.blocked ? 0 : f.fwd + f.rev > 0 ? (f.dFwd + f.dRev) / (f.fwd + f.rev) : 1);
  /** 路由之後：自動化、MES、工單、FDC、產能與良率 */
  Fab.measure = (ctx, st, g) => {
    const s = G.S, F = s.fab;
    if (!F || !F.open || !ctx) { G.R.fab = null; return null; }
    const slots = Fab.slots(), T = CAT.fab.types;
    const total = {}, run = {}, auto = {};
    let online = 0, down = 0, arrived = 0;
    const fsUp = !!st && st.up;
    const staffIn = s.floors[FID].movedIn > 0;
    /* EAP 容量：一台約管 40 台機台 */
    const eapN = Q.roleServers('eap').filter((d) => g.nodes.has(d.id)).length;
    const eapCap = eapN * CAT.roles.eap.capTools;
    let secsTools = 0;
    for (const a of Object.keys(ctx.eap)) if (ratio(ctx.eap[a]) > 0.9) secsTools += ctx.n[a] || 0;
    const eapF = secsTools > 0 ? Math.min(1, eapCap / secsTools) : 0;
    F.tools.forEach((x, i) => {
      const a = T[slots[i].type].area;
      total[a] = (total[a] || 0) + 1;
      if (x.st !== 'coming' && x.st !== 'install') arrived++;
      if (x.down) down++;
      if (x.st !== 'online' || x.down) return;
      online++;
      if (!fsUp) return;
      const e = ratio(ctx.eap[a]) > 0.9;
      run[a] = (run[a] || 0) + (e ? eapF + (1 - eapF) * 0.4 : 0.4);
      if (e) auto[a] = (auto[a] || 0) + 1;
    });
    const areas = {};
    let base = Infinity;
    /* 廠務（第十一章）：每一區的電力、純水、氣體、化學品供應比例 */
    const PA = G.Plant ? G.Plant.areaAvail() : null;
    for (const a of Object.keys(CAT.fab.areas)) {
      const n = total[a] || 0;
      if (!n) continue;
      const pa = PA ? PA[a] : 1;
      const r = (run[a] || 0) / n * pa;
      areas[a] = { total: n, run: r, auto: auto[a] || 0, eap: ratio(ctx.eap[a]), plant: pa };
      base = Math.min(base, r);
    }
    if (!isFinite(base)) base = 0;
    const mesUp = g.nodes.has('ROLE:mes') && ctx.eapMes.some((f) => !f.blocked);
    const erpOk = ctx.erp.some((f) => !f.blocked);
    const engOk = !ctx.eng.length || ctx.eng.every((f) => !f.blocked);
    /* 現場手持裝置：允許私人手機時大家用自己的手機（LINE 群組）溝通；禁止後要有公司手持裝置 + Wi-Fi 才查得到 MES */
    let handF = 1, handR = 1;
    if (F.phone === 'ban') {
      handR = Math.min(1, F.hand / Fab.handNeed()) * (ctx.hand ? ratio(ctx.hand) : 0) * (st && st.wifi ? U.clamp((st.wifi.usable || 0) / 0.9, 0, 1) : 0);
      handF = 0.88 + 0.12 * handR;
    }
    let fdcOff = 0, fdcDel = 0;
    for (const f of Object.values(ctx.fdc)) { fdcOff += f.fwd; fdcDel += f.blocked ? 0 : f.dFwd; }
    const fdcR = fdcOff > 0 ? fdcDel / fdcOff : 0;
    const factor = (mesUp ? 1 : 0) * (erpOk ? 1 : 0.75) * handF * (engOk ? 1 : 0.95);
    const rate = staffIn ? CAT.fab.wspd * base * factor : 0;
    /* 超純水水質變差（第十一章）：晶圓表面的缺陷增加 */
    const yld = 0.84 + 0.095 * fdcR - (G.Plant ? G.Plant.yieldLoss() : 0);
    /* 是不是「IT 造成的」停線：機台都接好了，卻因為網路 / MES 停下來 */
    let itStop = null;
    if (online > 0 && staffIn) {
      if (!fsUp) itStop = 'FAB 網路中斷';
      else if (!mesUp) itStop = 'MES 連不上';
    }
    const plantStop = online > 0 && staffIn && G.Plant ? G.Plant.stopWhy() : null;
    const R = { rate, yield: yld, base, factor, areas, online, down, arrived, total: F.tools.length, mesUp, erpOk, engOk, eapN, eapCap, eapF, secsTools, handF, handR, fdcR, itStop, up: fsUp,
      auto: U.sum(Object.values(auto), (x) => x), fmcs: !!ctx.fmcs && !ctx.fmcs.blocked, plantStop };
    G.R.fab = R;
    if (st) { st.fab = R; st.present = st.present || 0; }
    return R;
  };

  /* ---------- 查詢 ---------- */
  /** 每台機台目前的狀況（介面用） */
  Fab.info = (i) => {
    const s = G.S, x = s.fab.tools[i], slot = Fab.slots()[i], d = CAT.fab.types[slot.type];
    const R = G.R.fab;
    const eapOk = !!R && !!R.areas[d.area] && R.areas[d.area].eap > 0.9;
    /* 廠務（第十一章）：這一區的電、水、氣、化學品供應 */
    const pa = R && R.areas[d.area] && R.areas[d.area].plant !== undefined ? R.areas[d.area].plant : 1;
    const run = x.st === 'online' && !x.down && !!R && R.up && pa >= 0.5;
    return { i, code: Fab.code(i), name: Fab.name(i), def: d, slot, x, run, eapOk, area: CAT.fab.areas[d.area].name, plant: pa,
      status: x.down ? (x.down === 'vendor' ? '故障停機（等原廠診斷）' : '中毒停機') : x.st === 'online' ? (!R || !R.up ? '網路中斷' : pa < 0.5 ? '停線：廠務供應中斷' : eapOk ? '自動化生產中' : '連不上 EAP（人工操作）') : x.st === 'scan' && x.scanUntil ? '掃毒中' : x.st === 'ready' && x.scan === 'skip' ? '等待接上網路（未掃毒）' : Fab.ST[x.st] };
  };
  /** 各狀態的機台數 */
  Fab.counts = () => {
    const out = { coming: 0, install: 0, scan: 0, ready: 0, online: 0, down: 0, skipped: 0 };
    for (const x of Fab.tools()) { out[x.st]++; if (x.down) out.down++; if (x.scan === 'skip' && (x.st === 'online' || x.st === 'ready')) out.skipped++; }
    return out;
  };
  /** 機台所需的交換器埠（已接上 / 全部） */
  Fab.portsUsed = () => { let u = 0; Fab.tools().forEach((x, i) => { if (x.st === 'online') u += Fab.type(i).ports; }); return u; };
  /** 廠房的工程進度（0 = 空地、1 = 完工開廠）：
   * 沙盒模式照天數（第 6 天早上完工）；劇情模式第四章動工，每一章蓋一段，第九章結束時接近完工、第十章開廠 */
  Fab.buildProgress = () => {
    const s = G.S;
    if (!s || !s.fab) return 0;
    if (s.fab.open) return 1;
    if (s.scen) return 0;
    if (s.mode === 'sandbox') return U.clamp((s.time - U.at(1, 8)) / (SANDBOX_OPEN - U.at(1, 8)), 0.03, 0.97);
    if (s.mode !== 'campaign' || s.chapter < 3) return 0;
    const inCh = Math.min(1, Math.max(0, s.time - (s.chapterStart || s.time)) / 4320);
    return U.clamp((s.chapter - 3 + inCh) / 6, 0.03, 0.97);
  };
  /** 預計完工（顯示用） */
  Fab.buildEta = () => (G.S && G.S.mode === 'sandbox' ? `預計第 ${U.dayOf(SANDBOX_OPEN)} 天早上完工，隔天起機台陸續進廠` : '第十章完工啟用：62 台製程機台都要連上網路');
  /** 每天的良品帶給 IT 部門的預算 */
  Fab.dailyIncome = () => (G.S && G.S.fab ? G.S.fab.day.good * CAT.fab.wafer : 0);
  Fab.resetDay = () => { if (G.S.fab) G.S.fab.day = { out: 0, good: 0 }; };
  /** 讀檔：舊存檔補上晶圓廠；沙盒模式在所有樓層進駐之後開廠 */
  Fab.ensure = () => {
    const s = G.S;
    if (!s) return;
    if (!s.fab) s.fab = Fab.newState();
  };
  const SANDBOX_OPEN = U.at(6, 8);
})(window.G = window.G || {});
