/* eslint-disable */
// apply_patches_v8b.js
// Run from project root:   node apply_patches_v8b.js
//
// V8's regex-based replacement matched the OPENING of the old loading-screen
// JSX block but stopped at the wrong `)}` (non-greedy match), leaving the
// trailing 167 lines of the old block orphaned in the file. That broke the
// JSX parser → release bundle failed.
//
// V8b uses a line-based scan to remove EXACTLY the orphan, between two
// unambiguous text anchors: the closing of the V8 unified loader and the
// next legitimate JSX block (`{/* Error */}`).

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('frontend', 'app', 'player.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(PLAYER)) { bad('player.tsx not found'); process.exit(1); }

const lines = fs.readFileSync(PLAYER, 'utf8').split('\n');
const origCount = lines.length;
const bak = PLAYER + '.bak.v8b.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

console.log('\n=== Removing orphaned old loading-screen block from ' + PLAYER + ' ===');

// 1. Locate the V8 unified-loader marker.
const v8MarkerIdx = lines.findIndex(l => l.includes('PATCH_V8_UNIFIED_LOADING'));
if (v8MarkerIdx < 0) {
  bad('V8 marker not found — file may already be clean or never patched');
  process.exit(1);
}
info('V8 marker at line ' + (v8MarkerIdx + 1));

// 2. Find the closing `)}` of the V8 block — first line equal to "      )}" after the marker.
let v8EndIdx = -1;
for (let i = v8MarkerIdx + 1; i < lines.length; i++) {
  if (lines[i] === '      )}') { v8EndIdx = i; break; }
}
if (v8EndIdx < 0) {
  bad('could not find V8 block close `)}`');
  process.exit(1);
}
info('V8 block ends at line ' + (v8EndIdx + 1));

// 3. Find orphan start — the next `{/* Dark Overlay */}` after the V8 block ends.
//    Bail if we hit `{/* Error */}` first (means no orphan exists; already clean).
let orphanStart = -1;
let errorBlockIdx = -1;
for (let i = v8EndIdx + 1; i < lines.length; i++) {
  if (lines[i].includes('/* Dark Overlay */')) { orphanStart = i; break; }
  if (lines[i].includes('/* Error */'))         { errorBlockIdx = i; break; }
}
if (orphanStart < 0) {
  ok('no orphan found — file is already clean');
  process.exit(0);
}
info('orphan starts at line ' + (orphanStart + 1));

// 4. Find the orphan's end — the LAST `      )}` before `{/* Error */}`.
//    First locate the Error block (the next legitimate JSX section).
let nextErrorIdx = -1;
for (let i = orphanStart + 1; i < lines.length; i++) {
  if (lines[i].includes('/* Error */')) { nextErrorIdx = i; break; }
}
if (nextErrorIdx < 0) {
  bad('could not find next /* Error */ block to bound the orphan');
  process.exit(1);
}
info('next legitimate block (/* Error */) at line ' + (nextErrorIdx + 1));

let orphanEnd = -1;
for (let j = nextErrorIdx - 1; j > orphanStart; j--) {
  if (lines[j].trim() === ')}') { orphanEnd = j; break; }
}
if (orphanEnd < 0) {
  bad('could not find orphan closing `)}`');
  process.exit(1);
}
info('orphan ends at line ' + (orphanEnd + 1));

const removeCount = orphanEnd - orphanStart + 1;
info('removing ' + removeCount + ' orphaned lines (' + (orphanStart + 1) + '-' + (orphanEnd + 1) + ')');

// 5. Splice them out.
lines.splice(orphanStart, removeCount);

// Sanity: file should now be smaller.
if (lines.length >= origCount) {
  bad('line count did not decrease — something went wrong');
  process.exit(1);
}

fs.writeFileSync(PLAYER, lines.join('\n'), 'utf8');
ok('removed ' + removeCount + ' lines (file: ' + origCount + ' → ' + lines.length + ')');
ok('saved ' + PLAYER);

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');
console.log('\nNow rebuild the APK. If it succeeds, V8 unified loading screen is live.');
console.log('If it still fails, paste the next build error and I\'ll look at it.');
