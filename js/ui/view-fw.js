/* 防火牆與資安：政策規則、網段規劃（VLAN / 子網路 / 訪客 / 內部分段）、資安服務、資安健檢 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'rules', draft: { src: 'LAN', dst: 'INTERNET', svc: 'WEB', action: 'allow' } };
  G.Views.fw = V;
  const TABS = [['rules', '政策規則'], ['net', '網段規劃'], ['svc', '資安服務'], ['audit', '資安健檢']];
  const zc = (z) => h('span', { class: 'zone-chip zone-' + z }, z);

  V.mount = (el, param) => {
    if (param && TABS.some((t) => t[0] === param)) V.tab = param;
    V.el = el;
    const audit = G.Sec.audit();
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '防火牆與資安'), h('div', { class: 'desc' }, '防火牆由上而下比對規則，第一條符合的生效；都不符合就「預設拒絕」。區域：INTERNET 外網、LAN 員工、GUEST 訪客、SERVERS 內部伺服器、DMZ 對外服務。')),
      h('div', { class: 'row' }, h('span', { class: 'chip ' + (audit.grade <= 'B' ? 'ok' : audit.grade === 'C' ? 'warn' : 'bad') }, `資安評分 ${audit.grade}（${audit.score}）`))));
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, t]) => h('button', { class: V.tab === k ? 'on' : '', onclick: () => { V.tab = k; UI.refresh(); } }, t,
      k === 'audit' && audit.findings.some((f) => f.sev === 'crit' || f.sev === 'high') ? h('span', { class: 'count' }, String(audit.findings.filter((f) => f.sev === 'crit' || f.sev === 'high').length)) : null)));
    el.appendChild(tabs);
    if (!G.Sec.hasFirewall()) el.appendChild(h('div', { class: 'note warn', style: { marginBottom: '12px' } }, '機房裡還沒有安裝防火牆。規則要等防火牆上架並接好線路後才會生效；在那之前，內網等於直接暴露在網際網路上。'));
    if (V.tab === 'rules') rulesTab(el, audit);
    else if (V.tab === 'net') netTab(el);
    else if (V.tab === 'svc') svcTab(el);
    else auditTab(el, audit);
  };
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 3000) return;
    V.last = now;
    if (V.hitsEls) for (const [id, el] of V.hitsEls) el.textContent = fmtHits(G.S.ruleHits[id] || 0);
  };
  const fmtHits = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n)));

  /* ---------- 規則 ---------- */
  function rulesTab(el) {
    const s = G.S;
    const reqs = G.Sec.requirements();
    const reqCard = h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '業務必要連線'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-rules') }, '規則怎麼寫？')),
      h('div', { class: 'col', style: { gap: '6px' } }, reqs.map((r) => h('div', { class: 'row between small' },
        h('span', {}, h('span', { class: 'dot ' + (r.ok ? 'ok' : 'bad') }), ' ', r.text, h('div', { class: 'mono tiny dim', style: { marginLeft: '14px' } }, r.rule)),
        h('span', { class: 'chip ' + (r.ok ? 'ok' : 'bad') }, r.ok ? '已放行' : '被擋')))));
    const d = V.draft;
    const sel = (key, opts) => h('select', { id: 'rule-' + key, onchange: (e) => { d[key] = e.target.value; } }, opts.map(([v, t]) => h('option', { value: v, selected: d[key] === v || null }, t)));
    const zones = Object.keys(G.ZONES).map((z) => [z, `${z}　${G.ZONES[z].name}`]);
    const svcs = Object.keys(G.SVC).map((k) => [k, `${k}　${G.SVC[k].name}（${G.SVC[k].port}）`]);
    const tmpl = [
      ['員工上網', { src: 'LAN', dst: 'INTERNET', svc: 'WEB', action: 'allow' }],
      ['員工 DNS', { src: 'LAN', dst: 'INTERNET', svc: 'DNS', action: 'allow' }],
      ['AD 轉送 DNS', { src: 'SERVERS', dst: 'INTERNET', svc: 'DNS', action: 'allow' }],
      ['客戶連官網', { src: 'INTERNET', dst: 'DMZ', svc: 'WEB', action: 'allow' }],
      ['官網查資料庫', { src: 'DMZ', dst: 'SERVERS', svc: 'SQL', action: 'allow' }],
      ['訪客上網', { src: 'GUEST', dst: 'INTERNET', svc: 'WEB', action: 'allow' }],
      ['訪客 DNS', { src: 'GUEST', dst: 'INTERNET', svc: 'DNS', action: 'allow' }],
      ['擋訪客進內網', { src: 'GUEST', dst: 'LAN', svc: 'ANY', action: 'deny' }],
    ];
    const form = h('div', { class: 'card col', style: { gap: '10px' } },
      h('h3', {}, '新增規則'),
      h('div', { class: 'grid c4' },
        h('label', { class: 'field' }, h('span', {}, '來源區域'), sel('src', zones)),
        h('label', { class: 'field' }, h('span', {}, '目的區域'), sel('dst', zones)),
        h('label', { class: 'field' }, h('span', {}, '服務'), sel('svc', svcs)),
        h('label', { class: 'field' }, h('span', {}, '動作'), sel('action', [['allow', '允許 ALLOW'], ['deny', '拒絕 DENY']]))),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => UI.res(G.Act.addRule(Object.assign({}, d))) }, '加到最下方'),
        h('button', { class: 'btn', onclick: () => UI.res(G.Act.addRule(Object.assign({ top: true }, d))) }, '加到最上方'),
        h('span', { class: 'small muted' }, '快速範本：'),
        tmpl.map(([t, r]) => h('button', { class: 'btn xs', onclick: () => UI.res(G.Act.addRule(Object.assign({}, r))) }, t))));
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } }, form, reqCard));
    V.hitsEls = new Map();
    const rows = s.fw.rules.map((r, i) => {
      const sh = G.Sec.shadowedBy(r);
      const hitEl = h('span', {}, fmtHits(s.ruleHits[r.id] || 0));
      V.hitsEls.set(r.id, hitEl);
      return h('tr', { style: { opacity: r.on ? 1 : 0.45 } },
        h('td', { class: 'mono' }, String(i + 1)),
        h('td', { class: 'z' }, zc(r.src)), h('td', { class: 'z' }, zc(r.dst)),
        h('td', { class: 'mono small' }, r.svc, h('div', { class: 'tiny dim' }, G.SVC[r.svc].port)),
        h('td', {}, h('span', { class: 'chip ' + (r.action === 'allow' ? 'ok' : 'bad') }, r.action === 'allow' ? '允許' : '拒絕'), sh ? h('span', { class: 'chip warn', title: `被規則 #${s.fw.rules.indexOf(sh) + 1} 遮蔽` }, '永不生效') : null, r.note ? h('div', { class: 'tiny dim' }, r.note) : null),
        h('td', { class: 'r mono small' }, hitEl),
        h('td', { class: 'r' }, h('div', { class: 'row', style: { justifyContent: 'flex-end', gap: '4px' } },
          h('button', { class: 'btn xs', disabled: i === 0 || null, onclick: () => G.Act.moveRule(r.id, -1), 'aria-label': '上移' }, '↑'),
          h('button', { class: 'btn xs', disabled: i === s.fw.rules.length - 1 || null, onclick: () => G.Act.moveRule(r.id, 1), 'aria-label': '下移' }, '↓'),
          h('button', { class: 'btn xs', onclick: () => UI.res(G.Act.updateRule(r.id, { on: !r.on })) }, r.on ? '停用' : '啟用'),
          h('button', { class: 'btn xs danger', onclick: () => UI.res(G.Act.deleteRule(r.id)) }, '刪除'))));
    });
    const defHit = h('span', {}, fmtHits(s.ruleHits.default || 0));
    V.hitsEls.set('default', defHit);
    rows.push(h('tr', {}, h('td', { class: 'mono dim' }, '—'), h('td', { class: 'z' }, zc('ANY')), h('td', { class: 'z' }, zc('ANY')), h('td', { class: 'mono small' }, 'ANY'),
      h('td', {}, h('span', { class: 'chip bad' }, '拒絕'), h('div', { class: 'tiny dim' }, '預設規則（隱含）')), h('td', { class: 'r mono small' }, defHit), h('td', {})));
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, `防火牆政策（${s.fw.rules.length} 條）`), h('span', { class: 'small muted' }, '命中數：每條規則比對到的連線量（每日減半）')),
      h('div', { class: 'table-wrap' }, h('table', { class: 't rule-tbl' }, h('thead', {}, h('tr', {}, ['#', '來源', '目的', '服務', '動作', '命中', ''].map((x, i) => h('th', { class: i >= 5 ? 'r' : '' }, x)))), h('tbody', {}, rows)))));
  }

  /* ---------- 網段 ---------- */
  function netTab(el) {
    const s = G.S, sim = G.R.sim;
    const dh = sim ? sim.dhcp : { wifi: { need: 0, pool: 0 }, guest: { need: 0 }, wired: { worst: 0 } };
    const srvN = Q.devices('server').filter((d) => d.rack).length;
    const dmzN = Q.devices('server').filter((d) => { const z = G.Net.zones().get(d.id); return z && z.zone === 'DMZ'; }).length;
    const segs = [
      { k: 'wired', name: '員工有線（每層樓一個 VLAN）', vlan: '110–130', net: (p) => `10.1.<樓層>.0/${p}`, need: dh.wired.worst, sub: dh.wired.worstFloor ? `最多的樓層：${dh.wired.worstFloor}` : '', opts: [24, 23, 22, 21] },
      { k: 'wifi', name: '員工無線（全公司共用，由 WLC 集中）', vlan: '200', net: (p) => `10.64.0.0/${p}`, need: dh.wifi.need, sub: '筆電 + 手機', opts: [24, 23, 22, 21, 20, 19, 18, 17, 16] },
      { k: 'guest', name: '訪客無線', vlan: '300', net: (p) => `172.20.0.0/${p}`, need: s.fw.guestWifi ? dh.guest.need : 0, sub: s.fw.guestWifi ? '尖峰訪客裝置' : '訪客 Wi-Fi 未啟用', opts: [24, 23, 22, 21] },
      { k: 'servers', name: '內部伺服器區', vlan: '10', net: (p) => `10.0.10.0/${p}`, need: srvN, sub: '', opts: [26, 25, 24] },
      { k: 'dmz', name: 'DMZ', vlan: '20', net: (p) => `10.0.20.0/${p}`, need: dmzN, sub: '對外透過靜態 NAT', opts: [29, 28, 27] },
    ];
    const toggles = h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between' }, h('h3', {}, '訪客 Wi-Fi（Guest SSID）'), h('button', { class: 'btn ' + (s.fw.guestWifi ? 'on' : 'primary'), onclick: () => UI.res(G.Act.setGuestWifi(!s.fw.guestWifi)) }, s.fw.guestWifi ? '已啟用 · 關閉' : '啟用')),
        h('p', { class: 'small muted' }, '在所有 AP 上廣播獨立的訪客 SSID，對應獨立 VLAN 與網段，經防火牆的 GUEST 區域上網。記得寫規則：只允許 GUEST → INTERNET。'),
        h('button', { class: 'btn ghost xs', style: { alignSelf: 'flex-start' }, onclick: () => UI.openKb('k-guest') }, '訪客隔離')),
      h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between' }, h('h3', {}, '內部分段（LAN ⇄ SERVERS 經防火牆）'), h('button', { class: 'btn ' + (s.fw.segmentation ? 'on' : ''), onclick: () => {
          if (!s.fw.segmentation) UI.confirm('啟用內部分段', '啟用後，員工到內部伺服器的所有流量都要經過防火牆檢查。請先確認已允許 LAN → SERVERS 的 LDAP、DNS、SMB、SQL，而且防火牆效能足夠，否則全公司會登不進網域！', '啟用', () => UI.res(G.Act.setSegmentation(true)), 'warn');
          else UI.res(G.Act.setSegmentation(false));
        } }, s.fw.segmentation ? '已啟用 · 關閉' : '啟用')),
        h('p', { class: 'small muted' }, '讓勒索軟體無法從員工電腦直接橫向攻擊伺服器。代價是防火牆要承擔大量內部流量（流量會繞經防火牆再回到核心）。'),
        h('button', { class: 'btn ghost xs', style: { alignSelf: 'flex-start' }, onclick: () => UI.openKb('k-segment') }, '內部網段分割')));
    el.appendChild(toggles);
    const rows = segs.map((g) => {
      const p = s.subnets[g.k];
      const pool = Q.hosts(p) - 1;
      const u = pool > 0 ? g.need / pool : 0;
      return h('tr', {},
        h('td', {}, h('b', {}, g.name), g.sub ? h('div', { class: 'tiny dim' }, g.sub) : null),
        h('td', { class: 'mono small' }, g.vlan),
        h('td', { class: 'mono small' }, g.net(p)),
        h('td', {}, h('select', { id: 'subnet-' + g.k, onchange: (e) => UI.res(G.Act.setSubnet(g.k, parseInt(e.target.value, 10))) }, g.opts.map((o) => h('option', { value: o, selected: o === p || null }, `/${o}（${U.num(Q.hosts(o))}）`)))),
        h('td', { class: 'r mono small ' + (g.need > pool ? 'bad-t' : '') }, `${U.num(g.need)} / ${U.num(pool)}`),
        h('td', { style: { width: '18%' } }, h('div', { class: 'bar ' + (u > 1 ? 'bad' : u > 0.85 ? 'warn' : 'ok') }, h('i', { style: { width: Math.min(100, u * 100) + '%' } }))));
    });
    el.appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'card-h' }, h('h3', {}, 'VLAN 與 IP 子網路'), h('div', { class: 'row' }, h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-ip') }, 'CIDR 怎麼算'), h('button', { class: 'btn ghost xs', onclick: () => UI.openKb('k-vlan') }, 'VLAN'))),
      h('p', { class: 'small muted', style: { marginBottom: '8px' } }, 'DHCP 位址池 = 子網路可用位址 − 1（閘道）。需求超過可用數時，新裝置就拿不到 IP。前綴越小，位址越多（每少 1 就翻倍）。'),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['網段', 'VLAN', '位址', '大小', '需求 / 可用', ''].map((x, i) => h('th', { class: i === 4 ? 'r' : '' }, x)))), h('tbody', {}, rows)))));
    /* 區域成員 */
    const zones = G.Net.zones();
    const members = {};
    for (const [id, z] of zones) { if (!z.linked) continue; (members[z.zone] = members[z.zone] || []).push(id); }
    const zname = { LAN: '員工內網 LAN', SERVERS: '伺服器區 SERVERS', DMZ: 'DMZ', EXPOSED: '⚠ 暴露在防火牆外', BYPASS: '⚠ 繞過防火牆', BRIDGED: '⚠ DMZ 與內網相連' };
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '安全區域成員（依實際接線判定）')),
      Object.keys(members).length ? h('div', { class: 'col', style: { gap: '8px' } }, Object.entries(members).filter(([z]) => z !== 'ISOLATED').map(([z, ids]) => h('div', {},
        h('div', { class: 'small', style: { fontWeight: 600, color: ['EXPOSED', 'BYPASS', 'BRIDGED'].includes(z) ? 'var(--bad)' : 'var(--text)' } }, zname[z] || z),
        h('div', { class: 'row wrap', style: { marginTop: '4px' } }, ids.map((id) => h('span', { class: 'chip' }, Q.nodeName(id))))))) : h('div', { class: 'empty' }, '還沒有任何設備或樓層接上網路')));
  }

  /* ---------- 資安服務 ---------- */
  function svcTab(el) {
    const s = G.S;
    let total = 0;
    for (const id of Object.keys(s.services)) total += Q.monthlyServiceCost(id);
    el.appendChild(h('div', { class: 'note', style: { marginBottom: '12px' } }, `目前每月資安服務費用約 ${U.money(total)}（每日結算）。依人數計費的服務以目前進駐人數計算（最少 500 人）。啟用時先收首月費用。`));
    const groups = {};
    for (const [id, svc] of Object.entries(CAT.services)) (groups[svc.group] = groups[svc.group] || []).push([id, svc]);
    const grid = h('div', { class: 'shop-grid' });
    for (const [grp, items] of Object.entries(groups)) {
      for (const [id, svc] of items) {
        const on = !!s.services[id];
        const locked = !Q.unlocked(svc);
        const cost = svc.perUser ? `NT$${svc.perUser} / 人 / 月（約 ${U.money(Q.monthlyServiceCost(id))}）` : svc.monthly ? `${U.money(svc.monthly)} / 月` : '免費';
        grid.appendChild(h('div', { class: 'card svc-card' + (locked ? ' prod locked-item' : '') },
          h('div', { class: 'row between' }, h('span', { class: 'label' }, grp), on ? h('span', { class: 'chip ok' }, '已啟用') : locked ? h('span', { class: 'chip' }, `第 ${svc.unlock} 章解鎖`) : null),
          h('b', {}, svc.name), h('p', { class: 'small muted' }, svc.desc), h('div', { class: 'mono small' }, cost),
          h('button', { class: 'btn ' + (on ? 'danger' : 'primary') + ' sm', disabled: locked || null, style: { alignSelf: 'flex-start' }, onclick: () => UI.res(on ? G.Act.unsubscribe(id) : G.Act.subscribe(id)) }, on ? '停用' : '啟用')));
      }
    }
    const t = CAT.training;
    const trOn = s.trainingUntil > s.time;
    grid.appendChild(h('div', { class: 'card svc-card' + (Q.unlocked(t) ? '' : ' prod locked-item') },
      h('div', { class: 'row between' }, h('span', { class: 'label' }, '人員'), trOn ? h('span', { class: 'chip ok' }, `有效至 ${U.stamp(s.trainingUntil)}`) : null),
      h('b', {}, t.name), h('p', { class: 'small muted' }, t.desc), h('div', { class: 'mono small' }, `${U.money(t.price)} / 次`),
      h('button', { class: 'btn primary sm', disabled: !Q.unlocked(t) || null, style: { alignSelf: 'flex-start' }, onclick: () => UI.res(G.Act.buyTraining()) }, '舉辦訓練')));
    el.appendChild(grid);
  }

  /* ---------- 健檢 ---------- */
  function auditTab(el, audit) {
    const p = G.Sec.posture();
    const layers = [
      ['防火牆', p.fw], ['IPS', p.ips], ['URL 過濾', p.url], ['閘道防毒', p.gav], ['Geo-IP', p.geo], ['DDoS 清洗', p.ddos], ['WAF', p.waf],
      ['MFA', p.mfa], ['EDR', p.edr], ['郵件安全', p.mailsec], ['NAC', p.nac], ['內部分段', p.segmentation], ['訪客隔離', p.guestIsolated],
      ['SIEM', p.siem], ['NMS', p.nms], ['備份', p.backup], ['不可變備份', p.immutable], ['資安訓練', p.training],
    ];
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } },
      h('div', { class: 'card row', style: { gap: '18px' } },
        h('div', { class: 'grade ' + (audit.grade <= 'B' ? 'ok-t' : audit.grade === 'C' ? 'warn-t' : 'bad-t') }, audit.grade),
        h('div', {}, h('div', { class: 'mono', style: { fontSize: '20px', fontWeight: 600 } }, `${audit.score} / 100`), h('div', { class: 'small muted' }, `${audit.findings.length} 項發現。嚴重 −30、高 −15、中 −7、低 −3。`))),
      h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '6px' } }, '縱深防禦'), h('div', { class: 'row wrap' }, layers.map(([t, on]) => h('span', { class: 'chip ' + (on ? 'ok' : '') }, (on ? '✓ ' : '· ') + t))))));
    const sevName = { crit: '嚴重', high: '高', med: '中', low: '低', info: '提示' };
    const sevCls = { crit: 'bad', high: 'bad', med: 'warn', low: 'info', info: '' };
    el.appendChild(h('div', { class: 'card' }, audit.findings.length ? audit.findings.map((f) => h('div', { class: 'finding' },
      h('div', {}, h('span', { class: 'chip ' + sevCls[f.sev] }, sevName[f.sev])),
      h('div', {}, h('b', {}, f.title), h('p', { class: 'small muted', style: { margin: '2px 0 4px' } }, f.detail), h('div', { class: 'small' }, h('span', { class: 'accent-t' }, '建議：'), f.fix),
        f.kb ? h('button', { class: 'btn ghost xs', style: { marginTop: '4px' }, onclick: () => UI.openKb(f.kb) }, '相關知識') : null))) : h('div', { class: 'empty' }, '沒有發現問題。做得好！')));
  }
})(window.G = window.G || {});
