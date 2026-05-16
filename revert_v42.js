/* eslint-disable */
// revert_v42.js — Restore discover.tsx from the V42 backup.
// V42 swapped the outer ScrollView for a FlatList which broke TV focus.
// This restores the original ScrollView so navigation works again.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
if (!fs.existsSync(F)) { console.log('[FAIL] not found: ' + F); process.exit(1); }

const dir = path.dirname(F);
const base = path.basename(F);

// Find newest V42 backup
const baks = fs.readdirSync(dir)
  .filter(n => n.startsWith(base + '.bak.v42.'))
  .map(n => ({ n, t: parseInt(n.split('.bak.v42.')[1], 10) || 0 }))
  .sort((a, b) => b.t - a.t);

if (baks.length === 0) {
  console.log('[FAIL] no V42 backup found in ' + dir);
  console.log('       Expected files like: ' + base + '.bak.v42.<timestamp>');
  process.exit(1);
}

const newest = path.join(dir, baks[0].n);
console.log('[info] using backup: ' + newest);
console.log('[info] discarding current (broken) discover.tsx and restoring from backup');

// Save current broken file just in case
const trashName = F + '.broken.v42.' + Date.now();
fs.copyFileSync(F, trashName);
console.log('[info] current (broken) saved to: ' + trashName);

// Restore
fs.copyFileSync(newest, F);
console.log('[OK]   restored ' + F + ' from ' + newest);

if (baks.length > 1) {
  console.log('\n[info] other V42 backups available (newest first):');
  baks.forEach(b => console.log('       ' + b.n));
}

console.log('\nDone. Rebuild + force-stop + relaunch on Firestick.');
console.log('Navigation should be back to V41 state (working, but cold-start slow).');
