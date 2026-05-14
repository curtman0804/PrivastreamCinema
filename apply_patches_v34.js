/* eslint-disable */
// apply_patches_v34.js — Universal "back just goes back" — diagnostic-driven, surgical
// Run from project root:   node apply_patches_v34.js
//
// Confirmed by show_back_state.js:
//   - details/[type]/[id].tsx L547 still has the ORIGINAL buggy handler:
//       () => goToSeriesRootWithFocus()
//     For movies that returns false, propagates to V32 toast (invisible on TV).
//   - player.tsx has a real onBackPress that does router.replace(target) — already works.
//   - (tabs)/_layout.tsx has V32 toast (invisible on TV → feels like "nothing happened").
//
// V34 makes back behavior dead-simple and visible:
//   Player    →  existing onBackPress already navigates to details (no change)
//   Details   →  back: try series-root if applicable, else router.back, else Discover
//   Root tabs →  back: nothing (no toast, no exit, just stays put)
//
// All CRLF, all idempotent, all single-anchor.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const LAYOUT  = path.join('frontend', 'app', '(tabs)', '_layout.tsx');

let totalPass = 0, totalFail = 0;

function patchFile(filePath, label, patchFn) {
  console.log('\n========================================');
  console.log('  ' + label);
  console.log('  ' + filePath);
  console.log('========================================');

  if (!fs.existsSync(filePath)) { console.log('  [FAIL] not found'); totalFail++; return; }

  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;
  const bak = filePath + '.bak.v34.' + Date.now();
  fs.copyFileSync(filePath, bak);
  console.log('  [info] backup → ' + bak);

  const hadCRLF = src.indexOf('\r\n') >= 0;
  if (hadCRLF) src = src.replace(/\r\n/g, '\n');
  console.log('  [info] eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

  let pass = 0, fail = 0;
  const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
  const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
  const info = (m) => console.log('  [info] ' + m);

  src = patchFn({ src, ok, bad, info }) || src;

  if (src !== orig && fail === 0) {
    fs.writeFileSync(filePath, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
    ok('saved');
    totalPass += pass;
  } else if (fail > 0) {
    info('failures — NOT saved (original preserved in ' + bak + ')');
    totalFail += fail;
  } else {
    info('no changes needed (already at V34 state)');
    totalPass += pass;
  }
}

// =====================================================================
// FILE 1 — details/[type]/[id].tsx
// =====================================================================
patchFile(DETAILS, 'details — V34 back nav (replace buggy handler)', ({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V34_DETAILS_BACK';

  if (src.includes(MARKER)) { ok('V34 already applied'); return src; }

  // Anchor confirmed by show_back_state.js at L547
  const anchor = "    const sub = BackHandler.addEventListener('hardwareBackPress', () => goToSeriesRootWithFocus());";
  const occ = src.split(anchor).length - 1;

  if (occ === 0) { bad('anchor not found in details (file changed since diagnostic?)'); return src; }
  if (occ > 1)  { bad('anchor matches ' + occ + ' times'); return src; }

  const replacement = [
    "    // " + MARKER + " — back ALWAYS does something visible:",
    "    //   1. Series-episode page → goToSeriesRootWithFocus() handles it (returns true)",
    "    //   2. Movies / series-roots → router.back() to previous screen",
    "    //   3. Deep-linked (empty stack) → fall back to Discover tab",
    "    //   4. ALWAYS return true so Android can't force-exit",
    "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
    "      try { if (goToSeriesRootWithFocus()) return true; } catch (_) {}",
    "      try { router.back(); return true; } catch (_) {}",
    "      try { router.replace('/(tabs)/discover'); } catch (_) {}",
    "      return true;",
    "    });",
  ].join('\n');

  ok('replaced details BackHandler with V34 logic');
  return src.replace(anchor, replacement);
});

// =====================================================================
// FILE 2 — (tabs)/_layout.tsx
// =====================================================================
patchFile(LAYOUT, 'root tabs — V34 silent no-op (kill V32 toast)', ({ src, ok, bad, info }) => {
  const MARKER_V34 = 'PATCH_V34_ROOT_SILENT_NO_OP';
  if (src.includes(MARKER_V34)) { ok('V34 root no-op already applied'); return src; }

  // Replace the V32 useEffect block entirely.
  // V32 block starts with `// PATCH_V32_DOUBLE_BACK_TO_EXIT` comment and ends with
  // the closing `}, []);` of its useEffect. There may also be a `_v32LastBackRef = useRef`
  // line which we'll keep for safety (unused but harmless).
  const v32Re = /\/\/\s*PATCH_V32_DOUBLE_BACK_TO_EXIT[\s\S]*?\}\,\s*\[\]\)\s*;/;

  if (v32Re.test(src)) {
    info('V32 block detected — replacing with silent no-op');
    const noOp = [
      '// ' + MARKER_V34 + ' — back at root does NOTHING visible.',
      '  // No toast (invisible on TV anyway), no exit, just absorb the press.',
      '  // Use HOME button on the remote to leave the app.',
      '  useEffect(() => {',
      '    if (Platform.OS !== "android") return;',
      '    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);',
      '    return () => { try { sub.remove(); } catch (_) {} };',
      '  }, []);',
    ].join('\n  ');

    ok('replaced V32 toast useEffect with V34 silent no-op');
    return src.replace(v32Re, noOp);
  } else {
    // No V32 block — try to insert a fresh no-op after the function opening brace
    info('V32 block not found — installing fresh no-op handler');
    const funcRe = /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/m;
    const m = src.match(funcRe);
    if (!m) { bad('could not find layout function header'); return src; }
    const insertAt = m.index + m[0].length;
    const block = [
      '',
      '  // ' + MARKER_V34 + ' — back at root does NOTHING visible',
      '  useEffect(() => {',
      '    if (Platform.OS !== "android") return;',
      '    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);',
      '    return () => { try { sub.remove(); } catch (_) {} };',
      '  }, []);',
      '',
    ].join('\n');
    ok('injected V34 silent no-op into ' + m[1] + '()');
    return src.slice(0, insertAt) + block + src.slice(insertAt);
  }
});

// =====================================================================
console.log('\n========================================');
console.log('  TOTAL: ' + totalPass + ' passed   ' + totalFail + ' failed');
console.log('========================================');

if (totalFail > 0) {
  console.log('\nSome sections failed. Originals preserved in .bak.v34.* files.');
  process.exit(1);
} else {
  console.log('\nV34 done. Rebuild and test on Firestick:');
  console.log('  ✓ Discover → Apex → BACK → returns to Discover');
  console.log('  ✓ Discover → Rick&Morty → episode → BACK → series root → BACK → Discover');
  console.log('  ✓ Discover → BACK → NOTHING (silent, stays put)');
  console.log('  ✓ Search → poster → BACK → Search');
  console.log('  ✓ Player BACK still works (was already correct via onBackPress)');
  console.log('\nWhen this works, commit it:');
  console.log('  git add -A');
  console.log('  git commit -m "fix: V34 universal back nav (details + silent root)"');
}
