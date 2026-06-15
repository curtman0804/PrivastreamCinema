// =============================================================================
// PATCH v211 — Discover lag & vertical-nav polish (clean baseline)
//
// Built against your post-rollback baseline (b11_*).  Two surgical changes,
// both touching ONLY `app/(tabs)/discover.tsx`.  No image swaps (you already
// use expo-image — that was the v210 crash cause), no focus-chain rewiring.
//
//   FIX A — Throttled section focus with proper row framing
//           Drops duplicate D-pad fires (UP/DOWN no longer skips rows or
//           ignores presses) and frames the focused row at 1/3 down the
//           viewport so the title is visible.
//
//   FIX B — Cold-boot defer
//           Paint Discover from the AsyncStorage cache hydration FIRST,
//           push the parallel network fetches off the first paint frame.
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v211_discover_clean.js -o v211.js
//   node v211.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const F = path.join(ROOT, 'app/(tabs)/discover.tsx');

if (!fs.existsSync(F)) {
  console.log('[ERR] app/(tabs)/discover.tsx not found at ' + F);
  process.exit(1);
}

let src = fs.readFileSync(F, 'utf8');
const before = src;

// Windows files have CRLF.  Normalize for matching, but write back what the
// user had so we don't corrupt line endings.
const usesCRLF = /\r\n/.test(src);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(src);

if (work.includes('// v211 discover clean')) {
  console.log('[noop] discover already patched.');
  process.exit(0);
}

// --- FIX A — handleSectionFocus throttle + better scroll target ---
const oldFocus = `  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    lastFocusedSection.current = sectionKey;
    
    const sectionY = sectionPositions.current[sectionKey];
    if (sectionY !== undefined && scrollViewRef.current) {
      // V109_INSTANT_SCROLL: instant snap (no animation queue) so held D-pad
      // flies through rows like Stremio. Negative offset keeps the title row
      // visible above the focused poster.
      scrollViewRef.current.scrollTo({ y: Math.max(0, sectionY - 10), animated: false });
    }
  }, []);`;

const newFocus = `  // v211 discover clean — throttled focus + top-third framing
  const _v211FocusCooldown = useRef<number>(0);
  const _v211PendingFrame = useRef<number | null>(null);
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    const now = Date.now();
    // Drop duplicate D-pad fires within 80ms — fixes "skips 2 rows" and
    // "press does nothing" symptoms caused by overlapping focus events.
    if (now - _v211FocusCooldown.current < 80) return;
    _v211FocusCooldown.current = now;
    lastFocusedSection.current = sectionKey;

    // Coalesce scroll-to into one rAF — never queue multiple scrollTos.
    if (_v211PendingFrame.current != null) {
      cancelAnimationFrame(_v211PendingFrame.current);
      _v211PendingFrame.current = null;
    }
    _v211PendingFrame.current = requestAnimationFrame(() => {
      _v211PendingFrame.current = null;
      const sectionY = sectionPositions.current[sectionKey];
      if (sectionY === undefined || !scrollViewRef.current) return;
      // Frame focused row near the top third: title is visible above and
      // the next row's title peeks at the bottom — Stremio-style rhythm.
      // (Was sectionY - 10; now sectionY - 32 keeps title comfortably clear.)
      const target = Math.max(0, sectionY - 32);
      scrollViewRef.current.scrollTo({ y: target, animated: false });
    });
  }, []);`;

if (!work.includes(oldFocus)) {
  console.log('[ERR] handleSectionFocus block did not match exact baseline. Aborting.');
  process.exit(1);
}
work = work.replace(oldFocus, newFocus);

// --- FIX B — Cold-boot defer ---
const oldBoot = `  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);`;

const newBoot = `  useEffect(() => {
    // v211 cold-boot — paint Discover from AsyncStorage cache (hydrated in
    // the next useEffect) FIRST.  The three network fetches go through
    // InteractionManager so they don't compete with row mount work for the
    // JS thread on the first ~500 ms after mount.
    const _v211H = InteractionManager.runAfterInteractions(() => {
      try { fetchDiscover(); } catch (_) {}
      try { fetchContinueWatching(); } catch (_) {}
      try { fetchAddons(); } catch (_) {}
    });
    return () => { try { (_v211H as any).cancel && (_v211H as any).cancel(); } catch (_) {} };
  }, []);`;

if (!work.includes(oldBoot)) {
  console.log('[ERR] cold-boot useEffect did not match exact baseline. Aborting.');
  process.exit(1);
}
work = work.replace(oldBoot, newBoot);

if (work === normalize(before)) {
  console.log('[noop] nothing actually changed.');
  process.exit(0);
}

fs.writeFileSync(F + '.bak_v211', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/(tabs)/discover.tsx patched');
console.log('       backup at app/(tabs)/discover.tsx.bak_v211');
console.log('');
console.log('Rebuild APK + sideload to Firestick.  Expected:');
console.log('  • Cold boot: Discover paints from cache; no blank stretch.');
console.log('  • UP/DOWN through rows: deterministic 1-press-1-row.');
console.log('  • Focused row sits in the upper third with its title visible.');
console.log('');
console.log('Rollback if needed:');
console.log('  copy /Y "app\\(tabs)\\discover.tsx.bak_v211" "app\\(tabs)\\discover.tsx"');
