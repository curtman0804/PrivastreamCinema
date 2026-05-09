/* eslint-disable */
// apply_patches_v11.js
// Run from project root:   node apply_patches_v11.js
//
// PERF: kills nav lag on details + stream lists, especially noticeable on
// Firestick 4K Max where every parent re-render was reparsing every stream
// 3× and sorting them all over again.
//
// 1. parseStreamInfo: module-level WeakMap cache. Each Stream object parsed
//    exactly once for its whole lifetime.
// 2. StreamCard / EpisodeCard: wrapped in React.memo so they don't re-render
//    when unrelated parent state changes.
// 3. sortStreamsByLanguage(streams) in the FlatList JSX → useMemo'd
//    `sortedStreams` so the sort only runs when `streams` actually changes.
// 4. Both FlatLists in details: virtualization tuned for Firestick
//    (removeClippedSubviews, windowSize, initialNumToRender, maxToRenderPerBatch).

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }
let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v11.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// ----------------------------------------------------------------
// 0. Ensure `memo` is imported from 'react'
// ----------------------------------------------------------------
{
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]react['"]/;
  const m = src.match(re);
  if (m) {
    const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!items.includes('memo')) {
      items.push('memo');
      src = src.replace(re, "import { " + items.join(', ') + " } from 'react'");
      ok('added `memo` to react import');
    } else {
      ok('`memo` already imported from react');
    }
  } else {
    // Probably uses `import * as React from 'react'` or default. Inject named import.
    const headerEnd = src.indexOf('\n\n', src.indexOf('import'));
    src = "import { memo } from 'react';\n" + src;
    ok('inserted new `import { memo } from "react"` at top');
  }
}

// ----------------------------------------------------------------
// 1. Cache parseStreamInfo with a module-level WeakMap
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_PARSE_CACHE';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache already installed');
  } else {
    const anchor = "// Parse stream info helper - used by StreamCard and sorting\nfunction parseStreamInfo(stream: Stream) {";
    if (!src.includes(anchor)) {
      bad('could not locate parseStreamInfo header to inject cache');
    } else {
      const replacement = [
        "// Parse stream info helper - used by StreamCard and sorting",
        "// " + MARKER + " — module-level cache so each Stream is parsed exactly once.",
        "const _parseStreamInfoCache = new WeakMap<Stream, any>();",
        "function parseStreamInfo(stream: Stream) {",
        "  const _cached = _parseStreamInfoCache.get(stream);",
        "  if (_cached) return _cached;",
      ].join('\n');
      src = src.replace(anchor, replacement);
      ok('parseStreamInfo wrapped with WeakMap early-return');
    }
  }
}

// ----------------------------------------------------------------
// 2. Cache the result before parseStreamInfo's return
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_PARSE_CACHE_SET';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache-set already in place');
  } else {
    const oldReturn = "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };";
    if (!src.includes(oldReturn)) {
      bad('could not find parseStreamInfo return for cache-set');
    } else {
      const newReturn = [
        "  // " + MARKER,
        "  const _result = { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };",
        "  _parseStreamInfoCache.set(stream, _result);",
        "  return _result;",
      ].join('\n');
      src = src.replace(oldReturn, newReturn);
      ok('parseStreamInfo now caches its result');
    }
  }
}

// ----------------------------------------------------------------
// 3. Wrap StreamCard with memo (declaration → const memo)
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_MEMO_STREAMCARD';
  if (src.includes(MARKER)) {
    ok('StreamCard already wrapped in memo');
  } else {
    const oldStart = "// Stream Card Component - 3-row vertical layout\nfunction StreamCard({";
    const newStart = "// Stream Card Component - 3-row vertical layout\n// " + MARKER + " — re-renders only when stream/onPress identity changes\nconst StreamCard = memo(function StreamCardImpl({";
    if (!src.includes(oldStart)) {
      bad('could not find StreamCard declaration');
    } else {
      src = src.replace(oldStart, newStart);

      // Now find the closing `}` of StreamCard. Looking at dump: line 325 is `}` after the JSX.
      // Pattern: lines 321-325 are `      </Pressable>\n    );\n  }` so the function body
      // closes with `}\n` right before the next comment "// Episode Card Component".
      const oldEnd = "    </Pressable>\n  );\n}\n\n// Episode Card Component";
      const newEnd = "    </Pressable>\n  );\n});\n\n// Episode Card Component";
      if (!src.includes(oldEnd)) {
        bad('could not find StreamCard closing brace before Episode comment');
      } else {
        src = src.replace(oldEnd, newEnd);
        ok('StreamCard wrapped in memo()');
      }
    }
  }
}

// ----------------------------------------------------------------
// 4. Wrap EpisodeCard with memo (best-effort; only if found)
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_MEMO_EPISODECARD';
  if (src.includes(MARKER)) {
    ok('EpisodeCard already wrapped in memo');
  } else {
    const re = /\nfunction EpisodeCard\(\{/;
    if (re.test(src)) {
      src = src.replace(re, "\n// " + MARKER + "\nconst EpisodeCard = memo(function EpisodeCardImpl({");
      // Find next top-level `}` followed by blank-line + comment or function — best effort.
      // We search for an unindented closing brace after EpisodeCard's start. To avoid false
      // positives, look for `\n}\n\n// ` after our injected EpisodeCardImpl marker.
      const idx = src.indexOf(MARKER);
      const after = src.indexOf('\n}\n\n// ', idx);
      if (after > 0) {
        src = src.slice(0, after) + '\n});\n\n// ' + src.slice(after + '\n}\n\n// '.length);
        ok('EpisodeCard wrapped in memo()');
      } else {
        info('EpisodeCard wrap: could not find clean closing — leaving function as-is');
      }
    } else {
      info('no EpisodeCard component found — skipping');
    }
  }
}

// ----------------------------------------------------------------
// 5. Replace `sortStreamsByLanguage(streams)` in the FlatList JSX with `sortedStreams`,
//    and declare `const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);`
//    near where `streams` is taken from the store.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_MEMO_SORTED';
  if (src.includes(MARKER)) {
    ok('sortedStreams memo already declared');
  } else {
    const anchor = "  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);";
    if (!src.includes(anchor)) {
      bad('could not find isLoadingStreams anchor for sortedStreams useMemo');
    } else {
      const insert = [
        "  const isLoadingStreams = useContentStore(s => s.isLoadingStreams);",
        "  // " + MARKER + " — sort once per streams change instead of every render",
        "  const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);",
      ].join('\n');
      src = src.replace(anchor, insert);
      ok('declared sortedStreams = useMemo(...)');
    }
  }

  // Replace the JSX usage
  const oldData = "                  data={sortStreamsByLanguage(streams)}";
  const newData = "                  data={sortedStreams}";
  if (src.includes(newData) && !src.includes(oldData)) {
    ok('FlatList already uses sortedStreams');
  } else if (src.includes(oldData)) {
    src = src.replace(oldData, newData);
    ok('FlatList data switched to sortedStreams');
  } else {
    bad('could not find FlatList data={sortStreamsByLanguage(streams)} to swap');
  }
}

// ----------------------------------------------------------------
// 6. Add Firestick-tuned virtualization props to BOTH FlatLists
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V11_VIRTUALIZE';
  const virtProps = [
    "                removeClippedSubviews={true}",
    "                windowSize={5}",
    "                initialNumToRender={4}",
    "                maxToRenderPerBatch={4}",
    "                updateCellsBatchingPeriod={50}",
  ].join('\n');

  // Episode FlatList (line ~1222)
  if (src.includes('// ' + MARKER + ' (episodes)')) {
    ok('episode FlatList already virtualized');
  } else {
    const oldA = [
      "              <FlatList",
      "                data={episodesForSeason}",
      "                renderItem={renderEpisodeItem}",
      "                keyExtractor={(item) => `${item.season}-${item.episode}`}",
      "                horizontal",
      "                showsHorizontalScrollIndicator={false}",
      "                contentContainerStyle={styles.episodesList}",
      "              />",
    ].join('\n');
    const newA = [
      "              {/* " + MARKER + " (episodes) */}",
      "              <FlatList",
      "                data={episodesForSeason}",
      "                renderItem={renderEpisodeItem}",
      "                keyExtractor={(item) => `${item.season}-${item.episode}`}",
      "                horizontal",
      "                showsHorizontalScrollIndicator={false}",
      "                contentContainerStyle={styles.episodesList}",
      virtProps,
      "              />",
    ].join('\n');
    if (src.includes(oldA)) {
      src = src.replace(oldA, newA);
      ok('episode FlatList virtualized');
    } else {
      bad('could not find episode FlatList to virtualize');
    }
  }

  // Stream FlatList (line ~1269)
  if (src.includes('// ' + MARKER + ' (streams)')) {
    ok('stream FlatList already virtualized');
  } else {
    const oldB = [
      "                <FlatList",
      "                  data={sortedStreams}",
      "                  renderItem={renderStreamItem}",
      "                  keyExtractor={(item, index) => `${item.infoHash || item.url || index}`}",
      "                  horizontal",
      "                  showsHorizontalScrollIndicator={false}",
      "                  contentContainerStyle={styles.streamsList}",
      "                />",
    ].join('\n');
    const newB = [
      "                {/* " + MARKER + " (streams) */}",
      "                <FlatList",
      "                  data={sortedStreams}",
      "                  renderItem={renderStreamItem}",
      "                  keyExtractor={(item, index) => `${item.infoHash || item.url || index}`}",
      "                  horizontal",
      "                  showsHorizontalScrollIndicator={false}",
      "                  contentContainerStyle={styles.streamsList}",
      "                  removeClippedSubviews={true}",
      "                  windowSize={5}",
      "                  initialNumToRender={4}",
      "                  maxToRenderPerBatch={4}",
      "                  updateCellsBatchingPeriod={50}",
      "                />",
    ].join('\n');
    if (src.includes(oldB)) {
      src = src.replace(oldB, newB);
      ok('stream FlatList virtualized');
    } else {
      bad('could not find stream FlatList to virtualize');
    }
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes — already patched or anchors not found');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV11 installed. Rebuild & test on Firestick:');
  console.log('  ✓ Details page should paint faster, scroll should feel snappier');
  console.log('  ✓ Stream lists no longer freeze the UI on first paint');
  console.log('  ✓ Auto-play handoff should be quicker (no re-parse / re-sort)');
}
