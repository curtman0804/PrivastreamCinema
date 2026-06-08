/*
 * apply_patches_v194_progressive_paint.js
 *
 * V194 — Single frontend fix: progressive paint of streams.
 *
 * THE PROBLEM
 * -----------
 * `client.ts` getAllStreams fires three parallel sources for movies:
 *   1. Backend aggregator /api/streams/{type}/{id}   (~6 s cold cache)
 *   2. Direct Torrentio fetch from the Firestick     (often 10-12 s)
 *   3. Direct TPB fetch from the Firestick           (often 10-12 s)
 * It already calls a `mergeAndNotify(streams, source)` hook as each
 * source returns — BUT `contentStore.fetchStreams` doesn't pass an
 * onProgress callback, so those in-flight updates evaporate.  The
 * store only sees the FINAL result after Promise.allSettled — i.e. the
 * slowest of the three sources, which is 20+ s in your environment.
 *
 * THE FIX
 * -------
 * Pass an onProgress callback from contentStore → client.ts.  Update
 * state.streams as each source returns, never shrinking the list.
 * Result: as soon as the backend returns (5-6 s) you see streams.
 * The slower direct fetches may add more later — but the user is
 * already watching.
 *
 * Idempotent (V194_PROGRESSIVE_PAINT marker).  Single-file patch.
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v194_progressive_paint.js -o apply_patches_v194_progressive_paint.js
 *   node apply_patches_v194_progressive_paint.js
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

const storeFile = find([
  ['src', 'store', 'contentStore.ts'],
  ['src', 'stores', 'contentStore.ts'],
]);
if (!storeFile) { console.error('[v194] FATAL: contentStore.ts not found'); process.exit(1); }
console.log('[v194] store:', path.relative(ROOT, storeFile));

const raw = fs.readFileSync(storeFile, 'utf8');
const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;

if (text.indexOf('V194_PROGRESSIVE_PAINT') !== -1) {
  console.log('[v194] already patched, skipping.');
  process.exit(0);
}

// Anchor on the v190 fetchStreams network call.
const oldCall = `      const result = await api.addons.getAllStreams(type, id);
      let allStreams = result.streams || [];`;

const newCall = `      // V194_PROGRESSIVE_PAINT — paint streams as each source returns
      // instead of waiting for the slowest (direct Torrentio/TPB from
      // the Firestick can take 10-12 s; the backend returns in ~6 s on
      // cold cache).  The list never shrinks; once Backend lands 5
      // streams, the user sees them immediately.  Late-arriving direct
      // sources can append more — they can't take any away.
      let allStreams: any[] = [];
      const _v194_onProgress = (partialStreams: any[]) => {
        if (_myToken !== _v190AbortToken) return; // user navigated away
        if (!partialStreams || partialStreams.length === 0) return;
        // Only paint when we have STRICTLY MORE streams than before
        // (de-dupe is already done by client.ts mergeAndNotify).
        const _cur = get();
        const _curCount = (_cur && _cur.streams) ? _cur.streams.length : 0;
        if (partialStreams.length > _curCount) {
          if (partialStreams.length > 0) {
            try { setStreamsCache(cacheKey, partialStreams); } catch (_) {}
          }
          _setIf({ streams: partialStreams, isLoadingStreams: false });
          allStreams = partialStreams;
        }
      };
      const result = await api.addons.getAllStreams(type, id, _v194_onProgress);
      allStreams = result.streams || allStreams;`;

if (text.indexOf(oldCall) === -1) {
  console.error('[v194] FATAL: v190 fetchStreams anchor missing — was v190 frontend applied?');
  console.error('        looked for:\n' + oldCall.slice(0, 200));
  process.exit(2);
}
text = text.replace(oldCall, newCall);
console.log('[v194] contentStore.ts: progressive paint hook added');

const bak = storeFile + '.v194.bak';
if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(storeFile, out, 'utf8');
console.log(`[v194] wrote ${path.relative(ROOT, storeFile)} (${eol.toUpperCase()}, backup=.v194.bak)`);

console.log('');
console.log('Next:');
console.log('  cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('  npx expo run:android --device');
console.log('');
console.log('Then test on Firestick: open a fresh movie. Streams should');
console.log('appear in 5-7 s (when backend returns), not 20+ s.');
