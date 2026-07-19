# patch_v348_simple.ps1 - V348 MMKV-alternative filesystem cache
# NO here-strings, just downloads 3 files.
$ErrorActionPreference = 'Stop'
$base = 'https://git-update-staging.preview.emergentagent.com/api/raw'
$bust = "?bust=v348simple$(Get-Random)"

Write-Host "[V348] Downloading blobCache.ts, patched cache.ts, patched contentStore.ts" -ForegroundColor Cyan

# Backup existing files if present
if (Test-Path 'src\utils\blobCache.ts') { Copy-Item 'src\utils\blobCache.ts' 'src\utils\blobCache.ts.bak.v348' -Force }
if (Test-Path 'src\utils\cache.ts')     { Copy-Item 'src\utils\cache.ts'     'src\utils\cache.ts.bak.v348'     -Force }
if (Test-Path 'src\store\contentStore.ts') { Copy-Item 'src\store\contentStore.ts' 'src\store\contentStore.ts.bak.v348' -Force }

# Download each file
Invoke-WebRequest -Uri "$base/v348_blobCache.ts$bust"     -OutFile 'src\utils\blobCache.ts'    -UseBasicParsing
Write-Host "  wrote src\utils\blobCache.ts" -ForegroundColor Green

Invoke-WebRequest -Uri "$base/v348_cache.ts$bust"         -OutFile 'src\utils\cache.ts'       -UseBasicParsing
Write-Host "  wrote src\utils\cache.ts" -ForegroundColor Green

Invoke-WebRequest -Uri "$base/v348_contentStore.ts$bust"  -OutFile 'src\store\contentStore.ts' -UseBasicParsing
Write-Host "  wrote src\store\contentStore.ts" -ForegroundColor Green

Write-Host ""
Write-Host "[V348] Done. Next: run deploy_ota.bat" -ForegroundColor Cyan
