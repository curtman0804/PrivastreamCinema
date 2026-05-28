// apply_patches_v124p_player_clean_exit.js
//
// v124p - rebuild a CLEAN nav stack when leaving the player.
//
// Root cause of the recurring back-button bug: during binge-watch, every
// episode pushes its own page (e.g. RM:1:1, RM:1:2, ...) onto the nav stack.
// When the user backs out of the player, we router.replace into the current
// episode's page - but every prior episode page is still in the stack below.
// One more back press then pops to the PREVIOUS episode page instead of the
// series root.
//
// This patch fixes it at the source: instead of router.replace, we use
// CommonActions.reset to REBUILD the stack as exactly:
//
//   [...preSeriesHistory, seriesRoot, currentEpisodePage]
//
// All prior episode pages, leftover /player routes, etc. are dropped.
//
// After this, every back press is a normal router.back():
//   currentEpisodePage  --back-->  seriesRoot
//   seriesRoot          --back-->  discover / library / whatever came before
//
// No custom intercepts needed downstream.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124p_player_clean_exit.js

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
const MARKER = 'v124p-player-clean-exit';

function die(msg) { console.error('[v124p] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124p] ' + msg); }

if (!fs.existsSync(PLAYER)) die('cannot find ' + PLAYER);
let src = fs.readFileSync(PLAYER, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// 1) Ensure useNavigation + CommonActions are imported from @react-navigation/native.
// =========================================================================
const hasUseNav = /import\s*\{[^}]*useNavigation[^}]*\}\s*from\s*'@react-navigation\/native'/.test(src);
const hasCommonActions = /import\s*\{[^}]*CommonActions[^}]*\}\s*from\s*'@react-navigation\/native'/.test(src);

if (!hasUseNav || !hasCommonActions) {
  // Check if there's any @react-navigation/native import to extend.
  const navImportRe = /import\s*\{([^}]*)\}\s*from\s*'@react-navigation\/native';/;
  const m = src.match(navImportRe);
  if (m) {
    const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!existing.includes('useNavigation')) existing.push('useNavigation');
    if (!existing.includes('CommonActions')) existing.push('CommonActions');
    const newImport = "import { " + existing.join(', ') + " } from '@react-navigation/native';";
    src = src.replace(navImportRe, newImport);
    info('updated @react-navigation/native import: ' + newImport);
  } else {
    // No existing import - add one right after the expo-router import (or after react-native).
    const anchor = "import { SafeAreaView } from 'react-native-safe-area-context';";
    if (src.includes(anchor)) {
      src = src.replace(
        anchor,
        anchor + "\nimport { useNavigation, CommonActions } from '@react-navigation/native';"
      );
      info('added new @react-navigation/native import');
    } else {
      die('cannot find anchor to insert navigation import');
    }
  }
}

// =========================================================================
// 2) Replace the v124g handleBack block with v124p.
// =========================================================================
const startMarker = '// v124g-back-order: contextual back from player.';
const sIdx = src.indexOf(startMarker);
if (sIdx === -1) die('cannot find v124g handleBack start marker');

// End of the handleBack block: find the next "};" line that closes the handleBack arrow fn.
// Pattern: lines end with "    router.back();\n  };"
const endKey = '    router.back();\n  };';
const eIdx = src.indexOf(endKey, sIdx);
if (eIdx === -1) die('cannot find v124g handleBack end pattern');
const blockEnd = eIdx + endKey.length;

const NEW =
"// v124p-player-clean-exit: REBUILD nav stack on leaving player.\n" +
"  //\n" +
"  // For series: rewrite the stack to exactly [...preHistory, seriesRoot,\n" +
"  // currentEpisodePage]. Drops every prior binge episode page and stale\n" +
"  // /player entry. After this, every back press is a normal router.back().\n" +
"  //\n" +
"  // For movies: default router.back().\n" +
"  const navigation = useNavigation();\n" +
"  const handleBack = () => {\n" +
"    try {\n" +
"      if (contentType === 'series' && seriesId && season && episode) {\n" +
"        const epId = `${seriesId}:${season}:${episode}`;\n" +
"        const state = navigation.getState && navigation.getState();\n" +
"        const routes = (state && state.routes) || [];\n" +
"        console.log('[PLAYER v124p] handleBack series, stack=' + routes.length);\n" +
"        for (let i = 0; i < routes.length; i++) {\n" +
"          const r = routes[i] || {};\n" +
"          const rid = String((r.params && r.params.id) || '');\n" +
"          console.log('[PLAYER v124p]   [' + i + '] name=' + r.name + ' id=' + rid);\n" +
"        }\n" +
"        // Find the most recent series-root entry below the player.\n" +
"        let rootIdx = -1;\n" +
"        for (let i = routes.length - 1; i >= 0; i--) {\n" +
"          const rid = String((routes[i] && routes[i].params && routes[i].params.id) || '');\n" +
"          if (rid === seriesId) { rootIdx = i; break; }\n" +
"        }\n" +
"        let baseRoutes;\n" +
"        if (rootIdx >= 0) {\n" +
"          // Keep everything up to and including the existing series root.\n" +
"          baseRoutes = routes.slice(0, rootIdx + 1).map(r => ({\n" +
"            name: r.name,\n" +
"            params: r.params,\n" +
"          }));\n" +
"        } else {\n" +
"          // No series root in history. Keep entries that aren't part of\n" +
"          // this series or the player, then synthesize a fresh root.\n" +
"          baseRoutes = [];\n" +
"          for (const r of routes) {\n" +
"            const rid = String((r && r.params && r.params.id) || '');\n" +
"            const rname = String(r && r.name || '');\n" +
"            if (rid && rid.split(':')[0] === seriesId) continue;\n" +
"            if (rname.indexOf('player') !== -1) continue;\n" +
"            baseRoutes.push({ name: r.name, params: r.params });\n" +
"          }\n" +
"          baseRoutes.push({\n" +
"            name: 'details/[type]/[id]',\n" +
"            params: { type: 'series', id: seriesId },\n" +
"          });\n" +
"        }\n" +
"        baseRoutes.push({\n" +
"          name: 'details/[type]/[id]',\n" +
"          params: { type: 'series', id: epId, fromPlayer: 'true' },\n" +
"        });\n" +
"        console.log('[PLAYER v124p] dispatching reset, newLen=' + baseRoutes.length);\n" +
"        navigation.dispatch(\n" +
"          CommonActions.reset({\n" +
"            index: baseRoutes.length - 1,\n" +
"            routes: baseRoutes,\n" +
"          })\n" +
"        );\n" +
"        return;\n" +
"      }\n" +
"    } catch (e) {\n" +
"      console.log('[PLAYER v124p] handleBack error', e);\n" +
"    }\n" +
"    router.back();\n" +
"  };";

src = src.slice(0, sIdx) + NEW + src.slice(blockEnd);
info('replaced v124g handleBack with v124p clean-exit version');

// =========================================================================
// 3) Backup + write.
// =========================================================================
const bak = PLAYER + '.bak.v124p';
if (!fs.existsSync(bak)) fs.copyFileSync(PLAYER, bak);
fs.writeFileSync(PLAYER, src, 'utf8');
info('patched ' + PLAYER);
info('OK - rebuild and sideload.');
