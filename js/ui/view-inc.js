/* 事件中心：資安 / 維運事件（證據、應變行動、事後檢討）、使用者報修工單、營運日誌 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, CAT = G.CAT, Q = G.Q, UI = G.UI;
  const V = { tab: 'events', sel: null };
  G.Views.inc = V;
  const SEVC = { low: '', med: 'warn', high: 'bad', crit: 'bad' };

  V.mount = (el, param) => {
    const s = G.S;
    if (param === 'tickets' || param === 'log') V.tab = param;
    else if (param && param.startsWith('inc')) { V.tab = 'events'; V.sel = param; }
    V.el = el;
    const vis = s.incidents.filter((i) => i.detected);
    const act = vis.filter((i) => i.status === 'active');
    if (!V.sel || !vis.some((i) => i.id === V.sel)) V.sel = act.length ? act[act.length - 1].id : vis.length ? vis[vis.length - 1].id : null;
    const openT = s.tickets.filter((t) => !t.resolvedAt);
    el.appendChild(h('div', { class: 'view-h' },
      h('div', {}, h('h2', {}, '事件中心'), h('div', { class: 'desc' }, '資安與維運事件需要你做出應變決策；使用者報修則告訴你哪裡的網路出了問題。處理原則：先遏制、再根除、最後復原。')),
      h('button', { class: 'btn', onclick: () => UI.openKb('k-ir') }, '事件應變流程')));
    el.appendChild(h('div', { class: 'tabs' },
      h('button', { class: V.tab === 'events' ? 'on' : '', onclick: () => { V.tab = 'events'; UI.refresh(); } }, '事件', act.length ? h('span', { class: 'count' }, String(act.length)) : null),
      h('button', { class: V.tab === 'tickets' ? 'on' : '', onclick: () => { V.tab = 'tickets'; UI.refresh(); } }, '使用者報修', openT.length ? h('span', { class: 'count' }, String(openT.length)) : null),
      h('button', { class: V.tab === 'log' ? 'on' : '', onclick: () => { V.tab = 'log'; UI.refresh(); } }, '營運日誌')));
    if (V.tab === 'events') events(el, vis);
    else if (V.tab === 'tickets') tickets(el);
    else logTab(el);
  };
  V.update = () => {
    const now = performance.now();
    if (now - (V.last || 0) < 1000) return;
    V.last = now;
    if (V.tab === 'events' && V.detail && V.detail.isConnected) renderDetail();
    if (V.tab === 'tickets' && V.tkBox && V.tkBox.isConnected && now - (V.lastT || 0) > 3000) { V.lastT = now; renderTickets(); }
  };

  function events(el, vis) {
    const list = h('div', { class: 'col', style: { gap: '8px' } });
    const sorted = vis.slice().sort((a, b) => (a.status === 'active') === (b.status === 'active') ? b.startedAt - a.startedAt : a.status === 'active' ? -1 : 1);
    if (!sorted.length) list.appendChild(h('div', { class: 'card empty' }, '目前沒有事件。', G.Q.chapterNum() < 2 ? h('div', { class: 'small', style: { marginTop: '6px' } }, '（第一章不會發生隨機事件，專心建設吧！）') : null));
    for (const inc of sorted.slice(0, 30)) {
      const def = G.INC[inc.type];
      list.appendChild(h('div', { class: `inc-card sev-${inc.sev}${V.sel === inc.id ? ' sel' : ''}`, onclick: () => { V.sel = inc.id; UI.refresh(); } },
        h('div', { class: 'row between' }, h('b', {}, inc.title), statusChip(inc)),
        h('div', { class: 'row wrap small muted', style: { marginTop: '4px' } },
          h('span', { class: 'chip ' + (def.cat === 'sec' ? 'bad' : 'info') }, def.cat === 'sec' ? '資安' : '維運'),
          h('span', { class: 'chip ' + SEVC[inc.sev] }, '嚴重度：' + G.Ev.SEV[inc.sev]),
          h('span', { class: 'mono' }, U.stamp(inc.detectedAt || inc.startedAt)))));
    }
    V.detail = h('div', { class: 'col', style: { gap: '10px' } });
    el.appendChild(h('div', { class: 'split', style: { gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.4fr)' } }, list, V.detail));
    renderDetail();
  }
  function statusChip(inc) {
    if (inc.status === 'active') return h('span', { class: 'chip warn' }, '進行中');
    return h('span', { class: 'chip ' + (inc.outcome === 'fail' ? 'bad' : 'ok') }, G.Ev.OUTCOME[inc.outcome] || inc.outcome);
  }

  function renderDetail() {
    const s = G.S;
    const box = V.detail;
    U.clear(box);
    const inc = s.incidents.find((i) => i.id === V.sel);
    if (!inc) { box.appendChild(h('div', { class: 'card empty' }, '選擇左側的事件查看詳情')); return; }
    const def = G.INC[inc.type];
    const head = h('div', { class: 'card col', style: { gap: '8px' } },
      h('div', { class: 'row between' }, h('h3', { style: { fontSize: '17px' } }, inc.title), statusChip(inc)),
      h('div', { class: 'row wrap' },
        h('span', { class: 'chip ' + (def.cat === 'sec' ? 'bad' : 'info') }, def.name),
        h('span', { class: 'chip ' + SEVC[inc.sev] }, '嚴重度：' + G.Ev.SEV[inc.sev]),
        def.kb ? h('button', { class: 'btn ghost xs', onclick: () => UI.openKb(def.kb) }, '相關知識') : null),
      h('div', { class: 'kv' },
        h('span', { class: 'k' }, '偵測'), h('span', { class: 'v mono' }, `${U.stamp(inc.detectedAt)}（${inc.detectHow || ''}）`),
        inc.status !== 'active' ? h('span', { class: 'k' }, '實際發生') : null, inc.status !== 'active' ? h('span', { class: 'v mono' }, `${U.stamp(inc.startedAt)}${inc.detectedAt > inc.startedAt ? `（${U.dur(inc.detectedAt - inc.startedAt)} 後才發現）` : ''}`) : null,
        inc.endedAt ? h('span', { class: 'k' }, '結束') : null, inc.endedAt ? h('span', { class: 'v mono' }, `${U.stamp(inc.endedAt)}（處理 ${U.dur(inc.endedAt - inc.detectedAt)}）`) : null,
        inc.damage ? h('span', { class: 'k' }, '損失') : null, inc.damage ? h('span', { class: 'v mono bad-t' }, U.money(inc.damage)) : null,
        inc.ratingDelta !== undefined ? h('span', { class: 'k' }, '評價變化') : null, inc.ratingDelta !== undefined ? h('span', { class: 'v mono ' + (inc.ratingDelta >= 0 ? 'ok-t' : 'bad-t') }, (inc.ratingDelta >= 0 ? '+' : '') + inc.ratingDelta.toFixed(1)) : null));
    box.appendChild(head);
    box.appendChild(h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '6px' } }, '證據與時間軸'),
      h('div', { class: 'evlog' }, inc.logs.filter((l) => inc.status !== 'active' || l.t >= inc.startedAt).map((l) => h('div', { class: 'l' }, h('span', { class: 'dim' }, U.stamp(l.t)), h('span', {}, l.text))))));
    if (inc.status === 'active' && inc.data.blocked) {
      box.appendChild(h('div', { class: 'note ok' }, '防禦機制已經擋下這次攻擊，不需要人工處置。看看證據，了解是哪一層防護發揮了作用。'));
    } else if (inc.status === 'active') {
      const acts = h('div', { class: 'col', style: { gap: '6px' } });
      for (const a of def.actions) {
        const st = inc.acts[a.id];
        const cost = Math.round(G.Ev.cost(a, inc));
        const time = G.Ev.time(a, inc);
        const avail = !a.avail || a.avail(s, inc);
        const meta = st ? (st.done ? '✓ 已完成' : `執行中，約 ${U.dur(st.doneAt - s.time)} 後完成`) : `${cost ? U.money(cost) : '免費'} · ${time ? U.dur(time) : '立即'}${avail ? '' : ' · ' + (a.unavail || '目前無法執行')}`;
        acts.appendChild(h('button', { class: 'btn act-btn' + (st ? ' on' : ''), disabled: !!st || !avail || null, onclick: () => UI.res(G.Ev.act(inc.id, a.id)) },
          h('span', {}, a.label), h('span', { class: 'meta' }, meta)));
      }
      box.appendChild(h('div', { class: 'card' }, h('div', { class: 'row between', style: { marginBottom: '8px' } }, h('span', { class: 'label' }, '應變行動'), h('span', { class: 'small dim' }, '選擇你認為正確的處置；事後會檢討每個決定')), acts));
    } else {
      const rv = h('div', { class: 'col', style: { gap: '6px' } });
      if (!inc.review || !inc.review.length) rv.appendChild(h('div', { class: 'small muted' }, inc.outcome === 'blocked' ? '防禦機制在事件擴大前就擋下了攻擊，不需要人工處置。' : '這次沒有採取任何應變行動。'));
      for (const r of inc.review || []) {
        rv.appendChild(h('div', { class: 'verdict ' + r.verdict }, h('b', {}, { good: '✓ 正確', bad: '✗ 不恰當', neutral: '△ 有幫助但不是關鍵' }[r.verdict] + '　' + r.label), h('div', { class: 'small', style: { marginTop: '2px' } }, r.explain)));
      }
      const missed = def.actions.filter((a) => a.verdict === 'good' && !inc.acts[a.id]);
      if (missed.length && inc.outcome !== 'blocked') rv.appendChild(h('div', { class: 'small muted' }, '其他正確做法：' + missed.map((a) => a.label).join('、')));
      box.appendChild(h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '8px' } }, '事後檢討'), rv));
      if (inc.lessons && inc.lessons.length) box.appendChild(h('div', { class: 'card' }, h('div', { class: 'label', style: { marginBottom: '6px' } }, '學到的事'), h('ul', { class: 'small', style: { margin: 0, paddingLeft: '18px' } }, inc.lessons.map((x) => h('li', {}, x)))));
    }
  }

  function tickets(el) {
    V.tkBox = h('div', { class: 'col', style: { gap: '8px' } });
    el.appendChild(V.tkBox);
    renderTickets();
  }
  function renderTickets() {
    const s = G.S;
    const box = V.tkBox;
    U.clear(box);
    const open = s.tickets.filter((t) => !t.resolvedAt).slice().reverse();
    const done = s.tickets.filter((t) => t.resolvedAt).slice(-15).reverse();
    box.appendChild(h('div', { class: 'label' }, `處理中（${open.length}）`));
    if (!open.length) box.appendChild(h('div', { class: 'card empty' }, '目前沒有使用者報修。'));
    for (const t of open) {
      box.appendChild(h('div', { class: 'card row', style: { alignItems: 'flex-start', gap: '12px' } },
        h('span', { class: 'chip ' + (t.sev === 'crit' ? 'bad' : t.sev === 'high' ? 'bad' : 'warn') }, t.sev === 'crit' ? '緊急' : t.sev === 'high' ? '高' : '中'),
        h('div', { class: 'grow' }, h('b', {}, t.text), h('div', { class: 'small muted', style: { marginTop: '3px' } }, t.hint), h('div', { class: 'tiny dim mono', style: { marginTop: '3px' } }, `報修時間 ${U.stamp(t.t)}（${U.dur(s.time - t.t)} 前）`)),
        h('button', { class: 'btn primary sm', onclick: () => UI.go(t.goto) }, '前往處理')));
    }
    if (done.length) {
      box.appendChild(h('div', { class: 'label', style: { marginTop: '8px' } }, '最近解決'));
      for (const t of done) box.appendChild(h('div', { class: 'row small muted', style: { gap: '10px' } }, h('span', { class: 'ok-t' }, '✓'), h('span', { class: 'grow' }, t.text), h('span', { class: 'mono tiny' }, `${U.stamp(t.resolvedAt)}（${U.dur(t.resolvedAt - t.t)}）`)));
    }
  }

  function logTab(el) {
    const s = G.S;
    el.appendChild(h('div', { class: 'card' }, h('div', { class: 'alog', style: { maxHeight: 'none' } },
      s.log.slice().reverse().map((l) => h('div', { class: 'l' }, h('span', { class: 'dim' }, U.stamp(l.t)), h('span', { class: l.kind === 'good' ? 'ok-t' : l.kind === 'warn' ? 'warn-t' : l.kind === 'money' ? 'muted' : '' }, l.text))))));
  }
})(window.G = window.G || {});
