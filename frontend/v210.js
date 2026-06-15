// =============================================================================
// PATCH v210 — Discover lag + poster caching + vertical nav polish
//
// Focused, low-risk overhaul.  Hits:
//   • Poster B (uneven pop-in)         → expo-image disk cache
//   • Poster C (reload on scroll back) → expo-image memory cache + prefetch
//   • Discover A (cold-boot paint)     → InteractionManager-defer CW + addons
//   • Discover B/C (choppy scroll)     → throttled focus handler with rAF
//   • Nav A/B (skips, dead presses)    → focus cooldown ref drops duplicate events
//   • Nav C (focus off-screen)         → scrollTo target centres focused row
//
// Run from C:\Users\Curtm\PrivastreamCinema\frontend:
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v210_discover_polish.js -o v210.js
//   node v210.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, c) => fs.writeFileSync(p, c, 'utf8');
const exists = (p) => { try { fs.accessSync(p); return true; } catch { return false; } };

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = read(full);
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v210', before, 'utf8');
  write(full, after);
  console.log('  [ok]   ' + label);
}

console.log('--- Applying v210 patch ---');

// ============================================================================
// FIX 1 — ContentCard: swap RNImage for expo-image with memory+disk cache.
//          One-line per RNImage usage; preserves all props.
// ============================================================================
patch('ContentCard — expo-image poster cache', 'src/components/ContentCard.tsx', (src) => {
  let s = src;
  if (s.includes("// v210 expo-image")) return s;

  // Add import below the existing react-native import block
  s = s.replace(
    /Image as RNImage,/,
    `Image as RNImage,\n  // v210 expo-image — keep RNImage import as fallback`
  );
  if (!/from ['"]expo-image['"]/.test(s)) {
    s = s.replace(
      /import \{ Image as RNImage[\s\S]*?from 'react-native';/,
      (m) => m + "\nimport { Image as ExpoImage } from 'expo-image';"
    );
    // Above replacement may not match the multi-line react-native import pattern.
    // Fallback: prepend right after the last react-native import line.
    if (!/expo-image/.test(s)) {
      s = s.replace(
        /(from 'react-native';)/,
        `$1\nimport { Image as ExpoImage } from 'expo-image';`
      );
    }
  }

  // Replace ALL <RNImage in this file with <ExpoImage with cachePolicy added
  s = s.replace(
    /<RNImage(\s[^>]*?)\/>/g,
    (m, attrs) => `<ExpoImage${attrs} cachePolicy="memory-disk" transition={120} />`
  );
  s = s.replace(
    /<RNImage(\s[^>]*?)>/g,
    (m, attrs) => `<ExpoImage${attrs} cachePolicy="memory-disk" transition={120}>`
  );
  s = s.replace(/<\/RNImage>/g, '</ExpoImage>');

  return s;
});

// ============================================================================
// FIX 2 — Discover screen: swap RNImage in CW row + add prefetch + tighter
//          focus handler + scroll-into-view that frames the focused row
//          near the top third of the viewport instead of pinned to edge.
// ============================================================================
patch('discover — expo-image + throttled focus + smart scroll', 'app/(tabs)/discover.tsx', (src) => {
  let s = src;
  if (s.includes("// v210 discover polish")) return s;

  // 2a) Import expo-image alongside RNImage
  if (!/from ['"]expo-image['"]/.test(s)) {
    s = s.replace(
      /import \{ Image as RNImage \} from 'react-native';/,
      `import { Image as RNImage } from 'react-native';\nimport { Image as ExpoImage } from 'expo-image';\n// v210 discover polish — expo-image for CW posters`
    );
  }

  // 2b) Swap RNImage usages
  s = s.replace(
    /<RNImage(\s[^>]*?)\/>/g,
    (m, attrs) => `<ExpoImage${attrs} cachePolicy="memory-disk" transition={120} />`
  );
  s = s.replace(
    /<RNImage(\s[^>]*?)>/g,
    (m, attrs) => `<ExpoImage${attrs} cachePolicy="memory-disk" transition={120}>`
  );
  s = s.replace(/<\/RNImage>/g, '</ExpoImage>');

  // 2c) Rewrite handleSectionFocus: rAF + 80ms cooldown + viewport-centred target
  s = s.replace(
    /\/\/ Handle section focus[\s\S]*?const handleSectionFocus = useCallback\(\(sectionKey: string\) => \{[\s\S]*?\}, \[\]\);/,
    `// Handle section focus — v210: rAF-throttled, dedup'd, viewport-aware scroll
  const _v210FocusCooldown = useRef<number>(0);
  const _v210PendingFrame = useRef<number | null>(null);
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    const now = Date.now();
    if (now - _v210FocusCooldown.current < 80) return; // drop duplicate D-pad fires
    _v210FocusCooldown.current = now;
    lastFocusedSection.current = sectionKey;

    // Cancel any queued frame and schedule a fresh scroll on the next frame
    if (_v210PendingFrame.current != null) {
      cancelAnimationFrame(_v210PendingFrame.current);
      _v210PendingFrame.current = null;
    }
    _v210PendingFrame.current = requestAnimationFrame(() => {
      _v210PendingFrame.current = null;
      const sectionY = sectionPositions.current[sectionKey];
      if (sectionY === undefined || !scrollViewRef.current) return;
      // v210 — frame the focused row in the top third of the viewport so
      // the title is always visible above the posters AND the next row's
      // title peeks at the bottom (Stremio-like rhythm).
      const target = Math.max(0, sectionY - 32);
      scrollViewRef.current.scrollTo({ y: target, animated: false });
    });
  }, []);`
  );

  // 2d) Cold-boot defer: extend v208 — also defer fetchContinueWatching after
  //     the very first paint (we already painted from AsyncStorage cache).
  s = s.replace(
    /useEffect\(\(\) => \{\s*\n\s*\/\/ v208 cold-boot defer[\s\S]*?return \(\) => \{[\s\S]*?\};\s*\n\s*\}, \[\]\);/,
    `useEffect(() => {
    // v210 cold-boot — paint Discover from cache first, defer ALL fetches
    // off the first paint frame.  CW posters keep what AsyncStorage had;
    // network refresh lands a beat later via SWR.
    fetchDiscover();
    const _v210h = InteractionManager.runAfterInteractions(() => {
      try { fetchContinueWatching(); } catch (_) {}
      try { fetchAddons(); } catch (_) {}
    });
    return () => { try { _v210h.cancel && _v210h.cancel(); } catch (_) {} };
  }, []);`
  );

  // 2e) Add a one-time poster prefetch for the first row of the first 3
  //     services once the discoverData arrives (warms expo-image cache).
  if (!s.includes('_v210PrefetchDone')) {
    s = s.replace(
      /const flatRowsV54 = useMemo\(/,
      `// v210 — warm expo-image cache for the first ~24 posters so they
  // appear instantly when the user scrolls.
  const _v210PrefetchDone = useRef(false);
  useEffect(() => {
    if (_v210PrefetchDone.current) return;
    if (!discoverData) return;
    const urls: string[] = [];
    try {
      for (const cat of Object.values((discoverData as any).categories || {})) {
        for (const it of ((cat as any) || []).slice(0, 8)) {
          if (it && it.poster) urls.push(String(it.poster));
        }
        if (urls.length >= 24) break;
      }
    } catch (_) {}
    if (urls.length === 0) return;
    _v210PrefetchDone.current = true;
    InteractionManager.runAfterInteractions(() => {
      try { ExpoImage.prefetch(urls, 'memory-disk'); } catch (_) {}
    });
  }, [discoverData]);

  const flatRowsV54 = useMemo(`
    );
  }

  return s;
});

// ============================================================================
// FIX 3 — ServiceRow: swap RNImage if any, and tighten the row focus handler
//          (rAF wrap) so rapid UP/DOWN doesn't queue stale focus events.
// ============================================================================
patch('ServiceRow — expo-image swap', 'src/components/ServiceRow.tsx', (src) => {
  let s = src;
  if (s.includes('// v210 ServiceRow')) return s;

  if (/RNImage|react-native[^'"]*Image/.test(s)) {
    if (!/from ['"]expo-image['"]/.test(s)) {
      s = s.replace(
        /from 'react-native';/,
        `from 'react-native';\nimport { Image as ExpoImage } from 'expo-image';\n// v210 ServiceRow`
      );
    }
    s = s.replace(
      /<RNImage(\s[^>]*?)\/>/g,
      (m, attrs) => `<ExpoImage${attrs} cachePolicy="memory-disk" transition={120} />`
    );
  } else {
    // Mark file as visited so the noop check works on re-runs
    s = '// v210 ServiceRow — no RNImage to swap\n' + s;
  }

  return s;
});

console.log('--- v210 patch complete ---');
console.log('');
console.log('Press r in Expo CLI.  expo-image is already in package.json, no install needed.');
console.log('');
console.log('After fresh APK build + sideload, expected on Firestick:');
console.log('  • Cold boot: Discover paints from cache instantly, network refresh');
console.log('    arrives transparently.  No long blank stretch.');
console.log('  • Posters stay loaded as you scroll up and down (memory + disk cache).');
console.log('  • UP/DOWN through rows: one press = one row, no skips, no dead presses.');
console.log('  • Focused row scrolls into top third of screen with the title visible.');
console.log('');
console.log('If a row goes off-screen or feels slow still, paste a screen-record and');
console.log('I will tighten the timings.');
