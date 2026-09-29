/* 防火牆規則比對、必要連線檢查、資安健檢、資安姿態 */
(function (G) {
  'use strict';
  const U = G.U, Q = G.Q, CAT = G.CAT;

  G.ZONES = {
    ANY: { name: '任何區域', short: 'ANY' },
    INTERNET: { name: '網際網路', short: 'INTERNET' },
    LAN: { name: '員工內網', short: 'LAN' },
    GUEST: { name: '訪客網路', short: 'GUEST' },
    SERVERS: { name: '內部伺服器區', short: 'SERVERS' },
    DMZ: { name: 'DMZ 非軍事區', short: 'DMZ' },
    WAN: { name: '分支據點 / 雲端（專線、VPN、SD-WAN）', short: 'WAN' },
  };
  G.SVC = {
    ANY:  { name: '任何服務', port: '*' },
    WEB:  { name: 'WEB 網頁', port: 'TCP 80, 443' },
    DNS:  { name: 'DNS 名稱解析', port: 'UDP/TCP 53' },
    SMB:  { name: 'SMB 檔案分享', port: 'TCP 445' },
    LDAP: { name: 'AD 驗證 (LDAP/Kerberos)', port: 'TCP 88, 389, 636' },
    SQL:  { name: 'SQL 資料庫', port: 'TCP 1433, 3306' },
    RDP:  { name: 'RDP 遠端桌面', port: 'TCP 3389' },
    SSH:  { name: 'SSH 遠端管理', port: 'TCP 22' },
    SMTP: { name: 'SMTP 郵件', port: 'TCP 25, 587' },
    NTP:  { name: 'NTP 校時', port: 'UDP 123' },
    ICMP: { name: 'ICMP (ping)', port: '—' },
    SIP:  { name: 'SIP 語音', port: 'UDP 5060 / TLS 5061 + RTP' },
  };
  const CONCRETE = ['WEB', 'DNS', 'SMB', 'LDAP', 'SQL', 'RDP', 'SSH', 'SMTP', 'NTP', 'ICMP', 'SIP'];

  const Sec = {};
  G.Sec = Sec;

  /** 由上而下比對，回傳第一條符合的規則；null 代表落入預設拒絕 */
  Sec.match = (zs, zd, svc) => {
    for (const r of G.S.fw.rules) {
      if (!r.on) continue;
      if (r.src !== 'ANY' && r.src !== zs) continue;
      if (r.dst !== 'ANY' && r.dst !== zd) continue;
      if (r.svc !== 'ANY' && r.svc !== svc) continue;
      return r;
    }
    return null;
  };
  Sec.allows = (zs, zd, svc) => { const r = Sec.match(zs, zd, svc); return !!r && r.action === 'allow'; };
  Sec.allowedSvcs = (zs, zd) => CONCRETE.filter((svc) => Sec.allows(zs, zd, svc));
  Sec.hasFirewall = () => Q.devices('firewall').some((d) => d.rack);

  /** 規則 r 是否被前面的規則完全遮蔽（永遠不會命中） */
  Sec.shadowedBy = (r) => {
    const rules = G.S.fw.rules;
    const idx = rules.indexOf(r);
    for (let i = 0; i < idx; i++) {
      const p = rules[i];
      if (!p.on) continue;
      const cover = (a, b) => a === 'ANY' || a === b;
      if (cover(p.src, r.src) && cover(p.dst, r.dst) && cover(p.svc, r.svc)) return p;
    }
    return null;
  };

  /** 伺服器所在區域（給健檢與任務判定用） */
  Sec.serverZones = (role) => Q.roleServers(role).filter((d) => d.rack).map((d) => {
    const z = G.Net.zones().get(d.id);
    return { d, zone: z ? z.zone : 'ISOLATED' };
  });

  /** 業務必要連線 */
  Sec.requirements = () => {
    const s = G.S;
    const out = [];
    const fw = Sec.hasFirewall();
    const ok = (zs, zd, svc) => !fw || Sec.allows(zs, zd, svc);
    out.push({ id: 'lan-web', text: '員工上網', rule: 'LAN → INTERNET : WEB', need: true, ok: ok('LAN', 'INTERNET', 'WEB') });
    const lanDns = ok('LAN', 'INTERNET', 'DNS');
    const adDns = Q.roleServers('ad').some((d) => d.rack) && ok('SERVERS', 'INTERNET', 'DNS');
    out.push({ id: 'dns', text: 'DNS 名稱解析', rule: 'LAN → INTERNET : DNS　或　SERVERS → INTERNET : DNS（由 AD 轉送）', need: true, ok: lanDns || adDns });
    if (s.fw.guestWifi) out.push({ id: 'guest', text: '訪客上網', rule: 'GUEST → INTERNET : WEB、DNS', need: true, ok: ok('GUEST', 'INTERNET', 'WEB') && ok('GUEST', 'INTERNET', 'DNS') });
    if (G.Campaign.websiteLive() || Q.roleServers('web').length) {
      out.push({ id: 'web-in', text: '客戶連官網', rule: 'INTERNET → DMZ : WEB', need: true, ok: ok('INTERNET', 'DMZ', 'WEB') });
      out.push({ id: 'web-db', text: '官網查詢資料庫', rule: 'DMZ → SERVERS : SQL', need: true, ok: ok('DMZ', 'SERVERS', 'SQL') });
    }
    if (s.fw.segmentation) {
      for (const svc of ['LDAP', 'DNS', 'SMB', 'SQL']) out.push({ id: 'seg-' + svc, text: '內部分段：員工存取伺服器', rule: 'LAN → SERVERS : ' + svc, need: true, ok: ok('LAN', 'SERVERS', svc) });
    }
    /* 分支據點與雲端（WAN 區域）：ERP、檔案、AD；拉回總部上網；雲端官網查資料庫；雲端備份走專線 */
    const sitesOpen = G.Wan.openIds();
    if (sitesOpen.length) {
      out.push({ id: 'wan-erp', text: '據點連 ERP', rule: 'WAN → SERVERS : SQL', need: true, ok: ok('WAN', 'SERVERS', 'SQL') });
      out.push({ id: 'wan-smb', text: '據點開共用資料夾', rule: 'WAN → SERVERS : SMB', need: true, ok: ok('WAN', 'SERVERS', 'SMB') });
      out.push({ id: 'wan-ad', text: '據點登入網域', rule: 'WAN → SERVERS : LDAP、DNS', need: true, ok: ok('WAN', 'SERVERS', 'LDAP') && ok('WAN', 'SERVERS', 'DNS') });
      const backhaul = sitesOpen.some((id) => { const p = G.R.wanPlans && G.R.wanPlans[id]; return p && p.inet && p.inet !== 'dia'; });
      if (backhaul) out.push({ id: 'wan-inet', text: '據點經總部上網（backhaul）', rule: 'WAN → INTERNET : WEB', need: true, ok: ok('WAN', 'INTERNET', 'WEB') });
    }
    if (Q.hasService('cloudweb') && G.Campaign.websiteLive()) out.push({ id: 'cloud-db', text: '雲端官網查會員資料庫', rule: 'WAN → SERVERS : SQL', need: true, ok: ok('WAN', 'SERVERS', 'SQL') });
    if (Q.hasService('cloudbk')) out.push({ id: 'cloud-bk', text: '備份複製到雲端', rule: s.wan && s.wan.dx.bw ? 'SERVERS → WAN : WEB（雲端專線）' : 'SERVERS → INTERNET : WEB', need: true, ok: s.wan && s.wan.dx.bw ? ok('SERVERS', 'WAN', 'WEB') : ok('SERVERS', 'INTERNET', 'WEB') });
    /* 更新快取：電腦從機房的更新伺服器下載；快取自己要能連到微軟 */
    if (G.Ep.active() && Q.roleServers('upd').some((d) => d.rack)) {
      if (s.fw.segmentation) out.push({ id: 'seg-upd', text: '內部分段：電腦從更新快取下載', rule: 'LAN → SERVERS : WEB', need: true, ok: ok('LAN', 'SERVERS', 'WEB') });
      out.push({ id: 'upd-inet', text: '更新快取向微軟下載更新', rule: 'SERVERS → INTERNET : WEB', need: true, ok: ok('SERVERS', 'INTERNET', 'WEB') });
    }
    /* 電話：分機註冊到 PBX、外線經 SBC（DMZ）對接電信業者 */
    if (G.Voice.active() && Q.roleServers('pbx').some((d) => d.rack)) {
      if (s.fw.segmentation) out.push({ id: 'seg-SIP', text: '內部分段：分機連到電話交換機', rule: 'LAN → SERVERS : SIP', need: true, ok: ok('LAN', 'SERVERS', 'SIP') });
      if (G.Wan.openIds().length) out.push({ id: 'wan-SIP', text: '據點的分機註冊到總部的電話交換機', rule: 'WAN → SERVERS : SIP', need: true, ok: ok('WAN', 'SERVERS', 'SIP') });
      if (s.voice.trunk > 0) {
        const sbc = Sec.serverZones('sbc').some((x) => x.zone === 'DMZ');
        if (sbc) {
          out.push({ id: 'sip-in', text: '電信業者 SIP 中繼 → SBC', rule: 'INTERNET → DMZ : SIP', need: true, ok: ok('INTERNET', 'DMZ', 'SIP') });
          out.push({ id: 'sip-pbx', text: 'SBC → 電話交換機', rule: 'DMZ → SERVERS : SIP', need: true, ok: ok('DMZ', 'SERVERS', 'SIP') });
        } else out.push({ id: 'sip-direct', text: '電信業者 SIP 中繼 → 電話交換機（沒有 SBC，有盜打風險）', rule: 'INTERNET → SERVERS : SIP', need: true, ok: ok('INTERNET', 'SERVERS', 'SIP') });
      }
    }
    return out;
  };

  /** 資安健檢 */
  Sec.audit = () => {
    const s = G.S;
    const ch = Q.chapterNum();
    const F = [];
    const add = (sev, title, detail, fix, kb) => F.push({ sev, title, detail, fix, kb });
    const fw = Sec.hasFirewall();
    const zones = G.Net.zones();
    const anyFloorLinked = G.BLD.floors.some((f) => { const z = zones.get('F:' + f.id); return z && z.linked; });

    if (!fw && (anyFloorLinked || Q.devices('server').some((d) => d.rack))) {
      add('crit', '沒有防火牆', '內網直接透過路由器連上網際網路，任何人都能嘗試連入你的設備。', '採購防火牆，放在路由器與核心交換器之間。', 'k-firewall');
    }
    const byZone = {};
    for (const [id, z] of zones) (byZone[z.zone] = byZone[z.zone] || []).push(id);
    if (byZone.BYPASS) add('crit', '有繞過防火牆的連線', `${byZone.BYPASS.map(Q.nodeName).join('、')} 可以不經防火牆直接到達路由器。`, '移除核心 / DMZ 交換器與路由器之間的直連線路，所有對外流量都必須經過防火牆。', 'k-zones');
    if (byZone.BRIDGED) add('high', 'DMZ 與內網直接相連', `${byZone.BRIDGED.map(Q.nodeName).join('、')} 同時連到防火牆的 DMZ 與內部介面，DMZ 隔離失效。`, '拆除 DMZ 交換器與內部交換器之間的線路。', 'k-zones');
    if (fw && byZone.EXPOSED) {
      const srv = byZone.EXPOSED.filter((id) => !id.startsWith('F:'));
      if (srv.length) add('high', '伺服器位於防火牆外側', `${srv.map(Q.nodeName).join('、')} 直接暴露在網際網路上，沒有任何過濾。`, '把伺服器接到防火牆的 DMZ 介面或內部交換器。', 'k-zones');
    }
    if (fw) {
      for (const r of s.fw.rules) {
        if (r.on && r.action === 'allow' && r.src === 'ANY' && r.dst === 'ANY' && r.svc === 'ANY') {
          add('crit', `規則 #${s.fw.rules.indexOf(r) + 1}：ANY → ANY 全部允許`, '這條規則讓防火牆形同虛設。', '刪除這條規則，改寫成明確的來源、目的與服務。', 'k-rules');
        }
      }
      const inLan = Sec.allowedSvcs('INTERNET', 'LAN');
      if (inLan.length) add('crit', '網際網路可以直接連入員工內網', `允許 INTERNET → LAN：${inLan.join('、')}`, '刪除所有 INTERNET → LAN 的允許規則。', 'k-zones');
      const inSrv = Sec.allowedSvcs('INTERNET', 'SERVERS');
      const danger = inSrv.filter((x) => ['RDP', 'SSH', 'SMB', 'SQL', 'LDAP'].includes(x));
      if (danger.length) add('crit', '內部伺服器的管理 / 資料服務對外開放', `允許 INTERNET → SERVERS：${danger.join('、')}`, '刪除這些規則；遠端管理改用 VPN + MFA。', 'k-brute');
      if (inSrv.includes('SIP')) add('high', '電話交換機直接對網際網路開放 SIP', '允許 INTERNET → SERVERS：SIP。PBX 暴露在外，會被掃描、暴力破解分機密碼，拿去盜打國際電話。', '在 DMZ 放一台 SBC 對接電信業者，改開 INTERNET → DMZ：SIP 與 DMZ → SERVERS：SIP。', 'k-pbx');
      if (inSrv.includes('WEB')) add('med', '對外網站放在內部伺服器區', '允許 INTERNET → SERVERS：WEB。網站被攻破時，攻擊者就直接在內網裡。', '把官網伺服器移到 DMZ，改開 INTERNET → DMZ：WEB。', 'k-zones');
      /* DMZ 裡有 SBC 時，SIP 是必要的服務（電信業者 → SBC → 電話交換機） */
      const sbcDmz = Sec.serverZones('sbc').some((x) => x.zone === 'DMZ');
      const inDmz = Sec.allowedSvcs('INTERNET', 'DMZ').filter((x) => !['WEB', 'SMTP', 'ICMP'].concat(sbcDmz ? ['SIP'] : []).includes(x));
      if (inDmz.length) add('high', 'DMZ 開放了不必要的服務', `允許 INTERNET → DMZ：${inDmz.join('、')}`, 'DMZ 對外只開放 WEB（必要時 SMTP）。', 'k-rules');
      if (s.fw.guestWifi || ch >= 3) {
        const gl = [];
        for (const z of ['LAN', 'SERVERS', 'DMZ']) { const a = Sec.allowedSvcs('GUEST', z); if (a.length) gl.push(`${z}（${a.join('、')}）`); }
        if (gl.length) add('high', '訪客網路可以存取內部', `允許 GUEST → ${gl.join('；')}`, '新增規則拒絕 GUEST → LAN / SERVERS / DMZ，並放在允許規則之前。', 'k-guest');
      }
      const dl = Sec.allowedSvcs('DMZ', 'LAN');
      if (dl.length) add('high', 'DMZ 可以主動連入員工內網', `允許 DMZ → LAN：${dl.join('、')}`, '刪除 DMZ → LAN 的允許規則。', 'k-zones');
      const ds = Sec.allowedSvcs('DMZ', 'SERVERS').filter((x) => !['SQL', 'DNS', 'NTP', 'LDAP'].concat(sbcDmz ? ['SIP'] : []).includes(x));
      if (ds.length) add('med', 'DMZ 到伺服器區開太多', `允許 DMZ → SERVERS：${ds.join('、')}（通常只需要 SQL）`, '只保留 DMZ → SERVERS：SQL。', 'k-rules');
      const anyOut = s.fw.rules.find((r) => r.on && r.action === 'allow' && r.src === 'LAN' && r.dst === 'INTERNET' && r.svc === 'ANY');
      if (anyOut && ch >= 3) add('low', '員工上網規則過於寬鬆', 'LAN → INTERNET 允許 ANY：惡意程式可以用任何協定連出去。', '改成只允許 WEB 與 DNS 等必要服務。', 'k-rules');
      const srvAny = s.fw.rules.find((r) => r.on && r.action === 'allow' && r.src === 'SERVERS' && r.dst === 'INTERNET' && r.svc === 'ANY');
      if (srvAny) add('med', '伺服器可任意連出網際網路', 'SERVERS → INTERNET 允許 ANY，資料外洩時難以阻擋。', '只允許 DNS、WEB（更新）等必要服務。', 'k-rules');
      for (const r of s.fw.rules) {
        const sh = Sec.shadowedBy(r);
        if (sh) add('info', `規則 #${s.fw.rules.indexOf(r) + 1} 永遠不會生效`, `被上方的規則 #${s.fw.rules.indexOf(sh) + 1} 完全涵蓋。`, '調整規則順序：較明確的規則放上面。', 'k-rules');
      }
    }
    for (const { d, zone } of Sec.serverZones('web')) {
      if (zone === 'SERVERS' || zone === 'LAN' || zone === 'BRIDGED') add('high', `${d.name} 官網不在 DMZ`, '對外服務的伺服器與內部資料放在同一區，一旦被入侵影響範圍極大。', '把官網伺服器接到防火牆的 DMZ 介面。', 'k-zones');
    }
    for (const { d, zone } of Sec.serverZones('db')) {
      if (zone === 'DMZ') add('med', `${d.name} 資料庫放在 DMZ`, '資料庫存放最敏感的資料，不應放在對外區域。', '把資料庫移到內部伺服器區，只開放 DMZ → SERVERS：SQL。', 'k-zones');
    }
    if (ch >= 3 && fw && !Q.hasService('ips')) add('low', '沒有啟用 IPS', '防火牆只看埠號，無法辨識夾帶在允許流量中的攻擊。', '訂閱 IPS 入侵防禦（注意吞吐量下降）。', 'k-ips');
    if (ch >= 5 && !s.fw.segmentation) add('med', '內網沒有分段', '員工電腦可以直接存取所有伺服器，勒索軟體可以任意擴散。', '在防火牆頁面啟用「內部分段」，並補上 LAN → SERVERS 的必要規則。', 'k-segment');
    if (ch >= 5 && !Q.roleServers('backup').some((d) => d.rack)) add('med', '沒有備份伺服器', '遭勒索軟體加密時將無法復原。', '部署儲存伺服器並設為備份角色，並啟用不可變備份。', 'k-ransom');
    /* 第七章起：據點與雲端 */
    if (ch >= 7 && fw) {
      const wAny = s.fw.rules.find((r) => r.on && r.action === 'allow' && r.src === 'WAN' && (r.dst === 'ANY' || r.svc === 'ANY'));
      if (wAny) add('high', '據點 / 雲端可以任意連進總部', `規則 #${s.fw.rules.indexOf(wAny) + 1}：WAN → ${wAny.dst} ${wAny.svc}。據點的電腦中毒，就能直接打進總部。`, '只開放必要的服務：WAN → SERVERS 的 SQL、SMB、LDAP、DNS。', 'k-sdwan');
      const wl = Sec.allowedSvcs('WAN', 'LAN');
      if (wl.length) add('med', '據點可以直接連到總部員工電腦', `允許 WAN → LAN：${wl.join('、')}`, '據點只需要連伺服器，不需要連員工電腦。', 'k-segment');
    }
    if (ch >= 7) {
      const single = G.Wan.openIds().filter((id) => s.wan.sites[id].links.filter((l) => l.status === 'active').length < 2);
      if (single.length) add('low', `${single.length} 個據點只有一條線路`, `${single.map((id) => G.SITES[id].name).join('、')}：線路一斷，整個據點就連不回總部。`, '加一條不同業者的寬頻（或 4G/5G），搭配 VPN 或 SD-WAN 當備援。', 'k-sdwan');
      const cloudUse = ['m365', 'cloudweb', 'cloudbk'].some((x) => Q.hasService(x));
      if (Q.hasService('m365') && !Q.hasService('mfa')) add('high', '雲端服務沒有 MFA', 'Microsoft 365 從世界各地都登得進去：密碼一外洩，郵件與檔案就全部曝光。', '啟用 MFA 多因素驗證。', 'k-cloud');
      if (cloudUse && !Q.hasService('cspm')) add('low', '沒有持續檢查雲端設定', '公開的儲存桶、外洩的存取金鑰，是雲端最常見的資料外洩原因。', '啟用雲端資安態勢管理（CSPM）。', 'k-cloud');
    }
    /* 第八章起：端點修補與弱點管理 */
    if (ch >= 8) {
      if (!G.Ep.uem()) add('med', '沒有端點管理平台', '不知道一萬台電腦的修補狀況，也沒辦法集中派送更新、強制加密、遠端抹除遺失的筆電。', '訂閱端點管理平台（UEM），在「系統 → 端點」管理。', 'k-uem');
      else if (s.ep.patch < 0.85 && (G.Ep.days() || 0) > 3) add('med', `電腦修補率只有 ${U.pct(s.ep.patch)}`, '更新發布三天後還有很多電腦沒更新：攻擊者最愛利用已知漏洞。', '在「系統 → 端點」立即派送更新（記得分批）。', 'k-patch');
      if (G.Ep.uem() && !s.ep.bitlocker) add('low', '筆電沒有強制加密', '筆電遺失時，別人拆下硬碟就能讀到資料。', '在「系統 → 端點」開啟 BitLocker。', 'k-uem');
      if (!Q.roleServers('vscan').some((d) => d.rack)) add('med', '沒有弱點掃描', '不知道伺服器與網路設備有哪些沒修補的已知漏洞（CVE）。', '部署弱點掃描（VS 角色的伺服器或 VM），在「防火牆 → 弱點管理」追蹤修補。', 'k-vuln');
      const overdue = G.Vuln.known().filter((x) => x.sev === 'crit' && G.Vuln.overdue(x));
      if (overdue.length) add('high', `${overdue.length} 個嚴重弱點超過 7 天沒有修補`, `${Array.from(new Set(overdue.map((x) => s.devices[x.dev].name))).join('、')}`, '到「防火牆 → 弱點管理」排入維護窗口修補。', 'k-vuln');
      const ex = G.Vuln.exposedCrit().filter((x) => x.known);
      if (ex.length) add('crit', '對外設備有已知的嚴重弱點', `${Array.from(new Set(ex.map((x) => s.devices[x.dev].name))).join('、')}：攻擊者隨時可能利用。`, '立即修補；來不及的話先關閉受影響的功能，或用 IPS 虛擬修補。', 'k-vuln');
    }
    /* 第八章起：備份、儲存與虛擬化的健檢 */
    if (ch >= 8) {
      const r321 = G.Stor.rule321();
      if (G.Stor.bkpServers().length && !r321.ok) add('med', '備份不符合 3-2-1', '備份都放在同一個地方、同一種媒體：總部火災或勒索軟體一來，可能全部一起沒了。', '加上磁帶（並啟用異地保管）或雲端備份，讓一份備份離開總部。', 'k-backup');
      if (G.Stor.bkpServers().length && !r321.drill) add('low', '最近 7 天沒有做還原演練', '沒驗證過的備份，出事時可能根本還原不了。', '到「系統 → 備份」進行還原演練。', 'k-backup');
      const local = G.VM.vms().filter((v) => v.disk !== 'san').length;
      if (local) add('low', `${local} 台 VM 的硬碟放在主機本機`, '主機故障時，這些 VM 不能 HA、也不能線上遷移。', '在 VM 詳情把硬碟搬到 SAN。', 'k-vm');
      if (G.R.stor && G.R.stor.worst >= 0.9) add('med', '儲存空間超過 90%', '再成長一點就會滿：檔案存不了、SAN 上的 VM 會被迫暫停。', '擴充容量或把舊資料封存到磁帶 / 雲端。', 'k-san');
    }

    /* 第八章起（ISO 27001 稽核）：機房的實體安全 */
    if (ch >= 8 && s.racks.length) {
      const lv = G.Acc.level();
      if (lv === 0) add('high', '機房沒有門禁系統', '只有一把鑰匙：誰拿到鑰匙都能進出，也沒有任何進出紀錄。', '到「採購 → 機房設施」安裝感應卡門禁（或雙因子 + 防尾隨雙門），再到「機房 → 機房門禁」設定權限。', 'k-access');
      else {
        const over = G.Acc.overPriv();
        if (over.length) add('med', '機房常駐權限太多', `${over.map((x) => x.name).join('、')} 可以自己進出機房。`, '最小權限：清潔人員與廠商改成「需 IT 陪同」，主管不需要機房權限。', 'k-access');
        if (lv < 2) add('low', '機房沒有防尾隨', '一張卡刷開門，後面可以跟好幾個人進去。', '升級雙因子門禁 + 防尾隨雙門（mantrap）。', 'k-access');
        if (G.Acc.reviewDue()) add('low', '門禁權限超過 90 天沒有盤點', '離職、調職人員的卡片可能還能刷進機房。', '到「機房 → 機房門禁」做一次權限盤點。', 'k-access');
      }
    }

    const W = { crit: 30, high: 15, med: 7, low: 3, info: 0 };
    const score = U.clamp(100 - U.sum(F, (f) => W[f.sev]), 0, 100);
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    const order = { crit: 0, high: 1, med: 2, low: 3, info: 4 };
    F.sort((a, b) => order[a.sev] - order[b.sev]);
    return { findings: F, score, grade };
  };
  Sec.gradeRank = (g) => ({ A: 4, B: 3, C: 2, D: 1, F: 0 }[g] || 0);

  /** 資安姿態：事件引擎用來判斷攻擊成功率 */
  Sec.posture = () => {
    const s = G.S;
    const fw = Sec.hasFirewall();
    const up = (role) => Q.roleServers(role).some((d) => G.Net.devUp(d));
    const mgmt = [];
    for (const z of ['LAN', 'SERVERS', 'DMZ']) for (const svc of ['RDP', 'SSH']) if (!fw || Sec.allows('INTERNET', z, svc)) mgmt.push(`${z}:${svc}`);
    const guestLeak = fw ? ['LAN', 'SERVERS', 'DMZ'].some((z) => Sec.allowedSvcs('GUEST', z).length > 0) : true;
    const webZones = Sec.serverZones('web').map((x) => x.zone);
    return {
      fw, mgmtExposed: mgmt.length > 0, mgmt,
      lanExposed: !fw || Sec.allowedSvcs('INTERNET', 'LAN').length > 0,
      guestIsolated: !guestLeak,
      webInDmz: webZones.length > 0 && webZones.every((z) => z === 'DMZ'),
      segmentation: !!(s.fw.segmentation && fw),
      smbToServers: !s.fw.segmentation || Sec.allows('LAN', 'SERVERS', 'SMB'),
      srvEgress: !fw || Sec.allowedSvcs('SERVERS', 'INTERNET').length > 0,
      ips: fw && Q.hasService('ips'), gav: fw && Q.hasService('gav'), url: fw && Q.hasService('url'), geo: fw && Q.hasService('geo'),
      ddos: Q.hasService('ddos'), waf: Q.hasService('waf'), mfa: Q.hasService('mfa'), edr: Q.hasService('edr'),
      mailsec: Q.hasService('mailsec'), nac: Q.hasService('nac'), immutable: Q.hasService('immutable'),
      training: s.trainingUntil > s.time,
      siem: up('siem'), nms: up('nms'), backup: up('backup'),
      wlc: Q.devices('wlc').some((d) => G.Net.devUp(d)),
      uem: G.Ep.uem(), bitlocker: !!(s.ep && s.ep.bitlocker), vscan: up('vscan'), sbc: up('sbc'), cspm: Q.hasService('cspm'),
    };
  };
})(window.G = window.G || {});
