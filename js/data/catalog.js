/* 設備型錄、線材、光模組、ISP 方案、資安服務
 * 價格為遊戲化的新台幣參考值；規格簡化但保留真實世界的相對關係。
 * unlock = 劇情模式第幾章起可購買（沙盒模式全部開放）
 */
(function (G) {
  'use strict';
  const CAT = {};
  G.CAT = CAT;

  CAT.categories = {
    router:   { name: '路由器', en: 'Router', color: '#8f7cf0' },
    firewall: { name: '防火牆', en: 'Firewall', color: '#f06a5a' },
    switch:   { name: '交換器', en: 'Switch', color: '#2fc6b8' },
    server:   { name: '伺服器', en: 'Server', color: '#5aa9f0' },
    wlc:      { name: '無線控制器', en: 'WLC', color: '#e6a23c' },
    ups:      { name: '機架式 UPS', en: 'UPS', color: '#9aa7ad' },
    power:    { name: '電源櫃', en: 'Power Shelf', color: '#f2c14e' },
    bbu:      { name: '電池備援', en: 'BBU', color: '#e86fa8' },
    storage:  { name: '儲存設備', en: 'Storage', color: '#c39b6a' },
  };
  /** 不是網路設備（沒有連接埠、不出現在拓撲圖）：UPS、電源櫃、BBU、儲存擴充櫃（接在 SAN 後面） */
  CAT.infra = (m) => m.cat === 'ups' || m.cat === 'power' || m.cat === 'bbu' || !!m.shelf;

  /* 開機時間（遊戲分鐘） */
  CAT.bootMin = { router: 5, firewall: 8, switch: 4, server: 10, wlc: 6, ups: 1, power: 1, bbu: 1, storage: 8 };

  /* ---------- 機房設備（安裝在 B1 機櫃中） ----------
   * ports: rj45 = 1G 銅纜埠；sfp = SFP+/SFP28 光纖埠（上限 sfpMax）；qsfp = 40/100G 埠
   */
  CAT.devices = {
    /* 路由器 */
    'NR-1100': { cat: 'router', name: 'NR-1100 分支路由器', price: 85000, u: 1, watts: 60, thr: 1000,
      ports: { rj45: 4, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, multiWan: 'failover', unlock: 1,
      desc: '小型辦公室等級。路由/NAT 效能約 1 Gbps；多條 ISP 只能「主備援」，無法同時使用。' },
    'NR-5500': { cat: 'router', name: 'NR-5500 企業邊界路由器', price: 480000, u: 2, watts: 350, thr: 20000,
      ports: { rj45: 2, sfp: 8, qsfp: 2 }, sfpMax: 25000, qsfpMax: 100000, multiWan: 'bgp', unlock: 1,
      desc: '企業等級，路由效能 20 Gbps，支援 BGP，可同時使用多家 ISP 並負載分擔。' },
    'NR-9000': { cat: 'router', name: 'NR-9000 骨幹路由器', price: 2200000, u: 4, watts: 1200, thr: 100000,
      ports: { rj45: 2, sfp: 16, qsfp: 8 }, sfpMax: 25000, qsfpMax: 100000, multiWan: 'bgp', unlock: 4,
      desc: '電信等級骨幹路由器，100 Gbps 路由效能，適合大型企業或資料中心出口。' },

    /* 防火牆（NGFW） */
    'SG-300': { cat: 'firewall', name: 'SG-300 次世代防火牆', price: 160000, u: 1, watts: 80, fw: 2000, ips: 800,
      ports: { rj45: 8, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, unlock: 1,
      desc: '防火牆吞吐 2 Gbps；開啟 IPS 深度檢測後只剩約 800 Mbps。' },
    'SG-3000': { cat: 'firewall', name: 'SG-3000 企業防火牆', price: 1100000, u: 2, watts: 450, fw: 20000, ips: 9000,
      ports: { rj45: 8, sfp: 12, qsfp: 2 }, sfpMax: 25000, qsfpMax: 100000, unlock: 1,
      desc: '防火牆吞吐 20 Gbps；開啟 IPS 後約 9 Gbps。支援 HA 高可用配對。' },
    'SG-9000': { cat: 'firewall', name: 'SG-9000 資料中心防火牆', price: 4200000, u: 3, watts: 1100, fw: 80000, ips: 32000,
      ports: { rj45: 4, sfp: 16, qsfp: 8 }, sfpMax: 25000, qsfpMax: 100000, unlock: 4,
      desc: '防火牆吞吐 80 Gbps；開啟 IPS 後約 32 Gbps。萬人規模的邊界防護。' },

    /* 交換器 */
    'CX-3200': { cat: 'switch', layer: 3, name: 'CX-3200 小型 L3 交換器', price: 180000, u: 1, watts: 150,
      ports: { rj45: 24, sfp: 8, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, unlock: 1,
      desc: '24 個 1G 銅纜埠 + 8 個 10G 光纖埠，具備 L3 路由能力，適合小型核心。' },
    'CX-6400': { cat: 'switch', layer: 3, name: 'CX-6400 企業核心交換器', price: 750000, u: 1, watts: 450,
      ports: { rj45: 0, sfp: 48, qsfp: 8 }, sfpMax: 25000, qsfpMax: 100000, unlock: 1,
      desc: '48 個 25G + 8 個 100G 光纖埠。中大型企業的 L3 核心交換器。' },
    'CX-9600': { cat: 'switch', layer: 3, name: 'CX-9600 模組化核心交換器', price: 3600000, u: 7, watts: 2600,
      ports: { rj45: 0, sfp: 96, qsfp: 32 }, sfpMax: 25000, qsfpMax: 100000, unlock: 4,
      desc: '機箱式核心：96 個 25G + 32 個 100G。高埠數、高背板容量。' },
    'DX-2400': { cat: 'switch', layer: 2, name: 'DX-2400 伺服器 / DMZ 交換器', price: 120000, u: 1, watts: 120,
      ports: { rj45: 24, sfp: 4, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, unlock: 1,
      desc: '24 個 1G + 4 個 10G。常用於 DMZ 或小型伺服器區。' },
    'DX-4800': { cat: 'switch', layer: 2, name: 'DX-4800 資料中心 ToR 交換器', price: 520000, u: 1, watts: 380,
      ports: { rj45: 0, sfp: 48, qsfp: 6 }, sfpMax: 25000, qsfpMax: 100000, unlock: 3,
      desc: '機櫃頂端 (Top-of-Rack) 交換器：48 個 25G + 6 個 100G，讓大量伺服器高速接入。' },

    /* 伺服器（角色在安裝後設定） */
    'SV-1U': { cat: 'server', name: 'SV-1U 通用伺服器', price: 220000, u: 1, watts: 350,
      ports: { rj45: 2, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, roles: ['ad', 'web', 'nms', 'db', 'pbx', 'vscan', 'upd', 'iot', 'eap', 'jump', 'fmcs'], unlock: 1,
      desc: '1U 雙路伺服器，2 × 10G 網卡。可擔任 AD/DNS/DHCP、網站、網管、資料庫，以及電話交換機、弱點掃描、更新派送。' },
    'SV-2U': { cat: 'server', name: 'SV-2U 高效能伺服器', price: 520000, u: 2, watts: 750,
      ports: { rj45: 2, sfp: 2, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, roles: ['ad', 'web', 'nms', 'db', 'siem', 'vscan', 'upd', 'iot', 'mes', 'eap', 'fdc', 'jump', 'fmcs'], unlock: 1,
      desc: '2U 高效能伺服器，2 × 25G 網卡。可擔任 SIEM 等重負載角色。' },
    'ST-4U': { cat: 'server', name: 'ST-4U 儲存伺服器', price: 980000, u: 4, watts: 900, rawTB: 192,
      ports: { rj45: 2, sfp: 4, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, roles: ['file', 'backup'], unlock: 2,
      desc: '4U 大容量儲存 (NAS)，24 × 8 TB 硬碟（原始 192 TB），4 × 25G 網卡。擔任檔案伺服器或備份伺服器。' },

    /* 無線控制器 */
    'WC-500': { cat: 'wlc', name: 'WC-500 無線控制器', price: 380000, u: 1, watts: 150, maxAps: 250,
      ports: { rj45: 2, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, unlock: 2,
      desc: '集中管理最多 250 台 AP：自動頻道規劃 (RRM)、無縫漫遊、非法 AP 偵測。' },
    'WC-3000': { cat: 'wlc', name: 'WC-3000 大型無線控制器', price: 1200000, u: 2, watts: 400, maxAps: 1500,
      ports: { rj45: 2, sfp: 4, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, unlock: 4,
      desc: '集中管理最多 1,500 台 AP，適合萬人規模。' },

    /* 機架式 UPS */
    'UPS-10K': { cat: 'ups', name: 'UPS-10K 機架式不斷電系統', price: 190000, u: 5, watts: 0, capW: 9000, runtime: 10,
      ports: { rj45: 0, sfp: 0, qsfp: 0 }, unlock: 1,
      desc: '10 kVA（約 9 kW），滿載可撐約 10 分鐘。停電時讓設備不中斷。' },

    /* ---------- AI 運算（第六章）：ai = 在「AI 運算」採購頁；aiRack = 只能裝在 AI 機櫃 ---------- */
    'GX-8': { cat: 'server', ai: true, aiRack: true, name: 'GX-8 AI 訓練伺服器（8 × GPU）', price: 9800000, u: 8, watts: 10200, gpu: 8, pf: 16, liquid: 0.8,
      ports: { rj45: 0, sfp: 2, qsfp: 8 }, sfpMax: 25000, qsfpMax: 400000, roles: ['ai'], unlock: 6,
      desc: '8 顆資料中心 GPU 以 NVLink 互連。單台約 10 kW，GPU 用直接液冷；每顆 GPU 配一張 400G 網卡接 AI 後端網路。只能裝在 AI 機櫃。' },
    'GX-4': { cat: 'server', ai: true, name: 'GX-4 AI 推論伺服器（4 × GPU）', price: 2600000, u: 4, watts: 3200, gpu: 4, pf: 4, liquid: 0,
      ports: { rj45: 0, sfp: 2, qsfp: 2 }, sfpMax: 25000, qsfpMax: 400000, roles: ['ai'], unlock: 6,
      desc: '4 顆推論用 GPU、氣冷、3.2 kW：一般機櫃也放得下（一座最多兩台）。適合跑企業內部的 AI 助理。' },
    'ST-AI': { cat: 'server', ai: true, name: 'ST-AI 全快閃 AI 儲存', price: 3600000, u: 2, watts: 1500,
      ports: { rj45: 0, sfp: 0, qsfp: 4 }, sfpMax: 0, qsfpMax: 400000, roles: ['aistore'], unlock: 6,
      desc: '24 顆 NVMe SSD、4 × 400G。訓練時 GPU 要不停讀取資料，儲存太慢 GPU 就只能空等。' },
    'AF-6400': { cat: 'switch', layer: 2, ai: true, name: 'AF-6400 AI 後端交換器（64 × 400G）', price: 4800000, u: 2, watts: 2200,
      ports: { rj45: 0, sfp: 0, qsfp: 64 }, sfpMax: 0, qsfpMax: 400000, unlock: 6,
      desc: '51.2 Tbps 的 AI 叢集交換器，支援 RoCE 無損乙太網路。GPU 之間同步參數的流量走這張「後端網路」，不經過企業核心。' },
    'PS-33': { cat: 'power', ai: true, aiRack: true, name: 'PS-33 電源櫃（6 × 5.5 kW PSU）', price: 420000, u: 1, watts: 0, psuN: 6, psuW: 5500,
      ports: { rj45: 0, sfp: 0, qsfp: 0 }, unlock: 6,
      desc: 'AI 機櫃的電源：把市電 AC 轉成 54V 直流，經機櫃背面的銅排（busbar）供電給每台伺服器。6 個 PSU 可熱插拔，要留一個當備援（N+1）。' },
    'BBU-6': { cat: 'bbu', ai: true, aiRack: true, name: 'BBU-6 電池備援櫃（6 × 3 kW）', price: 380000, u: 1, watts: 0, bbuW: 18000, holdMin: 4,
      ports: { rj45: 0, sfp: 0, qsfp: 0 }, unlock: 6,
      desc: '鋰電池模組直接掛在 54V 匯流排上：停電時瞬間接手，撐到發電機啟動（約 1 分鐘）。18 kW 滿載約 4 分鐘，負載越輕撐越久。' },

    /* ---------- 電話語音（第七章）：在「採購 → 系統」 ---------- */
    'PX-500': { cat: 'server', sys: true, name: 'PX-500 IP 電話交換機（IP-PBX）', price: 680000, u: 1, watts: 150,
      ports: { rj45: 4, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, roles: ['pbx'], unlock: 7,
      desc: '企業總機：最多 3,000 支分機註冊、客服中心排隊與錄音（ACD / IVR）。專用硬體、雙電源，也可以改用 VM。' },
    'SBC-2': { cat: 'server', sys: true, name: 'SBC-2 語音邊界控制器', price: 420000, u: 1, watts: 120,
      ports: { rj45: 4, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, roles: ['sbc'], unlock: 7,
      desc: 'Session Border Controller：放在 DMZ，替電話交換機對接電信業者的 SIP 中繼。只接受電信業者的連線、隱藏內部架構、擋掉盜打與 SIP 掃描。' },

    /* ---------- 廣域網路（第七章） ---------- */
    'SDW-HUB': { cat: 'server', sys: true, name: 'SDW-1 SD-WAN 集中器', price: 560000, u: 1, watts: 200,
      ports: { rj45: 4, sfp: 4, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, roles: ['sdwan'], unlock: 7,
      desc: '總部端的 SD-WAN 集中器（Hub）：各據點的 SD-WAN 設備透過網際網路建立加密隧道連回這裡。一般放在 DMZ，由防火牆保護。' },

    /* ---------- 虛擬化與儲存（第八章）：在「採購 → 系統」 ---------- */
    'HV-2U': { cat: 'server', hv: true, sys: true, name: 'HV-2U 虛擬化主機', price: 780000, u: 2, watts: 900, vcpu: 256, ram: 1024,
      ports: { rj45: 2, sfp: 4, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, roles: [], unlock: 8,
      desc: '雙路 64 核、1 TB 記憶體、4 × 25G 網卡。裝好 Hypervisor 就能同時跑十幾台虛擬機（VM）；兩台以上組成叢集、搭配共用儲存（SAN），主機故障時 VM 會自動在別台重啟（HA）。' },
    'VM': { cat: 'server', virtual: true, name: '虛擬機（VM）', price: 0, u: 0, watts: 0,
      ports: { rj45: 0, sfp: 0, qsfp: 0 }, sfpMax: 0, qsfpMax: 0, roles: ['ad', 'web', 'db', 'nms', 'siem', 'file', 'backup', 'pbx', 'sbc', 'sdwan', 'vscan', 'upd', 'iot', 'mes', 'eap', 'fdc', 'jump'], unlock: 8,
      desc: '跑在虛擬化主機上的伺服器：幾分鐘就能建好一台，不佔機櫃、不用另外買硬體。' },
    'SAN-5K': { cat: 'storage', san: true, sys: true, name: 'SAN-5K 全快閃儲存陣列', price: 5200000, u: 2, watts: 800, rawTB: 92, flash: true,
      ports: { rj45: 2, sfp: 8, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, unlock: 8,
      desc: '雙控制器、24 顆 NVMe SSD（原始 92 TB），8 × 25G iSCSI。虛擬化叢集的共用儲存：VM 的硬碟都放這裡，任何一台主機都讀得到，HA 才做得到。' },
    'DS-24': { cat: 'storage', shelf: true, sys: true, name: 'DS-24 擴充櫃（大容量硬碟）', price: 1600000, u: 4, watts: 450, rawTB: 384,
      ports: { rj45: 0, sfp: 0, qsfp: 0 }, sfpMax: 0, qsfpMax: 0, unlock: 8,
      desc: '24 顆 16 TB 大容量硬碟（原始 384 TB），以 SAS 線接在 SAN 後面擴充容量。便宜、容量大，但比全快閃慢，硬碟越大 RAID 重建越久。' },
    'TL-48': { cat: 'storage', tape: true, sys: true, name: 'TL-48 磁帶櫃（LTO-9）', price: 1200000, u: 4, watts: 300, tapeTB: 18, slots: 48,
      ports: { rj45: 1, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, unlock: 8,
      desc: '48 格磁帶槽、2 台 LTO-9 磁帶機（每捲 18 TB）。磁帶可以退出來送到異地保存：離線、便宜、放十幾年，勒索軟體也加密不到。' },
  };

  /* ---------- 機房設施（非機櫃設備） ---------- */
  CAT.room = {
    'AC-8':    { kind: 'cooling', name: '一般辦公空調 8kW', coolKW: 8, price: 0, powerKW: 3, buyable: false,
      desc: '大樓內建的舒適型空調，並非為機房設計。' },
    'CRAC-25': { kind: 'cooling', name: '精密空調 CRAC-25', coolKW: 25, price: 850000, powerKW: 9, unlock: 1, buildMin: 240,
      desc: '機房專用精密空調，25 kW 冷卻能力，控制溫濕度。' },
    'CRAC-60': { kind: 'cooling', name: '精密空調 CRAC-60', coolKW: 60, price: 1900000, powerKW: 20, unlock: 4, buildMin: 360,
      desc: '60 kW 冷卻能力的大型精密空調。' },
    'UPS-80K': { kind: 'ups', name: '模組化 UPS 80kVA', capW: 72000, runtime: 15, price: 1650000, powerKW: 0, unlock: 4, buildMin: 240,
      desc: '機房級不斷電系統，約 72 kW，滿載約 15 分鐘。' },
    'GEN-250': { kind: 'generator', name: '柴油發電機 250kVA', capW: 200000, price: 2600000, powerKW: 0, unlock: 4, buildMin: 480,
      desc: '市電中斷約 1 分鐘後自動啟動，可長時間供電（含空調）。需搭配 UPS 撐過啟動空窗。' },
    /* 消防：每種各一套 */
    'VESDA': { kind: 'fire', name: '極早期偵煙系統 VESDA', price: 480000, powerKW: 0, unlock: 3, buildMin: 180,
      desc: '抽氣式偵煙：取樣管不停抽機房空氣檢測微粒，設備過熱「還只是冒煙」時就告警，比一般偵煙器早幾十分鐘，來得及在起火前處理。' },
    'PREACT': { kind: 'fire', name: '預動式灑水系統', price: 650000, powerKW: 0, unlock: 3, buildMin: 360,
      desc: '平時管內沒有水，要「偵煙器動作」加上「灑水頭受熱破裂」兩個條件才放水：管線被撞或滲漏不會淹機房，起火時也只在火源區放水。' },
    'GAS-FS': { kind: 'fire', name: '潔淨氣體滅火系統', price: 1900000, powerKW: 0, unlock: 4, buildMin: 480, refill: 350000,
      desc: '以惰性氣體 / 潔淨藥劑滅火：不導電、不留殘渣，設備不會泡水。釋放前警報並延遲 30 秒讓人員撤離，機房要保持密閉。' },
    /* 環控 */
    'EMS-1': { kind: 'ems', name: '機房環境監控系統（EMS）', price: 380000, powerKW: 0.2, unlock: 3, buildMin: 120,
      desc: '溫濕度感測器、漏水偵測線、煙霧、門禁與電力監測，一有異常就發簡訊告警。沒有它，往往要等設備出事才知道。' },
    /* 空調效率 */
    'CONTAIN': { kind: 'contain', name: '冷熱通道封閉', price: 420000, powerKW: 0, unlock: 3, buildMin: 240,
      desc: '用門板與頂板把冷通道（或熱通道）封起來，冷風不再和熱風混在一起：同樣的空調能多帶走約 20% 的熱，也更省電（PUE 下降）。' },
    /* AI 液冷 */
    'CDU-100': { kind: 'cdu', name: '液冷分配單元 CDU-100', coolKW: 100, price: 2400000, powerKW: 4, unlock: 6, buildMin: 360,
      desc: '把冷卻液送進 AI 伺服器 GPU 上的冷板（直接液冷），一台帶走 100 kW 的熱。AI 機櫃動輒 40 kW 以上，光靠空調吹不涼。' },
    /* 門禁（實體安全）：沒有門禁時，機房只有一把鑰匙 */
    'ACS-CARD': { kind: 'access', name: '感應卡門禁系統', price: 180000, powerKW: 0.1, unlock: 1, buildMin: 180, level: 1,
      desc: '讀卡機 + 電磁鎖 + 門禁紀錄：每個人用自己的卡、每次進出都有紀錄，權限可以依人員設定、離職時立刻停用。' },
    'ACS-MFA': { kind: 'access', name: '雙因子門禁 + 防尾隨雙門', price: 950000, powerKW: 0.3, unlock: 3, buildMin: 480, level: 2,
      desc: '感應卡 + 指紋雙因子驗證，搭配兩道互鎖的門（mantrap）：第一道門關上、第二道門才會開，一次只能進一個人，杜絕尾隨；門口加裝監視器錄影。' },
  };
  CAT.roomSlots = { cooling: 5, ups: 4, generator: 1, fire: 3, ems: 1, contain: 1, cdu: 3, access: 2 };
  CAT.rack = { price: 55000, units: 42, powerLimit: 8000, maxRacks: 24,
    ai: { price: 380000, max: 4, unlock: 6, name: 'ORv3 AI 機櫃', desc: '寬機櫃、背面有 54V 銅排（busbar）與液冷歧管。沒有 PDU：電力由你裝進去的電源櫃（PSU）決定。' } };
  /** 送風溫度設定（°C）：越高越省電、但出事時升溫得越快 */
  CAT.coolSets = [18, 21, 24];

  /* ---------- 樓層 IDF 接入交換器 ---------- */
  CAT.access = {
    'AX-24P': { name: 'AX-24P 接入交換器', price: 52000, ports: 24, portSpeed: 1000, poe: 370, uplinks: 4, uplinkMax: 10000, watts: 45, unlock: 1,
      desc: '24 × 1G PoE+ (總 370W)，4 × 10G 上行埠。' },
    'AX-48P': { name: 'AX-48P 接入交換器', price: 95000, ports: 48, portSpeed: 1000, poe: 740, uplinks: 4, uplinkMax: 10000, watts: 70, unlock: 1,
      desc: '48 × 1G PoE+ (總 740W)，4 × 10G 上行埠。最常見的樓層接入交換器。' },
    'AX-48M': { name: 'AX-48M mGig 接入交換器', price: 210000, ports: 48, portSpeed: 5000, poe: 1440, uplinks: 4, uplinkMax: 25000, watts: 110, unlock: 2,
      desc: '48 × mGig (最高 5G) PoE++ (總 1,440W)，4 × 25G 上行埠。Wi-Fi 6E/7 AP 需要超過 1G 的上行。' },
  };

  /* ---------- 無線基地台 ----------
   * cap = 實際可用總吞吐 (Mbps)；maxClients = 建議同時連線數
   */
  CAT.aps = {
    'AP-500':  { name: 'AP-500 (Wi-Fi 5)', gen: 'Wi-Fi 5', price: 12000, cap: 350, maxClients: 35, poe: 13, tx: 20, band: 'std', unlock: 1,
      desc: '802.11ac Wave 2。便宜，但容量與同時連線數有限。' },
    'AP-600':  { name: 'AP-600 (Wi-Fi 6)', gen: 'Wi-Fi 6', price: 24000, cap: 750, maxClients: 70, poe: 20, tx: 20, band: 'std', unlock: 1,
      desc: '802.11ax，OFDMA 讓高密度環境效率更好。' },
    'AP-610E': { name: 'AP-610E (Wi-Fi 6E)', gen: 'Wi-Fi 6E', price: 38000, cap: 1100, maxClients: 90, poe: 24, tx: 20, band: 'ext', unlock: 2,
      desc: '多了 6 GHz 頻段，可用頻道變多、同頻干擾大幅降低。上行建議 mGig。' },
    'AP-700':  { name: 'AP-700 (Wi-Fi 7)', gen: 'Wi-Fi 7', price: 58000, cap: 2200, maxClients: 120, poe: 30, tx: 21, band: 'ext', unlock: 4,
      desc: '802.11be，多鏈路 (MLO)。需要 mGig 交換器才能發揮效能。' },
  };
  CAT.apInstallFee = 3000;
  /* 5 GHz 20/40 MHz 不重疊頻道；Wi-Fi 6E/7 另可使用 6 GHz 頻道 */
  CAT.channels = {
    std: ['36', '40', '44', '48', '149', '153', '157', '161'],
    ext: ['36', '40', '44', '48', '149', '153', '157', '161', '6G-5', '6G-21', '6G-37', '6G-53', '6G-69', '6G-85', '6G-101', '6G-117'],
  };

  /* ---------- 線材與光模組 ---------- */
  CAT.speeds = [1000, 10000, 25000, 40000, 100000, 400000];
  CAT.cables = {
    cat6:  { name: 'Cat6 銅纜', short: 'Cat6', medium: 'copper', perM: 25, termCost: 300, color: '#4f86e8',
      max: { 1000: 100, 10000: 55 }, desc: '最常見的網路線。1G 可跑 100m；10G 只能跑 55m。' },
    cat6a: { name: 'Cat6A 銅纜', short: 'Cat6A', medium: 'copper', perM: 45, termCost: 400, color: '#7aa2f7',
      max: { 1000: 100, 10000: 100 }, desc: '強化屏蔽，10G 可跑滿 100m。銅纜最長就是 100m。' },
    om4:   { name: 'OM4 多模光纖', short: 'OM4', medium: 'mmf', perM: 70, termCost: 2000, color: '#2fc6b8',
      max: { 1000: 550, 10000: 400, 25000: 100, 40000: 150, 100000: 100, 400000: 100 }, desc: '水藍色外皮。短距離高速首選，光模組便宜；但 100G / 400G 只能跑 100m。' },
    os2:   { name: 'OS2 單模光纖', short: 'OS2', medium: 'smf', perM: 40, termCost: 2500, color: '#f2c14e',
      max: { 1000: 10000, 10000: 10000, 25000: 10000, 40000: 10000, 100000: 10000, 400000: 2000 }, desc: '黃色外皮。可傳 10 公里以上（400G FR4 約 2 公里），線便宜但光模組較貴。' },
  };
  /* 每一端的光模組 / 模組價格 */
  CAT.optics = {
    copper: { 1000: 1000, 10000: 4500 },
    mmf:    { 1000: 1500, 10000: 2800, 25000: 4800, 40000: 9500, 100000: 22000, 400000: 68000 },
    smf:    { 1000: 2500, 10000: 6000, 25000: 11000, 40000: 28000, 100000: 52000, 400000: 120000 },
  };
  CAT.opticName = {
    copper: { 1000: '1000BASE-T', 10000: '10GBASE-T' },
    mmf: { 1000: '1000BASE-SX', 10000: '10GBASE-SR', 25000: '25GBASE-SR', 40000: '40GBASE-SR4', 100000: '100GBASE-SR4', 400000: '400GBASE-SR8' },
    smf: { 1000: '1000BASE-LX', 10000: '10GBASE-LR', 25000: '25GBASE-LR', 40000: '40GBASE-LR4', 100000: '100GBASE-LR4', 400000: '400GBASE-FR4' },
  };
  CAT.riserBuildMin = 120;   /* 跨樓層垂直主幹佈線施工時間 */
  /* DAC 直連銅纜：兩端直接做成模組的銅纜，便宜、省電，但只能接同一座機櫃內（最長約 5 m）。
   * 只在「實體接線」使用（pick: false：拓撲的快速連線不列出） */
  CAT.cables.dac = { name: 'DAC 直連銅纜', short: 'DAC', medium: 'dac', perM: 0, termCost: 0, color: '#3b4046', pick: false,
    max: { 10000: 5, 25000: 5, 40000: 5, 100000: 5, 400000: 3 }, desc: '兩端直接做成 SFP / QSFP 模組的銅纜：不用另外買光模組，便宜又省電，但最長只有 3～5 m，只能接同一座機櫃裡的設備。' };

  /* ---------- 實體接線：光模組（插在 SFP / QSFP 埠上）與跳線 ----------
   * SR / SX = 多模光纖（850 nm，模組拉環黑色）、LR / LX / FR = 單模光纖（1310 nm，拉環藍色）；
   * 兩端的模組要同一種（同速率、同波長），跳線的光纖種類要和模組相同；-T 是插網路線的電口模組。
   * conn = 接頭：LC（雙芯）、MPO（多芯，40G / 100G / 400G 的 SR4 / SR8）、RJ45 */
  CAT.xcvr = {
    '1G-T':     { name: '1000BASE-T 電口模組', form: 'sfp', speed: 1000, media: 'copper', conn: 'rj45', price: 1000 },
    '10G-T':    { name: '10GBASE-T 電口模組', form: 'sfp', speed: 10000, media: 'copper', conn: 'rj45', price: 4500 },
    '1G-SX':    { name: '1000BASE-SX', form: 'sfp', speed: 1000, media: 'mmf', wl: 850, conn: 'lc', price: 1500 },
    '1G-LX':    { name: '1000BASE-LX', form: 'sfp', speed: 1000, media: 'smf', wl: 1310, conn: 'lc', price: 2500 },
    '10G-SR':   { name: '10GBASE-SR', form: 'sfp', speed: 10000, media: 'mmf', wl: 850, conn: 'lc', price: 2800 },
    '10G-LR':   { name: '10GBASE-LR', form: 'sfp', speed: 10000, media: 'smf', wl: 1310, conn: 'lc', price: 6000 },
    '25G-SR':   { name: '25GBASE-SR', form: 'sfp', speed: 25000, media: 'mmf', wl: 850, conn: 'lc', price: 4800 },
    '25G-LR':   { name: '25GBASE-LR', form: 'sfp', speed: 25000, media: 'smf', wl: 1310, conn: 'lc', price: 11000 },
    '40G-SR4':  { name: '40GBASE-SR4', form: 'qsfp', speed: 40000, media: 'mmf', wl: 850, conn: 'mpo', price: 9500 },
    '40G-LR4':  { name: '40GBASE-LR4', form: 'qsfp', speed: 40000, media: 'smf', wl: 1310, conn: 'lc', price: 28000 },
    '100G-SR4': { name: '100GBASE-SR4', form: 'qsfp', speed: 100000, media: 'mmf', wl: 850, conn: 'mpo', price: 22000 },
    '100G-LR4': { name: '100GBASE-LR4', form: 'qsfp', speed: 100000, media: 'smf', wl: 1310, conn: 'lc', price: 52000 },
    '400G-SR8': { name: '400GBASE-SR8', form: 'qsfp', speed: 400000, media: 'mmf', wl: 850, conn: 'mpo', price: 68000 },
    '400G-FR4': { name: '400GBASE-FR4', form: 'qsfp', speed: 400000, media: 'smf', wl: 1310, conn: 'lc', price: 120000 },
  };
  /* 跳線（機房內接設備用）。cable = 對應到線路的線材種類 */
  CAT.cords = {
    'cat6':    { name: 'Cat6 網路跳線', short: 'Cat6', media: 'copper', conn: 'rj45', cable: 'cat6', color: '#4f86e8', price: 150 },
    'cat6a':   { name: 'Cat6A 網路跳線', short: 'Cat6A', media: 'copper', conn: 'rj45', cable: 'cat6a', color: '#7aa2f7', price: 260 },
    'om4':     { name: 'OM4 多模光纖跳線（LC-LC）', short: 'OM4 LC', media: 'mmf', conn: 'lc', cable: 'om4', color: '#2fc6b8', price: 900 },
    'om4-mpo': { name: 'OM4 多模 MPO-12 跳線', short: 'OM4 MPO', media: 'mmf', conn: 'mpo', cable: 'om4', color: '#8fe0d8', price: 3200 },
    'os2':     { name: 'OS2 單模光纖跳線（LC-LC）', short: 'OS2 LC', media: 'smf', conn: 'lc', cable: 'os2', color: '#f2c14e', price: 800 },
    'dac':     { name: 'DAC 直連銅纜（兩端內建模組）', short: 'DAC', media: 'dac', conn: 'dac', cable: 'dac', color: '#3b4046', price: 1200, priceBy: { 10000: 1200, 25000: 1800, 40000: 3200, 100000: 4500, 400000: 12000 } },
  };
  /** 實體接線每個動作要花的遊戲時間（分鐘）：割接的維護窗口內會真的扣時間 */
  CAT.physMin = { plug: 1, unplug: 1, module: 1, flip: 1, label: 1, trace: 5, config: 2 };

  /* ---------- 廁所與清潔（js/sim/restroom.js） ----------
   * 清潔人員是外包合約（白班 07:00–22:00，夜班由清潔公司負責）；衛生紙與洗手乳依使用次數計費。
   * 智慧廁所：每層一台 IoT 閘道器（LoRaWAN / BLE 感測器 → 乙太網路，PoE 供電）+ 每間廁所一組感測器 */
  CAT.rest = {
    wage: 38000, maxStaff: 40, usePrice: 0.35, unlock: 2,
    iotGw: { name: 'IoT 閘道器（PoE）', price: 12000, poe: 8 },
    iotKit: { name: '智慧廁所感測器組（門口人流計數、衛生紙 / 洗手乳存量、異味、漏水）', price: 9000 },
  };

  /* ---------- 晶圓廠（第十章，js/sim/fab.js） ----------
   * 機台由公司採購、原廠來裝機；IT 要做的是讓每一台都安全地連上網路：進廠掃毒 → 接上交換器 → 由 EAP 自動化、MES 派工。
   * ports = 機台要佔幾個交換器埠（SECS/GEM 通訊 + 原廠診斷 / 大量資料）；fdc = FDC 感測資料（Mbps）；install = 原廠裝機時間（分鐘） */
  CAT.fab = {
    unlock: 10,
    wspd: 600,          /* 滿載時每天投片（片 / 日） */
    wafer: 900,         /* 每片良品帶給 IT 部門的預算（新台幣） */
    areas: {
      litho: { name: '黃光（微影）', color: '#e8c547' },
      etch:  { name: '蝕刻', color: '#e86f5a' },
      film:  { name: '薄膜', color: '#5aa9f0' },
      diff:  { name: '擴散 / 熱處理', color: '#f0823a' },
      imp:   { name: '離子植入', color: '#8f7cf0' },
      cmp:   { name: 'CMP / 濕式清洗', color: '#43c59e' },
      metro: { name: '量測 / 檢測', color: '#2fc6b8' },
      amhs:  { name: '自動搬運（AMHS）', color: '#9aa7ad' },
    },
    types: {
      scanner: { name: '浸潤式掃描機（曝光）', area: 'litho', ports: 2, fdc: 12, install: 540, os: '原廠封閉系統（Linux）' },
      track:   { name: '塗佈顯影機', area: 'litho', ports: 1, fdc: 2, install: 300, os: 'Windows 10 IoT' },
      etch:    { name: '電漿蝕刻機', area: 'etch', ports: 2, fdc: 6, install: 360, os: 'Windows 7 Embedded（原廠不支援升級）' },
      cvd:     { name: 'CVD 化學氣相沉積', area: 'film', ports: 2, fdc: 5, install: 360, os: 'Windows 7 Embedded（原廠不支援升級）' },
      pvd:     { name: 'PVD 濺鍍機', area: 'film', ports: 2, fdc: 5, install: 360, os: 'Windows XP Embedded（原廠不支援升級）' },
      ald:     { name: 'ALD 原子層沉積', area: 'film', ports: 2, fdc: 5, install: 360, os: 'Windows 10 IoT' },
      furnace: { name: '爐管（擴散 / 氧化）', area: 'diff', ports: 1, fdc: 1, install: 420, os: 'Windows 7 Embedded（原廠不支援升級）' },
      rtp:     { name: 'RTP 快速熱處理', area: 'diff', ports: 1, fdc: 2, install: 300, os: 'Windows 10 IoT' },
      implant: { name: '離子植入機', area: 'imp', ports: 2, fdc: 4, install: 600, os: 'Windows 7 Embedded（原廠不支援升級）' },
      cmp:     { name: 'CMP 化學機械研磨', area: 'cmp', ports: 1, fdc: 3, install: 360, os: 'Windows 10 IoT' },
      wet:     { name: '濕式清洗機', area: 'cmp', ports: 1, fdc: 1, install: 300, os: 'PLC + Windows 7 人機介面' },
      cdsem:   { name: 'CD-SEM 線寬量測', area: 'metro', ports: 2, fdc: 3, install: 300, os: 'Windows 10 IoT' },
      thick:   { name: '膜厚量測', area: 'metro', ports: 1, fdc: 1, install: 180, os: 'Windows 10 IoT' },
      overlay: { name: '疊對量測', area: 'metro', ports: 1, fdc: 2, install: 240, os: 'Windows 10 IoT' },
      inspect: { name: '缺陷檢測（影像）', area: 'metro', ports: 2, fdc: 60, install: 360, os: 'Linux' },
      stocker: { name: '晶圓倉儲 Stocker', area: 'amhs', ports: 1, fdc: 0.2, install: 240, os: 'PLC 控制器' },
    },
    /* 資安與保密設施 */
    kiosk: { name: '機台進廠掃毒站（SEMI E188）', price: 680000, buildMin: 180, scanMin: 40, slots: 2,
      desc: '原廠裝機用的筆電、USB、安裝光碟與機台電腦本身，都要先在這裡用多家防毒引擎掃過、確認沒有惡意程式，才能接上 OT 網路。' },
    gate: { name: '無塵室安檢門 + 手機置物櫃', price: 1200000, buildMin: 240,
      desc: '入口的金屬探測門與保全、更衣室裡上鎖的個人置物櫃：私人手機、隨身碟、有相機的裝置一律不能帶進無塵室。' },
    handheld: { name: '無相機的公司手持裝置', price: 16000,
      desc: '沒有相機、裝好 MES 程式的工業級手持電腦（PDA）：查批號、叫天車、回報機台狀況。只連得上無塵室的 OT Wi-Fi，不能上網。' },
    allowlist: { name: '機台應用程式白名單', price: 900000, buildMin: 240,
      desc: '在機台電腦上只允許原廠的程式執行（Application Allowlisting）：沒辦法更新的舊 Windows，至少不會被惡意程式執行起來、到處擴散。' },
  };

  /* ---------- 廠務（第十一章）：晶圓廠的電力、純水與廢水、氣體與排氣、化學品 ----------
   * 價格照遊戲的比例縮小（真實晶圓廠的廠務系統動輒數十億）；用電、用水、用氣的量級接近一條 12 吋試產線 */
  CAT.plant = {
    unlock: 11,
    /* 各型機台的用電（kW）、純水（m³/h）、大宗氣體（N₂ / CDA，Nm³/h）、要用到的特殊氣體類別、排氣要不要經洗滌塔 */
    tool: {
      scanner: { kw: 150, upw: 1, bulk: 60 },
      track:   { kw: 60, upw: 1.5, bulk: 20 },
      etch:    { kw: 70, upw: 0.3, bulk: 40, sg: ['etch'], scrub: true },
      cvd:     { kw: 70, upw: 0.3, bulk: 50, sg: ['dep', 'clean'], scrub: true },
      pvd:     { kw: 60, upw: 0.3, bulk: 40 },
      ald:     { kw: 50, upw: 0.3, bulk: 40, sg: ['dep', 'clean'], scrub: true },
      furnace: { kw: 110, upw: 0.5, bulk: 80, sg: ['dep'], scrub: true },
      rtp:     { kw: 120, upw: 0.5, bulk: 60 },
      implant: { kw: 180, upw: 0.5, bulk: 30, sg: ['dope'], scrub: true },
      cmp:     { kw: 45, upw: 5, bulk: 10 },
      wet:     { kw: 80, upw: 8, bulk: 20 },
      cdsem:   { kw: 12, upw: 0, bulk: 10 },
      thick:   { kw: 5, upw: 0, bulk: 10 },
      overlay: { kw: 10, upw: 0, bulk: 10 },
      inspect: { kw: 15, upw: 0, bulk: 10 },
      stocker: { kw: 20, upw: 0, bulk: 0 },
    },
    /* 各製程區要用到的廠務供應（電力每一區都要）：upw 純水（浸潤式曝光、清洗）、bulk 大宗氣體、sg 特殊氣體（依機台）、scrub 洗滌塔、exh 排氣、
     * acid 酸鹼化學品、solv 溶劑 / 顯影液、slurry 研磨液、wwt 廢水處理 */
    area: {
      litho: ['upw', 'bulk', 'solv', 'exh'],
      etch:  ['bulk', 'sg', 'scrub', 'exh'],
      film:  ['bulk', 'sg', 'scrub', 'exh'],
      diff:  ['bulk', 'sg', 'scrub', 'exh'],
      imp:   ['bulk', 'sg', 'scrub', 'exh'],
      cmp:   ['upw', 'bulk', 'acid', 'slurry', 'wwt', 'exh'],
      metro: ['bulk'],
      amhs:  [],
    },
    /* 跳電之後各區重新開機、升溫、校正要多久（分鐘），以及還在製程中、一跳電就報廢的晶圓（片） */
    recover: { litho: 120, etch: 60, film: 90, diff: 240, imp: 180, cmp: 30, metro: 30, amhs: 20 },
    wip: { litho: 20, etch: 30, film: 30, diff: 150, imp: 30, cmp: 15, metro: 0, amhs: 0 },
    /* 固定負載（kW）：無塵室空調（MAU / FFU）與冰水主機、製程冷卻水；照明與資訊設備；大宗氣體站每組的空壓機 */
    base: { hvac: 2300, misc: 150, bulkKW: 250, life: 150 },
    /* 變壓器長期負載不超過額定的九成；功率因數 */
    txLoad: 0.9, pf: 0.92,
    /* 純水槽（m³）：RO 停機時，拋光迴路還能撐一陣子 */
    tank: 120,
    /* 特殊氣體：每一類分開存放，一座氣瓶櫃經閥箱（VMB）分給幾台機台 */
    sg: {
      etch:  { name: '蝕刻氣體', gases: 'Cl₂、HBr、CF₄、C₄F₈', per: 8, hazard: '腐蝕性、毒性；含氟氣體的溫室效應是 CO₂ 的數千倍，排氣一定要經洗滌塔' },
      dep:   { name: '沉積氣體', gases: 'SiH₄、NH₃、WF₆、SiH₂Cl₂', per: 8, hazard: 'SiH₄（矽甲烷）碰到空氣會自燃，NH₃、WF₆ 有毒' },
      clean: { name: '腔體清潔氣體', gases: 'NF₃', per: 12, hazard: '強氧化性，高溫下會分解出有毒的氟化物' },
      dope:  { name: '植入摻雜氣體', gases: 'AsH₃、PH₃、BF₃', per: 6, hazard: '劇毒：砷化氫、磷化氫極低濃度就會致命' },
    },
    /* 設備：都要施工（buildMin），多數可以買好幾組（max） */
    eq: {
      tx:      { name: '主變壓器 5,000 kVA', group: 'power', price: 4200000, buildMin: 720, max: 5, kva: 5000,
        desc: '把台電送來的 22.8 kV 降成工廠用的 380 / 220 V。長期負載不要超過額定的九成；晶圓廠一定要 N+1——壞掉一台，其他台也撐得住。' },
      feeder2: { name: '台電第二回路（雙回路受電）', group: 'power', price: 3800000, buildMin: 1440, max: 1,
        desc: '從另一座變電所再拉一條 22.8 kV 饋線：一條線路故障就自動切換到另一條，只會有一瞬間的電壓驟降，不會長時間停電。' },
      dups:    { name: '動態 UPS（DUPS）1,000 kVA', group: 'power', price: 6500000, buildMin: 600, max: 6, kva: 1000,
        desc: '飛輪儲能 + 柴油引擎：電壓驟降或停電的瞬間由飛輪接手，接著柴油引擎發電。接在 DUPS 後面的製程區不會跳機；容量有限，要挑最怕停電的區域。配電盤的緊急電源區也由它供電。' },
      gen:     { name: '緊急柴油發電機 750 kW', group: 'power', price: 4200000, buildMin: 480, max: 3, kw: 750,
        desc: '停電約 1 分鐘後啟動，經自動切換開關（ATS）供電給緊急電源：排氣、洗滌塔、氣體偵測、緊急照明、FMCS——這些是維生負載，停電時也不能停。' },
      ro:      { name: 'RO 逆滲透機組 40 m³/h（含前處理）', group: 'water', price: 5600000, buildMin: 720, max: 4, cap: 40,
        desc: '自來水經過砂濾、活性碳、軟水，再用高壓泵推過 RO 膜，去除 98% 以上的離子、有機物與微粒，送進純水槽。' },
      polish:  { name: '拋光機組 40 m³/h（EDI + 混床 + UV + UF）', group: 'water', price: 4800000, buildMin: 600, max: 4, cap: 40,
        desc: '純水槽的水再經過 EDI 電除鹽、拋光混床樹脂、紫外線分解有機物、超過濾膜去除微粒，變成 18.2 MΩ·cm 的超純水，循環送到每一台機台。' },
      upwmon:  { name: '線上水質監測（電阻率 / TOC / 微粒）', group: 'water', price: 1200000, buildMin: 180, max: 1,
        desc: '在拋光迴路出口即時量測電阻率、總有機碳（TOC）與微粒：水質一變差就告警、切換備援，不用等晶圓出問題才發現。' },
      reclaim: { name: '回收水系統', group: 'water', price: 6500000, buildMin: 720, max: 1,
        desc: '把機台排出的清洗水分類回收、處理後再送回 RO：自來水用量少六成。台灣 2021 年大旱時，晶圓廠靠回收水與水車撐過限水。' },
      wwt:     { name: '廢水處理（酸鹼中和 + 含氟廢水）', group: 'water', price: 7200000, buildMin: 900, max: 1,
        desc: '酸鹼廢水中和、含氟廢水（氫氟酸）加鈣沉澱成氟化鈣、CMP 研磨廢水去除懸浮固體，水質合格才能放流。沒有它，CMP 與濕式清洗就不能生產。' },
      bulk:    { name: '大宗氣體站 1,500 Nm³/h（液氮 + CDA）', group: 'gas', price: 4500000, buildMin: 600, max: 4, cap: 1500,
        desc: '液態氮儲槽 + 汽化器、無油空壓機 + 乾燥機（CDA）：幾乎每一台機台都要用氮氣吹淨、用壓縮空氣驅動閥件。' },
      gc:      { name: '特殊氣體櫃（含閥箱 VMB）', group: 'gas', price: 1500000, buildMin: 240, max: 4,
        desc: '密閉、負壓排氣的鋼瓶櫃：雙鋼瓶自動切換、換瓶前用氮氣吹驅，經閥箱（VMB）分配到機台。每一類氣體都要分開存放。' },
      gds:     { name: '氣體偵測系統 GDS', group: 'gas', price: 3200000, buildMin: 360, max: 1,
        desc: '在氣瓶櫃、閥箱、機台與排氣管裝上毒性 / 可燃性氣體偵測器，集中到 GDS 主機。工安規定：沒有氣體偵測，特殊氣體不准供氣。' },
      eso:     { name: '緊急遮斷連鎖（ESO）', group: 'gas', price: 1500000, buildMin: 240, max: 1, needs: 'gds',
        desc: 'GDS 一偵測到洩漏，就自動關閉氣瓶櫃與閥箱的緊急遮斷閥、啟動警報與疏散廣播：從偵測到切斷只要幾秒。GDS 斷電時也會自動關閉（失效安全）。' },
      scrub:   { name: '廢氣洗滌塔（中央 + 現址）', group: 'gas', price: 3800000, buildMin: 480, max: 4, cap: 12,
        desc: '蝕刻、沉積、擴散、植入機台排出的有毒、可燃、含氟廢氣，先經機台旁的現址洗滌塔（燃燒 / 水洗）再進中央洗滌塔，處理乾淨才能排到大氣。一組約可處理 12 台機台。' },
      acid:    { name: '酸鹼化學品供應系統（CDS）', group: 'chem', price: 6800000, buildMin: 720, max: 1,
        desc: '硫酸、雙氧水、氫氟酸、氨水、鹽酸的儲槽、泵浦與雙套管，經化學品閥箱送到濕式清洗機與 CMP。' },
      solv:    { name: '溶劑 / 顯影液供應系統', group: 'chem', price: 3500000, buildMin: 480, max: 1,
        desc: 'IPA（異丙醇）、光阻稀釋劑與顯影液（TMAH）：易燃或有毒，儲存區要防爆、通風。黃光區的塗佈顯影機少了它就不能動。' },
      slurry:  { name: 'CMP 研磨液供應系統', group: 'chem', price: 4200000, buildMin: 480, max: 1,
        desc: '研磨液是懸浮著奈米顆粒的液體：要一直攪拌、循環、過濾，顆粒一沉澱或結塊就會刮傷晶圓。' },
      leak:    { name: '化學品洩漏偵測 + 緊急沖淋', group: 'chem', price: 1800000, buildMin: 240, max: 1,
        desc: '雙套管與閥箱裡的洩漏感測器、防溢堤，加上緊急沖淋與洗眼器（氫氟酸暴露要立刻沖水、塗葡萄糖酸鈣凝膠）。' },
    },
    /* 配電盤施工的材料：斷路器、漏電斷路器、每公尺電纜（依線徑） */
    breaker: 6000, elcb: 9000, cablePerM: { 3.5: 60, 5.5: 85, 8: 120, 14: 190, 22: 280, 38: 460, 60: 700 },
  };

  /* ---------- 水平布線（IDF → 座位 / AP） ---------- */
  CAT.horizontal = {
    cat6:  { name: 'Cat6 水平布線', perDrop: 2200, diyPerDrop: 900, buildMin: 8 * 60, maxSpeed: 5000,
      desc: '每個座位 / AP 點拉一條 Cat6 到 IDF。支援 1G，搭配 mGig 可到 5G。' },
    cat6a: { name: 'Cat6A 水平布線', perDrop: 3300, diyPerDrop: 1500, buildMin: 10 * 60, maxSpeed: 10000,
      desc: '較貴，但每個點都能跑 10G，是 Wi-Fi 7 時代的保險選擇。' },
  };

  /* 自己布線：打線刀、剝線鉗、理線工具與認證測試儀（買一次就好，材料費另計 diyPerDrop） */
  CAT.diyKit = 150000;

  /* ---------- ISP 企業專線 ---------- */
  CAT.isp = {
    providers: {
      A: { name: '甲電信', short: '甲' },
      B: { name: '乙寬頻', short: '乙' },
      C: { name: '丙通信', short: '丙' },
    },
    plans: {
      '500M': { bw: 500, monthly: 22000, setup: 10000, lead: 12 * 60, unlock: 1 },
      '1G':   { bw: 1000, monthly: 42000, setup: 20000, lead: 18 * 60, unlock: 1 },
      '10G':  { bw: 10000, monthly: 260000, setup: 80000, lead: 36 * 60, unlock: 1 },
    },
    latency: 8,
  };

  /* ---------- 伺服器角色 ---------- */
  CAT.roles = {
    ad:     { name: 'AD / DNS / DHCP', short: 'AD', capUsers: 6000,
      desc: '網域控制站：帳號登入、DNS 名稱解析、DHCP 自動派發 IP。沒有它，員工就拿不到 IP、也無法登入。' },
    file:   { name: '檔案伺服器', short: 'FILE',
      desc: '部門共用資料夾 (SMB)。內部流量的大宗。' },
    web:    { name: '官網 / 客戶入口', short: 'WEB',
      desc: '對外提供服務的網站。應放在 DMZ，不能放在內網。' },
    db:     { name: '資料庫 / ERP', short: 'DB',
      desc: '儲存客戶與訂單資料。網站與 ERP 都需要它，應放在內部伺服器區。' },
    nms:    { name: '網管監控 NMS', short: 'NMS',
      desc: '透過 SNMP / NetFlow 收集每條鏈路與設備的狀態，讓監控中心看得到細節。' },
    siem:   { name: 'SIEM 日誌分析', short: 'SIEM',
      desc: '集中收集防火牆、伺服器、端點日誌並關聯分析，大幅縮短攻擊偵測時間。' },
    backup: { name: '備份伺服器', short: 'BKP',
      desc: '每晚備份檔案伺服器與資料庫。遭勒索軟體加密時的最後防線。' },
    ai:     { name: 'AI 運算（GPU）', short: 'AI',
      desc: '訓練與推論企業 AI 模型。多台 GPU 伺服器要透過高速後端網路同步參數，才能一起訓練同一個模型。' },
    aistore: { name: 'AI 資料儲存', short: 'AIS',
      desc: '存放訓練資料與模型檢查點（checkpoint）。要夠快，GPU 才不會停下來等資料。' },
    pbx:    { name: 'IP 電話交換機（IP-PBX）', short: 'PBX',
      desc: '公司的總機：分機註冊、撥號、轉接、客服中心的排隊與錄音（ACD / IVR）。對外打電話要再接電信業者的 SIP 中繼。' },
    vscan:  { name: '弱點掃描', short: 'VS',
      desc: '定期掃描所有伺服器、網路設備與電腦，找出沒修補的已知漏洞（CVE），依嚴重程度（CVSS）排出修補順序。' },
    upd:    { name: '更新派送（WSUS / 快取）', short: 'UPD',
      desc: '在內網快取作業系統與軟體更新：更新只從網際網路下載一次，一萬台電腦再從內網取得，不會塞爆對外頻寬。' },
    iot:    { name: 'IoT 管理平台', short: 'IOT',
      desc: '收集智慧廁所等 IoT 感測器的資料（MQTT）：衛生紙快用完、太髒、漏水時自動派工給清潔人員並告警。IoT 裝置應放在獨立網段，只能連到這台平台。' },
    sbc:    { name: '語音邊界控制器（SBC）', short: 'SBC',
      desc: '語音的防火牆：放在 DMZ 對接電信業者的 SIP 中繼，內部的電話交換機不直接暴露在網際網路上。' },
    sdwan:  { name: 'SD-WAN 集中器', short: 'SDW',
      desc: '各據點的 SD-WAN 設備經網際網路建立加密隧道連回總部的集中器，依應用程式自動選路、斷線瞬間切換。' },
    /* 晶圓廠（第十章）：MES / EAP / FDC 放在 OT 區，跳板機放在 DMZ */
    mes:    { name: 'MES 製造執行系統', short: 'MES', unlock: 10,
      desc: '晶圓廠的大腦：工單、批號（lot）追蹤、派工、配方管理，也管天車與倉儲（MCS）。MES 一停，整座廠就停。要放在 OT 區，和 ERP 只交換工單與出貨資料。' },
    eap:    { name: 'EAP 機台自動化', short: 'EAP', capTools: 40, unlock: 10,
      desc: 'Equipment Automation Program：用 SECS/GEM 跟每一台機台對話（上下貨、選配方、開始加工、收資料）。一台 EAP 伺服器大約管 40 台機台；連不上 EAP 的機台只能靠人工操作。' },
    fdc:    { name: 'FDC 異常偵測', short: 'FDC', unlock: 10,
      desc: 'Fault Detection & Classification：即時收集每一台機台的感測資料（溫度、壓力、氣體流量、射頻功率……），一有偏移就停機告警，避免整批晶圓報廢。資料量很大。' },
    jump:   { name: '跳板機（遠端存取閘道）', short: 'JMP', unlock: 10,
      desc: '原廠要遠端維修機台時唯一的入口：放在 DMZ，要 MFA 登入、全程錄影、用完就關，只能連到指定的機台。' },
    /* 廠務（第十一章）：FMCS 也放在 OT 區 */
    fmcs:   { name: 'FMCS 廠務監控（SCADA）', short: 'FMCS', unlock: 11,
      desc: 'Facility Monitoring & Control System：透過 Modbus / BACnet 收集配電盤、純水、氣體、化學品、排氣與洗滌塔每一台 PLC 的狀態與告警，停電後依序自動復歸馬達。Modbus 沒有任何認證，所以 FMCS 和 PLC 一定要放在 OT 區、不能碰到網際網路。' },
  };
  /* ---------- 電話語音：SIP 中繼（向電信業者租用的外線路數） ---------- */
  CAT.voice = {
    trunks: { 60: { monthly: 48000, setup: 30000 }, 120: { monthly: 90000, setup: 40000 }, 240: { monthly: 170000, setup: 60000 }, 480: { monthly: 320000, setup: 80000 } },
    lead: 360, unlock: 7,
    /* 每位在座員工同時在講電話的比例：客服中心很高、一般辦公很低；外線比例 */
    rate: { callcenter: 0.2, office: 0.015, rnd: 0.01, creative: 0.012, exec: 0.025, conference: 0.008, lobby: 0.015 },
    ext: { callcenter: 0.92 },
    kbps: 90,
  };
  /** 各角色的 VM 規格：[vCPU, 記憶體 GB, 系統碟 TB]（檔案與備份的資料量另計） */
  CAT.vmSize = { fmcs: [8, 32, 0.5], mes: [16, 64, 2], eap: [8, 32, 0.3], fdc: [16, 64, 6], jump: [4, 8, 0.2], iot: [4, 16, 0.3], ad: [4, 16, 0.2], web: [8, 32, 0.3], db: [16, 128, 3], nms: [8, 32, 0.5], siem: [16, 64, 4], file: [8, 32, 0.2], backup: [8, 32, 0.2], pbx: [4, 16, 0.2], sbc: [4, 8, 0.1], sdwan: [4, 8, 0.1], vscan: [4, 16, 0.3], upd: [4, 16, 1.5] };
  CAT.vmCfg = { license: 45000, osLicense: 30000, bootMin: 6, haDelay: 3, p2vFee: 50000, p2vMin: 60 };
  /** RAID：可用比例、可容忍同時壞幾顆、說明 */
  CAT.raid = {
    raid5:  { name: 'RAID 5', eff: 0.9, tol: 1, desc: '容量最多，只能壞一顆。大容量硬碟重建要十幾個小時，期間再壞一顆資料就全毀。' },
    raid6:  { name: 'RAID 6', eff: 0.8, tol: 2, desc: '可以同時壞兩顆：重建期間再壞一顆也不怕。大容量硬碟的標準選擇。' },
    raid10: { name: 'RAID 10', eff: 0.5, tol: 1.5, desc: '鏡像 + 條帶：效能最好、重建最快，但只剩一半容量。資料庫與 VM 常用。' },
  };

  /* ---------- 資安與網路服務（訂閱制） ---------- */
  CAT.services = {
    ips:       { name: 'IPS 入侵防禦', group: '邊界防護', monthly: 45000, unlock: 3,
      desc: '在防火牆上深度檢測封包，阻擋漏洞攻擊與已知 C2 連線。啟用後防火牆吞吐量降為 IPS 規格。' },
    gav:       { name: '閘道防毒 / 沙箱', group: '邊界防護', monthly: 28000, unlock: 3,
      desc: '在網路邊界掃描下載的檔案與郵件附件，攔截已知惡意程式。' },
    url:       { name: 'URL 網址過濾', group: '邊界防護', monthly: 18000, unlock: 3,
      desc: '封鎖已知的釣魚網站與惡意網域，也能擋下部分 C2 連線。' },
    geo:       { name: 'Geo-IP 地理封鎖', group: '邊界防護', monthly: 0, unlock: 3,
      desc: '封鎖來自高風險地區的連線。可大幅減少掃描與暴力破解，但會擋掉少量海外客戶。' },
    ddos:      { name: 'ISP DDoS 清洗服務', group: '對外服務', monthly: 90000, unlock: 3,
      desc: '攻擊流量在 ISP 端就被清洗掉，不會塞爆你的線路。' },
    waf:       { name: '雲端 WAF', group: '對外服務', monthly: 60000, unlock: 3,
      desc: '網站應用程式防火牆：攔截 SQL Injection、XSS 等網站攻擊。' },
    mfa:       { name: 'MFA 多因素驗證', group: '身分安全', perUser: 45, unlock: 3,
      desc: '登入除了密碼還需要手機驗證。就算密碼被猜中或外洩，攻擊者也進不來。' },
    edr:       { name: 'EDR 端點偵測回應', group: '端點安全', perUser: 120, unlock: 5,
      desc: '每台電腦上的行為偵測代理程式，可自動隔離中毒電腦、阻止勒索軟體加密。' },
    mailsec:   { name: '郵件安全閘道', group: '端點安全', perUser: 30, unlock: 5,
      desc: '過濾釣魚信與惡意附件，大幅降低員工收到釣魚信的機率。' },
    nac:       { name: 'NAC 網路存取控制', group: '身分安全', perUser: 20, unlock: 5,
      desc: '802.1X 認證：只有公司設備能接上網路，中毒電腦可一鍵隔離到隔離 VLAN。' },
    immutable: { name: '不可變備份', group: '備份', monthly: 40000, unlock: 5, needsRole: 'backup',
      desc: '備份資料寫入後在保存期內無法被修改或刪除，勒索軟體也加密不了。' },
    vault:     { name: '磁帶異地保管', group: '備份', monthly: 30000, unlock: 8, needsTape: true,
      desc: '保全公司每週來收走磁帶，存放在異地的恆溫恆濕金庫。總部就算火災、淹水，資料還在。' },
    uem:       { name: '端點管理平台（UEM / MDM）', group: '端點管理', perUser: 60, unlock: 8,
      desc: '集中管理一萬台電腦與手機：資產清冊、修補合規率、自動分批派送更新、強制 BitLocker 加密、遺失時遠端抹除。' },
    m365:      { name: 'Microsoft 365（SaaS 郵件與協作）', group: '雲端', perUser: 330, unlock: 7,
      desc: '郵件、Teams、OneDrive 都搬到雲端：不用自己維護郵件伺服器，但每個人的流量都改走網際網路，出口頻寬要跟著加大。' },
    cloudweb:  { name: '官網上雲（IaaS + CDN）', group: '雲端', monthly: 120000, unlock: 7,
      desc: '官網搬到公有雲，前面加 CDN：流量高峰自動擴充、DDoS 由雲端吸收，不再佔用公司的對外頻寬。官網查會員資料時，要經專線或 VPN 連回總部的資料庫。' },
    cspm:      { name: '雲端資安態勢管理（CSPM）', group: '雲端', monthly: 25000, unlock: 7,
      desc: '持續檢查雲端帳號的設定：公開的儲存桶、沒開 MFA 的管理員、外洩的存取金鑰、異常的費用，一有問題就告警。' },
    cloudbk:   { name: '雲端備份（異地 + 物件鎖定）', group: '備份', perTB: 900, unlock: 8, needsRole: 'backup',
      desc: '每晚把備份複製一份到公有雲的物件儲存，並開啟物件鎖定（Object Lock）：異地、而且勒索軟體刪不掉。依備份容量計費。' },
  };
  CAT.training = { name: '全員資安意識訓練', price: 250000, days: 30, unlock: 5,
    desc: '模擬釣魚演練 + 課程。30 天內員工點擊釣魚連結的機率大幅下降。' };

  /* 電費（每度） */
  CAT.power = { perKWh: 4.5, pue: 1.6 };
})(window.G = window.G || {});
