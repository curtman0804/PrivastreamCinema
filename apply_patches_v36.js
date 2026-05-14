/* eslint-disable */
// apply_patches_v36.js — Stop overriding back in the player. Let expo-router do its job.
// Run from project root:   node apply_patches_v36.js
//
// THE BUG (after V35):
//   player.tsx onBackPress was rewriting navigation (router.replace OR router.back
//   with canGoBack). Something in that path is popping past details directly to
//   Discover. We've been chasing logic in a custom handler when the entire
//   handler shouldn't exist.
//
// THE FIX:
//   Change BackHandler.addEventListener('hardwareBackPress', onBackPress)
//   into     BackHandler.addEventListener('hardwareBackPress', () => false).
//
//   Returning false means "I don't consume this event". expo-router's stack
//   navigator then handles it natively: pop the top screen (the player) and
//   show whatever was underneath (the details page). No custom logic, no
//   replace, no canGoBack guesswork. Just pop.
//
//   onBackPress() function body is left in place (used elsewhere if any),
//   but it's no longer wired to the hardware back press.
//
// Progress-save on exit lives in a SEPARATE useEffect cleanup (player.tsx L511)
// that fires on unmount no matter how you exit — so it still works.
//
// Single file. Single anchor. Single string-replace. CRLF preserved.

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
const bak = PLAYER + '.bak.v36.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + PLAYER + ' ===');

const MARKER = 'PATCH_V36_PLAYER_NATIVE_BACK';

if (src.includes(MARKER)) { ok('V36 already applied'); process.exit(0); }

// Anchor: BackHandler.addEventListener registration in the player.
// From the diagnostic (L276) this line is verbatim:
//   "    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);"
const candidates = [
  "    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);",
  "  const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);",
];

let matched = null, indent = '';
for (const c of candidates) {
  const occ = src.split(c).length - 1;
  if (occ === 1) { matched = c; indent = c.match(/^\s*/)[0]; break; }
  if (occ > 1)   { bad('anchor "' + c.trim() + '" matched ' + occ + ' times'); }
}

if (!matched) {
  bad('could not find player BackHandler registration anchor');
} else {
  const replacement = [
    indent + "// " + MARKER + " — let expo-router's stack navigator pop natively.",
    indent + "// Returning false delegates the back press to the navigator's default,",
    indent + "// which simply pops the player off the stack and reveals details underneath.",
    indent + "// No custom routing here = no chance to over-pop or duplicate screens.",
    indent + "// Progress-save on exit lives in a separate useEffect cleanup, so unmount-",
    indent + "// driven save still happens regardless of how the player closes.",
    indent + "const sub = BackHandler.addEventListener('hardwareBackPress', () => false);",
  ].join('\n');
  src = src.replace(matched, replacement);
  ok('player back handler now returns false → expo-router handles pop natively');
}

if (src !== orig && fail === 0) {
  fs.writeFileSync(PLAYER, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + PLAYER);
} else if (fail > 0) {
  info('failed — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV36 done. Rebuild and test on Firestick:');
  console.log('  ✓ Discover → Apex → Play → BACK → Apex card (player pops, details exposed)');
  console.log('  ✓ Apex card → BACK → Discover (V34 details handler)');
  console.log('  ✓ Discover → BACK → nothing (V34 root no-op)');
  console.log('  ✓ Series episode → Play → BACK → episode → BACK → series root → BACK → Discover');
  console.log('\nWhen this works, COMMIT IT:');
  console.log('  git add -A');
  console.log('  git commit -m "fix: V34 + V36 — back nav works at every level (native pop)"');
}
