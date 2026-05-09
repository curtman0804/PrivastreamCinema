/* eslint-disable */
// apply_patches_v11a.js  — SAFE PARSER CACHE
// Run from project root:   node apply_patches_v11a.js
//
// Adds a module-level WeakMap cache for parseStreamInfo so each Stream object
// is parsed exactly once for its lifetime. This is the highest-impact perf
// win on details — every render previously re-parsed every stream multiple
// times.
//
// Zero JSX impact, zero component wrapping. Just a 1-line cache check at
// the top and 1-line cache set at the bottom of parseStreamInfo.

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
const bak = DETAILS + '.bak.v11a.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// 1. Inject WeakMap + early-return at parseStreamInfo's top
{
  const MARKER = 'PATCH_V11A_PARSE_CACHE';
  if (src.includes(MARKER)) {
    ok('parseStreamInfo cache already installed');
  } else {
    const anchor = "// Parse stream info helper - used by StreamCard and sorting\nfunction parseStreamInfo(stream: Stream) {";
    if (!src.includes(anchor)) {
      bad('could not locate parseStreamInfo header');
    } else {
      const replacement = [
        "// Parse stream info helper - used by StreamCard and sorting",
        "// " + MARKER + " — module-level cache so each Stream object is parsed exactly once.",
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

// 2. Cache the result before parseStreamInfo's return
{
  const MARKER = 'PATCH_V11A_PARSE_CACHE_SET';
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

// Save
if (src !== orig) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes — already patched');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV11-A done. Rebuild — should be no JSX changes, just faster parsing.');
  console.log('After confirming this builds + runs, ship V11-B for sortedStreams memoization.');
}
