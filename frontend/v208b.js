// =============================================================================
// HOTFIX v208b — Fix v208 syntax error in discover.tsx (missing comma) and
//                update SearchBar placeholder text.
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v208b_hotfix.js -o v208b.js
//   node v208b.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c, 'utf8');
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = read(full);
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v208b', before, 'utf8');
  write(full, after);
  console.log('  [ok]   ' + label);
}

console.log('--- v208b hotfix ---');

// =============================================================================
// FIX 1 — Add the missing comma after v176kMeasureAnchor in the ContentCard
//         import.  v208's injection regex matched but produced two items on
//         the same line without a separator.
// =============================================================================
patch('discover — add missing comma to ContentCard import', 'app/(tabs)/discover.tsx', (src) => {
  let s = src;

  // Locate the import block that ends at `} from '../../src/components/ContentCard';`
  // and ensure every line that precedes a v208SetUpwardTarget line ends with `,`.
  s = s.replace(
    /\/\* V176K_POPOVER \*\/ V176kPopover, v176kMeasureAnchor\s*\n\s*v208SetUpwardTarget,/,
    `/* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor,
  v208SetUpwardTarget,`
  );

  return s;
});

// =============================================================================
// FIX 2 — SearchBar placeholder & search screen empty-state text update
// =============================================================================
patch('SearchBar — placeholder "You can search anything..."', 'src/components/SearchBar.tsx', (src) => {
  let s = src;
  s = s.replace(/Search movies\s*&\s*TV shows\.\.\./gi, 'You can search anything...');
  s = s.replace(/Search movies\s*&\s*TV shows/gi, 'You can search anything');
  s = s.replace(/placeholder=["']Search\.\.\.["']/g, 'placeholder="You can search anything..."');
  return s;
});

patch('search screen — empty-state copy', 'app/(tabs)/search.tsx', (src) => {
  let s = src;
  s = s.replace(/Search for movies\s*&\s*TV shows/gi, 'You can search anything');
  s = s.replace(/Find your favorite content/gi, 'Movies, series, actors, directors — try it');
  return s;
});

console.log('--- v208b hotfix complete ---');
console.log('Press r in Expo CLI.');
