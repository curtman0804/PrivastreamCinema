/* eslint-disable */
// apply_patches_v35.js — fix back from player → back from details going nowhere
// Run from project root:   node apply_patches_v35.js
//
// THE BUG (confirmed by show_back_state.js):
//   player.tsx onBackPress builds a `target` like "/details/movie/apex" and
//   calls router.replace(target). This REPLACES player with details in the
//   stack instead of popping player off. Result:
//     stack before back: [Discover, details, player]
//     stack after back : [Discover, details, details]  ← duplicate
//   Pressing back again pops the duplicate details → you see the same details
//   page → "back does nothing". Exactly what you're seeing.
//
// THE FIX:
//   Prefer router.back() when there's history (pops player → exposes the
//   existing details). Only use router.replace(target) when canGoBack() is
//   false (deep-linked into player with empty stack).
//
//   Before:
//     if (target) {
//       router.replace(target as any);
//     } else {
//       router.back();
//     }
//
//   After:
//     if (router.canGoBack && router.canGoBack()) {
//       router.back();
//     } else if (target) {
//       router.replace(target as any);
//     } else {
//       router.back();
//     }
//
// Single file. Single anchor. Single replace. CRLF preserved.

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
const bak = PLAYER + '.bak.v35.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + PLAYER + ' ===');

const MARKER = 'PATCH_V35_BACK_POP_PREFER';

if (src.includes(MARKER)) { ok('V35 already applied'); process.exit(0); }

// Anchor from diagnostic L267:  "          router.replace(target as any);"
const anchor = "          router.replace(target as any);";
const occ = src.split(anchor).length - 1;

if (occ === 0) {
  bad("anchor not found — trying alternative indent");
  const anchor2 = "        router.replace(target as any);";
  const occ2 = src.split(anchor2).length - 1;
  if (occ2 === 1) {
    const repl2 = [
      "        // " + MARKER + " — pop player first; replace only as deep-link fallback",
      "        if (router.canGoBack && router.canGoBack()) {",
      "          router.back();",
      "        } else {",
      "          router.replace(target as any);",
      "        }",
    ].join('\n');
    src = src.replace(anchor2, repl2);
    ok('replaced (8-space indent variant)');
  } else if (occ2 > 1) {
    bad('alt anchor matches ' + occ2 + ' times');
  } else {
    bad('no variant of the anchor matched');
  }
} else if (occ > 1) {
  bad("anchor matches " + occ + " times — refusing ambiguous");
} else {
  const replacement = [
    "          // " + MARKER + " — pop player first; replace only as deep-link fallback",
    "          if (router.canGoBack && router.canGoBack()) {",
    "            router.back();",
    "          } else {",
    "            router.replace(target as any);",
    "          }",
  ].join('\n');
  src = src.replace(anchor, replacement);
  ok('replaced router.replace(target) with canGoBack-prefer-back logic');
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
  console.log('\nV35 done. Rebuild and test:');
  console.log('  ✓ Discover → Apex → Play → BACK → Apex details');
  console.log('  ✓ Apex details → BACK → Discover  ← THIS NOW WORKS');
  console.log('  ✓ Rick&Morty → ep → Play → BACK → ep details → BACK → series root → BACK → Discover');
  console.log('\nWhen this works, commit it locked-in:');
  console.log('  git add -A');
  console.log('  git commit -m "fix: V34+V35 back nav (player pops instead of duplicating details)"');
}
