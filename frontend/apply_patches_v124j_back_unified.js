// apply_patches_v124j_back_unified.js
//
// Replaces BOTH existing BackHandler registrations in
// app/details/[type]/[id].tsx with a single unified one.
//
// Behavior:
//   - On an EPISODE page (id contains ":" → "<seriesId>:<S>:<E>"):
//       hardware Back  ->  router.replace('/details/series/<seriesId>', focusS, focusE)
//   - On a series-root or movie page:
//       hardware Back  ->  router.back()
//
// This makes binge-watching collapse into:
//   Player  -> Back -> Episode page  -> Back -> Series root
// regardless of how many episodes were watched.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124j_back_unified.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124j-back-unified';

function die(msg) { console.error('[v124j] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124j] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// 1) NUKE the OLD V34 BackHandler (lines ~554-567 area).
// Anchor: comment "PATCH_V34_DETAILS_BACK" through the useEffect that
// registers BackHandler with the goToSeriesRootWithFocus fallback.
// =========================================================================
{
  const startIdx = src.indexOf('PATCH_V34_DETAILS_BACK');
  if (startIdx === -1) {
    info('WARN: PATCH_V34_DETAILS_BACK marker not found - skipping V34 removal.');
  } else {
    // Walk backwards from startIdx to find the "useEffect((" that opens this block.
    const blockOpen = src.lastIndexOf('useEffect(() => {', startIdx);
    if (blockOpen === -1) die('cannot find useEffect open for V34 block');
    // Find the closing "}, [goToSeriesRootWithFocus]);" after startIdx.
    const closeKey = '}, [goToSeriesRootWithFocus]);';
    const closeIdx = src.indexOf(closeKey, startIdx);
    if (closeIdx === -1) die('cannot find V34 close pattern }, [goToSeriesRootWithFocus]);');
    const blockEnd = closeIdx + closeKey.length;
    // Also swallow optional trailing comment line "// ====...===" (line 568).
    let after = blockEnd;
    // Skip newline then optional comment-divider line.
    while (after < src.length && src[after] === '\n') after++;
    if (src.slice(after, after + 4) === '  //') {
      const lineEnd = src.indexOf('\n', after);
      if (lineEnd !== -1) after = lineEnd;
    }
    src = src.slice(0, blockOpen) + '/* v124j-back-unified: V34 BackHandler removed, replaced below */\n  ' + src.slice(after);
    info('removed V34 BackHandler block (' + (after - blockOpen) + ' bytes)');
  }
}

// =========================================================================
// 2) NUKE the v124h BackHandler that intercepts only on fromPlayer/autoPlay.
// Anchor: the deps array "[autoPlayParam, fromPlayerParam, type, baseId, episodeSeason, episodeNumber]"
// =========================================================================
{
  const depsKey = '[autoPlayParam, fromPlayerParam, type, baseId, episodeSeason, episodeNumber]';
  const depsIdx = src.indexOf(depsKey);
  if (depsIdx === -1) {
    info('WARN: v124h deps signature not found - skipping v124h removal.');
  } else {
    const blockOpen = src.lastIndexOf('useEffect(() => {', depsIdx);
    if (blockOpen === -1) die('cannot find useEffect open for v124h block');
    const closeIdx = src.indexOf(');', depsIdx);
    if (closeIdx === -1) die('cannot find close for v124h block');
    const blockEnd = closeIdx + 2;
    src = src.slice(0, blockOpen) + '/* v124j-back-unified: v124h BackHandler removed, replaced below */' + src.slice(blockEnd);
    info('removed v124h BackHandler block');
  }
}

// =========================================================================
// 3) INSERT the new unified BackHandler.
// Place it right after the destructuring of useLocalSearchParams params,
// or — simpler and safer — right before "return (" of the component.
// We'll inject just before the existing `useEffect(() => {` that watches
// `[content, library]` (a known stable anchor we just saw at line ~722).
// =========================================================================
{
  const anchor = 'useEffect(() => {\n    if (content && library) {';
  const ai = src.indexOf(anchor);
  if (ai === -1) die('cannot find content&&library useEffect anchor');

  const unified =
"  // v124j-back-unified: single BackHandler for the details/episode page.\n" +
"  //\n" +
"  //   /details/series/<seriesId>:<S>:<E>  (episode page)\n" +
"  //        hardware Back -> /details/series/<seriesId>?focusS=S&focusE=E\n" +
"  //   /details/series/<seriesId>          (series root, no \":\")\n" +
"  //   /details/movie/<id>                 (movie page)\n" +
"  //        hardware Back -> router.back()\n" +
"  //\n" +
"  // This single intercept replaces both the old V34 handler and the\n" +
"  // v124h fromPlayer-only handler. It does NOT depend on autoPlay or\n" +
"  // fromPlayer flags - it ALWAYS resolves an episode-page back to the\n" +
"  // series root, so binge-watching collapses to exactly two back presses.\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const seriesRootId = rawId.split(':')[0];\n" +
"    const parts = rawId.split(':');\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124j] mount  isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId + ' s=' + sNum + ' e=' + eNum);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        console.log('[BACK v124j] hwBack pressed  isEp=' + isEpisodePage + ' rootId=' + seriesRootId);\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          router.replace({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124j] error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router]);\n" +
"\n  ";

  src = src.slice(0, ai) + unified + src.slice(ai);
  info('inserted unified BackHandler');
}

// =========================================================================
// Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124j';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
