/* Sysmex TS Guide — Service Worker (build_mobile.py 가 생성한다. 직접 고치지 않는다) */
var VERSION = 'enc-0883f1e9-20260821-236247f8-f80416';
var SHELL_CACHE = 'ts-shell-' + VERSION;
var DATA_CACHE = 'ts-data-' + VERSION;
var SHELL = ["./", "./index.html", "./css/app.css", "./js/app.js", "./manifest.webmanifest", "./fonts/brand.woff2", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];
var DATA = ["./data/devices.json.enc", "./data/search-index.json.enc", "./data/device/XN.json.enc", "./data/device/XN-L.json.enc", "./data/device/CN.json.enc", "./data/device/SP-50.json.enc", "./data/device/UF.json.enc", "./data/device/UC.json.enc", "./data/device/HISCL.json.enc", "./data/device/G11.json.enc", "./data/device/TS-10.json.enc", "./data/device/CS-1600.json.enc", "./data/device/CA-620.json.enc", "./data/cases/XN.json.enc", "./data/cases/XN-L.json.enc", "./data/cases/CN.json.enc", "./data/cases/SP-50.json.enc", "./data/cases/UF.json.enc", "./data/cases/UC.json.enc", "./data/cases/HISCL.json.enc", "./data/cases/G11.json.enc", "./data/cases/TS-10.json.enc", "./data/pm.json.enc", "./data/_auth.json"];
var EXTRA = ["./img/diag/CN_anerroroccurredinejectionfro.webp", "./img/diag/CN_anerroroccurredinthehydrauli.webp", "./img/diag/CN_anerroroccurredintheoperatio.webp", "./img/diag/CN_anerroroccurredwhilefeedingw.webp", "./img/diag/CN_arackisremainingintheanalysi.webp", "./img/diag/CN_the0055mpapressureiserroneou.webp", "./img/diag/CN_the0230mpapressureiserroneou.webp", "./img/diag/HISCL_pressureerror0033mpanegative.webp", "./img/diag/HISCL_pressureerror0053mpanegative.webp", "./img/diag/HISCL_r2reagentarmerror134.webp", "./img/diag/HISCL_r2reagentarmerror135.webp", "./img/diag/SP-50_004mpapressureerror.webp", "./img/diag/SP-50_chambermoveerror.webp", "./img/diag/SP-50_outofstainsolution1.webp", "./img/diag/SP-50_slideconveyorrlmotorerrorsme.webp", "./img/diag/SP-50_staininghand1lrmotorerror.webp", "./img/diag/SP-50_staininghand1udmotorerror.webp", "./img/diag/SP-50_staininghand2udmotorerror.webp", "./img/diag/SP-50_stainingpoolnotsetcorrectly.webp", "./img/diag/SP-50_waterleakdetected.webp", "./img/diag/SP-50_waterleakdetectedpreparation.webp", "./img/diag/SP-50_x.webp", "./img/diag/UC_flowcelloverflow.webp", "./img/diag/UC_samplerpressureerr.webp", "./img/diag/UC_samplingpumpmotor.webp", "./img/diag/UC_washingsolutionempty.webp", "./img/diag/UF_005mpapressureerror.webp", "./img/diag/UF_024mpapressureerror.webp", "./img/diag/UF_abnormalpressureloss.webp", "./img/diag/UF_data.webp", "./img/diag/UF_mixingaspirationunitprobecra.webp", "./img/diag/UF_mixingmotormbrspeederror.webp", "./img/diag/UF_outofufcellsheath.webp", "./img/diag/UF_shortsampledespensing.webp", "./img/diag/UF_shortsampledispensing.webp", "./img/diag/UF_shortsamplemixing.webp", "./img/diag/UF_ufcellsheathaspirationerrorr.webp", "./img/diag/UF_vacuumpressureerror.webp", "./img/diag/UF_wastechamber2drainerror.webp", "./img/diag/UF_waterleakdetected.webp", "./img/diag/XN-L_hgberror.webp", "./img/diag/XN-L_insufficientbloodvolumeshort.webp", "./img/diag/XN-L_rbchgbchambernotdraining.webp", "./img/diag/XN-L_rbcsheathfluidaspirationerro.webp", "./img/diag/XN-L_wastechamber1notdraining.webp", "./img/diag/XN-L_wdfsamplingerror.webp", "./img/diag/XN_004mpapressureerror.webp", "./img/diag/XN_007mpapressureerror.webp", "./img/diag/XN_bloodcannotbeaspirated.webp", "./img/diag/XN_fcmsheathmotorerror.webp", "./img/diag/XN_handupdownerror.webp", "./img/diag/XN_hgberror.webp", "./img/diag/XN_insufficientbloodvolumeshort.webp", "./img/diag/XN_piercerreplacementisrequired.webp", "./img/diag/XN_pltsamplingerror.webp", "./img/diag/XN_rbcdetectorclog.webp", "./img/diag/XN_rbchgbchambernotdraining.webp", "./img/diag/XN_rbcsamplingerror.webp", "./img/diag/XN_rbcsheathfluidaspirationerro.webp", "./img/diag/XN_tubeholdermoveerror.webp", "./img/diag/XN_tubepickuperror.webp", "./img/diag/XN_wastechamber1notdraining.webp", "./img/diag/XN_wastechamber2notdraining.webp", "./img/diag/XN_waterleakdetected.webp", "./img/diag/XN_wdfsamplingerror.webp", "./img/diag/XN_wdfscattergramsensitivityerr.webp", "./img/diag/XN_wnrsamplingerror.webp"];   // 도면 — '오프라인 전체 저장' 때만 받는다

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
    // 도면(EXTRA)도 함께 받는다. 도면을 볼 자리는 대개 전파가 나쁜 현장이다.
    var done = 0, total = DATA.length + EXTRA.length;
    Promise.all([caches.open(DATA_CACHE), caches.open(SHELL_CACHE)]).then(function (cs) {
      var jobs = DATA.map(function (u) { return [cs[0], u]; })
                     .concat(EXTRA.map(function (u) { return [cs[1], u]; }));
      return Promise.all(jobs.map(function (j) {
        return fetch(j[1], { cache: 'reload' }).then(function (r) {
          if (r && r.ok) return j[0].put(j[1], r);
        }).catch(function () {}).then(function () {
          done++;
          if (e.source) e.source.postMessage({ type: 'PRECACHE', done: done, total: total });
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
