/* 採購：網路設備、伺服器、無線、機房設施、ISP 專線 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'net', provider: 'A' };
  G.Views.shop = V;
  const TABS = [['net', '網路設備'], ['srv', '伺服器'], ['wifi', '無線網路'], ['facility', '機房設施'], ['isp', 'ISP 專線']];

  V.mount = (el, param) => {
    if (param && TABS.some((t) => t[0] === param)) V.tab = param;
    V.el = el;
    const inv = Object.values(G.S.devices).filter((d) => !d.rack).length;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '採購'), h('div', { class: 'desc' }, '機房設備買來後會先放在倉庫，要到「機房」安裝上架才能通電。樓層的接入交換器與 AP 在「樓層」頁面直接配置。')),
      h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, `預算 ${U.money(G.S.money)}`), inv ? h('button', { class: 'btn primary sm', onclick: () => UI.go('rack') }, `倉庫有 ${inv} 台未上架 →`) : null)));
    el.appendChild(h('div', { class: 'tabs' }, TABS.map(([k, t]) => h('button', { class: V.tab === k ? 'on' : '', onclick: () => { V.tab = k; UI.refresh(); } }, t))));
    const grid = h('div', { class: 'shop-grid' });
    if (V.tab === 'net') {
      el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } }, ['k-router', 'k-firewall', 'k-switch', 'k-optics'].map((k) => h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(k) }, G.KB.byId[k].title))));
      for (const [id, m] of Object.entries(CAT.devices)) if (['router', 'firewall', 'switch'].includes(m.cat)) grid.appendChild(devCard(id, m));
    } else if (V.tab === 'srv') {
      el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h3', { style: { marginBottom: '8px' } }, '伺服器角色'),
        h('div', { class: 'grid c3' }, Object.entries(CAT.roles).map(([k, r]) => h('div', { class: 'small' }, h('b', {}, `${r.short}　${r.name}`), h('div', { class: 'muted' }, r.desc))))));
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'server') grid.appendChild(devCard(id, m));
    } else if (V.tab === 'wifi') {
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'wlc') grid.appendChild(devCard(id, m));
      grid.appendChild(h('div', { class: 'card col', style: { gap: '8px' } }, h('b', {}, 'AP 與接入交換器'), h('p', { class: 'small muted' }, 'AP 要裝在樓層的天花板上，接入交換器裝在各樓層的 IDF。請到「樓層」頁面直接配置，平面圖會即時顯示訊號覆蓋。'), h('button', { class: 'btn primary sm', style: { alignSelf: 'flex-start' }, onclick: () => UI.go('floor') }, '前往樓層規劃')));
      for (const [id, m] of Object.entries(CAT.aps)) grid.appendChild(infoCard(m.name, m.desc, [['容量', U.bw(m.cap)], ['建議連線數', m.maxClients + ' 台'], ['PoE', m.poe + ' W'], ['頻段', m.band === 'ext' ? '5 GHz + 6 GHz' : '5 GHz']], m.price + CAT.apInstallFee, m));
      for (const [id, m] of Object.entries(CAT.access)) grid.appendChild(infoCard(m.name, m.desc, [['接入埠', `${m.ports} × ${U.speed(m.portSpeed)}`], ['PoE 預算', m.poe + ' W'], ['上行', `${m.uplinks} × ${U.speed(m.uplinkMax)}`]], m.price, m));
    } else if (V.tab === 'facility') {
      el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } }, ['k-rack', 'k-power', 'k-cooling', 'k-ha'].map((k) => h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(k) }, G.KB.byId[k].title))));
      const rk = CAT.rack;
      grid.appendChild(h('div', { class: 'card prod' }, h('span', { class: 'label' }, '機櫃'), h('b', {}, '標準 42U 機櫃（含雙 PDU）'), h('p', { class: 'small muted' }, `19 吋標準機櫃，${rk.units}U，PDU 電力上限 ${rk.powerLimit / 1000} kW。機房最多 ${rk.maxRacks} 座。`),
        h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(rk.price)), h('span', { class: 'small muted' }, `已有 ${G.S.racks.length} 座`)),
        h('button', { class: 'btn primary sm', onclick: () => UI.res(G.Act.buyRack()) }, '購買')));
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'ups') grid.appendChild(devCard(id, m));
      for (const [id, m] of Object.entries(CAT.room)) if (m.buyable !== false) grid.appendChild(roomCard(id, m));
    } else ispTab(el, grid);
    el.appendChild(grid);
  };

  function specs(m) {
    const rows = [];
    const ports = [];
    if (m.ports) {
      if (m.ports.rj45) ports.push(`${m.ports.rj45}×1G RJ45`);
      if (m.ports.sfp) ports.push(`${m.ports.sfp}×${U.speed(m.sfpMax)} SFP`);
      if (m.ports.qsfp) ports.push(`${m.ports.qsfp}×${U.speed(m.qsfpMax)} QSFP`);
    }
    if (m.cat === 'router') rows.push(['路由效能', U.bw(m.thr)], ['多 ISP', m.multiWan === 'bgp' ? 'BGP 負載分擔' : '僅主備援']);
    if (m.cat === 'firewall') rows.push(['防火牆吞吐', U.bw(m.fw)], ['開啟 IPS', U.bw(m.ips)]);
    if (m.cat === 'switch') rows.push(['層級', m.layer === 3 ? 'L3（可路由）' : 'L2']);
    if (m.cat === 'server') rows.push(['角色', m.roles.map((r) => CAT.roles[r].short).join(' / ')]);
    if (m.cat === 'wlc') rows.push(['管理 AP', `${m.maxAps} 台`]);
    if (m.cat === 'ups') rows.push(['容量', `${m.capW / 1000} kW`], ['滿載續航', `${m.runtime} 分鐘`]);
    if (ports.length) rows.push(['介面', ports.join('、')]);
    rows.push(['高度 / 耗電', `${m.u}U / ${m.watts} W`]);
    return rows;
  }
  function specGrid(rows) { return h('div', { class: 'specs' }, rows.map(([k, v]) => [h('span', { class: 'dim' }, k), h('span', {}, v)])); }

  function devCard(id, m) {
    const locked = !Q.unlocked(m);
    const owned = Object.values(G.S.devices).filter((d) => d.model === id);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      h('div', { class: 'row between' }, h('span', { class: 'label' }, CAT.categories[m.cat].name), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : owned.length ? h('span', { class: 'chip accent' }, `擁有 ${owned.length}`) : null),
      h('b', {}, m.name), h('p', { class: 'small muted' }, m.desc), specGrid(specs(m)),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(m.price)),
        h('button', { class: 'btn primary sm', disabled: locked || null, onclick: () => UI.res(G.Act.buyDevice(id, 1)) }, '購買')));
  }
  function infoCard(name, desc, rows, price, m) {
    const locked = !Q.unlocked(m);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      h('div', { class: 'row between' }, h('span', { class: 'label' }, '樓層設備'), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : null),
      h('b', {}, name), h('p', { class: 'small muted' }, desc), specGrid(rows), h('span', { class: 'price' }, U.money(price)));
  }
  function roomCard(id, m) {
    const locked = !Q.unlocked(m);
    const have = G.S.room.filter((r) => r.model === id).length;
    const rows = m.kind === 'cooling' ? [['冷卻能力', `${m.coolKW} kW`], ['耗電', `${m.powerKW} kW`]] : m.kind === 'ups' ? [['容量', `${m.capW / 1000} kW`], ['滿載續航', `${m.runtime} 分鐘`]] : [['啟動時間', '約 1 分鐘'], ['供電', '含空調、樓層 IDF']];
    rows.push(['安裝工期', U.dur(m.buildMin || 0)]);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      h('div', { class: 'row between' }, h('span', { class: 'label' }, { cooling: '冷卻', ups: '電力', generator: '電力' }[m.kind]), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : have ? h('span', { class: 'chip accent' }, `已有 ${have}`) : null),
      h('b', {}, m.name), h('p', { class: 'small muted' }, m.desc), specGrid(rows),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(m.price)), h('button', { class: 'btn primary sm', disabled: locked || null, onclick: () => UI.res(G.Act.buyRoom(id)) }, '購買')));
  }

  function ispTab(el, grid) {
    const s = G.S;
    el.appendChild(h('div', { class: 'note', style: { marginBottom: '12px' } }, '企業專線需要前置作業時間才會開通，請提早申請。開通後在「拓撲」把 ISP 節點接到路由器。想要備援，請申請不同業者的線路（路由器需支援 BGP 才能同時使用多條）。', h('button', { class: 'btn ghost xs', style: { marginLeft: '6px' }, onclick: () => UI.openKb('k-isp') }, 'ISP 與專線')));
    const prov = h('div', { class: 'seg', style: { marginBottom: '12px' } }, Object.entries(CAT.isp.providers).map(([k, p]) => h('button', { class: V.provider === k ? 'on' : '', onclick: () => { V.provider = k; UI.refresh(); } }, p.name)));
    el.appendChild(h('div', { class: 'row wrap' }, h('span', { class: 'label' }, '業者'), prov));
    for (const [id, p] of Object.entries(CAT.isp.plans)) {
      const locked = !Q.unlocked(p);
      grid.appendChild(h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
        h('span', { class: 'label' }, CAT.isp.providers[V.provider].name + ' 企業專線'),
        h('b', { style: { fontSize: '20px', fontFamily: 'var(--font-display)' } }, id),
        specGrid([['頻寬', `上下行對稱 ${U.bw(p.bw)}`], ['月租', U.money(p.monthly)], ['開通費', U.money(p.setup)], ['開通時間', U.dur(p.lead)], ['約可支撐', `${U.num(Math.round(p.bw / 1.3 / 50) * 50)} 人尖峰上網`]]),
        h('button', { class: 'btn primary sm', disabled: locked || null, onclick: () => UI.res(G.Act.orderIsp(V.provider, id)) }, '申請')));
    }
    if (s.isp.length) {
      const cur = h('div', { class: 'grid c2', style: { marginTop: '14px' } }, s.isp.map((c) => UI.ispCard(c)));
      el.appendChild(h('div', { class: 'label', style: { margin: '4px 0 8px' } }, '目前線路'));
      el.appendChild(cur);
      el.appendChild(h('div', { style: { height: '14px' } }));
    }
  }
})(window.G = window.G || {});
