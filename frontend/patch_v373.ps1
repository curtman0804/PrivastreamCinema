# ============================================================================
# patch_v373.ps1 - fix V371 regression: selector snapping back to CW card
#
# Root cause: V371 gated rail mounting on scroll distance alone.  Placeholder
# height estimates drift vs real rail heights, worst near the bottom of the
# list - so the rail HOLDING D-pad focus could get swapped to a placeholder
# mid-navigation.  Android TV then throws focus to the first focusable view
# on screen = the first Continue Watching card, and D-pad DOWN keeps getting
# pulled back because the rails below are placeholders (not focusable).
#
# Fix: V373_FOCUS_ANCHORED_RAILS - the focused row and its 2 neighbors in
# each direction are ALWAYS mounted, tracked from the row focus handler.
# Focus can never be standing on a rail that unmounts.  Scroll-distance
# mounting still applies on top (for touch scrolling).
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V373 focus-anchored rails" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

# --- Patch 1: focus-aware near-viewport gate -----------------------------------
if ($d.Contains('V373_FOCUS_ANCHORED_RAILS')) {
  Write-Host "[SKIP] discover p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
const _v371NearViewport = (row: any): boolean => {
  if (row.rowIdx === 0) return true;
  const y = sectionPositions.current[row.key];
  if (y === undefined) return true;
  return Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
};
'@

  $new1 = @'
/* V373_FOCUS_ANCHORED_RAILS - V371 gated rails on scroll distance alone,
   which could unmount the rail HOLDING D-pad focus (placeholder height
   estimates drift vs real heights near the bottom of the list), snapping
   the selector back to the first Continue Watching card.  The focused row
   and its 2 neighbors in each direction are now ALWAYS mounted - focus can
   never be standing on a rail that unmounts. */
const _v371FocusedRowIdx = useRef<number>(0);
const _v371RowIdxByKey = useRef<Record<string, number>>({});
const _v371OnRowFocus = (rowKey: string) => {
  const idx = _v371RowIdxByKey.current[rowKey];
  if (typeof idx === 'number' && idx !== _v371FocusedRowIdx.current) {
    _v371FocusedRowIdx.current = idx;
    _v371Bump((x) => (x + 1) & 0xff);
  }
};
const _v371NearViewport = (row: any): boolean => {
  if (typeof row.rowIdx === 'number') _v371RowIdxByKey.current[row.key] = row.rowIdx;
  if (row.rowIdx === 0) return true;
  if (Math.abs(row.rowIdx - _v371FocusedRowIdx.current) <= 2) return true;
  const y = sectionPositions.current[row.key];
  if (y === undefined) return true;
  return Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
};
'@

  if (-not $d.Contains($old1)) {
    Write-Host "[FATAL] discover p1 anchor not found (V371 gate drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old1, $new1)
  Write-Host "[OK] discover p1: focus-anchored rail gate" -ForegroundColor Green
}

# --- Patch 2: report row focus from the cached handlers -------------------------
if ($d.Contains('_v371OnRowFocus(rowKey);')) {
  Write-Host "[SKIP] discover p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
    h = (ci: any) => {
      handleSectionFocus(rowKey);
      if (contentType !== 'channels') handleItemFocus(ci);
    };
'@

  $new2 = @'
    h = (ci: any) => {
      handleSectionFocus(rowKey);
      _v371OnRowFocus(rowKey); /* V373_FOCUS_ANCHORED_RAILS */
      if (contentType !== 'channels') handleItemFocus(ci);
    };
'@

  if (-not $d.Contains($old2)) {
    Write-Host "[FATAL] discover p2 anchor not found (V369 focus factory drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old2, $new2)
  Write-Host "[OK] discover p2: row focus reported to rail gate" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V373 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V373_FOCUS_ANCHORED_RAILS" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
