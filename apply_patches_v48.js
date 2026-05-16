/* eslint-disable */
// apply_patches_v48.js — DEEP perf fix for Streamer 4K lag.
//
// V47 wasn't enough. Three new attacks on root causes seen in perf_dump:
//
//   1) app/_layout.tsx — Remove enableFreeze(true) and flip Stack's
//      freezeOnBlur to false. The freeze/thaw is the 3s back-nav lag.
//      Discover will stay alive in memory; back-nav becomes instant.
//
//   2) ServiceRow.tsx — Change animated:true → animated:false on the
//      horizontal scrollToOffset. D-pad presses no longer queue 250ms
//      animations that pile up faster than they can play.
//
//   3) ContentCard.tsx — Remove the per-card setTimeout(100ms) +
//      findNodeHandle useEffect. With hundreds of cards mounting,
//      that's hundreds of bridge calls + timers. The onLayout path
//      already handles focus-trap tag assignment natively.
//
// Idempotent. CRLF-safe. Per-file .bak.v48.<ts> backup.

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

function loadFile(F) {
  if (!fs.existsSync(F)) return null;
  const raw = fs.readFileSync(F, 'utf8');
  const hadCRLF = raw.indexOf('\r\n') >= 0;
  return { raw, text: raw.replace(/\r\n/g, '\n'), hadCRLF };
}
function saveFile(F, text, hadCRLF) {
  const bak = F + '.bak.v48.' + Date.now();
  fs.copyFileSync(F, bak);
  info('backup → ' + bak);
  fs.writeFileSync(F, hadCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf8');
}

// ─────────────────────────────────────────────────────────────────
// FIX 1: app/_layout.tsx — kill the freeze
// ─────────────────────────────────────────────────────────────────
function patchRootLayout() {
  const F = path.join('frontend', 'app', '_layout.tsx');
  const loaded = loadFile(F);
  if (!loaded) { bad('not found: ' + F); return; }
  let src = loaded.text;
  if (src.includes('PATCH_V48_NO_FREEZE')) { ok('root _layout already patched'); return; }

  const oldImport = `import { enableFreeze } from 'react-native-screens'; // PATCH_V14_FREEZE_IMPORT
enableFreeze(true);`;
  const newImport = `// PATCH_V48_NO_FREEZE — enableFreeze removed. Was causing 3s back-nav lag.
// import { enableFreeze } from 'react-native-screens';
// enableFreeze(true);`;

  if (!src.includes(oldImport)) {
    bad('root _layout: enableFreeze block not found.');
    return;
  }
  src = src.replace(oldImport, newImport);

  const oldStack = `<Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: true /* PATCH_V14_FREEZE_ON_BLUR_STACK */ }} />`;
  const newStack = `<Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: false /* PATCH_V48_NO_FREEZE — back-nav is instant */ }} />`;
  if (!src.includes(oldStack)) {
    bad('root _layout: Stack screenOptions block not found.');
    return;
  }
  src = src.replace(oldStack, newStack);

  saveFile(F, src, loaded.hadCRLF);
  ok('root _layout: enableFreeze removed + freezeOnBlur=false');
}

// ─────────────────────────────────────────────────────────────────
// FIX 2: ServiceRow.tsx — animated:false on horizontal scroll
// ─────────────────────────────────────────────────────────────────
function patchServiceRow() {
  const F = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
  const loaded = loadFile(F);
  if (!loaded) { bad('not found: ' + F); return; }
  let src = loaded.text;
  if (src.includes('PATCH_V48_NO_ANIM_SCROLL')) { ok('ServiceRow already patched'); return; }

  const oldScroll = `      const targetOffset = Math.max(0, (index - TV_SCROLL_ANCHOR) * itemTotalWidth);
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: true });`;
  const newScroll = `      const targetOffset = Math.max(0, (index - TV_SCROLL_ANCHOR) * itemTotalWidth);
      // PATCH_V48_NO_ANIM_SCROLL — instant scroll, no queued animations.
      // Animated horizontal scroll was the #1 D-pad lag cause; presses
      // queued 250ms animations that piled up faster than they played.
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: false });`;

  if (!src.includes(oldScroll)) {
    bad('ServiceRow: scrollToOffset block not found.');
    return;
  }
  src = src.replace(oldScroll, newScroll);
  saveFile(F, src, loaded.hadCRLF);
  ok('ServiceRow: horizontal scroll set to animated:false');
}

// ─────────────────────────────────────────────────────────────────
// FIX 3: ContentCard.tsx — remove per-card setTimeout(100ms)
// ─────────────────────────────────────────────────────────────────
function patchContentCard() {
  const F = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
  const loaded = loadFile(F);
  if (!loaded) { bad('not found: ' + F); return; }
  let src = loaded.text;
  if (src.includes('PATCH_V48_NO_NODEHANDLE_TIMER')) { ok('ContentCard already patched'); return; }

  const oldBlock = `  // Also try on mount and when isFirst/isLast changes
  useEffect(() => {
    if ((isFirstInRow || isLastInRow) && pressableRef.current) {
      // Small delay to ensure native view is ready
      const timer = setTimeout(() => {
        if (pressableRef.current) {
          const tag = getNativeTag(pressableRef.current);
          if (tag && tag > 0) setSelfTag(tag);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isFirstInRow, isLastInRow]);`;

  const newBlock = `  // PATCH_V48_NO_NODEHANDLE_TIMER — removed per-card setTimeout(100ms).
  // With ~30 rows × 6 cards visible, this was firing 60+ deferred bridge
  // calls on cold start. The handleLayout path above already fires the
  // native tag assignment when the view is laid out — no timer needed.`;

  if (!src.includes(oldBlock)) {
    bad('ContentCard: useEffect timer block not found.');
    return;
  }
  src = src.replace(oldBlock, newBlock);
  saveFile(F, src, loaded.hadCRLF);
  ok('ContentCard: removed per-card setTimeout focus-trap timer');
}

console.log('=== V48 — Deep perf fix (Streamer 4K lag) ===\n');
patchRootLayout();
patchServiceRow();
patchContentCard();

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome anchors did not match. Share latest perf_dump.txt.');
  process.exit(1);
} else {
  console.log('\nV48 done. Rebuild + force-stop + relaunch.');
  console.log('Expected:');
  console.log('  ✓ Back from Details → Discover: INSTANT (no freeze/thaw).');
  console.log('  ✓ D-pad on Discover: SNAPPY (no queued scroll animations).');
  console.log('  ✓ Cold start: faster (no per-card 100ms timers piling up).');
  console.log('');
  console.log('If lag is finally gone:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V48 — no freeze, no anim scroll, no per-card timers"');
}
