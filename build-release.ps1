# 打一个不含签名的发布包：dotnet publish + 组装 + zip + sha256
# 用法: powershell -File build-release.ps1 -Version 0.1.0
param([string]$Version = "0.1.0")

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out  = Join-Path $root 'release'
$pkg  = Join-Path $out ("lora-manager-" + $Version)

if (Test-Path $pkg) { Remove-Item $pkg -Recurse -Force }
New-Item -ItemType Directory -Path $pkg -Force | Out-Null

Push-Location (Join-Path $root 'shell')
dotnet publish -c Release -r win-x64 --self-contained false -o out -v q --nologo
Pop-Location

$built = Join-Path $root 'shell\out'
Copy-Item (Join-Path $built 'PromptNotebook.exe') (Join-Path $pkg 'LoRA管理器.exe')
Copy-Item (Join-Path $built '*.dll')  $pkg
Copy-Item (Join-Path $built '*.json') $pkg
Copy-Item (Join-Path $root 'web')     (Join-Path $pkg 'web') -Recurse
Copy-Item (Join-Path $root 'LICENSE') $pkg
Copy-Item (Join-Path $root 'START.txt') $pkg
New-Item -ItemType Directory -Path (Join-Path $pkg 'data\images') -Force | Out-Null

# 确认没被签过名（别把本机的自签名证书带出去）
$sig = Get-AuthenticodeSignature (Join-Path $pkg 'LoRA管理器.exe')
"signature status: " + $sig.Status

$zip = $pkg + ".zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path $pkg -DestinationPath $zip -CompressionLevel Optimal

$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"package : " + $zip
"size    : {0:N1} MB" -f ((Get-Item $zip).Length / 1MB)
"sha256  : " + $hash
