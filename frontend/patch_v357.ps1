# patch_v357.ps1 — V357 Playback Fast-Cascade + Diagnostic Logs
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V357 Playback + Nav Lag Fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# --- id.tsx ---
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) { Write-Host "[FATAL] $idPath not found." -ForegroundColor Red; exit 1 }
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

$oldPartition = @'
    const _v141_cached = parsed.filter((p) => !!p.stream.url);
    const _v141_uncached = parsed.filter((p) => !p.stream.url);
    _v141_cached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
    _v141_uncached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
    parsed.length = 0;
    for (const p of _v141_cached) parsed.push(p);
    for (const p of _v141_uncached) parsed.push(p);
'@

$newPartition = @'
    // V357_SDR_HARD_PARTITION - SDR always beats HDR regardless of quality/seeders.
    const _v357_isHdr = (p) => !!(p && p.info && p.info.isHDR);
    const _v357_cSdr = parsed.filter((p) => !!p.stream.url && !_v357_isHdr(p));
    const _v357_cHdr = parsed.filter((p) => !!p.stream.url && _v357_isHdr(p));
    const _v357_uSdr = parsed.filter((p) => !p.stream.url && !_v357_isHdr(p));
    const _v357_uHdr = parsed.filter((p) => !p.stream.url && _v357_isHdr(p));
    const _v357_sortScore = (a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream);
    _v357_cSdr.sort(_v357_sortScore);
    _v357_cHdr.sort(_v357_sortScore);
    _v357_uSdr.sort(_v357_sortScore);
    _v357_uHdr.sort(_v357_sortScore);
    parsed.length = 0;
    for (const p of _v357_cSdr) parsed.push(p);
    for (const p of _v357_cHdr) parsed.push(p);
    for (const p of _v357_uSdr) parsed.push(p);
    for (const p of _v357_uHdr) parsed.push(p);
    console.log('[V357 PARTITION]',
      'cached_sdr=' + _v357_cSdr.length,
      'cached_hdr=' + _v357_cHdr.length,
      'uncached_sdr=' + _v357_uSdr.length,
      'uncached_hdr=' + _v357_uHdr.length,
    );
'@

if ($id.Contains($oldPartition)) {
  $id = $id.Replace($oldPartition, $newPartition)
  Write-Host "  [OK]   SDR/HDR hard partition applied" -ForegroundColor Green
} elseif ($id.Contains('V357_SDR_HARD_PARTITION')) {
  Write-Host "  [NOOP] SDR/HDR partition already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] SDR/HDR partition anchor NOT FOUND" -ForegroundColor Yellow
}

$oldLog = "false && console.log('[SORT v141] picked top:'"
$newLog = "console.log('[SORT v141_V357] picked top:'"
if ($id.Contains($oldLog)) {
  $id = $id.Replace($oldLog, $newLog)
  Write-Host "  [OK]   v141 SORT log enabled" -ForegroundColor Green
} elseif ($id.Contains("SORT v141_V357")) {
  Write-Host "  [NOOP] v141 SORT log already enabled" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] v141 SORT log anchor NOT FOUND" -ForegroundColor Yellow
}

if ($id -ne $idOrig) {
  [System.IO.File]::WriteAllText($idAbs, $id)
  Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] $idPath unchanged" -ForegroundColor DarkGray
}

# --- player.tsx ---
$plPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $plPath)) { Write-Host "[FATAL] $plPath not found." -ForegroundColor Red; exit 1 }
$plAbs = (Resolve-Path -LiteralPath $plPath).Path
$pl = [System.IO.File]::ReadAllText($plAbs)
$plOrig = $pl

$oldRetry = @'
                    // Retry aggressively - torrent data arrives progressively, each retry may succeed
                    if (videoRetryCountRef.current < maxVideoRetries) {
'@

$newRetry = @'
                    // V357_FAST_CASCADE - directUrl (cached PM/RD) errors skip retry loop
                    if (directUrl && !infoHash) {
                      const _v357_fbLeft = Math.max(0, (fallbackUrls?.length || 0) - (currentStreamIndex + 1));
                      const _v357_torLeft = (torrentFallbacksRef.current?.length || 0) + (torrentFallbacks?.length || 0);
                      console.log('[V357 CASCADE] directUrl failed - fbUrlsLeft=' + _v357_fbLeft + ' torrentsLeft=' + _v357_torLeft);
                      videoRetryCountRef.current = 0;
                      if (_v357_fbLeft > 0) {
                        tryNextStream();
                      } else if (_v357_torLeft > 0) {
                        tryNextFallbackTorrent();
                      } else {
                        console.log('[V357 CASCADE] exhausted - surfacing error');
                        setError('Stream unavailable. Try a different source.');
                        setIsLoading(false);
                      }
                      return;
                    }
                    // Retry aggressively - torrent data arrives progressively, each retry may succeed
                    if (videoRetryCountRef.current < maxVideoRetries) {
'@

if ($pl.Contains($oldRetry)) {
  $pl = $pl.Replace($oldRetry, $newRetry)
  Write-Host "  [OK]   V357_FAST_CASCADE applied" -ForegroundColor Green
} elseif ($pl.Contains('V357_FAST_CASCADE')) {
  Write-Host "  [NOOP] V357_FAST_CASCADE already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] player.tsx retry anchor NOT FOUND" -ForegroundColor Yellow
}

$oldTryNext = @'
    // Try next fallback stream
    const tryNextStream = () => {
      if (fallbackUrls.length > currentStreamIndex + 1) {
        const nextIndex = currentStreamIndex + 1;
        console.log(`[PLAYER] Trying fallback stream ${nextIndex + 1}/${fallbackUrls.length}`);
'@

$newTryNext = @'
    // Try next fallback stream
    const tryNextStream = () => {
      if (fallbackUrls.length > currentStreamIndex + 1) {
        const nextIndex = currentStreamIndex + 1;
        console.log(`[V357/PLAYER] tryNextStream ${nextIndex + 1}/${fallbackUrls.length} url=${String(fallbackUrls[nextIndex]).slice(0,80)}`);
'@

if ($pl.Contains($oldTryNext)) {
  $pl = $pl.Replace($oldTryNext, $newTryNext)
  Write-Host "  [OK]   V357 tryNextStream verbose log added" -ForegroundColor Green
} elseif ($pl.Contains('V357/PLAYER] tryNextStream')) {
  Write-Host "  [NOOP] V357 tryNextStream log already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] tryNextStream anchor NOT FOUND" -ForegroundColor Yellow
}

if ($pl -ne $plOrig) {
  [System.IO.File]::WriteAllText($plAbs, $pl)
  Write-Host "  [WRITE] $plPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] $plPath unchanged" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Verification:" -ForegroundColor Cyan
Write-Host ("  id.tsx     SDR/HDR partition hits : " + (Select-String -LiteralPath $idPath -Pattern 'V357_SDR_HARD_PARTITION' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  id.tsx     v141 SORT log hits     : " + (Select-String -LiteralPath $idPath -Pattern 'SORT v141_V357' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  player.tsx V357_FAST_CASCADE hits : " + (Select-String -LiteralPath $plPath -Pattern 'V357_FAST_CASCADE' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  player.tsx tryNextStream log hits : " + (Select-String -LiteralPath $plPath -Pattern 'V357/PLAYER] tryNextStream' -SimpleMatch).Count) -ForegroundColor Green

Write-Host ""
Write-Host "Next: deploy_ota.bat  then tap Play on Endgame  then adb logcat" -ForegroundColor Yellow