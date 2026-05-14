/* eslint-disable */
// apply_patches_v32.js — Double-press-to-exit on the root tabs (no accidental app exit)
// Run from project root:   node apply_patches_v32.js
//
// THE BUG:
//   From any sub-screen (player/details), back returns to Discover (root tab),
//   which has no BackHandler registered. The next back press hits Android's
//   default → app exits. On a Firestick remote that's one careless click away
//   from being kicked out of the app.
//
// THE FIX:
//   In frontend/app/(tabs)/_layout.tsx, register a BackHandler that does
//   double-press-to-exit:
//     - 1st back  → toast "Press back again to exit", return true (consume)
//     - 2nd back within 2s → return false → Android default → clean exit
//   Cleanup on unmount so no listener leaks when navigating away from tabs.
//
// Auto-detects function name. Adds imports idempotently. Bails cleanly if
// the file shape is unexpected (so it can never break a working build).

const fs = require('fs');
const path = require('path');

const LAYOUT = path.join('frontend', 'app', '(tabs)', '_layout.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(LAYOUT)) { bad('layout not found: ' + LAYOUT); process.exit(1); }

let src = fs.readFileSync(LAYOUT, 'utf8');
const orig = src;
const bak = LAYOUT + '.bak.v32.' + Date.now();
fs.copyFileSync(LAYOUT, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
const EOL = _hadCRLF ? '\r\n' : '\n';
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');
info('detected line endings: ' + (_hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + LAYOUT + ' ===');

const MARKER = 'PATCH_V32_DOUBLE_BACK_TO_EXIT';

if (src.includes(MARKER)) {
  ok('V32 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// 1. Ensure imports: BackHandler, ToastAndroid, Platform from react-native
//    and useEffect, useRef from react.
// ---------------------------------------------------------------------
function ensureNamedImport(srcStr, pkg, names) {
  // Look for any existing import statement from the package
  const importRe = new RegExp(
    "import\\s*\\{([^}]*)\\}\\s*from\\s*['\"]" + pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['\"]\\s*;?",
    'm'
  );
  const m = srcStr.match(importRe);
  if (m) {
    const existing = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const missing = names.filter(n => !existing.includes(n));
    if (missing.length === 0) return { src: srcStr, changed: false };
    const merged = [...existing, ...missing].join(', ');
    const replacement = "import { " + merged + " } from '" + pkg + "';";
    return { src: srcStr.replace(m[0], replacement), changed: true, action: 'extended ' + pkg };
  }
  // No existing import from that package — prepend a new line at top after first import
  const firstImport = srcStr.match(/^import .*?;?\s*$/m);
  const newImport = "import { " + names.join(', ') + " } from '" + pkg + "';";
  if (firstImport) {
    return {
      src: srcStr.replace(firstImport[0], firstImport[0] + '\n' + newImport),
      changed: true,
      action: 'added ' + pkg,
    };
  }
  return { src: newImport + '\n' + srcStr, changed: true, action: 'prepended ' + pkg };
}

{
  const r1 = ensureNamedImport(src, 'react', ['useEffect', 'useRef']);
  src = r1.src; if (r1.changed) ok(r1.action); else info('react imports already present');

  const r2 = ensureNamedImport(src, 'react-native', ['BackHandler', 'ToastAndroid', 'Platform']);
  src = r2.src; if (r2.changed) ok(r2.action); else info('react-native imports already present');
}

// ---------------------------------------------------------------------
// 2. Find the default-exported function and inject the useEffect right
//    after its opening brace.
// ---------------------------------------------------------------------
{
  // Match: export default function <Name>(...) {   (capture the whole match)
  const funcRe = /export\s+default\s+function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/m;
  const m = src.match(funcRe);

  if (!m) {
    // Try arrow function form: const X = () => { ... };  export default X;
    bad('could not find `export default function <Name>() {` in ' + LAYOUT);
    info('expected pattern not found — bailing without changes');
  } else {
    const fnName = m[1];
    const insertAt = m.index + m[0].length;
    info('detected layout function: ' + fnName);

    const block = [
      '',
      '  // ' + MARKER + ' — back-from-root shows toast, second back exits',
      '  const _v32LastBackRef = useRef<number>(0);',
      '  useEffect(() => {',
      '    if (Platform.OS !== "android") return;',
      '    const sub = BackHandler.addEventListener("hardwareBackPress", () => {',
      '      const now = Date.now();',
      '      if (now - _v32LastBackRef.current < 2000) {',
      '        return false; // 2nd press within 2s → let Android exit',
      '      }',
      '      _v32LastBackRef.current = now;',
      '      try { ToastAndroid.show("Press back again to exit", ToastAndroid.SHORT); } catch (_) {}',
      '      return true; // consume the 1st press',
      '    });',
      '    return () => { try { sub.remove(); } catch (_) {} };',
      '  }, []);',
      '',
    ].join('\n');

    src = src.slice(0, insertAt) + block + src.slice(insertAt);
    ok('injected double-press-to-exit useEffect into ' + fnName + '()');
  }
}

// ---------------------------------------------------------------------
// Save (restore original line endings)
// ---------------------------------------------------------------------
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(LAYOUT, finalOut, 'utf8');
  ok('saved ' + LAYOUT);
} else if (fail > 0) {
  info('failures — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV32 done. Rebuild and test on Firestick:');
  console.log('  ✓ Apex → Play → exit player → Discover → press BACK once');
  console.log('    → toast "Press back again to exit" appears, app STAYS open');
  console.log('  ✓ Press BACK again within 2 seconds → app exits cleanly');
  console.log('  ✓ Wait > 2s, press BACK once → toast again (counter reset)');
  console.log('\nIf this works, commit it:');
  console.log('  git add -A');
  console.log('  git commit -m "fix: double-press-to-exit on root tabs (V29+V30+V32)"');
}
