// apply_patches_v124n_pop_to_root.js
//
// v124n - find series root in stack, pop everything above it.
//
// v124l counted consecutive episode pages, but autoplay leaves /player
// routes interleaved, so the count stopped at popCount=1. v124m's reset
// also kept those non-binge entries above series root.
//
// v124n: scan backwards from the top of the stack, find the FIRST entry
// whose params.id === seriesRootId, then pop everything above it. That
// strips out:
//   - the current episode page
//   - any prior binge episode pages
//   - any leftover /player routes
//   - anything else that piled up after series root was last visited
//
// If series root isn't in history, fall back to router.replace.
//
// Heavy [BACK v124n] logging so adb logcat reveals the real stack.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124n_pop_to_root.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124n-pop-to-root';

function die(msg) { console.error('[v124n] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124n] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// Ensure StackActions is imported (v124l should have added it; double-check).
if (!/StackActions/.test(src)) {
  const importRe = /import\s*\{\s*useNavigation\s*,\s*CommonActions\s*\}\s*from\s*'@react-navigation\/native';/;
  if (importRe.test(src)) {
    src = src.replace(importRe, "import { useNavigation, CommonActions, StackActions } from '@react-navigation/native';");
    info('added StackActions to import');
  } else {
    info('WARN: navigation import line not in expected shape - StackActions may be missing');
  }
}

// Find a prior handler block (try v124m, v124l, v124k, v124j in order).
const startMarkers = [
  '// v124m-stack-reset: single BackHandler',
  '// v124l-stack-collapse: single BackHandler',
  '// v124k-back-unified: single BackHandler',
  '// v124j-back-unified: single BackHandler',
];
let startIdx = -1;
for (const m of startMarkers) {
  const i = src.indexOf(m);
  if (i !== -1) { startIdx = i; info('matched start marker: ' + m); break; }
}
if (startIdx === -1) die('cannot find any prior BackHandler block (v124j/k/l/m)');

const endKeys = [
  '}, [id, type, router, navigation]);',
  '}, [id, type, router]);',
];
let endIdx = -1, endLen = 0;
for (const k of endKeys) {
  const i = src.indexOf(k, startIdx);
  if (i !== -1) { endIdx = i; endLen = k.length; info('matched end key: ' + k); break; }
}
if (endIdx === -1) die('cannot find prior BackHandler block end (deps array)');
const blockEnd = endIdx + endLen;

const NEW =
"// v124n-pop-to-root: scan stack for series root, pop everything above it.\n" +
"  //\n" +
"  // Works for binge: stack may look like\n" +
"  //   [..., discover, RMroot, S1E1page, player_E1, S1E2page]\n" +
"  // We walk back from top, find RMroot at index 1, pop the 3 entries above.\n" +
"  // Final stack: [..., discover, RMroot]. One more back -> discover.\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124n] mount isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          let popped = false;\n" +
"          try {\n" +
"            const state = navigation.getState && navigation.getState();\n" +
"            const routes = (state && state.routes) || [];\n" +
"            console.log('[BACK v124n] hwBack routes=' + routes.length + ' index=' + (state && state.index));\n" +
"            for (let i = 0; i < routes.length; i++) {\n" +
"              const r = routes[i] || {};\n" +
"              const rname = String(r.name || '');\n" +
"              const rid = String((r.params && r.params.id) || '');\n" +
"              console.log('[BACK v124n]   [' + i + '] name=' + rname + ' id=' + rid);\n" +
"            }\n" +
"            // Find the most recent series-root entry below current top.\n" +
"            let rootIdx = -1;\n" +
"            const topIdx = (typeof state.index === 'number') ? state.index : routes.length - 1;\n" +
"            for (let i = topIdx - 1; i >= 0; i--) {\n" +
"              const rid = String((routes[i] && routes[i].params && routes[i].params.id) || '');\n" +
"              if (rid === seriesRootId) { rootIdx = i; break; }\n" +
"            }\n" +
"            console.log('[BACK v124n] rootIdx=' + rootIdx + ' topIdx=' + topIdx);\n" +
"            if (rootIdx >= 0) {\n" +
"              const popCount = topIdx - rootIdx;\n" +
"              console.log('[BACK v124n] popping ' + popCount + ' entries');\n" +
"              if (popCount > 0 && typeof StackActions !== 'undefined') {\n" +
"                navigation.dispatch(StackActions.pop(popCount));\n" +
"                popped = true;\n" +
"              }\n" +
"            }\n" +
"          } catch (e) {\n" +
"            console.log('[BACK v124n] state-inspect error', e);\n" +
"          }\n" +
"          if (popped) return true;\n" +
"          // Fallback: series root not in history (or pop failed) - replace.\n" +
"          console.log('[BACK v124n] fallback: router.replace to series root');\n" +
"          router.replace({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124n] outer error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router, navigation]);";

src = src.slice(0, startIdx) + NEW + src.slice(blockEnd);
info('replaced handler with v124n pop-to-root version');

const bak = DETAILS + '.bak.v124n';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
