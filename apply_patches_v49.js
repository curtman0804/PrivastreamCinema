/* eslint-disable */
// apply_patches_v49.js — Convert ServiceRow's horizontal FlatList to FlashList.
//
// @shopify/flash-list 2.0.2 is already installed but never used. FlashList is
// 3-5x faster than FlatList on Android, especially with the new architecture
// (which you have enabled). This is THE Stremio-style virtualization.
//
// Safer single-file scope: only modifies frontend/src/components/ServiceRow.tsx.
// Outer discover.tsx ScrollView left untouched for now (V50 if needed).
//
// Changes:
//   - Add `import { FlashList } from '@shopify/flash-list'`
//   - Change `useRef<FlatList>` → `useRef<FlashList<ContentItem>>`
//   - Replace `<FlatList ...>` with `<FlashList ...>` and drop FlatList-specific
//     props (getItemLayout, initialNumToRender, maxToRenderPerBatch, windowSize,
//     updateCellsBatchingPeriod, removeClippedSubviews). FlashList auto-tunes.
//   - Add `estimatedItemSize={itemTotalWidth}` for horizontal virtualization.
//   - Keep `scrollToOffset` calls — FlashList supports the same API.
//
// Idempotent. CRLF-safe. .bak.v49.<ts> backup.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
const MARK = 'PATCH_V49_FLASHLIST';

if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const hadCRLF = raw.indexOf('\r\n') >= 0;
let src = raw.replace(/\r\n/g, '\n');

if (src.includes(MARK)) {
  console.log('[OK] V49 already applied.');
  process.exit(0);
}

let fails = 0;
function fail(m) { fails++; console.log('  [FAIL] ' + m); }
function ok(m) { console.log('  [OK]   ' + m); }

// ─── 1. Add FlashList import ───
const oldImport = `import { ContentCard, getCardWidth } from './ContentCard';`;
const newImport = `import { FlashList } from '@shopify/flash-list'; // ${MARK}
import { ContentCard, getCardWidth } from './ContentCard';`;
if (!src.includes(oldImport)) {
  fail('import anchor not found');
} else if (!src.includes(`from '@shopify/flash-list'`)) {
  src = src.replace(oldImport, newImport);
  ok('added FlashList import');
} else {
  ok('FlashList import already present');
}

// ─── 2. Change ref type ───
const oldRef = `  const flatListRef = useRef<FlatList>(null);`;
const newRef = `  const flatListRef = useRef<FlashList<ContentItem>>(null); // ${MARK}`;
if (!src.includes(oldRef)) {
  fail('flatListRef anchor not found');
} else {
  src = src.replace(oldRef, newRef);
  ok('changed flatListRef type to FlashList');
}

// ─── 3. Remove getItemLayout (FlashList ignores it) ───
const oldGetItemLayout = `  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemTotalWidth,
    offset: paddingLeft + (index * itemTotalWidth),
    index,
  }), [itemTotalWidth, paddingLeft]);

`;
if (src.includes(oldGetItemLayout)) {
  src = src.replace(oldGetItemLayout, `  // ${MARK} — getItemLayout removed; FlashList auto-virtualizes with estimatedItemSize.

`);
  ok('removed getItemLayout (FlashList does not need it)');
}

// ─── 4. Replace <FlatList ...> JSX with <FlashList ...> ───
const oldJsx = `        <FlatList
          ref={flatListRef}
          horizontal
          data={validItems}
          extraData={validItems.length}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          getItemLayout={getItemLayout}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            isTV && styles.scrollContentTV,
          ]}
          style={styles.flatListStyle}
          initialNumToRender={2} /* PATCH_V43B_SEQUENTIAL_MOUNT — first paint is 2 cards */
          maxToRenderPerBatch={3} /* PATCH_V41_COLDSTART_BUDGET — smaller render chunks; more JS yields */
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews={false} /* PATCH_V43B_SEQUENTIAL_MOUNT — TV focus stability */
          onEndReached={handleEndReached}
          onEndReachedThreshold={3}
        />`;

const newJsx = `        {/* ${MARK} — horizontal FlashList replaces FlatList for 3-5x D-pad perf */}
        <FlashList
          ref={flatListRef as any}
          horizontal
          data={validItems}
          extraData={validItems.length}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={
            isTV ? styles.scrollContentTV : styles.scrollContent
          }
          estimatedItemSize={itemTotalWidth}
          drawDistance={itemTotalWidth * 3}
          onEndReached={handleEndReached}
          onEndReachedThreshold={3}
        />`;

if (!src.includes(oldJsx)) {
  fail('FlatList JSX block not found — anchor mismatch.');
} else {
  src = src.replace(oldJsx, newJsx);
  ok('replaced <FlatList> with <FlashList>');
}

// ─── 5. Remove FlatList import (still needed? check usage) ───
// FlatList may be referenced elsewhere in the file via useRef type — we already
// changed the ref. Let's check if FlatList is referenced anywhere else.
const remainingFlatList = src.split('FlatList').length - 1;
// We expect references in `import { FlatList } from 'react-native'` and possibly
// nowhere else. If 1 reference remains (just the import), we can remove it.
// But to keep the patch surgical we leave the FlatList import in place — RN's
// FlatList is tree-shaken at build time. Skip.

// ─── Save ───
if (fails > 0) {
  console.log('\n[FAIL] ' + fails + ' anchor(s) failed — V49 NOT applied.');
  console.log('Aborting. Original file unchanged.');
  process.exit(1);
}

const bak = F + '.bak.v49.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('\n========================================');
console.log('  V49 done. FlashList active in ServiceRow.');
console.log('========================================');
console.log('Rebuild APK, force-stop on Streamer, relaunch.');
console.log('Expected:');
console.log('  ✓ D-pad horizontal scroll in any row: noticeably snappier.');
console.log('  ✓ Cold start: faster (FlashList auto-defers off-screen cards).');
console.log('  ✓ Memory: lower (cards recycled instead of all kept mounted).');
console.log('');
console.log('Verify in code with:');
console.log('  findstr /S /C:"PATCH_V49" frontend\\src\\components\\ServiceRow.tsx');
console.log('');
console.log('If it works: V50 will convert the outer <ScrollView> in discover.tsx');
console.log('to FlashList — that vertical virtualization gives the final Stremio feel.');
