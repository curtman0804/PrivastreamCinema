/**
 * apply_patches_v80.js
 * ====================
 * Three coordinated fixes to make vertical navigation feel like Stremio:
 *
 *   1. INITIAL FOCUS
 *        • If Continue Watching is shown → first CW item gets preferred focus.
 *        • Otherwise → first poster of the first ServiceRow gets preferred focus.
 *      (Previously nothing on the Discover screen had `hasTVPreferredFocus`,
 *      so focus stayed on the bottom tab bar until the user moved up.)
 *
 *   2. SNAPPY SCROLL
 *        • scrollTo({ animated: true })  →  scrollTo({ animated: false })
 *        • Wrapped in requestAnimationFrame so it runs AFTER Android TV's
 *          own "bring focus into view" auto-scroll, which was previously
 *          stomping our snap a frame later.
 *
 *   3. CONSISTENT TITLE-AT-TOP
 *        • Already established by v79 (Math.max(0, y)), confirmed here.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v80.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v80] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function backupAndWrite(file, src) {
  const b = file + '.bak.v80.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v80]   backup:', b);
}

// ───────────────────────────────────────────────────────────────
// Patch discover.tsx
// ───────────────────────────────────────────────────────────────
const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');
const eol = detectEol(src);
console.log('[v80] Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

let changed = false;

// ===============================================================
// (1) SCROLL: animated:false + requestAnimationFrame in handleRowFocus
// ===============================================================
const rowMarker = '/* RAF_ROW_V80 */';
if (!src.includes(rowMarker)) {
  const rowOld = 'scrollViewRef.current.scrollTo({ y: targetY, animated: true });';
  if (!src.includes(rowOld)) {
    // Maybe already animated:false from a prior tweak — accept that
    if (src.includes('scrollViewRef.current.scrollTo({ y: targetY, animated: false })')) {
      console.log('[v80]   = handleRowFocus already animated:false');
    } else {
      fail('handleRowFocus scrollTo line not found (v78/v79 expected).');
    }
  } else {
    const rowNew =
      '// ' + rowMarker + ' — run AFTER Android TV auto-scroll' + eol +
      '    requestAnimationFrame(() => {' + eol +
      '      scrollViewRef.current?.scrollTo({ y: targetY, animated: false });' + eol +
      '    });';
    src = src.replace(rowOld, rowNew);
    console.log('[v80]   ✓ handleRowFocus → RAF + animated:false');
    changed = true;
  }
} else {
  console.log('[v80]   = handleRowFocus already wrapped in RAF');
}

// ===============================================================
// (2) SCROLL: animated:false + requestAnimationFrame in handleSectionFocus
// ===============================================================
const cwMarker = '/* RAF_CW_V80 */';
if (!src.includes(cwMarker)) {
  const cwOld = 'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true });';
  if (src.includes(cwOld)) {
    const cwNew =
      '// ' + cwMarker + eol +
      '      requestAnimationFrame(() => {' + eol +
      '        scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });' + eol +
      '      });';
    src = src.replace(cwOld, cwNew);
    console.log('[v80]   ✓ handleSectionFocus → RAF + animated:false');
    changed = true;
  } else {
    console.log('[v80]   ! handleSectionFocus scrollTo not found verbatim — skipping (non-fatal).');
  }
} else {
  console.log('[v80]   = handleSectionFocus already wrapped in RAF');
}

// ===============================================================
// (3) Drop the now-redundant 50ms setTimeout around handleSectionFocus
//     (we use RAF instead — cleaner ordering, lower latency).
// ===============================================================
const stoBlock = /setTimeout\(\(\) => \{\s*\/\/ RAF_CW_V80[\s\S]*?\}, 50\);/;
if (stoBlock.test(src)) {
  src = src.replace(stoBlock, function (m) {
    // Strip the outer setTimeout(() => { ... }, 50); wrapper, keep inner RAF.
    return m
      .replace(/^setTimeout\(\(\) => \{\s*/, '')
      .replace(/\s*\}, 50\);$/, '');
  });
  console.log('[v80]   ✓ removed the redundant setTimeout(...,50) around handleSectionFocus');
  changed = true;
}

// ===============================================================
// (4) INITIAL FOCUS: pass `isFirstRow` to the first ServiceRow when there
//     is NO Continue Watching, and pass a `hasTVPreferredFocus` flag to the
//     first ContinueWatchingItem when CW IS present.
// ===============================================================

// 4a. Pass isFirstRow to ServiceRow
const isFirstMarker = '/* FIRST_ROW_FOCUS_V80 */';
if (!src.includes(isFirstMarker)) {
  const srAnchor = 'rowIndex={item.rowIdx}';
  if (!src.includes(srAnchor)) fail('ServiceRow rowIndex prop not found.');
  // Inject `isFirstRow={...}` right after rowIndex prop on the SAME line block.
  // Use a per-occurrence flag so we don't double-inject.
  if (!src.includes('isFirstRow={')) {
    src = src.replace(
      srAnchor,
      srAnchor + eol +
        '                isFirstRow={continueWatching.length === 0 && item.rowIdx === 0} // ' + isFirstMarker
    );
    console.log('[v80]   ✓ first ServiceRow now gets isFirstRow when no CW');
    changed = true;
  } else {
    console.log('[v80]   = isFirstRow prop already wired');
  }
} else {
  console.log('[v80]   = first-row focus marker already present');
}

// 4b. Pull `index` out of the FlatList renderItem callback so we can pass it
//     down to ContinueWatchingItem.
const renderOld = '({ item }: { item: WatchProgress }) => (';
const renderNew = '({ item, index }: { item: WatchProgress; index: number }) => (';
if (src.includes(renderOld)) {
  src = src.replace(renderOld, renderNew);
  console.log('[v80]   ✓ renderContinueWatchingItem now exposes index');
  changed = true;
} else if (src.includes(renderNew)) {
  console.log('[v80]   = renderContinueWatchingItem already exposes index');
} else {
  console.log('[v80]   ! renderContinueWatchingItem signature not found verbatim — skipping.');
}

// 4c. Pass hasTVPreferredFocus={index === 0} to ContinueWatchingItem.
//     Anchor on the existing onSectionFocus prop.
const cwiAnchor = "onSectionFocus={() => handleSectionFocus('continue-watching')}";
if (src.includes(cwiAnchor) && !src.includes('hasTVPreferredFocus={index === 0}')) {
  src = src.replace(
    cwiAnchor,
    cwiAnchor + eol +
      '      hasTVPreferredFocus={index === 0}'
  );
  console.log('[v80]   ✓ first ContinueWatchingItem now gets hasTVPreferredFocus');
  changed = true;
} else if (src.includes('hasTVPreferredFocus={index === 0}')) {
  console.log('[v80]   = ContinueWatchingItem already gets hasTVPreferredFocus');
}

// 4d. Make ContinueWatchingItem actually accept + use hasTVPreferredFocus.
//     Add it to the props interface block and to the Pressable for the poster.
//     Interface block:
const propsOld = 'onSectionFocus?: () => void;';
const propsNew = 'onSectionFocus?: () => void;' + eol + '  hasTVPreferredFocus?: boolean;';
if (src.includes(propsOld) && !src.includes('hasTVPreferredFocus?:')) {
  src = src.replace(propsOld, propsNew);
  console.log('[v80]   ✓ ContinueWatchingItem props interface extended');
  changed = true;
}
// Destructure:
const dsOld = 'onSectionFocus,\n}: {';
const dsOldCrlf = 'onSectionFocus,\r\n}: {';
const dsNew = 'onSectionFocus,' + eol + '  hasTVPreferredFocus = false,' + eol + '}: {';
if (!src.includes('hasTVPreferredFocus = false')) {
  if (src.includes(dsOldCrlf)) {
    src = src.replace(dsOldCrlf, dsNew);
    console.log('[v80]   ✓ ContinueWatchingItem destructured hasTVPreferredFocus (CRLF)');
    changed = true;
  } else if (src.includes(dsOld)) {
    src = src.replace(dsOld, dsNew);
    console.log('[v80]   ✓ ContinueWatchingItem destructured hasTVPreferredFocus (LF)');
    changed = true;
  } else {
    console.log('[v80]   ! ContinueWatchingItem destructure not found verbatim — skipping (non-fatal).');
  }
}
// Pressable: add the prop to the poster Pressable. Anchor on its onFocus.
const pressAnchor = 'onFocus={handleFocus}';
if (src.includes(pressAnchor) && !src.includes('hasTVPreferredFocus={hasTVPreferredFocus}')) {
  src = src.replace(
    pressAnchor,
    pressAnchor + eol + '        hasTVPreferredFocus={hasTVPreferredFocus}'
  );
  console.log('[v80]   ✓ ContinueWatchingItem poster Pressable gets hasTVPreferredFocus');
  changed = true;
}

if (!changed) {
  console.log('[v80] Nothing to change. File already up-to-date.');
  process.exit(0);
}

backupAndWrite(file, src);
console.log('');
console.log('[v80] ✅ discover.tsx patched.');
console.log('[v80]    Rebuild your APK. Then:');
console.log('[v80]      • App opens → first CW item (or first row\'s first poster) is focused.');
console.log('[v80]      • DOWN/UP → focused row\'s title instantly at the top of the scroll area.');
console.log('[v80]      • No animation — snappy.');
