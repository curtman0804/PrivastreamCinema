/* eslint-disable */
// apply_patches_v144_discover_async_cache.js
//
// DISCOVER COLD-START CACHE — instant paint on app open.
//
// Your complaint:
//   "I backed outta the app, and went back in, and had to wait for
//    everything to load again before I could navigate. The discover
//    screen needs to be cached. Posters and 'In Cinema' badges pop in
//    after a delay."
//
// Root cause: Discover data lives in zustand `useContentStore`, which
// is in-memory only.  On cold start it's empty → spinner → fetch →
// services arrive → flatRowsV54 rebuilds → posters render → meta
// (in-cinema badges, etc.) arrives on each card → second paint wave.
//
// v144 adds a disk-backed snapshot using AsyncStorage:
//
//   1. On every successful discoverData update, snapshot to
//      AsyncStorage under @ps_discover_v1.
//   2. On every continueWatching update, snapshot to @ps_cw_v1.
//   3. On cold mount, asynchronously read both snapshots and load them
//      into `cachedDiscover` + `cachedCW` local state.
//   4. The render pipeline (hasContent, flatRowsV54, CW FlatList, the
//      "No content" gate, the initial-load spinner) now prefers live
//      store data when present, otherwise falls back to the cached
//      snapshot.  Result: posters paint within ~1 frame of the screen
//      mounting, just like Stremio.
//
// Pairs with v145 (LayoutAnimation X dismiss).
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v144_discover_async_cache.js -o apply_patches_v144.js && node apply_patches_v144.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const discoverPath = find(path.join('app', '(tabs)', 'discover.tsx'));
if (!discoverPath) {
  console.error('[v144] FATAL: app/(tabs)/discover.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(discoverPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = discoverPath + '.bak_v144';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v144] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ─────────────────────────────────────────────────────────────
// PATCH 1 — import AsyncStorage
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_import_asyncstorage',
  'PATCH_V144_CACHE_IMPORT',
  `import { Image as RNImage } from 'react-native';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');`,
  `import { Image as RNImage } from 'react-native';
// PATCH_V144_CACHE_IMPORT — disk-backed snapshot for instant cold-start paint
import AsyncStorage from '@react-native-async-storage/async-storage';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — cached-snapshot state
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_cached_state',
  'PATCH_V144_CACHE_STATE',
  `  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);`,
  `  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  // PATCH_V144_CACHE_STATE — snapshots loaded from AsyncStorage on cold mount
  const [cachedDiscover, setCachedDiscover] = useState<any>(null);
  const [cachedCW, setCachedCW] = useState<WatchProgress[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 3 — hydrate + persist useEffects
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p3_hydrate_and_persist',
  'PATCH_V144_CACHE_HYDRATE',
  `  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);`,
  `  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);

  // PATCH_V144_CACHE_HYDRATE — load disk snapshot on cold start for instant paint
  useEffect(() => {
    (async () => {
      try {
        const [d, c] = await Promise.all([
          AsyncStorage.getItem('@ps_discover_v1'),
          AsyncStorage.getItem('@ps_cw_v1'),
        ]);
        if (d) {
          try { setCachedDiscover(JSON.parse(d)); } catch (_) {}
        }
        if (c) {
          try { setCachedCW(JSON.parse(c)); } catch (_) {}
        }
      } catch (_) {}
    })();
  }, []);

  // PATCH_V144_CACHE_PERSIST — snapshot store data to disk on every update
  useEffect(() => {
    if (discoverData?.services) {
      try {
        AsyncStorage.setItem('@ps_discover_v1', JSON.stringify(discoverData)).catch(() => {});
      } catch (_) {}
    }
  }, [discoverData]);

  useEffect(() => {
    try {
      AsyncStorage.setItem('@ps_cw_v1', JSON.stringify(continueWatching || [])).catch(() => {});
    } catch (_) {}
  }, [continueWatching]);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 4 — hasContent falls back to cached snapshot
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p4_hascontent_fallback',
  'PATCH_V144_CACHE_HASCONTENT',
  `  // Check if there's any content to display
  const hasContent = useMemo(() => {
    if (!discoverData?.services) return false;
    return Object.values(discoverData.services).some(
      (content: any) => 
        (content?.movies?.length > 0) || 
        (content?.series?.length > 0) || 
        (content?.channels?.length > 0)
    );
  }, [discoverData]);`,
  `  // Check if there's any content to display
  // PATCH_V144_CACHE_HASCONTENT — prefer live data, fall back to cached snapshot
  const hasContent = useMemo(() => {
    const services = discoverData?.services || cachedDiscover?.services;
    if (!services) return false;
    return Object.values(services).some(
      (content: any) => 
        (content?.movies?.length > 0) || 
        (content?.series?.length > 0) || 
        (content?.channels?.length > 0)
    );
  }, [discoverData, cachedDiscover]);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 5 — flatRowsV54 falls back to cached snapshot
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p5_flatrows_fallback',
  'PATCH_V144_CACHE_FLATROWS',
  `// Build flattened rows safely (optimized)
const flatRowsV54 = useMemo(() => {
  const rows: any[] = [];

  const services = discoverData?.services;
  if (!services || typeof services !== 'object') {
    return rows;
  }

  // Continue Watching row (constant identity, no recalculation logic)
  if (continueWatching?.length > 0) {
    rows.push({ key: '__cw__', kind: 'cw' });
  }`,
  `// Build flattened rows safely (optimized)
const flatRowsV54 = useMemo(() => {
  const rows: any[] = [];

  // PATCH_V144_CACHE_FLATROWS — prefer live data, fall back to cached snapshot
  const services = discoverData?.services || cachedDiscover?.services;
  if (!services || typeof services !== 'object') {
    return rows;
  }

  const cwSource = (continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW;

  // Continue Watching row (constant identity, no recalculation logic)
  if (cwSource?.length > 0) {
    rows.push({ key: '__cw__', kind: 'cw' });
  }`
);

// ─────────────────────────────────────────────────────────────
// PATCH 6 — flatRowsV54 deps now include cached snapshots
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p6_flatrows_deps',
  'PATCH_V144_CACHE_DEPS',
  `  return rows.slice(0, 1 + maxRowsV54);
}, [discoverData?.services, continueWatching, maxRowsV54]);`,
  `  return rows.slice(0, 1 + maxRowsV54);
  // PATCH_V144_CACHE_DEPS — re-evaluate when cached fallback hydrates
}, [discoverData?.services, cachedDiscover?.services, continueWatching, cachedCW, maxRowsV54]);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 7 — initial-load spinner skipped if cached snapshot exists
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p7_skip_spinner',
  'PATCH_V144_CACHE_SPINNER',
  `// Show loading only on initial load
if (isLoadingDiscover && !discoverData) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
}`,
  `// Show loading only on initial load
// PATCH_V144_CACHE_SPINNER — skip the spinner entirely if we have a cached snapshot
if (isLoadingDiscover && !discoverData && !cachedDiscover) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
}`
);

// ─────────────────────────────────────────────────────────────
// PATCH 8 — "No content" welcome gate also considers cached CW
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p8_welcome_gate',
  'PATCH_V144_CACHE_WELCOME',
  `    {!hasContent && continueWatching.length === 0 && !isLoadingDiscover ? (`,
  `    {/* PATCH_V144_CACHE_WELCOME — also consider cached CW so we don't flash "No Addons" */}
    {!hasContent && continueWatching.length === 0 && cachedCW.length === 0 && !isLoadingDiscover ? (`
);

// ─────────────────────────────────────────────────────────────
// PATCH 9 — CW FlatList prefers live data, falls back to cached
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p9_cw_flatlist_data',
  'PATCH_V144_CACHE_CWDATA',
  `                  <FlatList
                    data={continueWatching}
                    renderItem={renderContinueWatchingItem}
                    keyExtractor={(cwItem) =>
                      String(cwItem.content_id)
                    }`,
  `                  <FlatList
                    /* PATCH_V144_CACHE_CWDATA — fall back to cached CW for cold-start paint */
                    data={(continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW}
                    renderItem={renderContinueWatchingItem}
                    keyExtractor={(cwItem) =>
                      String(cwItem.content_id)
                    }`
);

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v144] All patches already applied — no changes written.');
} else {
  fs.writeFileSync(discoverPath, src, 'utf8');
  console.log(`[v144] Wrote ${discoverPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v144] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}

const okCount = reports.filter(r => r.status === 'OK').length;
const skipCount = reports.filter(r => r.status === 'SKIP_IDEMPOTENT').length;
const failCount = reports.length - okCount - skipCount;
console.log(`[v144] Summary: ${okCount} applied, ${skipCount} already-applied, ${failCount} failed.`);
process.exit(failCount > 0 ? 1 : 0);
