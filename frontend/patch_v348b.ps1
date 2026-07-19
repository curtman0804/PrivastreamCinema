# patch_v348b_kill_hotpath_logs.ps1 (fix: PS wildcards in [type]/[id])
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v348b$(Get-Random)"

$idPath  = 'app\details\[type]\[id].tsx'
$discPath = 'app\(tabs)\discover.tsx'

Write-Host "[V348b] Killing hot-path debug logs" -ForegroundColor Cyan

# Backup with -LiteralPath so [type]/[id] aren't treated as wildcards
if (Test-Path -LiteralPath $idPath)  { Copy-Item -LiteralPath $idPath   -Destination "$idPath.bak.v348b"  -Force }
if (Test-Path -LiteralPath $discPath) { Copy-Item -LiteralPath $discPath -Destination "$discPath.bak.v348b" -Force }

# Download to a temp filename first, then move with -LiteralPath (avoids wildcard issue)
$tmpId = "$env:TEMP\v348b_id.tsx"
$tmpDisc = "$env:TEMP\v348b_discover.tsx"

Invoke-WebRequest -Uri "$base/v348b_id.tsx$bust"       -OutFile $tmpId  -UseBasicParsing
Move-Item -LiteralPath $tmpId  -Destination $idPath  -Force
Write-Host "  wrote $idPath" -ForegroundColor Green

Invoke-WebRequest -Uri "$base/v348b_discover.tsx$bust" -OutFile $tmpDisc -UseBasicParsing
Move-Item -LiteralPath $tmpDisc -Destination $discPath -Force
Write-Host "  wrote $discPath" -ForegroundColor Green

Write-Host ""
Write-Host "[V348b] Done. Next: deploy_ota.bat" -ForegroundColor Cyan
