/* 電話語音：IP 電話交換機（IP-PBX）、SIP 中繼（向電信業者租的外線路數）、SBC、語音 QoS、
 * 通話品質（MOS，由延遲、抖動與掉包算出）與外線阻塞率（Erlang B）。
 * 第七章之前（或沙盒剛開局）用的是大樓附的舊型總機：不模擬。
 * G.R.voice = { active, pbxUp, calls, ext, channels, blocking, mos, worst, trunkOk, sbc, qos, exposed }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Voice = {};
  G.Voice = Voice;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = () => G.bus.emit('change', { what: 'voice' });

  Voice.active = () => {
    const s = G.S;
    if (!s) return false;
    if (s.mode === 'sandbox') return s.time >= (s.voice.graceUntil || 0);
    return Q.chapterNum() >= 7;
  };
  Voice.pbxUp = () => Q.roleServers('pbx').some((d) => G.Net.devUp(d));
  Voice.sbcUp = () => Q.roleServers('sbc').filter((d) => G.Net.devUp(d));
  /** 目前可用的 SIP 中繼路數（升級時，新線路開通前沿用舊的） */
  Voice.channels = () => { const v = G.S.voice; return v.trunk > 0 ? v.trunk : 0; };

  Voice.orderTrunk = (ch) => {
    const s = G.S, v = s.voice, p = CAT.voice.trunks[ch];
    if (!p) return err('沒有這個方案');
    if (!Q.unlocked(CAT.voice)) return err(`第 ${CAT.voice.unlock} 章解鎖`);
    if (v.trunk === ch && !v.next) return ok('');
    if (!G.Act.spend(p.setup, `SIP 中繼 ${ch} 路（開通費）`)) return err(`預算不足：需要 ${U.money(p.setup)}`);
    /* 第一次申請要等電信業者開通；之後調整路數只要改設定（約 30 分鐘） */
    v.next = ch; v.nextAt = s.time + (v.trunk > 0 ? 30 : CAT.voice.lead);
    changed();
    return ok(v.trunk > 0 ? `已向電信業者調整為 ${ch} 路，約 30 分鐘後生效` : `已申請 SIP 中繼 ${ch} 路，約 ${U.dur(CAT.voice.lead)} 後開通`);
  };
  Voice.cancelTrunk = () => { const v = G.S.voice; v.trunk = 0; v.next = 0; changed(); return ok('已終止 SIP 中繼合約'); };
  Voice.setQos = (on) => { G.S.voice.qos = !!on; changed(); return ok(on ? '語音 QoS 已啟用：交換器、路由器與防火牆都讓語音封包（DSCP EF）優先通過' : '語音 QoS 已關閉'); };
  Voice.monthly = () => { const v = G.S.voice; return v.trunk > 0 ? CAT.voice.trunks[v.trunk].monthly : 0; };

  /** Erlang B：N 路線、A 厄朗的話務量 → 打不進來的機率 */
  Voice.erlangB = (N, A) => {
    if (A <= 0) return 0;
    if (N <= 0) return 1;
    let B = 1;
    for (let k = 1; k <= N; k++) B = (A * B) / (k + A * B);
    return B;
  };
  /** 通話品質 MOS（E-model 簡化）：單向延遲 ms、掉包率 0～1 */
  Voice.mos = (d, loss) => {
    const pct = loss * 100;
    const Id = 0.024 * d + (d > 177.3 ? 0.11 * (d - 177.3) : 0);
    const Ie = 95 * pct / (pct + 10);
    const R = 93.2 - Id - Ie;
    if (R <= 0) return 1;
    if (R >= 100) return 4.5;
    return U.clamp(1 + 0.035 * R + 7e-6 * R * (R - 60) * (100 - R), 1, 4.5);
  };

  /** 每分鐘：SIP 中繼開通 */
  Voice.tick = () => {
    const s = G.S, v = s.voice;
    if (v.next && s.time >= v.nextAt) {
      v.trunk = v.next; v.next = 0;
      G.Act.log(`SIP 中繼 ${v.trunk} 路開通`, 'good');
      G.bus.emit('notice', { kind: 'good', text: `SIP 中繼 ${v.trunk} 路開通`, goto: 'sys:voice' });
      changed();
    }
  };

  /** 語音流量（Net.simulate 路由之前）：各樓層分機 ⇄ PBX、外線經 SBC（或直接）⇄ 電信業者 */
  Voice.flows = (g, flows, floorSt, fwVia) => {
    const s = G.S, v = s.voice;
    const ctx = { active: Voice.active(), floor: {}, trunk: null, leg: null, ext: 0, total: 0 };
    if (!ctx.active) return ctx;
    const pbxUp = g.nodes.has('ROLE:pbx');
    const kb = CAT.voice.kbps / 1000;
    for (const f of G.BLD.floors) {
      const st = floorSt[f.id];
      const rate = CAT.voice.rate[f.type] || 0;
      if (!st || !st.up || !rate) continue;
      const surge = G.FT[f.type].voip && G.R.mods ? G.R.mods.callMult || 1 : 1;
      const calls = (st.crew !== undefined ? st.crew : st.present) * rate * surge;
      if (calls < 0.2) continue;
      const ext = calls * (CAT.voice.ext[f.type] || 0.35);
      ctx.total += calls; ctx.ext += ext;
      st.calls = calls;
      const fl = { id: 'voice:' + f.id, stage: 1, kind: 'voice', floor: f.id, src: 'F:' + f.id, dst: 'ROLE:pbx', fwd: calls * kb, rev: calls * kb, zs: 'LAN', zd: null, svc: ['SIP'], prio: true, calls };
      if (fwVia) fl.via = fwVia;
      flows.push(fl);
      ctx.floor[f.id] = fl;
    }
    /* 分支據點的分機也註冊到總部的 PBX（由 WAN 模組加入） */
    if (G.Wan && G.Wan.voiceFlows) G.Wan.voiceFlows(g, flows, ctx, kb);
    const ch = Voice.channels();
    if (pbxUp && ch > 0 && ctx.ext > 0.1) {
      const carried = Math.min(ctx.ext, ch) * kb;
      const sbc = Voice.sbcUp().find((d) => g.nodes.has(d.id));
      ctx.trunk = { id: 'voice:trunk', stage: 1, kind: 'voice', src: 'INET', dst: sbc ? sbc.id : 'ROLE:pbx', fwd: carried, rev: carried, zs: 'INTERNET', zd: sbc ? G.Net.ruleZone(sbc.id) : null, svc: ['SIP'], prio: true };
      flows.push(ctx.trunk);
      if (sbc) { ctx.leg = { id: 'voice:sbc', stage: 1, kind: 'voice', src: sbc.id, dst: 'ROLE:pbx', fwd: carried, rev: carried, zs: G.Net.ruleZone(sbc.id), zd: null, svc: ['SIP'], prio: true }; flows.push(ctx.leg); }
      ctx.sbc = !!sbc;
    }
    return ctx;
  };

  /** 路由之後：MOS、外線阻塞率，以及每層樓的滿意度係數 */
  Voice.measure = (ctx, floorSt) => {
    const s = G.S;
    const R = { active: ctx.active, pbxUp: Voice.pbxUp(), calls: ctx.total, ext: ctx.ext, channels: Voice.channels(), blocking: 0, mos: null, worst: null, trunkOk: false, sbc: !!ctx.sbc, qos: !!s.voice.qos, exposed: false, floors: {} };
    G.R.voice = R;
    if (!ctx.active) return R;
    const q = (fl) => { if (!fl || fl.blocked) return { ok: false, mos: 1 }; const lost = fl.fwd + fl.rev > 0 ? 1 - (fl.dFwd + fl.dRev) / (fl.fwd + fl.rev) : 0; const d = (fl.rtt || 0) / 2 + 22 + (fl.q || 0) * 1.2; return { ok: true, mos: Voice.mos(d, U.clamp(lost, 0, 1)), d, lost }; };
    const trunk = ctx.trunk ? q(ctx.trunk) : null, leg = ctx.leg ? q(ctx.leg) : null;
    R.trunkOk = !!trunk && trunk.ok && (!ctx.leg || leg.ok);
    /* 外線阻塞：沒有中繼 / 中繼被防火牆擋 → 外線全部打不通；否則依 Erlang B */
    R.blocking = ctx.ext <= 0.1 ? 0 : !R.pbxUp || !R.trunkOk ? 1 : Voice.erlangB(R.channels, ctx.ext);
    R.exposed = !ctx.sbc && G.Sec.hasFirewall() && G.Sec.allows('INTERNET', 'SERVERS', 'SIP');
    let wSum = 0, mSum = 0, worst = null;
    for (const [fid, fl] of Object.entries(ctx.floor)) {
      const st = floorSt[fid], ft = G.FT[G.BLD.byId[fid].type];
      const r = q(fl);
      let mos = r.mos;
      if (r.ok && trunk && trunk.ok) mos = Math.min(mos, (mos + trunk.mos) / 2 + 0.2);
      st.mos = R.pbxUp ? mos : null;
      st.voiceLoss = r.lost || 0;
      const cc = !!ft.voip;
      /* 客服中心：電話就是工作本身 */
      let vq = 1;
      if (!R.pbxUp || !r.ok) vq = cc ? 0.25 : 0.93;
      else {
        vq = U.clamp((mos - 2.4) / 1.6, cc ? 0.35 : 0.85, 1);
        if (cc) vq *= 1 - Math.min(0.6, R.blocking * 1.6);
      }
      st.voiceQ = vq;
      R.floors[fid] = { calls: fl.calls, mos: st.mos, loss: st.voiceLoss };
      if (R.pbxUp && r.ok) { wSum += fl.calls; mSum += fl.calls * mos; if (worst === null || mos < worst.mos) worst = { fid, mos }; }
    }
    /* 分支據點的分機：經 WAN 連回總部 PBX（網際網路隧道要再算上當地網路的掉包） */
    R.sites = {};
    for (const [id, x] of Object.entries(ctx.sites || {})) {
      let okv = true, rtt = 0, qd = 0, ratio = 1;
      for (const f of x.flows) {
        if (f.blocked) { okv = false; break; }
        rtt += f.rtt || 0; qd += f.q || 0;
        const off = f.fwd + f.rev;
        ratio = Math.min(ratio, off > 0 ? (f.dFwd + f.dRev) / off : 1);
      }
      let lost = 1 - ratio;
      if (okv && x.path === 'tun' && G.Wan) lost += G.Wan.inetLoss(id, s.time, G.R.wanPlans && G.R.wanPlans[id] && G.R.wanPlans[id].sd);
      const mos = okv ? Voice.mos(rtt / 2 + 22 + qd * 1.2, U.clamp(lost, 0, 1)) : 1;
      R.sites[id] = { calls: x.calls, mos: R.pbxUp ? mos : null, path: x.path };
      if (R.pbxUp && okv) { wSum += x.calls; mSum += x.calls * mos; }
    }
    R.mos = wSum > 0 ? mSum / wSum : null;
    R.worst = worst;
    return R;
  };
})(window.G = window.G || {});
