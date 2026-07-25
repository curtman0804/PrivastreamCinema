# ============================================================================
# patch_v383_upload.ps1 - upload player.tsx + details [id].tsx for review
# (NO app changes, NO OTA - needed to write the single-loading-screen fix
# against your real code. The v381 uploader missed [id].tsx because
# PowerShell treats [id] as a wildcard - this one matches literally.)
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

$base = 'https://expo-android-tv.preview.emergentagent.com'
$wanted = @('player.tsx', '[id].tsx', 'ServiceRow.tsx')

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V383 Player File Upload" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$files = Get-ChildItem -Path 'src','app' -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Where-Object { $wanted -contains $_.Name }

if (-not $files -or @($files).Count -eq 0) {
  Write-Host "[FATAL] No matching files found. CWD = $(Get-Location)" -ForegroundColor Red
  exit 1
}

foreach ($f in $files) {
  $rel = $f.FullName.Replace((Get-Location).Path + '\', '')
  $flat = 'v383__' + ($rel -replace '[\\\/]', '__')
  try {
    Invoke-RestMethod -Uri "$base/api/upload/$flat" -Method Post -InFile $f.FullName -ContentType 'text/plain' | Out-Null
    Write-Host "[OK] Uploaded $rel" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $rel : $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Done. Tell the agent the upload finished." -ForegroundColor Cyan
Write-Host ""
