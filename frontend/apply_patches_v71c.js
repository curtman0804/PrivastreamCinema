/**
 * apply_patches_v71c.js — Restore UP navigation from Discover/Profile tabs.
 *
 * v71b added nextFocusUp = self on edge tabs as a belt-and-suspenders for
 * diagonal-up escape. Now that nextFocusLeft/Right traps confirmed working,
 * that extra block is unnecessary and prevents legitimate UP navigation.
 *
 * v71c surgically removes the 2 lines that set nextFocusUp on first/last tabs.
 * LEFT trap on Discover stays. RIGHT trap on Profile stays. UP works again.
 *
 * Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v71c.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v71c.js
 *   node apply_patches_v71c.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'app', '(tabs)', '_layout.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}
console.log(`[ok] target: ${TARGET}`);

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V71C_UP_ENABLED')) {
  console.log('[OK] v71c already applied.');
  process.exit(0);
}

if (!src.includes('PATCH_V71B_TAB_FOCUS_TRAP')) {
  console.error('[FAIL] v71b not detected. Apply apply_patches_v71b.js first.');
  process.exit(3);
}

const bak = `${TARGET}.bak.v71c.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

const before = src;

// Remove BOTH nextFocusUp lines (tolerant to whitespace and the inline comment)
src = src.replace(
  /\n\s*trap\.nextFocusUp\s*=\s*selfTag;[^\n]*\n/g,
  '\n'
);

// Flip the sentinel so this patch is idempotent and v71c-detectable.
src = src.replace(
  /PATCH_V71B_TAB_FOCUS_TRAP - hardened trap with multi-source tag detection\./,
  'PATCH_V71B_TAB_FOCUS_TRAP - hardened trap with multi-source tag detection. (PATCH_V71C_UP_ENABLED)'
);

if (src === before) {
  console.error('[FAIL] no nextFocusUp lines found to remove');
  fs.writeFileSync(TARGET, before);
  process.exit(2);
}

fs.writeFileSync(TARGET, src);

console.log('[ok] removed nextFocusUp = selfTag from both edge tabs');
console.log('');
console.log('===================================================================');
console.log(' V71C APPLIED - UP navigation restored.');
console.log('===================================================================');
console.log(' Expected after rebuild:');
console.log('   - LEFT on Discover tab   -> stays on Discover (trap still active)');
console.log('   - RIGHT on Profile tab   -> stays on Profile (trap still active)');
console.log('   - UP from Discover tab   -> goes to posters above');
console.log('   - UP from Profile tab    -> goes to profile content above');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
