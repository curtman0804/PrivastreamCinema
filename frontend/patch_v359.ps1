# patch_v359.ps1 - Regex-flexible anchors + auto-deploy + OTA verify
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V359 Regex Anchors + Deploy + Verify" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# =========================================================================
# STEP 1 - Patch id.tsx and player.tsx with whitespace-flexible regex
# =========================================================================
$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

# ---- Patch A: v146 audio penalty bump (regex tolerant to indent) ----
$reV146 = '(?ms)if\s*\(\s*/\\bDTS\[\\s\\-:\]\?X\\b\|\\bDTSX\\b/\.test\(_v146t\)\s*\)\s*\{\s*s\s*-=\s*900;\s*\}\s*else\s*if\s*\(\s*/\\bTRUEHD\\b\|\\bTRUE\[\\s\\-\]\?HD\\b/\.test\(_v146t\)\s*\)\s*\{\s*s\s*-=\s*800;\s*\}\s*else\s*if\s*\(\s*/\\bATMOS\\b/\.test\(_v146t\)\s*\)\s*\{\s*s\s*-=\s*700;\s*\}\s*else\s*if\s*\(\s*/\\bDTS\[\\s\\-\]\?HD\(\\s\*MA\)\?\\b/\.test\(_v146t\)\s*\)\s*\{\s*s\s*-=\s*400;\s*\}\s*else\s*if\s*\(\s*/\\bDTS\\b/\.test\(_v146t\)\s*\)\s*\{\s*s\s*-=\s*100;\s*\}'
$newV146 = @'
/* V358_STRONG_AUDIO */
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
if ($id -match $reV146) {
  $id = [regex]::Replace($id, $reV146, $newV146.Replace('$','$$'), 1)
  Write-Host "  [OK]   V358 v146 audio penalties bumped 8x-20x (regex)" -ForegroundColor Green
} elseif ($id.Contains('V358_STRONG_AUDIO')) {
  Write-Host "  [NOOP] V358 v146 already bumped" -ForegroundColor DarkGray
} else {
  Write-Host "  [WARN] V358 v146 regex still didn't match" -ForegroundColor Yellow
}

# ---- Patch B: v141 SDR partition (regex) ----
$reV141 = '(?ms)const\s+_v141_cached\s*=\s*parsed\.filter\(\(p\)\s*=>\s*!!p\.stream\.url\);\s*const\s+_v141_uncached\s*=\s*parsed\.filter\(\(p\)\s*=>\s*!p\.stream\.url\);\s*_v141_cached\.sort\(\(a,\s*b\)\s*=>\s*computeScore\(b\.info,\s*b\.stream\)\s*-\s*computeScore\(a\.info,\s*a\.stream\)\);\s*_v141_uncached\.sort\(\(a,\s*b\)\s*=>\s*computeScore\(b\.info,\s*b\.stream\)\s*-\s*computeScore\(a\.info,\s*a\.stream\)\);\s*parsed\.length\s*=\s*0;\s*for\s*\(const\s+p\s+of\s+_v141_cached\)\s*parsed\.push\(p\);\s*for\s*\(const\s+p\s+of\s+_v141_uncached\)\s*parsed\.push\(p\);'
$newV141 = @'
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
    console.log('[V357 PARTITION]', 'cached_sdr=' + _v357_cSdr.length, 'cached_hdr=' + _v357_cHdr.length, 'uncached_sdr=' + _v357_uSdr.length, 'uncached_hdr=' + _v357_uHdr.length);
'@
if ($id -match $reV141) {
  $id = [regex]::Replace($id, $reV141, $newV141.Replace('$','$$'), 1)
  Write-Host "  [OK]   V357 SDR/HDR partition applied (regex)" -ForegroundColor Green
} elseif ($id.Contains('V357_SDR_HARD_PARTITION')) {
  Write-Host "  [NOOP] V357 partition already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [WARN] V357 partition regex still didn't match" -ForegroundColor Yellow
}

if ($id -ne $idOrig) { [System.IO.File]::WriteAllText($idAbs, $id); Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan }

# ---- Patch player.tsx ----
$plPath = 'app\player.tsx'
$plAbs = (Resolve-Path -LiteralPath $plPath).Path
$pl = [System.IO.File]::ReadAllText($plAbs)
$plOrig = $pl

$rePlRetry = '(?ms)//\s*Retry\s+aggressively[^\n]*\n\s*if\s*\(videoRetryCountRef\.current\s*<\s*maxVideoRetries\)\s*\{'
$newPlRetry = @'
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
                    // Retry aggressively
                    if (videoRetryCountRef.current < maxVideoRetries) {
'@
if ($pl -match $rePlRetry) {
  $pl = [regex]::Replace($pl, $rePlRetry, $newPlRetry.Replace('$','$$'), 1)
  Write-Host "  [OK]   V357 fast-cascade applied (regex)" -ForegroundColor Green
} elseif ($pl.Contains('V357_FAST_CASCADE')) {
  Write-Host "  [NOOP] V357 fast-cascade already applied" -ForegroundColor DarkGray
} else {
  Write-Host "  [WARN] V357 fast-cascade regex still didn't match" -ForegroundColor Yellow
}

$rePlFb = '(?ms)//\s*Parse fallback streams \(URL-based\)\s*\n\s*if\s*\(fallbackStreams\)\s*\{'
$newPlFb = @'
// Parse fallback streams (URL-based)
      console.log('[V358 PLAYER] mount: fbStreams=' + (fallbackStreams ? String(fallbackStreams).length + 'ch' : 'null') + ' fbTorrents=' + (fallbackTorrents ? String(fallbackTorrents).length + 'ch' : 'null') + ' directUrl=' + (directUrl ? 'yes' : 'no') + ' infoHash=' + (infoHash ? String(infoHash).slice(0,8) : 'no'));
      if (fallbackStreams) {
'@
if ($pl -match $rePlFb) {
  $pl = [regex]::Replace($pl, $rePlFb, $newPlFb.Replace('$','$$'), 1)
  Write-Host "  [OK]   V358 fallback-mount log added (regex)" -ForegroundColor Green
} elseif ($pl.Contains('[V358 PLAYER] mount:')) {
  Write-Host "  [NOOP] V358 fallback-mount log already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [WARN] V358 fallback-mount regex still didn't match" -ForegroundColor Yellow
}

if ($pl -ne $plOrig) { [System.IO.File]::WriteAllText($plAbs, $pl); Write-Host "  [WRITE] $plPath saved" -ForegroundColor Cyan }

# =========================================================================
# STEP 2 - Show what's in the file NOW
# =========================================================================
Write-Host ""
Write-Host "----- Tags present in id.tsx -----" -ForegroundColor Cyan
'V358_KILL_LOSSLESS','V358_STRONG_AUDIO','V357_SDR_HARD_PARTITION','[V358 PLAY]' | ForEach-Object {
  $c = (Select-String -LiteralPath $idPath -Pattern $_ -SimpleMatch).Count
  Write-Host ("  {0,-30} : {1}" -f $_, $c) -ForegroundColor $(if($c -gt 0){'Green'}else{'Red'})
}
Write-Host "----- Tags present in player.tsx -----" -ForegroundColor Cyan
'V357_FAST_CASCADE','[V358 PLAYER]' | ForEach-Object {
  $c = (Select-String -LiteralPath $plPath -Pattern $_ -SimpleMatch).Count
  Write-Host ("  {0,-30} : {1}" -f $_, $c) -ForegroundColor $(if($c -gt 0){'Green'}else{'Red'})
}

# =========================================================================
# STEP 3 - Deploy OTA and capture its output
# =========================================================================
Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Running deploy_ota.bat NOW" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

if (!(Test-Path -LiteralPath 'deploy_ota.bat')) {
  Write-Host "[FATAL] deploy_ota.bat not found in current directory." -ForegroundColor Red
  exit 1
}

$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
Write-Host $deployOut

if ($deployOut -match 'DONE') {
  Write-Host "  [OK]   deploy_ota.bat completed" -ForegroundColor Green
} else {
  Write-Host "  [FAIL] deploy_ota.bat did NOT print DONE - upload likely failed" -ForegroundColor Red
}

# =========================================================================
# STEP 4 - Verify the OTA manifest was actually updated on the server
# =========================================================================
Write-Host ""
Write-Host "----- Querying OTA manifest server -----" -ForegroundColor Cyan
try {
  $manifest = curl.exe -sS -H "expo-runtime-version: 1.0.0" -H "expo-platform: android" `
    "https://api.privastreamsolutions.com/api/expo-updates/manifest?runtimeVersion=1.0.0&platform=android" 2>&1
  Write-Host $manifest
  if ($manifest -match '"id"\s*:\s*"([^"]+)"') {
    $mfId = $Matches[1]
    Write-Host "  Manifest ID on server: $mfId" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] Could not extract manifest ID from server response" -ForegroundColor Yellow
  }
} catch {
  Write-Host "  [FAIL] Manifest query threw: $_" -ForegroundColor Red
}

# =========================================================================
# STEP 5 - Force-stop the Firestick app so OTA re-pulls
# =========================================================================
Write-Host ""
Write-Host "----- Force-closing Firestick app -----" -ForegroundColor Cyan
try {
  $stopOut = & adb shell am force-stop com.privastream.cinema 2>&1
  Write-Host "  [OK]   Force-stop dispatched: $stopOut" -ForegroundColor Green
  Write-Host ""
  Write-Host "Now reopen the Privastream Cinema app on your Firestick." -ForegroundColor Yellow
  Write-Host "Wait 15 seconds on Discover, then tap Play on Endgame." -ForegroundColor Yellow
  Write-Host ""
  Write-Host 'Then run:' -ForegroundColor Yellow
  Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V358 V357 SORT PARTITION CASCADE PLAY OTA picked audio-tag mount"' -ForegroundColor Gray
} catch {
  Write-Host "  [WARN] adb not available - restart the app manually on Firestick" -ForegroundColor Yellow
}
