/* eslint-disable */
// apply_patches_v24.js — AsyncStorage persistent stream cache (defensive)
// Run from project root:   node apply_patches_v24.js
//
// What it adds to frontend/src/store/contentStore.ts:
//   1. AsyncStorage import (idempotent — only if not already imported)
//   2. Two helpers: loadStreamsFromDisk(key) and saveStreamsToDisk(key, streams)
//      with a 6-hour TTL. Stored under '@streamsCache:type/id'.
//   3. In fetchStreams: BEFORE the existing `set({ isLoadingStreams: true })`,
//      add a disk-cache check that returns instantly if there's a fresh hit.
//   4. After the successful network fetch and existing setStreamsCache call,
//      add a fire-and-forget saveStreamsToDisk.
//
// What it does NOT do (different from the broken V19-B):
//   - Does NOT replace the entire fetchStreams body
//   - Does NOT throttle progressive updates
//   - Does NOT add prefetchStreams action
//   - Each insertion is a single-line anchor + a small additive block

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
const bak = STORE + '.bak.v24.' + Date.now();
fs.copyFileSync(STORE, bak);
info('backup → ' + bak);

// EOL detection — used for joining multi-line insertions.
const EOL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
info('detected line endings: ' + (EOL === '\r\n' ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + STORE + ' ===');

const MARKER = 'PATCH_V24_DISK_CACHE';

// ---------------------------------------------------------------------
// 1. AsyncStorage import (idempotent)
// ---------------------------------------------------------------------
{
  if (src.includes("@react-native-async-storage/async-storage")) {
    ok('AsyncStorage already imported');
  } else {
    const anchor = "import { create } from 'zustand';";
    if (!src.includes(anchor)) {
      bad("could not find `import { create } from 'zustand';` anchor");
    } else {
      const newImport = anchor + EOL + "import AsyncStorage from '@react-native-async-storage/async-storage'; // " + MARKER;
      src = src.replace(anchor, newImport);
      ok('added AsyncStorage import');
    }
  }
}

// ---------------------------------------------------------------------
// 2. Helper functions (idempotent — skip if already defined)
// ---------------------------------------------------------------------
{
  if (src.includes('loadStreamsFromDisk')) {
    ok('disk helpers already defined');
  } else {
    // Anchor on the start of `export const useContentStore = create<` —
    // single-line anchor, unique. Insertion goes right above it.
    const anchor = "export const useContentStore = create";
    if (!src.includes(anchor)) {
      bad('could not find `export const useContentStore = create` anchor');
    } else {
      const helpers = [
        "// " + MARKER + " — AsyncStorage persistent stream cache (6h TTL).",
        "// Returns null on miss/expiry. Save is best-effort (silent on error).",
        "const _STREAMS_DISK_TTL_MS = 6 * 60 * 60 * 1000;",
        "const _streamsDiskKey = (key: string) => '@streamsCache:' + key;",
        "async function loadStreamsFromDisk(key: string): Promise<Stream[] | null> {",
        "  try {",
        "    const raw = await AsyncStorage.getItem(_streamsDiskKey(key));",
        "    if (!raw) return null;",
        "    const parsed = JSON.parse(raw);",
        "    if (!parsed || !parsed.t || !Array.isArray(parsed.s)) return null;",
        "    if (Date.now() - parsed.t > _STREAMS_DISK_TTL_MS) return null;",
        "    return parsed.s as Stream[];",
        "  } catch { return null; }",
        "}",
        "async function saveStreamsToDisk(key: string, streams: Stream[]): Promise<void> {",
        "  try {",
        "    if (!streams || streams.length === 0) return;",
        "    await AsyncStorage.setItem(_streamsDiskKey(key), JSON.stringify({ t: Date.now(), s: streams }));",
        "  } catch { /* swallow */ }",
        "}",
        "",
        "export const useContentStore = create",
      ].join(EOL);
      src = src.replace(anchor, helpers);
      ok('inserted loadStreamsFromDisk + saveStreamsToDisk helpers');
    }
  }
}

// ---------------------------------------------------------------------
// 3. In fetchStreams: insert disk-cache check before the existing
//    `set({ isLoadingStreams: true, streams: [], error: null });` line.
// ---------------------------------------------------------------------
{
  if (src.includes('// ' + MARKER + ' disk check')) {
    ok('disk-cache check already inserted in fetchStreams');
  } else {
    const anchor = "    set({ isLoadingStreams: true, streams: [], error: null });";
    const occurrences = (src.split(anchor).length - 1);
    if (occurrences === 0) {
      bad('could not find `set({ isLoadingStreams: true, streams: [], error: null });` anchor');
    } else if (occurrences > 1) {
      bad('anchor matches ' + occurrences + ' times — refusing to patch ambiguous file');
    } else {
      const insertion = [
        "    // " + MARKER + " disk check — instant return on disk-cache hit (no loading flicker)",
        "    const _v24Disk = await loadStreamsFromDisk(cacheKey);",
        "    if (_v24Disk && _v24Disk.length > 0) {",
        "      setStreamsCache(cacheKey, _v24Disk);",
        "      set({ streams: _v24Disk, isLoadingStreams: false, error: null });",
        "      return _v24Disk;",
        "    }",
        "",
        "    set({ isLoadingStreams: true, streams: [], error: null });",
      ].join(EOL);
      src = src.replace(anchor, insertion);
      ok('inserted disk-cache check in fetchStreams');
    }
  }
}

// ---------------------------------------------------------------------
// 4. After successful fetch + setStreamsCache, add saveStreamsToDisk
// ---------------------------------------------------------------------
{
  if (src.includes('saveStreamsToDisk(cacheKey, allStreams)')) {
    ok('saveStreamsToDisk call already inserted');
  } else {
    const anchor = "      setStreamsCache(cacheKey, allStreams);";
    const occurrences = (src.split(anchor).length - 1);
    if (occurrences === 0) {
      bad('could not find `setStreamsCache(cacheKey, allStreams);` anchor');
    } else if (occurrences > 1) {
      bad('anchor matches ' + occurrences + ' times — refusing to patch ambiguous');
    } else {
      const replacement = [
        "      setStreamsCache(cacheKey, allStreams);",
        "      saveStreamsToDisk(cacheKey, allStreams); // " + MARKER + " — persist for next session, fire-and-forget",
      ].join(EOL);
      src = src.replace(anchor, replacement);
      ok('inserted saveStreamsToDisk call after setStreamsCache');
    }
  }
}

// Save
if (src !== orig && fail === 0) {
  fs.writeFileSync(STORE, src, 'utf8');
  ok('saved ' + STORE);
} else if (src === orig) {
  info('no changes needed — file already at V24 state');
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
  console.log('\nV24 done. Rebuild and test:');
  console.log('  ✓ First time clicking a poster: same as before (network fetch)');
  console.log('  ✓ Same poster from same session: instant (memory cache)');
  console.log('  ✓ Restart app, click same poster: ~50ms (disk cache hit)');
  console.log('  ✓ After 6 hours: cache expires, network fetch again');
  console.log('\nIf builds + works, tell me and we go to V25.');
}
