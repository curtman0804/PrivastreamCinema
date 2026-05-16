/* eslint-disable */
// apply_patches_v54.js — Run the V50 progressive virtualization fix that
// silently failed in your build. Plus: cap initial flatRows to first 6
// services so cold start is fast even with 30 addons.
//
// This is the OUTER ScrollView → vertical FlashList conversion. Without
// this, every service row (movies + series + channels per addon) mounts
// on cold start. With it, ~5 rows render initially and the rest are
// virtualized as you scroll.
//
// SCOPE: frontend/app/(tabs)/discover.tsx only.
// Backup: discover.tsx.bak.v54.<ts>

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
  console.log('[OK] V54 already applied.');
  process.exit(0);
}

let fails = 0;
const ok   = (m) => console.log('  [OK]   ' + m);
const fail = (m) => { fails++; console.log('  [FAIL] ' + m); };

// 1) Add FlashList import (if missing)
if (!src.includes(`from '@shopify/flash-list'`)) {
  const importAnchor = `import { ServiceRow } from '../../src/components/ServiceRow';`;
  if (src.includes(importAnchor)) {
    src = src.replace(importAnchor,
      `import { FlashList } from '@shopify/flash-list'; // PATCH_V54_VIRTUALIZE\n${importAnchor}`);
    ok('added FlashList import');
  } else {
    fail('ServiceRow import anchor not found');
  }
} else {
  ok('FlashList import already present');
}

// 2) Inject flatRows useMemo + progressive loader BEFORE the return statement.
// Anchor on the existing `return (` of the component — find the FIRST one
// that's preceded by recently-declared callbacks (handleItemPress).
const memoAnchor = `  const handleItemPress = (item: ContentItem) => {`;
if (!src.includes(memoAnchor)) {
  fail('handleItemPress anchor not found');
} else if (!src.includes('PATCH_V54_FLATROWS')) {
  const inject = `  // PATCH_V54_VIRTUALIZE — flat data for the vertical FlashList that replaces
  // the outer ScrollView. Progressive: starts with 6 services, expands after 700ms.
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

// 3) Replace the ScrollView block with a FlashList using flatRowsV54.
// Anchor on multiple robust strings (open + close) to allow the block
// between to be anything.
const openAnchor = `<ScrollView`;
const closeAnchor = `</ScrollView>`;
const openIdx = src.indexOf(openAnchor);
const closeIdx = src.indexOf(closeAnchor, openIdx + 1);
if (openIdx < 0 || closeIdx < 0) {
  fail('ScrollView anchors not found in render');
} else {
  // Walk back from openIdx to capture leading whitespace.
  let lineStart = openIdx;
  while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--;
  const indent = src.slice(lineStart, openIdx);

  const newJsx = `${indent}{/* PATCH_V54_VIRTUALIZE — outer vertical FlashList replaces ScrollView */}
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
  ok('replaced ScrollView block with vertical FlashList');
}

if (fails > 0) {
  console.log('\n[FAIL] ' + fails + ' anchor(s) failed — V54 NOT applied. Original file unchanged.');
  process.exit(1);
}

const bak = F + '.bak.v54.' + Date.now();
const origBytes = raw;
fs.writeFileSync(bak, origBytes, 'utf8');
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('\n========================================');
console.log('  V54 done. Discover is fully virtualized.');
console.log('========================================');
console.log('Rebuild APK, sideload, force-stop + relaunch on Streamer 4K.');
console.log('Expected:');
console.log('  ✓ Cold start: first 6 rows render fast, rest fade in after 700ms.');
console.log('  ✓ Scrolling down: rows recycle in/out (memory stays low).');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V54" frontend\\\\app\\\\(tabs)\\\\discover.tsx');
