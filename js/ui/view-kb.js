/* 知識庫：遊戲中解鎖的概念卡片 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h, UI = G.UI;
  const V = { sel: null };
  G.Views.kb = V;

  V.mount = (el, param) => {
    const s = G.S;
    if (param && G.KB.byId[param]) V.sel = param;
    const unlocked = (id) => s.kb.unlocked[id] !== undefined;
    if (!V.sel || !unlocked(V.sel)) V.sel = G.KB.cards.find((c) => unlocked(c.id)).id;
    s.kb.seen[V.sel] = true;
    const n = G.KB.cards.filter((c) => unlocked(c.id)).length;
    el.appendChild(h('div', { class: 'view-h' }, h('div', {}, h('h2', {}, '知識庫'), h('div', { class: 'desc' }, `已解鎖 ${n} / ${G.KB.cards.length} 張知識卡。完成任務或遇到新事件時會解鎖更多。`)),
      UI.quizPicker ? h('button', { class: 'btn', onclick: () => UI.quizPicker() }, '章節小測驗') : null));
    const list = h('div', { class: 'kb-list card' });
    for (const cat of G.KB.cats) {
      list.appendChild(h('div', { class: 'cat' }, cat));
      for (const c of G.KB.cards.filter((x) => x.cat === cat)) {
        const ok = unlocked(c.id);
        list.appendChild(h('button', { class: (V.sel === c.id ? 'on' : '') + (ok ? '' : ' lock'), disabled: !ok || null, onclick: () => { V.sel = c.id; V.jump = true; UI.refresh(); } },
          h('span', {}, ok ? c.title : '？？？'), ok && !s.kb.seen[c.id] ? h('span', { class: 'chip accent', style: { fontSize: '10px', padding: '0 5px' } }, 'NEW') : null));
      }
    }
    const card = G.KB.byId[V.sel];
    const models = G.M3 ? G.M3.forKb(card.id) : [];
    let viewer = null;
    if (models.length) {
      // 背景事件也會觸發重繪：同一張卡沿用原本的 3D 檢視器，不重建 WebGL、不重設視角與分頁
      if (V.m3d && V.m3d.id === card.id && !V.m3d.el.m3dDead) viewer = V.m3d.el;
      else { viewer = G.M3.viewer(models, { height: window.innerWidth < 760 ? 280 : 340 }); V.m3d = { id: card.id, el: viewer }; }
    }
    const body = h('div', { class: 'card' },
      h('div', { class: 'label', style: { marginBottom: '6px' } }, card.cat),
      h('h3', { style: { fontSize: '22px', fontFamily: 'var(--font-display)', marginBottom: '10px' } }, card.title),
      viewer ? h('div', { class: 'kb-3d' }, viewer) : null,
      UI.kbBody(card));
    el.appendChild(h('div', { class: 'kb-layout' }, list, body));
    /* 窄螢幕是「清單在上、內容在下」：點了清單要捲到內容，不然看起來像沒反應 */
    if (V.jump) {
      V.jump = false;
      if (window.innerWidth <= 980) requestAnimationFrame(() => body.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  };
})(window.G = window.G || {});
