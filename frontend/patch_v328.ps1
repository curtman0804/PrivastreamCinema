# patch_v328_tos_auto_username.ps1
# Replaces src/components/ToSGate.tsx with the V328 auto-username build.
# - Pulls username from useAuthStore (Zustand) — no manual input.
# - Gold theme + visible D-pad focus ring (white border, gold glow).
# - POSTs { username } only (matches V327 backend).

$ErrorActionPreference = 'Stop'

$Root = (Get-Location).Path
$Target = Join-Path $Root 'frontend\src\components\ToSGate.tsx'
$Url = 'https://api.privastreamsolutions.com/api/raw/ToSGate.tsx?bust=v328'

Write-Host "[V328] Patching $Target" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $Root 'frontend'))) {
  Write-Host "ERROR: Run this from the project root (the folder that contains 'frontend\')." -ForegroundColor Red
  exit 1
}

# Ensure components folder exists
$ComponentsDir = Split-Path $Target -Parent
if (-not (Test-Path $ComponentsDir)) {
  New-Item -ItemType Directory -Force -Path $ComponentsDir | Out-Null
}

# Backup current ToSGate.tsx (if any)
if (Test-Path $Target) {
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $Backup = "$Target.bak_$stamp"
  Copy-Item $Target $Backup -Force
  Write-Host "  backup -> $Backup" -ForegroundColor DarkGray
}

# Download fresh ToSGate.tsx from backend
Write-Host "  downloading $Url" -ForegroundColor DarkGray
curl.exe -fsSL $Url -o $Target
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: curl failed to fetch ToSGate.tsx" -ForegroundColor Red
  exit 1
}

# Sanity-check that the new file references useAuthStore
$content = Get-Content $Target -Raw
if ($content -notmatch "useAuthStore") {
  Write-Host "ERROR: downloaded file does not contain 'useAuthStore'. Aborting." -ForegroundColor Red
  exit 1
}
if ($content -match "TextInput") {
  Write-Host "WARN: downloaded file still contains TextInput; check the source." -ForegroundColor Yellow
}

Write-Host "[V328] ToSGate.tsx updated (auto-username, gold focus ring)." -ForegroundColor Green
Write-Host "Next: run your OTA deploy (deploy_ota.bat) and test on Firestick." -ForegroundColor Yellow
