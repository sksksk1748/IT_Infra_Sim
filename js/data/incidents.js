/* 事件定義：維運事件（斷線、故障、停電）與資安事件（駭客攻擊）
 * 每個事件：init 初始化、tick 每分鐘推進、effects 對模擬的影響、actions 可採取的應變行動
 * 行動的 verdict：good = 正確做法、neutral = 有幫助但不是關鍵、bad = 錯誤或過度反應
 */
(function (G) {
  'use strict';
  const U = G.U, CAT = G.CAT, Q = G.Q;
  const E = () => G.Ev;
  const pos = () => G.Sec.posture();
  const randIP = () => `${U.randInt(31, 223)}.${U.randInt(0, 255)}.${U.randInt(0, 255)}.${U.randInt(2, 254)}`;
  const occupied = (min) => G.BLD.hq.filter((f) => G.S.floors[f.id].movedIn >= (min || 100));
  const C2 = ['update-check-cdn.xyz', 'msoffice-verify.top', 'cdn-sync-api.click', 'telemetry-win.site'];
  const bino = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (Math.random() < p) k++; return k; };
  const workHours = (t) => !U.isWeekend(t) && U.hourOf(t) >= 9 && U.hourOf(t) < 17;
  const hasOther = (list, pred) => list.some(pred);
  /* 晶圓廠：正在線上生產的機台、其中跑 Windows 的（蠕蟲的目標） */
  const fabOn = (i) => { const x = G.S.fab && G.S.fab.tools[i]; return !!x && x.st === 'online' && !x.down; };
  const fabWin = () => (G.S.fab ? G.S.fab.tools.map((x, i) => i).filter((i) => fabOn(i) && /Windows/.test(G.Fab.type(i).os)) : []);
  /* 廠務（第十一章）：廠務系統啟動了沒、統包商撤場了沒 */
  const plantOn = () => !!(G.Plant && G.Plant.active());
  const plantPerm = () => plantOn() && !G.Plant.temp();
  const fabRunning = () => !!G.R.fab && G.R.fab.online > 0;
  const GASN = { etch: 'Cl₂（氯氣）', dep: 'NH₃（氨氣）', clean: 'NF₃（三氟化氮）', dope: 'PH₃（磷化氫）' };
  const pcir = (id) => (id === 'N' ? '中性線匯流排' : `${id} ${G.Panel.def(id).name}`);
  /** 事件應變：無塵室禁止私人手機（安檢門還沒蓋就先動工，完工後自動生效） */
  function fabBan(s) {
    const F = s.fab;
    G.bus.emit('change', { what: 'fab' });
    if (!(F.gate > 0)) F.gate = s.time + CAT.fab.gate.buildMin;
    if (G.Fab.gateReady()) { F.phone = 'ban'; return `從現在起私人手機一律鎖在置物櫃。記得配發公司手持裝置（${F.hand} / ${G.Fab.handNeed()} 台），現場才查得到 MES。`; }
    F.phoneWant = true;
    return `安檢門與置物櫃施工中（約 ${U.dur(F.gate - s.time)}），完工後自動改成「禁止私人手機」。記得配發公司手持裝置。`;
  }

  /** 機房火警：冒煙變成起火，損害大小由消防設備決定（氣體滅火 < 預動式灑水 < 一般灑水頭） */
  function ignite(s, inc) {
    const d = inc.data;
    d.stage = 'fire';
    d.fireTime = s.time;
    const damaged = [];
    const hit = (x) => { if (x && !x.host && x.status === 'ok') { x.status = 'failed'; damaged.push(x.id); } };
    hit(s.devices[d.dev]);
    if (!inc.detected) E().detect(inc, '偵煙器動作（已經起火）');
    inc.title = `機櫃 ${d.rack} 起火`;
    E().log(inc, `🔥 機櫃 ${d.rack} 起火，濃煙觸發了偵煙器！`);
    const gas = s.room.find((r) => r.model === 'GAS-FS' && r.status === 'ok' && s.time >= (r.readyAt || 0));
    const idx = s.racks.findIndex((r) => r.id === d.rack);
    if (gas) {
      gas.status = 'discharged';
      d.suppress = 'gas';
      E().log(inc, '潔淨氣體滅火系統警報 30 秒後釋放，10 秒內撲滅火源。設備沒有泡水，只有起火的那台燒毀。');
    } else if (G.Fac.has('PREACT')) {
      d.suppress = 'preact';
      for (const x of Object.values(s.devices)) if (x.rack === d.rack && Math.random() < 0.6) hit(x);
      E().log(inc, `預動式灑水只在火源上方放水，火撲滅了，但機櫃 ${d.rack} 有 ${damaged.length} 台設備泡水損壞。`);
    } else {
      d.suppress = 'wet';
      const near = s.racks.filter((r, i) => Math.abs(i - idx) <= 1).map((r) => r.id);
      for (const x of Object.values(s.devices)) if (near.includes(x.rack) && Math.random() < 0.7) hit(x);
      d.powerCutUntil = s.time + 60;
      E().log(inc, `一般灑水頭動作，整區淋水：${damaged.length} 台設備泡水損壞。消防隊要求切斷機房電源 1 小時。`);
    }
    d.damaged = damaged;
    s.rating = Math.max(0, s.rating - (d.suppress === 'gas' ? 1 : 4));
    G.bus.emit('change', { what: 'room' });
  }
  const repairCost = (s, inc) => Math.round(80000 + U.sum((inc.data.damaged || []).map((id) => s.devices[id]).filter(Boolean), (d) => CAT.devices[d.model].price * 0.25));

  G.INC = {
    /* ================= 維運事件 ================= */
    'isp-down': {
      name: 'ISP 線路中斷', cat: 'ops', sev: 'high', kb: 'k-ha', minCh: 2, cooldown: 2880, detect: 'auto',
      weight: (s) => (s.isp.some((c) => c.status === 'active' && c.router) ? 1 : 0),
      init(s, inc) {
        const cs = s.isp.filter((c) => c.status === 'active' && c.router && !c.outage);
        if (!cs.length) return false;
        const c = U.pick(cs);
        c.outage = true;
        inc.data.isp = c.id;
        inc.data.until = s.time + U.randInt(60, 180);
        inc.title = `${CAT.isp.providers[c.provider].name} ${c.plan} 線路中斷`;
        E().log(inc, `${CAT.isp.providers[c.provider].name}：區域機房設備故障，${c.plan} 專線中斷，修復時間未定。`);
      },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, 'auto'); },
      end(s, inc) { const c = s.isp.find((x) => x.id === inc.data.isp); if (c) c.outage = false; },
      actions: [
        { id: 'call', label: '致電 ISP 報修並要求派員', time: 10, verdict: 'good',
          explain: '報修是正確的第一步。ISP 端的問題只能由 ISP 修，但主動報修並升級處理能縮短等待時間。',
          run(s, inc) { inc.data.until = Math.max(s.time + 20, inc.data.until - 50); E().log(inc, 'ISP 已派工程師前往處理。'); } },
        { id: 'reboot', label: '重新開機邊界路由器', time: 6, verdict: 'bad',
          explain: '中斷發生在 ISP 端，重開路由器無法解決，還會讓其他線路的流量也跟著中斷幾分鐘。',
          run(s) { for (const d of Q.devices('router')) if (d.rack) d.bootUntil = s.time + 5; } },
        { id: 'notify', label: '發布公告通知全公司', time: 5, verdict: 'neutral', explain: '讓員工知道狀況能減少重複報修，但無法解決問題。' },
      ],
      review(s, inc) {
        const other = hasOther(s.isp, (c) => c.id !== inc.data.isp && c.status === 'active' && c.router);
        return other ? ['第二條線路接手了流量 —— 這就是雙 ISP 備援的價值。'] : ['只有一條 ISP 線路就是單點故障。建議再申請一家不同業者的線路。'];
      },
    },

    'fiber-cut': {
      name: '主幹光纖中斷', cat: 'ops', sev: 'high', kb: 'k-lacp', minCh: 3, cooldown: 2880, detect: 'auto',
      weight: (s) => (Object.values(s.links).some((l) => l.status === 'up' && (l.a.startsWith('F:') || l.b.startsWith('F:'))) ? 0.8 : 0),
      init(s, inc) {
        const ls = Object.values(s.links).filter((l) => l.status === 'up' && (l.a.startsWith('F:') || l.b.startsWith('F:')) && s.floors[(l.a.startsWith('F:') ? l.a : l.b).slice(2)].movedIn > 0);
        if (!ls.length) return false;
        const l = U.pick(ls);
        l.status = 'cut';
        const fid = (l.a.startsWith('F:') ? l.a : l.b).slice(2);
        inc.data.link = l.id; inc.data.floor = fid;
        inc.title = `${fid} 主幹光纖中斷`;
        E().log(inc, `弱電豎井內的施工人員誤切了 ${fid} → ${Q.nodeName(Q.other(l, 'F:' + fid))} 的光纖。`);
      },
      tick(s, inc) { const l = s.links[inc.data.link]; if (!l || l.status === 'up') E().resolve(inc, 'fixed'); },
      actions: [
        { id: 'splice', label: '派光纖熔接工程師搶修（NT$3 萬）', cost: 30000, time: 120, verdict: 'good',
          explain: '光纖斷了只能重新熔接。事先準備好維修合約與備援路徑，才能縮短影響。',
          run(s, inc) { const l = s.links[inc.data.link]; if (l) l.status = 'up'; } },
        { id: 'swap', label: '更換樓層接入交換器', cost: 95000, time: 60, verdict: 'bad', explain: '交換器沒有壞，問題在光纖本身，換交換器是白花錢。' },
        { id: 'check', label: '確認樓層是否還有另一條上行', time: 5, verdict: 'good', explain: '先確認影響範圍：雙上行的樓層不會斷線，就能從容安排維修。',
          run(s, inc) { const n = Q.linksOf('F:' + inc.data.floor).filter((l) => l.status === 'up').length; E().log(inc, n ? `${inc.data.floor} 還有 ${n} 條上行正常運作。` : `${inc.data.floor} 沒有其他上行，整層斷線中！`); } },
      ],
      review(s, inc) {
        const n = Q.linksOf('F:' + inc.data.floor).length;
        return n > 1 ? ['這層樓有多條上行（最好接到不同的核心），所以沒有斷線。'] : ['單一上行 = 單點故障。建議每層樓以兩條光纖分別上連兩台核心交換器。'];
      },
    },

    /* 由實體接線觸發（phys.js）：迴圈上的交換器都沒開 STP */
    'storm': {
      name: '廣播風暴', cat: 'ops', sev: 'crit', kb: 'k-stp', minCh: 1, random: false, detect: 'auto',
      init(s, inc) {
        const R = G.R.l2;
        if (!R || R.stormNodes.size <= 1) return false;
        inc.data.nodes = Array.from(R.stormNodes);
        const lp = R.loops.find((x) => x.kind === 'storm');
        inc.data.where = lp ? (lp.self ? `${Q.nodeName(lp.self.node)} 的 ${G.Phys.name(lp.self.node, lp.self.ap)} ⇄ ${G.Phys.name(lp.self.node, lp.self.bp)}（同一台設備的兩個埠互接）` : `${Q.nodeName(lp.a)} ⇄ ${Q.nodeName(lp.b)} 之間多出來的一條線`) : '不明';
        const floors = inc.data.nodes.filter((n) => n.startsWith('F:')).length;
        inc.title = `廣播風暴：${inc.data.nodes.length} 台交換器${floors ? `（含 ${floors} 層樓）` : ''}癱瘓`;
        E().log(inc, `NMS 告警：核心交換器每秒收到上百萬個廣播封包，CPU 100%，${floors ? `${floors} 層樓` : '機房裡的設備'}全部連線逾時。`);
        E().log(inc, `迴圈位置：${inc.data.where}。迴圈上的交換器都沒有開 STP，同一個廣播封包在迴圈裡無限循環、越轉越多。`);
      },
      tick(s, inc) { if (!G.R.l2 || G.R.l2.stormNodes.size <= 1) E().resolve(inc, 'fixed'); },
      actions: [
        { id: 'stp', label: '在迴圈上的交換器啟用 STP（生成樹）', time: 3, verdict: 'good',
          explain: 'STP 會找出迴圈、把多出來的路徑擋下（Blocking），廣播就不會無限循環。所有交換器都應該開著 STP（RSTP / MSTP），接入埠再加上 BPDU Guard。',
          run(s, inc) {
            for (const id of inc.data.nodes) { const d = s.devices[id]; if (d && Q.nodeKind(id) === 'switch' && d.stp === false) d.stp = true; }
            G.Phys.touch(); G.Phys.refresh();
          } },
        { id: 'pull', label: '依告警找出造成迴圈的那條線，拔掉', time: 8, verdict: 'good',
          explain: '風暴當下最快的止血方法：找到最後接上去、造成迴圈的那條線，拔掉。事後再把 STP 開起來、查清楚為什麼會接錯。',
          run(s) {
            const R = G.Phys.refresh();
            for (const lp of R.loops.filter((x) => x.kind === 'storm')) {
              if (lp.self) { G.Phys.st().self = G.Phys.st().self.filter((x) => x !== lp.self); continue; }
              const l = lp.l;
              if (!l || !s.links[l.id]) continue;
              l.members = l.members.filter((m) => m !== lp.m);
              if (!l.members.length) delete s.links[l.id]; else G.Phys.sync(l);
            }
            G.Phys.touch(); G.Phys.refresh();
            G.bus.emit('change', { what: 'links' });
          } },
        { id: 'reboot', label: '重開核心交換器', time: 10, verdict: 'bad',
          explain: '迴圈還在：開機完成的瞬間，風暴馬上再起；重開機的那幾分鐘，全公司更是完全斷線。',
          run(s) { for (const d of Q.devices('switch')) if (d.rack && Q.isL3(d)) d.bootUntil = s.time + 8; } },
        { id: 'isp', label: '打電話請 ISP 檢查外部線路', time: 15, verdict: 'bad', explain: '問題在內部的 L2 迴圈，跟 ISP 一點關係都沒有。' },
      ],
      review(s, inc) {
        return ['廣播風暴幾乎都是「接出迴圈」＋「沒開 STP」：新交換器的出廠設定、有人把兩個埠接在一起、多拉一條備援線卻沒設 LACP……',
          '預防：所有交換器開 STP、接入埠開 BPDU Guard 與風暴控制（storm-control）、上線前先檢查新設備的設定。'];
      },
    },

    /* 廁所漏水：有智慧廁所的漏水感測器就幾分鐘內告警；沒有的話要等人發現——無障礙廁所和 IDF 只隔一道牆，漏久了會淹進 IDF */
    'rest-leak': {
      name: '廁所漏水', cat: 'ops', sev: 'high', kb: 'k-iot', minCh: 2, cooldown: 2880,
      weight: () => (G.Rest.occupied().length ? 0.35 : 0),
      init(s, inc) {
        const fl = G.Rest.occupied();
        if (!fl.length) return false;
        const f = U.pick(fl);
        const k = Math.random() < 0.5 ? 'A' : U.pick(['M', 'F']);
        const r = G.Rest.room(f.id, k);
        if (r.leak) return false;
        r.leak = true;
        Object.assign(inc.data, { fid: f.id, k, water: 0, idf: false, iot: G.Rest.iotOk(f.id) });
        inc.title = `${f.id} ${G.Rest.RM[k].name}漏水`;
        E().log(inc, `${f.id} ${G.Rest.RM[k].name}洗手台下方的給水管接頭鬆脫，開始漏水。`);
      },
      tick(s, inc) {
        const d = inc.data, r = G.Rest.room(d.fid, d.k);
        if (!r.leak && !d.idf) { E().resolve(inc, 'fixed'); return; }
        if (r.leak) d.water++;
        if (!inc.detected && r.leak) {
          /* 漏水感測器的資料送得到 IoT 管理平台：馬上告警；沒有的話要等有人發現地板積水 */
          if (G.Rest.iotOk(d.fid)) { d.iot = true; E().detect(inc, '智慧廁所的漏水感測器'); }
          else {
            const x = G.R.sim && G.R.sim.floors[d.fid];
            if (Math.random() < (x && x.present > 20 ? 0.012 : 0.002)) E().detect(inc, '員工回報廁所地板積水');
          }
        }
        /* 無障礙廁所和 IDF 弱電室只隔一道牆：漏了一個半小時，水就滲進 IDF */
        if (r.leak && d.k === 'A' && !d.idf && d.water >= 90) {
          d.idf = true;
          E().log(inc, `水從牆角滲進隔壁的 IDF 弱電室，接入交換器泡水短路：${d.fid} 整層斷網！`);
          if (!inc.detected) E().detect(inc, 'IDF 斷線告警');
          s.rating = Math.max(0, s.rating - 3);
        }
      },
      effects(s, inc, mods) { if (inc.data.idf) mods.floorOff[inc.data.fid] = true; },
      actions: [
        { id: 'valve', label: '關閉止水閥、請水電師傅修好接頭', cost: 6000, time: 25, verdict: 'good',
          explain: '先關水再修：止水閥一關就不會再漏。發現得越早，損害越小——這就是漏水感測器的價值。',
          run(s, inc) { G.Rest.room(inc.data.fid, inc.data.k).leak = false; E().log(inc, '止水閥關上、接頭換新，漏水停止。'); } },
        { id: 'idf', label: '搶修 IDF：斷電、烘乾、更換泡水的交換器', cost: (s, inc) => Math.round(30000 + CAT.access[s.floors[inc.data.fid].idf.model].price * 2), time: 120, verdict: 'good',
          avail: (s, inc) => inc.data.idf, unavail: 'IDF 沒有進水',
          explain: '泡過水的網路設備不能直接開機（會短路燒毀）：先斷電、烘乾，泡水的交換器換新，再把漏水源修好。',
          run(s, inc) { inc.data.idf = false; s.floors[inc.data.fid].idf.bootUntil = s.time + 5; E().log(inc, 'IDF 烘乾、交換器換新，樓層網路恢復。'); } },
        { id: 'mop', label: '請清潔人員先拖地', time: 10, verdict: 'bad', explain: '只拖地沒有關水，水還是一直漏：拖完又濕了，還可能淹進隔壁的 IDF 弱電室。' },
      ],
      review(s, inc) {
        const d = inc.data;
        const out = [d.iot ? '漏水感測器在幾分鐘內就發出告警，損害很小。' : `沒有漏水感測器（或感測器的資料送不到 IoT 平台），漏了 ${d.water} 分鐘才被發現。`];
        if (d.k === 'A') out.push('無障礙廁所和 IDF 弱電室只隔一道牆：弱電室旁邊的用水空間，最需要漏水偵測。');
        if (!d.iot) out.push('導入智慧廁所：漏水、衛生紙、整潔度都由感測器即時回報，清潔人員和水電可以第一時間處理。');
        return out;
      },
    },

    /* ---------- 晶圓廠（第十章） ---------- */
    /* 機台中毒：原廠的安裝媒體（或手機熱點、4G 分享器）帶進來的蠕蟲，在不能更新的舊 Windows 機台之間擴散 */
    'fab-malware': {
      name: '機台中毒：病毒在機台之間擴散', cat: 'sec', sev: 'crit', kb: 'k-fabsec', minCh: 10, random: false, detect: 'auto',
      init(s, inc) {
        const F = s.fab;
        if (!F || !F.open) return false;
        let i = inc.data.tool;
        if (!fabOn(i)) { const on = fabWin(); if (!on.length) return false; i = U.pick(on); inc.data.tool = i; }
        const via = inc.data.via === '4g' ? '原廠為了遠端維修接在機台上的 4G 分享器' : inc.data.via === 'hotspot' ? '工程師的手機熱點' : '原廠裝機時用的 USB 隨身碟';
        Object.assign(inc.data, { infected: [], contained: false, spreadAt: s.time + 10 });
        /* 應用程式白名單：只有原廠簽章的程式能執行，蠕蟲根本跑不起來 */
        if (G.Fab.allowReady()) {
          inc.data.blocked = true; inc.sev = 'low';
          inc.title = `${G.Fab.code(i)} 上的惡意程式被白名單擋下`;
          E().log(inc, `${G.Fab.name(i)} 上有一個不明程式想要執行（來源：${via}），應用程式白名單直接擋下，機台照常生產。`);
          return;
        }
        F.tools[i].down = 'mal'; F.tools[i].inf = false;
        inc.data.infected.push(i);
        inc.title = `機台中毒：${G.Fab.code(i)} 起的病毒在 OT 網路擴散`;
        E().log(inc, `${G.Fab.name(i)} 突然藍屏重開、EAP 跟它斷線：機台電腦被植入蠕蟲（來源：${via}），正透過 SMB 掃描其他機台。`);
        G.R.topoVer++;
      },
      tick(s, inc) {
        const d = inc.data, F = s.fab;
        if (d.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (d.done) { E().resolve(inc, 'fixed'); return; }
        if (d.contained || s.time < d.spreadAt) return;
        d.spreadAt = s.time + 10;
        if (G.Fab.allowReady()) { if (!d.wlLogged) { d.wlLogged = true; E().log(inc, '應用程式白名單啟用了：蠕蟲在其他機台上執行不起來，不再擴散。'); } return; }
        const cands = fabWin();
        const n = Math.min(cands.length, U.randInt(1, 3));
        for (let k = 0; k < n; k++) {
          const j = cands.splice(Math.floor(Math.random() * cands.length), 1)[0];
          F.tools[j].down = 'mal';
          d.infected.push(j);
        }
        if (n) {
          F.scrap += n * 2;
          E().log(inc, `又有 ${n} 台機台中毒停機：${d.infected.slice(-n).map((i) => G.Fab.code(i)).join('、')}（累計 ${d.infected.length} 台，製程中的晶圓報廢）`);
          G.R.topoVer++;
        }
      },
      actions: [
        { id: 'isolate', label: '先隔離：關掉中毒機台的交換器埠（NAC 可以一鍵隔離）', time: () => (Q.hasService('nac') ? 3 : 15), verdict: 'good',
          explain: '先止血：斷開中毒的機台，病毒就不能再透過網路擴散；沒中毒的機台照常生產。',
          run(s, inc) { inc.data.contained = true; E().log(inc, `${inc.data.infected.length} 台中毒的機台已經從 OT 網路隔離，擴散停止。`); } },
        { id: 'rebuild', label: '用原廠的乾淨映像檔重灌中毒的機台，掃毒後再接回', cost: (s, inc) => inc.data.infected.length * 25000, time: 180, verdict: 'good',
          avail: (s, inc) => inc.data.contained, unavail: '要先隔離：不然重灌好的機台一接回去又被感染',
          explain: '機台電腦不能自己亂裝防毒或更新（原廠不支援）：用原廠提供的乾淨映像檔重灌，再經過進廠掃毒，才能接回 OT 網路。',
          run(s, inc) {
            for (const i of inc.data.infected) Object.assign(s.fab.tools[i], { down: false, inf: false, scan: 'ok' });
            if (s.fab.g4 !== undefined && s.fab.g4 !== null) { s.fab.g4 = null; E().log(inc, '順便拆掉了機台上的 4G 分享器。'); }
            inc.data.done = true; G.R.topoVer++; G.bus.emit('change', { what: 'fab' });
            E().log(inc, `${inc.data.infected.length} 台機台重灌完成、重新接回網路。`);
          } },
        { id: 'allowlist', label: '導入機台應用程式白名單（只有原廠的程式能執行）', cost: () => CAT.fab.allowlist.price, time: 240, verdict: 'good',
          avail: (s) => !(s.fab.allow > 0), unavail: '白名單已經在部署或已經啟用',
          explain: '沒辦法更新的舊 Windows，至少要做到「只有原廠的程式能執行」：病毒就算進來了也跑不起來。',
          run(s, inc) { s.fab.allow = s.time; G.bus.emit('change', { what: 'fab' }); E().log(inc, '機台應用程式白名單部署完成。'); } },
        { id: 'patch', label: '幫所有機台裝 Windows 更新', time: 60, verdict: 'bad',
          explain: '機台電腦是原廠驗證過的封閉系統：自己裝更新會失去保固，還可能讓機台控制程式當掉。要靠隔離、掃毒與白名單。' },
        { id: 'shutdown', label: '關掉整座晶圓廠的網路', time: 5, verdict: 'bad',
          explain: '反應過度：沒中毒的機台也跟著停下來，製程中的晶圓整批報廢。只要隔離中毒的機台就夠了。',
          run(s, inc) { inc.data.contained = true; s.fab.scrap += 60; s.rating = Math.max(0, s.rating - 3); E().log(inc, '整座晶圓廠斷網：擴散停了，但所有機台跟著停線，製程中約 60 片晶圓報廢。'); } },
      ],
      review(s, inc) {
        const d = inc.data;
        if (d.blocked) return ['應用程式白名單讓不能更新的舊 Windows 也能擋下惡意程式。'];
        const out = [`${d.infected.length} 台機台中毒停機。`];
        if (d.via === '4g') out.push('病毒是從接在機台上的 4G 分享器進來的：原廠遠端維護一定要走 DMZ 的跳板機。');
        else if (d.via === 'hotspot') out.push('病毒是從工程師的手機熱點進來的：無塵室要禁止私人手機。');
        else out.push('原廠裝機用的 USB、筆電都要先經過進廠掃毒站。');
        if (!G.Fab.allowReady()) out.push('機台沒有應用程式白名單：病毒在不能更新的舊 Windows 之間暢行無阻。');
        return out;
      },
    },
    /* 機密外洩：無塵室裡有人用私人手機拍下機台畫面（製程配方），傳到通訊軟體群組 */
    'fab-leak': {
      name: '機密外洩：無塵室裡的手機照片', cat: 'sec', sev: 'high', kb: 'k-nophone', minCh: 10, cooldown: 4320,
      weight: (s) => (s.fab && s.fab.open && s.fab.phone !== 'ban' && s.floors.FAB.movedIn > 0 ? 0.35 : 0),
      init(s, inc) {
        const F = s.fab;
        if (!F || !F.open || s.floors.FAB.movedIn <= 0) return false;
        if (F.phone === 'ban' && G.Fab.gateReady()) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, '安檢門的金屬探測器在一位工程師的無塵衣口袋裡發現私人手機：保全請他回更衣室鎖進置物櫃。機台畫面沒有被拍走。');
          E().detect(inc, '無塵室安檢門');
          return;
        }
        E().log(inc, '一位工程師用私人手機拍下蝕刻機的配方畫面，傳到了「製程討論」的通訊軟體群組，群組裡還有已經離職、跳槽到競爭對手的前同事……');
      },
      detectChance: (s) => (s.trainingUntil > s.time ? 0.02 : 0.01),
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (inc.data.done) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt > 1440) { E().log(inc, '競爭對手發表的新製程，和我們的配方驚人地相似……'); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'contain', label: '找出拍照的人、請對方刪除所有照片並簽保密切結（法務介入）', time: 90, verdict: 'neutral',
          explain: '亡羊補牢：照片已經傳出去了，只能盡量追回。真正要做的是讓這件事不會再發生。',
          run(s, inc) { E().log(inc, '拍照的同事刪除了照片，群組也清除了。但誰已經轉存過，就不知道了。'); inc.data.done = true; } },
        { id: 'ban', label: '無塵室全面禁止私人手機：安檢門 + 置物櫃（再配發無相機的公司手持裝置）', cost: (s) => (s.fab.gate > 0 ? 0 : CAT.fab.gate.price), time: 30, verdict: 'good',
          explain: '晶圓廠的標準做法：私人手機、有相機的裝置一律不能帶進無塵室；現場要查 MES，就用公司配發、沒有相機的手持裝置。',
          run(s, inc) { E().log(inc, fabBan(s)); inc.data.done = true; } },
        { id: 'ignore', label: '只是幾張照片，不用大驚小怪', verdict: 'bad',
          explain: '製程配方是晶圓廠最值錢的資產：一張照片就可能讓競爭對手省下好幾年的研發。' },
      ],
      review(s, inc) {
        if (inc.data.blocked) return ['安檢門與置物櫃擋下了私人手機：機密沒有外流。'];
        return ['無塵室允許私人手機：配方、機台畫面、無塵室的配置都可能被拍走。', '禁止私人手機之後，要配發無相機的公司手持裝置，現場才查得到 MES。'];
      },
    },
    /* 手機熱點：工程師用自己的手機開熱點，讓機台電腦連上網際網路下載驅動程式——繞過了整個 IT / OT 防火牆 */
    'fab-hotspot': {
      name: '機台偷偷連上了手機熱點', cat: 'sec', sev: 'high', kb: 'k-fabsec', minCh: 10, cooldown: 4320,
      weight: (s) => (s.fab && s.fab.open && s.fab.phone !== 'ban' && fabWin().length > 5 ? 0.3 : 0),
      init(s, inc) {
        const F = s.fab;
        if (!F || !F.open || F.phone === 'ban') return false;
        const on = fabWin();
        if (!on.length) return false;
        const i = U.pick(on);
        inc.data.tool = i;
        inc.title = `${G.Fab.code(i)} 偷偷連上了手機熱點`;
        E().log(inc, `工程師為了幫 ${G.Fab.name(i)} 下載新的驅動程式，把機台電腦接上自己手機的熱點：這台機台現在直接連在網際網路上，完全沒經過防火牆。`);
      },
      detectChance: () => (Q.hasService('nac') ? 0.15 : Q.hasService('ips') ? 0.03 : 0.015),
      tick(s, inc) {
        const d = inc.data;
        if (d.done) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt >= 90) {
          E().log(inc, '網際網路上的掃描程式找到了這台沒有更新的機台，植入了蠕蟲……');
          E().resolve(inc, 'fail');
          if (!E().active().some((x) => x.type === 'fab-malware')) E().start('fab-malware', { tool: d.tool, via: 'hotspot' });
        }
      },
      actions: [
        { id: 'remove', label: '斷開手機熱點，這台機台掃毒後再接回 OT 網路', time: 20, verdict: 'good',
          explain: '機台只能透過 OT 網路連到 MES / EAP：任何「另外的網路出口」都繞過了防火牆。',
          run(s, inc) { inc.data.done = true; E().log(inc, '熱點斷開了，機台掃毒後重新接回 OT 網路。'); } },
        { id: 'ban', label: '無塵室全面禁止私人手機（安檢門 + 置物櫃）', cost: (s) => (s.fab.gate > 0 ? 0 : CAT.fab.gate.price), time: 30, verdict: 'good',
          explain: '沒有私人手機，就沒有手機熱點這個後門。原廠要下載的東西，走 DMZ 的跳板機或更新伺服器。',
          run(s, inc) { E().log(inc, fabBan(s)); inc.data.done = true; } },
        { id: 'ignore', label: '下載完驅動程式就好，沒關係', verdict: 'bad',
          explain: '不能更新的舊 Windows 直接暴露在網際網路上：幾分鐘內就會被掃描、植入惡意程式。' },
      ],
      review() { return ['機台連上手機熱點＝在 OT 網路上開了一個不經過防火牆的後門。', '禁止私人手機；NAC 可以發現機台多了一個不明的網路介面。']; },
    },
    /* 原廠要遠端診斷機台：走跳板機，還是在機台上接 4G 分享器？ */
    'fab-vendor': {
      name: '機台故障：原廠要遠端診斷', cat: 'ops', sev: 'high', kb: 'k-fabsec', minCh: 10, cooldown: 4320, detect: 'auto',
      weight: (s) => (s.fab && s.fab.open && G.Fab.counts().online > 10 ? 0.25 : 0),
      init(s, inc) {
        const F = s.fab;
        if (!F || !F.open) return false;
        const WHERE = { scanner: '荷蘭', implant: '美國', etch: '日本' };
        const on = F.tools.map((x, i) => i).filter((i) => fabOn(i) && WHERE[G.Fab.slots()[i].type]);
        if (!on.length) return false;
        const i = U.pick(on);
        F.tools[i].down = 'vendor';
        inc.data.tool = i;
        inc.title = `${G.Fab.code(i)} 故障：原廠要遠端診斷`;
        E().log(inc, `${G.Fab.name(i)} 報錯停機。原廠的工程師在${WHERE[G.Fab.slots()[i].type]}，要遠端連進機台電腦看 log、調參數。這台停著，這一區的產能就少一台。`);
        G.R.topoVer++;
      },
      tick(s, inc) {
        const x = s.fab.tools[inc.data.tool];
        if (!inc.data.done) return;
        if (x && x.down === 'vendor') x.down = false;
        G.R.topoVer++;
        E().resolve(inc, 'fixed');
      },
      actions: [
        { id: 'jump', label: '透過 DMZ 的跳板機讓原廠連線（MFA、全程錄影、只開這一台、用完就關）', time: 90, verdict: 'good',
          avail: () => G.Sec.posture().jumpOk, unavail: '還沒有可用的跳板機：伺服器設成「跳板機」角色接在 DMZ、防火牆開 DMZ → OT：RDP，並啟用 MFA',
          explain: '原廠遠端維護唯一的入口：身分驗證（MFA）、全程錄影、只能連到指定的機台、用完就關閉。',
          run(s, inc) { inc.data.done = true; E().log(inc, '原廠經跳板機連進來，調整參數後機台恢復生產。連線紀錄與錄影都留存了。'); } },
        { id: '4g', label: '在機台上接一台 4G 分享器，讓原廠直接連進來', time: 30, verdict: 'bad',
          explain: '最快、但最危險：機台直接暴露在網際網路上，繞過了整個 IT / OT 防火牆。這個「後門」還常常忘了拆。',
          run(s, inc) {
            inc.data.done = true;
            s.fab.g4 = inc.data.tool;
            G.bus.emit('change', { what: 'fab' });
            s.sched.push({ at: s.time + U.randInt(600, 1500), type: 'fab-malware', data: { tool: inc.data.tool, via: '4g' }, chapter: s.chapter });
            E().log(inc, '原廠經 4G 分享器連進來修好了機台……分享器還插在上面。');
          } },
        { id: 'onsite', label: '請原廠派工程師到現場維修（最快明天到）', time: 1200, verdict: 'neutral',
          explain: '安全，但機台要停將近一天，這一區的產能少一台。有跳板機的話，今天就能修好。',
          run(s, inc) { inc.data.done = true; E().log(inc, '原廠工程師到場修好了機台。'); } },
      ],
      review(s, inc) {
        const a = inc.acts;
        if (a['4g']) return ['4G 分享器是繞過防火牆的後門：病毒、駭客都可能從這裡進來。原廠遠端維護要走 DMZ 的跳板機。'];
        if (a.jump) return ['跳板機讓原廠可以安全地遠端維修：MFA、錄影、只開指定的機台、用完就關。'];
        return ['原廠遠端維護要有安全的管道：DMZ 的跳板機 + MFA + 錄影，否則就只能等原廠到現場。'];
      },
    },

    /* ---------- 廠務（第十一章） ---------- */
    /* 電壓驟降：雷擊輸電線路，電壓掉到五、六成、幾百毫秒——沒有 DUPS 的機台跳機（Plant.tick 處理跳機與報廢） */
    'fab-sag': {
      name: '電壓驟降：雷擊台電輸電線路', cat: 'ops', sev: 'high', kb: 'k-fabpower', minCh: 11, cooldown: 2880, detect: 'auto',
      weight: () => (plantOn() && fabRunning() ? 0.3 : 0),
      init(s, inc) {
        if (!plantOn()) return false;
        inc.data.until = s.time + 1;
        inc.data.v = inc.data.v || U.pick([55, 60, 65, 70]);
        inc.data.ms = inc.data.ms || U.pick([150, 200, 300]);
        E().log(inc, `午後雷雨，雷擊台電的 161 kV 輸電線路：晶圓廠的電壓瞬間掉到 ${inc.data.v}%、持續 ${inc.data.ms} 毫秒（電燈只閃了一下）。`);
      },
      effects(s, inc, mods) { if (s.time <= inc.data.until) mods.fabGrid = 'sag'; },
      tick(s, inc) {
        const d = inc.data, R = G.R.plant;
        if (!R) { E().resolve(inc, 'auto'); return; }
        if (s.time > d.until && !d.hit) {
          d.hit = true;
          d.tripped = R.tripped.slice();
          E().log(inc, d.tripped.length ? `${d.tripped.map((a) => CAT.fab.areas[a].name).join('、')}的機台跳機：要重新開機、升溫、校正；製程中的晶圓報廢。` : '接在 DUPS 後面的製程區都撐住了：飛輪在幾毫秒內接手，機台沒有感覺。');
        }
        /* 復歸計畫定好了（或各區都重新開機完成）就結案：之後各區自己照時間恢復 */
        if (d.hit && (!R.tripped.length || (inc.acts.sequence && inc.acts.sequence.done))) E().resolve(inc, d.tripped.length ? 'fixed' : 'blocked');
      },
      actions: [
        { id: 'sequence', label: '依序復歸：先確認排氣與洗滌塔、再純水與化學品，最後才開機台', time: 10, verdict: 'good',
          explain: '排氣沒恢復就開機台，有毒廢氣沒有地方排；大量馬達同時起動，湧入電流可能讓主斷路器再跳一次。依序復歸最快、也最安全。',
          run(s) { const P = s.plant; for (const a in P.trip) if (P.trip[a] > s.time) P.trip[a] -= Math.round((P.trip[a] - s.time) * 0.2); } },
        { id: 'all', label: '所有機台同時重新開機，越快越好', time: 5, verdict: 'bad',
          explain: '上百台馬達、加熱器同時起動，湧入電流讓主斷路器再跳一次；排氣還沒恢復就開機，機台會因為安全連鎖停下來。',
          run(s) { const P = s.plant; for (const a in P.trip) if (P.trip[a] > s.time) P.trip[a] += 30; } },
        { id: 'pq', label: '調閱電力品質紀錄，請台電說明事故原因', time: 30, verdict: 'neutral',
          explain: '電力品質紀錄（電壓驟降的深度與時間）可以用來評估要不要加裝 DUPS、要求機台符合 SEMI F47。但是改變不了這一次的損失。' },
      ],
      review(s, inc) {
        const d = inc.data, D = G.Plant.dups();
        if (!d.tripped || !d.tripped.length) return ['DUPS 撐住了關鍵製程區：電壓驟降只有幾百毫秒，但沒有保護的機台就會跳機。'];
        const out = [`${d.tripped.length} 個製程區跳機。電壓驟降只有 ${d.ms} 毫秒，機台重新開機、升溫、校正卻要好幾個小時（擴散爐管要 4 小時）。`];
        out.push(D.cap ? `DUPS 容量 ${U.num(D.cap)} kVA：把最怕停電的區域（擴散、植入、黃光）接到 DUPS。` : '沒有 DUPS：電壓驟降一來，全廠跳機。');
        out.push('雙回路受電擋不住電壓驟降——雷擊時整個電網的電壓都會掉。');
        return out;
      },
    },
    /* 台電停電：沒有第二回路就全廠停電；有第二回路就自動切換（只有一瞬間的驟降） */
    'fab-outage': {
      name: '台電停電：晶圓廠的供電線路故障', cat: 'ops', sev: 'crit', kb: 'k-fabpower', minCh: 11, cooldown: 4320, detect: 'auto',
      weight: () => (plantPerm() && fabRunning() ? 0.18 : 0),
      init(s, inc) {
        if (!plantOn()) return false;
        const dur = inc.data.dur || U.randInt(40, 110);
        inc.data.until = s.time + dur;
        inc.data.f2 = G.Plant.count('feeder2') > 0;
        const pw = G.Plant.pw();
        inc.data.gen = G.Plant.gen().ok && G.Plant.count('gen') > 0;
        inc.data.dups = pw.dups.ok;
        E().log(inc, inc.data.f2 ? '台電 A 路饋線故障（變電所的斷路器跳脫）：自動切換到 B 路，只有一瞬間的電壓驟降。' : `台電饋線故障，晶圓廠全廠停電，預計 ${dur} 分鐘後復電。`);
        if (!inc.data.f2) E().log(inc, inc.data.dups || inc.data.gen ? `緊急電源：${inc.data.dups ? 'DUPS 接手' : '發電機約 1 分鐘後啟動'}，排氣、洗滌塔、氣體偵測繼續運轉。` : '沒有 DUPS、也沒有發電機：排氣、洗滌塔、氣體偵測全部停擺！');
      },
      effects(s, inc, mods) { if (s.time < inc.data.until) mods.fabGrid = 'out'; },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, inc.data.f2 ? 'blocked' : 'auto'); },
      actions: [
        { id: 'safe', label: '依緊急應變程序：確認排氣、洗滌塔、GDS 在緊急電源上運轉，關閉非必要的特殊氣體', time: 10, verdict: 'good',
          explain: '停電時最危險的不是產能，而是有毒氣體：排氣與氣體偵測一定要在緊急電源上。' },
        { id: 'restart', label: '復電後依序復歸：排氣 → 純水 → 化學品 → 機台', time: 10, verdict: 'good',
          explain: '依序復歸避免湧入電流再次跳電，也確保機台開機時排氣已經恢復。' },
        { id: 'gen', label: '派人手動啟動發電機', time: 10, verdict: 'neutral', explain: '發電機有自動切換開關（ATS），正常會自己啟動；沒有發電機的話，派人也沒用。' },
      ],
      review(s, inc) {
        const d = inc.data;
        if (d.f2) return ['雙回路受電：一條線路故障就自動切換到另一條，只有一瞬間的電壓驟降。沒有接 DUPS 的機台還是會跳，但不會長時間停電。'];
        const out = ['只有一條台電線路：線路一故障，全廠停電到復電為止。加一條雙回路受電，就只剩切換瞬間的驟降。'];
        out.push(d.dups || d.gen ? '緊急電源撐住了排氣、洗滌塔與氣體偵測。' : '沒有 DUPS、沒有發電機：停電時排氣與氣體偵測都停了，這是工安大忌。');
        return out;
      },
    },
    /* 主變壓器故障：N+1 的話沒感覺，沒有備援就要卸載 */
    'fab-tx': {
      name: '主變壓器故障', cat: 'ops', sev: 'high', kb: 'k-fabpower', minCh: 11, cooldown: 4320, detect: 'auto',
      weight: () => (plantPerm() && G.Plant.count('tx') > 0 ? 0.12 : 0),
      init(s, inc) {
        if (!plantPerm() || G.Plant.count('tx') < 1) return false;
        inc.data.until = s.time + 8 * 60;
        const n1 = (G.Plant.count('tx') - 1) * CAT.plant.eq.tx.kva * CAT.plant.txLoad >= G.Plant.load(false).kva;
        inc.data.n1 = n1;
        E().log(inc, `一台主變壓器的絕緣油溫度異常、保護電驛跳脫，要停機檢修約 8 小時。${n1 ? '剩下的變壓器容量夠：N+1 發揮作用。' : '剩下的變壓器撐不住全廠負載！'}`);
      },
      effects(s, inc, mods) { if (s.time < inc.data.until) mods.fabTxOut = 1; },
      tick(s, inc) { if (s.time >= inc.data.until || (inc.data.n1 && s.time - inc.startedAt >= 10)) E().resolve(inc, inc.data.n1 ? 'blocked' : 'fixed'); },
      actions: [
        { id: 'rush', label: '請變壓器廠商夜間搶修（縮短 3 小時）', cost: 450000, time: 20, verdict: 'good', explain: '事先簽好維護合約，搶修才叫得到人。',
          run(s, inc) { inc.data.until = Math.max(s.time + 30, inc.data.until - 180); } },
        { id: 'shed', label: '先停掉非必要負載（辦公區空調、照明）', time: 10, verdict: 'neutral', explain: '能省一點是一點，但真正的解法是主變壓器要有 N+1。' },
      ],
      review(s, inc) { return inc.data.n1 ? ['主變壓器 N+1：少一台也撐得住全廠負載。'] : ['主變壓器沒有 N+1：壞一台就要卸載，製程區跟著減產。'] ; },
    },
    /* 配電盤的迴路跳脫（js/sim/panel.js 觸發）：起動電流、過載、短路 */
    'plant-trip': {
      name: '配電盤迴路跳脫', cat: 'ops', sev: 'med', kb: 'k-panel', minCh: 11, random: false, detect: 'auto',
      init(s, inc) {
        const d = G.Panel.def(inc.data.cid);
        if (!d) return false;
        inc.title = `${d.id} ${d.name}：斷路器跳脫`;
        const W = { short: '一送電就「碰」一聲跳脫，出線端有燒焦的痕跡', start: '馬達一起動就跳脫', overload: '運轉幾分鐘後跳脫' };
        E().log(inc, `配電盤 DP-UT1 的 ${d.id} ${d.name}：${W[inc.data.why] || '跳脫'}。`);
      },
      tick(s, inc) {
        /* 原因排除（斷路器換對了、電纜換新了）而且重新送電，才算修好 */
        const id = inc.data.cid, c = G.Panel.c(id), d = G.Panel.def(id);
        const fixed = inc.data.why === 'short' ? c.ins >= 1 : c.at >= G.Panel.flc(d) * (inc.data.why === 'start' ? 1.5 : 1.05);
        if (fixed && c.on && !c.trip) E().resolve(inc, 'fixed');
      },
      actions: [
        { id: 'find', label: '先查原因：鉤表量電流、核對斷路器與負載的額定、量絕緣電阻', time: 10, verdict: 'good',
          explain: '斷路器跳脫一定有原因：選太小（馬達起動電流大約是額定的 6 倍）、過載、還是絕緣破損短路？沒找到原因就送電，只會再跳一次，甚至燒掉設備。',
          run(s, inc) {
            const d = G.Panel.def(inc.data.cid), c = G.Panel.c(inc.data.cid), r = G.Panel.range(d);
            const W = { short: `絕緣電阻只有 ${c.ins} MΩ：電纜破損，要停電換電纜`, start: `額定電流 ${G.Panel.flc(d).toFixed(0)} A，斷路器只有 ${c.at} A：馬達要 ${Math.ceil(r.min)}～${Math.floor(r.max)} A 的斷路器`, overload: `負載 ${G.Panel.flc(d).toFixed(0)} A 超過斷路器 ${c.at} A` };
            E().log(inc, `原因：${W[inc.data.why] || '不明'}。到「廠務 → 配電盤」停電（LOTO）後修正。`);
          } },
        { id: 'reset', label: '直接復歸，重新送電試試看', time: 2, verdict: 'bad',
          explain: '沒排除原因就硬送電：斷路器會再跳一次；如果是短路，電弧會把電纜和斷路器一起燒壞。',
          run(s, inc) { const c = G.Panel.c(inc.data.cid); if (!c.lock) { c.trip = false; c.on = true; } } },
      ],
      review(s, inc) {
        const W = { short: '絕緣不良：送電前一定要做絕緣電阻測試（≥ 1 MΩ），拉線時刮傷的電纜會直接短路。', start: '馬達的起動電流是額定的 5～7 倍：斷路器要選 1.5～2.5 倍額定電流，太小會一起動就跳。', overload: '負載超過斷路器額定：斷路器與電纜都要照負載電流選。' };
        return [W[inc.data.why] || '跳脫的原因要找出來再送電。'];
      },
    },
    /* 配電盤過熱冒煙：電纜太細、端子沒鎖緊、中性線電流太大 */
    'plant-hot': {
      name: '配電盤過熱冒煙', cat: 'ops', sev: 'crit', kb: 'k-panel', minCh: 11, random: false, detect: 'auto',
      init(s, inc) {
        const id = inc.data.cid;
        if (id !== 'N' && !G.Panel.def(id)) return false;
        inc.title = `配電盤 DP-UT1 冒煙：${pcir(id)}`;
        const W = { cable: '電纜的外皮發燙、冒出焦味（電纜太細，電流超過安培容量）', loose: '端子附近冒煙、有燒焦的痕跡（端子沒鎖緊，接觸電阻發熱）', neutral: '中性線匯流排發燙、變色（單相負載都擠在同一相，中性線電流太大）' };
        E().log(inc, `巡檢人員聞到焦味：${pcir(id)} ${W[inc.data.cause]}。再不處理就會起火。`);
      },
      tick(s, inc) {
        const d = inc.data, id = d.cid;
        const cool = id === 'N' ? G.Panel.phases(false).N < 30 : !G.Panel.running(id);
        if (cool) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt >= 60 && !d.fire) {
          d.fire = true;
          E().log(inc, '🔥 起火了！電纜燒毀，整個電源區的主斷路器跳脫。');
          const pn = G.Panel.st();
          if (id === 'N') { pn.inc.N.on = false; }
          else { const c = G.Panel.c(id); c.ins = 0.1; c.trip = true; c.heat = 0; }
          s.money -= 800000;
          G.Act.log('配電盤火災：損失 NT$80 萬', 'bad');
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'isolate', label: '立刻把冒煙的迴路停電（OFF）', time: 1, verdict: 'good',
          explain: '電氣過熱第一步就是斷電：沒有電流就不會再發熱。之後再依 LOTO 程序處理根本原因（換電纜、鎖緊端子、重新分配相位）。',
          run(s, inc) {
            const id = inc.data.cid;
            if (id === 'N') { for (const x of G.Panel.DEF) if (x.ph === 1) G.Panel.c(x.id).on = false; E().log(inc, '先把單相迴路都關掉，中性線電流降下來了。'); }
            else G.Panel.c(id).on = false;
          } },
        { id: 'co2', label: '拿 CO₂ 滅火器在旁邊待命', time: 2, verdict: 'good', explain: '電氣火災用 CO₂ 或乾粉滅火器：不導電、不留殘渣。' },
        { id: 'water', label: '拉消防水管過來灑水降溫', time: 5, verdict: 'bad',
          explain: '帶電的配電盤灑水：水會導電，救火的人可能感電，短路還會讓事故擴大。電氣設備絕對不能用水滅火。',
          run(s) { s.rating = Math.max(0, s.rating - 3); } },
      ],
      review(s, inc) {
        const W = { cable: '電纜太細：安培容量要大於斷路器的額定（斷路器才保護得了電線）。', loose: '端子沒鎖緊：施工後要依規定扭力鎖緊，並定期用紅外線熱像檢查。', neutral: '單相負載要平均分到 R / S / T 三相：不平衡時中性線電流變大、發熱。' };
        return [W[inc.data.cause] || '', '紅外線熱像檢查可以在冒煙之前就找到過熱點。'].filter(Boolean);
      },
    },
    /* 帶電作業：沒有停電、上鎖掛牌、驗電就施工（js/sim/panel.js 觸發） */
    'plant-arc': {
      name: '帶電作業：電弧閃絡', cat: 'ops', sev: 'crit', kb: 'k-loto', minCh: 11, random: false, detect: 'auto',
      init(s, inc) {
        const id = inc.data.cid;
        inc.title = `${G.Panel.def(id) ? pcir(id) : '配電盤'}：帶電施工發生電弧閃絡`;
        E().log(inc, '技術員沒有停電就動手，工具碰到帶電的端子：瞬間的電弧溫度上萬度，強光與爆風灼傷了手臂和臉。');
        const c = G.Panel.def(id) ? G.Panel.c(id) : null;
        if (c) { c.trip = true; }
        s.rating = Math.max(0, s.rating - 6);
        s.money -= 1200000;
        G.Act.log('職災：帶電作業電弧灼傷（醫療、補償、停工調查 NT$120 萬）', 'bad');
      },
      tick(s, inc) {
        if (inc.acts.aid && inc.acts.aid.done && inc.acts.report && inc.acts.report.done) E().resolve(inc, 'contained');
        else if (s.time - inc.startedAt > 180) E().resolve(inc, 'fail');
      },
      actions: [
        { id: 'aid', label: '急救：確認已斷電，用大量冷水沖洗灼傷處，送醫', time: 10, verdict: 'good', explain: '電弧灼傷要立刻冷卻、送醫；救人之前一定先確認電源已經切斷，避免二次傷害。' },
        { id: 'report', label: '職災通報、全面停工檢討，重新訓練停電作業程序（LOTO）', time: 60, verdict: 'good', explain: '依法要通報重大職災；這種事故幾乎都是「沒有停電、沒有上鎖掛牌、沒有驗電」造成的。' },
        { id: 'hide', label: '私下處理，不要通報，趕快繼續施工', time: 5, verdict: 'bad', explain: '隱匿職災違法，而且同樣的錯誤一定會再發生。' },
      ],
      review() { return ['停電作業程序（LOTO）：斷電 → 上鎖掛牌 → 驗電 → 施工 → 拆除掛牌 → 送電，一步都不能省。', '換斷路器、改接匯流排要動到電源側：整個電源區的進線都要停電。'] ; },
    },
    /* 濕區插座沒有漏電斷路器：有人感電 */
    'plant-shock': {
      name: '濕區插座漏電：有人感電', cat: 'ops', sev: 'high', kb: 'k-panel', minCh: 11, random: false, detect: 'auto',
      init(s, inc) {
        const id = inc.data.cid, d = G.Panel.def(id);
        if (!d) return false;
        inc.title = `${d.name}漏電：清潔人員感電`;
        E().log(inc, `清潔人員在${d.name.replace('（濕區）', '')}用濕手插上高壓清洗機，插座漏電：沒有漏電斷路器，電流一直流過人體，旁邊的人趕緊拉下總開關。`);
        s.rating = Math.max(0, s.rating - 4);
        s.money -= 500000;
        G.Act.log('職災：濕區插座感電（NT$50 萬）', 'bad');
      },
      tick(s, inc) { if (inc.acts.aid && inc.acts.aid.done) E().resolve(inc, 'contained'); },
      actions: [
        { id: 'aid', label: '確認斷電後再救人：檢查呼吸心跳、CPR 與 AED、送醫', time: 10, verdict: 'good', explain: '救感電的人之前一定先斷電，否則救人的人也會感電。' },
        { id: 'grab', label: '衝過去把感電的人拉開', time: 1, verdict: 'bad', explain: '沒有斷電就碰感電的人：電流會經過救人的人，變成兩個人受傷。' },
        { id: 'elcb', label: '安排停電，把濕區迴路換成漏電斷路器（30 mA）', cost: 9000, time: 40, verdict: 'good',
          explain: '漏電斷路器偵測到 30 mA 的漏電流，在 0.1 秒內跳脫，人就不會有生命危險：濕區、戶外、插座迴路一定要裝。',
          run(s, inc) { const c = G.Panel.c(inc.data.cid); c.elcb = true; G.Panel.st().stats.fixes++; G.Panel.log(`${inc.data.cid}：換成漏電斷路器（事故後停電更換）`); } },
      ],
      review() { return ['濕區（純水室、化學品室、沖淋洗眼器）的插座與電熱迴路，一定要用漏電斷路器（30 mA）。']; },
    },
    /* 特殊氣體洩漏：GDS + ESO 幾秒內自動遮斷；只有 GDS 要人工關閥；什麼都沒有就只能靠人聞 */
    'plant-gas': {
      name: '特殊氣體洩漏', cat: 'ops', sev: 'crit', kb: 'k-gas', minCh: 11, cooldown: 4320,
      weight: () => (plantPerm() && G.Plant.SG.some((g) => G.Plant.count('gc:' + g) > 0) ? 0.15 : 0),
      init(s, inc) {
        if (!plantOn()) return false;
        const gs = G.Plant.SG.filter((g) => G.Plant.count('gc:' + g) > 0);
        const g = inc.data.g && G.Plant.count('gc:' + inc.data.g) ? inc.data.g : gs.length ? U.pick(gs) : inc.data.g || 'dep';
        inc.data.g = g;
        const gas = GASN[g];
        inc.title = `${gas} 洩漏：${CAT.plant.sg[g].name}的氣瓶櫃`;
        const gds = G.Plant.count('gds') > 0 && G.Panel.factor('GDS') > 0, eso = G.Plant.count('eso') > 0;
        E().log(inc, `${CAT.plant.sg[g].name}氣瓶櫃的接頭墊片老化，${gas} 開始洩漏。`);
        if (gds && eso) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, '氣瓶櫃裡的偵測器 2 秒內偵測到洩漏：ESO 自動關閉緊急遮斷閥，啟動警報與疏散廣播，排氣把殘氣抽到洗滌塔處理。沒有人受傷。');
          E().detect(inc, 'GDS 自動偵測');
          return;
        }
        if (gds) { E().detect(inc, 'GDS 告警'); E().log(inc, 'GDS 告警！但沒有緊急遮斷連鎖（ESO）：要有人穿上呼吸器去現場關閥。'); }
        else E().log(inc, '沒有氣體偵測器（或 GDS 主機沒電）：沒有人知道氣體正在外洩。');
      },
      detectChance: () => 0.04,
      tick(s, inc) {
        const d = inc.data;
        if (d.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (d.closed) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt >= 90) {
          E().log(inc, '洩漏持續太久：現場人員吸入有毒氣體送醫，消防局與環保局到場，特殊氣體全面停止供應。');
          s.money -= 2500000;
          G.Act.log('特殊氣體洩漏：人員送醫、停工調查（NT$250 萬）', 'bad');
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'evac', label: '啟動疏散廣播，人員撤離到上風處集合點名', time: 3, verdict: 'good', explain: '先保護人：撤離、點名，確認沒有人還在現場。' },
        { id: 'close', label: '兩人一組穿自給式空氣呼吸器（SCBA），進去關閉氣瓶櫃的閥門', time: 15, verdict: 'good',
          explain: '進入洩漏區一定要穿呼吸器、兩人一組互相照應；有 ESO 的話，這一步在洩漏的 2 秒內就自動完成了。', run(s, inc) { inc.data.closed = true; } },
        { id: 'sniff', label: '派人先去現場聞聞看是不是真的漏氣', time: 10, verdict: 'bad',
          explain: '很多特殊氣體極低濃度就致命（砷化氫、磷化氫），有些無色無味，SiH₄ 碰到空氣會自燃：絕對不能用鼻子確認。',
          run(s) { s.rating = Math.max(0, s.rating - 3); } },
      ],
      review(s, inc) {
        if (inc.data.blocked) return ['GDS + 緊急遮斷連鎖（ESO）：從偵測到切斷只要幾秒，人不用冒險進去關閥。'];
        const out = [];
        if (!G.Plant.count('gds')) out.push('沒有氣體偵測系統：洩漏只能等有人不舒服才發現。');
        if (!G.Plant.count('eso')) out.push('沒有緊急遮斷連鎖（ESO）：偵測到了也要人穿呼吸器進去關閥。');
        if (G.Plant.count('gds') && G.Panel.st().cir.GDS.bus !== 'E') out.push('GDS 主機接在一般電源：停電時氣體偵測也跟著停了。');
        return out.length ? out : ['特殊氣體洩漏：先疏散，再由穿呼吸器的人員關閥。'];
      },
    },
    /* 化學品洩漏：氫氟酸從閥箱的接頭滲漏 */
    'plant-chem': {
      name: '化學品洩漏：氫氟酸', cat: 'ops', sev: 'crit', kb: 'k-chem', minCh: 11, cooldown: 4320,
      weight: () => (plantPerm() && G.Plant.count('acid') > 0 ? 0.15 : 0),
      init(s, inc) {
        if (!plantOn() || !G.Plant.count('acid')) return false;
        inc.title = '氫氟酸（HF）從化學品閥箱滲漏';
        E().log(inc, 'CDS 化學品閥箱的接頭鬆動，49% 氫氟酸開始滲漏到雙套管的外管。');
        if (G.Plant.count('leak')) { E().detect(inc, '洩漏感測器'); E().log(inc, '雙套管裡的洩漏感測器立刻告警，FMCS 自動關閉這一路的供應閥。'); inc.data.auto = true; }
        else E().log(inc, '沒有洩漏偵測：化學品慢慢從外管滲出來，流到閥箱下方……');
      },
      detectChance: () => 0.03,
      tick(s, inc) {
        const d = inc.data;
        if ((inc.acts.ppe && inc.acts.ppe.done) || (d.auto && inc.acts.isolate && inc.acts.isolate.done)) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt >= (d.auto ? 240 : 120)) {
          E().log(inc, '一位技術員沒穿防護裝備就去擦拭，手指沾到氫氟酸：幾個小時後劇痛、送醫。');
          s.money -= 2000000;
          G.Act.log('化學品職災：氫氟酸灼傷（NT$200 萬）', 'bad');
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'isolate', label: '關閉 CDS 這一路的供應閥，隔離洩漏的閥箱', time: 10, verdict: 'good', explain: '先切斷來源：洩漏不會再擴大。' },
        { id: 'ppe', label: '穿耐酸防護衣、面罩與手套，用吸液棉與中和劑處理', time: 40, verdict: 'good', explain: '處理氫氟酸一定要全套防護；洩漏區要先圍起來，不相關的人不要靠近。' },
        { id: 'gluconate', label: '準備葡萄糖酸鈣凝膠：有人接觸就立刻沖水、塗抹、送醫', time: 5, verdict: 'good', explain: '氫氟酸會穿透皮膚、和體內的鈣結合（低血鈣、心律不整）：沖水之後塗葡萄糖酸鈣凝膠是標準急救。' },
        { id: 'wipe', label: '拿抹布擦乾就好，不用大驚小怪', time: 5, verdict: 'bad', explain: '氫氟酸一開始不痛，幾小時後才劇痛，而且會傷到骨頭與心臟：一定要穿防護裝備處理。', run(s) { s.rating = Math.max(0, s.rating - 3); } },
      ],
      review(s, inc) { return G.Plant.count('leak') ? ['雙套管 + 洩漏感測器：一滲漏就告警、自動關閥。'] : ['沒有洩漏偵測：化學品滲漏要等有人看到才發現。']; },
    },
    /* 超純水水質變差：拋光樹脂快飽和，電阻率慢慢下降 */
    'plant-upw': {
      name: '超純水水質異常', cat: 'ops', sev: 'high', kb: 'k-upw', minCh: 11, cooldown: 4320,
      weight: () => (plantPerm() && G.Plant.count('polish') > 0 ? 0.22 : 0),
      init(s, inc) {
        if (!plantPerm() || !G.Plant.count('polish')) return false;
        inc.data.level = 0.05;
        E().log(inc, '拋光混床的樹脂快飽和了，有機物與離子開始穿透：超純水的電阻率慢慢往下掉。');
        if (G.Plant.count('upwmon')) E().detect(inc, '線上水質監測：電阻率 17.9 MΩ·cm、TOC 上升');
      },
      detectChance: (s, inc) => (inc.data.level > 0.6 ? 0.03 : 0.002),
      effects(s, inc, mods) { if (!inc.data.fixed) mods.upwBad = Math.max(mods.upwBad || 0, inc.data.level); },
      tick(s, inc) {
        const d = inc.data;
        if (d.fixed) { E().resolve(inc, 'fixed'); return; }
        d.level = Math.min(1, d.level + 0.004);
        if (!inc.detected && d.level > 0.6) E().detect(inc, '晶圓缺陷檢測：金屬與顆粒污染異常');
        if (d.level >= 1 && s.time - inc.startedAt > 720) { E().log(inc, '好幾批晶圓因為水質問題報廢。'); if (s.fab) s.fab.scrap += 80; E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'switch', label: '切換到備援的拋光機組，隔離這一組', time: 15, verdict: 'good',
          avail: () => G.Plant.count('polish') >= 2, unavail: '只有一組拋光機組：沒有備援可以切換',
          explain: '拋光機組做 N+1：一組出問題，馬上切到另一組，水質不受影響。', run(s, inc) { inc.data.fixed = true; } },
        { id: 'resin', label: '更換拋光混床樹脂', cost: 350000, time: 180, verdict: 'good', explain: '樹脂是耗材，要定期更換；有線上水質監測，就能在水質變差之前安排更換。', run(s, inc) { inc.data.fixed = true; } },
        { id: 'ignore', label: '電阻率還有 17 以上，先繼續生產', time: 0, verdict: 'bad', explain: '先進製程對金屬離子與有機物極度敏感：水質一變差，晶圓缺陷就增加、良率下降。' },
      ],
      review(s, inc) { return G.Plant.count('upwmon') ? ['線上水質監測讓問題在影響晶圓之前就被發現。'] : ['沒有線上水質監測：要等晶圓缺陷增加才發現水質變差。']; },
    },
    /* 限水：枯水期自來水減量供應；有回收水系統就撐得住 */
    'plant-drought': {
      name: '枯水期限水：工業用水減量供應', cat: 'ops', sev: 'high', kb: 'k-upw', minCh: 11, cooldown: 10080, detect: 'auto',
      weight: () => (plantPerm() && G.Plant.count('ro') > 0 ? 0.1 : 0),
      init(s, inc) {
        if (!plantPerm()) return false;
        inc.data.until = s.time + 2 * 1440;
        E().log(inc, '水庫蓄水率偏低，自來水公司對工業用戶減量供水 30%，為期兩天。');
        if (G.Plant.count('reclaim')) { inc.data.blocked = true; inc.sev = 'low'; E().log(inc, '回收水系統把自來水用量壓低六成：減量供水之後還是夠用。'); }
      },
      effects(s, inc, mods) { if (s.time < inc.data.until && !inc.data.truck && !G.Plant.count('reclaim')) mods.drought = true; },
      tick(s, inc) {
        if (inc.data.blocked && s.time - inc.startedAt >= 30) { E().resolve(inc, 'blocked'); return; }
        /* 叫了水車、或回收水系統蓋好了：撐得過去 */
        if (inc.data.truck || G.Plant.count('reclaim')) { E().resolve(inc, 'contained'); return; }
        if (s.time >= inc.data.until) E().resolve(inc, 'auto');
      },
      actions: [
        { id: 'reclaim', label: '緊急建置回收水系統', cost: () => CAT.plant.eq.reclaim.price, time: () => CAT.plant.eq.reclaim.buildMin, verdict: 'good',
          avail: () => !G.Plant.total('reclaim'), unavail: '回收水系統已經有了（或正在施工）',
          explain: '把清洗水分類回收再利用：平常就能省水，限水時更是保命。', run(s) { (s.plant.eq.reclaim = s.plant.eq.reclaim || []).push(s.time); } },
        { id: 'truck', label: '叫水車運水（兩天 NT$160 萬）', cost: 1600000, time: 120, verdict: 'neutral', explain: '2021 年大旱時，晶圓廠真的是靠水車撐過去的：有效，但很貴。', run(s, inc) { inc.data.truck = true; } },
        { id: 'cut', label: '先停掉非必要的用水（景觀、辦公區、洗車）', time: 30, verdict: 'good', explain: '省下來的每一噸水都能留給製程。' },
      ],
      review() { return G.Plant.count('reclaim') ? ['回收水系統讓晶圓廠不怕限水。'] : ['沒有回收水：限水時 RO 的原水不夠，純水產量跟著減少。']; },
    },
    /* 特殊氣體鋼瓶更換：依 SOP 吹驅、洩漏測試，還是趕時間直接換？ */
    'plant-cyl': {
      name: '特殊氣體鋼瓶要更換', cat: 'ops', sev: 'med', kb: 'k-gas', minCh: 11, cooldown: 2880, detect: 'auto',
      weight: () => (plantPerm() && G.Plant.SG.some((g) => G.Plant.count('gc:' + g) > 0) ? 0.3 : 0),
      init(s, inc) {
        const gs = G.Plant.SG.filter((g) => G.Plant.count('gc:' + g) > 0);
        if (!plantOn() || !gs.length) return false;
        const g = U.pick(gs);
        inc.data.g = g;
        inc.title = `${GASN[g]} 鋼瓶快用完了`;
        E().log(inc, `${CAT.plant.sg[g].name}氣瓶櫃的 ${GASN[g]} 鋼瓶壓力剩 10%：已經自動切換到備用瓶，要在備用瓶用完之前換上新鋼瓶。`);
      },
      effects(s, inc, mods) { if (inc.data.empty && !inc.data.done) mods.sgOut = inc.data.g; },
      tick(s, inc) {
        const d = inc.data;
        if (d.done) { E().resolve(inc, d.quick ? 'contained' : 'fixed'); return; }
        if (!d.empty && s.time - inc.startedAt >= 16 * 60) { d.empty = true; E().log(inc, `備用瓶也用完了：${CAT.plant.sg[d.g].name}停止供應，用到的機台全部停下來。`); }
      },
      actions: [
        { id: 'sop', label: '依 SOP：兩人一組、穿防護具，換瓶前用氮氣吹驅管路，換好做洩漏測試', time: 60, verdict: 'good',
          explain: '吹驅（purge）把管路裡殘留的特殊氣體換成氮氣，拆接頭時才不會外洩；換好之後的洩漏測試確認接頭密合。', run(s, inc) { inc.data.done = true; } },
        { id: 'quick', label: '趕時間：不吹驅、不測漏，直接換', time: 15, verdict: 'bad',
          explain: '拆接頭時管路裡的殘氣會直接外洩；接頭沒測漏，之後還會慢慢漏。大部分的特殊氣體事故都發生在換瓶。',
          run(s, inc) { inc.data.done = true; inc.data.quick = true; s.sched.push({ at: s.time + U.randInt(20, 180), type: 'plant-gas', data: { g: inc.data.g }, chapter: s.chapter }); } },
      ],
      review(s, inc) { return inc.data.quick ? ['換瓶沒有吹驅、沒有測漏：這就是特殊氣體洩漏最常見的原因。'] : ['依 SOP 換瓶：吹驅、兩人一組、洩漏測試。']; },
    },

    'hw-fail': {
      name: '設備硬體故障', cat: 'ops', sev: 'high', kb: 'k-ha', minCh: 3, cooldown: 2880, detect: 'auto',
      weight: (s) => (Object.values(s.devices).some((d) => d.rack && d.status === 'ok') ? 0.45 : 0),
      init(s, inc) {
        let d = inc.data.dev ? s.devices[inc.data.dev] : null;
        /* 劇本：虛擬化主機故障（測試 HA） */
        if (!d && inc.data.hvFirst) {
          const hs = G.VM.hosts().filter((x) => x.status === 'ok' && G.VM.onHost(x.id).length);
          if (hs.length) d = U.pick(hs);
        }
        if (!d && inc.data.coreFirst) {
          const cores = Object.values(s.devices).filter((x) => x.rack && x.status === 'ok' && Q.isL3(x));
          if (cores.length) d = U.pick(cores);
        }
        if (!d) {
          const cands = Object.values(s.devices).filter((x) => x.rack && !x.host && x.status === 'ok' && ['router', 'firewall', 'switch', 'server'].includes(CAT.devices[x.model].cat));
          d = U.pick(cands);
        }
        if (!d || d.status !== 'ok') return false;
        d.status = 'failed';
        inc.data.dev = d.id;
        inc.title = `${d.name} 硬體故障`;
        E().log(inc, `${d.name}（${CAT.devices[d.model].name}）${inc.data.humid ? '：機房濕度太高，主機板結露短路' : inc.data.heat ? '：機房過熱，零件燒毀' : '電源供應器燒毀'}，設備停止運作。`);
      },
      tick(s, inc) { const d = s.devices[inc.data.dev]; if (!d || d.status === 'ok') E().resolve(inc, 'fixed'); },
      actions: [
        { id: 'rma', label: '申請原廠 RMA 替換（約 4 小時）', cost: (s, inc) => Math.round(CAT.devices[s.devices[inc.data.dev].model].price * 0.15), time: 240, verdict: 'good',
          explain: '有保固合約就申請 RMA，原廠會送來替換品。這段期間靠備援設備撐住。',
          run(s, inc) { const d = s.devices[inc.data.dev]; if (d) { d.status = 'ok'; d.bootUntil = s.time + 5; } } },
        { id: 'buy', label: '緊急採購全新設備替換（約 1 小時）', cost: (s, inc) => CAT.devices[s.devices[inc.data.dev].model].price, time: 60, verdict: 'neutral',
          explain: '最快恢復，但非常昂貴。有 HA 或備品就不需要這樣做。',
          run(s, inc) { const d = s.devices[inc.data.dev]; if (d) { d.status = 'ok'; d.bootUntil = s.time + 5; } } },
        { id: 'reboot', label: '遠端重新開機', time: 5, verdict: 'bad', explain: '硬體故障沒辦法靠重開機解決。' },
      ],
      review(s, inc) {
        const d = s.devices[inc.data.dev];
        if (!d) return [];
        const m = CAT.devices[d.model];
        if (m.hv) {
          const moved = G.VM.vms().filter((v) => v.haMoves);
          return [G.VM.cluster().ha ? `虛擬化主機故障，HA 在幾分鐘內把上面的 VM 在其他主機重新開機（${moved.length} 台曾被 HA 重啟過）。` : '主機故障時沒有 HA（要兩台以上主機 + SAN 共用儲存 + 開啟 HA），上面的 VM 全部停擺。',
            '叢集要保留一台主機的空間（N+1），HA 才有地方重啟 VM。'];
        }
        const peers = Object.values(s.devices).filter((x) => x.id !== d.id && x.rack && CAT.devices[x.model].cat === m.cat && (m.cat !== 'server' || x.role === d.role));
        return peers.length ? [`還有其他 ${CAT.categories[m.cat].name}（${peers.map((p) => p.name).join('、')}）可以接手 —— 備援設計發揮作用。`] : [`${d.name} 沒有備援。重要設備應該成對部署（HA / 雙核心 / 兩台 AD）。`];
      },
    },

    'power-out': {
      name: '大樓市電中斷', cat: 'ops', sev: 'crit', kb: 'k-power', minCh: 4, cooldown: 4320, detect: 'auto',
      weight: () => 0.6,
      init(s, inc) {
        const dur = inc.data.dur || U.randInt(25, 80);
        s.power.outageStart = s.time;
        s.power.outageUntil = s.time + dur;
        inc.data.until = s.power.outageUntil;
        inc.title = '大樓市電中斷';
        E().log(inc, `電力公司饋線故障，新曜大樓全棟停電，預計 ${dur} 分鐘後復電。`);
      },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, 'auto'); },
      actions: [
        { id: 'check', label: '巡檢機房溫度與 UPS 剩餘時間', time: 5, verdict: 'good', explain: '停電時精密空調可能停擺，要密切注意溫度與 UPS 電量。',
          run(s, inc) { const f = G.R.fac; E().log(inc, `UPS 容量 ${(f.upsCap / 1000).toFixed(1)} kW / 負載 ${(f.itLoad / 1000).toFixed(1)} kW，剩餘電量 ${Math.round(s.power.upsCharge * 100)}%，機房 ${s.temp.toFixed(1)}°C。`); } },
        { id: 'notify', label: '通知各樓層主管並發布公告', time: 5, verdict: 'good', explain: '溝通是事件處理的一部分，讓大家知道預計復電時間。' },
        { id: 'gen', label: '派人手動啟動發電機', time: 10, verdict: 'neutral', explain: '發電機有自動切換開關 (ATS)，正常情況會自己啟動；沒有發電機的話，派人也沒用。' },
      ],
      review(s) {
        const f = G.R.fac || {};
        const out = [];
        out.push(f.upsCap >= f.itLoad && f.upsCap > 0 ? 'UPS 容量足以承擔機房負載。' : 'UPS 容量不足（或沒有 UPS）：停電瞬間機房設備就斷電了。');
        out.push(f.gen ? '發電機在一分鐘內接手供電，空調也持續運轉。' : '沒有發電機：UPS 電池耗盡後設備就會斷電，而且空調停擺會讓機房快速升溫。');
        const noUps = G.BLD.floors.filter((x) => s.floors[x.id].movedIn > 0 && !s.floors[x.id].idf.ups).length;
        if (noUps) out.push(`${noUps} 層樓的 IDF 沒有 UPS，交換器與 AP 在停電瞬間全部重開機。`);
        return out;
      },
    },

    'cooling-fail': {
      name: '機房空調故障', cat: 'ops', sev: 'high', kb: 'k-cooling', minCh: 3, cooldown: 2880,
      weight: (s) => (G.Fac.roomUnits('cooling').length && G.R.fac && G.R.fac.itLoad > 3000 ? 0.7 : 0),
      init(s, inc) {
        const us = G.Fac.roomUnits('cooling');
        if (!us.length) return false;
        const u = us.slice().sort((a, b) => CAT.room[b.model].coolKW - CAT.room[a.model].coolKW)[0];
        u.status = 'failed';
        inc.data.unit = u.id;
        inc.data.until = s.time + 360;
        inc.title = `${CAT.room[u.model].name} 故障`;
        E().log(inc, `${CAT.room[u.model].name} 壓縮機跳脫，冷卻能力下降，機房溫度開始上升。`);
        /* 有環控就立刻知道；沒有的話，要等機房熱到有人發現 */
        if (G.Fac.has('EMS-1')) E().detect(inc, '環控系統：空調停機告警');
      },
      tick(s, inc) {
        if (!inc.detected && s.temp >= 29) E().detect(inc, '值班人員發現機房變熱');
        const u = s.room.find((r) => r.id === inc.data.unit);
        if (!u) { E().resolve(inc, 'auto'); return; }
        if (u.status === 'ok' && s.time >= (u.readyAt || 0)) { E().resolve(inc, 'fixed'); return; }
        if (s.time >= inc.data.until) { u.status = 'ok'; u.readyAt = s.time; E().resolve(inc, 'auto'); }
      },
      actions: [
        { id: 'repair', label: '叫修空調廠商（NT$6 萬，約 1.5 小時）', cost: 60000, time: 90, verdict: 'good', explain: '請專業廠商修復，同時監控溫度。',
          run(s, inc) { const u = s.room.find((r) => r.id === inc.data.unit); if (u) { u.status = 'ok'; u.readyAt = s.time; } } },
        { id: 'fans', label: '打開機房門、架設大型風扇', time: 10, verdict: 'neutral', explain: '只能稍微延緩升溫，而且破壞冷熱通道與門禁管制。',
          run(s) { s.temp = Math.max(22, s.temp - 1.5); } },
      ],
      review(s, inc) {
        const f = G.R.fac || {};
        const out = [f.coolN1 >= f.heat ? '其他空調足以承擔熱負載（N+1），溫度維持正常。' : '少了一台空調，冷卻能力就不夠了。機房冷卻應該做到 N+1。'];
        out.push(inc.detectHow && inc.detectHow.indexOf('環控') >= 0 ? '環控系統在空調停機的當下就發出告警。' : '沒有環境監控，要等機房變熱才發現空調壞了。建議建置 EMS。');
        return out;
      },
    },

    'dc-fire': {
      name: '機房火警', cat: 'ops', sev: 'crit', kb: 'k-fire', minCh: 3, cooldown: 5760,
      weight: (s) => { const f = G.R.fac; return f && f.itLoad + (f.aiLoad || 0) > 2000 ? 0.16 + (s.temp > 32 ? 0.3 : 0) : 0; },
      init(s, inc) {
        let src = inc.data.dev ? s.devices[inc.data.dev] : null;
        if (!src) {
          const cands = Object.values(s.devices).filter((d) => d.rack && !d.host && d.status === 'ok' && CAT.devices[d.model].cat !== 'bbu');
          src = U.pick(cands);
        }
        if (!src || !src.rack) return false;
        inc.data.dev = src.id; inc.data.rack = src.rack;
        inc.data.stage = 'smoke';
        inc.data.fireAt = s.time + (inc.data.delay || U.randInt(18, 30));
        inc.title = `機櫃 ${src.rack} 冒煙`;
        E().log(inc, `${src.name} 的電源模組過熱，絕緣外皮開始冒出肉眼看不見的微量煙霧。`);
        if (G.Fac.has('VESDA')) E().detect(inc, 'VESDA 極早期偵煙');
      },
      tick(s, inc) {
        const d = inc.data;
        if (d.stage === 'smoke' && s.time >= d.fireAt) ignite(s, inc);
        if (d.stage === 'fire' && d.cleaned) E().resolve(inc, 'fixed');
        else if (d.stage === 'fire' && s.time >= d.fireTime + 720) E().resolve(inc, 'fail');
      },
      effects(s, inc, mods) { if (inc.data.powerCutUntil > s.time) mods.mdfOff = true; },
      actions: [
        { id: 'isolate', label: '循 VESDA 取樣點找到冒煙的設備，關機並抽出電源模組', time: 10, verdict: 'good',
          avail: (s, inc) => inc.data.stage === 'smoke', unavail: '已經起火了，來不及',
          explain: '極早期偵煙的價值：在起火前找到過熱的零件並斷電，火災根本不會發生。',
          run(s, inc) {
            if (inc.data.stage !== 'smoke') return;
            const d = s.devices[inc.data.dev];
            if (d) d.status = 'failed';
            inc.data.stage = 'prevented';
            E().log(inc, `找到了：${d ? d.name : '設備'} 的電源模組已經焦黑。關機抽出後煙霧停止，火災沒有發生（設備需要送修）。`);
            E().resolve(inc, 'contained');
          } },
        { id: 'epo', label: '按下緊急斷電（EPO），整間機房斷電', time: 1, verdict: 'bad',
          explain: '冒煙階段就全機房斷電，所有服務瞬間中斷；應該精準處理冒煙的那一台。',
          run(s, inc) { inc.data.powerCutUntil = s.time + 45; E().log(inc, '整間機房斷電 45 分鐘。'); } },
        { id: 'restore', label: '災後清理、檢測並更換受損設備', cost: (s, inc) => repairCost(s, inc), time: 360, verdict: 'good',
          avail: (s, inc) => inc.data.stage === 'fire', unavail: '還沒有起火',
          explain: '確認火源已滅後：清除殘留的水或煙塵、逐台檢測，並更換受損的設備。',
          run(s, inc) {
            for (const id of inc.data.damaged || []) { const d = s.devices[id]; if (d && d.status === 'failed') { d.status = 'ok'; d.bootUntil = s.time + 10; } }
            inc.data.cleaned = true;
            E().log(inc, '受損設備已更換，機房恢復運作。');
          } },
        { id: 'report', label: '通報消防局、保險公司與管理層', time: 10, verdict: 'good', explain: '火災是重大事故，依規定通報並啟動保險理賠。' },
      ],
      review(s, inc) {
        const d = inc.data, out = [];
        if (d.stage === 'prevented') out.push('VESDA 在冒煙階段就發現異常，火災被阻止在起火之前。');
        else if (!G.Fac.has('VESDA')) out.push('沒有極早期偵煙（VESDA），一般偵煙器要等起火才動作。');
        else out.push('VESDA 早就告警了，但冒煙階段沒有及時找出並處理過熱的設備。');
        if (d.suppress === 'gas') out.push('潔淨氣體滅火撲滅了火源，設備沒有泡水，只有起火的那台燒毀。記得補充鋼瓶。');
        if (d.suppress === 'preact') out.push('預動式灑水只在火源區放水，但那一區的設備還是泡水了。機房最好用氣體滅火。');
        if (d.suppress === 'wet') out.push('一般灑水頭整區淋水，還被要求切斷機房電源 —— 損失比火災本身更大。機房應改用氣體滅火。');
        return out;
      },
    },

    'water-leak': {
      name: '機房漏水', cat: 'ops', sev: 'high', kb: 'k-ems', minCh: 3, cooldown: 4320,
      weight: (s) => (s.racks.length && Object.values(s.devices).some((d) => d.rack) ? (G.Fac.has('PREACT') ? 0.15 : 0.3) : 0),
      init(s, inc) {
        const racks = s.racks.filter((r) => Object.values(s.devices).some((d) => d.rack === r.id && !d.host));
        if (!racks.length) return false;
        const srcs = ['樓上茶水間的水管破裂，水從天花板滲下來'];
        if (G.Fac.roomUnits('cooling').some((r) => r.model !== 'AC-8')) srcs.push('精密空調的冷凝水盤排水管堵塞，冷凝水溢出');
        if (!G.Fac.has('PREACT')) srcs.push('天花板上方的濕式灑水管線接頭滲漏');
        inc.data.src = inc.data.src || U.pick(srcs);
        inc.data.rack = inc.data.rack || U.pick(racks).id;
        inc.data.damageAt = s.time + U.randInt(40, 70);
        inc.title = '機房漏水';
        E().log(inc, `${inc.data.src}，積水正沿著高架地板下方往機櫃 ${inc.data.rack} 蔓延。`);
        if (G.Fac.has('EMS-1')) E().detect(inc, '環控漏水偵測線告警');
      },
      tick(s, inc) {
        const d = inc.data;
        if (d.fixed) { E().resolve(inc, d.damaged ? 'fixed' : 'contained'); return; }
        if (!d.damaged && s.time >= d.damageAt) {
          d.damaged = [];
          const devs = Object.values(s.devices).filter((x) => x.rack === d.rack && !x.host && x.status === 'ok');
          devs.sort((a, b) => (a.u || 0) - (b.u || 0));
          for (const x of devs.slice(0, 1 + Math.floor(Math.random() * 3))) { x.status = 'failed'; d.damaged.push(x.id); }
          E().log(inc, `⚡ 積水碰到機櫃 ${d.rack} 底部的電源線與設備，${d.damaged.length} 台設備短路故障！`);
          if (!inc.detected) E().detect(inc, '設備故障後才發現地板下積水');
        }
      },
      actions: [
        { id: 'fix', label: '關閉水源、叫水電修漏並抽乾積水', cost: 40000, time: 45, verdict: 'good',
          explain: '先止水、再排水，同時確認有沒有碰到電源。越早處理，設備越不會受損。',
          run(s, inc) { inc.data.fixed = true; E().log(inc, '漏水處已修復、積水抽乾。'); } },
        { id: 'tarp', label: '在機櫃上方蓋防水布', time: 10, verdict: 'neutral',
          explain: '可以擋住上方滴水，但地板下的積水還是會淹到電源線。',
          run(s, inc) { inc.data.damageAt += 20; } },
        { id: 'epo', label: '整間機房斷電避免觸電', time: 1, verdict: 'bad',
          explain: '只有一座機櫃附近積水，整間機房斷電讓所有服務中斷；應該只關閉受影響的迴路並盡快排水。',
          run(s, inc) { inc.data.powerCutUntil = s.time + 40; } },
      ],
      effects(s, inc, mods) { if (inc.data.powerCutUntil > s.time) mods.mdfOff = true; },
      review(s, inc) {
        const out = [];
        out.push(inc.detectHow && inc.detectHow.indexOf('漏水') >= 0 ? '環控的漏水偵測線在積水剛出現時就告警，來得及在設備受損前處理。' : '沒有漏水偵測，要等設備短路才發現。建置環境監控（EMS）就能提早知道。');
        if (inc.data.damaged && inc.data.damaged.length) out.push(`${inc.data.damaged.length} 台設備受損，記得送修（RMA）。`);
        return out;
      },
    },

    'psu-fail': {
      name: '電源櫃 PSU 故障', cat: 'ops', sev: 'high', kb: 'k-aipower', minCh: 6, cooldown: 2880, detect: 'auto',
      weight: (s) => (Object.values(s.devices).some((d) => d.rack && d.status === 'ok' && CAT.devices[d.model].cat === 'power') && G.R.fac && G.R.fac.aiLoad > 0 ? 0.5 : 0),
      init(s, inc) {
        const shelves = Object.values(s.devices).filter((d) => d.rack && d.status === 'ok' && CAT.devices[d.model].cat === 'power' && (d.psuFail || 0) < CAT.devices[d.model].psuN);
        const d = inc.data.dev ? s.devices[inc.data.dev] : U.pick(shelves);
        if (!d) return false;
        d.psuFail = (d.psuFail || 0) + 1;
        inc.data.dev = d.id; inc.data.rack = d.rack;
        inc.title = `AI 機櫃 ${d.rack} 電源櫃 PSU 故障`;
        const p = G.Fac.aiRackPower(d.rack), load = G.Act.rackLoad(d.rack);
        E().log(inc, `${d.name} 的一個 5.5 kW PSU 模組故障停機。機櫃剩餘電源 ${(p.total / 1000).toFixed(1)} kW，負載 ${(load / 1000).toFixed(1)} kW。`);
        inc.data.tripped = load > p.total;
        E().log(inc, inc.data.tripped ? '⚡ 剩下的 PSU 撐不住整座機櫃的負載，機櫃跳電！GPU 訓練工作中斷。' : 'N+1 備援發揮作用：其他 PSU 分擔了負載，伺服器沒有斷電。');
      },
      tick(s, inc) { const d = s.devices[inc.data.dev]; if (!d || !(d.psuFail > 0)) E().resolve(inc, 'fixed'); },
      effects(s, inc, mods) { if (inc.data.capped) mods.gpuCap[inc.data.rack] = 0.7; },
      actions: [
        { id: 'swap', label: '熱插拔更換 PSU 模組（NT$4.5 萬）', cost: 45000, time: 20, verdict: 'good',
          explain: 'PSU 設計成可熱插拔：不必關機，抽出故障模組、插上新的就好。',
          run(s, inc) { const d = s.devices[inc.data.dev]; if (d) d.psuFail = Math.max(0, (d.psuFail || 0) - 1); } },
        { id: 'cap', label: '暫時降低 GPU 功耗上限（power capping）', time: 5, verdict: 'neutral',
          explain: '把 GPU 功耗壓到 70%，剩下的 PSU 就撐得住，但訓練會變慢。只是權宜之計。',
          run(s, inc) { inc.data.capped = true; } },
        { id: 'reboot', label: '重新開機整座 AI 機櫃', time: 15, verdict: 'bad', explain: 'PSU 是硬體故障，重開機沒有用，還會中斷所有訓練工作。' },
      ],
      review(s, inc) {
        return inc.data.tripped ? ['電源櫃沒有留備援（N+1）：壞一個 PSU 就撐不住整座機櫃。再多裝一台電源櫃，或降低機櫃負載。'] : ['電源櫃有 N+1 備援，壞一個 PSU 也不影響運作 —— 趁上班時間熱插拔更換即可。'];
      },
    },

    'cdu-leak': {
      name: '液冷系統漏液', cat: 'ops', sev: 'high', kb: 'k-liquid', minCh: 6, cooldown: 4320,
      weight: () => (G.Fac.roomUnits('cdu').length && G.R.fac && G.R.fac.liquidHeat > 0 ? 0.4 : 0),
      init(s, inc) {
        const us = G.Fac.roomUnits('cdu');
        if (!us.length) return false;
        const u = U.pick(us);
        u.status = 'failed';
        inc.data.unit = u.id;
        inc.title = 'CDU 冷卻液洩漏';
        E().log(inc, 'CDU 二次側管路的快接頭滲漏，冷卻液壓力下降，CDU 自動停泵保護。');
        if (G.Fac.has('EMS-1')) E().detect(inc, '環控：CDU 漏液 / 壓力告警');
      },
      tick(s, inc) {
        const u = s.room.find((r) => r.id === inc.data.unit);
        if (!u) { E().resolve(inc, 'auto'); return; }
        if (!inc.detected && G.R.fac && G.R.fac.thermal < 0.95) E().detect(inc, '監控發現 GPU 溫度飆高、開始降頻');
        if (u.status === 'ok' && s.time >= (u.readyAt || 0)) E().resolve(inc, 'fixed');
      },
      effects(s, inc, mods) { if (inc.data.capped) for (const r of s.racks) if (r.type === 'ai') mods.gpuCap[r.id] = 0.7; },
      actions: [
        { id: 'repair', label: '關閉閥門、更換快接頭並補充冷卻液（NT$12 萬）', cost: 120000, time: 90, verdict: 'good',
          explain: '先隔離漏液段避免液體碰到電子零件，再更換零件、補液、排氣泡。',
          run(s, inc) { const u = s.room.find((r) => r.id === inc.data.unit); if (u) { u.status = 'ok'; u.readyAt = s.time; } } },
        { id: 'cap', label: '暫時降低 GPU 功耗上限', time: 5, verdict: 'neutral',
          explain: 'GPU 發熱變少，剩下的液冷容量比較撐得住，但算力也跟著下降。',
          run(s, inc) { inc.data.capped = true; } },
        { id: 'fans', label: '打開機房門、加大空調風量', time: 5, verdict: 'bad',
          explain: '液冷伺服器的熱主要靠冷卻液帶走，對 GPU 吹風幫助很小，還破壞機房門禁與溫濕度控制。' },
      ],
      review() {
        const f = G.R.fac || {};
        return [f.cduN1 >= f.liquidHeat && f.liquidHeat > 0 ? '另一台 CDU 撐住了液冷負載（N+1）。' : '液冷只有一台 CDU（或容量不足）就是單點故障：壞了 GPU 只能降頻。',
          '漏液偵測（環控）能在冷卻液碰到電子零件前就發現。'];
      },
    },

    /* ---------- 端點與弱點（第八章） ---------- */
    'bad-patch': {
      name: '更新出包：電腦藍白當', cat: 'ops', sev: 'high', kb: 'k-patch', minCh: 8, random: false, detect: 'auto',
      init(s, inc) {
        if (!G.Ep.active()) return false;
        const e = s.ep;
        const frac = G.Ep.uem() && e.rings ? Math.min(e.patch, 0.05) : e.patch;
        if (frac < 0.01) return false;
        inc.data.frac = frac;
        e.paused = true;
        const n = Math.round(frac * Q.officeStaff());
        inc.title = `本週更新出包：約 ${U.num(n)} 台電腦開機就藍白當`;
        E().log(inc, `本週的作業系統更新和某款顯示卡驅動程式衝突，已經安裝的電腦開機就藍白當（BSOD）。目前約 ${U.num(n)} 台受影響。`);
        E().log(inc, G.Ep.uem() && e.rings ? '分批派送發揮作用：只有 5% 的試點電腦裝了，全面派送已自動暫停。' : G.Ep.uem() ? '更新是同時派給所有電腦的：已經裝好的都中了。' : '沒有端點管理：使用者自己更新，誰裝了誰中，IT 也不知道是哪些電腦。');
      },
      effects(s, inc, mods) {
        if (inc.data.fixed) return;
        const k = 1 - inc.data.frac * 0.85;
        for (const f of G.BLD.floors) if (!G.FT[f.type].dine && !G.FT[f.type].park && s.floors[f.id].movedIn > 0) mods.floorPenalty[f.id] = Math.min(mods.floorPenalty[f.id] || 1, k);
      },
      tick(s, inc) { if (inc.data.fixed) E().resolve(inc, 'fixed'); else if (s.time - inc.startedAt > 2880) E().resolve(inc, 'fail'); },
      actions: [
        { id: 'rollback', label: '暫停派送，遠端移除有問題的更新', time: () => (G.Ep.uem() ? 60 : 600), verdict: 'good',
          explain: '有端點管理平台可以遠端一鍵移除（約 1 小時）；沒有的話，只能派人逐台用安全模式處理（要一整天）。',
          run(s, inc) { inc.data.fixed = true; s.ep.patch = Math.max(0.02, s.ep.patch - inc.data.frac); E().log(inc, '有問題的更新已移除，電腦恢復正常。等原廠發布修正版再派送。'); } },
        { id: 'desk', label: '派 IT 人員逐台到座位修復', cost: (s, inc) => Math.round(inc.data.frac * Q.officeStaff() * 800), time: 720, verdict: 'neutral',
          explain: '可以解決，但很慢、很貴。', run(s, inc) { inc.data.fixed = true; } },
        { id: 'user', label: '請同事自己重開機試試看', time: 5, verdict: 'bad', explain: '藍白當是更新造成的，重開幾次都一樣。' },
      ],
      review(s, inc) {
        return [G.Ep.uem() && s.ep.rings ? '分批派送（先試點 5%、確認沒問題再全面）把災情控制在最小。' : '更新要分批派送：先派給一小群試點電腦，觀察一兩天沒問題再全面派送。',
          G.Ep.uem() ? '端點管理平台可以遠端暫停與移除更新。' : '沒有端點管理平台，連哪些電腦裝了更新都不知道。'];
      },
    },

    'laptop-lost': {
      name: '筆電遺失', cat: 'sec', sev: 'med', kb: 'k-uem', minCh: 8, cooldown: 2880, detect: 'auto',
      weight: (s) => (G.Ep.active() && Q.officeStaff() > 1000 ? 0.4 : 0),
      init(s, inc) {
        const occ = occupied(100).filter((f) => !G.FT[f.type].dine);
        if (!occ.length) return false;
        const f = U.pick(occ);
        inc.data.floor = f.id; inc.data.enc = !!s.ep.bitlocker;
        inc.title = `${f.dept}的筆電在高鐵上遺失`;
        E().log(inc, `${f.dept}的同事把公司筆電忘在高鐵上，裡面有客戶合約、報價單，還記住了公司 VPN 的帳號。`);
        E().log(inc, inc.data.enc ? '筆電有 BitLocker 全磁碟加密：沒有金鑰，別人拆下硬碟也讀不到資料。' : '⚠ 筆電沒有加密：拆下硬碟就能讀到所有檔案。');
      },
      tick(s, inc) {
        if (inc.data.wiped || (inc.data.enc && inc.data.reset)) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt > 720) { E().log(inc, inc.data.enc ? '筆電沒找回來，但資料有加密。' : '🚨 客戶合約出現在網路上的論壇。'); E().resolve(inc, inc.data.enc ? 'auto' : 'fail'); }
      },
      actions: [
        { id: 'wipe', label: '遠端鎖定並抹除筆電（UEM）', time: 10, verdict: 'good', avail: () => G.Ep.uem(), unavail: '沒有端點管理平台（UEM）',
          explain: '筆電一連上網路就會收到抹除指令。搭配 BitLocker，就算一直沒連網，資料也讀不出來。', run(s, inc) { inc.data.wiped = true; } },
        { id: 'reset', label: '停用帳號、重設密碼與 VPN 憑證', time: 15, verdict: 'good', explain: '假設帳號已經外洩：讓筆電上記住的帳密、憑證都失效。', run(s, inc) { inc.data.reset = true; if (!inc.data.enc) inc.data.wiped = inc.data.wiped || false; } },
        { id: 'police', label: '報警並聯絡高鐵失物招領', time: 30, verdict: 'neutral', explain: '該做，但不能只等失物招領。' },
      ],
      review(s, inc) { return [inc.data.enc ? 'BitLocker 全磁碟加密讓遺失的筆電只是一台硬體，資料沒有外洩。' : '筆電一定要全磁碟加密（BitLocker）：由端點管理平台強制開啟並保管復原金鑰。', '遺失時第一時間遠端抹除、重設帳號密碼。']; },
    },

    /* ---------- 機房門禁（實體安全） ---------- */
    'tailgate': {
      name: '陌生人進了機房', cat: 'sec', sev: 'high', kb: 'k-access', minCh: 8, cooldown: 4320,
      weight: (s) => { if (!s.racks.length || !workHours(s.time)) return 0; const lv = G.Acc.level(); return lv >= 2 ? 0 : lv === 1 ? 0.25 : 0.45; },
      detectChance: () => (G.Acc.level() >= 1 ? 1 : G.Fac.has('EMS-1') ? 0.08 : 0.03),
      init(s, inc) {
        const sw = Q.devices('switch').filter((d) => d.rack);
        const dev = sw.length ? U.pick(sw) : U.pick(Object.values(s.devices).filter((d) => d.rack));
        if (!dev) return false;
        const lv = G.Acc.level();
        inc.data.dev = dev.id; inc.data.rack = dev.rack; inc.data.lv = lv;
        inc.title = lv >= 1 ? '陌生人尾隨工程師進了機房' : '機房門沒鎖好，陌生人走了進去';
        E().log(inc, lv >= 1 ? '門禁系統告警：一次刷卡，門卻開了很久——有人跟在工程師後面進了機房（尾隨，tailgating）。' : '機房只有一把鑰匙，門常常沒鎖好：一個穿著外包制服的陌生人走進了機房。');
        E().log(inc, `他走到了機櫃 ${dev.rack}，站在 ${dev.name} 前面。`);
      },
      tick(s, inc) {
        const d = inc.data;
        if (d.caught && d.swept) { E().resolve(inc, 'contained'); return; }
        if (!d.planted && s.time - inc.startedAt >= 25) {
          d.planted = true;
          E().log(inc, `🚨 他在 ${s.devices[d.dev] ? s.devices[d.dev].name : '交換器'} 插上了一台小型裝置，然後離開了機房。`);
        }
        if (d.planted && !d.swept && s.time - inc.startedAt >= 90) {
          E().log(inc, '🚨 那台裝置開始把內部流量往外傳。');
          const srv = Q.devices('server').filter((x) => x.rack && ['file', 'db'].includes(x.role));
          if (srv.length) E().start('exfil', { src: U.pick(srv).id });
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'escort', label: '調閱門禁紀錄與監視器，請保全把人帶離', time: 8, verdict: 'good', explain: '先確認身分、請他離開，並留下紀錄。', run(s, inc) { inc.data.caught = true; } },
        { id: 'sweep', label: '清查機櫃：有沒有多出來的裝置或被拔掉的線', time: 25, verdict: 'good', explain: '人帶走了不代表沒事：攻擊者可能已經在交換器插了一台竊聽 / 遠端控制的小裝置。', run(s, inc) { inc.data.swept = true; if (inc.data.planted) E().log(inc, '在交換器的空埠上找到一台來路不明的小裝置，已經拔除並交給資安團隊鑑識。'); } },
        { id: 'ignore', label: '應該是新來的同事吧', time: 1, verdict: 'bad', explain: '機房裡出現不認識的人，一定要當場確認身分。' },
      ],
      review(s, inc) {
        const lv = inc.data.lv;
        return [lv === 0 ? '機房只有鑰匙：沒有門禁紀錄，也不知道誰進去過。先裝感應卡門禁。' : '一張卡刷開門，後面可以跟好幾個人進去（尾隨）。防尾隨雙門（mantrap）一次只讓一個人通過。',
          '實體安全是資安的第一道防線：人摸得到設備，就繞得過所有防火牆。'];
      },
    },
    'cleaner': {
      name: '機櫃被拔掉插頭', cat: 'ops', sev: 'high', kb: 'k-access', minCh: 8, cooldown: 4320,
      weight: (s) => { const h = U.hourOf(s.time); if (h > 5 && h < 22) return 0; if (!s.racks.some((r) => r.type !== 'ai' && Object.values(s.devices).some((d) => d.rack === r.id))) return 0; return G.Acc.can('clean') === 'perm' ? 0.5 : 0; },
      detectChance: () => (G.Ops.nmsUp() || G.Fac.has('EMS-1') ? 1 : 0.2),
      init(s, inc) {
        const racks = s.racks.filter((r) => r.type !== 'ai' && !r.unplugged && Object.values(s.devices).some((d) => d.rack === r.id));
        const r = inc.data.rack ? s.racks.find((x) => x.id === inc.data.rack) : U.pick(racks);
        if (!r) return false;
        r.unplugged = true;
        inc.data.rack = r.id;
        inc.data.who = inc.data.who || 'clean';
        inc.title = inc.data.who === 'vendor' ? `廠商碰掉了機櫃 ${r.id} 的電源` : `清潔人員拔掉機櫃 ${r.id} 的插頭插洗地機`;
        E().log(inc, inc.data.who === 'vendor' ? `廠商在機櫃 ${r.id} 後面整理線材，把 PDU 的電源線碰掉了：整座機櫃斷電。` : `半夜打掃的清潔人員找不到插座，拔掉了機櫃 ${r.id} 的 PDU 插頭來插洗地機：整座機櫃斷電！`);
        const n = Object.values(s.devices).filter((d) => d.rack === r.id).length;
        E().log(inc, `機櫃裡的 ${n} 台設備全部停擺。`);
      },
      tick(s, inc) {
        const r = s.racks.find((x) => x.id === inc.data.rack);
        if (!r || !r.unplugged) { E().resolve(inc, inc.data.late ? 'auto' : 'contained'); return; }
        /* 沒人處理：一早上班的人才發現 */
        if (s.time - inc.startedAt > 480) { r.unplugged = false; inc.data.late = true; E().log(inc, '早上上班的工程師進機房才發現插頭被拔掉，插回去重新開機。'); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'replug', label: '派值班工程師回機房插回電源', time: 20, verdict: 'good', explain: '先恢復服務：插回 PDU、確認設備都開機。', run(s, inc) { const r = s.racks.find((x) => x.id === inc.data.rack); if (r) r.unplugged = false; } },
        { id: 'acl', label: '把清潔人員 / 廠商的機房權限改成「需 IT 陪同」', time: 2, verdict: 'good', explain: '根本原因是不該讓他們自己進機房。', run(s, inc) { const g = inc.data.who === 'vendor' ? 'vendor' : 'clean'; if (s.access.list[g] === 'perm') s.access.list[g] = 'escort'; G.Acc.log(`門禁權限變更：${G.Acc.groupName(g)} → 需 IT 陪同`); } },
        { id: 'wait', label: '等明天上班再處理', time: 1, verdict: 'bad', explain: '整座機櫃的服務會停一整晚。' },
      ],
      review(s, inc) {
        return ['清潔人員與廠商不該能自己進機房：改成 IT 陪同，或乾脆不讓他們進去（機房清潔由 IT 另外安排）。', '機櫃的 PDU 要用防脫落 / 鎖定式插頭並清楚標示；重要設備用雙電源接到兩條不同的 PDU。'];
      },
    },
    'vendor': {
      name: '廠商要進機房', cat: 'ops', sev: 'low', kb: 'k-access', minCh: 8, cooldown: 4320, detect: 'auto',
      weight: (s) => (workHours(s.time) && s.room.some((r) => ['ups', 'cooling'].includes(CAT.room[r.model].kind) && CAT.room[r.model].price) ? 0.2 : 0),
      init(s, inc) {
        const who = U.pick(['UPS 廠商', '精密空調廠商', '伺服器原廠工程師']);
        inc.data.who = who;
        inc.title = `${who}要進機房做保養`;
        const perm = G.Acc.can('vendor') === 'perm';
        inc.data.perm = perm;
        if (perm) {
          E().log(inc, `${who}自己刷卡進了機房——他有常駐權限，IT 完全不知道。`);
          if (Math.random() < 0.35) { inc.data.mishap = true; }
        } else E().log(inc, `${who}在機房門口等你開門：要做年度保養，大約兩個小時。`);
      },
      tick(s, inc) {
        const d = inc.data;
        if (d.mishap && !d.mishapDone && s.time - inc.startedAt >= 30) {
          d.mishapDone = true;
          const racks = s.racks.filter((r) => r.type !== 'ai' && !r.unplugged && Object.values(s.devices).some((x) => x.rack === r.id));
          if (racks.length) E().start('cleaner', { rack: U.pick(racks).id, who: 'vendor' });
        }
        if (d.done && s.time >= d.doneAt) { E().log(inc, '保養完成，廠商離開機房。'); E().resolve(inc, d.bad ? 'auto' : 'contained'); }
        if (!d.done && s.time - inc.startedAt > 180) { E().log(inc, '廠商等不到人，改天再來。'); E().resolve(inc, 'auto'); }
      },
      actions: [
        { id: 'escort', label: '開當天有效的臨時權限，全程陪同', time: 5, verdict: 'good', explain: '廠商要進機房：臨時權限 + IT 全程陪同，完成後權限自動失效。', run(s, inc) { inc.data.done = true; inc.data.doneAt = s.time + 110; G.Acc.log(`${inc.data.who} 臨時權限（當日有效），由 IT 陪同進入`); } },
        { id: 'lend', label: '把自己的卡借他進去', time: 2, verdict: 'bad', explain: '借卡 = 門禁紀錄全部是你的名字，出事時查不到是誰；廠商也不知道哪些線不能碰。', run(s, inc) { inc.data.done = true; inc.data.bad = true; inc.data.doneAt = s.time + 110; if (Math.random() < 0.4) inc.data.mishap = true; } },
        { id: 'perm', label: '直接給他常駐權限，以後比較方便', time: 2, verdict: 'bad', explain: '廠商人員常常換，常駐權限會一直留在系統裡。', run(s, inc) { s.access.list.vendor = 'perm'; G.Acc.log('門禁權限變更：機電 / 設備廠商 → 常駐權限', true); inc.data.done = true; inc.data.bad = true; inc.data.doneAt = s.time + 110; } },
        { id: 'later', label: '今天太忙，請他改天再來', time: 1, verdict: 'neutral', explain: '保養延後不是不行，但不能一直拖。', run(s, inc) { inc.data.done = true; inc.data.doneAt = s.time; } },
      ],
      review(s, inc) { return ['廠商進機房：事先申請、臨時權限、IT 全程陪同、完成後收回權限。', '不借卡、不給常駐權限：門禁紀錄要能追到「誰」在「什麼時候」進去。']; },
    },
    'badge-ex': {
      name: '離職員工的卡還能進機房', cat: 'sec', sev: 'med', kb: 'k-access', minCh: 8, cooldown: 10080, detect: 'auto',
      weight: (s) => (G.Acc.level() >= 1 && G.Acc.reviewDue() && s.racks.length ? 0.3 : 0),
      init(s, inc) {
        inc.title = '離職員工的門禁卡還能刷進機房';
        E().log(inc, '門禁紀錄顯示：上個月離職的網管工程師，昨晚 23:40 刷卡進了機房。人資系統早就把他停用了，門禁卡卻沒有。');
      },
      tick(s, inc) {
        const d = inc.data;
        if (d.disabled && d.reviewed) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt > 240) { E().log(inc, d.disabled ? '卡片停用了，但其他該停用的卡還沒清查。' : '🚨 他又刷卡進去了一次。'); E().resolve(inc, d.disabled ? 'auto' : 'fail'); }
      },
      actions: [
        { id: 'disable', label: '立刻停用卡片，調閱監視器看他做了什麼', time: 5, verdict: 'good', explain: '先止血，再確認有沒有設備被動過。', run(s, inc) { inc.data.disabled = true; } },
        { id: 'review', label: '全面做一次門禁權限盤點', time: 30, verdict: 'good', explain: '一張沒停用的卡，代表離職流程有漏洞：和人資名單比對，把所有該停用的卡一次清掉。', run(s, inc) { G.Acc.review(); inc.data.reviewed = true; } },
        { id: 'hr', label: '請人資下次記得通知 IT', time: 1, verdict: 'neutral', explain: '流程要改，但這張卡現在就要停用。' },
      ],
      review() { return ['離職、調職流程要自動通知 IT：當天就停用門禁卡、帳號與 VPN。', '至少每季做一次權限盤點（和人資在職名單比對）。']; },
    },

    'kev': {
      name: '重大漏洞公告（已遭利用）', cat: 'sec', sev: 'high', kb: 'k-vuln', minCh: 8, cooldown: 4320, detect: 'auto',
      weight: () => (G.Vuln.active() && Q.devices('firewall').some((d) => d.rack) ? 0.35 : 0),
      init(s, inc) {
        const list = G.Vuln.kev('firewall');
        if (!list.length) return false;
        inc.data.list = list.map((x) => x.id);
        inc.data.cve = list[0].cve;
        inc.title = `重大漏洞公告：防火牆 SSL VPN 遠端執行程式碼（${list[0].cve}）`;
        E().log(inc, `原廠與 TWCERT/CC 發布緊急通告：防火牆的 SSL VPN 有遠端執行程式碼漏洞（${list[0].cve}，CVSS 9.8），已被勒索集團大規模利用。`);
        E().log(inc, `受影響：${list.map((x) => s.devices[x.dev].name).join('、')}。攻擊者通常在公告後一兩天內就開始大量掃描。`);
      },
      tick(s, inc) {
        const open = inc.data.list.map((id) => s.vuln.list.find((x) => x.id === id)).filter((x) => x && !x.fixed && !x.mitig);
        if (!open.length) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt > 4320) E().resolve(inc, 'auto');
      },
      actions: [
        { id: 'patch', label: '立即更新所有受影響防火牆的韌體', time: 30, verdict: 'good',
          explain: '已遭利用的漏洞要立刻修補，不能等維護窗口。防火牆有 HA 的話，兩台輪流更新就不會中斷。',
          run(s, inc) {
            const devs = new Set(inc.data.list.map((id) => s.vuln.list.find((x) => x.id === id)).filter(Boolean).map((x) => x.dev));
            for (const id of devs) { const r = G.Vuln.patch(id, true); E().log(inc, r.msg); }
          } },
        { id: 'vpnoff', label: '暫時關閉 SSL VPN（遠端員工暫時無法連線）', time: 5, verdict: 'neutral',
          explain: '官方建議的暫時緩解措施：關掉有漏洞的功能就不會被利用，但遠端員工會暫時無法工作。',
          run(s, inc) { for (const id of inc.data.list) { const x = s.vuln.list.find((v) => v.id === id); if (x) x.mitig = true; } s.rating = Math.max(0, s.rating - 1); } },
        { id: 'scan', label: '用弱點掃描確認還有沒有其他受影響的設備', time: 30, verdict: 'good', avail: () => G.Vuln.scannerUp(), unavail: '沒有弱點掃描伺服器',
          explain: '公告不一定列出你所有的設備型號與版本：掃描才知道真正受影響的範圍。', run() { G.Vuln.scan(); } },
        { id: 'wait', label: '等下個月的定期維護窗口再更新', time: 1, verdict: 'bad', explain: '已遭大規模利用的漏洞，攻擊者不會等你一個月。' },
      ],
      review(s, inc) {
        const ex = s.incidents.some((i) => i.type === 'exploit' && i.startedAt >= inc.startedAt);
        return [ex ? '修補得不夠快：攻擊者利用漏洞入侵了。' : '在攻擊者動手之前完成了修補或緩解。', '已遭利用（KEV）的嚴重漏洞要在幾天內修補；對外的設備（防火牆、VPN、官網）最優先。'];
      },
    },

    'exploit': {
      name: '已知弱點遭利用入侵', cat: 'sec', sev: 'crit', kb: 'k-vuln', minCh: 8, random: false,
      init(s, inc) {
        const x = s.vuln.list.find((v) => v.id === inc.data.vuln);
        const d = x && s.devices[x.dev];
        if (!x || !d || x.fixed) return false;
        Object.assign(inc.data, { dev: d.id, cve: x.cve, progress: 0 });
        inc.title = `${d.name} 遭利用 ${x.cve} 入侵`;
        E().log(inc, `攻擊者利用 ${d.name} 上沒有修補的「${x.name}」（${x.cve}，CVSS ${x.cvss}）取得了系統權限，正在植入後門、竊取管理員帳號。`);
        if (Q.hasService('edr') && CAT.devices[d.model].cat === 'server') E().detect(inc, 'EDR 告警');
      },
      detectChance: () => { const p = G.Sec.posture(); return 0.001 + (p.siem ? 0.06 : 0) + (p.ips ? 0.03 : 0) + (p.nms ? 0.004 : 0); },
      tick(s, inc) {
        const d = inc.data;
        if (d.contained && d.patched && d.cleaned) { E().resolve(inc, 'contained'); return; }
        if (d.contained) return;
        d.progress += U.rand(0.4, 1.1) * (G.Sec.posture().segmentation ? 0.6 : 1);
        if (d.progress >= 100) {
          E().log(inc, '🚨 攻擊者拿到了網域管理員權限，開始在內網部署勒索軟體！');
          E().resolve(inc, 'fail');
          s.sched.push({ at: s.time + U.randInt(60, 240), type: 'ransomware', data: { origin: 'srv' } });
        }
      },
      actions: [
        { id: 'isolate', label: '隔離被入侵的設備、封鎖攻擊來源', time: 10, verdict: 'good', explain: '先遏制：切斷攻擊者的連線，阻止橫向移動。', run(s, inc) { inc.data.contained = true; } },
        { id: 'patch', label: '緊急修補被利用的漏洞', time: 20, verdict: 'good', explain: '不修補的話，攻擊者換個 IP 又能再進來。', run(s, inc) { G.Vuln.patch(inc.data.dev, true); inc.data.patched = true; } },
        { id: 'clean', label: '清查後門、重設所有管理員密碼與憑證', time: 240, verdict: 'good', avail: (s, inc) => !!inc.data.contained, unavail: '請先隔離',
          explain: '根除：攻擊者可能已經留下後門、偷走帳號，全部都要清查、重設。', run(s, inc) { inc.data.cleaned = true; } },
        { id: 'reboot', label: '重新開機受影響的設備', time: 10, verdict: 'bad', explain: '漏洞還在、後門還在，重開機沒有用。' },
      ],
      review() { return ['這是「已知」漏洞：修補早就發布了。弱點管理（定期掃描、依 CVSS 排序、在 SLA 內修補）就是要避免這種事。', '對外的設備（防火牆、VPN、官網）要最優先修補；來不及修就先用 IPS 虛擬修補或關閉功能。']; },
    },

    /* ---------- 分支據點與雲端（第七章） ---------- */
    'wan-down': {
      name: '據點線路中斷', cat: 'ops', sev: 'high', kb: 'k-sdwan', minCh: 7, cooldown: 2880, detect: 'auto',
      weight: (s) => (G.Wan.openIds().some((id) => s.wan.sites[id].links.some((l) => l.status === 'active' && !l.outage)) ? 0.7 : 0),
      init(s, inc) {
        const c = [];
        for (const id of G.Wan.openIds()) for (const l of s.wan.sites[id].links) if (l.status === 'active' && !l.outage && l.type !== 'lte') c.push([id, l]);
        const pick = inc.data.site ? c.find(([id, l]) => id === inc.data.site && (!inc.data.type || l.type === inc.data.type)) : U.pick(c);
        if (!pick) return false;
        const [id, l] = pick;
        l.outage = true;
        Object.assign(inc.data, { site: id, link: l.id, until: s.time + U.randInt(150, 360) });
        const T = CAT.wan.types[l.type];
        inc.title = `${G.SITES[id].name} ${T.short} 中斷`;
        E().log(inc, `${G.SITES[id].name}附近道路施工挖斷了電信業者的光纜，${T.name} ${U.speed(l.bw)} 中斷，修復時間未定。`);
        const w = s.wan.sites[id];
        E().log(inc, w.sdwan ? 'SD-WAN 偵測到線路中斷，流量瞬間改走其他線路。' : w.links.filter((x) => x.id !== l.id && x.status === 'active').length && w.vpn ? '備援的 VPN 要等路由收斂（約 5 分鐘）才會接手。' : '這個據點沒有其他可用的路徑：整個據點連不回總部！');
        G.R.topoVer++;
      },
      tick(s, inc) {
        const l = s.wan.sites[inc.data.site].links.find((x) => x.id === inc.data.link);
        if (!l) { E().resolve(inc, 'auto'); return; }
        if (s.time >= inc.data.until) { l.outage = false; G.R.topoVer++; E().resolve(inc, inc.acts.call ? 'fixed' : 'auto'); }
      },
      end(s, inc) { const l = s.wan.sites[inc.data.site].links.find((x) => x.id === inc.data.link); if (l) l.outage = false; G.R.topoVer++; },
      actions: [
        { id: 'call', label: '向電信業者報修，要求依 SLA 派員搶修', time: 10, verdict: 'good',
          explain: '專線有 SLA（服務水準協議）：業者要在約定時間內修復，超過要賠償。主動報修、追蹤進度。',
          run(s, inc) { inc.data.until = Math.max(s.time + 30, inc.data.until - 90); E().log(inc, '電信業者已派工程師前往搶修。'); } },
        { id: 'lte', label: '緊急啟用 4G / 5G 行動網路備援', time: 20, verdict: 'neutral',
          explain: '行動網路可以撐一下，但頻寬有限。平常就該準備好第二條路（不同業者的寬頻 + VPN 或 SD-WAN）。',
          avail: (s, inc) => !s.wan.sites[inc.data.site].links.some((l) => l.type === 'lte'), unavail: '已經有 4G / 5G 備援了',
          run(s, inc) { const w = s.wan.sites[inc.data.site]; w.links.push({ id: Q.nextId('w'), type: 'lte', bw: 100, status: 'active', readyAt: s.time, outage: false }); if (!w.sdwan) w.vpn = true; G.R.topoVer++; E().log(inc, '行動網路備援已上線（搭配 VPN 連回總部）。'); } },
        { id: 'reboot', label: '請據點同事重開路由器', time: 10, verdict: 'bad', explain: '線路是被挖斷的，重開設備沒有用。' },
      ],
      review(s, inc) {
        const w = s.wan.sites[inc.data.site];
        return w.sdwan ? ['SD-WAN 在線路中斷的瞬間就把流量改走其他線路，使用者幾乎沒有感覺。'] : w.vpn && w.links.length > 1 ? ['有備援線路 + VPN：中斷後幾分鐘，路由收斂完就恢復了。SD-WAN 可以做到瞬間切換。'] : ['只有一條線路就是單點故障：加一條不同業者的寬頻（或 4G/5G），搭配 VPN 或 SD-WAN。'];
      },
    },

    'cable-cut': {
      name: '國際海纜中斷', cat: 'ops', sev: 'high', kb: 'k-mpls', minCh: 7, cooldown: 7200, detect: 'auto',
      weight: (s) => (G.Wan.openIds().some((id) => G.SITES[id].intl) ? 0.25 : 0),
      init(s, inc) {
        const intl = G.Wan.openIds().filter((id) => G.SITES[id].intl);
        if (!intl.length) return false;
        inc.data.until = s.time + U.randInt(1440, 2880);
        inc.data.cut = [];
        for (const id of intl) for (const l of s.wan.sites[id].links) if (l.type === 'iplc' && l.status === 'active' && !l.outage) { l.outage = true; inc.data.cut.push([id, l.id]); }
        inc.title = '國際海纜中斷：海外據點的網路大塞車';
        E().log(inc, '地震造成南海的兩條國際海纜斷裂。IPLC 是點對點的單一路徑，跟著斷了；國際網際網路改道繞行，延遲與掉包暴增。修復船要一兩天才能到。');
        G.R.topoVer++;
      },
      effects(s, inc, mods) { mods.cableCut = true; },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, inc.acts.reroute || inc.acts.lte ? 'contained' : 'auto'); },
      end(s, inc) { for (const [id, lid] of inc.data.cut || []) { const l = s.wan.sites[id].links.find((x) => x.id === lid); if (l) l.outage = false; } G.R.topoVer++; },
      actions: [
        { id: 'reroute', label: '請電信業者把 IPLC 改走另一條海纜（約 6 小時）', time: 360, verdict: 'good',
          explain: '國際專線可以要求業者改走其他海纜路由（保護路由），重要的線路在簽約時就該選有保護的方案。',
          run(s, inc) { for (const [id, lid] of inc.data.cut || []) { const l = s.wan.sites[id].links.find((x) => x.id === lid); if (l) l.outage = false; } inc.data.cut = []; G.R.topoVer++; E().log(inc, 'IPLC 已改走其他海纜，恢復連線（延遲稍微增加）。'); } },
        { id: 'lte', label: '海外據點啟用 SD-WAN，同時使用當地寬頻與 4G / 5G', time: 60, verdict: 'good',
          explain: 'SD-WAN 會持續量測每條路的延遲與掉包，自動把重要流量放在狀況最好的那條，還能用前向錯誤更正（FEC）補回掉包。',
          run(s) { for (const id of G.Wan.openIds().filter((x) => G.SITES[x].intl)) s.wan.sites[id].sdwan = true; G.R.topoVer++; } },
        { id: 'local', label: '通知越南廠改用離線作業，事後再補登', time: 10, verdict: 'neutral', explain: '讓產線能繼續運作的應急做法，但事後補登資料很費工，也容易出錯。' },
        { id: 'wait', label: '只能等海纜修好', time: 1, verdict: 'bad', explain: '什麼都不做，海外據點要癱瘓一兩天。' },
      ],
      review() { return ['國際線路要有路由多樣性：不同業者、不同海纜，或專線 + SD-WAN 的網際網路備援。', 'IPLC 延遲最低，但它是單一路徑：海纜一斷就斷。']; },
    },

    'cloud-leak': {
      name: '雲端儲存桶被設成公開', cat: 'sec', sev: 'high', kb: 'k-cloud', minCh: 7, cooldown: 5760,
      weight: () => (['cloudweb', 'cloudbk', 'm365'].some((x) => Q.hasService(x)) ? (Q.hasService('cspm') ? 0.1 : 0.45) : 0),
      init(s, inc) {
        if (!['cloudweb', 'cloudbk', 'm365'].some((x) => Q.hasService(x))) return false;
        inc.data.progress = 0;
        inc.title = '客戶資料的雲端儲存桶被設成公開';
        if (Q.hasService('cspm')) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, 'CSPM 在設定變更的幾分鐘內就發現：有一個存放客戶匯出資料的儲存桶被設成「公開讀取」，已自動改回私有並通知負責的工程師。');
          E().detect(inc, 'CSPM 自動修正');
          return;
        }
        E().log(inc, '工程師為了方便分享測試資料，把存放客戶匯出檔的雲端儲存桶設成「任何人都能讀取」，事後忘了改回來。網路上的掃描器已經開始找這類公開的儲存桶。');
      },
      detectChance: () => (Q.roleServers('siem').some((d) => G.Net.devUp(d)) ? 0.01 : 0.002),
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (inc.data.closed) { E().resolve(inc, 'contained'); return; }
        inc.data.progress += U.rand(0.1, 0.4);
        if (inc.data.progress >= 100) { E().log(inc, '🚨 資安研究員在網路上發現了貴公司的客戶資料，媒體已經在問了。'); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'close', label: '把儲存桶改回私有，檢查存取紀錄', time: 10, verdict: 'good',
          explain: '先止血，再從存取紀錄確認資料有沒有被下載、被誰下載。',
          run(s, inc) { inc.data.closed = true; E().log(inc, inc.data.progress > 30 ? '存取紀錄顯示已有不明 IP 下載過資料，需要啟動個資外洩通報。' : '存取紀錄顯示還沒有外部下載，及時止血。'); } },
        { id: 'cspm', label: '啟用 CSPM，持續檢查雲端設定', cost: () => (Q.hasService('cspm') ? 0 : Math.round(Q.monthlyServiceCost('cspm'))), time: 30, verdict: 'good',
          explain: '人一定會犯錯：用工具持續掃描雲端設定，一發現公開的儲存桶、沒開 MFA 的帳號就告警或自動修正。',
          run(s) { s.services.cspm = s.services.cspm || { since: s.time }; } },
        { id: 'report', label: '通報法務與主管機關（個資外洩）', time: 30, verdict: 'good', explain: '個資外洩有法定通報時限，要依規定處理。' },
        { id: 'ignore', label: '只是測試資料，不用緊張', time: 1, verdict: 'bad', explain: '儲存桶裡是真實的客戶資料。公開的雲端儲存桶是最常見的個資外洩原因之一。' },
      ],
      review() { return Q.hasService('cspm') ? ['CSPM 持續檢查雲端設定，把公開的儲存桶擋在發生之前。'] : ['雲端的「責任共擔」：雲端業者負責機房與平台，你的設定錯誤要你自己負責。建議啟用 CSPM。']; },
    },

    'cloud-bill': {
      name: '雲端帳單暴增', cat: 'sec', sev: 'med', kb: 'k-cloud', minCh: 7, cooldown: 5760,
      weight: () => (Q.hasService('cloudweb') ? 0.35 : 0),
      init(s, inc) {
        if (!Q.hasService('cloudweb')) return false;
        inc.data.cost = 0;
        inc.title = '雲端帳單暴增：外洩的金鑰被拿去挖礦';
        E().log(inc, '一位工程師把雲端的存取金鑰（Access Key）寫在程式碼裡上傳到公開的 GitHub。幾分鐘內就被攻擊者撿走，開了上百台 GPU 主機在挖加密貨幣。');
        if (Q.hasService('cspm')) E().detect(inc, 'CSPM：異常的費用與新建立的 GPU 主機');
      },
      detectChance: (s) => (U.hourOf(s.time) >= 9 && U.hourOf(s.time) < 10 ? 0.05 : 0.002),
      tick(s, inc) {
        if (inc.data.stopped) { E().resolve(inc, 'contained'); return; }
        const rate = 1600;
        inc.data.cost += rate; s.money -= rate;
        if (s.time - inc.startedAt > 1440) { E().log(inc, `帳單累計 ${U.money(inc.data.cost)}。`); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'revoke', label: '撤銷外洩的金鑰、關閉所有不明主機', time: 20, verdict: 'good',
          explain: '先止血：金鑰一外洩就要立刻撤銷，再清查被建立的資源。', run(s, inc) { inc.data.stopped = true; E().log(inc, `已止血，這次損失約 ${U.money(inc.data.cost)}。`); } },
        { id: 'budget', label: '設定預算告警與費用異常偵測', cost: () => (Q.hasService('cspm') ? 0 : Math.round(Q.monthlyServiceCost('cspm'))), time: 20, verdict: 'good',
          explain: 'FinOps：預算告警與異常偵測能在幾分鐘內發現暴衝的費用，而不是等到月底收帳單。', run(s) { s.services.cspm = s.services.cspm || { since: s.time }; } },
        { id: 'pay', label: '應該是官網流量變大，先付錢再說', time: 1, verdict: 'bad', explain: '不明原因的費用暴衝，一定要先查清楚。' },
      ],
      review(s, inc) { return [`這次多付了約 ${U.money(inc.data.cost)}。`, '存取金鑰不能寫在程式碼裡；雲端帳號要開 MFA、最小權限，並設定預算告警。']; },
    },

    /* ---------- 電話語音（第七章） ---------- */
    'call-surge': {
      name: '客服來電暴增', cat: 'ops', sev: 'high', kb: 'k-pbx', minCh: 7, cooldown: 2880, detect: 'auto',
      weight: (s) => (G.R.voice && G.R.voice.active && G.R.voice.pbxUp && workHours(s.time) ? 0.5 : 0),
      init(s, inc) {
        if (!G.Voice.active()) return false;
        inc.data.mult = inc.data.mult || 1.9;
        inc.data.until = s.time + U.randInt(150, 240);
        inc.title = '產品瑕疵新聞曝光：客服來電暴增';
        E().log(inc, '新聞報導了產品瑕疵，客服專線的來電量瞬間變成平常的兩倍，排隊的客戶越來越多。');
        const v = G.R.voice;
        if (v) E().log(inc, `目前外線 ${v.channels} 路；平常尖峰約 ${Math.round(v.ext)} 通同時進行。`);
      },
      effects(s, inc, mods) { mods.callMult = (mods.callMult || 1) * inc.data.mult; },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, inc.acts.ivr || inc.acts.trunk ? 'contained' : 'auto'); },
      actions: [
        { id: 'ivr', label: '啟用 IVR 自助語音與官網公告（常見問題自助處理）', time: 20, verdict: 'good',
          explain: '把可以自助處理的來電分流掉（查詢進度、退換貨流程），真人客服只接需要處理的電話。',
          run(s, inc) { inc.data.mult = Math.max(1.2, inc.data.mult - 0.55); } },
        { id: 'trunk', label: '請電信業者臨時增加 SIP 中繼路數', time: 5, verdict: 'good',
          explain: 'SIP 中繼的路數只是設定：電信業者約 30 分鐘就能調整，不用重新拉線（這也是 SIP 比傳統 E1 / PRI 彈性的地方）。',
          run(s) { const tiers = Object.keys(CAT.voice.trunks).map(Number); const nx = tiers.find((x) => x > s.voice.trunk); if (nx) G.Voice.orderTrunk(nx); } },
        { id: 'callback', label: '開放「預約回電」', time: 15, verdict: 'neutral', explain: '客戶不用一直在線上排隊，但回電還是要有人打。',
          run(s, inc) { inc.data.mult = Math.max(1.2, inc.data.mult - 0.3); } },
        { id: 'hangup', label: '尖峰時段直接掛斷排隊的電話', time: 1, verdict: 'bad', explain: '客戶會更生氣，還會一直重撥，讓線路更塞。',
          run(s) { s.rating = Math.max(0, s.rating - 3); } },
      ],
      review() {
        const v = G.R.voice || {};
        return [v.blocking > 0.05 ? `尖峰時外線阻塞率 ${U.pct(v.blocking)}：外線路數要用 Erlang B 依尖峰話務量規劃，並保留餘裕。` : '外線路數夠用，客戶打得進來。', 'IVR 自助語音可以把大量重複的查詢分流掉。'];
      },
    },

    'toll-fraud': {
      name: 'SIP 盜打國際電話', cat: 'sec', sev: 'high', kb: 'k-pbx', minCh: 7, cooldown: 4320,
      weight: (s) => { const v = G.R.voice; return v && v.active && v.pbxUp && s.voice.trunk > 0 ? (v.exposed ? 2 : 0.15) : 0; },
      init(s, inc) {
        const v = G.R.voice;
        if (!v || !v.active || !v.pbxUp || !s.voice.trunk) return false;
        inc.data.ip = randIP();
        inc.data.cost = 0;
        inc.title = '電話交換機遭盜打國際電話';
        if (!v.exposed) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, `SBC 攔截了來自 ${inc.data.ip} 的 SIP 掃描與分機密碼暴力破解（每秒數百次 REGISTER），電話交換機沒有直接暴露在網際網路上。`);
          E().detect(inc, 'SBC 告警');
          return;
        }
        E().log(inc, `攻擊者 ${inc.data.ip} 掃描到直接對外開放的 SIP 埠，暴力破解出分機 3021 的密碼，開始大量撥打國際付費電話。`);
      },
      detectChance: () => (Q.roleServers('siem').some((d) => G.Net.devUp(d)) ? 0.05 : 0.004),
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (inc.data.stopped) { E().resolve(inc, 'contained'); return; }
        const rate = inc.data.limited ? 300 : 2200;
        inc.data.cost += rate;
        s.money -= rate;
        if (!inc.detected && inc.data.cost > 400000) E().detect(inc, '電信業者來電：你們的國際電話費在一小時內暴增');
        if (s.time - inc.startedAt > 720) { E().log(inc, `盜打持續了 12 小時，國際電話費累計 ${U.money(inc.data.cost)}。`); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'block', label: '在電話交換機暫停國際撥號、重設被破解的分機密碼', time: 10, verdict: 'good',
          explain: '先止血：停掉國際外撥，並換掉被猜中的分機密碼（分機密碼也要夠複雜）。',
          run(s, inc) { inc.data.stopped = true; E().log(inc, `已停止盜打，這段期間的國際電話費約 ${U.money(inc.data.cost)}。`); } },
        { id: 'rule', label: '關閉 INTERNET → SERVERS 的 SIP 規則，改由 DMZ 的 SBC 對接電信業者', time: 20, verdict: 'good',
          explain: '根本解法：電話交換機不該直接暴露在網際網路上。SBC 只接受電信業者的連線，還會擋掉掃描與暴力破解。',
          run(s, inc) {
            const off = [];
            for (const r of s.fw.rules) if (r.on && r.action === 'allow' && (r.src === 'INTERNET' || r.src === 'ANY') && r.dst === 'SERVERS' && (r.svc === 'SIP' || r.svc === 'ANY')) { r.on = false; off.push(`#${s.fw.rules.indexOf(r) + 1}`); }
            inc.data.stopped = true;
            E().log(inc, off.length ? `已停用規則 ${off.join('、')}（記得在 DMZ 部署 SBC，外線才打得通）。` : '沒有找到可停用的規則。');
            G.bus.emit('change', { what: 'fw' });
          } },
        { id: 'limit', label: '請電信業者設定國際通話的額度上限', time: 30, verdict: 'neutral', explain: '可以限制損失的金額，但盜打還在繼續。',
          run(s, inc) { inc.data.limited = true; } },
        { id: 'ignore', label: '應該是客服打的越洋電話，不處理', time: 1, verdict: 'bad', explain: '半夜、大量、撥往罕見國家的國際電話，是典型的盜打特徵。' },
      ],
      review(s, inc) {
        return inc.data.blocked ? ['SBC 放在 DMZ 對接電信業者，電話交換機沒有暴露在網際網路上，攻擊一無所獲。']
          : [`盜打造成約 ${U.money(inc.data.cost)} 的國際電話費。`, '電話交換機不該直接對網際網路開放 SIP：用 SBC 對接電信業者，並限制國際撥號與分機密碼強度。'];
      },
    },

    /* ---------- 儲存與備份（第八章） ---------- */
    'disk-fail': {
      name: '儲存硬碟故障', cat: 'ops', sev: 'med', kb: 'k-san', minCh: 8, cooldown: 2880, detect: 'auto',
      weight: (s) => (Object.values(s.devices).some((d) => d.rack && CAT.devices[d.model].rawTB && !CAT.devices[d.model].shelf && !d.lost) ? 0.5 : 0),
      init(s, inc) {
        const cands = Object.values(s.devices).filter((d) => d.rack && d.status === 'ok' && !d.lost && CAT.devices[d.model].rawTB && !CAT.devices[d.model].shelf);
        const d = inc.data.dev ? s.devices[inc.data.dev] : U.pick(cands);
        if (!d) return false;
        const m = CAT.devices[d.model];
        /* SAN 的大容量擴充櫃也算在 SAN 上：有擴充櫃時，壞的通常是那些 16 TB 硬碟 */
        const hdd = !m.flash || (m.san && G.Stor.shelves().length > 0 && Math.random() < 0.7);
        const raid = d.raid || 'raid6';
        const rebuild = hdd ? U.randInt(840, 1080) : U.randInt(150, 220);
        d.rebuildUntil = s.time + rebuild;
        Object.assign(inc.data, { dev: d.id, raid, hdd, rebuild, replaced: false,
          risk: inc.data.risk !== undefined ? inc.data.risk : raid === 'raid5' ? (hdd ? 0.2 : 0.04) : raid === 'raid10' ? 0.03 : 0,
          checkAt: s.time + U.randInt(60, Math.max(90, rebuild - 30)) });
        inc.title = `${d.name} 硬碟故障，RAID 重建中`;
        E().log(inc, `${d.name}（${CAT.raid[raid].name}）的一顆${hdd ? ' 16 TB 大容量' : ' NVMe '}硬碟故障。備用硬碟（hot spare）自動接手，RAID 開始重建，約需 ${U.dur(rebuild)}。`);
        E().log(inc, raid === 'raid5' ? '⚠ RAID 5 只能壞一顆：重建完成之前，再壞一顆資料就全毀了。' : raid === 'raid6' ? 'RAID 6 可以再壞一顆，資料仍然安全。' : 'RAID 10：只要不是同一組鏡像的另一顆，都還撐得住。');
      },
      tick(s, inc) {
        const d = s.devices[inc.data.dev];
        if (!d) { E().resolve(inc, 'auto'); return; }
        if (inc.data.lost) {
          if (inc.data.restored) E().resolve(inc, 'fixed');
          else if (s.time - inc.data.lostAt > 2880) E().resolve(inc, 'fail');
          return;
        }
        if (!inc.data.second && s.time >= inc.data.checkAt && s.time < d.rebuildUntil) {
          inc.data.second = true;
          if (Math.random() < inc.data.risk) {
            inc.data.lost = true; inc.data.lostAt = s.time;
            d.lost = true;
            const m = CAT.devices[d.model];
            if (!m.san) d.dataLost = true;
            inc.sev = 'crit';
            inc.title = `${d.name} 陣列毀損：資料遺失`;
            const holds = G.R.stor ? (G.R.stor.pools.find((p) => p.dev === d || (m.san && p.kind === 'san')) || { items: {} }).items : {};
            if (holds['備份資料']) { s.bkp.lastOk = Math.max(s.bkp.lastTape || 0, s.bkp.lastCloud || 0) || null; }
            E().log(inc, `🚨 重建期間又壞了一顆硬碟！${d.name} 的陣列毀損，上面的資料（${Object.keys(holds).join('、') || '全部'}）無法讀取。`);
            if (m.san) E().log(inc, '所有放在 SAN 上的 VM 都停擺了。');
            G.bus.emit('change', { what: 'stor' });
            return;
          }
        }
        if (s.time >= d.rebuildUntil && (inc.data.replaced || s.time - inc.startedAt > 1440)) E().resolve(inc, inc.data.replaced ? 'fixed' : 'auto');
      },
      actions: [
        { id: 'swap', label: '熱插拔更換故障硬碟（NT$1.8 萬）', cost: 18000, time: 30, verdict: 'good',
          explain: '把壞掉的硬碟換掉，當作新的備用硬碟。儲存設備都支援熱插拔，不用停機。',
          run(s, inc) { inc.data.replaced = true; } },
        { id: 'verify', label: '確認最近一次備份可用', time: 10, verdict: 'good',
          explain: 'RAID 不是備份：陣列真的毀了，只能靠備份救回來。先確認備份是好的。',
          run(s, inc) { const h = G.Stor.rpoHours(); E().log(inc, h === Infinity ? '⚠ 沒有任何成功的備份！' : `最近一次成功備份在 ${Math.round(h)} 小時前${s.bkp.fault ? '，但最近的備份工作一直失敗' : ''}。`); } },
        { id: 'pause', label: '暫停非必要的讀寫，讓重建快一點', time: 5, verdict: 'neutral',
          explain: '重建時陣列很忙，減少其他讀寫可以縮短重建時間（也就縮短了危險期）。',
          run(s, inc) { const d = s.devices[inc.data.dev]; if (d && d.rebuildUntil > s.time) { d.rebuildUntil = s.time + Math.round((d.rebuildUntil - s.time) * 0.75); E().log(inc, `重建加速：剩 ${U.dur(d.rebuildUntil - s.time)}。`); } } },
        { id: 'restore', label: '從備份還原資料', time: (s, inc) => Math.round(90 + ((G.R.stor && G.R.stor.data.file) || 20) * 4), verdict: 'good',
          avail: (s, inc) => !!inc.data.lost, unavail: '陣列還沒有毀損',
          explain: '換掉故障的硬碟、重建一個新的陣列，再把資料從備份還原回來。資料量越大越久（RTO）。',
          run(s, inc) {
            const d = s.devices[inc.data.dev];
            const r = G.Stor.canRestore(false);
            if (d) { d.lost = false; d.dataLost = false; d.rebuildUntil = 0; }
            inc.data.restored = true;
            const h = G.Stor.rpoHours();
            if (r.ok) E().log(inc, `✔ 資料還原完成。${h > 2 ? `最近 ${Math.round(h)} 小時新增的資料救不回來（RPO）。` : ''}`);
            else { E().log(inc, `✖ ${r.why}：資料永久遺失，只能重新建立空的陣列。`); s.rating = Math.max(0, s.rating - 6); s.stor.extraTB = 0; }
            G.bus.emit('change', { what: 'stor' });
          } },
        { id: 'reboot', label: '重新開機儲存設備', time: 15, verdict: 'bad', explain: '硬碟是真的壞了，重開機沒用，還會讓所有使用這台儲存的服務中斷。',
          run(s, inc) { const d = s.devices[inc.data.dev]; if (d) d.bootUntil = s.time + 12; } },
      ],
      review(s, inc) {
        const out = [];
        if (inc.data.lost) out.push(`${CAT.raid[inc.data.raid].name} 在重建期間又壞了一顆硬碟，整個陣列毀損。大容量硬碟重建要十幾個小時，應該用 RAID 6。`);
        else if (inc.data.raid === 'raid5' && inc.data.hdd) out.push('這次運氣好：RAID 5 在大容量硬碟重建的十幾個小時裡，只要再壞一顆就全毀。建議改成 RAID 6。');
        else out.push('RAID 撐住了硬碟故障，服務沒有中斷。');
        out.push('RAID 保護的是「硬碟故障」，不是資料本身：誤刪、勒索軟體、整台設備燒毀，都只能靠備份。');
        if (!inc.data.replaced && !inc.data.lost) out.push('故障的硬碟沒有更換，陣列少了一顆備用硬碟。');
        return out;
      },
    },

    'data-spike': {
      name: '檔案資料暴增', cat: 'ops', sev: 'med', kb: 'k-san', minCh: 8, cooldown: 4320, detect: 'auto',
      weight: (s) => (Q.roleServers('file').some((d) => d.rack) && workHours(s.time) ? 0.4 : 0),
      init(s, inc) {
        if (!Q.roleServers('file').some((d) => d.rack)) return false;
        const tb = inc.data.tb || U.randInt(35, 70);
        inc.data.tb = tb;
        s.stor.extraTB = (s.stor.extraTB || 0) + tb;
        G.Stor.update();
        inc.title = `行銷部 8K 影片專案：檔案伺服器一週內多了 ${tb} TB`;
        E().log(inc, `行銷設計部開拍年度形象影片，8K 原始素材與剪輯檔一口氣丟上共用資料夾，檔案資料暴增 ${tb} TB。`);
        const P = G.R.stor.pools.filter((p) => p.items['檔案資料']);
        E().log(inc, P.map((p) => `${p.name}：${U.pct(Math.min(p.ratio, 9.99))}`).join('、'));
      },
      tick(s, inc) {
        const P = (G.R.stor ? G.R.stor.pools : []).filter((p) => p.items['檔案資料']);
        const ok = P.every((p) => p.ratio < 0.9);
        if (ok && s.time - inc.startedAt > 30) E().resolve(inc, inc.acts.archive || inc.acts.expand ? 'fixed' : 'auto');
        else if (s.time - inc.startedAt > 2880) E().resolve(inc, P.some((p) => p.ratio >= 1) ? 'fail' : 'auto');
      },
      actions: [
        { id: 'archive', label: '把結案的專案封存到磁帶 / 冷儲存', time: 180, verdict: 'good',
          avail: () => G.Stor.hasTape() || Q.hasService('cloudbk'), unavail: '沒有磁帶櫃或雲端儲存可以封存',
          explain: '分層儲存：很少再打開的舊資料搬到便宜的磁帶或雲端冷儲存，把快的主儲存留給正在進行的工作。',
          run(s) { s.stor.extraTB = Math.round((s.stor.extraTB || 0) * 0.35); G.Stor.update(); G.bus.emit('change', { what: 'stor' }); } },
        { id: 'expand', label: '緊急擴充：SAN 加擴充櫃或再加一台檔案伺服器', time: 5, verdict: 'good',
          explain: '容量規劃要提前做（到 80% 就該動作）；臨時擴充要等設備到貨、上架。這個行動會帶你到採購頁。',
          run() { G.bus.emit('notice', { kind: 'info', text: '到「採購 → 系統」買 DS-24 擴充櫃（SAN），或在「伺服器」再買一台 ST-4U 設為檔案角色', goto: 'shop:sys' }); } },
        { id: 'quota', label: '設定部門配額，要求清理重複與過期檔案', time: 120, verdict: 'neutral',
          explain: '配額可以避免同樣的事再發生，但清出來的空間有限。',
          run(s) { s.stor.extraTB = Math.round((s.stor.extraTB || 0) * 0.8); G.Stor.update(); } },
        { id: 'delete', label: '直接刪掉最大的影片資料夾', time: 5, verdict: 'bad',
          explain: '刪別人的工作檔案是災難：先溝通、封存或擴充，絕不是直接刪。',
          run(s) { s.stor.extraTB = Math.round((s.stor.extraTB || 0) * 0.4); s.rating = Math.max(0, s.rating - 4); G.Stor.update(); } },
      ],
      review() {
        const P = (G.R.stor ? G.R.stor.pools : []).filter((p) => p.items['檔案資料']);
        return [P.some((p) => p.ratio >= 1) ? '檔案伺服器滿了，全公司存不了檔。容量到 80% 就該擴充或封存。' : '主儲存保住了。', '分層儲存（熱資料放快的、冷資料放便宜的磁帶或雲端）是控制儲存成本的關鍵。'];
      },
    },

    'backup-fail': {
      name: '備份工作連續失敗', cat: 'ops', sev: 'med', kb: 'k-backup', minCh: 8, cooldown: 4320,
      weight: (s) => (G.Stor.bkpServers().length && !s.bkp.fault ? 0.45 : 0),
      init(s, inc) {
        if (!G.Stor.bkpServers().length || s.bkp.fault) return false;
        s.bkp.fault = inc.data.fault || U.pick(Object.keys(G.Stor.FAULTS));
        inc.data.fault = s.bkp.fault;
        inc.title = '備份工作連續失敗';
        E().log(inc, `${G.Stor.FAULTS[s.bkp.fault]}。從今晚起，每一次備份都會失敗。`);
      },
      detectChance: () => (Q.roleServers('siem').some((d) => G.Net.devUp(d)) ? 0.02 : G.Ops.nmsUp() ? 0.008 : 0.0004),
      tick(s, inc) {
        if (!s.bkp.fault) { E().resolve(inc, inc.acts.fix ? 'fixed' : 'auto'); return; }
        if (s.bkp.drillAt && s.bkp.drillAt >= inc.startedAt && !inc.detected) E().detect(inc, '還原演練發現備份有問題');
        if (s.time - inc.startedAt > 5760) { E().log(inc, '🚨 備份已經失敗了四天，完全沒有人發現。'); E().resolve(inc, 'fail'); }
      },
      end(s, inc) { if (inc.outcome === 'fail') s.bkp.fault = null; },
      actions: [
        { id: 'fix', label: '修正備份設定（更新帳號密碼 / 重啟代理程式 / 更新憑證）', time: 30, verdict: 'good',
          explain: '找到失敗的原因並修正，再手動補跑一次備份。',
          run(s) { s.bkp.fault = null; if (G.Stor.bkpServers().some((d) => G.Net.devUp(d))) s.bkp.lastOk = s.time; } },
        { id: 'drill', label: '安排還原演練，確認修好之後真的能還原', time: 10, verdict: 'good',
          explain: '修好之後要驗證：還原演練才能證明備份是可用的。',
          run() { G.Stor.drill(); } },
        { id: 'ignore', label: '只是偶發錯誤，明天會自己好', time: 1, verdict: 'bad', explain: '連續失敗就不是偶發。備份失敗沒人管，等到要還原時才發現，就太晚了。' },
      ],
      review(s, inc) {
        const out = [inc.detectHow && inc.detectHow.indexOf('演練') >= 0 ? '還原演練發現了備份的問題 —— 這就是定期演練的價值。' : inc.detected ? '監控系統收到了備份失敗的告警。' : '備份失敗了好幾天都沒有人發現。'];
        out.push('備份要「看報表」：每天確認成功，失敗要有告警（接到 NMS / SIEM）。');
        return out;
      },
    },

    'del-file': {
      name: '誤刪共用資料夾', cat: 'ops', sev: 'med', kb: 'k-backup', minCh: 8, cooldown: 2880, detect: 'auto',
      weight: (s) => (Q.roleServers('file').some((d) => d.rack) && workHours(s.time) && occupied(200).length ? 0.5 : 0),
      init(s, inc) {
        const occ = occupied(200).filter((f) => !G.FT[f.type].dine);
        if (!occ.length || !Q.roleServers('file').some((d) => d.rack)) return false;
        const f = inc.data.floor ? G.BLD.byId[inc.data.floor] : U.pick(occ);
        inc.data.floor = f.id;
        inc.title = `${f.id} 誤刪了整個專案資料夾`;
        E().log(inc, `${f.dept}的同事整理電腦時，把同步中的「2026 年度專案」共用資料夾整個刪除了（約 1.2 TB），網路磁碟機上的刪除不會進資源回收筒。`);
      },
      effects(s, inc, mods) { if (!inc.data.restored) mods.floorPenalty[inc.data.floor] = Math.min(mods.floorPenalty[inc.data.floor] || 1, 0.82); },
      tick(s, inc) {
        if (inc.data.restored) { E().resolve(inc, 'fixed'); return; }
        if (s.time - inc.startedAt > 1440) E().resolve(inc, 'fail');
      },
      actions: [
        { id: 'snap', label: '從儲存快照還原（幾分鐘）', time: 10, verdict: 'good',
          avail: (s) => !!s.stor.snap, unavail: '沒有開啟快照（系統 → 儲存）',
          explain: '快照可以在幾分鐘內救回一小時前的版本。但快照和原始資料在同一台設備上，它不是備份。',
          run(s, inc) { inc.data.restored = true; E().log(inc, '✔ 從一小時前的快照還原，幾乎沒有遺失。'); } },
        { id: 'backup', label: '從備份還原', time: 120, verdict: 'good',
          avail: () => G.Stor.bkpServers().length > 0, unavail: '沒有備份伺服器',
          explain: '從昨晚的備份把資料夾還原回來；今天白天改過的內容會遺失（RPO）。',
          run(s, inc) {
            const h = G.Stor.rpoHours();
            if (h === Infinity) { E().log(inc, '✖ 從來沒有成功的備份，資料救不回來。'); return; }
            inc.data.restored = true;
            E().log(inc, `✔ 從 ${Math.round(h)} 小時前的備份還原完成${h > 10 ? `，這段時間的修改遺失了` : ''}。`);
          } },
        { id: 'recycle', label: '請同事檢查資源回收筒', time: 10, verdict: 'neutral', explain: '從網路磁碟機刪除的檔案不會進本機的資源回收筒，通常白找。' },
        { id: 'redo', label: '請同事自己重做', time: 5, verdict: 'bad', explain: '一整年的專案資料要重做？這正是備份存在的理由。',
          run(s) { s.rating = Math.max(0, s.rating - 3); } },
      ],
      review(s) { return [s.stor.snap ? '快照讓誤刪在幾分鐘內就救回來。' : '開啟儲存快照，誤刪幾分鐘就能還原（備份要花幾小時）。', '快照不是備份：它和原始資料在同一台設備上，設備壞了、被加密了，快照也一起沒了。']; },
    },

    'allhands': {
      name: '執行長全員大會直播', cat: 'ops', sev: 'med', kb: 'k-bandwidth', minCh: 3, cooldown: 4320, detect: 'auto',
      weight: (s) => (workHours(s.time) && U.hourOf(s.time) < 15 && Q.employees() > 1500 ? 0.5 : 0),
      init(s, inc) {
        inc.data.until = s.time + 60;
        inc.data.mult = 2.2;
        inc.title = '執行長全員大會直播';
        E().log(inc, '執行長即將開始全員視訊大會，所有員工同時在座位上觀看 1080p 直播串流！');
      },
      effects(s, inc, mods) { mods.inetMult *= inc.data.mult; },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, 'auto'); },
      actions: [
        { id: 'ecdn', label: '啟用企業內部串流快取（eCDN）', cost: 80000, time: 10, verdict: 'good',
          explain: '同一份直播只從網際網路下載一次，再由內網分送給所有人，大幅減少 WAN 流量。',
          run(s, inc) { inc.data.mult = 1.2; } },
        { id: 'qos', label: '設定 QoS 限制串流頻寬', time: 5, verdict: 'neutral', explain: '保護其他應用不被擠爆，但直播畫質會變差。',
          run(s, inc) { inc.data.mult = 1.6; } },
        { id: 'upgrade', label: '緊急升級 ISP 頻寬', time: 5, verdict: 'bad', explain: '專線升級需要數天前置作業，來不及。' },
      ],
      review() { return ['大型活動前應先評估頻寬，或使用 eCDN / 組播技術分送影音。']; },
    },

    /* ================= 資安事件 ================= */
    'scan': {
      name: '外部連接埠掃描', cat: 'sec', sev: 'low', kb: 'k-rules', minCh: 3, cooldown: 1440, detect: 'auto',
      weight: () => 1,
      init(s, inc) {
        const p = pos();
        inc.data.ip = randIP();
        inc.data.until = s.time + 30;
        inc.title = `來自 ${inc.data.ip} 的連接埠掃描`;
        E().log(inc, `防火牆日誌：${inc.data.ip} 在 5 分鐘內對公司的公有 IP 探測了 1,024 個連接埠。`);
        if (p.mgmtExposed) {
          E().log(inc, `⚠ 對方很可能已發現對外開放的管理服務（${p.mgmt.join('、')}），接下來可能嘗試暴力破解。`);
          s.sched.push({ at: s.time + U.randInt(60, 180), type: 'brute' });
        } else E().log(inc, '掃描沒有發現可利用的服務：防火牆只開放了必要的連接埠。');
      },
      tick(s, inc) { if (s.time >= inc.data.until) E().resolve(inc, pos().mgmtExposed ? 'auto' : 'blocked'); },
      actions: [
        { id: 'review', label: '檢查有哪些服務對網際網路開放', time: 10, verdict: 'good', explain: '先了解自己的暴露面：對外只該開放必要的服務。',
          run(s, inc) {
            const out = [];
            for (const z of ['LAN', 'SERVERS', 'DMZ']) { const a = G.Sec.allowedSvcs('INTERNET', z); if (a.length) out.push(`INTERNET → ${z}：${a.join('、')}`); }
            E().log(inc, out.length ? `對外開放：${out.join('；')}` : '沒有任何服務對網際網路開放。');
          } },
        { id: 'geo', label: '啟用 Geo-IP 地理封鎖', time: 5, verdict: 'good', explain: '擋掉大部分來自高風險地區的掃描與暴力破解。',
          run(s) { s.services.geo = s.services.geo || { since: s.time }; } },
        { id: 'block', label: '在防火牆封鎖來源 IP', time: 3, verdict: 'neutral', explain: '擋得了這個 IP，但攻擊者換個 IP 就能再來。治本是關閉不必要的對外服務。' },
      ],
      review() { return pos().mgmtExposed ? ['掃描本身不是攻擊，但它是攻擊的前兆。對外開放的管理服務一定會被找到。'] : ['防火牆只開放必要服務，掃描就一無所獲。']; },
    },

    'brute': {
      name: 'RDP / SSH 暴力破解', cat: 'sec', sev: 'high', kb: 'k-brute', minCh: 3, cooldown: 1440,
      weight: () => (pos().mgmtExposed ? 3 : 0.3),
      init(s, inc) {
        const p = pos();
        inc.data.ip = randIP();
        inc.data.progress = 0;
        inc.title = 'RDP / SSH 暴力破解';
        if (!p.mgmtExposed) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, `來自 ${inc.data.ip} 的 3389 / 22 埠連線嘗試，全部被防火牆的預設拒絕擋下。`);
          E().detect(inc, '防火牆日誌');
          return;
        }
        E().log(inc, `攻擊者 ${inc.data.ip} 正對對外開放的 ${p.mgmt.join('、')} 以字典檔大量嘗試帳號密碼。`);
      },
      detectChance: () => { const p = pos(); return p.siem ? 0.08 : p.ips ? 0.03 : p.nms ? 0.004 : 0.0015; },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 10) E().resolve(inc, 'blocked'); return; }
        const p = pos();
        if (!p.mgmtExposed || p.mfa) { E().resolve(inc, 'contained'); return; }
        const rate = inc.data.slowUntil > s.time ? 0.5 : 1;
        inc.data.progress += U.rand(0.3, 1.2) * rate * (p.geo ? 0.45 : 1);
        if (inc.detected && s.time % 30 === 0) E().log(inc, `SIEM：administrator 帳號登入失敗累計 ${U.num(Math.round(inc.data.progress * 41))} 次。`);
        if (inc.data.progress >= 100) {
          E().log(inc, '🚨 攻擊者猜中了一組管理員密碼，成功登入內部主機！');
          E().resolve(inc, 'fail');
          s.sched.push({ at: s.time + U.randInt(360, 1080), type: 'ransomware', data: { origin: 'srv' } });
        }
      },
      actions: [
        { id: 'rule', label: '停用對網際網路開放 RDP / SSH 的防火牆規則', time: 5, verdict: 'good',
          explain: '從根本消除暴露面：管理服務不該直接開放給網際網路，應改用 VPN + MFA。',
          run(s, inc) {
            const off = [];
            for (const r of s.fw.rules) {
              if (r.on && r.action === 'allow' && (r.src === 'INTERNET' || r.src === 'ANY') && r.dst !== 'INTERNET' && ['RDP', 'SSH', 'ANY'].includes(r.svc)) { r.on = false; off.push(`#${s.fw.rules.indexOf(r) + 1}`); }
            }
            E().log(inc, off.length ? `已停用規則 ${off.join('、')}。` : '沒有找到可停用的規則。');
            G.bus.emit('change', { what: 'fw' });
          } },
        { id: 'mfa', label: '緊急導入 MFA 多因素驗證', cost: () => (Q.hasService('mfa') ? 0 : Math.round(Q.monthlyServiceCost('mfa'))), time: 60, verdict: 'good',
          explain: '即使密碼被猜中，沒有第二因素也登入不了。', run(s) { s.services.mfa = s.services.mfa || { since: s.time }; } },
        { id: 'block', label: '封鎖攻擊來源 IP', time: 3, verdict: 'neutral', explain: '攻擊者使用殭屍網路，換個 IP 就能繼續，只能稍微減緩。',
          run(s, inc) { inc.data.slowUntil = s.time + 120; } },
        { id: 'pw', label: '重設所有管理員密碼', time: 20, verdict: 'neutral', explain: '讓已猜測的進度部分作廢，但只要服務還開著，攻擊就會繼續。',
          run(s, inc) { inc.data.progress = Math.max(0, inc.data.progress - 40); } },
      ],
      review() { return ['管理介面（RDP、SSH）永遠不該直接對網際網路開放。遠端管理請走 VPN，並加上 MFA。']; },
    },

    'ddos': {
      name: 'DDoS 分散式阻斷服務攻擊', cat: 'sec', sev: 'crit', kb: 'k-ddos', minCh: 3, cooldown: 2880, detect: 'auto',
      weight: () => (G.Campaign.websiteLive() ? 0.8 : 0.2),
      init(s, inc) {
        const wan = Q.ispBw(true);
        if (wan <= 0) return false;
        /* 官網在雲端：攻擊打的是雲端的 CDN，被全球的節點吸收掉 */
        if (Q.hasService('cloudweb') && G.Campaign.websiteLive() && !inc.data.hq) {
          inc.data.blocked = true; inc.sev = 'low';
          inc.title = 'DDoS 攻擊官網（被雲端 CDN 吸收）';
          E().log(inc, `官網遭受約 ${U.bw(U.rand(40000, 120000))} 的 DDoS 攻擊，全部落在雲端 CDN 的全球節點上被吸收，公司的對外線路完全不受影響。`);
          return;
        }
        const webs = Q.roleServers('web').filter((d) => d.rack);
        const fw = Q.devices('firewall').find((d) => d.rack);
        const rtr = Q.devices('router').find((d) => d.rack);
        inc.data.dst = webs.length && G.Campaign.websiteLive() ? 'ROLE:web' : fw ? fw.id : rtr ? rtr.id : null;
        if (!inc.data.dst) return false;
        inc.data.mbps = Math.max(wan * U.rand(1.6, 2.6), U.rand(6000, 14000)) * (inc.data.scale || 1);
        inc.data.until = s.time + U.randInt(90, 180);
        inc.data.mitigated = false;
        inc.data.autoAt = s.time + 5;
        inc.title = 'DDoS 攻擊：網路出口被塞爆';
        E().log(inc, `WAN 下行流量瞬間飆到 ${U.bw(inc.data.mbps)}！來源是數萬個分散的 IP（殭屍網路）。`);
        if (Q.hasService('ddos')) E().log(inc, '已簽約 ISP DDoS 清洗服務，清洗中心將在數分鐘內自動介入。');
      },
      effects(s, inc, mods, flows) {
        if (inc.data.blocked) return;
        if (inc.data.webDown) mods.webDown = true;
        const mbps = inc.data.mitigated ? inc.data.mbps * 0.02 : inc.data.mbps;
        flows.push({ id: 'atk:' + inc.id, src: 'INET', dst: inc.data.dst, fwd: mbps, rev: mbps * 0.01, zs: 'INTERNET', zd: 'DMZ', svc: ['WEB'], volumetric: true, stopAtFw: true, incId: inc.id, label: 'DDoS 洪水流量', anomaly: true });
      },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 10) E().resolve(inc, 'blocked'); return; }
        if (!inc.data.mitigated && Q.hasService('ddos') && s.time >= inc.data.autoAt) {
          inc.data.mitigated = true; inc.data.mitAt = s.time;
          E().log(inc, 'ISP 清洗中心已介入，攻擊流量在上游被濾除。');
        }
        if (inc.data.mitigated && s.time >= (inc.data.mitAt || 0) + 30) { E().resolve(inc, 'contained'); return; }
        if (s.time >= inc.data.until) E().resolve(inc, 'auto');
      },
      actions: [
        { id: 'scrub', label: '啟動 ISP DDoS 清洗服務', cost: () => (Q.hasService('ddos') ? 0 : 350000), time: 15, verdict: 'good',
          explain: '在 ISP 上游把攻擊流量濾掉，是對抗大流量 DDoS 最有效的方法。沒有事先簽約的緊急啟用費很貴。',
          run(s, inc) { inc.data.mitigated = true; inc.data.mitAt = s.time; } },
        { id: 'fwblock', label: '在防火牆封鎖攻擊來源 IP', time: 5, verdict: 'bad',
          explain: '攻擊流量在抵達防火牆之前就已經塞滿 ISP 線路；而且來源是數萬個 IP，防火牆擋不完。' },
        { id: 'upgrade', label: '緊急申請加大 ISP 頻寬', time: 5, verdict: 'bad', explain: '專線升級需要數天，攻擊流量也往往比你買得到的頻寬還大。' },
        { id: 'webdown', label: '暫時關閉官網', time: 2, verdict: 'bad', explain: '攻擊打的是你的 IP 與線路，關網站不會讓流量停止，反而幫攻擊者達成目的。',
          run(s, inc) { inc.data.webDown = true; } },
        { id: 'waf', label: '啟用雲端 WAF / CDN 防護', cost: () => (Q.hasService('waf') ? 0 : Math.round(Q.monthlyServiceCost('waf'))), time: 30, verdict: 'neutral',
          explain: 'CDN 能吸收應用層攻擊、隱藏來源 IP，但這次是大流量攻擊，仍需要 ISP 清洗。',
          run(s, inc) { s.services.waf = s.services.waf || { since: s.time }; inc.data.mbps *= 0.7; } },
      ],
      review() { return Q.hasService('ddos') ? ['事先簽約的 DDoS 清洗服務自動介入，影響時間很短。'] : ['大流量 DDoS 只能在上游處理。建議事先與 ISP 簽訂 DDoS 清洗服務。']; },
    },

    'phish': {
      name: '網路釣魚 → 惡意程式感染', cat: 'sec', sev: 'high', kb: 'k-phish', minCh: 3, cooldown: 2160,
      weight: (s) => (occupied(100).length && workHours(s.time) ? 1 : 0),
      init(s, inc) {
        const fl = inc.data.floor ? G.BLD.byId[inc.data.floor] : U.pick(occupied(100));
        if (!fl) return false;
        const p = pos();
        const sent = 300;
        /* 電腦修補率越低，惡意巨集越容易利用漏洞執行（G.Ep.risk） */
        const click = 0.06 * (p.mailsec ? 0.12 : 1) * (p.training ? 0.35 : 1) * (inc.data.boost || 1) * G.Ep.risk();
        let infected = bino(sent, click);
        if (p.gav) infected = bino(infected, 0.5);
        if (p.edr) infected = bino(infected, 0.15);
        inc.data.floor = fl.id; inc.data.infected = infected;
        inc.data.c2 = U.pick(C2);
        inc.data.escalateAt = s.time + U.randInt(8 * 60, 16 * 60);
        inc.title = `${fl.id} 員工遭網路釣魚`;
        E().log(inc, `偽裝成「人資部：年終獎金發放名單.xlsm」的郵件寄給了 ${fl.id} 的 ${sent} 位員工。`);
        if (p.mailsec) E().log(inc, '郵件安全閘道攔截了大部分釣魚信。');
        if (infected === 0) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, '沒有任何電腦被感染 —— 防護奏效。');
          E().detect(inc, p.mailsec ? '郵件安全閘道' : p.edr ? 'EDR' : '員工回報');
          return;
        }
        E().log(inc, `${infected} 台電腦執行了惡意巨集，開始定期連線到 C2 伺服器 ${inc.data.c2}。`);
      },
      detectChance: () => { const p = pos(); return 0.0008 + (p.edr ? 0.08 : 0) + (p.siem ? 0.03 : 0) + (p.ips ? 0.02 : 0) + (p.url ? 0.015 : 0) + (p.nms ? 0.002 : 0); },
      effects(s, inc, mods, flows) {
        if (inc.data.floorOffUntil > s.time) mods.floorOff[inc.data.floor] = true;
        if (inc.data.blocked || inc.data.c2Blocked || inc.data.contained) return;
        const h = U.hourOf(s.time);
        const mb = (h < 5 ? 22 : 3) * Math.max(1, inc.data.infected);
        flows.push({ id: 'atk:' + inc.id, src: 'F:' + inc.data.floor, dst: 'INET', fwd: mb, rev: mb * 0.1, zs: 'LAN', zd: 'INTERNET', svc: ['WEB'], checkFw: true, incId: inc.id, label: `C2 連線 → ${inc.data.c2}`, anomaly: true });
      },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (inc.data.contained && inc.data.c2Blocked && inc.data.cleaned) { E().resolve(inc, 'contained'); return; }
        const p = pos();
        if (!inc.data.c2Blocked && (p.url || p.ips) && Math.random() < 0.02) { inc.data.c2Blocked = true; E().log(inc, 'URL 過濾 / IPS 自動攔截了連往 C2 網域的連線。'); }
        if (!inc.data.contained && s.time >= inc.data.escalateAt) {
          E().log(inc, '🚨 惡意程式開始在內網橫向移動，並下載了勒索軟體！');
          E().resolve(inc, 'fail');
          E().start('ransomware', { floor: inc.data.floor });
        }
      },
      actions: [
        { id: 'isolate', label: '隔離受感染電腦（關閉交換器埠 / NAC 隔離）', time: () => (Q.hasService('nac') ? 3 : 30), verdict: 'good',
          explain: '遏制的第一步：切斷受感染主機與內網的連線，阻止擴散。有 NAC 可以一鍵完成。', run(s, inc) { inc.data.contained = true; } },
        { id: 'c2', label: '在防火牆 / DNS 封鎖 C2 網域與 IP', time: 10, verdict: 'good', explain: '切斷攻擊者的遙控通道。', run(s, inc) { inc.data.c2Blocked = true; } },
        { id: 'clean', label: '重灌受感染電腦並重設帳號密碼', cost: (s, inc) => 6000 * Math.max(1, inc.data.infected), time: 180, verdict: 'good',
          avail: (s, inc) => !!inc.data.contained, unavail: '請先隔離受感染電腦',
          explain: '根除：惡意程式可能留下後門，重灌最保險；密碼也可能已經外洩。', run(s, inc) { inc.data.cleaned = true; } },
        { id: 'flooroff', label: '關閉整層樓的網路', time: 5, verdict: 'bad',
          explain: '過度反應：整層數百人無法工作，損失可能比攻擊本身還大。精準隔離受感染主機即可。',
          run(s, inc) { inc.data.contained = true; inc.data.floorOffUntil = s.time + 180; } },
        { id: 'mail', label: '寄信提醒全體員工注意釣魚信', time: 5, verdict: 'neutral', explain: '能避免更多人受害，但已感染的電腦仍在運作。' },
      ],
      review() {
        const p = pos(), out = [];
        if (!p.mailsec) out.push('郵件安全閘道可以在信件抵達前攔截大部分釣魚信。');
        if (!p.edr) out.push('EDR 可以在惡意程式執行時就阻擋並自動隔離。');
        if (!p.url && !p.ips) out.push('URL 過濾 / IPS 能擋下連往已知 C2 的連線。');
        return out.length ? out : ['多層防護（郵件過濾、EDR、URL 過濾）大幅降低了釣魚的成功率。'];
      },
    },

    'ransomware': {
      name: '勒索軟體攻擊', cat: 'sec', sev: 'crit', kb: 'k-ransom', minCh: 4, random: false,
      init(s, inc) {
        const p = pos();
        const occ = occupied(100);
        if (!occ.length) return false;
        const origin = inc.data.origin === 'srv' ? null : (inc.data.floor || U.pick(occ).id);
        inc.data.infected = origin ? [origin] : [U.pick(occ).id];
        inc.data.fileHit = inc.data.origin === 'srv';
        inc.data.nextSpread = s.time + U.randInt(20, 40);
        inc.data.encryptAt = s.time + (inc.data.fileHit ? 20 : 60);
        inc.title = '勒索軟體攻擊';
        if (p.edr && Math.random() < 0.7) {
          inc.data.blocked = true; inc.sev = 'med';
          E().log(inc, `EDR 在 ${inc.data.infected[0]} 偵測到大量檔案加密行為，已自動隔離主機並終止程序！`);
          E().detect(inc, 'EDR 自動阻擋');
          return;
        }
        E().log(inc, `${inc.data.infected[0]} 多台電腦的檔案副檔名變成 .locked，桌面出現勒索訊息：「支付 60 BTC，否則公開你們的資料」。`);
        if (p.edr || p.siem) E().detect(inc, p.edr ? 'EDR 告警' : 'SIEM 關聯告警');
      },
      detectChance: (s, inc) => (s.time - inc.startedAt > 25 ? 0.25 : 0.02),
      effects(s, inc, mods, flows) {
        if (inc.data.blocked) return;
        for (const fid of inc.data.infected) mods.floorPenalty[fid] = Math.min(mods.floorPenalty[fid] || 1, inc.data.rebuilt ? 1 : inc.data.contained ? 0.55 : 0.35);
        if (!inc.data.contained) {
          for (const fid of inc.data.infected) flows.push({ id: 'atk:' + inc.id + ':' + fid, src: 'F:' + fid, dst: 'ROLE:file', fwd: 180, rev: 40, zs: 'LAN', zd: 'SERVERS', svc: ['SMB'], checkFw: true, incId: inc.id, label: 'SMB 橫向掃描', anomaly: true });
        }
      },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        const p = pos();
        if (!inc.data.contained && s.time >= inc.data.nextSpread) {
          if (Math.random() < Math.min(0.95, 0.8 * (p.segmentation ? 0.35 : 1) * (p.edr ? 0.4 : 1) * Math.min(1.4, G.Ep.risk()))) {
            const cand = occupied(50).map((f) => f.id).filter((id) => !inc.data.infected.includes(id));
            if (cand.length) { const f = U.pick(cand); inc.data.infected.push(f); E().log(inc, `勒索軟體透過 SMB 擴散到 ${f}！`); }
          }
          inc.data.nextSpread = s.time + U.randInt(20, 45);
        }
        if (!inc.data.fileSafe && !inc.data.fileEncrypted && s.time >= inc.data.encryptAt) {
          const reach = inc.data.fileHit || p.smbToServers;
          if (reach && !inc.data.contained && Q.roleServers('file').some((d) => d.rack)) {
            for (const d of Q.roleServers('file')) d.encrypted = true;
            inc.data.fileEncrypted = true;
            E().log(inc, '🚨 檔案伺服器上的共用資料被加密了！全公司都打不開共用資料夾。');
          } else inc.data.encryptAt = s.time + 60;
        }
        const recovered = !inc.data.fileEncrypted || inc.data.restored;
        if (inc.data.contained && inc.data.rebuilt && recovered) { E().resolve(inc, 'contained'); return; }
        if (s.time - inc.startedAt > 2880) E().resolve(inc, 'fail');
      },
      end(s, inc) { if (inc.outcome === 'fail') for (const d of Q.roleServers('file')) d.encrypted = false; },
      actions: [
        { id: 'isolate', label: '立即隔離受感染樓層的網段', time: 15, verdict: 'good', explain: '遏制擴散是第一優先。', run(s, inc) { inc.data.contained = true; E().log(inc, `已隔離 ${inc.data.infected.join('、')}。`); } },
        { id: 'unplug', label: '緊急中斷檔案伺服器的網路連線', time: 5, verdict: 'good', explain: '在被加密之前保護最重要的資料。',
          run(s, inc) { if (!inc.data.fileEncrypted) { inc.data.fileSafe = true; E().log(inc, '檔案伺服器已及時隔離，資料安全。'); } else E().log(inc, '太遲了，檔案伺服器已經被加密。'); } },
        { id: 'restore', label: '從備份還原檔案伺服器（約 6 小時）', time: 360, verdict: 'good',
          avail: () => Q.roleServers('backup').some((d) => d.rack) || !!G.S.bkp.lastTape || !!G.S.bkp.lastCloud, unavail: '沒有備份伺服器！',
          explain: '有可用的乾淨備份，就不需要向攻擊者低頭。不可變、離線（磁帶）或異地（雲端物件鎖定）的備份，勒索軟體碰不到。',
          run(s, inc) {
            const r = G.Stor.canRestore(true);
            if (r.ok) {
              inc.data.restored = true;
              for (const d of Q.roleServers('file')) d.encrypted = false;
              const h = G.Stor.rpoHours();
              E().log(inc, `✔ ${r.how ? '從' + r.how + '還原成功' : '備份還原成功'}，檔案伺服器恢復服務。${h !== Infinity && h > 12 ? `最近 ${Math.round(h)} 小時的修改救不回來（RPO）。` : ''}`);
            } else E().log(inc, `✖ ${r.why || '備份也被勒索軟體加密了'}，還原失敗。`);
          } },
        { id: 'rebuild', label: '重灌受感染樓層所有電腦（約 8 小時）', cost: (s, inc) => 2500 * 500 * inc.data.infected.length, time: 480, verdict: 'good',
          avail: (s, inc) => !!inc.data.contained, unavail: '請先隔離受感染樓層',
          explain: '根除：確保每台電腦都乾淨了才能恢復上線。', run(s, inc) { inc.data.rebuilt = true; } },
        { id: 'pay', label: '支付贖金（約 NT$1,500 萬）', cost: 15000000, time: 120, verdict: 'bad',
          explain: '無法保證取回資料，還會資助犯罪、讓你成為下一次的目標。主管機關也強烈建議不要支付。',
          run(s, inc) {
            s.stats.ransomPaid++;
            s.rating = Math.max(0, s.rating - 8);
            if (Math.random() < 0.6) { inc.data.restored = true; inc.data.rebuilt = true; inc.data.contained = true; for (const d of Q.roleServers('file')) d.encrypted = false; E().log(inc, '拿到了解密金鑰，資料慢慢解開了……但你已經付了錢。'); }
            else E().log(inc, '✖ 解密金鑰無效，資料依然無法還原。');
          } },
        { id: 'report', label: '通報資安長、法務與主管機關', time: 30, verdict: 'good', explain: '重大資安事件依法需要通報，也是事件應變流程的一環。', run(s, inc) { inc.data.reported = true; } },
      ],
      review(s, inc) {
        const p = pos(), out = [];
        out.push(p.segmentation ? '內部分段限制了勒索軟體的擴散範圍。' : '內網沒有分段，勒索軟體可以從任何樓層直達檔案伺服器。');
        out.push(p.backup ? (p.immutable ? '不可變備份確保了還原一定成功。' : '有備份，但沒有不可變保護，備份本身也可能被加密。') : '沒有備份，只能在支付贖金與永久失去資料之間選擇。');
        if (!p.edr) out.push('EDR 可以在加密行為一開始就自動阻擋。');
        return out;
      },
    },

    'sqli': {
      name: '官網 SQL Injection 攻擊', cat: 'sec', sev: 'high', kb: 'k-sqli', minCh: 3, cooldown: 2880,
      weight: () => (G.Campaign.websiteLive() && Q.roleServers('web').some((d) => d.rack) ? 1 : 0),
      init(s, inc) {
        const webs = Q.roleServers('web').filter((d) => d.rack);
        if (!webs.length) return false;
        inc.data.web = webs[0].id;
        inc.data.ip = randIP();
        inc.data.progress = 0;
        inc.title = '官網遭受 SQL Injection 攻擊';
        if (pos().waf) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, `WAF 攔截了來自 ${inc.data.ip} 的 2,314 筆 SQL Injection 請求：/product?id=1' OR '1'='1`);
          E().detect(inc, 'WAF');
          return;
        }
        E().log(inc, `網站日誌出現大量可疑請求：GET /product?id=1' UNION SELECT username,password FROM members--（來源 ${inc.data.ip}）`);
      },
      detectChance: () => { const p = pos(); return 0.002 + (p.ips ? 0.04 : 0) + (p.siem ? 0.03 : 0); },
      effects(s, inc, mods, flows) {
        if (inc.data.offline) mods.webDown = true;
        if (inc.data.blocked || inc.data.patched || inc.data.offline || inc.data.progress < 40) return;
        if (G.Net.devUp(s.devices[inc.data.web])) flows.push({ id: 'atk:' + inc.id, src: inc.data.web, dst: 'INET', fwd: 120, rev: 5, zs: G.Net.ruleZone(inc.data.web), zd: 'INTERNET', svc: ['WEB'], incId: inc.id, label: '資料庫內容被大量傳出', anomaly: true });
      },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (inc.data.patched || pos().waf) { E().resolve(inc, 'contained'); return; }
        if (inc.data.offline) return;
        inc.data.progress += U.rand(0.4, 1.2) * (pos().ips ? 0.35 : 1);
        if (inc.data.progress >= 100) {
          const z = G.Net.zones().get(inc.data.web);
          E().log(inc, '🚨 攻擊者竊取了會員資料庫（個資外洩）！');
          if (z && z.zone !== 'DMZ') {
            E().log(inc, '🚨 官網不在 DMZ，攻擊者從網站伺服器直接進入了內網！');
            s.sched.push({ at: s.time + U.randInt(240, 720), type: 'ransomware', data: { origin: 'srv' } });
          }
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'waf', label: '啟用雲端 WAF', cost: () => (Q.hasService('waf') ? 0 : Math.round(Q.monthlyServiceCost('waf'))), time: 20, verdict: 'good',
          explain: 'WAF 可以立刻擋下 SQL Injection 的攻擊特徵，爭取修補程式的時間。', run(s) { s.services.waf = s.services.waf || { since: s.time }; } },
        { id: 'patch', label: '緊急修補網站程式（改用參數化查詢）', cost: 120000, time: 240, verdict: 'good', explain: '根本解法：修正有漏洞的程式碼。',
          run(s, inc) { inc.data.patched = true; inc.data.offline = false; } },
        { id: 'offline', label: '暫時將官網下線', time: 5, verdict: 'neutral', explain: '可以立刻止血，但官網中斷也有營收損失。修補完成後會自動上線。',
          run(s, inc) { inc.data.offline = true; } },
        { id: 'blockip', label: '封鎖攻擊來源 IP', time: 3, verdict: 'neutral', explain: '攻擊者可以透過代理伺服器換 IP。', run(s, inc) { inc.data.progress = Math.max(0, inc.data.progress - 20); } },
        { id: 'restart', label: '重新啟動網站伺服器', time: 10, verdict: 'bad', explain: '漏洞在程式碼裡，重開機無法修補。' },
      ],
      review() { return pos().webInDmz ? ['官網放在 DMZ，就算被攻破，攻擊者也無法直接進入內網。'] : ['官網不在 DMZ：網站被攻破時，攻擊者就直接在內網裡了。']; },
    },

    'exfil': {
      name: '異常資料外傳', cat: 'sec', sev: 'high', kb: 'k-siem', minCh: 4, cooldown: 2880,
      weight: (s) => (U.hourOf(s.time) < 5 ? 0.8 : 0.05),
      init(s, inc) {
        const srv = Q.devices('server').filter((d) => d.rack && ['file', 'db'].includes(d.role));
        const d = inc.data.src ? s.devices[inc.data.src] : U.pick(srv);
        if (!d) return false;
        inc.data.src = d.id;
        inc.data.mbps = U.rand(300, 800);
        inc.data.until = s.time + U.randInt(120, 240);
        inc.data.stolen = 0;
        inc.data.dstIp = randIP();
        inc.title = `${d.name} 凌晨大量外傳資料`;
        E().log(inc, `NetFlow：${d.name} 持續以約 ${U.bw(inc.data.mbps)} 上傳資料到境外 IP ${inc.data.dstIp}（HTTPS）。`);
      },
      detectChance: () => { const p = pos(); return 0.001 + (p.siem ? 0.06 : 0) + (p.ips ? 0.02 : 0) + (p.nms ? 0.008 : 0); },
      effects(s, inc, mods, flows) {
        if (inc.data.stopped) return;
        flows.push({ id: 'atk:' + inc.id, src: inc.data.src, dst: 'INET', fwd: inc.data.mbps, rev: inc.data.mbps * 0.02, zs: G.Net.ruleZone(inc.data.src), zd: 'INTERNET', svc: ['WEB'], checkFw: true, incId: inc.id, label: `外傳 → ${inc.data.dstIp}`, anomaly: true });
      },
      tick(s, inc) {
        const f = G.R.sim && G.R.sim.flows.find((x) => x.id === 'atk:' + inc.id);
        if (f && f.blocked === 'fw') inc.data.fwBlocked = (inc.data.fwBlocked || 0) + 1;
        if (f && !f.blocked) inc.data.stolen += f.dFwd * 60 / 8 / 1000;
        if (inc.data.fwBlocked >= 10 && inc.data.stolen < 1) { E().log(inc, '防火牆的出站規則（SERVERS → INTERNET 只開必要服務）擋下了外傳。'); E().resolve(inc, 'blocked'); return; }
        if (inc.data.stopped) { E().resolve(inc, inc.data.stolen > 20 ? 'fail' : 'contained'); return; }
        if (s.time >= inc.data.until) E().resolve(inc, inc.data.stolen > 20 ? 'fail' : 'auto');
      },
      actions: [
        { id: 'block', label: '在防火牆封鎖外傳目的地 IP', time: 5, verdict: 'good', explain: '先止血：切斷資料流向攻擊者的通道。', run(s, inc) { inc.data.stopped = true; } },
        { id: 'isolate', label: '隔離來源伺服器並保全跡證', time: 15, verdict: 'good', explain: '隔離並保留記憶體與磁碟映像，供後續鑑識調查。', run(s, inc) { inc.data.stopped = true; } },
        { id: 'ignore', label: '判斷為正常的雲端備份流量，不處理', time: 1, verdict: 'bad', explain: '凌晨往境外 IP 大量上傳是典型的資料外洩特徵，應立即調查。' },
      ],
      review(s, inc) {
        const out = [`估計外洩資料量：${inc.data.stolen.toFixed(1)} GB。`];
        if (!pos().siem) out.push('SIEM 能自動關聯「凌晨 + 大量 + 境外」的異常，大幅縮短偵測時間。');
        if (pos().srvEgress) out.push('伺服器可以任意連出網際網路。嚴格的出站規則能讓外傳直接失敗。');
        return out;
      },
    },

    'guest-probe': {
      name: '訪客網路異常掃描', cat: 'sec', sev: 'med', kb: 'k-guest', minCh: 3, cooldown: 2880,
      weight: (s) => (s.fw.guestWifi && s.floors['1F'].movedIn > 0 && workHours(s.time) ? 0.8 : 0),
      init(s, inc) {
        inc.title = '訪客網路上有裝置掃描內網';
        if (pos().guestIsolated) {
          inc.data.blocked = true; inc.sev = 'low';
          E().log(inc, '大廳訪客網路上有一台筆電嘗試掃描 10.0.0.0/8，全部被防火牆擋下 —— 訪客隔離奏效。');
          E().detect(inc, '防火牆日誌');
          return;
        }
        inc.data.until = s.time + U.randInt(60, 120);
        E().log(inc, '大廳訪客網路上的一台筆電，成功連到了內部的 SMB（445）埠！');
      },
      detectChance: () => { const p = pos(); return 0.004 + (p.ips ? 0.05 : 0) + (p.siem ? 0.04 : 0); },
      tick(s, inc) {
        if (inc.data.blocked) { if (s.time - inc.startedAt >= 5) E().resolve(inc, 'blocked'); return; }
        if (pos().guestIsolated) { E().resolve(inc, 'contained'); return; }
        if (s.time >= inc.data.until) { E().log(inc, '🚨 訪客下載了共用資料夾中的機密文件後離開。'); E().resolve(inc, 'fail'); }
      },
      actions: [
        { id: 'rule', label: '新增規則拒絕 GUEST → LAN / SERVERS / DMZ（置頂）', time: 5, verdict: 'good', explain: '訪客網路只該通往網際網路。',
          run() { for (const z of ['DMZ', 'SERVERS', 'LAN']) G.Act.addRule({ src: 'GUEST', dst: z, svc: 'ANY', action: 'deny', top: true, note: '訪客隔離' }); } },
        { id: 'kick', label: '踢除該裝置並封鎖 MAC 位址', time: 5, verdict: 'neutral', explain: '處理了這一台，但根本問題是訪客網路沒有隔離。',
          run(s, inc) { inc.data.until = s.time + 60; } },
      ],
      review() { return pos().guestIsolated ? ['訪客網路與內網隔離，攻擊者什麼也碰不到。'] : ['訪客網路必須與內網隔離。']; },
    },

    'rogue-ap': {
      name: '偽冒基地台（Evil Twin）', cat: 'sec', sev: 'med', kb: 'k-wlc', minCh: 3, cooldown: 4320,
      weight: (s) => (workHours(s.time) && Q.employees() > 1000 ? 0.4 : 0),
      init(s, inc) {
        const occ = occupied(100);
        if (!occ.length) return false;
        inc.data.floor = U.pick(occ).id;
        inc.data.until = s.time + 180;
        inc.title = `${inc.data.floor} 出現偽冒的公司 SSID`;
        E().log(inc, `有人在 ${inc.data.floor} 茶水間藏了一台小型 AP，廣播和公司一模一樣的 SSID，騙員工輸入帳號密碼。`);
        if (pos().wlc) E().detect(inc, 'WLC 無線入侵偵測 (WIDS)');
      },
      detectChance: () => 0.006,
      tick(s, inc) {
        if (inc.data.removed) { E().resolve(inc, 'contained'); return; }
        if (s.time >= inc.data.until) {
          E().log(inc, '🚨 數十位員工的帳號密碼被竊取。');
          if (!pos().mfa) s.sched.push({ at: s.time + U.randInt(600, 1400), type: 'ransomware', data: { origin: 'srv' } });
          E().resolve(inc, 'fail');
        }
      },
      actions: [
        { id: 'locate', label: '定位並拆除偽冒 AP', time: () => (pos().wlc ? 20 : 90), verdict: 'good', explain: 'WLC 能三角定位非法 AP 的位置，大幅縮短搜尋時間。', run(s, inc) { inc.data.removed = true; } },
        { id: 'pw', label: '要求可能受害的員工更換密碼', time: 30, verdict: 'good', explain: '假設帳密已外洩，立即更換可以讓竊得的密碼失效。', run(s, inc) { inc.data.until += 60; } },
        { id: 'announce', label: '提醒員工只連公司認證的 SSID', time: 5, verdict: 'neutral', explain: '有幫助，但一般人很難分辨真假 SSID。802.1X 憑證驗證才是根本。' },
      ],
      review() { return pos().wlc ? ['無線控制器的 WIDS 在第一時間發現了偽冒基地台。'] : ['沒有無線控制器，只能等員工回報才發現。']; },
    },
  };
})(window.G = window.G || {});
