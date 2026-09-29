/* 第九章「割接之夜」的介面：割接計畫卡片、MOP（割接計畫書）、維護窗口橫幅、窗口開始的提醒、成績單 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const CutUI = {};
  G.CutUI = CutUI;
  const C = () => G.Cut;
  const P = () => G.Phys;
  const ROLE_N = { floor: '樓層上行', srv: '伺服器', fw: '防火牆', core: '交換器' };
  const ST_T = { todo: '待搬', moving: '搬移中', done: '完成', bad: '不通', gone: '缺線', other: '接錯地方' };
  const ST_C = { todo: '', moving: 'warn', done: 'ok', bad: 'bad', gone: 'bad', other: 'bad' };
  const chg = () => `CHG-${U.dayOf(G.S.cut.win.start)}-0917`;

  /** 下一條建議搬的線：雙上行的樓層先搬、單線的最後搬 */
  CutUI.next = () => {
    const c = G.S.cut;
    if (!c) return null;
    const rest = C().rows().filter((r) => C().rowState(r).st !== 'done');
    const single = (r) => Q.linksOf(r.far).filter((l) => Q.other(l, r.far) !== c.old).length === 0;
    rest.sort((a, b) => (C().rowState(b).st === 'moving') - (C().rowState(a).st === 'moving') || single(a) - single(b));
    return rest[0] || null;
  };
  function findRow(r) {
    const st = C().rowState(r);
    if (st.st === 'todo') { const c = G.S.cut; G.PatchUI.goPort(c.old, r.oldPid); return; }
    if (st.st === 'moving') {
      const x = P().st().loose.find((y) => y.node === r.far && y.pid === r.farPid);
      if (x) G.PatchUI.hold = x.id;
      G.PatchUI.goPort(G.S.cut.neu, r.newPid);
      return;
    }
    G.PatchUI.goPort(G.S.cut.neu, r.newPid);
  }
  CutUI.findRow = findRow;

  /** 右欄的割接計畫卡片 */
  CutUI.card = () => {
    const s = G.S, c = s.cut;
    if (!c || c.done) return null;
    const ph = C().phase();
    const pr = C().progress();
    const ck = (ok, text, hint) => h('div', { class: 'row small', style: { gap: '6px' } }, h('span', { class: ok ? 'ok-t' : 'warn-t' }, ok ? '✓' : '○'), h('span', {}, text), hint ? h('span', { class: 'dim tiny' }, hint) : null);
    const n = C().dev('neu'), old = C().dev('old'), peer = C().dev('peer');
    const unl = C().unlabeled().length;
    const nx = CutUI.next();
    const card = h('div', { class: 'card col pp-cut', style: { gap: '6px' } },
      h('div', { class: 'card-h', style: { marginBottom: '0' } }, h('h3', {}, `割接計畫 ${chg()}`), h('button', { class: 'btn primary xs', 'data-hint': 'cut-mop', onclick: () => CutUI.mop() }, '打開 MOP')),
      h('div', { class: 'small' }, `維護窗口：${U.dayLabel(c.win.start)} 02:00–05:00　`,
        h('b', { class: ph === 'prep' ? '' : ph === 'window' ? 'accent-t' : ph === 'over' ? 'bad-t' : 'ok-t' },
          ph === 'prep' ? `還有 ${U.dur(c.win.start - s.time)}` : ph === 'window' ? `進行中，剩 ${U.dur(c.win.end - s.time)}` : ph === 'over' ? `超時 ${U.dur(s.time - c.win.end)}` : '已完成搬線')),
      h('div', { class: 'label', style: { marginTop: '4px' } }, '窗口前的準備'),
      ck(!!n && n.stp !== false, `${n ? n.name : '新核心'} 開啟 STP`, '（原廠預設關閉）'),
      ck(!P().st().self.some((x) => n && x.node === n.id), '拆掉原廠的燒機測試線'),
      ck(!unl, `${old ? old.name : '舊核心'} 的線都有標籤`, unl ? `（還有 ${unl} 條）` : ''),
      ck(C().modsOk(), '新核心的光模組就位', `（${C().modsReady()}/${C().rows().length}）`),
      peer ? ck(C().lagOk(), `新核心 ⇄ ${peer.name}：兩條 100G + LACP`) : null,
      h('div', { class: 'label', style: { marginTop: '4px' } }, '搬線'),
      h('div', { class: 'prog' }, h('div', { class: 'bar grow' }, h('i', { style: { width: (pr.total ? pr.done / pr.total * 100 : 0) + '%' } })), h('span', { class: 'mono small' }, `${pr.done}/${pr.total}`)),
      h('div', { class: 'tiny muted' }, `影響 ${U.num(Math.round(c.st.impWin + c.st.impOut))} 人分鐘 · 接錯 ${c.st.errors} 次 · 風暴 ${c.st.storms} 次${c.st.early ? ` · 提前動線 ${c.st.early} 條` : ''}`),
      ph === 'prep' ? h('button', { class: 'btn sm', 'data-hint': 'cut-skip', style: { alignSelf: 'flex-start' }, title: '時間會快速前進，窗口一開始自動暫停',
        onclick: () => { G.Engine.skipTo(c.win.start); UI.toast(`快轉到 ${U.dayLabel(c.win.start)} 02:00（窗口開始會自動暫停）`, 'info'); } }, s.skipUntil === c.win.start ? '快轉中…' : '快轉到維護窗口') : null);
    if (nx && ph !== 'prep') {
      const st = C().rowState(nx);
      card.appendChild(h('div', { class: 'note info small' }, h('b', {}, '下一條：'), `${Q.nodeName(nx.far)}　${P().name(c.old, nx.oldPid)} → ${P().name(c.neu, nx.newPid)}`, h('span', { class: 'dim' }, `（${ST_T[st.st]}）`),
        h('button', { class: 'btn xs', 'data-hint': 'cut-next', style: { marginLeft: '6px' }, onclick: () => findRow(nx) }, '找到它')));
    }
    return card;
  };

  /** 維護窗口進行中的橫幅（時間即時更新） */
  CutUI.banner = () => {
    const c = G.S.cut;
    const ph = c && C().phase();
    if (!c || (ph !== 'window' && ph !== 'over')) { CutUI.bannerEl = null; return null; }
    CutUI.bannerEl = h('div', { class: 'pp-banner' + (ph === 'over' ? ' over' : '') });
    CutUI.tick();
    return CutUI.bannerEl;
  };
  CutUI.tick = () => {
    const el = CutUI.bannerEl, c = G.S && G.S.cut;
    if (!el || !c) return;
    const ph = C().phase(), s = G.S, pr = C().progress();
    const txt = ph === 'over'
      ? `⏰ 超過維護窗口 ${U.dur(s.time - c.win.end)}！現在 ${U.clock(s.time)}，07:00 同事就要上班 · 已搬 ${pr.done}/${pr.total}`
      : `🛠 維護窗口進行中 · 現在 ${U.clock(s.time)}，剩 ${U.dur(c.win.end - s.time)} · 已搬 ${pr.done}/${pr.total} · 窗口內每個動作都要花時間（遊戲已暫停，時間只在你動手時前進）`;
    if (el.textContent !== txt) el.textContent = txt;
  };

  /** MOP：割接計畫書 */
  CutUI.mop = () => {
    const s = G.S, c = s.cut;
    if (!c) return;
    c.mopRead = true;
    const n = C().dev('neu'), old = C().dev('old'), peer = C().dev('peer');
    const body = h('div', { class: 'col', style: { gap: '10px' } });
    let m = null;
    const render = () => {
      U.clear(body);
      body.append(
        h('div', { class: 'kv' },
          h('span', { class: 'k' }, '變更內容'), h('span', { class: 'v' }, `汰換核心交換器：${old ? old.name : '舊核心'}（EoS）→ ${n ? n.name : '新核心'}（CX-9600）`),
          h('span', { class: 'k' }, '維護窗口'), h('span', { class: 'v mono' }, `${U.dayLabel(c.win.start)} 02:00–05:00（3 小時）`),
          h('span', { class: 'k' }, '影響範圍'), h('span', { class: 'v' }, '雙上行的樓層不中斷；只接一條線的設備會斷線約 2～3 分鐘'),
          h('span', { class: 'k' }, '回退計畫'), h('span', { class: 'v' }, '04:30 還無法完成：把已搬的線插回舊核心的原埠，變更延到下次窗口')),
        h('div', { class: 'label' }, '一、窗口前的準備（上班時間就可以做，不影響服務）'),
        h('ol', { class: 'small', style: { margin: '0', paddingLeft: '20px' } },
          h('li', {}, `${n ? n.name : '新核心'}：開啟 STP、拆掉原廠的燒機測試線（兩個埠互接 = 迴圈）。`),
          h('li', {}, `${old ? old.name : '舊核心'}：每一條線循線追蹤、貼標籤（窗口內才循線，每條要花 6 分鐘）。`),
          h('li', {}, '新核心：依下表在「新埠」插好和對端同一種的光模組。'),
          c.rows.some((r) => r.short) ? h('li', {}, `新核心裝在 ${n ? n.rack : '另一座機櫃'}：有 ${c.rows.filter((r) => r.short).length} 條同機櫃用的短跳線拉不過去，搬的時候要換成新跳線（表中標示「換新跳線」）。`) : null,
          peer ? h('li', {}, `新核心 Hu1/2/31、32 ⇄ ${peer.name}：兩條 100G 互連，設定 LACP。新跳線不通先翻轉極性。`) : null),
        h('div', { class: 'label' }, `二、窗口內搬線（${c.rows.length} 條：一次一條，燈號轉綠再搬下一條）`));
      const tbl = h('table', { class: 't pp-mop' },
        h('thead', {}, h('tr', {}, ['#', '對端', '用途', '舊埠', '新埠', '模組', '狀態', ''].map((t) => h('th', {}, t)))));
      const tb = h('tbody', {});
      c.rows.forEach((r, i) => {
        const st = C().rowState(r);
        const modOk = C().modOk(r);
        tb.appendChild(h('tr', {},
          h('td', { class: 'mono' }, String(i + 1)),
          h('td', {}, `${Q.nodeName(r.far)} `, h('span', { class: 'mono dim' }, P().name(r.far, r.farPid))),
          h('td', {}, ROLE_N[r.role] || r.role),
          h('td', { class: 'mono' }, P().name(c.old, r.oldPid)),
          h('td', { class: 'mono' }, P().name(c.neu, r.newPid)),
          h('td', { class: 'mono ' + (modOk ? '' : 'warn-t') }, r.mod ? CAT.xcvr[r.mod].name : (CAT.cords[r.cord] || {}).media === 'dac' ? 'DAC' : '—', modOk ? '' : ' ○',
            r.short ? h('div', { class: 'tiny warn-t' }, `換 ${r.short} m 新跳線`) : null),
          h('td', {}, h('span', { class: 'chip ' + ST_C[st.st], title: st.text }, ST_T[st.st])),
          h('td', {}, h('button', { class: 'btn xs ghost', onclick: () => { m.close(); G.UI.go('rack:patch'); findRow(r); } }, '找到'))));
      });
      tbl.appendChild(tb);
      body.appendChild(h('div', { class: 'table-wrap' }, tbl));
      body.append(
        h('div', { class: 'label' }, '三、驗證與收尾'),
        h('ol', { class: 'small', style: { margin: '0', paddingLeft: '20px' }, start: 1 },
          h('li', {}, '每搬一條：燈號綠色、show interface「up / connected」、對端設備的連線恢復。'),
          h('li', {}, '全部搬完：到「監控」確認所有樓層上線、沒有中斷的服務，觀察 30 分鐘。'),
          h('li', {}, `拆掉 ${old ? old.name : '舊核心'} 剩下的線（和另一台核心的互連），下架。`)),
        h('div', { class: 'note info small' }, '小技巧：先搬「有雙上行」的樓層（另一條上行撐著，使用者感覺不到）；只接一條線的伺服器放最後、動作要快。'));
    };
    render();
    m = UI.modal({ kicker: '割接計畫書（MOP）', title: `${chg()} · 核心交換器汰換`, wide: true, body, blocking: true, actions: [{ label: '了解', kind: 'primary', hint: 'mop-ok' }] });
    G.bus.emit('hint');
  };

  /** 窗口開始 */
  G.bus.on('cut', (e) => {
    if (e.kind !== 'start' || !G.S || !G.S.cut) return;
    const c = G.S.cut;
    UI.modal({
      kicker: '維護窗口開始', title: '02:00　割接開始', dismissible: false,
      body: [
        h('p', {}, '變更單核准，監控中心已公告「網路維護中」。遊戲時間暫停了：接下來時間只會在你動手時前進——'),
        h('ul', { class: 'small' }, h('li', {}, `拔線、插線、插模組、翻轉極性：各 1 分鐘`), h('li', {}, '循線追蹤並貼標籤：6 分鐘'), h('li', {}, '修改設定（STP、LACP、埠的用途）：2 分鐘')),
        h('p', {}, `窗口在 05:00 結束。${c.st.unlab0 ? `注意：舊核心還有 ${c.st.unlab0} 條線沒有標籤。` : '準備工作都做好了，照 MOP 一條一條來。'}`),
      ],
      actions: [{ label: '打開 MOP', kind: 'ghost', onClick: () => { G.UI.go('rack:patch'); CutUI.mop(); } }, { label: '開始割接', kind: 'primary', onClick: () => G.UI.go('rack:patch') }],
    });
  });

  /** 章節完成時的成績單 */
  CutUI.reportBlock = () => {
    const c = G.S.cut;
    const r = c && (c.report || C().report());
    if (!r) return null;
    const GC = { S: 'ok', A: 'ok', B: 'info', C: 'warn', D: 'bad' };
    return h('div', { class: 'col', style: { gap: '8px' } },
      h('div', { class: 'row', style: { gap: '14px', alignItems: 'center' } },
        h('div', { class: 'pp-grade ' + GC[r.grade] }, r.grade),
        h('div', { class: 'col', style: { gap: '2px' } }, h('b', {}, `割接成績 ${r.pts} 分`), h('span', { class: 'small muted' }, `${r.rows} 條線 · ${r.moved ? `${U.clock(r.moved)} 搬完` : '沒有搬完'}`))),
      h('div', { class: 'kv' }, r.items.flatMap((x) => [h('span', { class: 'k' }, x.k), h('span', { class: 'v mono ' + (x.pen >= 5 ? 'bad-t' : x.pen > 0 ? 'warn-t' : 'ok-t') }, `${x.v}${x.pen > 0 ? `（−${Math.round(x.pen)}）` : ''}`)])));
  };
})(window.G = window.G || {});
