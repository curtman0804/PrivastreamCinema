/**
 * apply_patches_v85.js
 * ====================
 * Add a second "lock" scrollTo at 400 ms so we always end up at our
 * target Y, even if Android TV scrolled or the user changed row mid-flight.
 *
 *   t = 50 ms  : scrollTo({ animated:true })  — smooth glide starts
 *   t = 400 ms : scrollTo({ animated:false }) — snap to target, lock it
 *
 * The second snap is invisible if the smooth animation already landed
 * us there; it's a corrective jump otherwise.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v85.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v85] FATAL:', msg); process.exit(1); }
function bw(file, src) {
  const b = file + '.bak.v85.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v85]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');

const MARKER = '/* LOCK_SCROLL_V85 */';
if (src.includes(MARKER)) {
  console.log('[v85] Already patched.');
  process.exit(0);
}

let changed = false;

// 1. Row: add a delayed lock-scroll after the smooth scrollTo.
const rowOld =
  'scrollViewRef.current?.scrollTo({ y: targetY, animated: true }); // /* SMOOTH_SNAP_V84 */';
const rowNew =
  'scrollViewRef.current?.scrollTo({ y: targetY, animated: true });\n' +
  '      setTimeout(() => {\n' +
  '        scrollViewRef.current?.scrollTo({ y: targetY, animated: false });\n' +
  '      }, 400); // ' + MARKER;
if (src.includes(rowOld)) {
  src = src.replace(rowOld, rowNew);
  console.log('[v85]   ✓ row scroll → smooth + 400ms lock');
  changed = true;
} else {
  console.log('[v85]   ! row scroll line not found verbatim. Looking for fallback variant...');
  const rowOldAlt = 'scrollViewRef.current?.scrollTo({ y: targetY, animated: true });';
  if (src.includes(rowOldAlt)) {
    src = src.replace(rowOldAlt, rowNew);
    console.log('[v85]   ✓ row scroll (fallback) → smooth + 400ms lock');
    changed = true;
  } else {
    fail('Row scrollTo line not found at all.');
  }
}

// 2. Section: same treatment for CW UP-snap.
const cwOld =
  'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true }); // /* SMOOTH_SNAP_V84 */';
const cwNew =
  'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true });\n' +
  '      setTimeout(() => {\n' +
  '        scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });\n' +
  '      }, 400); // ' + MARKER;
if (src.includes(cwOld)) {
  src = src.replace(cwOld, cwNew);
  console.log('[v85]   ✓ CW scroll → smooth + 400ms lock');
  changed = true;
} else {
  const cwOldAlt = 'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true });';
  if (src.includes(cwOldAlt)) {
    src = src.replace(cwOldAlt, cwNew);
    console.log('[v85]   ✓ CW scroll (fallback) → smooth + 400ms lock');
    changed = true;
  }
}

if (!changed) {
  console.log('[v85] Nothing changed.');
  process.exit(0);
}

bw(file, src);
console.log('');
console.log('[v85] ✅ discover.tsx patched.');
console.log('[v85]    Rebuild your APK.');
console.log('[v85]    UP and DOWN should both smoothly slide and then lock at the right spot.');
