// apply_patches_v121m_play_overlay.js
//
// Adds a proper loading screen when the user taps Play:
//   - Reuses the existing AutoPlayOverlay (backdrop image + movie/series
//     title + animated loading bar)
//   - For MOVIES: hides the "S1 E2" line and the episode-title line
//   - For SERIES: keeps everything as-is
//   - Auto-clears via a 15s safety timeout in case navigation doesn't happen
//
// DO NOT run apply_patches_v121l_clean_loading.js - use this instead.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121m_play_overlay.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v121m-play-overlay';

function die(msg) { console.error('[v121m] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121m] already applied - nothing to do.');
  process.exit(0);
}

// Defensive: if v121l was applied, revert its overlay JSX + state first.
if (src.includes('v121l-clean-loading')) {
  console.log('[v121m] removing previous v121l fragments...');
  src = src.replace(/\n\s*\/\/ v121l-clean-loading:[^\n]*\n\s*const \[isPlayLoading, setIsPlayLoading\] = useState\(false\);\n\s*\/\/ Clear[^\n]*\n\s*useEffect\(\(\) => \{[\s\S]*?\}, \[isPlayLoading\]\);/, '');
  src = src.replace(/\s*\/\* v121l-clean-loading \*\/\n\s*setIsPlayLoading\(true\);\n/, '\n');
  src = src.replace(/\{\/\* v121l-clean-loading[\s\S]*?<\/View>\s*\)\}\n\s*/, '');
}

// 1) Add isPlayLoading state right after autoPlayTriggeredRef.
const stateAnchor = /const\s+autoPlayTriggeredRef\s*=\s*useRef\(false\);/;
if (!stateAnchor.test(src)) die('could not find autoPlayTriggeredRef anchor.');

src = src.replace(
  stateAnchor,
  "const autoPlayTriggeredRef = useRef(false);\n" +
  "  // v121m-play-overlay: movie-aware Play loading overlay\n" +
  "  const [isPlayLoading, setIsPlayLoading] = useState(false);\n" +
  "  useEffect(() => {\n" +
  "    if (!isPlayLoading) return;\n" +
  "    // Safety net: clear after 15s if navigation didn't fire\n" +
  "    const _t = setTimeout(() => setIsPlayLoading(false), 15000);\n" +
  "    return () => clearTimeout(_t);\n" +
  "  }, [isPlayLoading]);"
);

// 2) Set isPlayLoading(true) at the top of the Play button onPress.
const setterAnchor = /(\/\* v121d-play-wait \*\/)/;
if (!setterAnchor.test(src)) die('could not find v121d-play-wait marker.');

src = src.replace(
  setterAnchor,
  "/* v121m-play-overlay */\n" +
  "                      setIsPlayLoading(true);\n" +
  "                      $1"
);

// 3) Extend the autoPlayOverlay outer condition to also fire on isPlayLoading.
const outerCondAnchor = /\{autoPlayParam === 'true' && !autoPlayTriggeredRef\.current && \(/;
if (!outerCondAnchor.test(src)) die('could not find autoPlayOverlay outer anchor.');

src = src.replace(
  outerCondAnchor,
  "{/* v121m-play-overlay: also fires on isPlayLoading */}\n" +
  "      {((autoPlayParam === 'true' && !autoPlayTriggeredRef.current) || isPlayLoading) && ("
);

// 4) Hide the episode-title <Text> when type === 'movie'.
const epTitleRe = /<Text style=\{\{ color: '#FFF', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 6 \}\}>\s*\{nextTitleParam \? String\(nextTitleParam\) : \(currentEpisode\?\.name \|\| `Episode \$\{episodeNumber\}`\)\}\s*<\/Text>/;
if (!epTitleRe.test(src)) die('could not find episode-title Text anchor.');

src = src.replace(
  epTitleRe,
  "{type === 'series' && (\n" +
  "              <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>\n" +
  "                {nextTitleParam ? String(nextTitleParam) : (currentEpisode?.name || `Episode ${episodeNumber}`)}\n" +
  "              </Text>\n" +
  "            )}"
);

// 5) Hide the "S{x} E{y}" <Text> when type === 'movie'.
const seRe = /<Text style=\{\{ color: '#B8A05C', fontSize: 14, fontWeight: '600', marginBottom: 36, letterSpacing: 1 \}\}>\s*S\{episodeSeason\} E\{episodeNumber\}\s*<\/Text>/;
if (!seRe.test(src)) die('could not find S/E Text anchor.');

src = src.replace(
  seRe,
  "{type === 'series' && (\n" +
  "              <Text style={{ color: '#B8A05C', fontSize: 14, fontWeight: '600', marginBottom: 36, letterSpacing: 1 }}>\n" +
  "                S{episodeSeason} E{episodeNumber}\n" +
  "              </Text>\n" +
  "            )}"
);

// 6) Replace the "Loading next episode..." text with movie-aware copy.
const loadingTextRe = /Loading next episode\.\.\./;
if (!loadingTextRe.test(src)) die('could not find loading text anchor.');

src = src.replace(
  loadingTextRe,
  "${type === 'movie' ? 'Loading...' : 'Loading next episode...'}"
);
// The above is a TS template literal substitution context but the Text node
// is plain JSX text. Fix it properly by wrapping with curly braces.
src = src.replace(
  /<Text style=\{\{ color: '#CCC', fontSize: 13, marginTop: 14, fontWeight: '500' \}\}>\s*\$\{type === 'movie' \? 'Loading\.\.\.' : 'Loading next episode\.\.\.'\}\s*<\/Text>/,
  "<Text style={{ color: '#CCC', fontSize: 13, marginTop: 14, fontWeight: '500' }}>\n" +
  "              {type === 'movie' ? 'Loading...' : 'Loading next episode...'}\n" +
  "            </Text>"
);

const bak = TARGET + '.bak.v121m';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121m] patched ' + TARGET);
console.log('[v121m] backup: ' + bak);
console.log('[v121m] OK - rebuild and sideload.');
