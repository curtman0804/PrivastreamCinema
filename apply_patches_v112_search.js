// apply_patches_v112_search.js
// SEARCH SCREEN: Lift 30-item cap (auto-paginate through all results)
// + add vertical row-snap nav so D-pad behaves identically to Discover.
// CRLF-safe (handles Windows line endings, like v108b).
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'search.tsx');
function fail(msg) { console.error(`[v112] FATAL: ${msg}`); process.exit(1); }
function ok(msg)   { console.log(`[v112] ok: ${msg}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found. cd into the frontend folder first.`);

const origBuffer = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = origBuffer.includes('\r\n');
let src = origBuffer.replace(/\r\n/g, '\n'); // normalize for matching
const norm = src;

if (src.includes('V112_SEARCH_NAV')) {
  console.log('[v112] = already applied');
  process.exit(0);
}

// ---------- 1. Add refs & store subscriptions after hasTriggeredInitialSearch ----------
const A1_OLD = `  const hasTriggeredInitialSearch = useRef(false);`;
const A1_NEW = `  const hasTriggeredInitialSearch = useRef(false);
  // V112_SEARCH_NAV: pagination + row-snap nav (parity with Discover screen)
  const loadMoreSearch = useContentStore(s => s.loadMoreSearch);
  const searchHasMore = useContentStore(s => s.searchHasMore);
  const isLoadingMoreSearch = useContentStore(s => s.isLoadingMoreSearch);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');
  const pagesLoaded = useRef<number>(0);`;

if (!src.includes(A1_OLD)) fail('anchor A1 (hasTriggeredInitialSearch) not found');
src = src.replace(A1_OLD, A1_NEW);
ok('A1: store subs + refs injected');

// ---------- 2. Auto-page effect + handleSectionFocus, just above handleSearch ----------
const A2_OLD = `  const handleSearch = useCallback(async (query: string) => {`;
const A2_NEW = `  // V112: auto-page through ALL remaining results once initial search finishes
  useEffect(() => {
    if (!hasSearched) return;
    if (isLoadingSearch || isLoadingMoreSearch) return;
    if (!searchHasMore) return;
    if (pagesLoaded.current >= 15) return; // safety cap (~1500 items per type)
    pagesLoaded.current += 1;
    loadMoreSearch();
  }, [hasSearched, isLoadingSearch, isLoadingMoreSearch, searchHasMore, loadMoreSearch]);

  // Reset paging + focus state when query changes
  useEffect(() => {
    pagesLoaded.current = 0;
    lastFocusedSection.current = '';
  }, [currentQuery]);

  // V112: row-snap — scroll parent ScrollView to bring focused row's title into view
  const handleSectionFocus = useCallback((sectionKey: string) => {
    if (lastFocusedSection.current === sectionKey) return;
    lastFocusedSection.current = sectionKey;
    const y = sectionPositions.current[sectionKey];
    if (y !== undefined && scrollViewRef.current) {
      scrollViewRef.current?.scrollTo({ y: Math.max(0, y - 10), animated: true });
    }
  }, []);

  const handleSearch = useCallback(async (query: string) => {`;

if (!src.includes(A2_OLD)) fail('anchor A2 (handleSearch decl) not found');
src = src.replace(A2_OLD, A2_NEW);
ok('A2: auto-pagination effect + handleSectionFocus injected');

// ---------- 3. Attach scrollViewRef to the ScrollView ----------
const A3_OLD = `        <ScrollView 
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >`;
const A3_NEW = `        <ScrollView 
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >`;

if (!src.includes(A3_OLD)) fail('anchor A3 (ScrollView opening tag) not found');
src = src.replace(A3_OLD, A3_NEW);
ok('A3: scrollViewRef attached to ScrollView');

// ---------- 4. Wrap Movies row ----------
const A4_OLD = `          {/* Movies Row */}
          {searchMovies.length > 0 && (
            <ServiceRow
              title={\`Movies (\${searchMovies.length})\`}
              items={searchMovies}
              onItemPress={handleItemPress}
            />
          )}`;
const A4_NEW = `          {/* Movies Row */}
          {searchMovies.length > 0 && (
            <View onLayout={(e) => { sectionPositions.current['movies'] = e.nativeEvent.layout.y; }}>
              <ServiceRow
                title={\`Movies (\${searchMovies.length})\`}
                items={searchMovies}
                onItemPress={handleItemPress}
                onSectionFocus={() => handleSectionFocus('movies')}
              />
            </View>
          )}`;

if (!src.includes(A4_OLD)) fail('anchor A4 (Movies row) not found');
src = src.replace(A4_OLD, A4_NEW);
ok('A4: Movies row wrapped with onLayout + onSectionFocus');

// ---------- 5. Wrap Series row ----------
const A5_OLD = `          {/* Series Row */}
          {searchSeries.length > 0 && (
            <ServiceRow
              title={\`Series (\${searchSeries.length})\`}
              items={searchSeries}
              onItemPress={handleItemPress}
            />
          )}`;
const A5_NEW = `          {/* Series Row */}
          {searchSeries.length > 0 && (
            <View onLayout={(e) => { sectionPositions.current['series'] = e.nativeEvent.layout.y; }}>
              <ServiceRow
                title={\`Series (\${searchSeries.length})\`}
                items={searchSeries}
                onItemPress={handleItemPress}
                onSectionFocus={() => handleSectionFocus('series')}
              />
            </View>
          )}`;

if (!src.includes(A5_OLD)) fail('anchor A5 (Series row) not found');
src = src.replace(A5_OLD, A5_NEW);
ok('A5: Series row wrapped with onLayout + onSectionFocus');

if (src === norm) fail('No changes applied');

// Restore original line endings
const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;

const bak = TARGET + '.bak.v112.' + Date.now();
fs.writeFileSync(bak, origBuffer, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v112] backup: ${bak}`);
console.log(`[v112] OK wrote ${TARGET}`);
console.log('');
console.log('Next:');
console.log('  1) Restart Metro:    npx expo start --clear');
console.log('  2) Rebuild + sideload to Firestick');
console.log('  3) Hit a genre button -> search screen should now load ALL results');
console.log('     and D-pad up/down should snap-scroll between Movies/Series rows.');
