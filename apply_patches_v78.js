/**
 * apply_patches_v78.js — Stremio-style row-snap navigation
 * =========================================================
 * Fixes the "click DOWN twice to reach next row" problem in Discover.
 *
 * Root cause: discover.tsx has a `sectionPositions` ref and a
 * `handleSectionFocus` scroller, but they were never wired up. So
 * when focus moves to the next row's card (off-screen), nothing
 * scrolls until Android TV's default focus-into-view kicks in lazily.
 *
 * Fix:
 *   1) ServiceRow measures its own Y inside the outer ScrollView and
 *      reports it via a new `onRowLayout(rowIndex, y)` callback.
 *   2) ServiceRow fires a new `onRowFocus(rowIndex)` whenever any
 *      card inside it receives focus.
 *   3) Discover keeps a Record<rowIndex, y> ref and on row-focus
 *      scrolls so the focused row slides up to where Row 0 sits.
 *      → Next row "takes the place of" the previous row, like Stremio.
 *
 * Idempotent. CRLF-safe. Safe to re-run.
 *
 * Usage from C:\Users\Curtm\PrivastreamCinema :
 *   node apply_patches_v78.js
 */

const fs = require('fs');
const path = require('path');

const SR_CANDIDATES = [
  path.join('frontend', 'src', 'components', 'ServiceRow.tsx'),
  path.join('src', 'components', 'ServiceRow.tsx'),
];
const DS_CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const MARKER = '=== ROW_SNAP_V78 ===';

function fail(msg) {
  console.error('[v78] FATAL:', msg);
  process.exit(1);
}
function find(cands, label) {
  const hit = cands.find(p => fs.existsSync(p));
  if (!hit) fail(`Could not find ${label} (looked in: ${cands.join(', ')})`);
  return hit;
}
function backupAndWrite(file, newSrc) {
  const backup = file + '.bak.v78.' + Date.now();
  fs.writeFileSync(backup, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, newSrc);
  console.log('[v78]   backup:', backup);
}
function detectEol(src) {
  return src.includes('\r\n') ? '\r\n' : '\n';
}

// ────────────────────────────────────────────────────────────────
// 1) Patch ServiceRow.tsx
// ────────────────────────────────────────────────────────────────
function patchServiceRow() {
  const file = find(SR_CANDIDATES, 'ServiceRow.tsx');
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes(MARKER)) {
    console.log('[v78] ServiceRow.tsx already patched — skipping.');
    return;
  }
  console.log('[v78] Patching:', file);
  const eol = detectEol(src);
  console.log('[v78]   EOL:', eol === '\r\n' ? 'CRLF' : 'LF');

  // ── 1a. Add new optional props to interface ServiceRowProps
  const propsAnchor = '  rowIndex?: number;';
  if (!src.includes(propsAnchor)) fail('SR anchor #1a (interface rowIndex) missing.');
  if (!src.includes('onRowFocus?:')) {
    src = src.replace(
      propsAnchor,
      propsAnchor +
        eol +
        '  onRowFocus?: (rowIndex: number) => void; // ' + MARKER +
        eol +
        '  onRowLayout?: (rowIndex: number, y: number) => void;'
    );
    console.log('[v78]   ✓ interface props added');
  }

  // ── 1b. Destructure new props
  const destructAnchor = '    rowIndex = 0,';
  if (!src.includes(destructAnchor)) fail('SR anchor #1b (destructure rowIndex) missing.');
  src = src.replace(
    destructAnchor,
    destructAnchor + eol + '    onRowFocus,' + eol + '    onRowLayout,'
  );
  console.log('[v78]   ✓ destructure added');

  // ── 1c. Call onRowFocus inside handleCardFocus (right after the
  //        existing onSectionFocus?.() call)
  const focusAnchor = '        onSectionFocus?.();';
  if (!src.includes(focusAnchor)) fail('SR anchor #1c (onSectionFocus call) missing.');
  src = src.replace(
    focusAnchor,
    focusAnchor + eol + eol + '        onRowFocus?.(rowIndex); // ' + MARKER
  );
  console.log('[v78]   ✓ onRowFocus call wired into handleCardFocus');

  // ── 1d. Wrap the LazyMount return in a measuring <View>.
  //        Anchor on the opening tag:
  const openAnchor = '      <LazyMount height={200} rowIndex={rowIndex}>';
  if (!src.includes(openAnchor)) fail('SR anchor #1d-open (LazyMount open) missing.');
  src = src.replace(
    openAnchor,
    '      <View' + eol +
    '        onLayout={(e) => onRowLayout?.(rowIndex, e.nativeEvent.layout.y)}' + eol +
    '      >' + eol +
    '        <LazyMount height={200} rowIndex={rowIndex}>'
  );

  //        and the matching close:
  const closeAnchor = '      </LazyMount>' + eol + '    );';
  if (!src.includes(closeAnchor)) {
    // Try alternative EOL just in case
    const altClose = '      </LazyMount>\n    );';
    if (src.includes(altClose)) {
      src = src.replace(altClose, '        </LazyMount>\n      </View>\n    );');
    } else {
      fail('SR anchor #1d-close (LazyMount close) missing.');
    }
  } else {
    src = src.replace(
      closeAnchor,
      '        </LazyMount>' + eol + '      </View>' + eol + '    );'
    );
  }

  // Also need to re-indent inner closing tags one level deeper to keep
  // them visually aligned. Not critical (TS doesn't care about indent),
  // so we leave them as-is. Compilation is unaffected.
  console.log('[v78]   ✓ outer <View onLayout> wrapper added');

  backupAndWrite(file, src);
  console.log('[v78] ServiceRow.tsx ✅ patched.');
}

// ────────────────────────────────────────────────────────────────
// 2) Patch discover.tsx
// ────────────────────────────────────────────────────────────────
function patchDiscover() {
  const file = find(DS_CANDIDATES, 'discover.tsx');
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes(MARKER)) {
    console.log('[v78] discover.tsx already patched — skipping.');
    return;
  }
  console.log('[v78] Patching:', file);
  const eol = detectEol(src);
  console.log('[v78]   EOL:', eol === '\r\n' ? 'CRLF' : 'LF');

  // ── 2a. Add row position ref + last-focused row ref next to the
  //        existing sectionPositions ref.
  const refAnchor = "  const sectionPositions = useRef<Record<string, number>>({});";
  if (!src.includes(refAnchor)) fail('DS anchor #2a (sectionPositions) missing.');
  src = src.replace(
    refAnchor,
    refAnchor + eol +
      '  // ' + MARKER + eol +
      '  const rowYPositionsRef = useRef<Record<number, number>>({});' + eol +
      '  const lastFocusedRowRef = useRef<number>(-1);'
  );
  console.log('[v78]   ✓ rowYPositionsRef + lastFocusedRowRef added');

  // ── 2b. Add handleRowLayout + handleRowFocus callbacks. Inject them
  //        right before the existing handleSectionFocus.
  const handlerAnchor = '  // Handle section focus - scroll parent to show category title';
  if (!src.includes(handlerAnchor)) fail('DS anchor #2b (handleSectionFocus comment) missing.');
  const handlerBlock =
    '  // ' + MARKER + ' — Stremio-style row snap' + eol +
    '  const handleRowLayout = useCallback((rowIndex: number, y: number) => {' + eol +
    '    rowYPositionsRef.current[rowIndex] = y;' + eol +
    '  }, []);' + eol + eol +
    '  const handleRowFocus = useCallback((rowIndex: number) => {' + eol +
    '    if (lastFocusedRowRef.current === rowIndex) return;' + eol +
    '    lastFocusedRowRef.current = rowIndex;' + eol +
    '    const y = rowYPositionsRef.current[rowIndex];' + eol +
    '    if (y === undefined || !scrollViewRef.current) return;' + eol +
    '    const firstRowY = rowYPositionsRef.current[0] ?? 0;' + eol +
    '    const targetY = Math.max(0, y - firstRowY);' + eol +
    '    scrollViewRef.current.scrollTo({ y: targetY, animated: true });' + eol +
    '  }, []);' + eol + eol;
  src = src.replace(handlerAnchor, handlerBlock + handlerAnchor);
  console.log('[v78]   ✓ handleRowLayout + handleRowFocus inserted');

  // ── 2c. Pass new props to <ServiceRow ... />. Anchor on the trailing
  //        `rowIndex={item.rowIdx}` line.
  const passAnchor = 'rowIndex={item.rowIdx}';
  if (!src.includes(passAnchor)) fail('DS anchor #2c (rowIndex pass) missing.');
  src = src.replace(
    passAnchor,
    passAnchor + eol +
      '                onRowFocus={handleRowFocus}' + eol +
      '                onRowLayout={handleRowLayout}'
  );
  console.log('[v78]   ✓ onRowFocus / onRowLayout wired into <ServiceRow>');

  backupAndWrite(file, src);
  console.log('[v78] discover.tsx ✅ patched.');
}

// ────────────────────────────────────────────────────────────────
patchServiceRow();
console.log('');
patchDiscover();
console.log('');
console.log('[v78] 🎯 All done. Rebuild your APK and side-load.');
console.log('[v78]    Press DOWN on any poster → next row slides up to take the spot. Stremio-style.');
