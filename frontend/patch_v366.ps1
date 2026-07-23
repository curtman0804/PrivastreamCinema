# ============================================================================
# patch_v366.ps1 (rev B, pure ASCII) - JS-thread decongestion
#
# From the 09:53 logcat:
#   - Popover "Clear Progress" OK-press at 48.5s, action executed at 50.7s.
#     The 50ms deferred runAction fired 2.2s late because the JS thread was
#     busy with Modal teardown + re-render. Fix: run the action INLINE on
#     the press tick, then close the modal - one reconciliation pass.
#   - V325 scorer logs still active - 24+ bridge-crossing console.logs per
#     stream sort on details open. Silenced (false && gated, greppable).
#   - Player dumps the full 35-language subtitle JSON to console. Trimmed
#     to a count.
#   - Cleanup: V365 wrote a few garbled 'a-hat euro quote' sequences into
#     comments (BOM-less UTF-8 ps1 parsed as ANSI). Restored to '-'.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V366 JS-thread decongestion (rev B)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Mojibake sequence: U+00E2 U+20AC U+201D (how an em dash looks after the
# ANSI mis-parse), replaced with a plain ASCII hyphen.
$moji = [string][char]0x00E2 + [string][char]0x20AC + [string][char]0x201D
$dash = '-'

# ------------------------------------------------------------------
# ContentCard.tsx
# ------------------------------------------------------------------
$ccPath = 'src\components\ContentCard.tsx'
if (!(Test-Path -LiteralPath $ccPath)) {
  Write-Host "[FATAL] $ccPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$ccAbs = (Resolve-Path -LiteralPath $ccPath).Path
$cc = [System.IO.File]::ReadAllText($ccAbs)

# --- Patch 0a: mojibake cleanup ---------------------------------------------
$mojiCount = ([regex]::Matches($cc, [regex]::Escape($moji))).Count
if ($mojiCount -gt 0) {
  $cc = $cc.Replace($moji, $dash)
  Write-Host "[OK] ContentCard: cleaned $mojiCount garbled dash sequences" -ForegroundColor Green
} else {
  Write-Host "[SKIP] ContentCard: no garbled sequences found" -ForegroundColor Yellow
}

# --- Patch 1: synchronous popover action -------------------------------------
if ($cc.Contains('V366_SYNC_POPOVER_ACTION_BUILD_TAG')) {
  Write-Host "[SKIP] ContentCard patch 1 already applied" -ForegroundColor Yellow
} else {
  $oldRun = @'
    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}
    setOpen(false);
    // Delay slightly so the close animation can start before the action
    // triggers anything heavy (e.g. fetchLibrary).
    setTimeout(() => { try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); } }, 50);
'@

  $newRun = @'
    /* V366_SYNC_POPOVER_ACTION - run the action on THIS tick, BEFORE the
       Modal teardown + screen re-render occupy the JS thread.  The old
       50ms setTimeout did not fire "50ms later" on a busy Firestick - it
       fired after the whole close/re-render pass (measured 2.2s late in
       the 09:53 logcat).  Optimistic actions (Clear Progress, Mark
       Watched) are cheap setState + fire-and-forget HTTP, so running them
       inline lets the poster update commit in the SAME render pass as the
       modal close. */
    const _V366_BUILD_TAG = 'V366_SYNC_POPOVER_ACTION_BUILD_TAG';
    void _V366_BUILD_TAG;
    try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); }
    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}
    setOpen(false);
'@

  if (-not $cc.Contains($oldRun)) {
    Write-Host "[FATAL] ContentCard patch 1 anchor not found (runAction drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($oldRun, $newRun)
  Write-Host "[OK] ContentCard patch 1: popover action runs synchronously" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($ccAbs, $cc)

# ------------------------------------------------------------------
# discover.tsx - mojibake cleanup only
# ------------------------------------------------------------------
$dPath = 'app\(tabs)\discover.tsx'
if (Test-Path -LiteralPath $dPath) {
  $dAbs = (Resolve-Path -LiteralPath $dPath).Path
  $d = [System.IO.File]::ReadAllText($dAbs)
  $mojiCount = ([regex]::Matches($d, [regex]::Escape($moji))).Count
  if ($mojiCount -gt 0) {
    $d = $d.Replace($moji, $dash)
    [System.IO.File]::WriteAllText($dAbs, $d)
    Write-Host "[OK] discover: cleaned $mojiCount garbled dash sequences" -ForegroundColor Green
  } else {
    Write-Host "[SKIP] discover: no garbled sequences found" -ForegroundColor Yellow
  }
}

# ------------------------------------------------------------------
# id.tsx - silence the V325 scorer logs (hot loop)
# ------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) {
  Write-Host "[FATAL] $idPath not found." -ForegroundColor Red
  exit 1
}
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if ($id.Contains('V366_KILL_SCORER_LOGS_BUILD_TAG')) {
  Write-Host "[SKIP] id.tsx patch 2 already applied" -ForegroundColor Yellow
} else {
  $oldV325a = @'
            try {
              console.log('[V325] WEB-DL+Atmos+HEVC combo +5500 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
'@
  $newV325a = @'
            /* V366_KILL_SCORER_LOGS_BUILD_TAG - silenced: fired per-stream
               inside the sort; 24+ bridge logs per details open. */
            try {
              false && console.log('[V325] WEB-DL+Atmos+HEVC combo +5500 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
'@

  $oldV325b = @'
            try {
              console.log('[V325] WEB-DL bonus +4000 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
'@
  $newV325b = @'
            try {
              false && console.log('[V325] WEB-DL bonus +4000 | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
            } catch (_) {}
'@

  $oldV325c = @'
          try {
            console.log('[V325] WEBRip penalty -3000 (often burned ad overlay) | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
'@
  $newV325c = @'
          try {
            false && console.log('[V325] WEBRip penalty -3000 (often burned ad overlay) | ' + _v323blob.slice(0, 80).replace(/\n/g, ' '));
          } catch (_) {}
'@

  foreach ($pair in @(
      @($oldV325a, $newV325a, 'WEB-DL+Atmos combo log'),
      @($oldV325b, $newV325b, 'WEB-DL bonus log'),
      @($oldV325c, $newV325c, 'WEBRip penalty log'))) {
    if (-not $id.Contains($pair[0])) {
      Write-Host "[FATAL] id.tsx anchor not found: $($pair[2])" -ForegroundColor Red
      exit 1
    }
    $id = $id.Replace($pair[0], $pair[1])
    Write-Host "[OK] id.tsx: silenced $($pair[2])" -ForegroundColor Green
  }
}

[System.IO.File]::WriteAllText($idAbs, $id)

# ------------------------------------------------------------------
# player.tsx - trim the subtitle JSON dump
# ------------------------------------------------------------------
$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) {
  Write-Host "[FATAL] $pPath not found." -ForegroundColor Red
  exit 1
}
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V366_SUBS_LOG_TRIM_BUILD_TAG')) {
  Write-Host "[SKIP] player patch 3 already applied" -ForegroundColor Yellow
} else {
  $oldSubs = @'
      console.log('[SUBTITLES] API response:', response);
'@
  $newSubs = @'
      /* V366_SUBS_LOG_TRIM_BUILD_TAG - was dumping the full 35-language
         subtitle JSON object to logcat (expensive Hermes serialization). */
      console.log('[SUBTITLES] API response: n=' + (response?.subtitles?.length ?? 0));
'@

  if (-not $p.Contains($oldSubs)) {
    Write-Host "[FATAL] player patch 3 anchor not found (subtitles log drifted)" -ForegroundColor Red
    exit 1
  }
  $p = $p.Replace($oldSubs, $newSubs)
  Write-Host "[OK] player patch 3: subtitle dump trimmed to a count" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V366 applied. Verify:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V366_SYNC_POPOVER_ACTION_BUILD_TAG" src\components\ContentCard.tsx'
Write-Host '  findstr /C:"V366_KILL_SCORER_LOGS_BUILD_TAG" app\details\[type]\[id].tsx'
Write-Host '  findstr /C:"V366_SUBS_LOG_TRIM_BUILD_TAG" app\player.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
