/* 儲存與備份：公司資料量（依部門類型成長）、儲存池（NAS、SAN + 擴充櫃、主機本機）、RAID 與容量、
 * 備份排程與保存天數、每一次備份工作的結果、3-2-1 原則（異地：磁帶保管 / 雲端）、還原演練、RPO。
 * G.R.stor = { pools, data, backupTB, sanFull, fileFull, bkpFull, worst }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Stor = {};
  G.Stor = Stor;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = (what) => G.bus.emit('change', { what: what || 'stor' });

  /* 每人的檔案資料量（GB）：行銷設計的影片素材最可觀 */
  const GB = { office: 3, rnd: 8, creative: 25, callcenter: 1, conference: 2, exec: 4, lobby: 1, canteen: 0.5, foodcourt: 0.5 };
  const HOST_LOCAL_TB = 7;
  Stor.FAULTS = {
    cred: '備份服務帳號的密碼過期，無法登入檔案伺服器與資料庫',
    agent: '資料庫主機上的備份代理程式當掉了',
    cert: '備份伺服器的憑證過期，連線被拒絕',
  };
  Stor.FREQ = { 24: [1], 12: [1, 13], 4: [1, 5, 9, 13, 17, 21] };
  Stor.KEEP = [14, 30, 90];

  /** 公司資料量（TB） */
  Stor.data = () => {
    const s = G.S, g = 1 + 0.004 * Math.max(0, s.time / 1440);
    let file = 0;
    for (const f of G.BLD.floors) file += s.floors[f.id].movedIn * (GB[f.type] || 3) / 1000;
    file = file * g * (s.stor.snap ? 1.1 : 1) + (s.stor.extraTB || 0);
    const db = (0.8 + Q.employees() / 4000) * g;
    return { file, db };
  };
  Stor.usableOf = (d) => { const m = CAT.devices[d.model]; return (m.rawTB || 0) * CAT.raid[d.raid || 'raid6'].eff * 0.95; };
  Stor.shelves = () => Object.values(G.S.devices).filter((d) => d.rack && CAT.devices[d.model].shelf);

  /** 儲存池與資料擺放 */
  Stor.pools = () => {
    const s = G.S;
    const data = Stor.data();
    const pools = new Map();
    const sans = G.VM.san();
    if (sans.length) {
      const raid = sans[0].raid || 'raid6';
      const cap = U.sum(sans, Stor.usableOf) + U.sum(Stor.shelves(), (d) => (CAT.devices[d.model].rawTB || 0) * CAT.raid[raid].eff * 0.95);
      pools.set('san', { id: 'san', kind: 'san', name: 'SAN 共用儲存池', dev: sans[0], raid, cap, used: 0, items: {}, shelves: Stor.shelves().length });
    }
    for (const d of Object.values(s.devices)) {
      const m = CAT.devices[d.model];
      if (!d.rack || !m.rawTB || m.san || m.shelf) continue;
      pools.set(d.id, { id: d.id, kind: 'nas', name: d.name, dev: d, raid: d.raid || 'raid6', cap: Stor.usableOf(d), used: 0, items: {} });
    }
    for (const h of G.VM.hosts()) pools.set('local:' + h.id, { id: 'local:' + h.id, kind: 'local', name: `${h.name} 本機硬碟`, dev: h, raid: 'raid10', cap: HOST_LOCAL_TB, used: 0, items: {} });
    /* 放資料：實體 NAS 放在自己身上；VM 放在 SAN 或主機本機 */
    const poolOf = (d) => (d.host ? (d.disk === 'san' ? pools.get('san') : pools.get('local:' + d.host)) : pools.get(d.id));
    const put = (p, k, tb) => { if (!p || tb <= 0) return; p.items[k] = (p.items[k] || 0) + tb; p.used += tb; };
    const fileSrv = Q.roleServers('file').filter((d) => d.rack);
    for (const d of fileSrv) put(poolOf(d), '檔案資料', data.file / fileSrv.length);
    const dbSrv = Q.roleServers('db').filter((d) => d.rack && d.host);
    for (const d of dbSrv) put(poolOf(d), '資料庫', data.db / Math.max(1, Q.roleServers('db').filter((x) => x.rack).length));
    let vmOs = 0;
    for (const v of G.VM.vms()) { put(poolOf(v), 'VM 系統碟', v.diskTB || 0.2); vmOs += v.diskTB || 0.2; }
    const prot = data.file + data.db + vmOs;
    const backupTB = prot * (1 + s.bkp.keep * 0.012) / 2;
    const bkpSrv = Q.roleServers('backup').filter((d) => d.rack);
    for (const d of bkpSrv) put(poolOf(d), '備份資料', backupTB / bkpSrv.length);
    const list = Array.from(pools.values());
    for (const p of list) {
      p.ratio = p.cap > 0 ? p.used / p.cap : (p.used > 0 ? 9 : 0);
      p.lost = !!(p.dev && p.dev.lost);
      p.rebuild = p.dev && p.dev.rebuildUntil > s.time ? p.dev.rebuildUntil : 0;
      /* 每天成長 0.4%：還能撐幾天 */
      p.daysLeft = p.used > 0 && p.ratio < 1 ? Math.log(p.cap / p.used) / Math.log(1.004) : 0;
    }
    return { list, data, backupTB, prot, vmOs };
  };

  /** 每 5 分鐘重算容量 */
  Stor.update = () => {
    const P = Stor.pools();
    const holds = (p, k) => p.items[k] > 0;
    const full = (k) => P.list.some((p) => holds(p, k) && p.ratio >= 1);
    G.R.stor = {
      pools: P.list, data: P.data, backupTB: P.backupTB, prot: P.prot,
      sanFull: P.list.some((p) => p.kind === 'san' && p.ratio >= 1),
      fileFull: full('檔案資料'), bkpFull: full('備份資料'),
      worst: P.list.reduce((m, p) => Math.max(m, p.ratio), 0),
    };
    return G.R.stor;
  };
  Stor.backupTB = () => (G.R.stor ? G.R.stor.backupTB : 0);

  Stor.setRaid = (devId, raid) => {
    const s = G.S, d = s.devices[devId];
    if (!d || !CAT.raid[raid]) return err('設定錯誤');
    const m = CAT.devices[d.model];
    if (!m.rawTB || m.shelf) return err('這台設備不能設定 RAID');
    if ((d.raid || 'raid6') === raid) return ok('');
    if (d.rebuildUntil > s.time) return err('RAID 重建中，不能變更');
    const P = Stor.pools();
    const pool = P.list.find((p) => p.dev === d || (p.kind === 'san' && m.san));
    const old = d.raid || 'raid6';
    d.raid = raid;
    const cap = m.san ? Stor.pools().list.find((p) => p.kind === 'san').cap : Stor.usableOf(d);
    if (pool && pool.used > cap) { d.raid = old; return err(`改成 ${CAT.raid[raid].name} 後只剩 ${cap.toFixed(0)} TB，放不下目前的 ${pool.used.toFixed(0)} TB 資料`); }
    /* 轉換 RAID 要搬資料：一段時間效能較差 */
    d.rebuildUntil = s.time + (m.flash ? 120 : 360);
    Stor.update();
    changed();
    return ok(`${d.name} 轉換為 ${CAT.raid[raid].name}（資料在背景重新配置，約 ${U.dur(d.rebuildUntil - s.time)}）`);
  };
  Stor.setSnap = (on) => { G.S.stor.snap = !!on; Stor.update(); changed(); return ok(on ? '每小時快照已開啟：誤刪檔案幾分鐘就能救回（多用約 10% 空間）' : '快照已關閉'); };

  /* ---------- 備份 ---------- */
  Stor.setPolicy = (freq, keep) => {
    const b = G.S.bkp;
    if (freq && Stor.FREQ[freq]) b.freq = freq;
    if (keep && Stor.KEEP.includes(keep)) b.keep = keep;
    Stor.update();
    changed('bkp');
    return ok(`備份策略：每 ${b.freq} 小時一次、保存 ${b.keep} 天`);
  };
  Stor.hasTape = () => Object.values(G.S.devices).some((d) => d.rack && CAT.devices[d.model].tape && G.Net.devUp(d));
  Stor.bkpServers = () => Q.roleServers('backup').filter((d) => d.rack);
  /** 備份工作進行中（工作開始後 90 分鐘內）：網路上會有備份流量 */
  Stor.jobActive = (t) => {
    if (!Stor.bkpServers().length) return false;
    const h = U.hourOf(t);
    return Stor.FREQ[G.S.bkp.freq].some((x) => h >= x && h < x + 1.5);
  };
  /** 工作開始後第 1～4 小時：複製到異地（磁帶 / 雲端） */
  Stor.offsiteActive = (t) => {
    if (!Stor.bkpServers().length) return false;
    const h = U.hourOf(t);
    return Stor.FREQ[G.S.bkp.freq].some((x) => h >= x + 1 && h < x + 4);
  };
  function runJob() {
    const s = G.S, b = s.bkp, t = s.time;
    const srv = Stor.bkpServers();
    if (!srv.length) return;
    let ok = true, why = '';
    if (!srv.some((d) => G.Net.devUp(d))) { ok = false; why = '備份伺服器沒有運作'; }
    else if (G.R.stor && G.R.stor.bkpFull) { ok = false; why = '備份空間已滿'; }
    else if (b.fault) { ok = false; why = Stor.FAULTS[b.fault] || '備份失敗'; }
    else if (Math.random() < 0.02) { ok = false; why = '偶發錯誤：快照逾時（下一次會自動重試）'; }
    const prot = G.R.stor ? G.R.stor.prot : 0;
    const job = { t, ok, why, tb: ok ? Math.round(prot * (b.freq === 24 ? 0.03 : 0.012) * 10) / 10 : 0, tape: false, cloud: false };
    if (ok) {
      b.lastOk = t;
      if (Stor.hasTape()) { job.tape = true; b.lastTape = t; }
      const net = G.R.sim && G.R.sim.wan && G.R.sim.wan.cap > 0;
      const allowed = !G.Sec.hasFirewall() || G.Sec.allows('SERVERS', 'INTERNET', 'WEB');
      if (Q.hasService('cloudbk')) {
        if (net && allowed) { job.cloud = true; b.lastCloud = t; }
        else job.cloudWhy = !net ? '對外網路中斷' : '防火牆擋下了 SERVERS → INTERNET：WEB（HTTPS）';
      }
    }
    b.jobs.push(job);
    if (b.jobs.length > 40) b.jobs.splice(0, b.jobs.length - 40);
    /* 失敗通知：有監控（NMS / SIEM）才會變成告警；否則只記在備份報表裡 */
    const watched = G.Ops && (G.Ops.nmsUp() || Q.roleServers('siem').some((d) => G.Net.devUp(d)));
    if (!ok && watched) G.Ops.alert('warn', `備份失敗：${why}`, 'bkp');
    if (job.cloudWhy && watched) G.Ops.alert('warn', `雲端備份複製失敗：${job.cloudWhy}`, 'bkpc');
  }
  /** RPO：距離最後一次成功備份幾小時 */
  Stor.rpoHours = () => { const b = G.S.bkp; return b.lastOk === null || b.lastOk === undefined ? Infinity : (G.S.time - b.lastOk) / 60; };
  /** 3-2-1：三份資料、兩種媒體、一份在異地（再加一份不可變 / 離線） */
  Stor.rule321 = () => {
    const s = G.S, b = s.bkp, t = s.time;
    const recent = (x) => x !== null && x !== undefined && t - x <= 26 * 60;
    const local = recent(b.lastOk);
    const tape = recent(b.lastTape);
    const vault = tape && Q.hasService('vault');
    const cloud = recent(b.lastCloud);
    const offsite = vault || cloud;
    const copies = 1 + (local ? 1 : 0) + (offsite ? 1 : 0);
    const media2 = local && (tape || cloud);
    const immutable = Q.hasService('immutable') || vault || cloud;
    const drill = b.drillAt !== null && b.drillAt !== undefined && t - b.drillAt <= 7 * 1440 && !!b.drillOk;
    return { local, tape, vault, cloud, offsite, copies, media2, immutable, drill, ok: copies >= 3 && media2 && offsite };
  };
  /** 還原：有沒有乾淨的備份可用（勒索軟體會連線上的備份一起加密） */
  Stor.canRestore = (ransom) => {
    const r = Stor.rule321();
    if (Stor.rpoHours() === Infinity) return { ok: false, why: '從來沒有成功的備份' };
    if (!ransom) return { ok: true };
    if (r.immutable) return { ok: true, how: r.vault ? '異地磁帶（離線）' : r.cloud ? '雲端物件鎖定' : '不可變備份' };
    return { ok: Math.random() < 0.5, why: '線上的備份也被勒索軟體加密了（沒有不可變或離線的副本）' };
  };
  /** 還原演練：真的從備份還原一個系統，確認備份可用、量出需要多久（RTO） */
  Stor.drill = () => {
    const s = G.S, b = s.bkp;
    if (!Stor.bkpServers().length) return err('還沒有備份伺服器');
    if (b.drillUntil > s.time) return err('還原演練進行中');
    b.drillUntil = s.time + 120;
    changed('bkp');
    return ok('還原演練開始：把資料庫還原到測試環境（約 2 小時）');
  };

  /** 每分鐘：排程備份、演練結果、每 5 分鐘更新容量 */
  Stor.tick = () => {
    const s = G.S, t = s.time, b = s.bkp;
    if (t % 5 === 0 || !G.R.stor) Stor.update();
    const h = U.hourOf(t);
    if (t % 60 === 0 && Stor.FREQ[b.freq].includes(Math.round(h) % 24)) runJob();
    if (b.drillUntil && t === b.drillUntil) {
      const rpo = Stor.rpoHours();
      b.drillAt = t;
      b.drillOk = rpo <= 26 && !b.fault;
      const P = G.R.stor || Stor.update();
      const rto = Math.max(0.5, P.data.db / 2);
      G.Act.log(b.drillOk ? `還原演練成功：資料庫從 ${Math.round(rpo)} 小時前的備份還原，約需 ${rto.toFixed(1)} 小時（RTO）` : `還原演練失敗：${b.fault ? Stor.FAULTS[b.fault] + '，最近的備份其實都沒有成功' : '最近 26 小時內沒有成功的備份'}`, b.drillOk ? 'good' : 'warn');
      G.bus.emit('notice', { kind: b.drillOk ? 'good' : 'bad', text: b.drillOk ? '還原演練成功：備份確實可以用' : '還原演練失敗：備份有問題！', goto: 'sys:bkp' });
      changed('bkp');
    }
    /* 容量告警 */
    if (t % 5 === 0 && G.R.stor) {
      for (const p of G.R.stor.pools) {
        if (p.ratio >= 0.95) G.Ops && G.Ops.alert('crit', `儲存空間即將用完：${p.name} ${U.pct(Math.min(p.ratio, 9.99))}`, 'stor:' + p.id);
        else if (p.ratio >= 0.85) G.Ops && G.Ops.alert('warn', `儲存空間偏高：${p.name} ${U.pct(p.ratio)}（建議 < 80%）`, 'stor:' + p.id);
      }
    }
  };
})(window.G = window.G || {});
