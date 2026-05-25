// apply_patches_v121e_codec_penalty.js
//
// Fixes the "audio plays but video stutters/fails" issue caused by the Play
// button auto-picking a 4K HDR HEVC 10-bit stream that the device's hardware
// decoder can't handle.
//
// Current score formula in computeScore() (v121b values):
//   QUALITY_PTS:  4K=800, 1080p=600, 720p=400, HD=300, SD=0
//   if (!info.isHEVC) s += 30;
//   if (!info.isHDR)  s += 20;
//
// With those tiny non-HEVC / non-HDR bonuses, a 4K HDR HEVC stream beats a
// 1080p x264 by ~150 points and wins auto-play - even though many TV devices
// can't decode HDR HEVC.
//
// Fix: bump non-HEVC bonus to 250 and non-HDR bonus to 150 so codec-safe
// streams win auto-play. New score table for ENG streams:
//   4K x264 (no HDR)      = 1000 + 800 + 250 + 150 = 2200  <- ideal
//   1080p x264 (no HDR)   = 1000 + 600 + 250 + 150 = 2000
//   4K HEVC (no HDR)      = 1000 + 800 +   0 + 150 = 1950
//   4K HEVC HDR (10-bit)  = 1000 + 800 +   0 +   0 = 1800  <- now LOSES
//   720p x264 (no HDR)    = 1000 + 400 + 250 + 150 = 1800
//
// 4K still wins when it's a "safe" codec; the device-incompatible 4K HDR
// HEVC drops to the bottom so auto-play picks a working 1080p instead.
// Manual selection of any stream still works (user can tap a 4K card).
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121e_codec_penalty.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121e-codec-penalty */';

function die(msg) { console.error('[v121e] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121e] already applied - nothing to do.');
  process.exit(0);
}

// Anchor on the two existing codec/HDR bonus lines. CRLF-safe.
const re = /if\s*\(!info\.isHEVC\)\s*s\s*\+=\s*30;\s*[\r\n]+\s*if\s*\(!info\.isHDR\)\s*s\s*\+=\s*20;/;

if (!re.test(src)) die('could not find computeScore HEVC/HDR bonus anchors.');

const replacement =
  "/* v121e-codec-penalty */ if (!info.isHEVC) s += 250; if (!info.isHDR) s += 150;";

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121e';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121e] patched ' + TARGET);
console.log('[v121e] backup: ' + bak);
console.log('[v121e] OK - rebuild and sideload.');
