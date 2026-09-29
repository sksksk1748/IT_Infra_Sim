/* 遊戲主迴圈：時間推進、排程、經濟、評價、歷史取樣、存檔 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Engine = {};
  G.Engine = Engine;

  /* 速度：每一真實秒推進的遊戲分鐘數 */
  Engine.SPEEDS = [
    { v: 0, label: '暫停', key: '0' },
    { v: 1, label: '1×', key: '1' },
    { v: 5, label: '5×', key: '2' },
    { v: 20, label: '20×', key: '3' },
    { v: 60, label: '60×', key: '4' },
  ];
  let last = 0, acc = 0, lastUi = 0, raf = null;

  Engine.setSpeed = (v) => {
    const s = G.S;
    if (!s) return;
    s.speed = v;
    s.skipUntil = null;
    G.bus.emit('speed');
  };
  Engine.skipTo = (target) => {
    const s = G.S;
    if (!s || target <= s.time) return;
    s.speedBeforeSkip = s.speed || 5;
    s.skipUntil = target;
    s.speed = 180;
    G.bus.emit('speed');
  };
  Engine.paused = () => !G.S || !G.S.speed || !!G.S.gameOver || (G.UI && G.UI.blocking && G.UI.blocking());

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.25, (ts - last) / 1000) : 0;
    last = ts;
    const s = G.S;
    if (s && !Engine.paused()) {
      acc += dt * s.speed;
      let n = 0;
      const t0 = performance.now();
      while (acc >= 1 && n < 200) {
        try { Engine.step(); } catch (e) { console.error(e); s.speed = 0; G.bus.emit('speed'); break; }
        acc -= 1; n++;
        if (performance.now() - t0 > 28) { acc = Math.min(acc, 3); break; }
        if (Engine.paused()) { acc = 0; break; }
      }
    } else acc = 0;
    if (ts - lastUi > 200) { lastUi = ts; G.bus.emit('tick'); }
  }
  Engine.start = () => { if (!raf) raf = requestAnimationFrame(frame); };

  /** 重新建立執行期快取並跑一次模擬（開新遊戲 / 讀檔後） */
  Engine.boot = (state) => {
    G.S = state;
    G.R = { topoVer: 1 };
    /* 舊存檔：替每條線路補上實體跳線（埠、光模組）；並算好 STP */
    G.Phys.ensure();
    /* 舊存檔：補上廁所與清潔 */
    G.Rest.ensure();
    G.Fac.update(0);
    G.Stor.update();
    G.Ev.applyEffects();
    G.Net.simulate();
    G.bus.emit('boot');
  };
  Engine.newGame = (mode) => {
    const s = G.State.create(mode);
    Engine.boot(s);
    G.Campaign.begin(s);
    G.Net.simulate();
    G.State.save(s);
    G.bus.emit('newgame');
  };

  /** 一次推進好幾分鐘（割接窗口內的實體動作要花時間） */
  Engine.advance = (n) => {
    if (Engine.inStep || Engine.advancing) return;
    Engine.advancing = true;
    try { for (let i = 0; i < n && G.S && !G.S.gameOver; i++) Engine.step(); } finally { Engine.advancing = false; }
    G.bus.emit('tick');
  };

  Engine.step = () => {
    Engine.inStep = true;
    try { stepOnce(); } finally { Engine.inStep = false; }
  };
  function stepOnce() {
    const s = G.S;
    s.time += 1;
    timers(s);
    G.Campaign.tickMoveIns(s);
    G.Fac.update(1);
    G.VM.tick();
    G.Stor.tick();
    G.Voice.tick();
    G.Wan.tick();
    G.Ep.tick();
    G.Vuln.tick();
    G.Acc.tick();
    heatFailures(s);
    G.Ev.tick();
    if (s.scen && G.Scen) G.Scen.pre(s);
    G.Net.simulate();
    if (s.scen && G.Scen) G.Scen.post(s);
    /* 廣播風暴告警、割接（第九章）的計時與評分 */
    G.Phys.watch(s);
    G.Cut.tick(s);
    /* 廁所：使用、清潔人員巡邏 / 依感測器派工、夜班整理 */
    G.Rest.tick(s);
    if (s.time % 5 === 0) G.Ops.monitor();
    rating(s);
    if (s.time % 1440 === 0) daily(s);
    if (s.time % 5 === 0) sample(s);
    G.Campaign.check(s);
    if (s.skipUntil && s.time >= s.skipUntil) { s.speed = s.speedBeforeSkip || 5; s.skipUntil = null; G.bus.emit('speed'); }
    if (s.time % 60 === 0) G.State.save(s);
    checkGameOver(s);
  }

  function timers(s) {
    for (const c of s.isp) {
      if (c.status === 'pending' && s.time >= c.readyAt) {
        c.status = 'active';
        const nm = `${CAT.isp.providers[c.provider].name} ${c.plan}`;
        G.Act.log(`ISP 專線開通：${nm}`, 'good');
        G.bus.emit('notice', { kind: 'good', text: `ISP 專線開通：${nm}${c.router ? '' : '（請到拓撲把它接到路由器）'}`, goto: 'topo' });
        G.R.topoVer++;
      }
    }
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id];
      if (fs.cabling.status === 'building' && s.time >= fs.cabling.readyAt) {
        fs.cabling.status = 'done';
        G.Act.log(`${f.id} 水平布線完工`, 'good');
        G.bus.emit('notice', { kind: 'good', text: `${f.id} 水平布線完工`, goto: 'floor:' + f.id });
        G.bus.emit('change', { what: 'floor', fid: f.id });
      }
    }
    for (const d of Object.values(s.devices)) {
      if (d.status === 'rma' && s.time >= d.readyAt) {
        d.status = 'ok';
        d.bootUntil = s.time + (CAT.bootMin[CAT.devices[d.model].cat] || 5);
        G.Act.log(`${d.name} RMA 替換完成`, 'good');
        G.bus.emit('change', { what: 'devices' });
      }
    }
    for (const l of Object.values(s.links)) {
      if (l.status === 'repair' && s.time >= l.repairAt) { l.status = 'up'; G.Act.log('光纖熔接修復完成', 'good'); G.bus.emit('change', { what: 'links' }); }
      if (l.readyAt && s.time === l.readyAt) {
        G.bus.emit('notice', { kind: 'good', text: `主幹線完工：${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)}` });
        G.bus.emit('change', { what: 'links' });
      }
    }
    for (const r of s.room) {
      if (r.readyAt && s.time === r.readyAt) {
        G.bus.emit('notice', { kind: 'good', text: `${CAT.room[r.model].name} 安裝完成並啟用`, goto: 'rack' });
        G.bus.emit('change', { what: 'room' });
      }
    }
  }

  /** 過熱與結露：機房太熱（> 35°C）或太潮濕（> 65%）時，設備會隨機故障 */
  function heatFailures(s) {
    if (!G.R.fac || !G.R.fac.mdfPowered) return;
    const hot = s.temp > 35, humid = s.hum > 65;
    if (!hot && !humid) return;
    const p = (hot ? (s.temp - 35) * 0.00035 : 0) + (humid ? (s.hum - 65) * 0.000012 : 0);
    for (const d of Object.values(s.devices)) {
      if (!d.rack || d.host || d.status !== 'ok' || CAT.infra(CAT.devices[d.model])) continue;
      if (Math.random() < p) G.Ev.start('hw-fail', { dev: d.id, heat: hot, humid: !hot && humid });
    }
  }

  function rating(s) {
    const sim = G.R.sim;
    if (!sim || sim.sat === null || sim.sat === undefined) return;
    if (sim.users >= 30) {
      s.rating += (sim.sat - 0.8) * 0.02 * Math.min(1, sim.users / 500);
      const crit = s.tickets.filter((t) => !t.resolvedAt && t.sev === 'crit').length;
      s.rating -= 0.002 * Math.min(crit, 5);
    }
    if (G.Campaign.websiteLive() && sim.web.demand > 0) s.rating += (sim.web.ratio - 0.95) * 0.004;
    s.rating = U.clamp(s.rating, 0, 100);
  }

  Engine.dailyCosts = () => {
    const s = G.S;
    /* 電信費用：ISP 專線 + SIP 中繼 */
    const isp = (U.sum(s.isp, (c) => CAT.isp.plans[c.plan].monthly) + G.Voice.monthly() + G.Wan.monthly()) / 30;
    let svc = 0;
    for (const id of Object.keys(s.services)) svc += Q.monthlyServiceCost(id) / 30;
    let hw = 0;
    for (const d of Object.values(s.devices)) hw += CAT.devices[d.model].price;
    for (const r of s.room) hw += CAT.room[r.model].price || 0;
    for (const f of Object.values(s.floors)) hw += f.idf.count * CAT.access[f.idf.model].price + U.sum(f.aps, (a) => CAT.aps[a.model].price);
    /* 虛擬化授權（每台主機）也算進維護費 */
    const maint = hw * 0.08 / 365 + G.VM.monthlyCost() / 30;
    const kw = G.R.fac ? G.R.fac.kw : 0;
    const power = kw * 24 * CAT.power.perKWh;
    const income = Q.employees() * 14 * (0.4 + s.rating / 100);
    /* AI 平台帶來的研發效率：每 1 PFLOPS 有效算力每天約 NT$6 萬 */
    const ai = G.R.ai ? G.R.ai.pflops * 60000 : 0;
    /* 清潔：白班清潔人員（外包）+ 衛生紙與洗手乳 */
    const clean = G.Rest.dailyCost();
    return { isp, svc, maint, power, clean, income: income + ai, ai };
  };

  function daily(s) {
    const c = Engine.dailyCosts();
    const power = (s.power.kwh || 0) * CAT.power.perKWh;
    s.power.kwh = 0;
    const cost = Math.round(c.isp + c.svc + c.maint + c.clean + power);
    G.Rest.resetDay();
    const income = Math.round(c.income);
    s.money += income - cost;
    s.stats.income += income;
    s.stats.spent += cost;
    s.lastDaily = { t: s.time, income, isp: Math.round(c.isp), svc: Math.round(c.svc), maint: Math.round(c.maint), clean: Math.round(c.clean), power: Math.round(power) };
    G.Act.log(`每日結算：營運預算 +${U.money(income)}${c.ai > 0 ? `（含 AI 平台效益 ${U.money(c.ai)}）` : ''}；電信（ISP、WAN、SIP）${U.money(c.isp)}、訂閱服務 ${U.money(c.svc)}、維護 ${U.money(c.maint)}、清潔 ${U.money(c.clean)}、電費 ${U.money(power)}`, 'money');
    for (const k in s.ruleHits) s.ruleHits[k] = Math.round(s.ruleHits[k] * 0.5);
  }

  function sample(s) {
    const sim = G.R.sim, h = s.hist;
    if (!sim) return;
    let fwU = 0;
    for (const id in sim.nodes) if (Q.nodeKind(id) === 'firewall') fwU = Math.max(fwU, sim.nodes[id].util);
    h.t.push(s.time);
    h.wanIn.push(Math.round(sim.wan.in));
    h.wanOut.push(Math.round(sim.wan.out));
    h.wanCap.push(sim.wan.cap);
    h.intra.push(Math.round(sim.intra));
    h.users.push(Math.round(sim.users));
    h.sat.push(sim.sat === null ? null : Math.round(sim.sat * 1000) / 1000);
    h.lat.push(Math.round(sim.lat * 10) / 10);
    h.loss.push(Math.round(sim.loss * 1000) / 1000);
    h.fw.push(Math.round(fwU * 1000) / 1000);
    h.temp.push(Math.round(s.temp * 10) / 10);
    h.kw.push(G.R.fac ? Math.round(G.R.fac.itLoad / 100) / 10 : 0);
    h.web.push(sim.web.demand > 0 ? Math.round(sim.web.ratio * 1000) / 1000 : null);
    const MAX = 864;
    if (h.t.length > MAX) for (const k in h) h[k].splice(0, h[k].length - MAX);
  }

  function checkGameOver(s) {
    if (s.gameOver) return;
    if (s.rating <= 0) s.gameOver = { reason: 'rating', t: s.time };
    else if (s.money < -5000000) s.gameOver = { reason: 'money', t: s.time };
    if (s.gameOver) { s.speed = 0; G.State.save(s); G.bus.emit('gameover', s.gameOver); }
  }
})(window.G = window.G || {});
