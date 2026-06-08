/*
 * apply_patches_v180_streams_flash_and_prewarm.js
 *
 * V180 — Two fixes bundled:
 *
 *   A. Streams list flash → 0 → reappear      (contentStore.ts)
 *   B. Pre-warm top cached streams on Details (id.tsx)
 *
 * ─── A. Flash race ─────────────────────────────────────────────────────
 *
 * Today fetchStreams() sets   `{ streams: [], isLoadingStreams: true }`
 * unconditionally before its disk-cache + network calls.  When the user
 * back-navigates to a previously-viewed show, the in-memory `_streamsCache`
 * has the entry but a remount can hit the disk-cache branch first (depending
 * on focus-prefetch timing), causing the visible array to clear for
 * 50-200 ms before re-populating.  Visible as: "X streams → 0 streams → X
 * streams again".
 *
 * Fix: track the current-content key in the store; only wipe the visible
 * streams list when the user is actually viewing a NEW show (different
 * cacheKey).  Refetching the SAME show keeps the stale data on screen
 * while the network round-trips, then atomically swaps.  Stremio-style.
 *
 * ─── B. Pre-warm ───────────────────────────────────────────────────────
 *
 * Stremio cheats: when you open Details, it immediately tells the debrid
 * service to resolve the top few cached candidates so the magic 30-90 s
 * "uncached → cached" download window happens DURING your decide-and-click
 * time, not after.  Our backend already supports this — POST /api/stream/
 * start/{infoHash} kicks off PM resolution and the result lands in Redis.
 *
 * When sortedStreams populates with cached candidates, fire-and-forget POST
 * to /api/stream/start/{infoHash} for the top 3.  Hash extracted from
 * Torrentio's behaviorHints.bingeGroup (`torrentio|<40-hex-hash>`) since
 * Torrentio strips infoHash on debrid mode.
 *
 * Result:  click Play → status is already "ready" in Redis → ~2-3 s buffer
 *          instead of the typical 8-12 s "resolving…" wait.
 *
 * ─── Properties ────────────────────────────────────────────────────────
 * - Idempotent (markers V180_FLASH_FIX and V180_PREWARM)
 * - CRLF preserved per file
 * - Backups: contentStore.ts.v180.bak, [id].tsx.v180.bak
 * - Pre-warm errors are swallowed — never affects user flow
 * - All 4 anchor edits must succeed; any anchor miss aborts (no partial writes)
 *
 * Usage
 * -----
 *   cd <your-expo-project-root>
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v180_streams_flash_and_prewarm.js -o apply_patches_v180_streams_flash_and_prewarm.js
 *   node apply_patches_v180_streams_flash_and_prewarm.js
 *
 * Rebuild the APK after, since Metro-only reload won't update the release
 * build on the TV.
 *
 * Rollback
 * --------
 *   move /Y src\stores\contentStore.ts.v180.bak    src\stores\contentStore.ts
 *   move /Y app\details\[type]\[id].tsx.v180.bak   app\details\[type]\[id].tsx
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// Locate contentStore.ts — it lives in various paths depending on project layout
const STORE_CANDIDATES = [
  path.join(ROOT, 'src', 'stores', 'contentStore.ts'),
  path.join(ROOT, 'stores', 'contentStore.ts'),
  path.join(ROOT, 'src', 'store', 'contentStore.ts'),
  path.join(ROOT, 'store', 'contentStore.ts'),
];
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

function findStore() {
  for (const p of STORE_CANDIDATES) if (fs.existsSync(p)) return p;
  // Fallback — scan
  const scan = require('child_process').execSync(
    process.platform === 'win32'
      ? 'where /R . contentStore.ts'
      : 'find . -name contentStore.ts -not -path "*/node_modules/*"',
    { cwd: ROOT, encoding: 'utf8' }
  ).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return scan[0] || null;
}

const STORE_PATH = findStore();
if (!STORE_PATH || !fs.existsSync(STORE_PATH)) {
  console.error('[v180] FATAL: contentStore.ts not found.  Candidates checked:');
  STORE_CANDIDATES.forEach(p => console.error('         ' + p));
  process.exit(1);
}
if (!fs.existsSync(ID_PATH)) {
  console.error(`[v180] FATAL: ${path.relative(ROOT, ID_PATH)} not found.`);
  console.error('[v180] Run from your Expo project root.');
  process.exit(1);
}
console.log(`[v180] contentStore: ${path.relative(ROOT, STORE_PATH)}`);
console.log(`[v180] details file: ${path.relative(ROOT, ID_PATH)}`);

function read(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return { raw, eol, text: eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw };
}
function write(p, text, eol, raw) {
  const bak = p + '.v180.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v180] wrote ${path.relative(ROOT, p)} (${eol.toUpperCase()}, backup=.v180.bak)`);
}

// Brace balance sanity — guard against accidental drops in big edits
function braceDelta(text) {
  let depth = 0, inS = null, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inS) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') { const nl = text.indexOf('\n', i); i = nl === -1 ? text.length : nl; continue; }
    if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end === -1 ? text.length : end + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
  }
  return depth;
}

// ═════════════════════════════════════════════════════════════════════════
// PART A — patch contentStore.ts
// ═════════════════════════════════════════════════════════════════════════
const storeRead = read(STORE_PATH);
let storeText = storeRead.text;

if (storeText.indexOf('V180_FLASH_FIX') !== -1) {
  console.log('[v180] contentStore.ts: already patched, skipping');
} else {

  // ── A1 — add `currentStreamsKey` to initialState ────────────────────────
  const initOld =
    '  isLoadingStreams: false,\n' +
    '  error: null,\n' +
    '};';
  const initNew =
    '  isLoadingStreams: false,\n' +
    '  error: null,\n' +
    '  // V180_FLASH_FIX — tracks which (type/id) is currently visible so\n' +
    '  // refetches of the SAME show keep stale streams on screen instead\n' +
    '  // of flashing the list to [].\n' +
    '  currentStreamsKey: null as string | null,\n' +
    '};';
  if (storeText.indexOf(initOld) === -1) {
    console.error('[v180] FATAL: contentStore initialState anchor missed.');
    process.exit(2);
  }
  storeText = storeText.replace(initOld, initNew);
  console.log('[v180] contentStore: added currentStreamsKey to initialState');

  // ── A2 — replace the unconditional wipe at line 271 ─────────────────────
  const wipeOld =
    '    // 2. AsyncStorage disk cache — ~10ms\n' +
    '    set({ isLoadingStreams: true, streams: [], error: null });';
  const wipeNew =
    '    // 2. AsyncStorage disk cache — ~10ms\n' +
    '    // V180_FLASH_FIX — only clear `streams` if the user switched to\n' +
    '    // a DIFFERENT show.  Refetching the SAME show keeps the stale\n' +
    '    // list visible during the disk/network round-trip, eliminating\n' +
    '    // the "streams → 0 → streams" flash on back-navigation.\n' +
    '    {\n' +
    '      const _v180Prev = (get() as any).currentStreamsKey;\n' +
    '      if (_v180Prev !== cacheKey) {\n' +
    '        set({ isLoadingStreams: true, streams: [], error: null, currentStreamsKey: cacheKey } as any);\n' +
    '      } else {\n' +
    '        set({ isLoadingStreams: true, error: null } as any);\n' +
    '      }\n' +
    '    }';
  if (storeText.indexOf(wipeOld) === -1) {
    console.error('[v180] FATAL: fetchStreams wipe-line anchor missed.');
    process.exit(2);
  }
  storeText = storeText.replace(wipeOld, wipeNew);
  console.log('[v180] contentStore: fetchStreams wipe is now conditional');

  // ── A3 — also persist currentStreamsKey on memory-cache-hit early return ─
  const memHitOld =
    '    const cached = getStreamsCache(cacheKey);\n' +
    '    if (cached && cached.length > 0) {\n' +
    '      set({ streams: cached, isLoadingStreams: false, error: null });\n' +
    '      return cached;\n' +
    '    }';
  const memHitNew =
    '    const cached = getStreamsCache(cacheKey);\n' +
    '    if (cached && cached.length > 0) {\n' +
    '      // V180_FLASH_FIX — also record the key so future refetches treat\n' +
    '      // this as the current show.\n' +
    '      set({ streams: cached, isLoadingStreams: false, error: null, currentStreamsKey: cacheKey } as any);\n' +
    '      return cached;\n' +
    '    }';
  if (storeText.indexOf(memHitOld) === -1) {
    console.error('[v180] FATAL: memory-cache-hit anchor missed.');
    process.exit(2);
  }
  storeText = storeText.replace(memHitOld, memHitNew);
  console.log('[v180] contentStore: memory-cache-hit records currentStreamsKey');

  // Brace check
  const dStore = braceDelta(storeText) - braceDelta(storeRead.text);
  if (dStore !== 0) {
    console.error(`[v180] FATAL: contentStore brace delta ${dStore}, refusing to write.`);
    process.exit(3);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PART B — patch [id].tsx — add pre-warm effect
// ═════════════════════════════════════════════════════════════════════════
const idRead = read(ID_PATH);
let idText = idRead.text;

if (idText.indexOf('V180_PREWARM') !== -1) {
  console.log('[v180] [id].tsx: pre-warm already present, skipping');
} else {
  // Anchor: insert right after the `useEffect` at line ~1130 (the one that
  // calls fetchStreams).  Its full block is unique:
  const prewarmAnchor =
    '    if (type && id && (type === \'movie\' || type === \'tv\' || isEpisodePage)) {\n' +
    '      // PATCH_V37_DEFER_STREAMS — defer to next tick so the details page paints\n' +
    '      // instantly; streams load in the background and populate as they arrive.\n' +
    '      const _v37StreamsTimer = setTimeout(() => { try { fetchStreams(type, id); } catch (_) {} }, 0);\n' +
    '    }\n' +
    '  }, [id, type]);';

  if (idText.indexOf(prewarmAnchor) === -1) {
    console.error('[v180] FATAL: pre-warm anchor (PATCH_V37_DEFER_STREAMS useEffect) not found.');
    process.exit(2);
  }

  const prewarmBlock =
    prewarmAnchor +
    '\n\n' +
    '  /* V180_PREWARM — when sortedStreams populates, fire-and-forget POST to\n' +
    '     /api/stream/start/<infoHash> for the top 3 cached candidates.  The\n' +
    '     backend (v179b) writes the resolved PM URL to Redis, so by the time\n' +
    '     the user clicks Play the status poll lands on "ready" immediately\n' +
    '     instead of waiting through 8-12 s of "resolving".\n' +
    '\n' +
    '     Torrentio strips infoHash in debrid mode; pull the 40-hex hash out\n' +
    '     of behaviorHints.bingeGroup (`torrentio|<hash>`) instead. */\n' +
    '  const _v180_prewarmedRef = useRef<Set<string>>(new Set());\n' +
    '  useEffect(() => {\n' +
    '    if (!sortedStreams || sortedStreams.length === 0) return;\n' +
    '    try {\n' +
    '      const _backend = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\\/$/, "");\n' +
    '      if (!_backend) return;\n' +
    '      let _kicked = 0;\n' +
    '      for (let i = 0; i < sortedStreams.length && _kicked < 3; i++) {\n' +
    '        const s: any = sortedStreams[i];\n' +
    '        const _bh: any = s && s.behaviorHints;\n' +
    '        let _hash: string = (s && s.infoHash) ? String(s.infoHash).toLowerCase() : "";\n' +
    '        if (!_hash && _bh && typeof _bh.bingeGroup === "string") {\n' +
    '          const _m = _bh.bingeGroup.match(/\\b([0-9a-f]{40})\\b/i);\n' +
    '          if (_m) _hash = _m[1].toLowerCase();\n' +
    '        }\n' +
    '        if (!_hash || _hash.length !== 40) continue;\n' +
    '        if (_v180_prewarmedRef.current.has(_hash)) continue;\n' +
    '        _v180_prewarmedRef.current.add(_hash);\n' +
    '        // Fire-and-forget — never await, never bubble errors.\n' +
    '        try {\n' +
    '          fetch(`${_backend}/api/stream/start/${_hash}`, {\n' +
    '            method: "POST",\n' +
    '            headers: { "Content-Type": "application/json" },\n' +
    '            body: JSON.stringify({\n' +
    '              season: (typeof season === "number") ? season : undefined,\n' +
    '              episode: (typeof episode === "number") ? episode : undefined,\n' +
    '            }),\n' +
    '          }).catch(() => {});\n' +
    '        } catch (_) {}\n' +
    '        _kicked++;\n' +
    '      }\n' +
    '      if (_kicked > 0) {\n' +
    '        console.log("[PREWARM v180] kicked", _kicked, "PM resolves for top cached streams");\n' +
    '      }\n' +
    '    } catch (_) { /* never break UI */ }\n' +
    '  }, [sortedStreams]);';

  idText = idText.replace(prewarmAnchor, prewarmBlock);
  console.log('[v180] [id].tsx: pre-warm effect injected');

  const dId = braceDelta(idText) - braceDelta(idRead.text);
  if (dId !== 0) {
    console.error(`[v180] FATAL: [id].tsx brace delta ${dId}, refusing to write.`);
    process.exit(3);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// WRITE both files atomically — only after both passed validation
// ═════════════════════════════════════════════════════════════════════════
if (storeText !== storeRead.text) write(STORE_PATH, storeText, storeRead.eol, storeRead.raw);
if (idText    !== idRead.text)    write(ID_PATH,    idText,    idRead.eol,    idRead.raw);

console.log('');
console.log('━'.repeat(60));
console.log(' NEXT STEPS');
console.log('━'.repeat(60));
console.log('  1) Rebuild the Android TV APK:');
console.log('       cd android && .\\gradlew assembleRelease');
console.log('  2) Install:');
console.log('       adb -s <serial> install -r android\\app\\build\\outputs\\apk\\release\\app-release.apk');
console.log('  3) Test back-nav into a previously-viewed show — list should');
console.log('     stay visible (no 0-flash) and clicking Play should be faster.');
console.log('━'.repeat(60));
