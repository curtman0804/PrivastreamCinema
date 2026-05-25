// apply_patches_v121d3_play_wait.js
//
// Refines v121d2: when the Play button auto-picks a stream, it must pick
// ONLY from streams that have a pre-resolved direct URL (cached on
// Premiumize and resolved by the v121 backend block). If none exist, it
// falls back to picking the best uncached stream so the user still gets
// something to play. Manual stream-card selection is unaffected.
//
// Without this filter, an uncached 4K with high seeders can outscore a
// cached 1080p and the Play button picks it - resulting in another orange
// screen.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121d3_play_wait.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = '/* v121d3-resolved-only */';

function die(msg) { console.error('[v121d3] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121d3] already applied - nothing to do.');
  process.exit(0);
}

// Anchor: the last two lines of the v121d2 onPress where it sorts pool and
// calls handleStreamSelect.
const re = /const\s+sorted\s*=\s*sortStreamsByLanguage\(pool\);\s*[\r\n]+\s*if\s*\(sorted\[0\]\)\s*handleStreamSelect\(sorted\[0\]\);/;

if (!re.test(src)) die('could not find v121d2 sort/select anchor (was v121d2 applied?).');

const replacement =
  "/* v121d3-resolved-only */\n" +
  "                      // Auto-pick only from pre-resolved (cached + resolved)\n" +
  "                      // streams. Uncached can outscore cached on raw quality\n" +
  "                      // points, so we restrict the auto-pick pool. Manual\n" +
  "                      // stream-card selection still works for any stream.\n" +
  "                      const resolved = pool.filter((s: any) => s && (s.url || s.externalUrl || s.direct_url));\n" +
  "                      const candidates = resolved.length > 0 ? resolved : pool;\n" +
  "                      const sorted = sortStreamsByLanguage(candidates);\n" +
  "                      if (sorted[0]) handleStreamSelect(sorted[0]);";

src = src.replace(re, replacement);

const bak = TARGET + '.bak.v121d3';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121d3] patched ' + TARGET);
console.log('[v121d3] backup: ' + bak);
console.log('[v121d3] OK - rebuild and sideload.');
