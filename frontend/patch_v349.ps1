# patch_v349_stremio_tricks.ps1
# Trick #2: defer stream sort with InteractionManager.runAfterInteractions
# This is THE big Stremio-inspired win — details page paints INSTANTLY,
# sort runs in background after nav animation. No JS thread block on click.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v349$(Get-Random)"

$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V349] Stremio trick: deferred stream sort" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v349" -Force }

$tmpId = "$env:TEMP\v349_id.tsx"
Invoke-WebRequest -Uri "$base/v349_id.tsx$bust" -OutFile $tmpId -UseBasicParsing
Move-Item -LiteralPath $tmpId -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V349] Done. Next: deploy_ota.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "WHAT CHANGED:" -ForegroundColor Cyan
Write-Host "  * Stream sort no longer blocks navigation animation"
Write-Host "  * Details page paints instantly with unsorted streams"
Write-Host "  * Sort runs in background, list re-orders when done"
Write-Host "  * Back button feels instant (sort not blocking unmount)"
