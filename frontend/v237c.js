// v237c — Rollback ONLY the discover See All change from v237/v237b.
// Keep the Firestick cache-buster (A+B) in details/[type]/[id].tsx — that
// patch is in a separate file and is harmless.
//
// Reason: v237b injected a React hook (_v237_useRowCap) inside ServiceRow
// items prop JSX expression.  ServiceRow is rendered inside a .map() loop,
// so the hook ends up called outside a component body -> Rules of Hooks
// violation -> Discover crashes on mount.
//
// This patch:
//   1. Restores app/(tabs)/discover.tsx from the original .bak_v237 backup
//      (pre-anything) — if that exists.  Falls back to .bak_v237b.
//   2. Verifies the restore worked by checking the marker is gone.
//
// Run:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v237c_rollback_seeall.js -o v237c.js
//   node v237c.js
//   :: rebuild APK
//
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const target = path.join(ROOT, 'app/(tabs)/discover.tsx');
const bakV237 = target + '.bak_v237';
const bakV237b = target + '.bak_v237b';

if (!fs.existsSync(target)) {
  console.error('[ERR] discover.tsx not found at ' + target);
  process.exit(1);
}

// Prefer .bak_v237 (truly pristine), fall back to .bak_v237b
let src = null;
if (fs.existsSync(bakV237)) {
  src = bakV237;
  console.log('[info] using .bak_v237 (pre-v237 original)');
} else if (fs.existsSync(bakV237b)) {
  src = bakV237b;
  console.log('[warn] .bak_v237 missing, using .bak_v237b (may still be patched)');
} else {
  console.error('[ERR] No backup found. Cannot rollback.');
  console.error('       Looked for: ' + bakV237);
  console.error('                   ' + bakV237b);
  process.exit(1);
}

// Save current (crashed) state for forensics, then restore
const current = fs.readFileSync(target, 'utf8');
fs.writeFileSync(target + '.crashed_v237b', current, 'utf8');

const restored = fs.readFileSync(src, 'utf8');
fs.writeFileSync(target, restored, 'utf8');

// Verify markers are gone
const hasMarker = restored.includes('// v237 see all') || restored.includes('_v237_useRowCap');
if (hasMarker) {
  console.log('[warn] restored file still contains v237 markers — backup was already polluted.');
  console.log('       You may need to git checkout app/(tabs)/discover.tsx manually.');
} else {
  console.log('[ok]   discover.tsx restored to pristine pre-v237 state');
}

console.log('');
console.log('Saved crashed copy at: ' + target + '.crashed_v237b');
console.log('');
console.log('Now rebuild APK + sideload.');
console.log('');
console.log('Expected after install:');
console.log('  - Discover loads without crashing');
console.log('  - Firestick cache-buster still active (it is in details/[type]/[id].tsx, untouched)');
console.log('  - No See All grid yet — we will redo that safely later.');
