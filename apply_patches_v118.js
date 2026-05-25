// apply_patches_v118_discover_focus_throttle.js
// Stops Discover from force-reloading every catalog when the user backs
// out of Search (or any other screen). Only refetches if data is stale.
//
// Adds a `lastDiscoverFetchTime` ref and only fires fetchDiscover(true)
// when >60s have elapsed since the last fetch. Continue-watching keeps
// its own 30s throttle (already in code).
// CRLF-safe.
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'discover.tsx');
function fail(msg) { console.error(`[v118] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v118] ok: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. cd into the frontend folder first.`);

const origBuffer = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = origBuffer.includes('\r\n');
let src = origBuffer.replace(/\r\n/g, '\n');
const norm = src;

if (src.includes('V118_FOCUS_THROTTLE')) {
  console.log('[v118] = already applied');
  process.exit(0);
}

// 1) Add lastDiscoverFetchTime ref next to lastCWFetchTime
const REF_OLD = `  const lastCWFetchTime = useRef<number>(0);`;
const REF_NEW = `  const lastCWFetchTime = useRef<number>(0);
  // V118_FOCUS_THROTTLE: skip discover refetch on screen focus if recent
  const lastDiscoverFetchTime = useRef<number>(0);`;

if (!src.includes(REF_OLD)) fail('anchor REF (lastCWFetchTime) not found');
src = src.replace(REF_OLD, REF_NEW);
ok('A: lastDiscoverFetchTime ref added');

// 2) Set lastDiscoverFetchTime on initial mount + focus fetches
//    Wrap the existing useFocusEffect callback with throttle logic.
const FOCUS_OLD = `  // Re-fetch discover data AND continue watching when screen comes into focus
  // This ensures newly installed addons show up immediately
  useFocusEffect(
    useCallback(() => {
      const timeSinceLastFetch = Date.now() - lastCWFetchTime.current;
      if (timeSinceLastFetch < 30000 && continueWatching.length >= 0) {
        return;
      }
      const handle = InteractionManager.runAfterInteractions(() => {
        fetchContinueWatching();
        fetchDiscover(true); // Force refresh so new addon catalogs appear
      });
      return () => handle.cancel();
    }, [fetchContinueWatching, continueWatching.length])
  );`;

const FOCUS_NEW = `  // V118_FOCUS_THROTTLE: only refetch discover if data is stale (>60s old)
  // Backing out of Search no longer triggers a full catalog reload.
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const timeSinceCW = now - lastCWFetchTime.current;
      const timeSinceDiscover = now - lastDiscoverFetchTime.current;
      const cwStale = timeSinceCW >= 30000;
      const discoverStale = timeSinceDiscover >= 60000;

      if (!cwStale && !discoverStale) {
        // both fresh -> nothing to do
        return;
      }

      const handle = InteractionManager.runAfterInteractions(() => {
        if (cwStale) {
          fetchContinueWatching();
        }
        if (discoverStale) {
          fetchDiscover(true); // force refresh so new addon catalogs appear
          lastDiscoverFetchTime.current = Date.now();
        }
      });
      return () => handle.cancel();
    }, [fetchContinueWatching])
  );`;

if (!src.includes(FOCUS_OLD)) fail('anchor FOCUS (useFocusEffect block) not found');
src = src.replace(FOCUS_OLD, FOCUS_NEW);
ok('B: useFocusEffect now throttles discover refetch (60s) independently from CW (30s)');

// 3) Also stamp on initial mount so 1st focus after mount doesn't double-fetch
const MOUNT_OLD = `  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
  }, []);`;
const MOUNT_NEW = `  useEffect(() => {
    fetchAddons();
    fetchDiscover();
    fetchContinueWatching();
    // V118: stamp initial fetch so the focus throttle starts ticking now
    lastDiscoverFetchTime.current = Date.now();
  }, []);`;

if (!src.includes(MOUNT_OLD)) fail('anchor MOUNT (initial useEffect) not found');
src = src.replace(MOUNT_OLD, MOUNT_NEW);
ok('C: initial mount stamps lastDiscoverFetchTime');

// 4) Also stamp on pull-to-refresh so we don't immediately refetch after manual refresh
const REFRESH_OLD = `  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchAddons(),
      fetchDiscover(),
      fetchContinueWatching(),
    ]);
    setRefreshing(false);
  }, [fetchContinueWatching]);`;

const REFRESH_NEW = `  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchAddons(),
      fetchDiscover(),
      fetchContinueWatching(),
    ]);
    // V118: stamp so we don't refetch again immediately after pull-to-refresh
    lastDiscoverFetchTime.current = Date.now();
    setRefreshing(false);
  }, [fetchContinueWatching]);`;

if (src.includes(REFRESH_OLD)) {
  src = src.replace(REFRESH_OLD, REFRESH_NEW);
  ok('D: pull-to-refresh also stamps timestamp');
} else {
  console.log('[v118] note: onRefresh anchor not found (non-fatal)');
}

if (src === norm) fail('No changes applied');

const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;

const bak = TARGET + '.bak.v118.' + Date.now();
fs.writeFileSync(bak, origBuffer, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v118] backup: ${bak}`);
console.log(`[v118] OK wrote ${TARGET}`);
console.log('');
console.log('Next: npx expo start --clear, rebuild & sideload.');
console.log('Test: open Search -> back to Discover should be INSTANT (no reload).');
console.log('Discover only refreshes if >60s since last fetch, or via pull-to-refresh.');
