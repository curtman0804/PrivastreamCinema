# ============================================================================
# patch_v381_upload.ps1 - upload current frontend files for review (NO app
# changes, NO OTA needed - just sends me your current code so the CW-row
# nav fix + memory-cache patch are written against the REAL files)
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

$base = 'https://expo-android-tv.preview.emergentagent.com'

$wanted = @('discover.tsx', 'ContentCard.tsx', 'contentStore.ts', 'mmkvStorage.ts', '[id].tsx', '_layout.tsx')

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V381 File Upload for Review" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$files = Get-ChildItem -Path 'src','app' -Recurse -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Where-Object { $wanted -contains $_.Name }

foreach ($f in $files) {
  # Build a flat, unique upload name from the relative path
  $rel = $f.FullName.Replace((Get-Location).Path + '\', '')
  $flat = 'v381__' + ($rel -replace '[\\\/]', '__')
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
