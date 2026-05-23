/**
 * apply_patches_v89.js — fix v88 vertical-nav edge cases
 * =======================================================
 * Symptoms after v88:
 *   1. Pressing D-pad down at the bottom still scrolls past the last row.
 *   2. Pressing D-pad up from the bottom only snaps the previous row
 *      to ~75% of the viewport top (FlatList runs out of content below
 *      and clamps the scroll → viewPosition:0 cannot be reached).
 *   3. Holding D-pad up/down doesn't "fly" because rows beyond the
 *      initial render window aren't mounted yet, blocking native focus
 *      from hopping ahead.
 *
 * Fix (surgical edits to frontend/app/(tabs)/discover.tsx):
 *   A. Add `overScrollMode="never"` and `bounces={false}` to the outer
 *      FlatList → prevents the "still scrolls past last row" feel.
 *   B. Add `contentContainerStyle={{ paddingBottom: height }}` → gives
 *      every row enough room to reach viewPosition:0 at the top.
 *   C. Bump `initialNumToRender`, `maxToRenderPerBatch`, `windowSize`
 *      so all (or nearly all) rows mount eagerly → native focus engine
 *      can hop one row per repeat tick, enabling hold-to-fly.
 *   D. In handleFlatIndexFocus: when the index jump > 1, use
 *      `animated: false` so rapid d-pad holds feel instant
 *      (matches the horizontal hold-to-fly UX).
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root on Windows:
 *   node apply_patches_v89.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v89] FATAL:', msg); process.exit(1); }

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');

const MARKER = '/* V89_NAV_FIXES */';
if (src.includes(MARKER)) {
  console.log('[v89] already applied.');
  process.exit(0);
}

const useCRLF = src.includes('\r\n');
const eol = useCRLF ? '\r\n' : '\n';

// ─────────────────────────────────────────────────────────────
// EDIT 1 — replace handleFlatIndexFocus with a smart version
//          that uses animated:false for big jumps (hold-to-fly).
// ─────────────────────────────────────────────────────────────
const oldHandler =
  '  const handleFlatIndexFocus = useCallback((flatIndex: number) => {' + eol +
  '    if (lastFocusedFlatIndexRef.current === flatIndex) return;' + eol +
  '    lastFocusedFlatIndexRef.current = flatIndex;' + eol +
  '    const list = flatListRef.current;' + eol +
  '    if (!list) return;' + eol +
  '    try {' + eol +
  '      list.scrollToIndex({ index: flatIndex, animated: true, viewPosition: 0 });' + eol +
  '    } catch {' + eol +
  '      // Fallback — compute offset from any rows we\'ve already measured.' + eol +
  '      let offset = 0;' + eol +
  '      for (let i = 0; i < flatIndex; i++) {' + eol +
  '        offset += rowHeightsRef.current[i] ?? estimatedRowHeight;' + eol +
  '      }' + eol +
  '      list.scrollToOffset({ offset, animated: true });' + eol +
  '    }' + eol +
  '  }, [estimatedRowHeight]);';

const newHandler =
  '  // ' + MARKER + eol +
  '  const handleFlatIndexFocus = useCallback((flatIndex: number) => {' + eol +
  '    const prev = lastFocusedFlatIndexRef.current;' + eol +
  '    if (prev === flatIndex) return;' + eol +
  '    // Hold-to-fly: if user is hopping multiple rows fast, skip animation' + eol +
  '    // so focus moves "snap-snap-snap" instead of waiting on tweens.' + eol +
  '    const jump = Math.abs(flatIndex - prev);' + eol +
  '    const animated = (prev < 0) ? true : (jump <= 1);' + eol +
  '    lastFocusedFlatIndexRef.current = flatIndex;' + eol +
  '    const list = flatListRef.current;' + eol +
  '    if (!list) return;' + eol +
  '    try {' + eol +
  '      list.scrollToIndex({ index: flatIndex, animated, viewPosition: 0 });' + eol +
  '    } catch {' + eol +
  '      let offset = 0;' + eol +
  '      for (let i = 0; i < flatIndex; i++) {' + eol +
  '        offset += rowHeightsRef.current[i] ?? estimatedRowHeight;' + eol +
  '      }' + eol +
  '      list.scrollToOffset({ offset, animated });' + eol +
  '    }' + eol +
  '  }, [estimatedRowHeight]);';

if (!src.includes(oldHandler)) fail('handleFlatIndexFocus block not found verbatim.');
src = src.replace(oldHandler, newHandler);
console.log('[v89]   ok replaced handleFlatIndexFocus (hold-to-fly).');

// ─────────────────────────────────────────────────────────────
// EDIT 2 — outer FlatList props: render more, no over-scroll,
//          bigger paddingBottom, faster deceleration.
// ─────────────────────────────────────────────────────────────
const oldProps =
  '          <FlatList' + eol +
  '            ref={flatListRef}' + eol +
  '            style={styles.scrollView}' + eol +
  '            data={flatRowsV54}' + eol +
  '            keyExtractor={(item: any) => item.key}' + eol +
  '            showsVerticalScrollIndicator={false}' + eol +
  '            removeClippedSubviews={false}' + eol +
  '            windowSize={11}' + eol +
  '            initialNumToRender={4}' + eol +
  '            maxToRenderPerBatch={4}' + eol +
  '            updateCellsBatchingPeriod={50}';

const newProps =
  '          <FlatList' + eol +
  '            ref={flatListRef}' + eol +
  '            style={styles.scrollView}' + eol +
  '            contentContainerStyle={{ paddingBottom: height }}' + eol +
  '            data={flatRowsV54}' + eol +
  '            keyExtractor={(item: any) => item.key}' + eol +
  '            showsVerticalScrollIndicator={false}' + eol +
  '            removeClippedSubviews={false}' + eol +
  '            overScrollMode="never"' + eol +
  '            bounces={false}' + eol +
  '            decelerationRate="fast"' + eol +
  '            windowSize={31}' + eol +
  '            initialNumToRender={12}' + eol +
  '            maxToRenderPerBatch={8}' + eol +
  '            updateCellsBatchingPeriod={30}';

if (!src.includes(oldProps)) fail('Outer FlatList props block not found verbatim.');
src = src.replace(oldProps, newProps);
console.log('[v89]   ok upgraded outer FlatList props (paddingBottom, render window, overscroll off).');

// ─────────────────────────────────────────────────────────────
// EDIT 3 — bump bottomPadding height too (defensive, in case
//          paddingBottom on contentContainerStyle is overridden).
// ─────────────────────────────────────────────────────────────
const oldFooter = 'bottomPadding: { height: 100 },';
const newFooter = 'bottomPadding: { height: 0 },';
if (src.includes(oldFooter)) {
  src = src.replace(oldFooter, newFooter);
  console.log('[v89]   ok shrunk legacy bottomPadding (now handled by contentContainerStyle).');
}

// Backup + write
const bak = file + '.bak.v89.' + Date.now();
fs.writeFileSync(bak, fs.readFileSync(file, 'utf8'));
console.log('[v89]   backup:', bak);
fs.writeFileSync(file, src);

console.log('');
console.log('[v89] OK discover.tsx patched.');
console.log('[v89]');
console.log('[v89] Clear caches + rebuild:');
console.log('[v89]   del /q frontend\\android\\app\\src\\main\\assets\\index.android.bundle 2>nul');
console.log('[v89]   rmdir /s /q frontend\\android\\app\\build 2>nul');
console.log('[v89]   rmdir /s /q frontend\\node_modules\\.cache 2>nul');
console.log('[v89]');
console.log('[v89] Expected behavior on Firestick:');
console.log('[v89]   * D-pad down at the bottom row no longer scrolls past it.');
console.log('[v89]   * D-pad up from the bottom snaps the previous row to the very top.');
console.log('[v89]   * Holding D-pad up or down flies through rows like left/right does for posters.');
