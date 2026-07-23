# ============================================================================
# patch_v369.ps1 (pure ASCII) - JS-thread lag: kill the re-render storms
#
# Findings from lag_capture.log (12:10 capture):
#   1) "Clear Progress" fired TWO DELETE /api/watch-progress calls 2ms apart
#      (12:10:13.383 + .385) - second one 404'd.  Cause: the popover action
#      runs BOTH onAfterChange -> discover handleRemove (DELETE #1) AND
#      v176ClearProgress (DELETE #2).
#   2) The card only unmounted 1.2s after the OK press (12:10:10.885 press ->
#      12:10:12.078 unmount).  Cause: v176ClearProgress notifies the progress
#      registry, and EVERY mounted ContentCard (~100) does an unconditional
#      setState bump -> ~100 card re-renders, then discover's register-effect
#      notifies them ALL a second time.  ContentCard renders NOTHING from the
#      progress registry, so both passes were pure waste.
#   3) Back-nav to Discover: Choreographer skipped 52 frames (~870ms) + a
#      1051ms Davey frame.  Cause: ServiceRow is React.memo'd but discover
#      passed a FRESH .slice(0,100) array and a FRESH inline onItemFocus
#      closure on every render -> memo defeated -> ANY discover state change
#      (CW refetch lands after back-nav) re-rendered EVERY rail + cards.
#   4) [V311_PERF] details/MOUNT logged 6x per details open: start()/mark()
#      run in the component body, so every re-render reset the profiler and
#      shipped another bridge log.
#
# Fix (3 files):
#   [ContentCard.tsx]
#     p1 V369_SINGLE_FLIGHT_DELETE - one dedup'd DELETE per clear (8s window)
#     p2 V369_SKIP_NOOP_REGISTER   - registry notify only on REAL changes
#     p3 V369_NO_PROGRESS_BUMP     - drop the useless per-card progress sub
#     p4 V369_SCOPED_BUMP          - watched-badge bump only when THIS card's
#                                    own flag flipped (was: every card, every
#                                    registry change)
#   [discover.tsx]
#     p5/p6/p7/p8 V369_STABLE_ROW_PROPS - identity-stable items + onItemFocus
#                                    so unchanged rails bail out in memo;
#                                    handleRemove routes DELETE through the
#                                    single-flight helper
#   [id.tsx]
#     p9 V369_PERF_ONCE            - profiler start/MOUNT once per mount
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V369 re-render storm elimination" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

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

# --- Patch 1: single-flight DELETE ------------------------------------------
if ($cc.Contains('V369_SINGLE_FLIGHT_DELETE')) {
  Write-Host "[SKIP] ContentCard p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }
}
'@

  $new1 = @'
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  try { v369DeleteProgressOnce(key); } catch (_) { /* best-effort */ }
}

/* V369_SINGLE_FLIGHT_DELETE - "Clear Progress" fired TWO DELETEs 2ms apart
   (onAfterChange -> discover handleRemove -> DELETE #1, then
   v176ClearProgress -> DELETE #2 -> 404).  Both paths now route through
   this 8s-window dedupe so exactly ONE HTTP call goes out per clear. */
const _v369DeletedAt = new Map<string, number>();
export function v369DeleteProgressOnce(contentId: string | undefined | null): void {
  if (!contentId) return;
  const key = String(contentId);
  const now = Date.now();
  if (now - (_v369DeletedAt.get(key) || 0) < 8000) return;
  _v369DeletedAt.set(key, now);
  try {
    (api as any).watchProgress.delete(key).catch(() => { /* best-effort */ });
  } catch (_) { /* best-effort */ }
}
'@

  if (-not $cc.Contains($old1)) {
    Write-Host "[FATAL] ContentCard p1 anchor not found (v176ClearProgress tail drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($old1, $new1)
  Write-Host "[OK] ContentCard p1: single-flight DELETE" -ForegroundColor Green
}

# --- Patch 2: registry notify only on real change ----------------------------
if ($cc.Contains('V369_SKIP_NOOP_REGISTER')) {
  Write-Host "[SKIP] ContentCard p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
export function v176RegisterProgress(ids: Array<string | undefined | null>): void {
  _v176ProgressSet.clear();
  for (const raw of (ids || [])) {
    if (!raw) continue;
    _v176ProgressSet.add(String(raw));
  }
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
}
'@

  $new2 = @'
export function v176RegisterProgress(ids: Array<string | undefined | null>): void {
  /* V369_SKIP_NOOP_REGISTER - discover re-registers the same id set on
     every CW state change; notifying subscribers for an IDENTICAL set
     triggered pointless re-render passes.  Only notify on real changes. */
  const next = new Set<string>();
  for (const raw of (ids || [])) {
    if (!raw) continue;
    next.add(String(raw));
  }
  let changed = next.size !== _v176ProgressSet.size;
  if (!changed) {
    for (const k of next) { if (!_v176ProgressSet.has(k)) { changed = true; break; } }
  }
  if (!changed) return;
  _v176ProgressSet.clear();
  for (const k of next) _v176ProgressSet.add(k);
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
}
'@

  if (-not $cc.Contains($old2)) {
    Write-Host "[FATAL] ContentCard p2 anchor not found (v176RegisterProgress drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($old2, $new2)
  Write-Host "[OK] ContentCard p2: skip no-op registry notifies" -ForegroundColor Green
}

# --- Patch 3: drop the useless per-card progress subscription ----------------
if ($cc.Contains('V369_NO_PROGRESS_BUMP')) {
  Write-Host "[SKIP] ContentCard p3 already applied" -ForegroundColor Yellow
} else {
  $old3 = @'
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const t = setTimeout(() => {
      unsub = v176SubscribeProgress(() => _v172Bump((x) => (x + 1) & 0xff));
    }, 250);
    return () => { clearTimeout(t); if (unsub) try { unsub(); } catch (_) {} };
  }, []);
'@

  $new3 = @'
  /* V369_NO_PROGRESS_BUMP - subscription removed: ContentCard renders
     NOTHING that depends on the progress registry (the long-press menu
     reads v176HasProgress live at open time).  The old unconditional bump
     re-rendered EVERY mounted card (~100) TWICE per Clear Progress -
     measured as the 1.2s press-to-unmount freeze in lag_capture.log. */
'@

  if (-not $cc.Contains($old3)) {
    Write-Host "[FATAL] ContentCard p3 anchor not found (v176SubscribeProgress effect drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($old3, $new3)
  Write-Host "[OK] ContentCard p3: per-card progress subscription removed" -ForegroundColor Green
}

# --- Patch 4: watched bump only when THIS card's flag flipped ----------------
if ($cc.Contains('V369_SCOPED_BUMP')) {
  Write-Host "[SKIP] ContentCard p4 already applied" -ForegroundColor Yellow
} else {
  $old4 = @'
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const t = setTimeout(() => {
      unsub = v172SubscribeWatched(() => _v172Bump((x) => (x + 1) & 0xff));
    }, 250);
    return () => { clearTimeout(t); if (unsub) try { unsub(); } catch (_) {} };
  }, []);
'@

  $new4 = @'
  /* V369_SCOPED_BUMP - only re-render THIS card when ITS OWN watched flag
     actually flipped.  The old unconditional bump re-rendered every
     mounted card on any watched-registry change. */
  const _v369LastWatched = useRef<boolean>(v172IsWatched(_v172ContentId));
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const t = setTimeout(() => {
      unsub = v172SubscribeWatched(() => {
        const _now = v172IsWatched(_v172ContentId);
        if (_now !== _v369LastWatched.current) {
          _v369LastWatched.current = _now;
          _v172Bump((x) => (x + 1) & 0xff);
        }
      });
    }, 250);
    return () => { clearTimeout(t); if (unsub) try { unsub(); } catch (_) {} };
  }, []);
'@

  if (-not $cc.Contains($old4)) {
    Write-Host "[FATAL] ContentCard p4 anchor not found (v172SubscribeWatched effect drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($old4, $new4)
  Write-Host "[OK] ContentCard p4: scoped watched-badge bump" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($ccAbs, $cc)

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

# --- Patch 5: import the single-flight delete helper --------------------------
if ($d.Contains('v369DeleteProgressOnce as _v369DeleteProgressOnce')) {
  Write-Host "[SKIP] discover p5 already applied" -ForegroundColor Yellow
} else {
  $old5 = @'
  v365IsCleared as _v365IsCleared
} from '../../src/components/ContentCard';
'@

  $new5 = @'
  v365IsCleared as _v365IsCleared,
  /* V369_SINGLE_FLIGHT_DELETE */
  v369DeleteProgressOnce as _v369DeleteProgressOnce
} from '../../src/components/ContentCard';
'@

  if (-not $d.Contains($old5)) {
    Write-Host "[FATAL] discover p5 anchor not found (v365 import block drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old5, $new5)
  Write-Host "[OK] discover p5: v369 helper import" -ForegroundColor Green
}

# --- Patch 6: stable-prop caches ----------------------------------------------
if ($d.Contains('V369_STABLE_ROW_PROPS')) {
  Write-Host "[SKIP] discover p6 already applied" -ForegroundColor Yellow
} else {
  $old6 = @'
// Navigation handler (kept minimal for speed)
const handleItemPress = useCallback((item: ContentItem) => {
'@

  $new6 = @'
/* V369_STABLE_ROW_PROPS - ServiceRow is React.memo'd, but every discover
   re-render passed it a FRESH items array (.slice(0, 100)) and a FRESH
   inline onItemFocus closure, defeating memo entirely: ANY state change
   (CW clear, CW refetch landing after back-nav) re-rendered EVERY rail
   and its cards.  lag_capture.log measured this as 52 skipped frames +
   a 1051ms Davey on back-nav and the 1.2s Clear Progress freeze.  The
   caches below hand ServiceRow identity-stable props so unchanged rails
   bail out in the memo compare.  handleSectionFocus/handleItemFocus are
   useCallback([]) stable, so the cached closures never go stale. */
const _v369SliceCache = useRef(new WeakMap<any, any[]>()).current;
const _v369EmptyItems = useRef<any[]>([]).current;
const _v369StableSlice = (row: any): any[] => {
  const src: any[] = row && row.items ? row.items : _v369EmptyItems;
  let s = _v369SliceCache.get(src);
  if (!s) { s = src.slice(0, 100); _v369SliceCache.set(src, s); }
  return s;
};
const _v369FocusHandlers = useRef<Record<string, (ci: any) => void>>({}).current;
const _v369RowFocusHandler = (rowKey: string, contentType: string) => {
  const hk = rowKey + '|' + contentType;
  let h = _v369FocusHandlers[hk];
  if (!h) {
    h = (ci: any) => {
      handleSectionFocus(rowKey);
      if (contentType !== 'channels') handleItemFocus(ci);
    };
    _v369FocusHandlers[hk] = h;
  }
  return h;
};

// Navigation handler (kept minimal for speed)
const handleItemPress = useCallback((item: ContentItem) => {
'@

  if (-not $d.Contains($old6)) {
    Write-Host "[FATAL] discover p6 anchor not found (handleItemPress header drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old6, $new6)
  Write-Host "[OK] discover p6: stable-prop caches installed" -ForegroundColor Green
}

# --- Patch 7: identity-stable items prop --------------------------------------
$old7 = @'
                  items={(item.items || []).slice(0, 100)}
'@
if (-not $d.Contains($old7)) {
  if ($d.Contains('items={_v369StableSlice(item)')) {
    Write-Host "[SKIP] discover p7 already applied" -ForegroundColor Yellow
  } else {
    Write-Host "[FATAL] discover p7 anchor not found (items slice line drifted)" -ForegroundColor Red
    exit 1
  }
} else {
  $new7 = @'
                  items={_v369StableSlice(item) /* V369_STABLE_ROW_PROPS */}
'@
  $d = $d.Replace($old7, $new7)
  Write-Host "[OK] discover p7: identity-stable items prop" -ForegroundColor Green
}

# --- Patch 8: identity-stable onItemFocus prop ---------------------------------
$old8 = @'
                  onItemFocus={
                    item.contentType !== 'channels'
                      ? (ci) => {
                          handleSectionFocus(item.key);
                          handleItemFocus(ci);
                        }
                      : (ci) => {
                          handleSectionFocus(item.key);
                        }
                  }
'@
if (-not $d.Contains($old8)) {
  if ($d.Contains('onItemFocus={_v369RowFocusHandler(')) {
    Write-Host "[SKIP] discover p8 already applied" -ForegroundColor Yellow
  } else {
    Write-Host "[FATAL] discover p8 anchor not found (onItemFocus block drifted)" -ForegroundColor Red
    exit 1
  }
} else {
  $new8 = @'
                  onItemFocus={_v369RowFocusHandler(item.key, item.contentType) /* V369_STABLE_ROW_PROPS */}
'@
  $d = $d.Replace($old8, $new8)
  Write-Host "[OK] discover p8: identity-stable onItemFocus prop" -ForegroundColor Green
}

# --- Patch 9: handleRemove routes DELETE through the single-flight helper -----
$old9 = @'
    api.watchProgress.delete(item.content_id).catch(err => {
      console.log('[Discover] Error removing from continue watching:', err);
      // Optionally: restore the item if delete fails
    });
'@
if (-not $d.Contains($old9)) {
  if ($d.Contains('_v369DeleteProgressOnce(item.content_id)')) {
    Write-Host "[SKIP] discover p9 already applied" -ForegroundColor Yellow
  } else {
    Write-Host "[FATAL] discover p9 anchor not found (handleRemove delete drifted)" -ForegroundColor Red
    exit 1
  }
} else {
  $new9 = @'
    _v369DeleteProgressOnce(item.content_id); /* V369_SINGLE_FLIGHT_DELETE */
'@
  $d = $d.Replace($old9, $new9)
  Write-Host "[OK] discover p9: handleRemove uses single-flight DELETE" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

# ------------------------------------------------------------------
# id.tsx - profiler start/MOUNT once per mount
# ------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) {
  Write-Host "[FATAL] $idPath not found." -ForegroundColor Red
  exit 1
}
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if ($id.Contains('V369_PERF_ONCE')) {
  Write-Host "[SKIP] id.tsx p10 already applied" -ForegroundColor Yellow
} else {
  $old10 = @'
  v311Perf.start('details');
  v311Perf.mark('MOUNT');
'@

  $new10 = @'
  /* V369_PERF_ONCE - start()/mark() ran in the component BODY, so every
     re-render (6x per open in lag_capture.log) reset the profiler and
     shipped another bridge log.  Ref-guarded to fire once per mount. */
  const _v369PerfStarted = React.useRef(false);
  if (!_v369PerfStarted.current) {
    _v369PerfStarted.current = true;
    v311Perf.start('details');
    v311Perf.mark('MOUNT');
  }
'@

  if (-not $id.Contains($old10)) {
    Write-Host "[FATAL] id.tsx p10 anchor not found (v311Perf mount block drifted)" -ForegroundColor Red
    exit 1
  }
  $id = $id.Replace($old10, $new10)
  Write-Host "[OK] id.tsx p10: profiler fires once per mount" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($idAbs, $id)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V369 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V369_SINGLE_FLIGHT_DELETE" src\components\ContentCard.tsx'
Write-Host '  findstr /C:"V369_STABLE_ROW_PROPS" app\(tabs)\discover.tsx'
Write-Host '  findstr /C:"V369_PERF_ONCE" "app\details\[type]\[id].tsx"'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
