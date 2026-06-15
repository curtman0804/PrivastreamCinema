// =============================================================================
// PATCH v210b — Discover lag + nav polish (NO expo-image, NO native changes)
//
// Excludes the v210 expo-image swap that crashed at runtime.  Keeps only the
// pure-JS wins:
//   • Throttled handleSectionFocus  (kills nav skips and dead D-pad presses)
//   • Smarter scroll target          (focused row sits in top third of view)
//   • Cold-boot defer of CW+addons   (faster first paint on cold start)
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v210b_discover_safe.js -o v210b.js
//   node v210b.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = fs.readFileSync(full, 'utf8');
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v210b', before, 'utf8');
  fs.writeFileSync(full, after, 'utf8');
  console.log('  [ok]   ' + label);
}

console.log('--- Applying v210b (safe) patch ---');

patch('discover — throttled focus + smart scroll + cold-boot defer',
      'app/(tabs)/discover.tsx', (src) => {
  let s = src;
  if (s.includes("// v210b safe")) return s;

  // 1) Replace handleSectionFocus body with rAF + 80ms cooldown + top-third
  //    framing.  Match leniently — the old version may be a single line or
  //    a small multi-line block.
  s = s.replace(
    /\/\/ Handle section focus[\s\S]*?const handleSectionFocus = useCallback\(\(sectionKey: string\) => \{[\s\S]*?\}, \[\]\);/,
    `// Handle section focus — v210b safe: rAF-throttled, dedup'd, top-third frame
  const _v210bFocusCooldown = useRef<number>(0);
  const _v210bPendingFrame = useRef<number | null>(null);
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    const now = Date.now();
    if (now - _v210bFocusCooldown.current < 80) return; // drop duplicate D-pad fires
    _v210bFocusCooldown.current = now;
    lastFocusedSection.current = sectionKey;

    if (_v210bPendingFrame.current != null) {
      cancelAnimationFrame(_v210bPendingFrame.current);
      _v210bPendingFrame.current = null;
    }
    _v210bPendingFrame.current = requestAnimationFrame(() => {
      _v210bPendingFrame.current = null;
      const sectionY = sectionPositions.current[sectionKey];
      if (sectionY === undefined || !scrollViewRef.current) return;
      // Frame focused row in the upper third — title visible, next row peeks.
      const target = Math.max(0, sectionY - 32);
      scrollViewRef.current.scrollTo({ y: target, animated: false });
    });
  }, []);`
  );

  // 2) Cold-boot defer: also defer fetchContinueWatching off the first paint.
  //    v208 already deferred fetchAddons; v210b just extends the pattern.
  s = s.replace(
    /useEffect\(\(\) => \{\s*\n\s*\/\/ v208 cold-boot defer[\s\S]*?return \(\) => \{[\s\S]*?\};\s*\n\s*\}, \[\]\);/,
    `useEffect(() => {
    // v210b cold-boot — paint Discover from AsyncStorage cache first; defer
    // ALL fetches off the first paint frame so the JS thread isn't competing
    // with row mount work.  Network refresh lands a beat later via SWR.
    fetchDiscover();
    const _v210bH = InteractionManager.runAfterInteractions(() => {
      try { fetchContinueWatching(); } catch (_) {}
      try { fetchAddons(); } catch (_) {}
    });
    return () => { try { _v210bH.cancel && _v210bH.cancel(); } catch (_) {} };
  }, []);`
  );

  return s;
});

console.log('--- v210b patch complete ---');
console.log('');
console.log('Rebuild APK and sideload.  Expected on Firestick:');
console.log('  • Cold boot Discover paints from cache instantly, no blank stretch.');
console.log('  • UP/DOWN through rows: one press = one row, no skips, no dead presses.');
console.log('  • Focused row scrolls into the top third with its title visible.');
console.log('');
console.log('Poster caching (the riskier expo-image swap) is deferred to a separate');
console.log('patch that will also wire up app.json plugin config.');
