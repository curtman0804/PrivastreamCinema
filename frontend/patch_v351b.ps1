# patch_v351b_hdr_nuke.ps1 - HDR penalty -3000 -> -8000 so 1080p SDR wins auto-play
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v351b$(Get-Random)"

$idPath = 'app\details\[type]\[id].tsx'

Write-Host "[V351b] HDR nuke - 1080p SDR wins auto-play" -ForegroundColor Cyan

if (Test-Path -LiteralPath $idPath) { Copy-Item -LiteralPath $idPath -Destination "$idPath.bak.v351b" -Force }

$tmp = "$env:TEMP\v351b_id.tsx"
Invoke-WebRequest -Uri "$base/v351b_id.tsx$bust" -OutFile $tmp -UseBasicParsing
Move-Item -LiteralPath $tmp -Destination $idPath -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V351b] Done. Run: deploy_ota.bat" -ForegroundColor Cyan
