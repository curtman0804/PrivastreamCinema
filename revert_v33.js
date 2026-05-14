/* eslint-disable */
// revert_v33.js — Restore the 3 files V33 touched from their .bak.v33.* backups
// Run from project root:   node revert_v33.js
//
// This undoes V33 entirely. You'll be back to the state right BEFORE V33 ran,
// which was: back-from-player worked, back-from-details exited the app.
// Not perfect, but at least the back button DOES something visible again.
//
// After this, we diagnose the actual file state before any more patching.

const fs = require('fs');
const path = require('path');

const FILES = [
  path.join('frontend', 'app', 'details', '[type]', '[id].tsx'),
  path.join('frontend', 'app', 'player.tsx'),
  path.join('frontend', 'app', '(tabs)', '_layout.tsx'),
];

let restored = 0, missing = 0;

for (const f of FILES) {
  const dir = path.dirname(f);
  const base = path.basename(f);
  let candidates = [];
  try {
    candidates = fs.readdirSync(dir)
      .filter(n => n.startsWith(base + '.bak.v33.'))
      .map(n => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
  } catch (e) {
    console.log('  [WARN] could not read dir ' + dir + ': ' + e.message);
  }

  if (candidates.length === 0) {
    console.log('  [SKIP] no .bak.v33.* found for ' + f);
    missing++;
    continue;
  }

  const newest = candidates[0];
  fs.copyFileSync(newest.full, f);
  console.log('  [OK]   restored ' + f + '  ←  ' + newest.name);
  restored++;
}

console.log('\n========================================');
console.log('  restored: ' + restored + '   missing-backups: ' + missing);
console.log('========================================');

if (restored === 0) {
  console.log('\nNothing restored. V33 may not have run, or backups were cleaned up.');
  console.log('Tell me and I will write a manual revert based on file contents.');
  process.exit(1);
}

console.log('\nDone. V33 is undone. Rebuild and verify:');
console.log('  ✓ Apex → Play → BACK → returns to Apex card (working state)');
console.log('  ✓ Now DO NOT run any patches. Paste me the output of:');
console.log('');
console.log('    node show_back_state.js');
console.log('');
console.log('  (I will send that diagnostic next so we can see the EXACT current');
console.log('   state of the back handlers before we touch anything else.)');
