# patch_v351_tpb_boost_retrykill.ps1
# V351 — Playback + navigation lag fixes
#   1. Ranker: TPB source +2000 boost; seeder scaling up to +500 (was 240)
#   2. Client: skip retry for /api/addon-proxy/tpb/* (kills 4.5s stalls)
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v351$(Get-Random)"

$idPath   = 'app\details\[type]\[id].tsx'
$cliPath  = 'src\api\client.ts'

Write-Host "[V351] TPB boost + retry kill" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath)  { Copy-Item -LiteralPath $idPath  -Destination "$idPath.bak.v351"  -Force }
if (Test-Path -LiteralPath $cliPath) { Copy-Item -LiteralPath $cliPath -Destination "$cliPath.bak.v351" -Force }

$tmpId  = "$env:TEMP\v351_id.tsx"
$tmpCli = "$env:TEMP\v351_client.ts"

Invoke-WebRequest -Uri "$base/v351_id.tsx$bust"     -OutFile $tmpId  -UseBasicParsing
Move-Item -LiteralPath $tmpId  -Destination $idPath  -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Invoke-WebRequest -Uri "$base/v351_client.ts$bust" -OutFile $tmpCli -UseBasicParsing
Move-Item -LiteralPath $tmpCli -Destination $cliPath -Force
Write-Host "  wrote $cliPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V351] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "WHAT CHANGED:" -ForegroundColor Cyan
Write-Host "  * TPB streams and high-seed streams float to top of auto-play"
Write-Host "  * Broken TPB proxy no longer retries 3x - fails instantly"
Write-Host "  * Should reduce click-to-playback lag by ~4-5 seconds"
