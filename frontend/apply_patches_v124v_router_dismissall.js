// apply_patches_v124v_router_dismissall.js
//
// v124v - real fix for the binge back button.
//
// Two problems in the user's app/details/[type]/[id].tsx:
//
//   1) TEMPORAL DEAD ZONE on `router`. Line ~643 declares
//        const router = useRouter();
//      But `router` is used at lines ~561-570 INSIDE goToSeriesRootWithFocus
//      and the hardware BackHandler useCallback/useEffect. Metro coerces TDZ
//      to undefined in deps arrays, so React.useCallback sees router=undefined
//      and never invalidates the callback when the actual router instance
//      changes - stale closures.
//
//   2) StackActions.pop() doesn't work in Expo Router v6. The pop dispatches
//      are silently swallowed, so the "back to series root" logic falls
//      through to router.replace - which only swaps the current top, leaving
//      prior binge episode pages in the stack.
//
// Fix:
//   - Move `const router = useRouter();` ABOVE the back-button block.
//   - Remove the now-duplicate declaration at line ~643.
//   - Replace the StackActions.pop branch with `router.dismissAll()` followed
//     by `router.push('/details/series/<rootId>?focusS=&focusE=')`. This
//     wipes every pushed screen in the current navigator and re-pushes the
//     series root on a clean slate. Works regardless of how many episode
//     pages got pushed during binge.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124v_router_dismissall.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124v-router-dismissall';

function die(msg) { console.error('[v124v] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124v] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// STEP 1: Move `const router = useRouter();` ABOVE the back-button block.
//
// Anchor: the comment "// === ANDROID-TV BACK BUTTON FIX ==="
// Insert `const router = useRouter();` immediately before it (after a blank
// line so it reads cleanly).
// =========================================================================
const beforeBackComment = '  // === ANDROID-TV BACK BUTTON FIX =========================================';
if (src.indexOf(beforeBackComment) === -1) die('cannot find "ANDROID-TV BACK BUTTON FIX" comment');

if (src.indexOf('  const router = useRouter();\n\n  // === ANDROID-TV BACK BUTTON FIX') === -1) {
  src = src.replace(
    beforeBackComment,
    "  const router = useRouter();\n\n" + beforeBackComment
  );
  info('inserted const router = useRouter() before back-button block');
} else {
  info('router already moved above back-button block');
}

// Remove the OLD declaration at ~line 643. It should be the second occurrence
// of `const router = useRouter();` in the file at this point.
{
  const re = /const router = useRouter\(\);/g;
  const matches = [];
  let m;
  while ((m = re.exec(src)) !== null) matches.push(m.index);
  if (matches.length >= 2) {
    // Remove the SECOND occurrence (and the surrounding "  " indent + newline).
    const secondIdx = matches[1];
    // Find line bounds.
    const lineStart = src.lastIndexOf('\n', secondIdx) + 1;
    const lineEnd = src.indexOf('\n', secondIdx) + 1;
    src = src.slice(0, lineStart) + src.slice(lineEnd);
    info('removed duplicate router declaration at original line ~643');
  } else if (matches.length === 1) {
    info('only one router declaration found (already deduped)');
  } else {
    die('expected at least one router declaration after move');
  }
}

// =========================================================================
// STEP 2: Replace goToSeriesRootWithFocus body with router.dismissAll path.
//
// Locate the function by its name and replace from "= useCallback(" to the
// closing "}, [id, type, router, navigation]);" with the new implementation.
// =========================================================================
{
  const fnStartAnchor = 'const goToSeriesRootWithFocus = useCallback(';
  const sIdx = src.indexOf(fnStartAnchor);
  if (sIdx === -1) die('cannot find goToSeriesRootWithFocus');
  const endAnchor = '}, [id, type, router, navigation]);';
  const eIdx = src.indexOf(endAnchor, sIdx);
  if (eIdx === -1) die('cannot find goToSeriesRootWithFocus deps closer');
  const blockEnd = eIdx + endAnchor.length;

  const newFn =
"const goToSeriesRootWithFocus = useCallback(() => {\n" +
"    // v124v-router-dismissall: on-screen back from an episode page.\n" +
"    // Wipe every pushed screen via router.dismissAll(), then push the\n" +
"    // series root with focus params. Works regardless of how many episode\n" +
"    // pages piled up during binge - expo-router v6 native API.\n" +
"    const rawId = String(id || '');\n" +
"    if (type !== 'series' || !rawId.includes(':')) {\n" +
"      console.log('[BACK-UI v124v] not an episode page, no-op');\n" +
"      return false;\n" +
"    }\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK-UI v124v] fired rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    try {\n" +
"      // Step A: dismiss all pushed screens (binge entries, player, etc.)\n" +
"      // back to the navigator root (the tab screen).\n" +
"      if (typeof router.dismissAll === 'function') {\n" +
"        try { router.dismissAll(); console.log('[BACK-UI v124v] dismissAll OK'); }\n" +
"        catch (e) { console.log('[BACK-UI v124v] dismissAll error', e); }\n" +
"      }\n" +
"      // Step B: push the series root fresh.\n" +
"      router.push({\n" +
"        pathname: '/details/series/' + seriesRootId,\n" +
"        params: { focusS: sNum, focusE: eNum },\n" +
"      });\n" +
"      return true;\n" +
"    } catch (e) {\n" +
"      console.log('[BACK-UI v124v] outer error', e);\n" +
"    }\n" +
"    // Last-resort fallback.\n" +
"    try {\n" +
"      router.replace({\n" +
"        pathname: '/details/series/' + seriesRootId,\n" +
"        params: { focusS: sNum, focusE: eNum },\n" +
"      });\n" +
"      return true;\n" +
"    } catch (_) { return false; }\n" +
"  }, [id, type, router, navigation]);";

  src = src.slice(0, sIdx) + newFn + src.slice(blockEnd);
  info('rewrote goToSeriesRootWithFocus to use router.dismissAll + push');
}

// =========================================================================
// STEP 3: Replace the hardware BackHandler useEffect (v124n) body similarly.
// =========================================================================
{
  const startAnchor = '// v124n-pop-to-root: scan stack for series root, pop everything above it.';
  const sIdx = src.indexOf(startAnchor);
  if (sIdx === -1) {
    info('WARN: v124n hardware BackHandler not found - skipping');
  } else {
    const endAnchor = '}, [id, type, router, navigation]);';
    const eIdx = src.indexOf(endAnchor, sIdx);
    if (eIdx === -1) die('cannot find v124n deps closer');
    const blockEnd = eIdx + endAnchor.length;

    const newBlock =
"// v124v-router-dismissall: hardware Back from an episode page.\n" +
"  // Mirrors the on-screen logic in goToSeriesRootWithFocus.\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124v] mount isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          if (typeof router.dismissAll === 'function') {\n" +
"            try { router.dismissAll(); console.log('[BACK v124v] hwBack dismissAll OK'); }\n" +
"            catch (e) { console.log('[BACK v124v] dismissAll error', e); }\n" +
"          }\n" +
"          router.push({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124v] outer error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router, navigation]);";

    src = src.slice(0, sIdx) + newBlock + src.slice(blockEnd);
    info('rewrote v124n hardware BackHandler to use router.dismissAll + push');
  }
}

// =========================================================================
// Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124v';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
info('Expected: back from any episode page (binge or not) -> series root in 1 press.');
