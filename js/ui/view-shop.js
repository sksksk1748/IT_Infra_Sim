/* 採購：網路設備、伺服器、無線、機房設施、線材與光模組、ISP 專線（每項都附 3D 模型） */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'net', provider: 'A' };
  G.Views.shop = V;
  const TABS = [['net', '網路設備'], ['srv', '伺服器'], ['sys', '系統'], ['wifi', '無線網路'], ['facility', '機房設施'], ['ai', 'AI 運算'], ['cable', '線材與光模組'], ['isp', 'ISP 專線']];
  V.TABS = TABS;
  const thumb = (id, title) => (G.M3 && G.M3.has(id) ? G.M3.thumbButton(id, title) : null);

  V.mount = (el, param) => {
    if (param && TABS.some((t) => t[0] === param)) V.tab = param;
    V.el = el;
    const inv = Object.values(G.S.devices).filter((d) => !d.rack && !d.host).length;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '採購'), h('div', { class: 'desc' }, '點圖片可以 360° 旋轉查看設備的 3D 模型與零件說明。機房設備買來後先放在倉庫，要到「機房」上架才能通電；樓層的接入交換器與 AP 在「樓層」頁面配置。')),
      h('div', { class: 'row wrap' }, h('span', { class: 'chip' }, `預算 ${U.money(G.S.money)}`), inv ? h('button', { class: 'btn primary sm', onclick: () => UI.go('rack') }, `倉庫有 ${inv} 台未上架 →`) : null)));
    el.appendChild(h('div', { class: 'tabs' }, TABS.map(([k, t]) => h('button', { class: V.tab === k ? 'on' : '', 'data-hint': 'tab:shop:' + k, onclick: () => { V.tab = k; UI.refresh(); } }, t))));
    const grid = h('div', { class: 'shop-grid' });
    const kbRow = (ids) => el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } }, ids.map((k) => h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(k) }, G.KB.byId[k].title))));
    if (V.tab === 'net') {
      kbRow(['k-router', 'k-firewall', 'k-switch', 'k-optics']);
      for (const [id, m] of Object.entries(CAT.devices)) if (['router', 'firewall', 'switch'].includes(m.cat) && !m.ai && !m.sys) grid.appendChild(devCard(id, m));
    } else if (V.tab === 'srv') {
      el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h3', { style: { marginBottom: '8px' } }, '伺服器角色'),
        h('div', { class: 'grid c3' }, Object.entries(CAT.roles).filter(([k]) => k !== 'ai' && k !== 'aistore').map(([k, r]) => h('div', { class: 'small' }, h('b', {}, `${r.short}　${r.name}`), h('div', { class: 'muted' }, r.desc))))));
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'server' && !m.ai && !m.sys && !m.virtual) grid.appendChild(devCard(id, m));
    } else if (V.tab === 'sys') {
      el.appendChild(h('div', { class: 'note', style: { marginBottom: '10px' } }, h('b', {}, '系統設備：'), '虛擬化主機與共用儲存（SAN）、儲存擴充櫃、磁帶櫃，以及電話與廣域網路設備。VM 不用採購：主機上架後，到「系統 → 虛擬化」建立。',
        h('button', { class: 'btn ghost xs', style: { marginLeft: '6px' }, onclick: () => UI.go('sys') }, '前往系統管理')));
      kbRow(['k-vm', 'k-san', 'k-backup'].filter((k) => G.KB.byId[k]));
      for (const [id, m] of Object.entries(CAT.devices)) if (m.sys) grid.appendChild(devCard(id, m));
    } else if (V.tab === 'ai') {
      aiTab(el, grid, kbRow);
    } else if (V.tab === 'wifi') {
      kbRow(['k-wifi', 'k-wlc', 'k-poe']);
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'wlc') grid.appendChild(devCard(id, m));
      grid.appendChild(h('div', { class: 'card col', style: { gap: '8px' } }, h('b', {}, 'AP 與接入交換器'), h('p', { class: 'small muted' }, 'AP 要裝在樓層的天花板上，接入交換器裝在各樓層的 IDF。請到「樓層」頁面直接配置，平面圖會即時顯示訊號覆蓋。'), h('button', { class: 'btn primary sm', style: { alignSelf: 'flex-start' }, onclick: () => UI.go('floor') }, '前往樓層規劃')));
      for (const [id, m] of Object.entries(CAT.aps)) grid.appendChild(infoCard(id, m.name, m.desc, [['容量', U.bw(m.cap)], ['建議連線數', m.maxClients + ' 台'], ['PoE', m.poe + ' W'], ['頻段', m.band === 'ext' ? '5 GHz + 6 GHz' : '5 GHz']], m.price + CAT.apInstallFee, m));
      for (const [id, m] of Object.entries(CAT.access)) grid.appendChild(infoCard(id, m.name, m.desc, [['接入埠', `${m.ports} × ${U.speed(m.portSpeed)}`], ['PoE 預算', m.poe + ' W'], ['上行', `${m.uplinks} × ${U.speed(m.uplinkMax)}`]], m.price, m));
    } else if (V.tab === 'facility') {
      kbRow(['k-rack', 'k-power', 'k-cooling', 'k-fire', 'k-ems', 'k-access', 'k-ha']);
      const rk = CAT.rack;
      grid.appendChild(h('div', { class: 'card prod' }, thumb('rack42', '42U 標準機櫃'), h('span', { class: 'label' }, '機櫃'), h('b', {}, '標準 42U 機櫃（含雙 PDU）'), h('p', { class: 'small muted' }, `19 吋標準機櫃，${rk.units}U，PDU 電力上限 ${rk.powerLimit / 1000} kW。機房最多 ${rk.maxRacks} 座。`),
        h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(rk.price)), h('span', { class: 'small muted' }, `已有 ${G.S.racks.length} 座`)),
        h('button', { class: 'btn primary sm', 'data-hint': 'buy:rack', onclick: () => UI.res(G.Act.buyRack()) }, '購買')));
      for (const [id, m] of Object.entries(CAT.devices)) if (m.cat === 'ups') grid.appendChild(devCard(id, m));
      for (const [id, m] of Object.entries(CAT.room)) if (m.buyable !== false && m.kind !== 'cdu') grid.appendChild(roomCard(id, m));
    } else if (V.tab === 'cable') cableTab(el, grid, kbRow);
    else ispTab(el, grid);
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
    if (m.cat === 'server' && m.roles.length) rows.push(['角色', m.roles.map((r) => CAT.roles[r].short).join(' / ')]);
    if (m.hv) rows.push(['虛擬化資源', `${m.vcpu} vCPU · ${m.ram} GB 記憶體`], ['授權', `${U.money(CAT.vmCfg.license)} / 月`]);
    if (m.rawTB) rows.push(['原始容量', `${m.rawTB} TB${m.flash ? '（全快閃）' : ''}`], [m.shelf ? '加入 SAN 後可用' : 'RAID 6 可用', `約 ${Math.round(m.rawTB * 0.8 * 0.95)} TB`]);
    if (m.tape) rows.push(['磁帶', `LTO-9 · 每捲 ${m.tapeTB} TB · ${m.slots} 格`]);
    if (m.cat === 'wlc') rows.push(['管理 AP', `${m.maxAps} 台`]);
    if (m.cat === 'ups') rows.push(['容量', `${m.capW / 1000} kW`], ['滿載續航', `${m.runtime} 分鐘`]);
    if (m.gpu) rows.push(['GPU', `${m.gpu} 顆 · ${m.pf} PFLOPS`], ['散熱', m.liquid ? '直接液冷（需要 CDU）' : '氣冷']);
    if (m.cat === 'power') rows.push(['容量', `${m.psuN} × ${m.psuW / 1000} kW = ${m.psuN * m.psuW / 1000} kW`], ['N+1 可用', `${(m.psuN - 1) * m.psuW / 1000} kW`]);
    if (m.cat === 'bbu') rows.push(['備援功率', `${m.bbuW / 1000} kW`], ['滿載續航', `約 ${m.holdMin} 分鐘`]);
    if (ports.length) rows.push(['介面', ports.join('、')]);
    rows.push(['高度 / 耗電', `${m.u}U / ${m.watts >= 1000 ? (m.watts / 1000).toFixed(1) + ' kW' : m.watts + ' W'}`]);
    if (m.aiRack) rows.push(['安裝', '只能裝在 AI 機櫃']);
    return rows;
  }
  /** AI 運算：AI 機櫃、電源櫃與 BBU、GPU 伺服器、AI 交換器與儲存、液冷 CDU */
  function aiTab(el, grid, kbRow) {
    const locked = !Q.unlocked(CAT.rack.ai);
    el.appendChild(h('div', { class: 'note', style: { marginBottom: '10px' } },
      h('b', {}, 'AI 機房和一般機房不一樣：'), '一台 8-GPU 伺服器就要 10 kW（一般機櫃整座才 8 kW），要用 AI 機櫃、自己配電源櫃（PSU）與 BBU；GPU 靠液冷（CDU）散熱；GPU 之間要用 400G 的後端網路互連。',
      locked ? h('span', { class: 'chip', style: { marginLeft: '6px' } }, `第 ${CAT.rack.ai.unlock} 章解鎖`) : null));
    kbRow(['k-gpu', 'k-aipower', 'k-liquid', 'k-aifabric']);
    const ra = CAT.rack.ai, have = G.S.racks.filter((r) => r.type === 'ai').length;
    grid.appendChild(h('div', { class: 'card prod' + (locked ? ' locked-item' : '') }, thumb('rackai', ra.name), h('span', { class: 'label' }, 'AI 機櫃'), h('b', {}, ra.name), h('p', { class: 'small muted' }, ra.desc),
      specGrid([['電力', '由電源櫃決定（每台 PS-33 = 33 kW）'], ['備援電力', 'BBU（不接中央 UPS）'], ['散熱', '液冷歧管 + 空調'], ['數量上限', `${ra.max} 座（已有 ${have}）`]]),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(ra.price)), h('button', { class: 'btn primary sm', 'data-hint': 'buy:rackai', disabled: locked || null, onclick: () => UI.res(G.Act.buyRack('ai')) }, '購買'))));
    for (const [id, m] of Object.entries(CAT.devices)) if (m.ai) grid.appendChild(devCard(id, m));
    for (const [id, m] of Object.entries(CAT.room)) if (m.kind === 'cdu') grid.appendChild(roomCard(id, m));
  }
  function specGrid(rows) { return h('div', { class: 'specs' }, rows.map(([k, v]) => [h('span', { class: 'dim' }, k), h('span', {}, v)])); }

  function devCard(id, m) {
    const locked = !Q.unlocked(m);
    const owned = Object.values(G.S.devices).filter((d) => d.model === id);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      thumb(id, m.name),
      h('div', { class: 'row between' }, h('span', { class: 'label' }, CAT.categories[m.cat].name), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : owned.length ? h('span', { class: 'chip accent' }, `擁有 ${owned.length}`) : null),
      h('b', {}, m.name), h('p', { class: 'small muted' }, m.desc), specGrid(specs(m)),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(m.price)),
        h('button', { class: 'btn primary sm', 'data-hint': 'buy:' + id, disabled: locked || null, onclick: () => UI.res(G.Act.buyDevice(id, 1)) }, '購買')));
  }
  function infoCard(id, name, desc, rows, price, m) {
    const locked = !Q.unlocked(m);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      thumb(id, name),
      h('div', { class: 'row between' }, h('span', { class: 'label' }, '樓層設備'), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : null),
      h('b', {}, name), h('p', { class: 'small muted' }, desc), specGrid(rows), h('span', { class: 'price' }, U.money(price)));
  }
  function roomCard(id, m) {
    const locked = !Q.unlocked(m);
    const have = G.S.room.filter((r) => r.model === id).length;
    const ROWS = {
      cooling: [['冷卻能力', `${m.coolKW} kW`], ['耗電', `${m.powerKW} kW`]],
      ups: [['容量', `${(m.capW || 0) / 1000} kW`], ['滿載續航', `${m.runtime} 分鐘`]],
      generator: [['啟動時間', '約 1 分鐘'], ['供電', '含空調、樓層 IDF']],
      fire: [['用途', { VESDA: '極早期偵測（冒煙階段）', PREACT: '灑水（兩段式觸發）', 'GAS-FS': '滅火（不泡水）' }[id] || '消防']],
      ems: [['監測', '溫濕度、漏水、煙霧、門禁']],
      contain: [['效果', '冷卻能力 +20%、PUE 下降']],
      access: [['門禁', m.level === 2 ? '感應卡 + 指紋、兩道互鎖的門' : '感應卡 + 電磁鎖'], ['紀錄', '每次進出都有紀錄、可調閱']],
      cdu: [['液冷能力', `${m.coolKW} kW`], ['耗電', `${m.powerKW} kW`]],
    };
    const rows = (ROWS[m.kind] || []).slice();
    if (m.refill) rows.push(['釋放後補充', U.money(m.refill)]);
    rows.push(['安裝工期', U.dur(m.buildMin || 0)]);
    return h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
      thumb(id, m.name),
      h('div', { class: 'row between' }, h('span', { class: 'label' }, { cooling: '冷卻', ups: '電力', generator: '電力', fire: '消防', ems: '環控', contain: '冷卻', cdu: '液冷', access: '門禁' }[m.kind]), locked ? h('span', { class: 'chip' }, `第 ${m.unlock} 章解鎖`) : have ? h('span', { class: 'chip accent' }, `已有 ${have}`) : null),
      h('b', {}, m.name), h('p', { class: 'small muted' }, m.desc), specGrid(rows),
      h('div', { class: 'row between' }, h('span', { class: 'price' }, U.money(m.price)), h('button', { class: 'btn primary sm', 'data-hint': 'buy:' + id, disabled: locked || null, onclick: () => UI.res(G.Act.buyRoom(id)) }, '購買')));
  }

  /* 線材與光模組：拉線時自動計價，這裡說明規格與外觀 */
  function cableTab(el, grid, kbRow) {
    el.appendChild(h('div', { class: 'note', style: { marginBottom: '10px' } }, '線材與光模組不用另外購買：在「拓撲」或「樓層」拉線時，會依長度、速率與條數自動計價。這裡可以看清楚它們長什麼樣子、能跑多遠。'));
    kbRow(['k-cable', 'k-optics', 'k-mdf']);
    for (const [id, c] of Object.entries(CAT.cables)) {
      const dist = CAT.speeds.filter((sp) => c.max[sp]).map((sp) => [U.speed(sp), c.max[sp] >= 10000 ? '10 km' : c.max[sp] + ' m']);
      grid.appendChild(h('div', { class: 'card prod' }, thumb(id, c.name), h('span', { class: 'label' }, c.medium === 'copper' ? '銅纜' : '光纖'),
        h('b', {}, c.name), h('p', { class: 'small muted' }, c.desc), specGrid([['線材', `NT$${c.perM} / 公尺`], ['端接施工', `NT$${U.num(c.termCost)} / 條`]].concat(dist.map(([sp, d]) => [sp + ' 最遠', d])))));
    }
    const optics = [
      ['sfp-sr', 'SFP+ 10GBASE-SR', '多模光纖（OM4）用的 10G 模組。', CAT.optics.mmf[10000], '850nm · LC · 400m'],
      ['sfp-lr', 'SFP+ 10GBASE-LR', '單模光纖（OS2）用的 10G 模組。', CAT.optics.smf[10000], '1310nm · LC · 10km'],
      ['qsfp-sr4', 'QSFP28 100GBASE-SR4', '多模 100G，使用 MPO 12 芯接頭。', CAT.optics.mmf[100000], '850nm · MPO · 100m'],
      ['qsfp-lr4', 'QSFP28 100GBASE-LR4', '單模 100G，高樓層主幹常用。', CAT.optics.smf[100000], '1310nm · LC · 10km'],
    ];
    for (const [id, name, desc, price, spec] of optics) {
      grid.appendChild(h('div', { class: 'card prod' }, thumb(id, name), h('span', { class: 'label' }, '光模組'), h('b', {}, name), h('p', { class: 'small muted' }, desc),
        specGrid([['規格', spec], ['單價', U.money(price) + ' / 顆'], ['一條連線', '兩端各一顆']])));
    }
    grid.appendChild(h('div', { class: 'card prod' }, thumb('patch24', '24 埠配線架'), h('span', { class: 'label' }, '結構化布線'), h('b', {}, '配線架（Patch Panel）'),
      h('p', { class: 'small muted' }, '水平布線工程的每一條網路線，都終結在 IDF 配線架的背面；前面再用短跳線接到接入交換器。費用包含在「水平布線」工程內。')));
  }

  function ispTab(el, grid) {
    const s = G.S;
    el.appendChild(h('div', { class: 'note', style: { marginBottom: '12px' } }, '企業專線需要前置作業時間才會開通，請提早申請。開通後在「拓撲」把 ISP 節點接到路由器。想要備援，請申請不同業者的線路（路由器需支援 BGP 才能同時使用多條）。', h('button', { class: 'btn ghost xs', style: { marginLeft: '6px' }, onclick: () => UI.openKb('k-isp') }, 'ISP 與專線')));
    const prov = h('div', { class: 'seg', style: { marginBottom: '12px' } }, Object.entries(CAT.isp.providers).map(([k, p]) => h('button', { class: V.provider === k ? 'on' : '', onclick: () => { V.provider = k; UI.refresh(); } }, p.name)));
    el.appendChild(h('div', { class: 'row wrap' }, h('span', { class: 'label' }, '業者'), prov));
    grid.appendChild(h('div', { class: 'card prod' }, thumb('ont', 'ISP 光纖終端設備'), h('span', { class: 'label' }, '開通時由 ISP 安裝'), h('b', {}, 'ISP 光纖終端設備（CPE）'),
      h('p', { class: 'small muted' }, 'ISP 把單模光纖拉進 B1 機房，接在這台終端設備上，再用 SFP+ 或 RJ45 交接給你的邊界路由器。設備費用含在專線月租內。')));
    for (const [id, p] of Object.entries(CAT.isp.plans)) {
      const locked = !Q.unlocked(p);
      grid.appendChild(h('div', { class: 'card prod' + (locked ? ' locked-item' : '') },
        h('span', { class: 'label' }, CAT.isp.providers[V.provider].name + ' 企業專線'),
        h('b', { style: { fontSize: '20px', fontFamily: 'var(--font-display)' } }, id),
        specGrid([['頻寬', `上下行對稱 ${U.bw(p.bw)}`], ['月租', U.money(p.monthly)], ['開通費', U.money(p.setup)], ['開通時間', U.dur(p.lead)], ['約可支撐', `${U.num(Math.round(p.bw / 1.3 / 50) * 50)} 人尖峰上網`]]),
        h('button', { class: 'btn primary sm', 'data-hint': 'isp:' + id, disabled: locked || null, onclick: () => UI.res(G.Act.orderIsp(V.provider, id)) }, '申請')));
    }
    if (s.isp.length) {
      const cur = h('div', { class: 'grid c2', style: { marginTop: '14px' } }, s.isp.map((c) => UI.ispCard(c)));
      el.appendChild(h('div', { class: 'label', style: { margin: '4px 0 8px' } }, '目前線路'));
      el.appendChild(cur);
      el.appendChild(h('div', { style: { height: '14px' } }));
    }
  }
})(window.G = window.G || {});
