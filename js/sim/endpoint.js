/* 用戶端電腦管理：一萬台電腦的作業系統更新（每週的「Patch Tuesday」）、修補合規率、
 * 派送方式（使用者自己更新 / 端點管理平台 UEM 自動派送、分批 rings）、更新來源（網際網路 / 內部更新快取）、
 * BitLocker 加密與遠端抹除。更新下載會真的佔用網路：沒有內部快取時，全部從網際網路下載。
 * G.R.ep = { patchMbps, cacheOn, rate }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Ep = {};
  G.Ep = Ep;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg) => ({ ok: false, msg });
  const changed = () => G.bus.emit('change', { what: 'ep' });
  const GB = 1.3;   /* 每台電腦每次更新的下載量（GB） */

  Ep.newState = () => ({ patch: 0.92, release: null, releaseAt: 0, deployAt: 0, paused: false, rings: true, bitlocker: false, bad: null });
  Ep.active = () => { const s = G.S; return s.mode === 'sandbox' || Q.chapterNum() >= 8; };
  Ep.uem = () => Q.hasService('uem');
  Ep.cacheUp = () => Q.roleServers('upd').some((d) => G.Net.devUp(d));
  Ep.pcs = () => Q.employees();
  /** 每週三 01:00 微軟發布更新（Patch Tuesday 的台灣時間） */
  Ep.isRelease = (t) => (U.dowOf(t) === 3 && t % 1440 === 60) || (!!G.S.ep && t === G.S.ep.forceAt);

  Ep.setRings = (on) => { G.S.ep.rings = !!on; changed(); return ok(on ? '分批派送：先派給 5% 的試點電腦，確認沒問題才全面派送' : '分批派送已關閉：更新會同時派給所有電腦'); };
  Ep.setBitlocker = (on) => {
    if (on && !Ep.uem()) return err('要先有端點管理平台（UEM）才能集中強制加密並保管金鑰');
    G.S.ep.bitlocker = !!on; changed();
    return ok(on ? 'BitLocker 全磁碟加密：遺失的筆電，別人拿到也讀不出資料' : 'BitLocker 已關閉');
  };
  /** UEM：立即開始派送（不用等使用者自己更新） */
  Ep.deployNow = () => {
    const s = G.S, e = s.ep;
    if (!Ep.uem()) return err('沒有端點管理平台（UEM）：只能等使用者自己按「更新」');
    if (e.patch >= 0.995) return ok('所有電腦都已經是最新的了');
    e.deployAt = s.time; e.paused = false;
    changed();
    return ok(e.rings ? '開始分批派送：試點組 → 全公司' : '開始同時派送給所有電腦');
  };
  Ep.pause = () => { G.S.ep.paused = true; changed(); return ok('已暫停派送'); };

  /** 每分鐘：新的更新發布、派送進度、下載流量 */
  Ep.tick = () => {
    const s = G.S, e = s.ep, t = s.time;
    G.R.ep = { patchMbps: 0, cacheOn: false, rate: 0 };
    if (!Ep.active()) return;
    if (Ep.isRelease(t)) {
      e.release = (e.release || 0) + 1; e.releaseAt = t;
      e.patch = Math.min(e.patch, 0.05);
      /* UEM：排程在當天 10:00 開始派送；沒有 UEM：等使用者自己更新 */
      e.deployAt = Ep.uem() ? t + 9 * 60 : 0;
      e.paused = false;
      G.Act.log(`微軟發布本週安全更新（#${e.release}）：全公司的電腦都需要更新`, 'info');
      G.bus.emit('notice', { kind: 'info', text: '本週的作業系統安全更新已發布', goto: 'sys:ep' });
      /* 偶爾會有出包的更新 */
      if (Math.random() < 0.18) s.sched.push({ at: t + 9 * 60 + U.randInt(30, 240), type: 'bad-patch' });
      changed();
    }
    const h = U.hourOf(t), work = !U.isWeekend(t) && h >= 9 && h < 18;
    if (!work || e.patch >= 0.999) return;
    /* 派送速度（每小時完成的比例） */
    let rate = 0;
    if (Ep.uem() && e.deployAt && t >= e.deployAt && !e.paused) {
      const since = (t - e.deployAt) / 60;
      rate = e.rings ? (since < 4 ? 0.012 : 0.1) : 0.22;
    } else rate = 0.025;
    const d = Math.min(1 - e.patch, rate / 60);
    e.patch += d;
    const pcs = Ep.pcs();
    const mbps = d * pcs * GB * 8000 / 60;
    const cache = Ep.cacheUp();
    G.R.ep = { patchMbps: mbps, cacheOn: cache, rate };
  };

  /** 這層樓的更新下載量（Mbps）：沒有快取 → 網際網路；有快取 → 內部 */
  Ep.floorMbps = (fid) => {
    const r = G.R.ep;
    if (!r || !r.patchMbps) return 0;
    const f = G.BLD.byId[fid];
    if (G.FT[f.type].dine) return 0;
    const emp = Q.officeStaff() || 1;
    return r.patchMbps * G.S.floors[fid].movedIn / emp;
  };

  /** 修補合規率低：資安事件更容易成功（釣魚感染、橫向擴散） */
  Ep.risk = () => { const s = G.S; if (!Ep.active()) return 1; return 1 + (1 - s.ep.patch) * 0.8; };
  Ep.days = () => { const e = G.S.ep; return e.releaseAt ? (G.S.time - e.releaseAt) / 1440 : null; };
})(window.G = window.G || {});
