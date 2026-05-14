/* eslint-disable */
// apply_patches_v20.js — useMemo the sorted streams (smallest possible perf win)
// Run from project root:   node apply_patches_v20.js
//
// Single file. Single concept. Three anchor swaps. Zero new state.
//
// Currently `sortStreamsByLanguage(streams)` is called inline 4 times per
// render. With 50+ streams + 5 progressive updates from addons, that's
// ~1000 wasteful sort operations per stream-fetch. This patch derives a
// single memoized `sortedStreams` and swaps the two render-hot call sites
// (FlatList data, Play button onPress).

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
const bak = DETAILS + '.bak.v20.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V20_SORTED_MEMO';

if (src.includes(MARKER)) {
  ok('V20 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// 1. Insert `sortedStreams = useMemo(...)` after fetchStreams hook
// ---------------------------------------------------------------------
{
  const anchor = "  const fetchStreams = useContentStore(s => s.fetchStreams);";
  if (!src.includes(anchor)) {
    bad('could not find fetchStreams hook anchor');
  } else {
    const insertion = [
      "  const fetchStreams = useContentStore(s => s.fetchStreams);",
      "  // " + MARKER + " — memoize sorted streams; sort runs only when streams identity changes",
      "  const sortedStreams = useMemo(() => sortStreamsByLanguage(streams), [streams]);",
    ].join('\n');
    src = src.replace(anchor, insertion);
    ok('added sortedStreams useMemo after fetchStreams hook');
  }
}

// ---------------------------------------------------------------------
// 2. FlatList data prop swap (single-line)
// ---------------------------------------------------------------------
{
  const anchor = "data={sortStreamsByLanguage(streams)}";
  const replacement = "data={sortedStreams}";
  if (!src.includes(anchor)) {
    info('FlatList data prop already swapped or differs — skipping');
  } else {
    // Use replaceAll-style behavior in case it appears more than once
    let count = 0;
    while (src.includes(anchor)) {
      src = src.replace(anchor, replacement);
      count++;
      if (count > 5) break; // safety
    }
    ok('FlatList(s) now use memoized sortedStreams (' + count + ' swap' + (count !== 1 ? 's' : '') + ')');
  }
}

// ---------------------------------------------------------------------
// 3. Play button onPress: swap the inline sort
//    The Play button does:
//      const sorted = sortStreamsByLanguage(streams);
//      if (sorted[0]) handleStreamSelect(sorted[0]);
//    Replace with:
//      if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);
//
//    Two sub-anchors (single-line each) so we don't need a multi-line match.
// ---------------------------------------------------------------------
{
  const anchorA = "                      const sorted = sortStreamsByLanguage(streams);";
  const anchorB = "                      if (sorted[0]) handleStreamSelect(sorted[0]);";
  const removed = [];
  if (src.includes(anchorA)) {
    src = src.replace(anchorA + '\n', '');
    removed.push('A');
  }
  if (src.includes(anchorB)) {
    src = src.replace(anchorB, "                      if (sortedStreams[0]) handleStreamSelect(sortedStreams[0]);");
    removed.push('B');
  }
  if (removed.length === 2) {
    ok('Play button now uses memoized sortedStreams');
  } else if (removed.length === 1) {
    info('Play button partially matched (' + removed.join('') + ') — manual check recommended but harmless');
  } else {
    info('Play button onPress not in expected form — leaving alone');
  }
}

// Save (restoring CRLF if original was CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (src === orig) {
  info('no changes needed — file unchanged');
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
  console.log('\nV20 done. Rebuild and test:');
  console.log('  ✓ Stream list scrolls smoothly while addons are still loading');
  console.log('  ✓ "Play" button responds without a frame stutter');
  console.log('  ✓ Nothing else changes');
  console.log('\nIf this builds and runs cleanly, tell me and we go to V21 (next single change).');
}
