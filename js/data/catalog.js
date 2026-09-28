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
  };

  /* 開機時間（遊戲分鐘） */
  CAT.bootMin = { router: 5, firewall: 8, switch: 4, server: 10, wlc: 6, ups: 1 };

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
      ports: { rj45: 2, sfp: 2, qsfp: 0 }, sfpMax: 10000, qsfpMax: 0, roles: ['ad', 'web', 'nms', 'db'], unlock: 1,
      desc: '1U 雙路伺服器，2 × 10G 網卡。可擔任 AD/DNS/DHCP、網站、網管、資料庫。' },
    'SV-2U': { cat: 'server', name: 'SV-2U 高效能伺服器', price: 520000, u: 2, watts: 750,
      ports: { rj45: 2, sfp: 2, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, roles: ['ad', 'web', 'nms', 'db', 'siem'], unlock: 1,
      desc: '2U 高效能伺服器，2 × 25G 網卡。可擔任 SIEM 等重負載角色。' },
    'ST-4U': { cat: 'server', name: 'ST-4U 儲存伺服器', price: 980000, u: 4, watts: 900,
      ports: { rj45: 2, sfp: 4, qsfp: 0 }, sfpMax: 25000, qsfpMax: 0, roles: ['file', 'backup'], unlock: 2,
      desc: '4U 大容量儲存 (NAS)，4 × 25G 網卡。擔任檔案伺服器或備份伺服器。' },

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
  };
  CAT.roomSlots = { cooling: 4, ups: 2, generator: 1 };
  CAT.rack = { price: 55000, units: 42, powerLimit: 8000, maxRacks: 10 };

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
  CAT.speeds = [1000, 10000, 25000, 40000, 100000];
  CAT.cables = {
    cat6:  { name: 'Cat6 銅纜', short: 'Cat6', medium: 'copper', perM: 25, termCost: 300, color: '#4f86e8',
      max: { 1000: 100, 10000: 55 }, desc: '最常見的網路線。1G 可跑 100m；10G 只能跑 55m。' },
    cat6a: { name: 'Cat6A 銅纜', short: 'Cat6A', medium: 'copper', perM: 45, termCost: 400, color: '#7aa2f7',
      max: { 1000: 100, 10000: 100 }, desc: '強化屏蔽，10G 可跑滿 100m。銅纜最長就是 100m。' },
    om4:   { name: 'OM4 多模光纖', short: 'OM4', medium: 'mmf', perM: 70, termCost: 2000, color: '#2fc6b8',
      max: { 1000: 550, 10000: 400, 25000: 100, 40000: 150, 100000: 100 }, desc: '水藍色外皮。短距離高速首選，光模組便宜；但 100G 只能跑 100m。' },
    os2:   { name: 'OS2 單模光纖', short: 'OS2', medium: 'smf', perM: 40, termCost: 2500, color: '#f2c14e',
      max: { 1000: 10000, 10000: 10000, 25000: 10000, 40000: 10000, 100000: 10000 }, desc: '黃色外皮。可傳 10 公里以上，線便宜但光模組較貴。' },
  };
  /* 每一端的光模組 / 模組價格 */
  CAT.optics = {
    copper: { 1000: 1000, 10000: 4500 },
    mmf:    { 1000: 1500, 10000: 2800, 25000: 4800, 40000: 9500, 100000: 22000 },
    smf:    { 1000: 2500, 10000: 6000, 25000: 11000, 40000: 28000, 100000: 52000 },
  };
  CAT.opticName = {
    copper: { 1000: '1000BASE-T', 10000: '10GBASE-T' },
    mmf: { 1000: '1000BASE-SX', 10000: '10GBASE-SR', 25000: '25GBASE-SR', 40000: '40GBASE-SR4', 100000: '100GBASE-SR4' },
    smf: { 1000: '1000BASE-LX', 10000: '10GBASE-LR', 25000: '25GBASE-LR', 40000: '40GBASE-LR4', 100000: '100GBASE-LR4' },
  };
  CAT.riserBuildMin = 120;   /* 跨樓層垂直主幹佈線施工時間 */

  /* ---------- 水平布線（IDF → 座位 / AP） ---------- */
  CAT.horizontal = {
    cat6:  { name: 'Cat6 水平布線', perDrop: 2200, buildMin: 8 * 60, maxSpeed: 5000,
      desc: '每個座位 / AP 點拉一條 Cat6 到 IDF。支援 1G，搭配 mGig 可到 5G。' },
    cat6a: { name: 'Cat6A 水平布線', perDrop: 3300, buildMin: 10 * 60, maxSpeed: 10000,
      desc: '較貴，但每個點都能跑 10G，是 Wi-Fi 7 時代的保險選擇。' },
  };

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
  };
  CAT.training = { name: '全員資安意識訓練', price: 250000, days: 30, unlock: 5,
    desc: '模擬釣魚演練 + 課程。30 天內員工點擊釣魚連結的機率大幅下降。' };

  /* 電費（每度） */
  CAT.power = { perKWh: 4.5, pue: 1.6 };
})(window.G = window.G || {});
