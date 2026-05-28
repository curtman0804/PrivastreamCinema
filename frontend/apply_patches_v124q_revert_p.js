// apply_patches_v124q_revert_p.js
//
// v124q - EMERGENCY REVERT of v124p.
//
// v124p tried to use @react-navigation CommonActions.reset to rebuild the
// nav stack on player exit. Diagnostic confirms this is incompatible with
// Expo Router (route names like 'details/[type]/[id]' aren't valid in
// Expo Router's internal registry). Dispatching reset with those names
// invalidates the entire navigation state and exits the app.
//
// This script restores the v124g handleBack implementation (plain
// router.replace to the current episode page) so the app stops crashing.
//
// Trade-off: binge prior-episode entries will remain in the stack until
// the autoplay-page-flash fix lands separately. That's a UX nuisance, not
// an app crash.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124q_revert_p.js

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
const MARKER = 'v124q-revert-p';

function die(msg) { console.error('[v124q] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124q] ' + msg); }

if (!fs.existsSync(PLAYER)) die('cannot find ' + PLAYER);
let src = fs.readFileSync(PLAYER, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// 1) Replace the v124p block back to v124g-style.
//    v124p starts with comment "v124p-player-clean-exit: REBUILD nav stack"
//    and ends with "router.back();\n  };"
// =========================================================================
const startMarker = '// v124p-player-clean-exit: REBUILD nav stack on leaving player.';
const sIdx = src.indexOf(startMarker);
if (sIdx === -1) die('cannot find v124p start marker - was v124p applied?');

const endKey = '    router.back();\n  };';
const eIdx = src.indexOf(endKey, sIdx);
if (eIdx === -1) die('cannot find v124p handleBack end');
const blockEnd = eIdx + endKey.length;

const NEW =
"// v124q-revert-p: restored v124g handleBack. CommonActions.reset is\n" +
"  // incompatible with Expo Router and crashed the app. Use plain\n" +
"  // router.replace to navigate to the current episode page.\n" +
"  //\n" +
"  // SERIES -> EPISODE page (with fromPlayer flag for back-tracking).\n" +
"  // MOVIE  -> default router.back().\n" +
"  const handleBack = () => {\n" +
"    try {\n" +
"      if (contentType === 'series' && seriesId && season && episode) {\n" +
"        router.replace({\n" +
"          pathname: `/details/series/${seriesId}:${season}:${episode}`,\n" +
"          params: { fromPlayer: 'true' },\n" +
"        });\n" +
"        return;\n" +
"      }\n" +
"    } catch (e) {\n" +
"      console.log('[PLAYER v124q] handleBack error', e);\n" +
"    }\n" +
"    router.back();\n" +
"  };";

src = src.slice(0, sIdx) + NEW + src.slice(blockEnd);
info('reverted v124p handleBack to v124g-style router.replace');

// =========================================================================
// 2) Also remove the broken `const navigation = useNavigation();` line that
//    v124p inserted INSIDE the function body block. Now that we don't use
//    navigation here, remove it to avoid lint/runtime confusion. (Leave the
//    import - harmless.)
// =========================================================================
const navLine = '  const navigation = useNavigation();\n';
if (src.includes(navLine + '  const handleBack')) {
  src = src.replace(navLine + '  const handleBack', '  const handleBack');
  info('removed stray useNavigation() call');
}

// =========================================================================
// 3) Backup + write.
// =========================================================================
const bak = PLAYER + '.bak.v124q';
if (!fs.existsSync(bak)) fs.copyFileSync(PLAYER, bak);
fs.writeFileSync(PLAYER, src, 'utf8');
info('patched ' + PLAYER);
info('OK - rebuild and sideload. App should stop exiting on back.');
