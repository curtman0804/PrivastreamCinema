// apply_patches_v121_play.js
//
// PURPOSE: Make the "Play" button on details screens INSTANTLY play the
// highest-quality CACHED stream. If no cached streams exist, play the best
// uncached one as a fallback (may fail — user is then expected to tap a stream
// card directly).
//
// PROBLEM:
//   sortStreamsByLanguage() in app\details\[type]\[id].tsx prioritizes streams
//   with a direct URL, then language, then seeders. It does NOT prioritize
//   higher quality (4K, 1080p) so the Play button can land on a 480p stream
//   even when a 4K cached version is available.
//
// FIX:
//   After the "direct URL first" sort key, add a quality-rank sort key
//   (4K > 1080p > 720p > 480p > SD/other) so the first stream the Play
//   button picks is always the best quality available.
//
// Run from the FRONTEND root (Windows):
//   node apply_patches_v121_play.js
//
// Idempotent: re-running is safe.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121-quality-rank */';

function die(msg) {
  console.error(`[v121] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) die(`cannot find ${TARGET}. Run this from the frontend root.`);

let src = fs.readFileSync(TARGET, 'utf8');
const origLen = src.length;

if (src.includes(MARKER)) {
  console.log('[v121] already applied — nothing to do.');
  process.exit(0);
}

// Locate the sort callback inside sortStreamsByLanguage. We anchor on the
// existing line `const directA = a.stream.url ? 0 : 1;` and the matching
// closing of `if (directA !== directB) return directA - directB;`. Whitespace
// is collapsed to be CRLF-safe.

const anchorRegex = /(const\s+directA\s*=\s*a\.stream\.url\s*\?\s*0\s*:\s*1;\s*[\r\n]+\s*const\s+directB\s*=\s*b\.stream\.url\s*\?\s*0\s*:\s*1;\s*[\r\n]+\s*if\s*\(\s*directA\s*!==\s*directB\s*\)\s*return\s+directA\s*-\s*directB;)/;

if (!anchorRegex.test(src)) die('could not find sortStreamsByLanguage direct-URL anchor. File may already be patched in a different way or layout changed.');

// The quality-rank block we want to inject AFTER the direct-URL check.
const injection = `

    /* v121-quality-rank */
    // After "direct URL first", prefer higher quality so the Play button picks
    // the best cached stream (4K > 1080p > 720p > 480p > SD/other).
    const qRank = (info) => {
      const q = (info && info.quality) ? String(info.quality).toUpperCase() : '';
      if (q === '4K' || q === '2160P') return 4;
      if (q === '1080P') return 3;
      if (q === '720P') return 2;
      if (q === 'HD') return 2;
      if (q === '480P' || q === 'SD') return 1;
      return 0;
    };
    const qA = qRank(a.info);
    const qB = qRank(b.info);
    if (qA !== qB) return qB - qA;`;

src = src.replace(anchorRegex, `$1${injection}`);

if (src.length === origLen) die('regex replace produced no change — aborting.');

// Backup
const bak = TARGET + '.bak.v121';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');

console.log(`[v121] patched ${TARGET}`);
console.log(`[v121] backup: ${bak}`);
console.log(`[v121] OK — rebuild the app and sideload.`);
