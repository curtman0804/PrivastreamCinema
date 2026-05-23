/**
 * apply_patches_v72e.js — match search button focus outline to the X button.
 *
 * Removes the fat white outer ring + dark-gold background + 1.15x scale.
 * Replaces with a clean thin 2px white border, same proportions as the X.
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'SearchBar.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V72E_SEARCH_OUTLINE')) {
  console.log('[OK] v72e already applied.');
  process.exit(0);
}

const bak = `${TARGET}.bak.v72e.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

// Replace the searchButtonFocused style — match X button (thin border, no scale, no fill change)
const re = /searchButtonFocused:\s*\{[\s\S]*?\n\s*\},/;
if (!re.test(src)) {
  console.error('[FAIL] searchButtonFocused style block not found');
  fs.writeFileSync(TARGET, src);
  process.exit(2);
}
src = src.replace(re,
`/* PATCH_V72E_SEARCH_OUTLINE — thin white border, matches X button */
  searchButtonFocused: {
    borderColor: '#FFFFFF',
    borderWidth: 2,
  },`
);

fs.writeFileSync(TARGET, src);

console.log('[ok] search button focus now matches X button (thin white border)');
console.log('');
console.log(' Rebuild now.');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
