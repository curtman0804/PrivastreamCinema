// apply_patches_v112b_search.js
// Search screen — follow-up to v112:
//   1. Add bounces={false} + overScrollMode="never" to lock the bottom of scroll
//   2. Add console diagnostics so we can confirm auto-pagination is firing
//   3. Also re-applies v112 anchors in case v112 silently failed
// CRLF-safe.
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'search.tsx');
function fail(msg) { console.error(`[v112b] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v112b] ok: ${msg}`); }
function info(msg) { console.log(`[v112b] info: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. cd into the frontend folder first.`);

const origBuffer = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = origBuffer.includes('\r\n');
let src = origBuffer.replace(/\r\n/g, '\n');
const norm = src;

// ====== Verify v112 base patch applied ======
const v112Present = src.includes('V112_SEARCH_NAV');
if (!v112Present) {
  fail(`v112 base patch markers NOT FOUND in ${TARGET}.\n` +
       `  This means apply_patches_v112_search.js did NOT modify this file.\n` +
       `  Things to check:\n` +
       `    1. Are you running from the correct frontend folder? (the one with app/(tabs)/search.tsx)\n` +
       `    2. Did 'node ..\\apply_patches_v112_search.js' print all 5 'ok:' lines?\n` +
       `    3. Did Metro/Expo recompile? Run: npx expo start --clear\n` +
       `  Re-run apply_patches_v112_search.js, confirm 5 ok lines, then come back here.`);
}
info('v112 base patch confirmed present');

if (src.includes('V112B_LOCK_BOTTOM')) {
  console.log('[v112b] = already applied');
  process.exit(0);
}

// ====== Patch A: lock the bottom of ScrollView ======
const A_OLD = `        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >`;
const A_NEW = `        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          /* V112B_LOCK_BOTTOM: hard-stop at last row, no overscroll past content */
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
        >`;

if (!src.includes(A_OLD)) fail('anchor A (ScrollView with scrollViewRef) not found');
src = src.replace(A_OLD, A_NEW);
ok('A: ScrollView locked at bottom (bounces=false, overScrollMode=never)');

// ====== Patch B: trim bottomPadding so list ends flush with chrome ======
const B_OLD = `  bottomPadding: {
    height: 40,
  },`;
const B_NEW = `  bottomPadding: {
    height: 8, // V112B: minimal padding so last row ends flush with screen
  },`;

if (src.includes(B_OLD)) {
  src = src.replace(B_OLD, B_NEW);
  ok('B: bottomPadding trimmed 40 -> 8');
} else {
  info('B: bottomPadding anchor not found (skipping, non-fatal)');
}

// ====== Patch C: instrument the auto-page effect with console logs ======
const C_OLD = `  // V112: auto-page through ALL remaining results once initial search finishes
  useEffect(() => {
    if (!hasSearched) return;
    if (isLoadingSearch || isLoadingMoreSearch) return;
    if (!searchHasMore) return;
    if (pagesLoaded.current >= 15) return; // safety cap (~1500 items per type)
    pagesLoaded.current += 1;
    loadMoreSearch();
  }, [hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore, loadMoreSearch]);`;

const C_NEW = `  // V112: auto-page through ALL remaining results once initial search finishes
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

if (!src.includes(C_OLD)) fail('anchor C (v112 auto-page effect) not found — was v112 modified?');
src = src.replace(C_OLD, C_NEW);
ok('C: auto-page effect instrumented + dependency on searchMovies/Series.length added');

if (src === norm) fail('No changes applied');

const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;

const bak = TARGET + '.bak.v112b.' + Date.now();
fs.writeFileSync(bak, origBuffer, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v112b] backup: ${bak}`);
console.log(`[v112b] OK wrote ${TARGET}`);
console.log('');
console.log('Next:');
console.log('  1) Restart Metro:    npx expo start --clear');
console.log('  2) Rebuild + sideload');
console.log('  3) Search anything. Check Metro/Logcat for [SEARCH/v112b] lines.');
console.log('     - You should see "firing loadMoreSearch()" multiple times.');
console.log('     - Movies/Series counts should grow past 30.');
