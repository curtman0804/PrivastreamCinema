// apply_patches_v122_search_focus.js
//
// Fixes invisible focus selector on the X (clear) and search buttons in
// SearchBar.tsx. The Pressable `{focused}` destructure prop isn't reliable
// on Android TV / Firestick - we need explicit onFocus/onBlur state hooks.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v122_search_focus.js

const fs = require('fs');
const path = require('path');

// SearchBar.tsx could live in /components or /src/components - find it.
const candidates = [
  path.join('components', 'SearchBar.tsx'),
  path.join('src', 'components', 'SearchBar.tsx'),
  path.join('src', 'SearchBar.tsx'),
  'SearchBar.tsx',
];
let TARGET = null;
for (const c of candidates) {
  if (fs.existsSync(c)) { TARGET = c; break; }
}
if (!TARGET) {
  console.error('[v122] FAIL: cannot find SearchBar.tsx. Searched:');
  for (const c of candidates) console.error('   - ' + c);
  process.exit(1);
}

const MARKER = 'v122-search-focus';

function die(msg) { console.error('[v122] FAIL: ' + msg); process.exit(1); }

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v122] already applied to ' + TARGET);
  process.exit(0);
}

// 1) Add useState hooks for focus tracking right after the existing query
// useState. Anchor on the existing query state line.
const stateAnchor = /(const \[query, setQuery\] = useState\(initialValue\);)/;
if (!stateAnchor.test(src)) die('could not find query useState anchor.');

src = src.replace(
  stateAnchor,
  "$1\n" +
  "  // v122-search-focus: track focus for TV remote selector visibility\n" +
  "  const [isClearFocused, setIsClearFocused] = useState(false);\n" +
  "  const [isSearchFocused, setIsSearchFocused] = useState(false);"
);

// 2) Replace the clear (X) Pressable with focus-tracked version.
const clearRe = /<Pressable onPress=\{handleClear\} style=\{styles\.clearButton\}>\s*[\r\n]+\s*<Ionicons name="close-circle" size=\{20\} color="#888888" \/>\s*[\r\n]+\s*<\/Pressable>/;
if (!clearRe.test(src)) die('could not find clear Pressable anchor.');

src = src.replace(
  clearRe,
  "<Pressable\n" +
  "            onPress={handleClear}\n" +
  "            onFocus={() => setIsClearFocused(true)}\n" +
  "            onBlur={() => setIsClearFocused(false)}\n" +
  "            style={[styles.clearButton, isClearFocused && styles.clearButtonFocused]}\n" +
  "          >\n" +
  "            <Ionicons name=\"close-circle\" size={22} color={isClearFocused ? '#FFFFFF' : '#888888'} />\n" +
  "          </Pressable>"
);

// 3) Replace the search Pressable with focus-tracked version.
const searchRe = /<Pressable\s*[\r\n]+\s*onPress=\{handleSubmit\}\s*[\r\n]+\s*style=\{\(\{focused\}\) => \[\s*[\r\n]+\s*styles\.searchButton,\s*[\r\n]+\s*focused && styles\.searchButtonFocused\s*[\r\n]+\s*\]\}\s*[\r\n]+\s*>\s*[\r\n]+\s*<Ionicons name="search" size=\{20\} color="#000" \/>\s*[\r\n]+\s*<\/Pressable>/;
if (!searchRe.test(src)) die('could not find search Pressable anchor.');

src = src.replace(
  searchRe,
  "<Pressable\n" +
  "        onPress={handleSubmit}\n" +
  "        onFocus={() => setIsSearchFocused(true)}\n" +
  "        onBlur={() => setIsSearchFocused(false)}\n" +
  "        style={[styles.searchButton, isSearchFocused && styles.searchButtonFocused]}\n" +
  "      >\n" +
  "        <Ionicons name=\"search\" size={20} color=\"#000\" />\n" +
  "      </Pressable>"
);

// 4) Add clearButtonFocused style to the stylesheet. Anchor accepts
// single-line `clearButton: { padding: 4 },` and multi-line variants.
const clearStyleRe = /clearButton:\s*\{[^}]*padding:\s*\d+[^}]*\}\s*,/;
if (!clearStyleRe.test(src)) die('could not find clearButton style anchor.');

src = src.replace(
  clearStyleRe,
  "clearButton: {\n" +
  "    padding: 6,\n" +
  "    borderRadius: 16,\n" +
  "    borderWidth: 2,\n" +
  "    borderColor: 'transparent',\n" +
  "  },\n" +
  "  clearButtonFocused: {\n" +
  "    /* v122-search-focus */\n" +
  "    borderColor: '#FFFFFF',\n" +
  "    backgroundColor: 'rgba(255,255,255,0.15)',\n" +
  "    transform: [{ scale: 1.15 }],\n" +
  "  },"
);

const bak = TARGET + '.bak.v122';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v122] patched ' + TARGET);
console.log('[v122] backup: ' + bak);
console.log('[v122] OK - rebuild and sideload.');
