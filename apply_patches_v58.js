/* eslint-disable */
// apply_patches_v58.js — Revert outer FlashList → plain ScrollView.
//
// FlashList recycling at the outer level keeps causing item-mismatch bugs
// (USA TV posters under Netflix Series, movies in TV channels, etc.) even
// with getItemType. With only ~30 rows total, vertical virtualization isn't
// worth the complexity. Inner horizontal FlashList per row (V49) stays —
// that's where the cards-per-row count is high and virtualization matters.
//
// V54's progressive render (maxRowsV54: 6 first, then 999 after 700ms) is
// PRESERVED — so cold start stays fast. We just render flatRowsV54 inside
// a plain ScrollView with .map() instead of FlashList.

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

if (src.includes('PATCH_V58_SCROLLVIEW')) {
  console.log('[OK] V58 already applied.');
  process.exit(0);
}

// Find the FlashList block (open via comment, close on `/>`).
// We injected it in V54b — anchor on the comment line.
const startMarker = '{/* PATCH_V54_VIRTUALIZE';
const startIdx = src.indexOf(startMarker);
if (startIdx < 0) {
  console.log('[FAIL] could not locate V54 FlashList block start');
  process.exit(1);
}

// Find the closing `/>` of the FlashList — search for "ListFooterComponent" then the next `/>`
const footerIdx = src.indexOf('ListFooterComponent', startIdx);
if (footerIdx < 0) {
  console.log('[FAIL] could not locate ListFooterComponent');
  process.exit(1);
}
const closeIdx = src.indexOf('/>', footerIdx);
if (closeIdx < 0) {
  console.log('[FAIL] could not locate closing /> of FlashList');
  process.exit(1);
}

// Walk back from startIdx to capture leading whitespace
let lineStart = startIdx;
while (lineStart > 0 && src[lineStart - 1] !== '\n') lineStart--;
const indent = src.slice(lineStart, startIdx);

const replacement = `${indent}{/* PATCH_V58_SCROLLVIEW — outer ScrollView with progressive render.
${indent}     Outer FlashList caused row recycling bugs; with ~30 rows total a plain
${indent}     ScrollView + V54's maxRowsV54 gating is the right balance. */}
${indent}<ScrollView
${indent}  ref={scrollViewRef}
${indent}  style={styles.scrollView}
${indent}  showsVerticalScrollIndicator={false}
${indent}  scrollEventThrottle={16}
${indent}  refreshControl={
${indent}    <RefreshControl
${indent}      refreshing={refreshing}
${indent}      onRefresh={onRefresh}
${indent}      tintColor={colors.primary}
${indent}      colors={[colors.primary]}
${indent}    />
${indent}  }
${indent}>
${indent}  {flatRowsV54.map((item: any) => {
${indent}    if (item.kind === 'cw') {
${indent}      return (
${indent}        <View key={item.key} style={styles.section}>
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
${indent}        key={item.key}
${indent}        title={item.title}
${indent}        serviceName={item.serviceName}
${indent}        contentType={item.contentType}
${indent}        items={item.items}
${indent}        onItemPress={handleItemPress}
${indent}        onItemFocus={item.contentType !== 'channels' ? handleItemFocus : undefined}
${indent}        rowIndex={item.rowIdx}
${indent}      />
${indent}    );
${indent}  })}
${indent}  <View style={styles.bottomPadding} />
${indent}</ScrollView>`;

src = src.slice(0, lineStart) + replacement + src.slice(closeIdx + 2);

const bak = F + '.bak.v58.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('  [OK]   reverted outer FlashList → ScrollView with stable keys');
console.log('');
console.log('========================================');
console.log('V58 done. Rebuild → sideload → force-stop → relaunch.');
console.log('========================================');
console.log('Expected:');
console.log('  ✓ All addon rows populate in correct positions.');
console.log('  ✓ Posters match their row titles (no jumbling).');
console.log('  ✓ Cold start still fast (V54 progressive maxRowsV54 still active).');
console.log('  ✓ D-pad scroll still smooth (horizontal FlashList per row remains).');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V58" frontend\\\\app\\\\(tabs)\\\\discover.tsx');
