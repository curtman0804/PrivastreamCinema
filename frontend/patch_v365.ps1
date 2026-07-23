# ============================================================================
# patch_v365.ps1 — Continue Watching: INSTANT disappear on "Clear Progress"
#
# Root cause of the lag:
#   1) Clearing progress from a DETAILS-page menu (episode card / poster)
#      never told Discover's local CW state — the stale card sat there for
#      up to 30s until the focus-effect refetch throttle expired.
#   2) Refetch race: if a CW fetch response landed while the background
#      DELETE was still in flight, the server payload re-added the card
#      (flicker-back), making the removal feel even slower.
#
# Fix (2 files):
#   [ContentCard.tsx] v176ClearProgress now broadcasts 'v365:cwCleared'
#      BEFORE the HTTP delete + records a tombstone (5 min TTL).
#   [discover.tsx]  listens for the broadcast → drops the card from BOTH
#      the live and disk-cached CW lists on the same frame; refetch results
#      are filtered against the tombstones so a card can never flicker back.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V365 CW Instant Clear" -ForegroundColor Cyan
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

# --- Patch 1: tombstone registry + broadcast inside v176ClearProgress ------
if ($cc.Contains('V365_CW_INSTANT_CLEAR_BUILD_TAG')) {
  Write-Host "[SKIP] ContentCard patch 1 already applied" -ForegroundColor Yellow
} else {
  $oldClear = @'
export async function v176ClearProgress(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v176ProgressSet.delete(key);
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }
}
'@

  $newClear = @'
/* V365_CW_INSTANT_CLEAR — tombstone registry + broadcast so the Discover
   Continue-Watching row drops a cleared card on the SAME FRAME the user
   taps "Clear Progress", no matter which screen the menu was opened from
   (CW card, discover poster, episode card on details).  The tombstone also
   shields the CW list from the refetch race: if a CW fetch response lands
   while the background DELETE is still in flight, the stale item is
   filtered out instead of flickering back onto the row. */
const _V365_BUILD_TAG = 'V365_CW_INSTANT_CLEAR_BUILD_TAG';
void _V365_BUILD_TAG;
const _v365ClearedAt = new Map<string, number>();
const _V365_TOMBSTONE_TTL_MS = 5 * 60 * 1000;
export function v365MarkCleared(contentId: string | undefined | null, opts?: { silent?: boolean }): void {
  if (!contentId) return;
  const key = String(contentId);
  _v365ClearedAt.set(key, Date.now());
  if (!opts || !opts.silent) {
    try { DeviceEventEmitter.emit('v365:cwCleared', key); } catch (_) {}
  }
}
export function v365IsCleared(contentId: string | undefined | null): boolean {
  if (!contentId) return false;
  const key = String(contentId);
  const at = _v365ClearedAt.get(key);
  if (!at) return false;
  if (Date.now() - at > _V365_TOMBSTONE_TTL_MS) {
    _v365ClearedAt.delete(key);
    return false;
  }
  return true;
}
export async function v176ClearProgress(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v176ProgressSet.delete(key);
  /* V365_CW_INSTANT_CLEAR — broadcast FIRST so Discover's CW row updates
     on this frame; the HTTP delete below stays slow-lane fire-and-forget. */
  v365MarkCleared(key);
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }
}
'@

  if (-not $cc.Contains($oldClear)) {
    Write-Host "[FATAL] ContentCard patch 1 anchor not found (v176ClearProgress body drifted)" -ForegroundColor Red
    exit 1
  }
  $cc = $cc.Replace($oldClear, $newClear)
  Write-Host "[OK] ContentCard patch 1: tombstone + broadcast in v176ClearProgress" -ForegroundColor Green
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

# --- Patch 2: import the v365 helpers ---------------------------------------
if ($d.Contains('v365MarkCleared as _v365MarkCleared')) {
  Write-Host "[SKIP] discover patch 2 already applied" -ForegroundColor Yellow
} else {
  $oldImport = @'
  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor
} from '../../src/components/ContentCard';
'@

  $newImport = @'
  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor,
  /* V365_CW_INSTANT_CLEAR */
  v365MarkCleared as _v365MarkCleared,
  v365IsCleared as _v365IsCleared
} from '../../src/components/ContentCard';
'@

  if (-not $d.Contains($oldImport)) {
    Write-Host "[FATAL] discover patch 2 anchor not found (ContentCard import block drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($oldImport, $newImport)
  Write-Host "[OK] discover patch 2: v365 helper imports" -ForegroundColor Green
}

# --- Patch 3: same-frame CW removal listener --------------------------------
if ($d.Contains('V365_CW_INSTANT_REMOVE_BUILD_TAG')) {
  Write-Host "[SKIP] discover patch 3 already applied" -ForegroundColor Yellow
} else {
  $oldV316c = @'
    const sub = DeviceEventEmitter.addListener(
      'v316c:firstCWTag',
      (tag: number | null) => {
        setFirstCWTag(typeof tag === 'number' && tag > 0 ? tag : null);
      }
    );
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);
'@

  $newV316c = @'
    const sub = DeviceEventEmitter.addListener(
      'v316c:firstCWTag',
      (tag: number | null) => {
        setFirstCWTag(typeof tag === 'number' && tag > 0 ? tag : null);
      }
    );
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);

  /* V365_CW_INSTANT_CLEAR — drop a cleared card from the CW row on the
     same frame the user taps "Clear Progress", regardless of which screen
     the long-press menu was opened from (CW card, discover poster, episode
     card on the details page).  Previously a clear from details left the
     stale card on Discover for up to 30s (focus-effect refetch throttle). */
  const _V365_DISCOVER_BUILD_TAG = 'V365_CW_INSTANT_REMOVE_BUILD_TAG';
  void _V365_DISCOVER_BUILD_TAG;
  useEffect(() => {
    const _v365Sub = DeviceEventEmitter.addListener('v365:cwCleared', (cid: string) => {
      if (!cid) return;
      try {
        LayoutAnimation.configureNext({
          duration: 120,
          update: { type: LayoutAnimation.Types.easeInEaseOut },
          delete: {
            type: LayoutAnimation.Types.easeInEaseOut,
            property: LayoutAnimation.Properties.opacity,
          },
        });
      } catch (_) {}
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
    });
    return () => { try { _v365Sub.remove(); } catch (_) {} };
  }, []);
'@

  if (-not $d.Contains($oldV316c)) {
    Write-Host "[FATAL] discover patch 3 anchor not found (v316c listener drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($oldV316c, $newV316c)
  Write-Host "[OK] discover patch 3: v365:cwCleared same-frame removal listener" -ForegroundColor Green
}

# --- Patch 4: tombstone filter on refetch ------------------------------------
if ($d.Contains('_v365IsCleared(it && it.content_id)')) {
  Write-Host "[SKIP] discover patch 4 already applied" -ForegroundColor Yellow
} else {
  $oldFetch = @'
      const _v204Next = response.continueWatching || [];
'@

  $newFetch = @'
      /* V365_CW_INSTANT_CLEAR — shield the fresh list from the refetch
         race: recently-cleared ids stay tombstoned until the background
         DELETE has had time to commit server-side (5 min TTL). */
      const _v204Next = (response.continueWatching || []).filter(
        (it: any) => !_v365IsCleared(it && it.content_id)
      );
'@

  if (-not $d.Contains($oldFetch)) {
    Write-Host "[FATAL] discover patch 4 anchor not found (_v204Next line drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($oldFetch, $newFetch)
  Write-Host "[OK] discover patch 4: tombstone filter in fetchContinueWatching" -ForegroundColor Green
}

# --- Patch 5: tombstone in the CW-card X/remove path -------------------------
if ($d.Contains('_v365MarkCleared(item.content_id, { silent: true })')) {
  Write-Host "[SKIP] discover patch 5 already applied" -ForegroundColor Yellow
} else {
  $oldRemove = @'
    // Then delete from server in background (don't await)
    api.watchProgress.delete(item.content_id).catch(err => {
'@

  $newRemove = @'
    /* V365_CW_INSTANT_CLEAR — tombstone (silent: local lists already
       filtered above) so a refetch can't re-add before DELETE commits. */
    try { _v365MarkCleared(item.content_id, { silent: true }); } catch (_) {}
    // Then delete from server in background (don't await)
    api.watchProgress.delete(item.content_id).catch(err => {
'@

  if (-not $d.Contains($oldRemove)) {
    Write-Host "[FATAL] discover patch 5 anchor not found (handleRemove delete line drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($oldRemove, $newRemove)
  Write-Host "[OK] discover patch 5: tombstone in handleRemoveFromContinueWatching" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V365 applied. Verify:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V365_CW_INSTANT_CLEAR_BUILD_TAG" src\components\ContentCard.tsx'
Write-Host '  findstr /C:"V365_CW_INSTANT_REMOVE_BUILD_TAG" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
