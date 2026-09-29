/* 機房門禁（實體安全）：門禁系統等級（鑰匙 / 感應卡 / 雙因子 + 防尾隨雙門）、各類人員的機房權限
 * （常駐 / 需 IT 陪同 / 不能進入）、權限盤點與門禁紀錄。
 * 實體安全是資安的第一道防線：人摸得到設備，就繞得過所有防火牆。
 * G.S.access = { list: { it, vendor, clean, mgr }, reviewAt, log: [{ t, text, bad }] }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const Acc = {};
  G.Acc = Acc;

  Acc.GROUPS = [
    { id: 'it', name: 'IT 部門工程師', desc: '負責機房設備的人：一定要能進去', best: ['perm'], fixed: true },
    { id: 'vendor', name: '機電 / 設備廠商', desc: 'UPS、空調保養，設備維修、上架', best: ['escort'] },
    { id: 'clean', name: '清潔人員', desc: '晚上來打掃', best: ['escort', 'none'] },
    { id: 'mgr', name: '各部門主管', desc: '「我是主管，給我一張卡」', best: ['none'] },
  ];
  Acc.OPTS = [['perm', '常駐權限'], ['escort', '需 IT 陪同'], ['none', '不能進入']];
  Acc.LEVEL = ['鑰匙鎖（沒有門禁系統）', '感應卡門禁', '雙因子門禁 + 防尾隨雙門'];
  const NAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊'];

  Acc.newState = () => ({ list: { it: 'perm', vendor: 'perm', clean: 'perm', mgr: 'perm' }, reviewAt: null, log: [] });
  /** 目前的門禁等級：0 = 只有鑰匙、1 = 感應卡、2 = 雙因子 + 防尾隨 */
  Acc.level = () => {
    const s = G.S;
    let lv = 0;
    for (const r of s.room) { const m = CAT.room[r.model]; if (m.kind === 'access' && r.status === 'ok' && s.time >= (r.readyAt || 0)) lv = Math.max(lv, m.level); }
    return lv;
  };
  /** 實際上能不能進去：沒有門禁系統時，權限設定無法落實（拿到鑰匙就進得去） */
  Acc.can = (g) => (Acc.level() === 0 ? 'perm' : G.S.access.list[g]);
  Acc.groupName = (g) => (Acc.GROUPS.find((x) => x.id === g) || {}).name || g;
  /** 權限給太多的類別（違反最小權限） */
  Acc.overPriv = () => Acc.GROUPS.filter((x) => !x.fixed && !x.best.includes(G.S.access.list[x.id]));
  Acc.reviewDue = () => { const a = G.S.access; return a.reviewAt === null || G.S.time - a.reviewAt > 90 * 1440; };

  Acc.set = (g, v) => {
    const s = G.S, def = Acc.GROUPS.find((x) => x.id === g);
    if (!def || def.fixed) return { ok: false, msg: '這個類別不能調整' };
    if (!Acc.OPTS.some((o) => o[0] === v)) return { ok: false, msg: '沒有這種權限' };
    s.access.list[g] = v;
    Acc.log(`門禁權限變更：${def.name} → ${Acc.OPTS.find((o) => o[0] === v)[1]}`);
    G.bus.emit('change', { kind: 'access' });
    return { ok: true, msg: `${def.name}的機房權限改為「${Acc.OPTS.find((o) => o[0] === v)[1]}」` };
  };
  /** 權限盤點：和人資的在職名單比對，停用離職 / 調職人員的卡片 */
  Acc.review = () => {
    const s = G.S;
    if (Acc.level() === 0) return { ok: false, msg: '沒有門禁系統：只有鑰匙，沒辦法盤點誰能進機房' };
    s.access.reviewAt = s.time;
    const n = U.randInt(2, 7);
    Acc.log(`權限盤點完成：和人資的在職名單比對，停用了 ${n} 張離職或調職人員的卡片`);
    for (const inc of G.Ev.active()) if (inc.type === 'badge-ex') { inc.data.reviewed = true; }
    G.bus.emit('change', { kind: 'access' });
    return { ok: true, msg: `權限盤點完成：停用了 ${n} 張不該再有權限的卡片` };
  };
  Acc.log = (text, bad) => {
    const a = G.S.access;
    a.log.push({ t: G.S.time, text, bad: !!bad });
    if (a.log.length > 40) a.log.splice(0, a.log.length - 40);
  };

  /** 每分鐘：產生門禁紀錄（有門禁系統才有紀錄） */
  Acc.tick = () => {
    const s = G.S, t = s.time;
    if (!s.racks.length || Acc.level() === 0) return;
    const h = U.hourOf(t), wk = U.isWeekend(t);
    if (!wk && h >= 8 && h < 19 && t % 37 === 0 && Math.random() < 0.6) Acc.log(`IT 部門 ${U.pick(NAMES)}工程師 刷卡進入${Acc.level() >= 2 ? '（卡片 + 指紋）' : ''}`);
    if ((h >= 22 || h < 5) && t % 53 === 0 && Math.random() < 0.5) {
      const c = s.access.list.clean;
      if (c === 'perm') Acc.log('清潔人員 刷卡進入（沒有人陪同）', true);
      else if (c === 'escort' && Math.random() < 0.3) Acc.log('清潔人員由值班工程師陪同進入打掃');
    }
    if (!wk && h >= 10 && h < 17 && t % 211 === 0 && s.access.list.mgr === 'perm' && Math.random() < 0.5) Acc.log('業務部主管 刷卡進入（帶客戶參觀機房）', true);
  };
})(window.G = window.G || {});
