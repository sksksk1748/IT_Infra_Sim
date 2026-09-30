/* 廠務（第十一章）：
 * 總覽：統包商撤場倒數、各製程區的廠務供應（電、純水、氣體、化學品、排氣、廢水）、廠務告警、FMCS
 * 電力：單線圖（台電 → 主變壓器 → 低壓主配電盤 → 各饋線；DUPS、發電機、緊急電源）、變電設備、DUPS 保護的區域、用電曲線
 * 配電盤實作：js/ui/view-panel.js
 * 純水與廢水、氣體與排氣、化學品：流程圖、設備、容量與需求、危害 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'ov', last: 0, live: [], nodes: [] };
  G.Views.plant = V;
  const TABS = [['ov', '總覽'], ['power', '電力'], ['panel', '配電盤實作'], ['water', '純水與廢水'], ['gas', '氣體與排氣'], ['chem', '化學品']];
  V.TABS = TABS;
  const P = () => G.Plant;
  const PC = () => CAT.plant;
  const AREAS = () => Object.keys(CAT.fab.areas);
  const pctCls = (v) => (v >= 0.995 ? 'ok-t' : v >= 0.5 ? 'warn-t' : 'bad-t');

  /* ---------- 會自己更新的小元件 ---------- */
  function live(fn, cls) {
    const el = h('span', { class: cls || '' }, '');
    V.live.push({ el, fn });
    try { el.textContent = fn(); } catch (e) { el.textContent = '—'; }
    return el;
  }
  /** 每秒重畫的區塊（guard：使用者正在操作裡面的下拉選單時先不要重畫） */
  V.liveNode = (el, fn, guard) => {
    V.nodes.push({ el, fn, guard });
    try { U.mount(el, fn()); } catch (e) { console.error(e); }
    return el;
  };

  V.mount = (el, param) => {
    if (param && TABS.some((t) => t[0] === param)) V.tab = param;
    V.el = el; V.live = []; V.nodes = [];
    const s = G.S;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '廠務：電力、純水、氣體、化學品'), h('div', { class: 'desc' }, '晶圓廠的每一台機台，背後都有電、超純水、氣體、化學品、排氣與洗滌塔在撐著。任何一項斷了，那一區就停線。')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => UI.go('fab') }, '晶圓廠產能'),
        h('button', { class: 'btn', onclick: () => UI.openKb('k-fabpower') }, '晶圓廠供電'),
        h('button', { class: 'btn', onclick: () => UI.openKb('k-loto') }, '停電作業安全'))));
    if (!P().active()) {
      el.appendChild(h('div', { class: 'note info' }, Q.unlocked(PC()) ? '晶圓廠的廠務目前還由建廠的統包商代管。' : `第 ${PC().unlock} 章開放：晶圓廠的電力、純水、氣體與化學品由你接手。`));
      return;
    }
    if (!G.R.plant) P().refresh();
    const R = G.R.plant;
    el.appendChild(h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => {
      const n = R ? R.alarms.filter((a) => a.tab === k && a.sev === 'crit').length : 0;
      return h('button', { class: V.tab === k ? 'on' : '', 'data-hint': 'tab:plant:' + k, onclick: () => { V.tab = k; UI.refresh(); } }, t, n ? h('span', { class: 'count' }, String(n)) : null);
    })));
    if (P().temp()) el.appendChild(h('div', { class: 'note warn', style: { marginBottom: '12px' } }, live(() => `統包商的臨時供應（臨時電源、純水車、鋼瓶車、化學品桶槽）到 ${U.stamp(s.plant.tempUntil)}，還剩 ${U.dur(Math.max(0, s.plant.tempUntil - G.S.time))}：之後晶圓廠就全靠你的廠務系統。`)));
    const body = h('div', {});
    el.appendChild(body);
    if (V.tab === 'ov') ovTab(body);
    else if (V.tab === 'power') powerTab(body);
    else if (V.tab === 'panel') G.PanelUI.mount(body, V);
    else if (V.tab === 'water') waterTab(body);
    else if (V.tab === 'gas') gasTab(body);
    else chemTab(body);
  };
  V.update = () => {
    const now = performance.now();
    if (now - V.last < 1000) return;
    V.last = now;
    if (!V.el || !V.el.isConnected) return;
    for (const x of V.live) { try { x.el.textContent = x.fn(); } catch (e) { x.el.textContent = '—'; } }
    const act = document.activeElement;
    for (const n of V.nodes) {
      if (!n.el.isConnected) continue;
      if (n.guard && act && n.el.contains(act) && act.tagName === 'SELECT') continue;
      try { U.mount(n.el, n.fn()); } catch (e) { console.error(e); }
    }
  };

  /* ---------- 共用：設備一列 ---------- */
  function eqRow(k, need) {
    const it = P().def(k), n = P().count(k), tot = P().total(k), bld = tot - n;
    const lab = P().label(k);
    const multi = it.max > 1;
    const chip = need !== undefined && need !== null ? h('span', { class: 'chip ' + (n >= need ? 'ok' : tot >= need ? 'info' : 'warn') }, `${n} / ${need}`)
      : h('span', { class: 'chip ' + (n ? 'ok' : bld ? 'info' : '') }, n ? (multi ? `${n} 組` : '✓ 啟用中') : bld ? '施工中' : '尚未建置');
    return h('div', { class: 'eq-row' },
      h('div', { class: 'col grow', style: { gap: '2px' } },
        h('div', { class: 'row wrap', style: { gap: '6px' } }, h('b', { class: 'small' }, lab), chip),
        h('span', { class: 'tiny dim' }, it.desc),
        bld ? h('span', { class: 'tiny' }, live(() => { const b = P().building(k); return b ? `施工中 ${b}${multi ? ' 組' : ''}：還要 ${U.dur(Math.max(0, P().readyAt(k) - G.S.time))}` : '施工完成'; })) : null),
      h('div', { class: 'row', style: { gap: '4px', flex: 'none', alignSelf: 'center' } },
        tot < it.max ? h('button', { class: 'btn sm primary', 'data-hint': 'plant-buy:' + k, onclick: () => UI.res(P().buy(k)) }, `${multi && tot ? '加一組' : '建置'}（${U.money(it.price)}）`) : null,
        tot > 0 ? h('button', { class: 'btn sm ghost', title: '拆除（回收四成；施工中取消回收八成）', onclick: () => UI.confirm(`拆除 ${lab}`, `確定要${bld ? '取消施工 / ' : ''}拆除一組 ${lab}？`, '拆除', () => UI.res(P().sell(k)), 'danger') }, '−') : null));
  }
  const tile = (k, v, sub, cls) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, sub));

  /* ---------- 總覽 ---------- */
  const UCOL = [['pwr', '電力'], ['upw', '純水'], ['bulk', '大宗氣體'], ['sg', '特殊氣體'], ['scrub', '洗滌塔'], ['exh', '排氣'], ['chem', '化學品'], ['wwt', '廢水']];
  function matrix() {
    const R = G.R.plant, temp = R.temp;
    const tb = h('tbody', {});
    for (const a of AREAS()) {
      const us = R.areaU[a], f = R.areaF[a];
      const req = PC().area[a];
      const n = P().demand(false).areaN[a] || 0;
      const cells = UCOL.map(([k]) => {
        let v = null;
        if (k === 'pwr') v = us.pwr;
        else if (k === 'chem') { const ks = ['acid', 'solv', 'slurry'].filter((x) => req.includes(x)); if (ks.length) v = Math.min(...ks.map((x) => us[x])); }
        else if (req.includes(k)) v = us[k];
        if (v === null || v === undefined) return h('td', { class: 'dim center' }, '—');
        if (temp && k !== 'pwr') return h('td', { class: 'center' }, h('span', { class: 'chip info', title: '統包商的臨時供應' }, '臨時'));
        return h('td', { class: 'center mono ' + pctCls(v) }, v >= 0.995 ? '✓' : U.pct(v));
      });
      tb.appendChild(h('tr', {}, h('td', {}, h('i', { class: 'fchip', style: { background: CAT.fab.areas[a].color } }), CAT.fab.areas[a].name, h('span', { class: 'tiny dim' }, `　${n} 台`)), ...cells,
        h('td', { class: 'mono ' + pctCls(f) }, U.pct(f), R.areaWhy[a].length ? h('div', { class: 'tiny dim', style: { whiteSpace: 'normal' } }, R.areaWhy[a][0]) : null)));
    }
    return h('table', { class: 't plant-mx' }, h('thead', {}, h('tr', {}, h('th', {}, '製程區'), ...UCOL.map(([, t]) => h('th', { class: 'center' }, t)), h('th', {}, '可生產'))), tb);
  }
  function ovTab(el) {
    const s = G.S;
    const kpi = h('div', { class: 'tiles t4', style: { marginBottom: '12px' } });
    V.liveNode(kpi, () => {
      const R = G.R.plant, pw = R.power, w = R.water, g = R.gas, c = R.chem;
      const cabNeed = U.sum(P().SG, (x) => g.sg[x].needCab), cabHave = U.sum(P().SG, (x) => g.sg[x].cab);
      return [
        tile('用電', `${(pw.load.kw / 1000).toFixed(2)} MW`, pw.temp ? '統包商臨時電源' : `主變壓器 ${pw.txN} 台 · 負載率 ${pw.cap > 0 && isFinite(pw.cap) ? U.pct(pw.load.kva / (pw.cap / PC().txLoad)) : '—'}`, pw.shed < 1 || !pw.normal ? 'bad-t' : ''),
        tile('超純水', `${w.deliver.toFixed(0)} / ${w.demand.toFixed(0)} m³/h`, `電阻率 ${w.resist ? w.resist.toFixed(1) : '—'} MΩ·cm · 純水槽 ${U.pct(w.tank / w.tankCap)}`, w.ratio < 0.95 && !R.temp ? 'bad-t' : ''),
        tile('氣體', `氣瓶櫃 ${cabHave} / ${cabNeed}`, `大宗 ${U.pct(g.bulk)} · GDS ${g.gds ? '✓' : '✗'} · 洗滌塔 ${P().count('scrub')} / ${P().needScrub()}`, !g.gds && !R.temp ? 'bad-t' : ''),
        tile('化學品', `${['acid', 'solv', 'slurry'].filter((k) => P().count(k)).length} / 3 套`, `洩漏偵測 ${c.leak ? '✓' : '✗'} · 廢水處理 ${P().count('wwt') ? '✓' : '✗'}`),
      ];
    });
    el.appendChild(kpi);
    const mx = h('div', { class: 'scroll-x' });
    V.liveNode(mx, matrix);
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'card-h' }, h('h3', {}, '各製程區的廠務供應'), h('span', { class: 'small muted' }, '任何一項不足，那一區就跟著減產；產能看最慢的那一區')), mx));
    const al = h('div', { class: 'col', style: { gap: '4px' } });
    V.liveNode(al, () => {
      const R = G.R.plant, list = R.alarms.filter((a) => a.sev !== 'info');
      if (!list.length) return [h('div', { class: 'small ok-t' }, '✓ 沒有廠務告警')];
      const TN = Object.fromEntries(TABS);
      return list.slice(0, 12).map((a) => h('div', { class: 'row small', style: { gap: '6px', alignItems: 'center' } },
        h('span', { class: 'chip ' + (a.sev === 'crit' ? 'bad' : 'warn') }, a.sev === 'crit' ? '嚴重' : '注意'), h('span', { class: 'grow' }, a.text),
        h('button', { class: 'btn xs', onclick: () => { V.tab = a.tab; UI.refresh(); } }, TN[a.tab] || '查看')));
    });
    const fm = h('div', { class: 'col', style: { gap: '4px' } });
    V.liveNode(fm, () => {
      const f = P().fmcs(), z = Q.roleServers('fmcs').map((d) => { const x = G.Net.zones().get(d.id); return x ? x.zone : '未連線'; });
      const need = Q.floorPortNeed('FAB'), ports = Q.floorPorts('FAB');
      return [
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, 'FMCS 伺服器'), h('span', { class: 'v ' + (f.srv ? '' : 'bad-t') }, f.srv ? `${f.srv} 台 · ${z.join('、')}` : '還沒有（伺服器設成 FMCS 角色，接在 OT 核心）'),
          h('span', { class: 'k' }, 'PLC → FMCS'), h('span', { class: 'v ' + (f.net ? 'ok-t' : 'bad-t') }, f.net ? `Modbus / BACnet 連線正常（${P().plcCount()} 台 PLC）` : '連不上（FAB IDF → OT 核心 → FMCS）'),
          h('span', { class: 'k' }, 'PLC 盤電源'), h('span', { class: 'v ' + (f.plc ? 'ok-t' : 'bad-t') }, f.plc ? '有電（緊急電源區）' : '沒電（配電盤 PLC 迴路）'),
          h('span', { class: 'k' }, 'FAB IDF 的埠'), h('span', { class: 'v mono ' + (ports >= need.total ? '' : 'bad-t') }, `${ports} / 需要 ${need.total}（機台 ${need.tools} + PLC ${need.plc} + AP ${need.aps} + 其他）`)),
        h('div', { class: 'tiny dim' }, f.ok ? 'FMCS 看得到每一套廠務設備：告警即時、停電後自動依序復歸馬達（約 5 分鐘）。' : '沒有 FMCS：廠務的異常要等巡檢才發現，停電後的馬達也要一台一台人工復歸（約 30 分鐘）。'),
      ];
    });
    el.appendChild(h('div', { class: 'grid c2' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '廠務告警')), al),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'FMCS 廠務監控'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-fmcs') }, 'FMCS 與 Modbus')), fm)));
  }

  /* ---------- 電力 ---------- */
  function sld() {
    const R = G.R.plant, pw = R.power, P0 = G.S.plant;
    const W = 760, H = 360;
    const svg = U.s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '晶圓廠單線圖' });
    const line = (pts, c, dash, w) => svg.appendChild(U.s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: c, 'stroke-width': w || 2.2, 'stroke-dasharray': dash || null }));
    const box = (x, y, w, hh, title, sub, st, extra) => {
      const c = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', off: 'var(--line-2)', info: 'var(--info)' }[st] || 'var(--line-2)';
      svg.appendChild(U.s('rect', Object.assign({ x, y, width: w, height: hh, rx: 6, fill: 'var(--bg-3)', stroke: c, 'stroke-width': 2, 'stroke-dasharray': st === 'off' ? '4 3' : null }, extra || {})));
      svg.appendChild(U.s('text', { x: x + w / 2, y: y + (sub ? hh / 2 - 3 : hh / 2 + 4), 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--text)' }, title));
      if (sub) svg.appendChild(U.s('text', { x: x + w / 2, y: y + hh / 2 + 11, 'text-anchor': 'middle', 'font-size': 9.5, fill: c, 'font-family': 'var(--font-mono)' }, sub));
    };
    const lc = (on) => (on ? 'var(--ok)' : 'var(--bad)');
    /* 台電兩條回路 → 高壓盤 */
    const f2 = P().count('feeder2') > 0, f2b = P().building('feeder2') > 0;
    box(20, 12, 150, 38, '台電 22.8 kV A 路', pw.out ? '停電！' : pw.grid === 'sag' ? '電壓驟降' : '供電中', pw.out ? 'bad' : 'ok');
    box(190, 12, 150, 38, '台電 22.8 kV B 路', f2 ? '備援（自動切換）' : f2b ? '施工中' : '沒有申請', f2 ? 'ok' : f2b ? 'info' : 'off');
    line([[95, 50], [95, 70]], lc(!pw.out)); line([[265, 50], [265, 70]], f2 ? 'var(--ok)' : 'var(--line-2)', f2 ? null : '4 4');
    svg.appendChild(U.s('rect', { x: 20, y: 70, width: 320, height: 8, rx: 3, fill: pw.out ? 'var(--bad)' : 'var(--text-3)' }));
    svg.appendChild(U.s('text', { x: 350, y: 78, 'font-size': 10, fill: 'var(--text-3)' }, '高壓配電盤（VCB）'));
    /* 主變壓器 */
    const n = P().count('tx'), tot = P().total('tx'), need = P().needTx();
    const txN = Math.max(tot, need + 1);
    const tw = Math.min(90, 320 / txN - 8);
    for (let i = 0; i < txN; i++) {
      const x = 20 + i * (tw + 8), built = i < n, bld = i >= n && i < tot;
      line([[x + tw / 2, 78], [x + tw / 2, 96]], built ? 'var(--text-3)' : 'var(--line-2)', built ? null : '4 4');
      box(x, 96, tw, 44, `TR-${i + 1}`, built ? '5,000 kVA' : bld ? '施工中' : '需要', built ? (pw.temp ? 'info' : 'ok') : bld ? 'info' : 'off');
      line([[x + tw / 2, 140], [x + tw / 2, 158]], built ? 'var(--text-3)' : 'var(--line-2)', built ? null : '4 4');
    }
    if (pw.temp) svg.appendChild(U.s('text', { x: 350, y: 124, 'font-size': 10, fill: 'var(--info)' }, '目前由統包商的臨時電源供電'));
    svg.appendChild(U.s('text', { x: 350, y: 110, 'font-size': 10, fill: n >= need + 1 ? 'var(--ok)' : n >= need ? 'var(--warn)' : 'var(--bad)' }, `需要 ${need} 台（N），N+1 = ${need + 1} 台`));
    /* 低壓主配電盤 */
    svg.appendChild(U.s('rect', { x: 20, y: 158, width: 720, height: 8, rx: 3, fill: pw.normal ? 'var(--accent)' : 'var(--bad)' }));
    svg.appendChild(U.s('text', { x: 740, y: 152, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--text-3)' }, `低壓主配電盤 380 / 220 V · 需量 ${U.num(Math.round(pw.load.kva))} kVA · 容量 ${isFinite(pw.cap) ? U.num(Math.round(pw.cap)) + ' kVA（九成）' : '臨時電源'}`));
    /* 饋線：八個製程區 + 空調冰水 + 大宗氣體 + DP-UT1 + 照明資訊 */
    const D = pw.dups, d = P().demand(true);
    const SHORT = { litho: '黃光', etch: '蝕刻', film: '薄膜', diff: '擴散', imp: '植入', cmp: 'CMP 濕式', metro: '量測', amhs: '搬運' };
    const fe = AREAS().map((a) => ({ k: a, name: SHORT[a] || CAT.fab.areas[a].name, kw: d.areaKW[a] || 0, dups: D.ok && P0.dupsOn[a], trip: (P0.trip[a] || 0) > G.S.time, f: R.areaU[a].pwr }))
      .concat([{ k: 'hvac', name: '空調冰水', kw: PC().base.hvac, f: pw.normal ? 1 : 0 }, { k: 'bulk', name: '大宗氣體', kw: pw.load.bulkKW, f: pw.normal ? 1 : 0 }, { k: 'dp', name: 'DP-UT1', kw: G.Panel.kw(), f: G.Panel.busLive('N') ? 1 : 0, panel: true }, { k: 'misc', name: '照明資訊', kw: PC().base.misc, f: pw.normal || pw.emerg ? 1 : 0 }]);
    const fw = 720 / fe.length;
    fe.forEach((x, i) => {
      const cx = 20 + i * fw + fw / 2;
      const st = x.trip ? 'bad' : x.f >= 0.995 ? 'ok' : x.f > 0 ? 'warn' : 'bad';
      line([[cx, 166], [cx, 196]], x.dups ? '#a78bfa' : 'var(--text-3)');
      box(20 + i * fw + 2, 196, fw - 4, 54, x.name, `${U.num(Math.round(x.kw))} kW`, st, x.dups ? { stroke: '#a78bfa' } : null);
      svg.appendChild(U.s('text', { x: cx, y: 262, 'text-anchor': 'middle', 'font-size': 8.5, fill: x.trip ? 'var(--bad)' : x.dups ? '#a78bfa' : 'var(--text-3)' }, x.trip ? '跳電重開中' : x.dups ? 'DUPS 保護' : x.panel ? '見配電盤' : ''));
    });
    /* DUPS 與發電機 → 緊急電源 */
    const dn = P().count('dups'), gn = P().count('gen'), g = pw.gen;
    box(20, 282, 220, 50, `DUPS ${dn ? `${dn} × 1,000 kVA` : '（沒有）'}`, dn ? `保護 ${U.num(Math.round(D.kva))} / ${U.num(D.cap)} kVA${D.over ? ' 過載！' : ''}` : '電壓驟降時全廠跳機', dn ? (D.over ? 'bad' : 'ok') : 'off', dn ? { stroke: '#a78bfa' } : null);
    box(260, 282, 220, 50, `緊急發電機 ${gn ? `${gn} × 750 kW` : '（沒有）'}`, gn ? `${g.ok ? '夠' : '不夠'}：維生負載 ${g.need} kW${pw.genRun ? ' · 運轉中' : ''}` : '停電時維生負載沒電', gn ? (g.ok ? 'ok' : 'bad') : 'off');
    box(500, 282, 240, 50, '緊急電源（DP-UT1 緊急電源區）', `排氣 · 洗滌塔 · GDS · FMCS · ${pw.emerg ? '有電' : '沒電！'}`, pw.emerg ? 'ok' : 'bad');
    line([[240, 307], [260, 307]], 'var(--text-3)', '3 3'); line([[480, 307], [500, 307]], pw.emerg ? 'var(--ok)' : 'var(--bad)');
    return svg;
  }
  function powerTab(el) {
    const sl = h('div', { class: 'sld' });
    V.liveNode(sl, sld);
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'card-h' }, h('h3', {}, '單線圖'), h('span', { class: 'small muted' }, '紫色 = 接在 DUPS · 虛線 = 還沒有 / 施工中')), sl));
    const R = G.R.plant, pw = R.power;
    const need = P().needTx();
    const txInfo = h('div', { class: 'tiny' });
    V.liveNode(txInfo, () => { const L = P().load(true); return [`設計需量 ${U.num(Math.round(L.kva))} kVA（全部機台 ${U.num(Math.round(L.proc))} kW + 空調冰水 ${U.num(L.hvac)} kW + 大宗氣體 ${U.num(L.bulkKW)} kW + 配電盤 ${U.num(Math.round(L.panelKW))} kW + 照明資訊 ${U.num(L.misc)} kW，功率因數 0.92）；一台 5,000 kVA × 九成 = 4,500 kVA → 需要 ${need} 台，N+1 = ${need + 1} 台`]; });
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '受電與變電')), eqRow('tx', need + 1), txInfo, eqRow('feeder2')),
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '電力品質：DUPS 與緊急發電機')), eqRow('dups'), dupsList(), eqRow('gen'),
        h('div', { class: 'tiny' }, live(() => { const g = P().gen(); return `維生負載 ${g.need} kW（配電盤緊急電源區 ${Math.round(G.Panel.kw('E'))} kW + 無塵室的緊急照明、排煙與資訊 ${PC().base.life} kW）· 發電機 ${U.num(g.kw)} kW ${g.ok && g.kw ? '✓' : '✗'}`; })))));
    const cv = h('canvas', { class: 'chart', 'aria-label': '晶圓廠用電' });
    const tick = h('span', { hidden: true });
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h', style: { marginBottom: '4px' } }, h('h3', {}, '晶圓廠用電（最近 24 小時）'), h('span', { class: 'small muted' }, live(() => `電壓驟降 ${G.S.plant.stats.sags} 次 · 停電 ${G.S.plant.stats.outages} 次 · 跳電報廢 ${G.S.plant.stats.scrap} 片`))), cv, tick));
    requestAnimationFrame(() => chart(cv));
    V.liveNode(tick, () => { chart(cv); return []; });
  }
  function dupsList() {
    const box = h('div', { class: 'col', style: { gap: '3px' } });
    const d = P().demand(true), P0 = G.S.plant;
    box.appendChild(h('div', { class: 'tiny dim' }, '要接到 DUPS 的製程區（電壓驟降、停電時照常運轉）：跳機後恢復越久、製程中的晶圓越多，越值得保護。'));
    for (const a of AREAS()) {
      const kw = d.areaKW[a] || 0;
      box.appendChild(h('label', { class: 'row small', style: { gap: '6px', alignItems: 'center' } },
        h('input', { type: 'checkbox', 'data-hint': 'plant-dups:' + a, checked: P0.dupsOn[a] || null, onchange: (e) => UI.res(P().setDups(a, e.target.checked)) }),
        h('i', { class: 'fchip', style: { background: CAT.fab.areas[a].color } }), h('span', { class: 'grow' }, CAT.fab.areas[a].name),
        h('span', { class: 'mono tiny dim' }, `${U.num(Math.round(kw / PC().pf))} kVA · 恢復 ${U.dur(PC().recover[a])} · 報廢 ${PC().wip[a]} 片`)));
    }
    box.appendChild(h('div', { class: 'tiny' }, live(() => { const D = P().dups(); return D.cap ? `DUPS 負載 ${U.num(Math.round(D.kva))} / ${U.num(D.cap)} kVA（含配電盤緊急電源區）${D.over ? '　⚠ 過載：什麼都保護不了' : ''}` : '還沒有 DUPS：勾了也沒有用'; })));
    return box;
  }
  function chart(cv) {
    const hs = G.S.hist;
    if (!cv || !cv.isConnected || !hs.fabMW) return;
    const n = 288, t = hs.t.slice(-n), d = hs.fabMW.slice(-n);
    const tk = U.tokens();
    const cap = P().count('tx') * PC().eq.tx.kva * PC().txLoad * PC().pf / 1000;
    G.Charts.line(cv, { t, yMax: Math.max(10, cap || 0, ...d.filter((x) => x !== null)) * 1.1, series: [{ data: d, color: tk.accent, fill: true }].concat(cap ? [{ data: d.map(() => cap), color: tk.text3, dash: [4, 3], width: 1 }] : []), yFmt: (v) => v.toFixed(1) + ' MW' });
  }

  /* ---------- 純水與廢水 ---------- */
  function flow() {
    const R = G.R.plant, w = R.water;
    const W = 760, H = 210;
    const svg = U.s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '純水流程' });
    const box = (x, y, bw, bh, t1, t2, st) => {
      const c = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', off: 'var(--line-2)' }[st];
      svg.appendChild(U.s('rect', { x, y, width: bw, height: bh, rx: 7, fill: 'var(--bg-3)', stroke: c, 'stroke-width': 2, 'stroke-dasharray': st === 'off' ? '4 3' : null }));
      svg.appendChild(U.s('text', { x: x + bw / 2, y: y + bh / 2 - 3, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--text)' }, t1));
      svg.appendChild(U.s('text', { x: x + bw / 2, y: y + bh / 2 + 12, 'text-anchor': 'middle', 'font-size': 9.5, fill: c, 'font-family': 'var(--font-mono)' }, t2));
    };
    const arrow = (x1, y1, x2, y2, label, on, dash) => {
      svg.appendChild(U.s('line', { x1, y1, x2, y2, stroke: on ? '#3fa9f5' : 'var(--line-2)', 'stroke-width': 3, 'stroke-dasharray': dash || null, 'marker-end': 'url(#uw-arr)' }));
      if (label) svg.appendChild(U.s('text', { x: (x1 + x2) / 2, y: Math.min(y1, y2) - 6, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, label));
    };
    const defs = U.s('defs', {});
    const mk = U.s('marker', { id: 'uw-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' });
    mk.appendChild(U.s('path', { d: 'M0 0 L10 5 L0 10 z', fill: '#3fa9f5' }));
    defs.appendChild(mk); svg.appendChild(defs);
    const pf = (id) => { const c = G.Panel.c(id); return c.trip ? '跳脫' : !G.Panel.running(id) ? '停' : G.Panel.def(id).motor && !c.seq ? '反轉!' : '運轉'; };
    box(10, 70, 90, 50, '自來水', w.reclaim ? `${w.city.toFixed(0)} m³/h` : `${w.city.toFixed(0)} m³/h`, w.drought ? 'warn' : 'ok');
    const roSt = !w.roCap ? 'off' : w.roF >= 0.99 ? 'ok' : w.roF > 0 ? 'warn' : 'bad';
    box(130, 62, 140, 66, `前處理 + RO × ${P().count('ro')}`, `${w.roRate.toFixed(0)} / ${w.roCap} m³/h`, roSt);
    svg.appendChild(U.s('text', { x: 200, y: 142, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--text-3)' }, `P-101 ${pf('P101')} · P-201 ${pf('P201')}`));
    /* 純水槽（液位） */
    const lv = w.tank / w.tankCap;
    svg.appendChild(U.s('rect', { x: 300, y: 52, width: 70, height: 86, rx: 6, fill: 'var(--bg-2)', stroke: 'var(--line-2)', 'stroke-width': 2 }));
    svg.appendChild(U.s('rect', { x: 303, y: 55 + 80 * (1 - lv), width: 64, height: 80 * lv, rx: 4, fill: '#3fa9f5', opacity: 0.55 }));
    svg.appendChild(U.s('text', { x: 335, y: 46, 'text-anchor': 'middle', 'font-size': 10.5, 'font-weight': 700, fill: 'var(--text)' }, '純水槽'));
    svg.appendChild(U.s('text', { x: 335, y: 100, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: lv < 0.25 ? 'var(--bad)' : 'var(--text)', 'font-family': 'var(--font-mono)' }, U.pct(lv)));
    const poSt = !w.polCap ? 'off' : w.polF >= 0.99 ? 'ok' : w.polF > 0 ? 'warn' : 'bad';
    box(400, 62, 150, 66, `拋光 × ${P().count('polish')}（EDI · UV · UF）`, `${w.polOut.toFixed(0)} / ${w.polCap} m³/h`, poSt);
    svg.appendChild(U.s('text', { x: 475, y: 142, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--text-3)' }, `P-301 ${pf('P301')} · ${w.resist ? w.resist.toFixed(1) + ' MΩ·cm' : '—'}${w.mon ? ' · 線上監測' : ''}`));
    box(580, 62, 170, 66, '晶圓廠（機台）', `${w.deliver.toFixed(0)} / ${w.demand.toFixed(0)} m³/h`, w.ratio >= 0.995 ? 'ok' : w.ratio > 0.5 ? 'warn' : 'bad');
    arrow(100, 95, 128, 95, '', true);
    arrow(270, 95, 298, 95, '', w.roRate > 0);
    arrow(370, 95, 398, 95, '', w.polOut > 0);
    arrow(550, 95, 578, 95, '', w.deliver > 0);
    /* 廢水處理與回收 */
    const wwSt = !P().count('wwt') ? 'off' : w.wwt >= 0.99 ? 'ok' : 'bad';
    box(580, 158, 170, 44, '廢水處理（酸鹼 · 含氟）', P().count('wwt') ? `WWT 泵 ${pf('WWT')}` : '還沒建置', wwSt);
    arrow(665, 128, 665, 156, '', w.deliver > 0);
    if (w.reclaim) { svg.appendChild(U.s('polyline', { points: '580,180 200,180 200,130', fill: 'none', stroke: '#43c59e', 'stroke-width': 2.5, 'stroke-dasharray': '6 4' })); svg.appendChild(U.s('text', { x: 390, y: 174, 'text-anchor': 'middle', 'font-size': 9.5, fill: '#43c59e' }, '回收水 → RO（自來水用量少六成）')); }
    else svg.appendChild(U.s('text', { x: 390, y: 184, 'text-anchor': 'middle', 'font-size': 9.5, fill: 'var(--text-3)' }, '沒有回收水：處理後全部放流'));
    return svg;
  }
  function waterTab(el) {
    const fl = h('div', { class: 'sld' });
    V.liveNode(fl, flow);
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'card-h' }, h('h3', {}, '超純水流程'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-upw') }, '超純水')), fl));
    const w = G.R.plant.water;
    const needRo = P().needRo(), needPol = P().needPolish();
    el.appendChild(h('div', { class: 'grid c2' },
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '造水與送水')),
        h('div', { class: 'tiny' }, `設計需求 ${w.need.toFixed(1)} m³/h：濕式清洗、CMP 用最多，浸潤式曝光機也要超純水。RO 造水、拋光送水，兩段都要夠。`),
        eqRow('ro', needRo), eqRow('polish', needPol), eqRow('upwmon')),
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '廢水與回收')), eqRow('wwt'), eqRow('reclaim'),
        h('div', { class: 'tiny dim' }, '含氟廢水（氫氟酸）要加鈣沉澱成氟化鈣；CMP 研磨廢水要去除懸浮固體。水質合格才能放流，放流水還要定期給環保局檢驗。'))));
  }

  /* ---------- 氣體與排氣 ---------- */
  function gasTab(el) {
    const R = G.R.plant, g = R.gas;
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '大宗氣體（N₂ / CDA）'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-gas') }, '氣體')),
        h('div', { class: 'tiny' }, live(() => { const x = G.R.plant.gas; return `需求 ${U.num(Math.round(x.bulkDemand))} / 設計 ${U.num(Math.round(x.bulkNeed))} Nm³/h · 供應能力 ${U.num(Math.round(x.bulkCap))} Nm³/h（空壓機要有電）`; })),
        eqRow('bulk', P().needBulk())),
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '安全：氣體偵測與緊急遮斷')),
        eqRow('gds'), eqRow('eso'),
        h('div', { class: 'tiny' }, live(() => { const x = G.R.plant.gas; return !x.gds ? '沒有 GDS：工安規定特殊氣體不准供氣。' : x.gdsRun ? '✓ GDS 主機運轉中（偵測器 → 主機 → 緊急遮斷閥）' : '✗ GDS 主機沒電（配電盤 GDS 迴路）：有 ESO 的話，所有特殊氣體會自動關閉'; }, '')))));
    const tb = h('tbody', {});
    for (const x of P().SG) {
      const sg = PC().sg[x], row = g.sg[x];
      const k = 'gc:' + x, tot = P().total(k), n = P().count(k);
      tb.appendChild(h('tr', {},
        h('td', {}, h('b', {}, sg.name), h('div', { class: 'tiny dim' }, sg.gases)),
        h('td', { class: 'tiny', style: { whiteSpace: 'normal', maxWidth: '260px' } }, sg.hazard),
        h('td', { class: 'mono center' }, String(row.tools)),
        h('td', { class: 'mono center ' + (n >= row.needCab ? 'ok-t' : 'bad-t') }, `${n}${tot > n ? `（+${tot - n}）` : ''} / ${row.needCab}`),
        h('td', { class: 'mono center ' + pctCls(row.ratio) }, row.need ? U.pct(row.ratio) : '—'),
        h('td', {}, h('div', { class: 'row', style: { gap: '4px' } },
          tot < PC().eq.gc.max ? h('button', { class: 'btn xs primary', 'data-hint': 'plant-buy:' + k, onclick: () => UI.res(P().buy(k)) }, `+ 一座（${U.money(PC().eq.gc.price)}）`) : null,
          tot ? h('button', { class: 'btn xs ghost', onclick: () => UI.res(P().sell(k)) }, '−') : null))));
    }
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'card-h' }, h('h3', {}, '特殊氣體：氣瓶櫃（每一類分開存放）'), h('span', { class: 'small muted' }, '一座氣瓶櫃經閥箱（VMB）分給好幾台機台')),
      h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, '類別'), h('th', {}, '危害'), h('th', { class: 'center' }, '機台'), h('th', { class: 'center' }, '氣瓶櫃'), h('th', { class: 'center' }, '供應'), h('th', {}, ''))), tb))));
    const ex = h('div', { class: 'tiny' });
    V.liveNode(ex, () => {
      const x = G.R.plant.gas;
      const fan = (id) => { const c = G.Panel.c(id); return `${id} ${c.trip ? '跳脫' : !G.Panel.running(id) ? '停止' : !c.seq ? '反轉（風量不足）' : '運轉'}`; };
      return [`排氣：${fan('EF1')} · ${fan('EF2')} → 風量 ${U.pct(x.exh)}；洗滌塔 ${P().count('scrub')} 組（${x.scrubCap} 台）/ 需要處理 ${x.scrubNeed} 台 · SC-1 循環泵 ${G.Panel.running('SC1') ? '運轉' : '停止'} → ${U.pct(x.scrub)}`];
    });
    el.appendChild(h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '排氣與洗滌塔')),
      h('div', { class: 'tiny dim' }, '蝕刻、沉積、擴散、植入的廢氣有毒、可燃、含氟：先經機台旁的現址洗滌塔，再進中央洗滌塔，排氣風機把處理過的氣體排到屋頂的煙囪。排氣一停，這些機台就會連鎖停機。'),
      eqRow('scrub', P().needScrub()), ex));
  }

  /* ---------- 化學品 ---------- */
  const CHEM = [
    ['H₂SO₄ 硫酸', '濕式清洗（SPM 去除光阻、有機物）', '強腐蝕、遇水劇烈放熱', '大量清水沖洗 15 分鐘以上'],
    ['H₂O₂ 雙氧水', '濕式清洗（SPM、SC1、SC2）', '強氧化劑，和有機物接觸可能起火', '清水沖洗、遠離可燃物'],
    ['HF 氫氟酸', '去除氧化層', '會穿透皮膚、和體內的鈣結合（低血鈣、心律不整）；一開始不痛', '沖水後塗葡萄糖酸鈣凝膠、立刻送醫'],
    ['NH₄OH 氨水', '濕式清洗（SC1 去除微粒）', '刺激性、揮發出氨氣', '通風、清水沖洗'],
    ['HCl 鹽酸', '濕式清洗（SC2 去除金屬）', '腐蝕性、揮發出氯化氫', '通風、清水沖洗'],
    ['IPA 異丙醇', '清洗後的乾燥', '易燃（儲存區要防爆）', '遠離火源、通風'],
    ['TMAH 顯影液', '黃光顯影', '劇毒：大面積皮膚接觸就可能致命', '立刻沖水、送醫'],
    ['研磨液（Slurry）', 'CMP 化學機械研磨', '奈米顆粒；乾掉結塊會刮傷晶圓', '持續攪拌循環，不能讓它沉澱'],
  ];
  function chemTab(el) {
    const st = h('div', { class: 'tiny' });
    V.liveNode(st, () => { const c = G.R.plant.chem, cc = G.Panel.c('CDS'); return [`CDS 化學品泵浦（配電盤 CDS 迴路）：${cc.trip ? '跳脫' : G.Panel.running('CDS') ? '運轉' : '停止'} · 酸鹼 ${U.pct(c.acid)} · 溶劑 / 顯影液 ${U.pct(c.solv)} · 研磨液 ${U.pct(c.slurry)}`]; });
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '化學品供應'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-chem') }, '化學品')),
        h('div', { class: 'tiny dim' }, '濕式清洗要酸鹼、黃光的塗佈顯影機要溶劑與顯影液、CMP 要研磨液。化學品從儲槽經泵浦、雙套管與閥箱送到機台。'),
        eqRow('acid'), eqRow('solv'), eqRow('slurry'), st),
      h('div', { class: 'card col', style: { gap: '8px' } }, h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '安全')), eqRow('leak'),
        h('div', { class: 'tiny dim' }, '化學品洩漏的處理原則：先切斷來源（關閥）、圍起洩漏區、穿全套防護裝備再處理；有人暴露就立刻沖水、送醫。'))));
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '化學品與危害')),
      h('div', { class: 'scroll-x' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, h('th', {}, '化學品'), h('th', {}, '用途'), h('th', {}, '危害'), h('th', {}, '洩漏 / 暴露時'))),
        h('tbody', {}, CHEM.map((r) => h('tr', {}, r.map((x, i) => h('td', { class: i ? 'small' : '', style: { whiteSpace: 'normal' } }, i ? x : h('b', {}, x))))))))));
  }
})(window.G = window.G || {});
