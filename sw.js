/* Sysmex TS Guide — Service Worker (build_mobile.py 가 생성한다. 직접 고치지 않는다) */
var VERSION = 'enc-0883f1e9-20260820-fad0b7b5-e7596b';
var SHELL_CACHE = 'ts-shell-' + VERSION;
var DATA_CACHE = 'ts-data-' + VERSION;
var SHELL = ["./", "./index.html", "./css/app.css", "./js/app.js", "./manifest.webmanifest", "./fonts/brand.woff2", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];
var DATA = ["./data/devices.json.enc", "./data/search-index.json.enc", "./data/device/XN.json.enc", "./data/device/XN-L.json.enc", "./data/device/CN.json.enc", "./data/device/SP-50.json.enc", "./data/device/UF.json.enc", "./data/device/UC.json.enc", "./data/device/HISCL.json.enc", "./data/device/G11.json.enc", "./data/device/TS-10.json.enc", "./data/cases/XN.json.enc", "./data/cases/XN-L.json.enc", "./data/cases/CN.json.enc", "./data/cases/SP-50.json.enc", "./data/cases/UF.json.enc", "./data/cases/UC.json.enc", "./data/cases/HISCL.json.enc", "./data/cases/G11.json.enc", "./data/cases/TS-10.json.enc", "./data/pm.json.enc", "./data/_auth.json"];

self.addEventListener('install', function (e) {
  // 앱 껍데기 + 첫 화면 데이터만 먼저 받는다 (설치가 빨리 끝나도록)
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function (c) {
      return c.addAll(SHELL.concat(DATA.slice(0, 2)));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== DATA_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      if (hit) {
        // 캐시로 먼저 응답하고, 온라인이면 조용히 갱신해 둔다
        fetch(e.request).then(function (res) {
          if (res && res.ok) {
            caches.open(res.url.indexOf('/data/') >= 0 ? DATA_CACHE : SHELL_CACHE)
              .then(function (c) { c.put(e.request, res.clone()); });
          }
        }).catch(function () {});
        return hit;
      }
      return fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var clone = res.clone();
          caches.open(e.request.url.indexOf('/data/') >= 0 ? DATA_CACHE : SHELL_CACHE)
            .then(function (c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});

/* 앱에서 보내는 명령 */
self.addEventListener('message', function (e) {
  var msg = e.data || {};
  if (msg.type === 'PRECACHE_ALL') {
    // 오프라인용 전체 저장 — 진행 상황을 앱에 알려 준다
    var done = 0;
    caches.open(DATA_CACHE).then(function (c) {
      return Promise.all(DATA.map(function (u) {
        return fetch(u, { cache: 'reload' }).then(function (r) {
          if (r && r.ok) return c.put(u, r);
        }).catch(function () {}).then(function () {
          done++;
          if (e.source) e.source.postMessage({ type: 'PRECACHE', done: done, total: DATA.length });
        });
      }));
    }).then(function () {
      if (e.source) e.source.postMessage({ type: 'PRECACHE_DONE', version: VERSION });
    });
  }
  if (msg.type === 'VERSION') {
    if (e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
  }
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
});
