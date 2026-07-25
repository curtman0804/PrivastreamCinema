# ============================================================================
# patch_v382.ps1 - CW row nav fixes + memory-pressure trims (OTA)
#
# Fixes (written against the user's ACTUAL uploaded v381 files):
#   [A] UP from row-0 landed on CW card 2: V316c forced nextFocusUp on ALL
#       row-0 cards to one "first-mounted" CW tag (last mount wins = wrong
#       card). Removed -> default spatial nav gives column-aligned landing
#       (up from card N lands on CW card N), same as every other row.
#   [B] DOWN from CW sometimes moved only the selector, not the page: the
#       V278 500ms CW snap-back lock fought the row-snap scroll back to
#       y=0. Lock now releases the instant a non-CW row takes focus, and
#       the onScroll snap is scoped to CW-focused state only.
#   [C] Memory pressure: focus-dwell prefetched FULL-RES backdrops into the
#       decoded-bitmap memory cache (50 posters browsed = 50 HD bitmaps in
#       RAM -> lowmemorykiller). Now disk-only. Memory cache also cleared
#       when app goes to background. CW posters get recyclingKey.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V382 CW Nav + Memory Trims" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$p = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $p)) {
  Write-Host "[FATAL] $p not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$abs = (Resolve-Path -LiteralPath $p).Path
$s = [System.IO.File]::ReadAllText($abs)
$orig = $s

function Apply([string]$name, [string]$old, [string]$new) {
  $cur = $script:s
  if ($cur.Contains($new.Substring(0, [Math]::Min(60, $new.Length)))) {
    Write-Host "[SKIP] $name (already applied)" -ForegroundColor Yellow
    return
  }
  if (-not $cur.Contains($old)) {
    Write-Host "[FATAL] $name anchor NOT FOUND - file drifted from v381 upload" -ForegroundColor Red
    exit 1
  }
  $script:s = $cur.Replace($old, $new)
  Write-Host "[OK] $name" -ForegroundColor Green
}

# --- [A] positional UP: drop forced first-CW tag on row 0 ------------------
$oldA = @'
                  nextFocusUpTag={item.rowIdx === 0 ? firstCWTag : null}
'@
$newA = @'
                  /* V382_POSITIONAL_UP - the forced V316c tag sent EVERY
                      UP press to one "first-mounted" CW card (last mount
                      wins, often card #2). CW cards share the same column
                      grid as row cards, so default spatial navigation
                      already lands UP-from-card-N on CW-card-N. */
                  nextFocusUpTag={null}
'@
Apply 'A: positional UP into CW' $oldA $newA

# --- [B1] release CW scroll lock when a non-CW row takes focus -------------
$oldB1 = @'
    const target = Math.max(0, sectionY - 12);
    scrollViewRef.current.scrollTo({ y: target, animated: false });
'@
$newB1 = @'
    const target = Math.max(0, sectionY - 12);
    /* V382_LOCK_RELEASE - focus moved to a non-CW row: kill the V278 CW
       snap-back lock NOW so this row-snap scroll isn't fought to y=0
       ("selector moves but the page doesn't"). */
    if (sectionKey !== '__cw__') { cwFocusLockUntilRef.current = 0; }
    scrollViewRef.current.scrollTo({ y: target, animated: false });
'@
Apply 'B1: lock release on non-CW focus' $oldB1 $newB1

# --- [B2] scope the onScroll snap-back to CW-focused state -----------------
$oldB2 = @'
            if (inLock && y > 0 && scrollViewRef.current) {
'@
$newB2 = @'
            if (inLock && y > 0 && lastFocusedSection.current === '__cw__' && scrollViewRef.current) { /* V382_LOCK_SCOPE */
'@
Apply 'B2: onScroll snap scoped to CW' $oldB2 $newB2

# --- [C1] backdrop prefetch: disk-only (stop pinning HD bitmaps in RAM) ----
$oldC1 = @'
          try { Image.prefetch(meta.background); } catch (_) {}
'@
$newC1 = @'
          /* V382_MEM - disk-only: default policy decoded every full-res
             backdrop into the shared memory cache while browsing. */
          try { Image.prefetch(meta.background, 'disk'); } catch (_) {}
'@
Apply 'C1: backdrop prefetch disk-only' $oldC1 $newC1

# --- [C2] clear expo-image memory cache when app backgrounds ---------------
$oldC2 = @'
        setFirstCWTag(typeof tag === 'number' && tag > 0 ? tag : null);
      }
    );
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);
'@
$newC2 = @'
        setFirstCWTag(typeof tag === 'number' && tag > 0 ? tag : null);
      }
    );
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);

  /* V382_MEM_TRIM - drop expo-image's decoded-bitmap memory cache when the
     app goes to background so lowmemorykiller has no reason to target us.
     Disk cache stays warm, so posters repaint instantly on resume. */
  useEffect(() => {
    const { AppState: _v382AS } = require('react-native');
    const _v382Sub = _v382AS.addEventListener('change', (st: string) => {
      if (st === 'background' || st === 'inactive') {
        try { Image.clearMemoryCache(); } catch (_) {}
      }
    });
    return () => { try { _v382Sub.remove(); } catch (_) {} };
  }, []);
'@
Apply 'C2: memory cache trim on background' $oldC2 $newC2

# --- [C3] CW poster recyclingKey -------------------------------------------
$oldC3 = @'
              source={{ uri: _v166Poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
'@
$newC3 = @'
              source={{ uri: _v166Poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
              recyclingKey={String((item as any).content_id)} /* V382_MEM */
'@
Apply 'C3: CW poster recyclingKey' $oldC3 $newC3

if ($s -ne $orig) {
  [System.IO.File]::WriteAllText($abs, $s)
  Write-Host ""
  Write-Host "[DONE] discover.tsx written. Run deploy_ota.bat, relaunch twice." -ForegroundColor Green
} else {
  Write-Host ""
  Write-Host "[NOOP] No changes were needed." -ForegroundColor Yellow
}
Write-Host ""
