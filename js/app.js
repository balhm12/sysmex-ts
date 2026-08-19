/* 실마리 (Sysmex TS Guide) — Mobile (Phase 1)
 *
 * 원칙
 *  · 데이터는 build_mobile.py 가 만든 JSON 만 읽는다. UI 는 통계를 만들지 않는다.
 *  · 전체 Error 상세를 미리 DOM 에 만들지 않는다. 선택한 것만 렌더한다.
 *  · CRM(현장)과 S/M(공식)은 섹션·색·배지를 달리해 절대 섞지 않는다.
 *  · Interactive 분기는 Phase 2 이후. 여기서는 steps[] 를 체크리스트로만 보여 준다.
 *  · 호스팅 경로를 코드에 넣지 않는다 (전부 상대 경로).
 */
'use strict';

var DATA = 'data/';
var META = null;              // devices.json
var INDEX = null;             // search-index.json (rows) — 첫 화면 뒤에 읽는다
var INDEXP = null;
var CACHE = {};               // device/<id>.json 1회 로드 후 보관
var CASES = {};               // cases/<id>.json — "더 보기" 를 눌렀을 때만 받는다
var CBOX = null;              // 지금 화면에 열려 있는 사례 묶음 (필터용)
var RECENT_KEY = 'sysmex-ts-recent';

var $ = function (s, r) { return (r || document).querySelector(s); };
var SW = null;                // Service Worker 등록 결과
var view = $('#view'), qEl = $('#q'), qx = $('#qx'), backEl = $('#back'),
    homeEl = $('#home');
var titleEl = $('#title'), subEl = $('#sub'), boot = $('#boot');

/* ── 유틸 ─────────────────────────────────────────── */
function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
/* 데이터에는 <b> 만 들어 있다 (build_simple 과 같은 규칙) */
function rich(t) { return esc(t).replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>'); }
function num(n) { return (n || 0).toLocaleString('ko-KR'); }

function unzipB64(b64) {
  // gzip 을 base64 로 넣어 둔 블록을 푼다 (단일 파일 빌드 전용)
  var bin = atob(b64), n = bin.length, buf = new Uint8Array(n), i;
  for (i = 0; i < n; i++) buf[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === 'undefined') {
    return Promise.reject(new Error('이 브라우저는 압축 해제를 지원하지 않습니다'));
  }
  var ds = new DecompressionStream('gzip');
  var stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Response(stream).json();
}

/* ── 잠금 ─────────────────────────────────────────────
   정적 호스팅에는 서버가 없다. 화면만 가리는 비밀번호는 파일을 직접 받으면
   그냥 뚫리므로, 데이터 자체를 잠가 두고 여기서 푼다.
   비밀번호 → PBKDF2 → 키. 키는 서버로 나가지 않는다. */
var AUTH = null;          // _auth.json (salt·반복수·확인용 조각). 없으면 잠그지 않은 빌드
var KEY = null;           // CryptoKey — 이 화면에서만 산다
var KEY_STORE = 'sysmex-ts-key';

function b64buf(s) {
  var bin = atob(s), n = bin.length, b = new Uint8Array(n), i;
  for (i = 0; i < n; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function bufb64(b) {
  var s = '', a = new Uint8Array(b), i;
  for (i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}

function deriveKey(pw) {
  var enc = new TextEncoder();
  return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey'])
    .then(function (base) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: b64buf(AUTH.salt), iterations: AUTH.iter, hash: 'SHA-256' },
        base, { name: 'AES-GCM', length: 256 }, true, ['decrypt']);
    });
}

function openSealed(key, buf) {
  var a = new Uint8Array(buf);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, key, a.slice(12));
}

function checkKey(key) {
  return openSealed(key, b64buf(AUTH.verify).buffer)
    .then(function () { return true; }, function () { return false; });
}

/* 현장에서 매번 치게 하면 쓰지 않게 된다. 이 기기에 키를 넣어 두되 기한을 준다. */
function rememberKey(key) {
  return crypto.subtle.exportKey('raw', key).then(function (raw) {
    try {
      localStorage.setItem(KEY_STORE, JSON.stringify(
        { k: bufb64(raw), until: Date.now() + 30 * 864e5, salt: AUTH.salt }));
    } catch (e) { /* 저장 못 해도 이번 세션은 돈다 */ }
  });
}

function recallKey() {
  var s;
  try { s = JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); } catch (e) { return null; }
  if (!s || s.until < Date.now() || s.salt !== AUTH.salt) return null;   // 비밀번호가 바뀌면 salt 가 바뀐다
  return crypto.subtle.importKey('raw', b64buf(s.k), 'AES-GCM', true, ['decrypt']);
}

function forgetKey() {
  try { localStorage.removeItem(KEY_STORE); } catch (e) { /* 무시 */ }
}

function getJSON(path) {
  // 단일 파일 빌드: 데이터가 문서 안에 들어 있다.
  // 문서에 박혀 있어도 여기서 부르기 전까지는 파싱 비용이 들지 않는다.
  var z = document.getElementById('tsz:' + path);
  if (z) return unzipB64(z.textContent.trim());
  var el = document.getElementById('ts:' + path);
  if (el) {
    return new Promise(function (ok, no) {
      try { ok(JSON.parse(el.textContent)); } catch (e) { no(e); }
    });
  }
  if (AUTH && KEY) {
    return fetch(DATA + path + '.enc', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      return openSealed(KEY, buf);
    }).then(function (raw) {
      // 잠그기 전에 gzip 으로 줄여 두었다 (암호문은 압축이 안 되므로 순서가 그렇다)
      if (!AUTH.gz) return JSON.parse(new TextDecoder().decode(raw));
      return new Response(new Blob([raw]).stream()
        .pipeThrough(new DecompressionStream('gzip'))).json();
    });
  }
  return fetch(DATA + path, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  });
}

function recall() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; }
}
function remember(q) {
  if (!q || q.length < 2) return;
  try {
    var a = recall().filter(function (x) { return x !== q; });
    a.unshift(q);
    localStorage.setItem(RECENT_KEY, JSON.stringify(a.slice(0, 8)));
  } catch (e) { /* 사파리 프라이빗 모드 등 — 저장 못 해도 앱은 돈다 */ }
}

function devOf(id) {
  for (var i = 0; i < META.devices.length; i++) {
    if (META.devices[i].id === id) return META.devices[i];
  }
  return null;
}

function loadDevice(id) {
  if (CACHE[id]) return Promise.resolve(CACHE[id]);
  var d = devOf(id);
  if (!d) return Promise.reject(new Error('unknown device ' + id));
  return getJSON(d.file).then(function (j) { CACHE[id] = j; return j; });
}

/* ── 검색 ─────────────────────────────────────────── */
/* 신호 세기 순으로 점수를 준다 — 코드 완전일치 > 제목 > 부품·조치 > 매뉴얼 본문.
   순위 규칙은 여기 한 곳에만 있고, 근거 필드는 인덱스가 제공한다. */
function score(row, q) {
  var i, c;
  for (i = 0; i < row.c.length; i++) {
    c = String(row.c[i]).toLowerCase();
    if (c === q) return 1000;
    if (c.indexOf(q) === 0) return 900;
  }
  var k1 = row.k1 || '';
  if (k1.indexOf(q) === 0) return 800;
  if ((' ' + k1).indexOf(' ' + q) >= 0) return 700;
  if (k1.indexOf(q) >= 0) return 600;
  var k2 = row.k2 || '';
  if ((' ' + k2).indexOf(' ' + q) >= 0) return 400;
  if (k2.indexOf(q) >= 0) return 300;
  var k3 = row.k3 || '';
  if (k3.indexOf(q) >= 0) return 100;
  return 0;
}

function ensureIndex() {
  if (!INDEXP) {
    INDEXP = getJSON('search-index.json').then(function (j) {
      INDEX = j.rows;
      return INDEX;
    });
  }
  return INDEXP;
}

function search(q, devFilter, limit) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  var out = [], i, s, r;
  for (i = 0; i < INDEX.length; i++) {
    r = INDEX[i];
    if (devFilter && r.d !== devFilter) continue;
    s = score(r, q);
    if (s) out.push({ s: s, r: r });
  }
  out.sort(function (a, b) {
    if (b.s !== a.s) return b.s - a.s;
    if (a.r.p !== b.r.p) return a.r.p - b.r.p;   // Part 1(사람이 쓴 것) 우선
    return b.r.n - a.r.n;                        // 그다음 발생 건수
  });
  return out.slice(0, limit || 60).map(function (x) { return x.r; });
}

/* ── 조각 렌더 ─────────────────────────────────────── */
function rowHTML(r) {
  var codes = (r.c && r.c.length) ? r.c.slice(0, 2).join(' / ') : '';
  var tags = '<span class="tag dv">' + esc(r.d) + '</span>';
  tags += codes ? '<span class="tag cd">' + esc(codes) + '</span>'
                : '<span class="tag no">코드 없음</span>';
  if (r.r != null) {
    tags += '<span class="tag rc' + (r.r >= 55 ? ' hi' : '') + '">재발 ' + r.r + '%</span>';
  }
  if (r.p === 2) tags += '<span class="tag p2">전체</span>';
  // 한 번에 안 잡힌 건이 있는 Error — 목록에서 바로 알아보게
  if (r.sp) tags += '<span class="tag sp">스페셜 ' + r.sp + '</span>';
  return '<button class="row" data-go="' + r.d + '/' + r.p + '/' + r.i + '">' +
    '<span class="r1"><span class="t">' + esc(r.t) + '</span>' +
    '<span class="n">' + num(r.n) + '건</span></span>' +
    '<span class="r2">' + tags +
    (r.cz ? '<span class="cz">' + esc(r.cz) + '</span>' : '') +
    '</span></button>';
}

function listHTML(rows, emptyMsg) {
  if (!rows.length) return '<div class="card"><div class="empty">' + esc(emptyMsg) + '</div></div>';
  return '<div class="card rows">' + rows.map(rowHTML).join('') + '</div>';
}

/* ── 화면 1: Home ─────────────────────────────────── */
function renderHome() {
  titleEl.innerHTML = '실마리 <span class="en">Sysmex TS Guide</span>';
  subEl.textContent = META.devices.length + '개 장비 · 데이터 ' + META.v;
  backEl.hidden = true;
  homeEl.hidden = true;

  var devs = META.devices.map(function (d) {
    return '<button class="dev" data-dev="' + d.id + '"><b>' + esc(d.name) + '</b>' +
      '<i>' + d.counts.p1 + ' + ' + d.counts.p2 + '</i></button>';
  }).join('');

  var rec = recall();
  var recHTML = rec.length
    ? '<div class="sec"><h2>최근 검색</h2><div class="recent">' +
      rec.map(function (q) {
        return '<button data-q="' + esc(q) + '">' + esc(q) + '</button>';
      }).join('') + '</div></div>'
    : '';

  var hot = (META.hot || []).map(function (h) {
    return rowHTML({ d: h.d, p: h.p, i: h.i, t: h.en, c: h.c, n: h.n, r: h.r, cz: '' });
  }).join('');

  // PM(정기 점검)은 수리(TS)와 다른 업무다 — 구역을 나눠 섞이지 않게 둔다
  var pmCard = META.pm
    ? '<div class="sec pmsec"><h2>정기 점검 (PM)</h2>' +
      '<button class="pmgo" data-go-pm="1">' +
      '<b>PM 후 확인 체크리스트 <span class="tst">TEST</span></b>' +
      '<i>PM 직후에 실제로 터지는 곳만 · 체크 후 PDF·엑셀 출력</i></button>' +
      '<p class="muted">수리(TS)와는 별개 업무입니다. 위쪽은 고장 수리용, ' +
      '여기는 정기 점검용입니다.</p></div>'
    : '';

  view.innerHTML =
    '<p class="tagline home">막혔을 때, 해결의 <b>실마리</b>를 찾다</p>' +
    '<div class="sec"><h2>수리 (TS) — 장비를 고르십시오</h2>' +
    '<div class="devs">' + devs + '</div></div>' +
    recHTML +
    '<div class="sec"><h2>자주 발생하는 Error</h2>' +
    '<div class="card rows">' + hot + '</div>' +
    '<p class="muted">발생 건수 기준 상위입니다. 장비를 고르면 그 장비의 전체 목록이 나옵니다.</p></div>' +
    pmCard + offlineCardHTML();
}

/* ── 화면 5: PM 후 확인 체크리스트 ──────────────────────
   현장에서 체크하고 그대로 PDF(인쇄)·엑셀(CSV)로 내보낸다.
   진행 중 앱을 닫아도 남도록 localStorage 에 저장한다. */
var PM = null, PM_KEY = 'sysmex-ts-pm';

function pmState() {
  try { return JSON.parse(localStorage.getItem(PM_KEY) || 'null') || {}; }
  catch (e) { return {}; }
}
function pmSave(s) {
  try { localStorage.setItem(PM_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ }
}

function renderPM() {
  titleEl.textContent = 'PM 후 확인';
  subEl.textContent = 'TEST · 정기 점검 (수리와 별개)';
  backEl.hidden = false; homeEl.hidden = false;
  view.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';

  getJSON('pm.json').then(function (j) {
    PM = j;
    var s = pmState();
    var head = ['model', 'serial', 'fac', 'date', 'eng'];
    var lab = { model: 'Model', serial: 'Serial No.', fac: '기관',
                date: 'PM 일자', eng: '담당 엔지니어' };
    var hin = head.map(function (k) {
      return '<label class="pmf"><span>' + lab[k] + '</span>' +
        '<input id="pf_' + k + '" type="' + (k === 'date' ? 'date' : 'text') +
        '" value="' + esc(s['h_' + k] || '') + '"></label>';
    }).join('');

    var rows = j.items.map(function (it, i) {
      var acts = it.acts.map(function (a) {
        var id = 'pm' + i + '_' + a;
        var on = s[id] ? ' on' : '';
        return '<label class="act' + on + '"><input type="checkbox" data-pm="' + id +
          '"' + (s[id] ? ' checked' : '') + '><span>' + esc(a) + '</span></label>';
      }).join('');
      // 표준 체크리스트 항목명은 원문 그대로 (묶음 → 항목)
      var std = (it.rows || []).map(function (x) {
        return '<li>' + esc(x) + '</li>';
      }).join('');
      var parts = (it.parts || []).map(function (pp) {
        return '<div class="pp"><span class="pn">' + esc(pp.pn) + '</span>' +
          esc(pp.name) + '<i>' + esc(pp.when) + '</i></div>';
      }).join('');
      return '<div class="pmi"><div class="pmh"><span class="no">' + (i + 1) + '</span>' +
        '<b>' + esc(it.group) + '</b>' +
        '<span class="tag sp">' + it.x + '배</span></div>' +
        (std ? '<ul class="std">' + std + '</ul>' : '') +
        (parts ? '<div class="parts"><h5>교체 부품</h5>' + parts + '</div>' : '') +
        '<p class="how">' + esc(it.how) + '</p>' +
        '<p class="dim">PM 직후에 나는 Error — ' + esc(it.err) + '</p>' +
        '<div class="acts">' + acts + '</div>' +
        '<input class="memo" data-pm="m' + i + '" placeholder="측정값 · 특이사항" value="' +
        esc(s['m' + i] || '') + '"></div>';
    }).join('');

    var hz = (j.hazard || []).map(function (x) {
      return '<tr><td>' + esc(x.band) + '</td><td>' + x.n + '</td>' +
        '<td>' + x.rate + '</td><td>' + x.rel + '배</td></tr>';
    }).join('');

    var late = (j.late || []).map(function (x) {
      var pp = (x.parts || []).map(function (q) {
        return '<span class="pn">' + esc(q.pn) + '</span>';
      }).join(' ');
      return '<li>' + esc(x.err) + '<div class="dim">' + esc(x.item) +
        (pp ? ' ' + pp : '') + '</div></li>';
    }).join('');

    view.innerHTML =
      (j.test ? '<div class="testbar"><b>TEST</b> 시험 중인 기능입니다. ' +
       '표준 PM 절차를 대체하지 않습니다 — 확인용으로만 쓰십시오.</div>' : '') +
      '<div class="card"><div class="pmhd">' + hin + '</div></div>' +
      '<div class="sec"><h2>PM 에서 손댄 곳 — 마치기 전에 확인</h2>' + rows + '</div>' +
      '<div class="card pmact">' +
      '<button class="cta" id="pmPdf">PDF 로 저장 · 인쇄</button>' +
      '<button class="obtn" id="pmCsv">엑셀(CSV) 내려받기</button>' +
      '<button class="obtn ghost" id="pmClear">체크 지우기</button></div>' +
      '<details class="acc dat"><summary>왜 이 항목인가<span class="src">데이터</span></summary>' +
      '<div class="body"><p class="dim">' + esc(j.period) + ' · PM ' +
      num(j.pm_visits) + '회 · 장비 ' + num(j.instruments) + '대 ' +
      '(주기가 규칙적인 ' + j.regular + '대로 계산)</p>' +
      '<h4>PM 후 경과별 고장률 (1000 장비·일당)</h4>' +
      '<table class="pt"><tbody>' + hz + '</tbody></table>' +
      '<p class="dim">고장률은 PM 직후가 가장 높고 시간이 지나도 올라가지 않습니다. ' +
      '즉 주기를 더 조이는 것보다 <b>PM 직후 확인</b>이 효과가 큽니다.</p>' +
      '<h4>반대로 — 시간이 지나야 나는 Error (정기교체 주기가 중요)</h4>' +
      '<ul>' + late + '</ul>' +
      '<div class="note">' + esc(j.basis) + '</div></div></details>';

    view.addEventListener('change', pmOnChange);
    view.addEventListener('input', pmOnChange);
    window.scrollTo(0, 0);
  }).catch(fail);
}

function pmOnChange(ev) {
  var t = ev.target, k = t.getAttribute('data-pm');
  var s = pmState();
  if (k) {
    if (t.type === 'checkbox') {
      s[k] = t.checked;
      t.closest('.act').classList.toggle('on', t.checked);
    } else { s[k] = t.value; }
  } else if (t.id && t.id.indexOf('pf_') === 0) {
    s['h_' + t.id.slice(3)] = t.value;
  } else { return; }
  pmSave(s);
}

/* 내보내기 — 라이브러리 없이. PDF 는 브라우저 인쇄, 엑셀은 CSV.
   둘 다 오프라인에서 그대로 된다. */
function pmRows() {
  var s = pmState();
  return PM.items.map(function (it, i) {
    var done = it.acts.filter(function (a) { return s['pm' + i + '_' + a]; });
    return { no: i + 1, item: it.item, how: it.how, err: it.err, x: it.x,
             done: done.join(' '), memo: s['m' + i] || '' };
  });
}
function pmHead() {
  var s = pmState();
  return { model: s.h_model || '', serial: s.h_serial || '', fac: s.h_fac || '',
           date: s.h_date || '', eng: s.h_eng || '' };
}

function pmCsv() {
  var h = pmHead(), s = pmState();
  var q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
  var lines = [
    ['XN-10/XN-11/XN-20/XN-21 PM 후 확인 체크리스트 (TEST)'].map(q).join(','),
    [PM.src || ''].map(q).join(','),
    ['Model', h.model, 'Serial No.', h.serial].map(q).join(','),
    ['Facility name', h.fac, 'PM completed on', h.date].map(q).join(','),
    ['Person in charge', h.eng].map(q).join(','), '',
    ['Check item', '항목 (원문)', 'Yes', 'No', '수행한 작업',
     '교체 부품 (P/N)', 'Value / 비고', 'PM 직후 Error', '직후/평소'].map(q).join(','),
  ];
  PM.items.forEach(function (it, i) {
    var acts = it.acts.filter(function (a) { return s['pm' + i + '_' + a]; });
    var parts = (it.parts || []).map(function (p) {
      return p.pn + ' ' + p.name + ' (' + p.when + ')';
    }).join(' / ');
    (it.rows.length ? it.rows : ['']).forEach(function (rw, k) {
      lines.push([k === 0 ? it.group : '', rw,
                  k === 0 ? (acts.length ? 'Y' : '') : '',
                  k === 0 ? (acts.length ? '' : 'Y') : '',
                  k === 0 ? acts.join(' · ') : '',
                  k === 0 ? parts : '',
                  k === 0 ? (s['m' + i] || '') : '',
                  k === 0 ? it.err : '',
                  k === 0 ? it.x + '배' : ''].map(q).join(','));
    });
  });
  lines.push('', [PM.basis].map(q).join(','));
  // 엑셀이 한글을 깨지 않게 BOM 을 붙인다
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  pmDownload(blob, 'PM확인_' + (h.serial || h.model || 'XN') + '_' +
    (h.date || new Date().toISOString().slice(0, 10)) + '.csv');
}

/* iPhone 은 a[download] 로 파일이 잘 안 떨어진다. 공유 시트가 되면 그쪽을 쓴다
   — 메일·파일·메신저로 바로 보낼 수 있어 현장에서 이쪽이 편하다. */
function pmDownload(blob, name) {
  var file = null;
  try { file = new File([blob], name, { type: blob.type }); } catch (e) { /* 구형 */ }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch(function () { pmSaveAs(blob, name); });
    return;
  }
  pmSaveAs(blob, name);
}

function pmSaveAs(blob, name) {
  var u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 1000);
}

/* 인쇄 양식은 Sysmex 표준 체크리스트를 따른다 —
   Check item(묶음 / 항목) · Yes · No · Check/Adjustment item · Value 칸 구조. */
function pmPdf() {
  var h = pmHead(), s = pmState();
  var body = PM.items.map(function (it, i) {
    var rows = it.rows.length ? it.rows : [''];
    var acts = it.acts.filter(function (a) { return s['pm' + i + '_' + a]; });
    var yes = acts.length ? '☑' : '☐';
    var no = acts.length ? '☐' : '☑';
    var parts = (it.parts || []).map(function (p) {
      return p.pn + ' ' + p.name + ' (' + p.when + ')';
    }).join('<br>');
    return rows.map(function (rw, k) {
      var first = k === 0;
      return '<tr>' +
        (first ? '<td rowspan="' + rows.length + '" class="g">' + esc(it.group) + '</td>' : '') +
        '<td>' + esc(rw) + '</td>' +
        (first ? '<td rowspan="' + rows.length + '" class="c">' + yes + '</td>' +
                 '<td rowspan="' + rows.length + '" class="c">' + no + '</td>' +
                 '<td rowspan="' + rows.length + '">' + esc(acts.join(' · ') || '—') +
                 (parts ? '<div class="s">' + parts + '</div>' : '') + '</td>' +
                 '<td rowspan="' + rows.length + '">' + esc(s['m' + i] || '') + '</td>' +
                 '<td rowspan="' + rows.length + '" class="c">' + esc(it.err) +
                 '<div class="s">' + it.x + '배</div></td>' : '') +
        '</tr>';
    }).join('');
  }).join('');
  var w = document.createElement('div');
  w.id = 'pmprint';
  w.innerHTML =
    '<h1>XN-10/XN-11/XN-20/XN-21 PM 후 확인 체크리스트 <span class="tst">TEST</span></h1>' +
    '<p class="sub">' + esc(PM.src || '') + ' 를 보완하는 확인표입니다.</p>' +
    '<table class="hd"><tr><td>Model</td><td>' + esc(h.model) + '</td>' +
    '<td>Serial No.</td><td>' + esc(h.serial) + '</td></tr>' +
    '<tr><td>Facility name</td><td>' + esc(h.fac) + '</td>' +
    '<td>PM completed on</td><td>' + esc(h.date) + '</td></tr>' +
    '<tr><td>Person in charge</td><td colspan="3">' + esc(h.eng) + '</td></tr></table>' +
    '<table class="bd"><thead><tr>' +
    '<th style="width:14%">Check item</th><th style="width:26%"></th>' +
    '<th style="width:4%">Yes</th><th style="width:4%">No</th>' +
    '<th style="width:22%">수행한 작업 · 교체 부품</th>' +
    '<th style="width:16%">Value / 비고</th>' +
    '<th style="width:14%">PM 직후 Error</th></tr></thead><tbody>' +
    body + '</tbody></table>' +
    '<p class="ft">' + esc(PM.basis) + ' · ' + esc(PM.period) +
    ' · 항목명은 표준 체크리스트 원문입니다.</p>';
  document.body.appendChild(w);
  document.body.classList.add('printing');
  var done = function () {
    document.body.classList.remove('printing');
    w.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(function () { if (document.getElementById('pmprint')) done(); }, 60000);
}

/* ── 오프라인 / 설치 ──────────────────────────────── */
function offlineCardHTML() {
  if (!('serviceWorker' in navigator)) return '';
  var saved = localStorage.getItem('ts-offline-v');
  var ok = saved === META.v;
  return '<div class="sec"><h2>오프라인</h2><div class="card off">' +
    '<div class="offr"><span class="dot ' + (ok ? 'on' : '') + '"></span>' +
    '<span>' + (ok ? '이 기기에 전부 저장돼 있습니다 — 인터넷 없이 사용 가능'
                   : '아직 전부 저장하지 않았습니다') + '</span></div>' +
    '<button class="obtn" id="saveAll">' +
    (ok ? '다시 받기' : '오프라인용으로 전부 저장') + '</button>' +
    '<p class="muted">현장에 나가기 전에 한 번 눌러 두면 인터넷이 없어도 전부 열립니다. ' +
    '데이터 ' + esc(META.v) + '</p></div></div>';
}

function banner(html, action, label) {
  var b = document.getElementById('banner');
  if (!b) return;
  b.hidden = false;
  b.innerHTML = '<span>' + html + '</span>' +
    (label ? '<button id="bnact">' + esc(label) + '</button>' : '') +
    '<button class="bx" id="bnx" aria-label="닫기">✕</button>';
  var a = document.getElementById('bnact');
  if (a) a.onclick = action;
  document.getElementById('bnx').onclick = function () { b.hidden = true; };
}

function precacheAll(btn) {
  if (!SW || !SW.active) { alert('오프라인 저장을 아직 쓸 수 없습니다. 잠시 후 다시 시도하십시오.'); return; }
  btn.disabled = true;
  btn.textContent = '저장 중… 0%';
  SW.active.postMessage({ type: 'PRECACHE_ALL' });
}

function initSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then(function (reg) {
    SW = reg;
    reg.addEventListener('updatefound', function () {
      var nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', function () {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          banner('새 데이터가 있습니다.', function () {
            nw.postMessage({ type: 'SKIP_WAITING' });
            location.reload();
          }, '받기');
        }
      });
    });
  }).catch(function () { /* http:// 로컬 테스트 등 — 앱은 그대로 돈다 */ });

  navigator.serviceWorker.addEventListener('message', function (ev) {
    var m = ev.data || {};
    var btn = document.getElementById('saveAll');
    if (m.type === 'PRECACHE' && btn) {
      btn.textContent = '저장 중… ' + Math.round(m.done / m.total * 100) + '%';
    }
    if (m.type === 'PRECACHE_DONE') {
      localStorage.setItem('ts-offline-v', META.v);
      if (location.hash === '' || location.hash === '#/') renderHome();
    }
  });

  window.addEventListener('offline', function () {
    banner('오프라인입니다. 저장해 둔 자료로 계속 볼 수 있습니다.');
  });
}

/* ── 화면 2: 장비별 목록 ───────────────────────────── */
function renderDevice(id, tab) {
  var d = devOf(id);
  if (!d) return go('');
  titleEl.textContent = d.name;
  subEl.textContent = d.label;
  backEl.hidden = false;
  homeEl.hidden = false;
  view.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';

  loadDevice(id).then(function (j) {
    if (location.hash.indexOf('#/d/' + id) !== 0) return;   // 이미 다른 화면으로 이동
    tab = tab === '2' ? '2' : '1';
    var items = j.list[tab === '2' ? 'p2' : 'p1'];
    var rows = items.map(function (x) {
      return { d: id, p: Number(tab), i: x.i, t: x.en, c: x.c, n: x.n, r: x.r,
               cz: x.cz, sp: x.sp };
    });
    view.innerHTML =
      '<div class="tabs">' +
      '<button data-tab="1" class="' + (tab === '1' ? 'on' : '') + '">주요 Error ' +
      d.counts.p1 + '</button>' +
      '<button data-tab="2" class="' + (tab === '2' ? 'on' : '') + '">전체 Error ' +
      d.counts.p2 + '</button></div>' +
      listHTML(rows, '항목이 없습니다') +
      '<p class="muted">' + esc(d.period) + ' · 고장 수리 · PM ' + num(d.visits) + '회 방문' +
      (d.manual ? ' · 매뉴얼 ' + esc(d.manual) : ' · S/M 미확보') + '</p>';
  }).catch(fail);
}

/* ── 화면 3: Error 상세 ────────────────────────────── */
function bar(cs) {
  if (!cs || !cs.items || !cs.items.length) return '';
  var max = cs.items[0].pct || 1;
  return '<div class="share">' + cs.items.slice(0, 5).map(function (x) {
    return '<div class="b"><span class="nm">' + esc(x.t) + '</span>' +
      '<span class="bar"><i style="width:' + Math.round(x.pct / max * 100) + '%"></i></span>' +
      '<span class="pc">' + x.pct + '%</span></div>';
  }).join('') +
    '<p class="muted">CRM 첫 조치 ' + num(cs.total) + '건의 분포입니다. ' +
    '조치에서 역산한 <b>추정</b>이며 원인 판정 결과가 아닙니다.</p></div>';
}

function stagesHTML(steps) {
  if (!steps || !steps.length) return '<div class="empty">조치 기록이 없습니다</div>';
  return steps.map(function (s, si) {
    var cls = s.kind === 0 ? 'sm0' : (s.kind === 1 ? 's1' : 's2');
    var no = s.kind === 0 ? '·' : String(s.kind);
    var items = (s.items || []).map(function (it, ii) {
      var id = 'c' + si + '_' + ii;
      // 조치 자체가 눈에 들어오게 — "—" 뒤의 건수·사례 설명은 작고 연하게
      var t = rich(it);
      var cut = t.indexOf(' — ');
      if (cut > 0) t = t.slice(0, cut) + ' <span class="dim">— ' + t.slice(cut + 3) + '</span>';
      return '<label class="chk" for="' + id + '">' +
        '<input type="checkbox" id="' + id + '"><span>' + t + '</span></label>';
    }).join('');
    return '<div class="stage ' + cls + '"><div class="sh"><span class="no">' + no +
      '</span>' + esc(s.label) + '</div>' + items + '</div>';
  }).join('');
}

function smHTML(e) {
  var m = e.manual || {}, o = e.overview || {};
  var has = m.title || (m.causes || []).length || (m.actions || []).length ||
            (o.reasons || []).length;
  if (!has) {
    return '<details class="acc sm"><summary>S/M Standard' +
      '<span class="src">공식</span></summary><div class="body">' +
      '<p class="note">이 Error 는 Service Manual 과 연결되지 않았습니다. ' +
      '없는 내용을 채우지 않았습니다.</p></div></details>';
  }
  var b = '';
  var codes = (e.codes && e.codes.length) ? e.codes : (e.code ? [e.code] : []);
  if (codes.length) b += '<h4>Error Code</h4><p>' + esc(codes.join(' / ')) + '</p>';
  if (o.etype || o.elevel) {
    b += '<h4>구분</h4><p>' + esc([o.etype, o.elevel].filter(Boolean).join(' · ')) + '</p>';
  }
  if (m.meaning) b += '<h4>Meaning</h4><p>' + esc(m.meaning) + '</p>';
  if ((o.reasons || []).length) {
    b += '<h4>검출 조건</h4><ul>' +
      o.reasons.slice(0, 4).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }
  if ((m.causes || []).length) {
    b += '<h4>Probable Cause</h4><ul>' +
      m.causes.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }
  if ((m.actions || []).length) {
    b += '<h4>Action (매뉴얼 표준 조치)</h4><ul>' +
      m.actions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
  }
  if ((m.parts || []).length) {
    b += '<h4>S/M 부품 P/N</h4><p>' + esc(m.parts.slice(0, 6).join(' · ')) + '</p>';
  }
  if (m.note) b += '<div class="note">' + rich(m.note) + '</div>';
  return '<details class="acc sm"><summary>S/M Standard<span class="src">공식</span>' +
    '</summary><div class="body">' + b + '</div></details>';
}

function crmHTML(e) {
  var c = e.crm || {};
  var b = '';
  if (e.cause) b += '<p>' + rich(e.cause) + '</p>';
  b += '<h4>현장 조치 (작업 기록 ' + num(c.base || 0) + '건 집계)</h4>' + stagesHTML(e.steps);
  if (e.verify) b += '<h4>조치 후 확인</h4><p>' + rich(e.verify) + '</p>';
  if (e.caution) b += '<h4>주의사항</h4><p>' + rich(e.caution) + '</p>';
  return '<details class="acc crm" open><summary>CRM Actual<span class="src">현장</span>' +
    '</summary><div class="body">' + b + '</div></details>';
}

/* XN Data 불량 — 측정 항목 × 증상(높음/낮음/재현성) 분해.
   WBC 계열(WNR·WDF·RET·WPC 등)은 FCM 계통, RBC·HCT·PLT 는 RBC 계통 (현장 기준). */
function itemsHTML(e) {
  var di = e.data_items;
  if (!di || !(di.items || []).length) return '';
  var b = di.items.map(function (x) {
    var acts = (x.acts || []).map(function (a) {
      var t = esc(a), cut = t.indexOf(' — ');
      if (cut > 0) t = t.slice(0, cut) + ' <span class="dim">— ' + t.slice(cut + 3) + '</span>';
      return '<li>' + t + '</li>';
    }).join('');
    var symp = (x.symp || []).filter(function (s) { return s.n; }).map(function (s) {
      var sa = (s.acts || []).map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
      return '<p style="margin:6px 0 2px"><b>' + esc(s.s) + '</b> <span class="dim">' +
        s.n + '건 언급</span></p>' + (sa ? '<ul>' + sa + '</ul>' : '');
    }).join('');
    var vv = (x.valve || []).map(function (v) {
      return '<span class="chip sm">' + esc(v) + '</span>';
    }).join('');
    return '<div style="border-top:1px solid var(--line);padding:8px 0 2px">' +
      '<h4 style="margin:0 0 4px">' + esc(x.item) +
      (x.sys ? ' <span class="chip sm">' + esc(x.sys) + ' 계열</span>' : '') +
      ' <span class="dim">' + x.n + '건 언급</span></h4>' +
      (acts ? '<ul>' + acts + '</ul>' : '') + symp +
      (vv ? '<div class="chips">' + vv + '</div>' : '') + '</div>';
  }).join('');
  return '<details class="acc dat"><summary>항목별 분해 (WBC·RBC…)<span class="src">데이터</span>' +
    '</summary><div class="body">' +
    '<div class="note">' + esc(di.basis || '') +
    ' WBC 계열(WNR·WDF·RET·WPC 등)은 FCM 계통, RBC·HCT·PLT 는 RBC 계통입니다.</div>' +
    b + '</div></details>';
}

/* 스페셜 케이스 — 한 장비에서 같은 Error 로 90일 안에 4회 이상 다시 부른 건.
   평균 조치 통계에는 안 보이는 "무엇을 시도했고 끝에 뭘 했는지" 순서를 보여 준다. */
function specialHTML(e) {
  var sp = e.special || [];
  if (!sp.length) return '';
  var b = sp.map(function (c) {
    // 장시간 작업 — 방문 한 번인데 오래 걸린 건
    if (c.kind === 'long') {
      var li = (c.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
      var rp2 = (c.repl || []).map(function (x) {
        return '<span class="chip sm">' + esc(x) + '</span>';
      }).join('');
      return '<div class="spc"><h4><span class="k long">장시간</span> ' +
        c.hours + '시간' + (c.night ? ' <span class="k night">야간</span>' : '') +
        (c.d ? ' · ' + esc(c.d) : '') +
        (c.model ? ' <span class="dim">' + esc(c.model) + '</span>' : '') + '</h4>' +
        (li ? '<ul>' + li + '</ul>' : '') +
        (rp2 ? '<div class="chips">' + rp2 + '</div>' : '') + '</div>';
    }
    var vs = (c.visits || []).map(function (v, i) {
      var last = i === c.visits.length - 1;
      var li = (v.steps || []).map(function (s) {
        return '<li>' + esc(s) + '</li>';
      }).join('');
      return '<div class="sv' + (last ? ' last' : '') + '">' +
        '<div class="sh"><span class="no">' + (i + 1) + '</span>' + esc(v.d) +
        (last ? ' <span class="chip sm">마지막 방문</span>' : '') + '</div>' +
        (li ? '<ul>' + li + '</ul>' : '') + '</div>';
    }).join('');
    var rp = (c.repl || []).map(function (x) {
      return '<span class="chip sm">' + esc(x) + '</span>';
    }).join('');
    return '<div class="spc">' +
      '<h4><span class="k">반복</span> ' + c.n + '회 방문 · ' + c.days + '일' +
      (c.model ? ' <span class="dim">' + esc(c.model) + '</span>' : '') + '</h4>' +
      (rp ? '<p class="dim" style="margin:2px 0 6px">이 기간에 교체: </p>' +
            '<div class="chips">' + rp + '</div>' : '') +
      vs + '</div>';
  }).join('');
  // 난이도 배수 — 이 Error 가 평균보다 몇 배 자주 애먹었는지 (흔해서 뽑힌 것은 걸러짐)
  var lf = sp[0] && sp[0].lift;
  var lift = lf >= 1.5
    ? '<p><b>이 Error 는 평균보다 ' + lf + '배 자주 애먹었습니다.</b> ' +
      '<span class="dim">(같은 기준으로 센 전 장비 평균 대비)</span></p>' : '';
  // 같은 Error 라도 대부분은 한 번에 끝난다 — 겁먹지 않도록 대비를 먼저 보여 준다
  var d = sp[0] && sp[0].dist, dist = '';
  if (d && d.units >= 5) {
    var seg = [['one', d.one, '1회로 끝남', 'g1'],
               ['few', d.few, '2~3회', 'g2'],
               ['many', d.many, '4회 이상', 'g3']];
    dist = '<h4>이 Error 를 겪은 장비 ' + d.units + '대 — 몇 번 만에 끝났나</h4>' +
      '<div class="rbar">' + seg.map(function (s) {
        return s[1] ? '<i class="' + s[3] + '" style="flex:' + s[1] + '">' + s[1] + '</i>' : '';
      }).join('') + '</div><div class="rlg">' + seg.map(function (s) {
        return '<span><i class="' + s[3] + '"></i>' + s[2] + ' ' + s[1] + '대</span>';
      }).join('') + '</div>' +
      '<p class="dim" style="margin:4px 0 0">' +
      (d.one + d.few) + '대는 3회 안에 끝났습니다. 아래는 <b>' + d.many +
      '대에서 애먹은 기록</b>입니다 — 같은 Error 라도 늘 어려운 것은 아닙니다.</p>';
  }
  return '<details class="acc spec"><summary>스페셜 케이스 ' + sp.length +
    '건' + (lf >= 1.5 ? ' <span class="tag sp">' + lf + '배</span>' : '') +
    '<span class="src">현장</span></summary><div class="body">' + lift + dist +
    '<div class="note"><b>반복</b> = 같은 장비에서 90일 안에 4회 이상 다시 방문. ' +
    '<b>장시간</b> = 한 방문 8시간 이상. ' +
    '<b>마지막 조치가 정답이라는 뜻은 아닙니다</b> — 그 뒤로 기록이 없다는 뜻입니다.</div>' +
    b + '</div></details>';
}

function partsHTML(e) {
  // p1 은 e.crm 아래, p2(전체 에러)는 최상위에 있다 — 둘 다 읽는다
  var c = e.crm || {};
  var pn = c.pn || e.pn || [], named = c.named || e.named || [],
      sens = c.sensors || e.sensors || [];
  if (!pn.length && !named.length && !sens.length) return '';
  var b = '';
  if (pn.length) {
    // 많이 교체한 순 — 출동 전에 위에서부터 챙기면 된다 (파이프라인이 건수순 정렬)
    b += '<h4>많이 교체한 순 — 출동 전 챙길 부품</h4><table class="pt"><tbody>' +
      pn.slice(0, 10).map(function (r, i) {
        return '<tr><td class="nm"><b class="rk">' + (i + 1) + '</b>' + esc(r.name) +
          (r.pn ? '<span class="pn">' + esc(r.pn) + '</span>' : '') +
          '</td><td class="q">' + num(r.n) + '건</td></tr>';
      }).join('') + '</tbody></table>';
  }
  if (named.length) {
    b += '<h4>작업 기록 표기 (P/N 아님)</h4><div class="chips">' +
      named.slice(0, 8).map(function (x) {
        return '<span class="chip">' + esc(x[0]) + '<i>' + x[1] + '</i></span>';
      }).join('') + '</div>';
  }
  if (sens.length) {
    b += '<h4>센서</h4><div class="chips">' +
      sens.slice(0, 8).map(function (x) {
        return '<span class="chip">' + esc(x[0]) + '<i>' + x[1] + '</i></span>';
      }).join('') + '</div>';
  }
  b += '<div class="note">건수는 그 Part 가 이 Error 방문에서 청구된 <b>방문 수</b>입니다. ' +
       '많이 교체한 순으로 정렬했습니다. 발주 전 P/N 을 다시 확인하십시오.</div>';
  // 접힌 상태에서도 1위 부품이 보이게 — 출동 전에 펼치지 않고 확인할 수 있다
  var top = pn.length ? pn[0] : null;
  var peek = top
    ? '<span class="cz">' + esc(top.name) +
      (pn.length > 1 ? ' 외 ' + (pn.length - 1) : '') + '</span>' : '';
  return '<details class="acc crm"><summary>Related Parts' + peek +
    '<span class="src">현장</span></summary><div class="body">' + b + '</div></details>';
}

function relatedHTML(e, dev) {
  var co = e.co || [];
  if (!co.length) return '';
  var chips = co.map(function (x) {
    return '<button class="chip" data-find="' + esc(x[0]) + '">' + esc(x[0]) +
      '<i>' + x[1] + '</i></button>';
  }).join('');
  return '<details class="acc dat"><summary>Related Errors<span class="src">데이터</span>' +
    '</summary><div class="body"><h4>같은 방문에 함께 기록된 Error</h4>' +
    '<div class="chips">' + chips + '</div>' +
    '<div class="note">함께 뜬 것이지 인과관계가 확인된 것은 아닙니다.</div>' +
    '</div></details>';
}

function quoteHTML(r) {
  var cut = r.cut ? ' <span class="dim">(다른 Error 동반 방문 — 이 Error 구간만 발췌)</span>' : '';
  return '<blockquote><em>' + esc(r.date) + ' · ' + esc(r.inst) + ' · ' + esc(r.model) +
    cut + '</em>' + esc(r.text) + '</blockquote>';
}

function recordsHTML(e, more) {
  var rs = e.records || [];
  if (!rs.length && !e.quote) return '';
  if (!rs.length && e.quote) rs = [e.quote];
  var b = rs.slice(0, 3).map(quoteHTML).join('');
  var btn = more ? '<button class="more" id="moreCases" data-n="' + more +
    '">비슷한 사례 ' + more + '건 더 보기</button>' : '';
  return '<details class="acc crm"><summary>작업 기록 원문<span class="src">현장</span>' +
    '</summary><div class="body"><div id="cwrap">' + b + '</div>' + btn +
    '<div class="note">CRM 작업 내용을 <b>고치지 않고</b> 그대로 옮긴 것입니다. ' +
    '한 방문에 Error 가 둘 이상이면 이 Error 와 이어지는 구간만 싣고, ' +
    '가를 수 없으면 싣지 않습니다.</div>' +
    '</div></details>';
}

/* 사례를 "더" 가 아니라 "다르게" 보여 준다.
   손댄 구성품·교체 여부로 걸러 볼 수 있게 칩을 만든다. 칩은 데이터에서 나온 것만 쓴다. */
function chipsOf(cases) {
  var cnt = {}, i, j, c;
  for (i = 0; i < cases.length; i++) {
    c = cases[i];
    for (j = 0; j < (c.tags || []).length; j++) bump(c.tags[j]);
    for (j = 0; j < (c.comps || []).length; j++) bump(c.comps[j]);
  }
  function bump(k) { cnt[k] = (cnt[k] || 0) + 1; }
  // 전부에 붙은 칩은 걸러 낼 것이 없으니 뺀다
  return Object.keys(cnt)
    .filter(function (k) { return cnt[k] >= 2 && cnt[k] < cases.length; })
    .sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 8)
    .map(function (k) { return { k: k, n: cnt[k] }; });
}

function casesListHTML(cases, sel) {
  var use = cases.filter(function (c) {
    if (!sel) return true;
    return (c.tags || []).indexOf(sel) >= 0 || (c.comps || []).indexOf(sel) >= 0;
  });
  if (!use.length) return '<div class="empty">해당하는 사례가 없습니다</div>';
  return use.map(function (c) {
    var tg = (c.tags || []).concat(c.valves || []).map(function (t) {
      return '<span class="chip sm">' + esc(t) + '</span>';
    }).join('');
    var cut = c.cut ? ' <span class="dim">(다른 Error 동반 방문 — 이 Error 구간만 발췌)</span>' : '';
    return '<blockquote><em>' + esc(c.date) + ' · ' + esc(c.inst) + ' · ' + esc(c.model) +
      cut + '</em>' + esc(c.text) + (tg ? '<div class="chips">' + tg + '</div>' : '') +
      '</blockquote>';
  }).join('');
}

function openCases(dev, file, key, idx, btn) {
  btn.disabled = true;
  btn.textContent = '불러오는 중…';
  var p = CASES[dev] ? Promise.resolve(CASES[dev])
                     : getJSON(file).then(function (j) { CASES[dev] = j; return j; });
  p.then(function (j) {
    var box = ((j.items || {})[key] || {})[idx];
    if (!box) { btn.textContent = '사례가 없습니다'; return; }
    CBOX = box;
    var chips = chipsOf(box.cases);
    var host = document.createElement('div');
    host.className = 'cases';
    host.innerHTML =
      '<div class="note">아래는 같은 Error 로 기록된 <b>' + box.pool +
      '건</b> 중 접근이 서로 다른 <b>' + box.cases.length + '건</b>입니다. ' +
      '많이 나온 순서가 아니라 <b>손댄 곳이 겹치지 않는 순서</b>로 골랐습니다.</div>' +
      (chips.length ? '<div class="chips filt"><button class="chip on" data-f="">전체</button>' +
        chips.map(function (c) {
          return '<button class="chip" data-f="' + esc(c.k) + '">' + esc(c.k) +
            ' <i>' + c.n + '</i></button>';
        }).join('') + '</div>' : '') +
      '<div id="clist">' + casesListHTML(box.cases, '') + '</div>';
    btn.parentNode.replaceChild(host, btn);
    var f = host.querySelector('.filt');
    if (f) {
      f.addEventListener('click', function (ev) {
        var t = ev.target.closest ? ev.target.closest('button') : null;
        if (!t) return;
        var all = f.querySelectorAll('button'), i;
        for (i = 0; i < all.length; i++) all[i].className = 'chip';
        t.className = 'chip on';
        $('#clist', host).innerHTML = casesListHTML(CBOX.cases, t.getAttribute('data-f'));
      });
    }
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = '사례를 불러오지 못했습니다 — 다시 시도';
  });
}

function dataHTML(e) {
  var r = e.recur || {}, b = '';
  if (r.base >= 10) {
    b += '<h4>재발</h4><p>같은 Serial 30일 내 <b>' + r.p30 + '%</b> · 90일 ' + r.p90 +
      '% <span class="muted">(판정 ' + r.base + '건)</span></p>';
  }
  if (e.models) b += '<h4>모델 분포</h4><p>' + esc(e.models) + '</p>';
  var v = (e.valves && e.valves.crm) || e.valve || [];
  if (v.length) {
    b += '<h4>Valve No.</h4><div class="chips">' +
      v.slice(0, 10).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('') +
      '</div>';
  }
  if (e.vfn && e.vfn.items && e.vfn.items.length) {
    b += '<h4>Valve 기능 — S/M Ch.2 원문</h4><ul>' +
      e.vfn.items.map(function (x) {
        return '<li><b>' + esc(x[0]) + '</b> — ' + esc(x[1]) + '</li>';
      }).join('') + '</ul>';
  }
  if ((e.crm || {}).skipped) {
    b += '<div class="note">이 Error 로 기록된 방문 중 <b>' + e.crm.skipped +
      '건</b>은 작업 내용에서 이 Error 와 이어지는 구간을 찾지 못해 집계에서 제외했습니다.</div>';
  }
  if (!b) return '';
  return '<details class="acc dat"><summary>Data<span class="src">데이터</span>' +
    '</summary><div class="body">' + b + '</div></details>';
}

function renderError(dev, part, idx) {
  var d = devOf(dev);
  if (!d) return go('');
  backEl.hidden = false;
  homeEl.hidden = false;
  view.innerHTML = '<div class="card"><div class="empty">불러오는 중…</div></div>';

  loadDevice(dev).then(function (j) {
    var key = part === '2' ? 'p2' : 'p1';
    var e = j.detail[key][idx];
    if (!e) { view.innerHTML = '<div class="card"><div class="empty">항목을 찾지 못했습니다</div></div>'; return; }

    titleEl.textContent = e.en;
    subEl.textContent = d.name + ' · ' + (part === '2' ? '전체 Error' : '주요 Error');

    var codes = (e.codes && e.codes.length) ? e.codes : (e.code ? [e.code] : []);
    var r = e.recur || {};
    var stats =
      '<div class="stat"><b>' + num(e.n) + '건</b><span>발생</span></div>' +
      (e.share != null ? '<div class="stat"><b>' + e.share + '%</b><span>전체 대비</span></div>' : '') +
      (r.base >= 10 ? '<div class="stat"><b>' + r.p30 + '%</b><span>30일 재발</span></div>' : '') +
      ((e.crm || {}).base != null ?
        '<div class="stat"><b>' + num(e.crm.base) + '건</b><span>작업 기록</span></div>' : '');

    var head =
      '<div class="card head">' +
      '<div class="r2" style="margin:0 0 7px">' +
      '<span class="tag dv">' + esc(dev) + '</span>' +
      // 코드가 수십 개인 Error 가 있다 (CN 38101~ 처럼). 머리말에는 앞의 몇 개만
      // 보이고 전체는 S/M Standard 안에 그대로 둔다 — 한 줄이 화면 폭을 밀어냈다.
      (codes.length ? '<span class="tag cd">' +
        esc(codes.slice(0, 3).join(' / ')) +
        (codes.length > 3 ? ' 외 ' + (codes.length - 3) + '개' : '') + '</span>'
                    : '<span class="tag no">코드 없음</span>') +
      (part === '2' ? '<span class="tag p2">전체</span>' : '') + '</div>' +
      '<h1>' + esc(e.en) + '</h1>' +
      (e.ko ? '<p class="ko">' + esc(e.ko) + '</p>' : '') +
      '<div class="stats">' + stats + '</div>' +
      bar(e.cause_share) +
      ((e.steps && e.steps.length)
        ? '<button class="cta" id="startTs">Troubleshooting 시작</button>' : '') +
      '</div>';

    var more = ((j.cn || {})[key] || {})[idx] || 0;
    view.innerHTML = head + smHTML(e) + crmHTML(e) + specialHTML(e) + itemsHTML(e) +
      partsHTML(e) + relatedHTML(e, dev) + recordsHTML(e, more) + dataHTML(e);
    var mb = $('#moreCases');
    if (mb) {
      mb.addEventListener('click', function () {
        openCases(dev, j.cases_file, key, idx, mb);
      });
    }
    window.scrollTo(0, 0);
  }).catch(fail);
}

/* ── 화면 4: 검색 결과 ─────────────────────────────── */
function renderSearch(q) {
  titleEl.textContent = '검색';
  subEl.textContent = '"' + q + '"';
  backEl.hidden = false;
  homeEl.hidden = false;
  if (!INDEX) {
    view.innerHTML = '<div class="card"><div class="empty">검색 준비 중…</div></div>';
    ensureIndex().then(function () {
      if (decodeURIComponent(location.hash).indexOf('#/q/' + q) === 0) renderSearch(q);
    }).catch(fail);
    return;
  }
  var rows = search(q, null, 60);
  view.innerHTML =
    '<p class="muted" style="margin:0 0 8px">' + rows.length + '건' +
    (rows.length >= 60 ? ' (상위 60건만 표시)' : '') + '</p>' +
    listHTML(rows, '결과가 없습니다. Error 이름 일부 · Code · Part No. · Valve 번호로 찾아보십시오.');
}

/* ── 라우팅 ───────────────────────────────────────── */
function go(hash) { location.hash = hash ? '#/' + hash : '#/'; }

function route() {
  var h = (location.hash || '#/').replace(/^#\/?/, '');
  var p = h.split('/').filter(Boolean).map(decodeURIComponent);
  if (!p.length) { qEl.value = ''; qx.hidden = true; return renderHome(); }
  if (p[0] === 'q') { qEl.value = p[1] || ''; qx.hidden = !qEl.value; return renderSearch(p[1] || ''); }
  if (p[0] === 'd') return renderDevice(p[1], p[2]);
  if (p[0] === 'e') return renderError(p[1], p[2], p[3]);
  if (p[0] === 'pm') return renderPM();
  return renderHome();
}

function fail(err) {
  view.innerHTML = '<div class="card"><div class="empty">데이터를 불러오지 못했습니다.<br>' +
    esc(err && err.message) + '</div></div>';
}

/* ── 이벤트 ───────────────────────────────────────── */
var tmr = null;
qEl.addEventListener('input', function () {
  qx.hidden = !qEl.value;
  clearTimeout(tmr);
  tmr = setTimeout(function () {
    var v = qEl.value.trim();
    if (!v) { if (location.hash.indexOf('#/q/') === 0) go(''); return; }
    var target = '#/q/' + encodeURIComponent(v);
    if (location.hash.indexOf('#/q/') === 0) {
      history.replaceState(null, '', target);       // 타이핑 중에는 히스토리를 쌓지 않는다
      renderSearch(v);
    } else {
      location.hash = target;
    }
  }, 120);
});
qEl.addEventListener('change', function () { remember(qEl.value.trim()); });
qEl.addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') { remember(qEl.value.trim()); qEl.blur(); }
});
qx.addEventListener('click', function () { qEl.value = ''; qx.hidden = true; qEl.focus(); go(''); });
backEl.addEventListener('click', function () {
  if (history.length > 1) history.back(); else go('');
});
// 몇 단계를 들어갔든 한 번에 처음 화면으로
homeEl.addEventListener('click', function () {
  qEl.value = ''; qx.hidden = true;
  go('');
  window.scrollTo(0, 0);
});

document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-go],[data-dev],[data-tab],[data-q],[data-find],#startTs');
  if (!t) return;
  if (t.id === 'startTs') {
    var s = document.querySelector('details.crm');
    if (s) { s.open = true; s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    return;
  }
  if (t.dataset.go) { go('e/' + t.dataset.go); return; }
  if (t.dataset.dev) { go('d/' + t.dataset.dev); return; }
  if (t.dataset.tab) { go('d/' + location.hash.split('/')[2] + '/' + t.dataset.tab); return; }
  if (t.dataset.q) { qEl.value = t.dataset.q; go('q/' + encodeURIComponent(t.dataset.q)); return; }
  if (t.dataset.find) { qEl.value = t.dataset.find; go('q/' + encodeURIComponent(t.dataset.find)); }
});

document.addEventListener('click', function (ev) {
  if (ev.target.id === 'saveAll') precacheAll(ev.target);
  if (ev.target.closest('[data-go-pm]')) go('pm');
  if (ev.target.id === 'pmPdf') pmPdf();
  if (ev.target.id === 'pmCsv') pmCsv();
  if (ev.target.id === 'pmClear') {
    if (confirm('체크한 내용을 모두 지웁니다. 계속할까요?')) {
      try { localStorage.removeItem(PM_KEY); } catch (e) { /* 무시 */ }
      renderPM();
    }
  }
});

document.addEventListener('change', function (ev) {
  if (ev.target.matches('.chk input')) {
    ev.target.closest('.chk').classList.toggle('done', ev.target.checked);
  }
});

window.addEventListener('hashchange', route);

/* ── 잠금 화면 ─────────────────────────────────────── */
function askPassword(msg) {
  boot.remove();
  titleEl.innerHTML = '실마리 <span class="en">Sysmex TS Guide</span>';
  subEl.textContent = '';
  backEl.hidden = true;
  homeEl.hidden = true;
  document.body.classList.add('locked');
  view.innerHTML =
    '<div class="card lock">' +
    '<p class="tagline">막혔을 때, 해결의 <b>실마리</b>를 찾다</p>' +
    '<h2>비밀번호</h2>' +
    '<p class="muted">현장 배포용 비밀번호를 넣어 주십시오. 이 기기에서 한 번만 하면 됩니다.</p>' +
    (msg ? '<div class="lockerr">' + esc(msg) + '</div>' : '') +
    '<form id="lockf" autocomplete="on">' +
    '<input type="text" name="username" value="sysmex-fsg" autocomplete="username" hidden>' +
    '<input type="password" id="pw" autocomplete="current-password" ' +
    'placeholder="비밀번호" autocapitalize="off" autocorrect="off" spellcheck="false">' +
    '<label class="rem"><input type="checkbox" id="rem" checked> 이 기기에서 30일간 기억</label>' +
    '<button class="cta" type="submit" id="pwgo">열기</button>' +
    '</form>' +
    '<div class="note">데이터는 비밀번호로 잠겨 있습니다. 비밀번호는 이 기기 밖으로 나가지 않습니다.</div>' +
    '</div>';
  $('#pw').focus();
  $('#lockf').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var pw = $('#pw').value, keep = $('#rem').checked, btn = $('#pwgo');
    if (!pw) return;
    btn.disabled = true;
    btn.textContent = '확인 중…';           // PBKDF2 는 일부러 느리다 (대입 방어)
    setTimeout(function () {
      deriveKey(pw).then(function (k) {
        return checkKey(k).then(function (good) {
          if (!good) {
            btn.disabled = false; btn.textContent = '열기';
            askPassword('비밀번호가 맞지 않습니다.');
            return;
          }
          KEY = k;
          document.body.classList.remove('locked');
          return (keep ? rememberKey(k) : Promise.resolve()).then(start);
        });
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = '열기';
        askPassword('열지 못했습니다 — ' + e.message);
      });
    }, 30);                                  // 버튼 글자가 바뀐 뒤에 계산을 시작한다
  });
}

/* ── 시작 ─────────────────────────────────────────── */
function start() {
  if (window.__step) window.__step('③ 앱 코드 시작 — 장비 목록 읽는 중');
  return getJSON('devices.json')
    .then(function (m) {
      META = m;
      if (window.__step) window.__step('④ 장비 목록 읽음 — 화면 그리는 중');
      if (boot.parentNode) boot.remove();
      route();                                  // 홈은 여기서 이미 보인다
      var idle = window.requestIdleCallback ||
                 function (f) { return setTimeout(f, 1); };
      idle(function () { ensureIndex(); initSW(); });   // 검색 인덱스·오프라인 준비는 뒤이어
    })
    .catch(function (err) {
      if (AUTH) {                               // 키가 상했을 수 있다 — 다시 묻는다
        forgetKey(); KEY = null;
        askPassword('데이터를 열지 못했습니다. 비밀번호를 다시 넣어 주십시오.');
        return;
      }
      if (boot.parentNode) {
        boot.className = 'boot err';
        boot.innerHTML = '데이터를 불러오지 못했습니다.<br><b>' + esc(err.message) + '</b><br><br>' +
          '<small>' + esc(navigator.userAgent) + '</small><br><br>' +
          'file:// 로 직접 열면 브라우저가 JSON 읽기를 막습니다.<br>' +
          '이 폴더에서 <code>python -m http.server 8000</code> 을 실행한 뒤<br>' +
          '<code>http://localhost:8000/</code> 로 접속하십시오.';
      }
    });
}

// 잠긴 빌드인지 먼저 본다. _auth.json 이 없으면 예전처럼 그냥 연다.
fetch(DATA + '_auth.json', { cache: 'no-cache' })
  .then(function (r) { return r.ok ? r.json() : null; })
  .catch(function () { return null; })
  .then(function (a) {
    if (!a || !window.crypto || !crypto.subtle) return start();
    AUTH = a;
    var p = recallKey();
    if (!p) return askPassword('');
    return Promise.resolve(p).then(function (k) {
      return checkKey(k).then(function (good) {
        if (!good) { forgetKey(); return askPassword(''); }
        KEY = k;
        return start();
      });
    }).catch(function () { forgetKey(); return askPassword(''); });
  });
