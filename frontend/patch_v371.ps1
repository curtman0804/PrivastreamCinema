# ============================================================================
# patch_v371.ps1 - back-nav re-attach cost + broken stream disk cache
#
# From lag2.log (V369+V370 confirmed live; sort stall GONE):
#   1) Back-out jam is now purely NATIVE and perfectly reproducible:
#      BACK -> JS unmount ~50ms (fast) -> then ~850-900ms main-thread stall
#      (Choreographer skipped 51/55/51 frames) + Davey 1045/1085/1028ms,
#      with the JS thread completely idle.  Every discover rail stays
#      native-mounted (removeClippedSubviews=false + all rows), so popping
#      details forces Android to re-attach + measure/layout/draw the ENTIRE
#      rail tree in one frame.  Fix: rails farther than ~2.5 rail-heights
#      from the scroll offset render a fixed-height placeholder and
#      materialize as the user scrolls toward them.
#   2) The heavy discover refetch fired 128ms after BACK - now deferred 900ms.
#   3) REAL BUG: every stream/meta disk-cache write has been failing since
#      the SDK 54 upgrade - "[blobCache] setBlob failed ... getInfoAsync
#      deprecated" spams the log 3+ lines per fetch.  SDK 54 moved the
#      legacy filesystem API to 'expo-file-system/legacy'.
#
# Fix (2 files):
#   [discover.tsx]        p1-p4  V371_VIEWPORT_RAILS + V371_DISCOVER_SETTLE
#   [src\utils\blobCache.ts] p5  V371_FS_LEGACY
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V371 viewport rails + blobCache fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# discover.tsx
# ------------------------------------------------------------------
$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

# --- Patch 1: viewport-rail helpers -------------------------------------------
if ($d.Contains('V371_VIEWPORT_RAILS')) {
  Write-Host "[SKIP] discover p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
    _v369FocusHandlers[hk] = h;
  }
  return h;
};
'@

  $new1 = @'
    _v369FocusHandlers[hk] = h;
  }
  return h;
};

/* V371_VIEWPORT_RAILS - every rail stayed native-mounted, so popping back
   from details forced Android to re-attach + measure/layout/draw the ENTIRE
   tree in one frame: ~850ms main-thread stall (Choreographer skipped 51-55
   frames) + ~1050ms Davey in EVERY capture, with the JS thread idle.  Rails
   farther than ~2.5 rail-heights from the scroll offset now render a
   fixed-height placeholder; they materialize as the user scrolls near. */
const _V371_RAIL_H = Math.round(POSTER_HEIGHT + (isTV ? 96 : 80));
const _V371_WINDOW = Math.round(_V371_RAIL_H * 2.6);
const _v371ScrollYRef = useRef(0);
const _v371LastSwapY = useRef(0);
const [, _v371Bump] = useState(0);
const _v371OnScrollY = (y: number) => {
  _v371ScrollYRef.current = y;
  if (Math.abs(y - _v371LastSwapY.current) > 300) {
    _v371LastSwapY.current = y;
    _v371Bump((x) => (x + 1) & 0xff);
  }
};
useEffect(() => {
  /* One pass after the V54 progressive row expansion (700ms) + first
     layout, so rails that mounted just to get measured swap over to
     placeholders before the user ever navigates. */
  const t = setTimeout(() => { _v371Bump((x) => (x + 1) & 0xff); }, 1500);
  return () => clearTimeout(t);
}, []);
const _v371NearViewport = (row: any): boolean => {
  if (row.rowIdx === 0) return true;
  const y = sectionPositions.current[row.key];
  if (y === undefined) return true;
  return Math.abs(y - _v371ScrollYRef.current) < _V371_WINDOW;
};
'@

  if (-not $d.Contains($old1)) {
    Write-Host "[FATAL] discover p1 anchor not found (V369 helper tail drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old1, $new1)
  Write-Host "[OK] discover p1: viewport-rail helpers" -ForegroundColor Green
}

# --- Patch 2: track scroll offset ----------------------------------------------
if ($d.Contains('_v371OnScrollY(y);')) {
  Write-Host "[SKIP] discover p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
'@

  $new2 = @'
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
            /* V371_VIEWPORT_RAILS - track offset + swap far rails. */
            _v371OnScrollY(y);
'@

  if (-not $d.Contains($old2)) {
    Write-Host "[FATAL] discover p2 anchor not found (onScroll y line drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old2, $new2)
  Write-Host "[OK] discover p2: onScroll offset tracking" -ForegroundColor Green
}

# --- Patch 3a: open the near-viewport gate --------------------------------------
if ($d.Contains('_v371NearViewport(item) ? (')) {
  Write-Host "[SKIP] discover p3a already applied" -ForegroundColor Yellow
} else {
  $old3a = @'
              >
                <ServiceRow
                  title={item.title}
'@

  $new3a = @'
              >
                {/* V371_VIEWPORT_RAILS */}
                {_v371NearViewport(item) ? (
                <ServiceRow
                  title={item.title}
'@

  if (-not $d.Contains($old3a)) {
    Write-Host "[FATAL] discover p3a anchor not found (ServiceRow open drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old3a, $new3a)
  Write-Host "[OK] discover p3a: near-viewport gate opened" -ForegroundColor Green
}

# --- Patch 3b: close the gate with a placeholder --------------------------------
if ($d.Contains('style={{ height: _V371_RAIL_H }}')) {
  Write-Host "[SKIP] discover p3b already applied" -ForegroundColor Yellow
} else {
  $old3b = @'
                  nextFocusUpTag={item.rowIdx === 0 ? firstCWTag : null}
                />
              </View>
            );
'@

  $new3b = @'
                  nextFocusUpTag={item.rowIdx === 0 ? firstCWTag : null}
                />
                ) : (
                  <View
                    style={{ height: _V371_RAIL_H }}
                    focusable={false}
                    accessible={false}
                    importantForAccessibility="no"
                  />
                )}
              </View>
            );
'@

  if (-not $d.Contains($old3b)) {
    Write-Host "[FATAL] discover p3b anchor not found (ServiceRow close drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old3b, $new3b)
  Write-Host "[OK] discover p3b: placeholder branch closed" -ForegroundColor Green
}

# --- Patch 4: defer the heavy discover refetch on focus -------------------------
if ($d.Contains('V371_DISCOVER_SETTLE')) {
  Write-Host "[SKIP] discover p4 already applied" -ForegroundColor Yellow
} else {
  $em = [string][char]0x2014
  $old4 = @"
        if (discoverElapsed >= 60000) {
          lastDiscoverFetchTime.current = Date.now();
          fetchDiscover(); // no force flag $em SWR pattern from store
        }
"@

  $new4 = @'
        if (discoverElapsed >= 60000) {
          lastDiscoverFetchTime.current = Date.now();
          /* V371_DISCOVER_SETTLE - was firing 128ms after BACK, stacking a
             network fetch + multi-MB JSON parse onto the re-attach window. */
          setTimeout(() => { try { fetchDiscover(); } catch (_) {} }, 900);
        }
'@

  if (-not $d.Contains($old4)) {
    Write-Host "[FATAL] discover p4 anchor not found (focus-effect discover branch drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old4, $new4)
  Write-Host "[OK] discover p4: discover refetch deferred 900ms" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

# ------------------------------------------------------------------
# src\utils\blobCache.ts - SDK 54 legacy filesystem import
# ------------------------------------------------------------------
$bPath = 'src\utils\blobCache.ts'
if (!(Test-Path -LiteralPath $bPath)) {
  Write-Host "[FATAL] $bPath not found." -ForegroundColor Red
  exit 1
}
$bAbs = (Resolve-Path -LiteralPath $bPath).Path
$b = [System.IO.File]::ReadAllText($bAbs)

if ($b.Contains("expo-file-system/legacy")) {
  Write-Host "[SKIP] blobCache p5 already applied" -ForegroundColor Yellow
} else {
  $old5 = @'
import * as FileSystem from 'expo-file-system';
'@

  $new5 = @'
/* V371_FS_LEGACY - SDK 54 moved getInfoAsync/documentDirectory to the
   legacy subpath; the old import made EVERY setBlob throw, so the stream/
   meta disk cache silently stopped persisting (3+ warning lines spammed
   into logcat per fetch - see lag2.log). */
import * as FileSystem from 'expo-file-system/legacy';
'@

  if (-not $b.Contains($old5)) {
    Write-Host "[FATAL] blobCache p5 anchor not found (import line drifted)" -ForegroundColor Red
    exit 1
  }
  $b = $b.Replace($old5, $new5)
  Write-Host "[OK] blobCache p5: legacy filesystem import (disk cache restored)" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($bAbs, $b)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V371 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V371_VIEWPORT_RAILS" app\(tabs)\discover.tsx'
Write-Host '  findstr /C:"V371_FS_LEGACY" src\utils\blobCache.ts'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
