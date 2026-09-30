/* 晶圓廠 Fab 1（第十章）：產能、Purdue 模型（你的 OT 網路現在長什麼樣子）、OT 網路檢查、
 * 機台進廠與連網（每一台的狀態）、無塵室的保密與機台資安（掃毒站、白名單、手機管制、原廠遠端維護） */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { sel: null, last: 0 };
  G.Views.fab = V;
  const FID = 'FAB';
  const COL = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', info: 'var(--info)', off: 'var(--line-2)' };

  V.mount = (el) => {
    V.el = el;
    const s = G.S, F = s.fab;
    const open = !!F && F.open;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, 'Fab 1 晶圓廠'), h('div', { class: 'desc' }, open
        ? `總部後方的 12 吋試產線：${Fab().slots().length} 台機台、24 小時運轉。每一台都要安全地連上 OT 網路——進廠掃毒 → 接上 FAB IDF 的交換器 → EAP 自動化 → MES 派工。無塵室裡的製程配方是公司最高機密。`
        : '大樓後方的空地將蓋一座晶圓廠：第十章開放。')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn', 'data-hint': 'fab-plan', onclick: () => UI.go('floor:' + FID) }, '無塵室平面圖'),
        h('button', { class: 'btn', onclick: () => UI.openKb('k-ot') }, 'OT / IT 與 Purdue 模型'),
        h('button', { class: 'btn', onclick: () => UI.openKb('k-fab') }, 'MES / EAP / SECS'))));
    if (!open) {
      el.appendChild(h('div', { class: 'note info' }, Q.unlocked(CAT.fab) ? '晶圓廠還在興建中：完工後機台就會陸續進廠。' : `第 ${CAT.fab.unlock} 章開放。`));
      return;
    }
    V.kpi = h('div', { class: 'tiles t4' });
    el.appendChild(V.kpi);
    V.purdue = h('div', { class: 'purdue' });
    V.checks = h('div', { class: 'col', style: { gap: '4px' } });
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'Purdue 模型：你的 OT 網路'), h('span', { class: 'small muted' }, '綠 = 正常 · 橘 = 位置不對 / 不完整 · 紅 = 沒有或被擋')), V.purdue),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, 'OT 網路檢查'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-fabsec') }, '機台資安')), V.checks)));
    V.tools = h('div', { class: 'col', style: { gap: '8px' } });
    V.toolCard = h('div', {});
    el.appendChild(h('div', { class: 'split' },
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '機台進廠與連網'), h('span', { class: 'small muted' }, '點機台看詳情')), V.tools),
      h('div', { class: 'col', style: { gap: '10px' } }, V.toolCard, secCard(), prodCard())));
    V.draw();
  };
  const Fab = () => G.Fab;
  V.update = () => { const now = performance.now(); if (now - V.last < 1000) return; V.draw(); };

  V.draw = () => {
    V.last = performance.now();
    if (!V.kpi || !V.kpi.isConnected) return;
    const s = G.S, F = s.fab, R = G.R.fab;
    const c = Fab().counts(), tot = F.tools.length;
    const tile = (k, v, sub, cls) => h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, sub));
    const rate = R ? R.rate : 0;
    U.mount(V.kpi,
      tile('產能', `${U.num(Math.round(rate))} 片 / 日`, `滿載 ${U.num(CAT.fab.wspd)} 片 · ${R && R.itStop ? '⚠ ' + R.itStop : R && rate > 0 ? bottleneck(R) : '尚未量產'}`, R && R.itStop ? 'bad-t' : rate >= CAT.fab.wspd * 0.8 ? 'ok-t' : rate > 0 ? 'warn-t' : ''),
      tile('良率', R && rate > 0 ? U.pct(R.yield, 1) : '—', R && R.fdcR < 0.5 ? 'FDC 收不到資料：偏移晚發現' : 'FDC 即時監控製程', R && rate > 0 && R.yield < 0.9 ? 'warn-t' : ''),
      tile('機台', `${c.online} / ${tot} 連網`, `自動化 ${R ? R.auto : 0} 台 · 裝機 ${c.install} · 等掃毒 ${c.scan} · 等交換器埠 ${c.ready}`, c.down ? 'bad-t' : ''),
      tile('今日良品', `${U.num(Math.round(F.day.good))} 片`, `累計 ${U.num(Math.round(F.good))} 片 · 報廢 ${U.num(F.scrap)} 片`, F.scrap ? 'warn-t' : ''));
    U.mount(V.purdue, purdue());
    U.mount(V.checks, checks().map((x) => h('div', { class: 'row small chk' + (x.ok ? ' ok' : '') }, h('span', { class: 'ck' }, x.ok ? '✓' : '·'), h('span', { class: 'grow' }, x.t), x.sub ? h('span', { class: 'tiny dim' }, x.sub) : null)));
    U.mount(V.tools, toolList());
    U.mount(V.toolCard, toolCard());
    if (V.chart && V.chart.isConnected) drawChart();
    if (V.hand) V.hand.textContent = handLine();
  };
  /** 產能被什麼卡住：最慢的製程區，加上 MES 以外的全廠因素（工單、手持裝置、工程師） */
  function bottleneck(R) {
    let worst = null;
    for (const [a, x] of Object.entries(R.areas)) if (!worst || x.run < R.areas[worst].run) worst = a;
    const out = [];
    if (worst && R.areas[worst].run < 0.995) out.push(`瓶頸：${CAT.fab.areas[worst].name} ${U.pct(R.areas[worst].run)}`);
    if (!R.erpOk) out.push('工單連不上 ERP −25%');
    if (R.handF < 0.995) out.push(`現場手持裝置不足 −${U.pct(1 - R.handF)}`);
    if (!R.engOk) out.push('工程師看不到 MES −5%');
    return out.join(' · ') || '全速生產';
  }

  /* ---------- Purdue 模型 ---------- */
  function roleSt(r) {
    const list = Q.roleServers(r).filter((d) => d.rack || d.host);
    if (!list.length) return { c: 'bad', t: '還沒有' };
    const z = G.Net.zones();
    const up = list.filter((d) => G.Net.devUp(d));
    const zs = list.map((d) => { const x = z.get(d.id); return x ? x.zone : 'ISOLATED'; });
    if (!up.length) return { c: 'bad', t: `${list.length} 台 · 沒有運作` };
    if (!zs.some((x) => x === 'OT' || x === 'OTBRIDGE')) return { c: 'warn', t: `${list.length} 台 · 在 ${zs[0]}（應在 OT 區）` };
    return { c: 'ok', t: `${up.length} 台 · OT 區` };
  }
  V.status = () => {
    const s = G.S, R = G.R.fab, z = G.Net.zones();
    const fw = G.Sec.hasFirewall();
    const otLinks = Object.values(s.links).filter((l) => l.zone === 'ot');
    const fz = z.get('F:' + FID);
    const post = G.Sec.posture();
    return {
      fw: !fw ? { c: 'bad', t: '沒有防火牆' } : otLinks.length ? { c: 'ok', t: `OT 介面 × ${otLinks.length}` } : { c: 'warn', t: '還沒有 OT 介面' },
      fab: !fz || !fz.linked ? { c: 'bad', t: '還沒有上行' } : fz.zone === 'OT' ? { c: 'ok', t: `OT 區 · 上行 × ${Q.linksOf('F:' + FID).length}` } : fz.zone === 'OTBRIDGE' ? { c: 'bad', t: 'IT / OT 直接相連' } : { c: 'bad', t: `在 ${fz.zone}（沒有 OT 隔離）` },
      mes: roleSt('mes'), eap: roleSt('eap'), fdc: roleSt('fdc'), jump: (() => {
        const j = G.Sec.serverZones('jump');
        if (!j.length) return { c: 'warn', t: '還沒有' };
        return j.some((x) => x.zone === 'DMZ') ? { c: post.jumpOk ? 'ok' : 'warn', t: post.jumpOk ? 'DMZ · MFA' : 'DMZ（規則或 MFA 未完成）' } : { c: 'warn', t: `在 ${j[0].zone}（應在 DMZ）` };
      })(),
      erp: Q.roleServers('db').some((d) => G.Net.devUp(d)) ? { c: 'ok', t: '資料庫 / ERP' } : { c: 'bad', t: '沒有資料庫' },
      lan: { c: 'ok', t: '研發樓層' },
      tools: R ? { c: R.itStop ? 'bad' : R.online < R.total ? 'warn' : 'ok', t: `${R.online} / ${R.total} 台連網 · 自動化 ${R.auto}` } : { c: 'warn', t: '尚未進廠' },
      e: {
        web: !R ? 'off' : R.engOk && G.Sec.allows('LAN', 'OT', 'WEB') ? 'ok' : R.engOk ? 'warn' : 'bad',
        sql: !R ? 'off' : R.erpOk ? 'ok' : 'bad',
        rdp: post.jumpOk ? 'ok' : G.Sec.serverZones('jump').length ? 'warn' : 'off',
        secs: !R || !R.online ? 'off' : R.auto >= R.online ? 'ok' : R.auto > 0 ? 'warn' : 'bad',
        fdc: !R || !R.online ? 'off' : R.fdcR > 0.9 ? 'ok' : R.fdcR > 0 ? 'warn' : 'bad',
        mes: !R ? 'off' : R.mesUp ? 'ok' : 'bad',
      },
    };
  };
  function purdue() {
    const S = V.status();
    const W = 560, H = 344, LX = 116;
    const svg = U.s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Purdue 模型' });
    const bands = [['Level 4–5', '企業 IT（總部）'], ['Level 3.5', 'IT / OT DMZ'], ['Level 3', '製造營運（OT）'], ['Level 2', '自動化控制'], ['Level 1–0', '機台與感測器']];
    const BH = 66;
    bands.forEach(([a, b], i) => {
      const y = 4 + i * (BH + 3);
      svg.appendChild(U.s('rect', { x: 2, y, width: W - 4, height: BH, rx: 8, fill: i === 1 ? 'var(--accent-soft)' : 'var(--bg-2)', stroke: 'var(--line)' }));
      svg.appendChild(U.s('text', { x: 12, y: y + 26, 'font-size': 12, 'font-weight': 700, fill: 'var(--text-2)', 'font-family': 'var(--font-mono)' }, a));
      svg.appendChild(U.s('text', { x: 12, y: y + 44, 'font-size': 11, fill: 'var(--text-3)' }, b));
    });
    const yc = (i) => 4 + i * (BH + 3) + BH / 2;
    /* 左欄：工程師 → 防火牆 → MES → EAP；右欄：ERP、跳板機、FDC；最下面：機台與 FAB IDF */
    const XL = LX + 85, XR = LX + 305, XG = LX + 202, NW = 160;
    const P = { lan: [XL, yc(0)], erp: [XR, yc(0)], fw: [XL, yc(1)], jump: [XR, yc(1)], mes: [XL, yc(2)], fdc: [XR, yc(2)], eap: [XL, yc(3)], tools: [XL + 20, yc(4)], fab: [XR, yc(4)] };
    /** 連線：pts = 途經的點，label 放在 at（[x, y]） */
    const edge = (pts, st, label, at) => {
      const col = COL[st] || COL.off;
      svg.appendChild(U.s('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: col, 'stroke-width': 2.2, 'stroke-dasharray': st === 'off' ? '4 4' : null, 'marker-end': 'url(#pd-arr)' }));
      if (label) {
        const [mx, my] = at;
        svg.appendChild(U.s('rect', { x: mx - 22, y: my - 8, width: 44, height: 16, rx: 4, fill: 'var(--bg)', stroke: col }));
        svg.appendChild(U.s('text', { x: mx, y: my + 4, 'text-anchor': 'middle', 'font-size': 10, fill: col, 'font-family': 'var(--font-mono)', 'font-weight': 700 }, label));
      }
    };
    const defs = U.s('defs', {});
    const mk = U.s('marker', { id: 'pd-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    mk.appendChild(U.s('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'var(--text-3)' }));
    defs.appendChild(mk);
    svg.appendChild(defs);
    const top = (k) => [P[k][0], P[k][1] - 21], bot = (k) => [P[k][0], P[k][1] + 21];
    /* 工程師 → （防火牆）→ MES：WEB */
    edge([bot('lan'), top('mes')], S.e.web, 'WEB', [XL, (yc(0) + yc(1)) / 2]);
    /* MES → （防火牆）→ ERP：SQL */
    edge([[XL + 60, yc(2) - 21], [XG, yc(1)], [XR - 40, yc(0) + 21]], S.e.sql, 'SQL', [XG, yc(1)]);
    /* 跳板機 → 機台：RDP（沿著中間的走道往下） */
    edge([bot('jump'), [XR, yc(1) + 34], [XG - 2, yc(1) + 34], [XG - 2, yc(4) - 21]], S.e.rdp, 'RDP', [XG - 2, yc(2)]);
    /* EAP ⇄ 機台：SECS/GEM */
    edge([bot('eap'), top('tools')], S.e.secs, 'SECS', [XL + 10, (yc(3) + yc(4)) / 2]);
    /* 機台 → FAB IDF → FDC：感測資料 */
    edge([[XL + 120, yc(4)], [XR - NW / 2, yc(4)]], S.e.fdc, null);
    edge([top('fab'), bot('fdc')], S.e.fdc, 'FDC', [XR, yc(3)]);
    /* EAP ⇄ MES */
    edge([top('eap'), bot('mes')], S.e.mes, null);
    const node = (k, title, st, w) => {
      const [x, y] = P[k];
      w = w || NW;
      const g = U.s('g', {});
      g.appendChild(U.s('rect', { x: x - w / 2, y: y - 21, width: w, height: 42, rx: 8, fill: 'var(--bg-3)', stroke: COL[st.c], 'stroke-width': 2 }));
      g.appendChild(U.s('text', { x, y: y - 3, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: 'var(--text)' }, title));
      g.appendChild(U.s('text', { x, y: y + 13, 'text-anchor': 'middle', 'font-size': 10, fill: COL[st.c], 'font-family': 'var(--font-mono)' }, st.t));
      svg.appendChild(g);
    };
    node('lan', '研發工程師（LAN）', S.lan);
    node('erp', 'ERP 資料庫（SERVERS）', S.erp);
    node('fw', '防火牆（OT 介面）', S.fw);
    node('jump', '跳板機（原廠遠端維護）', S.jump);
    node('mes', 'MES 製造執行系統', S.mes);
    node('fdc', 'FDC 異常偵測', S.fdc);
    node('eap', 'EAP 機台自動化', S.eap);
    node('fab', 'FAB IDF（OT 網路）', S.fab);
    node('tools', '製程機台', S.tools, 200);
    return svg;
  }

  /* ---------- OT 網路檢查（和第十章任務一致） ---------- */
  function checks() {
    const s = G.S, F = s.fab, R = G.R.fab, S = V.status(), post = G.Sec.posture();
    const c = Fab().counts();
    const otCore = Object.values(s.links).some((l) => l.zone === 'ot' && [l.a, l.b].some((id) => { const d = s.devices[id]; return d && Q.isL3(d); }));
    return [
      { t: 'OT 核心（L3 交換器）接在防火牆的「OT」介面', ok: otCore },
      { t: 'FAB 無塵室經 OT 核心上行（在 OT 區），而且有兩條上行', ok: S.fab.c === 'ok' && Q.linksOf('F:' + FID).length >= 2, sub: S.fab.t },
      { t: 'MES、EAP、FDC 都放在 OT 區', ok: S.mes.c === 'ok' && S.eap.c === 'ok' && S.fdc.c === 'ok' },
      { t: `EAP 容量夠（一台管 ${CAT.roles.eap.capTools} 台機台）`, ok: !!R && R.eapCap >= Math.max(1, R.online), sub: R ? `${R.eapN} 台 EAP · ${R.online} 台機台` : '' },
      { t: 'IT ⇄ OT 只開必要的：LAN → OT：WEB、OT → SERVERS：SQL；OT 不能上網', ok: post.otIsolated && G.Sec.allows('LAN', 'OT', 'WEB') && G.Sec.allows('OT', 'SERVERS', 'SQL') },
      { t: '機台進廠掃毒站：每一台都掃過才連網', ok: Fab().kioskReady() && !c.skipped, sub: c.skipped ? `${c.skipped} 台略過掃毒` : '' },
      { t: '無塵室禁止私人手機，配發無相機的公司手持裝置', ok: F.phone === 'ban' && F.hand >= Fab().handNeed(), sub: `${F.hand} / ${Fab().handNeed()} 台` },
      { t: '原廠遠端維護走 DMZ 的跳板機（MFA），網際網路不能直連 OT', ok: post.jumpOk },
    ];
  }

  /* ---------- 機台 ---------- */
  const chipCls = (x, R, i) => {
    if (x.down) return 'bad';
    if (x.st === 'online') { const inf = Fab().info(i); return inf.run ? (inf.eapOk ? 'ok' : 'warn') : 'bad'; }
    if (x.st === 'ready' || x.st === 'scan') return 'wait';
    if (x.st === 'install') return 'info';
    return 'off';
  };
  function toolList() {
    const s = G.S, F = s.fab, R = G.R.fab;
    const slots = Fab().slots(), c = Fab().counts();
    const out = [];
    if (c.scan && !Fab().kioskReady()) out.push(h('div', { class: 'note warn small' }, `${c.scan} 台機台裝好了，卻沒有進廠掃毒站可以掃毒。`,
      h('button', { class: 'btn xs', style: { marginLeft: '6px' }, 'data-hint': 'fab-skipscan', onclick: () => UI.confirm('略過進廠掃毒', '沒有掃毒就把原廠的機台接上 OT 網路：原廠裝機用的筆電、USB 如果帶著惡意程式，就會在機台之間擴散（很多機台是不能更新的舊 Windows）。確定要略過？', '略過掃毒，直接連網', () => UI.res(Fab().skipScan('all')), 'danger') }, '略過掃毒（風險自負）')));
    if (c.skipped) out.push(h('div', { class: 'note bad small' }, `${c.skipped} 台機台沒有掃毒就接上了 OT 網路。`, Fab().kioskReady()
      ? h('button', { class: 'btn xs', style: { marginLeft: '6px' }, 'data-hint': 'fab-rescan', onclick: () => UI.res(Fab().rescan()) }, '斷線重掃')
      : h('span', { class: 'dim' }, '　建好進廠掃毒站之後，就能斷線重掃。')));
    const fs = s.floors[FID];
    if (c.ready && fs.cabling.status === 'done' && fs.idf.count > 0) out.push(h('div', { class: 'note warn small' }, `${c.ready} 台機台在等交換器埠：FAB IDF 的埠數不夠（機台共需 ${Fab().portsTotal()} 埠）。`, h('button', { class: 'btn xs', style: { marginLeft: '6px' }, onclick: () => UI.go('floor:' + FID) }, '到 FAB IDF')));
    else if (c.ready + c.scan + c.install > 0 && (fs.cabling.status !== 'done' || fs.idf.count === 0 || !Q.linksOf('F:' + FID).length)) out.push(h('div', { class: 'note info small' }, 'FAB 的網路還沒好（布線、接入交換器、上行）：機台裝好也接不上。', h('button', { class: 'btn xs', style: { marginLeft: '6px' }, onclick: () => UI.go('floor:' + FID) }, '到無塵室')));
    for (const [a, def] of Object.entries(CAT.fab.areas)) {
      const idx = slots.map((t, i) => i).filter((i) => CAT.fab.types[slots[i].type].area === a);
      const ar = R && R.areas[a];
      out.push(h('div', { class: 'fab-area' },
        h('div', { class: 'row between small' }, h('span', {}, h('i', { class: 'fchip', style: { background: def.color } }), h('b', {}, def.name), h('span', { class: 'dim' }, `　${idx.length} 台`)),
          h('span', { class: 'mono tiny' }, ar ? `自動化 ${ar.auto} · 產能 ${U.pct(ar.run)}` : '—')),
        h('div', { class: 'tchips' }, idx.map((i) => {
          const x = F.tools[i];
          return h('button', { class: 'tchip ' + chipCls(x, R, i) + (V.sel === i ? ' sel' : '') + (x.scan === 'skip' ? ' skip' : ''), title: `${Fab().name(i)}：${Fab().info(i).status}`, onclick: () => { V.sel = i; V.draw(); } }, Fab().code(i));
        }))));
    }
    out.push(h('div', { class: 'legend' }, [['var(--ok)', '自動化生產'], ['var(--warn)', '人工操作（連不上 EAP）'], ['var(--bad)', '停機 / 中毒'], ['var(--accent)', '等掃毒 / 等交換器埠'], ['var(--info)', '原廠裝機中'], ['var(--line-2)', '尚未進廠']].map(([c2, t]) => h('span', {}, h('i', { style: { background: c2 } }), t))));
    return out;
  }
  function toolCard() {
    if (V.sel === null || V.sel === undefined || !G.S.fab.tools[V.sel]) return h('div', { class: 'card small muted' }, '點左邊的機台，看它的作業系統、需要幾個埠、資料量與掃毒結果。');
    const inf = Fab().info(V.sel), x = inf.x, d = inf.def;
    const scanTxt = x.caught ? '✓ 掃毒站抓到並清除了惡意程式' : x.scan === 'ok' ? '✓ 通過進廠掃毒' : x.scan === 'skip' ? '⚠ 略過掃毒就接上網路' : x.scanUntil ? `掃毒中（剩 ${U.dur(x.scanUntil - G.S.time)}）` : x.st === 'scan' ? '等待掃毒站' : '—';
    return h('div', { class: 'card col', style: { gap: '6px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, inf.name), h('span', { class: 'chip ' + (x.down ? 'bad' : inf.run ? (inf.eapOk ? 'ok' : 'warn') : '') }, inf.status)),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '製程區 / bay'), h('span', { class: 'v' }, `${inf.area} · ${inf.slot.bay}`),
        h('span', { class: 'k' }, '機台電腦'), h('span', { class: 'v' }, d.os),
        h('span', { class: 'k' }, '交換器埠'), h('span', { class: 'v mono' }, `${d.ports} 個（SECS/GEM${d.ports > 1 ? ' + 原廠診斷 / 大量資料' : ''}）`),
        h('span', { class: 'k' }, 'FDC 感測資料'), h('span', { class: 'v mono' }, `${d.fdc} Mbps`),
        h('span', { class: 'k' }, '進廠掃毒'), h('span', { class: 'v' }, scanTxt),
        h('span', { class: 'k' }, '進廠時間'), h('span', { class: 'v mono' }, x.at ? U.stamp(x.at) : '—')),
      /(不支援升級|XP)/.test(d.os) ? h('div', { class: 'tiny dim' }, '這台機台的電腦是原廠鎖定的舊版 Windows：不能自己裝更新、也不能裝防毒（會失去保固）。只能靠網路隔離、進廠掃毒與應用程式白名單保護它。') : null,
      x.st === 'scan' && !x.scanUntil && !Fab().kioskReady() ? h('button', { class: 'btn xs danger', style: { alignSelf: 'flex-start' }, onclick: () => UI.res(Fab().skipScan(V.sel)) }, '這台略過掃毒，直接連網') : null);
  }

  /* ---------- 保密與資安 ---------- */
  function facRow(k, it, hint) {
    const F = G.S.fab;
    const st = F[k] > 0 ? (G.S.time < F[k] ? `施工中，剩 ${U.dur(F[k] - G.S.time)}` : '✓ 啟用中') : null;
    return h('div', { class: 'row between wrap', style: { gap: '6px' } },
      h('div', { class: 'col', style: { gap: '2px', flex: '1 1 220px' } }, h('b', { class: 'small' }, it.name), h('span', { class: 'tiny dim' }, it.desc)),
      st ? h('span', { class: 'chip ' + (st.startsWith('✓') ? 'ok' : 'info') }, st)
        : h('button', { class: 'btn sm primary', 'data-hint': 'fab-buy:' + k, onclick: () => UI.res(Fab().buy(k)) }, `建置（${U.money(it.price)}）`));
  }
  function handLine() {
    const F = G.S.fab, st = G.R.sim && G.R.sim.floors[FID];
    const cov = st && st.wifi ? st.wifi.usable : 0;
    return `${F.hand} / ${Fab().handNeed()} 台 · 無塵室 Wi-Fi 可用覆蓋 ${U.pct(cov)}${F.phone === 'ban' && cov < 0.9 ? '（bay 裡收不到訊號的地方，手持裝置就查不到 MES）' : ''}`;
  }
  function secCard() {
    const s = G.S, F = s.fab;
    const card = h('div', { class: 'card col', style: { gap: '10px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '無塵室保密與機台資安'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-nophone') }, '為什麼禁止手機？')));
    card.appendChild(facRow('kiosk', CAT.fab.kiosk));
    card.appendChild(facRow('allow', CAT.fab.allowlist));
    card.appendChild(facRow('gate', CAT.fab.gate));
    card.appendChild(h('div', { class: 'row between wrap' }, h('span', { class: 'small' }, '私人手機'),
      h('div', { class: 'seg' },
        h('button', { class: F.phone === 'allow' ? 'on' : '', onclick: () => UI.res(Fab().setPhone('allow')) }, '允許帶進無塵室'),
        h('button', { class: F.phone === 'ban' ? 'on' : '', 'data-hint': 'fab-phone:ban', onclick: () => UI.res(Fab().setPhone('ban')) }, '禁止（鎖在置物櫃）'))));
    const need = Fab().handNeed();
    card.appendChild(h('div', { class: 'row between wrap' },
      h('span', { class: 'small' }, CAT.fab.handheld.name, h('span', { class: 'dim' }, `　每台 ${U.money(CAT.fab.handheld.price)}`)),
      h('div', { class: 'row', style: { gap: '6px' } },
        h('div', { class: 'stepper' },
          h('button', { onclick: () => UI.res(Fab().setHand(F.hand - 10)), 'aria-label': '減少 10 台' }, '−'),
          h('span', { class: 'n' }, String(F.hand)),
          h('button', { 'data-hint': 'fab-hand-add', onclick: () => UI.res(Fab().setHand(F.hand + 10)), 'aria-label': '增加 10 台' }, '+')),
        F.hand < need ? h('button', { class: 'btn xs', 'data-hint': 'fab-hand-fill', onclick: () => UI.res(Fab().setHand(need)) }, `補到 ${need} 台`) : null)));
    V.hand = h('div', { class: 'tiny dim' }, handLine());
    card.appendChild(V.hand);
    if (F.g4 !== undefined && F.g4 !== null) card.appendChild(h('div', { class: 'note bad small' }, `${Fab().code(F.g4)} 上還接著原廠的 4G 分享器：這台機台直接連在網際網路上。`,
      h('button', { class: 'btn xs danger', style: { marginLeft: '6px' }, onclick: () => UI.res(Fab().removeG4()) }, '拆除')));
    const post = G.Sec.posture(), j = G.Sec.serverZones('jump');
    card.appendChild(h('div', { class: 'small' }, h('b', {}, '原廠遠端維護：'), post.jumpOk ? '✓ 經 DMZ 的跳板機（MFA、全程錄影）' : j.length ? '跳板機在了，還差：' + [j.some((x) => x.zone === 'DMZ') ? null : '放到 DMZ', G.Sec.allows('DMZ', 'OT', 'RDP') ? null : '規則 DMZ → OT：RDP', Q.hasService('mfa') ? null : 'MFA'].filter(Boolean).join('、') : '還沒有跳板機（伺服器設成 JMP 角色，接在 DMZ 交換器上）'));
    return card;
  }

  /* ---------- 產能曲線 ---------- */
  function prodCard() {
    V.chart = h('canvas', { class: 'chart', 'aria-label': '晶圓廠產能' });
    requestAnimationFrame(drawChart);
    return h('div', { class: 'card' }, h('div', { class: 'card-h', style: { marginBottom: '4px' } }, h('h3', {}, '產能（最近 24 小時）'), h('span', { class: 'small muted' }, '片 / 日（換算）')), V.chart);
  }
  function drawChart() {
    const hs = G.S.hist;
    if (!V.chart || !V.chart.isConnected || !hs.fab) return;
    const n = 288, t = hs.t.slice(-n), d = hs.fab.slice(-n);
    const tk = U.tokens();
    G.Charts.line(V.chart, { t, yMax: CAT.fab.wspd, series: [{ data: d, color: tk.ok, fill: true }, { data: d.map(() => CAT.fab.wspd * 0.8), color: tk.text3, dash: [4, 3], width: 1 }], yFmt: (v) => String(Math.round(v)) });
  }
})(window.G = window.G || {});
