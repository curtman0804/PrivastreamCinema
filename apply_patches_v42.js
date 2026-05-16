/* eslint-disable */
// apply_patches_v42.js — Virtualize the vertical row list in Discover.
// THIS is the structural fix: replace the outer ScrollView with a FlatList so
// only ~2-3 ServiceRows mount on cold start. The rest mount as you scroll down.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(F)) { bad('not found: ' + F); process.exit(1); }

let src = fs.readFileSync(F, 'utf8');
const orig = src;
const bak = F + '.bak.v42.' + Date.now();
fs.copyFileSync(F, bak);
info('backup → ' + bak);

const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');
info('eol: ' + (hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + F + ' ===');

const MARKER = 'PATCH_V42_VERTICAL_VIRT';
if (src.includes(MARKER)) { ok('V42 already applied'); process.exit(0); }

function swap(anchor, replacement, label) {
  const occ = src.split(anchor).length - 1;
  if (occ === 0) { bad('anchor not found: ' + label); return false; }
  if (occ > 1)   { bad(label + ' matches ' + occ + ' times'); return false; }
  src = src.replace(anchor, replacement);
  ok(label);
  return true;
}

// ---- 1. ref type
swap(
  "const scrollViewRef = useRef<ScrollView>(null);",
  "const scrollViewRef = useRef<any>(null); // " + MARKER + " — FlatList ref",
  "ref type: ScrollView → any"
);

// ---- 2. scrollTo → scrollToOffset
swap(
  "scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY - 10), animated: true });",
  "scrollViewRef.current?.scrollToOffset({ offset: Math.max(0, sectionY - 10), animated: true });",
  "handleSectionFocus: scrollTo → scrollToOffset"
);

// ---- 3. Insert helper memos before "// Show loading only on initial load"
const insertAnchor = "  // Show loading only on initial load";
{
  const helper = [
    "  // " + MARKER + " — flatten all service rows into a single array so",
    "  // FlatList can virtualize them (only visible rows mount on cold start).",
    "  const rowsArray = useMemo(() => {",
    "    if (!discoverData?.services) return [];",
    "    const rows: any[] = [];",
    "    let rowIdx = 0;",
    "    Object.entries(discoverData.services).forEach(([serviceName, content]: any) => {",
    "      const hasMoviesInName = serviceName.toLowerCase().includes('movie');",
    "      const hasSeriesInName = serviceName.toLowerCase().includes('series');",
    "      const hasChannelsInName = serviceName.toLowerCase().includes('channel');",
    "      if (content?.movies?.length > 0) rows.push({",
    "        key: serviceName + '-movies', serviceName, contentType: 'movies' as const,",
    "        title: hasMoviesInName ? serviceName : serviceName + ' Movies',",
    "        items: content.movies, rowIdx: rowIdx++,",
    "      });",
    "      if (content?.series?.length > 0) rows.push({",
    "        key: serviceName + '-series', serviceName, contentType: 'series' as const,",
    "        title: hasSeriesInName ? serviceName : serviceName + ' Series',",
    "        items: content.series, rowIdx: rowIdx++,",
    "      });",
    "      if (content?.channels?.length > 0) rows.push({",
    "        key: serviceName + '-channels', serviceName, contentType: 'channels' as const,",
    "        title: hasChannelsInName ? serviceName : serviceName + ' Channels',",
    "        items: content.channels.map((ch: any) => ({ ...ch, type: 'tv' as const })),",
    "        rowIdx: rowIdx++,",
    "      });",
    "    });",
    "    return rows;",
    "  }, [discoverData]);",
    "",
    "  const renderServiceRow = useCallback(({ item }: { item: any }) => (",
    "    <View onLayout={(e) => { sectionPositions.current[item.key] = e.nativeEvent.layout.y; }}>",
    "      <ServiceRow",
    "        title={item.title}",
    "        serviceName={item.serviceName}",
    "        contentType={item.contentType}",
    "        items={item.items}",
    "        onItemPress={handleItemPress}",
    "        onItemFocus={item.contentType !== 'channels' ? handleItemFocus : undefined}",
    "        onSectionFocus={() => handleSectionFocus(item.key)}",
    "        rowIndex={item.rowIdx}",
    "      />",
    "    </View>",
    "  ), [handleItemFocus, handleSectionFocus]);",
    "",
    "  const listHeaderComponent = useMemo(() => {",
    "    if (continueWatching.length === 0) return null;",
    "    return (",
    "      <View",
    "        style={styles.section}",
    "        onLayout={(e) => { sectionPositions.current['continue-watching'] = e.nativeEvent.layout.y; }}",
    "      >",
    "        <View style={[styles.sectionHeader, isTV && styles.sectionHeaderTV]}>",
    "          <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>",
    "            Continue Watching",
    "          </Text>",
    "        </View>",
    "        <FlatList",
    "          data={continueWatching}",
    "          renderItem={renderContinueWatchingItem}",
    "          keyExtractor={(cwItem) => cwItem.content_id}",
    "          horizontal",
    "          showsHorizontalScrollIndicator={false}",
    "          contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}",
    "          removeClippedSubviews={true}",
    "          windowSize={5}",
    "          initialNumToRender={3}",
    "          maxToRenderPerBatch={3}",
    "          updateCellsBatchingPeriod={50}",
    "        />",
    "      </View>",
    "    );",
    "  }, [continueWatching, isTV, renderContinueWatchingItem]);",
    "",
    insertAnchor,
  ].join('\n');
  swap(insertAnchor, helper, "inserted rowsArray + renderServiceRow + listHeaderComponent");
}

// ---- 4. Replace ScrollView block with FlatList
{
  // Regex to capture the WHOLE ScrollView block including all children
  const re = /          <ScrollView\b[\s\S]*?<\/ScrollView>/m;
  const m = src.match(re);
  if (!m) {
    bad('could not match <ScrollView>...</ScrollView> block');
  } else {
    const flatList = [
      "          {/* " + MARKER + " — vertical FlatList virtualizes rows: only ~2-3 mount on cold start */}",
      "          <FlatList",
      "            ref={scrollViewRef}",
      "            data={rowsArray}",
      "            renderItem={renderServiceRow}",
      "            keyExtractor={(item: any) => item.key}",
      "            ListHeaderComponent={listHeaderComponent}",
      "            ListFooterComponent={<View style={styles.bottomPadding} />}",
      "            showsVerticalScrollIndicator={false}",
      "            scrollEventThrottle={16}",
      "            refreshControl={",
      "              <RefreshControl",
      "                refreshing={refreshing}",
      "                onRefresh={onRefresh}",
      "                tintColor={colors.primary}",
      "                colors={[colors.primary]}",
      "              />",
      "            }",
      "            windowSize={3}",
      "            initialNumToRender={2}",
      "            maxToRenderPerBatch={2}",
      "            removeClippedSubviews={true}",
      "            updateCellsBatchingPeriod={50}",
      "          />",
    ].join('\n');
    src = src.replace(re, flatList);
    ok('replaced <ScrollView>...</ScrollView> with vertical <FlatList>');
  }
}

if (src !== orig && fail === 0) {
  fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('saved ' + F);
} else if (fail > 0) {
  info('failures — file NOT saved (original safe in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV42 done. Rebuild + force-stop on Firestick + relaunch:');
  console.log('  ✓ Cold start should be Stremio-fast: only ~2 rows mount initially');
  console.log('  ✓ As you scroll down, more rows mount lazily');
  console.log('  ✓ Continue Watching is the list header (renders first)');
  console.log('  ✓ Section-focus auto-scroll still works (scrollToOffset)');
  console.log('\nIf cold start is finally snappy:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V42 — virtualize discover vertical row list"');
}
