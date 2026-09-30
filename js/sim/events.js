/* 事件引擎：產生、推進、偵測、應變行動、結案評分 */
(function (G) {
  'use strict';
  const U = G.U, Q = G.Q;
  const Ev = {};
  G.Ev = Ev;

  const SEVW = { low: 1, med: 2, high: 4, crit: 6 };
  Ev.SEV = { low: '低', med: '中', high: '高', crit: '嚴重' };
  Ev.OUTCOME = { blocked: '防禦成功', contained: '已控制', fixed: '已修復', auto: '自行恢復', fail: '失敗 / 受害' };

  Ev.def = (inc) => G.INC[inc.type];
  Ev.active = () => G.S.incidents.filter((i) => i.status === 'active');
  Ev.visible = () => G.S.incidents.filter((i) => i.status === 'active' && i.detected);

  Ev.unlockKb = (id) => {
    const s = G.S;
    if (!id || !G.KB.byId[id] || s.kb.unlocked[id] !== undefined) return false;
    s.kb.unlocked[id] = s.time;
    G.bus.emit('kb', { id });
    return true;
  };

  Ev.log = (inc, text) => { inc.logs.push({ t: G.S.time, text }); };

  Ev.start = (type, data) => {
    const s = G.S, def = G.INC[type];
    if (!def) return null;
    const inc = { id: Q.nextId('inc'), type, sev: def.sev, title: def.name, startedAt: s.time, status: 'active', detected: false, detectedAt: null, detectHow: null, data: Object.assign({}, data || {}), logs: [], acts: {}, outcome: null };
    if (def.init && def.init(s, inc) === false) return null;
    s.incidents.push(inc);
    s.lastInc = s.lastInc || {};
    s.lastInc[type] = s.time;
    if (def.detect === 'auto' && !inc.detected) Ev.detect(inc, '即時告警');
    return inc;
  };

  Ev.detect = (inc, how) => {
    if (inc.detected) return;
    const s = G.S;
    inc.detected = true;
    inc.detectedAt = s.time;
    inc.detectHow = how;
    const def = Ev.def(inc);
    Ev.unlockKb(def.kb);
    if (def.cat === 'sec') s.stats.mttd.push(s.time - inc.startedAt);
    G.bus.emit('incident', { inc, kind: 'new' });
  };

  Ev.cost = (a, inc) => (typeof a.cost === 'function' ? a.cost(G.S, inc) : (a.cost || 0));
  Ev.time = (a, inc) => (typeof a.time === 'function' ? a.time(G.S, inc) : (a.time || 0));

  Ev.act = (incId, actId) => {
    const s = G.S;
    const inc = s.incidents.find((i) => i.id === incId);
    if (!inc || inc.status !== 'active') return { ok: false, msg: '事件已結束' };
    if (inc.data.blocked) return { ok: false, msg: '這次攻擊已被防禦機制擋下，不需要處置' };
    const def = Ev.def(inc);
    const a = def.actions.find((x) => x.id === actId);
    if (!a) return { ok: false, msg: '未知行動' };
    if (inc.acts[actId]) return { ok: false, msg: '這個行動已經執行過了' };
    if (a.avail && !a.avail(s, inc)) return { ok: false, msg: a.unavail || '目前無法執行' };
    const cost = Math.round(Ev.cost(a, inc));
    if (cost > 0 && !G.Act.spend(cost, a.label)) return { ok: false, msg: `預算不足：需要 ${U.money(cost)}` };
    const time = Ev.time(a, inc);
    inc.acts[actId] = { at: s.time, doneAt: s.time + time, done: false };
    Ev.log(inc, `▶ ${a.label}${time ? `（約 ${U.dur(time)}）` : ''}`);
    if (!time) finish(inc, a);
    G.bus.emit('incident', { inc, kind: 'act' });
    return { ok: true, msg: time ? `已開始：${a.label}` : `已完成：${a.label}` };
  };

  function finish(inc, a) {
    const st = inc.acts[a.id];
    st.done = true;
    if (a.run) a.run(G.S, inc);
    Ev.log(inc, `✔ 完成：${a.label}`);
  }

  Ev.resolve = (inc, outcome) => {
    const s = G.S;
    if (inc.status !== 'active') return;
    const def = Ev.def(inc);
    inc.status = outcome === 'fail' ? 'failed' : 'resolved';
    inc.outcome = outcome;
    inc.endedAt = s.time;
    if (def.end) def.end(s, inc);
    const w = SEVW[inc.sev] || 1;
    let dr = 0;
    const review = [];
    for (const [aid, st] of Object.entries(inc.acts)) {
      const a = def.actions.find((x) => x.id === aid);
      if (!a) continue;
      review.push({ label: a.label, verdict: a.verdict, explain: a.explain, done: st.done });
      if (a.verdict === 'bad') dr -= 0.8;
      if (a.verdict === 'good' && st.done) dr += 0.3;
    }
    if (outcome === 'blocked') dr += 0.8;
    else if (outcome === 'contained' || outcome === 'fixed') dr += w * 0.4;
    else if (outcome === 'auto' && def.cat === 'sec') dr -= w * 0.3;
    else if (outcome === 'fail') {
      dr -= w * 2.2;
      const dmg = { ransomware: 8000000, sqli: 3000000, exfil: 5000000, 'guest-probe': 600000, 'rogue-ap': 400000, 'fab-leak': 3000000 }[inc.type] || 0;
      if (dmg) { s.money -= dmg; inc.damage = dmg; G.Act.log(`資安事件損失（${def.name}）：−${U.money(dmg)}`, 'money'); }
      if (def.cat === 'sec') s.stats.breaches++;
      s.stats.incFailed++;
    }
    if (outcome !== 'fail') s.stats.incResolved++;
    if (inc.detectedAt !== null && def.cat === 'sec' && outcome !== 'blocked') s.stats.mttr.push(s.time - inc.detectedAt);
    s.rating = U.clamp(s.rating + dr, 0, 100);
    inc.ratingDelta = dr;
    inc.review = review;
    inc.lessons = def.review ? def.review(s, inc) : [];
    if (!inc.detected) { inc.detected = true; inc.detectedAt = s.time; inc.detectHow = '事後才發現'; }
    Ev.log(inc, `■ 事件結束：${Ev.OUTCOME[outcome] || outcome}`);
    G.bus.emit('incident', { inc, kind: 'end' });
  };

  /** 每分鐘：推進事件、套用影響、隨機產生新事件、處理排程 */
  Ev.tick = () => {
    const s = G.S;
    G.R.attackFlows = [];
    G.R.mods = { floorOff: {}, floorPenalty: {}, inetMult: 1, webMult: 1, webDown: false, gpuCap: {}, mdfOff: false, callMult: 1 };
    for (const it of s.sched) {
      if (it.fired || s.time < it.at) continue;
      it.fired = true;
      const inc = Ev.start(it.type, it.data);
      if (inc && it.visible) Ev.detect(inc, '排程');
    }
    if (s.sched.length > 40) s.sched = s.sched.filter((x) => !x.fired || s.time - x.at < 1440);
    for (const inc of s.incidents) {
      if (inc.status !== 'active') continue;
      const def = Ev.def(inc);
      for (const [aid, st] of Object.entries(inc.acts)) {
        if (!st.done && s.time >= st.doneAt) { const a = def.actions.find((x) => x.id === aid); if (a) finish(inc, a); }
      }
      if (inc.status !== 'active') continue;
      if (!inc.detected && def.detectChance && Math.random() < def.detectChance(s, inc)) Ev.detect(inc, '監控偵測');
      if (def.tick) def.tick(s, inc);
      if (inc.status === 'active' && def.effects) def.effects(s, inc, G.R.mods, G.R.attackFlows);
    }
    if (s.time % 30 === 0) maybeSpawn();
    const done = s.incidents.filter((i) => i.status !== 'active');
    if (done.length > 60) {
      const drop = new Set(done.slice(0, done.length - 60).map((i) => i.id));
      s.incidents = s.incidents.filter((i) => !drop.has(i.id));
    }
  };

  /** 不推進時間，只重新套用事件對模擬的影響（讀檔後使用） */
  Ev.applyEffects = () => {
    const s = G.S;
    G.R.attackFlows = [];
    G.R.mods = { floorOff: {}, floorPenalty: {}, inetMult: 1, webMult: 1, webDown: false, gpuCap: {}, mdfOff: false, callMult: 1 };
    for (const inc of s.incidents) {
      if (inc.status !== 'active') continue;
      const def = Ev.def(inc);
      if (def && def.effects) def.effects(s, inc, G.R.mods, G.R.attackFlows);
    }
  };

  function maybeSpawn() {
    const s = G.S;
    const ch = Q.chapterNum();
    if (s.mode === 'campaign' && ch < 2) return;
    if (s.gameOver || s.scen) return;
    /* 割接的維護窗口內不產生隨機事件 */
    if (G.Cut && G.Cut.inWindow()) return;
    if (Ev.active().length >= 3) return;
    const p = ch >= 99 ? 0.03 : ch >= 4 ? 0.035 : ch >= 3 ? 0.025 : 0.012;
    if (Math.random() > p) return;
    s.lastInc = s.lastInc || {};
    const cands = Object.keys(G.INC).filter((id) => {
      const d = G.INC[id];
      if (d.random === false) return false;
      if ((d.minCh || 1) > ch) return false;
      if (s.lastInc[id] !== undefined && s.time - s.lastInc[id] < (d.cooldown || 1440)) return false;
      if (Ev.active().some((i) => i.type === id)) return false;
      return true;
    });
    const pick = U.weightedPick(cands, (id) => (G.INC[id].weight ? G.INC[id].weight(s) : 1));
    if (pick) Ev.start(pick);
  }
  Ev.maybeSpawn = maybeSpawn;
})(window.G = window.G || {});
