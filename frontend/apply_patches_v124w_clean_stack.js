// apply_patches_v124w_clean_stack.js
//
// v124w - FINAL FIX for binge back button.
//
// Strategy: stop the stack pollution AT THE SOURCE.
//
// During binge, autoplay (player.tsx) does router.replace to next episode's
// details page. router.replace swaps the current TOP entry (player_Ex) but
// leaves the previous episode page in the stack. After 7 episodes binged:
//   [..., RMroot, S1E1page, S1E2page, ..., S1E7page, player_E7]
//
// Fix: replace router.replace with router.dismiss(2) + router.push. dismiss(2)
// pops [player + previousEpisodePage] atomically; push then re-adds the new
// episode page. Final stack stays:
//   [..., RMroot, currentEpisodePage, player_current]
// regardless of how many episodes were binged.
//
// With the stack always clean, plain router.back() does the right thing:
//   - back from player -> lands on current episode page (1st back)
//   - back from episode page -> lands on RMroot (2nd back)
//
// The episode-page back handler is rewritten to use router.back() +
// router.setParams() so the series root receives the focus episode for the
// selector.
//
// Also fixes a real TDZ bug in id.tsx: `const router = useRouter();` is
// declared at line ~562 but used by goToSeriesRootWithFocus at line ~542.
// Move it above the back-button block.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124w_clean_stack.js

const fs = require('fs');
const path = require('path');

const PLAYER  = path.join('app', 'player.tsx');
const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER  = 'v124w-clean-stack';

function die(msg) { console.error('[v124w] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124w] ' + msg); }

if (!fs.existsSync(PLAYER))  die('cannot find ' + PLAYER);
if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);

let psrc = fs.readFileSync(PLAYER, 'utf8');
let dsrc = fs.readFileSync(DETAILS, 'utf8');

if (psrc.includes(MARKER) && dsrc.includes(MARKER)) {
  info('already applied to both files - nothing to do.');
  process.exit(0);
}

// =========================================================================
// PART A: player.tsx
// =========================================================================
info('=== Part A: player.tsx ===');

// A1) Replace the two autoplay router.replace blocks with dismiss(2) + push.
const REPLACE_RE_COUNTDOWN = /router\.replace\(\{\s*pathname:\s*`\/details\/series\/\$\{nextEpisodeId\}`,\s*params:\s*\{\s*autoPlay:\s*'true',\s*nextTitle:[^}]*nextPoster:[^}]*nextBackdrop:[^}]*\},\s*\}\);/;
const REPLACE_RE_PLAYNOW = /router\.replace\(\{\s*pathname:\s*`\/details\/series\/\$\{nextEpisodeId\}`,\s*params:\s*\{\s*autoPlay:\s*'true',\s*nextTitle:\s*nextEpisodeTitle\s*\|\|\s*''\s*,?\s*\},\s*\}\);/;

const PUSH_COUNTDOWN =
"// v124w-clean-stack: dismiss [player + prevEpisodePage] then push next.\n" +
"          try { (router as any).dismiss && (router as any).dismiss(2); } catch (_) {}\n" +
"          router.push({\n" +
"            pathname: `/details/series/${nextEpisodeId}`,\n" +
"            params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '', nextPoster: (nextEpisodePoster || poster || '') as string, nextBackdrop: (backdrop || '') as string },\n" +
"          });";

const PUSH_PLAYNOW =
"// v124w-clean-stack: dismiss [player + prevEpisodePage] then push next.\n" +
"    try { (router as any).dismiss && (router as any).dismiss(2); } catch (_) {}\n" +
"    router.push({\n" +
"      pathname: `/details/series/${nextEpisodeId}`,\n" +
"      params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '' },\n" +
"    });";

if (REPLACE_RE_COUNTDOWN.test(psrc)) {
  psrc = psrc.replace(REPLACE_RE_COUNTDOWN, PUSH_COUNTDOWN);
  info('A1a: countdown autoplay -> dismiss(2)+push');
} else if (psrc.includes('v124w-clean-stack') && psrc.includes("router as any).dismiss")) {
  info('A1a: countdown autoplay already patched');
} else {
  die('cannot find countdown autoplay router.replace block');
}

if (REPLACE_RE_PLAYNOW.test(psrc)) {
  psrc = psrc.replace(REPLACE_RE_PLAYNOW, PUSH_PLAYNOW);
  info('A1b: playNext autoplay -> dismiss(2)+push');
} else if ((psrc.match(/v124w-clean-stack/g) || []).length >= 2) {
  info('A1b: playNext autoplay already patched');
} else {
  die('cannot find playNext autoplay router.replace block');
}

// =========================================================================
// PART B: details/[type]/[id].tsx
// =========================================================================
info('=== Part B: details/[type]/[id].tsx ===');

// B1) Move `const router = useRouter();` from below to ABOVE goToSeriesRootWithFocus.
const beforeBackComment = '  // === ANDROID-TV BACK BUTTON FIX =========================================';
if (dsrc.indexOf(beforeBackComment) === -1) die('cannot find ANDROID-TV BACK BUTTON FIX comment');

const wantInsert = '  const router = useRouter();\n\n' + beforeBackComment;
if (dsrc.indexOf(wantInsert) === -1) {
  dsrc = dsrc.replace(beforeBackComment, '  const router = useRouter();\n\n' + beforeBackComment);
  info('B1a: inserted const router = useRouter() before back-button block');
} else {
  info('B1a: router already moved above back-button block');
}

// B1b) Remove the old declaration further down (the SECOND occurrence now).
{
  const re = /  const router = useRouter\(\);\r?\n/g;
  const positions = [];
  let m;
  while ((m = re.exec(dsrc)) !== null) positions.push({ idx: m.index, len: m[0].length });
  if (positions.length >= 2) {
    const second = positions[1];
    dsrc = dsrc.slice(0, second.idx) + dsrc.slice(second.idx + second.len);
    info('B1b: removed duplicate router declaration');
  } else {
    info('B1b: only one router declaration found (already deduped)');
  }
}

// B2) Rewrite goToSeriesRootWithFocus to use router.back() + setParams.
{
  const fnStartAnchor = 'const goToSeriesRootWithFocus = useCallback(';
  const sIdx = dsrc.indexOf(fnStartAnchor);
  if (sIdx === -1) die('cannot find goToSeriesRootWithFocus in details');
  const endAnchor = '}, [id, type, router, navigation]);';
  const eIdx = dsrc.indexOf(endAnchor, sIdx);
  if (eIdx === -1) die('cannot find goToSeriesRootWithFocus deps closer');
  const blockEnd = eIdx + endAnchor.length;

  const newFn =
"const goToSeriesRootWithFocus = useCallback(() => {\n" +
"    // v124w-clean-stack: with the autoplay v124w fix, the binge stack stays\n" +
"    // clean at [..., RMroot, currentEpisodePage, player]. A plain router.back()\n" +
"    // from the episode page lands on RMroot in one press. Then setParams to\n" +
"    // focus the just-watched episode on the series-root selector.\n" +
"    const idStr = String(id || '');\n" +
"    if (type !== 'series' || !idStr.includes(':')) {\n" +
"      console.log('[BACK-UI v124w] not an episode page, no-op');\n" +
"      return false;\n" +
"    }\n" +
"    const parts = idStr.split(':');\n" +
"    const s = parts[1] || '';\n" +
"    const e = parts[2] || '';\n" +
"    console.log('[BACK-UI v124w] fired idStr=' + idStr + ' season=' + s + ' episode=' + e);\n" +
"    try {\n" +
"      router.back();\n" +
"      // After back lands us on RMroot, push focus params so the selector\n" +
"      // highlights the just-watched episode.\n" +
"      setTimeout(() => {\n" +
"        try { router.setParams({ selectedSeason: s, selectedEpisode: e } as any); }\n" +
"        catch (err) { console.log('[BACK-UI v124w] setParams error', err); }\n" +
"      }, 80);\n" +
"      return true;\n" +
"    } catch (err) {\n" +
"      console.log('[BACK-UI v124w] router.back error', err);\n" +
"      return false;\n" +
"    }\n" +
"  }, [id, type, router, navigation]);";

  dsrc = dsrc.slice(0, sIdx) + newFn + dsrc.slice(blockEnd);
  info('B2: rewrote goToSeriesRootWithFocus to use router.back + setParams');
}

// =========================================================================
// Backups + write.
// =========================================================================
const pbak = PLAYER + '.bak.v124w';
const dbak = DETAILS + '.bak.v124w';
if (!fs.existsSync(pbak)) fs.copyFileSync(PLAYER, pbak);
if (!fs.existsSync(dbak)) fs.copyFileSync(DETAILS, dbak);

fs.writeFileSync(PLAYER, psrc, 'utf8');
fs.writeFileSync(DETAILS, dsrc, 'utf8');
info('patched ' + PLAYER);
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
info('Expected flow:');
info('  Player -> back -> CURRENT episode page (always)');
info('  Episode page -> back -> Series root, selector on current episode (always)');
info('  Series root -> back -> wherever you came from (discover/library/etc)');
