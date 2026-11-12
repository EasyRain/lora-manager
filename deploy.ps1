# 本地开发部署：编译 -> 覆盖安装目录 -> 重启 -> 校验文件真的换了
# 用法: powershell -File deploy.ps1 [-NoSign]
param([switch]$NoSign)

$ErrorActionPreference = 'Stop'
$root  = $PSScriptRoot
$dest  = Join-Path $env:LOCALAPPDATA 'Programs\LoraManager'
$thumb = 'B172AADEFC8E843C48ADCE48AD0F729612D6DC79'

if (-not (Test-Path $dest)) { throw "安装目录不存在: $dest" }

# 1. 编译
Push-Location (Join-Path $root 'shell')
dotnet publish -c Release -r win-x64 --self-contained false -o out -v q --nologo
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'dotnet publish 失败' }
Pop-Location

$built = Join-Path $root 'shell\out'

# 2. 停掉正在跑的实例
Get-Process | Where-Object { $_.Path -like "$dest\*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# 3. 覆盖文件（web 整个换掉，避免残留旧文件）
Copy-Item (Join-Path $built 'PromptNotebook.exe') (Join-Path $dest 'LoRA管理器.exe') -Force
Copy-Item (Join-Path $built '*.dll')  $dest -Force
Copy-Item (Join-Path $built '*.json') $dest -Force
Remove-Item (Join-Path $dest 'web') -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $root 'web') $dest -Recurse

# 4. 签名（本机装的是签过的；发布包不签）
if (-not $NoSign) {
    $signtool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
    if (-not $signtool) {
        $signtool = (Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
                     Where-Object { $_.FullName -like '*x64*' } | Select-Object -First 1).FullName
    }
    if ($signtool) {
        & $signtool sign /sha1 $thumb /fd SHA256 /d "LoRA Manager" (Join-Path $dest 'LoRA管理器.exe') | Out-Null
        "signature : " + (Get-AuthenticodeSignature (Join-Path $dest 'LoRA管理器.exe')).Status
    } else {
        "signature : 跳过（找不到 signtool）"
    }
}

# 5. 校验：刚更新的前端文件必须一致
$srcJs = (Get-FileHash (Join-Path $root 'web\app.js') -Algorithm SHA256).Hash
$dstJs = (Get-FileHash (Join-Path $dest 'web\app.js') -Algorithm SHA256).Hash
if ($srcJs -ne $dstJs) { throw "部署校验失败：app.js 没换掉" }
"verify    : web\app.js 一致 $($srcJs.Substring(0,12))"

# 6. 启动
Start-Process -FilePath (Join-Path $dest 'LoRA管理器.exe') -WorkingDirectory $dest
"started"
