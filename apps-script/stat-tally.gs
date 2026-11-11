/**
 * 실마리 사용·피드백 집계 (silmari-ts RTDB /stat → 구글 시트)
 *
 * 읽는 곳: /stat/{날짜}/{push id} = {a: 기기 해시, t: 날짜, v: [이벤트…]}
 *   이벤트: open {k,t,v} · view {k,t,d,e} · fb {k,t,d,e,r}  (r = y 이 조치대로 · o 다른 조치 · n 해결 안 됨)
 * 쓰는 곳: 이 스크립트가 붙은 구글 시트의 「일별」·「Error별」 탭 (DB 에는 아무것도 쓰지 않음)
 *
 * 스크립트 속성(설정 → 스크립트 속성)에만 둔다 — 채팅·저장소 금지:
 *   SA_JSON  서비스 계정 키 JSON 전체 (silmari-ts, 역할: Firebase Realtime Database 뷰어 이상)
 *   DB_URL   예: https://silmari-ts-default-rtdb.asia-southeast1.firebasedatabase.app
 * 기기 해시(a)는 시트에 올리지 않고 기기 수만 센다.
 */

var STAT_DAYS_ = 3; // 매일 돌 때 다시 계산하는 최근 날짜 수(늦게 도착한 이벤트 보정)

/** 매일 한 번 돌리는 진입점 */
function dailyTally() { tallyDays_(lastDays_(STAT_DAYS_)); }

/** 처음 한 번: 지난 n일(기본 30) 채우기 — 편집기에서 backfill30() 실행 */
function backfill30() { tallyDays_(lastDays_(30)); }

/** 한 번만 실행: 매일 오전 6시대 트리거 만들기 */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyTally') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyTally').timeBased().everyDays(1).atHour(6).inTimezone('Asia/Seoul').create();
}

// ---------- 집계(순수 함수 — tests/stat_tally.js 가 시험) ----------

/** 하루치 {id:{a,t,v:[…]}} → {day:{…}, errors:[…]} */
function aggregateDay_(date, raw) {
  var devs = {}, openDevs = {}, rows = {};
  var day = { date: date, opens: 0, devices: 0, views: 0, fb: 0 };
  Object.keys(raw || {}).forEach(function (id) {
    var rec = raw[id];
    if (!rec || !rec.v) return;
    var a = String(rec.a || '');
    var list = Array.isArray(rec.v) ? rec.v : Object.keys(rec.v).map(function (k) { return rec.v[k]; });
    list.forEach(function (ev) {
      if (!ev || !ev.k) return;
      devs[a] = 1;
      if (ev.k === 'open') { day.opens++; openDevs[a] = 1; return; }
      if (ev.k !== 'view' && ev.k !== 'fb') return;
      var key = (ev.d || '') + '\u0001' + (ev.e || '');
      var r = rows[key] || (rows[key] = { date: date, dev: ev.d || '', err: ev.e || '', views: 0, viewDevs: {}, y: 0, o: 0, n: 0 });
      if (ev.k === 'view') { day.views++; r.views++; r.viewDevs[a] = 1; return; }
      day.fb++;
      if (ev.r === 'y' || ev.r === 'o' || ev.r === 'n') r[ev.r]++;
    });
  });
  day.devices = Object.keys(devs).length;
  var errors = Object.keys(rows).map(function (k) {
    var r = rows[k];
    return { date: r.date, dev: r.dev, err: r.err, views: r.views, viewDevs: Object.keys(r.viewDevs).length, y: r.y, o: r.o, n: r.n };
  }).sort(function (x, y) { return (y.views + y.y + y.o + y.n) - (x.views + x.y + x.o + x.n); });
  return { day: day, errors: errors };
}

// ---------- 시트·DB ----------

function tallyDays_(dates) {
  var token = accessToken_();
  var base = String(prop_('DB_URL')).replace(/\/$/, '');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sd = sheet_(ss, '일별', ['날짜', '접속(열기)', '사용 기기', '조회', '피드백']);
  var se = sheet_(ss, 'Error별', ['날짜', '장비', 'Error', '조회', '조회 기기', '이 조치대로', '다른 조치', '해결 안 됨']);
  var dayRows = [], errRows = [];
  dates.forEach(function (date) {
    var res = UrlFetchApp.fetch(base + '/stat/' + date + '.json?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('stat ' + date + ' 읽기 실패 ' + res.getResponseCode());
    var agg = aggregateDay_(date, JSON.parse(res.getContentText()));
    var d = agg.day;
    dayRows.push([d.date, d.opens, d.devices, d.views, d.fb]);
    agg.errors.forEach(function (r) { errRows.push([r.date, r.dev, r.err, r.views, r.viewDevs, r.y, r.o, r.n]); });
  });
  replaceDates_(sd, dates, dayRows, 5);
  replaceDates_(se, dates, errRows, 8);
}

/** 같은 날짜의 기존 행을 지우고 새로 쓴다(여러 번 돌려도 중복 없음) */
function replaceDates_(sh, dates, rows, cols) {
  var set = {}; dates.forEach(function (d) { set[d] = 1; });
  var last = sh.getLastRow();
  var keep = [];
  if (last > 1) {
    sh.getRange(2, 1, last - 1, cols).getValues().forEach(function (r) {
      var d = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Seoul', 'yyyy-MM-dd') : String(r[0]);
      if (!set[d]) { r[0] = d; keep.push(r); }
    });
    sh.getRange(2, 1, last - 1, cols).clearContent();
  }
  var all = keep.concat(rows).sort(function (a, b) { return a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0; });
  if (all.length) {
    sh.getRange(2, 1, all.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, all.length, cols).setValues(all);
  }
}

function sheet_(ss, name, head) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function lastDays_(n) {
  var out = [], now = new Date();
  for (var i = 0; i < n; i++) out.push(Utilities.formatDate(new Date(now.getTime() - i * 86400000), 'Asia/Seoul', 'yyyy-MM-dd'));
  return out;
}

// ---------- 서비스 계정 인증(키는 스크립트 속성에만) ----------

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw new Error('스크립트 속성 ' + k + ' 이(가) 없습니다');
  return v;
}

function accessToken_() {
  var cache = CacheService.getScriptCache(), hit = cache.get('stat-token');
  if (hit) return hit;
  var sa = JSON.parse(prop_('SA_JSON'));
  var now = Math.floor(Date.now() / 1000);
  var b64 = function (o) { return Utilities.base64EncodeWebSafe(typeof o === 'string' ? o : JSON.stringify(o)).replace(/=+$/, ''); };
  var head = b64({ alg: 'RS256', typ: 'JWT' });
  var claim = b64({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  var sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.private_key)).replace(/=+$/, '');
  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }
  });
  if (res.getResponseCode() !== 200) throw new Error('토큰 발급 실패 ' + res.getResponseCode());
  var tok = JSON.parse(res.getContentText()).access_token;
  cache.put('stat-token', tok, 3000);
  return tok;
}
