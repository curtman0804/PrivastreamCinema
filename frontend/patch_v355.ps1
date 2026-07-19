# patch_v355_healthy_torrent_fallbacks.ps1
# THE ACTUAL REAL FIX. All the previous fallback fixes touched fallbackStreams
# (used for direct URL streams). Torrentio streams have infoHash → they go
# through the DIFFERENT fallbackTorrents path which was capped at 20 and NOT
# sorted by seeders. That's why cascade cycled through dead torrents.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v355$(Get-Random)"
$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V355] REAL FIX - fallbackTorrents path (used by Torrentio streams)" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v355" -Force }

$tmp = "$env:TEMP\v355_id.tsx"
Invoke-WebRequest -Uri "$base/v355_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V355] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "CHANGES:" -ForegroundColor Cyan
Write-Host "  * fallbackTorrents cap: 20 -> 60"
Write-Host "  * Sorted by seeders DESC (healthy torrents tried first)"
Write-Host "  * Healthy (>=10 seeds) first, unhealthy after"
Write-Host ""
Write-Host "After deploy_ota + force-close + reopen (2x) - check logcat:" -ForegroundColor Yellow
Write-Host "  adb logcat -d ReactNativeJS:V *:S | findstr /I ""V355 torrent fallbacks"""
Write-Host "You should see:  [V355] torrent fallbacks: healthy=NNN unhealthy=NNN"
