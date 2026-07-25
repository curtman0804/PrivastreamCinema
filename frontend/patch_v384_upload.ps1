# ============================================================================
# patch_v384_upload.ps1 - upload details [id].tsx (bracket-safe, NO app changes)
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

$base = 'https://expo-android-tv.preview.emergentagent.com'

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V384 [id].tsx Upload (bracket-safe)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Find every file literally named [id].tsx without wildcard interpretation
$hits = Get-ChildItem -Path 'app' -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -eq '[id].tsx' }

if (-not $hits -or @($hits).Count -eq 0) {
  Write-Host "[FATAL] No [id].tsx found under app\. CWD = $(Get-Location)" -ForegroundColor Red
  exit 1
}

foreach ($f in $hits) {
  $rel = $f.FullName.Replace((Get-Location).Path + '\', '')
  $flat = 'v384__' + ($rel -replace '[\\\/]', '__') -replace '[\[\]]', ''
  try {
    # Read bytes with .NET (no wildcard globbing on the path)
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    Invoke-RestMethod -Uri "$base/api/upload/$flat" -Method Post -Body $bytes -ContentType 'application/octet-stream' | Out-Null
    Write-Host "[OK] Uploaded $rel -> $flat" -ForegroundColor Green
  } catch {
    Write-Host "[FAIL] $rel : $($_.Exception.Message)" -ForegroundColor Red
  }
}

Write-Host ""
Write-Host "Done. Tell the agent the upload finished." -ForegroundColor Cyan
Write-Host ""
