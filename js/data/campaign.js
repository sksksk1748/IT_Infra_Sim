/* 劇情模式：五個章節、任務目標、進駐時程與劇本事件 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;

  /* ---------- 任務判定小工具 ---------- */
  const H = {
    installed: (cat, pred) => Q.devices(cat).some((d) => d.rack && (!pred || pred(d))),
    link: (pred) => Object.values(G.S.links).some(pred),
    kinds: (l) => [Q.nodeKind(l.a), Q.nodeKind(l.b)],
    fwLink: (otherPred, zone) => H.link((l) => {
      const [ka, kb] = H.kinds(l);
      if (ka !== 'firewall' && kb !== 'firewall') return false;
      if (ka === 'firewall' && kb === 'firewall') return false;
      const other = ka === 'firewall' ? l.b : l.a;
      return otherPred(other) && (!zone || l.zone === zone);
    }),
    isL3: (id) => { const d = G.S.devices[id]; return !!d && Q.isL3(d); },
    coverage: (fid) => {
      const up = G.Net.floorUp(fid);
      return G.Wifi.get(fid, G.Wifi.powered(fid, up)).good;
    },
    portsOk: (fid) => Q.floorPorts(fid) >= Q.floorPortNeed(fid).total,
    uplinkToSwitch: (fid) => Q.linksOf('F:' + fid).some((l) => Q.nodeKind(Q.other(l, 'F:' + fid)) === 'switch'),
    floorReady: (fid, cov) => {
      const fs = G.S.floors[fid];
      return fs.cabling.status === 'done' && fs.idf.count > 0 && H.portsOk(fid) && H.uplinkToSwitch(fid) && H.coverage(fid) >= (cov || 0.85);
    },
    sat: (fid) => (G.R.satEma ? G.R.satEma[fid] : null),
    present: (fid) => (G.R.sim && G.R.sim.floors[fid] ? G.R.sim.floors[fid].present : 0),
    serverLinked: (d) => Q.linksOf(d.id).some((l) => ['switch', 'firewall'].includes(Q.nodeKind(Q.other(l, d.id)))),
    roleUp: (role) => Q.roleServers(role).some((d) => d.rack && H.serverLinked(d)),
    workTime: () => !U.isWeekend(G.S.time) && U.hourOf(G.S.time) >= 9 && U.hourOf(G.S.time) < 18,
    dhcpOk: () => {
      const sim = G.R.sim;
      if (!sim) return false;
      const d = sim.dhcp;
      return d.wifi.pool >= d.wifi.need && d.wired.pool >= d.wired.worst && (!G.S.fw.guestWifi || d.guest.pool >= d.guest.need);
    },
    floorsDone: (ids, cov) => ids.filter((id) => H.floorReady(id, cov)).length,
    range: (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i + 'F'); return out; },
  };

  const C2F = H.range(3, 8), C4F = H.range(9, 21);

  const chapters = [
    {
      id: 'c1', title: '第一章｜B1 機房開張', grant: 12000000,
      story: [
        '2026 年秋天，新曜集團的一萬名員工即將遷入剛落成的 21 層總部「新曜大樓」。',
        '你是剛上任的基礎架構工程師。大樓裡只有水泥、電力，和一間空蕩蕩的 B1 機房。',
        '週一早上 9 點，資訊部與總務部的 527 位同仁就要搬進 2F。你有一個週末的時間，讓他們一坐下就能上網。',
      ],
      learn: ['機櫃與 U 數', '路由器 / 防火牆 / 交換器的角色', 'ISP 專線', 'DHCP / DNS', '樓層布線與 Wi-Fi', '防火牆規則'],
      moveIns: [{ floor: '2F', at: () => U.at(3, 9) }],
      kb: ['k-dhcpdns', 'k-cable', 'k-wifi', 'k-rules'],
      objectives: [
        { id: 'c1-rack', text: '在 B1 機房設置一座 42U 機櫃', hint: '到「機房」點「採購機櫃」。所有網路設備都要安裝在機櫃裡才能通電運作。', goto: 'rack', kb: 'k-rack',
          check: (s) => s.racks.length > 0 },
        { id: 'c1-isp', text: '向 ISP 申請企業專線（527 人建議 1 Gbps）', hint: '到「採購 → ISP 專線」申請。專線需要十幾個小時才會開通，要提早申請！', goto: 'shop:isp', kb: 'k-isp',
          check: (s) => s.isp.length > 0 },
        { id: 'c1-router', text: '採購路由器並安裝到機櫃', hint: '「採購 → 網路設備」買一台路由器（NR-1100 就夠用），再到「機房」把它安裝上架。', goto: 'shop:net', kb: 'k-router',
          check: () => H.installed('router') },
        { id: 'c1-fw', text: '採購防火牆並安裝到機櫃', hint: '防火牆要放在路由器與內網之間。SG-300 足以應付 2 Gbps 以內的流量。', goto: 'shop:net', kb: 'k-firewall',
          check: () => H.installed('firewall') },
        { id: 'c1-core', text: '採購 L3 核心交換器並安裝到機櫃', hint: '核心交換器是所有樓層與伺服器的匯集點。未來要接很多樓層，埠數要夠。', goto: 'shop:net', kb: 'k-switch',
          check: () => H.installed('switch', (d) => Q.isL3(d)) },
        { id: 'c1-wire', text: '在「拓撲」連線：路由器 ⇄ 防火牆（外部）⇄ 核心交換器（內部）', hint: '拓撲頁點「連線」，依序點兩台設備。接路由器的防火牆介面選「外部 OUTSIDE」，接核心的選「內部 INSIDE」。', goto: 'topo', kb: 'k-hier',
          check: () => H.fwLink((o) => Q.nodeKind(o) === 'router', 'outside') && H.fwLink((o) => H.isL3(o), 'inside') },
        { id: 'c1-isplink', text: 'ISP 專線開通並接上路由器', hint: '開通後，在拓撲點 ISP 節點選「接到路由器」。若只有一台路由器，會自動接上。', goto: 'topo', kb: 'k-nat',
          check: (s) => s.isp.some((c) => c.status === 'active' && c.router) },
        { id: 'c1-ad', text: '部署伺服器，角色設為 AD / DNS / DHCP，並接上核心交換器', hint: '買一台 SV-1U 上架，在機房點選它設定角色，再到拓撲把它連到核心交換器。', goto: 'rack', kb: 'k-dhcpdns',
          check: () => H.roleUp('ad') },
        { id: 'c1-cabling', text: '2F 完成水平布線工程', hint: '到「樓層」選 2F，發包水平布線。施工要 8～10 小時！', goto: 'floor:2F', kb: 'k-mdf',
          check: (s) => s.floors['2F'].cabling.status === 'done' },
        { id: 'c1-access', text: '2F IDF 的接入交換器埠數足夠（有線座位 + AP + 印表機）', hint: '樓層頁的「接入交換器」數量要讓埠數 ≥ 需求。48 埠的機型最划算。', goto: 'floor:2F', kb: 'k-poe',
          check: () => G.S.floors['2F'].idf.count > 0 && H.portsOk('2F') },
        { id: 'c1-uplink', text: '把 2F IDF 以主幹線連到核心交換器', hint: '在樓層頁點「新增上行」，或在拓撲連線 2F IDF ⇄ 核心。500 人的樓層至少要 10G 光纖。', goto: 'floor:2F', kb: 'k-cable',
          check: () => H.uplinkToSwitch('2F') },
        { id: 'c1-wifi', text: '2F 佈建 AP，良好訊號（≥ −67 dBm）覆蓋 ≥ 90%', hint: '在平面圖上點擊放置 AP。注意牆壁與核心筒會擋訊號；人多的地方要多放幾台分擔容量。', goto: 'floor:2F', kb: 'k-wifi',
          check: () => H.coverage('2F') >= 0.9 },
        { id: 'c1-rules', text: '防火牆新增規則：允許 LAN → INTERNET 的 WEB 與 DNS', hint: '防火牆預設全部拒絕。到「防火牆」新增允許規則。DNS 也可以改開 SERVERS → INTERNET（由 AD 轉送）。', goto: 'fw', kb: 'k-rules',
          check: () => G.Sec.allows('LAN', 'INTERNET', 'WEB') && (G.Sec.allows('LAN', 'INTERNET', 'DNS') || G.Sec.allows('SERVERS', 'INTERNET', 'DNS')) },
        { id: 'c1-live', text: '2F 員工進駐後，滿意度 ≥ 80% 累積 2 小時', hint: '第 3 天（週一）09:00 起員工陸續進駐。到「大樓」或「監控」觀察 2F 的滿意度。', goto: 'building', kb: 'k-bandwidth',
          sustain: 120, cond: () => H.present('2F') > 100 && H.sat('2F') >= 0.8 },
      ],
      outro: ['2F 的同事們順利上線，資訊長在走廊上對你點了點頭。', '不過這只是開始 —— 接下來一週，還有六個部門要搬進來。'],
    },
    {
      id: 'c2', title: '第二章｜大遷徙', grant: 22000000,
      story: [
        '3F 到 8F 的六個部門將在接下來三個工作天陸續進駐，總人數將超過 3,600 人。',
        '研發部要求共用的檔案伺服器；客服中心有上百支 IP 電話；行銷設計部天天傳大檔案。',
        '人一多，Wi-Fi 頻道、IP 位址、ISP 頻寬……所有你還沒想到的問題都會冒出來。',
      ],
      learn: ['檔案伺服器與內部流量', '網管監控 NMS', 'ISP 頻寬規劃', '頻道規劃與無線控制器', 'IP 子網路規劃', 'PoE 預算'],
      moveIns: [
        { floor: '3F', at: (t0) => U.nextWeekdayAt(t0, 9, 1) }, { floor: '4F', at: (t0) => U.nextWeekdayAt(t0, 9, 1) },
        { floor: '5F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1) }, { floor: '6F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1) },
        { floor: '7F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1), 9, 1) }, { floor: '8F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1), 9, 1) },
      ],
      events: [{ type: 'allhands', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 10, 1), 10, 1), 10, 1) + 60 }],
      kb: ['k-optics', 'k-poe', 'k-channel', 'k-wlc', 'k-ip', 'k-nms', 'k-oversub', 'k-lacp', 'k-vlan'],
      objectives: [
        { id: 'c2-file', text: '部署檔案伺服器（ST-4U，角色：檔案）並接上核心', hint: '內部流量大部分是存取共用資料夾。儲存伺服器有 25G 網卡，建議用 25G 或多條線路連接核心。', goto: 'shop:srv', kb: 'k-oversub',
          check: () => H.roleUp('file') },
        { id: 'c2-nms', text: '部署網管監控伺服器（角色：NMS）', hint: '沒有 NMS，監控中心只看得到 ISP 提供的總流量。部署後就能看到每條鏈路與異常流量。', goto: 'shop:srv', kb: 'k-nms',
          check: () => H.roleUp('nms') },
        { id: 'c2-wan', text: 'ISP 可用總頻寬 ≥ 5 Gbps', hint: '3,600 人尖峰上網約需 4～5 Gbps。申請 10G 專線，並確認路由器與防火牆的效能跟得上。', goto: 'shop:isp', kb: 'k-bandwidth',
          check: () => Q.ispBw(true) >= 5000 },
        { id: 'c2-floors', text: '3F～8F 全部完成佈建（布線、交換器、上行、Wi-Fi ≥ 85%）', hint: '做好一層後，可用「複製設計」一次套用到其他樓層。不同樓層類型的 AP 需求不同喔。', goto: 'building', kb: 'k-hier',
          check: () => H.floorsDone(C2F) === C2F.length, progress: () => `${H.floorsDone(C2F)}/${C2F.length}` },
        { id: 'c2-wlc', text: '部署無線控制器（WLC）統一管理 AP', hint: 'AP 一多，手動設定頻道很容易撞頻。WLC 會自動規劃頻道（RRM），也讓員工漫遊不斷線。', goto: 'shop:wifi', kb: 'k-wlc',
          check: () => H.installed('wlc', (d) => H.serverLinked(d)) },
        { id: 'c2-dhcp', text: 'IP 網段規劃：所有 DHCP 位址池都足夠', hint: '到「防火牆 → 網段規劃」檢查：員工 Wi-Fi 的裝置數會隨人數暴增，/22 很快就不夠了。', goto: 'fw:net', kb: 'k-ip',
          check: () => Q.employees() >= 3000 && H.dhcpOk() },
        { id: 'c2-sat', text: '全公司 3,000 人以上時，滿意度 ≥ 80% 累積 6 小時', hint: '用監控中心找出瓶頸：WAN、樓層上行、Wi-Fi 容量、防火牆效能都可能是問題。', goto: 'noc', kb: 'k-bandwidth',
          sustain: 360, cond: () => G.R.sim && G.R.sim.users > 1500 && Q.employees() >= 3000 && G.R.sim.sat >= 0.8 },
      ],
      outro: ['八個樓層、將近 3,700 人穩定上線。你開始在監控中心看見每天規律起伏的流量曲線。', '行銷部提醒你：官網與客戶入口即將上線，一樓大廳也要開放訪客了。'],
    },
    {
      id: 'c3', title: '第三章｜開門迎客', grant: 8000000,
      story: [
        '集團的全新官網與客戶入口明天上線，一樓大廳也將開放訪客與提供訪客 Wi-Fi。',
        '「對外服務」代表網際網路上的任何人都能連到你的伺服器 —— 包括駭客。',
        '你需要清楚劃分外網、DMZ 與內網，並讓防火牆只開放必要的服務。',
      ],
      learn: ['外網 / 內網 / DMZ', 'NAT 與對外服務', '訪客網路隔離', 'VLAN', 'IPS / WAF', '掃描、暴力破解、SQL Injection'],
      moveIns: [{ floor: '1F', at: (t0) => U.nextWeekdayAt(t0, 8, 1) }],
      flags: (t0) => ({ websiteAt: U.nextWeekdayAt(t0, 9, 1) }),
      events: [
        { type: 'scan', at: (t0) => U.nextWeekdayAt(t0, 14, 2) },
        { type: 'sqli', at: (t0) => U.nextWeekdayAt(t0, 20, 2) + 30 },
      ],
      kb: ['k-zones', 'k-nat', 'k-vlan', 'k-guest', 'k-ips', 'k-brute', 'k-sqli', 'k-ddos'],
      objectives: [
        { id: 'c3-lobby', text: '1F 大廳完成佈建（布線、交換器、上行、Wi-Fi ≥ 90%）', hint: '大廳人不多但訪客很多，AP 要照顧到大廳、咖啡廳與訪客會議室。', goto: 'floor:1F', kb: 'k-wifi',
          check: () => H.floorReady('1F', 0.9) },
        { id: 'c3-guest', text: '啟用訪客 Wi-Fi（獨立 SSID 與 VLAN）', hint: '到「防火牆 → 網段規劃」開啟訪客 Wi-Fi。', goto: 'fw:net', kb: 'k-vlan',
          check: (s) => s.fw.guestWifi },
        { id: 'c3-guestiso', text: '訪客隔離：GUEST → INTERNET 只開 WEB / DNS；GUEST 不能連到 LAN、SERVERS、DMZ', hint: '新增 GUEST → INTERNET 的允許規則；預設拒絕會擋掉其他流量，但也可以明確寫拒絕規則。', goto: 'fw', kb: 'k-guest',
          check: () => G.Sec.allows('GUEST', 'INTERNET', 'WEB') && G.Sec.allows('GUEST', 'INTERNET', 'DNS') && G.Sec.posture().guestIsolated },
        { id: 'c3-dmz', text: '官網伺服器（角色 WEB）放在 DMZ', hint: '買一台 DMZ 交換器（或直接）接到防火牆，介面區域選「DMZ」，再把官網伺服器接上去。', goto: 'topo', kb: 'k-zones',
          check: () => G.Sec.serverZones('web').some((x) => x.zone === 'DMZ') },
        { id: 'c3-db', text: '資料庫伺服器（角色 DB）放在內部伺服器區', hint: '資料庫接在核心交換器（內部），不要放 DMZ。它同時服務官網與內部 ERP。', goto: 'topo', kb: 'k-zones',
          check: () => G.Sec.serverZones('db').some((x) => x.zone === 'SERVERS') },
        { id: 'c3-rules', text: '防火牆：INTERNET → DMZ 開 WEB、DMZ → SERVERS 開 SQL，且沒有多開其他服務', hint: '最小權限原則：DMZ 對外只開 WEB；DMZ 到內部只開資料庫。', goto: 'fw', kb: 'k-rules',
          check: () => {
            const S = G.Sec;
            if (!S.allows('INTERNET', 'DMZ', 'WEB') || !S.allows('DMZ', 'SERVERS', 'SQL')) return false;
            const extraIn = S.allowedSvcs('INTERNET', 'DMZ').filter((x) => !['WEB', 'SMTP', 'ICMP'].includes(x));
            const extraDs = S.allowedSvcs('DMZ', 'SERVERS').filter((x) => !['SQL', 'DNS', 'NTP'].includes(x));
            return !extraIn.length && !extraDs.length && !S.allowedSvcs('DMZ', 'LAN').length && !S.allowedSvcs('INTERNET', 'LAN').length;
          } },
        { id: 'c3-audit', text: '資安健檢評分達到 B 以上', hint: '到「防火牆 → 資安健檢」逐項修正問題。', goto: 'fw:audit', kb: 'k-rules',
          check: () => G.Sec.gradeRank(G.Sec.audit().grade) >= 3 },
        { id: 'c3-web', text: '官網上線後，可用率 ≥ 98% 累積 12 小時', hint: '官網流量在晚上最高。WEB 伺服器、DB 伺服器、DMZ 規則、ISP 頻寬缺一不可。', goto: 'noc', kb: 'k-ddos',
          sustain: 720, cond: () => G.R.sim && G.R.sim.web.demand > 0 && G.R.sim.web.ratio >= 0.98 },
      ],
      outro: ['官網順利上線，大廳的訪客也能安心上網。', '但資安團隊發現，最近的掃描與攻擊嘗試越來越頻繁……而且，剩下的 13 層樓就要一口氣搬進來了。'],
    },
    {
      id: 'c4', title: '第四章｜萬人進駐', grant: 45000000,
      story: [
        '9F 到 21F 共 13 層樓、超過 6,000 人，將在五個工作天內全部進駐。',
        '到時候整個網路要撐起一萬人。任何一台設備、一條線路、一次停電，影響的都是成千上萬人。',
        '這一章的關鍵字只有一個：備援。',
      ],
      learn: ['大規模主幹：40G / 100G、單模光纖', '雙核心與雙上行', '防火牆 HA', '雙 ISP', 'UPS、發電機、N+1 冷卻'],
      moveIns: (() => {
        const groups = [['9F', '10F', '11F'], ['12F', '13F', '14F'], ['15F', '16F', '17F'], ['18F', '19F'], ['20F', '21F']];
        const out = [];
        groups.forEach((g, i) => g.forEach((fid) => out.push({ floor: fid, at: (t0) => { let t = t0; for (let k = 0; k <= i; k++) t = U.nextWeekdayAt(t, 9, 1); return t; } })));
        return out;
      })(),
      events: [
        { type: 'hw-fail', at: (t0) => U.nextWeekdayAt(t0, 11, 2), data: { coreFirst: true } },
        { type: 'power-out', at: (t0) => U.nextWeekdayAt(t0, 15, 3) },
        { type: 'isp-down', at: (t0) => U.nextWeekdayAt(t0, 10, 4) },
      ],
      kb: ['k-ha', 'k-power', 'k-cooling', 'k-lacp', 'k-segment'],
      objectives: [
        { id: 'c4-floors', text: '9F～21F 全部完成佈建（13 層）', hint: '17F 以上到 B1 超過 100m，銅纜到不了；100G 也要用單模光纖。善用「複製設計」。', goto: 'building', kb: 'k-cable',
          check: () => H.floorsDone(C4F) === C4F.length, progress: () => `${H.floorsDone(C4F)}/${C4F.length}` },
        { id: 'c4-isp2', text: '雙 ISP：兩家不同業者的線路同時運作', hint: '再申請一家業者的 10G 專線。單 WAN 路由器只能主備援，BGP 路由器才能同時使用兩條。', goto: 'shop:isp', kb: 'k-ha',
          check: (s) => new Set(s.isp.filter((c) => c.status === 'active' && c.router).map((c) => c.provider)).size >= 2 },
        { id: 'c4-core2', text: '核心備援：兩台 L3 核心交換器，且 80% 以上已進駐樓層雙上行到兩台核心', hint: '每層樓各拉一條上行到兩台不同的核心交換器，任一台核心故障都不會斷線。', goto: 'topo', kb: 'k-lacp',
          check: () => {
            const cores = Q.devices('switch').filter((d) => d.rack && Q.isL3(d));
            if (cores.length < 2) return false;
            const fl = G.BLD.floors.filter((f) => G.S.floors[f.id].movedIn > 0);
            const dual = fl.filter((f) => new Set(Q.linksOf('F:' + f.id).map((l) => Q.other(l, 'F:' + f.id)).filter((o) => H.isL3(o))).size >= 2);
            return fl.length > 0 && dual.length / fl.length >= 0.8;
          }, progress: () => {
            const fl = G.BLD.floors.filter((f) => G.S.floors[f.id].movedIn > 0);
            const dual = fl.filter((f) => new Set(Q.linksOf('F:' + f.id).map((l) => Q.other(l, 'F:' + f.id)).filter((o) => H.isL3(o))).size >= 2);
            return `${dual.length}/${fl.length}`;
          } },
        { id: 'c4-fwha', text: '防火牆 HA：兩台防火牆以 HA 同步線配對，並且都接好內外網', hint: '再買一台同型防火牆，兩台之間連一條 HA 線，並各自接到路由器與核心。', goto: 'topo', kb: 'k-ha',
          check: () => {
            const fws = Q.devices('firewall').filter((d) => d.rack);
            if (fws.length < 2) return false;
            const ha = H.link((l) => Q.nodeKind(l.a) === 'firewall' && Q.nodeKind(l.b) === 'firewall');
            const wired = fws.filter((f) => Q.linksOf(f.id).some((l) => l.zone === 'outside') && Q.linksOf(f.id).some((l) => l.zone === 'inside')).length;
            return ha && wired >= 2;
          } },
        { id: 'c4-power', text: '機房 UPS 容量 ≥ IT 負載，並設置發電機', hint: '模組化 UPS 撐住發電機啟動前的空窗；發電機撐長時間停電（也讓空調繼續運轉）。', goto: 'rack', kb: 'k-power',
          check: () => G.R.fac && G.R.fac.upsCap >= G.R.fac.itLoad && G.R.fac.itLoad > 0 && G.R.fac.gen },
        { id: 'c4-cool', text: '冷卻 N+1：任一台空調故障時，冷卻能力仍 ≥ 熱負載', hint: '萬人規模的機房熱負載很可觀。空調至少要多一台備援。', goto: 'rack', kb: 'k-cooling',
          check: () => G.R.fac && G.R.fac.heat > 0 && G.R.fac.coolN1 >= G.R.fac.heat },
        { id: 'c4-ad2', text: '至少兩台 AD / DNS / DHCP 伺服器', hint: '一萬人同時登入，一台 AD 撐不住，也是單點故障。', goto: 'rack', kb: 'k-dhcpdns',
          check: () => Q.roleServers('ad').filter((d) => d.rack && H.serverLinked(d)).length >= 2 },
        { id: 'c4-sat', text: '一萬人全部進駐後，全公司滿意度 ≥ 80% 累積 8 小時', hint: '萬人規模的 WAN 尖峰超過 10 Gbps；防火牆開 IPS 後的效能也要算進去。', goto: 'noc', kb: 'k-bandwidth',
          sustain: 480, cond: () => G.R.sim && Q.employees() >= 9990 && G.R.sim.users > 3000 && G.R.sim.sat >= 0.8 },
      ],
      outro: ['一萬名員工，21 層樓，全部上線。', '就在你準備鬆一口氣的時候，資安長把你叫進辦公室：「情資顯示，有一個勒索集團盯上我們了。」'],
    },
    {
      id: 'c5', title: '第五章｜資安風暴', grant: 15000000,
      story: [
        '威脅情資顯示，一個知名的勒索集團正在鎖定新曜集團。',
        '他們會從網路釣魚、DDoS、暴力破解、網站攻擊一路試到勒索軟體 —— 攻擊將在接下來三天內陸續發生。',
        '準備好你的縱深防禦，並在事件發生時做出正確的應變。',
      ],
      learn: ['縱深防禦', 'SIEM', 'EDR / MFA / 郵件安全 / NAC', '內部網段分割', '不可變備份', '事件應變流程'],
      moveIns: [],
      events: [
        { type: 'phish', at: (t0) => U.nextWeekdayAt(t0, 10, 1), data: { boost: 1.6, floor: '7F' } },
        { type: 'ddos', at: (t0) => U.nextWeekdayAt(t0, 19, 1), data: { scale: 1.3 } },
        { type: 'exfil', at: (t0) => U.nextWeekdayAt(t0, 2, 2) + 30 },
        { type: 'brute', at: (t0) => U.nextWeekdayAt(t0, 14, 2) },
        { type: 'sqli', at: (t0) => U.nextWeekdayAt(t0, 16, 2) },
        { type: 'ransomware', at: (t0) => U.nextWeekdayAt(t0, 10, 3) + 30, data: { floor: '12F' } },
      ],
      kb: ['k-phish', 'k-ransom', 'k-edr', 'k-siem', 'k-ir', 'k-segment'],
      objectives: [
        { id: 'c5-siem', text: '部署 SIEM 日誌分析伺服器（SV-2U，角色 SIEM）', hint: 'SIEM 會大幅提高攻擊被偵測到的機率與速度。', goto: 'shop:srv', kb: 'k-siem',
          check: () => H.roleUp('siem') },
        { id: 'c5-backup', text: '部署備份伺服器，並啟用不可變備份', hint: '儲存伺服器設為「備份」角色，再到「防火牆 → 資安服務」訂閱不可變備份。', goto: 'shop:srv', kb: 'k-ransom',
          check: () => H.roleUp('backup') && Q.hasService('immutable') },
        { id: 'c5-defense', text: '啟用至少 4 項防護：IPS、EDR、MFA、郵件安全、URL 過濾、NAC', hint: '到「防火牆 → 資安服務」。注意 IPS 會降低防火牆吞吐量，EDR 與 MFA 依人數計費。', goto: 'fw:svc', kb: 'k-edr',
          check: () => ['ips', 'edr', 'mfa', 'mailsec', 'url', 'nac'].filter((x) => Q.hasService(x)).length >= 4,
          progress: () => `${['ips', 'edr', 'mfa', 'mailsec', 'url', 'nac'].filter((x) => Q.hasService(x)).length}/4` },
        { id: 'c5-seg', text: '啟用內部分段，並補上 LAN → SERVERS 的必要規則（LDAP、DNS、SMB、SQL）', hint: '分段後員工到伺服器的流量要經過防火牆：規則沒開好，全公司都登不進網域！防火牆效能也要夠。', goto: 'fw:net', kb: 'k-segment',
          check: (s) => s.fw.segmentation && ['LDAP', 'DNS', 'SMB', 'SQL'].every((x) => G.Sec.allows('LAN', 'SERVERS', x)) },
        { id: 'c5-survive', text: '撐過三天的攻擊行動，並處理完所有資安事件', hint: '事件頁會列出正在發生的攻擊。先遏制、再根除、最後復原。', goto: 'inc', kb: 'k-ir',
          check: (s) => {
            const last = Math.max(...s.sched.filter((x) => x.chapter === 4).map((x) => x.at), 0);
            return last > 0 && s.time > last + 120 && !G.Ev.active().some((i) => G.INC[i.type].cat === 'sec');
          } },
        { id: 'c5-grade', text: '資安健檢評分 A', hint: '到「防火牆 → 資安健檢」逐項處理。', goto: 'fw:audit', kb: 'k-rules',
          check: () => G.Sec.audit().grade === 'A' },
        { id: 'c5-rating', text: '攻擊行動結束後，IT 部門評價 ≥ 70', hint: '穩定的服務與正確的事件處理都會提升評價。', goto: 'noc', kb: 'k-ir',
          check: (s) => !!s.obj['c5-survive'] && s.rating >= 70 },
      ],
      outro: ['攻擊行動結束了。你的網路撐了下來。', '從一間空蕩蕩的機房，到撐起一萬人的企業網路 —— 你做到了。'],
    },
  ];

  /* ---------- 劇情控制 ---------- */
  const Campaign = { chapters, H };
  G.Campaign = Campaign;

  Campaign.requiredRoles = () => {
    const ch = Q.chapterNum();
    return ch >= 3 ? ['ad', 'file', 'db'] : ch >= 2 ? ['ad', 'file'] : ['ad'];
  };
  Campaign.websiteLive = () => {
    const s = G.S;
    if (!s) return false;
    if (s.mode === 'sandbox') return s.time >= U.at(4, 9);
    return Q.chapterNum() >= 3 && s.flags.websiteAt !== undefined && s.time >= s.flags.websiteAt;
  };
  Campaign.current = () => (G.S.mode === 'campaign' ? chapters[G.S.chapter] : null);

  /** 開新遊戲 */
  Campaign.begin = (s) => {
    if (s.mode === 'sandbox') {
      s.money = 150000000;
      s.rating = 60;
      const plan = [['2F', '3F', '4F', '5F', '6F'], ['7F', '8F', '9F', '10F', '11F'], ['12F', '13F', '14F', '15F', '16F'], ['17F', '18F', '19F', '20F', '21F', '1F']];
      plan.forEach((g, i) => g.forEach((fid) => { s.floors[fid].moveInAt = U.at(3 + i, 9); }));
      for (const c of G.KB.cards) s.kb.unlocked[c.id] = s.time;
      Campaign.scheduleMoveIns(s);
      return;
    }
    Campaign.startChapter(s, 0);
  };

  Campaign.startChapter = (s, idx) => {
    const ch = chapters[idx];
    s.chapter = idx;
    s.chapterStart = s.time;
    s.money += ch.grant;
    G.Act && G.Act.log(`${ch.title}：集團撥款 ${U.money(ch.grant)}`, 'money');
    for (const mi of ch.moveIns) {
      const fs = s.floors[mi.floor];
      if (fs.movedIn === 0 && fs.moveInAt === null) fs.moveInAt = mi.at(s.time);
    }
    if (ch.flags) Object.assign(s.flags, ch.flags(s.time));
    for (const ev of ch.events || []) s.sched.push({ at: ev.at(s.time), type: ev.type, data: ev.data || {}, chapter: idx });
    for (const id of ch.kb || []) G.Ev && G.Ev.unlockKb(id);
    s.flags.introShown = false;
    G.bus.emit('chapter', { idx, kind: 'start' });
  };

  Campaign.scheduleMoveIns = () => {};

  /** 每分鐘：員工進駐進度 */
  Campaign.tickMoveIns = (s) => {
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id];
      if (fs.moveInAt === null || fs.movedIn >= f.staff || s.time < fs.moveInAt) continue;
      const before = fs.movedIn;
      fs.movedIn = Math.min(f.staff, Math.round(f.staff * (s.time - fs.moveInAt + 1) / 180));
      if (before === 0 && fs.movedIn > 0) {
        const ready = G.Net.floorUp(f.id);
        G.Act.log(`${f.id} ${f.dept} 開始進駐（${f.staff} 人）`, ready ? 'info' : 'warn');
        G.bus.emit('movein', { fid: f.id, ready });
        if (!ready && s.mode === 'campaign') s.rating = Math.max(0, s.rating - 3);
      }
    }
  };

  /** 每分鐘：檢查任務 */
  Campaign.check = (s) => {
    const ch = Campaign.current();
    if (!ch || s.won) return;
    let allDone = true;
    for (const o of ch.objectives) {
      if (s.obj[o.id]) continue;
      let done = false;
      try {
        if (o.sustain) {
          if (o.cond(s)) s.objT[o.id] = (s.objT[o.id] || 0) + 1;
          done = (s.objT[o.id] || 0) >= o.sustain;
        } else done = !!o.check(s);
      } catch (e) { console.error(e); done = false; }
      if (done) {
        s.obj[o.id] = s.time;
        s.rating = Math.min(100, s.rating + 1);
        G.Act.log(`✔ 任務完成：${o.text}`, 'good');
        G.bus.emit('objective', { o });
      } else allDone = false;
    }
    if (allDone && !s.flags['done-' + ch.id]) {
      s.flags['done-' + ch.id] = s.time;
      G.bus.emit('chapter', { idx: s.chapter, kind: 'done' });
    }
  };

  Campaign.nextChapter = (s) => {
    if (s.chapter + 1 < chapters.length) Campaign.startChapter(s, s.chapter + 1);
    else { s.won = true; G.bus.emit('chapter', { idx: s.chapter, kind: 'won' }); }
  };

  Campaign.objectiveProgress = (o) => {
    const s = G.S;
    if (s.obj[o.id]) return null;
    if (o.sustain) return `${U.dur(s.objT[o.id] || 0)} / ${U.dur(o.sustain)}`;
    if (o.progress) { try { return o.progress(); } catch (e) { return null; } }
    return null;
  };
})(window.G = window.G || {});
