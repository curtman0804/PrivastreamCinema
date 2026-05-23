/**
 * apply_patches_v82b.js
 * =====================
 * Bugfix for v82.
 *
 * v82 used `view.measureLayout(scrollViewRef)`, which returns the view's
 * VISUAL (on-screen) y position relative to the ScrollView, not its
 * position within the scrollable content. So scrollTo({y: visual_y})
 * only worked when scrollY was already 0.
 *
 * This patch:
 *   1. Tracks live `currentScrollY` via the ScrollView's onScroll handler.
 *   2. Adds it to the measureLayout result so we get the true content y
 *      every time:  contentY = visualY + currentScrollY.current
 *   3. Then scrollTo({y: contentY}) works correctly in any state.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v82b.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v82b] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function bw(file, src) {
  const b = file + '.bak.v82b.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v82b]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');
const eol = detectEol(src);
console.log('[v82b] Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

const MARKER = '/* SCROLL_OFFSET_TRACK_V82B */';
if (src.includes(MARKER)) {
  console.log('[v82b] Already patched.');
  process.exit(0);
}

let changed = false;

// 1. Add currentScrollY ref next to other refs.
const refAnchor = 'const lastFocusedRowRef = useRef<number>(-1);';
if (!src.includes(refAnchor)) fail('lastFocusedRowRef anchor missing.');
src = src.replace(
  refAnchor,
  refAnchor + eol +
    '  const currentScrollY = useRef<number>(0); // ' + MARKER
);
console.log('[v82b]   ✓ added currentScrollY ref');
changed = true;

// 2. Add onScroll handler to ScrollView.
//    Anchor on the scrollEventThrottle line which already exists.
const scrollAnchor = 'scrollEventThrottle={16}';
if (!src.includes(scrollAnchor)) fail('ScrollView scrollEventThrottle anchor missing.');
src = src.replace(
  scrollAnchor,
  scrollAnchor + eol +
    '          onScroll={(e) => { currentScrollY.current = e.nativeEvent.contentOffset.y; }}'
);
console.log('[v82b]   ✓ onScroll handler wired to ScrollView');

// 3. Modify the measureLayout success callback to add currentScrollY.
const cbOld = '(_x: number, y: number) => snap(y),';
const cbNew = '(_x: number, y: number) => snap(y + currentScrollY.current), // ' + MARKER;
if (src.includes(cbOld)) {
  src = src.replace(cbOld, cbNew);
  console.log('[v82b]   ✓ measureLayout callback now adds currentScrollY → true content y');
} else {
  fail('measureLayout success callback line not found. Did v82 apply?');
}

bw(file, src);
console.log('');
console.log('[v82b] ✅ discover.tsx patched.');
console.log('[v82b]    Rebuild your APK. UP and DOWN should both snap correctly now,');
console.log('[v82b]    regardless of current scroll position.');
