/* eslint-disable */
// apply_patches_v19b.js — contentStore: throttled progressive updates + AsyncStorage cache + prefetchStreams
// Run from project root:   node apply_patches_v19b.js
//
// Three changes to frontend/src/store/contentStore.ts:
//   1. AsyncStorage-backed persistent stream cache (6h TTL). Re-visiting a
//      poster after restarting the app returns streams instantly instead
//      of refetching from the network.
//   2. Throttle progressive updates to max 1 per 150ms during fetch. Stops
//      the "stream count climbing" UI thrash; you get smooth jumps instead
//      of constant micro-renders.
//   3. New `prefetchStreams(type, id)` action that warms the cache without
//      touching the visible streams[] state. Used by V19-C to pre-fetch
//      streams when a poster gets focus.

const fs = require('fs');
const path = require('path');

const STORE = path.join('frontend', 'src', 'store', 'contentStore.ts');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(STORE)) { bad('contentStore.ts not found at ' + STORE); process.exit(1); }

let src = fs.readFileSync(STORE, 'utf8');
const orig = src;
const bak = STORE + '.bak.v19b.' + Date.now();
fs.copyFileSync(STORE, bak);
info('backup → ' + bak);

// Detect line endings (Windows ships CRLF; Mac/Linux LF). Used by the
// fetchStreams body replacement which is the only multi-line block.
const EOL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
info('detected line endings: ' + (EOL === '\r\n' ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + STORE + ' ===');

const MARKER = 'PATCH_V19B';

if (src.includes(MARKER + '_ALL_DONE')) {
  ok('V19-B already applied — nothing to do');
  process.exit(0);
}

// =====================================================================
// PART 1: Add AsyncStorage import + disk cache helpers + prefetch dedupe set
// =====================================================================
{
  if (src.includes(MARKER + '_DISK_HELPERS')) {
    ok('disk cache helpers already present');
  } else {
    const importAnchor = "import { create } from 'zustand';";
    if (!src.includes(importAnchor)) {
      bad('could not find zustand import anchor');
    } else {
      const newImports = [
        "import { create } from 'zustand';",
        "import AsyncStorage from '@react-native-async-storage/async-storage'; // " + MARKER + "_DISK_HELPERS",
      ].join(EOL);
      src = src.replace(importAnchor, newImports);
      ok('added AsyncStorage import');
    }

    // Insert helpers after the existing setStreamsCache export
    const helperAnchor = "export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = data; };";
    if (!src.includes(helperAnchor)) {
      bad('could not find setStreamsCache anchor for helper insertion');
    } else {
      const helperBlock = [
        "export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = data; };",
        "",
        "// " + MARKER + "_DISK_HELPERS — AsyncStorage-backed persistent cache (6h TTL).",
        "const STREAMS_DISK_TTL_MS = 6 * 60 * 60 * 1000;",
        "const STREAMS_DISK_KEY = (key: string) => '@streamsCache:' + key;",
        "const _pendingPrefetches = new Set<string>();",
        "",
        "async function loadStreamsFromDisk(key: string): Promise<Stream[] | null> {",
        "  try {",
        "    const raw = await AsyncStorage.getItem(STREAMS_DISK_KEY(key));",
        "    if (!raw) return null;",
        "    const parsed = JSON.parse(raw);",
        "    if (!parsed || !parsed.time || !Array.isArray(parsed.streams)) return null;",
        "    if (Date.now() - parsed.time > STREAMS_DISK_TTL_MS) return null;",
        "    return parsed.streams as Stream[];",
        "  } catch { return null; }",
        "}",
        "",
        "async function saveStreamsToDisk(key: string, streams: Stream[]): Promise<void> {",
        "  try {",
        "    if (!streams || streams.length === 0) return;",
        "    await AsyncStorage.setItem(STREAMS_DISK_KEY(key), JSON.stringify({ time: Date.now(), streams }));",
        "  } catch { /* swallow — disk cache is best-effort */ }",
        "}",
      ].join(EOL);
      src = src.replace(helperAnchor, helperBlock);
      ok('added disk cache helpers + prefetch dedupe set');
    }
  }
}

// =====================================================================
// PART 2: Add prefetchStreams to the ContentState interface
// =====================================================================
{
  if (src.includes(MARKER + '_INTERFACE')) {
    ok('prefetchStreams interface already declared');
  } else {
    const ifaceAnchor = "  fetchStreams: (type: string, id: string) => Promise<Stream[]>;";
    if (!src.includes(ifaceAnchor)) {
      bad('could not find fetchStreams interface line anchor');
    } else {
      const newIface = [
        "  fetchStreams: (type: string, id: string) => Promise<Stream[]>;",
        "  // " + MARKER + "_INTERFACE",
        "  prefetchStreams: (type: string, id: string) => Promise<void>;",
      ].join(EOL);
      src = src.replace(ifaceAnchor, newIface);
      ok('added prefetchStreams to ContentState interface');
    }
  }
}

// =====================================================================
// PART 3: Replace fetchStreams body — disk-cache check + throttled progressive
// =====================================================================
{
  if (src.includes(MARKER + '_FETCHSTREAMS_BODY')) {
    ok('fetchStreams body already replaced');
  } else {
    const oldBody = [
      "  fetchStreams: async (type: string, id: string) => {",
      "    const cacheKey = `${type}/${id}`;",
      "    ",
      "    // CHECK CACHE FIRST — instant return if we have data",
      "    const cached = getStreamsCache(cacheKey);",
      "    if (cached && cached.length > 0) {",
      "      set({ streams: cached, isLoadingStreams: false, error: null });",
      "      return cached;",
      "    }",
      "    ",
      "    set({ isLoadingStreams: true, streams: [], error: null });",
      "    ",
      "    try {",
      "      // Progressive loading: show streams as each source responds",
      "      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {",
      "        set({ streams: partialStreams });",
      "        if (partialStreams.length > 0) {",
      "          set({ isLoadingStreams: false });",
      "        }",
      "      });",
      "      const allStreams = result.streams || [];",
      "      // Cache the result for instant re-access",
      "      setStreamsCache(cacheKey, allStreams);",
      "      set({ streams: allStreams, isLoadingStreams: false });",
      "      return allStreams;",
      "    } catch (error: any) {",
      "      console.log('[ContentStore] fetchStreams error:', error);",
      "      set({ streams: [], isLoadingStreams: false });",
      "      return [];",
      "    }",
      "  },",
    ].join(EOL);

    const newBody = [
      "  fetchStreams: async (type: string, id: string) => {",
      "    // " + MARKER + "_FETCHSTREAMS_BODY — memory cache → disk cache → network",
      "    const cacheKey = `${type}/${id}`;",
      "",
      "    // 1. Memory cache — instant",
      "    const cached = getStreamsCache(cacheKey);",
      "    if (cached && cached.length > 0) {",
      "      set({ streams: cached, isLoadingStreams: false, error: null });",
      "      return cached;",
      "    }",
      "",
      "    // 2. AsyncStorage disk cache — ~10ms",
      "    set({ isLoadingStreams: true, streams: [], error: null });",
      "    const diskCached = await loadStreamsFromDisk(cacheKey);",
      "    if (diskCached && diskCached.length > 0) {",
      "      setStreamsCache(cacheKey, diskCached);",
      "      set({ streams: diskCached, isLoadingStreams: false, error: null });",
      "      return diskCached;",
      "    }",
      "",
      "    // 3. Network with throttled progressive updates (max 1 set per 150ms)",
      "    try {",
      "      let _v19LastSet = 0;",
      "      let _v19PendingTimer: any = null;",
      "      let _v19PendingStreams: Stream[] = [];",
      "      const flushPending = () => {",
      "        if (_v19PendingStreams.length === 0) return;",
      "        _v19LastSet = Date.now();",
      "        set({ streams: _v19PendingStreams, isLoadingStreams: false });",
      "        _v19PendingStreams = [];",
      "      };",
      "      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {",
      "        _v19PendingStreams = partialStreams;",
      "        const elapsed = Date.now() - _v19LastSet;",
      "        if (elapsed >= 150) {",
      "          if (_v19PendingTimer) { clearTimeout(_v19PendingTimer); _v19PendingTimer = null; }",
      "          flushPending();",
      "        } else if (!_v19PendingTimer) {",
      "          _v19PendingTimer = setTimeout(() => { _v19PendingTimer = null; flushPending(); }, 150 - elapsed);",
      "        }",
      "      });",
      "      if (_v19PendingTimer) { clearTimeout(_v19PendingTimer); _v19PendingTimer = null; }",
      "      const allStreams = result.streams || [];",
      "      setStreamsCache(cacheKey, allStreams);",
      "      saveStreamsToDisk(cacheKey, allStreams); // fire-and-forget",
      "      set({ streams: allStreams, isLoadingStreams: false });",
      "      return allStreams;",
      "    } catch (error: any) {",
      "      console.log('[ContentStore] fetchStreams error:', error);",
      "      set({ streams: [], isLoadingStreams: false });",
      "      return [];",
      "    }",
      "  },",
    ].join(EOL);

    if (src.includes(oldBody)) {
      src = src.replace(oldBody, newBody);
      ok('replaced fetchStreams body with throttled+disk-cached version');
    } else {
      bad('could not find fetchStreams body to replace (file may have diverged)');
    }
  }
}

// =====================================================================
// PART 4: Add prefetchStreams implementation (right after fetchStreams)
// =====================================================================
{
  if (src.includes(MARKER + '_PREFETCH_IMPL')) {
    ok('prefetchStreams implementation already present');
  } else {
    // Anchor: the line right after fetchStreams closes — the start of the next
    // method (`addToLibrary`).
    const anchor = "  addToLibrary: async (item: ContentItem) => {";
    if (!src.includes(anchor)) {
      bad('could not find addToLibrary anchor for prefetch insertion');
    } else {
      const newBlock = [
        "  // " + MARKER + "_PREFETCH_IMPL — warm the cache without touching visible state.",
        "  // Used by ContentCard on poster focus so by the time the user clicks,",
        "  // streams are already in memory + disk cache.",
        "  prefetchStreams: async (type: string, id: string) => {",
        "    const cacheKey = `${type}/${id}`;",
        "    if (getStreamsCache(cacheKey)) return;",
        "    if (_pendingPrefetches.has(cacheKey)) return;",
        "    _pendingPrefetches.add(cacheKey);",
        "    try {",
        "      // Try disk first to avoid an unnecessary network round-trip",
        "      const diskCached = await loadStreamsFromDisk(cacheKey);",
        "      if (diskCached && diskCached.length > 0) {",
        "        setStreamsCache(cacheKey, diskCached);",
        "        return;",
        "      }",
        "      const result = await api.addons.getAllStreams(type, id);",
        "      const allStreams = result.streams || [];",
        "      if (allStreams.length > 0) {",
        "        setStreamsCache(cacheKey, allStreams);",
        "        saveStreamsToDisk(cacheKey, allStreams);",
        "      }",
        "    } catch { /* prefetch is best-effort */ }",
        "    finally { _pendingPrefetches.delete(cacheKey); }",
        "  },",
        "",
        "  addToLibrary: async (item: ContentItem) => {",
      ].join(EOL);
      src = src.replace(anchor, newBlock);
      ok('inserted prefetchStreams action implementation');
    }
  }
}

// Final marker
if (src !== orig && fail === 0 && !src.includes(MARKER + '_ALL_DONE')) {
  src = src.replace(
    "import { create } from 'zustand';",
    "import { create } from 'zustand'; // " + MARKER + "_ALL_DONE"
  );
}

// Save
if (src !== orig && fail === 0) {
  fs.writeFileSync(STORE, src, 'utf8');
  ok('saved ' + STORE);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV19-B done. Rebuild and test:');
  console.log('  ✓ Stream count climbs in smooth 150ms steps instead of jittering');
  console.log('  ✓ Re-visiting a poster after app restart returns streams instantly');
  console.log('  ✓ prefetchStreams() action available for V19-C');
  console.log('\nNext: V19-C (poster-focus prefetch in ContentCard)');
}
