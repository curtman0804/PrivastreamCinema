// apply_patches_v124l_stack_collapse.js
//
// v124l - properly collapse the binge stack.
//
// v124k's BackHandler did router.replace(seriesRoot), which only swaps the
// CURRENT top entry. After binge-watching, prior episode pages of the same
// series are still in the stack underneath, so the next Back press pops to
// the previous episode page instead of leaving the series.
//
// This patch rewrites the v124k handler to:
//   1. Read the current navigation state.
//   2. Count consecutive same-series episode-page entries at the top of the
//      stack (entries whose id starts with "<seriesId>:").
//   3. If the actual series root ("<seriesId>" with no ":") exists below
//      that chain, StackActions.pop(N) to land directly on it.
//   4. Otherwise fall back to router.replace(seriesRoot) (single-page case).
//
// Also adds StackActions to the existing @react-navigation/native import.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124l_stack_collapse.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124l-stack-collapse';

function die(msg) { console.error('[v124l] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124l] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// 1) Ensure StackActions is imported from @react-navigation/native.
// =========================================================================
if (!/StackActions/.test(src)) {
  const importRe = /import\s*\{\s*useNavigation\s*,\s*CommonActions\s*\}\s*from\s*'@react-navigation\/native';/;
  if (!importRe.test(src)) die("cannot find @react-navigation/native import line");
  src = src.replace(
    importRe,
    "import { useNavigation, CommonActions, StackActions } from '@react-navigation/native';"
  );
  info('added StackActions to navigation import');
} else {
  info('StackActions already imported');
}

// =========================================================================
// 2) Replace the v124k BackHandler block with the v124l collapsing version.
// =========================================================================
const startKey = '// v124k-back-unified: single BackHandler';
const startIdx = src.indexOf(startKey);
if (startIdx === -1) die('cannot find v124k handler block - did v124k apply?');

// End of the block is the deps array "}, [id, type, router]);"
const endKey = '}, [id, type, router]);';
const endIdx = src.indexOf(endKey, startIdx);
if (endIdx === -1) die('cannot find v124k deps closer "}, [id, type, router]);"');
const blockEnd = endIdx + endKey.length;

const NEW_BLOCK =
"// v124l-stack-collapse: single BackHandler for the details/episode page.\n" +
"  //\n" +
"  // Episode page (id contains \":\")  ->  pop ALL same-series episode-page\n" +
"  //   entries off the stack so we land on the actual series root that\n" +
"  //   already exists below them. This handles binge-watching where the\n" +
"  //   stack has accumulated multiple episode pages.\n" +
"  // Series root or movie page          ->  router.back().\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124l] mount isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          // Inspect nav stack to find how many episode-page entries of this\n" +
"          // series are stacked at the top and whether series root is below.\n" +
"          let popCount = 0;\n" +
"          let foundRoot = false;\n" +
"          try {\n" +
"            const state = navigation.getState && navigation.getState();\n" +
"            const routes = (state && state.routes) || [];\n" +
"            for (let i = routes.length - 1; i >= 0; i--) {\n" +
"              const rid = String((routes[i] && routes[i].params && routes[i].params.id) || '');\n" +
"              if (!rid) break;\n" +
"              if (rid === seriesRootId) { foundRoot = true; break; }\n" +
"              if (rid.split(':')[0] === seriesRootId) { popCount++; continue; }\n" +
"              break;\n" +
"            }\n" +
"            console.log('[BACK v124l] hwBack popCount=' + popCount + ' foundRoot=' + foundRoot + ' totalRoutes=' + routes.length);\n" +
"          } catch (e) {\n" +
"            console.log('[BACK v124l] state-inspect error', e);\n" +
"          }\n" +
"          if (foundRoot && popCount > 0) {\n" +
"            try {\n" +
"              navigation.dispatch(StackActions.pop(popCount));\n" +
"              return true;\n" +
"            } catch (e) {\n" +
"              console.log('[BACK v124l] StackActions.pop failed', e);\n" +
"            }\n" +
"          }\n" +
"          // Fallback: single-page case OR no root in stack.\n" +
"          router.replace({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124l] error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router, navigation]);";

src = src.slice(0, startIdx) + NEW_BLOCK + src.slice(blockEnd);
info('replaced v124k handler with v124l stack-collapse handler');

// =========================================================================
// 3) Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124l';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
