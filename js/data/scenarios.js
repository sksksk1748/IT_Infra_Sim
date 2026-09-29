/* 情境挑戰：短時間、可重玩的限時情境（附評分）
 * 每個情境會先蓋好一套公司網路（刻意留一些弱點），把時間撥到事發前，
 * 再依情境安排事件與流量；結束時依結果評分並給出檢討。
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const Scen = {};
  G.Scen = Scen;
  const BEST_KEY = 'infraops.scen.best';

  /* ---------- 快速建好一套網路（不需要等施工與開機） ---------- */
  function buildNetwork(o) {
    const s = G.S, A = G.Act;
    const buy = (m, n) => (A.buyDevice(m, n || 1).ids || []);
    const L = (a, b, cable, speed, count, zone) => { const r = A.createLink(a, b, cable, speed, count || 1, zone); if (r.ok && s.links[r.id]) s.links[r.id].readyAt = 0; return r; };
    for (let i = 0; i < (o.racks || 3); i++) A.buyRack();
    for (const m of o.room || []) A.buyRoom(m);
    for (const r of s.room) r.readyAt = 0;
    const rtr = buy(o.router || 'NR-5500')[0];
    const fws = buy(o.firewall || 'SG-3000', o.fwHA === false ? 1 : 2);
    const cores = buy(o.core || 'CX-6400', o.cores || 2);
    const srv = buy('SV-1U', 4);
    const sts = buy('ST-4U', 2);
    const ups = buy('UPS-10K');
    const wlc = buy('WC-500');
    const dmz = buy('DX-2400');
    for (const id of [...ups, rtr, ...fws, ...cores, ...wlc, ...dmz, ...srv, ...sts]) A.autoInstall(id);
    for (const d of Object.values(s.devices)) d.bootUntil = 0;
    A.setRole(srv[0], 'ad'); A.setRole(srv[1], 'nms'); A.setRole(srv[2], 'db'); A.setRole(srv[3], 'web');
    A.setRole(sts[0], 'file'); A.setRole(sts[1], 'backup');
    const fwSpeed = o.fwSpeed || 10000, fwCable = o.fwCable || 'om4';
    for (const fw of fws) L(rtr, fw, fwCable, fwSpeed, 1, 'outside');
    if (fws.length > 1) L(fws[0], fws[1], 'cat6', 1000, 1);
    fws.forEach((fw, i) => L(fw, cores[Math.min(i, cores.length - 1)], fwCable, fwSpeed, 2, 'inside'));
    if (cores.length > 1) L(cores[0], cores[1], 'om4', 100000, 2);
    for (const id of [srv[0], srv[1], srv[2], ...sts]) for (const c of cores) L(id, c, 'om4', 10000);
    L(wlc[0], cores[0], 'om4', 10000);
    L(srv[3], dmz[0], 'cat6', 1000);
    L(dmz[0], fws[0], 'om4', 10000, 1, 'dmz');
    const floors = o.floors;
    for (const f of floors) {
      A.startCabling(f, 'cat6a');
      const fs = s.floors[f];
      fs.cabling.status = 'done';
      A.setAccess(f, o.access || 'AX-48P', o.idf || 12);
      fs.idf.bootUntil = 0;
      for (let k = 0; k < (o.uplinks || 2); k++) L('F:' + f, cores[k % cores.length], 'om4', 10000, 1);
      A.autoPlan(f, 'AP-600');
    }
    for (const [prov, plan] of o.isp || [['A', '10G'], ['B', '1G']]) A.orderIsp(prov, plan);
    for (const c of s.isp) { c.status = 'active'; c.readyAt = 0; if (!c.router && o.connectIsp !== false) A.connectIsp(c.id, rtr, true); }
    const R = (src, dst, svc) => A.addRule({ src, dst, svc, action: 'allow' });
    R('LAN', 'INTERNET', 'WEB'); R('LAN', 'INTERNET', 'DNS'); R('SERVERS', 'INTERNET', 'DNS'); R('INTERNET', 'DMZ', 'WEB'); R('DMZ', 'SERVERS', 'SQL');
    for (const id of o.services || []) A.subscribe(id);
    /* 位址池給足：情境要考的是事件本身，不是 DHCP 不夠用 */
    s.subnets.wifi = 19;
    s.subnets.wired = 22;
    for (const f of G.BLD.floors) {
      const fs = s.floors[f.id];
      fs.moveInAt = null;
      fs.movedIn = floors.includes(f.id) ? f.staff : 0;
    }
    /* 清潔人員給足：情境不考廁所 */
    if (s.rest) s.rest.staff = G.Rest.recommend();
    s.log = [];
    G.R.topoVer++;
    return { rtr, fws, cores, srv, sts };
  }
  /* 開發測試也會用到（在瀏覽器主控台快速建一套網路） */
  Scen.buildNetwork = buildNetwork;
  const ALL = ['1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '11F', '12F', '15F', '18F', '21F'];

  /* ---------- 情境 ---------- */
  Scen.list = [
    {
      id: 'ransom', title: '凌晨 3 點：勒索軟體', level: '困難', mins: 365,
      brief: ['凌晨 03:00，SIEM 發出告警：6F 研發部多台電腦的檔案副檔名變成 .locked，桌面出現勒索訊息。',
        '勒索軟體正在透過 SMB 橫向擴散，檔案伺服器很可能是下一個目標。公司沒有內部分段，也沒有 EDR。',
        '在 09:00 員工上班前處理完畢：先遏制、再根除、最後復原。'],
      goal: '09:00 前遏制勒索軟體，保住（或還原）檔案伺服器',
      tips: ['「事件」頁可以看到事件的即時紀錄與應變行動。', '先隔離，再保護檔案伺服器；有乾淨的備份就不必付贖金。', '沒有不可變備份時，還原可能失敗 ——「防火牆 → 資安服務」可以訂閱。'],
      setup(s) {
        buildNetwork({ floors: ALL, budget: 0 });
        s.money = 60000000;
        s.time = U.at(3, 2, 58);
      },
      begin(s, sc) {
        const inc = G.Ev.start('ransomware', { floor: '6F' });
        if (inc) { inc.data.blocked = false; G.Ev.detect(inc, 'SIEM 關聯告警'); sc.inc = inc.id; }
      },
      post(s, sc) {
        const inc = s.incidents.find((i) => i.id === sc.inc);
        if (!inc || inc.status !== 'active') return 'resolved';
        return null;
      },
      live(s, sc) {
        const inc = s.incidents.find((i) => i.id === sc.inc);
        if (!inc) return [];
        const d = inc.data;
        return [['受感染樓層', (d.infected || []).join('、') || '—'], ['檔案伺服器', d.fileEncrypted ? (d.restored ? '已還原' : '已被加密！') : d.fileSafe ? '已隔離保護' : '尚未受害'], ['狀態', inc.status === 'active' ? (d.contained ? '已隔離，等待根除 / 復原' : '擴散中') : '已結束']];
      },
      score(s, sc) {
        const inc = s.incidents.find((i) => i.id === sc.inc);
        const d = inc ? inc.data : {};
        const notes = [];
        let score = 100;
        const extra = Math.max(0, (d.infected || []).length - 1);
        if (extra) { score -= extra * 12; notes.push([false, `勒索軟體擴散到另外 ${extra} 層樓（${d.infected.slice(1).join('、')}）`]); }
        else notes.push([true, '勒索軟體沒有擴散到其他樓層']);
        if (d.fileEncrypted && !d.restored) { score -= 35; notes.push([false, '檔案伺服器被加密，而且沒有還原']); }
        else if (d.fileEncrypted) { score -= 12; notes.push([true, '檔案伺服器被加密，但從備份還原成功']); }
        else notes.push([true, d.fileSafe ? '及時隔離了檔案伺服器，資料安全' : '檔案伺服器沒有被加密']);
        if (s.stats.ransomPaid) { score -= 40; notes.push([false, '支付了贖金 —— 資助犯罪，也不保證能拿回資料']); }
        const bad = badActs(inc);
        if (bad.length) { score -= bad.length * 8; notes.push([false, `錯誤的應變行動：${bad.join('、')}`]); }
        const acts = inc ? inc.acts : {};
        const iso = acts.isolate ? acts.isolate.doneAt - sc.t0 : null;
        if (iso !== null && iso <= 45) { score += 8; notes.push([true, `開始後 ${U.dur(iso)} 就完成隔離，遏制得很快`]); }
        else if (iso !== null) notes.push([true, `開始後 ${U.dur(iso)} 完成隔離`]);
        else notes.push([false, '一直沒有隔離受感染的網段']);
        if (inc && inc.status !== 'active' && inc.outcome === 'contained') notes.push([true, `事件在 ${U.clock(s.time)} 完整處理（遏制 → 根除 → 復原）`]);
        else if (inc && inc.status === 'active') {
          /* 重灌要 8 小時、還原要 6 小時：上班前做不完是正常的，重點是方向對不對 */
          const onTrack = d.contained && acts.rebuild && (!d.fileEncrypted || acts.restore);
          if (onTrack) notes.push([true, '已遏制，重灌與復原也都已展開（重灌需要 8 小時，會在上班後完成）']);
          else { score -= 20; notes.push([false, '到上班時間還沒完成遏制，或還沒展開根除與復原']); }
        }
        if (acts.report) notes.push([true, '依規定通報了資安長與主管機關']);
        return { score, notes, tips: ['長期對策：啟用內部分段、導入 EDR、訂閱不可變備份。'] };
      },
    },
    {
      id: 'peak', title: '季末流量高峰', level: '中等', mins: 210,
      brief: ['季末最後一天，全公司都在上傳報表、開視訊會議。從 10:00 起的 3 小時，上網流量會是平常的 1.6 倍。',
        '這間公司當初為了省錢：只有一條 1G 專線在用，路由器與防火牆都是分支等級，彼此之間還是 1G 銅纜。另一條 10G 專線上週已經開通，但還沒接上。',
        '找出瓶頸並升級（預算 NT$800 萬），讓 10:00–13:00 的員工滿意度盡量維持在高檔。時間可以隨時暫停。'],
      goal: '10:00–13:00 的平均滿意度越高越好',
      tips: ['監控中心看得到哪條線路、哪台設備滿載。', '路由器、防火牆都有處理量上限，線路再粗也會被它們卡住。', '拓撲圖上可以把 ISP 接到路由器；單 WAN（主備援）路由器一次只能用一條專線。'],
      setup(s) {
        buildNetwork({ floors: ['2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F', '10F', '12F'], router: 'NR-1100', firewall: 'SG-300', fwHA: false, fwSpeed: 1000, fwCable: 'cat6', isp: [['A', '1G'], ['B', '10G']] });
        for (const c of s.isp) if (c.bw >= 10000) { c.router = null; c.port = null; }
        s.money = 8000000;
        s.time = U.at(3, 9, 30);
      },
      pre(s, sc) {
        const h = U.hourOf(s.time);
        if (h >= 10 && h < 13) G.R.mods.inetMult *= 1.6;
      },
      post(s, sc) {
        const h = U.hourOf(s.time);
        if (h >= 10 && h < 13 && G.R.sim && G.R.sim.sat !== null) sc.samples.push(G.R.sim.sat);
        return null;
      },
      live(s, sc) {
        const sim = G.R.sim || { sat: null, wan: { in: 0, cap: 0 } };
        const avg = sc.samples.length ? U.sum(sc.samples) / sc.samples.length : null;
        const h = U.hourOf(s.time);
        return [['流量', h >= 10 && h < 13 ? '高峰中（上網 ×1.6）' : h < 10 ? `${U.clock(U.at(3, 10))} 開始` : '已結束'], ['目前滿意度', sim.sat === null ? '—' : U.pct(sim.sat)], ['高峰平均', avg === null ? '—' : U.pct(avg)], ['WAN', `${U.bw(sim.wan.in)} / ${U.bw(sim.wan.cap)}`]];
      },
      score(s, sc) {
        const avg = sc.samples.length ? U.sum(sc.samples) / sc.samples.length : 0;
        const min = sc.samples.length ? Math.min(...sc.samples) : 0;
        let score = Math.round(avg * 100);
        const notes = [[avg >= 0.8, `高峰時段平均滿意度 ${U.pct(avg)}`]];
        if (min >= 0.7) { score += 5; notes.push([true, `最低也有 ${U.pct(min)}，全程沒有崩潰`]); }
        const sim = G.R.sim;
        /* 看實際在轉送流量的那一台（舊設備留在機櫃裡也不算） */
        const inUse = (cat) => {
          let best = null, bl = -1;
          for (const d of Q.devices(cat)) {
            if (!d.rack || !G.Net.devUp(d)) continue;
            const ni = sim && sim.nodes[d.id];
            const l = ni ? ni.load : -0.5;
            if (l > bl) { bl = l; best = d; }
          }
          return best;
        };
        const rtr = inUse('router'), fw = inUse('firewall');
        notes.push([!!(rtr && CAT.devices[rtr.model].thr >= 10000), rtr ? `路由器：${CAT.devices[rtr.model].name}（效能 ${U.bw(CAT.devices[rtr.model].thr)}）` : '沒有運作中的路由器']);
        notes.push([!!(fw && CAT.devices[fw.model].fw >= 10000), fw ? `防火牆：${CAT.devices[fw.model].name}（${U.bw(CAT.devices[fw.model].fw)}）` : '沒有運作中的防火牆']);
        notes.push([!!(sim && sim.wan.cap >= 10000), `對外頻寬：${U.bw(sim ? sim.wan.cap : 0)}`]);
        if (s.money < 0) { score -= 10; notes.push([false, '預算超支']); }
        return { score, notes, tips: ['瓶頸會移動：線路升級後，路由器或防火牆可能變成下一個瓶頸。', '多條專線要同時使用，路由器必須支援 BGP 負載分擔。'] };
      },
    },
    {
      id: 'launch', title: '官網上線日：DDoS', level: '中等', mins: 180,
      brief: ['今晚 20:00 新產品發表會，官網流量預計是平常的 3 倍。官網伺服器當初只用一條 1G 銅纜接到 DMZ 交換器，平常夠用，今晚就難說了。',
        '情報顯示競爭對手雇用的攻擊者準備在發表會前發動 DDoS，並嘗試 SQL Injection 竊取會員資料。',
        '讓官網撐過 20:00–22:00 的發表會，並保住會員資料庫。'],
      goal: '20:00–22:00 官網可用率越高越好，會員資料不外洩',
      tips: ['容量規劃：3 倍流量要先算一下 —— 在拓撲圖點官網伺服器的線路，可以升級線材與速率。', '大流量 DDoS 只能在 ISP 上游清洗，在防火牆封鎖 IP 沒有用。', 'WAF 可以擋下 SQL Injection 的攻擊特徵。'],
      setup(s) {
        buildNetwork({ floors: ALL });
        s.money = 20000000;
        s.time = U.at(5, 19, 0);
        s.sched.push({ at: U.at(5, 19, 30), type: 'ddos', visible: true });
        s.sched.push({ at: U.at(5, 19, 45), type: 'sqli', visible: true });
      },
      pre(s, sc) {
        const h = U.hourOf(s.time);
        if (h >= 20 && h < 22) G.R.mods.webMult *= 3;
      },
      post(s, sc) {
        const h = U.hourOf(s.time);
        if (h >= 20 && h < 22 && G.R.sim && G.R.sim.web.demand > 0) sc.samples.push(G.R.sim.web.ratio);
        return null;
      },
      live(s, sc) {
        const sim = G.R.sim || { web: { ratio: 0, demand: 0 } };
        const avg = sc.samples.length ? U.sum(sc.samples) / sc.samples.length : null;
        const h = U.hourOf(s.time);
        return [['發表會', h >= 20 && h < 22 ? '進行中（流量 ×3）' : h < 20 ? '20:00 開始' : '已結束'], ['官網可用率', sim.web.demand > 0 ? U.pct(sim.web.ratio) : '—'], ['發表會平均', avg === null ? '—' : U.pct(avg)], ['官網主機連線', U.bw(webUplink(s))]];
      },
      score(s, sc) {
        const avg = sc.samples.length ? U.sum(sc.samples) / sc.samples.length : 0;
        const notes = [[avg >= 0.9, `發表會期間官網平均可用率 ${U.pct(avg)}`]];
        const up = webUplink(s);
        notes.push([up > 1000, up > 1000 ? `官網伺服器的連線升級到 ${U.bw(up)}，撐得住 3 倍流量` : `官網伺服器只有 ${U.bw(up)} 連線，發表會流量卡在這裡`]);
        let score = Math.round(avg * 65);
        const sq = s.incidents.filter((i) => i.type === 'sqli');
        const leaked = sq.some((i) => i.outcome === 'fail');
        if (!leaked) { score += 25; notes.push([true, '會員資料沒有外洩']); } else notes.push([false, 'SQL Injection 成功，會員資料外洩']);
        const dd = s.incidents.filter((i) => i.type === 'ddos');
        if (dd.some((i) => i.data.mitigated)) { score += 10; notes.push([true, 'DDoS 由 ISP 清洗中心在上游處理']); }
        else if (dd.length) notes.push([false, 'DDoS 沒有被清洗，只能硬撐']);
        const bad = [].concat(...dd.map(badActs), ...sq.map(badActs));
        if (bad.length) { score -= bad.length * 8; notes.push([false, `錯誤的應變行動：${bad.join('、')}`]); }
        return { score, notes, tips: ['重要活動前先做容量規劃，並簽好 DDoS 清洗服務與 WAF，事發時就不用手忙腳亂。'] };
      },
    },
  ];
  const byId = {};
  for (const sc of Scen.list) byId[sc.id] = sc;
  Scen.def = (id) => byId[id];

  /** 官網伺服器目前可用的連線頻寬 (Mbps) */
  function webUplink(s) {
    const w = Q.roleServers('web')[0];
    if (!w) return 0;
    return U.sum(Q.linksOf(w.id).filter((l) => l.status === 'up' && (l.readyAt || 0) <= s.time).map((l) => l.speed * l.count));
  }

  function badActs(inc) {
    if (!inc) return [];
    const def = G.INC[inc.type];
    return Object.keys(inc.acts || {}).map((aid) => def.actions.find((a) => a.id === aid)).filter((a) => a && a.verdict === 'bad').map((a) => a.label);
  }

  /* ---------- 最佳成績（存在這台瀏覽器） ---------- */
  Scen.best = () => { try { return JSON.parse(U.store.get(BEST_KEY) || '{}') || {}; } catch (e) { return {}; } };
  const saveBest = (id, score) => { const b = Scen.best(); if (b[id] === undefined || score > b[id]) { b[id] = score; U.store.set(BEST_KEY, JSON.stringify(b)); return true; } return false; };
  Scen.grade = (score) => (score >= 90 ? 'S' : score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D');

  /** 開始一個情境：開一局沙盒、蓋好網路、撥好時間 */
  Scen.start = (id) => {
    const def = byId[id];
    if (!def) return null;
    G.Engine.newGame('sandbox');
    const s = G.S;
    def.setup(s);
    s.scen = { id, t0: s.time, end: s.time + def.mins, samples: [], done: false, result: null };
    G.R = { topoVer: 1 };
    G.Fac.update(0);
    G.Ev.applyEffects();
    G.Net.simulate();
    s.speed = 0;
    G.State.save(s);
    return s.scen;
  };
  /** 情境開始（簡報關閉後） */
  Scen.go = () => {
    const s = G.S, sc = s && s.scen;
    if (!sc || sc.begun) return;
    sc.begun = true;
    const def = byId[sc.id];
    if (def.begin) def.begin(s, sc);
    G.bus.emit('change', { what: 'scen' });
  };
  /** 每分鐘：模擬前（調整流量） */
  Scen.pre = (s) => { const sc = s.scen; if (!sc || sc.done || !sc.begun) return; const def = byId[sc.id]; if (def.pre) def.pre(s, sc); };
  /** 每分鐘：模擬後（取樣、判斷結束） */
  Scen.post = (s) => {
    const sc = s.scen;
    if (!sc || sc.done || !sc.begun) return;
    const def = byId[sc.id];
    const why = def.post ? def.post(s, sc) : null;
    if (why || s.time >= sc.end) Scen.finish(s, why || 'time');
  };
  Scen.finish = (s, why) => {
    const sc = s.scen;
    if (!sc || sc.done) return;
    sc.done = true;
    const def = byId[sc.id];
    const r = def.score(s, sc);
    r.score = U.clamp(Math.round(r.score), 0, 100);
    r.grade = Scen.grade(r.score);
    r.best = saveBest(sc.id, r.score);
    r.why = why;
    sc.result = r;
    G.Engine.setSpeed(0);
    G.State.save(s);
    G.bus.emit('scen', { kind: 'done', result: r });
  };
})(window.G = window.G || {});
