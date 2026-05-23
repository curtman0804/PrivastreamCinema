/**
 * apply_patches_v72c.js — Fix invisible focus on X clear + search buttons.
 *
 * Root cause: Pressable's `style={({focused}) => …}` callback only fires on
 * tvOS. On Android TV (your Streamer 4K / Fire Stick) the `focused` argument
 * never becomes true, so the styles I added in v72 never applied.
 *
 * Fix: switch to onFocus/onBlur + useState (same pattern your existing
 * inputFocused state uses). The focused styles will now render properly
 * because the JS state actually changes when the D-pad lands on them.
 *
 * Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v72c.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v72c.js
 *   node apply_patches_v72c.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'SearchBar.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}
console.log(`[ok] target: ${TARGET}`);

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V72C_FOCUS_STATE')) {
  console.log('[OK] v72c already applied.');
  process.exit(0);
}

if (!src.includes('PATCH_V72_CLEAR_FOCUS')) {
  console.error('[FAIL] v72 not detected. Apply apply_patches_v72.js first.');
  process.exit(3);
}

const bak = `${TARGET}.bak.v72c.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

const steps = [];
function step(name, fn) {
  const before = src;
  fn();
  if (src === before) {
    console.error(`[FAIL] step "${name}" made no change.`);
    fs.writeFileSync(TARGET, before);
    process.exit(2);
  }
  steps.push(name);
  console.log(`[ok] ${name}`);
}

// ─── 1. Add focus state hooks near the existing inputFocused state ───
step('add-focus-state-hooks', () => {
  const re = /const \[inputFocused, setInputFocused\] = useState\(false\);/;
  if (!re.test(src)) throw new Error('inputFocused state declaration not found');
  src = src.replace(re,
`const [inputFocused, setInputFocused] = useState(false);
  // PATCH_V72C_FOCUS_STATE — Android TV needs onFocus/onBlur + state for visible focus.
  const [clearFocused, setClearFocused] = useState(false);
  const [searchBtnFocused, setSearchBtnFocused] = useState(false);`
  );
});

// ─── 2. Replace clear (X) button block with onFocus/onBlur version ───
step('rewrite-clear-button', () => {
  // Match the v72 clear-button block we previously injected
  const re = /\{query\.length\s*>\s*0\s*&&\s*\(\s*\/\*\s*PATCH_V72_CLEAR_FOCUS[\s\S]*?\<\/Pressable>\s*\)\}/;
  if (!re.test(src)) throw new Error('v72 clear-button block not found');
  src = src.replace(re,
`{query.length > 0 && (
          /* PATCH_V72C_FOCUS_STATE — Android TV onFocus/onBlur state */
          <Pressable
            onPress={handleClear}
            onFocus={() => setClearFocused(true)}
            onBlur={() => setClearFocused(false)}
            style={[styles.clearButton, clearFocused && styles.clearButtonFocused]}
          >
            <Ionicons name="close-circle" size={24} color={clearFocused ? '#000000' : '#888888'} />
          </Pressable>
        )}`
  );
});

// ─── 3. Replace search button block ───
step('rewrite-search-button', () => {
  const re = /\{\/\* Explicit search button[\s\S]*?<\/Pressable>/;
  if (!re.test(src)) throw new Error('search-button block not found');
  src = src.replace(re,
`{/* Explicit search button — PATCH_V72C_FOCUS_STATE */}
      <Pressable
        onPress={handleSubmit}
        onFocus={() => setSearchBtnFocused(true)}
        onBlur={() => setSearchBtnFocused(false)}
        style={[styles.searchButton, searchBtnFocused && styles.searchButtonFocused]}
      >
        <Ionicons name="search" size={22} color={searchBtnFocused ? '#FFFFFF' : '#000000'} />
      </Pressable>`
  );
});

// ─── 4. Persist ───
fs.writeFileSync(TARGET, src);

console.log('');
console.log('===================================================================');
console.log(` V72C APPLIED — ${steps.length} steps. Focus state now visible.`);
console.log('===================================================================');
console.log('');
console.log(' Expected after rebuild:');
console.log('   - D-pad to X clear button   -> gold background fills, icon turns black');
console.log('   - D-pad to magnifying glass -> darker gold + thick white ring + scale up');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
