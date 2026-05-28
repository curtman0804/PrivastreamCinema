// apply_patches_v124k_back_finalize.js
//
// Finalizer for v124j. v124j successfully removed the two old BackHandlers
// in app/details/[type]/[id].tsx but failed on the insert anchor. It left a
// placeholder comment behind:
//   /* v124j-back-unified: V34 BackHandler removed, replaced below */
//
// This script finds that placeholder and replaces it with the actual
// unified BackHandler useEffect block.
//
// Also handles the case where v124j was never run: it does the full job.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124k_back_finalize.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124k-back-unified';

function die(msg) { console.error('[v124k] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124k] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

const UNIFIED =
"  // v124k-back-unified: single BackHandler for the details/episode page.\n" +
"  //   /details/series/<id>:<S>:<E>  ->  back jumps to series root.\n" +
"  //   /details/series/<id>          ->  router.back()\n" +
"  //   /details/movie/<id>           ->  router.back()\n" +
"  // Replaces the old V34 handler and the v124h fromPlayer-only handler.\n" +
"  useEffect(() => {\n" +
"    const rawId = String(id || '');\n" +
"    const isEpisodePage = type === 'series' && rawId.includes(':');\n" +
"    const parts = rawId.split(':');\n" +
"    const seriesRootId = parts[0];\n" +
"    const sNum = parts[1] || '';\n" +
"    const eNum = parts[2] || '';\n" +
"    console.log('[BACK v124k] mount isEp=' + isEpisodePage + ' rawId=' + rawId + ' rootId=' + seriesRootId);\n" +
"    const handler = () => {\n" +
"      try {\n" +
"        console.log('[BACK v124k] hwBack isEp=' + isEpisodePage + ' rootId=' + seriesRootId);\n" +
"        if (isEpisodePage && seriesRootId) {\n" +
"          router.replace({\n" +
"            pathname: '/details/series/' + seriesRootId,\n" +
"            params: { focusS: sNum, focusE: eNum },\n" +
"          });\n" +
"          return true;\n" +
"        }\n" +
"      } catch (e) {\n" +
"        console.log('[BACK v124k] error', e);\n" +
"      }\n" +
"      try { router.back(); return true; } catch (_) {}\n" +
"      try { router.replace('/(tabs)/discover'); } catch (_) {}\n" +
"      return true;\n" +
"    };\n" +
"    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
"    return () => sub.remove();\n" +
"  }, [id, type, router]);\n";

// ---- preferred path: replace the v124j V34 placeholder ----
const placeholder = '/* v124j-back-unified: V34 BackHandler removed, replaced below */';
if (src.includes(placeholder)) {
  src = src.replace(placeholder, UNIFIED.trimStart());
  info('replaced V34 placeholder with unified handler');
} else {
  // ---- fallback: do the whole v124j job from scratch ----
  info('V34 placeholder not found; running full removal + insert');

  // 1) remove V34 if still present
  const v34key = 'PATCH_V34_DETAILS_BACK';
  if (src.includes(v34key)) {
    const startIdx = src.indexOf(v34key);
    const blockOpen = src.lastIndexOf('useEffect(() => {', startIdx);
    const closeKey = '}, [goToSeriesRootWithFocus]);';
    const closeIdx = src.indexOf(closeKey, startIdx);
    if (blockOpen !== -1 && closeIdx !== -1) {
      src = src.slice(0, blockOpen) + UNIFIED.trimStart() + src.slice(closeIdx + closeKey.length);
      info('removed V34 and inserted unified handler');
    } else {
      die('could not parse V34 block');
    }
  } else {
    // No V34, no placeholder. Try to insert before a very-stable anchor.
    const stableAnchors = [
      "const handleBack = useCallback",
      "const goToSeriesRootWithFocus = useCallback",
      "const router = useRouter();",
      "return (",
    ];
    let inserted = false;
    for (const anc of stableAnchors) {
      const idx = src.indexOf(anc);
      if (idx !== -1) {
        src = src.slice(0, idx) + UNIFIED + '\n  ' + src.slice(idx);
        info('inserted unified handler before anchor: ' + anc);
        inserted = true;
        break;
      }
    }
    if (!inserted) die('no stable anchor found for insertion');
  }
}

// ---- also strip the v124h leftover placeholder if present ----
src = src.replace(
  /\/\* v124j-back-unified: v124h BackHandler removed, replaced below \*\//g,
  '/* v124k-back-unified: prior intercept removed */'
);

// ---- backup + write ----
const bak = DETAILS + '.bak.v124k';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
