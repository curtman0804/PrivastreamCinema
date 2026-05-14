/* eslint-disable */
// apply_patches_v29.js — Robust back navigation on details screen
// Run from project root:   node apply_patches_v29.js
//
// THE BUG (details/[type]/[id].tsx line 542):
//   const sub = BackHandler.addEventListener('hardwareBackPress',
//     () => goToSeriesRootWithFocus());
//
// `goToSeriesRootWithFocus()` returns truthy only for SERIES EPISODES.
// For movies, series roots, and other content it returns falsy →
// BackHandler interprets that as "not handled" → Android default →
// app exits.
//
// THE FIX:
// 1. Keep series-root logic intact (return true when goToSeriesRootWithFocus
//    handles it).
// 2. Otherwise explicitly call router.back() inside try/catch.
// 3. If router.back() throws (deep-linked entry, empty back stack),
//    fall back to /(tabs)/discover.
// 4. ALWAYS return true so Android never closes the app from details.
//
// Single file. Single anchor. Single string replace.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v29.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V29_BACK_NAV';

if (src.includes(MARKER)) {
  ok('V29 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Single anchor: the inline-arrow BackHandler registration on line 542
// ---------------------------------------------------------------------
{
  const anchor = "    const sub = BackHandler.addEventListener('hardwareBackPress', () => goToSeriesRootWithFocus());";
  const occ = src.split(anchor).length - 1;

  if (occ === 0) {
    bad('could not find the hardwareBackPress inline-arrow anchor (line ~542)');
  } else if (occ > 1) {
    bad('anchor matches ' + occ + ' times — refusing ambiguous swap');
  } else {
    const replacement = [
      "    // " + MARKER + " — never let Android back close the app from details.",
      "    // - Series-episode path stays untouched (true → consumed)",
      "    // - Movies/series-roots: call router.back() explicitly",
      "    // - Empty back stack (deep link): fall back to Discover tab",
      "    // - ALWAYS return true so Android cannot exit the app from here",
      "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
      "      try { if (goToSeriesRootWithFocus()) return true; } catch { /* fall through */ }",
      "      try { router.back(); return true; } catch { /* no back history */ }",
      "      try { router.replace('/(tabs)/discover'); } catch { /* last resort: ignore */ }",
      "      return true;",
      "    });",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('replaced hardware-back handler with robust V29 version');
  }
}

// Save (restoring CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV29 done. Rebuild and test:');
  console.log('  ✓ From Discover → click a movie → press hardware back → returns to Discover (no app exit)');
  console.log('  ✓ From Search → click a movie → press hardware back → returns to Search');
  console.log('  ✓ From series episode → back → goes to series root (unchanged)');
  console.log('  ✓ Deep-linked entry to details → back → goes to Discover (no exit)');
  console.log('\nIf this fixes the close-on-back, tell me and we move to V30 (post-playback stuck state).');
}
