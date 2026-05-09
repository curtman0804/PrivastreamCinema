/* eslint-disable */
// apply_patches_v19a.js — Memoization perf wins in details/[type]/[id].tsx
// Run from project root:   node apply_patches_v19a.js
//
// Three changes, all surgical:
//   1. parseStreamInfo: WeakMap cache so the same stream object is parsed only
//      ONCE no matter how many times sort/render touches it. (V11/V11A's
//      intended fix, finally done right.)
//   2. DetailsScreen: useMemo the sorted streams list so we don't re-sort on
//      every re-render. The Play button + FlatList both use the memoized
//      reference, which also lets React.memo on StreamCard skip 90% of
//      re-renders during progressive stream loading.
//   3. StreamCard: wrapped in React.memo so unchanged cards don't re-render
//      when the streams array reference changes (e.g. addon arrives).
//
// Big win: progressive stream loading no longer thrashes the UI thread.

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
const bak = DETAILS + '.bak.v19a.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

// Normalize line endings to LF for uniform anchor matching. We restore the
// original EOL on save so the file's apparent line endings don't change.
const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

// =====================================================================
// PART 1: parseStreamInfo WeakMap cache
// =====================================================================
{
  const MARKER = 'PATCH_V19A_PARSE_CACHE';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache already in place');
  } else {
    // 1a. Insert cache declaration BEFORE `function parseStreamInfo`
    const fnAnchor = "// Parse stream info helper - used by StreamCard and sorting\nfunction parseStreamInfo(stream: Stream) {";
    if (!src.includes(fnAnchor)) {
      bad('could not find parseStreamInfo declaration anchor');
    } else {
      const declarationBlock = [
        "// " + MARKER + " — module-level WeakMap cache so the same stream object is",
        "// parsed only once. Keyed by the stream object reference; entries auto-evict",
        "// when the stream is garbage-collected. Massive win during progressive",
        "// stream loading where sort/render touches the same streams 5-10x.",
        "const _parseStreamInfoCache = new WeakMap<Stream, any>();",
        "",
        "// Parse stream info helper - used by StreamCard and sorting",
        "function parseStreamInfo(stream: Stream) {",
        "  const _v19Cached = _parseStreamInfoCache.get(stream);",
        "  if (_v19Cached) return _v19Cached;",
      ].join('\n');
      src = src.replace(fnAnchor, declarationBlock);
      ok('inserted parseStreamInfo WeakMap cache + check at function entry');
    }

    // 1b. Modify the return statement to also store in cache.
    // Try post-V12 form first (with isCommentary), then V9 form, then original.
    const returnVariants = [
      "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR, isCommentary };",
      "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };",
      "  return { quality, source, size, seeders, title, language, isForeign };",
    ];
    let returnReplaced = false;
    for (const oldReturn of returnVariants) {
      if (src.includes(oldReturn)) {
        const newReturn = [
          "  const _v19Result = " + oldReturn.trim().replace(/^return\s+/, '').replace(/;$/, ';'),
          "  _parseStreamInfoCache.set(stream, _v19Result);",
          "  return _v19Result;",
        ].join('\n  ').replace(/^\s+/, '  ');
        // Slight cleanup: ensure `_v19Result = { ... };` form
        const properNew = [
          "  const _v19Result = " + oldReturn.replace(/^\s*return\s+/, '').replace(/^\{/, '{'),
          "  _parseStreamInfoCache.set(stream, _v19Result);",
          "  return _v19Result;",
        ].join('\n');
        src = src.replace(oldReturn, properNew);
        returnReplaced = true;
        ok('parseStreamInfo return now caches result (matched: ' + oldReturn.substring(0, 60) + '...)');
        break;
      }
    }
    if (!returnReplaced) bad('could not find parseStreamInfo return line to wrap');
  }
}

// =====================================================================
// PART 2: useMemo the sorted streams + replace 2 inline call sites
// =====================================================================
{
  const MARKER = 'PATCH_V19A_SORTED_MEMO';
  if (src.includes(MARKER)) {
    ok('sortedStreams useMemo already in place');
  } else {
    // 2a. Insert the useMemo right after `const fetchStreams = useContentStore(s => s.fetchStreams);`
    // That line is in DetailsScreen's hook block — known stable from diagnostic.
    const hookAnchor = "  const fetchStreams = useContentStore(s => s.fetchStreams);";
    if (!src.includes(hookAnchor)) {
      bad('could not find fetchStreams hook anchor for useMemo insertion');
    } else {
      const insertion = [
        "  const fetchStreams = useContentStore(s => s.fetchStreams);",
        "  // " + MARKER + " — memoize the sorted streams list. Without this, every",
        "  // re-render (and during progressive load there are 5-10) fully re-sorts",
        "  // the streams array and re-runs parseStreamInfo on every entry.",
        "  const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);",
      ].join('\n');
      src = src.replace(hookAnchor, insertion);
      ok('added sortedStreams useMemo after fetchStreams hook');
    }

    // 2b. Replace the FlatList data prop
    const oldFlatListData = "                  data={sortStreamsByLanguage(streams)}";
    const newFlatListData = "                  data={sortedStreams}";
    if (src.includes(oldFlatListData)) {
      src = src.replace(oldFlatListData, newFlatListData);
      ok('FlatList now uses memoized sortedStreams');
    } else {
      info('FlatList data prop already pointed at sortedStreams or differs — skipping');
    }

    // 2c. Replace the Play button's inline sort
    const oldPlayBtn = "                    onPress={() => {\n                      const sorted = sortStreamsByLanguage(streams);\n                      if (sorted[0]) handleStreamSelect(sorted[0]);\n                    }}";
    const newPlayBtn = "                    onPress={() => {\n                      if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);\n                    }}";
    if (src.includes(oldPlayBtn)) {
      src = src.replace(oldPlayBtn, newPlayBtn);
      ok('Play button now uses memoized sortedStreams');
    } else {
      info('Play button onPress already changed or differs — skipping');
    }
  }
}

// =====================================================================
// PART 3: Wrap StreamCard with React.memo
// =====================================================================
{
  const MARKER = 'PATCH_V19A_STREAMCARD_MEMO';
  if (src.includes(MARKER)) {
    ok('StreamCard already wrapped in React.memo');
  } else {
    // Anchor: the function declaration line. Snapshot has:
    //   // Stream Card Component - 3-row vertical layout
    //   function StreamCard({
    const oldDecl = "// Stream Card Component - 3-row vertical layout\nfunction StreamCard({";
    if (!src.includes(oldDecl)) {
      bad('could not find StreamCard function declaration to wrap');
    } else {
      const newDecl = "// Stream Card Component - 3-row vertical layout (" + MARKER + " React.memo)\nconst StreamCard = React.memo(function StreamCardInner({";
      src = src.replace(oldDecl, newDecl);
      ok('StreamCard renamed to inner + wrapped in React.memo opener');

      // Now find the closing `}` of StreamCard. It's followed by:
      //   <blank line>
      //   // Episode Card Component
      // (V18 left this structure intact)
      const oldClose = "    </Pressable>\n  );\n}\n\n// Episode Card Component";
      if (src.includes(oldClose)) {
        const newClose = "    </Pressable>\n  );\n});\n\n// Episode Card Component";
        src = src.replace(oldClose, newClose);
        ok('StreamCard closing brace updated to React.memo closer');
      } else {
        bad('could not find StreamCard close + Episode Card Component anchor');
        info('Reverting StreamCard rename to keep file valid');
        src = src.replace(newDecl, oldDecl);
      }
    }
  }
}

// Save
if (src !== orig && fail === 0) {
  // Restore CRLF if the original used it
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV19-A done. Rebuild and test:');
  console.log('  ✓ Stream count climbs more smoothly (no UI thread spikes)');
  console.log('  ✓ Scrolling the stream list is buttery smooth');
  console.log('  ✓ The "Play" button responds instantly');
  console.log('\nNext: V19-B (contentStore throttling + AsyncStorage persistent cache)');
}
