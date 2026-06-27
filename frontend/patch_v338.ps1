# patch_v338_restore_hdr_dv_penalty.ps1
# Restores the V272/V150 HDR + Dolby Vision PENALTIES that V319 accidentally
# inverted into BONUSES. On Firesticks (and any display whose tone-mapping
# is imperfect), HDR/DV encodes look washed-out / dark — so SDR must win.
#
# V338 changes:
#   if (!info.isHDR) s += 0; else s += 500;   →   if (!info.isHDR) s += 0; else s -= 3000;
#   if (_v272IsDV) s += 200;                  →   if (_v272IsDV) s -= 1500;
# Net effect: a 1080p SDR WEB-DL now beats a 4K DV BluRay on the scoring,
# so the picker selects the version that actually looks bright and correct.

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\details\[type]\[id].tsx'

Write-Host "[V338] Patching $Target" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Target)) { Write-Host "ERROR: not found" -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v338_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V338_RESTORE_HDR_PENALTY') {
  Write-Host "[V338] Already patched. Skipping." -ForegroundColor Yellow; exit 0
}

# --- 1) HDR line ---
$oldHDR = '/* V319_QUALITY_FIRST */ if (!info.isHDR) s += 0; else s += 500;'
$newHDR = '/* V338_RESTORE_HDR_PENALTY */ if (!info.isHDR) s += 0; else s -= 3000;'
if ($content.Contains($oldHDR)) {
  $content = $content.Replace($oldHDR, $newHDR)
  Write-Host "  HDR scoring restored: +500 -> -3000" -ForegroundColor Green
} else {
  Write-Host "  WARN: HDR anchor line not found verbatim — already changed?" -ForegroundColor Yellow
}

# --- 2) DV line ---
$oldDV = '/* V319_QUALITY_FIRST */ if (_v272IsDV) s += 200;'
$newDV = '/* V338_RESTORE_DV_PENALTY */ if (_v272IsDV) s -= 1500;'
if ($content.Contains($oldDV)) {
  $content = $content.Replace($oldDV, $newDV)
  Write-Host "  DV scoring restored: +200 -> -1500" -ForegroundColor Green
} else {
  Write-Host "  WARN: DV anchor line not found verbatim — already changed?" -ForegroundColor Yellow
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V338] Done. Now run: deploy_ota.bat" -ForegroundColor Cyan
