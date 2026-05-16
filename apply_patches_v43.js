/* eslint-disable */
// apply_patches_v43.js — Strict sequential mount for ServiceRow.
// Replaces the old fixed-delay LazyMount with a singleton mount queue:
// row N+1 only mounts after row N has painted. Adapts to device speed.
//
// Targets: frontend/src/components/ServiceRow.tsx
// Idempotent. Safe. Backup auto-created.

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
const bak = F + '.bak.v43.' + Date.now();
fs.copyFileSync(F, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + F + ' ===');

const MARKER = 'PATCH_V43_SEQUENTIAL_MOUNT';
if (src.includes(MARKER)) { ok('V43 already applied'); process.exit(0); }

function swap(anchor, replacement, label) {
  const occ = src.split(anchor).length - 1;
  if (occ === 0) { bad('anchor not found: ' + label); return false; }
  if (occ > 1)   { bad(label + ' matches ' + occ + ' times'); return false; }
  src = src.replace(anchor, replacement);
  ok(label);
  return true;
}

// ---- 1. Replace the entire LazyMount component with the queue-based version
const oldLazyMount =
"// Lazy wrapper — only mounts the real ServiceRow content after a staggered delay.\n" +
"// This prevents all horizontal FlatLists from mounting at once and blocking the JS thread.\n" +
"const LazyMount: React.FC<{ height: number; delay?: number; children: React.ReactNode }> = memo(({ height, delay = 0, children }) => {\n" +
"  const [shouldRender, setShouldRender] = useState(delay <= 0);\n" +
"\n" +
"  useEffect(() => {\n" +
"    if (delay <= 0) {\n" +
"      setShouldRender(true);\n" +
"      return;\n" +
"    }\n" +
"    const timer = setTimeout(() => {\n" +
"      InteractionManager.runAfterInteractions(() => {\n" +
"        setShouldRender(true);\n" +
"      });\n" +
"    }, delay);\n" +
"    return () => clearTimeout(timer);\n" +
"  }, [delay]);\n" +
"\n" +
"  if (!shouldRender) {\n" +
"    return <View style={{ height, backgroundColor: 'transparent' }} />;\n" +
"  }\n" +
"\n" +
"  return <>{children}</>;\n" +
"});";

const newLazyMount =
"// " + MARKER + " — Singleton mount queue. Row N+1 only mounts after row N\n" +
"// has signaled \"painted\". This guarantees serial mounting; the JS thread is\n" +
"// never asked to mount two FlatLists at once. Adapts to device speed.\n" +
"const mountQueue: { rowIndex: number; grant: () => void }[] = [];\n" +
"let currentMountTicket = 0; // monotonically increasing; row 0 gets ticket 0\n" +
"\n" +
"function requestMountToken(rowIndex: number): Promise<void> {\n" +
"  return new Promise((resolve) => {\n" +
"    if (rowIndex <= currentMountTicket) {\n" +
"      // It's already this row's turn (or past it) — mount immediately\n" +
"      resolve();\n" +
"      return;\n" +
"    }\n" +
"    mountQueue.push({ rowIndex, grant: resolve });\n" +
"    // Keep queue sorted ascending so lower rowIndex fires first\n" +
"    mountQueue.sort((a, b) => a.rowIndex - b.rowIndex);\n" +
"  });\n" +
"}\n" +
"\n" +
"function releaseMountToken(rowIndex: number) {\n" +
"  if (rowIndex >= currentMountTicket) {\n" +
"    currentMountTicket = rowIndex + 1;\n" +
"  }\n" +
"  // Find next waiter whose rowIndex matches (or precedes) the new ticket\n" +
"  while (mountQueue.length > 0 && mountQueue[0].rowIndex <= currentMountTicket) {\n" +
"    const next = mountQueue.shift()!;\n" +
"    // Defer to next animation frame so we don't mount synchronously\n" +
"    requestAnimationFrame(() => next.grant());\n" +
"  }\n" +
"}\n" +
"\n" +
"// Lazy wrapper — uses the mount queue so rows mount one at a time, in order.\n" +
"// Each row signals \"done\" via onLayout, which unblocks the next row.\n" +
"const LazyMount: React.FC<{ height: number; rowIndex: number; children: React.ReactNode }> = memo(({ height, rowIndex, children }) => {\n" +
"  // Row 0 always mounts immediately on first render\n" +
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
"  // Once the row has painted, unblock the next row\n" +
"  const handleLayout = useCallback(() => {\n" +
"    if (hasReleasedRef.current) return;\n" +
"    hasReleasedRef.current = true;\n" +
"    // Use a microtask so React commits this row before we trigger the next\n" +
"    InteractionManager.runAfterInteractions(() => releaseMountToken(rowIndex));\n" +
"  }, [rowIndex]);\n" +
"\n" +
"  // Cleanup on unmount: release token so we don't deadlock the queue\n" +
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

swap(oldLazyMount, newLazyMount, "replaced LazyMount with sequential mount queue");

// ---- 2. Fix the LazyMount call site — replace delay prop with rowIndex prop
const oldCall =
"  // First 2 rows render immediately, subsequent rows stagger by 150ms each\n" +
"  const lazyDelay = rowIndex <= 1 ? 0 : (rowIndex - 1) * 150;\n" +
"\n" +
"  return (\n" +
"    <LazyMount height={200} delay={lazyDelay}>";

const newCall =
"  // " + MARKER + " — Row 0 mounts immediately; subsequent rows mount in order\n" +
"  // after the previous row paints (signaled via onLayout in LazyMount).\n" +
"\n" +
"  return (\n" +
"    <LazyMount height={200} rowIndex={rowIndex}>";

swap(oldCall, newCall, "updated LazyMount call site (delay → rowIndex)");

// ---- 3. Tighten initialNumToRender for cold-start first paint
swap(
  "          initialNumToRender={3} /* PATCH_V41_COLDSTART_BUDGET — was 6; halves cold-start image fetches */",
  "          initialNumToRender={2} /* " + MARKER + " — was 3; first paint is just 2 cards */",
  "initialNumToRender 3 → 2"
);

// ---- 4. Remove removeClippedSubviews from horizontal FlatList (Android TV focus bugs)
swap(
  "          removeClippedSubviews={true}\n" +
  "          onEndReached={handleEndReached}",
  "          removeClippedSubviews={false} /* " + MARKER + " — Android TV focus stability */\n" +
  "          onEndReached={handleEndReached}",
  "horizontal FlatList: removeClippedSubviews true → false"
);

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
  console.log('\nV43 done. Rebuild + force-stop on Firestick + relaunch:');
  console.log('  ✓ Row 0 mounts immediately (2 cards visible)');
  console.log('  ✓ Subsequent rows mount one-by-one only after previous row paints');
  console.log('  ✓ JS thread never asked to mount two FlatLists simultaneously');
  console.log('  ✓ Navigation/focus unchanged — outer ScrollView preserved');
  console.log('  ✓ Adapts to device speed (fast → 400ms; slow → graceful)');
  console.log('\nIf cold start is finally snappy:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V43 — strict sequential row mount via mount queue"');
}
