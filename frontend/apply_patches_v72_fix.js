/**
 * apply_patches_v72_fix.js — Fix the double-comma bug from v72.
 *
 * v72's add-keyboard-import step left "Platform,, Keyboard" because it
 * appended ", Keyboard" without stripping the trailing comma from the
 * existing import body. This script just collapses the double comma.
 *
 * Run:
 *   node apply_patches_v72_fix.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'SearchBar.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');

const bak = `${TARGET}.bak.v72fix.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

// Match ",," with optional whitespace between (covers ",  ,") in react-native import
// Specifically target the broken `Platform,, Keyboard` (or any `, ,`) before `} from 'react-native'`
const before = src;
let changes = 0;

// Collapse `,,` -> `,` (handles `Platform,, Keyboard`)
src = src.replace(/,(\s*),/g, (m, ws) => {
  changes++;
  return `,${ws}`;
});

if (changes === 0) {
  console.error('[FAIL] no double-comma found to fix.');
  console.error('       If your build still fails, paste the top 15 lines of SearchBar.tsx and I will look.');
  fs.writeFileSync(TARGET, before);
  process.exit(2);
}

fs.writeFileSync(TARGET, src);

console.log(`[ok] collapsed ${changes} double-comma occurrence(s)`);
console.log('');
console.log(' Rebuild now — the broken import is corrected.');
console.log('');
console.log(' ROLLBACK if needed:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
