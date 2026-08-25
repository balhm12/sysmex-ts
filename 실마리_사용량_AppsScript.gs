/**
 * 실마리 사용량 — Firebase 에 쌓인 익명 기록을 매일 한 번 시트로 옮긴다.
 *
 * 왜 앱에서 시트로 바로 안 보내나
 *   Apps Script 웹앱은 응답이 느리고 동시 접속에 약하다. 현장에서 앱이 멈춘
 *   것처럼 보이면 안 된다. 앱은 Firebase 에 던지기만 하고(수십 ms), 옮기는
 *   일은 여기서 하루 한 번 한다.
 *
 * 처음 한 번만 하면 되는 일
 *   1) 새 스프레드시트를 만들고, 확장 프로그램 → Apps Script 에 이 파일을 붙인다
 *   2) 아래 FIREBASE_URL 을 채운다 (앱의 js/stat.js 와 같은 주소)
 *   3) **서비스 계정 키를 넣는다** (아래 '읽기 권한' 참고)
 *   4) setup() 을 한 번 실행한다 — 매일 새벽 3시에 도는 트리거가 걸린다
 *   5) 처음에는 pull() 을 손으로 한 번 눌러 값이 들어오는지 본다
 *
 * 읽기 권한 — 왜 서비스 계정인가
 *   Firebase 규칙을 '.read: false' 로 잠가 두었다. 주소는 앱 소스에 들어 있어
 *   누구나 알 수 있으므로, 읽기를 열면 사용 기록이 그대로 공개된다.
 *   **서비스 계정은 규칙을 거치지 않고 읽는다.** 규칙은 잠긴 채로 둘 수 있다.
 *
 *   1) Firebase 콘솔 → 프로젝트 설정 → **서비스 계정** → 새 비공개 키 생성
 *      → JSON 파일이 받아진다
 *   2) Apps Script 왼쪽 **⚙ 프로젝트 설정** → 아래 **스크립트 속성** →
 *      속성 `SA_JSON`, 값에 그 JSON 파일 **전체 내용**을 붙여넣는다
 *
 *   왜 코드가 아니라 스크립트 속성인가 — 이 .gs 파일은 배포본에 같이 들어가
 *   GitHub 에 올라간다. 키를 코드에 적으면 **비공개 키가 공개된다.**
 *   스크립트 속성은 이 프로젝트 안에만 남는다.
 *
 *   서비스 계정을 안 쓰고 싶으면, 규칙의 '.read' 를 true 로 바꾸면 이 파일도
 *   그대로 돈다 (SA_JSON 이 없으면 저절로 그 방식으로 물러선다).
 *   대신 주소를 아는 사람은 사용 기록을 볼 수 있게 된다.
 *
 * 시트 세 장이 생긴다
 *   raw     — 옮겨온 기록 (날짜 · 기기 · 종류 · 장비 · Error)
 *   일자별  — 날짜마다 몇 명이 몇 번 열었나
 *   Error별 — 어느 Error 를 몇 번, 몇 명이 열었나  ← 이걸 보고 다음 보강을 정한다
 *
 * 개인 식별
 *   '기기' 칸은 앱이 만든 임의의 16자리다. 이름·사번·메일과 이어지지 않는다.
 *   사람 수를 세는 용도로만 쓴다. 누구인지 되짚으려 하지 말 것.
 */

// 앱의 js/stat.js 와 같은 주소여야 한다. 끝의 '/' 는 떼어 낸다.
var FIREBASE_URL =
  'https://silmari-ts-default-rtdb.asia-southeast1.firebasedatabase.app'
    .replace(/\/+$/, '');
var KEEP_DAYS = 400;            // Firebase 에서 이만큼 지난 날짜 묶음은 지운다

/* ── 읽기 권한 ─────────────────────────────────────────────
   서비스 계정 JSON 으로 짧은 수명의 접근 토큰을 받는다.
   토큰은 1시간짜리라 55분 동안만 재사용한다. */
function accessToken_() {
  var json = PropertiesService.getScriptProperties().getProperty('SA_JSON');
  if (!json) return null;                       // 안 넣었으면 규칙에 맡긴다

  var cache = CacheService.getScriptCache();
  var hit = cache.get('sa_token');
  if (hit) return hit;

  var sa = JSON.parse(json);
  var now = Math.floor(Date.now() / 1000);
  var enc = function (o) {
    return Utilities.base64EncodeWebSafe(JSON.stringify(o)).replace(/=+$/, '');
  };
  var unsigned = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database ' +
           'https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  });
  var sig = Utilities.computeRsaSha256Signature(unsigned, sa.private_key);
  var jwt = unsigned + '.' + Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('서비스 계정 토큰을 못 받았습니다 (' + res.getResponseCode() + ') — ' +
                    'SA_JSON 이 올바른지 확인하십시오. ' + res.getContentText().slice(0, 200));
  }
  var tok = JSON.parse(res.getContentText()).access_token;
  cache.put('sa_token', tok, 55 * 60);
  return tok;
}

/** Firebase REST 호출 — 토큰이 있으면 붙인다. */
function fb_(path, opt) {
  var tok = accessToken_();
  var url = FIREBASE_URL + path + (tok ? '?access_token=' + encodeURIComponent(tok) : '');
  return UrlFetchApp.fetch(url, opt || { muteHttpExceptions: true });
}

function setup() {
  if (!FIREBASE_URL) throw new Error('FIREBASE_URL 을 먼저 채우십시오.');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pull') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pull').timeBased().everyDays(1).atHour(3).create();
  pull();
}

/* ── 시트 메뉴 ─────────────────────────────────────────────
   Apps Script 를 열지 않고 시트에서 바로 새로고침하기 위한 것.
   시트를 열 때마다 상단에 '실마리' 메뉴가 생긴다.
   (메뉴를 '만드는' 일은 권한이 필요 없고, 눌렀을 때 도는 함수가 권한을 쓴다) */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('실마리')
    .addItem('지금 새로고침', 'menuPull_')
    .addItem('상태 확인', 'menuCheck_')
    .addToUi();
}

function menuPull_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Firebase 에서 가져오는 중…', '실마리', 30);
  try {
    var n = pull();
    ss.toast(n ? '새로 옮긴 기록 ' + n + '건' : '새로 들어온 기록이 없습니다',
             '실마리', 6);
  } catch (e) {
    ss.toast('실패', '실마리', 3);
    SpreadsheetApp.getUi().alert('새로고침 실패\n\n' + e.message);
  }
}

function menuCheck_() {
  try {
    check();
    SpreadsheetApp.getUi().alert('상태\n\n' + (check_last_ || '(로그를 보십시오)'));
  } catch (e) {
    SpreadsheetApp.getUi().alert('확인 실패\n\n' + e.message);
  }
}

var check_last_ = '';

/** 어디까지 됐는지 한 번에 본다. 막혔을 때 이것부터 실행하십시오. */
function check() {
  var out = [];
  out.push(FIREBASE_URL ? '① 주소 OK' : '① FIREBASE_URL 이 비어 있습니다');
  if (!FIREBASE_URL) { return done_(out); }

  var hasSA = !!PropertiesService.getScriptProperties().getProperty('SA_JSON');
  out.push(hasSA ? '② 서비스 계정 키 있음' : '② 서비스 계정 키 없음 — 규칙의 .read 에 의존합니다');
  if (hasSA) {
    try { out.push(accessToken_() ? '③ 토큰 발급 OK' : '③ 토큰 없음'); }
    catch (e) { out.push('③ 토큰 실패 — ' + e.message); return done_(out); }
  }

  var res = fb_('/stat.json');
  var code = res.getResponseCode();
  out.push('④ 읽기 응답 ' + code + (code === 401 ? ' — 권한 없음' : ''));
  if (code === 200) {
    var tree = JSON.parse(res.getContentText() || 'null');
    if (!tree) {
      out.push('⑤ 아직 쌓인 것이 없습니다.');
      out.push('   → 앱이 아직 안 보내고 있습니다. 규칙의 .write 가 열려 있는지,');
      out.push('     js/stat.js 의 ENDPOINT 가 커밋됐는지 확인하십시오.');
    } else {
      var days = Object.keys(tree).sort();
      var n = 0;
      days.forEach(function (d) {
        Object.keys(tree[d] || {}).forEach(function (b) {
          n += ((tree[d][b] || {}).v || []).length;
        });
      });
      out.push('⑤ 쌓인 날짜 ' + days.length + '일 (' + days[0] + ' ~ ' +
               days[days.length - 1] + ') · 기록 ' + n + '건');
    }
  }
  return done_(out);
}

/** check() 결과를 로그와 메뉴 양쪽에서 쓰기 위해 한 곳에 모은다. */
function done_(out) {
  check_last_ = out.join('\n');
  Logger.log(check_last_);
  return check_last_;
}

function sheet_(name, header) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(header);
    sh.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Firebase → raw 시트. 이미 옮긴 묶음은 건너뛴다. */
function pull() {
  if (!FIREBASE_URL) throw new Error('FIREBASE_URL 을 먼저 채우십시오.');
  var raw = sheet_('raw', ['날짜', '기기', '종류', '장비', 'Error', '묶음ID']);

  // 이미 옮긴 묶음 ID — 같은 것을 두 번 넣지 않기 위해서다.
  // (트리거가 겹쳐 돌거나, 손으로 한 번 더 눌러도 숫자가 부풀지 않아야 한다)
  var done = {};
  if (raw.getLastRow() > 1) {
    raw.getRange(2, 6, raw.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { done[r[0]] = 1; });
  }

  var res = fb_('/stat.json');
  if (res.getResponseCode() === 401) {
    throw new Error(
      '읽기 권한이 없습니다 (401). 둘 중 하나를 하십시오.\n' +
      ' (1) 서비스 계정 — Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 →' +
      ' 새 비공개 키 생성 → 받은 JSON 전체를 이 스크립트의' +
      ' ⚙ 프로젝트 설정 → 스크립트 속성에 SA_JSON 이름으로 넣기 (권장)\n' +
      ' (2) 규칙의 stat 아래 ".read" 를 true 로 바꾸기' +
      ' — 주소를 아는 사람은 사용 기록을 볼 수 있게 됩니다');
  }
  if (res.getResponseCode() !== 200) {
    throw new Error('Firebase 응답 ' + res.getResponseCode() + ' — ' +
                    res.getContentText().slice(0, 200));
  }
  var tree = JSON.parse(res.getContentText() || 'null');
  if (!tree) { Logger.log('쌓인 것이 없습니다'); return; }

  var rows = [];
  Object.keys(tree).forEach(function (day) {
    var batches = tree[day] || {};
    Object.keys(batches).forEach(function (bid) {
      if (done[bid]) return;
      var b = batches[bid] || {};
      (b.v || []).forEach(function (ev) {
        rows.push([ev.t || day, b.a || '', ev.k || '', ev.d || '', ev.e || '', bid]);
      });
    });
  });
  if (rows.length) raw.getRange(raw.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  Logger.log('새로 옮긴 줄 ' + rows.length);

  summarize_();
  prune_(tree);
  return rows.length;
}

/** raw 를 두 가지로 요약한다. 매번 새로 계산한다 — 틀어질 여지를 안 만든다. */
function summarize_() {
  var raw = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('raw');
  if (!raw || raw.getLastRow() < 2) return;
  var data = raw.getRange(2, 1, raw.getLastRow() - 1, 5).getValues();

  var byDay = {}, byErr = {};
  data.forEach(function (r) {
    var day = r[0], aid = r[1], kind = r[2], dev = r[3], err = r[4];
    if (!byDay[day]) byDay[day] = { open: 0, view: 0, who: {} };
    byDay[day][kind === 'open' ? 'open' : 'view']++;
    byDay[day].who[aid] = 1;
    if (kind === 'view' && err) {
      var k = dev + '\t' + err;
      if (!byErr[k]) byErr[k] = { n: 0, who: {}, last: day };
      byErr[k].n++;
      byErr[k].who[aid] = 1;
      if (day > byErr[k].last) byErr[k].last = day;
    }
  });

  var d1 = sheet_('일자별', ['날짜', '연 사람(기기)', '연 횟수', 'Error 조회']);
  // 시트를 열었을 때 '언제 것인지' 를 바로 알 수 있게 — 없으면 오래된 값을
  // 최신으로 착각한다
  d1.getRange('F1').setValue('마지막 새로고침 ' +
    Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm'))
    .setFontColor('#777');
  if (d1.getLastRow() > 1) d1.getRange(2, 1, d1.getLastRow() - 1, 4).clearContent();
  var rows1 = Object.keys(byDay).sort().map(function (day) {
    return [day, Object.keys(byDay[day].who).length, byDay[day].open, byDay[day].view];
  });
  if (rows1.length) d1.getRange(2, 1, rows1.length, 4).setValues(rows1);

  var d2 = sheet_('Error별', ['장비', 'Error', '조회 수', '본 사람(기기)', '마지막']);
  if (d2.getLastRow() > 1) d2.getRange(2, 1, d2.getLastRow() - 1, 5).clearContent();
  var rows2 = Object.keys(byErr).map(function (k) {
    var p = k.split('\t');
    return [p[0], p[1], byErr[k].n, Object.keys(byErr[k].who).length, byErr[k].last];
  }).sort(function (a, b) { return b[2] - a[2]; });
  if (rows2.length) d2.getRange(2, 1, rows2.length, 5).setValues(rows2);
}

/** 오래된 날짜 묶음은 Firebase 에서 지운다 — 시트에 이미 옮겨 두었다. */
function prune_(tree) {
  var cut = new Date();
  cut.setDate(cut.getDate() - KEEP_DAYS);
  var cutS = Utilities.formatDate(cut, 'Asia/Seoul', 'yyyy-MM-dd');
  Object.keys(tree).forEach(function (day) {
    if (day < cutS) {
      fb_('/stat/' + day + '.json', { method: 'delete', muteHttpExceptions: true });
    }
  });
}
