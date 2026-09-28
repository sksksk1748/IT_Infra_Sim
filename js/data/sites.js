/* 分支據點與廣域網路（WAN）：台中工廠、高雄營業所、越南廠、東京辦公室；
 * 專線種類（MPLS、IPLC、企業寬頻、4G/5G 備援）、總部的 MPLS 匯接、SD-WAN、雲端（Direct Connect）。
 * lat = 單向延遲（ms）：MPLS / IPLC 走電信業者的骨幹，網際網路繞得比較遠、尖峰會塞車。
 */
(function (G) {
  'use strict';
  const CAT = G.CAT;

  G.SITES = {
    tc: { id: 'tc', name: '台中工廠', city: '台中', flag: '🇹🇼', staff: 820, intl: false, kind: 'factory',
      lat: { mpls: 3, iplc: 3, inet: 8, lte: 22 }, loss: 0.002,
      /* 每人尖峰：ERP / MES（到總部資料庫）、檔案、上網（Mbps） */
      erp: 0.16, file: 0.04, inet: 0.3, calls: 0.012,
      desc: '生產線的 MES 與 ERP 要即時查總部的資料庫：斷線或延遲太高，產線就停擺。' },
    ks: { id: 'ks', name: '高雄營業所', city: '高雄', flag: '🇹🇼', staff: 180, intl: false, kind: 'office',
      lat: { mpls: 5, iplc: 5, inet: 11, lte: 25 }, loss: 0.002,
      erp: 0.06, file: 0.12, inet: 0.7, calls: 0.03,
      desc: '業務與客服人員：大多用雲端服務和上網，ERP 用量不大，對成本很敏感。' },
    vn: { id: 'vn', name: '越南廠', city: '胡志明市', flag: '🇻🇳', staff: 1200, intl: true, kind: 'factory',
      lat: { mpls: 26, iplc: 20, inet: 42, lte: 60 }, loss: 0.012, eve: true,
      erp: 0.1, file: 0.02, inet: 0.2, calls: 0.006,
      desc: '海外最大的生產基地：ERP 每一筆工單都要回總部。當地網際網路晚上很塞、掉包多，海纜一斷就更慘。' },
    jp: { id: 'jp', name: '東京辦公室', city: '東京', flag: '🇯🇵', staff: 60, intl: true, kind: 'office',
      lat: { mpls: 18, iplc: 15, inet: 24, lte: 40 }, loss: 0.004,
      erp: 0.05, file: 0.15, inet: 0.9, calls: 0.03,
      desc: '日本業務據點，人少：專線太貴，大多靠網際網路。' },
  };
  G.SITE_IDS = Object.keys(G.SITES);

  CAT.wan = {
    unlock: 7,
    types: {
      mpls: { name: 'MPLS VPN 專線', short: 'MPLS', bws: [50, 100, 200, 500], perMbps: { dom: 150, intl: 900 }, setup: 50000, lead: 1440, color: '#8f7cf0',
        desc: '電信業者的私有骨幹：不經過網際網路、延遲穩定、有 SLA 與 QoS。按頻寬計價，海外據點非常貴。總部也要有一條 MPLS 匯接線。' },
      iplc: { name: 'IPLC 國際私人專線', short: 'IPLC', bws: [50, 100, 200], perMbps: { intl: 1300 }, setup: 120000, lead: 2880, intlOnly: true, color: '#f2c14e',
        desc: '兩地之間的點對點國際專線，整條頻寬獨享、延遲最低，但最貴，而且是單一路徑：海纜斷了就斷了。' },
      inet: { name: '企業寬頻（網際網路）', short: '寬頻', bws: [300, 500, 1000], perMbps: { dom: 12, intl: 25 }, setup: 8000, lead: 720, color: '#5aa9f0',
        desc: '便宜、頻寬大，但只是「盡力而為」：延遲與掉包會跟著網路尖峰變動。要搭配 VPN 或 SD-WAN 才能連回總部。' },
      lte: { name: '4G / 5G 行動備援', short: '5G', bws: [100], monthly: 3000, setup: 3000, lead: 60, color: '#9aa7ad',
        desc: '插一張 SIM 卡就能上網：平常待命，主要線路斷了才接手。' },
    },
    /* 總部端 */
    hqMpls: { bws: [200, 500, 1000, 2000], perMbps: 80, setup: 60000, lead: 1440 },
    sdwan: { perSite: 15000, desc: '每個據點一台 SD-WAN 設備（授權與設備租用）' },
    /* 雲端專線（Direct Connect / ExpressRoute） */
    dx: { bws: [1000, 10000], monthly: { 1000: 60000, 10000: 280000 }, setup: 50000, lead: 2880 },
  };
  CAT.wan.price = (type, bw, intl) => {
    const t = CAT.wan.types[type];
    if (t.monthly) return t.monthly;
    return Math.round(bw * (intl ? t.perMbps.intl : t.perMbps.dom));
  };
})(window.G = window.G || {});
