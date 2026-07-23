# ============================================================================
# patch_v368.ps1 (pure ASCII) - FIX: Clear Progress nuked the whole CW row
#
# Root cause: since V366 runs popover actions synchronously, the CW card's
# own remove handler and the V365 broadcast listener execute in the SAME JS
# tick. React only eager-evaluates a setState updater when that hook's queue
# is empty - with a removal already queued, the listener's updaters were
# deferred, its captured "next" arrays stayed [], and the
# "both lists empty -> setCwForceHidden(true)" check force-hid the ENTIRE
# Continue Watching section on every clear.
#
# Fix:
#   1) Listener updaters just filter; no captured-variable emptiness check.
#   2) Section-hide is now DERIVED at render time from actual list state, so
#      clearing the LAST item still hides the row in the same frame, but a
#      single clear can never nuke a non-empty row.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V368 CW row scoped remove fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

# --- Patch 1: listener no longer force-hides the section ---------------------
if ($d.Contains('V368_SCOPED_CW_REMOVE')) {
  Write-Host "[SKIP] patch 1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
      let _v365NextLive: WatchProgress[] = [];
      let _v365NextCached: WatchProgress[] = [];
      setContinueWatching(prev => {
        _v365NextLive = (prev || []).filter(i => i.content_id !== cid);
        return _v365NextLive.length === (prev || []).length ? prev : _v365NextLive;
      });
      setCachedCW(prev => {
        _v365NextCached = (prev || []).filter(i => i.content_id !== cid);
        return _v365NextCached.length === (prev || []).length ? prev : _v365NextCached;
      });
      if (_v365NextLive.length === 0 && _v365NextCached.length === 0) {
        setCwForceHidden(true);
      }
'@

  $new1 = @'
      /* V368_SCOPED_CW_REMOVE - React only eager-evaluates a setState
         updater when that hook's queue is empty.  Since V366 the CW
         long-press path queues its own removal in the SAME tick before this
         listener runs, so the captured next-arrays stayed [] and the old
         emptiness check force-hid the ENTIRE Continue Watching row.  The
         updaters below only filter; section visibility is derived at render
         time from the actual list state. */
      try { ((globalThis as any).__psTags = (globalThis as any).__psTags || {})['V368_SCOPED_CW_REMOVE'] = 1; } catch (_) {}
      setContinueWatching(prev => {
        const next = (prev || []).filter(i => i.content_id !== cid);
        return next.length === (prev || []).length ? prev : next;
      });
      setCachedCW(prev => {
        const next = (prev || []).filter(i => i.content_id !== cid);
        return next.length === (prev || []).length ? prev : next;
      });
'@

  if (-not $d.Contains($old1)) {
    Write-Host "[FATAL] patch 1 anchor not found (V365 listener body drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old1, $new1)
  Write-Host "[OK] patch 1: listener filters only, no force-hide" -ForegroundColor Green
}

# --- Patch 2: derived section-hide at render ---------------------------------
if ($d.Contains("(continueWatching || []).length === 0 && (cachedCW || []).length === 0) return null;")) {
  Write-Host "[SKIP] patch 2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
            if (item.kind === 'cw' && cwForceHidden) return null;
'@

  $new2 = @'
            if (item.kind === 'cw' && cwForceHidden) return null;
            /* V368_SCOPED_CW_REMOVE - derived emptiness: clearing the LAST
               item hides the row in the same frame (both lists empty after
               the filters), but a clear can never hide a non-empty row. */
            if (item.kind === 'cw' && (continueWatching || []).length === 0 && (cachedCW || []).length === 0) return null;
'@

  if (-not $d.Contains($old2)) {
    Write-Host "[FATAL] patch 2 anchor not found (cw render gate drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old2, $new2)
  Write-Host "[OK] patch 2: render-time derived section hide" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V368 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V368_SCOPED_CW_REMOVE" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
