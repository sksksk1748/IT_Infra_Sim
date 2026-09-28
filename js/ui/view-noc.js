/* 網管監控中心（NOC）：即時 KPI、流量趨勢圖、鏈路使用率排行、樓層狀態、NetFlow 異常、告警
 * 沒有部署 NMS 伺服器時，只看得到 ISP 入口網站提供的 WAN 總量。
 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { range: 288 };
  G.Views.noc = V;

  V.mount = (el) => {
    V.el = el;
    const nms = G.Ops.nmsUp();
    const seg = h('div', { class: 'seg' }, [[72, '6 小時'], [288, '24 小時'], [864, '3 天']].map(([n, t]) => h('button', { class: V.range === n ? 'on' : '', onclick: () => { V.range = n; UI.refresh(); } }, t)));
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '網管監控中心 NOC'), h('div', { class: 'desc' }, nms ? 'NMS 以 SNMP 輪詢每台設備、以 NetFlow 分析流量。上班時間（09:00～18:00）是尖峰。' : '目前只有 ISP 入口網站提供的 WAN 總流量。部署網管監控伺服器（NMS）後，才看得到每條鏈路、設備與異常流量。')),
      h('div', { class: 'row wrap' }, seg, h('button', { class: 'btn', onclick: () => UI.openKb('k-nms') }, 'SNMP / NetFlow'), h('button', { class: 'btn', onclick: () => UI.showLog() }, '營運日誌'))));
    if (!nms) el.appendChild(h('div', { class: 'note warn', style: { marginBottom: '12px' } }, h('b', {}, '看不見的東西，就無法管理。　'), '沒有 NMS 時，你只能等使用者打電話來抱怨才知道出事。', h('button', { class: 'btn sm primary', style: { marginLeft: '8px' }, onclick: () => UI.go('shop:srv') }, '部署 NMS')));
    V.tiles = h('div', { class: 'tiles' });
    el.appendChild(V.tiles);
    const chart = (key, title, locked) => {
      const cv = h('canvas', { class: 'chart', 'aria-label': title });
      const lg = h('div', { class: 'legend', style: { marginTop: '0', marginBottom: '6px' } });
      const card = h('div', { class: 'card' + (locked ? ' locked' : '') }, h('div', { class: 'card-h', style: { marginBottom: '4px' } }, h('h3', {}, title)), lg, cv,
        locked ? h('div', { class: 'lock-cover' }, h('div', {}, h('b', {}, '需要 NMS'), h('div', { class: 'small muted' }, '部署網管監控伺服器後解鎖'))) : null);
      V.charts[key] = { cv, lg, locked };
      return card;
    };
    V.charts = {};
    el.appendChild(h('div', { class: 'grid c3', style: { marginBottom: '12px' } },
      chart('wan', '網際網路流量（WAN）', false),
      chart('intra', '內部流量（員工 ↔ 伺服器、備份）', !nms),
      chart('sat', '使用者滿意度 / 官網可用率', false),
      chart('lat', '平均延遲（RTT）', !nms),
      chart('fw', '防火牆處理量使用率', !nms),
      chart('temp', '機房溫度與 IT 負載', false)));
    V.linksBox = h('div', {});
    V.floorBox = h('div', { class: 'floor-grid' });
    V.anomBox = h('div', {});
    V.devBox = h('div', {});
    V.alertBox = h('div', { class: 'alog' });
    const lockCover = (t) => (nms ? null : h('div', { class: 'lock-cover' }, h('div', {}, h('b', {}, '需要 NMS'), h('div', { class: 'small muted' }, t))));
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card' + (nms ? '' : ' locked') }, h('div', { class: 'card-h' }, h('h3', {}, '鏈路使用率排行')), V.linksBox, lockCover('SNMP 介面流量')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '各樓層狀態'), h('span', { class: 'small muted' }, '滿意度 · 上行使用率')), V.floorBox)));
    el.appendChild(h('div', { class: 'grid c3' },
      h('div', { class: 'card' + (nms ? '' : ' locked') }, h('div', { class: 'card-h' }, h('h3', {}, 'NetFlow 異常流量'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-phish') }, 'C2 是什麼？')), V.anomBox, lockCover('NetFlow 流量分析')),
      h('div', { class: 'card' + (nms ? '' : ' locked') }, h('div', { class: 'card-h' }, h('h3', {}, '路由器 / 防火牆效能')), V.devBox, lockCover('設備效能監控')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '告警紀錄')), V.alertBox)));
    V.draw();
  };
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 1500) return;
    V.draw();
  };

  function slice(arr) { return arr.slice(Math.max(0, arr.length - V.range)); }
  function lg(el, items) { U.mount(el, items.map(([c, t, dash]) => h('span', {}, h('i', { style: dash ? { background: 'none', borderTop: '2px dashed ' + c, height: '0', verticalAlign: '3px' } : { background: c } }), t))); }

  V.draw = () => {
    V.last = performance.now();
    const s = G.S, sim = G.R.sim;
    if (!sim || !V.tiles || !V.tiles.isConnected) return;
    const nms = G.Ops.nmsUp();
    const tk = U.tokens();
    const hs = s.hist;
    /* KPI 磚 */
    const tile = (k, v, sub, spark, color, max, cls) => {
      const cv = h('canvas', {});
      const t = h('div', { class: 'tile' }, h('div', { class: 'k' }, k), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 's' }, sub), spark ? cv : null);
      if (spark) requestAnimationFrame(() => G.Charts.spark(cv, spark, color, max));
      return t;
    };
    const cap = sim.wan.cap || 0;
    const sat = sim.sat;
    U.mount(V.tiles,
      tile('在線使用者', U.num(Math.round(sim.users)), `員工 ${U.num(sim.employees)} 人`, slice(hs.users).slice(-72), tk.accent),
      tile('WAN 下行', U.bw(sim.wan.in), cap ? `容量 ${U.bw(cap)} · ${U.pct(sim.wan.in / cap)}` : '沒有可用的 ISP', slice(hs.wanIn).slice(-72), tk.info, null, cap && sim.wan.in / cap > 0.9 ? 'bad-t' : ''),
      tile('WAN 上行', U.bw(sim.wan.out), cap ? `${U.pct(sim.wan.out / cap)}` : '—', slice(hs.wanOut).slice(-72), tk.accent2),
      tile('平均延遲', nms ? `${sim.lat.toFixed(1)} ms` : '—', nms ? '員工到服務的往返時間' : '需要 NMS', nms ? slice(hs.lat).slice(-72) : null, tk.warn, null, nms && sim.lat > 60 ? 'warn-t' : ''),
      tile('封包遺失', nms ? U.pct(sim.loss, 1) : '—', nms ? '壅塞時封包被丟棄' : '需要 NMS', nms ? slice(hs.loss).slice(-72) : null, tk.bad, null, nms && sim.loss > 0.02 ? 'bad-t' : ''),
      tile('滿意度', sat === null || sat === undefined ? '—' : U.pct(sat), '在座員工加權平均', slice(hs.sat).slice(-72), tk.ok, 1, sat === null || sat === undefined ? '' : sat >= 0.8 ? 'ok-t' : sat >= 0.6 ? 'warn-t' : 'bad-t'));
    /* 圖表 */
    const t = slice(hs.t);
    const C = V.charts;
    lg(C.wan.lg, [[tk.info, '下行'], [tk.accent2, '上行'], [tk.text3, '可用頻寬', true]]);
    G.Charts.line(C.wan.cv, { t, series: [{ data: slice(hs.wanIn), color: tk.info, fill: true }, { data: slice(hs.wanOut), color: tk.accent2 }, { data: slice(hs.wanCap), color: tk.text3, dash: [5, 4], width: 1.2 }], yFmt: (v) => U.bwShort(v) });
    lg(C.intra.lg, [[tk.accent, '內部流量']]);
    G.Charts.line(C.intra.cv, { t, series: [{ data: slice(hs.intra), color: tk.accent, fill: true }], yFmt: (v) => U.bwShort(v) });
    lg(C.sat.lg, [[tk.ok, '員工滿意度'], [tk.info, '官網可用率', true]]);
    G.Charts.line(C.sat.cv, { t, yMax: 100, series: [{ data: slice(hs.sat).map((v) => (v === null ? null : v * 100)), color: tk.ok, fill: true }, { data: slice(hs.web).map((v) => (v === null ? null : v * 100)), color: tk.info, dash: [4, 3] }], yFmt: (v) => v + '%' });
    lg(C.lat.lg, [[tk.warn, '平均延遲 (ms)']]);
    G.Charts.line(C.lat.cv, { t, minY: 10, series: [{ data: slice(hs.lat), color: tk.warn, fill: true }], yFmt: (v) => v + 'ms' });
    lg(C.fw.lg, [[tk.bad, '防火牆使用率']]);
    G.Charts.line(C.fw.cv, { t, yMax: Math.max(100, ...slice(hs.fw).map((v) => v * 100)), series: [{ data: slice(hs.fw).map((v) => v * 100), color: tk.bad, fill: true }], yFmt: (v) => Math.round(v) + '%' });
    lg(C.temp.lg, [[tk.bad, '溫度 °C'], [tk.info, 'IT 負載 kW', true]]);
    G.Charts.line(C.temp.cv, { t, minY: 30, series: [{ data: slice(hs.temp), color: tk.bad }, { data: slice(hs.kw), color: tk.info, dash: [4, 3] }], yFmt: (v) => String(Math.round(v)) });

    /* 鏈路排行 */
    const rows = [];
    for (const l of Object.values(s.links)) { const ls = sim.links[l.id]; if (ls && ls.up) rows.push({ name: `${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)}`, spec: UI.linkLabel(l), util: ls.util, a: ls.ab, b: ls.ba, cap: ls.cap, id: l.id }); }
    for (const c of s.isp) { const is = sim.isp[c.id]; if (is && is.up) rows.push({ name: `ISP ${CAT.isp.providers[c.provider].name}`, spec: c.plan, util: is.util, a: is.in, b: is.out, cap: c.bw }); }
    rows.sort((x, y) => y.util - x.util);
    U.mount(V.linksBox, rows.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('tbody', {}, rows.slice(0, 10).map((r) => h('tr', { class: r.id ? 'click' : '', onclick: r.id ? () => { G.Views.topo.sel = { type: 'link', id: r.id }; UI.go('topo'); } : null },
      h('td', { class: 'small' }, r.name, h('div', { class: 'tiny dim mono' }, r.spec)),
      h('td', { style: { width: '38%' } }, h('div', { class: 'bar ' + U.utilClass(r.util) }, h('i', { style: { width: Math.min(100, r.util * 100) + '%' } }))),
      h('td', { class: 'r mono small ' + (r.util >= 0.9 ? 'bad-t' : '') }, U.pct(r.util))))))) : h('div', { class: 'empty' }, '還沒有運作中的線路'));
    /* 樓層 */
    const cells = [];
    for (const f of G.BLD.floors.slice().reverse()) {
      const st = sim.floors[f.id], fs = s.floors[f.id];
      const util = Math.max(0, ...Q.linksOf('F:' + f.id).map((l) => (sim.links[l.id] ? sim.links[l.id].util : 0)));
      const sv = st && st.present > 1 ? st.sat : null;
      const bc = fs.movedIn > 0 && !st.up ? 'var(--bad)' : sv === null ? 'var(--line)' : sv >= 0.8 ? 'var(--ok)' : sv >= 0.6 ? 'var(--warn)' : 'var(--bad)';
      cells.push(h('button', { class: 'fcell', style: { borderColor: bc, textAlign: 'left' }, onclick: () => UI.go('floor:' + f.id) },
        h('div', { class: 'n' }, f.id),
        h('div', { class: 'v' }, fs.movedIn ? (st.up ? (sv === null ? '無人' : U.pct(sv)) : '斷線') : '—'),
        h('div', { class: 'v' }, nms && Q.linksOf('F:' + f.id).length ? `↑ ${U.pct(util)}` : '')));
    }
    U.mount(V.floorBox, cells);
    /* 異常流量 */
    const anoms = sim.flows.filter((f) => f.anomaly);
    U.mount(V.anomBox, anoms.length ? anoms.map((f) => {
      const inc = s.incidents.find((i) => i.id === f.incId);
      const rate = f.blocked ? f.fwd : f.dFwd + f.dRev;
      return h('div', { class: 'note ' + (f.blocked ? 'ok' : 'bad'), style: { marginBottom: '6px' } },
        h('div', { class: 'row between' }, h('b', {}, f.label), h('span', { class: 'mono small' }, U.bw(rate))),
        h('div', { class: 'small mono muted' }, `${Q.nodeName(f.src)} → ${f.dst.startsWith('ROLE:') ? CAT.roles[f.dst.slice(5)].name : Q.nodeName(f.dst)}${f.blocked ? '（被防火牆擋下）' : ''}`),
        inc ? h('div', { class: 'row', style: { marginTop: '6px' } }, inc.detected ? h('button', { class: 'btn xs', onclick: () => UI.go('inc:' + inc.id) }, '查看事件') : h('button', { class: 'btn xs primary', onclick: () => { G.Ev.detect(inc, 'NetFlow 異常調查'); UI.go('inc:' + inc.id); } }, '調查這筆流量')) : null);
    }) : h('div', { class: 'empty' }, '沒有發現異常流量'));
    /* 設備效能 */
    const devs = Object.entries(sim.nodes);
    U.mount(V.devBox, devs.length ? devs.map(([id, n]) => h('div', { style: { marginBottom: '8px' } },
      h('div', { class: 'row between small' }, h('span', {}, Q.nodeName(id)), h('span', { class: 'mono' }, `${U.bw(n.load)} / ${U.bw(n.cap)}`)),
      h('div', { class: 'bar ' + U.utilClass(n.util) }, h('i', { style: { width: Math.min(100, n.util * 100) + '%' } })))) : h('div', { class: 'empty' }, '沒有運作中的路由器或防火牆'));
    /* 告警 */
    const al = s.alerts.slice(-40).reverse();
    U.mount(V.alertBox, al.length ? al.map((a) => h('div', { class: 'l' }, h('span', { class: 'dim' }, U.stamp(a.t)), h('span', { class: a.sev === 'crit' ? 'bad-t' : a.sev === 'warn' ? 'warn-t' : 'muted' }, a.text))) : h('div', { class: 'empty' }, '目前沒有告警'));
  };
})(window.G = window.G || {});
