/* eslint-disable */
// apply_patches_v38.js — Kill V19C focus prefetch (D-pad lag), the RIGHT way this time
// Run from project root:   node apply_patches_v38.js
//
// THE BUG (confirmed from your code dump):
//   ContentCard.tsx handleFocus schedules a 800ms setTimeout that calls
//   _store.prefetchStreams(_type, _id) on line 157. Every D-pad focus event
//   queues another prefetch. Rapid D-pad nav across many posters fires many
//   prefetches → backend hammered → JS thread fragmented → laggy.
//
// THE FIX:
//   Comment out exactly the prefetch CALL line. The setTimeout still runs but
//   the body becomes a no-op. The handoff explicitly said this prefetch was
//   rolled back — we're now respecting that.
//
//     Before:  _store.prefetchStreams(_type, _id);
//     After:   // V38_V19C_KILL — disabled; was hammering backend on D-pad nav
//              // _store.prefetchStreams(_type, _id);
//
// Single file. Single anchor. Idempotent. CRLF preserved.

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
const bak = CARD + '.bak.v38.' + Date.now();
fs.copyFileSync(CARD, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ContentCard.tsx ===');

const MARKER = 'V38_V19C_KILL';

if (src.includes(MARKER)) { ok('V38 already applied'); process.exit(0); }

// Find the prefetch call regardless of exact indent. Match the WHOLE LINE so
// we keep the indent and just comment it out + add a comment above.
const callRe = /^(\s*)(_store\.prefetchStreams\(_type, _id\);)\s*$/m;
const m = src.match(callRe);

if (!m) {
  bad('could not find `_store.prefetchStreams(_type, _id);` line');
  info('Maybe already removed, or code structure changed.');
} else {
  const indent = m[1];
  const replacement = [
    indent + '// ' + MARKER + ' — V19C focus prefetch disabled. Was hammering the backend',
    indent + '// during rapid D-pad nav across posters → laggy. The handoff explicitly',
    indent + '// said this should be rolled back. To re-enable: uncomment the next line.',
    indent + '// ' + m[2],
  ].join('\n');
  src = src.replace(m[0], replacement);
  ok('commented out _store.prefetchStreams call');
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
  console.log('\nFailed. Original safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV38 done. Rebuild and test:');
  console.log('  ✓ Discover D-pad left/right/up/down → SMOOTH, no queued network bursts');
  console.log('  ✓ No more backend hammer when scrubbing through posters');
  console.log('  ✓ Tap a poster → still fast (V37 details defer still active)');
  console.log('\nCommit when verified:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V37 + V38 — fast posters + smooth D-pad"');
}
