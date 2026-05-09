/* eslint-disable */
// apply_patches_v16.js — COMMENTARY SINK (REAL FIX)
// Run from project root:   node apply_patches_v16.js
//
// PROBLEM: V12 added a -2000 commentary penalty, but only inside `computeScore`.
// The actual Play button + auto-play + visible FlatList all use
// `sortStreamsByLanguage` — which never calls computeScore. So commentary
// tracks (which are typically ENG + heavily seeded) bubbled to position 0
// and got auto-picked. V15-A's COMM badge made them VISIBLE but did not
// fix the picker.
//
// V16 fix: sortStreamsByLanguage now uses commentary detection as its
// FIRST sort criterion (above cached/direct-URL preference). Commentary
// tracks always sink to the bottom, even if cached. The visible list,
// the Play button, and the auto-play (Play Next) all use this same
// function, so all three are fixed in one edit.
//
// Single-file, surgical, exact-match string replacement — no regex.

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
const bak = DETAILS + '.bak.v16.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V16_COMMENTARY_SINK';

if (src.includes(MARKER)) {
  ok('V16 already applied — nothing to do');
  console.log('\n========================================');
  console.log('  ' + pass + ' passed   ' + fail + ' failed');
  console.log('========================================');
  process.exit(0);
}

// ----------------------------------------------------------------
// 1. Inject _isCommentaryStream helper at the top of sortStreamsByLanguage
// ----------------------------------------------------------------
{
  const anchor = "function sortStreamsByLanguage(streams: Stream[]): Stream[] {\n  // Parse all stream info first\n  const parsed = streams.map(s => ({ stream: s, info: parseStreamInfo(s) }));";
  if (!src.includes(anchor)) {
    bad('could not find sortStreamsByLanguage opener (anchor 1)');
  } else {
    const replacement = [
      "function sortStreamsByLanguage(streams: Stream[]): Stream[] {",
      "  // " + MARKER + " — local commentary detector. Independent of V12 so this",
      "  // works whether or not parseStreamInfo exposes isCommentary. Tested",
      "  // against: 'Commentary', 'Audio Commentary', 'Director Commentary',",
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
}

// ----------------------------------------------------------------
// 2. Add commentary check as FIRST criterion in the parsed.sort() comparator
// ----------------------------------------------------------------
{
  const anchor = "  parsed.sort((a, b) => {\n    const directA = a.stream.url ? 0 : 1;\n    const directB = b.stream.url ? 0 : 1;\n    if (directA !== directB) return directA - directB;";
  if (!src.includes(anchor)) {
    bad('could not find parsed.sort comparator anchor (anchor 2)');
  } else {
    const replacement = [
      "  parsed.sort((a, b) => {",
      "    // " + MARKER + " — commentary tracks ALWAYS sink, even if cached.",
      "    // This must run before the direct-URL check, otherwise a cached",
      "    // commentary track wins over an uncached real episode.",
      "    const commA = ((a.info as any)?.isCommentary || _isCommentaryStream(a.stream)) ? 1 : 0;",
      "    const commB = ((b.info as any)?.isCommentary || _isCommentaryStream(b.stream)) ? 1 : 0;",
      "    if (commA !== commB) return commA - commB;",
      "",
      "    const directA = a.stream.url ? 0 : 1;",
      "    const directB = b.stream.url ? 0 : 1;",
      "    if (directA !== directB) return directA - directB;",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('inserted commentary-first check in sortStreamsByLanguage comparator');
  }
}

// Save
if (src !== orig && fail === 0) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved)');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV16 done. Rebuild and test:');
  console.log('  ✓ Play button on Rick & Morty S1E1 should NOT play commentary anymore');
  console.log('  ✓ Visible stream list will show non-commentary streams first');
  console.log('  ✓ Commentary tracks (with V15-A orange COMM badge) appear at the bottom');
  console.log('  ✓ Auto-play (Play Next) skips commentary tracks');
}
