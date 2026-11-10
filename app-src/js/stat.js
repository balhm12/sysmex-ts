/* 실마리 — 사용량 세기 (익명)
 *
 * 무엇을 세나
 *   · 열어 본 기기 수와 횟수
 *   · 어느 장비의 어느 Error 를 열어 봤는지
 *
 * 무엇을 세지 않나 (일부러)
 *   · 누구인지 — 이름·사번·메일·IP 를 보내지 않는다. 기기마다 임의의 번호를
 *     하나 만들어 '몇 명'만 셀 수 있게 한다. 그 번호로 사람을 되짚을 수 없다.
 *   · 검색어 · 작업 기록 · 거래처 — 아예 보내지 않는다.
 *   · 시각 — 날짜까지만 남긴다. 쓰는 사람이 열 명 남짓이라 분 단위 시각이
 *     남으면 '누가 언제' 가 드러날 수 있다.
 *
 * 왜 이렇게 하나
 *   동료가 쓰는 도구다. 감시로 읽히면 안 쓰게 된다. '무엇이 많이 쓰이는지'
 *   만 보고 다음에 무엇을 보강할지 정하는 것이 목적이다.
 *
 * 어디에 쌓나
 *   Firebase Realtime Database (REST). ENDPOINT 가 비어 있으면 **아무것도
 *   하지 않는다** — 통째로 꺼진다. 배포 전에 한 줄만 채우면 켜진다.
 *
 * 왜 '더하기' 가 아니라 '한 줄씩 쌓기' 인가
 *   RTDB REST 에는 원자적 증가가 없다. 읽어서 +1 해 쓰면 두 사람이 같은
 *   순간에 볼 때 하나가 사라진다. POST 는 서버가 키를 만들어 주므로 절대
 *   부딪히지 않는다. 세는 일은 나중에 Apps Script 가 한다.
 */
'use strict';

var STAT = (function () {
  /* ── 쌓는 곳 ──────────────────────────────────────────────
     비워 두면 통계 기능 전체가 꺼진 채로 돈다 (네트워크 호출 없음).
     끝의 '/' 는 떼어 낸다 — 붙어 있으면 '//stat/...' 가 되어 경로가 어긋난다. */
  var ENDPOINT = 'https://silmari-ts-default-rtdb.asia-southeast1.firebasedatabase.app'
                 .replace(/\/+$/, '');

  var AID_KEY = 'ts-aid';        // 기기 번호 (익명)
  var Q_KEY = 'ts-statq';        // 못 보낸 것 (오프라인)
  var DAY_KEY = 'ts-statday';    // '오늘 열었음' 을 하루 한 번만 세기 위해
  var MAX_Q = 300;               // 큐 상한 — 오래 오프라인이어도 저장소를 안 먹게
  var sending = false;

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
           '-' + ('0' + d.getDate()).slice(-2);
  }

  /* 기기 번호 — 임의의 16자리. 사람과 이어지는 정보가 하나도 안 들어간다. */
  function aid() {
    var v = null;
    try { v = localStorage.getItem(AID_KEY); } catch (e) { return 'x'; }
    if (v) return v;
    var b = new Uint8Array(8);
    (window.crypto || window.msCrypto).getRandomValues(b);
    v = Array.prototype.map.call(b, function (x) {
      return ('0' + x.toString(16)).slice(-2);
    }).join('');
    try { localStorage.setItem(AID_KEY, v); } catch (e) { /* 무시 */ }
    return v;
  }

  function queue() {
    try { return JSON.parse(localStorage.getItem(Q_KEY) || '[]'); } catch (e) { return []; }
  }

  function setQueue(a) {
    try { localStorage.setItem(Q_KEY, JSON.stringify(a.slice(-MAX_Q))); } catch (e) { /* 무시 */ }
  }

  function add(ev) {
    if (!ENDPOINT) return;
    var a = queue();
    a.push(ev);
    setQueue(a);
    flush();
  }

  /* 쌓인 것을 한 번에 보낸다. 실패하면 큐에 그대로 두고 다음에 다시 시도한다.
     현장은 전파가 나쁜 곳이 많아 '보내다 실패하면 버린다' 로 하면 안 된다. */
  function flush() {
    if (!ENDPOINT || sending) return;
    if (navigator.onLine === false) return;
    var a = queue();
    if (!a.length) return;
    sending = true;
    var batch = a.slice(0, 100);
    fetch(ENDPOINT + '/stat/' + batch[0].t + '.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: aid(), t: batch[0].t, v: batch })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      setQueue(queue().slice(batch.length));
      sending = false;
      if (queue().length) flush();
    }).catch(function () {
      sending = false;             // 큐는 건드리지 않는다 — 다음 기회에 다시
    });
  }

  return {
    /* 앱을 연 날 — 하루 한 번만 센다 (여닫이를 반복해도 1) */
    open: function (ver) {
      if (!ENDPOINT) return;         // 꺼져 있으면 저장소도 건드리지 않는다
      var d = today(), last = null;
      try { last = localStorage.getItem(DAY_KEY); } catch (e) { /* 무시 */ }
      if (last === d) { flush(); return; }
      try { localStorage.setItem(DAY_KEY, d); } catch (e) { /* 무시 */ }
      add({ k: 'open', t: d, v: String(ver || '') });
    },
    /* Error 상세를 열었을 때 — 장비와 Error 이름만 */
    view: function (dev, name) {
      add({ k: 'view', t: today(), d: String(dev || ''), e: String(name || '').slice(0, 80) });
    },
    on: function () { return !!ENDPOINT; },
    flush: flush
  };
})();

window.addEventListener('online', function () { STAT.flush(); });
