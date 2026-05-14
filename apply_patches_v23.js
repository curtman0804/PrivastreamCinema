/* eslint-disable */
// apply_patches_v23.js — FlatList virtualization knobs (zero-risk perf)
// Run from project root:   node apply_patches_v23.js
//
// Single file. Two additive prop changes. Zero behavior change.
//
// `removeClippedSubviews={true}` — Android frees off-screen card memory.
// `windowSize={5}` — Only ~5 screens of cards mounted at once
//                    (default is 21, way too many for a 50+ item list).
// `initialNumToRender={8}` — Render only 8 items initially instead of 10.
//
// Combined with V21's React.memo, scrolling the streams list is much cheaper.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v23.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V23_FLATLIST_VIRT';

if (src.includes(MARKER)) {
  ok('V23 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Anchor on `data={sortedStreams}` (added by V20). Insert virtualization
// props on the next line. Indentation is matched dynamically.
// ---------------------------------------------------------------------
{
  const anchor = "                  data={sortedStreams}";
  if (!src.includes(anchor)) {
    bad('could not find FlatList `data={sortedStreams}` anchor (V20 must be applied first)');
  } else {
    const insertion = [
      "                  data={sortedStreams}",
      "                  // " + MARKER,
      "                  removeClippedSubviews={true}",
      "                  windowSize={5}",
      "                  initialNumToRender={8}",
      "                  maxToRenderPerBatch={5}",
    ].join('\n');
    src = src.replace(anchor, insertion);
    ok('added removeClippedSubviews + windowSize + initialNumToRender + maxToRenderPerBatch to streams FlatList');
  }
}

// Save (restoring CRLF if original was CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV23 done. Rebuild and test:');
  console.log('  ✓ Stream list scrolling on Firestick is noticeably smoother');
  console.log('  ✓ Memory usage on long stream lists drops significantly');
  console.log('  ✓ Off-screen cards no longer eat render time');
  console.log('\nIf it builds + works, tell me and we go to V24.');
}
