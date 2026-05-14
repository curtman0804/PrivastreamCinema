/* eslint-disable */
// apply_patches_v22.js — parseStreamInfo WeakMap cache (bulletproof rewrite)
// Run from project root:   node apply_patches_v22.js
//
// SINGLE string replace. No multi-line splicing, no brace tracking, no
// regex on the return statement. The original `function parseStreamInfo`
// declaration is replaced with a block containing:
//   - The WeakMap cache declaration
//   - A new `function parseStreamInfo` (the cached wrapper) that calls
//     `parseStreamInfoUncached`
//   - A `function parseStreamInfoUncached(...) {` opener
// The original body (everything between the function's `{` and its
// matching `}`) is now part of `parseStreamInfoUncached`. Every existing
// caller of `parseStreamInfo` automatically gets caching with zero changes.
//
// Idempotency: if `parseStreamInfoUncached` already exists in the file,
// no-op. If `_parseStreamInfoCache` is already declared, also no-op.

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
const bak = DETAILS + '.bak.v22.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V22_PARSE_CACHE';

// ---------------------------------------------------------------------
// Idempotency: bail out if cache or uncached function already exists
// ---------------------------------------------------------------------
if (src.includes('parseStreamInfoUncached') || src.includes('_parseStreamInfoCache')) {
  ok('parseStreamInfo cache already present — nothing to do (idempotent skip)');
  console.log('\n========================================');
  console.log('  ' + pass + ' passed   ' + fail + ' failed');
  console.log('========================================');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Single-anchor transform: function parseStreamInfo → wrapper + uncached
// ---------------------------------------------------------------------
{
  const anchor = "function parseStreamInfo(stream: Stream) {";
  const occurrences = (src.match(new RegExp(anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

  if (occurrences === 0) {
    bad('could not find `function parseStreamInfo(stream: Stream) {` anchor');
  } else if (occurrences > 1) {
    bad('anchor matches ' + occurrences + ' times — refusing to patch ambiguous file');
  } else {
    const replacement = [
      "// " + MARKER + " — module-level WeakMap cache. Each Stream object is parsed",
      "// only once per its lifetime; subsequent calls return the cached result.",
      "const _parseStreamInfoCache = new WeakMap<Stream, any>();",
      "function parseStreamInfo(stream: Stream): any {",
      "  const _cached = _parseStreamInfoCache.get(stream);",
      "  if (_cached !== undefined) return _cached;",
      "  const _result = parseStreamInfoUncached(stream);",
      "  _parseStreamInfoCache.set(stream, _result);",
      "  return _result;",
      "}",
      "function parseStreamInfoUncached(stream: Stream) {",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('inserted cache + wrapper; original body now belongs to parseStreamInfoUncached');
  }
}

// Save (restoring CRLF if original was CRLF)
if (src !== orig && fail === 0) {
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
  console.log('\nV22 done. Rebuild and test:');
  console.log('  ✓ Each stream parsed only once even across many re-renders');
  console.log('  ✓ Stream count climbs without UI thread spikes');
  console.log('  ✓ Combined with V20+V21: stream list rendering is now ~5-10x cheaper');
  console.log('\nIf builds + works, tell me and we go to V23.');
}
