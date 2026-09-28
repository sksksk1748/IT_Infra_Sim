/* 章節小測驗與情境挑戰的介面 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, UI = G.UI;
  const QUIZ_KEY = 'infraops.quiz.best';
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const quizBest = () => { try { return JSON.parse(U.store.get(QUIZ_KEY) || '{}') || {}; } catch (e) { return {}; } };

  /* ---------- 章節小測驗 ---------- */
  /** 一題一題作答：選完立刻顯示對錯與解說，最後給成績 */
  UI.quiz = (ci) => {
    const set = G.QUIZ[ci];
    if (!set) return;
    const order = shuffle(set.qs.map((q, i) => i));
    let k = 0, right = 0;
    const box = h('div', { class: 'quiz' });
    UI.modal({ kicker: '章節小測驗', title: set.title, blocking: true, body: box });
    const render = () => {
      if (k >= order.length) { result(); return; }
      const q = set.qs[order[k]];
      const opts = shuffle(q.o.map((t, i) => ({ t, ok: i === 0 })));
      const fb = h('div', { class: 'quiz-fb', hidden: true });
      const list = h('div', { class: 'quiz-opts' });
      const cnt = h('span', {}, `目前答對 ${right} 題`);
      let answered = false;
      opts.forEach((o) => {
        const b = h('button', { class: 'quiz-opt', onclick: () => {
          if (answered) return;
          answered = true;
          if (o.ok) right++;
          cnt.textContent = `目前答對 ${right} 題`;
          Array.from(list.children).forEach((x, i) => { x.disabled = true; if (opts[i].ok) x.classList.add('right'); });
          if (!o.ok) b.classList.add('wrong');
          U.mount(fb,
            h('div', { class: 'r ' + (o.ok ? 'ok-t' : 'bad-t') }, o.ok ? '✔ 答對了！' : '✖ 答錯了'),
            h('p', {}, q.why),
            h('div', { class: 'row wrap' },
              q.kb ? h('button', { class: 'btn sm', onclick: () => UI.openKb(q.kb) }, '看相關知識卡') : null,
              h('button', { class: 'btn primary sm', onclick: () => { k++; render(); } }, k + 1 < order.length ? '下一題 ▶' : '看成績')));
          fb.hidden = false;
        } }, o.t);
        list.appendChild(b);
      });
      U.mount(box,
        h('div', { class: 'row between small muted' }, h('span', {}, `第 ${k + 1} / ${order.length} 題`), cnt),
        h('div', { class: 'quiz-q' }, q.q), list, fb);
    };
    const result = () => {
      const n = order.length;
      const best = quizBest();
      const isBest = best[ci] === undefined || right > best[ci];
      if (isBest) { best[ci] = right; U.store.set(QUIZ_KEY, JSON.stringify(best)); }
      const msg = right === n ? '全對！這一章的觀念你都掌握了。' : right >= n - 1 ? '很不錯，只差一點點。' : right >= Math.ceil(n / 2) ? '及格了，錯的題目建議回去看看知識卡。' : '建議先讀一下這章的知識卡再挑戰一次。';
      U.mount(box,
        h('div', { class: 'quiz-score' }, h('div', { class: 'grade mono' }, `${right} / ${n}`), h('div', {}, h('b', {}, msg), isBest && right > 0 ? h('div', { class: 'small ok-t' }, '新的最佳成績！') : h('div', { class: 'small muted' }, `最佳成績：${best[ci]} / ${n}`))),
        h('div', { class: 'row wrap' }, h('button', { class: 'btn primary', onclick: () => { k = 0; right = 0; order.splice(0, n, ...shuffle(set.qs.map((q, i) => i))); render(); } }, '再測一次'), h('button', { class: 'btn', onclick: () => UI.quizPicker() }, '其他章節')));
    };
    render();
  };
  /** 選擇章節（劇情模式只開放已經玩到的章節） */
  UI.quizPicker = () => {
    const s = G.S;
    const upTo = s && s.mode === 'campaign' ? s.chapter : G.QUIZ.length - 1;
    const best = quizBest();
    UI.modal({
      kicker: '知識檢定', title: '章節小測驗', blocking: true,
      body: (close) => [
        h('p', { class: 'muted' }, '每章 5 題，題目來自該章的知識卡。答錯會附上解說，可以直接打開相關知識卡。'),
        h('div', { class: 'col', style: { gap: '8px' } }, G.QUIZ.map((set, i) => {
          const locked = i > upTo;
          return h('div', { class: 'row between quiz-row' + (locked ? ' locked' : '') },
            h('div', {}, h('b', {}, set.title), h('div', { class: 'small muted' }, locked ? '玩到這一章後開放' : best[i] !== undefined ? `最佳成績 ${best[i]} / ${set.qs.length}` : '尚未作答')),
            h('button', { class: 'btn sm' + (locked ? '' : ' primary'), disabled: locked || null, onclick: () => { close(); UI.quiz(i); } }, '開始'));
        })),
      ],
    });
  };

  /* ---------- 情境挑戰 ---------- */
  UI.scenPicker = () => {
    const best = G.Scen.best();
    UI.modal({
      kicker: '情境挑戰', title: '選擇一個情境', wide: true, blocking: true,
      body: (close) => [
        h('p', { class: 'muted' }, '每個情境都會蓋好一套公司網路，把時間撥到事發前。限時處理完畢後依結果評分（S / A / B / C / D）。開始挑戰會覆蓋目前的存檔。'),
        h('div', { class: 'grid c3 scen-grid' }, G.Scen.list.map((sc) => h('div', { class: 'card col scen-card', style: { gap: '8px' } },
          h('div', { class: 'row between' }, h('span', { class: 'chip ' + (sc.level === '困難' ? 'bad' : 'warn') }, sc.level), best[sc.id] !== undefined ? h('span', { class: 'chip ok' }, `最佳 ${best[sc.id]} 分 · ${G.Scen.grade(best[sc.id])}`) : h('span', { class: 'chip' }, '尚未挑戰')),
          h('h3', {}, sc.title),
          h('p', { class: 'small muted', style: { margin: 0 } }, sc.brief[0]),
          h('div', { class: 'small' }, h('b', {}, '目標：'), sc.goal),
          h('button', { class: 'btn primary', style: { marginTop: 'auto' }, onclick: () => { close(); UI.startScen(sc.id); } }, '開始挑戰')))),
      ],
    });
  };
  UI.startScen = (id) => {
    const go = () => {
      G.Scen.start(id);
      UI.hideTitle();
      UI.build();
      UI.scenBrief();
    };
    const peek = G.State.peek();
    if (peek && !peek.scen) UI.confirm('開始情境挑戰', '目前的遊戲存檔會被覆蓋（可以先到選單匯出存檔）。確定要開始嗎？', '開始挑戰', go, 'danger');
    else go();
  };
  /** 任務簡報：開始時顯示；挑戰中也可以從任務面板再打開 */
  UI.scenBrief = (again) => {
    const s = G.S, sc = s && s.scen;
    if (!sc) return;
    const def = G.Scen.def(sc.id);
    UI.modal({
      kicker: `情境挑戰 · ${def.level}`, title: def.title, wide: true, dismissible: !!again,
      body: [
        ...def.brief.map((p) => h('p', {}, p)),
        h('div', { class: 'note info' }, h('b', {}, '目標　'), def.goal, h('span', { class: 'muted' }, `　·　時限 ${U.dur(def.mins)}`)),
        h('div', {}, h('div', { class: 'label', style: { marginBottom: '6px' } }, '提示'), h('ul', { class: 'small', style: { margin: 0, paddingLeft: '18px' } }, def.tips.map((t) => h('li', {}, t)))),
      ],
      actions: again ? [{ label: '繼續', kind: 'primary' }] : [{ label: '開始（時間開始流動）', kind: 'primary', onClick: () => { G.Scen.go(); G.Engine.setSpeed(5); UI.renderSide(); } }],
    });
  };
  UI.scenResult = (r) => {
    const s = G.S, sc = s && s.scen;
    if (!sc || !r) return;
    const def = G.Scen.def(sc.id);
    UI.modal({
      kicker: '情境挑戰結果', title: def.title, wide: true, blocking: true,
      body: [
        h('div', { class: 'row wrap', style: { gap: '18px', alignItems: 'center' } },
          h('div', {}, h('div', { class: 'label' }, '評等'), h('div', { class: 'grade' }, r.grade)),
          h('div', {}, h('div', { class: 'label' }, '分數'), h('div', { class: 'grade mono' }, String(r.score))),
          r.best ? h('span', { class: 'chip ok' }, '新的最佳成績！') : null),
        h('div', { class: 'col', style: { gap: '6px' } }, r.notes.map(([ok, t]) => h('div', { class: 'note ' + (ok ? 'ok' : 'bad') }, (ok ? '✔ ' : '✖ ') + t))),
        r.tips && r.tips.length ? h('div', { class: 'note info' }, h('b', {}, '檢討　'), r.tips.join(' ')) : null,
      ],
      actions: [
        { label: '回到標題', kind: 'ghost', onClick: () => UI.title() },
        { label: '選其他情境', kind: 'ghost', onClick: () => UI.scenPicker() },
        { label: '再挑戰一次', kind: 'primary', onClick: () => UI.startScen(sc.id) },
      ],
    });
  };
  /** 任務面板：情境挑戰的目標、剩餘時間與即時數據 */
  UI.scenSide = (wrap, closeBtn) => {
    const s = G.S, sc = s.scen, def = G.Scen.def(sc.id);
    const left = Math.max(0, sc.end - s.time);
    const live = def.live ? def.live(s, sc) : [];
    wrap.append(
      h('div', { class: 'row between' }, h('span', { class: 'label' }, `情境挑戰 · ${def.level}`), closeBtn),
      h('div', { class: 'ch-title' }, def.title),
      h('div', { class: 'note info small', style: { margin: '6px 0' } }, h('b', {}, '目標　'), def.goal),
      h('div', { class: 'row between' }, h('span', { class: 'label' }, sc.done ? '已結束' : sc.begun ? '剩餘時間' : '尚未開始'), h('span', { class: 'mono ' + (left < 30 && !sc.done ? 'bad-t' : '') }, sc.done ? '—' : U.dur(left))),
      live.length ? h('div', { class: 'kv', style: { margin: '8px 0' } }, ...[].concat(...live.map(([k, v]) => [h('span', { class: 'k' }, k), h('span', { class: 'v' }, v)]))) : null,
      h('div', { class: 'row wrap' },
        sc.done ? h('button', { class: 'btn primary sm', onclick: () => UI.scenResult(sc.result) }, '查看成績') : null,
        !sc.done && sc.begun ? h('button', { class: 'btn sm', onclick: () => UI.confirm('提前結算', '現在就結束挑戰並計算成績？', '結算', () => G.Scen.finish(s, 'quit')) }, '提前結算') : null,
        h('button', { class: 'btn sm', onclick: () => UI.scenBrief(true) }, '任務簡報'),
        h('button', { class: 'btn sm', onclick: () => UI.startScen(sc.id) }, '重新挑戰')),
      h('div', { class: 'hr' }),
      h('div', { class: 'label', style: { marginBottom: '6px' } }, '提示'),
      ...def.tips.map((t) => h('div', { class: 'small muted', style: { marginBottom: '4px' } }, '• ' + t)));
  };
  G.bus.on('scen', (e) => {
    if (e.kind === 'done') { UI.renderSide(); UI.scenResult(e.result); }
  });
})(window.G = window.G || {});
