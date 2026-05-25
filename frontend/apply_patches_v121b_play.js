// apply_patches_v121b_play.js
//
// v121b — Make quality DOMINATE among streams with the same language so the
// Play button always grabs the highest-quality cached stream.
//
// Your file has computeScore() with:
//   QUALITY_PTS = { '4K': 80, '1080p': 60, '720p': 40, 'HD': 20, 'SD': 0 }
// Bonuses for direct URL, seeders, codec, HDR can total +/-100, easily
// flipping a 4K vs 1080p pick. We bump quality 10x so quality wins.
//
// New weights:
//   4K=800, 1080p=600, 720p=400, HD=300, SD=0
// Language is still 1000 (ENG) vs 100 (other) so ENG still beats foreign 4K.
// Within ENG, 4K (1800) > 1080p (1600) > 720p (1400) > HD (1300) > SD (1000),
// and the +/-100 other bonuses can no longer flip these tiers.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121b_play.js
//
// Idempotent — safe to re-run.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121b-quality-boost */';

function die(msg) { console.error('[v121b] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' — run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121b] already applied — nothing to do.');
  process.exit(0);
}

// Anchor: the QUALITY_PTS declaration. Whitespace flexible for CRLF.
const re = /const\s+QUALITY_PTS\s*:\s*Record<string,\s*number>\s*=\s*\{\s*'4K'\s*:\s*80\s*,\s*'1080p'\s*:\s*60\s*,\s*'720p'\s*:\s*40\s*,\s*'HD'\s*:\s*20\s*,\s*'SD'\s*:\s*0\s*\}\s*;/;

if (!re.test(src)) die('could not find QUALITY_PTS line. File may already be patched or layout changed.');

const replacement =
  "/* v121b-quality-boost */ " +
  "const QUALITY_PTS: Record<string, number> = { '4K': 800, '1080p': 600, '720p': 400, 'HD': 300, 'SD': 0 };";

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121b';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121b] patched ' + TARGET);
console.log('[v121b] backup: ' + bak);
console.log('[v121b] OK — rebuild and sideload.');
