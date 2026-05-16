/* eslint-disable */
// apply_patches_v43b.js — Same goal as V43, but uses a signature-anchored
// regex to replace the LazyMount component body. Doesn't rely on comment text
// (em-dash vs hyphen). Atomically applies all 4 changes or none.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(F)) { bad('not found: ' + F); process.exit(1); }

let src = fs.readFileSync(F, 'utf8');
const orig = src;
const bak = F + '.bak.v43b.' + Date.now();
fs.copyFileSync(F, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + F + ' ===');

const MARKER = 'PATCH_V43B_SEQUENTIAL_MOUNT';
if (src.includes(MARKER) || src.includes('PATCH_V43_SEQUENTIAL_MOUNT')) {
  ok('V43 already applied');
  process.exit(0);
}

// ---- 1. Replace the LazyMount component using a regex that matches the signature
// We match from `const LazyMount: React.FC<{` through the matching `});` at column 0.
{
  const re = /const LazyMount: React\.FC<\{ height: number; delay\?: number; children: React\.ReactNode \}> = memo\(\(\{ height, delay = 0, children \}\) => \{[\s\S]*?\n\}\);/;
  const m = src.match(re);
  if (!m) {
    bad('LazyMount signature regex did not match');
  } else {
    const replacement =
"// " + MARKER + " — Singleton mount queue. Row N+1 only mounts after row N\n" +
"// has signaled \"painted\". Guarantees serial mounting; JS thread is never\n" +
"// asked to mount two FlatLists at once. Adapts to device speed.\n" +
"const mountQueue: { rowIndex: number; grant: () => void }[] = [];\n" +
"let currentMountTicket = 0;\n" +
"\n" +
"function requestMountToken(rowIndex: number): Promise<void> {\n" +
"  return new Promise((resolve) => {\n" +
"    if (rowIndex <= currentMountTicket) {\n" +
"      resolve();\n" +
"      return;\n" +
"    }\n" +
"    mountQueue.push({ rowIndex, grant: resolve });\n" +
"    mountQueue.sort((a, b) => a.rowIndex - b.rowIndex);\n" +
"  });\n" +
"}\n" +
"\n" +
"function releaseMountToken(rowIndex: number) {\n" +
"  if (rowIndex >= currentMountTicket) {\n" +
"    currentMountTicket = rowIndex + 1;\n" +
"  }\n" +
"  while (mountQueue.length > 0 && mountQueue[0].rowIndex <= currentMountTicket) {\n" +
"    const next = mountQueue.shift()!;\n" +
"    requestAnimationFrame(() => next.grant());\n" +
"  }\n" +
"}\n" +
"\n" +
"const LazyMount: React.FC<{ height: number; rowIndex: number; children: React.ReactNode }> = memo(({ height, rowIndex, children }) => {\n" +
"  const [shouldRender, setShouldRender] = useState(rowIndex === 0);\n" +
"  const hasReleasedRef = useRef(false);\n" +
"\n" +
"  useEffect(() => {\n" +
"    if (shouldRender) return;\n" +
"    let cancelled = false;\n" +
"    requestMountToken(rowIndex).then(() => {\n" +
"      if (!cancelled) setShouldRender(true);\n" +
"    });\n" +
"    return () => { cancelled = true; };\n" +
"  }, [rowIndex, shouldRender]);\n" +
"\n" +
"  const handleLayout = useCallback(() => {\n" +
"    if (hasReleasedRef.current) return;\n" +
"    hasReleasedRef.current = true;\n" +
"    InteractionManager.runAfterInteractions(() => releaseMountToken(rowIndex));\n" +
"  }, [rowIndex]);\n" +
"\n" +
"  useEffect(() => {\n" +
"    return () => {\n" +
"      if (!hasReleasedRef.current) {\n" +
"        hasReleasedRef.current = true;\n" +
"        releaseMountToken(rowIndex);\n" +
"      }\n" +
"    };\n" +
"  }, [rowIndex]);\n" +
"\n" +
"  if (!shouldRender) {\n" +
"    return <View style={{ height, backgroundColor: 'transparent' }} />;\n" +
"  }\n" +
"\n" +
"  return <View onLayout={handleLayout}>{children}</View>;\n" +
"});";
    src = src.replace(re, replacement);
    ok('replaced LazyMount component with sequential mount queue');
  }
}

// ---- 2. Update the LazyMount call site — replace `delay={lazyDelay}` with `rowIndex={rowIndex}`
// First, remove the lazyDelay calculation line (regex-tolerant for comment differences)
{
  const re = /\n  \/\/ First 2 rows render immediately[^\n]*\n  const lazyDelay = [^\n]+\n\n  return \(\n    <LazyMount height=\{200\} delay=\{lazyDelay\}>/;
  const m = src.match(re);
  if (!m) {
    bad('LazyMount call site regex did not match');
  } else {
    const replacement =
"\n  // " + MARKER + " — Row 0 mounts immediately; subsequent rows mount\n" +
"  // in order after the previous row paints (signaled via onLayout).\n" +
"\n" +
"  return (\n" +
"    <LazyMount height={200} rowIndex={rowIndex}>";
    src = src.replace(re, replacement);
    ok('updated LazyMount call site (delay → rowIndex)');
  }
}

// ---- 3. Tighten initialNumToRender (regex tolerant of comment changes)
{
  const re = /initialNumToRender=\{3\}[^\n]*/;
  if (!re.test(src)) {
    bad('initialNumToRender={3} not found');
  } else {
    src = src.replace(re, 'initialNumToRender={2} /* ' + MARKER + ' — first paint is 2 cards */');
    ok('initialNumToRender 3 → 2');
  }
}

// ---- 4. Flip removeClippedSubviews to false on horizontal FlatList
{
  const re = /removeClippedSubviews=\{true\}/;
  if (!re.test(src)) {
    bad('removeClippedSubviews={true} not found');
  } else {
    src = src.replace(re, 'removeClippedSubviews={false} /* ' + MARKER + ' — TV focus stability */');
    ok('removeClippedSubviews true → false');
  }
}

if (src !== orig && fail === 0) {
  fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + F);
} else if (fail > 0) {
  info('failures — file NOT saved (original safe in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV43b done. Rebuild + force-stop on Firestick + relaunch.');
  console.log('  ✓ Sequential row mounting via singleton queue');
  console.log('  ✓ Row 0 instant; rows 1..N mount one-by-one after previous paints');
  console.log('  ✓ Navigation/focus unchanged');
}
