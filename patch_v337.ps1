# patch_v337_cam_and_bait_robust.ps1
# Replaces V334's narrow CAM filter with a robust V337 multi-field bait detector.
# V337:
#   - normalizes stream name/title/filename (lowercase, collapse \\n, \r, whitespace)
#   - drops CAM/HDCAM/TS/TC/TELESYNC/CAMRip/TSRip/TCRip/WORKPRINT/SCREENER/R5
#   - drops bait domains in the URL field (1xbet, melbet, betway, mostbet, etc.)
#   - LOGS every drop with the matched reason

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\details\[type]\[id].tsx'

Write-Host "[V337] Patching $Target" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Target)) {
  Write-Host "ERROR: $Target not found" -ForegroundColor Red; exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v337_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V337_ROBUST_BAIT_FILTER') {
  Write-Host "[V337] Already patched. Skipping." -ForegroundColor Yellow
  exit 0
}

# Anchor: the V334 block we want to replace (everything from V334 marker to the line before V157_FILTER_APPLIED)
# We do a simpler approach: insert V337 right BEFORE the existing V334 comment line, and let V337's
# logic do the real work. We don't need to physically remove V334 since V337 will pre-drop anything
# V334 would have caught.
$anchor = '  // V334_HARD_DROP_CAM'
if ($content -notmatch [regex]::Escape($anchor)) {
  Write-Host "ERROR: V334 anchor not found - is V334 applied?" -ForegroundColor Red; exit 1
}

$injection = @'
  // V337_ROBUST_BAIT_FILTER — fixes V334 misses by checking multiple fields and
  // normalizing the input. V334 only checked stream.name and assumed real
  // newlines; real Torrentio streams sometimes carry literal '\n' sequences
  // (escaped) instead of '\n' (newline char), which slipped past V334.
  //
  // V337 also drops bait DOMAINS in the URL itself (1xbet/melbet/etc.) in case
  // a bait stream's metadata is laundered clean but the URL still points at
  // an affiliate redirector.
  const _v337_normalize = (s: any): string => {
    return String(s || '')
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\r|\n|\t/g, ' ')
      .replace(/[\[\]\(\)\|\.\-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .trim();
  };
  const _V337_CAM_TOKENS = ['cam', 'hdcam', 'camrip', 'cam rip', 'hdts', 'hd ts', 'hdtc', 'hd tc', 'telesync', 'tsrip', 'ts rip', 'tcrip', 'tc rip', 'workprint', 'preair', 'screener', 'dvdscr', 'r5'];
  const _V337_BAIT_DOMAINS = /(1xbet|1xstavka|melbet|mostbet|parimatch|4rabet|dafabet|22bet|betway|bet365|stake\.com|olymptrade)/i;
  const _v337_isBait = (s: any): { bad: boolean; reason: string } => {
    const nameN  = _v337_normalize(s?.name);
    const titleN = _v337_normalize(s?.title);
    const fileN  = _v337_normalize(s?.filename);
    const url    = String(s?.url || '');
    // Look for CAM-class tokens as whole-word tokens in any normalized field.
    const blob = ' ' + nameN + ' | ' + titleN + ' | ' + fileN + ' ';
    for (const tok of _V337_CAM_TOKENS) {
      if (blob.indexOf(' ' + tok + ' ') !== -1) return { bad: true, reason: 'CAM:' + tok };
    }
    if (_V337_BAIT_DOMAINS.test(url))   return { bad: true, reason: 'bait-url-domain' };
    if (_V337_BAIT_DOMAINS.test(blob))  return { bad: true, reason: 'bait-name-mention' };
    return { bad: false, reason: '' };
  };
  {
    const _v337_before = streams.length;
    const _v337_kept: any[] = [];
    for (const s of streams) {
      const v = _v337_isBait(s);
      if (v.bad) {
        console.log('[v337 DROP]', v.reason, '|', String(s?.name || '').slice(0, 80).replace(/\s+/g, ' '));
      } else {
        _v337_kept.push(s);
      }
    }
    if (_v337_kept.length !== _v337_before) {
      console.log('[v337] kept', _v337_kept.length, 'of', _v337_before, 'streams');
    }
    streams = _v337_kept;
  }

'@

# Insert V337 BEFORE V334. V334 still runs as a defense-in-depth backup but its work is now done by V337.
$content = $content.Replace($anchor, $injection + $anchor)

if ($content -notmatch 'V337_ROBUST_BAIT_FILTER') {
  Write-Host "ERROR: insertion failed" -ForegroundColor Red; exit 1
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V337] Patched. Run deploy_ota.bat next." -ForegroundColor Green
