/* 系統管理：虛擬化（主機、VM、HA、P2V）、儲存（資料量、儲存池、RAID、容量預測）、備份（排程、3-2-1、還原演練、工作紀錄）、
 * 語音（IP-PBX、SIP 中繼與 Erlang B、SBC、QoS、各樓層 MOS）、端點（Patch Tuesday、分批派送、更新快取、BitLocker）。 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'vm', selVm: null, newRole: 'ad', renderers: {} };
  G.Views.sys = V;
  V.TABS = [['vm', '虛擬化'], ['stor', '儲存'], ['bkp', '備份']];
  const kbBtn = (id, label) => h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(id) }, label || (G.KB.byId[id] ? G.KB.byId[id].title : id));
  const tile = (k, v, sub, cls) => h('div', { class: 'tile gauge' }, h('div', { class: 'k' }, k), h('div', { class: 'big ' + (cls || '') }, v), h('div', { class: 's small muted' }, sub || ''));
  const lockNote = (item) => (!Q.unlocked(item) ? h('div', { class: 'note', style: { marginBottom: '10px' } }, `第 ${item.unlock} 章解鎖：現在可以先看看，等劇情到了就能建置。`) : null);

  V.mount = (el, param) => {
    if (param && V.TABS.some((t) => t[0] === param)) V.tab = param;
    V.el = el;
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '系統管理'), h('div', { class: 'desc' }, '機房裡跑的「服務」：虛擬化主機上的 VM、存放公司資料的儲存設備、每晚的備份，以及電話系統與上萬台電腦的管理。')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => UI.go('shop:sys') }, '採購系統設備'))));
    el.appendChild(h('div', { class: 'tabs', role: 'tablist' }, V.TABS.map(([k, t]) => h('button', { class: V.tab === k ? 'on' : '', 'data-hint': 'tab:sys:' + k, onclick: () => { V.tab = k; UI.refresh(); } }, t, badge(k)))));
    const r = V.renderers[V.tab] || vmTab;
    r(el);
  };
  function badge(k) {
    const s = G.S;
    let n = 0;
    if (k === 'stor' && G.R.stor) n = G.R.stor.pools.filter((p) => p.ratio >= 0.85 || p.lost).length;
    if (k === 'bkp') { const j = s.bkp.jobs[s.bkp.jobs.length - 1]; n = j && !j.ok ? 1 : 0; }
    if (k === 'vm') n = G.VM.vms().filter((v) => UI.devStatus(v).c === 'bad').length;
    if (V.badges && V.badges[k]) n += V.badges[k]();
    return n ? h('span', { class: 'count' }, String(n)) : null;
  }
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 2000) return;
    V.last = now;
    if (V.el && !V.el.contains(document.activeElement)) UI.refresh();
  };

  /* ---------- 虛擬化 ---------- */
  function vmTab(el) {
    const s = G.S, c = G.VM.cluster();
    const lk = lockNote(CAT.devices['HV-2U']);
    if (lk) el.appendChild(lk);
    el.appendChild(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
      tile('虛擬化主機', `${c.up} / ${c.hosts}`, c.hosts ? `授權費 ${U.money(G.VM.monthlyCost())}/月` : '還沒有主機', c.up < c.hosts ? 'bad-t' : ''),
      tile('VM', String(c.vms), c.vms ? `${c.onSan} 台放在 SAN` : '還沒有 VM'),
      tile('vCPU', c.vcpu ? U.pct(c.uc / c.vcpu) : '—', c.vcpu ? `${c.uc} / ${c.vcpu}（4:1 超用）` : ''),
      tile('記憶體', c.ram ? U.pct(c.ur / c.ram) : '—', c.ram ? `${c.ur} / ${c.ram} GB（不能超用）` : '', c.ram && c.ur / c.ram > 0.9 ? 'warn-t' : ''),
      tile('HA 高可用', c.ha ? (c.n1 ? '可容錯' : '資源不足') : '未啟用', !c.haOn ? 'HA 已關閉' : c.hosts < 2 ? '至少要兩台主機' : !c.shared ? '缺共用儲存（SAN）' : c.n1 ? '任一台主機故障，VM 都能在別台重開' : '壞一台主機後，剩下的記憶體放不下所有 VM', c.ha && c.n1 ? 'ok-t' : 'warn-t')));
    el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      h('button', { class: 'btn ' + (s.vm.ha ? 'on' : 'primary'), 'data-hint': 'vm-ha', onclick: () => UI.res(G.VM.setHa(!s.vm.ha)) }, s.vm.ha ? 'HA 已開啟 · 關閉' : '開啟 HA'),
      kbBtn('k-vm'), kbBtn('k-san')));
    if (!c.hosts) {
      el.appendChild(h('div', { class: 'card col', style: { gap: '8px', marginBottom: '12px' } },
        h('b', {}, '先建一座虛擬化叢集'), h('p', { class: 'small muted' }, '一台實體伺服器通常只用到 10～20% 的效能。把十幾個服務做成 VM 放在同一台主機上，機櫃、電費、維護費都省下來；兩台以上主機再加一台共用儲存（SAN），任何一台主機壞掉，VM 都會自動在別台重開（HA）。'),
        h('button', { class: 'btn primary sm', style: { alignSelf: 'flex-start' }, onclick: () => UI.go('shop:sys') }, '採購虛擬化主機與 SAN')));
    }
    const grid = h('div', { class: 'grid c2', style: { marginBottom: '12px' } });
    for (const host of G.VM.hosts()) {
      const m = CAT.devices[host.model], u = G.VM.used(host.id), st = UI.devStatus(host);
      const vms = G.VM.onHost(host.id);
      grid.appendChild(h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between' }, h('b', {}, host.name), h('span', { class: 'chip ' + st.c }, st.t)),
        UI.meter('vCPU', u.vcpu, m.vcpu, ''), UI.meter('記憶體', u.ram, m.ram, ' GB'),
        h('div', { class: 'row wrap' }, vms.length ? vms.map((v) => h('button', { class: 'chip ' + UI.devStatus(v).c + (V.selVm === v.id ? ' accent' : ''), style: { cursor: 'pointer' }, onclick: () => { V.selVm = v.id; UI.refresh(); } }, v.name)) : h('span', { class: 'small dim' }, '沒有 VM')),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn xs', onclick: () => { G.Views.rack.sel = host.id; G.Views.rack.rack = host.rack; UI.go('rack'); } }, '在機房查看'),
          vms.length ? h('button', { class: 'btn xs', onclick: () => { const r = G.VM.evacuate(host.id); UI.toast(`維護模式：遷走 ${r.moved} 台 VM${r.failed ? `，${r.failed} 台沒有地方放` : ''}`, r.failed ? 'warn' : 'ok'); UI.refresh(); } }, '維護模式（遷走 VM）') : null)));
    }
    if (grid.children.length) el.appendChild(grid);
    /* 建立 VM、P2V、選取的 VM */
    const roles = CAT.devices.VM.roles;
    const [vc, ram, disk] = CAT.vmSize[V.newRole] || [4, 16, 0.2];
    const create = h('div', { class: 'card col', style: { gap: '8px' } },
      h('h3', {}, '建立 VM'),
      h('select', { id: 'vm-role', onchange: (e) => { V.newRole = e.target.value; UI.refresh(); } }, roles.map((r) => h('option', { value: r, selected: r === V.newRole || null }, `${CAT.roles[r].name}（${CAT.vmSize[r][0]} vCPU · ${CAT.vmSize[r][1]} GB）`))),
      h('div', { class: 'small muted' }, `${vc} vCPU、${ram} GB 記憶體、系統碟 ${disk} TB。作業系統授權 ${U.money(CAT.vmCfg.osLicense)}，約 ${CAT.vmCfg.bootMin} 分鐘開機。${G.VM.sanUp() ? '硬碟會放在 SAN。' : '目前沒有 SAN：硬碟只能放主機本機（不能 HA）。'}`),
      h('button', { class: 'btn primary sm', 'data-hint': 'vm-create', disabled: !c.up || null, style: { alignSelf: 'flex-start' }, onclick: () => { const r = UI.res(G.VM.create(V.newRole)); if (r.ok) V.selVm = r.id; } }, '建立 VM'));
    const phys = Q.devices('server').filter((d) => d.rack && !d.host && d.role && roles.includes(d.role) && !CAT.devices[d.model].hv);
    const p2v = h('div', { class: 'card col', style: { gap: '6px' } },
      h('h3', {}, '實體轉虛擬（P2V）'),
      h('div', { class: 'small muted' }, `把實體伺服器的服務搬到 VM：轉換期間舊主機照常服務，完成後就能出售舊硬體。每台 ${U.money(CAT.vmCfg.p2vFee)}、約 ${U.dur(CAT.vmCfg.p2vMin)}。`),
      phys.length ? phys.map((d) => { const m = CAT.devices[d.model]; const busy = G.VM.vms().some((v) => v.p2vFrom === d.id);
        const dmz = (G.Net.zones().get(d.id) || {}).zone === 'DMZ';
        return h('div', { class: 'row between small' }, h('span', {}, h('b', {}, d.name), h('span', { class: 'muted' }, `　${CAT.roles[d.role].short} · ${m.u}U · ${m.watts} W`),
          dmz ? h('div', { class: 'tiny warn-t' }, '在 DMZ：VM 會跟著主機的網段（內部伺服器區），對外服務建議留在 DMZ 或用 DMZ 專用的主機') : null),
          h('button', { class: 'btn xs', 'data-hint': 'p2v', disabled: busy || !c.up || null, onclick: () => UI.res(G.VM.p2v(d.id)) }, busy ? '轉換中…' : '轉成 VM')); }) : h('div', { class: 'small dim' }, '沒有可以轉換的實體伺服器。'));
    const right = h('div', { class: 'col', style: { gap: '10px' } }, create, p2v);
    const left = h('div', { class: 'col', style: { gap: '10px' } });
    if (V.selVm && G.S.devices[V.selVm]) left.appendChild(UI.vmCard(V.selVm));
    left.appendChild(vmTable());
    el.appendChild(h('div', { class: 'split' }, left, right));
  }
  function vmTable() {
    const vms = G.VM.vms();
    if (!vms.length) return h('div', { class: 'card empty' }, '還沒有 VM。');
    const rows = vms.map((v) => {
      const st = UI.devStatus(v), host = G.S.devices[v.host];
      return h('tr', { class: 'click', onclick: () => { V.selVm = v.id; UI.refresh(); } },
        h('td', {}, h('b', {}, v.name)), h('td', {}, v.role ? CAT.roles[v.role].short : '—'), h('td', { class: 'mono small' }, host ? host.name : '—'),
        h('td', { class: 'mono small' }, `${v.vcpu} / ${v.ram} GB`), h('td', { class: 'small ' + (v.disk === 'san' ? '' : 'warn-t') }, v.disk === 'san' ? 'SAN' : '本機'),
        h('td', {}, h('span', { class: 'chip ' + st.c }, st.t)));
    });
    return h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, `VM 清單（${vms.length}）`)),
      h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['名稱', '角色', '主機', 'vCPU / 記憶體', '硬碟', '狀態'].map((x) => h('th', {}, x)))), h('tbody', {}, rows))));
  }

  /* ---------- 儲存 ---------- */
  function storTab(el) {
    const s = G.S, R = G.R.stor || G.Stor.update();
    const d = R.data;
    el.appendChild(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
      tile('檔案資料', `${d.file.toFixed(1)} TB`, '每天成長約 0.4%（行銷設計的影片素材最多）'),
      tile('資料庫', `${d.db.toFixed(1)} TB`, 'ERP、客戶與訂單'),
      tile('VM 系統碟', `${(R.prot - d.file - d.db).toFixed(1)} TB`, `${G.VM.vms().length} 台 VM`),
      tile('備份資料', `${R.backupTB.toFixed(1)} TB`, `保存 ${s.bkp.keep} 天、重複資料刪除後`),
      tile('最滿的儲存', R.pools.length ? U.pct(Math.min(R.worst, 9.99)) : '—', R.worst >= 1 ? '已經滿了！' : R.worst >= 0.85 ? '該擴充了（建議 < 80%）' : '正常', R.worst >= 1 ? 'bad-t' : R.worst >= 0.85 ? 'warn-t' : 'ok-t')));
    el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      h('button', { class: 'btn ' + (s.stor.snap ? 'on' : ''), onclick: () => UI.res(G.Stor.setSnap(!s.stor.snap)) }, s.stor.snap ? '每小時快照：開 · 關閉' : '開啟每小時快照'),
      kbBtn('k-san'), kbBtn('k-backup')));
    if (!R.pools.length) { el.appendChild(h('div', { class: 'card empty' }, '還沒有任何儲存設備。檔案伺服器（ST-4U）或 SAN 上架後，這裡會顯示容量。')); return; }
    const grid = h('div', { class: 'grid c2' });
    for (const p of R.pools) {
      const dev = p.dev, m = CAT.devices[dev.model];
      const status = p.lost ? { t: '資料毀損', c: 'bad' } : p.rebuild ? { t: `RAID 重建中 ${U.dur(p.rebuild - s.time)}`, c: 'warn' } : p.ratio >= 1 ? { t: '已滿', c: 'bad' } : p.ratio >= 0.85 ? { t: '偏滿', c: 'warn' } : { t: '正常', c: 'ok' };
      const card = h('div', { class: 'card col', style: { gap: '8px' } },
        h('div', { class: 'row between' }, h('b', {}, p.name), h('span', { class: 'chip ' + status.c }, status.t)),
        UI.meter(p.kind === 'local' ? '本機硬碟（不共用）' : `可用容量（${CAT.raid[p.raid].name}）`, p.used, p.cap, ' TB'),
        h('div', { class: 'small muted' }, Object.entries(p.items).map(([k, v]) => `${k} ${v.toFixed(1)} TB`).join('、') || '還沒有資料'),
        h('div', { class: 'small ' + (p.daysLeft && p.daysLeft < 30 ? 'warn-t' : 'dim') }, p.ratio >= 1 ? '已經放不下了：擴充容量，或把資料搬到別的儲存' : p.used > 0 ? `照目前成長，約 ${Math.round(p.daysLeft)} 天後滿` : ''));
      if (p.kind !== 'local' && !m.shelf) {
        card.appendChild(h('div', { class: 'seg' }, Object.entries(CAT.raid).map(([k, r]) => h('button', { class: p.raid === k ? 'on' : '', onclick: () => UI.res(G.Stor.setRaid(dev.id, k)) }, r.name))));
        card.appendChild(h('div', { class: 'tiny dim' }, CAT.raid[p.raid].desc));
      }
      if (p.kind === 'san') card.appendChild(h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `擴充櫃 ${p.shelves} 台（每台 +${CAT.devices['DS-24'].rawTB} TB 原始容量）`), h('button', { class: 'btn xs', onclick: () => UI.res(G.Act.buyDevice('DS-24')) }, `購買擴充櫃（${U.money(CAT.devices['DS-24'].price)}）`)));
      if (p.kind === 'local') card.appendChild(h('div', { class: 'tiny dim' }, '放在主機本機的 VM：主機一壞就停擺，也不能線上遷移。建議把硬碟搬到 SAN。'));
      grid.appendChild(card);
    }
    el.appendChild(grid);
  }

  /* ---------- 備份 ---------- */
  function bkpTab(el) {
    const s = G.S, b = s.bkp, r = G.Stor.rule321();
    const rpo = G.Stor.rpoHours();
    const srv = G.Stor.bkpServers();
    const chk = (okv, t, sub) => h('div', { class: 'row', style: { gap: '8px', alignItems: 'flex-start' } }, h('span', { class: 'chip ' + (okv ? 'ok' : 'bad'), style: { minWidth: '26px', justifyContent: 'center' } }, okv ? '✓' : '✗'), h('div', {}, h('b', {}, t), h('div', { class: 'small muted' }, sub)));
    el.appendChild(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
      tile('最後成功備份', rpo === Infinity ? '從未' : `${Math.round(rpo)} 小時前`, rpo === Infinity ? (srv.length ? '還沒有跑過備份' : '還沒有備份伺服器') : `RPO：出事時最多遺失 ${Math.round(Math.max(rpo, b.freq))} 小時的資料`, rpo > 26 ? 'bad-t' : 'ok-t'),
      tile('備份策略', `每 ${b.freq} 小時`, `保存 ${b.keep} 天`),
      tile('3-2-1', r.ok ? '符合' : `${r.copies} 份`, r.ok ? '三份、兩種媒體、一份在異地' : '還差一步：看下面的清單', r.ok ? 'ok-t' : 'warn-t'),
      tile('還原演練', b.drillUntil > s.time ? '進行中' : b.drillAt ? (b.drillOk ? '成功' : '失敗') : '從未', b.drillAt ? `${U.stamp(b.drillAt)}` : '沒演練過的備份，等於沒有備份', b.drillAt && b.drillOk ? 'ok-t' : 'warn-t')));
    if (b.fault) el.appendChild(h('div', { class: 'note bad', style: { marginBottom: '10px' } }, h('b', {}, '備份一直失敗　'), Stor().FAULTS[b.fault], '。到「事件」處理。'));
    const policy = h('div', { class: 'card col', style: { gap: '10px' } },
      h('div', { class: 'card-h', style: { marginBottom: 0 } }, h('h3', {}, '備份策略'), kbBtn('k-backup')),
      h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, '頻率'), h('div', { class: 'seg' }, [24, 12, 4].map((f) => h('button', { class: b.freq === f ? 'on' : '', onclick: () => UI.res(G.Stor.setPolicy(f)) }, `每 ${f} 小時`)))),
      h('div', { class: 'small dim' }, '越頻繁，RPO（可能遺失的資料）越少；但備份流量與備份空間也越多。'),
      h('div', { class: 'row wrap' }, h('span', { class: 'small muted' }, '保存'), h('div', { class: 'seg' }, G.Stor.KEEP.map((k) => h('button', { class: b.keep === k ? 'on' : '', onclick: () => UI.res(G.Stor.setPolicy(null, k)) }, `${k} 天`)))),
      h('div', { class: 'small dim' }, '保存越久，越能還原到「被入侵之前」的版本（勒索軟體常潛伏好幾週），但備份空間也越大。'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary sm', 'data-hint': 'bkp-drill', disabled: !srv.length || b.drillUntil > s.time || null, onclick: () => UI.res(G.Stor.drill()) }, b.drillUntil > s.time ? `演練中（剩 ${U.dur(b.drillUntil - s.time)}）` : '進行還原演練（2 小時）'),
        !srv.length ? h('button', { class: 'btn sm', onclick: () => UI.go('shop:srv') }, '部署備份伺服器') : null));
    const tape = G.Stor.hasTape();
    const svcBtn = (id) => { const on = Q.hasService(id), svc = CAT.services[id]; return h('button', { class: 'btn xs ' + (on ? 'danger' : 'primary'), 'data-hint': 'svc:' + id, disabled: !Q.unlocked(svc) || null, onclick: () => UI.res(on ? G.Act.unsubscribe(id) : G.Act.subscribe(id)) }, on ? '停用' : `啟用（${U.money(Q.monthlyServiceCost(id))}/月）`); };
    const rule = h('div', { class: 'card col', style: { gap: '10px' } },
      h('h3', {}, '3-2-1 原則'),
      chk(r.local, '第 2 份：本地備份', srv.length ? (r.local ? '備份伺服器上有 26 小時內的備份' : '最近 26 小時內沒有成功的備份') : '還沒有備份伺服器（ST-4U 角色設為備份，或建一台備份 VM）'),
      chk(r.media2, '2 種媒體', tape ? (r.tape ? '硬碟 + 磁帶' : '磁帶櫃還沒寫入最新的備份') : r.cloud ? '硬碟 + 雲端物件儲存' : '備份都在同一種硬碟上：再加磁帶或雲端'),
      chk(r.offsite, '第 3 份在異地', r.vault ? '磁帶由保全公司送到異地金庫' : r.cloud ? '每晚複製到雲端' : tape ? '磁帶還放在機房裡：啟用「磁帶異地保管」' : '總部火災、淹水時，資料全部在同一棟樓'),
      chk(r.immutable, '+1：不可變 / 離線', r.immutable ? '勒索軟體改不了、刪不掉' : '線上的備份，勒索軟體拿到管理員權限就能一起加密'),
      chk(r.drill, '還原演練（7 天內）', r.drill ? '最近一次演練成功' : '定期真的還原一次，才知道備份能不能用、要多久（RTO）'),
      h('div', { class: 'hr' }),
      h('div', { class: 'row between small' }, h('span', {}, h('b', {}, '磁帶櫃 TL-48'), h('span', { class: 'muted' }, tape ? '　運作中' : '　未安裝')), tape ? null : h('button', { class: 'btn xs', onclick: () => UI.go('shop:sys') }, '採購')),
      h('div', { class: 'row between small' }, h('span', {}, h('b', {}, CAT.services.vault.name), h('span', { class: 'muted' }, '　每週把磁帶送到異地金庫')), svcBtn('vault')),
      h('div', { class: 'row between small' }, h('span', {}, h('b', {}, '雲端備份'), h('span', { class: 'muted' }, '　異地 + 物件鎖定（需開 SERVERS → INTERNET：WEB）')), svcBtn('cloudbk')),
      h('div', { class: 'row between small' }, h('span', {}, h('b', {}, CAT.services.immutable.name), h('span', { class: 'muted' }, '　備份伺服器上的 WORM 鎖定')), svcBtn('immutable')));
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } }, policy, rule));
    const jobs = b.jobs.slice(-14).reverse();
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '備份工作紀錄'), h('span', { class: 'small muted' }, '沒有監控（NMS / SIEM）的話，失敗只會記在這裡，沒人會通知你')),
      jobs.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['時間', '結果', '資料量', '磁帶', '雲端'].map((x) => h('th', {}, x)))),
        h('tbody', {}, jobs.map((j) => h('tr', {},
          h('td', { class: 'mono small' }, U.stamp(j.t)),
          h('td', {}, j.ok ? h('span', { class: 'chip ok' }, '成功') : h('span', {}, h('span', { class: 'chip bad' }, '失敗'), h('div', { class: 'tiny dim' }, j.why))),
          h('td', { class: 'mono small' }, j.ok ? `${j.tb} TB` : '—'),
          h('td', { class: 'small' }, j.tape ? '✓' : '—'),
          h('td', { class: 'small ' + (j.cloudWhy ? 'bad-t' : '') }, j.cloud ? '✓' : j.cloudWhy ? '失敗' : '—')))))) : h('div', { class: 'empty' }, srv.length ? '排程時間到了就會開始備份（每天 01:00 起）。' : '還沒有備份伺服器。')));
  }
  const Stor = () => G.Stor;

  /* ---------- 語音 ---------- */
  function voiceTab(el) {
    const s = G.S, v = s.voice, R = G.R.voice || {};
    const active = G.Voice.active();
    const lk = lockNote(CAT.voice);
    if (lk) el.appendChild(lk);
    if (!active) el.appendChild(h('div', { class: 'note info', style: { marginBottom: '10px' } }, s.mode === 'sandbox' ? `目前還在用大樓附的舊型總機，${U.stamp(v.graceUntil)} 起要換成自己的 IP 電話交換機。` : '目前用的是大樓附的舊型類比總機（第七章起要換成 IP 電話交換機）。'));
    const pbx = Q.roleServers('pbx').filter((d) => d.rack), sbc = Q.roleServers('sbc').filter((d) => d.rack);
    const pbxUp = pbx.filter((d) => G.Net.devUp(d)).length;
    el.appendChild(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
      tile('電話交換機', pbx.length ? `${pbxUp} / ${pbx.length}` : '沒有', pbx.length >= 2 ? '有備援' : pbx.length ? '單一台：壞了全公司電話不通' : '部署 IP-PBX', pbx.length && pbxUp ? 'ok-t' : active ? 'bad-t' : ''),
      tile('外線（SIP 中繼）', v.trunk ? `${v.trunk} 路` : '沒有', v.next ? `調整為 ${v.next} 路：${U.dur(Math.max(0, v.nextAt - s.time))} 後生效` : v.trunk ? `月租 ${U.money(G.Voice.monthly())}` : '向電信業者申請'),
      tile('同時通話', R.active ? `${Math.round(R.calls || 0)} 通` : '—', R.active ? `外線 ${Math.round(R.ext || 0)} 通（厄朗）` : ''),
      tile('外線阻塞率', R.active ? U.pct(R.blocking || 0, 1) : '—', R.active ? (R.blocking > 0.05 ? '客戶打不進來' : 'Erlang B：< 1% 最理想') : '', R.blocking > 0.05 ? 'bad-t' : R.blocking > 0.01 ? 'warn-t' : 'ok-t'),
      tile('通話品質 MOS', R.mos ? R.mos.toFixed(2) : '—', R.worst ? `最差：${R.worst.fid} ${R.worst.mos.toFixed(2)}（4 以上清楚）` : '1～5 分', R.mos && R.mos < 3.6 ? 'bad-t' : R.mos && R.mos < 4 ? 'warn-t' : 'ok-t')));
    el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      h('button', { class: 'btn ' + (v.qos ? 'on' : 'primary'), 'data-hint': 'qos', onclick: () => UI.res(G.Voice.setQos(!v.qos)) }, v.qos ? '語音 QoS：開 · 關閉' : '啟用語音 QoS'),
      kbBtn('k-pbx'), kbBtn('k-qos')));
    /* 設備 */
    const devRow = (d, what) => { const st = UI.devStatus(d), z = G.Net.zones().get(d.id); return h('div', { class: 'row between small' }, h('span', {}, h('b', {}, d.name), h('span', { class: 'muted' }, `　${what}${d.host ? '（VM）' : ''} · ${z ? UI.zoneText(z.zone) : ''}`)), h('span', { class: 'chip ' + st.c }, st.t)); };
    const devs = h('div', { class: 'card col', style: { gap: '8px' } },
      h('h3', {}, '電話交換機與 SBC'),
      pbx.length ? pbx.map((d) => devRow(d, 'IP-PBX')) : h('div', { class: 'small dim' }, '還沒有電話交換機。'),
      sbc.length ? sbc.map((d) => devRow(d, 'SBC')) : h('div', { class: 'small dim' }, '還沒有 SBC：電信業者的 SIP 中繼只能直接接到電話交換機（要對網際網路開 SIP，有盜打風險）。'),
      sbc.length && !G.Sec.serverZones('sbc').some((x) => x.zone === 'DMZ') ? h('div', { class: 'note warn small' }, 'SBC 要放在 DMZ（接到防火牆的 DMZ 介面或 DMZ 交換器）。') : null,
      h('div', { class: 'small muted' }, '分機（IP 電話）用 PoE 供電、註冊到電話交換機；打外線時經 SBC 走 SIP 中繼到電信業者。'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn sm', onclick: () => UI.go('shop:sys') }, '採購 PX-500 / SBC-2'),
        Q.unlocked(CAT.devices.VM) && G.VM.hosts().length ? h('button', { class: 'btn sm', onclick: () => UI.res(G.VM.create('pbx')) }, '建立 PBX VM') : null));
    /* SIP 中繼：Erlang B 試算 */
    const A = R.ext || 0;
    const trunk = h('div', { class: 'card col', style: { gap: '8px' } },
      h('h3', {}, '外線：SIP 中繼'),
      h('div', { class: 'small muted' }, '向電信業者租用的「同時通話路數」。路數不夠，尖峰時客戶就會聽到忙線。用 Erlang B 從尖峰話務量（厄朗 = 同時進行的通話數）算出阻塞率。'),
      h('div', { class: 'col', style: { gap: '4px' } }, Object.entries(CAT.voice.trunks).map(([ch, p]) => {
        const n = Number(ch), b = A > 0 ? G.Voice.erlangB(n, A) : 0;
        return h('div', { class: 'row between small' },
          h('span', {}, h('b', { class: 'mono' }, `${ch} 路`), h('span', { class: 'muted' }, `　${U.money(p.monthly)}/月`), A > 0 ? h('span', { class: b > 0.05 ? 'bad-t' : b > 0.01 ? 'warn-t' : 'ok-t' }, `　目前阻塞率 ${U.pct(b, 1)}`) : null),
          v.trunk === n && !v.next ? h('span', { class: 'chip ok' }, '使用中') : v.next === n ? h('span', { class: 'chip warn' }, '開通中') : h('button', { class: 'btn xs', 'data-hint': 'trunk:' + n, disabled: !Q.unlocked(CAT.voice) || null, onclick: () => UI.res(G.Voice.orderTrunk(n)) }, v.trunk ? '改成這個' : `申請（開通費 ${U.money(p.setup)}）`));
      })),
      v.trunk ? h('button', { class: 'btn danger xs', style: { alignSelf: 'flex-start' }, onclick: () => UI.confirm('終止 SIP 中繼', '終止後所有外線都會中斷。', '終止', () => UI.res(G.Voice.cancelTrunk()), 'danger') }, '終止合約') : null);
    el.appendChild(h('div', { class: 'grid c2', style: { marginBottom: '12px' } }, devs, trunk));
    /* QoS 說明與各樓層通話品質 */
    const fl = Object.entries(R.floors || {});
    el.appendChild(h('div', { class: 'grid c2' },
      h('div', { class: 'card col', style: { gap: '6px' } }, h('h3', {}, '語音 QoS'),
        h('p', { class: 'small muted' }, '語音封包很小，但對延遲、抖動與掉包非常敏感：超過 150 ms 對話就會卡、掉包 1% 就聽得出來。QoS 在接入交換器把 IP 電話的封包標記為 DSCP EF，一路上的交換器、路由器、防火牆都讓它走優先佇列，下載大檔案也不會卡到電話。'),
        h('div', { class: 'small ' + (v.qos ? 'ok-t' : 'warn-t') }, v.qos ? '✓ 已啟用：語音優先，其他流量分剩下的頻寬' : '✗ 未啟用：線路一壅塞，電話就斷斷續續')),
      h('div', { class: 'card' }, h('div', { class: 'card-h' }, h('h3', {}, '各樓層通話品質')),
        fl.length ? h('div', { class: 'table-wrap' }, h('table', { class: 't' }, h('thead', {}, h('tr', {}, ['樓層', '同時通話', 'MOS', '掉包'].map((x) => h('th', {}, x)))),
          h('tbody', {}, fl.map(([fid, x]) => h('tr', {}, h('td', { class: 'mono' }, fid), h('td', { class: 'mono small' }, `${Math.round(x.calls)} 通`),
            h('td', { class: 'mono small ' + (x.mos === null ? '' : x.mos < 3.6 ? 'bad-t' : x.mos < 4 ? 'warn-t' : 'ok-t') }, x.mos === null ? '—' : x.mos.toFixed(2)),
            h('td', { class: 'mono small' }, U.pct(x.loss || 0, 1))))))) : h('div', { class: 'empty' }, active ? '上班時間才有人打電話。' : '舊總機時期不顯示。'))));
  }
  V.TABS.push(['voice', '語音']);
  V.renderers.voice = voiceTab;

  /* ---------- 端點 ---------- */
  function epTab(el) {
    const s = G.S, e = s.ep, uem = G.Ep.uem(), R = G.R.ep || {};
    const active = G.Ep.active();
    const lk = lockNote(CAT.services.uem);
    if (lk) el.appendChild(lk);
    const days = G.Ep.days();
    const cache = Q.roleServers('upd').filter((d) => d.rack), cacheUp = G.Ep.cacheUp();
    const nextRel = (() => { let t = s.time; for (let i = 0; i < 8 * 1440; i += 60) { const x = Math.floor((t + i) / 60) * 60; if (G.Ep.isRelease(x) && x > s.time) return x; } return null; })();
    el.appendChild(h('div', { class: 'tiles', style: { marginBottom: '12px' } },
      tile('電腦', U.num(G.Ep.pcs()), '員工的桌機與筆電'),
      tile('修補合規率', uem ? U.pct(e.patch) : '不知道', uem ? (days !== null ? `本週更新發布 ${days < 1 ? Math.round(days * 24) + ' 小時' : days.toFixed(1) + ' 天'}前` : '最新') : '沒有端點管理平台，看不到每台電腦的狀態', uem ? (e.patch >= 0.95 ? 'ok-t' : e.patch >= 0.8 ? 'warn-t' : 'bad-t') : 'warn-t'),
      tile('派送方式', uem ? (e.rings ? '分批自動派送' : '同時全面派送') : '使用者自己更新', uem ? (e.paused ? '已暫停' : e.deployAt && e.deployAt > s.time ? `${U.stamp(e.deployAt)} 開始` : '端點管理平台派送') : '慢，而且不知道誰沒更新'),
      tile('更新下載', R.patchMbps > 1 ? U.bw(R.patchMbps) : '—', R.patchMbps > 1 ? (R.cacheOn ? '從內部更新快取' : '⚠ 從網際網路下載（佔用對外頻寬）') : cacheUp ? '有內部更新快取' : '沒有內部快取', R.patchMbps > 1 && !R.cacheOn ? 'warn-t' : ''),
      tile('下一次更新', nextRel ? U.stamp(nextRel) : '—', '每週三凌晨（微軟 Patch Tuesday 的台灣時間）')));
    if (!active) el.appendChild(h('div', { class: 'note info', style: { marginBottom: '10px' } }, '第八章起，每週的作業系統更新才會開始模擬。'));
    el.appendChild(h('div', { class: 'row wrap', style: { marginBottom: '10px' } },
      h('button', { class: 'btn ' + (uem ? 'danger' : 'primary'), 'data-hint': 'svc:uem', disabled: !Q.unlocked(CAT.services.uem) || null, onclick: () => UI.res(uem ? G.Act.unsubscribe('uem') : G.Act.subscribe('uem')) }, uem ? '停用端點管理平台' : `啟用端點管理平台（${U.money(Q.monthlyServiceCost('uem'))}/月）`),
      uem ? h('button', { class: 'btn', onclick: () => UI.res(G.Ep.deployNow()) }, '立即派送更新') : null,
      uem && !e.paused && e.patch < 0.999 ? h('button', { class: 'btn', onclick: () => UI.res(G.Ep.pause()) }, '暫停派送') : null,
      kbBtn('k-patch'), kbBtn('k-uem')));
    const opts = h('div', { class: 'card col', style: { gap: '10px' } },
      h('h3', {}, '派送設定'),
      h('label', { class: 'row small', 'data-hint': 'ep-rings' }, h('input', { type: 'checkbox', checked: e.rings, disabled: !uem || null, onchange: (ev) => UI.res(G.Ep.setRings(ev.target.checked)) }), '分批派送（rings）：先派給 5% 的試點電腦，4 小時沒問題才全面派送'),
      h('div', { class: 'tiny dim' }, '更新偶爾會出包（藍白當、印表機不能用）。分批派送讓問題只出現在試點電腦上，還來得及暫停。'),
      h('label', { class: 'row small', 'data-hint': 'ep-bitlocker' }, h('input', { type: 'checkbox', checked: e.bitlocker, disabled: !uem || null, onchange: (ev) => UI.res(G.Ep.setBitlocker(ev.target.checked)) }), 'BitLocker 全磁碟加密（由端點管理平台保管復原金鑰）'),
      h('div', { class: 'tiny dim' }, '筆電遺失時，沒有金鑰就讀不到資料；再搭配遠端抹除。'));
    const src = h('div', { class: 'card col', style: { gap: '8px' } },
      h('h3', {}, '更新從哪裡下載'),
      h('div', { class: 'small muted' }, `每台電腦每次更新約 1.3 GB。一萬台電腦各自從網際網路下載就是 13 TB：全面派送時會塞爆公司的對外頻寬。內部的更新快取（WSUS / Connected Cache）只從網際網路下載一次，電腦再從機房取得。`),
      cache.length ? cache.map((d) => h('div', { class: 'row between small' }, h('span', {}, h('b', {}, d.name), h('span', { class: 'muted' }, d.host ? '　VM' : '')), h('span', { class: 'chip ' + UI.devStatus(d).c }, UI.devStatus(d).t))) : h('div', { class: 'small dim' }, '還沒有更新快取伺服器（UPD 角色）。'),
      h('div', { class: 'row wrap' },
        Q.unlocked(CAT.devices.VM) && G.VM.hosts().length ? h('button', { class: 'btn sm', 'data-hint': 'vm-upd', onclick: () => UI.res(G.VM.create('upd')) }, '建立更新快取 VM') : null,
        h('button', { class: 'btn sm', onclick: () => UI.go('shop:srv') }, '實體伺服器（SV-1U）')));
    el.appendChild(h('div', { class: 'grid c2' }, opts, src));
  }
  V.TABS.push(['ep', '端點']);
  V.renderers.ep = epTab;

  V.renderers.vm = vmTab;
  V.renderers.stor = storTab;
  V.renderers.bkp = bkpTab;
})(window.G = window.G || {});
