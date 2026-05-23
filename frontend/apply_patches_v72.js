/**
 * apply_patches_v72.js — Patch B: Search UX.
 *
 * Four surgical fixes (idempotent, anchored, auto-rollback):
 *
 *   1. PATCH_V72_KEYBOARD_DISMISS
 *      SearchBar.tsx: handleSubmit now calls Keyboard.dismiss() AND
 *      blurs the input. blurOnSubmit flipped to true so the IME tucks
 *      itself away after the user hits search.
 *
 *   2. PATCH_V72_CLEAR_FOCUS
 *      SearchBar.tsx: the X (clear) button now uses a Pressable style
 *      callback with a visible focused state (gold background + white
 *      ring) so it lights up under TV D-pad focus.
 *
 *   3. PATCH_V72_SEARCH_FOCUS_BOLD
 *      SearchBar.tsx: the magnifying-glass search button's focused
 *      style gets a much thicker white outer ring + darker gold
 *      background so it's obvious at TV viewing distance.
 *
 *   4. PATCH_V72_SEARCH_CAP_100
 *      contentStore.ts: the search() and loadMoreSearch() limit
 *      bumps from 30 to 100, so genre clicks and queries show ~3x
 *      more results before the user has to scroll further.
 *
 * Run on Windows:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v72.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v72.js
 *   node apply_patches_v72.js
 */
const fs = require('fs');
const path = require('path');

const SEARCHBAR = path.join(__dirname, 'src', 'components', 'SearchBar.tsx');
const STORE     = path.join(__dirname, 'src', 'store',      'contentStore.ts');

for (const p of [SEARCHBAR, STORE]) {
  if (!fs.existsSync(p)) {
    console.error('[FAIL] not found:', p);
    process.exit(1);
  }
}
console.log('[ok] targets exist');

// ─────────────────────────────────────────────────────────────────────
// FILE 1: SearchBar.tsx
// ─────────────────────────────────────────────────────────────────────
let sb = fs.readFileSync(SEARCHBAR, 'utf8');

if (sb.includes('PATCH_V72_KEYBOARD_DISMISS')) {
  console.log('[OK] SearchBar.tsx already v72.');
} else {
  const sbBak = `${SEARCHBAR}.bak.v72.${Date.now()}`;
  fs.writeFileSync(sbBak, sb);
  console.log(`[ok] SearchBar backup -> ${sbBak}`);

  const sbSteps = [];
  function sbStep(name, fn) {
    const before = sb;
    fn();
    if (sb === before) {
      console.error(`[FAIL] SearchBar step "${name}" made no change.`);
      fs.writeFileSync(SEARCHBAR, before);
      process.exit(2);
    }
    sbSteps.push(name);
    console.log(`[ok] SearchBar: ${name}`);
  }

  // 1. Add Keyboard to react-native imports
  sbStep('add-keyboard-import', () => {
    const re = /import\s*\{\s*([^}]*)\s*\}\s*from\s*'react-native';/;
    if (!re.test(sb)) throw new Error('react-native import not found');
    sb = sb.replace(re, (full, inside) => {
      if (inside.includes('Keyboard')) return full;
      return `import { ${inside.trim()}, Keyboard } from 'react-native';`;
    });
  });

  // 2. Replace handleSubmit body to also dismiss keyboard + blur
  sbStep('replace-handleSubmit', () => {
    const re = /const handleSubmit = \(\) => \{\s*if \(query\.trim\(\)\) onSearch\(query\.trim\(\)\);\s*\};/;
    if (!re.test(sb)) throw new Error('handleSubmit pattern not found');
    sb = sb.replace(re,
`const handleSubmit = () => {
    // PATCH_V72_KEYBOARD_DISMISS — submit, then explicitly dismiss IME and blur input.
    if (query.trim()) onSearch(query.trim());
    try { inputRef.current?.blur(); } catch (_) {}
    try { Keyboard.dismiss(); } catch (_) {}
  };`
    );
  });

  // 3. Flip blurOnSubmit={false} -> blurOnSubmit={true}
  sbStep('flip-blurOnSubmit', () => {
    const re = /blurOnSubmit=\{false\}/;
    if (!re.test(sb)) throw new Error('blurOnSubmit={false} not found');
    sb = sb.replace(re, 'blurOnSubmit={true} /* PATCH_V72_KEYBOARD_DISMISS */');
  });

  // 4. Replace the X (clear) button with a focus-visible version
  sbStep('replace-clear-button', () => {
    const re = /\{query\.length\s*>\s*0\s*&&\s*\(\s*<Pressable\s+onPress=\{handleClear\}\s+style=\{styles\.clearButton\}\s*>[\s\S]*?<\/Pressable>\s*\)\}/;
    if (!re.test(sb)) throw new Error('clear-button block not found');
    sb = sb.replace(re,
`{query.length > 0 && (
          /* PATCH_V72_CLEAR_FOCUS — visible focused state on TV */
          <Pressable
            onPress={handleClear}
            style={({focused}) => [styles.clearButton, focused && styles.clearButtonFocused]}
          >
            {({focused}) => (
              <Ionicons name="close-circle" size={22} color={focused ? '#000000' : '#888888'} />
            )}
          </Pressable>
        )}`
    );
  });

  // 5. Replace the search button to make focused state more prominent
  sbStep('replace-search-button', () => {
    const re = /\{\/\* Explicit search button[\s\S]*?<\/Pressable>/;
    if (!re.test(sb)) throw new Error('search-button block not found');
    sb = sb.replace(re,
`{/* Explicit search button — PATCH_V72_SEARCH_FOCUS_BOLD */}
      <Pressable
        onPress={handleSubmit}
        style={({focused}) => [
          styles.searchButton,
          focused && styles.searchButtonFocused
        ]}
      >
        {({focused}) => (
          <Ionicons name="search" size={22} color={focused ? '#FFFFFF' : '#000'} />
        )}
      </Pressable>`
    );
  });

  // 6. Update styles: add clearButtonFocused + beef up searchButtonFocused
  sbStep('update-styles', () => {
    // Match the searchButtonFocused block including its nested {} from transform
    const re = /searchButtonFocused:\s*\{[\s\S]*?\n\s*\},/;
    if (!re.test(sb)) throw new Error('searchButtonFocused style block not found');
    sb = sb.replace(re,
`searchButtonFocused: {
    backgroundColor: '#8B7440',
    borderColor: '#FFFFFF',
    borderWidth: 4,
    transform: [{ scale: 1.15 }],
  },
  /* PATCH_V72_CLEAR_FOCUS style */
  clearButtonFocused: {
    backgroundColor: '#B8A05C',
    borderRadius: 14,
    transform: [{ scale: 1.2 }],
  },`
    );
  });

  fs.writeFileSync(SEARCHBAR, sb);
  console.log(`[ok] SearchBar.tsx written (${sbSteps.length} steps)`);
}

// ─────────────────────────────────────────────────────────────────────
// FILE 2: contentStore.ts
// ─────────────────────────────────────────────────────────────────────
let st = fs.readFileSync(STORE, 'utf8');

if (st.includes('PATCH_V72_SEARCH_CAP_100')) {
  console.log('[OK] contentStore.ts already v72.');
} else {
  const stBak = `${STORE}.bak.v72.${Date.now()}`;
  fs.writeFileSync(stBak, st);
  console.log(`[ok] contentStore backup -> ${stBak}`);

  // Replace `api.content.search(query, 0, 30)` -> 100
  let count = 0;
  st = st.replace(
    /api\.content\.search\((\s*\w+\s*),\s*(\w+)\s*,\s*30\s*\)/g,
    (m, a, b) => { count++; return `api.content.search(${a}, ${b}, 100)`; }
  );

  // Replace `searchSkip: 30,` -> 100
  st = st.replace(/searchSkip:\s*30,/g, (m) => { count++; return 'searchSkip: 100,'; });

  // Replace `searchSkip + 30` -> +100
  st = st.replace(/searchSkip\s*\+\s*30/g, (m) => { count++; return 'searchSkip + 100'; });

  if (count === 0) {
    console.error('[FAIL] no 30-cap patterns found in contentStore.ts');
    fs.writeFileSync(STORE, fs.readFileSync(stBak));
    process.exit(2);
  }

  // Add sentinel comment near top
  st = st.replace(
    /(import\s*\{\s*create\s*\}\s*from\s*'zustand';)/,
    `// PATCH_V72_SEARCH_CAP_100 — search page-size bumped 30 -> 100\n$1`
  );

  fs.writeFileSync(STORE, st);
  console.log(`[ok] contentStore.ts written (${count} replacements)`);
}

console.log('');
console.log('===================================================================');
console.log(' V72 APPLIED — Patch B complete.');
console.log('===================================================================');
console.log(' Expected after rebuild:');
console.log('   - Press SEARCH on the IME -> keyboard tucks away');
console.log('   - X clear button -> visible gold-filled state on focus');
console.log('   - Magnifying-glass button -> bold white ring + scale on focus');
console.log('   - Search results / genre clicks -> 100 per page instead of 30');
console.log('');
console.log(' Voice mic was NOT included — that needs a native speech module.');
console.log(' Ask for it as a separate patch if you still want it.');
console.log('');
