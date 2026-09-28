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
  const occupied = (min) => G.BLD.floors.filter((f) => G.S.floors[f.id].movedIn >= (min || 100));
  const C2 = ['update-check-cdn.xyz', 'msoffice-verify.top', 'cdn-sync-api.click', 'telemetry-win.site'];
  const bino = (n, p) => { let k = 0; for (let i = 0; i < n; i++) if (Math.random() < p) k++; return k; };
  const workHours = (t) => !U.isWeekend(t) && U.hourOf(t) >= 9 && U.hourOf(t) < 17;
  const hasOther = (list, pred) => list.some(pred);

  /** 機房火警：冒煙變成起火，損害大小由消防設備決定（氣體滅火 < 預動式灑水 < 一般灑水頭） */
  function ignite(s, inc) {
    const d = inc.data;
    d.stage = 'fire';
    d.fireTime = s.time;
    const damaged = [];
    const hit = (x) => { if (x && x.status === 'ok') { x.status = 'failed'; damaged.push(x.id); } };
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

    'hw-fail': {
      name: '設備硬體故障', cat: 'ops', sev: 'high', kb: 'k-ha', minCh: 3, cooldown: 2880, detect: 'auto',
      weight: (s) => (Object.values(s.devices).some((d) => d.rack && d.status === 'ok') ? 0.45 : 0),
      init(s, inc) {
        let d = inc.data.dev ? s.devices[inc.data.dev] : null;
        if (!d && inc.data.coreFirst) {
          const cores = Object.values(s.devices).filter((x) => x.rack && x.status === 'ok' && Q.isL3(x));
          if (cores.length) d = U.pick(cores);
        }
        if (!d) {
          const cands = Object.values(s.devices).filter((x) => x.rack && x.status === 'ok' && ['router', 'firewall', 'switch', 'server'].includes(CAT.devices[x.model].cat));
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
          const cands = Object.values(s.devices).filter((d) => d.rack && d.status === 'ok' && CAT.devices[d.model].cat !== 'bbu');
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
        const racks = s.racks.filter((r) => Object.values(s.devices).some((d) => d.rack === r.id));
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
          const devs = Object.values(s.devices).filter((x) => x.rack === d.rack && x.status === 'ok');
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
        if (inc.data.webDown) mods.webDown = true;
        const mbps = inc.data.mitigated ? inc.data.mbps * 0.02 : inc.data.mbps;
        flows.push({ id: 'atk:' + inc.id, src: 'INET', dst: inc.data.dst, fwd: mbps, rev: mbps * 0.01, zs: 'INTERNET', zd: 'DMZ', svc: ['WEB'], volumetric: true, stopAtFw: true, incId: inc.id, label: 'DDoS 洪水流量', anomaly: true });
      },
      tick(s, inc) {
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
        const click = 0.06 * (p.mailsec ? 0.12 : 1) * (p.training ? 0.35 : 1) * (inc.data.boost || 1);
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
          if (Math.random() < 0.8 * (p.segmentation ? 0.35 : 1) * (p.edr ? 0.4 : 1)) {
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
          avail: () => Q.roleServers('backup').some((d) => d.rack), unavail: '沒有備份伺服器！',
          explain: '有可用的乾淨備份，就不需要向攻擊者低頭。不可變備份保證備份本身不會被加密。',
          run(s, inc) {
            if (Q.hasService('immutable') || Math.random() < 0.5) {
              inc.data.restored = true;
              for (const d of Q.roleServers('file')) d.encrypted = false;
              E().log(inc, '✔ 備份還原成功，檔案伺服器恢復服務。');
            } else E().log(inc, '✖ 備份也被勒索軟體加密了（沒有不可變備份），還原失敗。');
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
