/**
 * apply_patches_v82.js
 * ====================
 * Robust row-snap: use measureLayout for fresh native positions on every
 * focus, instead of cached onLayout values which can be stale during the
 * LazyMount staggered-render window (~600 ms after Discover opens).
 *
 * Strategy:
 *   1. ServiceRow exposes its outer-wrap View via a ref, which it passes
 *      up to discover through the existing `onRowFocus` callback as a
 *      second argument.
 *   2. discover's handleRowFocus calls `rowView.measureLayout(scrollHandle,...)`
 *      to get the CURRENT y position relative to the ScrollView, then
 *      scrollTo's there inside double-RAF.
 *   3. Falls back to the cached y if measureLayout fails for any reason.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v82.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v82] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function bw(file, src) {
  const b = file + '.bak.v82.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v82]   backup:', b);
}
function find(cands, label) {
  const hit = cands.find(p => fs.existsSync(p));
  if (!hit) fail('Could not find ' + label);
  return hit;
}

const MARKER = '/* MEASURE_LAYOUT_V82 */';

// ─────────────────────────────────────────────────────────
// (A) ServiceRow.tsx — expose wrapping View ref via onRowFocus
// ─────────────────────────────────────────────────────────
function patchServiceRow() {
  const file = find(
    [
      path.join('frontend', 'src', 'components', 'ServiceRow.tsx'),
      path.join('src', 'components', 'ServiceRow.tsx'),
    ],
    'ServiceRow.tsx'
  );
  let src = fs.readFileSync(file, 'utf8');
  const eol = detectEol(src);
  console.log('[v82] (A) Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

  if (src.includes(MARKER)) {
    console.log('[v82]   = already patched');
    return;
  }

  // A1. Add rowWrapRef declaration just below isNavigatingInRowRef
  const refAnchor = 'const isNavigatingInRowRef = useRef(false);';
  if (!src.includes(refAnchor)) fail('isNavigatingInRowRef anchor missing.');
  src = src.replace(
    refAnchor,
    refAnchor + eol + eol +
    '    const rowWrapRef = useRef<View>(null); // ' + MARKER
  );

  // A2. Attach ref={rowWrapRef} to the outer wrap View added in v78.
  //     Anchor on the onLayout line so we add ref on the line above.
  const layoutAnchor = '<View' + eol + '        onLayout={(e) => onRowLayout?.(rowIndex, e.nativeEvent.layout.y)}';
  if (!src.includes(layoutAnchor)) {
    // Try LF
    const lfAnchor = '<View\n        onLayout={(e) => onRowLayout?.(rowIndex, e.nativeEvent.layout.y)}';
    if (src.includes(lfAnchor)) {
      src = src.replace(lfAnchor, '<View\n        ref={rowWrapRef}\n        onLayout={(e) => onRowLayout?.(rowIndex, e.nativeEvent.layout.y)}');
    } else {
      fail('Outer wrap <View> onLayout anchor not found.');
    }
  } else {
    src = src.replace(layoutAnchor, '<View' + eol + '        ref={rowWrapRef}' + eol + '        onLayout={(e) => onRowLayout?.(rowIndex, e.nativeEvent.layout.y)}');
  }

  // A3. Modify the onRowFocus call to pass rowWrapRef.current as 2nd arg
  const focusOld = 'onRowFocus?.(rowIndex); // === ROW_SNAP_V78 ===';
  const focusNew = 'onRowFocus?.(rowIndex, rowWrapRef.current); // ' + MARKER;
  if (src.includes(focusOld)) {
    src = src.replace(focusOld, focusNew);
  } else if (src.includes('onRowFocus?.(rowIndex, rowWrapRef.current)')) {
    // already there
  } else {
    // try regex fallback
    const re = /onRowFocus\?\.\(rowIndex\);[^\n]*/;
    if (re.test(src)) {
      src = src.replace(re, focusNew);
    } else {
      fail('onRowFocus call not found.');
    }
  }

  // A4. Update the prop type to accept second arg
  const typeOld = 'onRowFocus?: (rowIndex: number) => void;';
  const typeNew = 'onRowFocus?: (rowIndex: number, viewRef?: any) => void;';
  if (src.includes(typeOld)) src = src.replace(typeOld, typeNew);

  bw(file, src);
  console.log('[v82]   ✓ ServiceRow exposes wrap View ref via onRowFocus');
}

// ─────────────────────────────────────────────────────────
// (B) discover.tsx — use measureLayout in handleRowFocus
// ─────────────────────────────────────────────────────────
function patchDiscover() {
  const file = find(
    [
      path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
      path.join('app', '(tabs)', 'discover.tsx'),
    ],
    'discover.tsx'
  );
  let src = fs.readFileSync(file, 'utf8');
  const eol = detectEol(src);
  console.log('[v82] (B) Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

  if (src.includes(MARKER)) {
    console.log('[v82]   = already patched');
    return;
  }

  // B1. Replace the entire body of handleRowFocus with a measureLayout-first
  //     implementation. We anchor on the signature line and replace until
  //     the matching `}, []);`. This single replacement covers v78/v80/v81
  //     variants since we rewrite the whole function body.
  //
  //     We'll do a regex replacement to find the function body.
  const fnRe = /const handleRowFocus = useCallback\(\(rowIndex: number\) => \{[\s\S]*?\}, \[\]\);/;
  const m = src.match(fnRe);
  if (!m) fail('handleRowFocus function not found.');

  const newBody =
    'const handleRowFocus = useCallback((rowIndex: number, rowView?: any) => {' + eol +
    '    // ' + MARKER + eol +
    '    if (lastFocusedRowRef.current === rowIndex) return;' + eol +
    '    lastFocusedRowRef.current = rowIndex;' + eol +
    '    if (!scrollViewRef.current) return;' + eol +
    '' + eol +
    '    const snap = (y: number) => {' + eol +
    '      requestAnimationFrame(() => {' + eol +
    '        requestAnimationFrame(() => {' + eol +
    '          scrollViewRef.current?.scrollTo({ y: Math.max(0, y), animated: false });' + eol +
    '        });' + eol +
    '      });' + eol +
    '    };' + eol +
    '' + eol +
    '    // Fresh native measurement against the ScrollView — always accurate' + eol +
    '    if (rowView && typeof rowView.measureLayout === \'function\' && scrollViewRef.current) {' + eol +
    '      const scrollNode = findNodeHandle(scrollViewRef.current);' + eol +
    '      if (scrollNode != null) {' + eol +
    '        rowView.measureLayout(' + eol +
    '          scrollNode,' + eol +
    '          (_x: number, y: number) => snap(y),' + eol +
    '          () => {' + eol +
    '            const cy = rowYPositionsRef.current[rowIndex];' + eol +
    '            if (cy !== undefined) snap(cy);' + eol +
    '          }' + eol +
    '        );' + eol +
    '        return;' + eol +
    '      }' + eol +
    '    }' + eol +
    '' + eol +
    '    // Fallback: cached y from onLayout' + eol +
    '    const y = rowYPositionsRef.current[rowIndex];' + eol +
    '    if (y === undefined) return;' + eol +
    '    snap(y);' + eol +
    '  }, []);';

  src = src.replace(fnRe, newBody);
  console.log('[v82]   ✓ handleRowFocus rewritten to use measureLayout (fresh per-focus)');

  bw(file, src);
}

patchServiceRow();
console.log('');
patchDiscover();
console.log('');
console.log('[v82] ✅ Done. Rebuild your APK (nuke android\\app\\build first).');
console.log('[v82]    UP and DOWN should now both fully snap the focused row\'s title to the top.');
