/* eslint-disable */
// apply_patches_v54b.js — Fixed V54. The earlier V54 used <ScrollView as
// anchor, which also matched useRef<ScrollView>(null) and corrupted the
// file. This version anchors on `<ScrollView\n            ref=` (a
// pattern that ONLY appears at the JSX opening tag, never in a useRef).

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const hadCRLF = raw.indexOf('\r\n') >= 0;
let src = raw.replace(/\r\n/g, '\n');

if (src.includes('PATCH_V54_VIRTUALIZE')) {
  console.log('[OK] V54b already applied.');
  process.exit(0);
}

let fails = 0;
const ok   = (m) => console.log('  [OK]   ' + m);
const fail = (m) => { fails++; console.log('  [FAIL] ' + m); };

// 1) FlashList import
if (!src.includes(`from '@shopify/flash-list'`)) {
  const impAnchor = `import { ServiceRow } from '../../src/components/ServiceRow';`;
  if (src.includes(impAnchor)) {
    src = src.replace(impAnchor,
      `import { FlashList } from '@shopify/flash-list'; // PATCH_V54_VIRTUALIZE\n${impAnchor}`);
    ok('added FlashList import');
  } else {
    fail('ServiceRow import anchor not found');
  }
} else {
  ok('FlashList import already present');
}

// 2) Inject flatRowsV54 + progressive loader
const memoAnchor = `  const handleItemPress = (item: ContentItem) => {`;
if (!src.includes(memoAnchor)) {
  fail('handleItemPress anchor not found');
} else if (!src.includes('PATCH_V54_FLATROWS')) {
  const inject = `  // PATCH_V54_VIRTUALIZE — progressive: 6 services first, expand after 700ms.
  const [maxRowsV54, setMaxRowsV54] = useState(6); // PATCH_V54_FLATROWS
  useEffect(() => {
    const t = setTimeout(() => setMaxRowsV54(999), 700);
    return () => clearTimeout(t);
  }, []);
  const flatRowsV54 = useMemo(() => {
    const rows: any[] = [];
    if (continueWatching.length > 0) rows.push({ key: '__cw__', kind: 'cw' });
    let rIdx = 0;
    Object.entries(discoverData?.services || {}).forEach(([sName, c]: any) => {
      const lname = sName.toLowerCase();
      const hasMov = lname.includes('movie');
      const hasSer = lname.includes('series');
      const hasCh  = lname.includes('channel');
      if (c?.movies?.length > 0)   rows.push({ key: sName+'|m', kind: 'row', serviceName: sName, contentType: 'movies',   items: c.movies,   title: hasMov ? sName : sName+' Movies',   rowIdx: rIdx++ });
      if (c?.series?.length > 0)   rows.push({ key: sName+'|s', kind: 'row', serviceName: sName, contentType: 'series',   items: c.series,   title: hasSer ? sName : sName+' Series',   rowIdx: rIdx++ });
      if (c?.channels?.length > 0) rows.push({ key: sName+'|c', kind: 'row', serviceName: sName, contentType: 'channels', items: c.channels.map((ch:any)=>({ ...ch, type: 'tv' as const })), title: hasCh ? sName : sName+' Channels', rowIdx: rIdx++ });
    });
    return rows.slice(0, 1 + maxRowsV54);
  }, [continueWatching, discoverData, maxRowsV54]);

  ${memoAnchor}`;
  src = src.replace(memoAnchor, inject);
  ok('added flatRowsV54 + progressive loader');
}

// 3) Replace the JSX ScrollView with FlashList — anchor on the multi-line
//    pattern that ONLY appears at the JSX site (open tag + ref attribute).
const openAnchor = `<ScrollView\n            ref={scrollViewRef}`;
const closeAnchor = `</ScrollView>`;

const openIdx = src.indexOf(openAnchor);
const closeIdx = openIdx >= 0 ? src.indexOf(closeAnchor, openIdx) : -1;

if (openIdx < 0) {
  fail('ScrollView JSX open anchor not found (looked for <ScrollView\\n            ref={scrollViewRef})');
} else if (closeIdx < 0) {
  fail('ScrollView close anchor not found');
} else {
  // Capture leading whitespace of the open line
  let lineStart = openIdx;
  while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--;
  const indent = src.slice(lineStart, openIdx);

  const newJsx = `${indent}{/* PATCH_V54_VIRTUALIZE — vertical FlashList replaces ScrollView */}
${indent}<FlashList
${indent}  data={flatRowsV54}
${indent}  extraData={flatRowsV54.length}
${indent}  keyExtractor={(it: any) => it.key}
${indent}  estimatedItemSize={260}
${indent}  drawDistance={500}
${indent}  showsVerticalScrollIndicator={false}
${indent}  refreshControl={
${indent}    <RefreshControl
${indent}      refreshing={refreshing}
${indent}      onRefresh={onRefresh}
${indent}      tintColor={colors.primary}
${indent}      colors={[colors.primary]}
${indent}    />
${indent}  }
${indent}  renderItem={({ item }: any) => {
${indent}    if (item.kind === 'cw') {
${indent}      return (
${indent}        <View style={styles.section}>
${indent}          <View style={[styles.sectionHeader, isTV && styles.sectionHeaderTV]}>
${indent}            <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>Continue Watching</Text>
${indent}          </View>
${indent}          <FlatList
${indent}            data={continueWatching}
${indent}            renderItem={renderContinueWatchingItem}
${indent}            keyExtractor={(cwItem) => cwItem.content_id}
${indent}            horizontal
${indent}            showsHorizontalScrollIndicator={false}
${indent}            contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}
${indent}            removeClippedSubviews={true}
${indent}          />
${indent}        </View>
${indent}      );
${indent}    }
${indent}    return (
${indent}      <ServiceRow
${indent}        title={item.title}
${indent}        serviceName={item.serviceName}
${indent}        contentType={item.contentType}
${indent}        items={item.items}
${indent}        onItemPress={handleItemPress}
${indent}        onItemFocus={item.contentType !== 'channels' ? handleItemFocus : undefined}
${indent}        rowIndex={item.rowIdx}
${indent}      />
${indent}    );
${indent}  }}
${indent}  ListFooterComponent={<View style={styles.bottomPadding} />}
${indent}/>`;

  src = src.slice(0, lineStart) + newJsx + src.slice(closeIdx + closeAnchor.length);
  ok('replaced ScrollView JSX with vertical FlashList');
}

if (fails > 0) {
  console.log('\n[FAIL] anchors not matched — file unchanged');
  process.exit(1);
}

const bak = F + '.bak.v54b.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('\n========================================');
console.log('  V54b done.');
console.log('========================================');
console.log('Now retry your APK build. The corrupted useRef lines are gone.');
console.log('');
console.log('Verify:');
console.log('  findstr /N /C:"useRef" frontend\\\\app\\\\(tabs)\\\\discover.tsx');
console.log('  → should show ONE clean line: const scrollViewRef = useRef<ScrollView>(null);');
console.log('  findstr /S /C:"PATCH_V54" frontend\\\\app\\\\(tabs)\\\\discover.tsx');
console.log('  → should show ~3 marker lines');
