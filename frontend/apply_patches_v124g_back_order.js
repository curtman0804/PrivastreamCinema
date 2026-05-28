// apply_patches_v124g_back_order.js
//
// Reorders the contextual back flow per user feedback:
//
//   /player                 -- Back -->   /details/series/<id>:<S>:<E>
//                                          (the episode page they were watching)
//   episode page            -- Back -->   /details/series/<id>?focusS=<S>&focusE=<E>
//                                          (series root with that episode focused)
//
// Two clean back presses to escape during binge, no matter how deep the
// stack got.
//
// Patches BOTH app/player.tsx and app/details/[type]/[id].tsx in one run.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124g_back_order.js

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124g-back-order';

function die(msg) { console.error('[v124g] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(PLAYER)) die('cannot find ' + PLAYER);
if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);

let psrc = fs.readFileSync(PLAYER, 'utf8');
let dsrc = fs.readFileSync(DETAILS, 'utf8');

if (psrc.includes(MARKER) && dsrc.includes(MARKER)) {
  console.log('[v124g] already applied - nothing to do.');
  process.exit(0);
}

// =========================================================================
// PLAYER.TSX - handleBack now navigates to the episode page with fromPlayer flag
// =========================================================================
if (!psrc.includes(MARKER)) {
  const re = /\/\/ v124b-back-contextual: contextual back from player\.[\s\S]*?const handleBack = \(\) => \{[\s\S]*?\};/;
  if (!re.test(psrc)) die('could not find v124b handleBack block.');

  const replacement =
    "// v124g-back-order: contextual back from player.\n" +
    "  //   SERIES -> EPISODE page (with fromPlayer flag so the episode page\n" +
    "  //               can then jump to series root on the next back press).\n" +
    "  //   MOVIE  -> default router.back() (returns to stream cards page).\n" +
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
    "      console.log('[PLAYER] v124g handleBack error', e);\n" +
    "    }\n" +
    "    router.back();\n" +
    "  };";

  psrc = psrc.replace(re, replacement);

  const pbak = PLAYER + '.bak.v124g';
  if (!fs.existsSync(pbak)) fs.copyFileSync(PLAYER, pbak);
  fs.writeFileSync(PLAYER, psrc, 'utf8');
  console.log('[v124g] patched ' + PLAYER);
}

// =========================================================================
// DETAILS_ID.TSX - extend the existing autoPlay BackHandler intercept to
// also fire when fromPlayer=true. Both cases route to series root with
// focusS/focusE so the show-root page highlights the watched episode.
// =========================================================================
if (!dsrc.includes(MARKER)) {
  // 1) Add fromPlayer to useLocalSearchParams destructuring.
  if (!dsrc.includes('fromPlayer: fromPlayerParam')) {
    const paramAnchor = /autoPlay:\s*autoPlayParam,/;
    if (!paramAnchor.test(dsrc)) die('could not find autoPlay param destructure.');
    dsrc = dsrc.replace(
      paramAnchor,
      "autoPlay: autoPlayParam,\n    fromPlayer: fromPlayerParam,"
    );
  }

  // 2) Add fromPlayer to type definition.
  if (!dsrc.includes('fromPlayer?: string;')) {
    const typeAnchor = /autoPlay\?:\s*string;/;
    if (!typeAnchor.test(dsrc)) die('could not find autoPlay param type.');
    dsrc = dsrc.replace(typeAnchor, "autoPlay?: string;\n    fromPlayer?: string;");
  }

  // 3) Replace the existing autoPlay BackHandler intercept to also fire
  // on fromPlayer=true AND to pass focusS/focusE to series root.
  const interceptRe = /useEffect\(\(\) => \{\s*[\r\n]+\s*if \(autoPlayParam !== 'true' \|\| type !== 'series' \|\| !baseId\) return;\s*[\r\n]+\s*const handler = \(\) => \{\s*[\r\n]+\s*router\.replace\(\{ pathname: `\/details\/series\/\$\{baseId\}` \}\);\s*[\r\n]+\s*return true;\s*[\r\n]+\s*\};\s*[\r\n]+\s*const sub = BackHandler\.addEventListener\('hardwareBackPress', handler\);\s*[\r\n]+\s*return \(\) => sub\.remove\(\);\s*[\r\n]+\s*\}, \[autoPlayParam, type, baseId\]\);/;

  if (!interceptRe.test(dsrc)) die('could not find existing autoPlay BackHandler intercept.');

  dsrc = dsrc.replace(
    interceptRe,
    "useEffect(() => {\n" +
    "    // v124g-back-order: intercept hardware Back on series episode pages\n" +
    "    // when arriving from /player (fromPlayer=true) OR from autoplay.\n" +
    "    // Route to series root with focusS/focusE so the just-watched episode\n" +
    "    // is highlighted on the show page.\n" +
    "    const isFromPlayer = fromPlayerParam === 'true';\n" +
    "    const isAutoPlay = autoPlayParam === 'true';\n" +
    "    if ((!isFromPlayer && !isAutoPlay) || type !== 'series' || !baseId) return;\n" +
    "    const handler = () => {\n" +
    "      router.replace({\n" +
    "        pathname: `/details/series/${baseId}`,\n" +
    "        params: {\n" +
    "          focusS: String(episodeSeason || ''),\n" +
    "          focusE: String(episodeNumber || ''),\n" +
    "        },\n" +
    "      });\n" +
    "      return true;\n" +
    "    };\n" +
    "    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
    "    return () => sub.remove();\n" +
    "  }, [autoPlayParam, fromPlayerParam, type, baseId, episodeSeason, episodeNumber]);"
  );

  // 4) Add the marker so re-runs are no-ops.
  dsrc = dsrc.replace(
    /(\/\/ v124c-back-contextual\n)/,
    "$1  // v124g-back-order\n"
  );

  const dbak = DETAILS + '.bak.v124g';
  if (!fs.existsSync(dbak)) fs.copyFileSync(DETAILS, dbak);
  fs.writeFileSync(DETAILS, dsrc, 'utf8');
  console.log('[v124g] patched ' + DETAILS);
}

console.log('[v124g] OK - rebuild and sideload.');
