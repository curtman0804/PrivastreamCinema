# patch_v356_play_uses_ranker.ps1
# THE ROOT-CAUSE FIX. Play button was ignoring the V354 ranker and
# scanning for URL-first streams (often dead RD links) instead of using
# sortedStreams[0]. Now respects the ranker's top pick.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v356$(Get-Random)"
$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V356] Play button now trusts ranker top pick" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v356" -Force }

$tmp = "$env:TEMP\v356_id.tsx"
Invoke-WebRequest -Uri "$base/v356_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V356] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
