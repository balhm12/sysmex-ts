# GitHub Pages 로 한 번에 올린다 (Windows PowerShell)
#
#   .\github_deploy.ps1
#
# 파일을 올리고, Pages 를 켜고, 주소가 살아날 때까지 지켜본다.
# git 이 깔려 있지 않아도 된다 — GitHub API 로만 동작한다.
#
# 먼저 https://github.com/new 에서 저장소를 만들어 두십시오
# ('Add a README file' 을 체크해서 만듭니다)
#
# 필요한 것: Personal Access Token — 그 저장소에 대해 Contents · Pages 쓰기 권한
#            (발급 방법은 배포절차.md 의 2-A-1)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# ── 입력 ──────────────────────────────────────────────
$repo = Read-Host "저장소 이름 (엔터 = sysmex-ts)"
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = 'sysmex-ts' }

$tokenSecure = Read-Host "GitHub Token (화면에 보이지 않습니다)" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure))
if ([string]::IsNullOrWhiteSpace($token)) { throw "토큰이 비어 있습니다." }

$H = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json';
        'User-Agent' = 'sysmex-ts-deploy' }

function Api($method, $url, $body) {
    # $args 는 PowerShell 자동 변수라 쓰지 않는다
    $req = @{ Method = $method; Uri = "https://api.github.com$url"; Headers = $H }
    if ($body) {
        # 한글이 섞여도 깨지지 않게 UTF-8 로 직접 바꿔 보낸다 (PowerShell 5.1 대응)
        $json = $body | ConvertTo-Json -Depth 10 -Compress
        $req.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $req.ContentType = 'application/json; charset=utf-8'
    }
    Invoke-RestMethod @req
}

# ── 0. 올릴 것이 준비됐는지 ────────────────────────────
if (-not (Test-Path 'index.html')) {
    throw "이 폴더에 index.html 이 없습니다. 배포 킷(zip)을 푼 폴더에서 실행하십시오."
}
if (-not (Test-Path 'data\_auth.json')) {
    Write-Host "주의: 데이터가 잠겨 있지 않습니다. 주소를 아는 사람은 누구나 볼 수 있게 됩니다." -ForegroundColor Yellow
    if ((Read-Host "그래도 올릴까요? (y/N)") -ne 'y') { exit 1 }
}

# ── 1. 내가 누구인가 ──────────────────────────────────
$owner = (Api GET '/user').login
Write-Host "GitHub 계정: $owner" -ForegroundColor Cyan

# ── 2. 저장소 확인 ────────────────────────────────────
# 저장소를 만드는 것은 웹에서 한다. 토큰에 저장소 생성 권한까지 주면
# 그 토큰이 계정 전체에 손댈 수 있게 되고, fine-grained 토큰으로는 막히기도 한다.
try {
    Api GET "/repos/$owner/$repo" | Out-Null
    Write-Host "저장소 $owner/$repo 를 찾았습니다."
} catch {
    Write-Host ""
    Write-Host "저장소 $owner/$repo 가 없습니다." -ForegroundColor Yellow
    Write-Host "  1) https://github.com/new 에서 만드십시오"
    Write-Host "     - Repository name: $repo"
    Write-Host "     - Public 선택"
    Write-Host "     - 'Add a README file' 체크  ← 체크해야 합니다"
    Write-Host "  2) 만든 뒤 이 스크립트를 다시 실행하십시오"
    exit 1
}

# 기본 브랜치 이름은 계정 설정에 따라 다르다 (main 또는 master)
$branch = (Api GET "/repos/$owner/$repo").default_branch
Write-Host "기본 브랜치: $branch"

# ── 3. 파일 모으기 ────────────────────────────────────
# 문서와 이 스크립트는 앱 동작에 필요 없다. 한글 파일명이 API 를 타면서 깨지는 일도 막는다.
$skip = @('github_deploy.ps1', 'github_deploy.sh', '배포절차.md', '설치안내.md')
$files = Get-ChildItem -Recurse -File | Where-Object {
    $_.FullName -notmatch '\\\.git\\' -and $skip -notcontains $_.Name
}
Write-Host "올릴 파일 $($files.Count)개"

# ── 4. blob 으로 올린 뒤 한 번에 커밋 ─────────────────
# 파일을 하나씩 커밋하면 히스토리가 지저분해지고 느리다. 트리를 만들어 한 번에 넣는다.
$tree = @()
$i = 0
foreach ($f in $files) {
    $i++
    $rel = (Resolve-Path -Relative $f.FullName) -replace '^\.\\', '' -replace '\\', '/'
    Write-Progress -Activity "업로드" -Status $rel -PercentComplete ($i * 100 / $files.Count)
    $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f.FullName))
    $blob = Api POST "/repos/$owner/$repo/git/blobs" @{ content = $b64; encoding = 'base64' }
    $tree += @{ path = $rel; mode = '100644'; type = 'blob'; sha = $blob.sha }
}
Write-Progress -Activity "업로드" -Completed

try {
    $ref = Api GET "/repos/$owner/$repo/git/ref/heads/$branch"
} catch {
    throw "저장소가 비어 있습니다. GitHub 저장소 화면에서 'Add a README file' 로 파일을 하나 만든 뒤 다시 실행하십시오."
}
$base = Api GET "/repos/$owner/$repo/git/commits/$($ref.object.sha)"
$newTree = Api POST "/repos/$owner/$repo/git/trees" @{ base_tree = $base.tree.sha; tree = $tree }
$commit = Api POST "/repos/$owner/$repo/git/commits" @{
    message = "모바일 가이드 배포 ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
    tree = $newTree.sha; parents = @($ref.object.sha) }
Api PATCH "/repos/$owner/$repo/git/refs/heads/$branch" @{ sha = $commit.sha } | Out-Null
Write-Host "파일 업로드 완료" -ForegroundColor Green

# ── 5. Pages 켜기 ─────────────────────────────────────
try {
    Api POST "/repos/$owner/$repo/pages" @{ source = @{ branch = $branch; path = '/' } } | Out-Null
    Write-Host "Pages 를 켰습니다." -ForegroundColor Green
} catch {
    Write-Host "Pages 는 이미 켜져 있습니다."
}

# ── 6. 주소가 살아날 때까지 기다린다 ──────────────────
$url = "https://$owner.github.io/$repo/"
Write-Host "`n주소: $url" -ForegroundColor Cyan
Write-Host "첫 배포는 1~2분 걸립니다. 확인 중..."
for ($n = 1; $n -le 24; $n++) {
    Start-Sleep -Seconds 10
    try {
        if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) {
            Write-Host "`n열렸습니다 → $url" -ForegroundColor Green
            Write-Host "휴대폰으로 이 주소를 열고, 설치안내.md 대로 홈 화면에 추가하십시오."
            exit 0
        }
    } catch { Write-Host "." -NoNewline }
}
Write-Host "`n아직 준비 중입니다. 몇 분 뒤 $url 을 열어 보십시오." -ForegroundColor Yellow
Write-Host "저장소 Settings > Pages 에서 상태를 볼 수 있습니다."
