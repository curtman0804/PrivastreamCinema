/* eslint-disable */
// apply_patches_v33.js — Universal back-button fix (just go back, no exceptions)
// Run from project root:   node apply_patches_v33.js
//
// THREE FILES, ONE RULE: back press goes to the previous screen. Never exits.
//
//   File 1: frontend/app/details/[type]/[id].tsx
//     - Re-apply V29 BackHandler (router.back → /(tabs)/discover fallback)
//
//   File 2: frontend/app/player.tsx
//     - Re-apply V30 BackHandler (existing onBackPress runs, then router.back)
//
//   File 3: frontend/app/(tabs)/_layout.tsx
//     - Replace V32 double-press toast with a clean no-op (back at root does nothing)
//     - Adds a fresh no-op handler if V32 wasn't applied
//
// All three sections are idempotent (skip if marker already present), use
// single-line anchors, and preserve original line endings (CRLF or LF).
// If any section fails, that file isn't saved — others can still succeed.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const PLAYER  = path.join('frontend', 'app', 'player.tsx');
const LAYOUT  = path.join('frontend', 'app', '(tabs)', '_layout.tsx');

let totalPass = 0, totalFail = 0;

function patchFile(filePath, sectionName, patchFn) {
  console.log('\n========================================');
  console.log('  Section: ' + sectionName);
  console.log('  File:    ' + filePath);
  console.log('========================================');

  if (!fs.existsSync(filePath)) {
    console.log('  [FAIL] file not found');
    totalFail++;
    return;
  }

  let src = fs.readFileSync(filePath, 'utf8');
  const orig = src;
  const bak = filePath + '.bak.v33.' + Date.now();
  fs.copyFileSync(filePath, bak);
  console.log('  [info] backup → ' + bak);

  const hadCRLF = src.indexOf('\r\n') >= 0;
  if (hadCRLF) src = src.replace(/\r\n/g, '\n');
  console.log('  [info] line endings: ' + (hadCRLF ? 'CRLF' : 'LF'));

  let pass = 0, fail = 0;
  const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
  const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
  const info = (m) => console.log('  [info] ' + m);

  src = patchFn({ src, ok, bad, info }) || src;

  if (src !== orig && fail === 0) {
    const finalOut = hadCRLF ? src.replace(/\n/g, '\r\n') : src;
    fs.writeFileSync(filePath, finalOut, 'utf8');
    ok('saved');
    totalPass += pass;
  } else if (fail > 0) {
    info('failures — NOT saved (original preserved in ' + bak + ')');
    totalFail += fail;
  } else {
    info('no changes needed');
    totalPass += pass;
  }
}

// =====================================================================
// SECTION 1 — details/[type]/[id].tsx  (V29 re-apply)
// =====================================================================
patchFile(DETAILS, 'V29 — details back nav', ({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V29_BACK_NAV';
  if (src.includes(MARKER)) { ok('V29 already applied'); return src; }

  const anchor = "    const sub = BackHandler.addEventListener('hardwareBackPress', () => goToSeriesRootWithFocus());";
  const occ = src.split(anchor).length - 1;

  if (occ === 0) { bad('V29 anchor not found in details — already patched differently?'); return src; }
  if (occ > 1)  { bad('V29 anchor matches ' + occ + ' times'); return src; }

  const replacement = [
    "    // " + MARKER + " — never let Android back close the app from details.",
    "    // Series-episode path stays untouched. Movies/series-roots: router.back().",
    "    // Empty back stack (deep link): fall back to Discover tab. ALWAYS return true.",
    "    const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
    "      try { if (goToSeriesRootWithFocus()) return true; } catch { /* fall through */ }",
    "      try { router.back(); return true; } catch { /* no back history */ }",
    "      try { router.replace('/(tabs)/discover'); } catch { /* last resort */ }",
    "      return true;",
    "    });",
  ].join('\n');

  ok('V29 back handler injected');
  return src.replace(anchor, replacement);
});

// =====================================================================
// SECTION 2 — player.tsx  (V30 re-apply)
// =====================================================================
patchFile(PLAYER, 'V30 — player back escape', ({ src, ok, bad, info }) => {
  const MARKER = 'PATCH_V30_PLAYER_BACK_ESCAPE';
  if (src.includes(MARKER)) { ok('V30 already applied'); return src; }

  // 4-space indent variant first
  let anchor = "    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);";
  let indent = '    ';
  let occ = src.split(anchor).length - 1;
  if (occ === 0) {
    anchor = "  const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);";
    indent = '  ';
    occ = src.split(anchor).length - 1;
  }

  if (occ === 0) { bad('V30 anchor not found in player'); return src; }
  if (occ > 1)  { bad('V30 anchor matches ' + occ + ' times'); return src; }

  const replacement = [
    indent + "// " + MARKER + " — back press ALWAYS escapes the player",
    indent + "const sub = BackHandler.addEventListener('hardwareBackPress', () => {",
    indent + "  try { if (onBackPress && onBackPress() === true) return true; } catch (_) {}",
    indent + "  try { router.back(); return true; } catch (_) {}",
    indent + "  try { router.replace('/(tabs)/discover'); } catch (_) {}",
    indent + "  return true;",
    indent + "});",
  ].join('\n');

  ok('V30 back handler injected');
  return src.replace(anchor, replacement);
});

// =====================================================================
// SECTION 3 — (tabs)/_layout.tsx  (replace V32 toast with no-op, or add fresh)
// =====================================================================
patchFile(LAYOUT, 'V33 — root tabs no-op back', ({ src, ok, bad, info }) => {
  const MARKER_V33 = 'PATCH_V33_ROOT_NO_OP_BACK';
  const MARKER_V32 = 'PATCH_V32_DOUBLE_BACK_TO_EXIT';

  if (src.includes(MARKER_V33)) { ok('V33 root no-op already applied'); return src; }

  // Case A: V32 block exists → replace its whole useEffect with a no-op useEffect
  if (src.includes(MARKER_V32)) {
    info('V32 block detected — replacing with no-op');
    // The V32 block starts with the marker comment and ends with the closing `}, []);`
    // Use a regex from "// PATCH_V32_DOUBLE_BACK_TO_EXIT" through the next `}, []);`
    const v32Re = /\n?\s*\/\/\s*PATCH_V32_DOUBLE_BACK_TO_EXIT[\s\S]*?\}\,\s*\[\]\)\;\s*\n?/m;
    if (!v32Re.test(src)) { bad('V32 block regex did not match'); return src; }
    const noOp = [
      '',
      '  // ' + MARKER_V33 + ' — back at root does nothing (stays put, no exit, no toast)',
      '  useEffect(() => {',
      '    if (Platform.OS !== "android") return;',
      '    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);',
      '    return () => { try { sub.remove(); } catch (_) {} };',
      '  }, []);',
      '',
    ].join('\n');
    ok('replaced V32 double-press block with V33 no-op');
    return src.replace(v32Re, noOp);
  }

  // Case B: fresh install — add imports + no-op useEffect
  function ensureNamedImport(s, pkg, names) {
    const re = new RegExp("import\\s*\\{([^}]*)\\}\\s*from\\s*['\"]" + pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['\"]\\s*;?", 'm');
    const m = s.match(re);
    if (m) {
      const existing = m[1].split(',').map(t => t.trim()).filter(Boolean);
      const missing = names.filter(n => !existing.includes(n));
      if (missing.length === 0) return s;
      return s.replace(m[0], "import { " + [...existing, ...missing].join(', ') + " } from '" + pkg + "';");
    }
    // No existing import — prepend
    const firstImport = s.match(/^import .*?;?\s*$/m);
    const stmt = "import { " + names.join(', ') + " } from '" + pkg + "';";
    return firstImport ? s.replace(firstImport[0], firstImport[0] + '\n' + stmt) : stmt + '\n' + s;
  }

  src = ensureNamedImport(src, 'react', ['useEffect']);
  src = ensureNamedImport(src, 'react-native', ['BackHandler', 'Platform']);

  const funcRe = /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/m;
  const m = src.match(funcRe);
  if (!m) { bad('could not find `export default function ...() {` in layout'); return src; }

  const insertAt = m.index + m[0].length;
  const block = [
    '',
    '  // ' + MARKER_V33 + ' — back at root does nothing (stays put, no exit, no toast)',
    '  useEffect(() => {',
    '    if (Platform.OS !== "android") return;',
    '    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);',
    '    return () => { try { sub.remove(); } catch (_) {} };',
    '  }, []);',
    '',
  ].join('\n');

  ok('injected V33 no-op handler into ' + m[1] + '()');
  return src.slice(0, insertAt) + block + src.slice(insertAt);
});

// =====================================================================
console.log('\n========================================');
console.log('  TOTAL: ' + totalPass + ' passed   ' + totalFail + ' failed');
console.log('========================================');

if (totalFail > 0) {
  console.log('\nSome sections failed. Originals preserved in their .bak.v33.* files.');
  process.exit(1);
} else {
  console.log('\nV33 done. Rebuild and test on Firestick:');
  console.log('  ✓ Discover → Apex → Play → BACK → Apex details ← V30');
  console.log('  ✓ Apex details → BACK → Discover ← V29 (no app exit)');
  console.log('  ✓ Discover → BACK → nothing happens (stays put) ← V33');
  console.log('  ✓ Discover → Rick&Morty → episode → Play → BACK → episode page');
  console.log('    → BACK → series root → BACK → Discover');
  console.log('  ✓ Search → poster → details → BACK → Search → BACK → Discover');
  console.log('\nWhen this works, commit:');
  console.log('  git add -A');
  console.log('  git commit -m "fix: universal back navigation (V29+V30+V33)"');
}
