/* eslint-disable */
// apply_patches_v27.js — ServiceRow FlatList retune for TV D-pad hold-scroll
// Run from project root:   node apply_patches_v27.js
//
// Symptom: holding the right D-pad button on Google Streamer/Firestick
// makes the row scroll in jerky chunks where multiple posters appear/
// disappear at once. Root cause: virtualization batching is tuned for
// touch scroll, where slowing down rendering is fine. TV D-pad scrolls
// faster than touch and needs eager rendering.
//
// Changes (4 single-line tuning swaps in ServiceRow.tsx):
//   windowSize: 5  → 11    (mount ~5x more cards around viewport)
//   maxToRenderPerBatch: 6 → 12   (catch up faster)
//   updateCellsBatchingPeriod: 50 → 10   (fire batches 5x more often)
//   initialNumToRender: 6 → 10   (initial paint covers a wider row)
//
// removeClippedSubviews stays true (memory matters on Firestick),
// but with windowSize=11 it clips much less aggressively.

const fs = require('fs');
const path = require('path');

const ROW = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(ROW)) { bad('ServiceRow.tsx not found at ' + ROW); process.exit(1); }

let src = fs.readFileSync(ROW, 'utf8');
const orig = src;
const bak = ROW + '.bak.v27.' + Date.now();
fs.copyFileSync(ROW, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');

console.log('\n=== Patching ' + ROW + ' ===');

const MARKER = 'PATCH_V27_FLATLIST_TUNE';

if (src.includes(MARKER)) {
  ok('V27 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Four single-line prop swaps. Each is independently idempotent.
// ---------------------------------------------------------------------
const swaps = [
  { old: "          initialNumToRender={6}",          new_: "          initialNumToRender={10} /* " + MARKER + " */", label: "initialNumToRender 6 → 10" },
  { old: "          maxToRenderPerBatch={6}",          new_: "          maxToRenderPerBatch={12} /* " + MARKER + " */", label: "maxToRenderPerBatch 6 → 12" },
  { old: "          updateCellsBatchingPeriod={50}",   new_: "          updateCellsBatchingPeriod={10} /* " + MARKER + " */", label: "updateCellsBatchingPeriod 50 → 10" },
  { old: "          windowSize={5}",                   new_: "          windowSize={11} /* " + MARKER + " */", label: "windowSize 5 → 11" },
];

for (const s of swaps) {
  const occ = src.split(s.old).length - 1;
  if (occ === 0) {
    info(s.label + ' — anchor not found (already changed?), skipping');
  } else if (occ > 1) {
    bad(s.label + ' — anchor matches ' + occ + ' times, refusing ambiguous swap');
  } else {
    src = src.replace(s.old, s.new_);
    ok(s.label);
  }
}

// Save (restoring CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(ROW, finalOut, 'utf8');
  ok('saved ' + ROW);
} else if (src === orig) {
  info('no changes applied — file unchanged');
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
  console.log('\nV27 done. Rebuild and test:');
  console.log('  ✓ Hold the D-pad right on Google Streamer — posters scroll smoothly');
  console.log('  ✓ No more "multiple posters disappearing at once"');
  console.log('  ✓ Slight memory increase (~10-20 MB on a long row) — fine for Firestick/Streamer');
  console.log('\nIf this fixes it, tell me. If still jerky, we look at the focus snap behavior next.');
}
