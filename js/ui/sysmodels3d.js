/* 3D 模型：系統設備 —— 虛擬化主機、SAN 全快閃儲存、儲存擴充櫃、LTO 磁帶櫃，
 * 以及 IP 電話交換機（PX-500）、SBC、SD-WAN 集中器。
 * 機架式設備沿用 models3d 的面板區塊（連接埠、PSU、風扇、硬碟槽…），同時登錄進共用的 SPEC 讓 3D 機房使用。
 */
(function (G) {
  'use strict';
  const M3 = G.M3;
  if (!M3 || !M3.kit) return;
  const K = M3.kit;

  const SYS = { body: '#b3bac0', bezel: '#1b1f23', handles: true };
  const SPECS = {
    'HV-2U': Object.assign({}, SYS, { u: 2, depth: 740, brand: 'VIRTUA', accent: '#8f7cf0',
      front: { s: [{ t: 'ctrl', label: '電源鍵與健康狀態燈' }, { t: 'lcd', w: 44, lines: ['HV-01  HYPERVISOR', 'VMs 12  CPU 38%', 'RAM 71%  HA OK'], color: '#c9b8ff', label: '主機狀態：跑了幾台 VM、CPU 與記憶體用量' },
        { t: 'drives', cols: 8, rows: 1, dw: 20, dh: 72, tab: '#8f7cf0', label: '8 × 2.5 吋 SSD：只放 Hypervisor 本身，VM 的硬碟放在 SAN' }, { t: 'io' }, { t: 'vent' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（熱插拔）' }, { t: 'psu' }, { t: 'nic', count: 4, label: '4 × 25G 網卡：兩張接一般網路、兩張接儲存網路（iSCSI）' },
        { t: 'pcie', w: 56, n: 2, label: 'PCIe 擴充槽' }, { t: 'mgmt', text: 'BMC', label: 'BMC 遠端管理：主機當機也能遠端開關機、看畫面' }, { t: 'vent' }] } }),
    'SAN-5K': Object.assign({}, SYS, { u: 2, depth: 720, body: '#c7ccd0', brand: 'STORIQ', accent: '#c39b6a',
      front: { s: [{ t: 'leds', items: [['PWR', 'g'], ['CTL-A', 'g'], ['CTL-B', 'g'], ['FLT', 'r', false]], label: '雙控制器狀態' },
        { t: 'drives', cols: 24, rows: 1, dw: 14.4, dh: 72, tab: '#c39b6a', label: '24 × NVMe SSD（熱插拔）：壞一顆直接抽換，RAID 自動重建' }] },
      rear: { rows: [
        { h: 40, s: [{ t: 'badge', text: 'CTRL A', w: 26, color: '#c39b6a', label: '控制器 A' }, { t: 'ports', kind: 'sfp', count: 4, modules: 4, label: '4 × 25G iSCSI：接儲存網路' }, { t: 'mgmt' }, { t: 'badge', text: 'SAS', w: 18, color: '#9aa7ad', label: 'SAS 埠：接擴充櫃' }, { t: 'psu', label: '雙電源' }] },
        { s: [{ t: 'badge', text: 'CTRL B', w: 26, color: '#c39b6a', label: '控制器 B：雙控制器互為備援，一個壞了另一個接手（Active / Active）' }, { t: 'ports', kind: 'sfp', count: 4, modules: 4, label: '4 × 25G iSCSI（多路徑 MPIO）' }, { t: 'mgmt' }, { t: 'badge', text: 'SAS', w: 18, color: '#9aa7ad' }, { t: 'psu' }] },
      ] } }),
    'DS-24': Object.assign({}, SYS, { u: 4, depth: 700, body: '#c7ccd0', brand: 'STORIQ', accent: '#c39b6a', sticker: false,
      front: { s: [{ t: 'leds', items: [['PWR', 'g'], ['FLT', 'r', false]] }, { t: 'drives', cols: 4, rows: 6, dw: 96, dh: 26.5, tab: '#c39b6a', label: '24 × 3.5 吋 16 TB 大容量硬碟：容量大、單價低，但重建一顆要十幾個小時' }] },
      rear: { s: [{ t: 'badge', text: 'SAS IN', w: 28, color: '#9aa7ad', label: 'SAS 線接回 SAN 控制器（不是網路設備）' }, { t: 'badge', text: 'SAS OUT', w: 28, color: '#9aa7ad', label: '可以再串接下一台擴充櫃' }, { t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'fan' }, { t: 'fan' }] } }),
    'TL-48': { u: 4, depth: 900, body: '#2c3136', bezel: '#1a1e22', brand: 'TAPEVAULT', accent: '#46d17f', handles: true,
      front: { rows: [
        { h: 70, s: [{ t: 'brand', w: 60 }, { t: 'lcd', w: 64, h: 40, lines: ['LTO-9  DRIVES 2', 'SLOTS 46/48  I/E 2', 'JOB: COPY  312 MB/s'], color: '#8ff0c0', label: '操作面板：磁帶機狀態、槽位、目前的備份工作' },
          { t: 'btns', label: '操作按鈕' }, { t: 'leds', items: [['RDY', 'g'], ['DRV', 'b'], ['CLN', 'a', false], ['ERR', 'r', false]] }, { t: 'vent' }] },
        { s: [{ t: 'badge', text: 'MAIL SLOT I/E', w: 60, color: '#46d17f', label: '進出口（I/E）：把要送去異地保管的磁帶從這裡退出來' }, { t: 'vent', label: '磁帶匣（左右各 24 格，機械手臂在中間移動）' }] },
      ] },
      rear: { s: [{ t: 'card', label: 'LTO-9 磁帶機 #1（每捲 18 TB、約 400 MB/s）' }, { t: 'card', label: 'LTO-9 磁帶機 #2' }, { t: 'ports', kind: 'sfp', count: 2, modules: 2, label: '2 × 10G：接備份伺服器' }, { t: 'mgmt' }, { t: 'psu', label: '雙電源' }, { t: 'psu' }] } },
  };
  /* 電話交換機與 SBC */
  Object.assign(SPECS, {
    'PX-500': { u: 1, depth: 420, body: '#2d3339', bezel: '#1c2126', brand: 'VOXLINE', accent: '#e86fa8',
      front: { s: [{ t: 'brand' }, { t: 'lcd', w: 52, lines: ['PBX  EXT 2,861 REG', 'CALLS 318  QUEUE 12'], color: '#ffb3d9', label: '分機註冊數、進行中的通話、客服排隊' },
        { t: 'leds', items: [['PWR', 'g'], ['SYS', 'g'], ['SIP', 'b'], ['ALM', 'r', false]] }, { t: 'ports', kind: 'rj45', count: 4, label: '4 × 1G：管理與語音 VLAN' },
        { t: 'ports', kind: 'sfp', count: 2, modules: 2, label: '2 × 10G：上連核心交換器' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '雙電源（電話不能斷）' }, { t: 'psu' }, { t: 'card', label: 'DSP 語音處理卡：會議、錄音、轉碼' }, { t: 'mgmt' }, { t: 'fan' }] } },
    'SBC-2': { u: 1, depth: 380, body: '#3a2a33', bezel: '#241a20', brand: 'VOXLINE', accent: '#f06a5a',
      front: { s: [{ t: 'brand' }, { t: 'badge', text: 'SBC', color: '#f06a5a', label: 'Session Border Controller：語音的防火牆' },
        { t: 'leds', items: [['PWR', 'g'], ['WAN', 'g'], ['LAN', 'g'], ['DoS', 'r', false]], label: 'DoS 燈：偵測到 SIP 掃描或暴力破解' },
        { t: 'ports', kind: 'rj45', count: 4, label: 'WAN 側接電信業者、LAN 側接電話交換機' }, { t: 'ports', kind: 'sfp', count: 2, modules: 2, label: '2 × 10G' }, { t: 'console' }] },
      rear: { s: [{ t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }] } },
  });
  /* SD-WAN 集中器 */
  SPECS['SDW-HUB'] = { u: 1, depth: 400, body: '#263238', bezel: '#1a2227', brand: 'PATHWISE', accent: '#43c59e',
    front: { s: [{ t: 'brand' }, { t: 'lcd', w: 48, lines: ['SD-WAN HUB', 'TUNNELS 4 UP'], color: '#9ff0d0', label: '各據點建立的加密隧道狀態' },
      { t: 'leds', items: [['PWR', 'g'], ['WAN', 'g'], ['VPN', 'b'], ['ALM', 'r', false]] }, { t: 'ports', kind: 'rj45', count: 4, label: '4 × 1G' },
      { t: 'ports', kind: 'sfp', count: 4, modules: 2, label: '4 × 10G：接防火牆的 DMZ 或核心' }, { t: 'console' }] },
    rear: { s: [{ t: 'psu', label: '雙電源' }, { t: 'psu' }, { t: 'vent' }, { t: 'fan' }] } };
  for (const [id, sp] of Object.entries(SPECS)) {
    K.SPEC[id] = sp;
    M3.register(id, () => K.chassis(Object.assign({ model: id }, sp)));
  }
  M3.sysSpecs = SPECS;

  Object.assign(M3.KB, {
    'k-vm': ['HV-2U', 'SAN-5K'],
    'k-san': ['SAN-5K', 'DS-24', 'ST-4U'],
    'k-backup': ['TL-48', 'ST-4U'],
    'k-pbx': ['PX-500', 'SBC-2'],
    'k-sdwan': ['SDW-HUB', 'NR-1100'],
    'k-mpls': ['NR-5500', 'os2'],
    'k-qos': ['AX-48P', 'PX-500'],
  });
})(window.G = window.G || {});
