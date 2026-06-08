/*
 * apply_patches_v188_polish.js
 *
 * V188 — Frontend polish bundle (3 files):
 *   A. id.tsx → No more "0 Streams" flash on mount.  Clear state
 *      synchronously so the very first render shows "Finding Streams..."
 *      even before fetchStreams kicks off.
 *   B. addons.tsx → Remove the X-close icon in the share modal (the
 *      bottom "Close" button already does this; the X was duplicate).
 *   C. ContentCard.tsx → Nav-cooldown.  When the user backs out of
 *      a Details page, suppress focus-prefetch API calls for 1.2 s
 *      so the JS thread is free for D-pad input → kills the Discover
 *      selector lag immediately after Back.
 *
 * Properties:
 *   - Idempotent (markers V188_NO_ZERO_FLASH + V188_SHARE_NOX +
 *     V188_NAV_COOLDOWN)
 *   - CRLF preserved
 *   - Backups: .v188.bak
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v188_polish.js -o apply_patches_v188_polish.js
 *   node apply_patches_v188_polish.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
function find(cands) {
  for (const c of cands) {
    const p = path.join(ROOT, ...c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const addonsFile = find([
  ['app', '(tabs)', 'addons.tsx'],
  ['app', 'addons.tsx'],
  ['app', 'settings', 'addons.tsx'],
]);
const detailsFile = find([
  ['app', 'details', '[type]', '[id].tsx'],
  ['app', '(tabs)', 'details', '[type]', '[id].tsx'],
  ['app', 'details', '[id].tsx'],
]);
const cardFile = find([
  ['src', 'components', 'ContentCard.tsx'],
  ['components', 'ContentCard.tsx'],
  ['src', 'components', 'cards', 'ContentCard.tsx'],
]);

if (!addonsFile)  { console.error('[v188] FATAL: addons.tsx not found.');  process.exit(1); }
if (!detailsFile) { console.error('[v188] FATAL: details/[type]/[id].tsx not found.'); process.exit(1); }
if (!cardFile)    { console.error('[v188] FATAL: ContentCard.tsx not found.'); process.exit(1); }

console.log('[v188] addons:  ', path.relative(ROOT, addonsFile));
console.log('[v188] details: ', path.relative(ROOT, detailsFile));
console.log('[v188] card:    ', path.relative(ROOT, cardFile));

function patchFile(file, marker, edits) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
  if (text.indexOf(marker) !== -1) {
    console.log(`[v188] ${path.basename(file)}: already patched (${marker}), skipping.`);
    return;
  }
  for (const e of edits) {
    if (text.indexOf(e.old) === -1) {
      console.error(`[v188] FATAL anchor missed in ${path.basename(file)}: ${e.label}`);
      console.error(`        looked for:\n${e.old.slice(0, 220)}...`);
      process.exit(2);
    }
    text = text.replace(e.old, e.new, 1);
    console.log(`[v188] ${path.basename(file)}: ${e.label}`);
  }
  const bak = file + '.v188.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[v188] wrote ${path.relative(ROOT, file)} (${eol.toUpperCase()}, backup=.v188.bak)`);
}

// ════════════════════════════════════════════════════════════════════════
// A. id.tsx — no more "0 Streams" flash on mount
// ════════════════════════════════════════════════════════════════════════
//
// Today the page mounts, renders ONE frame with whatever streams state
// the store still holds (could be [] left over from a prior failed
// fetch), and THEN the setTimeout(..., 0) fires fetchStreams which sets
// isLoadingStreams=true.  That one frame shows "0 Streams" → user
// notices a brief flash.
//
// Fix: synchronously seed the store with {streams:[], isLoadingStreams:true}
// right before the setTimeout so the FIRST render is already in the
// "Finding Streams..." state.

const detailsOldStreamsKickoff = `    if (type && id && (type === 'movie' || type === 'tv' || isEpisodePage)) {
      // PATCH_V37_DEFER_STREAMS — defer to next tick so the details page paints
      // instantly; streams load in the background and populate as they arrive.
      const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);
    }`;
const detailsNewStreamsKickoff = `    if (type && id && (type === 'movie' || type === 'tv' || isEpisodePage)) {
      // V188_NO_ZERO_FLASH — sync-seed loading state so the very first render
      // shows "Finding Streams..." instead of momentarily flashing "0 Streams"
      // (which can happen if streams=[] is left over from a prior failed load).
      try { (useContentStore as any).setState({ streams: [], isLoadingStreams: true, error: null }); } catch (_) {}
      // PATCH_V37_DEFER_STREAMS — defer to next tick so the details page paints
      // instantly; streams load in the background and populate as they arrive.
      const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);
    }`;

patchFile(detailsFile, 'V188_NO_ZERO_FLASH', [
  { label: 'A1. sync-seed loading state on mount', old: detailsOldStreamsKickoff, new: detailsNewStreamsKickoff },
]);

// ════════════════════════════════════════════════════════════════════════
// B. addons.tsx — remove duplicate X close icon from share modal
// ════════════════════════════════════════════════════════════════════════

const addonsOldHeader = `            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share {shareModalData?.name || 'Addon'}</Text>
              <Pressable onPress={() => setShareModalData(null)} style={styles.actionButton}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>`;
const addonsNewHeader = `            <View style={styles.modalHeader}>
              {/* V188_SHARE_NOX — bottom Close button is enough; remove redundant X */}
              <Text style={styles.modalTitle}>Share {shareModalData?.name || 'Addon'}</Text>
            </View>`;

patchFile(addonsFile, 'V188_SHARE_NOX', [
  { label: 'B1. drop X icon from share modal header', old: addonsOldHeader, new: addonsNewHeader },
]);

// ════════════════════════════════════════════════════════════════════════
// C. ContentCard.tsx — nav cooldown after back from Details
// ════════════════════════════════════════════════════════════════════════
//
// When the user backs out of Details to Discover, the focus-prewarm API
// dwell timer (900 ms) for every card the D-pad passes can stack up
// pending fetchStream calls.  Even with v170's concurrency cap, the JS
// thread feels sluggish for ~1 s right after Back.
//
// Fix: a module-scoped `_v188NavCooldownUntil` timestamp.  When set,
// handleFocus skips its dwell timer entirely (no prefetch, no scheduled
// network call).  We arm the cooldown from the same place we already
// abort in-flight streams (id.tsx handleBack/hardwareBack → calls
// useContentStore.getState().cancelInFlightStreams()).  ContentCard
// observes the same cancel event by patching cancelInFlightStreams to
// ALSO bump the cooldown.
//
// To avoid touching id.tsx again, we wrap the cancelInFlightStreams call
// inside the contentStore — but that requires editing contentStore.ts.
// Instead, we expose `__v188_armNavCooldown(ms)` from ContentCard and
// have the user's existing v187 handleBack reach into the global.
// Simpler still: subscribe to a store-level "_v188NavTick" counter so
// no extra file plumbing is needed.
//
// Approach used here: piggy-back on the v187 abort token.  ContentCard
// already imports `_v169UseContentStore`.  We add a tiny module-level
// `useEffect` (in the same file) that polls every render — but that's
// heavy.  Cleanest: expose a setter on the module and have id.tsx call
// it directly — but again requires editing id.tsx.
//
// FINAL approach: ContentCard sets the cooldown WHEN ITSELF UNMOUNTS
// IN BULK.  When the user backs from Details to Discover, the previously
// unmounted ContentCards (in Details lists) aren't relevant — but the
// Discover cards remount-stay-mounted.  So we trigger cooldown via the
// global `_v169UseContentStore.subscribe(...)` on the isLoadingStreams
// transition true→false (which fires when a back-cancelled fetch
// resolves AFTER the abort).  That isn't reliable either.
//
// Pragmatic approach: just gate the dwell timer behind a simple time
// check using `_v170LastClickTimestamp`.  We assume that pressing OK on
// a card sets a timestamp; if the user comes back within ~1.5 s, we
// suppress prefetches.  Since OK→navigate→back round-trip is typically
// 1-3 s on Firestick, this catches most back-nav lag windows.

const cardOldHandleFocus = `  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onCardFocus?.();
    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only
       movies get streams prefetched (series root IDs have no usable
       streams; the v138 patch already prefetches the next episode). */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }
    const _v169_type = (item as any)?.type;
    const _v169_cid = (item as any)?.imdb_id || (item as any)?.id;
    if (_v169_cid && _v169_type === 'movie' && String(_v169_cid).startsWith('tt')) {
      /* V170_FOCUS_DWELL_TUNE — 900ms dwell + concurrency cap so D-pad
         scrolling doesn't flood the backend and the JS bridge. */
      _v169PrewarmTimerRef.current = setTimeout(() => {`;
const cardNewHandleFocus = `  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onCardFocus?.();
    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only
       movies get streams prefetched (series root IDs have no usable
       streams; the v138 patch already prefetches the next episode). */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }
    /* V188_NAV_COOLDOWN — if the user just backed out of a Details page,
       suppress focus prefetch for 1.2 s.  Lets the JS thread serve D-pad
       focus changes without competing with network kick-offs. */
    if (Date.now() < (_v188NavCooldownUntil as any)) return;
    const _v169_type = (item as any)?.type;
    const _v169_cid = (item as any)?.imdb_id || (item as any)?.id;
    if (_v169_cid && _v169_type === 'movie' && String(_v169_cid).startsWith('tt')) {
      /* V170_FOCUS_DWELL_TUNE — 900ms dwell + concurrency cap so D-pad
         scrolling doesn't flood the backend and the JS bridge. */
      _v169PrewarmTimerRef.current = setTimeout(() => {`;

// Add module-level state + arm cooldown when card press fires
// (best signal we have for "user just clicked a card to go to Details").
const cardOldPrewarmExport = `export function v167PrewarmReleaseStatus(imdbIds: string[] | undefined | null): void {`;
const cardNewPrewarmExport = `// V188_NAV_COOLDOWN — module-scoped timestamp.  Bumped whenever any
// ContentCard's onPress fires (user is heading INTO Details).  After
// they back out (~1-3 s later) we still have ~1 s of cooldown left,
// which suppresses focus prefetches while D-pad navigation recovers.
export let _v188NavCooldownUntil = 0;
export function _v188ArmNavCooldown(ms: number = 1500): void {
  _v188NavCooldownUntil = Date.now() + Math.max(0, ms);
}

export function v167PrewarmReleaseStatus(imdbIds: string[] | undefined | null): void {`;

// Arm cooldown when ContentCard's onPress fires.
// Anchor: existing handler "const handlePress = useCallback(() => {".  Match
// the leading whitespace.  We add 1 line just inside the body.
//
// Different versions of this file may have slightly different press
// handlers; use a defensive regex-style search anchor that matches the
// likely body.
const cardOldHandlePress = `  const handleFocus = useCallback(() => {`;
// (We'll inject _v188ArmNavCooldown(1500) BEFORE the handleFocus declaration,
// inside the press handler.  Since the press handler appears later in
// the file, we anchor on the `_v169PrewarmTimerRef` usage in onPress.
//
// Simpler: arm from the same place handleFocus is declared — add a
// useEffect that arms cooldown on unmount.  But that fires for EVERY
// card unmount (e.g. virtualization), not what we want.
//
// Cleanest: arm from `onCardFocus?.()` itself isn't right either.
//
// Final approach: arm cooldown right in handleFocus's first line
// (so every D-pad navigation extends cooldown by 1.5s).  Wait, that
// would suppress ALL prefetches forever as the user navigates.
//
// REVERT TO PRAGMATIC: arm cooldown from an exported `_v188ArmNavCooldown`
// AND call it from id.tsx's handleBack (NEXT edit below).

const cardOldImports = `import { useFocusEffect } from '@react-navigation/native';`;
const cardNewImports = `import { useFocusEffect } from '@react-navigation/native';
// V188_NAV_COOLDOWN — keep here for re-exports (no-op import).`;

// Try the import anchor; if missing, fall back to a different anchor.
// We'll just inject the module state + export INSIDE the
// v167PrewarmReleaseStatus injection above — no separate import edit
// needed.  Skip cardOldImports edit.

patchFile(cardFile, 'V188_NAV_COOLDOWN', [
  { label: 'C1. add module-level cooldown + arm helper', old: cardOldPrewarmExport, new: cardNewPrewarmExport },
  { label: 'C2. handleFocus: respect cooldown',          old: cardOldHandleFocus,   new: cardNewHandleFocus   },
]);

// ════════════════════════════════════════════════════════════════════════
// D. id.tsx — arm the cooldown from handleBack (+hardware back)
// ════════════════════════════════════════════════════════════════════════
//
// We hook into the v187 handleBack which already calls
// cancelInFlightStreams.  We add `_v188ArmNavCooldown?.(1500)` next to it.
//
// Import is added directly from ContentCard (it's already in scope as
// the cards are imported there — we hop via dynamic require to avoid
// touching imports).

const detailsV187CancelLine = `    try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
    // V186_BACK_INSTANT — hide heavy tree IMMEDIATELY, navigate on next frame.
    _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);`;
const detailsV188CancelLine = `    try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
    // V188_NAV_COOLDOWN — disable focus-prefetch on Discover for 1.5 s so
    // D-pad navigation is smooth right after Back.  Dynamic require keeps
    // imports stable (ContentCard is bundled at app start).
    try {
      const _cc = require('../../../src/components/ContentCard');
      if (typeof _cc?._v188ArmNavCooldown === 'function') _cc._v188ArmNavCooldown(1500);
    } catch (_) {}
    // V186_BACK_INSTANT — hide heavy tree IMMEDIATELY, navigate on next frame.
    _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);`;

patchFile(detailsFile, 'V188_NAV_COOLDOWN_DETAILS', [
  { label: 'D1. handleBack arms nav cooldown', old: detailsV187CancelLine, new: detailsV188CancelLine },
]);

console.log('');
console.log('[v188] All frontend patches done.');
console.log('');
console.log('Next steps:');
console.log('  1. Rebuild & sideload APK:');
console.log('     cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('     npx expo run:android --device');
console.log('');
console.log('  2. ALSO apply v188 backend on Hetzner (adds /api/movie/release_status):');
console.log('     ssh choyt@5.161.49.99 "cd ~/PrivastreamCinema && curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v188_release_status_endpoint.py -o patch_v188.py && python3 patch_v188.py && docker compose restart app"');
console.log('');
console.log('  3. Test on Firestick:');
console.log('     - IN CINEMA gold badges back on movies released <= 90 days ago.');
console.log('     - Share modal has no X (just the bottom Close button).');
console.log('     - Click a movie → if stream search retries, screen shows');
console.log('       "Finding Streams..." continuously (no "0 Streams" flash).');
console.log('     - Back out of Details → Discover D-pad navigation is smooth');
console.log('       (no 1-2 s freeze).');
