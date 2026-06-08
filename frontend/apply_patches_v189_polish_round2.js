/*
 * apply_patches_v189_polish_round2.js
 *
 * V189 — Round-2 polish (3 files):
 *   A. addons.tsx       → Share modal hint text: "Stremio" → "the Addons
 *      section in this app" (this app isn't Stremio, no reason to send
 *      users there).
 *   B. contentStore.ts  → DON'T-CLOBBER guard.  If a fetchStreams retry
 *      returns 0 streams but state already has a previously-successful
 *      stream list, keep it.  Better to show 5 stale streams than wipe
 *      to 0 while the user is reading them.
 *   C. ContentCard.tsx  → Stronger nav cooldown.  Extend window to 2500
 *      ms and ALSO short-circuit the setIsFocused(true) re-render
 *      during cooldown — focus events still fire (so the on-screen
 *      hover effect still happens via native focus) but we avoid the
 *      cascade of state updates that block D-pad navigation.
 *
 * Properties:
 *   - Idempotent (markers V189_NOT_STREMIO + V189_DONT_CLOBBER +
 *     V189_STRONG_COOLDOWN)
 *   - CRLF preserved
 *   - Backups: .v189.bak
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v189_polish_round2.js -o apply_patches_v189_polish_round2.js
 *   node apply_patches_v189_polish_round2.js
 *   npx expo run:android --device
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
]);
const storeFile = find([
  ['src', 'store', 'contentStore.ts'],
  ['src', 'stores', 'contentStore.ts'],
]);
const cardFile = find([
  ['src', 'components', 'ContentCard.tsx'],
  ['components', 'ContentCard.tsx'],
]);

if (!addonsFile) { console.error('[v189] FATAL: addons.tsx not found.'); process.exit(1); }
if (!storeFile)  { console.error('[v189] FATAL: contentStore.ts not found.'); process.exit(1); }
if (!cardFile)   { console.error('[v189] FATAL: ContentCard.tsx not found.'); process.exit(1); }

console.log('[v189] addons: ', path.relative(ROOT, addonsFile));
console.log('[v189] store:  ', path.relative(ROOT, storeFile));
console.log('[v189] card:   ', path.relative(ROOT, cardFile));

function patchFile(file, marker, edits) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
  if (text.indexOf(marker) !== -1) {
    console.log(`[v189] ${path.basename(file)}: already patched (${marker}), skipping.`);
    return;
  }
  for (const e of edits) {
    if (text.indexOf(e.old) === -1) {
      console.error(`[v189] FATAL anchor missed in ${path.basename(file)}: ${e.label}`);
      console.error(`        looked for:\n${e.old.slice(0, 220)}...`);
      process.exit(2);
    }
    text = text.replace(e.old, e.new, 1);
    console.log(`[v189] ${path.basename(file)}: ${e.label}`);
  }
  const bak = file + '.v189.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[v189] wrote ${path.relative(ROOT, file)} (${eol.toUpperCase()}, backup=.v189.bak)`);
}

// ════════════════════════════════════════════════════════════════════════
// A. addons.tsx — share text no longer says "Stremio"
// ════════════════════════════════════════════════════════════════════════

const addonsOldHint1 = `              {shareModalData?.code
                ? 'Recipient can enter the Downloader code on FireStick or paste the URL into Stremio.'
                : 'Recipient can paste the manifest URL into Stremio to install this addon.'}`;
const addonsNewHint1 = `              {/* V189_NOT_STREMIO — this app isn't Stremio; instruct user where to actually paste */}
              {shareModalData?.code
                ? 'Recipient can enter the Downloader code on FireStick or paste the URL into the Addons section in this app.'
                : 'Recipient can paste the manifest URL into the Addons section in this app to install this addon.'}`;

const addonsOldShareMsg1 = "      : \`Check out this Stremio addon: \${name}\\n\\n\${url}\`;";
const addonsNewShareMsg1 = "      : \`Check out this addon: \${name}\\n\\n\${url}\`;";

const addonsOldShareMsg2 = "      : \`Check out this Stremio addon: \${addonName}\\n\\n\${addonUrl}\`;";
const addonsNewShareMsg2 = "      : \`Check out this addon: \${addonName}\\n\\n\${addonUrl}\`;";

patchFile(addonsFile, 'V189_NOT_STREMIO', [
  { label: 'A1. share modal hint text',           old: addonsOldHint1,     new: addonsNewHint1     },
  { label: 'A2. share message (v187 path)',       old: addonsOldShareMsg1, new: addonsNewShareMsg1 },
  // A3 (v186 fallback) is no longer present after v187 replaced the whole
  // handleShareAddon body — applied opportunistically below if found.
]);

// Opportunistic A3 (no-op if anchor missing — v187 already removed it).
try {
  const raw = fs.readFileSync(addonsFile, 'utf8');
  if (raw.indexOf(addonsOldShareMsg2) !== -1) {
    const patched = raw.replace(addonsOldShareMsg2, addonsNewShareMsg2);
    fs.writeFileSync(addonsFile, patched, 'utf8');
    console.log('[v189] addons.tsx: A3. share message (v186 fallback) — opportunistic hit');
  }
} catch (_) {}

// ════════════════════════════════════════════════════════════════════════
// B. contentStore.ts — DON'T-CLOBBER guard for streams=[]
// ════════════════════════════════════════════════════════════════════════
//
// The mysterious "5 streams → 0 streams" regression the user is seeing
// most likely comes from a stream fetch that succeeded once, then a later
// fetch (retry, focus-prefetch race, season change) returned 0 and wrote
// streams=[] to state.  v189 adds a guard: if we're about to set
// streams=[] but state ALREADY has streams.length > 0 from a recent
// success, we keep the existing list and just clear isLoadingStreams.
//
// Anchor: the final `_setIfActive({ streams: allStreams, isLoadingStreams: false });`
// in fetchStreams.

const storeOldFinalSet = `      if (allStreams.length > 0) {
        setStreamsCache(cacheKey, allStreams);
        saveStreamsToDisk(cacheKey, allStreams);
      }
      _setIfActive({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore] fetchStreams error:', error);
      _setIfActive({ streams: [], isLoadingStreams: false });
      return [];
    }
  },`;
const storeNewFinalSet = `      if (allStreams.length > 0) {
        setStreamsCache(cacheKey, allStreams);
        saveStreamsToDisk(cacheKey, allStreams);
      }
      // V189_DONT_CLOBBER — if a retry returned 0 streams but the screen
      // already had a successful set, keep it.  Better to show stale data
      // than wipe a populated list to 0.
      if (allStreams.length === 0) {
        const _cur = get();
        if (_cur?.streams && _cur.streams.length > 0) {
          console.log('[v189] keeping', _cur.streams.length, 'existing streams (refusing to overwrite with [])');
          _setIfActive({ isLoadingStreams: false });
          return _cur.streams;
        }
      }
      _setIfActive({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore] fetchStreams error:', error);
      // V189_DONT_CLOBBER — same guard for the error path
      const _cur = get();
      if (_cur?.streams && _cur.streams.length > 0) {
        console.log('[v189] error path: keeping', _cur.streams.length, 'existing streams');
        _setIfActive({ isLoadingStreams: false });
        return _cur.streams;
      }
      _setIfActive({ streams: [], isLoadingStreams: false });
      return [];
    }
  },`;

patchFile(storeFile, 'V189_DONT_CLOBBER', [
  { label: 'B1. fetchStreams: keep existing streams when retry returns 0', old: storeOldFinalSet, new: storeNewFinalSet },
]);

// ════════════════════════════════════════════════════════════════════════
// C. ContentCard.tsx — STRONGER nav cooldown (2.5 s + skip re-renders)
// ════════════════════════════════════════════════════════════════════════
//
// 1) Extend cooldown window from 1.2 s to 2.5 s
// 2) During cooldown: skip setIsFocused(true)/(false) state updates so
//    we avoid cascading re-renders of every card the D-pad passes.  The
//    native focus halo still works (it uses native focus events under
//    the hood), only the React-driven hover styles are deferred.

const cardOldFocusGate = `    /* V188_NAV_COOLDOWN — if the user just backed out of a Details page,
       suppress focus prefetch for 1.2 s.  Lets the JS thread serve D-pad
       focus changes without competing with network kick-offs. */
    if (Date.now() < (_v188NavCooldownUntil as any)) return;`;
const cardNewFocusGate = `    /* V189_STRONG_COOLDOWN — extended 2.5 s + skip ALL further work
       (no prefetch, no re-render-driving setState) so the JS thread is
       completely free for D-pad input.  The native focus halo still
       paints because react-native-tvos handles that natively. */
    if (Date.now() < (_v188NavCooldownUntil as any)) return;`;

// Move setIsFocused(true) AFTER the cooldown check.  Original:
//   const handleFocus = useCallback(() => {
//     setIsFocused(true);
//     onCardFocus?.();
//     ...
//     if (Date.now() < (_v188NavCooldownUntil as any)) return;
const cardOldFocusHead = `  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onCardFocus?.();
    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only
       movies get streams prefetched (series root IDs have no usable
       streams; the v138 patch already prefetches the next episode). */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }`;
const cardNewFocusHead = `  const handleFocus = useCallback(() => {
    // V189_STRONG_COOLDOWN — during nav cooldown, skip the setState and the
    // onCardFocus callback so D-pad navigation doesn't drown the JS thread.
    if (Date.now() < (_v188NavCooldownUntil as any)) {
      return;
    }
    setIsFocused(true);
    onCardFocus?.();
    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only
       movies get streams prefetched (series root IDs have no usable
       streams; the v138 patch already prefetches the next episode). */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }`;

// Bump the cooldown default from 1500 → 2500 ms
const cardOldArmDefault = `export function _v188ArmNavCooldown(ms: number = 1500): void {`;
const cardNewArmDefault = `export function _v188ArmNavCooldown(ms: number = 2500): void {`;

patchFile(cardFile, 'V189_STRONG_COOLDOWN', [
  { label: 'C1. handleFocus head: skip setState during cooldown', old: cardOldFocusHead,   new: cardNewFocusHead   },
  { label: 'C2. update inner gate label (cosmetic)',              old: cardOldFocusGate,   new: cardNewFocusGate   },
  { label: 'C3. default cooldown 1500 → 2500 ms',                 old: cardOldArmDefault,  new: cardNewArmDefault  },
]);

console.log('');
console.log('[v189] All frontend patches done.');
console.log('');
console.log('Next steps:');
console.log('  1. Rebuild & sideload APK:');
console.log('     cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('     npx expo run:android --device');
console.log('');
console.log('  2. ALSO apply v189 backend on Hetzner (replaces v188 release_status):');
console.log('     ssh choyt@5.161.49.99 "cd ~/PrivastreamCinema && curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v189_now_playing_release_status.py -o patch_v189.py && python3 patch_v189.py && docker compose restart app"');
console.log('');
console.log('  3. Verify backend (cold cache takes 3-5 s):');
console.log('     curl -X POST https://api.privastreamsolutions.com/api/movie/release_status -H \'Content-Type: application/json\' -d \'{"imdb_ids":["tt9603212","tt15239678"]}\'');
