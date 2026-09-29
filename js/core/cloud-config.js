/* 雲端存檔的 Firebase 設定（js/ui/cloud.js 使用）
 * 這些是 Firebase 網頁應用程式的公開識別碼，本來就會出現在網頁裡；存檔資料的安全由 Firestore 規則（firestore.rules）保護。
 * 自己架設這個遊戲時：換成自己 Firebase 專案的設定；留 null 就不會出現雲端存檔的功能。
 */
(function (G) {
  'use strict';
  G.CLOUD_CONFIG = {
    apiKey: 'AIzaSyAnJaiXGN7VT9WDAu285Elm0RMiLjf1cYs',
    authDomain: 'infraops-save.firebaseapp.com',
    projectId: 'infraops-save',
    storageBucket: 'infraops-save.firebasestorage.app',
    messagingSenderId: '811922832273',
    appId: '1:811922832273:web:b8dae503a7e67be5a63830',
  };
})(window.G = window.G || {});
