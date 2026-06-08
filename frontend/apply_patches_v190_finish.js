/*
 * apply_patches_v190_finish.js
 *
 * V190 — Definitive frontend bundle (defensive — handles any prior
 * patch state).  Covers everything v187 + v188 + v189 wanted to do for
 * contentStore but didn't actually land on the user's machine.
 *
 * Targets:
 *   A. addons.tsx  → "Stremio" wording → "the Addons section in this app"
 *      (idempotent over any prior v189 state).
 *   B. contentStore.ts → FULL retry-with-abort-token + DON'T-CLOBBER guard.
 *      Detects pristine V170B state OR partially-patched state and brings
 *      both up to v190.
 *   C. id.tsx → cancelInFlightStreams call from handleBack (idempotent over
 *      v186/v187/v188 state).
 *
 * Properties:
 *   - Idempotent (markers V190_STORE_DEF + V190_SHARE_TEXT + V190_BACK_CANCEL)
 *   - CRLF preserved
 *   - Backups: .v190.bak
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v190_finish.js -o apply_patches_v190_finish.js
 *   node apply_patches_v190_finish.js
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
const addonsFile = find([['app','(tabs)','addons.tsx'], ['app','addons.tsx']]);
const storeFile  = find([['src','store','contentStore.ts'], ['src','stores','contentStore.ts']]);
const detailsFile = find([['app','details','[type]','[id].tsx'], ['app','details','[id].tsx']]);

if (!addonsFile)  { console.error('[v190] FATAL: addons.tsx not found.');  process.exit(1); }
if (!storeFile)   { console.error('[v190] FATAL: contentStore.ts not found.'); process.exit(1); }
if (!detailsFile) { console.error('[v190] FATAL: details/[type]/[id].tsx not found.'); process.exit(1); }
console.log('[v190] addons:', path.relative(ROOT, addonsFile));
console.log('[v190] store: ', path.relative(ROOT, storeFile));
console.log('[v190] details:', path.relative(ROOT, detailsFile));

function readUnix(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  const text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
  return { raw, eol, text };
}
function write(file, eol, text) {
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, out, 'utf8');
}
function backup(file, raw) {
  const bak = file + '.v190.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
}

// ════════════════════════════════════════════════════════════════════════
// A. addons.tsx — share text wording (V190_SHARE_TEXT)
// ════════════════════════════════════════════════════════════════════════
(function () {
  const { raw, eol, text } = readUnix(addonsFile);
  if (text.indexOf('V190_SHARE_TEXT') !== -1) {
    console.log('[v190] addons.tsx: V190_SHARE_TEXT already present, skipping.');
    return;
  }
  let t = text;
  let changes = 0;

  const replaces = [
    [
      "'Recipient can enter the Downloader code on FireStick or paste the URL into Stremio.'",
      "'Recipient can enter the Downloader code on FireStick or paste the URL into the Addons section in this app.'",
    ],
    [
      "'Recipient can paste the manifest URL into Stremio to install this addon.'",
      "'Recipient can paste the manifest URL into the Addons section in this app to install this addon.'",
    ],
    [
      "`Check out this Stremio addon: ${name}\\n\\n${url}`",
      "`Check out this addon: ${name}\\n\\n${url}`",
    ],
    [
      "`Check out this Stremio addon: ${addonName}\\n\\n${addonUrl}`",
      "`Check out this addon: ${addonName}\\n\\n${addonUrl}`",
    ],
  ];
  for (const [old, neu] of replaces) {
    if (t.indexOf(old) !== -1) {
      t = t.split(old).join(neu);
      changes++;
    }
  }
  // Marker — inject as a comment near the share-modal handler so we don't
  // re-patch on subsequent runs.
  t = t.replace(
    '  const handleShareAddon =',
    '  // V190_SHARE_TEXT — wording updated to refer to this app\'s Addons section\n  const handleShareAddon ='
  );
  backup(addonsFile, raw);
  write(addonsFile, eol, t);
  console.log(`[v190] addons.tsx: ${changes} wording replacements, marker added`);
})();

// ════════════════════════════════════════════════════════════════════════
// B. contentStore.ts — full retry+abort+don't-clobber (V190_STORE_DEF)
// ════════════════════════════════════════════════════════════════════════
(function () {
  const { raw, eol, text } = readUnix(storeFile);
  if (text.indexOf('V190_STORE_DEF') !== -1) {
    console.log('[v190] contentStore.ts: V190_STORE_DEF already present, skipping.');
    return;
  }

  let t = text;

  // B1. Add abort token + cancelInFlightStreams declaration to the
  // module-scope right after _pendingPrefetches.
  const oldPending = `const _pendingPrefetches = new Map<string, Promise<Stream[]>>();`;
  if (t.indexOf(oldPending) === -1) {
    console.error('[v190] FATAL: contentStore _pendingPrefetches anchor missing');
    process.exit(2);
  }
  if (t.indexOf('_v190AbortToken') === -1) {
    t = t.replace(
      oldPending,
      `${oldPending}
// V190_STORE_DEF — abort token incremented on Back from Details so
// late-arriving fetch results don't clobber a successfully-rendered list.
let _v190AbortToken = 0;`
    );
  }

  // B2. Add `cancelInFlightStreams` to the interface.
  const oldIface = `  fetchStreams: (type: string, id: string) => Promise<Stream[]>;`;
  if (t.indexOf(oldIface) === -1) {
    console.error('[v190] FATAL: contentStore fetchStreams interface anchor missing');
    process.exit(2);
  }
  if (t.indexOf('cancelInFlightStreams:') === -1) {
    t = t.replace(
      oldIface,
      `${oldIface}
  // V190_STORE_DEF
  cancelInFlightStreams: () => void;`
    );
  }

  // B3. Replace the ENTIRE fetchStreams implementation.  This is robust:
  // we use start/end anchors that exist in both the V170B baseline AND
  // any partially-patched (v187) state.
  const startAnchor = `  fetchStreams: async (type: string, id: string) => {`;
  // We want to delete the original fetchStreams body INCLUDING its closing
  // `},`.  The simplest anchor that doesn't overlap with template literals
  // inside fetchStreams is the V176J comment that immediately follows.
  // We then trim trailing whitespace before that anchor so we don't leak
  // dangling braces.
  const endAnchorText = `/* V176J_STORE_FINALLY`;
  const sIdx = t.indexOf(startAnchor);
  const eIdxRaw = t.indexOf(endAnchorText);
  if (sIdx < 0 || eIdxRaw < 0 || eIdxRaw <= sIdx) {
    console.error('[v190] FATAL: could not locate fetchStreams body span');
    process.exit(2);
  }
  // Back up over the leading whitespace + comment marker of the anchor so
  // our replacement lands on the same indent.  We replace up to (but not
  // including) the V176J comment line.
  let eIdx = eIdxRaw;
  // Move eIdx back to start of its line
  while (eIdx > 0 && t[eIdx - 1] !== '\n') eIdx--;
  const newBody = `  fetchStreams: async (type: string, id: string) => {
    // V190_STORE_DEF — retry-once on empty + abort-token gate + don't-clobber
    const cacheKey = \`\${type}/\${id}\`;
    const _myToken = _v190AbortToken;
    const _setIf = (patch: any) => { if (_myToken === _v190AbortToken) set(patch); };

    // 1. Memory cache — instant
    const cached = getStreamsCache(cacheKey);
    if (cached && cached.length > 0) {
      _setIf({ streams: cached, isLoadingStreams: false, error: null });
      return cached;
    }

    // 2. Mark loading + watchdog
    _setIf({ isLoadingStreams: true, streams: [], error: null });
    setTimeout(() => {
      if (get().isLoadingStreams && _myToken === _v190AbortToken) {
        console.log('[ContentStore v190] watchdog clearing isLoadingStreams after 30s');
        _setIf({ isLoadingStreams: false, error: null });
      }
    }, 30000);

    // 3. Disk cache
    const diskCached = await loadStreamsFromDisk(cacheKey);
    if (diskCached && diskCached.length > 0) {
      setStreamsCache(cacheKey, diskCached);
      _setIf({ streams: diskCached, isLoadingStreams: false, error: null });
      return diskCached;
    }

    // 4. Wait on any in-flight focus-prefetch
    const _inflight = _pendingPrefetches.get(cacheKey);
    if (_inflight) {
      try {
        const shared = await _inflight;
        if (shared && shared.length > 0) {
          setStreamsCache(cacheKey, shared);
          _setIf({ streams: shared, isLoadingStreams: false, error: null });
          return shared;
        }
      } catch (_) { /* fall through */ }
    }

    // 5. Network — with one retry on empty (3 s delay)
    try {
      const result = await api.addons.getAllStreams(type, id);
      let allStreams = result.streams || [];

      if ((!allStreams || allStreams.length === 0) && _myToken === _v190AbortToken) {
        console.log('[ContentStore v190] 0 streams on first try — retrying once in 3s');
        await new Promise((r) => setTimeout(r, 3000));
        if (_myToken !== _v190AbortToken) return [];
        try {
          const retry = await api.addons.getAllStreams(type, id);
          if (retry && retry.streams && retry.streams.length > 0) {
            allStreams = retry.streams;
            console.log('[ContentStore v190] retry succeeded:', allStreams.length);
          }
        } catch (e) {
          console.log('[ContentStore v190] retry threw:', e);
        }
      }

      if (allStreams.length > 0) {
        setStreamsCache(cacheKey, allStreams);
        saveStreamsToDisk(cacheKey, allStreams);
      }
      // V190_STORE_DEF — DON'T CLOBBER: if retry returned 0 but state already
      // has streams from a prior success, keep them.
      if (allStreams.length === 0) {
        const _cur = get();
        if (_cur && _cur.streams && _cur.streams.length > 0) {
          console.log('[v190] keeping', _cur.streams.length, 'existing streams (refusing 0)');
          _setIf({ isLoadingStreams: false });
          return _cur.streams;
        }
      }
      _setIf({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore v190] fetchStreams error:', error);
      const _cur = get();
      if (_cur && _cur.streams && _cur.streams.length > 0) {
        _setIf({ isLoadingStreams: false });
        return _cur.streams;
      }
      _setIf({ streams: [], isLoadingStreams: false });
      return [];
    }
  },

  // V190_STORE_DEF — drop any in-flight fetch's state-writes
  cancelInFlightStreams: () => {
    _v190AbortToken++;
  },

`;
  // Replace span [sIdx, eIdx) with newBody.  eIdx points to the comment
  // "/* V176J_STORE_FINALLY" — we want to KEEP that, so insert before it.
  t = t.slice(0, sIdx) + newBody + t.slice(eIdx);

  backup(storeFile, raw);
  write(storeFile, eol, t);
  console.log('[v190] contentStore.ts: replaced fetchStreams + added cancelInFlightStreams');
})();

// ════════════════════════════════════════════════════════════════════════
// C. id.tsx — handleBack calls cancelInFlightStreams (V190_BACK_CANCEL)
// ════════════════════════════════════════════════════════════════════════
(function () {
  const { raw, eol, text } = readUnix(detailsFile);
  if (text.indexOf('V190_BACK_CANCEL') !== -1) {
    console.log('[v190] [id].tsx: V190_BACK_CANCEL already present, skipping.');
    return;
  }
  let t = text;
  // Inject cancelInFlightStreams() call into handleBack, in WHATEVER
  // form it's currently in (v186/v187/v188).  Match the start of the
  // handleBack body and add the cancel call as the first statement.
  const handleBackHead = `  const handleBack = useCallback(() => {`;
  const idx = t.indexOf(handleBackHead);
  if (idx < 0) {
    console.error('[v190] FATAL: handleBack anchor missing in [id].tsx');
    process.exit(2);
  }
  if (t.indexOf('V190_BACK_CANCEL') === -1) {
    t = t.replace(
      handleBackHead,
      `  const handleBack = useCallback(() => {
    // V190_BACK_CANCEL — drop in-flight stream fetch state-writes
    try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}`
    );
  }
  backup(detailsFile, raw);
  write(detailsFile, eol, t);
  console.log('[v190] [id].tsx: handleBack now cancels in-flight streams');
})();

console.log('');
console.log('[v190] All frontend patches done.');
console.log('');
console.log('Next steps:');
console.log('  1. Rebuild & sideload:');
console.log('     cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('     npx expo run:android --device');
console.log('');
console.log('  2. Apply v190 backend on Hetzner (cleans up v188/v189 dupes):');
console.log('     ssh choyt@5.161.49.99 "cd ~/PrivastreamCinema && curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v190_release_status_clean.py -o patch_v190.py && python3 patch_v190.py && docker compose restart app"');
console.log('');
console.log('  3. VERIFY the backend route is alive:');
console.log('     curl https://api.privastreamsolutions.com/api/movie/release_status/__ping');
console.log('     Expected: {"ok":true,"version":"v190"}');
console.log('     If 404 → docker is running cached code; run:');
console.log('     ssh choyt@5.161.49.99 "cd ~/PrivastreamCinema && docker compose up -d --build app"');
