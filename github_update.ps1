﻿# 실마리 (Sysmex TS Guide) — GitHub 갱신 (Windows PowerShell)
#
#   .\github_update.ps1
#
# 이미 만들어 둔 저장소에 **바뀐 파일만** 올린다.
# git 이 깔려 있지 않아도 된다 — GitHub API 로만 동작한다.
# 토큰은 이 PC 밖으로 나가지 않고, 어디에도 저장하지 않는다.
#
# 쓰는 법
#   1. 받은 zip 을 풀고, 그 폴더 안에 이 파일을 둔다
#      (폴더 안에 index.html 이나 data 폴더가 보여야 한다)
#   2. 폴더에서 마우스 오른쪽 → "터미널에서 열기" 또는 PowerShell 실행
#   3. .\github_update.ps1
#
# 토큰은 한 번만 넣으면 이 PC 에 안전하게 기억해 둘 수 있다(물어본다).
# 지우려면  .\github_update.ps1 -forget
#
# 토큰 발급 (한 번만, 90일)
#   https://github.com/settings/tokens?type=beta → Generate new token
#   · Repository access: Only select repositories → sysmex-ts
#   · Permissions → Contents: Read and write   (이것 하나면 된다)
#   화면에 나온 github_pat_... 를 복사해 둔다. 창을 벗어나면 다시 못 본다.
#
# 이 스크립트는 지우지 않는다 — 올리고 덮어쓸 뿐이다.
# 저장소에만 있고 이 폴더에 없는 파일은 그대로 남으며, 끝에 목록으로 알려 준다.

# ※ 이 파일은 반드시 UTF-8 BOM 으로 저장한다.
#    BOM 이 없으면 Windows PowerShell 5.1 이 CP949 로 읽어 한글이 깨지고,
#    깨진 글자가 따옴표 짝을 무너뜨려 "':' 종결자가 없습니다" 류의 ParserError 가 난다.

$ErrorActionPreference = 'Stop'
if ($PSScriptRoot) { Set-Location $PSScriptRoot }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ── 올릴 것이 맞는 폴더인가 ───────────────────────────
$targets = @('index.html', 'data', 'sw.js', 'js', 'css', 'fonts',
             'manifest.webmanifest', 'icons', 'robots.txt', '.nojekyll')
$found = @($targets | Where-Object { Test-Path -LiteralPath $_ })
if ($found.Count -eq 0) {
    Write-Host "이 폴더에 올릴 것이 없습니다." -ForegroundColor Red
    Write-Host "현재 위치: $((Get-Location).Path)"
    Write-Host "받은 zip 을 푼 폴더(안에 index.html 이나 data 폴더가 있는 곳)에 이 파일을 두고 실행하십시오."
    Read-Host "엔터를 누르면 닫습니다"; exit 1
}

# ── 입력 ──────────────────────────────────────────────
$repo = Read-Host "저장소 이름 (엔터 = sysmex-ts)"
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = 'sysmex-ts' }
$repo = $repo.Trim()

# 토큰 보관 — 갱신할 때마다 다시 찾아 붙여넣지 않게.
#
# Windows 의 DPAPI 로 잠가서 둔다 (Export-Clixml 이 SecureString 에 쓰는 방식).
# **이 PC 의 이 사용자 계정으로 로그인해야만** 풀린다. 파일을 복사해 가도
# 다른 PC·다른 계정에서는 못 읽는다. 배포 폴더 바깥(LOCALAPPDATA)에 두어
# zip 이나 저장소에 딸려 나갈 일이 없다.
$store = Join-Path $env:LOCALAPPDATA 'silmari'
$tokenFile = Join-Path $store 'token.xml'

if ($args -contains '-forget' -or $args -contains '-Forget') {
    if (Test-Path -LiteralPath $tokenFile) {
        Remove-Item -LiteralPath $tokenFile -Force
        Write-Host "저장해 둔 토큰을 지웠습니다." -ForegroundColor Yellow
    } else { Write-Host "저장해 둔 토큰이 없습니다." }
    Read-Host "엔터를 누르면 닫습니다"; exit 0
}

$sec = $null
$fromStore = $false
if (Test-Path -LiteralPath $tokenFile) {
    try { $sec = Import-Clixml -LiteralPath $tokenFile; $fromStore = $true }
    catch { $sec = $null }
    if ($fromStore) {
        Write-Host "이 PC 에 저장해 둔 토큰을 씁니다. (지우려면 .\github_update.ps1 -forget)" `
                   -ForegroundColor DarkGray
    }
}
if (-not $sec) {
    $sec = Read-Host "GitHub Token (화면에 보이지 않습니다)" -AsSecureString
}
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "토큰이 비어 있습니다." -ForegroundColor Red
    Read-Host "엔터를 누르면 닫습니다"; exit 1
}
$token = $token.Trim()

$H = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json';
        'User-Agent' = 'silmari-update'; 'X-GitHub-Api-Version' = '2022-11-28' }

function Api($method, $url, $body) {
    $req = @{ Method = $method; Uri = "https://api.github.com$url"; Headers = $H }
    if ($body) {
        # 한글이 섞여도 깨지지 않게 UTF-8 로 직접 바꿔 보낸다 (PowerShell 5.1 대응)
        $json = ConvertTo-Json -InputObject $body -Depth 12 -Compress
        $req.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $req.ContentType = 'application/json; charset=utf-8'
    }
    Invoke-RestMethod @req
}

# git 이 파일을 식별하는 방식 그대로 계산한다 — 같은 파일은 다시 올리지 않기 위해
function Get-GitBlobSha([string]$path) {
    $bytes  = [IO.File]::ReadAllBytes($path)
    $header = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)`0")
    $all    = New-Object byte[] ($header.Length + $bytes.Length)
    [Array]::Copy($header, 0, $all, 0, $header.Length)
    [Array]::Copy($bytes, 0, $all, $header.Length, $bytes.Length)
    $sha1 = [Security.Cryptography.SHA1]::Create()
    try { ($sha1.ComputeHash($all) | ForEach-Object { $_.ToString('x2') }) -join '' }
    finally { $sha1.Dispose() }
}

# ── 계정·저장소 확인 ──────────────────────────────────
try { $owner = (Api GET '/user').login }
catch {
    Write-Host "토큰이 올바르지 않거나 만료됐습니다." -ForegroundColor Red
    if ($fromStore) {
        Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
        Write-Host "저장해 둔 토큰을 지웠습니다. 새 토큰을 발급해 다시 실행하십시오." `
                   -ForegroundColor Yellow
        Write-Host "  https://github.com/settings/personal-access-tokens/new"
    }
    Read-Host "엔터를 누르면 닫습니다"; exit 1
}
Write-Host "GitHub 계정: $owner" -ForegroundColor Cyan

# 토큰이 실제로 통한 것을 확인한 뒤에만 저장을 권한다
if (-not $fromStore) {
    $ans = Read-Host "이 토큰을 이 PC 에 기억해 둘까요? 다음부터 안 물어봅니다 (y/N)"
    if ($ans -match '^[yY]') {
        New-Item -ItemType Directory -Force -Path $store | Out-Null
        $sec | Export-Clixml -LiteralPath $tokenFile
        Write-Host "기억했습니다 — 이 PC 의 이 계정에서만 풀립니다." -ForegroundColor DarkGray
        Write-Host "  $tokenFile" -ForegroundColor DarkGray
    }
}

try { $info = Api GET "/repos/$owner/$repo" }
catch {
    Write-Host "저장소 $owner/$repo 에 접근할 수 없습니다." -ForegroundColor Red
    Write-Host "  · 저장소 이름이 맞는지"
    Write-Host "  · 토큰의 Repository access 에 이 저장소가 들어 있는지"
    Write-Host "  · Permissions 에 Contents: Read and write 가 있는지 확인하십시오."
    Read-Host "엔터를 누르면 닫습니다"; exit 1
}
$branch = $info.default_branch
Write-Host "저장소 $owner/$repo · 브랜치 $branch"

# ── 올릴 파일 모으기 ──────────────────────────────────
# 안내문(.md)·스크립트·zip 은 올리지 않는다. 파일 이름 대신 확장자로 거른다 —
# 한글 파일명을 코드에 적으면 인코딩이 어긋났을 때 그 줄부터 깨진다.
$skipExt = @('.md', '.zip', '.ps1', '.sh', '.bat', '.cmd')
$files = @(Get-ChildItem -Recurse -File -Force | Where-Object {
    $_.FullName -notmatch '(\\|/)\.git(\\|/)' -and
    $skipExt -notcontains $_.Extension.ToLower() -and
    @('desktop.ini', 'Thumbs.db', '.DS_Store') -notcontains $_.Name
})
if ($files.Count -eq 0) {
    Write-Host "올릴 파일이 없습니다." -ForegroundColor Red
    Read-Host "엔터를 누르면 닫습니다"; exit 1
}
Write-Host "이 폴더의 파일 $($files.Count)개"

# ── 원격의 현재 상태와 비교 ───────────────────────────
$ref  = Api GET "/repos/$owner/$repo/git/ref/heads/$branch"
$head = $ref.object.sha
$tree = Api GET "/repos/$owner/$repo/git/trees/$head`?recursive=1"
$remote = @{}
if ($tree.truncated) {
    Write-Host "저장소가 커서 목록을 다 받지 못했습니다. 전부 다시 올립니다." -ForegroundColor Yellow
} else {
    foreach ($t in $tree.tree) { if ($t.type -eq 'blob') { $remote[$t.path] = $t.sha } }
}

$root = (Get-Location).Path.TrimEnd('\', '/')
$changed = @()
$localPaths = @{}
foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length).TrimStart('\', '/') -replace '\\', '/'
    $localPaths[$rel] = $true
    if ($remote[$rel] -ne (Get-GitBlobSha $f.FullName)) {
        $changed += [pscustomobject]@{ Path = $rel; File = $f.FullName }
    }
}

$onlyRemote = @($remote.Keys | Where-Object { -not $localPaths.ContainsKey($_) } | Sort-Object)

if ($changed.Count -eq 0) {
    Write-Host "`n바뀐 파일이 없습니다. 이미 최신입니다." -ForegroundColor Green
    Write-Host "주소: https://$owner.github.io/$repo/"
    Read-Host "엔터를 누르면 닫습니다"; exit 0
}
Write-Host "`n바뀐 파일 $($changed.Count)개:" -ForegroundColor Yellow
$changed | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.Path)" }
if ($changed.Count -gt 20) { Write-Host "  ... 외 $($changed.Count - 20)개" }

# ── blob 으로 올린 뒤 한 번에 커밋 ────────────────────
$newTree = New-Object System.Collections.ArrayList
$i = 0
foreach ($c in $changed) {
    $i++
    Write-Progress -Activity "업로드" -Status $c.Path -PercentComplete ($i * 100 / $changed.Count)
    $b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($c.File))
    $blob = Api POST "/repos/$owner/$repo/git/blobs" @{ content = $b64; encoding = 'base64' }
    [void]$newTree.Add(@{ path = $c.Path; mode = '100644'; type = 'blob'; sha = $blob.sha })
}
Write-Progress -Activity "업로드" -Completed

$base   = Api GET "/repos/$owner/$repo/git/commits/$head"
$treeN  = Api POST "/repos/$owner/$repo/git/trees" @{
    base_tree = $base.tree.sha; tree = [object[]]$newTree.ToArray() }
$commit = Api POST "/repos/$owner/$repo/git/commits" @{
    message = "실마리 갱신 ($(Get-Date -Format 'yyyy-MM-dd HH:mm')) — 파일 $($changed.Count)개"
    tree    = $treeN.sha
    parents = [object[]]@($head) }
Api PATCH "/repos/$owner/$repo/git/refs/heads/$branch" @{ sha = $commit.sha } | Out-Null
Write-Host "업로드 완료 — 커밋 $($commit.sha.Substring(0,7))" -ForegroundColor Green

if ($onlyRemote.Count -gt 0) {
    Write-Host "`n저장소에만 있고 이 폴더에 없는 파일 $($onlyRemote.Count)개 (그대로 뒀습니다):" -ForegroundColor DarkGray
    $onlyRemote | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

# ── 반영될 때까지 확인 ────────────────────────────────
$url = "https://$owner.github.io/$repo/"
Write-Host "`n주소: $url" -ForegroundColor Cyan
Write-Host "GitHub 가 반영하는 데 1~2분 걸립니다. 확인 중..."
for ($n = 1; $n -le 18; $n++) {
    Start-Sleep -Seconds 10
    try {
        if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) {
            Write-Host "`n반영됐습니다 → $url" -ForegroundColor Green
            Write-Host "휴대폰에서 앱을 완전히 종료했다가 다시 열면 새 내용이 받아집니다."
            Read-Host "엔터를 누르면 닫습니다"; exit 0
        }
    } catch { Write-Host "." -NoNewline }
}
Write-Host "`n아직 반영 중입니다. 몇 분 뒤 $url 을 열어 보십시오." -ForegroundColor Yellow
Read-Host "엔터를 누르면 닫습니다"
