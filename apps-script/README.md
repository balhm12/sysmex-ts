# 실마리 사용·피드백 집계 (stat-tally.gs)

silmari-ts RTDB `/stat` 을 매일 읽어 구글 시트에 쌓는다. DB 에는 쓰지 않고, 기기 해시는 시트에 올리지 않는다(기기 수만).

## 설정 (한 번)
1. 집계용 구글 시트를 새로 만들고 확장 프로그램 → Apps Script 에 `stat-tally.gs` 를 붙여 넣는다.
2. Firebase 콘솔 silmari-ts → 프로젝트 설정 → 서비스 계정에서 키(JSON)를 만들고, IAM 에서 그 계정에 **Firebase Realtime Database 뷰어** 이상을 준다.
3. Apps Script 설정 → 스크립트 속성에 `SA_JSON`(키 JSON 전체), `DB_URL`(`https://silmari-ts-default-rtdb.asia-southeast1.firebasedatabase.app`)을 넣는다. **키는 채팅·저장소에 올리지 않는다.**
4. 편집기에서 `backfill30` 을 한 번 실행(지난 30일 채움), 이어서 `installDailyTrigger` 를 한 번 실행(매일 오전 6시대).

## 시트
- `일별`: 날짜 · 접속(열기) · 사용 기기 · 조회 · 피드백
- `Error별`: 날짜 · 장비 · Error · 조회 · 조회 기기 · 이 조치대로 · 다른 조치 · 해결 안 됨
같은 날짜는 다시 돌려도 덮어써서 중복되지 않는다(최근 3일을 매일 다시 계산).

시험: `node tests/stat_tally.js`
