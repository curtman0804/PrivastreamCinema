/* eslint-disable */
// fix_v37b.js — Repair the broken `if (false)` line V37 FIX B injected into ContentCard.tsx
// Run from project root:   node fix_v37b.js
//
// THE BUG:
//   V37 FIX B inserted:
//     if (false) /* PATCH_V37_KILL_V19C_PREFETCH short-circuit — see comments above */
//   directly before `const _prefetchTimerRef = useRef<any>(null);`.
//   In JS/TS, a `const` declaration cannot be the consequent of a single-statement
//   `if`. Build fails. My bad — overly clever.
//
// THE FIX:
//   Remove just the broken `if (false)` line. Leave the V37 comment block above it
//   alone (it's all comments, harmless, and useful as an audit trail).
//   This restores the file to a buildable state. The V19C prefetch will be ACTIVE
//   AGAIN — meaning D-pad lag from V19C will return. We'll re-kill V19C properly
//   in V38 once I see the exact code structure (a small targeted diagnostic).
//
// V37 FIX A (details defer) is unaffected — it lives in a different file.

const fs = require('fs');
const path = require('path');

const CARD = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(CARD)) { bad('not found: ' + CARD); process.exit(1); }

let src = fs.readFileSync(CARD, 'utf8');
const orig = src;
const bak = CARD + '.bak.fixv37b.' + Date.now();
fs.copyFileSync(CARD, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Removing broken `if (false)` line ===');

// Match the whole line containing the marker, including its trailing newline.
const re = /^\s*if\s*\(\s*false\s*\)\s*\/\*\s*PATCH_V37_KILL_V19C_PREFETCH[^\n]*\n?/m;

const m = src.match(re);
if (!m) {
  bad('broken `if (false)` line not found');
  info('Maybe already fixed, or V37 FIX B was never applied to this file.');
} else {
  info('found broken line: ' + m[0].trim());
  src = src.replace(re, '');
  ok('removed broken `if (false)` line');
}

if (src !== orig && fail === 0) {
  fs.writeFileSync(CARD, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + CARD);
} else if (fail > 0) {
  info('failed — file NOT saved (original safe in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nDone. Build should pass now.');
  console.log('');
  console.log('Status:');
  console.log('  ✓ V37 FIX A (details defer fetchStreams) — STILL ACTIVE → faster poster taps');
  console.log('  ✗ V37 FIX B (kill V19C prefetch) — REMOVED → D-pad lag from V19C is BACK');
  console.log('');
  console.log('Next:');
  console.log('  1. Build + verify poster tap is fast (V37 FIX A win)');
  console.log('  2. If D-pad still laggy, send me a tiny ContentCard diagnostic and');
  console.log('     I will kill V19C correctly in V38 (precise anchor on the prefetch');
  console.log('     CALL, not on the const declaration).');
}
