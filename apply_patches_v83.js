/**
 * apply_patches_v83.js
 * ====================
 * Replace handleRowFocus with the simplest possible implementation that
 * reliably wins the race against Android TV's native focus-into-view
 * auto-scroll.
 *
 * Approach:
 *   1. Use the cached y from onLayout (it's content-relative; correct).
 *   2. Schedule scrollTo via setTimeout(250 ms) — long enough that
 *      Android TV has finished its own auto-scroll before we apply ours.
 *   3. Cancel any previous pending snap if focus changes again before
 *      250 ms elapses (so fast D-pad scrolling stays smooth).
 *   4. animated:false → instant snap, no smoothing.
 *
 * No measureLayout, no scroll-offset tracking, no RAFs — just one cheap
 * setTimeout per row change.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v83.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v83] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function bw(file, src) {
  const b = file + '.bak.v83.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v83]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');
const eol = detectEol(src);
console.log('[v83] Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

const MARKER = '/* SIMPLE_SNAP_V83 */';
if (src.includes(MARKER)) {
  console.log('[v83] Already patched.');
  process.exit(0);
}

// 1. Add snapTimerRef next to other refs (cancel pending on re-focus).
const refAnchor = 'const lastFocusedRowRef = useRef<number>(-1);';
if (!src.includes(refAnchor)) fail('lastFocusedRowRef anchor missing.');
src = src.replace(
  refAnchor,
  refAnchor + eol +
    '  const snapTimerRef = useRef<any>(null); // ' + MARKER
);
console.log('[v83]   ✓ added snapTimerRef');

// 2. Rewrite handleRowFocus body — flexible regex matching v78–v82b variants.
const fnRe = /const handleRowFocus = useCallback\(\([^)]*\) => \{[\s\S]*?\}, \[\]\);/;
if (!fnRe.test(src)) fail('handleRowFocus function not found.');

const newBody =
  'const handleRowFocus = useCallback((rowIndex: number) => {' + eol +
  '    // ' + MARKER + '  — long setTimeout to outlast Android TV auto-scroll' + eol +
  '    if (snapTimerRef.current) {' + eol +
  '      clearTimeout(snapTimerRef.current);' + eol +
  '      snapTimerRef.current = null;' + eol +
  '    }' + eol +
  '    if (lastFocusedRowRef.current === rowIndex) return;' + eol +
  '    lastFocusedRowRef.current = rowIndex;' + eol +
  '' + eol +
  '    const y = rowYPositionsRef.current[rowIndex];' + eol +
  '    if (y === undefined || !scrollViewRef.current) return;' + eol +
  '' + eol +
  '    const targetY = Math.max(0, y);' + eol +
  '    snapTimerRef.current = setTimeout(() => {' + eol +
  '      snapTimerRef.current = null;' + eol +
  '      scrollViewRef.current?.scrollTo({ y: targetY, animated: false });' + eol +
  '    }, 250);' + eol +
  '  }, []);';

src = src.replace(fnRe, newBody);
console.log('[v83]   ✓ handleRowFocus rewritten — cached y + setTimeout(250) + animated:false');

// 3. Same treatment for handleSectionFocus (CW UP-snap).
//    Replace whatever scroll dispatch is currently in there with a
//    simple setTimeout-based snap.
const sectionFnRe = /const handleSectionFocus = useCallback\(\([^)]*\) => \{[\s\S]*?\}, \[\]\);/;
if (sectionFnRe.test(src)) {
  const newSection =
    'const handleSectionFocus = useCallback((sectionKey: string) => {' + eol +
    '    // ' + MARKER + eol +
    '    if (lastFocusedSection.current === sectionKey) return;' + eol +
    '    lastFocusedSection.current = sectionKey;' + eol +
    '    if (snapTimerRef.current) {' + eol +
    '      clearTimeout(snapTimerRef.current);' + eol +
    '      snapTimerRef.current = null;' + eol +
    '    }' + eol +
    '    const sectionY = sectionPositions.current[sectionKey];' + eol +
    '    if (sectionY === undefined || !scrollViewRef.current) return;' + eol +
    '    snapTimerRef.current = setTimeout(() => {' + eol +
    '      snapTimerRef.current = null;' + eol +
    '      scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });' + eol +
    '    }, 250);' + eol +
    '  }, []);';
  src = src.replace(sectionFnRe, newSection);
  console.log('[v83]   ✓ handleSectionFocus rewritten — same simple approach');
} else {
  console.log('[v83]   ! handleSectionFocus not found verbatim — skipping (non-fatal).');
}

bw(file, src);
console.log('');
console.log('[v83] ✅ discover.tsx patched.');
console.log('[v83]    Rebuild your APK. UP and DOWN should both snap reliably.');
console.log('[v83]    The 250 ms delay is invisible to humans but lets Android TV finish its');
console.log('[v83]    own scroll before ours, eliminating the race.');
