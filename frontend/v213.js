// =============================================================================
// PATCH v213 — Discover ScrollView constraints + cold-boot poster prefetch
//
//   FIX A — Stop the over-scroll past the last row.  Adds a bounded
//           contentContainerStyle + overScrollMode="never" so the
//           ScrollView can't fly into empty space below the bottom row.
//           This also stops focus search from chasing invisible targets
//           below the last row, which contributed to nav stalls.
//
//   FIX B — Cold-boot poster prefetch.  When discoverData arrives, warm
//           expo-image's cache with the first ~24 posters in the
//           background (InteractionManager-deferred) so they appear
//           instantly when the user scrolls them into view.
//
// Touches ONE file: app/(tabs)/discover.tsx  (CRLF-safe)
//
// Run:
//   cd C:\Users\Curtm\PrivastreamCinema\frontend
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v213_discover_bottom_and_prefetch.js -o v213.js
//   node v213.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const F = path.join(ROOT, 'app/(tabs)/discover.tsx');

if (!fs.existsSync(F)) { console.log('[ERR] discover.tsx not found'); process.exit(1); }

let raw = fs.readFileSync(F, 'utf8');
const before = raw;
const usesCRLF = /\r\n/.test(raw);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(raw);

if (work.includes('// v213 bottom + prefetch')) {
  console.log('[noop] v213 already applied.'); process.exit(0);
}

// -------------------------------------------------------------------------
// FIX A — ScrollView constraints
// -------------------------------------------------------------------------
const oldScroll = `        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          removeClippedSubviews={true}
          refreshControl={`;

const newScroll = `        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          removeClippedSubviews={true}
          // v213 bottom + prefetch — stop the over-scroll past the last row.
          // Without these the ScrollView happily flies into empty space below
          // the bottom row, which also confuses Android-TV focus search.
          contentContainerStyle={styles._v213ScrollPad}
          overScrollMode="never"
          bounces={false}
          refreshControl={`;

if (!work.includes(oldScroll)) {
  console.log('[ERR] outer ScrollView block did not match baseline. Aborting.');
  process.exit(1);
}
work = work.replace(oldScroll, newScroll);

// Add the style entry near the existing scrollView style.  We append a new
// entry to the StyleSheet — simple regex anchor on `scrollView: { flex: 1 }`.
const scrollStyleAnchor = work.match(/(scrollView:\s*\{[^}]*\},)/);
if (scrollStyleAnchor) {
  work = work.replace(
    scrollStyleAnchor[0],
    scrollStyleAnchor[0] + `
  // v213 — bounded bottom padding so the last row doesn't sit flush against
  // the system nav, but you also can't scroll into a blank void below it.
  _v213ScrollPad: {
    paddingBottom: 24,
  },`
  );
} else {
  // Fallback: append to the styles object before the closing brace.  We
  // hunt for the last `},\n});` pattern.  This is a soft-fallback so don't
  // bail if it misses.
  work = work.replace(
    /\n\}\);\s*$/,
    `\n  _v213ScrollPad: { paddingBottom: 24 },\n});\n`
  );
}

// -------------------------------------------------------------------------
// FIX B — Cold-boot poster prefetch
// -------------------------------------------------------------------------
// Anchor on the existing v211 cold-boot defer useEffect.  Insert a NEW
// useEffect right after it that fires when discoverData first becomes
// available.  Uses expo-image's static Image.prefetch.
const prefetchAnchor = `  }, []);

  // PATCH_V144_CACHE_HYDRATE — load disk snapshot on cold start for instant paint`;

const prefetchInject = `  }, []);

  // v213 bottom + prefetch — warm expo-image's cache with the first ~24
  // discover posters so they paint instantly as they enter the viewport.
  // Deferred via InteractionManager so the prefetch network burst can't
  // compete with the first paint frame.
  const _v213PrefetchDone = useRef(false);
  useEffect(() => {
    if (_v213PrefetchDone.current) return;
    if (!discoverData) return;
    const urls: string[] = [];
    try {
      const services = (discoverData as any).services || {};
      for (const svc of Object.values(services)) {
        for (const bucket of ['movies', 'series', 'channels']) {
          const list = (svc as any)?.[bucket] || [];
          for (const it of list.slice(0, 6)) {
            if (it && it.poster) urls.push(String(it.poster));
          }
        }
        if (urls.length >= 24) break;
      }
    } catch (_) {}
    if (urls.length === 0) return;
    _v213PrefetchDone.current = true;
    const h = InteractionManager.runAfterInteractions(() => {
      try {
        // Lazy-require so we don't add a top-of-file import collision risk.
        const { Image: _ExpoImage } = require('expo-image');
        _ExpoImage.prefetch(urls, 'memory-disk');
      } catch (_) {}
    });
    return () => { try { (h as any).cancel && (h as any).cancel(); } catch (_) {} };
  }, [discoverData]);

  // PATCH_V144_CACHE_HYDRATE — load disk snapshot on cold start for instant paint`;

if (work.includes(prefetchAnchor)) {
  work = work.replace(prefetchAnchor, prefetchInject);
} else {
  console.log('[WARN] prefetch anchor not found — FIX B skipped, FIX A still applied.');
}

if (work === normalize(before)) { console.log('[noop] nothing changed.'); process.exit(0); }

fs.writeFileSync(F + '.bak_v213', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/(tabs)/discover.tsx patched');
console.log('       backup at app/(tabs)/discover.tsx.bak_v213');
console.log('');
console.log('Rebuild APK + sideload.  Expected:');
console.log('  • Last row of Discover now hard-stops at the bottom of the screen.');
console.log('  • Pressing DOWN on the last row should do nothing (focus stays).');
console.log('  • Posters in the first ~24 catalog entries appear noticeably faster.');
console.log('');
console.log('Rollback: copy /Y "app\\(tabs)\\discover.tsx.bak_v213" "app\\(tabs)\\discover.tsx"');
