# Silmari (Sysmex TS Guide) - GitHub update (Windows PowerShell)
#
#   .\github_update_en.ps1            upload changed files
#   .\github_update_en.ps1 -forget    clear the token saved on this PC
#
# ASCII-only fallback. Use this if the Korean version shows a ParserError
# (that happens when PowerShell 5.1 reads a UTF-8 file as CP949).
#
# Uploads ONLY changed files. No git needed. The token never leaves this PC.
# Run it inside the unzipped folder (the one containing index.html and data).

$ErrorActionPreference = 'Stop'
if ($PSScriptRoot) { Set-Location $PSScriptRoot }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

#
$targets = @('index.html', 'data', 'sw.js', 'js', 'css', 'fonts',
             'manifest.webmanifest', 'icons', 'robots.txt', '.nojekyll')
$found = @($targets | Where-Object { Test-Path -LiteralPath $_ })
if ($found.Count -eq 0) {
    Write-Host "Nothing to upload in this folder." -ForegroundColor Red
    Write-Host "Current folder: $((Get-Location).Path)"
    Write-Host "Put this file in the unzipped folder (the one with index.html / data) and run it there."
    Read-Host "Press Enter to close"; exit 1
}

#
$repo = Read-Host "Repository name (Enter = sysmex-ts)"
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = 'sysmex-ts' }
$repo = $repo.Trim()

#
#
#
#
#
#
$store = Join-Path $env:LOCALAPPDATA 'silmari'
$tokenFile = Join-Path $store 'token.xml'

if ($args -contains '-forget' -or $args -contains '-Forget') {
    if (Test-Path -LiteralPath $tokenFile) {
        Remove-Item -LiteralPath $tokenFile -Force
        Write-Host "Saved token deleted." -ForegroundColor Yellow
    } else { Write-Host "No saved token." }
    Read-Host "Press Enter to close"; exit 0
}

$sec = $null
$fromStore = $false
if (Test-Path -LiteralPath $tokenFile) {
    try { $sec = Import-Clixml -LiteralPath $tokenFile; $fromStore = $true }
    catch { $sec = $null }
    if ($fromStore) {
        Write-Host "Using the token saved on this PC. (clear it with .\github_update_en.ps1 -forget)" `
                   -ForegroundColor DarkGray
    }
}
if (-not $sec) {
    $sec = Read-Host "GitHub Token (input is hidden)" -AsSecureString
}
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "Token is empty." -ForegroundColor Red
    Read-Host "Press Enter to close"; exit 1
}
$token = $token.Trim()

$H = @{ Authorization = "Bearer $token"; Accept = 'application/vnd.github+json';
        'User-Agent' = 'silmari-update'; 'X-GitHub-Api-Version' = '2022-11-28' }

function Api($method, $url, $body) {
    $req = @{ Method = $method; Uri = "https://api.github.com$url"; Headers = $H }
    if ($body) {
        #
        $json = ConvertTo-Json -InputObject $body -Depth 12 -Compress
        $req.Body = [Text.Encoding]::UTF8.GetBytes($json)
        $req.ContentType = 'application/json; charset=utf-8'
    }
    Invoke-RestMethod @req
}

#
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

#
try { $owner = (Api GET '/user').login }
catch {
    Write-Host "Token is invalid or expired." -ForegroundColor Red
    if ($fromStore) {
        Remove-Item -LiteralPath $tokenFile -Force -ErrorAction SilentlyContinue
        Write-Host "Saved token deleted. Issue a new token and run again." `
                   -ForegroundColor Yellow
        Write-Host "  https://github.com/settings/personal-access-tokens/new"
    }
    Read-Host "Press Enter to close"; exit 1
}
Write-Host "GitHub account: $owner" -ForegroundColor Cyan

#
if (-not $fromStore) {
    $ans = Read-Host "Remember this token on this PC? You will not be asked again (y/N)"
    if ($ans -match '^[yY]') {
        New-Item -ItemType Directory -Force -Path $store | Out-Null
        $sec | Export-Clixml -LiteralPath $tokenFile
        Write-Host "Saved - only this Windows account on this PC can decrypt it." -ForegroundColor DarkGray
        Write-Host "  $tokenFile" -ForegroundColor DarkGray
    }
}

try { $info = Api GET "/repos/$owner/$repo" }
catch {
    Write-Host "Cannot access repository $owner/$repo." -ForegroundColor Red
    Write-Host "  - is the repository name correct?"
    Write-Host "  - does the token Repository access include this repo?"
    Write-Host "  - does the token have Contents: Read and write?"
    Read-Host "Press Enter to close"; exit 1
}
$branch = $info.default_branch
Write-Host "Repository $owner/$repo - branch $branch"

#
#
#
$skipExt = @('.md', '.zip', '.ps1', '.sh', '.bat', '.cmd')
$files = @(Get-ChildItem -Recurse -File -Force | Where-Object {
    $_.FullName -notmatch '(\\|/)\.git(\\|/)' -and
    $skipExt -notcontains $_.Extension.ToLower() -and
    @('desktop.ini', 'Thumbs.db', '.DS_Store') -notcontains $_.Name
})
if ($files.Count -eq 0) {
    Write-Host "No files to upload." -ForegroundColor Red
    Read-Host "Press Enter to close"; exit 1
}
Write-Host "Files in this folder: $($files.Count)"

#
$ref  = Api GET "/repos/$owner/$repo/git/ref/heads/$branch"
$head = $ref.object.sha
$tree = Api GET "/repos/$owner/$repo/git/trees/$head`?recursive=1"
$remote = @{}
if ($tree.truncated) {
    Write-Host "Remote tree truncated. Uploading everything." -ForegroundColor Yellow
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
    Write-Host "`nNo changes. Already up to date." -ForegroundColor Green
    Write-Host "URL: https://$owner.github.io/$repo/"
    Read-Host "Press Enter to close"; exit 0
}
Write-Host "`nChanged files: $($changed.Count)" -ForegroundColor Yellow
$changed | Select-Object -First 20 | ForEach-Object { Write-Host "  $($_.Path)" }
if ($changed.Count -gt 20) { Write-Host "  ... and $($changed.Count - 20) more" }

#
$newTree = New-Object System.Collections.ArrayList
$i = 0
foreach ($c in $changed) {
    $i++
    Write-Progress -Activity "Upload" -Status $c.Path -PercentComplete ($i * 100 / $changed.Count)
    $b64  = [Convert]::ToBase64String([IO.File]::ReadAllBytes($c.File))
    $blob = Api POST "/repos/$owner/$repo/git/blobs" @{ content = $b64; encoding = 'base64' }
    [void]$newTree.Add(@{ path = $c.Path; mode = '100644'; type = 'blob'; sha = $blob.sha })
}
Write-Progress -Activity "Upload" -Completed

$base   = Api GET "/repos/$owner/$repo/git/commits/$head"
$treeN  = Api POST "/repos/$owner/$repo/git/trees" @{
    base_tree = $base.tree.sha; tree = [object[]]$newTree.ToArray() }
$commit = Api POST "/repos/$owner/$repo/git/commits" @{
    message = "Silmari update ($(Get-Date -Format 'yyyy-MM-dd HH:mm')) - $($changed.Count) files"
    tree    = $treeN.sha
    parents = [object[]]@($head) }
Api PATCH "/repos/$owner/$repo/git/refs/heads/$branch" @{ sha = $commit.sha } | Out-Null
Write-Host "Upload done - commit $($commit.sha.Substring(0,7))" -ForegroundColor Green

if ($onlyRemote.Count -gt 0) {
    Write-Host "`nOn remote but not in this folder: $($onlyRemote.Count) (left untouched)" -ForegroundColor DarkGray
    $onlyRemote | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

#
$url = "https://$owner.github.io/$repo/"
Write-Host "`nURL: $url" -ForegroundColor Cyan
Write-Host "GitHub Pages takes 1-2 min to publish. Checking..."
for ($n = 1; $n -le 18; $n++) {
    Start-Sleep -Seconds 10
    try {
        if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200) {
            Write-Host "`nPublished -> $url" -ForegroundColor Green
            Write-Host "On the phone: fully close the app and reopen it to get the new build."
            Read-Host "Press Enter to close"; exit 0
        }
    } catch { Write-Host "." -NoNewline }
}
Write-Host "`nStill publishing. Open $url in a few minutes." -ForegroundColor Yellow
Read-Host "Press Enter to close"
