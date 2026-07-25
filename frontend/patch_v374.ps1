# ============================================================================
# patch_v374.ps1 - fix scroll-up snapping between CW and rows (V373 follow-up)
#
# Root cause: placeholder rails used an ESTIMATED height (_V371_RAIL_H).
# When a rail above the viewport materialized or unmounted during upward
# D-pad navigation, its height changed by the estimate error, shifting every
# rail below - including the focused one - mid-navigation.  The TV focus
# engine then resolves UP/DOWN against stale geometry and the selector
# ping-pongs between the CW row and whatever landed under the old position.
#
# Fix: V374_EXACT_PLACEHOLDERS - record each rail's MEASURED height from the
# wrapper onLayout (only while it is rendered for real) and give its
# placeholder exactly that height.  Swaps become pixel-identical: zero
# layout shift, stable focus geometry.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V374 exact-height placeholders" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

# --- Patch 1: record verdict + measured heights in the gate ---------------------
if ($d.Contains('V374_EXACT_PLACEHOLDERS')) {
  Write-Host "[SKIP] discover p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
const _v371NearViewport = (row: any): boolean => {
  if (typeof row.rowIdx === 'number') _v371RowIdxByKey.current[row.key] = row.rowIdx;
  if (row.rowIdx === 0) return true;
  if (Math.abs(row.rowIdx - _v371FocusedRowIdx.current) <= 2) return true;
  const y = sectionPositions.current[row.key];
  if (y === undefined) return true;
  return Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
};
'@

  $new1 = @'
/* V374_EXACT_PLACEHOLDERS - placeholders now reuse each rail's MEASURED
   height so real<->placeholder swaps cause ZERO layout shift.  The old
   estimated height shifted every rail below on each swap, which made the
   selector ping-pong between CW and other rows while scrolling up. */
const _v371HeightByKey = useRef<Record<string, number>>({});
const _v371IsRealRef = useRef<Record<string, boolean>>({});
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

  if (-not $d.Contains($old1)) {
    Write-Host "[FATAL] discover p1 anchor not found (V373 gate drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old1, $new1)
  Write-Host "[OK] discover p1: gate records verdict + height refs added" -ForegroundColor Green
}

# --- Patch 2: measure real rail heights in the wrapper onLayout -----------------
if ($d.Contains('_v371HeightByKey.current[item.key] = e.nativeEvent.layout.height;')) {
  Write-Host "[SKIP] discover p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
                onLayout={(e) => {
                  sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                }}
'@

  $new2 = @'
                onLayout={(e) => {
                  sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                  /* V374_EXACT_PLACEHOLDERS - only record while the real
                     rail is rendered (never the placeholder's height). */
                  if (_v371IsRealRef.current[item.key]) {
                    _v371HeightByKey.current[item.key] = e.nativeEvent.layout.height;
                  }
                }}
'@

  if (-not $d.Contains($old2)) {
    Write-Host "[FATAL] discover p2 anchor not found (wrapper onLayout drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old2, $new2)
  Write-Host "[OK] discover p2: real rail heights measured" -ForegroundColor Green
}

# --- Patch 3: placeholder uses the measured height -------------------------------
if ($d.Contains('_v371HeightByKey.current[item.key] || _V371_RAIL_H')) {
  Write-Host "[SKIP] discover p3 already applied" -ForegroundColor Yellow
} else {
  $old3 = @'
                    style={{ height: _V371_RAIL_H }}
'@

  $new3 = @'
                    style={{ height: _v371HeightByKey.current[item.key] || _V371_RAIL_H }}
'@

  if (-not $d.Contains($old3)) {
    Write-Host "[FATAL] discover p3 anchor not found (placeholder style drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old3, $new3)
  Write-Host "[OK] discover p3: placeholders use exact measured height" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V374 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V374_EXACT_PLACEHOLDERS" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
