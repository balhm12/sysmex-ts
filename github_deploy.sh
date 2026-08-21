#!/usr/bin/env bash
# GitHub Pages 로 한 번에 올린다 (macOS · Linux · Git Bash)
#
#   ./github_deploy.sh
#
# 파일을 올리고, Pages 를 켜고, 주소가 살아날 때까지 지켜본다.
# 저장소는 먼저 https://github.com/new 에서 만들어 두십시오
# ('Add a README file' 을 체크해서 만듭니다).
#
# git 없이 GitHub API 로만 동작한다. 필요한 것: curl, python3, Personal Access Token
set -euo pipefail
cd "$(dirname "$0")"

read -rp "저장소 이름 (엔터 = sysmex-ts): " REPO
REPO=${REPO:-sysmex-ts}
read -rsp "GitHub Token (화면에 보이지 않습니다): " TOKEN; echo
[ -n "$TOKEN" ] || { echo "토큰이 비어 있습니다."; exit 1; }

api() {  # api METHOD PATH [JSON]
  local m=$1 p=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -X "$m" -H "Authorization: Bearer $TOKEN" \
         -H "Accept: application/vnd.github+json" \
         -H "Content-Type: application/json" -d "$body" "https://api.github.com$p"
  else
    curl -sS -X "$m" -H "Authorization: Bearer $TOKEN" \
         -H "Accept: application/vnd.github+json" "https://api.github.com$p"
  fi
}
jget() { python3 -c "import json,sys;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1"; }

[ -f index.html ] || { echo "이 폴더에 index.html 이 없습니다. 배포 킷을 푼 폴더에서 실행하십시오."; exit 1; }
if [ ! -f data/_auth.json ]; then
  echo "주의: 데이터가 잠겨 있지 않습니다. 주소를 아는 사람은 누구나 볼 수 있게 됩니다."
  read -rp "그래도 올릴까요? (y/N) " a; [ "$a" = y ] || exit 1
fi

OWNER=$(api GET /user | jget login)
[ -n "$OWNER" ] || { echo "토큰이 올바르지 않습니다."; exit 1; }
echo "GitHub 계정: $OWNER"

# 저장소를 만드는 것은 웹에서 한다. 토큰에 저장소 생성 권한까지 주면
# 그 토큰이 계정 전체에 손댈 수 있게 되고, fine-grained 토큰으로는 막히기도 한다.
if api GET "/repos/$OWNER/$REPO" | grep -q '"full_name"'; then
  echo "저장소 $OWNER/$REPO 를 찾았습니다."
else
  echo
  echo "저장소 $OWNER/$REPO 가 없습니다."
  echo "  1) https://github.com/new 에서 만드십시오"
  echo "     - Repository name: $REPO"
  echo "     - Public 선택"
  echo "     - 'Add a README file' 체크  ← 체크해야 합니다"
  echo "  2) 만든 뒤 이 스크립트를 다시 실행하십시오"
  exit 1
fi

# 기본 브랜치 이름은 계정 설정에 따라 다르다 (main 또는 master)
BRANCH=$(api GET "/repos/$OWNER/$REPO" | jget default_branch)
echo "기본 브랜치: $BRANCH"

# 파일을 blob 으로 올리고 트리를 만들어 한 번에 커밋한다
python3 - "$OWNER" "$REPO" "$TOKEN" "$BRANCH" <<'PY'
import base64, datetime, json, os, sys, urllib.request

owner, repo, token, branch = sys.argv[1:5]
API = 'https://api.github.com'
SKIP = {'github_deploy.ps1', 'github_deploy.sh', '배포절차.md', '설치안내.md'}


def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json', 'User-Agent': 'sysmex-ts-deploy'})
    with urllib.request.urlopen(r) as f:
        return json.load(f)


files = []
for root, dirs, names in os.walk('.'):
    dirs[:] = [d for d in dirs if d != '.git']
    for n in names:
        if n in SKIP:
            continue
        p = os.path.join(root, n)
        files.append((os.path.relpath(p, '.').replace(os.sep, '/'), p))

print(f'올릴 파일 {len(files)}개')
tree = []
for i, (rel, p) in enumerate(sorted(files), 1):
    b64 = base64.b64encode(open(p, 'rb').read()).decode()
    sha = api('POST', f'/repos/{owner}/{repo}/git/blobs',
              {'content': b64, 'encoding': 'base64'})['sha']
    tree.append({'path': rel, 'mode': '100644', 'type': 'blob', 'sha': sha})
    print(f'  [{i}/{len(files)}] {rel}')

ref = api('GET', f'/repos/{owner}/{repo}/git/ref/heads/{branch}')
base = api('GET', f"/repos/{owner}/{repo}/git/commits/{ref['object']['sha']}")
nt = api('POST', f'/repos/{owner}/{repo}/git/trees',
         {'base_tree': base['tree']['sha'], 'tree': tree})
c = api('POST', f'/repos/{owner}/{repo}/git/commits', {
    'message': '모바일 가이드 배포 (' +
               datetime.datetime.now().strftime('%Y-%m-%d %H:%M') + ')',
    'tree': nt['sha'], 'parents': [ref['object']['sha']]})
api('PATCH', f'/repos/{owner}/{repo}/git/refs/heads/{branch}', {'sha': c['sha']})
print('파일 업로드 완료')
PY

api POST "/repos/$OWNER/$REPO/pages" "{\"source\":{\"branch\":\"$BRANCH\",\"path\":\"/\"}}" >/dev/null 2>&1 \
  && echo "Pages 를 켰습니다." || echo "Pages 는 이미 켜져 있습니다."

URL="https://$OWNER.github.io/$REPO/"
echo; echo "주소: $URL"
echo "첫 배포는 1~2분 걸립니다. 확인 중..."
for _ in $(seq 1 24); do
  sleep 10
  if [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL")" = 200 ]; then
    echo; echo "열렸습니다 → $URL"
    echo "휴대폰으로 이 주소를 열고, 설치안내.md 대로 홈 화면에 추가하십시오."
    exit 0
  fi
  printf '.'
done
echo; echo "아직 준비 중입니다. 몇 분 뒤 $URL 을 열어 보십시오."
