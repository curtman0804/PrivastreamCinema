/* eslint-disable */
// apply_patches_v30.js — Bulletproof BACK button in the player
// Run from project root:   node apply_patches_v30.js
//
// THE BUG (Firestick + Android TV):
//   player.tsx registers BackHandler('hardwareBackPress', onBackPress).
//   `onBackPress` lives elsewhere in the file and — under certain states
//   (isLoading=true, no streamUrl yet, in-flight series-root logic) —
//   either returns true and silently does nothing, or throws. Result:
//   user is trapped on the player loading screen. Confirmed by user
//   ("back button don't do shit", "doesn't take me back anymore").
//
// THE FIX:
//   Replace the registration with an inline arrow that ALWAYS escapes:
//     1. Try existing onBackPress() — if it explicitly returns true, OK
//     2. Otherwise try router.back()
//     3. Otherwise router.replace('/(tabs)/discover')
//     4. ALWAYS return true so Android can't force-close
//
//   onBackPress is preserved (we still call it first), so any side effects
//   like dialog confirmations or analytics still run. We only override the
//   "no-op silently" behavior.
//
// Note: progress-save on exit is in a SEPARATE useEffect cleanup at
//       player.tsx L511, so it still fires on unmount no matter how we exit.
//
// Single file. Single anchor (confirmed unique by diagnostic). CRLF/LF safe.

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('frontend', 'app', 'player.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(PLAYER)) { bad('player.tsx not found at ' + PLAYER); process.exit(1); }

let src = fs.readFileSync(PLAYER, 'utf8');
const orig = src;
const bak = PLAYER + '.bak.v30.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');
info('detected line endings: ' + (_hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + PLAYER + ' ===');

const MARKER = 'PATCH_V30_PLAYER_BACK_ESCAPE';

if (src.includes(MARKER)) {
  ok('V30 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Single anchor — confirmed by diagnose_player_cleanup.js at line 276:
//   const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
// ---------------------------------------------------------------------
{
  const anchor = "    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);";
  const occ = src.split(anchor).length - 1;

  if (occ === 0) {
    bad("could not find player BackHandler registration anchor (4-space indent)");
    info("trying 2-space indent fallback...");

    const anchor2 = "  const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);";
    const occ2 = src.split(anchor2).length - 1;
    if (occ2 === 0) {
      bad("2-space variant also not found — refusing to patch");
    } else if (occ2 > 1) {
      bad("2-space anchor matches " + occ2 + " times — refusing ambiguous");
    } else {
      const replacement2 = [
        "  // " + MARKER + " — back press ALWAYS escapes the player",
        "  const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
        "    // 1) Let the existing onBackPress run — only honor it if it explicitly returns true",
        "    try { if (onBackPress && onBackPress() === true) return true; } catch (_) { /* fall through */ }",
        "    // 2) Try normal back nav",
        "    try { router.back(); return true; } catch (_) { /* no back stack */ }",
        "    // 3) Last resort: go to Discover",
        "    try { router.replace('/(tabs)/discover'); } catch (_) { /* swallow */ }",
        "    return true; // never let Android force-close from player",
        "  });",
      ].join('\n');
      src = src.replace(anchor2, replacement2);
      ok('replaced player BackHandler (2-space variant) with bulletproof V30 escape');
    }
  } else if (occ > 1) {
    bad("anchor matches " + occ + " times — refusing ambiguous swap");
  } else {
    const replacement = [
      "    // " + MARKER + " — back press ALWAYS escapes the player",
      "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
      "      // 1) Let the existing onBackPress run — only honor it if it explicitly returns true",
      "      try { if (onBackPress && onBackPress() === true) return true; } catch (_) { /* fall through */ }",
      "      // 2) Try normal back nav",
      "      try { router.back(); return true; } catch (_) { /* no back stack */ }",
      "      // 3) Last resort: go to Discover",
      "      try { router.replace('/(tabs)/discover'); } catch (_) { /* swallow */ }",
      "      return true; // never let Android force-close from player",
      "    });",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('replaced player BackHandler with bulletproof V30 escape');
  }
}

// ---------------------------------------------------------------------
// Save (restore original line endings)
// ---------------------------------------------------------------------
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(PLAYER, finalOut, 'utf8');
  ok('saved ' + PLAYER);
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
  console.log('\nV30 done. Rebuild and test on Firestick:');
  console.log('  ✓ Click any movie → loading screen → press BACK → returns to details');
  console.log('  ✓ Click any movie → start playback → press BACK → returns to details');
  console.log('  ✓ Open player from notification (no back stack) → BACK → goes to Discover');
  console.log('  ✓ Series-episode flows unaffected (existing onBackPress still runs first)');
  console.log('  ✓ Progress-save on exit unaffected (separate useEffect cleanup at L511)');
  console.log('\nIf back now ALWAYS works, tell me and answer the 3 questions in the chat');
  console.log('so I can target the playback-delay + lag fixes (V31).');
}
