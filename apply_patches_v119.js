// apply_patches_v119_search_transition_lag.js
// Reduce Discover<->Search transition lag by:
//   1. Wrapping the auto-pagination effect in InteractionManager so it fires
//      AFTER the navigation animation completes (not during it).
//   2. Adding removeClippedSubviews to the ScrollView so off-screen posters
//      drop out of the native view hierarchy.
//   3. Delaying the initial search() call by one frame so the transition
//      animation can paint first.
// CRLF-safe.

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'search.tsx');
function fail(m) { console.error(`[v119] FATAL: ${m}`); process.exit(1); }
function ok(m)   { console.log(`[v119] ok: ${m}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. cd into the frontend folder first.`);

const orig = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = orig.includes('\r\n');
let src = orig.replace(/\r\n/g, '\n');
const norm = src;

if (src.includes('V119_TRANSITION_LAG')) {
  console.log('[v119] = already applied');
  process.exit(0);
}

// ---- 1. Ensure InteractionManager is imported from react-native ----
if (!src.includes("InteractionManager")) {
  // Append to existing react-native import
  const RN_IMPORT_RE = /from\s+['"]react-native['"]/;
  if (!RN_IMPORT_RE.test(src)) fail("react-native import not found");
  // Try to insert InteractionManager into the destructured import list
  const importLineMatch = src.match(/import\s*\{([^}]+)\}\s*from\s*['"]react-native['"]/);
  if (importLineMatch) {
    const existing = importLineMatch[1];
    const newImport = `import {${existing}, InteractionManager} from 'react-native'`;
    src = src.replace(importLineMatch[0], newImport);
    ok('A: InteractionManager imported from react-native');
  } else {
    // Add a new import line right after a known react-native import
    src = src.replace(/(import\s+.*\s+from\s+['"]react-native['"];)/, `$1\nimport { InteractionManager } from 'react-native';`);
    ok('A: InteractionManager added as separate import line');
  }
} else {
  ok('A: InteractionManager already imported');
}

// ---- 2. Wrap the v112 auto-pagination effect with InteractionManager ----
const PAG_OLD = `  // V112: auto-page through ALL remaining results once initial search finishes
  // V112B: added console diagnostics
  useEffect(() => {
    console.log('[SEARCH/v112b] page-effect tick', {
      hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore,
      pagesLoaded: pagesLoaded.current,
      movies: searchMovies.length, series: searchSeries.length,
    });
    if (!hasSearched) return;
    if (isLoadingSearch || isLoadingMoreSearch) return;
    if (!searchHasMore) return;
    if (pagesLoaded.current >= 15) return; // safety cap (~1500 items per type)
    pagesLoaded.current += 1;
    console.log('[SEARCH/v112b] firing loadMoreSearch() page=' + pagesLoaded.current);
    loadMoreSearch();
  }, [hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore, loadMoreSearch, searchMovies.length, searchSeries.length]);`;

const PAG_NEW = `  // V119_TRANSITION_LAG: defer auto-paging until AFTER nav transition completes
  // so the Discover->Search animation doesn't stutter on the JS thread.
  useEffect(() => {
    if (!hasSearched) return;
    if (isLoadingSearch || isLoadingMoreSearch) return;
    if (!searchHasMore) return;
    if (pagesLoaded.current >= 15) return;
    const handle = InteractionManager.runAfterInteractions(() => {
      pagesLoaded.current += 1;
      loadMoreSearch();
    });
    return () => handle.cancel();
  }, [hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore, loadMoreSearch, searchMovies.length, searchSeries.length]);`;

if (!src.includes(PAG_OLD)) fail('anchor PAG (v112b auto-pagination effect) not found');
src = src.replace(PAG_OLD, PAG_NEW);
ok('B: auto-pagination now waits for InteractionManager (post-transition)');

// ---- 3. Defer the initial search() trigger by one frame ----
const TRIG_OLD = `      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      search(decodedQuery);`;

const TRIG_NEW = `      hasTriggeredInitialSearch.current = true;
      const decodedQuery = decodeURIComponent(queryParam);
      setCurrentQuery(decodedQuery);
      setHasSearched(true);
      // V119: defer the network call until the screen has painted
      InteractionManager.runAfterInteractions(() => {
        search(decodedQuery);
      });`;

if (src.includes(TRIG_OLD)) {
  src = src.replace(TRIG_OLD, TRIG_NEW);
  ok('C: initial search call deferred to runAfterInteractions');
} else {
  console.log('[v119] note: TRIG anchor not found (non-fatal — initial search trigger may be in different shape)');
}

// ---- 4. Add removeClippedSubviews to the ScrollView ----
const SV_OLD = `        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          /* V112B_LOCK_BOTTOM: hard-stop at last row, no overscroll past content */
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
        >`;

const SV_NEW = `        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          /* V112B_LOCK_BOTTOM: hard-stop at last row, no overscroll past content */
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
          /* V119_TRANSITION_LAG: drop offscreen rows from native view tree */
          removeClippedSubviews={true}
        >`;

if (src.includes(SV_OLD)) {
  src = src.replace(SV_OLD, SV_NEW);
  ok('D: ScrollView removeClippedSubviews enabled');
} else {
  console.log('[v119] note: SV anchor not found (non-fatal)');
}

if (src === norm) fail('No changes applied');

const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;

const bak = TARGET + '.bak.v119.' + Date.now();
fs.writeFileSync(bak, orig, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v119] backup: ${bak}`);
console.log(`[v119] OK wrote ${TARGET}`);
console.log('');
console.log('Next: npx expo start --clear, rebuild & sideload.');
console.log('Test: Discover -> Search transition should be smooth, then results stream in.');
console.log('      Search -> Discover should also feel snappier (less unmount work).');
