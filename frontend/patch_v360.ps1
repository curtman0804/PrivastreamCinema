# patch_v360.ps1 - Nav Lag: Kill MMKV spam + Back-nav profiler + Discover throttle
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V360 Nav Lag Fixes" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# =========================================================================
# FIX 1: Kill V344 MMKV migration spam (MMKV was rolled back)
# =========================================================================
$mmPath = 'src\utils\mmkvMigrate.ts'
if (Test-Path -LiteralPath $mmPath) {
  $mmAbs = (Resolve-Path -LiteralPath $mmPath).Path
  $mm = [System.IO.File]::ReadAllText($mmAbs)
  $mmOrig = $mm

  $oldRunFn = 'async function _run(): Promise<{ migrated: number; skipped: number; failed: number }> {'
  $newRunFn = @'
async function _run(): Promise<{ migrated: number; skipped: number; failed: number }> {
  // V360_MMKV_SHORT_CIRCUIT - MMKV native module was rolled back. Every call to
  // rawMMKV.* throws "undefined is not a function", causing this migration to
  // spam 20+ bridge calls per cold boot. Short-circuit immediately.
  try {
    if (typeof (rawMMKV as any)?.getString !== 'function') {
      return { migrated: 0, skipped: 0, failed: 0 };
    }
  } catch (_) {
    return { migrated: 0, skipped: 0, failed: 0 };
  }
'@
  if ($mm.Contains($oldRunFn) -and -not $mm.Contains('V360_MMKV_SHORT_CIRCUIT')) {
    $mm = $mm.Replace($oldRunFn, $newRunFn)
    Write-Host "  [OK]   V360 MMKV migration short-circuit applied" -ForegroundColor Green
  } elseif ($mm.Contains('V360_MMKV_SHORT_CIRCUIT')) {
    Write-Host "  [NOOP] V360 MMKV short-circuit already applied" -ForegroundColor DarkGray
  } else {
    Write-Host "  [SKIP] mmkvMigrate _run function anchor NOT FOUND" -ForegroundColor Yellow
  }

  if ($mm -ne $mmOrig) { [System.IO.File]::WriteAllText($mmAbs, $mm); Write-Host "  [WRITE] $mmPath saved" -ForegroundColor Cyan }
} else {
  Write-Host "  [SKIP] $mmPath not found" -ForegroundColor Yellow
}

# =========================================================================
# FIX 2: Back-nav profiler + force render placeholder when _v186Closing
# =========================================================================
$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

# Add high-res back-nav timing right at the top of the back handler
$reBackTop = "console\.log\('\[BACK v134/v186\] main hwBack fired;.*?\n"
$newBackTop = @'
const _v360_backT0 = Date.now();
        console.log('[V360_BACK] t0=hwBack fired');
        console.log('[BACK v134/v186] main hwBack fired');

'@
if ($id -match $reBackTop -and -not $id.Contains('V360_BACK')) {
  $id = [regex]::Replace($id, $reBackTop, $newBackTop.Replace('$','$$'), 1)
  Write-Host "  [OK]   V360 back-nav profiler injected" -ForegroundColor Green
} elseif ($id.Contains('V360_BACK')) {
  Write-Host "  [NOOP] V360 back-nav profiler already injected" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] back handler anchor NOT FOUND" -ForegroundColor Yellow
}

# Log timing right AFTER _setV186Closing(true)
$reV186 = '_setV186Closing\(true\);\s*\n\s*// Navigate on the next frame'
$newV186 = @'
_setV186Closing(true);
        console.log('[V360_BACK] t=' + (Date.now() - _v360_backT0) + 'ms _setV186Closing done');
        // Navigate on the next frame
'@
if ($id -match $reV186 -and -not $id.Contains('_setV186Closing done')) {
  $id = [regex]::Replace($id, $reV186, $newV186.Replace('$','$$'), 1)
  Write-Host "  [OK]   V360 closing-timing log added" -ForegroundColor Green
} elseif ($id.Contains('_setV186Closing done')) {
  Write-Host "  [NOOP] V360 closing-timing already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [SKIP] _setV186Closing anchor NOT FOUND" -ForegroundColor Yellow
}

# CRITICAL: Force early-return placeholder when _v186Closing is true.
# We inject right after all useState declarations, before the JSX return.
# Anchor: `<V176kPopover />` - this is very early in the JSX return.
$reV176kPopover = "\{/\* V176K_POPOVER_MOUNTED"
$injectClosing = @'
{_v186Closing ? (<View style={{flex:1,backgroundColor:'#0c0c0c'}} />) : null}
        {!_v186Closing && (<>{/* V176K_POPOVER_MOUNTED
'@
# Actually we can't wrap the whole return without seeing it. Instead, add
# a top-level early-return via a conditional at the return statement itself.
# Safer alternative: add a `return null` gate in a hook-independent way.

# Look for the main component return `return (` right before <V176kPopover />
$reReturnBeforePopover = '(?ms)(return\s*\(\s*\n\s*<[^>]+>\s*\n\s*\{/\*\s*V176K_POPOVER_MOUNTED)'
$newReturnBeforePopover = @'
if (_v186Closing) { return (<View style={{flex:1,backgroundColor:'#0c0c0c'}} />); }
    $1
'@
if ($id -match $reReturnBeforePopover -and -not $id.Contains('V360_CLOSING_EARLY_RETURN')) {
  # Use a build tag to mark this
  $marker = "// V360_CLOSING_EARLY_RETURN`n    if (_v186Closing) { return (<View style={{flex:1,backgroundColor:'#0c0c0c'}} />); }`n    "
  $id = [regex]::Replace($id, $reReturnBeforePopover, ($marker + '$1'.Replace('$','$$')), 1)
  Write-Host "  [OK]   V360 _v186Closing early-return placeholder added" -ForegroundColor Green
} elseif ($id.Contains('V360_CLOSING_EARLY_RETURN')) {
  Write-Host "  [NOOP] V360 early-return placeholder already added" -ForegroundColor DarkGray
} else {
  Write-Host "  [WARN] V360 return-before-popover anchor NOT FOUND - manual JSX inspection needed" -ForegroundColor Yellow
}

# UNMOUNT log with timing
$reUnmount = "\[V311_PERF\] details/UNMOUNT"
if ($id -match $reUnmount) {
  Write-Host "  [OK]   Existing UNMOUNT log will report timing" -ForegroundColor Green
}

if ($id -ne $idOrig) { [System.IO.File]::WriteAllText($idAbs, $id); Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan }

# =========================================================================
# FIX 3: Discover section focus - defer heavy work
# =========================================================================
$dcPath = 'app\(tabs)\discover.tsx'
if (Test-Path -LiteralPath $dcPath) {
  $dcAbs = (Resolve-Path -LiteralPath $dcPath).Path
  $dc = [System.IO.File]::ReadAllText($dcAbs)
  $dcOrig = $dc

  # Find handleSectionFocus and wrap the body in InteractionManager.runAfterInteractions
  $reFocusFn = '(?ms)(const\s+handleSectionFocus\s*=\s*(?:React\.)?useCallback\(\s*\(\s*key[^)]*\)\s*=>\s*\{)'
  $newFocusFn = @'
$1
    // V360_DEFER_FOCUS - defer heavy scroll/layout work to next tick so D-pad feels instant.
    const _v360_deferBody = () => {
'@
  if ($dc -match $reFocusFn -and -not $dc.Contains('V360_DEFER_FOCUS')) {
    Write-Host "  [WARN] Discover focus defer needs manual JSX inspection - deferred to next patch" -ForegroundColor Yellow
  } elseif ($dc.Contains('V360_DEFER_FOCUS')) {
    Write-Host "  [NOOP] V360 discover focus defer already applied" -ForegroundColor DarkGray
  } else {
    Write-Host "  [SKIP] handleSectionFocus anchor NOT FOUND" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [SKIP] $dcPath not found" -ForegroundColor Yellow
}

# =========================================================================
# Verification + deploy + force restart
# =========================================================================
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  V360 MMKV short-circuit hits    : " + (Select-String -LiteralPath $mmPath -Pattern 'V360_MMKV_SHORT_CIRCUIT' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V360 back-nav profiler hits     : " + (Select-String -LiteralPath $idPath -Pattern 'V360_BACK' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V360 closing early-return hits  : " + (Select-String -LiteralPath $idPath -Pattern 'V360_CLOSING_EARLY_RETURN' -SimpleMatch).Count) -ForegroundColor Green

Write-Host ""
Write-Host "----- Running deploy_ota.bat -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
if ($deployOut -match 'DONE') {
  Write-Host "  [OK]   Deploy completed" -ForegroundColor Green
  if ($deployOut -match '"updateId":"([^"]+)"') { Write-Host ("  New updateId: " + $Matches[1]) -ForegroundColor Green }
} else {
  Write-Host "  [FAIL] Deploy did not complete cleanly" -ForegroundColor Red
  Write-Host $deployOut
}

Write-Host ""
Write-Host "----- Force-stopping Firestick app -----" -ForegroundColor Cyan
& adb shell am force-stop com.privastream.cinema 2>&1 | Out-Null
Write-Host "  [OK]   App force-stopped" -ForegroundColor Green

Write-Host ""
Write-Host "Now on Firestick:" -ForegroundColor Yellow
Write-Host "  1. Reopen Privastream Cinema" -ForegroundColor Yellow
Write-Host "  2. Wait 15s on Discover, then click a title, wait 3s, press back" -ForegroundColor Yellow
Write-Host "  3. Then run:" -ForegroundColor Yellow
Write-Host '     adb logcat -c && [nav test on Firestick] && adb logcat -d ReactNativeJS:V *:S > nav.txt' -ForegroundColor Gray
Write-Host "  4. Paste output of:" -ForegroundColor Yellow
Write-Host '     findstr /I "V360 V311 MOUNT UNMOUNT FOCUS BACK V344 discover render" nav.txt' -ForegroundColor Gray
