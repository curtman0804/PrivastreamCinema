# patch_v363.ps1 - V363 Nav polish + fast unmount round 3 + currentPlaying -> blobCache
# ---------------------------------------------------------------------------
# Fixes:
#   A. discover.tsx  - Debounce handleSectionFocus via rAF so rapid D-pad
#                      scrolls only fire ONE scrollTo (kills the "focus cascade").
#   B. discover.tsx  - Guard SNAP BACK timers with a stale check so if the
#                      user leaves the CW row the queued snap-to-0 is aborted.
#   C. id.tsx        - Broaden V361_FAST_UNMOUNT clear to nuke content + the
#                      global useContentStore streams so back-nav stays fast
#                      even on titles with 30+ streams (was regressing to 2.7-3.6s).
#   D. id.tsx        - Route "currentPlaying" write through blobCache instead
#                      of AsyncStorage (kills recurring SQLITE_FULL).
#   E. player.tsx    - Route "currentPlaying" read through blobCache first,
#                      with AsyncStorage fallback.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V363 Nav polish + fast unmount R3" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ============================================================================
# FIX A + B : discover.tsx  (focus cascade debounce + snap-back guard)
# ============================================================================
$discPath = 'app\(tabs)\discover.tsx'
$discAbs = (Resolve-Path -LiteralPath $discPath).Path
$disc = [System.IO.File]::ReadAllText($discAbs)
$discOrig = $disc

# --- A: Debounce handleSectionFocus body ---
# The current body runs a scrollTo synchronously EVERY time a D-pad focus
# hops into a section. When you arrow through 4 rails fast that's 4 scrollTos
# in ~60ms => visible ricochet. We coalesce via a single rAF: only the LAST
# section wins.
if (-not $disc.Contains('V363_SECTION_FOCUS_DEBOUNCE')) {
  $reBodyStart = '(?ms)(const\s+handleSectionFocus\s*=\s*useCallback\(\(sectionKey:\s*string\)\s*=>\s*\{)'
  if ($disc -match $reBodyStart) {
    $inject = @'
$1
    /* V363_SECTION_FOCUS_DEBOUNCE - coalesce rapid D-pad focus hops into
       a single scrollTo per animation frame. Prevents the "focus cascade"
       where arrowing past 3-4 rails fired 3-4 scrollTos back-to-back. */
    (globalThis as any).__v363_pendingSection = sectionKey;
    if ((globalThis as any).__v363_pendingRAF) {
      cancelAnimationFrame((globalThis as any).__v363_pendingRAF);
    }
    (globalThis as any).__v363_pendingRAF = requestAnimationFrame(() => {
      (globalThis as any).__v363_pendingRAF = null;
      const key = (globalThis as any).__v363_pendingSection;
      if (key !== sectionKey) return;  /* newer focus took over */
'@
    $disc = [regex]::Replace($disc, $reBodyStart, $inject.Replace('$1','$$1'), 1)

    # Now we need to close the extra rAF callback. Append `});` right before
    # the FINAL closing `}, []);` of handleSectionFocus.
    # Anchor: `lastFocusedSection.current = sectionKey;\n  }, []);`
    $reClose = "(?ms)(lastFocusedSection\.current\s*=\s*sectionKey;\s*)\}\s*,\s*\[\]\s*\);"
    if ($disc -match $reClose) {
      $newClose = "`$1});`n  }, []);"
      $disc = [regex]::Replace($disc, $reClose, $newClose, 1)
      Write-Host "  [OK]   A) handleSectionFocus debounce wrapper applied" -ForegroundColor Green
    } else {
      Write-Host "  [FAIL] A) Could not find handleSectionFocus close anchor" -ForegroundColor Red
    }
  } else {
    Write-Host "  [FAIL] A) handleSectionFocus start anchor NOT FOUND" -ForegroundColor Red
  }
} else {
  Write-Host "  [NOOP] A) V363_SECTION_FOCUS_DEBOUNCE already applied" -ForegroundColor DarkGray
}

# --- B: SNAP BACK guard - abort queued snaps if user left the CW row ---
if (-not $disc.Contains('V363_SNAP_ABORT')) {
  $reSnap = "(?ms)const\s+_snap\s*=\s*\(\)\s*=>\s*\{\s*if\s*\(scrollViewRef\.current\)\s*\{\s*scrollViewRef\.current\.scrollTo\(\{\s*y:\s*0,\s*animated:\s*false\s*\}\);\s*\}\s*\};"
  if ($disc -match $reSnap) {
    $newSnap = @'
const _snap = () => {
        /* V363_SNAP_ABORT - if the user D-padded off the CW row while our
           timers were queued, the snap-to-0 would jerk them back up. Abort. */
        if (lastFocusedSection.current !== '__cw__') return;
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({ y: 0, animated: false });
        }
      };
'@
    $disc = [regex]::Replace($disc, $reSnap, $newSnap, 1)
    Write-Host "  [OK]   B) SNAP BACK guard applied" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] B) _snap anchor NOT FOUND - snap-to-0 stays unguarded" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [NOOP] B) V363_SNAP_ABORT already applied" -ForegroundColor DarkGray
}

if ($disc -ne $discOrig) {
  [System.IO.File]::WriteAllText($discAbs, $disc)
  Write-Host "  [WRITE] $discPath saved" -ForegroundColor Cyan
}

# ============================================================================
# FIX C + D : app\details\[type]\[id].tsx  (broader unmount + blobCache write)
# ============================================================================
$idPath = 'app\details\[type]\[id].tsx'
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)
$idOrig = $id

# --- C: Broaden V361_FAST_UNMOUNT - also clear content + global streams ---
if (-not $id.Contains('V363_BROAD_UNMOUNT')) {
  $reV361 = "console\.log\('\[V361_UNMOUNT\] state cleared t\+' \+ \(Date\.now\(\) - _v361_t0\) \+ 'ms'\);"
  if ($id -match $reV361) {
    $inject = @'
/* V363_BROAD_UNMOUNT - broaden clear: content (meta blob), global streams
   store, and any large lists. React unmount cost was regressing to 2.7-3.6s
   on titles with 30+ streams because those child components stayed mounted
   until the parent tore down. */
        try { setContent && setContent(null); } catch (_) {}
        try { (useContentStore as any).setState({ streams: [], isLoadingStreams: false }); } catch (_) {}
        console.log('[V361_UNMOUNT] state cleared t+' + (Date.now() - _v361_t0) + 'ms');
'@
    $id = [regex]::Replace($id, $reV361, $inject, 1)
    Write-Host "  [OK]   C) V363_BROAD_UNMOUNT applied" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] C) V361_UNMOUNT anchor NOT FOUND - skipping broader clear" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [NOOP] C) V363_BROAD_UNMOUNT already applied" -ForegroundColor DarkGray
}

# --- D: Route currentPlaying WRITE through blobCache ---
if (-not $id.Contains('V363_CURPLAY_BLOB')) {
  # Match:
  #   await AsyncStorage.setItem('currentPlaying', JSON.stringify({
  #     contentType: cType, contentId: id, title: contentTitle,
  #   }));
  $reCP = "(?ms)await\s+AsyncStorage\.setItem\('currentPlaying',\s*JSON\.stringify\(\{[^}]+\}\)\);"
  if ($id -match $reCP) {
    $newCP = @'
/* V363_CURPLAY_BLOB - move off SQLite (SQLITE_FULL crash) onto FS. */
      try {
        const _b363 = require('../../../src/utils/blobCache');
        await _b363.setBlob('currentPlaying', JSON.stringify({
          contentType: cType,
          contentId: id,
          title: contentTitle,
        }));
      } catch (_) {
        await AsyncStorage.setItem('currentPlaying', JSON.stringify({
          contentType: cType,
          contentId: id,
          title: contentTitle,
        }));
      }
'@
    $id = [regex]::Replace($id, $reCP, $newCP, 1)
    Write-Host "  [OK]   D) currentPlaying write -> blobCache applied" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] D) currentPlaying setItem anchor NOT FOUND" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [NOOP] D) V363_CURPLAY_BLOB already applied" -ForegroundColor DarkGray
}

if ($id -ne $idOrig) {
  [System.IO.File]::WriteAllText($idAbs, $id)
  Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan
}

# ============================================================================
# FIX E : app\player.tsx  (blobCache read for currentPlaying with fallback)
# ============================================================================
$plPath = 'app\player.tsx'
$plAbs = (Resolve-Path -LiteralPath $plPath).Path
$pl = [System.IO.File]::ReadAllText($plAbs)
$plOrig = $pl

if (-not $pl.Contains('V363_CURPLAY_BLOB_READ')) {
  # Match: const storedData = await AsyncStorage.getItem('currentPlaying');
  $reCPr = "const\s+storedData\s*=\s*await\s+AsyncStorage\.getItem\('currentPlaying'\);"
  if ($pl -match $reCPr) {
    $newCPr = @'
/* V363_CURPLAY_BLOB_READ - prefer blobCache, fall back to AsyncStorage. */
        let storedData: string | null = null;
        try {
          const _b363 = require('../src/utils/blobCache');
          storedData = await _b363.getBlob('currentPlaying');
        } catch (_) { /* blobCache import failed */ }
        if (storedData == null) {
          storedData = await AsyncStorage.getItem('currentPlaying');
        }
'@
    $pl = [regex]::Replace($pl, $reCPr, $newCPr, 1)
    Write-Host "  [OK]   E) player currentPlaying read -> blobCache applied" -ForegroundColor Green
  } else {
    Write-Host "  [WARN] E) player currentPlaying getItem anchor NOT FOUND" -ForegroundColor Yellow
  }
} else {
  Write-Host "  [NOOP] E) V363_CURPLAY_BLOB_READ already applied" -ForegroundColor DarkGray
}

if ($pl -ne $plOrig) {
  [System.IO.File]::WriteAllText($plAbs, $pl)
  Write-Host "  [WRITE] $plPath saved" -ForegroundColor Cyan
}

# ============================================================================
# Verification
# ============================================================================
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  V363_SECTION_FOCUS_DEBOUNCE hits : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SECTION_FOCUS_DEBOUNCE' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_SNAP_ABORT hits             : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SNAP_ABORT' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_BROAD_UNMOUNT hits          : " + (Select-String -LiteralPath $idPath -Pattern 'V363_BROAD_UNMOUNT' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_CURPLAY_BLOB (write) hits   : " + (Select-String -LiteralPath $idPath -Pattern 'V363_CURPLAY_BLOB' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_CURPLAY_BLOB_READ hits      : " + (Select-String -LiteralPath $plPath -Pattern 'V363_CURPLAY_BLOB_READ' -SimpleMatch).Count) -ForegroundColor Green

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
Write-Host "Reopen the app and try:" -ForegroundColor Yellow
Write-Host "  1) Arrow down through 4-5 rails FAST on Discover" -ForegroundColor Yellow
Write-Host "     -> should NOT ricochet, only settle at final row" -ForegroundColor Yellow
Write-Host "  2) Arrow back UP past CW to the top" -ForegroundColor Yellow
Write-Host "     -> should NOT snap to 0 if you kept arrowing" -ForegroundColor Yellow
Write-Host "  3) Open a title with lots of streams, back out" -ForegroundColor Yellow
Write-Host "     -> UNMOUNT should stay <500ms" -ForegroundColor Yellow
Write-Host ""
Write-Host "Verify with:" -ForegroundColor Yellow
Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V361_UNMOUNT V363 SQLITE"' -ForegroundColor Gray
