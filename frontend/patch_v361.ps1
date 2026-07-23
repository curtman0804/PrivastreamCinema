# patch_v361.ps1 - V361 Nav Lag Round 2 + Torrentio 500 diagnostic
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V361 Nav Lag Round 2" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# =========================================================================
# FIX 1: MMKV migration short-circuit (regex, 3 fallback anchors)
# =========================================================================
$mmPath = 'src\utils\mmkvMigrate.ts'
$mmAbs = (Resolve-Path -LiteralPath $mmPath).Path
$mm = [System.IO.File]::ReadAllText($mmAbs)
$mmOrig = $mm

if (-not $mm.Contains('V361_MMKV_KILL')) {
  # Anchor A: right after export async function ensureMMKVMigrated
  $reA = '(?ms)(export\s+async\s+function\s+ensureMMKVMigrated[^{]*\{)'
  $newA = @'
$1
  // V361_MMKV_KILL - native module was rolled back; never run migration.
  return { migrated: 0, skipped: 0, failed: 0 };
'@
  if ($mm -match $reA) {
    $mm = [regex]::Replace($mm, $reA, $newA.Replace('$1','$$1'), 1)
    Write-Host "  [OK]   V361 MMKV kill applied at ensureMMKVMigrated entry" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] ensureMMKVMigrated anchor NOT FOUND - trying fallback" -ForegroundColor Yellow
    # Fallback: at the top of _run function
    $reB = '(?ms)(async\s+function\s+_run\s*\([^)]*\)\s*:[^{]+\{)'
    if ($mm -match $reB) {
      $newB = @'
$1
  // V361_MMKV_KILL - native module rolled back; never run migration.
  return { migrated: 0, skipped: 0, failed: 0 };
'@
      $mm = [regex]::Replace($mm, $reB, $newB.Replace('$1','$$1'), 1)
      Write-Host "  [OK]   V361 MMKV kill applied at _run entry (fallback)" -ForegroundColor Green
    } else {
      Write-Host "  [FAIL] Both MMKV anchors missed - manual inspection needed" -ForegroundColor Red
    }
  }
} else {
  Write-Host "  [NOOP] V361 MMKV kill already applied" -ForegroundColor DarkGray
}

if ($mm -ne $mmOrig) { [System.IO.File]::WriteAllText($mmAbs, $mm); Write-Host "  [WRITE] $mmPath saved" -ForegroundColor Cyan }

# =========================================================================
# FIX 2: Back-nav - clear heavy state BEFORE router.back() so React
# has less to unmount. Also add high-res profiler.
# =========================================================================
$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

if (-not $id.Contains('V361_FAST_UNMOUNT')) {
  # Find the back handler's `_setV186Closing(true);` line and prepend
  # aggressive state clears so React has less work when unmounting.
  # Also add wall-clock timing.
  $reBack = '(?ms)_setV186Closing\(true\);'
  $newBack = @'
/* V361_FAST_UNMOUNT - clear heavy state BEFORE router.back() so React
   has less to tear down (was 2960ms UNMOUNT). Drop stream arrays,
   watchedEpisodes, sortedStreams so their child components can unmount
   immediately instead of waiting for the whole tree teardown pass. */
        const _v361_t0 = Date.now();
        try { _setSortedStreams && _setSortedStreams([]); } catch (_) {}
        try { setWatchedEpisodes && setWatchedEpisodes({}); } catch (_) {}
        console.log('[V361_UNMOUNT] state cleared t+' + (Date.now() - _v361_t0) + 'ms');
        _setV186Closing(true);
'@
  if ($id -match $reBack) {
    $id = [regex]::Replace($id, $reBack, $newBack, 1)
    Write-Host "  [OK]   V361 fast-unmount state clear applied" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] _setV186Closing anchor NOT FOUND" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [NOOP] V361 fast-unmount already applied" -ForegroundColor DarkGray
}

# Also add timing at router.back()
if (-not $id.Contains('V361_BACK_FIRED')) {
  $reRouterBack = "router\.back\(\);\s*console\.log\('\[BACK v134\] -> router\.back\(\)'\);"
  $newRouterBack = @'
router.back();
            console.log('[V361_BACK_FIRED] router.back() called t+' + (Date.now() - _v361_t0) + 'ms');
'@
  if ($id -match $reRouterBack) {
    $id = [regex]::Replace($id, $reRouterBack, $newRouterBack, 1)
    Write-Host "  [OK]   V361 router.back() timing added" -ForegroundColor Green
  } else {
    Write-Host "  [SKIP] router.back log anchor NOT FOUND (non-critical)" -ForegroundColor DarkGray
  }
}

if ($id -ne $idOrig) { [System.IO.File]::WriteAllText($idAbs, $id); Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan }

# =========================================================================
# Verification + deploy + reload
# =========================================================================
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  V361 MMKV kill hits             : " + (Select-String -LiteralPath $mmPath -Pattern 'V361_MMKV_KILL' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V361 FAST_UNMOUNT hits          : " + (Select-String -LiteralPath $idPath -Pattern 'V361_FAST_UNMOUNT' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V361 UNMOUNT diag log hits      : " + (Select-String -LiteralPath $idPath -Pattern '\[V361_UNMOUNT\]').Count) -ForegroundColor Green

Write-Host ""
Write-Host "----- Deploy + reload -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
  Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
} else {
  Write-Host "  [FAIL] Deploy did not complete cleanly" -ForegroundColor Red
  Write-Host $deployOut
}
& adb shell am force-stop com.privastream.cinema 2>&1 | Out-Null
Write-Host "  [OK]   Firestick app force-stopped" -ForegroundColor Green

Write-Host ""
Write-Host "----- Torrentio 500 diagnostic (on Hetzner) -----" -ForegroundColor Cyan
Write-Host "  On your Hetzner SSH session, run:" -ForegroundColor Yellow
Write-Host '  sudo docker logs --tail 200 privastream-app 2>&1 | grep -iE "torrentio|addon.proxy|502|503|500|timeout" | tail -40' -ForegroundColor Gray
Write-Host ""
Write-Host "  If you see many 502/timeout hits, the Torrentio upstream is down." -ForegroundColor Yellow
Write-Host "  Post the output and I will ship a backend patch that:" -ForegroundColor Yellow
Write-Host "    - Falls through to next addon on 5xx instead of returning error" -ForegroundColor Yellow
Write-Host "    - Adds a 3s hard timeout so retries fail fast" -ForegroundColor Yellow

Write-Host ""
Write-Host "Now on Firestick:" -ForegroundColor Yellow
Write-Host "  1. Reopen app, wait 10s on Discover" -ForegroundColor Yellow
Write-Host "  2. Click a title, wait 2s, press back, arrow around" -ForegroundColor Yellow
Write-Host "  3. Then run:" -ForegroundColor Yellow
Write-Host '     adb logcat -d ReactNativeJS:V *:S | findstr /I "V361 V360 V311 UNMOUNT V344 mmkv"' -ForegroundColor Gray
