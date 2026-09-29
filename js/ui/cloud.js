/* 雲端存檔（Firebase：Google 登入 + Firestore）
 * - 本機存檔仍然是主要存檔（離線、直接開檔案都能玩）；雲端用來換裝置接著玩
 * - 每個帳號 3 個欄位：users/{uid}/saves/{s1|s2|s3}，存 gzip 壓縮後的存檔（約 20 KB）
 * - 自動同步：上傳或讀取過的欄位會「連結」到這一局，之後每 5 分鐘（有新進度時）、章節開始 / 完成、離開頁面時自動上傳；
 *   欄位裡是另一局遊戲、或雲端的進度比這台新時會暫停，不會蓋掉
 * - Firebase SDK 只在用到時才載入（沒登入過就完全不載入）；設定在 js/core/cloud-config.js，規則在 firestore.rules
 */
(function (G) {
  'use strict';
  const U = G.U, h = U.h;
  const Cloud = { user: null, ready: false, listed: false, slots: {}, status: null, last: null, err: null };
  G.Cloud = Cloud;
  const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const KEY = 'infraops.cloud';
  const SLOTS = ['s1', 's2', 's3'];
  const AUTO_MS = 5 * 60 * 1000;
  const MAX = 880000;

  /* ---------- 這台瀏覽器的設定：連結的欄位、自動同步、登入過 ---------- */
  const pref = () => {
    const d = { slot: null, auto: true, signed: false };
    try { return Object.assign(d, JSON.parse(U.store.get(KEY) || '{}')); } catch (e) { return d; }
  };
  const setPref = (p) => U.store.set(KEY, JSON.stringify(Object.assign(pref(), p)));
  Cloud.pref = pref;

  Cloud.configured = () => !!(G.CLOUD_CONFIG && G.CLOUD_CONFIG.apiKey);
  /** 直接開 index.html（file://）時不能用 Google 登入 */
  Cloud.available = () => Cloud.configured() && /^https?:$/.test(location.protocol);

  const ERR = {
    'auth/popup-blocked': '瀏覽器擋下了登入視窗：請允許這個網站開啟彈出式視窗，再按一次登入',
    'auth/popup-closed-by-user': '登入視窗被關掉了，沒有登入',
    'auth/cancelled-popup-request': '已經有一個登入視窗開著',
    'auth/unauthorized-domain': '這個網址還沒加到 Firebase 的「授權網域」',
    'auth/operation-not-allowed': 'Firebase 還沒有啟用 Google 登入',
    'auth/network-request-failed': '網路連線失敗',
    'permission-denied': '沒有權限：雲端的規則不允許這個動作',
    'unavailable': '雲端暫時連不上，稍後再試',
    'resource-exhausted': '雲端今天的免費額度用完了，明天再試',
  };
  Cloud.errText = (e) => ERR[e && e.code] || (e && e.message) || String(e);
  const timeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || '連線逾時：網路不穩，稍後再試')), ms))]);

  /* ---------- 壓縮：gzip + base64（瀏覽器不支援時存原始 JSON） ---------- */
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (str) => { const bin = atob(str); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  Cloud.pack = async (json) => {
    if (!window.CompressionStream) return 'js:' + json;
    const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    return 'gz:' + b64(new Uint8Array(buf));
  };
  Cloud.unpack = async (data) => {
    if (typeof data !== 'string') throw new Error('存檔格式不正確');
    if (data.startsWith('js:')) return data.slice(3);
    if (!data.startsWith('gz:')) throw new Error('存檔格式不正確');
    if (!window.DecompressionStream) throw new Error('這個瀏覽器太舊，讀不了壓縮過的存檔');
    return new Response(new Blob([unb64(data.slice(3))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  };

  /* ---------- Firebase ---------- */
  let loading = null;
  const script = (src) => new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.onload = () => res();
    el.onerror = () => rej(new Error('無法載入雲端元件：網路不通，或被瀏覽器的擴充功能擋下'));
    document.head.appendChild(el);
  });
  /** 載入 Firebase、恢復上次的登入狀態 */
  Cloud.init = () => {
    if (!Cloud.available()) return Promise.resolve(false);
    if (!loading) {
      loading = (async () => {
        if (!window.firebase) for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js']) await script(SDK + f);
        if (!firebase.apps.length) firebase.initializeApp(G.CLOUD_CONFIG);
        Cloud.auth = firebase.auth();
        Cloud.db = firebase.firestore();
        await new Promise((res) => {
          let first = true;
          Cloud.auth.onAuthStateChanged((u) => {
            Cloud.user = u;
            Cloud.listed = false;
            Cloud.slots = {};
            if (u) { setPref({ signed: true }); Cloud.refresh().catch((e) => { Cloud.status = { kind: 'bad', text: '讀取雲端存檔失敗：' + Cloud.errText(e) }; G.bus.emit('cloud'); }); }
            G.bus.emit('cloud');
            if (first) { first = false; res(); }
          });
        });
        Cloud.ready = true;
        Cloud.err = null;
        G.bus.emit('cloud');
        return true;
      })().catch((e) => { loading = null; Cloud.err = Cloud.errText(e); G.bus.emit('cloud'); throw e; });
    }
    return loading;
  };
  /** Google 登入（要在按鈕的點擊裡直接呼叫，彈出視窗才不會被擋） */
  Cloud.signIn = () => {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    return Cloud.auth.signInWithPopup(p);
  };
  Cloud.signOut = async () => {
    if (Cloud.auth) await Cloud.auth.signOut();
    Cloud.slots = {};
    Cloud.listed = false;
    Cloud.status = null;
    setPref({ signed: false });
    G.bus.emit('cloud');
  };
  const col = () => Cloud.db.collection('users').doc(Cloud.user.uid).collection('saves');

  /** 讀取 3 個欄位的摘要 */
  Cloud.refresh = async () => {
    if (!Cloud.user) return {};
    const snap = await timeout(col().get(), 15000);
    const out = {};
    snap.forEach((d) => {
      const x = d.data();
      out[d.id] = { meta: x.meta || {}, size: x.size || 0, at: x.updatedAt && x.updatedAt.toMillis ? x.updatedAt.toMillis() : 0 };
    });
    Cloud.slots = out;
    Cloud.listed = true;
    G.bus.emit('cloud');
    return out;
  };
  /** 存檔摘要（列在欄位上、用來判斷是不是同一局） */
  Cloud.metaOf = (s) => ({ gid: s.gid, mode: s.mode, chapter: s.chapter, won: !!s.won, time: s.time, money: Math.round(s.money), rating: Math.round(s.rating), emp: G.Q.employees(), ver: 1 });
  /** 把目前的遊戲存到某個欄位 */
  Cloud.upload = async (slot) => {
    const s = G.S;
    if (!Cloud.user) throw new Error('請先登入');
    if (!s) throw new Error('目前沒有進行中的遊戲');
    if (s.scen) throw new Error('情境挑戰不能存到雲端');
    const data = await Cloud.pack(JSON.stringify(s));
    if (data.length > MAX) throw new Error('存檔太大，無法上傳');
    const meta = Cloud.metaOf(s);
    await timeout(col().doc(slot).set({ v: 1, data, size: data.length, meta, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }), 20000, '上傳逾時：網路不穩，稍後再試');
    Cloud.slots[slot] = { meta, size: data.length, at: Date.now() };
    setPref({ slot });
    Cloud.last = { at: Date.now(), time: s.time, slot };
    Cloud.status = { kind: 'ok', text: `已同步到欄位 ${slot.slice(1)}（${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}）` };
    G.bus.emit('cloud');
  };
  /** 下載某個欄位的存檔（回傳整理過的遊戲狀態，還沒套用） */
  Cloud.download = async (slot) => {
    const snap = await timeout(col().doc(slot).get(), 20000, '下載逾時：網路不穩，稍後再試');
    if (!snap.exists) throw new Error('這個欄位是空的');
    const json = await Cloud.unpack(snap.data().data);
    const st = G.State.migrate(JSON.parse(json));
    if (!st) throw new Error('存檔格式不正確');
    return st;
  };
  Cloud.remove = async (slot) => {
    await timeout(col().doc(slot).delete(), 15000);
    delete Cloud.slots[slot];
    if (pref().slot === slot) setPref({ slot: null });
    G.bus.emit('cloud');
  };

  /* ---------- 自動同步 ---------- */
  let syncing = false, warned = false;
  Cloud.sync = async (why) => {
    const p = pref(), s = G.S;
    if (!Cloud.user || !p.auto || !p.slot || !s || s.scen || syncing) return;
    if (why !== 'chapter' && Cloud.last && Cloud.last.time === s.time) return;
    if (why === 'hide' && Cloud.last && Date.now() - Cloud.last.at < 60000) return;
    syncing = true;
    try {
      /* 上傳前再看一次欄位：是另一局、或雲端比較新（在別台玩過）就不蓋 */
      const snap = await timeout(col().doc(p.slot).get(), 15000);
      const m = snap.exists ? snap.data().meta || {} : null;
      if (m && m.gid && m.gid !== s.gid) {
        Cloud.status = { kind: 'warn', text: `自動同步暫停：欄位 ${p.slot.slice(1)} 存的是另一局遊戲。要保留這一局，請在「雲端存檔」選一個欄位上傳` };
      } else if (m && m.gid === s.gid && m.time > s.time + 30) {
        Cloud.status = { kind: 'warn', text: `自動同步暫停：雲端欄位 ${p.slot.slice(1)} 的進度（${U.dayLabel(m.time)} ${U.clock(m.time)}）比這台新` };
        if (!warned) { warned = true; G.bus.emit('notice', { kind: 'warn', text: '雲端有這一局比較新的進度：到「選單 → 雲端存檔」讀取' }); }
      } else await Cloud.upload(p.slot);
    } catch (e) {
      Cloud.status = { kind: 'bad', text: '自動同步失敗：' + Cloud.errText(e) };
    } finally {
      syncing = false;
      G.bus.emit('cloud');
    }
  };
  setInterval(() => { if (!Cloud.last || Date.now() - Cloud.last.at >= AUTO_MS) Cloud.sync('timer'); }, 60 * 1000);
  G.bus.on('chapter', (e) => { if (e.kind === 'done' || e.kind === 'start' || e.kind === 'won') Cloud.sync('chapter'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) Cloud.sync('hide'); });
  /* 登入過的話，開啟遊戲後在背景連上雲端（自動同步、檢查有沒有比較新的進度） */
  setTimeout(() => { if (pref().signed && Cloud.available()) Cloud.init().catch(() => {}); }, 1500);

  /* ---------- 介面 ---------- */
  const metaText = (m) => {
    if (!m) return '';
    const where = m.mode === 'sandbox' ? '沙盒模式' : m.won ? '劇情模式 · 全破' : `劇情模式 · 第 ${(m.chapter || 0) + 1} 章`;
    return `${where} · ${U.dayLabel(m.time || 0)} ${U.clock(m.time || 0)} · 預算 ${U.money(m.money || 0)} · 員工 ${U.num(m.emp || 0)}`;
  };
  const when = (ms) => {
    if (!ms) return '剛剛';
    const d = new Date(ms);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  /** 開始畫面：雲端有比較新的進度（或這台沒有存檔、雲端有）時提醒 */
  Cloud.titleNote = () => {
    const menu = document.querySelector('#title .menu');
    if (!menu) return;
    let el = menu.querySelector('.cloud-note');
    let text = null;
    if (Cloud.user && Cloud.listed) {
      const p = pref(), peek = G.State.peek();
      const x = p.slot && Cloud.slots[p.slot];
      if (x && peek && x.meta.gid === peek.gid && x.meta.time > peek.time) text = `雲端欄位 ${p.slot.slice(1)} 有這一局比較新的進度（${U.dayLabel(x.meta.time)} ${U.clock(x.meta.time)}）`;
      else if (!peek && Object.keys(Cloud.slots).length) text = '雲端有你的存檔';
    }
    if (!text) { if (el) el.remove(); return; }
    if (!el) { el = h('div', { class: 'note info small cloud-note' }); menu.prepend(el); }
    U.mount(el, h('span', {}, text), h('button', { class: 'btn primary xs', style: { marginLeft: '8px' }, onclick: () => G.UI.cloud() }, '打開雲端存檔'));
  };
  G.bus.on('cloud', () => Cloud.titleNote());

  /** 雲端存檔的對話框 */
  G.UI.cloud = () => {
    const UI = G.UI;
    const body = h('div', { class: 'col cloud', style: { gap: '10px' } });
    let busy = '';
    const act = async (label, fn) => {
      busy = label;
      draw();
      try { await fn(); } catch (e) { UI.toast(Cloud.errText(e), 'bad', { ms: 6000 }); }
      busy = '';
      draw();
    };
    const upload = (k) => {
      const x = Cloud.slots[k], s = G.S;
      const go = () => act('上傳', async () => { await Cloud.upload(k); UI.toast(`已存到雲端欄位 ${k.slice(1)}`, 'ok'); });
      if (x && x.meta.gid !== s.gid) UI.confirm('覆寫雲端存檔', `欄位 ${k.slice(1)} 存的是另一局遊戲（${metaText(x.meta)}）。要用目前的進度覆寫嗎？覆寫後就找不回來了。`, '覆寫', go, 'danger');
      else if (x && x.meta.time > s.time) UI.confirm('覆寫比較新的進度', `欄位 ${k.slice(1)} 的進度（${U.dayLabel(x.meta.time)} ${U.clock(x.meta.time)}）比目前的遊戲還新，確定要覆寫嗎？`, '覆寫', go, 'danger');
      else go();
    };
    const load = (k) => {
      const go = () => act('讀取', async () => {
        const st = await Cloud.download(k);
        entry.close();
        G.Engine.boot(st);
        G.State.save(st);
        UI.hideTitle();
        UI.build();
        setPref({ slot: k });
        Cloud.last = { at: Date.now(), time: st.time, slot: k };
        Cloud.status = { kind: 'ok', text: `已讀取欄位 ${k.slice(1)}，之後會自動同步到這一格` };
        UI.toast(`已讀取雲端欄位 ${k.slice(1)}`, 'ok');
        if (st.gameOver) UI.gameOver(st.gameOver);
      });
      if (G.State.hasSave()) UI.confirm('讀取雲端存檔', '這台電腦上的遊戲進度會換成雲端的這一格（本機存檔會被取代）。確定要讀取嗎？', '讀取', go);
      else go();
    };
    const del = (k) => UI.confirm('刪除雲端存檔', `刪除欄位 ${k.slice(1)}？刪除後無法復原。`, '刪除', () => act('刪除', () => Cloud.remove(k)), 'danger');
    const draw = () => {
      U.clear(body);
      if (!Cloud.configured()) { body.appendChild(h('div', { class: 'note warn' }, '這個版本沒有設定雲端存檔。')); return; }
      if (!Cloud.available()) { body.appendChild(h('div', { class: 'note warn' }, '直接開啟 index.html 時不能使用雲端存檔：請從網址開啟遊戲（例如 GitHub Pages）。')); return; }
      if (!Cloud.ready) {
        body.appendChild(Cloud.err ? h('div', { class: 'note bad' }, Cloud.err, h('button', { class: 'btn xs', style: { marginLeft: '8px' }, onclick: () => { Cloud.err = null; draw(); Cloud.init().catch(() => {}); } }, '再試一次'))
          : h('div', { class: 'small muted' }, '連線到雲端中…'));
        return;
      }
      if (!Cloud.user) {
        body.append(
          h('p', {}, '用 Google 帳號登入，就能把進度存到雲端，在別台電腦或手機接著玩。'),
          h('button', { class: 'btn primary', 'data-hint': 'cloud-signin', style: { alignSelf: 'flex-start' }, onclick: () => {
            Cloud.signIn().then(() => UI.toast('已登入雲端存檔', 'ok')).catch((e) => UI.toast(Cloud.errText(e), 'bad', { ms: 7000 }));
          } }, '用 Google 登入'),
          h('p', { class: 'small dim' }, '只會存遊戲進度（每個帳號 3 格）。Google 帳號只用來辨識是誰的存檔。'));
        return;
      }
      const u = Cloud.user, p = pref(), s = G.S;
      body.appendChild(h('div', { class: 'row between wrap' },
        h('span', { class: 'small' }, '已登入：', h('b', {}, u.displayName || u.email || 'Google 帳號'), u.email && u.displayName ? h('span', { class: 'muted' }, `　${u.email}`) : null),
        h('button', { class: 'btn ghost xs', disabled: !!busy || null, onclick: () => act('登出', Cloud.signOut) }, '登出')));
      if (!Cloud.listed) { body.appendChild(h('div', { class: 'small muted' }, '讀取雲端存檔中…')); return; }
      const canUp = !!s && !s.scen && !!document.getElementById('app') && !document.getElementById('title');
      for (const k of SLOTS) {
        const x = Cloud.slots[k];
        const linked = p.slot === k;
        const same = !!x && !!s && x.meta.gid === s.gid;
        body.appendChild(h('div', { class: 'tile cloud-slot' + (linked ? ' on' : '') },
          h('div', { class: 'row between' }, h('b', {}, `欄位 ${k.slice(1)}`), linked ? h('span', { class: 'chip accent' }, p.auto ? '自動同步中' : '已連結') : null),
          h('div', { class: 'small' + (x ? '' : ' muted') }, x ? metaText(x.meta) : '（空的）'),
          x ? h('div', { class: 'tiny dim' }, `上傳時間 ${when(x.at)}${same ? ' · 和目前的遊戲是同一局' : ''}`) : null,
          h('div', { class: 'row wrap', style: { marginTop: '6px' } },
            h('button', { class: 'btn sm primary', 'data-hint': 'cloud-up:' + k, disabled: !canUp || !!busy || null, title: canUp ? '' : '進入遊戲後才能上傳', onclick: () => upload(k) }, '上傳目前進度'),
            h('button', { class: 'btn sm', 'data-hint': 'cloud-load:' + k, disabled: !x || !!busy || null, onclick: () => load(k) }, '讀取'),
            x ? h('button', { class: 'btn sm ghost', disabled: !!busy || null, onclick: () => del(k) }, '刪除') : null)));
      }
      body.appendChild(h('label', { class: 'row small', style: { gap: '6px' } },
        h('input', { type: 'checkbox', checked: p.auto || null, onchange: (e) => { setPref({ auto: e.target.checked }); draw(); } }),
        '自動同步到連結的欄位（每 5 分鐘、章節開始與完成、離開頁面時）'));
      if (busy) body.appendChild(h('div', { class: 'small muted' }, `${busy}中…`));
      else if (Cloud.status) body.appendChild(h('div', { class: 'small ' + ({ ok: 'ok-t', warn: 'warn-t', bad: 'bad-t' }[Cloud.status.kind] || 'muted') }, Cloud.status.text));
      if (!p.slot && s && !s.scen) body.appendChild(h('div', { class: 'tiny dim' }, '選一格「上傳目前進度」後，這一局就會連結到那一格並自動同步。'));
    };
    const off = G.bus.on('cloud', draw);
    const entry = UI.modal({ kicker: 'Google 帳號', title: '雲端存檔', body, blocking: true, onClose: () => off() });
    draw();
    Cloud.init().then(() => { if (Cloud.user && !Cloud.listed) return Cloud.refresh(); }).catch(() => draw());
  };
})(window.G = window.G || {});
