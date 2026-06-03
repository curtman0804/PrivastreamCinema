/*
 * apply_patches_v170b_dedupe_prefetch_race.js
 *
 * V170B — Stop the prefetch ⇄ fetch race that causes the
 *         "2 streams → 8 streams" flicker even after v170.
 *
 * Root cause:
 *   v169 prefetchStreams(focused poster) fires api.addons.getAllStreams().
 *   When the user clicks, fetchStreams() starts a SECOND, parallel
 *   getAllStreams() call.  fetchStreams's progressive callback then
 *   paints whatever its FIRST source returned (typically Backend with 2
 *   cached streams), then later paints the full merged list (~8) when
 *   Torrentio + TPB+ arrive.  The v170 settle-debounce can't help here
 *   because the gaps between sources exceed the debounce window.
 *
 * Fix (two edits in contentStore.ts):
 *   1) V170B_PREFETCH_REGISTRY
 *      Promote `_pendingPrefetches: Set<string>` to a Map keyed by
 *      cacheKey that stores the in-flight promise.  prefetchStreams
 *      registers its promise; anyone else can await it.
 *
 *   2) V170B_FETCH_SHARES_PREFETCH
 *      In fetchStreams, BEFORE starting any new network call, check
 *      whether a prefetch is in flight for the same cacheKey.  If so:
 *        a) await that prefetch
 *        b) re-read the memory cache (the prefetch populates it)
 *        c) set streams once with the final list
 *      Only fall through to a fresh fetch when no prefetch is running.
 *
 *   3) V170B_NO_PARTIAL_PAINT
 *      For the fall-through fresh-fetch path, drop the progressive
 *      onProgress callback entirely.  We award one paint at the end
 *      with the final result -- zero intermediate states, zero flicker.
 *      (The v170 settle-debounce stays in place but becomes a no-op
 *      since there are no progressive updates to debounce.)
 *
 * Idempotent.  Re-running is a no-op once V170B markers are present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v170b_dedupe_prefetch_race.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STORE_PATH = path.join(ROOT, 'src', 'store', 'contentStore.ts');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v170b] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v170b] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = STORE_PATH;
let src = read(file);

if (src.indexOf('V170B_PREFETCH_REGISTRY') !== -1) {
  console.log('[v170b] contentStore.ts: already patched (V170B marker present), skipping');
  process.exit(0);
}

let changes = 0;

// ─────────────────────────────────────────────────────────────────────────────
//  (1) Promote _pendingPrefetches to a Map<string, Promise<Stream[]>>.
// ─────────────────────────────────────────────────────────────────────────────
const oldSet = 'const _pendingPrefetches = new Set<string>();';
const newSet =
  '/* V170B_PREFETCH_REGISTRY — promote from a plain Set to a Map keyed by\n' +
  '   cacheKey, storing the in-flight promise so fetchStreams can await it\n' +
  '   instead of starting a duplicate parallel network call. */\n' +
  'const _pendingPrefetches = new Map<string, Promise<Stream[]>>();';
if (src.indexOf(oldSet) === -1) {
  console.error('[v170b] FATAL: contentStore.ts — could not find _pendingPrefetches declaration.');
  process.exit(2);
}
src = src.replace(oldSet, newSet);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  (2) Inside fetchStreams, after disk-cache miss, AWAIT any in-flight
//      prefetch BEFORE making our own network call.
// ─────────────────────────────────────────────────────────────────────────────
const oldFetchHead =
  '    const diskCached = await loadStreamsFromDisk(cacheKey);\n' +
  '    if (diskCached && diskCached.length > 0) {\n' +
  '      setStreamsCache(cacheKey, diskCached);\n' +
  '      set({ streams: diskCached, isLoadingStreams: false, error: null });\n' +
  '      return diskCached;\n' +
  '    }\n' +
  '\n' +
  '    // 3. Network with throttled progressive updates (max 1 set per 150ms)\n' +
  '    try {';
const newFetchHead =
  '    const diskCached = await loadStreamsFromDisk(cacheKey);\n' +
  '    if (diskCached && diskCached.length > 0) {\n' +
  '      setStreamsCache(cacheKey, diskCached);\n' +
  '      set({ streams: diskCached, isLoadingStreams: false, error: null });\n' +
  '      return diskCached;\n' +
  '    }\n' +
  '\n' +
  '    /* V170B_FETCH_SHARES_PREFETCH — if a focus-prefetch is already in\n' +
  '       flight for this content, await ITS promise instead of firing a\n' +
  '       parallel duplicate fetch.  This kills the "2 streams -> 8" race\n' +
  '       that progressive-paint partial results from the second fetch\n' +
  '       caused before they merged. */\n' +
  '    const _v170bInflight = _pendingPrefetches.get(cacheKey);\n' +
  '    if (_v170bInflight) {\n' +
  '      try {\n' +
  '        const shared = await _v170bInflight;\n' +
  '        if (shared && shared.length > 0) {\n' +
  '          setStreamsCache(cacheKey, shared);\n' +
  '          set({ streams: shared, isLoadingStreams: false, error: null });\n' +
  '          return shared;\n' +
  '        }\n' +
  '      } catch (_) { /* fall through to a fresh fetch */ }\n' +
  '    }\n' +
  '\n' +
  '    // 3. Network -- single final set, no progressive paint (V170B_NO_PARTIAL_PAINT)\n' +
  '    try {';
if (src.indexOf(oldFetchHead) === -1) {
  console.error('[v170b] FATAL: contentStore.ts — could not find fetchStreams head to inject shared-prefetch await.');
  process.exit(3);
}
src = src.replace(oldFetchHead, newFetchHead);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  (3) Replace the v170 settle-debounce body with a single final-set path
//      (no progressive callback at all -- zero intermediate paints).
// ─────────────────────────────────────────────────────────────────────────────
const oldV170Body =
  '      /* V170_STREAMS_SETTLE — settle-debounce instead of hard 150ms\n' +
  '         throttle.  The UI only sees an update when streams have been\n' +
  '         stable for 400ms (or all sources have completed), so the\n' +
  '         filtered count no longer ticks "5 -> 9 -> 8" as Backend /\n' +
  '         Torrentio / TPB+ merge progressively. */\n' +
  '      let _v170Pending: Stream[] = [];\n' +
  '      let _v170SettleTimer: any = null;\n' +
  '      const _v170Flush = () => {\n' +
  '        if (_v170Pending.length === 0) return;\n' +
  '        const snapshot = _v170Pending;\n' +
  '        _v170Pending = [];\n' +
  '        set({ streams: snapshot, isLoadingStreams: false });\n' +
  '      };\n' +
  '      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {\n' +
  '        _v170Pending = partialStreams;\n' +
  '        if (_v170SettleTimer) { clearTimeout(_v170SettleTimer); _v170SettleTimer = null; }\n' +
  '        _v170SettleTimer = setTimeout(() => {\n' +
  '          _v170SettleTimer = null;\n' +
  '          _v170Flush();\n' +
  '        }, 400);\n' +
  '      });\n' +
  '      if (_v170SettleTimer) { clearTimeout(_v170SettleTimer); _v170SettleTimer = null; }';
const newV170Body =
  '      /* V170B_NO_PARTIAL_PAINT — no progressive callback.  Await the\n' +
  '         full merged result and paint once.  Trade-off: cold-cache users\n' +
  '         see "Finding Streams..." until ALL sources complete (typically\n' +
  '         1.5-3 s) but the count never flickers between intermediate\n' +
  '         values.  Focus-prefetch (v169) carries most clicks anyway, so\n' +
  '         in practice the spinner is rare. */\n' +
  '      const result = await api.addons.getAllStreams(type, id);';
if (src.indexOf(oldV170Body) === -1) {
  console.error('[v170b] FATAL: contentStore.ts — could not find v170 settle block to replace.');
  console.error('         Make sure v170 was applied successfully first.');
  process.exit(4);
}
src = src.replace(oldV170Body, newV170Body);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  (4) Update prefetchStreams to register its promise in the Map.
// ─────────────────────────────────────────────────────────────────────────────
const oldPrefetch =
  '  prefetchStreams: async (type: string, id: string) => {\n' +
  '    const cacheKey = `${type}/${id}`;\n' +
  '    if (getStreamsCache(cacheKey)) return;\n' +
  '    if (_pendingPrefetches.has(cacheKey)) return;\n' +
  '    _pendingPrefetches.add(cacheKey);\n' +
  '    try {';
const newPrefetch =
  '  prefetchStreams: async (type: string, id: string) => {\n' +
  '    const cacheKey = `${type}/${id}`;\n' +
  '    if (getStreamsCache(cacheKey)) return;\n' +
  '    if (_pendingPrefetches.has(cacheKey)) return;\n' +
  '    /* V170B_PREFETCH_REGISTRY — store the in-flight promise so\n' +
  '       fetchStreams (and any other prefetch caller) can await it\n' +
  '       instead of firing a duplicate network call. */\n' +
  '    let _v170bResolve: (v: Stream[]) => void = () => {};\n' +
  '    const _v170bPromise = new Promise<Stream[]>((res) => { _v170bResolve = res; });\n' +
  '    _pendingPrefetches.set(cacheKey, _v170bPromise);\n' +
  '    try {';
if (src.indexOf(oldPrefetch) === -1) {
  console.error('[v170b] FATAL: contentStore.ts — could not find prefetchStreams head.');
  process.exit(5);
}
src = src.replace(oldPrefetch, newPrefetch);
changes++;

// And wire the resolve + remove the `.add → .delete` mismatch.
const oldPrefetchEnd =
  '    } catch { /* prefetch is best-effort */ }\n' +
  '    finally { _pendingPrefetches.delete(cacheKey); }';
const newPrefetchEnd =
  '    } catch { /* prefetch is best-effort */ }\n' +
  '    finally {\n' +
  '      /* V170B_PREFETCH_REGISTRY — resolve before removal so anyone\n' +
  '         awaiting can collect the final list. */\n' +
  '      try { _v170bResolve(getStreamsCache(cacheKey) || []); } catch (_) {}\n' +
  '      _pendingPrefetches.delete(cacheKey);\n' +
  '    }';
if (src.indexOf(oldPrefetchEnd) === -1) {
  console.error('[v170b] FATAL: contentStore.ts — could not find prefetchStreams finally clause.');
  process.exit(6);
}
src = src.replace(oldPrefetchEnd, newPrefetchEnd);
changes++;

// Final sanity write.
write(file, src);
console.log(`[v170b] contentStore.ts: ${changes} change(s) applied`);
console.log('[v170b] DONE.  Rebuild your Expo app and sideload to test.');
