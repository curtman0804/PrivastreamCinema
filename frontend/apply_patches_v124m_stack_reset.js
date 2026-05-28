// apply_patches_v124m_stack_reset.js
//
// v124m - bulletproof binge collapse via CommonActions.reset.
//
// v124l relied on counting consecutive episode-page entries and popping with
// StackActions.pop. That depended on a clean consecutive ordering in the
// nav stack, which doesn't always hold when autoplay/replace flows leave
// other routes between binge entries.
//
// This patch instead rebuilds the full nav stack with CommonActions.reset:
//   - Iterate the current stack
//   - DROP any route whose params.id starts with "<seriesId>:" (binge entries)
//   - KEEP everything else (discover, library, search, other series, etc.)
//   - Ensure the series root "<seriesId>" exists at the end of the new stack
//     with focusS/focusE params for episode highlighting
//   - dispatch CommonActions.reset with the rebuilt list
//
// This guarantees that whatever back-press came from a binge episode page
// lands the user on the series root with one click, and a subsequent back
// goes wherever they came from BEFORE the binge.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124m_stack_reset.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124m-stack-reset';

function die(msg) { console.error('[v124m] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124m] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// 1) Find the v124l handler block to replace. It starts with the comment
//    "v124l-stack-collapse: single BackHandler" and ends with the deps
//    array "}, [id, type, router, navigation]);".
//    Fall back to v124k or older labels if v124l isn't there.
// =========================================================================
const startMarkers = [
  '// v124l-stack-collapse: single BackHandler',
  '// v124k-back-unified: single BackHandler',
  '// v124j-back-unified: single BackHandler',
];
let startIdx = -1, startLen = 0;
for (const m of startMarkers) {
  const i = src.indexOf(m);
  if (i !== -1) { startIdx = i; startLen = m.length; info('matched start marker: ' + m); break; }
}
if (startIdx === -1) die('cannot find any prior BackHandler block start marker (v124j/k/l)');

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

// =========================================================================
// 2) New handler block.
// =========================================================================
const NEW =
"// v124m-stack-reset: single BackHandler. Binge-aware via CommonActions.reset.\n" +
"  //\n" +
"  // On an episode page (id contains \":\"):\n" +
"  //   - inspect nav stack via navigation.getState()\n" +
"  //   - drop every entry whose id starts with \"<seriesId>:\"\n" +
"  //   - ensure series root entry exists (push at end if missing)\n" +
"  //   - dispatch CommonActions.reset to the rebuilt list\n" +
"  // Else (series root or movie page): router.back().\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124m] mount isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          let stateOk = false;\n" +
"          try {\n" +
"            const state = navigation.getState && navigation.getState();\n" +
"            const routes = (state && state.routes) || [];\n" +
"            console.log('[BACK v124m] hwBack routes=' + routes.length);\n" +
"            for (let i = 0; i < routes.length; i++) {\n" +
"              const r = routes[i] || {};\n" +
"              const rname = String(r.name || '');\n" +
"              const rid = String((r.params && r.params.id) || '');\n" +
"              console.log('[BACK v124m]   [' + i + '] name=' + rname + ' id=' + rid);\n" +
"            }\n" +
"            // Build new routes: drop binge entries of THIS series; keep series\n" +
"            // root with focus params; keep everything else as-is.\n" +
"            const kept = [];\n" +
"            let rootInKept = false;\n" +
"            for (const r of routes) {\n" +
"              const rid = String((r && r.params && r.params.id) || '');\n" +
"              const ridRoot = rid.split(':')[0];\n" +
"              if (rid === seriesRootId) {\n" +
"                kept.push({\n" +
"                  name: r.name,\n" +
"                  params: { ...(r.params || {}), focusS: sNum, focusE: eNum },\n" +
"                });\n" +
"                rootInKept = true;\n" +
"                continue;\n" +
"              }\n" +
"              if (ridRoot === seriesRootId && rid !== seriesRootId) {\n" +
"                // binge episode page entry - drop it\n" +
"                continue;\n" +
"              }\n" +
"              kept.push({ name: r.name, params: r.params, state: r.state });\n" +
"            }\n" +
"            if (!rootInKept) {\n" +
"              // No series root in history at all - synthesize one at the end.\n" +
"              kept.push({\n" +
"                name: 'details/[type]/[id]',\n" +
"                params: { type: 'series', id: seriesRootId, focusS: sNum, focusE: eNum },\n" +
"              });\n" +
"            }\n" +
"            console.log('[BACK v124m] dispatching reset, newLen=' + kept.length);\n" +
"            navigation.dispatch(\n" +
"              CommonActions.reset({\n" +
"                index: kept.length - 1,\n" +
"                routes: kept,\n" +
"              })\n" +
"            );\n" +
"            stateOk = true;\n" +
"          } catch (e) {\n" +
"            console.log('[BACK v124m] reset failed', e);\n" +
"          }\n" +
"          if (stateOk) return true;\n" +
"          // Fallback if reset blew up: plain replace.\n" +
"          router.replace({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124m] outer error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router, navigation]);";

src = src.slice(0, startIdx) + NEW + src.slice(blockEnd);
info('replaced handler with v124m stack-reset version');

// =========================================================================
// 3) Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124m';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
