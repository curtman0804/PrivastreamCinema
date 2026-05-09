/* eslint-disable */
// apply_patches_v16a.js — COMMENTARY SINK (V16 retry, robust)
// Run from project root:   node apply_patches_v16a.js
//
// V16 failed because V9 already replaced the parsed.sort() comparator with
// a single-line computeScore-based one. The "directA = a.stream.url" anchor
// no longer exists.
//
// V16-A picks an anchor that's IDENTICAL in V9 and pre-V9 versions:
// the final `return parsed.map(p => p.stream);` line. We post-process
// the sorted result and partition commentary tracks to the end. This
// doesn't touch the comparator at all — it works regardless of whether
// V9, V12, or a vanilla pre-V9 file is in place.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found at ' + DETAILS); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v16a.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V16A_COMMENTARY_SINK';

if (src.includes(MARKER)) {
  ok('V16-A already applied — nothing to do');
  console.log('\n========================================');
  console.log('  ' + pass + ' passed   ' + fail + ' failed');
  console.log('========================================');
  process.exit(0);
}

// If V16's first half ran (helper got injected but the second anchor failed),
// the helper is still there from the partial application. Detect that so we
// don't double-inject.
const HELPER_ALREADY_PRESENT = src.includes('_isCommentaryStream') && src.includes('PATCH_V16_COMMENTARY_SINK');

// ----------------------------------------------------------------
// 1. Inject _isCommentaryStream helper at the top of sortStreamsByLanguage
//    (skip if V16 already injected it)
// ----------------------------------------------------------------
if (!HELPER_ALREADY_PRESENT) {
  const anchor = "function sortStreamsByLanguage(streams: Stream[]): Stream[] {\n  // Parse all stream info first\n  const parsed = streams.map(s => ({ stream: s, info: parseStreamInfo(s) }));";
  if (!src.includes(anchor)) {
    bad('could not find sortStreamsByLanguage opener (anchor 1)');
  } else {
    const replacement = [
      "function sortStreamsByLanguage(streams: Stream[]): Stream[] {",
      "  // " + MARKER + " — local commentary detector. Independent of V12/V9.",
      "  // Tested: 'Commentary', 'Audio Commentary', 'Director Commentary',",
      "  // 'Creator Comm', '[COMM]', 'Comm.', 'with commentary', etc.",
      "  const _isCommentaryStream = (s: any): boolean => {",
      "    const t = (((s?.title || '') + ' ' + (s?.name || '')).toUpperCase());",
      "    if (!t) return false;",
      "    if (t.includes('COMMENTARY')) return true;",
      "    if (t.includes('CREATOR COMM')) return true;",
      "    if (t.includes('DIRECTOR COMM')) return true;",
      "    if (t.includes('WRITERS COMM') || t.includes('WRITER COMM')) return true;",
      "    if (t.includes('WITH COMM')) return true;",
      "    if (t.includes('AUDIO COMM')) return true;",
      "    if (t.includes('COMM TRACK') || t.includes('COMM-TRACK') || t.includes('COMM.TRACK')) return true;",
      "    if (/\\[\\s*COMM[^\\]]*\\]/.test(t)) return true;",
      "    if (/\\bCOMM\\.\\s/.test(t)) return true;",
      "    return false;",
      "  };",
      "  // Parse all stream info first",
      "  const parsed = streams.map(s => ({ stream: s, info: parseStreamInfo(s) }));",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('injected _isCommentaryStream helper into sortStreamsByLanguage');
  }
} else {
  ok('_isCommentaryStream helper already present (from V16 partial run)');
}

// ----------------------------------------------------------------
// 2. Wrap the final `return parsed.map(p => p.stream);` so commentary
//    tracks are pushed to the END of the returned array. This anchor
//    is identical in V9, V12, and pre-V9 — bulletproof.
// ----------------------------------------------------------------
{
  const anchor = "  return parsed.map(p => p.stream);";
  if (!src.includes(anchor)) {
    bad('could not find `return parsed.map(p => p.stream);` anchor');
  } else {
    const replacement = [
      "  // " + MARKER + " — partition commentary tracks to the end of the result.",
      "  // Whatever score-based sort ran above, commentary always sinks last so",
      "  // the Play button (sorted[0]) and auto-play never select a commentary",
      "  // track even if it scored highest by language/quality/seeders.",
      "  const _sorted = parsed.map(p => p.stream);",
      "  const _nonComm: Stream[] = [];",
      "  const _comm: Stream[] = [];",
      "  for (const s of _sorted) {",
      "    if (_isCommentaryStream(s)) _comm.push(s); else _nonComm.push(s);",
      "  }",
      "  return [..._nonComm, ..._comm];",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('wrapped sortStreamsByLanguage return to push commentary tracks to end');
  }
}

// Save
if (src !== orig && fail === 0) {
  fs.writeFileSync(DETAILS, src, 'utf8');
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
  console.log('\nV16-A done. Rebuild and test:');
  console.log('  ✓ Play button on Rick & Morty S1E1 should NOT play commentary anymore');
  console.log('  ✓ Visible stream list shows commentary tracks at the bottom (with V15-A orange COMM badge)');
  console.log('  ✓ Auto-play (Play Next) skips commentary tracks');
}
