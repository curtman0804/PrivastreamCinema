// apply_patches_v121c_client.js
//
// Fixes the stream-merge race in src/api/client.ts that lets uncached streams
// from direct Torrentio/TPB fetches win over the backend's pre-resolved
// Premiumize-cached streams.
//
// Current behavior in getAllStreams():
//   - 3 parallel fetches: /api/streams (backend), Torrentio direct, TPB direct
//   - mergeAndNotify() dedupes by infoHash with "first-seen wins"
//   - Direct sources usually arrive first => uncached hashes lock in
//   - Backend's /api/streams arrives later with pre-resolved url/externalUrl
//     fields BUT the merge drops them as duplicates
//   => Play button picks an uncached hash => orange screen
//
// Fix:
//   When the "Backend" source comes back carrying any stream with a
//   pre-resolved direct URL (externalUrl or url), REPLACE the entire merged
//   list with the backend's curated set. Backend already:
//     - drops uncached when any cached exists
//     - sorts by quality (4K > 1080p > 720p > 480p)
//     - pre-resolves top 5 cached streams to direct Premiumize HTTPS
//   so its set is the authoritative one.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121c_client.js
//
// Idempotent.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('src', 'api', 'client.ts');
const MARKER = '/* v121c-backend-override */';

function die(msg) { console.error('[v121c] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121c] already applied - nothing to do.');
  process.exit(0);
}

// Anchor: the opening of mergeAndNotify function. We inject the
// backend-override check right after the function header. CRLF-safe.
const anchor = /(const\s+mergeAndNotify\s*=\s*\(newStreams\s*:\s*Stream\[\]\s*,\s*sourceName\s*:\s*string\)\s*=>\s*\{\s*[\r\n]+)/;

if (!anchor.test(src)) die('could not find mergeAndNotify function signature.');

const injection =
  "        /* v121c-backend-override */\n" +
  "        // When backend returns pre-resolved cached streams, REPLACE the\n" +
  "        // merged list. Backend already filtered uncached, sorted by quality,\n" +
  "        // and pre-resolved direct HTTPS URLs. Don't let raw Torrentio/TPB\n" +
  "        // results dilute the Play button's top pick.\n" +
  "        if (sourceName === 'Backend' && newStreams.some((s: any) => s.externalUrl || s.url || s.direct_url)) {\n" +
  "          allStreams = newStreams.slice();\n" +
  "          existingHashes.clear();\n" +
  "          for (const s of allStreams) {\n" +
  "            const h = (s.infoHash || '').toLowerCase();\n" +
  "            if (h) existingHashes.add(h);\n" +
  "          }\n" +
  "          console.log(`[STREAMS] v121c: Backend override - using ${allStreams.length} curated streams`);\n" +
  "          if (onProgress) onProgress(allStreams.slice());\n" +
  "          return;\n" +
  "        }\n";

src = src.replace(anchor, '$1' + injection);

const bak = TARGET + '.bak.v121c';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121c] patched ' + TARGET);
console.log('[v121c] backup: ' + bak);
console.log('[v121c] OK - rebuild and sideload.');
