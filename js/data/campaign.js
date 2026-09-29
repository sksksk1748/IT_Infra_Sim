/* 劇情模式：九個章節、任務目標、進駐時程、據點開幕與劇本事件 */
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
    serverLinked: (d) => (d.host ? !!G.S.devices[d.host] && H.serverLinked(G.S.devices[d.host]) : Q.linksOf(d.id).some((l) => ['switch', 'firewall'].includes(Q.nodeKind(Q.other(l, d.id))))),
    roleUp: (role) => Q.roleServers(role).some((d) => d.rack && H.serverLinked(d)),
    workTime: () => !U.isWeekend(G.S.time) && U.hourOf(G.S.time) >= 9 && U.hourOf(G.S.time) < 18,
    dhcpOk: () => {
      const sim = G.R.sim;
      if (!sim) return false;
      const d = sim.dhcp;
      return d.wifi.pool >= d.wifi.need && d.wired.pool >= d.wired.worst && (!G.S.fw.guestWifi || d.guest.pool >= d.guest.need);
    },
    floorsDone: (ids, cov) => ids.filter((id) => H.floorReady(id, cov)).length,
    /** 已上架的 8-GPU 訓練伺服器 */
    gpus: () => Q.devices('server').filter((d) => d.rack && CAT.devices[d.model].gpu >= 8),
    /** 這台伺服器有 400G 連到 AI 交換器 */
    aiLink: (d) => Q.linksOf(d.id).some((l) => { const o = G.S.devices[Q.other(l, d.id)]; return l.speed >= 400000 && !!o && CAT.devices[o.model].ai && CAT.devices[o.model].cat === 'switch'; }),
    range: (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i + 'F'); return out; },
    /** 已進駐樓層都裝了智慧廁所，而且感測器連得到 IoT 平台 */
    iotAll: () => { const fl = G.Rest.occupied(); return fl.length > 0 && fl.every((f) => G.Rest.iotOk(f.id)); },
  };

  const C2F = H.range(3, 8), C4F = H.range(9, 21);

  const chapters = [
    {
      id: 'c1', title: '第一章｜B1 機房開張', grant: 12000000,
      story: [
        '2026 年秋天，新曜集團的一萬名員工即將遷入剛落成的 23 層總部「新曜大樓」（頂樓兩層是員工餐廳）。',
        '你是剛上任的基礎架構工程師。大樓裡只有水泥、電力，和一間空蕩蕩的 B1 機房。',
        '週一早上 9 點，資訊部與總務部的 527 位同仁就要搬進 2F。你有一個週末的時間，讓他們一坐下就能上網。',
      ],
      learn: ['機櫃與 U 數', '路由器 / 防火牆 / 交換器的角色', 'ISP 專線', 'DHCP / DNS', '樓層布線與 Wi-Fi', '防火牆規則'],
      moveIns: [{ floor: '2F', at: () => U.at(3, 9) }],
      kb: ['k-dhcpdns', 'k-cable', 'k-wifi', 'k-rules', 'k-diy'],
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
        { id: 'c1-cabling', text: '2F 完成水平布線（發包施工或自己布線都可以）', hint: '到「樓層」選 2F：「發包施工」最省事，但要等 8～10 小時；想親手體驗就選「自己布線」——在平面圖上畫出走線路徑、依 T568B 色序打線，再用測試儀驗證。', goto: 'floor:2F', kb: 'k-mdf',
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
        'B2 員工停車場也要啟用了：地下室收不到 GPS 和手機訊號，開車、騎車來的同事一停好車就要用 App 打卡。',
        '總務部也提醒你：人一多，廁所髒得快、衛生紙用得快——清潔排班跟網路一樣，都是讓大家好好上班的基礎設施。',
        '人一多，Wi-Fi 頻道、IP 位址、ISP 頻寬……所有你還沒想到的問題都會冒出來。',
      ],
      learn: ['檔案伺服器與內部流量', '網管監控 NMS', 'ISP 頻寬規劃', '頻道規劃與無線控制器', 'IP 子網路規劃', 'PoE 預算', '地下停車場的 Wi-Fi 與手機打卡', '廁所與清潔排班'],
      moveIns: [
        /* B2 員工停車場：第一批同事上班那天一早啟用（開車、騎車來的人一進停車場就要打卡） */
        { floor: 'B2', at: (t0) => U.nextWeekdayAt(t0, 7, 1) },
        { floor: '3F', at: (t0) => U.nextWeekdayAt(t0, 9, 1) }, { floor: '4F', at: (t0) => U.nextWeekdayAt(t0, 9, 1) },
        { floor: '5F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1) }, { floor: '6F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1) },
        { floor: '7F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1), 9, 1) }, { floor: '8F', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 9, 1), 9, 1), 9, 1) },
      ],
      events: [{ type: 'allhands', at: (t0) => U.nextWeekdayAt(U.nextWeekdayAt(U.nextWeekdayAt(t0, 10, 1), 10, 1), 10, 1) + 60 }],
      kb: ['k-optics', 'k-poe', 'k-channel', 'k-wlc', 'k-ip', 'k-nms', 'k-oversub', 'k-lacp', 'k-vlan', 'k-parking', 'k-iot'],
      objectives: [
        { id: 'c2-file', text: '部署檔案伺服器（ST-4U，角色：檔案）並接上核心', hint: '內部流量大部分是存取共用資料夾。儲存伺服器有 25G 網卡，建議用 25G 或多條線路連接核心。', goto: 'shop:srv', kb: 'k-oversub',
          check: () => H.roleUp('file') },
        { id: 'c2-nms', text: '部署網管監控伺服器（角色：NMS）', hint: '沒有 NMS，監控中心只看得到 ISP 提供的總流量。部署後就能看到每條鏈路與異常流量。', goto: 'shop:srv', kb: 'k-nms',
          check: () => H.roleUp('nms') },
        { id: 'c2-wan', text: 'ISP 可用總頻寬 ≥ 5 Gbps', hint: '3,600 人尖峰上網約需 4～5 Gbps。申請 10G 專線，並確認路由器與防火牆的效能跟得上。', goto: 'shop:isp', kb: 'k-bandwidth',
          check: () => Q.ispBw(true) >= 5000 },
        { id: 'c2-floors', text: '3F～8F 全部完成佈建（布線、交換器、上行、Wi-Fi ≥ 85%）', hint: '做好一層後，可用「複製設計」一次套用到其他樓層。不同樓層類型的 AP 需求不同喔。', goto: 'building', kb: 'k-hier',
          check: () => H.floorsDone(C2F) === C2F.length, progress: () => `${H.floorsDone(C2F)}/${C2F.length}` },
        { id: 'c2-park', text: 'B2 員工停車場：手機打卡的 Wi-Fi 覆蓋 ≥ 90%，柵欄機與監視器都連上網路', hint: '地下室收不到 GPS 與手機訊號，打卡 App 要靠公司 Wi-Fi 確認你人在公司。B2 一樣要布線、接入交換器（柵欄機與 24 台 PoE 監視器也要埠）、上行，再用 AP 蓋滿停車格、走道與電梯廳。混凝土柱會擋訊號！', goto: 'floor:B2', kb: 'k-parking',
          check: () => { const st = G.R.sim && G.R.sim.floors.B2; return H.floorReady('B2', 0.9) && !!st && st.gateOk && st.camOk >= 1; } },
        { id: 'c2-wlc', text: '部署無線控制器（WLC）統一管理 AP', hint: 'AP 一多，手動設定頻道很容易撞頻。WLC 會自動規劃頻道（RRM），也讓員工漫遊不斷線。', goto: 'shop:wifi', kb: 'k-wlc',
          check: () => H.installed('wlc', (d) => H.serverLinked(d)) },
        { id: 'c2-dhcp', text: 'IP 網段規劃：所有 DHCP 位址池都足夠', hint: '到「防火牆 → 網段規劃」檢查：員工 Wi-Fi 的裝置數會隨人數暴增，/22 很快就不夠了。', goto: 'fw:net', kb: 'k-ip',
          check: () => Q.employees() >= 3000 && H.dhcpOk() },
        { id: 'c2-sat', text: '全公司 3,000 人以上時，滿意度 ≥ 80% 累積 6 小時', hint: '用監控中心找出瓶頸：WAN、樓層上行、Wi-Fi 容量、防火牆效能都可能是問題。', goto: 'noc', kb: 'k-bandwidth',
          sustain: 360, cond: () => G.R.sim && G.R.sim.users > 1500 && Q.employees() >= 3000 && G.R.sim.sat >= 0.8 },
        { id: 'c2-rest', text: '全公司 3,000 人以上時，一整個工作天（09:00～18:00）每間廁所都有衛生紙、整潔 ≥ 60%', hint: '早上廁所都是夜班整理好的，下午才見真章：一位清潔人員巡不完八層樓、24 間廁所。到任一樓層頁的「⑤ 廁所與清潔」，把白班清潔人員加到建議人數（外包合約按月計費）。', goto: 'floor', kb: 'k-iot',
          check: (s) => !!(s.rest.lastDay && s.rest.lastDay.ok && s.rest.lastDay.pop >= 3000),
          progress: () => {
            const R = G.S.rest, d = R.day, L = R.lastDay;
            if (d && d.first) return `今天 ${U.stamp(d.first.t).slice(-5)} ${d.first.fid} ${G.Rest.RM[d.first.k].name}${d.first.why}，明天再試`;
            if (d) return `今天目前都合格（${U.dur(d.mins)} / 9 小時）`;
            if (L && !L.ok && L.first) return `上一個工作天 ${L.first.fid} ${G.Rest.RM[L.first.k].name}${L.first.why}`;
            return '平日 09:00～18:00 計算';
          } },
      ],
      outro: ['八個樓層、將近 3,700 人穩定上線。你開始在監控中心看見每天規律起伏的流量曲線。', '行銷部提醒你：官網與客戶入口即將上線，一樓大廳也要開放訪客了。'],
    },
    {
      id: 'c3', title: '第三章｜開門迎客', grant: 8000000,
      story: [
        '集團的全新官網與客戶入口明天上線，一樓大廳也將開放訪客與提供訪客 Wi-Fi。',
        '「對外服務」代表網際網路上的任何人都能連到你的伺服器 —— 包括駭客。',
        '你需要清楚劃分外網、DMZ 與內網，並讓防火牆只開放必要的服務。',
        '總務部也要導入「智慧廁所」：衛生紙快沒了、地板漏水，感測器會自動通報、清潔人員照需要派工。只是這些 IoT 裝置很少更新韌體，一旦被駭就是闖進內網的跳板。',
      ],
      learn: ['外網 / 內網 / DMZ', 'NAT 與對外服務', '訪客網路隔離', 'VLAN', 'IPS / WAF', '掃描、暴力破解、SQL Injection', 'IoT 裝置獨立網段與 MQTT'],
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
        { id: 'c3-iot', text: '智慧廁所：已進駐的樓層都裝好感測器並連上 IoT 管理平台；IoT 裝置放在獨立網段，只開 IOT → SERVERS：MQTT', hint: '三件事：① 每層樓的「⑤ 廁所與清潔」按「安裝智慧廁所」；② 一台伺服器設成 IoT 管理平台並接上核心；③「防火牆 → 網段規劃」啟用 IoT 獨立網段，再新增 IOT → SERVERS：MQTT。IoT 網段不能連到 LAN、網際網路或其他區域。', goto: 'floor', kb: 'k-iot',
          check: (s) => H.iotAll() && s.fw.iotVlan && G.Sec.allows('IOT', 'SERVERS', 'MQTT') && G.Sec.posture().iotIsolated,
          progress: () => { const fl = G.Rest.occupied(); return `${fl.filter((f) => G.Rest.iotOk(f.id)).length}/${fl.length} 層`; } },
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
      kb: ['k-ha', 'k-power', 'k-cooling', 'k-lacp', 'k-segment', 'k-pue', 'k-fire', 'k-ems'],
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
      outro: ['攻擊行動結束了。你的網路撐了下來。', '資訊長拍拍你的肩膀：「董事會剛通過一個新計畫 —— 我們要有自己的 AI 運算中心。」'],
    },
    {
      id: 'c6', title: '第六章｜AI 運算中心', grant: 60000000,
      story: [
        '撐過資安風暴後，董事會決定全面導入生成式 AI：研發部要訓練自家的產品模型，全體員工也要有企業內部的 AI 助理。',
        '可是 AI 伺服器跟你熟悉的設備完全不同 —— 一台 8-GPU 伺服器就要 10 kW，一般機櫃整座才 8 kW；GPU 熱到要用液體冷卻；GPU 之間的網路一台就要好幾個 400G。',
        '在 B1 建好一座 AI 運算中心：電力、散熱、網路、消防，一樣都不能少。',
      ],
      learn: ['AI 機櫃與電源櫃（PSU）', 'BBU 電池備援', '液冷與 CDU', '400G AI 後端網路', '機房消防與環控', 'PUE'],
      moveIns: [],
      events: [
        { type: 'power-out', at: (t0) => U.nextWeekdayAt(t0, 14, 3), data: { dur: 20 } },
        { type: 'psu-fail', at: (t0) => U.nextWeekdayAt(t0, 10, 4) },
        { type: 'dc-fire', at: (t0) => U.nextWeekdayAt(t0, 16, 4), data: { delay: 25 } },
        { type: 'cdu-leak', at: (t0) => U.nextWeekdayAt(t0, 11, 5) },
      ],
      kb: ['k-gpu', 'k-aipower', 'k-liquid', 'k-aifabric', 'k-fire', 'k-ems', 'k-pue'],
      objectives: [
        { id: 'c6-rack', text: '採購 AI 機櫃，並裝上電源櫃（PSU）與 BBU', hint: '「採購 → AI 運算」買 ORv3 AI 機櫃、PS-33 電源櫃與 BBU-6。AI 機櫃沒有 PDU，電力完全由你裝的電源櫃決定。', goto: 'shop:ai', kb: 'k-aipower',
          check: (s) => s.racks.some((r) => { if (r.type !== 'ai') return false; const p = G.Fac.aiRackPower(r.id); return p.total > 0 && p.bbuW > 0; }) },
        { id: 'c6-gpu', text: '安裝至少 2 台 GX-8 AI 訓練伺服器', hint: '每台 10.2 kW，只能裝在 AI 機櫃。先算算電源櫃容量夠不夠！', goto: 'shop:ai', kb: 'k-gpu',
          check: () => H.gpus().length >= 2 },
        { id: 'c6-n1', text: '每座 AI 機櫃的電源櫃都有 N+1 備援', hint: 'N+1 = 少一個 PSU 時仍撐得住整座機櫃。負載超過（PSU 數 − 1）× 5.5 kW 就再加一台電源櫃。', goto: 'rack', kb: 'k-aipower',
          check: () => { const f = G.R.fac; const ai = G.S.racks.filter((r) => r.type === 'ai' && f && f.racks[r.id] && f.racks[r.id].load > 0); return ai.length > 0 && ai.every((r) => f.racks[r.id].load <= f.racks[r.id].n1); } },
        { id: 'c6-bbu', text: '停電時撐得住：每座 AI 機櫃的 BBU 容量 ≥ 機櫃負載，而且有發電機', hint: 'BBU 只需要撐過發電機啟動的 1 分鐘，但瞬間功率要夠：兩台 GX-8 就超過一台 BBU-6 的 18 kW。', goto: 'rack', kb: 'k-aipower',
          check: () => { const f = G.R.fac; const ai = G.S.racks.filter((r) => r.type === 'ai' && f && f.racks[r.id] && f.racks[r.id].load > 0); return !!f && f.gen && ai.length > 0 && ai.every((r) => f.racks[r.id].bbuW >= f.racks[r.id].load); } },
        { id: 'c6-cdu', text: '建置液冷 CDU，液冷能力 ≥ GPU 的發熱', hint: 'GX-8 的熱有 80% 走冷卻液。CDU 不夠，GPU 就會過熱降頻。', goto: 'shop:ai', kb: 'k-liquid',
          check: () => G.R.fac && G.R.fac.liquidHeat > 0 && G.R.fac.cduCap >= G.R.fac.liquidHeat },
        { id: 'c6-fabric', text: 'AI 後端網路：每台 GX-8 都以 400G 接到 AF-6400 AI 交換器', hint: '拓撲頁把 GX-8 連到 AF-6400，速率選 400G。GPU 之間每秒要同步上百 Gbps，企業核心的 100G 會卡住訓練。', goto: 'topo', kb: 'k-aifabric',
          check: () => { const gx = H.gpus(); return gx.length >= 2 && gx.every(H.aiLink); } },
        { id: 'c6-store', text: '部署 AI 全快閃儲存（ST-AI）並接上網路', hint: 'GPU 要不停讀訓練資料。把 ST-AI 以 400G 接到 AF-6400，GPU 才不會等資料。', goto: 'shop:ai', kb: 'k-gpu',
          check: () => Q.roleServers('aistore').some((d) => d.rack && Q.linksOf(d.id).length > 0) },
        { id: 'c6-fire', text: '機房消防升級：VESDA 極早期偵煙 + 潔淨氣體滅火', hint: 'AI 設備價值上億，一般灑水頭一淋就全毀。到「採購 → 機房設施」。', goto: 'shop:facility', kb: 'k-fire',
          check: (s) => G.Fac.has('VESDA') && s.room.some((r) => r.model === 'GAS-FS' && s.time >= (r.readyAt || 0)) },
        { id: 'c6-ems', text: '建置機房環境監控（EMS）', hint: '溫濕度、漏水、煙霧與液冷漏液偵測，一有異常立刻告警。', goto: 'shop:facility', kb: 'k-ems',
          check: () => G.Fac.has('EMS-1') },
        { id: 'c6-perf', text: 'AI 算力利用率 ≥ 85% 累積 6 小時', hint: '利用率 = 供電 × 散熱 × 後端網路 × 儲存。到「機房」看 AI 算力，哪一項拖後腿就補哪一項。', goto: 'rack', kb: 'k-gpu',
          sustain: 360, cond: () => !!G.R.ai && G.R.ai.trainers >= 2 && G.R.ai.util >= 0.85 },
      ],
      outro: ['AI 運算中心正式啟用。研發部的第一個模型訓練完成，全公司也都用上了企業內部的 AI 助理。', '慶功宴上，董事長宣布：集團要擴張了 —— 台中、高雄、越南、東京，還有總部頂樓的員工餐廳。'],
    },
    {
      id: 'c7', title: '第七章｜集團版圖', grant: 38000000,
      story: [
        '新曜集團併購了台中的精密零件廠、在高雄設立營業所，越南胡志明市的新工廠正式投產，東京辦公室負責日本市場。四個據點都要連回總部的 ERP、檔案與電話。',
        '總部頂樓的員工餐廳也要開幕了：午餐時間上千人擠在 22、23 樓，人人拿著手機。',
        '還有：大樓附的舊型總機即將停產，客服中心要換成 IP 電話交換機；董事會也決定把郵件搬上 Microsoft 365。',
      ],
      learn: ['MPLS / IPLC / SD-WAN', 'VPN 與線路備援', 'IP-PBX、SIP 中繼與 SBC', '語音 QoS 與 MOS', 'SaaS 與雲端專線', '高密度 Wi-Fi（員工餐廳）'],
      moveIns: [{ floor: '22F', at: (t0) => U.nextWeekdayAt(t0, 10, 1) }, { floor: '23F', at: (t0) => U.nextWeekdayAt(t0, 10, 1) }],
      sites: [{ id: 'tc', at: (t0) => U.nextWeekdayAt(t0, 9, 2) }, { id: 'ks', at: (t0) => U.nextWeekdayAt(t0, 9, 2) }, { id: 'vn', at: (t0) => U.nextWeekdayAt(t0, 9, 3) }, { id: 'jp', at: (t0) => U.nextWeekdayAt(t0, 9, 3) }],
      events: [
        { type: 'call-surge', at: (t0) => U.nextWeekdayAt(t0, 14, 2) },
        { type: 'wan-down', at: (t0) => U.nextWeekdayAt(t0, 10, 4), data: { site: 'tc', type: 'mpls' } },
        { type: 'toll-fraud', at: (t0) => U.nextWeekdayAt(t0, 2, 4) },
        { type: 'cable-cut', at: (t0) => U.nextWeekdayAt(t0, 20, 5) },
      ],
      kb: ['k-mpls', 'k-sdwan', 'k-cloud', 'k-pbx', 'k-qos', 'k-canteen'],
      objectives: [
        { id: 'c7-canteen', text: '22F、23F 員工餐廳完成佈建（布線、交換器、上行、Wi-Fi 覆蓋 ≥ 90%）', hint: '餐廳的 AP 要照「人數」規劃：午餐時一層樓就有七百多人。冷凍庫是金屬牆，訊號穿不透。收銀機也要有網路孔。', goto: 'floor:22F', kb: 'k-canteen',
          check: () => H.floorReady('22F', 0.9) && H.floorReady('23F', 0.9), progress: () => `${['22F', '23F'].filter((f) => H.floorReady(f, 0.9)).length}/2` },
        { id: 'c7-lunch', text: '午餐尖峰：兩層餐廳的用餐 Wi-Fi 容量 ≥ 90%、收銀機都能刷卡（累積 30 分鐘）', hint: '12:00～13:00 是尖峰。用 AP 負載圖層找出超載的 AP，改用「自動規劃 AP」或 Wi-Fi 6E / 7。', goto: 'floor:22F', kb: 'k-canteen',
          sustain: 30, cond: () => ['22F', '23F'].every((f) => { const st = G.R.sim && G.R.sim.floors[f]; return st && st.diners > 200 && st.dinerRatio >= 0.9 && st.posOk; }) },
        { id: 'c7-pbx', text: '部署 IP 電話交換機（IP-PBX），並申請 SIP 中繼（外線）', hint: '「採購 → 系統」買 PX-500 上架、接上核心；再到「系統 → 語音」申請 SIP 中繼。第一次開通要 6 小時。', goto: 'sys:voice', kb: 'k-pbx',
          check: (s) => H.roleUp('pbx') && s.voice.trunk > 0 },
        { id: 'c7-sbc', text: '用 DMZ 的 SBC 對接電信業者，電話交換機不直接對外開放 SIP', hint: 'SBC-2 接到防火牆的 DMZ 介面；規則開 INTERNET → DMZ：SIP 與 DMZ → SERVERS：SIP，不要開 INTERNET → SERVERS：SIP。', goto: 'sys:voice', kb: 'k-pbx',
          check: () => G.Sec.serverZones('sbc').some((x) => x.zone === 'DMZ') && !G.Sec.allows('INTERNET', 'SERVERS', 'SIP') && !!G.R.voice && G.R.voice.trunkOk && G.R.voice.sbc },
        { id: 'c7-voice', text: '客服中心：外線阻塞率 < 2%、通話品質 MOS ≥ 4（累積 2 小時）', hint: '外線路數用 Erlang B 規劃（「系統 → 語音」有試算）；啟用語音 QoS，網路壅塞時電話才不會斷斷續續。', goto: 'sys:voice', kb: 'k-qos',
          sustain: 120, cond: () => { const v = G.R.voice; return !!v && v.active && v.calls > 50 && v.blocking < 0.02 && v.mos >= 4; } },
        { id: 'c7-tc', text: '台中工廠以 MPLS 連回總部，ERP 延遲 < 40 ms', hint: '「據點」頁：台中工廠申請 MPLS，總部也要申請 MPLS 匯接；防火牆開 WAN → SERVERS 的 SQL、SMB、LDAP、DNS。頻寬不夠延遲就會飆高。', goto: 'wan:tc', kb: 'k-mpls',
          check: () => { const x = G.R.wan && G.R.wan.sites.tc; return !!x && x.open && x.cls.erp && x.cls.erp.path === 'mpls' && x.cls.erp.ratio > 0.95 && x.erpRtt < 40; } },
        { id: 'c7-vn', text: '越南廠：ERP 延遲 < 120 ms，而且有兩條不同的線路', hint: 'IPLC 延遲最低但最貴、而且是單一路徑；當地寬頻便宜但晚上很塞。用 IPLC + 寬頻，再搭配 VPN 或 SD-WAN 當備援。', goto: 'wan:vn', kb: 'k-sdwan',
          check: (s) => { const x = G.R.wan && G.R.wan.sites.vn; return !!x && x.open && x.cls.erp && x.cls.erp.ratio > 0.9 && x.erpRtt < 120 && s.wan.sites.vn.links.filter((l) => l.status === 'active').length >= 2; } },
        { id: 'c7-sdwan', text: '至少兩個據點使用 SD-WAN（總部要有 SD-WAN 集中器）', hint: '「採購 → 系統」買 SDW-1 放在 DMZ，再到「據點」勾選 SD-WAN。上網就近從據點出去，專線只留給 ERP。', goto: 'wan', kb: 'k-sdwan',
          check: () => G.SITE_IDS.filter((id) => G.R.wanPlans && G.R.wanPlans[id] && G.R.wanPlans[id].sd).length >= 2, progress: () => `${G.SITE_IDS.filter((id) => G.R.wanPlans && G.R.wanPlans[id] && G.R.wanPlans[id].sd).length}/2` },
        { id: 'c7-cloud', text: '導入 Microsoft 365，而且全員啟用 MFA', hint: '「據點 → 公有雲」啟用 Microsoft 365。上雲之後，每個人的流量都改走網際網路：ISP 頻寬要夠。雲端帳號一定要 MFA。', goto: 'wan:cloud', kb: 'k-cloud',
          check: () => Q.hasService('m365') && Q.hasService('mfa') },
        { id: 'c7-sites', text: '四個據點都營運中，所有據點與全公司滿意度 ≥ 80%（累積 6 小時）', hint: '到「據點」看哪一類應用卡住了：頻寬、延遲、防火牆規則，還是晚上的國際網路。', goto: 'wan', kb: 'k-sdwan',
          sustain: 360, cond: () => { const R = G.R.wan; if (!R || !G.R.sim || G.R.sim.sat < 0.8) return false; return G.SITE_IDS.every((id) => R.sites[id] && R.sites[id].open && R.sites[id].sat >= 0.8); } },
      ],
      outro: ['四個據點、兩層員工餐廳、全新的電話系統與雲端服務，全部上線。', '但稽核報告讓資訊長皺起眉頭：「伺服器三十幾台各自為政、備份從沒還原過、一萬台電腦的修補狀況不明。」'],
    },
    {
      id: 'c8', title: '第八章｜系統維運', grant: 42000000,
      story: [
        'ISO 27001 稽核即將到來。稽核員列了一長串問題：三十幾台實體伺服器、每台只用了一成的效能；備份從來沒有還原過；沒人知道一萬台電腦裝了哪些更新；防火牆有沒修補的漏洞……',
        '這一章要把機房的「系統」整頓好：虛擬化、共用儲存、3-2-1 備份、端點管理、弱點管理，還有稽核員最先檢查的——機房門禁。',
        '記住：真正的考驗不是建好，而是出事的時候還撐得住。',
      ],
      learn: ['虛擬化與 HA', 'SAN 與 RAID', '備份 3-2-1 與還原演練', '端點管理與修補', '弱點掃描與 CVSS', '維護窗口', '機房門禁與最小權限'],
      moveIns: [],
      patchAt: (t0) => U.nextWeekdayAt(t0, 1, 2),
      events: [
        { type: 'hw-fail', at: (t0) => U.nextWeekdayAt(t0, 11, 2), data: { hvFirst: true } },
        { type: 'disk-fail', at: (t0) => U.nextWeekdayAt(t0, 15, 2) },
        { type: 'kev', at: (t0) => U.nextWeekdayAt(t0, 14, 3) },
        { type: 'del-file', at: (t0) => U.nextWeekdayAt(t0, 16, 3) },
        { type: 'laptop-lost', at: (t0) => U.nextWeekdayAt(t0, 19, 4) },
        { type: 'vendor', at: (t0) => U.nextWeekdayAt(t0, 10, 1) },
      ],
      kb: ['k-vm', 'k-san', 'k-backup', 'k-uem', 'k-patch', 'k-vuln', 'k-access'],
      objectives: [
        { id: 'c8-cluster', text: '建置虛擬化叢集：至少 3 台虛擬化主機 + SAN 共用儲存，開啟 HA', hint: '「採購 → 系統」買 HV-2U 與 SAN-5K，上架並接上核心交換器（25G）。「系統 → 虛擬化」確認 HA 已開啟。', goto: 'sys:vm', kb: 'k-vm',
          check: () => { const c = G.VM.cluster(); return c.hosts >= 3 && c.up >= 3 && c.shared && c.ha; }, progress: () => `${G.VM.cluster().up}/3 台主機${G.VM.cluster().shared ? ' · SAN ✓' : ''}` },
        { id: 'c8-vms', text: '至少 6 個服務跑在 VM 上（新建 VM 或 P2V 實體轉虛擬）', hint: '在實體伺服器的詳情按「轉成 VM（P2V）」，完成後舊主機就能出售，省下機櫃、電費與維護費。', goto: 'sys:vm', kb: 'k-vm',
          check: () => G.VM.vms().filter((v) => v.role && G.Net.devUp(v)).length >= 6, progress: () => `${G.VM.vms().filter((v) => v.role && G.Net.devUp(v)).length}/6` },
        { id: 'c8-n1', text: 'HA 可以承受任一台主機故障（N+1），所有 VM 的硬碟都在 SAN', hint: '壞掉一台主機後，剩下的主機記憶體要放得下所有 VM。放在主機本機硬碟的 VM 不能 HA。', goto: 'sys:vm', kb: 'k-vm',
          check: () => { const c = G.VM.cluster(); return c.ha && c.n1 && c.vms > 0 && G.VM.vms().every((v) => v.disk === 'san'); } },
        { id: 'c8-raid', text: '儲存都用 RAID 6 或 RAID 10，使用率都 < 80%', hint: '大容量硬碟重建要十幾個小時：RAID 5 在重建時再壞一顆就全毀。到「系統 → 儲存」調整，空間不夠就加擴充櫃。', goto: 'sys:stor', kb: 'k-san',
          check: () => { const P = G.R.stor ? G.R.stor.pools.filter((p) => p.kind !== 'local') : []; return P.length > 0 && P.every((p) => p.raid !== 'raid5' && p.ratio < 0.8); } },
        { id: 'c8-321', text: '備份符合 3-2-1：本地備份 + 另一種媒體 + 一份在異地', hint: '備份伺服器之外，再加磁帶櫃（啟用異地保管）或雲端備份。雲端備份要開 SERVERS → INTERNET：WEB。', goto: 'sys:bkp', kb: 'k-backup',
          check: () => G.Stor.rule321().ok },
        { id: 'c8-drill', text: '完成一次成功的還原演練', hint: '「系統 → 備份」→ 進行還原演練（2 小時）。沒有演練過的備份，出事時可能根本還原不了。', goto: 'sys:bkp', kb: 'k-backup',
          check: (s) => !!s.bkp.drillOk && s.bkp.drillAt >= s.chapterStart },
        { id: 'c8-uem', text: '導入端點管理平台，開啟分批派送與 BitLocker', hint: '「系統 → 端點」。分批派送讓出包的更新只影響試點電腦；BitLocker 讓遺失的筆電不會洩漏資料。', goto: 'sys:ep', kb: 'k-uem',
          check: (s) => G.Ep.uem() && s.ep.rings && s.ep.bitlocker },
        { id: 'c8-patch', text: '安全更新發布後，全公司的修補合規率 ≥ 95%', hint: '更新發布後由端點管理平台派送。一萬台電腦一起從網際網路下載會塞爆對外頻寬：先建一台更新快取（UPD 角色的 VM）。', goto: 'sys:ep', kb: 'k-patch',
          check: (s) => s.ep.releaseAt >= s.chapterStart && s.ep.patch >= 0.95, progress: () => (G.S.ep.releaseAt >= G.S.chapterStart ? U.pct(G.S.ep.patch) : '等待更新發布') },
        { id: 'c8-vuln', text: '部署弱點掃描：沒有超過 SLA 的嚴重弱點，對外設備沒有嚴重弱點', hint: '建一台弱點掃描 VM（VS 角色），到「防火牆 → 弱點管理」把嚴重與高風險的弱點排入維護窗口。', goto: 'fw:vuln', kb: 'k-vuln',
          check: (s) => G.Vuln.scannerUp() && s.vuln.lastScan !== null && s.vuln.lastScan >= s.chapterStart && !G.Vuln.known().some((x) => x.sev === 'crit' && G.Vuln.overdue(x)) && !G.Vuln.exposedCrit().length },
        { id: 'c8-access', text: '機房門禁：裝好門禁系統，清潔人員、廠商、主管都不能自己進機房（最小權限）', hint: '「採購 → 機房設施」安裝感應卡門禁（或雙因子 + 防尾隨雙門）。裝好後到「機房」的「機房門禁」：清潔人員與廠商改成「需 IT 陪同」、主管改成「不能進入」。', goto: 'rack', kb: 'k-access',
          check: () => G.Acc.level() >= 1 && !G.Acc.overPriv().length },
        { id: 'c8-audit', text: '資安健檢評分 A', hint: '到「防火牆 → 資安健檢」逐項處理：備份、修補、弱點、雲端 MFA……', goto: 'fw:audit', kb: 'k-vuln',
          check: () => G.Sec.audit().grade === 'A' },
      ],
      outro: ['稽核員闔上筆電：「這是我今年看過最整齊的機房。」', '從一間空蕩蕩的 B1 機房，到橫跨四個據點、上雲、上萬台電腦與 AI 運算中心的企業 IT —— 你做到了。',
        '不過，原廠寄來了一封公告：第一台核心交換器明年就停止支援（End of Support）……'],
    },
    {
      id: 'c9', title: '第九章｜割接之夜', grant: 6000000,
      story: [
        '原廠公告：第一章買的那台核心交換器明年停止支援（EoS），韌體不會再修補漏洞，稽核也把它列為高風險。',
        '新的 CX-9600 已經到貨，原廠工程師幫你上架、灌好出廠設定。剩下的工作——把舊核心上的每一條線，一條一條搬到新核心——要由你在凌晨 02:00～05:00 的維護窗口內完成（日期寫在割接計畫上）。',
        '一萬人的網路不能停。窗口內每個動作都要花時間：拔線、插線、循線追蹤……準備工作做得越徹底，割接的那一夜就越平靜。',
      ],
      learn: ['割接計畫（MOP）與變更管理', '維護窗口與回退計畫', '光模組與跳線（SR / LR、LC / MPO、DAC）', '光纖極性', 'LACP 與 STP：迴圈與廣播風暴', '線路標籤與 show interface'],
      moveIns: [],
      begin: (s) => G.Cut.begin(s),
      kb: ['k-patch', 'k-stp', 'k-cutover'],
      objectives: [
        { id: 'c9-mop', text: '打開割接計畫書（MOP），看清楚要搬哪些線、維護窗口是什麼時候', hint: '到「機房」切換到「實體接線」，右邊的「割接計畫」卡片按「打開 MOP」。MOP（Method of Procedure）是割接的劇本：每一條線從哪個埠搬到哪個埠、需要什麼模組、出問題怎麼回退。', goto: 'rack:patch', kb: 'k-cutover',
          check: (s) => G.Cut.skip() || (!!s.cut && s.cut.mopRead) },
        { id: 'c9-prep', text: '檢查新核心：開啟 STP，拆掉原廠留下的燒機測試線', hint: '原廠出貨預設「關閉 STP」，還留著一條把兩個埠接在一起的測試線（自我迴圈）。新核心只要一接上網路，廣播封包就會在迴圈裡無限循環——整個公司的網路瞬間癱瘓。先在新核心開啟 STP，再把測試線拔掉收走。', goto: 'rack:patch', kb: 'k-stp',
          check: () => G.Cut.skip() || G.Cut.prepOk() },
        { id: 'c9-label', text: '舊核心上的每一條線都貼好標籤', hint: '舊核心上很多線沒有標籤：割接時你根本不知道它通往哪一層樓。趁現在逐條「循線追蹤並貼標籤」（窗口前不用花時間；窗口內每條要 6 分鐘）。', goto: 'rack:patch', kb: 'k-cutover',
          check: () => G.Cut.skip() || G.Cut.labelsOk(), progress: () => { const c = G.S.cut; return c ? `還有 ${G.Cut.unlabeled().length} 條沒標籤` : ''; } },
        { id: 'c9-mods', text: '依 MOP 在新核心插好光模組（和對端同一種）', hint: '模組要成對：對端是 10GBASE-LR（單模、藍色拉環），新核心這一頭也要 LR；對端是 SR（多模）就配 SR。點新核心上 MOP 指定的埠，選模組插上。', goto: 'rack:patch', kb: 'k-patch',
          check: () => G.Cut.skip() || G.Cut.modsOk(), progress: () => (G.S.cut ? `${G.Cut.modsReady()}/${G.Cut.rows().length}` : '') },
        { id: 'c9-lag', text: '新核心 ⇄ 另一台核心：接兩條 100G 互連，設定 LACP（兩條都要轉送）', hint: '在新核心的 Hu1/2/31、32 和另一台核心的空 QSFP 埠之間各接一條 100G。沒有 LACP 的兩條線是「迴圈」：STP 會擋掉一條，只剩一半頻寬。接第二條時勾選 LACP，或在埠詳情把 LACP 打開。新跳線不通？先翻轉極性試試。', goto: 'rack:patch', kb: 'k-lacp',
          check: () => G.Cut.skip() || G.Cut.lagOk() },
        { id: 'c9-window', text: '等到維護窗口開始（凌晨 02:00，時間到會自動暫停）', hint: '準備工作都做好了，就在「割接計畫」卡片按「快轉到維護窗口」（窗口一開始會自動暫停）。窗口前別去動舊核心上的線：上班時間拔線會影響同事，也違反變更管理。', goto: 'rack:patch', kb: 'k-cutover',
          check: (s) => G.Cut.skip() || (!!s.cut && s.time >= s.cut.win.start) },
        { id: 'c9-move', text: '依 MOP 把舊核心的線全部搬到新核心（每條搬完確認燈號轉綠）', hint: '一次搬一條：在舊核心上點那條線 →「拔掉這一端」→ 點新核心上 MOP 指定的埠插上 → 看燈號、show interface 確認通了，再搬下一條。有雙上行的樓層先搬、單線的伺服器最後搬，影響最小。', goto: 'rack:patch', kb: 'k-cutover',
          check: () => G.Cut.skip() || G.Cut.movedAll(), progress: () => { const p = G.Cut.progress(); return `${p.done}/${p.total}`; } },
        { id: 'c9-verify', text: '驗證：所有樓層與服務都正常，而且持續 30 分鐘', hint: '搬完不等於結束：到「監控」看每層樓都上線、沒有中斷的服務、沒有 STP 阻擋以外的異常，觀察 30 分鐘。', goto: 'noc', kb: 'k-cutover',
          sustain: 30, cond: () => G.Cut.skip() || (G.Cut.movedAll() && G.Cut.healthy()) },
        { id: 'c9-remove', text: '舊核心下架：拆掉剩下的線（含核心互連），從機櫃移除', hint: '舊核心上剩下的只有和另一台核心的互連：拔掉收走，再到「機房」把舊核心下架（或出售）。', goto: 'rack', kb: 'k-cutover',
          check: () => G.Cut.skip() || G.Cut.removed() },
      ],
      outro: ['最後一條線的燈號轉綠，監控中心的曲線恢復平穩。一次好的割接，就該讓人感覺不到它發生過。',
        '你在變更單上寫下結案紀錄，把舊核心推出機房。天亮了，一萬名同事照常上班——下面是這一夜的成績單。'],
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
      const plan = [['2F', '3F', '4F', '5F', '6F'], ['7F', '8F', '9F', '10F', '11F'], ['12F', '13F', '14F', '15F', '16F'], ['17F', '18F', '19F', '20F', '21F', '1F', '22F', '23F']];
      plan.forEach((g, i) => g.forEach((fid) => { s.floors[fid].moveInAt = U.at(3 + i, 9); }));
      /* B2 停車場：第一批同事上班那天一早啟用 */
      s.floors.B2.moveInAt = U.at(3, 7);
      /* 分支據點：第 5～7 天陸續開幕 */
      Object.assign(s.wan.sites.tc, { openAt: U.at(5, 9) });
      Object.assign(s.wan.sites.ks, { openAt: U.at(5, 9) });
      Object.assign(s.wan.sites.vn, { openAt: U.at(6, 9) });
      Object.assign(s.wan.sites.jp, { openAt: U.at(7, 9) });
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
    /* 章節自己的開場（第九章：原廠上架新核心、產生 MOP） */
    if (ch.begin) ch.begin(s);
    /* 分支據點開幕、提前發布一次安全更新（讓本章可以練習派送） */
    for (const x of ch.sites || []) { const w = s.wan.sites[x.id]; if (w && w.openAt === null) w.openAt = x.at(s.time); }
    if (ch.patchAt) s.ep.forceAt = ch.patchAt(s.time);
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
  /** 這個任務的條件現在是否已經達成（暫停中也能即時打勾；累積時間的任務要等時間走） */
  Campaign.ready = (o) => { if (!G.S || o.sustain) return false; try { return !!o.check(G.S); } catch (e) { return false; } };
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
      if (ch.id === 'c9' && G.Cut) G.Cut.finish();
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
