/* eslint-disable */
// apply_patches_v54c.js — Add getItemType to outer FlashList so heterogeneous
// items (Continue Watching vs ServiceRow) recycle into correct cell types.
//
// SYMPTOM (before this fix): Netflix Series row shows USA TV posters,
// movies appear under series titles, etc. Caused by FlashList recycling
// without knowing cell types differ.
//
// FIX: Pass `getItemType` prop. FlashList then maintains separate
// recycle pools per type, eliminating the jumbling.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const hadCRLF = raw.indexOf('\r\n') >= 0;
let src = raw.replace(/\r\n/g, '\n');

if (src.includes('PATCH_V54C_GETITEMTYPE')) {
  console.log('[OK] V54c already applied.');
  process.exit(0);
}

const old1 = `          keyExtractor={(it: any) => it.key}
          estimatedItemSize={260}`;
const new1 = `          keyExtractor={(it: any) => it.key}
          getItemType={(it: any) => it.kind} // PATCH_V54C_GETITEMTYPE — separates recycle pools per cell type
          estimatedItemSize={260}`;

if (!src.includes(old1)) {
  console.log('[FAIL] anchor not found — V54c NOT applied.');
  console.log('       Looking for:');
  console.log('         keyExtractor={(it: any) => it.key}');
  console.log('         estimatedItemSize={260}');
  process.exit(1);
}

src = src.replace(old1, new1);

const bak = F + '.bak.v54c.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('  [OK]   added getItemType to outer FlashList');
console.log('');
console.log('========================================');
console.log('V54c done. Rebuild → sideload → force-stop → relaunch.');
console.log('Posters should now match their row titles correctly.');
console.log('========================================');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V54C" frontend\\\\app\\\\(tabs)\\\\discover.tsx');
