/* 共用對話框與卡片：連線設定、設備詳情、ISP 線路 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;

  const ZONE_NAMES = { outside: '外部 OUTSIDE', inside: '內部 INSIDE', dmz: 'DMZ', ha: 'HA 同步' };
  const ZONE_DESC = {
    outside: '接往路由器 / 網際網路的介面，信任度最低。',
    inside: '接往核心交換器：員工內網與內部伺服器都在這一側。',
    dmz: '接往對外提供服務的伺服器（官網）。與內網隔離。',
    ha: '兩台防火牆之間同步狀態，組成 Active / Standby。',
  };
  UI.ZONE_NAMES = ZONE_NAMES;

  /** 設備狀態 */
  UI.devStatus = (d) => {
    const s = G.S;
    if (!d.rack) return { t: '未上架', c: '' };
    if (d.status === 'failed') return { t: '故障', c: 'bad' };
    if (d.status === 'rma') return { t: 'RMA 維修中', c: 'bad' };
    if (d.encrypted) return { t: '已被加密', c: 'bad' };
    const fac = G.R.fac;
    if (fac && (!fac.mdfPowered || fac.rackTripped[d.rack])) return { t: '斷電', c: 'bad' };
    if (s.time < (d.bootUntil || 0)) return { t: `開機中 ${d.bootUntil - s.time} 分`, c: 'warn' };
    return { t: '運作中', c: 'ok' };
  };

  UI.portBars = (nodeId) => {
    const P = Q.ports(nodeId);
    const rows = [];
    const lab = { rj45: 'RJ45 1G', sfp: 'SFP', qsfp: 'QSFP' };
    for (const k of ['rj45', 'sfp', 'qsfp']) {
      if (!P[k].total) continue;
      if (nodeId.startsWith('F:') && k === 'rj45') continue;
      const u = P[k].used / P[k].total;
      rows.push(h('div', { class: 'row', style: { fontSize: '12px' } },
        h('span', { class: 'mono', style: { width: '120px' } }, `${lab[k]}${k !== 'rj45' ? ' ≤' + U.speed(P[k].max) : ''}`),
        h('div', { class: 'bar grow ' + U.utilClass(u) }, h('i', { style: { width: Math.min(100, u * 100) + '%' } })),
        h('span', { class: 'mono', style: { width: '52px', textAlign: 'right' } }, `${P[k].used}/${P[k].total}`)));
    }
    return h('div', { class: 'col', style: { gap: '4px' } }, rows);
  };

  UI.linkLabel = (l) => `${U.speed(l.speed)}${l.count > 1 ? '×' + l.count : ''} ${CAT.cables[l.cable].short}`;

  /** 預設連線規格：優先 10G，找最便宜可行的線材 */
  UI.defaultLinkSpec = (a, b) => {
    for (const sp of [10000, 1000, 25000, 40000, 100000]) {
      let best = null;
      for (const c of ['om4', 'cat6a', 'cat6', 'os2']) {
        const pv = G.Act.linkPreview(a, b, c, sp, 1, null);
        if (pv.ok && (!best || pv.cost < best.cost)) best = { cable: c, speed: sp, cost: pv.cost };
      }
      if (best) return { cable: best.cable, speed: best.speed, count: 1 };
    }
    return { cable: 'om4', speed: 10000, count: 1 };
  };

  /** 連線設定對話框（建立或編輯） */
  UI.linkDialog = (a, b, linkId, onDone) => {
    const ex = linkId ? G.S.links[linkId] : null;
    let spec = ex ? { cable: ex.cable, speed: ex.speed, count: ex.count, zone: ex.zone } : Object.assign(UI.defaultLinkSpec(a, b), { zone: G.Act.defaultZone(a, b) });
    const body = h('div', { class: 'col', style: { gap: '12px' } });
    const fwEnds = (Q.nodeKind(a) === 'firewall') + (Q.nodeKind(b) === 'firewall');
    const PA = Q.ports(a), PB = Q.ports(b);
    const supports = (P, sp) => (sp >= 40000 ? P.qsfp.total > 0 && P.qsfp.max >= sp : P.sfp.max >= sp || (sp <= 1000 && P.rj45.total > 0));
    let m = null;
    const render = () => {
      const pv = G.Act.linkPreview(a, b, spec.cable, spec.speed, spec.count, spec.zone, linkId);
      U.clear(body);
      const len = pv.len;
      body.appendChild(h('div', { class: 'row wrap', style: { gap: '14px' } },
        h('span', {}, h('span', { class: 'label' }, '距離　'), h('b', { class: 'mono' }, `${len} m`)),
        (a.startsWith('F:') || b.startsWith('F:')) ? h('span', { class: 'chip info' }, `垂直主幹：經弱電豎井到 B1（施工 ${U.dur(CAT.riserBuildMin)}）`) : h('span', { class: 'chip' }, '機房內跳線')));
      const cab = h('div', { class: 'grid c2' });
      for (const [id, c] of Object.entries(CAT.cables)) {
        const maxD = c.max[spec.speed];
        const ok = maxD && len <= maxD;
        cab.appendChild(h('button', { class: 'btn' + (spec.cable === id ? ' on' : ''), style: { justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }, onclick: () => { spec.cable = id; render(); } },
          h('span', { style: { width: '10px', height: '28px', borderRadius: '3px', background: c.color, flex: 'none' } }),
          h('span', { class: 'col', style: { gap: '0' } },
            h('b', {}, c.name),
            h('span', { class: 'small ' + (ok ? 'muted' : 'bad-t') }, maxD ? `${U.speed(spec.speed)} 最遠 ${maxD >= 10000 ? '10 km' : maxD + ' m'}${ok ? '' : '（不夠長）'}` : `不支援 ${U.speed(spec.speed)}`),
            h('span', { class: 'tiny dim' }, `線材 NT$${c.perM}/m`))));
      }
      body.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '線材'), cab));
      const seg = h('div', { class: 'seg' });
      for (const sp of CAT.speeds) {
        const okBoth = supports(PA, sp) && supports(PB, sp);
        seg.appendChild(h('button', { class: spec.speed === sp ? 'on' : '', disabled: !okBoth || null, title: okBoth ? '' : '其中一端的埠不支援這個速率', onclick: () => { spec.speed = sp; render(); } }, U.speed(sp)));
      }
      const stepper = h('div', { class: 'stepper' },
        h('button', { onclick: () => { spec.count = Math.max(1, spec.count - 1); render(); }, 'aria-label': '減少' }, '−'),
        h('span', { class: 'n' }, String(spec.count)),
        h('button', { onclick: () => { spec.count = Math.min(8, spec.count + 1); render(); }, 'aria-label': '增加' }, '+'));
      body.appendChild(h('div', { class: 'row wrap', style: { gap: '18px', alignItems: 'flex-end' } },
        h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '速率'), seg),
        h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '條數（LACP 聚合）'), stepper),
        h('div', { class: 'mono' }, h('div', { class: 'label' }, '總頻寬'), h('b', { style: { fontSize: '18px' } }, U.bw(spec.speed * spec.count)))));
      if (fwEnds === 1) {
        const zs = h('div', { class: 'seg' });
        for (const z of ['outside', 'inside', 'dmz']) zs.appendChild(h('button', { class: pv.zone === z ? 'on' : '', onclick: () => { spec.zone = z; render(); } }, ZONE_NAMES[z]));
        body.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '防火牆介面區域'), zs, h('div', { class: 'small muted', style: { marginTop: '4px' } }, ZONE_DESC[pv.zone] || '')));
      } else if (fwEnds === 2) body.appendChild(h('div', { class: 'note info' }, ZONE_DESC.ha));
      const portTxt = (id, P) => {
        const parts = [];
        if (P.rj45.total && !id.startsWith('F:')) parts.push(`RJ45 ${P.rj45.total - P.rj45.used}/${P.rj45.total}`);
        if (P.sfp.total) parts.push(`SFP(≤${U.speed(P.sfp.max)}) ${P.sfp.total - P.sfp.used}/${P.sfp.total}`);
        if (P.qsfp.total) parts.push(`QSFP(≤${U.speed(P.qsfp.max)}) ${P.qsfp.total - P.qsfp.used}/${P.qsfp.total}`);
        return h('div', { class: 'small' }, h('b', {}, Q.nodeName(id)), h('span', { class: 'mono muted' }, '　可用：' + (parts.join('　') || '無')));
      };
      body.appendChild(h('div', { class: 'col', style: { gap: '2px' } }, portTxt(a, PA), portTxt(b, PB)));
      for (const e of pv.errs) body.appendChild(h('div', { class: 'note bad' }, e));
      for (const w of pv.warns) body.appendChild(h('div', { class: 'note warn' }, w));
      if (pv.ok) {
        const cable = CAT.cables[spec.cable];
        const oname = (cls) => (cls === 'rj45' ? '內建 RJ45' : (CAT.opticName[cable.medium] || {})[spec.speed] || '');
        body.appendChild(h('div', { class: 'kv' },
          h('span', { class: 'k' }, '線材'), h('span', { class: 'v mono' }, `${len} m × ${spec.count} 條 × NT$${cable.perM} = ${U.moneyFull(len * spec.count * cable.perM)}`),
          h('span', { class: 'k' }, '光模組 / 介面'), h('span', { class: 'v mono' }, `${oname(pv.aPort)} ／ ${oname(pv.bPort)}：${U.moneyFull(pv.optics)}`),
          h('span', { class: 'k' }, '端接施工'), h('span', { class: 'v mono' }, U.moneyFull(cable.termCost * spec.count)),
          h('span', { class: 'k' }, h('b', {}, '合計')), h('span', { class: 'v mono' }, h('b', {}, U.moneyFull(pv.cost)))));
      }
      const same = ex && ex.cable === spec.cable && ex.speed === spec.speed && ex.count === spec.count;
      body.appendChild(h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '8px' } },
        h('button', { class: 'btn ghost', onclick: () => m.close() }, '取消'),
        h('button', { class: 'btn primary', disabled: !pv.ok || null, onclick: () => {
          const r = ex ? G.Act.updateLink(linkId, spec.cable, spec.speed, spec.count, pv.zone) : G.Act.createLink(a, b, spec.cable, spec.speed, spec.count, pv.zone);
          UI.res(r);
          if (r.ok) { m.close(); if (onDone) onDone(r); }
        } }, ex ? (same ? '更新介面區域' : `升級線路（${U.money(Math.max(0, pv.cost - Math.round((ex.cost || 0) * 0.4)))}）`) : `建立連線（${U.money(pv.cost)}）`)));
    };
    m = UI.modal({ kicker: ex ? '編輯連線' : '建立連線', title: `${Q.nodeName(a)} ⇄ ${Q.nodeName(b)}`, wide: true, body, blocking: true });
    render();
    return m;
  };

  /** 選擇連線目標（例如樓層上行到哪台核心） */
  UI.pickTarget = (from, filter, title) => {
    const cands = Object.values(G.S.devices).filter((d) => d.rack && d.id !== from && (!filter || filter(d)));
    const body = h('div', { class: 'col' });
    let m = null;
    if (!cands.length) body.appendChild(h('div', { class: 'note warn' }, '沒有可連線的設備。請先到「採購」買交換器，並在「機房」安裝上架。'));
    for (const d of cands) {
      const st = UI.devStatus(d);
      const P = Q.ports(d.id);
      body.appendChild(h('button', { class: 'btn', style: { justifyContent: 'space-between' }, onclick: () => { m.close(); UI.linkDialog(from, d.id); } },
        h('span', {}, h('b', {}, d.name), h('span', { class: 'muted small' }, '　' + CAT.devices[d.model].name)),
        h('span', { class: 'mono small' }, `SFP ${P.sfp.total - P.sfp.used} 可用`, '　', h('span', { class: 'chip ' + st.c }, st.t))));
    }
    m = UI.modal({ title: title || '選擇要連線的設備', body, blocking: true });
  };

  /** 設備詳情卡（機房與拓撲共用） */
  UI.deviceCard = (id, opts) => {
    opts = opts || {};
    const s = G.S, d = s.devices[id];
    if (!d) return h('div', { class: 'empty' }, '設備已不存在');
    const m = CAT.devices[d.model];
    const st = UI.devStatus(d);
    const sim = G.R.sim || { nodes: {} };
    const card = h('div', { class: 'card col', style: { gap: '10px' } });
    card.appendChild(h('div', { class: 'row between' },
      h('div', { class: 'col', style: { gap: '0' } }, h('b', { style: { fontSize: '16px' } }, d.name), h('span', { class: 'small muted' }, m.name)),
      h('span', { class: 'chip ' + st.c }, st.t)));
    const z = G.Net.zones().get(id);
    card.appendChild(h('div', { class: 'kv' },
      h('span', { class: 'k' }, '類別'), h('span', { class: 'v' }, CAT.categories[m.cat].name + (m.layer ? `（L${m.layer}）` : '')),
      h('span', { class: 'k' }, '位置'), h('span', { class: 'v mono' }, d.rack ? `${d.rack} · U${d.u}${m.u > 1 ? '–' + (d.u + m.u - 1) : ''}` : '倉庫（未上架）'),
      h('span', { class: 'k' }, '耗電'), h('span', { class: 'v mono' }, m.cat === 'ups' ? `供電 ${(m.capW / 1000).toFixed(0)} kW` : `${m.watts} W`),
      z ? h('span', { class: 'k' }, '安全區域') : null, z ? h('span', { class: 'v' }, zoneText(z.zone)) : null));
    if (m.cat === 'server') {
      const sel = h('select', { id: 'role-' + id, onchange: (e) => UI.res(G.Act.setRole(id, e.target.value || null)) },
        h('option', { value: '' }, '— 尚未設定角色 —'),
        m.roles.map((r) => h('option', { value: r, selected: d.role === r || null }, CAT.roles[r].name)));
      card.appendChild(h('label', { class: 'field' }, h('span', {}, '伺服器角色'), sel));
      if (d.role) card.appendChild(h('div', { class: 'small muted' }, CAT.roles[d.role].desc));
      else card.appendChild(h('div', { class: 'note warn' }, '伺服器需要設定角色才會提供服務。'));
    }
    if (m.cat === 'router' || m.cat === 'firewall') {
      const ni = sim.nodes[id];
      const cap = m.cat === 'router' ? m.thr : (Q.hasService('ips') ? m.ips : m.fw);
      const load = ni ? ni.load : 0;
      card.appendChild(h('div', {},
        h('div', { class: 'row between small' }, h('span', { class: 'muted' }, m.cat === 'router' ? '路由處理量' : `防火牆處理量${Q.hasService('ips') ? '（IPS 開啟）' : ''}`), h('span', { class: 'mono' }, `${U.bw(load)} / ${U.bw(cap)}`)),
        h('div', { class: 'bar ' + U.utilClass(load / cap) }, h('i', { style: { width: Math.min(100, load / cap * 100) + '%' } }))));
      if (m.cat === 'router') card.appendChild(h('div', { class: 'small muted' }, m.multiWan === 'bgp' ? '支援 BGP：多條 ISP 可同時使用。' : '多條 ISP 只能主備援（一次只用一條）。'));
      if (m.cat === 'firewall') {
        const fws = Q.devices('firewall').filter((f) => f.rack);
        const standby = G.R.sim && G.R.sim.graph && G.R.sim.graph.standby && G.R.sim.graph.standby.has(id);
        if (standby) card.appendChild(h('div', { class: 'note info' }, 'HA 備援（Standby）：主要防火牆故障時會自動接手。'));
        else if (fws.length > 1 && Q.linksOf(id).some((l) => l.zone === 'ha')) card.appendChild(h('div', { class: 'note ok' }, 'HA 主要（Active）'));
      }
    }
    if (m.cat === 'wlc') {
      const aps = U.sum(Object.values(s.floors), (f) => f.aps.length);
      card.appendChild(h('div', { class: 'kv' }, h('span', { class: 'k' }, '管理 AP'), h('span', { class: 'v mono ' + (aps > m.maxAps ? 'bad-t' : '') }, `${aps} / ${m.maxAps}`)));
    }
    if (m.cat !== 'ups') card.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '4px' } }, '連接埠'), UI.portBars(id)));
    const links = Q.linksOf(id);
    const ispL = s.isp.filter((c) => c.router === id);
    if (links.length || ispL.length) {
      const list = h('div', { class: 'col', style: { gap: '4px' } });
      for (const c of ispL) list.appendChild(h('div', { class: 'row between small' }, h('span', {}, `ISP ${CAT.isp.providers[c.provider].name} ${c.plan}`), h('span', { class: 'mono muted' }, c.status === 'active' ? '已開通' : '等待開通')));
      for (const l of links) {
        const ls = sim.links && sim.links[l.id];
        const other = Q.other(l, id);
        list.appendChild(h('div', { class: 'row between small', style: { cursor: opts.onLink ? 'pointer' : 'default' }, onclick: opts.onLink ? () => opts.onLink(l.id) : null },
          h('span', {}, '→ ', Q.nodeName(other), l.zone && Q.nodeKind(id) === 'firewall' ? h('span', { class: 'chip', style: { marginLeft: '4px' } }, ZONE_NAMES[l.zone]) : null),
          h('span', { class: 'mono ' + (l.status !== 'up' ? 'bad-t' : ls ? U.utilClass(ls.util) + '-t' : '') }, `${UI.linkLabel(l)}${l.status !== 'up' ? ' 中斷' : ls ? ' ' + U.pct(ls.util) : ''}`)));
      }
      card.appendChild(h('div', {}, h('div', { class: 'label', style: { marginBottom: '4px' } }, '連線'), list));
    }
    const acts = h('div', { class: 'row wrap' });
    if (d.rack && m.cat !== 'ups' && opts.onConnect) acts.appendChild(h('button', { class: 'btn primary sm', onclick: () => opts.onConnect(id) }, '連線到…'));
    if (!d.rack) acts.appendChild(h('button', { class: 'btn primary sm', onclick: () => UI.res(G.Act.autoInstall(id)) }, '自動上架'));
    if (d.status === 'failed') acts.appendChild(h('button', { class: 'btn warn sm', onclick: () => UI.res(G.Act.rma(id)) }, `RMA 送修（${U.money(m.price * 0.15)}）`));
    acts.appendChild(h('button', { class: 'btn sm', onclick: () => {
      const inp = h('input', { type: 'text', id: 'rename-' + id, value: d.name, maxlength: 16 });
      UI.modal({ title: '重新命名', body: [inp], blocking: true, actions: [{ label: '取消', kind: 'ghost' }, { label: '確定', kind: 'primary', onClick: () => UI.res(G.Act.renameDevice(id, inp.value)) }] });
    } }, '改名'));
    if (d.rack) acts.appendChild(h('button', { class: 'btn sm', onclick: () => UI.res(G.Act.uninstallDevice(id)) }, '下架'));
    acts.appendChild(h('button', { class: 'btn danger sm', onclick: () => UI.confirm('出售設備', `出售 ${d.name}？會拆除它的所有連線，回收 ${U.money(m.price * 0.4)}。`, '出售', () => UI.res(G.Act.sellDevice(id)), 'danger') }, '出售'));
    card.appendChild(acts);
    return card;
  };

  function zoneText(z) {
    return { LAN: '員工內網 LAN', SERVERS: '內部伺服器區 SERVERS', DMZ: 'DMZ', EXPOSED: '⚠ 防火牆外側（暴露）', BYPASS: '⚠ 繞過防火牆', BRIDGED: '⚠ DMZ 與內網相連', ISOLATED: '未連線' }[z] || z;
  }
  UI.zoneText = zoneText;

  /** ISP 線路卡 */
  UI.ispCard = (c) => {
    const s = G.S;
    const p = CAT.isp.providers[c.provider];
    const is = G.R.sim && G.R.sim.isp[c.id];
    const card = h('div', { class: 'card col', style: { gap: '8px' } });
    const status = c.status === 'pending' ? { t: `開通中（剩 ${U.dur(c.readyAt - s.time)}）`, c: 'warn' } : c.outage ? { t: '中斷', c: 'bad' } : !c.router ? { t: '未接路由器', c: 'warn' } : is && is.standby ? { t: '備援待命', c: 'info' } : { t: '運作中', c: 'ok' };
    card.appendChild(h('div', { class: 'row between' }, h('div', {}, h('b', {}, `${p.name} ${c.plan} 企業專線`), h('div', { class: 'small muted mono' }, `月租 ${U.money(CAT.isp.plans[c.plan].monthly)}`)), h('span', { class: 'chip ' + status.c }, status.t)));
    if (is && is.up) {
      card.appendChild(h('div', { class: 'kv' },
        h('span', { class: 'k' }, '下行（進）'), h('span', { class: 'v mono' }, `${U.bw(is.in)} / ${U.bw(c.bw)}`),
        h('span', { class: 'k' }, '上行（出）'), h('span', { class: 'v mono' }, `${U.bw(is.out)} / ${U.bw(c.bw)}`)));
      card.appendChild(h('div', { class: 'bar ' + U.utilClass(is.util) }, h('i', { style: { width: Math.min(100, is.util * 100) + '%' } })));
    }
    const routers = Q.devices('router').filter((d) => d.rack);
    const sel = h('select', { id: 'isp-router-' + c.id }, h('option', { value: '' }, '— 選擇路由器 —'), routers.map((r) => h('option', { value: r.id, selected: c.router === r.id || null }, r.name)));
    card.appendChild(h('div', { class: 'row wrap' },
      h('span', { class: 'small muted' }, '接到'), sel,
      h('button', { class: 'btn sm', onclick: () => { if (sel.value) UI.res(G.Act.connectIsp(c.id, sel.value)); else UI.res(G.Act.disconnectIsp(c.id)); } }, '套用'),
      h('button', { class: 'btn danger sm', onclick: () => UI.confirm('終止合約', `終止 ${p.name} ${c.plan} 專線？`, '終止', () => UI.res(G.Act.cancelIsp(c.id)), 'danger') }, '終止合約')));
    if (!routers.length) card.appendChild(h('div', { class: 'note warn' }, '還沒有已上架的路由器。'));
    return card;
  };
})(window.G = window.G || {});
