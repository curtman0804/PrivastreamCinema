// apply_patches_v124e_quality_4k_preferred.js
//
// Reweights computeScore() so 4K wins over 1080p when HDR is OFF, and
// HDR sinks to the bottom (your TV chokes on HDR HEVC 10-bit).
//
// New weights (replaces v121e values):
//   if (!info.isHEVC) s += 100;   // was 250 - smaller HEVC penalty
//   if (!info.isHDR)  s += 220;   // was 150 - bigger HDR penalty
//
// Resulting auto-pick order (ENG streams, before url/seeders bonuses):
//   4K x264   no HDR   = 1000 + 800 + 100 + 220 = 2120  <- ideal
//   4K HEVC   no HDR   = 1000 + 800 +   0 + 220 = 2020  <- chosen most often
//   1080p x264 no HDR  = 1000 + 600 + 100 + 220 = 1920
//   1080p HEVC no HDR  = 1000 + 600 +   0 + 220 = 1820
//   4K HEVC   HDR      = 1000 + 800 +   0 +   0 = 1800  <- still loses to 1080p
//
// 4K HEVC non-HDR wins on most series episodes (where 4K x264 is rare).
// 4K HDR HEVC drops below 1080p so it never auto-plays.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124e_quality_4k_preferred.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124e-quality-4k';

function die(msg) { console.error('[v124e] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v124e] already applied - nothing to do.');
  process.exit(0);
}

// Anchor on the v121e marker we placed earlier.
const re = /\/\* v121e-codec-penalty \*\/ if \(!info\.isHEVC\) s \+= 250; if \(!info\.isHDR\) s \+= 150;/;

if (!re.test(src)) die('could not find v121e codec/HDR line. Was v121e applied?');

src = src.replace(
  re,
  "/* v124e-quality-4k */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 220;"
);

const bak = TARGET + '.bak.v124e';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v124e] patched ' + TARGET);
console.log('[v124e] backup: ' + bak);
console.log('[v124e] OK - rebuild and sideload.');
