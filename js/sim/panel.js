/* 配電盤實作（第十一章）：晶圓廠的廠務動力分電盤 DP-UT1（三相四線 380 / 220 V、60 Hz）
 * 兩個電源區、兩條進線：一般電源（主變壓器 → 低壓主配電盤）與緊急電源（有 DUPS 就由 DUPS 供電，否則經 ATS 由一般電源 / 發電機供電）。
 * 統包商交接時留下九個缺失（DEF 裡標「缺失」的地方），要用絕緣電阻計、相序計、鉤表、紅外線熱像儀一一找出來，
 * 依停電作業程序（LOTO：斷電 → 上鎖掛牌 → 驗電 → 施工 → 拆除掛牌 → 送電）修好。
 * 負載側施工（換電纜、鎖緊端子、對調相序）只要停掉那一個迴路；電源側施工（換斷路器、改接相位、搬到另一區）要停掉整個電源區。
 * 每個動作都會花遊戲時間，世界照常運轉：停掉的泵浦就不出水、停掉的風機就不排氣。
 * s.plant.panel = { inc: { N, E }, cir: { id: 迴路狀態 }, stats, scan, clamp, energized, nHeat, log }
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT;
  const Panel = {};
  G.Panel = Panel;

  const SQ3 = Math.sqrt(3);
  /** 斷路器的額定跳脫電流（AT）、電纜線徑（mm²）與安培容量（簡化：PVC 絕緣、穿管或電纜架） */
  Panel.AT = [15, 20, 30, 40, 50, 60, 75, 100, 125, 150, 175, 200];
  Panel.SIZES = [3.5, 5.5, 8, 14, 22, 38, 60];
  Panel.AMP = { 3.5: 25, 5.5: 32, 8: 42, 14: 60, 22: 80, 38: 110, 60: 150 };
  /** 導線顏色（台灣常見的做法：R 紅、S 黑、T 藍；中性線白、接地線綠） */
  Panel.COL = { R: '#d9382c', S: '#2b2e33', T: '#2f6fd6', N: '#e6e9ec', E: '#2fa84f' };
  Panel.PH = ['R', 'S', 'T'];
  Panel.BUS = { N: '一般電源區', E: '緊急電源區' };
  Panel.INC = { N: { name: '一般電源進線', short: '一般', at: 600 }, E: { name: '緊急電源進線', short: '緊急', at: 225 } };
  /** 三相不平衡率（設計負載全部運轉時）上限 */
  Panel.UNBAL = 0.05;
  const LEN = 40;   /* 每一迴路的電纜長度（m） */

  /* 迴路：統包商配好的樣子（含缺失）。sys = 這個迴路的負載屬於哪一套廠務設備（設備還沒建置就沒有負載）；
   * motor = 三相馬達（有起動電流、會反轉）；wet = 濕區（要漏電斷路器）；life = 維生負載（要接緊急電源） */
  const DEF = [
    { id: 'P101', name: 'P-101 原水泵', sys: 'ro', motor: true, ph: 3, kw: 15, bus: 'N', at: 50, mm2: 14 },
    { id: 'P201', name: 'P-201 RO 高壓泵', sys: 'ro', motor: true, ph: 3, kw: 37, bus: 'N', at: 125, mm2: 60, seq: false },   /* 缺失：相序接反，泵浦反轉 */
    { id: 'P301', name: 'P-301 純水供應泵', sys: 'polish', motor: true, ph: 3, kw: 30, bus: 'N', at: 100, mm2: 38, ins: 0.3 }, /* 缺失：拉線時刮傷電纜，絕緣不良 */
    { id: 'CDS', name: 'CDS 化學品供應泵浦', sys: 'chem', motor: true, ph: 3, kw: 11, bus: 'N', at: 40, mm2: 14 },
    { id: 'WWT', name: 'WWT 廢水處理泵浦', sys: 'wwt', motor: true, ph: 3, kw: 15, bus: 'N', at: 125, mm2: 60 },             /* 缺失：斷路器太大，保護不到馬達 */
    { id: 'EF1', name: 'EF-1 酸排風機', sys: 'exh', motor: true, ph: 3, kw: 30, bus: 'E', at: 50, mm2: 38, life: true },     /* 缺失：斷路器太小，起動就跳 */
    { id: 'EF2', name: 'EF-2 一般排氣風機', sys: 'exh', motor: true, ph: 3, kw: 30, bus: 'E', at: 100, mm2: 38, life: true, loose: 'T' }, /* 缺失：T 相端子沒鎖緊 */
    { id: 'SC1', name: 'SC-1 洗滌塔循環泵', sys: 'scrub', motor: true, ph: 3, kw: 15, bus: 'E', at: 50, mm2: 3.5, life: true }, /* 缺失：電纜太細，過熱 */
    { id: 'GC', name: '特殊氣體櫃（控制 / 加熱帶）', sys: 'gas', ph: 3, kw: 9, bus: 'E', at: 30, mm2: 8, life: true },
    /* 單相 220 V（一條相線 + 中性線）：統包商全部接在 R 相（缺失：三相不平衡） */
    { id: 'L1', name: '純水 / 廢水區照明', ph: 1, kw: 1.4, bus: 'N', at: 20, mm2: 3.5 },
    { id: 'L2', name: '氣體 / 化學品室照明', ph: 1, kw: 1.2, bus: 'N', at: 20, mm2: 3.5 },
    { id: 'R1', name: '純水室插座（濕區）', ph: 1, kw: 1.8, bus: 'N', at: 20, mm2: 3.5, wet: true, elcb: true },
    { id: 'R2', name: '化學品室插座（濕區）', ph: 1, kw: 1.8, bus: 'N', at: 20, mm2: 3.5, wet: true },                        /* 缺失：沒有漏電斷路器 */
    { id: 'EW', name: '緊急沖淋 / 洗眼器（加熱）', ph: 1, kw: 2.2, bus: 'N', at: 20, mm2: 3.5, wet: true, elcb: true },
    { id: 'CR', name: '廠務控制室（電腦、螢幕）', ph: 1, kw: 2.4, bus: 'N', at: 20, mm2: 3.5 },
    { id: 'TV', name: '監視器 / 門禁', ph: 1, kw: 0.9, bus: 'N', at: 20, mm2: 3.5 },
    { id: 'GDS', name: 'GDS 氣體偵測主機', sys: 'gds', ph: 1, kw: 0.8, bus: 'N', at: 20, mm2: 3.5, life: true },              /* 缺失：維生負載接在一般電源 */
    { id: 'L3', name: '緊急照明 / 出口標示', ph: 1, kw: 0.6, bus: 'E', at: 20, mm2: 3.5, life: true },
    { id: 'PLC', name: 'FMCS PLC 盤', sys: 'plc', ph: 1, kw: 1.0, bus: 'E', at: 20, mm2: 3.5, life: true },
  ];
  Panel.DEF = DEF;
  const byId = {};
  for (const d of DEF) byId[d.id] = d;
  Panel.def = (id) => byId[id];

  Panel.newState = () => ({
    inc: { N: { on: false, lock: false, ver: false }, E: { on: false, lock: false, ver: false } },
    cir: Object.fromEntries(DEF.map((d) => [d.id, {
      on: false, trip: false, lock: false, ver: false, at: d.at, elcb: !!d.elcb, mm2: d.mm2, bus: d.bus, phase: d.ph === 1 ? 'R' : null,
      seq: d.seq !== false, loose: d.loose || null, ins: d.ins || 500, meg: null, seqKnown: false, heat: 0, drop: 0, ovl: 0, live0: false,
    }])),
    stats: { loto: 0, live: 0, viol: 0, trips: 0, shorts: 0, fixes: 0 },
    scan: null, clamp: null, energized: 0, nHeat: 0, log: [],
  });
  const S = () => G.S.plant.panel;
  Panel.st = S;
  Panel.c = (id) => S().cir[id];

  /* ---------- 電氣計算 ---------- */
  /** 額定電流（A）：三相馬達 I = P ÷ (√3 × 380 V × 功率因數 0.85 × 效率 0.9)；三相電熱 PF 0.95；單相 I = P ÷ (220 V × 0.95) */
  Panel.flc = (d) => (d.ph === 3 ? d.kw * 1000 / (SQ3 * 380 * (d.motor ? 0.85 * 0.9 : 0.95)) : d.kw * 1000 / (220 * 0.95));
  /** 斷路器的合理範圍：馬達 1.5～2.5 倍額定電流（要躲過起動電流、又保護得到）；其他負載至少 1.25 倍 */
  Panel.range = (d) => {
    const i = Panel.flc(d);
    return d.motor ? { min: i * 1.5, max: i * 2.5 } : { min: Math.max(i * 1.25, 15), max: Math.max(20, i * 3) };
  };
  Panel.amp = (mm2) => Panel.AMP[mm2] || 0;
  /** 建議的斷路器與線徑（提示、說明用） */
  Panel.suggest = (d) => {
    const r = Panel.range(d);
    const at = Panel.AT.find((a) => a >= r.min && a <= r.max) || Panel.AT.find((a) => a >= r.min);
    const mm2 = Panel.SIZES.find((m) => Panel.amp(m) >= at);
    return { at, mm2 };
  };

  /* ---------- 電源與負載 ---------- */
  Panel.busLive = (bus) => { const I = S().inc[bus]; return !!I.on && !!(G.Plant && G.Plant.busSource(bus)); };
  Panel.loadLive = (id) => { const c = Panel.c(id); return Panel.busLive(c.bus) && c.on && !c.trip; };
  Panel.present = (d) => !!(G.Plant && G.Plant.hasLoad(d.sys));
  Panel.running = (id) => { const c = Panel.c(id); return Panel.loadLive(id) && Panel.present(byId[id]) && !(c.drop > G.S.time); };
  /** 這個迴路帶的設備現在發揮幾成：沒電 0；馬達反轉（泵浦、風機）只剩三成多 */
  Panel.factor = (id) => (Panel.running(id) ? (byId[id].motor && !Panel.c(id).seq ? 0.35 : 1) : 0);
  /** 一套廠務設備的運轉比例：同一套取最差的迴路；排氣的兩台風機取平均 */
  Panel.sys = (sys) => {
    const ids = DEF.filter((d) => d.sys === sys).map((d) => d.id);
    if (!ids.length) return 1;
    if (sys === 'exh') return U.sum(ids, (id) => Panel.factor(id)) / ids.length;
    return Math.min(...ids.map((id) => Panel.factor(id)));
  };
  Panel.current = (id) => (Panel.running(id) ? Panel.flc(byId[id]) : 0);
  /** 三相電流：三相負載平均分在 R / S / T；單相負載加在它接的那一相；中性線電流 = 三個單相電流的相量和
   * design = true：假設每一個迴路都滿載運轉（驗收用）；false：現在實際的電流（鉤表量到的） */
  Panel.phases = (design) => {
    const out = { R: 0, S: 0, T: 0 }, one = { R: 0, S: 0, T: 0 };
    for (const d of DEF) {
      const c = Panel.c(d.id);
      const i = design ? Panel.flc(d) : Panel.current(d.id);
      if (!i) continue;
      if (d.ph === 3) { out.R += i; out.S += i; out.T += i; } else { out[c.phase] += i; one[c.phase] += i; }
    }
    const x = one.R - 0.5 * one.S - 0.5 * one.T, y = (SQ3 / 2) * (one.T - one.S);
    const avg = (out.R + out.S + out.T) / 3;
    return { R: out.R, S: out.S, T: out.T, N: Math.hypot(x, y), unbal: avg > 0 ? (Math.max(out.R, out.S, out.T) - avg) / avg : 0, one };
  };
  /** 負載（kW）：全部 / 一般電源區 / 緊急電源區（設計值） */
  Panel.kw = (bus) => U.sum(DEF.filter((d) => !bus || Panel.c(d.id).bus === bus), (d) => d.kw);
  Panel.kwRunning = () => U.sum(DEF.filter((d) => Panel.running(d.id)), (d) => d.kw);

  /* ---------- 驗收：還有哪些缺失 ---------- */
  Panel.defects = () => {
    const out = [];
    const add = (id, k, t) => out.push({ id, k, t });
    for (const d of DEF) {
      const c = Panel.c(d.id), r = Panel.range(d);
      if (c.ins < 1) add(d.id, 'ins', `絕緣電阻只有 ${c.ins} MΩ（至少 1 MΩ）：電纜破損`);
      else if (!c.meg) add(d.id, 'meg', '還沒做絕緣電阻測試');
      if (d.motor && !c.seq) add(d.id, 'seq', '相序接反：馬達反轉');
      if (c.at < r.min) add(d.id, 'atLow', `斷路器 ${c.at} A 太小（至少 ${Math.ceil(r.min)} A）`);
      else if (c.at > r.max) add(d.id, 'atHigh', `斷路器 ${c.at} A 太大（最多 ${Math.floor(r.max)} A，保護不到）`);
      if (Panel.amp(c.mm2) < c.at) add(d.id, 'cable', `電纜 ${c.mm2} mm²（${Panel.amp(c.mm2)} A）小於斷路器 ${c.at} A`);
      if (d.wet && !c.elcb) add(d.id, 'elcb', '濕區迴路沒有漏電斷路器');
      if (d.life && c.bus !== 'E') add(d.id, 'bus', '維生負載接在一般電源');
      if (c.loose) add(d.id, 'loose', `${c.loose} 相端子鬆脫`);
      if (c.trip) add(d.id, 'off', '跳脫中');
      else if (!c.on) add(d.id, 'off', '沒有送電');
    }
    const ph = Panel.phases(true);
    if (ph.unbal > Panel.UNBAL) add(null, 'unbal', `三相不平衡 ${U.pct(ph.unbal, 1)}（要 ≤ ${U.pct(Panel.UNBAL)}）`);
    for (const k of ['N', 'E']) if (!S().inc[k].on) add(k, 'inc', `${Panel.INC[k].name}還沒送電`);
    return out;
  };
  /** 驗收清單的分類（介面與提示用） */
  Panel.CHECKS = [
    { k: 'ins', t: '絕緣電阻 ≥ 1 MΩ（送電前每一迴路都要測）', keys: ['ins', 'meg'] },
    { k: 'at', t: '斷路器容量：馬達 1.5～2.5 倍、其他 ≥ 1.25 倍額定電流', keys: ['atLow', 'atHigh'] },
    { k: 'cable', t: '電纜的安培容量 ≥ 斷路器', keys: ['cable'] },
    { k: 'elcb', t: '濕區（插座、沖淋加熱）有漏電斷路器 30 mA', keys: ['elcb'] },
    { k: 'bus', t: '維生負載（排氣、洗滌塔、氣體偵測、緊急照明、FMCS）在緊急電源區', keys: ['bus'] },
    { k: 'unbal', t: `三相不平衡 ≤ ${Math.round(Panel.UNBAL * 100)}%（單相負載分散到 R / S / T）`, keys: ['unbal'] },
    { k: 'seq', t: '馬達相序正確（泵浦、風機不反轉）', keys: ['seq'] },
    { k: 'loose', t: '熱像檢查：沒有過熱的端子與電纜', keys: ['loose'] },
    { k: 'on', t: '兩條進線與每一個迴路都送電、沒有跳脫', keys: ['off', 'inc'] },
  ];

  /* ---------- 施工安全 ---------- */
  /** side：'load' 負載側（電纜、端子、相序）/ 'line' 電源側（斷路器、匯流排上的位置）/ 'both' 搬到另一個電源區
   * 回傳 { ok, live, why }：ok = 已經停電、上鎖掛牌、驗過電；live = 真的有電（硬做就會出事） */
  Panel.safety = (id, side, toBus) => {
    const c = Panel.c(id), st = S();
    const incSafe = (b) => { const I = st.inc[b]; return !I.on && I.lock && I.ver; };
    if (side === 'load') {
      const live = Panel.loadLive(id);
      const ok = !live && ((!c.on && c.lock && c.ver) || incSafe(c.bus));
      return { ok, live, why: ok ? '' : live ? '這個迴路還在送電：先把斷路器 OFF、上鎖掛牌、驗電' : !c.lock && !st.inc[c.bus].lock ? '斷路器關了，但還沒上鎖掛牌：別人隨時可能把它送電' : '上鎖掛牌之後還要驗電，確認真的沒電' };
    }
    const buses = side === 'both' && toBus && toBus !== c.bus ? [c.bus, toBus] : [c.bus];
    const live = buses.some((b) => Panel.busLive(b));
    const ok = buses.every((b) => incSafe(b));
    const nm = buses.map((b) => Panel.BUS[b]).join('與');
    return { ok, live, why: ok ? '' : live ? `換斷路器、改接匯流排要動到電源側：${nm}還有電，要把${nm}的進線 OFF、上鎖掛牌、驗電` : `${nm}的進線還沒上鎖掛牌、驗電` };
  };

  /* ---------- 動作（每個都花遊戲時間） ---------- */
  Panel.TIME = { off: 1, on: 1, lock: 3, unlock: 2, verify: 2, meg: 3, megAll: 15, seq: 2, clamp: 1, scan: 10, at: 20, elcb: 20, phase: 10, bus: 30, cable: 60, torque: 5, swap: 10 };
  const SIDE = { at: 'line', elcb: 'line', phase: 'line', bus: 'both', cable: 'load', torque: 'load', swap: 'load' };
  Panel.SIDE = SIDE;
  const ok = (msg, extra) => Object.assign({ ok: true, msg }, extra || {});
  const err = (msg, extra) => Object.assign({ ok: false, msg }, extra || {});
  const logp = (text) => { const st = S(); st.log.push({ t: G.S.time, text }); if (st.log.length > 40) st.log.shift(); };
  Panel.log = logp;
  const spend = (min) => { if (min > 0 && G.Engine && !G.Engine.inStep && !G.Engine.advancing) G.Engine.advance(min); };
  const changed = () => G.bus.emit('change', { what: 'plant' });
  const nameOf = (id) => (id === 'N' || id === 'E' ? Panel.INC[id].name : `${id} ${byId[id].name}`);
  Panel.nameOf = nameOf;

  Panel.act = (id, a, arg, opt) => {
    opt = opt || {};
    const st = S();
    const isInc = id === 'N' || id === 'E';
    const tgt = isInc ? st.inc[id] : st.cir[id];
    if (!tgt && !['scan', 'megAll', 'allOn', 'seqAll'].includes(a)) return err('找不到這個迴路');
    const d = isInc ? null : byId[id];
    const nm = tgt ? nameOf(id) : '';
    let r = null;
    switch (a) {
      case 'off':
        if (!tgt.on && !tgt.trip) return err('已經是 OFF');
        tgt.on = false;
        if (!isInc) tgt.trip = false;
        logp(`${nm}：OFF`);
        r = ok(`${nm}：OFF`);
        break;
      case 'on':
        if (tgt.lock) return err('上面還掛著鎖和「禁止操作」吊牌：要先拆除掛牌，確認沒有人在施工，才能送電');
        if (tgt.on && !tgt.trip) return err('已經送電');
        tgt.on = true; tgt.ver = false;
        if (!isInc) tgt.trip = false;
        logp(`${nm}：ON（送電）`);
        r = ok(isInc ? `${nm}送電` : `${nm}：送電`);
        break;
      case 'lock':
        if (tgt.on) return err('要先把斷路器扳到 OFF，才能上鎖掛牌');
        if (tgt.lock) return err('已經上鎖掛牌了');
        tgt.lock = true; tgt.ver = false;
        logp(`${nm}：上鎖掛牌（個人安全鎖 + 「禁止送電，有人施工」吊牌）`);
        r = ok(`${nm}：上鎖掛牌`);
        break;
      case 'unlock':
        if (!tgt.lock) return err('沒有上鎖');
        tgt.lock = false; tgt.ver = false;
        logp(`${nm}：拆除掛牌`);
        r = ok(`${nm}：拆除掛牌（確認人員都離開、工具都收走了）`);
        break;
      case 'verify': {
        if (!tgt.lock) return err('先上鎖掛牌，再驗電');
        const live = isInc ? Panel.busLive(id) : Panel.loadLive(id);
        if (live) return err('驗電：還有電！不能施工');
        tgt.ver = true;
        logp(`${nm}：驗電，確認無電壓`);
        r = ok(`${nm}：驗電 0 V，可以施工`);
        break;
      }
      case 'meg': {
        if (isInc) return err('絕緣電阻要一個迴路一個迴路測');
        const sf = Panel.safety(id, 'load');
        if (!sf.ok) return err('絕緣電阻計會送出 500 V 直流高壓：這個迴路要先停電、上鎖掛牌、驗電，才能測');
        tgt.meg = { at: G.S.time, val: tgt.ins };
        logp(`${nm}：絕緣電阻 ${tgt.ins >= 1 ? '> 500' : tgt.ins} MΩ`);
        r = ok(tgt.ins >= 1 ? `${nm}：絕緣電阻 > 500 MΩ，良好` : `${nm}：絕緣電阻只有 ${tgt.ins} MΩ！電纜絕緣破損，送電會短路`, { bad: tgt.ins < 1 });
        break;
      }
      case 'megAll': {
        const ids = DEF.filter((x) => Panel.safety(x.id, 'load').ok).map((x) => x.id);
        if (!ids.length) return err('沒有可以測的迴路：先把進線（或迴路）停電、上鎖掛牌、驗電');
        const bad = [];
        for (const x of ids) { const c = st.cir[x]; c.meg = { at: G.S.time, val: c.ins }; if (c.ins < 1) bad.push(x); }
        logp(`絕緣電阻測試 ${ids.length} 個迴路${bad.length ? `：${bad.join('、')} 絕緣不良` : '：全部良好'}`);
        changed();
        spend(Math.min(Panel.TIME.megAll, 3 * ids.length));
        return bad.length ? ok(`測了 ${ids.length} 個迴路：${bad.map(nameOf).join('、')} 絕緣不良（< 1 MΩ）！送電前要換電纜`, { bad: true }) : ok(`測了 ${ids.length} 個迴路：絕緣全部良好（> 500 MΩ）`);
      }
      case 'allOn': {
        /* 依序送電：一次一個迴路（避免所有馬達同時起動），上鎖的跳過 */
        const ids = DEF.filter((x) => { const c = st.cir[x.id]; return (!c.on || c.trip) && !c.lock; }).map((x) => x.id);
        if (!ids.length) return err('每一個迴路都已經送電（上鎖的迴路要先拆除掛牌）');
        if (!Panel.busLive('N') && !Panel.busLive('E')) return err('兩條進線都還沒送電：先送進線，再送各迴路');
        for (const x of ids) { const c = st.cir[x]; c.on = true; c.trip = false; c.ver = false; }
        logp(`依序送電：${ids.join('、')}`);
        changed();
        for (let k = 0; k < ids.length; k++) spend(1);
        return ok(`依序送電 ${ids.length} 個迴路`);
      }
      case 'seqAll': {
        const ids = DEF.filter((x) => x.motor && Panel.loadLive(x.id)).map((x) => x.id);
        if (!ids.length) return err('要送電才量得到相序（相序計夾在斷路器的出線端）');
        const bad = [];
        for (const x of ids) { const c = st.cir[x]; c.seqKnown = true; if (!c.seq) bad.push(x); }
        logp(`相序測試 ${ids.length} 台馬達${bad.length ? `：${bad.join('、')} 反相序` : '：全部正相序'}`);
        changed();
        spend(2 * ids.length);
        return bad.length ? ok(`測了 ${ids.length} 台馬達：${bad.map(nameOf).join('、')} 反相序（馬達反轉）！停電後對調任意兩相`, { bad: true }) : ok(`測了 ${ids.length} 台馬達：全部正相序`);
      }
      case 'seq':
        if (isInc || !d.motor) return err('相序計是用來確認三相馬達的旋轉方向');
        if (!Panel.loadLive(id)) return err('要送電才量得到相序（相序計夾在斷路器的出線端）');
        tgt.seqKnown = true;
        logp(`${nm}：相序 ${tgt.seq ? 'R→S→T 正相序' : '反相序'}`);
        r = ok(tgt.seq ? `${nm}：正相序，馬達正轉` : `${nm}：反相序！馬達在反轉：停電後對調任意兩相`, { bad: !tgt.seq });
        break;
      case 'clamp': {
        const ph = Panel.phases(false);
        st.clamp = { at: G.S.time, R: ph.R, S: ph.S, T: ph.T, N: ph.N, unbal: ph.unbal, cir: isInc ? null : { id, i: Panel.current(id) } };
        r = ok(isInc || !tgt ? `進線電流 R ${ph.R.toFixed(0)} A · S ${ph.S.toFixed(0)} A · T ${ph.T.toFixed(0)} A · 中性線 ${ph.N.toFixed(0)} A` : `${nm}：${Panel.current(id).toFixed(1)} A（額定 ${Panel.flc(d).toFixed(1)} A）`);
        break;
      }
      case 'scan': {
        if (!Panel.busLive('N') && !Panel.busLive('E')) return err('配電盤沒有送電：熱像要在帶載運轉時才看得出過熱');
        const spots = {};
        for (const x of DEF) {
          const c = st.cir[x.id];
          if (!Panel.running(x.id)) continue;
          const over = Panel.current(x.id) / Panel.amp(c.mm2);
          const tmp = 32 + (c.loose ? 28 : 0) + (over > 1 ? (over - 1) * 90 + 15 : 0) + c.heat * 45;
          if (tmp >= 45) spots[x.id] = Math.round(tmp);
        }
        const ph = Panel.phases(false);
        if (ph.N > 30) spots.N = Math.round(35 + ph.N * 0.35 + st.nHeat * 30);
        st.scan = { at: G.S.time, spots };
        const n = Object.keys(spots).length;
        logp(`紅外線熱像掃描：${n ? Object.entries(spots).map(([k, v]) => `${k === 'N' ? '中性線' : k} ${v}°C`).join('、') : '沒有異常溫升'}`);
        changed();
        spend(Panel.TIME.scan);
        return ok(n ? `熱像：${n} 個過熱點（${Object.entries(spots).map(([k, v]) => `${k === 'N' ? '中性線匯流排' : k} ${v}°C`).join('、')}）` : '熱像：沒有異常溫升', { bad: n > 0 });
      }
      case 'at': case 'elcb': case 'phase': case 'bus': case 'cable': case 'torque': case 'swap': {
        if (isInc) return err('進線不能這樣施工');
        if (a === 'phase' && d.ph !== 1) return err('只有單相迴路要選接在哪一相');
        if (a === 'swap' && !d.motor) return err('對調相序是用來改變三相馬達的旋轉方向');
        if (a === 'torque' && !tgt.loose) return err('端子都鎖緊了');
        if (a === 'at' && (!Panel.AT.includes(arg) || arg === tgt.at)) return err('選一個不同的額定');
        if (a === 'cable' && !Panel.AMP[arg]) return err('選一種線徑');
        if (a === 'phase' && (!Panel.PH.includes(arg) || arg === tgt.phase)) return err('選另一相');
        if (a === 'bus' && (!Panel.BUS[arg] || arg === tgt.bus)) return err('已經在這一區');
        if (a === 'elcb' && !!arg === tgt.elcb) return err(tgt.elcb ? '已經是漏電斷路器' : '已經是一般斷路器');
        const sf = Panel.safety(id, SIDE[a], a === 'bus' ? arg : null);
        let viol = false;
        if (!sf.ok) {
          if (!opt.force) return err(sf.why, { unsafe: true, live: sf.live });
          if (sf.live) {
            st.stats.live++;
            logp(`⚠ 帶電作業：${nm}（${WORK[a]}）→ 電弧閃絡`);
            G.Ev && G.Ev.start('plant-arc', { cid: id, act: a });
            changed();
            spend(30);
            return err('電弧閃絡！帶電施工的技術員被電弧灼傷，送醫治療', { accident: true });
          }
          /* 沒有上鎖掛牌、但剛好沒電：工安違規（幸好沒出事） */
          viol = true;
          st.stats.viol++;
          G.S.rating = Math.max(0, G.S.rating - 1);
          logp(`⚠ 違反停電作業程序：${nm} 沒有上鎖掛牌、驗電就施工`);
        }
        const cost = a === 'at' ? CAT.plant.breaker : a === 'elcb' ? (arg ? CAT.plant.elcb : CAT.plant.breaker) : a === 'cable' ? CAT.plant.cablePerM[arg] * LEN : 0;
        if (cost > 0 && !G.Act.spend(cost, `${nm}：${WORK[a]}`)) return err(`預算不足：需要 ${U.money(cost)}`);
        if (a === 'at') { tgt.at = arg; tgt.trip = false; }
        else if (a === 'elcb') tgt.elcb = !!arg;
        else if (a === 'phase') tgt.phase = arg;
        else if (a === 'bus') tgt.bus = arg;
        else if (a === 'cable') { tgt.mm2 = arg; tgt.ins = 500; tgt.heat = 0; tgt.meg = null; }
        else if (a === 'torque') { tgt.loose = null; tgt.heat = Math.min(tgt.heat, 0.2); }
        else if (a === 'swap') { tgt.seq = !tgt.seq; tgt.seqKnown = false; }
        st.stats.fixes++;
        if (!viol) st.stats.loto++;
        const what = a === 'at' ? `換成 ${arg} A 斷路器` : a === 'elcb' ? (arg ? '換成漏電斷路器（30 mA）' : '換成一般斷路器') : a === 'phase' ? `改接到 ${arg} 相` : a === 'bus' ? `改接到${Panel.BUS[arg]}` : a === 'cable' ? `換新電纜 ${arg} mm²（${Panel.amp(arg)} A）` : a === 'torque' ? '端子依規定扭力鎖緊' : '對調兩相（改變旋轉方向）';
        logp(`${nm}：${what}${viol ? '（違規施工）' : ''}`);
        r = ok(`${nm}：${what}${a === 'cable' ? '（新電纜送電前記得再做一次絕緣電阻測試）' : ''}`);
        break;
      }
      default:
        return err('未知動作');
    }
    changed();
    spend(Panel.TIME[a] || 0);
    return r;
  };
  const WORK = { at: '更換斷路器', elcb: '更換漏電斷路器', phase: '改接相位', bus: '改接電源區', cable: '更換電纜', torque: '鎖緊端子', swap: '對調相序' };
  Panel.WORK = WORK;

  /* ---------- 每分鐘（Plant.tick 裡呼叫） ---------- */
  const activeInc = (type, cid) => !!(G.Ev && G.Ev.active().some((i) => i.type === type && i.data.cid === cid));
  function trip(d, c, why) {
    c.trip = true; c.live0 = false; c.ovl = 0;
    const st = S();
    st.stats.trips++;
    if (why === 'short') st.stats.shorts++;
    const W = { short: '短路（絕緣不良）', start: '馬達起動電流大於斷路器額定', overload: '過載' };
    logp(`${d.id} ${d.name}：斷路器跳脫（${W[why]}）`);
    if (G.Ev && !activeInc('plant-trip', d.id)) G.Ev.start('plant-trip', { cid: d.id, why });
    G.bus.emit('change', { what: 'plant' });
  }
  Panel.tick = (s) => {
    const st = S(), t = s.time;
    const live = { N: Panel.busLive('N'), E: Panel.busLive('E') };
    if (!st.energized && live.N && live.E) st.energized = t;
    for (const d of DEF) {
      const c = st.cir[d.id];
      const on = live[c.bus] && c.on && !c.trip;
      /* 送電的瞬間：絕緣不良 → 短路；馬達的起動電流（約 6 倍）超過斷路器能忍的範圍 → 跳脫 */
      if (on && !c.live0) {
        if (c.ins < 1) { trip(d, c, 'short'); continue; }
        if (d.motor && Panel.present(d) && !(c.drop > t) && c.at < Panel.flc(d) * 1.5) { trip(d, c, 'start'); continue; }
      }
      c.live0 = on && !(c.drop > t);
      if (c.drop && c.drop <= t) c.drop = 0;
      const run = on && Panel.present(d) && !(c.drop > t);
      const i = run ? Panel.flc(d) : 0;
      /* 持續過載：幾分鐘後熱動跳脫 */
      if (run && i > c.at * 1.05) { c.ovl = (c.ovl || 0) + 1; if (c.ovl >= 3) { trip(d, c, 'overload'); continue; } } else c.ovl = 0;
      /* 發熱：電纜的電流超過安培容量、端子鬆脫（接觸電阻大） */
      const over = i / Panel.amp(c.mm2);
      let dh = -0.01;
      if (run && over > 1) dh = (over - 1) * 0.02;
      if (run && c.loose) dh = Math.max(dh, 0.0015);
      c.heat = U.clamp(c.heat + dh, 0, 1.2);
      if (c.heat >= 1 && G.Ev && !activeInc('plant-hot', d.id)) G.Ev.start('plant-hot', { cid: d.id, cause: over > 1 ? 'cable' : 'loose' });
      /* 濕區插座沒有漏電斷路器：有人用的時候，偶爾會有人感電 */
      if (run && d.wet && !c.elcb && s.floors.FAB && s.floors.FAB.movedIn > 0 && U.hourOf(t) >= 8 && U.hourOf(t) < 20 && Math.random() < 1 / (1440 * 3) && G.Ev) G.Ev.start('plant-shock', { cid: d.id });
    }
    /* 中性線：單相負載都擠在同一相時，中性線電流大、匯流排發熱 */
    const ph = Panel.phases(false);
    st.nHeat = U.clamp((st.nHeat || 0) + (ph.N > 45 ? 0.0012 : -0.004), 0, 1.2);
    if (st.nHeat >= 1 && G.Ev && !activeInc('plant-hot', 'N')) G.Ev.start('plant-hot', { cid: 'N', cause: 'neutral' });
  };
  /** 電壓驟降 / 停電：沒有 DUPS 撐住的馬達迴路跟著跳開（電磁接觸器失壓），要等復歸 */
  Panel.dropout = (bus, until) => {
    for (const d of DEF) {
      const c = Panel.c(d.id);
      if (c.bus === bus && d.motor && c.on && !c.trip) c.drop = Math.max(c.drop || 0, until);
    }
  };
})(window.G = window.G || {});
