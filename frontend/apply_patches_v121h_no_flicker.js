// apply_patches_v121h_no_flicker.js
//
// Stops the stream list from rendering progressively (Torrentio/TPB direct
// first, then backend replaces it) by suppressing onProgress for non-Backend
// sources. The list now renders once - when the backend's curated set
// arrives - or after all sources settle if backend fails.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121h_no_flicker.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('src', 'api', 'client.ts');
const MARKER = '/* v121h-suppress-direct */';

function die(msg) { console.error('[v121h] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121h] already applied - nothing to do.');
  process.exit(0);
}

// Anchor on the exact onProgress line inside the non-Backend branch.
// (The Backend branch returns early via v121c-backend-override.)
const re = /if\s*\(onProgress\)\s*onProgress\(\[\.\.\.allStreams\]\);/;

if (!re.test(src)) die('could not find direct-source onProgress anchor.');

const replacement =
  "/* v121h-suppress-direct */\n" +
  "          // Don't render Torrentio/TPB raw streams progressively.\n" +
  "          // Backend will arrive with the curated cached+resolved list\n" +
  "          // (v121c-backend-override) and we want one clean render.\n" +
  "          // (onProgress intentionally suppressed for non-Backend sources)";

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121h';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121h] patched ' + TARGET);
console.log('[v121h] backup: ' + bak);
console.log('[v121h] OK - rebuild and sideload.');
