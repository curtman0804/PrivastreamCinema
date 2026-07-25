# ============================================================================
# patch_v375.ps1 - kill the focus ping-pong for good: one-way rail mounting
#
# lag3.log showed focus oscillating in a fixed loop between the same cards,
# with double focus-jumps in the same millisecond: rails were being swapped
# real<->placeholder UNDER the D-pad navigation as the focused-row window
# slid.  Any mid-navigation unmount is hazardous to the Android TV focus
# engine, regardless of geometry.
#
# Fix: V375_ONE_WAY_RAILS
#   - While browsing, rails only MATERIALIZE (placeholder -> real) as you
#     approach; a mounted rail NEVER unmounts under you.
#   - Far rails are pruned back to placeholders only when the screen blurs
#     (navigating into details) - focus is gone, the teardown is invisible,
#     and the discover tree is small again for the cheap back re-attach.
#   - Unmeasured rails use an estimated position (rowIdx * rail height)
#     instead of force-mounting, so cold boot mounts only the top rails.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V375 one-way rail mounting" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

# --- Patch 1: one-way gate ------------------------------------------------------
if ($d.Contains('V375_ONE_WAY_RAILS')) {
  Write-Host "[SKIP] discover p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
const _v371NearViewport = (row: any): boolean => {
  if (typeof row.rowIdx === 'number') _v371RowIdxByKey.current[row.key] = row.rowIdx;
  let near: boolean;
  if (row.rowIdx === 0) {
    near = true;
  } else if (Math.abs(row.rowIdx - _v371FocusedRowIdx.current) <= 2) {
    near = true;
  } else {
    const y = sectionPositions.current[row.key];
    near = y === undefined || Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
  }
  _v371IsRealRef.current[row.key] = near;
  return near;
};
'@

  $new1 = @'
/* V375_ONE_WAY_RAILS - while browsing, rails only materialize; a mounted
   rail NEVER unmounts under the selector (lag3.log showed real<->placeholder
   swaps mid-navigation ping-ponging focus between the same cards).  Far
   rails are pruned back to placeholders only on screen blur.  Unmeasured
   rails use an estimated position instead of force-mounting, so cold boot
   mounts only the top rails. */
const _v371MountedRails = useRef<Record<string, boolean>>({});
const _v371NearViewport = (row: any): boolean => {
  if (typeof row.rowIdx === 'number') _v371RowIdxByKey.current[row.key] = row.rowIdx;
  if (_v371MountedRails.current[row.key]) {
    _v371IsRealRef.current[row.key] = true;
    return true;
  }
  let near: boolean;
  if (row.rowIdx === 0) {
    near = true;
  } else if (Math.abs(row.rowIdx - _v371FocusedRowIdx.current) <= 2) {
    near = true;
  } else {
    const y = sectionPositions.current[row.key] ?? (row.rowIdx * _V371_RAIL_H);
    near = Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
  }
  if (near) _v371MountedRails.current[row.key] = true;
  _v371IsRealRef.current[row.key] = near;
  return near;
};
'@

  if (-not $d.Contains($old1)) {
    Write-Host "[FATAL] discover p1 anchor not found (V374 gate drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old1, $new1)
  Write-Host "[OK] discover p1: one-way mounting gate" -ForegroundColor Green
}

# --- Patch 2: prune far rails on blur (focus effect cleanup) --------------------
if ($d.Contains('V375_PRUNE_ON_BLUR')) {
  Write-Host "[SKIP] discover p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
      return () => handle.cancel();
'@

  $new2 = @'
      return () => {
        handle.cancel();
        /* V375_PRUNE_ON_BLUR - screen just blurred (details push): focus is
           gone, so trimming far rails back to placeholders is invisible and
           keeps the back re-attach cheap. Keep focused row +/-2 and row 0. */
        try {
          const _f = _v371FocusedRowIdx.current;
          const _keep: Record<string, boolean> = {};
          for (const _k in _v371MountedRails.current) {
            const _idx = _v371RowIdxByKey.current[_k];
            if (_idx === 0 || (typeof _idx === 'number' && Math.abs(_idx - _f) <= 2)) {
              _keep[_k] = true;
            }
          }
          _v371MountedRails.current = _keep;
          _v371Bump((x) => (x + 1) & 0xff);
        } catch (_) {}
      };
'@

  if (-not $d.Contains($old2)) {
    Write-Host "[FATAL] discover p2 anchor not found (focus-effect cleanup drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old2, $new2)
  Write-Host "[OK] discover p2: prune-on-blur installed" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V375 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V375_ONE_WAY_RAILS" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
