/* 維運：監控告警（需要 NMS 才看得到細節）與使用者報修工單（永遠會來）
 * 工單同時是給玩家的動態提示：告訴你哪裡出了問題、該去哪裡修。
 */
(function (G) {
  'use strict';
  const U = G.U, Q = G.Q, CAT = G.CAT;
  const Ops = {};
  G.Ops = Ops;

  Ops.nmsUp = () => Q.roleServers('nms').some((d) => G.Net.devUp(d));

  Ops.alert = (sev, text, key) => {
    const s = G.S;
    if (!s) return;
    if (key) {
      for (let i = s.alerts.length - 1; i >= 0 && i >= s.alerts.length - 40; i--) {
        const a = s.alerts[i];
        if (a.key === key && s.time - a.t < 60) return;
      }
    }
    const a = { id: Q.nextId('a'), t: s.time, sev, text, key };
    s.alerts.push(a);
    if (s.alerts.length > 200) s.alerts.splice(0, s.alerts.length - 200);
    G.bus.emit('alert', a);
  };

  /** 找出某樓層流量的主要瓶頸 */
  Ops.bottleneck = (fid) => {
    const sim = G.R.sim;
    if (!sim) return null;
    const st = sim.floors[fid];
    if (!st) return null;
    if (st.capRatio < 0.8 && st.wifiShare > 0.1) return { kind: 'wifi', text: `Wi-Fi 容量不足（AP 只能滿足 ${U.pct(st.capRatio)} 的需求）`, goto: 'floor:' + fid };
    let worst = null;
    for (const fl of st.flows) {
      if (!fl.legs || fl.blocked) continue;
      for (const leg of fl.legs) for (const p of leg) {
        for (const e of p.edges) {
          for (const k of [e.fwd, e.rev]) {
            const u = sim.util.get(k) || 0;
            if (u > 0.95 && (!worst || u > worst.u)) worst = { u, key: e.key };
          }
        }
        for (const n of p.nodes) {
          const ni = sim.nodes[n];
          if (ni && ni.util > 0.95 && (!worst || ni.util > worst.u)) worst = { u: ni.util, node: n };
        }
      }
    }
    if (!worst) return null;
    if (worst.node) {
      const k = Q.nodeKind(worst.node);
      return { kind: k, text: `${Q.nodeName(worst.node)} 效能滿載（${U.pct(worst.u)}）${k === 'firewall' && Q.hasService('ips') ? '，IPS 開啟後吞吐量會下降' : ''}`, goto: 'topo' };
    }
    if (worst.key.startsWith('isp:')) return { kind: 'wan', text: `ISP 頻寬不足（WAN 使用率 ${U.pct(worst.u)}）`, goto: 'shop:isp' };
    const l = G.S.links[worst.key];
    if (l) {
      const isUp = l.a === 'F:' + fid || l.b === 'F:' + fid;
      return { kind: isUp ? 'uplink' : 'link', text: `${isUp ? fid + ' 上行鏈路' : Q.nodeName(l.a) + ' ⇄ ' + Q.nodeName(l.b)} 滿載（${U.pct(worst.u)}，${U.speed(l.speed)}×${l.count}）`, goto: isUp ? 'floor:' + fid : 'topo' };
    }
    return null;
  };

  const TK = {
    down:      { sev: 'crit', text: (f) => `${f} 整層網路斷線！`, hint: '檢查 IDF：布線是否完工、有沒有接入交換器、上行鏈路是否正常、IDF 是否斷電。' },
    isolated:  { sev: 'crit', text: (f) => `${f} 整層連不到任何服務（上行中斷）`, hint: '這層樓的上行主幹全部中斷，或核心交換器故障。到拓撲檢查紅色的線路並派員搶修。建議每層樓雙上行到兩台不同的核心。', goto: 'topo' },
    fw:        { sev: 'crit', text: (f) => `${f}：所有網站都打不開`, hint: '防火牆擋下了員工上網（預設拒絕）。到「防火牆」新增 LAN → INTERNET 的 WEB 允許規則。', goto: 'fw' },
    dns:       { sev: 'crit', text: (f) => `${f}：網頁打不開，但輸入 IP 可以連（DNS 失敗）`, hint: '允許 LAN → INTERNET 的 DNS，或讓 AD 伺服器能向外查詢（SERVERS → INTERNET：DNS）。', goto: 'fw' },
    noad:      { sev: 'crit', text: (f) => `${f}：電腦無法登入網域、拿不到 IP`, hint: 'AD / DNS / DHCP 伺服器連不到。確認伺服器有上架、角色已設定、已接到核心交換器；若開了內部分段，要允許 LAN → SERVERS 的 LDAP 與 DNS。', goto: 'rack' },
    nofile:    { sev: 'high', text: (f) => `${f}：共用資料夾打不開`, hint: '檔案伺服器無法存取。部署儲存伺服器（角色：檔案）並接上核心；若開了內部分段，要允許 LAN → SERVERS：SMB。', goto: 'shop:srv' },
    nodb:      { sev: 'high', text: (f) => `${f}：ERP 系統無法連線`, hint: '資料庫伺服器無法存取。部署伺服器（角色：DB）接上核心；若開了內部分段，要允許 LAN → SERVERS：SQL。', goto: 'shop:srv' },
    slow:      { sev: 'med', text: (f) => `${f}：網路好慢`, hint: '' },
    wificov:   { sev: 'med', text: (f) => `${f}：部分座位 Wi-Fi 訊號很差、常斷線`, hint: '在樓層平面圖打開「訊號」圖層，找出紅色與灰色區域補 AP。牆壁與核心筒會擋訊號。' },
    wificap:   { sev: 'med', text: (f) => `${f}：Wi-Fi 很卡、會議室連不上`, hint: 'AP 過載：增加 AP 數量、升級 Wi-Fi 6/6E，或用無線控制器規劃頻道避免同頻干擾。' },
    ports:     { sev: 'high', text: (f) => `${f}：新同事的座位沒有網路孔可用`, hint: 'IDF 的接入交換器埠數不足。增加交換器數量或改用 48 埠機型。' },
    dhcpwired: { sev: 'high', text: (f) => `${f}：部分有線電腦拿不到 IP`, hint: '員工有線網段（每層樓一個 VLAN）太小。到「防火牆 → 網段規劃」把前綴調小（例如 /23 → /22）。', goto: 'fw:net' },
    dhcpwifi:  { sev: 'high', text: () => '手機與筆電連上 Wi-Fi 卻拿不到 IP', hint: '員工 Wi-Fi 位址池耗盡。到「防火牆 → 網段規劃」擴大員工無線網段。', goto: 'fw:net' },
    poe:       { sev: 'med', text: (f) => `${f}：有幾台 AP 沒有亮燈`, hint: '交換器的 PoE 總預算不夠供電給所有 AP（客服中心的 IP 電話也會吃 PoE）。增加交換器或改用 AX-48M。' },
    voip:      { sev: 'high', text: (f) => `${f}：客服電話斷斷續續、有回音`, hint: '語音對延遲與封包遺失非常敏感。檢查上行與 WAN 是否壅塞、PoE 是否足夠。' },
    dinewifi:  { sev: 'med', text: (f) => `${f}：午餐時間餐廳的 Wi-Fi 連不上、影片一直轉圈`, hint: '用餐尖峰上百人同時滑手機：AP 要照「人數」規劃（每台 AP 建議 50～70 人），不是照面積。用「自動規劃 AP」，或改用 Wi-Fi 6E / 7。' },
    sitedown:  { sev: 'crit', text: (f) => `${f}：整個據點連不回總部`, hint: '檢查這個據點的線路是否開通、總部的 MPLS 匯接，以及防火牆有沒有放行 WAN → SERVERS。只有一條線路就是單點故障：加一條寬頻 + VPN / SD-WAN 當備援。' },
    siteslow:  { sev: 'high', text: (f) => `${f}：ERP 很慢，查一筆資料要等好幾秒`, hint: 'WAN 線路滿載或延遲太高。加大專線頻寬，或用 SD-WAN 把上網與大檔案分流到當地的寬頻，讓專線留給 ERP。' },
    pbxdown:   { sev: 'crit', text: (f) => `${f}：電話全部不通，客戶打不進來`, hint: '沒有運作中的電話交換機（IP-PBX）。部署 PX-500（或 PBX 角色的伺服器 / VM）並接上核心交換器；若開了內部分段，要允許 LAN → SERVERS：SIP。', goto: 'sys:voice' },
    trunk:     { sev: 'high', text: () => '客戶來電一直忙線，外線打不出去', hint: '外線（SIP 中繼）不夠或不通：到「系統 → 語音」看阻塞率並增加路數；也要確認防火牆有放行 SIP（有 SBC：INTERNET → DMZ、DMZ → SERVERS）。', goto: 'sys:voice' },
    filefull:  { sev: 'high', text: () => '存檔失敗：共用資料夾的空間滿了', hint: '檔案伺服器的儲存空間用完了。到「系統 → 儲存」擴充容量（SAN 加擴充櫃、再加一台檔案伺服器），或把結案的專案封存到磁帶。', goto: 'sys:stor' },
    pos:       { sev: 'high', text: (f) => `${f}：收銀機不能刷卡，結帳大排長龍`, hint: '收銀機（POS）要連到網際網路上的金流閘道。檢查這層樓的網路、上行與防火牆（LAN → INTERNET：WEB）。' },
    clockin:   { sev: 'high', text: (f) => `${f}：停車場手機打卡失敗，好多人被記遲到`, hint: '地下室收不到 GPS、手機訊號也很差，打卡 App 要靠公司 Wi-Fi 確認位置。在停車場佈建 AP：停車格、走道和電梯廳都要有訊號（混凝土柱會擋訊號）；這層樓也要能上網（LAN → INTERNET：WEB）。' },
    gate:      { sev: 'high', text: (f) => `${f}：車道柵欄機連不上系統，車子回堵到馬路上`, hint: '車牌辨識攝影機與柵欄機要接有線網路：IDF 的接入交換器要留足埠數，而且這層樓要有上行主幹。' },
    cam:       { sev: 'med', text: (f) => `${f}：保全反映停車場的監視器畫面中斷`, hint: '監視器用 PoE 供電：接入交換器的埠數與 PoE 預算都要夠（每台約 7 W）。PoE 不夠時，AP 也會跟著沒電。' },
    wcpaper:   { sev: 'med', text: (f) => `${f}：廁所沒有衛生紙了`, hint: '清潔人員還沒巡到這一間。到這層樓的「廁所與清潔」加派清潔人員；或導入智慧廁所：感測器在快用完時就通知清潔人員先補。' },
    wcdirty:   { sev: 'med', text: (f) => `${f}：廁所很髒、有異味`, hint: '用的人太多、清潔人員巡不過來。加派清潔人員，或導入智慧廁所依人流與異味派工。' },
    wcclog:    { sev: 'med', text: (f) => `${f}：廁所馬桶堵住了`, hint: '堵住的那一間暫停使用，要等清潔人員來處理。智慧廁所的感測器會立刻通知清潔人員。' },
    /* 晶圓廠（第十章） */
    fabmes:    { sev: 'crit', text: () => '晶圓廠：MES 連不上，整座廠停線！', hint: 'MES 是晶圓廠的大腦：伺服器要設成 MES 角色、接在 OT 核心；EAP 也要連得到 MES。', goto: 'fab' },
    fabeap:    { sev: 'high', text: (f, n) => `晶圓廠：${n || '部分'} 台機台連不上 EAP，只能靠人工操作`, hint: 'EAP 伺服器（接在 OT 核心）用 SECS/GEM 控制機台。一台 EAP 大約管 40 台機台；EAP 放在 IT 那一側的話，SECS 要經過防火牆。', goto: 'fab' },
    fabport:   { sev: 'high', text: (f, n) => `晶圓廠：${n || '幾'} 台機台裝好了，卻沒有交換器埠可以接`, hint: 'FAB IDF 的接入交換器埠數不夠：每台機台要 1～2 個埠。到「樓層 → FAB」增加接入交換器。', goto: 'floor:FAB' },
    fabscan:   { sev: 'med', text: (f, n) => `晶圓廠：${n || '幾'} 台機台卡在「等待進廠掃毒」`, hint: '沒有進廠掃毒站，機台不能安全地接上網路。到「晶圓廠」建置掃毒站（或自負風險略過掃毒）。', goto: 'fab' },
    fabhand:   { sev: 'med', text: () => '晶圓廠：現場人員查不到 MES（手持裝置不夠或收不到訊號）', hint: '禁止私人手機之後，操作員要用公司的手持裝置查批號、叫天車：裝置數量要夠，無塵室的 bay 裡也要有 Wi-Fi 訊號（金屬機台與壁板很擋訊號）。', goto: 'fab' },
    fabfdc:    { sev: 'med', text: () => '晶圓廠：FDC 收不到機台的感測資料', hint: '沒有 FDC，製程偏移要等量測站才發現，一整批晶圓就報廢了。部署 FDC 伺服器接在 OT 核心，資料量很大，上行頻寬要夠。', goto: 'fab' },
    faberp:    { sev: 'high', text: () => '晶圓廠：MES 拿不到 ERP 的工單', hint: 'MES 要跟總部的 ERP（資料庫）交換工單與出貨資料：防火牆要允許 OT → SERVERS：SQL。', goto: 'fw' },
    fabeng:    { sev: 'med', text: () => '研發工程師在辦公室看不到晶圓廠的 MES 報表', hint: '工程師從總部的員工內網看 MES：防火牆要允許 LAN → OT：WEB（只開網頁，其他都不要開）。', goto: 'fw' },
    /* 廠務（第十一章，統包商撤場之後） */
    plpwr:     { sev: 'crit', text: (f, n) => `晶圓廠：${n || '電力不足'}`, hint: '主變壓器容量要大於需量（長期負載九成以下）；跳電後的製程區要重新開機、升溫、校正。最怕停電的區域接到 DUPS。', goto: 'plant:power' },
    plupw:     { sev: 'crit', text: () => '晶圓廠：超純水供應不足，黃光與 CMP / 濕式清洗停線', hint: 'RO（造水）與拋光機組（送水）的容量都要大於需求；純水泵的迴路要有電、不能反轉。', goto: 'plant:water' },
    plgas:     { sev: 'crit', text: () => '晶圓廠：特殊氣體或大宗氣體供應中斷', hint: '特殊氣體要有氣體偵測系統（GDS）才准供氣，GDS 主機要接在緊急電源；每一類氣體要有足夠的氣瓶櫃。', goto: 'plant:gas' },
    plexh:     { sev: 'crit', text: () => '晶圓廠：排氣或洗滌塔不足，機台連鎖停機', hint: '沒有排氣、洗滌塔處理不完，蝕刻、沉積、擴散、植入的機台都會連鎖停機（有毒廢氣不能排出去）。排氣風機與洗滌塔泵浦的迴路要正常。', goto: 'plant:gas' },
    plchem:    { sev: 'high', text: () => '晶圓廠：化學品或研磨液供應中斷', hint: '酸鹼、溶劑 / 顯影液、研磨液三套供應系統都要有，化學品泵浦的迴路要有電。CMP 與濕式清洗還要有廢水處理。', goto: 'plant:chem' },
    plcir:     { sev: 'high', text: (f, n) => `廠務配電盤 DP-UT1：${n || '有'} 個迴路跳脫`, hint: '跳脫的原因要先查清楚（斷路器太小？絕緣不良？），不要一直硬送電：到「廠務 → 配電盤」用鉤表、絕緣電阻計檢查。', goto: 'plant:panel' },
  };
  Ops.TK = TK;

  function openTicket(key, kind, fid, hintOverride, gotoOverride, arg) {
    const s = G.S;
    let t = s.tickets.find((x) => x.key === key && !x.resolvedAt);
    if (t) { t.clearSince = null; if (hintOverride) t.hint = hintOverride; return; }
    const d = TK[kind];
    t = { id: Q.nextId('t'), key, kind, fid, sev: d.sev, text: d.text(fid, arg), hint: hintOverride || d.hint, goto: gotoOverride || d.goto || (fid ? 'floor:' + fid : 'noc'), t: s.time, resolvedAt: null, clearSince: null };
    s.tickets.push(t);
    G.bus.emit('ticket', t);
  }

  Ops.monitor = () => {
    const s = G.S, sim = G.R.sim;
    if (!sim) return;
    const nms = Ops.nmsUp();
    const active = new Set();
    for (const f of G.BLD.floors) {
      const st = sim.floors[f.id];
      if (!st || st.present < 30) continue;
      const ft = G.FT[f.type];
      const key = (k) => f.id + ':' + k;
      const flag = (k, hint, go) => { active.add(key(k)); openTicket(key(k), k, f.id, hint, go); };
      if (!st.up) { flag('down'); continue; }
      if (st.flows.length && st.flows.every((x) => x.blocked === 'noroute')) {
        const building = Q.linksOf('F:' + f.id).some((l) => G.Net.linkBuilding(l));
        flag('isolated', building ? '上行主幹還在施工中，完工後就會恢復。' : null);
        continue;
      }
      /* 晶圓廠：不看登入網域、上網，看 MES / EAP / 工單 / FDC / 手持裝置，以及等不到交換器埠或等著掃毒的機台 */
      if (ft.fab) {
        const R = G.R.fab, c = G.Fab.counts(), fs = s.floors[f.id];
        const flagN = (k, n) => { active.add(key(k)); openTicket(key(k), k, f.id, null, null, n); };
        if (R && R.online > 0) {
          if (!R.mesUp) flag('fabmes');
          else {
            if (R.online - R.auto > 0) flagN('fabeap', R.online - R.auto);
            if (!R.erpOk) flag('faberp');
          }
          if (!R.engOk) flag('fabeng');
          if (R.fdcR < 0.5) flag('fabfdc');
          if (s.fab.phone === 'ban' && R.handR < 0.7) flag('fabhand');
        }
        if (c.ready > 0 && fs.cabling.status === 'done' && fs.idf.count > 0) flagN('fabport', c.ready);
        if (c.scan > 0 && !G.Fab.kioskReady()) flagN('fabscan', c.scan);
        /* 廠務（第十一章）：統包商撤場之後，供應不足就報修 */
        const PR = G.R.plant;
        if (PR && !PR.temp && R && R.online > 0) {
          const pw = PR.power;
          if (PR.tripped.length) flagN('plpwr', `${PR.tripped.map((a) => CAT.fab.areas[a].name).join('、')}跳電後重新開機中`);
          else if (!pw.normal) flagN('plpwr', '停電');
          else if (pw.shed < 1) flagN('plpwr', '主變壓器容量不足，製程區卸載');
          if (PR.water.ratio < 0.95 && PR.water.demand > 0) flag('plupw');
          if (G.Plant.SG.some((g) => PR.gas.sg[g].ratio < 0.95) || PR.gas.bulk < 0.95) flag('plgas');
          if (PR.gas.exh < 0.95 || PR.gas.scrub < 0.95) flag('plexh');
          if (PR.chem.acid < 0.95 || PR.chem.solv < 0.95 || PR.chem.slurry < 0.95 || PR.water.wwt < 0.95) flag('plchem');
          const tr = G.Panel.DEF.filter((x) => G.Panel.c(x.id).trip).length;
          if (tr) flagN('plcir', tr);
        }
        continue;
      }
      if (!st.adOk) flag('noad');
      const inet = st.flows.find((x) => x.kind === 'inet');
      if (inet && inet.blocked === 'fw') flag('fw');
      else if (inet && inet.blocked === 'dns') flag('dns');
      for (const fl of st.flows) {
        if (fl.kind !== 'intra' || !fl.blocked) continue;
        if (fl.role === 'file') flag('nofile', fl.blocked === 'fw' ? '內部分段後，防火牆擋下了 LAN → SERVERS：SMB。請新增允許規則。' : null, fl.blocked === 'fw' ? 'fw' : null);
        if (fl.role === 'db') flag('nodb', fl.blocked === 'fw' ? '內部分段後，防火牆擋下了 LAN → SERVERS：SQL。請新增允許規則。' : null, fl.blocked === 'fw' ? 'fw' : null);
      }
      if (st.portFrac < 0.98) flag('ports');
      if (st.dhcpWired < 1) flag('dhcpwired');
      if (st.wifi.unpowered > 0) flag('poe');
      if (ft.park) {
        /* 停車場：打卡、柵欄機、監視器 */
        if (st.parkers > 15 && G.Net.clockWindow(s.time) && st.clockOk < 0.85) flag('clockin');
        if (st.parkers > 15 && !st.gateOk) flag('gate');
        if (st.camOk < 1) flag('cam');
      } else if (st.wifiShare > 0.05 && st.wifi.cover < 0.85) flag('wificov');
      if (ft.dine && st.diners > 60 && (st.dinerRatio < 0.8 || st.wifi.gcover < 0.85)) flag('dinewifi');
      else if (st.wifiShare > 0.05 && st.capRatio < 0.8) flag('wificap');
      if (ft.pos && st.diners > 30 && !st.posOk) flag('pos');
      /* 廁所：沒衛生紙、太髒、馬桶堵住（有人在用的時段才會有人報修） */
      if (s.rest && s.rest.rooms[f.id]) {
        const rs = s.rest.rooms[f.id];
        const tail = G.Rest.hasIot(f.id) && !G.Rest.iotOk(f.id) ? `這層樓的智慧廁所連不到 IoT 管理平台（${G.Rest.iotWhy(f.id)}）：感測器的資料送不出去，清潔人員只能照固定路線巡。` : null;
        if (rs.some((r) => r.paper <= 0)) flag('wcpaper', tail);
        if (rs.some((r) => r.clean < 35)) flag('wcdirty', tail);
        if (rs.some((r) => r.clog)) flag('wcclog', tail);
      }
      const vr = G.R.voice;
      if (vr && vr.active && ft.voip) {
        if (!vr.pbxUp) flag('pbxdown');
        else if (st.mos !== undefined && st.mos !== null && st.mos < 3.6) flag('voip', `通話品質 MOS ${st.mos.toFixed(1)}（4 以上才算清楚）：語音對延遲、抖動與掉包非常敏感。${G.S.voice.qos ? '檢查這層樓的上行與核心是否壅塞。' : '到「系統 → 語音」啟用 QoS，讓語音封包優先通過。'}`, 'sys:voice');
      } else if (ft.voip && (st.lat > 40 || st.loss > 0.02)) flag('voip');
      if (st.thr < 0.75 && !st.blocked && st.adOk) {
        const b = nms ? Ops.bottleneck(f.id) : null;
        const hint = nms ? (b ? `瓶頸：${b.text}` : '網管系統沒有發現明顯瓶頸，可能是多處輕微壅塞。') : '原因不明 —— 沒有網管監控 (NMS)，你看不到瓶頸在哪裡。部署 NMS 伺服器後，監控中心會標出滿載的鏈路。';
        flag('slow', hint, b ? b.goto : (nms ? 'noc' : 'shop:srv'));
      }
    }
    if (sim.dhcp.wifi.need > sim.dhcp.wifi.pool && sim.users > 30) { active.add('wifi:dhcp'); openTicket('wifi:dhcp', 'dhcpwifi', null); }
    if (G.R.stor && G.R.stor.fileFull && sim.users > 30) { active.add('stor:file'); openTicket('stor:file', 'filefull', null); }
    /* 分支據點 */
    const WR = G.R.wan;
    if (WR) {
      for (const id of G.SITE_IDS) {
        const x = WR.sites[id];
        if (!x || !x.open || x.pres < 20) continue;
        const nm = G.SITES[id].name, key = 'site:' + id;
        if (!x.up) { active.add(key + ':down'); openTicket(key + ':down', 'sitedown', nm, null, 'wan:' + id); }
        else if (x.cls && x.cls.erp && (x.erpRtt > 110 || x.cls.erp.ratio < 0.8)) { active.add(key + ':slow'); openTicket(key + ':slow', 'siteslow', nm, x.lineStop ? '產線的 MES 查不到 ERP，生產線停擺中！先處理 WAN 線路（頻寬、備援、SD-WAN 選路）。' : null, 'wan:' + id); }
      }
    }
    const vr = G.R.voice;
    if (vr && vr.active && vr.pbxUp && vr.ext > 5 && vr.blocking > 0.05) { active.add('voice:trunk'); openTicket('voice:trunk', 'trunk', null, vr.channels ? null : '還沒有租外線（SIP 中繼）：到「系統 → 語音」申請。'); }

    /* 工單自動結案：狀況解除 10 分鐘後 */
    for (const t of s.tickets) {
      if (t.resolvedAt) continue;
      if (active.has(t.key)) { t.clearSince = null; continue; }
      if (t.clearSince === null) t.clearSince = s.time;
      if (s.time - t.clearSince >= 10) {
        t.resolvedAt = s.time;
        s.stats.ticketsResolved++;
        s.rating = Math.min(100, s.rating + 0.25);
        G.bus.emit('ticket', t);
      }
    }
    if (s.tickets.length > 150) {
      const keep = s.tickets.filter((t) => !t.resolvedAt || s.time - t.resolvedAt < 1440);
      s.tickets = keep.slice(-150);
    }

    /* 設施告警（大樓監控系統，一定看得到） */
    const fac = G.R.fac;
    if (fac) {
      if (s.temp >= 35) Ops.alert('crit', `機房溫度 ${s.temp.toFixed(1)}°C！設備故障風險急遽升高`, 'temp');
      else if (s.temp >= 29) Ops.alert('warn', `機房溫度偏高：${s.temp.toFixed(1)}°C（建議 < 27°C）`, 'temp');
      if (fac.onBattery) Ops.alert('warn', `市電中斷，機房由 UPS 供電（剩餘 ${Math.round(s.power.upsCharge * 100)}%）`, 'ups');
      if (fac.genRunning) Ops.alert('info', '發電機運轉中', 'gen');
      if (fac.coolCap > 0 && fac.heat > fac.coolCap * 0.9) Ops.alert('warn', `冷卻能力接近上限（熱負載 ${fac.heat.toFixed(1)} kW / 冷卻 ${fac.coolCap} kW）`, 'cool');
      for (const id in fac.racks) {
        const r = fac.racks[id];
        if (r.load > r.limit * 0.85 && r.load <= r.limit) Ops.alert('warn', r.ai ? `AI 機櫃 ${id} 用電 ${(r.load / 1000).toFixed(1)} kW，接近電源櫃容量 ${(r.limit / 1000).toFixed(1)} kW` : `機櫃 ${id} 用電 ${(r.load / 1000).toFixed(1)} kW，接近 8 kW 上限`, 'rack:' + id);
        else if (r.ai && r.load > 0 && r.load > r.n1 && r.load <= r.limit) Ops.alert('warn', `AI 機櫃 ${id} 的電源櫃沒有 N+1 備援：壞一個 PSU 就會跳電`, 'n1:' + id);
      }
      /* 環控：有 EMS 才看得到濕度與漏液 */
      if (fac.ems && s.hum > 65) Ops.alert('warn', `機房濕度 ${Math.round(s.hum)}%：有結露風險（建議 40～60%）`, 'hum');
      if (fac.onBBU) Ops.alert('warn', '市電中斷，AI 機櫃由 BBU 電池供電', 'bbu');
      if (fac.liquidHeat > 0 && fac.thermal < 0.98) Ops.alert('crit', `液冷容量不足：GPU 發熱 ${fac.liquidHeat.toFixed(1)} kW / CDU ${fac.cduCap} kW，GPU 降頻中`, 'cdu');
    }
    /* 網路告警（需要 NMS） */
    if (nms) {
      for (const l of Object.values(s.links)) {
        const ls = sim.links[l.id];
        if (l.status === 'cut') Ops.alert('crit', `線路中斷：${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)}`, 'cut:' + l.id);
        else if (ls && ls.util >= 0.9) Ops.alert('warn', `鏈路壅塞：${Q.nodeName(l.a)} ⇄ ${Q.nodeName(l.b)} 使用率 ${U.pct(ls.util)}`, 'link:' + l.id);
      }
      for (const c of s.isp) {
        const is = sim.isp[c.id];
        if (is && is.up && is.util >= 0.9) Ops.alert('warn', `WAN 壅塞：${CAT.isp.providers[c.provider].name} ${c.plan} 使用率 ${U.pct(is.util)}`, 'isp:' + c.id);
        if (c.outage) Ops.alert('crit', `ISP 線路中斷：${CAT.isp.providers[c.provider].name} ${c.plan}`, 'ispdown:' + c.id);
      }
      for (const id in sim.nodes) {
        const n = sim.nodes[id];
        if (n.util >= 0.9) Ops.alert('warn', `${Q.nodeName(id)} 處理量 ${U.pct(n.util)}，效能不足`, 'node:' + id);
      }
      for (const d of Object.values(s.devices)) {
        if (!d.rack || CAT.infra(CAT.devices[d.model])) continue;
        if (d.status === 'failed') Ops.alert('crit', `設備故障：${d.name}`, 'dev:' + d.id);
      }
    }
  };
})(window.G = window.G || {});
