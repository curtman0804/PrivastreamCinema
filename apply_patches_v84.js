/**
 * apply_patches_v84.js
 * ====================
 * Tweak v83's row-snap to feel smooth and work going UP.
 *
 * Change:
 *   setTimeout(250) + animated:false   →   setTimeout(50) + animated:true
 *
 * Why:
 *   • animated:true gives the smooth Stremio-style glide.
 *   • A short 50 ms delay still ensures Android TV's auto-scroll has been
 *     dispatched before ours starts — so we win, but with a single
 *     continuous animation instead of a "wait, then jerky snap".
 *
 * Applies to both handleRowFocus and handleSectionFocus.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v84.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v84] FATAL:', msg); process.exit(1); }
function bw(file, src) {
  const b = file + '.bak.v84.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v84]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');

const MARKER = '/* SMOOTH_SNAP_V84 */';
if (src.includes(MARKER)) {
  console.log('[v84] Already patched.');
  process.exit(0);
}

let changed = false;

// 1. Row snap: change y → animated:true + 250 → 50
const rowOld1 = "scrollViewRef.current?.scrollTo({ y: targetY, animated: false });";
const rowNew1 = "scrollViewRef.current?.scrollTo({ y: targetY, animated: true }); // " + MARKER;
if (src.includes(rowOld1)) {
  src = src.replace(rowOld1, rowNew1);
  console.log('[v84]   ✓ handleRowFocus scroll → animated:true');
  changed = true;
} else {
  console.log('[v84]   ! handleRowFocus scrollTo line not found verbatim.');
}

// Section snap: same
const cwOld1 = "scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });";
const cwNew1 = "scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true }); // " + MARKER;
if (src.includes(cwOld1)) {
  src = src.replace(cwOld1, cwNew1);
  console.log('[v84]   ✓ handleSectionFocus scroll → animated:true');
  changed = true;
}

// 2. Lower the setTimeout from 250 ms to 50 ms (both occurrences).
const t250 = '}, 250);';
const t50 = '}, 50); // ' + MARKER;
let count = 0;
while (src.includes(t250)) {
  src = src.replace(t250, t50);
  count++;
  if (count > 5) break; // safety
}
if (count > 0) {
  console.log('[v84]   ✓ setTimeout delays reduced 250 → 50 ms (' + count + ' occurrences)');
  changed = true;
} else {
  console.log('[v84]   ! No setTimeout(250) found — was v83 applied?');
}

if (!changed) {
  console.log('[v84] Nothing to change.');
  process.exit(0);
}

bw(file, src);
console.log('');
console.log('[v84] ✅ discover.tsx patched.');
console.log('[v84]    Rebuild your APK. Scroll should now be smooth in BOTH directions.');
console.log('[v84]    If UP still misbehaves, paste a short description of what you see and');
console.log('[v84]    we will switch to manual UP/DOWN key interception via useTVEventHandler.');
