# patch_v334_drop_cam_quality.ps1  (v334b — fixed LiteralPath handling)

$ErrorActionPreference = 'Stop'

$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\details\[type]\[id].tsx'

Write-Host "[V334] Patching $Target" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Target)) {
  Write-Host "ERROR: $Target not found" -ForegroundColor Red
  exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = "$Target.bak_v334_$stamp"
Copy-Item -LiteralPath $Target -Destination $Backup -Force
Write-Host "  backup -> $Backup" -ForegroundColor DarkGray

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V334_HARD_DROP_CAM') {
  Write-Host "[V334] Already patched. Skipping." -ForegroundColor Yellow
  exit 0
}

$anchor = '  // V157_FILTER_APPLIED'
if ($content -notmatch [regex]::Escape($anchor)) {
  Write-Host "ERROR: Anchor '$anchor' not found in id.tsx. Patch aborted." -ForegroundColor Red
  exit 1
}

$injection = @'
  // V334_HARD_DROP_CAM — unconditionally drop CAM/HDCAM/TS/TC/TELESYNC/WORKPRINT/
  // SCR/DVDSCR quality streams. Unlike V296 (which keeps watermarked streams as
  // last-resort fallback), V334 hard-drops them. Reasoning: CAM-class streams
  // are 100% bait for unreleased titles (1xbet overlays burned in) and Premiumize
  // cannot resolve them — they cause 30-sec "stream timeout" errors.
  const _V334_CAM_QUALITY_RE = /(?:^|\n|\[|\||\s)(cam|hdcam|cam-?rip|camrip|hd-?ts|hdtc|telesync|tsrip|tcrip|workprint|preair|scr|dvdscr|screener|r5)(?:\s|\n|\]|\||$)/i;
  {
    const _v334_before = streams.length;
    streams = streams.filter((s: any) => {
      const name = String(s?.name || '');
      return !_V334_CAM_QUALITY_RE.test(name);
    });
    if (_v334_before !== streams.length) {
      console.log('[v334] dropped', _v334_before - streams.length, 'CAM-quality streams (of', _v334_before + ')');
    }
  }

'@

$replacement = $injection + $anchor
$content = $content.Replace($anchor, $replacement)

if ($content -notmatch 'V334_HARD_DROP_CAM') {
  Write-Host "ERROR: Replace step did not insert the patch. Aborting." -ForegroundColor Red
  exit 1
}

Set-Content -LiteralPath $Target -Value $content -NoNewline

Write-Host "[V334] id.tsx patched. CAM-class streams will be hard-dropped." -ForegroundColor Green
