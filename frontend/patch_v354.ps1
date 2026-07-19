# patch_v354_healthy_seeders.ps1
# THE REAL FIX. Root cause: auto-play was picking streams with 2 seeders.
# Backend's torrent-video endpoint needs peers to stream. Low seeds = dead.
# V354 nukes low-seed streams from ranker + filters fallback pool to
# well-seeded torrents first.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v354$(Get-Random)"
$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V354] The real fix - only healthy torrents win Play button" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v354" -Force }

$tmp = "$env:TEMP\v354_id.tsx"
Invoke-WebRequest -Uri "$base/v354_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V354] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "CHANGES:" -ForegroundColor Cyan
Write-Host "  * <3 seeders = -10000 (dead torrents banished from auto-play)"
Write-Host "  * Seeder scaling boost: log(seeds)*320 up to +1200"
Write-Host "  * Fallback pool sorted by seeders DESC, healthy (>=5) first"
Write-Host "  * Pool widened 60 -> 80"
