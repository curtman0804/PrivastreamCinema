// apply_patches_v124o_onscreen_back.js
//
// v124o - fix the ON-SCREEN back button.
//
// The user's logs proved the hardware back handler never fires - they're
// pressing the on-screen back button which is wired to handleBack() at
// line ~550 of details/[type]/[id].tsx. handleBack delegates to
// goToSeriesRootWithFocus() which uses router.replace - same broken behavior
// (only swaps top entry, leaving prior episode pages in the stack).
//
// This patch REWRITES goToSeriesRootWithFocus to use the pop-to-root logic
// from v124n: walk back from current entry, find the most recent series
// root in stack, StackActions.pop(N) everything above it.
//
// Adds [BACK-UI v124o] logging so the on-screen path is now visible in
// adb logcat too.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124o_onscreen_back.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124o-onscreen-back';

function die(msg) { console.error('[v124o] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124o] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// Ensure StackActions is imported.
if (!/StackActions/.test(src)) {
  const importRe = /import\s*\{\s*useNavigation\s*,\s*CommonActions\s*\}\s*from\s*'@react-navigation\/native';/;
  if (importRe.test(src)) {
    src = src.replace(importRe, "import { useNavigation, CommonActions, StackActions } from '@react-navigation/native';");
    info('added StackActions import');
  } else {
    info('WARN: navigation import not in expected shape - assuming StackActions already present');
  }
}

// =========================================================================
// Find the goToSeriesRootWithFocus function definition.
// Anchor: "const goToSeriesRootWithFocus = useCallback("
// End: matching "}, [...]);" with id/type/router in deps
// =========================================================================
const fnAnchor = 'const goToSeriesRootWithFocus = useCallback(';
const fnStart = src.indexOf(fnAnchor);
if (fnStart === -1) die('cannot find goToSeriesRootWithFocus declaration');

// Find the matching closing "}, [id, type, router, navigation]);" after fnStart.
const possibleEnds = [
  '}, [id, type, router, navigation]);',
  '}, [id, type, router]);',
  '}, [type, id, router, navigation]);',
  '}, [type, id, router]);',
];
let fnEnd = -1, fnEndLen = 0;
for (const e of possibleEnds) {
  const i = src.indexOf(e, fnStart);
  if (i !== -1 && (fnEnd === -1 || i < fnEnd)) { fnEnd = i; fnEndLen = e.length; }
}
if (fnEnd === -1) die('cannot find end of goToSeriesRootWithFocus');
const fnBlockEnd = fnEnd + fnEndLen;

const oldFn = src.slice(fnStart, fnBlockEnd);
info('matched goToSeriesRootWithFocus, length=' + oldFn.length);

const newFn =
"const goToSeriesRootWithFocus = useCallback(() => {\n" +
"    // v124o-onscreen-back: pop-to-root for ON-SCREEN back button.\n" +
"    // Walks current nav stack, finds the most-recent series-root entry below\n" +
"    // the current top, pops everything above it via StackActions.pop. Works\n" +
"    // for binge: stack like\n" +
"    //   [..., RMroot, S1E1page, player_E1, S1E2page]\n" +
"    // pops 3 entries to land on RMroot.\n" +
"    const rawId = String(id || '');\n" +
"    if (type !== 'series' || !rawId.includes(':')) {\n" +
"      console.log('[BACK-UI v124o] not an episode page, no-op');\n" +
"      return false;\n" +
"    }\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK-UI v124o] fired rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    try {\n" +
"      const state = navigation.getState && navigation.getState();\n" +
"      const routes = (state && state.routes) || [];\n" +
"      const topIdx = (typeof state.index === 'number') ? state.index : routes.length - 1;\n" +
"      console.log('[BACK-UI v124o] routes=' + routes.length + ' topIdx=' + topIdx);\n" +
"      for (let i = 0; i < routes.length; i++) {\n" +
"        const r = routes[i] || {};\n" +
"        const rname = String(r.name || '');\n" +
"        const rid = String((r.params && r.params.id) || '');\n" +
"        console.log('[BACK-UI v124o]   [' + i + '] name=' + rname + ' id=' + rid);\n" +
"      }\n" +
"      let rootIdx = -1;\n" +
"      for (let i = topIdx - 1; i >= 0; i--) {\n" +
"        const rid = String((routes[i] && routes[i].params && routes[i].params.id) || '');\n" +
"        if (rid === seriesRootId) { rootIdx = i; break; }\n" +
"      }\n" +
"      console.log('[BACK-UI v124o] rootIdx=' + rootIdx);\n" +
"      if (rootIdx >= 0 && typeof StackActions !== 'undefined') {\n" +
"        const popCount = topIdx - rootIdx;\n" +
"        console.log('[BACK-UI v124o] popping ' + popCount);\n" +
"        if (popCount > 0) {\n" +
"          navigation.dispatch(StackActions.pop(popCount));\n" +
"          return true;\n" +
"        }\n" +
"      }\n" +
"    } catch (e) {\n" +
"      console.log('[BACK-UI v124o] state-inspect error', e);\n" +
"    }\n" +
"    // Fallback: series root not in history (deep-link) - replace.\n" +
"    console.log('[BACK-UI v124o] fallback router.replace');\n" +
"    try {\n" +
"      router.replace({\n" +
"        pathname: '/details/series/' + seriesRootId,\n" +
"        params: { focusS: sNum, focusE: eNum },\n" +
"      });\n" +
"      return true;\n" +
"    } catch (_) { return false; }\n" +
"  }, [id, type, router, navigation]);";

src = src.slice(0, fnStart) + newFn + src.slice(fnBlockEnd);
info('replaced goToSeriesRootWithFocus with v124o pop-to-root version');

// =========================================================================
// Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124o';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
