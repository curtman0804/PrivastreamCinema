# patch_v358.ps1 — Kill lossless audio (DTS-HD MA, TrueHD, Atmos) + V357 stack
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V358 Lossless Audio Kill + V357 stack" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# --- id.tsx ---
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) { Write-Host "[FATAL] $idPath not found." -ForegroundColor Red; exit 1 }
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

# ============================================================
# V358 CRITICAL: Restore lossless audio penalty (V319 zeroed it)
# ============================================================
$oldAudioPenalty = '/* V319_QUALITY_FIRST */ if (_v158_badAudio) s -= 0;'
$newAudioPenalty = '/* V358_KILL_LOSSLESS */ if (_v158_badAudio) s -= 20000;'
if ($id.Contains($oldAudioPenalty)) {
  $id = $id.Replace($oldAudioPenalty, $newAudioPenalty)
  Write-Host "  [OK]   V358 lossless audio penalty restored (-20000)" -ForegroundColor Green
} elseif ($id.Contains('V358_KILL_LOSSLESS')) {
  Write-Host "  [NOOP] V358 lossless audio penalty already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] V319_QUALITY_FIRST audio anchor NOT FOUND" -ForegroundColor Yellow
}

# ============================================================
# V358: Bump v146 audio penalties (they were too weak vs +5000 cache bonus)
# ============================================================
$oldV146 = @'
        if (/\bDTS[\s\-:]?X\b|\bDTSX\b/.test(_v146t)) {
          s -= 900;
        } else if (/\bTRUEHD\b|\bTRUE[\s\-]?HD\b/.test(_v146t)) {
          s -= 800;
        } else if (/\bATMOS\b/.test(_v146t)) {
          s -= 700;
        } else if (/\bDTS[\s\-]?HD(\s*MA)?\b/.test(_v146t)) {
          s -= 400;
        } else if (/\bDTS\b/.test(_v146t)) {
          s -= 100;
        }
'@
$newV146 = @'
        /* V358_STRONG_AUDIO - Google TV Streamer / Firestick cannot decode
           these audio codecs. Old penalties too weak vs +5000 PM cache bonus. */
        if (/\bDTS[\s\-:]?X\b|\bDTSX\b/.test(_v146t)) {
          s -= 8000;
        } else if (/\bTRUEHD\b|\bTRUE[\s\-]?HD\b/.test(_v146t)) {
          s -= 8000;
        } else if (/\bATMOS\b/.test(_v146t)) {
          s -= 6000;
        } else if (/\bDTS[\s\-]?HD(\s*MA)?\b/.test(_v146t)) {
          s -= 10000;
        } else if (/\bDTS\b/.test(_v146t)) {
          s -= 2000;
        }
'@
if ($id.Contains($oldV146)) {
  $id = $id.Replace($oldV146, $newV146)
  Write-Host "  [OK]   V358 v146 audio penalties bumped 8x-20x" -ForegroundColor Green
} elseif ($id.Contains('V358_STRONG_AUDIO')) {
  Write-Host "  [NOOP] V358 v146 audio penalties already bumped" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] v146 audio anchor NOT FOUND" -ForegroundColor Yellow
}

# ============================================================
# V357 SDR partition (bundle again in case last run didn't stick)
# ============================================================
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
    // V357_SDR_HARD_PARTITION - SDR always beats HDR
    const _v357_isHdr = (p) => !!(p && p.info && p.info.isHDR);
    const _v357_cSdr = parsed.filter((p) => !!p.stream.url && !_v357_isHdr(p));
    const _v357_cHdr = parsed.filter((p) => !!p.stream.url && _v357_isHdr(p));
    const _v357_uSdr = parsed.filter((p) => !p.stream.url && !_v357_isHdr(p));
    const _v357_uHdr = parsed.filter((p) => !p.stream.url && _v357_isHdr(p));
    const _v357_sortScore = (a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream);
    _v357_cSdr.sort(_v357_sortScore); _v357_cHdr.sort(_v357_sortScore);
    _v357_uSdr.sort(_v357_sortScore); _v357_uHdr.sort(_v357_sortScore);
    parsed.length = 0;
    for (const p of _v357_cSdr) parsed.push(p);
    for (const p of _v357_cHdr) parsed.push(p);
    for (const p of _v357_uSdr) parsed.push(p);
    for (const p of _v357_uHdr) parsed.push(p);
    console.log('[V357 PARTITION]',
      'cached_sdr=' + _v357_cSdr.length,
      'cached_hdr=' + _v357_cHdr.length,
      'uncached_sdr=' + _v357_uSdr.length,
      'uncached_hdr=' + _v357_uHdr.length);
'@
if ($id.Contains($oldPartition)) {
  $id = $id.Replace($oldPartition, $newPartition)
  Write-Host "  [OK]   V357 SDR/HDR partition applied" -ForegroundColor Green
} elseif ($id.Contains('V357_SDR_HARD_PARTITION')) {
  Write-Host "  [NOOP] V357 SDR/HDR partition already present" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] V357 partition anchor NOT FOUND" -ForegroundColor Yellow
}

# Enable v141 SORT log
$oldLog = "false && console.log('[SORT v141] picked top:'"
$newLog = "console.log('[SORT v141_V358] picked top:'"
if ($id.Contains($oldLog)) {
  $id = $id.Replace($oldLog, $newLog)
  Write-Host "  [OK]   v141 SORT log enabled" -ForegroundColor Green
} elseif ($id.Contains("SORT v141_V35")) {
  Write-Host "  [NOOP] v141 SORT log already enabled" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] v141 SORT log anchor NOT FOUND" -ForegroundColor Yellow
}

# ============================================================
# V358: Log the picked stream's audio codec at play time
# ============================================================
$oldPickedLog = "console.log('[v241 PLAY] picked:', picked.name || picked.title, 'isPorn=', _v241IsPorn);"
$newPickedLog = @'
console.log('[V358 PLAY] picked:', String(picked.name || picked.title || '').slice(0,80),
                                   '| hasUrl=', !!picked.url,
                                   '| infoHash=', String(picked.infoHash || '').slice(0,8),
                                   '| audio-tag=', String(picked.title || picked.name || '').match(/DTS[\-\s]?HD\s?MA|DTS[\-\s]?X|DTSX|TRUEHD|TRUE[\-\s]?HD|ATMOS|DTS/i)?.[0] || 'aac/ac3-ok');
'@
if ($id.Contains($oldPickedLog)) {
  $id = $id.Replace($oldPickedLog, $newPickedLog)
  Write-Host "  [OK]   V358 play-picker diagnostic log added" -ForegroundColor Green
} elseif ($id.Contains('[V358 PLAY]')) {
  Write-Host "  [NOOP] V358 play-picker log already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] v241 PLAY log anchor NOT FOUND" -ForegroundColor Yellow
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

# V357 fast-cascade
$oldRetry = @'
                    // Retry aggressively - torrent data arrives progressively, each retry may succeed
                    if (videoRetryCountRef.current < maxVideoRetries) {
'@
$newRetry = @'
                    // V357_FAST_CASCADE - directUrl errors skip retry loop
                    if (directUrl && !infoHash) {
                      const _v357_fbLeft = Math.max(0, (fallbackUrls?.length || 0) - (currentStreamIndex + 1));
                      const _v357_torLeft = (torrentFallbacksRef.current?.length || 0) + (torrentFallbacks?.length || 0);
                      console.log('[V357 CASCADE] directUrl failed - fbUrlsLeft=' + _v357_fbLeft + ' torrentsLeft=' + _v357_torLeft);
                      videoRetryCountRef.current = 0;
                      if (_v357_fbLeft > 0) tryNextStream();
                      else if (_v357_torLeft > 0) tryNextFallbackTorrent();
                      else { setError('Stream unavailable. Try a different source.'); setIsLoading(false); }
                      return;
                    }
                    // Retry aggressively - torrent data arrives progressively, each retry may succeed
                    if (videoRetryCountRef.current < maxVideoRetries) {
'@
if ($pl.Contains($oldRetry)) {
  $pl = $pl.Replace($oldRetry, $newRetry)
  Write-Host "  [OK]   V357 fast-cascade applied" -ForegroundColor Green
} elseif ($pl.Contains('V357_FAST_CASCADE')) {
  Write-Host "  [NOOP] V357 fast-cascade already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] player.tsx retry anchor NOT FOUND" -ForegroundColor Yellow
}

# V358: log parsed fallback counts to diagnose "No more fallback streams" bug
$oldFbParse = @'
      // Parse fallback streams (URL-based)
      if (fallbackStreams) {
'@
$newFbParse = @'
      // Parse fallback streams (URL-based)
      console.log('[V358 PLAYER] mount: fallbackStreams=' + (fallbackStreams ? String(fallbackStreams).length + 'ch' : 'null') + ' fallbackTorrents=' + (fallbackTorrents ? String(fallbackTorrents).length + 'ch' : 'null') + ' directUrl=' + (directUrl ? 'yes' : 'no') + ' infoHash=' + (infoHash ? String(infoHash).slice(0,8) : 'no'));
      if (fallbackStreams) {
'@
if ($pl.Contains($oldFbParse)) {
  $pl = $pl.Replace($oldFbParse, $newFbParse)
  Write-Host "  [OK]   V358 fallback-mount log added" -ForegroundColor Green
} elseif ($pl.Contains('[V358 PLAYER] mount:')) {
  Write-Host "  [NOOP] V358 fallback-mount log already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] fallback-parse anchor NOT FOUND" -ForegroundColor Yellow
}

if ($pl -ne $plOrig) {
  [System.IO.File]::WriteAllText($plAbs, $pl)
  Write-Host "  [WRITE] $plPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] $plPath unchanged" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Verification" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ("  V358 KILL_LOSSLESS hits    : " + (Select-String -LiteralPath $idPath -Pattern 'V358_KILL_LOSSLESS' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V358 STRONG_AUDIO hits     : " + (Select-String -LiteralPath $idPath -Pattern 'V358_STRONG_AUDIO' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V357 SDR partition hits    : " + (Select-String -LiteralPath $idPath -Pattern 'V357_SDR_HARD_PARTITION' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V358 PLAY diagnostic hits  : " + (Select-String -LiteralPath $idPath -Pattern '\[V358 PLAY\]').Count) -ForegroundColor Green
Write-Host ("  V357 FAST_CASCADE hits     : " + (Select-String -LiteralPath $plPath -Pattern 'V357_FAST_CASCADE' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V358 PLAYER mount log hits : " + (Select-String -LiteralPath $plPath -Pattern '\[V358 PLAYER\]').Count) -ForegroundColor Green

Write-Host ""
Write-Host "Next: deploy_ota.bat  ->  Play Endgame  ->  logcat" -ForegroundColor Yellow
