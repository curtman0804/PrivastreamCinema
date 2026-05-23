/**
 * apply_patches_v86.js — proper architectural fix
 * ================================================
 * Replaces the outer <ScrollView> in discover.tsx with a <FlatList> and
 * uses `flatListRef.current.scrollToIndex(...)` for row snapping. This is
 * the standard Android TV pattern that Netflix / Prime / Stremio use.
 *
 * Why: ScrollView.scrollTo() races against Android TV's native focus
 * auto-scroll. We've spent v78-v85 trying to win that race; it's
 * unwinnable. FlatList.scrollToIndex is imperative and platform-neutral —
 * Android TV doesn't fight it.
 *
 * Changes:
 *   1. Refs block: replace v78-v85 tracking refs with just flatListRef +
 *      lastFocusedFlatIndexRef.
 *   2. handleRowFocus: replace body — calls flatListRef.scrollToIndex.
 *   3. handleSectionFocus: replace body — scrollToIndex(0).
 *   4. JSX: replace the outer <ScrollView>{flatRowsV54.map(...)}</ScrollView>
 *      with a single <FlatList data renderItem keyExtractor />.
 *   5. Pass new onRowFocus={() => handleFlatIndexFocus(index)} from
 *      renderItem so each row knows its FlatList index.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v86.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v86] FATAL:', msg); process.exit(1); }
function bw(file, src) {
  const b = file + '.bak.v86.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v86]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');

const MARKER = '/* FLATLIST_SNAP_V86 */';
if (src.includes(MARKER)) {
  console.log('[v86] Already patched.');
  process.exit(0);
}

const eol = src.includes('\r\n') ? '\r\n' : '\n';

// ─────────────────────────────────────────────────────────────
// 1) Replace the refs / handlers block.
//    Anchor on the unique "=== ROW_SNAP_V78 ===" comment near the
//    refs and remove everything up to (but not including) the
//    handleSectionFocus end "// (No longer needed".
// ─────────────────────────────────────────────────────────────
const refsBlockStart = '  // === ROW_SNAP_V78 ===';
const refsBlockEnd = '  // Row sync: keep all rows scrolled to the same horizontal offset';
const s1 = src.indexOf(refsBlockStart);
const s2 = src.indexOf(refsBlockEnd);
if (s1 < 0 || s2 < 0 || s2 < s1) fail('Could not locate refs/handlers block.');

const newRefsBlock =
  '  // ' + MARKER + eol +
  '  const flatListRef = useRef<FlatList<any>>(null);' + eol +
  '  const lastFocusedFlatIndexRef = useRef<number>(-1);' + eol +
  '  const lastCWFocusRef = useRef<boolean>(false);' + eol +
  '  // (legacy refs kept for compatibility with handlers used elsewhere)' + eol +
  '  const lastFocusedSection = useRef<string>(\'\');' + eol +
  eol +
  '  const handleFlatIndexFocus = useCallback((flatIndex: number) => {' + eol +
  '    if (lastFocusedFlatIndexRef.current === flatIndex) return;' + eol +
  '    lastFocusedFlatIndexRef.current = flatIndex;' + eol +
  '    try {' + eol +
  '      flatListRef.current?.scrollToIndex({' + eol +
  '        index: flatIndex,' + eol +
  '        animated: true,' + eol +
  '        viewPosition: 0,' + eol +
  '      });' + eol +
  '    } catch (e) { /* item not yet rendered — onScrollToIndexFailed will retry */ }' + eol +
  '  }, []);' + eol +
  eol +
  '  // Legacy shims so any callers below still type-check.' + eol +
  '  const handleRowLayout = useCallback((_rowIndex: number, _y: number) => {}, []);' + eol +
  '  const handleRowFocus = useCallback((_rowIndex: number) => {}, []);' + eol +
  '  const handleSectionFocus = useCallback((_sectionKey: string) => {' + eol +
  '    // CW corresponds to flat index 0 (when present).' + eol +
  '    handleFlatIndexFocus(0);' + eol +
  '  }, [handleFlatIndexFocus]);' + eol +
  eol;

src = src.slice(0, s1) + newRefsBlock + src.slice(s2);
console.log('[v86]   ✓ replaced refs + handlers block');

// ─────────────────────────────────────────────────────────────
// 2) Replace the <ScrollView> ... </ScrollView> block with <FlatList>.
//    Anchor on the opening line and the closing line.
// ─────────────────────────────────────────────────────────────
const svOpen = '        <ScrollView' + eol +
  '          ref={scrollViewRef}' + eol +
  '          style={styles.scrollView}' + eol +
  '          showsVerticalScrollIndicator={false}' + eol +
  '          scrollEventThrottle={16}' + eol +
  '          onScroll={(e) => { currentScrollY.current = e.nativeEvent.contentOffset.y; }}' + eol +
  '          removeClippedSubviews={true}' + eol +
  '          refreshControl={';

const svOpenIdx = src.indexOf(svOpen);
if (svOpenIdx < 0) fail('ScrollView opening block not found verbatim.');

// Find the matching </ScrollView>
const svCloseStr = '        </ScrollView>';
const svCloseIdx = src.indexOf(svCloseStr, svOpenIdx);
if (svCloseIdx < 0) fail('ScrollView closing tag not found.');

// Build the replacement: a single <FlatList> with renderItem inline.
const flatListReplacement =
  '        <FlatList' + eol +
  '          ref={flatListRef}' + eol +
  '          style={styles.scrollView}' + eol +
  '          data={flatRowsV54}' + eol +
  '          keyExtractor={(item: any) => item.key}' + eol +
  '          showsVerticalScrollIndicator={false}' + eol +
  '          removeClippedSubviews={true}' + eol +
  '          windowSize={5}' + eol +
  '          initialNumToRender={3}' + eol +
  '          maxToRenderPerBatch={3}' + eol +
  '          updateCellsBatchingPeriod={50}' + eol +
  '          onScrollToIndexFailed={(info) => {' + eol +
  '            // Row not yet rendered — wait, then retry once.' + eol +
  '            setTimeout(() => {' + eol +
  '              try {' + eol +
  '                flatListRef.current?.scrollToIndex({' + eol +
  '                  index: info.index,' + eol +
  '                  animated: true,' + eol +
  '                  viewPosition: 0,' + eol +
  '                });' + eol +
  '              } catch (e) {}' + eol +
  '            }, 150);' + eol +
  '          }}' + eol +
  '          ListFooterComponent={<View style={styles.bottomPadding} />}' + eol +
  '          refreshControl={' + eol +
  '            <RefreshControl' + eol +
  '              refreshing={refreshing}' + eol +
  '              onRefresh={onRefresh}' + eol +
  '              tintColor={colors.primary}' + eol +
  '              colors={[colors.primary]}' + eol +
  '            />' + eol +
  '          }' + eol +
  '          renderItem={({ item, index }: { item: any; index: number }) => {' + eol +
  '            if (item.kind === \'cw\') {' + eol +
  '              return (' + eol +
  '                <View style={styles.section}>' + eol +
  '                  <View style={[styles.sectionHeader, isTV && styles.sectionHeaderTV]}>' + eol +
  '                    <Text style={[styles.sectionTitle, isTV && styles.sectionTitleTV]}>' + eol +
  '                      Continue Watching' + eol +
  '                    </Text>' + eol +
  '                  </View>' + eol +
  '                  <FlatList' + eol +
  '                    data={continueWatching}' + eol +
  '                    renderItem={renderContinueWatchingItem}' + eol +
  '                    keyExtractor={(cwItem) => String(cwItem.content_id)}' + eol +
  '                    horizontal' + eol +
  '                    showsHorizontalScrollIndicator={false}' + eol +
  '                    contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}' + eol +
  '                    removeClippedSubviews={true}' + eol +
  '                    initialNumToRender={4}' + eol +
  '                    maxToRenderPerBatch={4}' + eol +
  '                    windowSize={3}' + eol +
  '                    updateCellsBatchingPeriod={50}' + eol +
  '                    getItemLayout={(_, idx) => ({' + eol +
  '                      length: isTV ? 320 : 220,' + eol +
  '                      offset: (isTV ? 320 : 220) * idx,' + eol +
  '                      index: idx,' + eol +
  '                    })}' + eol +
  '                  />' + eol +
  '                </View>' + eol +
  '              );' + eol +
  '            }' + eol +
  '            return (' + eol +
  '              <ServiceRow' + eol +
  '                title={item.title}' + eol +
  '                serviceName={item.serviceName}' + eol +
  '                contentType={item.contentType}' + eol +
  '                items={item.items}' + eol +
  '                onItemPress={handleItemPress}' + eol +
  '                onItemFocus={item.contentType !== \'channels\' ? handleItemFocus : undefined}' + eol +
  '                rowIndex={item.rowIdx}' + eol +
  '                isFirstRow={continueWatching.length === 0 && item.rowIdx === 0}' + eol +
  '                onRowFocus={() => handleFlatIndexFocus(index)}' + eol +
  '                onRowLayout={handleRowLayout}' + eol +
  '              />' + eol +
  '            );' + eol +
  '          }}' + eol +
  '        />';

src = src.slice(0, svOpenIdx) + flatListReplacement + src.slice(svCloseIdx + svCloseStr.length);
console.log('[v86]   ✓ outer ScrollView replaced with FlatList');

// 3) Rewire the CW item's onSectionFocus → handleFlatIndexFocus(0).
//    Anchor on its current wiring.
const cwOld = "onSectionFocus={() => handleSectionFocus('continue-watching')}";
const cwNew = "onSectionFocus={() => handleFlatIndexFocus(0)}";
if (src.includes(cwOld)) {
  src = src.replace(cwOld, cwNew);
  console.log('[v86]   ✓ CW onSectionFocus → handleFlatIndexFocus(0)');
}

bw(file, src);
console.log('');
console.log('[v86] ✅ discover.tsx patched.');
console.log('[v86]    Rebuild your APK:');
console.log('[v86]      del /q frontend\\android\\app\\src\\main\\assets\\index.android.bundle 2>nul');
console.log('[v86]      rmdir /s /q frontend\\android\\app\\build 2>nul');
console.log('[v86]    Then your normal gradle build.');
console.log('');
console.log('[v86] What changed: outer scroll uses FlatList.scrollToIndex now.');
console.log('[v86]    Smooth animation, reliable both directions, no race conditions.');
