# patch_v352_massive_fallback.ps1
# Widens fallback pool from 20 proxy-only streams to 60 all-types.
# Player will now cascade through 60 URLs before giving up on Play button.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v352$(Get-Random)"
$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V352] Massive fallback URL list - Play button never gives up" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v352" -Force }

$tmp = "$env:TEMP\v352_id.tsx"
Invoke-WebRequest -Uri "$base/v352_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V352] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
