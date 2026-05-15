/* eslint-disable */
// diagnose_perf.js — READ-ONLY. Inspect Discover D-pad lag + slow poster→details transitions.
//
// Goal: find what's slowing the JS thread during:
//   (a) D-pad nav on Discover (left/right/up/down) — likely re-renders, focus handlers,
//       FlatList virtualization knobs, image load thrashing.
//   (b) Poster tap → details load — likely synchronous mount work, missing meta cache,
//       blocking stream fetch on mount.
//
// Run from project root:  node diagnose_perf.js > diag_perf.txt
// Then paste diag_perf.txt back.

const fs = require('fs');
const path = require('path');

const F = {
  discover:    path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  ContentCard: path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  ServiceRow:  path.join('frontend', 'src', 'components', 'ServiceRow.tsx'),
  details:     path.join('frontend', 'app', 'details', '[type]', '[id].tsx'),
  store:       path.join('frontend', 'src', 'store', 'contentStore.ts'),
};

function header(t) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + t);
  console.log('='.repeat(72));
}

function dump(label, src, regex, before, after, maxHits) {
  const lines = src.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) hits.push(i);
  console.log('\n  -- ' + label + ' (' + hits.length + ' hit' + (hits.length === 1 ? '' : 's') + ') --');
  if (hits.length === 0) { console.log('    (none)'); return; }
  const cap = maxHits || 10;
  const shown = hits.slice(0, cap);
  for (const i of shown) {
    const a = Math.max(0, i - before), b = Math.min(lines.length - 1, i + after);
    console.log('    [L' + (i + 1) + ']');
    for (let k = a; k <= b; k++) {
      console.log('    L' + (k + 1).toString().padStart(4) + (k === i ? ' >> ' : '    ') + lines[k]);
    }
    console.log('    ----');
  }
  if (hits.length > cap) console.log('    ... ' + (hits.length - cap) + ' more suppressed');
}

console.log('# diagnose_perf.js — read-only');
console.log('# generated: ' + new Date().toISOString());

function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }

// =====================================================================
header('discover.tsx — D-pad navigation root cause hunt');
const discover = read(F.discover);
if (!discover) console.log('  [MISSING] ' + F.discover);
else {
  console.log('  lines: ' + discover.split(/\r?\n/).length + '   eol: ' + (discover.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF'));

  dump('FlatList / FlashList props (windowSize, virtualization, snapToInterval, ...)',
    discover, /\b(FlatList|FlashList|windowSize|initialNumToRender|removeClippedSubviews|getItemLayout|maxToRenderPerBatch|onEndReached|snapTo|keyExtractor|estimatedItemSize)\b/, 0, 0, 30);

  dump('focus / onFocus / hasTVPreferredFocus / nextFocus / focusable',
    discover, /\b(onFocus|hasTVPreferredFocus|focusable|nextFocus|focusUp|focusDown|focusLeft|focusRight)\b/, 0, 1);

  dump('useEffect / useMemo / useCallback hooks',
    discover, /\b(useEffect|useMemo|useCallback|useState|useRef)\s*\(/, 0, 0, 20);

  dump('PATCH_V* markers (sediment audit)',
    discover, /PATCH_V\d+/, 0, 0, 30);

  dump('expensive sync calls (sort, filter, map chains, JSON.parse)',
    discover, /\.(sort|filter|reduce)\s*\(|JSON\.parse/, 0, 0, 20);
}

// =====================================================================
header('ContentCard.tsx — per-poster focus/render cost');
const card = read(F.ContentCard);
if (!card) console.log('  [MISSING] ' + F.ContentCard);
else {
  console.log('  lines: ' + card.split(/\r?\n/).length + '   eol: ' + (card.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF'));

  dump('React.memo / memo comparator / arePropsEqual',
    card, /\b(React\.memo|^\s*function\s+arePropsEqual|memo\s*\(|comparator)\b/, 0, 5);

  dump('Animated / withTiming / withSpring / focus animations',
    card, /\b(Animated\.|withTiming|withSpring|withDelay|reanimated|interpolate|useSharedValue|useAnimatedStyle)\b/, 0, 0, 20);

  dump('Image / FastImage / source / uri loading',
    card, /\b(Image|FastImage|source\s*=|uri\s*:|expo-image|cachePolicy|priority)\b/, 0, 0, 15);

  dump('onFocus / focus handlers in card',
    card, /\b(onFocus|onBlur|hasTVPreferredFocus|focusable)\b/, 0, 3);

  dump('PATCH_V* markers',
    card, /PATCH_V\d+/, 0, 0, 30);
}

// =====================================================================
header('ServiceRow.tsx — horizontal row scroll cost');
const row = read(F.ServiceRow);
if (!row) console.log('  [MISSING] ' + F.ServiceRow);
else {
  console.log('  lines: ' + row.split(/\r?\n/).length + '   eol: ' + (row.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF'));

  dump('FlatList / FlashList virtualization props',
    row, /\b(FlatList|FlashList|windowSize|initialNumToRender|removeClippedSubviews|getItemLayout|maxToRenderPerBatch|onEndReached|keyExtractor|estimatedItemSize|horizontal)\b/, 0, 0, 30);

  dump('scrollToIndex / scrollToOffset / onItemFocus / onScroll',
    row, /\b(scrollToIndex|scrollToOffset|onItemFocus|onScroll|onScrollEnd|onMomentumScrollEnd)\b/, 0, 3);

  dump('PATCH_V* markers',
    row, /PATCH_V\d+/, 0, 0, 30);
}

// =====================================================================
header('details mount — what runs on poster→details click');
const details = read(F.details);
if (!details) console.log('  [MISSING] ' + F.details);
else {
  console.log('  lines: ' + details.split(/\r?\n/).length);

  // First 30 useEffects with their dep arrays (to see what fires on mount)
  dump('useEffect blocks (the body kicks off on mount)',
    details, /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/, 0, 3, 30);

  // useFocusEffect blocks
  dump('useFocusEffect (re-runs on every focus, suspect for slow nav)',
    details, /useFocusEffect/, 0, 4);

  // fetchStreams / fetchMeta on mount
  dump('fetchStreams / fetchMeta / api.* calls (mount-time IO)',
    details, /\b(fetchStreams|fetchMeta|api\.(content|addons|library)|getMeta|getCached)\b/, 0, 2);

  // Big sync work in render
  dump('expensive ops near top of component (sort/filter/parseStreamInfo)',
    details, /\b(parseStreamInfo|sortStreamsByLanguage|computeScore|JSON\.parse)\b/, 0, 1);
}

// =====================================================================
header('contentStore.ts — discover cache shape');
const store = read(F.store);
if (!store) console.log('  [MISSING] ' + F.store);
else {
  dump('discover cache + persistent cache patterns',
    store, /\b(discoverData|getCached|setCache|CACHE_DURATIONS|fetchDiscover|isLoadingDiscover)\b/, 0, 1);

  dump('PATCH_V* markers in store',
    store, /PATCH_V\d+/, 0, 0, 30);
}

console.log('\n# done.');
