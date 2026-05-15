/* eslint-disable */
// apply_patches_v40.js — Turn off freezeOnBlur on tabs (kill the back→Discover re-mount storm)
// Run from project root:   node apply_patches_v40.js
//
// THE BUG (confirmed by findstr + your symptom description):
//   (tabs)/_layout.tsx line 36 has `freezeOnBlur: true,` (PATCH_V14B).
//   This DETACHES Discover from the React tree when you navigate to details.
//   When you press back, Discover RE-MOUNTS FROM SCRATCH:
//     ~20 ServiceRows × ~30 posters = ~600 components re-render
//   That happens DURING the back-slide animation → animation stutters →
//   "few seconds" delay. After the screen lands, JS thread is still recovering
//   → D-pad input feels laggy for the first second.
//
// THE FIX:
//   `freezeOnBlur: true` → `freezeOnBlur: false`. Discover stays mounted in
//   memory while you're on details. Return is instant. Scroll position and
//   focused poster are preserved. The cost is a few MB of RAM — irrelevant
//   on a Firestick.
//
// Single file. Single anchor. Idempotent. CRLF preserved.

const fs = require('fs');
const path = require('path');

const LAYOUT = path.join('frontend', 'app', '(tabs)', '_layout.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(LAYOUT)) { bad('not found: ' + LAYOUT); process.exit(1); }

let src = fs.readFileSync(LAYOUT, 'utf8');
const orig = src;
const bak = LAYOUT + '.bak.v40.' + Date.now();
fs.copyFileSync(LAYOUT, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + LAYOUT + ' ===');

const MARKER = 'PATCH_V40_NO_FREEZE';

if (src.includes(MARKER)) { ok('V40 already applied'); process.exit(0); }

// Match `freezeOnBlur: true,` allowing any indent. Use a regex so we keep the
// indent in the replacement.
const re = /^(\s*)freezeOnBlur:\s*true\s*,\s*$/m;
const m = src.match(re);

if (!m) {
  bad('could not find `freezeOnBlur: true,` anchor');
  info('Maybe already false, or the line was reformatted. Open _layout.tsx and');
  info('manually change `freezeOnBlur: true` to `freezeOnBlur: false`.');
} else {
  const occ = src.split(m[0]).length - 1;
  if (occ > 1) {
    bad('anchor matches ' + occ + ' times — refusing ambiguous');
  } else {
    const indent = m[1];
    const replacement =
      indent + '// ' + MARKER + ' — keep Discover mounted; back returns instantly.\n' +
      indent + 'freezeOnBlur: false,';
    src = src.replace(m[0], replacement);
    ok('freezeOnBlur: true → false');
  }
}

if (src !== orig && fail === 0) {
  fs.writeFileSync(LAYOUT, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + LAYOUT);
} else if (fail > 0) {
  info('failed — file NOT saved (original safe in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV40 done. Rebuild and test:');
  console.log('  ✓ Back from details → Discover appears INSTANTLY (no re-mount)');
  console.log('  ✓ Scroll position and focused poster preserved exactly');
  console.log('  ✓ D-pad responsive from frame 1 after back');
  console.log('  ✓ A few MB more RAM used — Firestick wont notice');
  console.log('\nCommit:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V40 — disable freezeOnBlur (no back→Discover re-mount)"');
}
