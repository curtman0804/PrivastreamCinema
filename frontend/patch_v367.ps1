# ============================================================================
# patch_v367.ps1 (pure ASCII) - FIX details-screen white-screen crash
#
# Root cause (from white_screen.log, exact):
#   ReferenceError: Property '_v141_cached' doesn't exist  at DetailsScreen
#
# V357 replaced the _v141_cached/_v141_uncached partition variables with the
# SDR/HDR buckets (_v357_cSdr etc.) but the final "picked top" log line still
# referenced the deleted variables. First stream sort on any title throws ->
# React unmounts the details tree -> white screen. This code never ran on the
# device until today because OTA was dead (runtimeVersion mismatch), so V357+
# shipped sight-unseen.
#
# Fix: compute cached/uncached counts from the V357 buckets. Log prefix bumped
# to [SORT v141_V367] which doubles as the bundle-greppable marker.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V367 details white-screen fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) {
  Write-Host "[FATAL] $idPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if ($id.Contains('[SORT v141_V367]')) {
  Write-Host "[SKIP] V367 already applied" -ForegroundColor Yellow
} else {
  $old = @'
    console.log('[SORT v141_V357] picked top:', _topInfo.quality || '?', 'cached=' + (!!_top.stream.url), 'seeders=' + (_topInfo.seeders || 0), 'lang=' + (_topInfo.language || '?'), '| cached_n=' + _v141_cached.length, 'uncached_n=' + _v141_uncached.length);
'@

  $new = @'
    /* V367_FIX_V141_REF_BUILD_TAG - _v141_cached/_v141_uncached were deleted
       by V357's SDR/HDR partition but this log still referenced them ->
       ReferenceError -> details white screen on EVERY title. Counts now come
       from the V357 buckets. */
    console.log('[SORT v141_V367] picked top:', _topInfo.quality || '?', 'cached=' + (!!_top.stream.url), 'seeders=' + (_topInfo.seeders || 0), 'lang=' + (_topInfo.language || '?'), '| cached_n=' + (_v357_cSdr.length + _v357_cHdr.length), 'uncached_n=' + (_v357_uSdr.length + _v357_uHdr.length));
'@

  if (-not $id.Contains($old)) {
    Write-Host "[FATAL] V367 anchor not found (SORT v141_V357 log line drifted)" -ForegroundColor Red
    exit 1
  }
  $id = $id.Replace($old, $new)
  Write-Host "[OK] id.tsx: fixed _v141_cached ReferenceError (details crash)" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($idAbs, $id)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V367 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"SORT v141_V367" app\details\[type]\[id].tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
