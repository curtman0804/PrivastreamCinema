/**
 * apply_patches_v72d.js — shrink X clear button focus outline to match posters.
 *
 * v72c put a chunky gold-fill + 1.2x scale on the X button. User wants the
 * exact same selector style as the posters: a thin (2px) gold border with
 * no fill and no scale.
 *
 * Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v72d.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v72d.js
 *   node apply_patches_v72d.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'SearchBar.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V72D_CLEAR_OUTLINE')) {
  console.log('[OK] v72d already applied.');
  process.exit(0);
}

const bak = `${TARGET}.bak.v72d.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

// 1. Replace clearButtonFocused style (gold fill + scale -> thin gold border)
const styleRe = /\/\*\s*PATCH_V72_CLEAR_FOCUS style\s*\*\/\s*clearButtonFocused:\s*\{[\s\S]*?\n\s*\},/;
if (!styleRe.test(src)) {
  console.error('[FAIL] clearButtonFocused style block not found');
  fs.writeFileSync(TARGET, src);
  process.exit(2);
}
src = src.replace(styleRe,
`/* PATCH_V72D_CLEAR_OUTLINE — thin gold border, matches poster selector */
  clearButtonFocused: {
    borderWidth: 2,
    borderColor: '#B8A05C',
    borderRadius: 14,
  },`
);

// 2. The clearButton needs an invisible border baseline so the size doesn't
//    jump when the border appears on focus. Add borderWidth:2 borderColor:transparent.
const baseRe = /clearButton:\s*\{\s*padding:\s*4\s*\},/;
if (baseRe.test(src)) {
  src = src.replace(baseRe,
`clearButton: {
    padding: 4,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 14,
  },`
  );
} else {
  console.warn('[warn] clearButton base style not in expected form; left as-is');
}

// 3. Revert the icon size from 24 back to 20 so it doesn't dominate
src = src.replace(
  /<Ionicons name="close-circle" size=\{24\} color=\{clearFocused \? '#000000' : '#888888'\} \/>/,
  `<Ionicons name="close-circle" size={20} color={clearFocused ? '#B8A05C' : '#888888'} />`
);

fs.writeFileSync(TARGET, src);

console.log('[ok] clearButton outline now matches the poster selector (thin gold border)');
console.log('');
console.log(' Rebuild now.');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
