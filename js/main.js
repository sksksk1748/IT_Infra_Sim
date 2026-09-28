/* 進入點：掛上事件、啟動主迴圈、顯示開始畫面 */
(function (G) {
  'use strict';
  let started = false;
  function boot(data) {
    if (started) return;
    started = true;
    G.UI.hook();
    G.Engine.start();
    if (data && data.state) {
      try {
        const st = G.State.migrate(JSON.parse(data.state));
        if (st) {
          G.Engine.boot(st);
          G.UI.build();
          if (data.view) G.UI.go(data.view.view, data.view.param);
          return;
        }
      } catch (e) { console.error(e); }
    }
    G.UI.title();
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    try { hot.snapshot(() => (G.S ? { state: JSON.stringify(G.S), view: G.UI.cur } : {})); } catch (e) { /* ignore */ }
  }
  const go = () => {
    if (hot && hot.ready) hot.ready(boot);
    else boot((hot && hot.data) || {});
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
  else go();
})(window.G = window.G || {});
