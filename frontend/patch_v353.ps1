# patch_v353_pm_directdl_fallbacks.ps1
# CRITICAL FIX: V299 + V300 PM-directdl branches were pushing to /player
# WITHOUT fallbackStreams param → player had 0 fallbacks → any 30s timeout
# hit hard "Stream timed out" error with no cascade. V353 fixes this.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v353$(Get-Random)"
$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V353] CRITICAL: add fallback URLs to PM-directdl branches" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v353" -Force }

$tmp = "$env:TEMP\v353_id.tsx"
Invoke-WebRequest -Uri "$base/v353_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V353] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "WHAT CHANGED:" -ForegroundColor Cyan
Write-Host "  * PM cache-resolve paths (V299/V300) now pass 60 fallback URLs"
Write-Host "  * If PM direct link fails, cascade tries next 60 streams"
Write-Host "  * Play button will now hunt through streams until one works"
Write-Host "  * User sees loading spinner during cascade, player when playing"
