/* eslint-disable */
// apply_patches_v41.js — Cold-start render budget: smaller initial burst per row
// Run from project root:   node apply_patches_v41.js
//
// THE LAG (initial launch only):
//   On cold start, all ~20 ServiceRows mount at once. Each FlatList renders
//   initialNumToRender=6 cards immediately → ~120 simultaneous image fetches
//   from the network (no disk cache yet) + ~600 component renders. The JS
//   thread saturates → D-pad UP from bottom tab feels laggy → first few
//   D-pad moves stutter while everything settles.
//
// THE FIX:
//   Lower initialNumToRender 6 → 3 and maxToRenderPerBatch 6 → 3. Each row
//   now eager-renders 3 cards instead of 6. FlatList virtualization already
//   renders more as you scroll horizontally, so steady-state feel is unchanged.
//   Cold start: ~60 image fetches and ~half the sync render work.
//
// Single file. Two anchors, both unique. CRLF preserved. Idempotent.

const fs = require('fs');
const path = require('path');

const ROW = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(ROW)) { bad('not found: ' + ROW); process.exit(1); }

let src = fs.readFileSync(ROW, 'utf8');
const orig = src;
const bak = ROW + '.bak.v41.' + Date.now();
fs.copyFileSync(ROW, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + ROW + ' ===');

const MARKER = 'PATCH_V41_COLDSTART_BUDGET';

if (src.includes(MARKER)) { ok('V41 already applied'); process.exit(0); }

function swapUnique(anchor, replacement, label) {
  const occ = src.split(anchor).length - 1;
  if (occ === 0) { bad('anchor not found: ' + label); return false; }
  if (occ > 1)   { bad(label + ' matches ' + occ + ' times — refusing'); return false; }
  src = src.replace(anchor, replacement);
  ok(label);
  return true;
}

swapUnique(
  "initialNumToRender={6}",
  "initialNumToRender={3} /* " + MARKER + " — was 6; halves cold-start image fetches */",
  "initialNumToRender: 6 → 3"
);

swapUnique(
  "maxToRenderPerBatch={6}",
  "maxToRenderPerBatch={3} /* " + MARKER + " — smaller render chunks; more JS yields */",
  "maxToRenderPerBatch: 6 → 3"
);

if (src !== orig && fail === 0) {
  fs.writeFileSync(ROW, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + ROW);
} else if (fail > 0) {
  info('failed — file NOT saved (original safe in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV41 done. Rebuild and test cold start:');
  console.log('  ✓ Force-stop app on Firestick, relaunch (clean cold start)');
  console.log('  ✓ Press UP from bottom tabs → focus reaches first poster faster');
  console.log('  ✓ D-pad responsive within ~1 s instead of 3-5 s');
  console.log('  ✓ Posters off-screen still load as you scroll horizontally');
  console.log('\nCommit:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V41 — smaller cold-start render burst per row"');
  console.log('\nIf cold-start is STILL too slow, the remaining lever is virtualizing the');
  console.log('outer vertical list of ServiceRows (currently all mount at once inside a');
  console.log('ScrollView). That would be V42 — replace ScrollView with FlatList for');
  console.log('the rows. Bigger change so let\'s test V41 first.');
}
