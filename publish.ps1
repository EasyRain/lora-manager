# 一条命令发版：编译打包 -> 建 Release -> 上传附件
#
# 用法:
#   $env:GH_TOKEN = "ghp_xxx"        # 需要 repo 权限
#   powershell -File publish.ps1 -Version 0.1.4
#
# 可选:
#   -NotesFile notes.md   自定义发布说明（缺省用内置模板）
#   -Repo owner/name      默认从 git remote 推断
#   -Draft                发草稿（不公开，适合先自己看一眼）
#   -SkipBuild            复用 release/ 里已有的 zip
#   -NoProxy              不走代理

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$NotesFile = "",
    [string]$Repo = "",
    [string]$Token = $env:GH_TOKEN,
    [string]$Proxy = "http://127.0.0.1:7890",
    [switch]$Draft,
    [switch]$SkipBuild,
    [switch]$NoProxy
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Fail($msg) { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ---------- 1. 前置检查 ----------
if (-not $Token) {
    # 没在环境里就给个提示，别默默失败
    $Token = [Environment]::GetEnvironmentVariable("GH_TOKEN", "User")
}
if (-not $Token) { Fail "缺少 GH_TOKEN（环境变量或 -Token 参数），需要 repo 权限" }

if (-not $Repo) {
    $url = (git -C $root remote get-url origin 2>$null)
    if ($url -match "github\.com[:/]([^/]+/[^/]+?)(\.git)?$") { $Repo = $Matches[1] }
    if (-not $Repo) { Fail "推断不出仓库，用 -Repo owner/name 指定" }
}

$dirty = (git -C $root status --porcelain)
if ($dirty) { Write-Host "! 工作区有未提交的改动，发布会和源码不一致" -ForegroundColor Yellow }

$head = (git -C $root rev-parse --short HEAD)
Push-Location $root
$behind = (git status -sb 2>$null | Select-Object -First 1)
Pop-Location
Write-Host "仓库   : $Repo"
Write-Host "版本   : v$Version"
Write-Host "提交   : $head"

# ---------- 2. 打包 ----------
$zip = Join-Path $root ("release\lora-manager-" + $Version + ".zip")
if (-not $SkipBuild) {
    Write-Host "`n>> 编译打包..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "build-release.ps1") -Version $Version | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail "打包失败" }
}
if (-not (Test-Path $zip)) { Fail "找不到 $zip" }

$sha = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
$sizeMB = "{0:N1}" -f ((Get-Item $zip).Length / 1MB)
Write-Host "包     : $zip ($sizeMB MB)"
Write-Host "sha256 : $sha"

# ---------- 3. 发布说明 ----------
if ($NotesFile -and (Test-Path $NotesFile)) {
    $body = Get-Content $NotesFile -Raw -Encoding UTF8
} else {
    $body = @"
解压即用：解压后双击 ``LoRA管理器.exe``。

**需要 .NET 10 桌面运行时**：https://dotnet.microsoft.com/download/dotnet/10.0

### 更新

（发版前把这一段换成实际改动）

### 未签名 / Unsigned

发布包没有做代码签名。第一次运行时 SmartScreen 会拦：点「更多信息」→「仍要运行」。

Click *More info* → *Run anyway* on first launch.

``````
SHA256  $sha
``````
"@
}
if ($body -notmatch "SHA256") { $body = $body + "`n``````nSHA256  $sha`n```````n" }

# ---------- 4. 建 Release ----------
$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = "application/vnd.github+json"
    "User-Agent"           = "lora-manager-publish"
}
$base = "https://api.github.com/repos/$Repo"
$common = @{}
if (-not $NoProxy) { $common.Proxy = $Proxy }

$payload = @{
    tag_name   = "v$Version"
    name       = "LoRA 管理器 v$Version"
    body       = $body
    draft      = [bool]$Draft
    prerelease = $false
} | ConvertTo-Json -Depth 5

Write-Host "`n>> 创建 Release..."
try {
    $rel = Invoke-RestMethod -Uri "$base/releases" -Method Post -Headers $headers `
        -ContentType "application/json; charset=utf-8" `
        -Body ([Text.Encoding]::UTF8.GetBytes($payload)) @common
} catch {
    $resp = $_.Exception.Response
    $bodyText = ""
    if ($resp) {
        try {
            $sr = New-Object IO.StreamReader($resp.GetResponseStream())
            $bodyText = $sr.ReadToEnd()
        } catch { }
    }
    if ($resp -and $resp.StatusCode.value__ -eq 422 -and $bodyText -match "already_exists") {
        Fail "v$Version 的 tag 已经存在；先在网页上删掉那个 release/tag，或换个版本号"
    }
    Fail ("创建失败: " + $_.Exception.Message + "`n" + $bodyText)
}
Write-Host "已创建 #$($rel.id)"

# ---------- 5. 传附件 ----------
Write-Host ">> 上传附件..."
# 不用 upload_url 模板，直接按 id 拼，省得处理 {?name,label}
$upload = "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$(Split-Path $zip -Leaf)"
$asset = Invoke-RestMethod -Uri $upload -Method Post -Headers $headers `
    -ContentType "application/zip" -InFile $zip @common

Write-Host ("`n✓ {0}" -f $(if ($Draft) { "草稿已保存" } else { "发布完成" })) -ForegroundColor Green
Write-Host "  页面: $($rel.html_url)"
Write-Host "  附件: $($asset.browser_download_url)"
Write-Host "  大小: $($asset.size) 字节"
Write-Host "  sha256: $sha"
