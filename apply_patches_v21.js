/* eslint-disable */
// apply_patches_v21.js — React.memo wrapper for StreamCard (zero-risk approach)
// Run from project root:   node apply_patches_v21.js
//
// Single file. Single concept. Two swaps.
//
// Strategy: don't touch the existing `function StreamCard({...}) { ... }`
// declaration at all (that's where V19 went wrong). Instead, add a new
// `const StreamCardMemo = React.memo(StreamCard);` line right before the
// next component (// Episode Card Component), and swap the JSX usage
// from <StreamCard ... /> to <StreamCardMemo ... />.

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
const bak = DETAILS + '.bak.v21.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V21_STREAMCARD_MEMO';

if (src.includes(MARKER)) {
  ok('V21 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// 1. Insert `const StreamCardMemo = React.memo(StreamCard);` right
//    before the `// Episode Card Component` comment. Single-line anchor.
// ---------------------------------------------------------------------
{
  const anchor = "// Episode Card Component";
  if (!src.includes(anchor)) {
    bad('could not find `// Episode Card Component` anchor for memo insertion');
  } else {
    const insertion = [
      "// " + MARKER + " — memoized wrapper so cards skip re-render when stream identity is stable",
      "const StreamCardMemo = React.memo(StreamCard);",
      "",
      "// Episode Card Component",
    ].join('\n');
    src = src.replace(anchor, insertion);
    ok('inserted const StreamCardMemo = React.memo(StreamCard) before EpisodeCard');
  }
}

// ---------------------------------------------------------------------
// 2. Swap JSX usage <StreamCard ...> → <StreamCardMemo ...>
//    (handles space, newline, or > variations after the tag name)
// ---------------------------------------------------------------------
{
  let count = 0;
  // Replace common JSX usages: `<StreamCard ` and `<StreamCard\n`
  const variants = [
    { from: '<StreamCard ', to: '<StreamCardMemo ' },
    { from: '<StreamCard\n', to: '<StreamCardMemo\n' },
    { from: '<StreamCard\t', to: '<StreamCardMemo\t' },
    { from: '<StreamCard/>', to: '<StreamCardMemo/>' },
    { from: '<StreamCard>', to: '<StreamCardMemo>' },
  ];
  for (const v of variants) {
    while (src.includes(v.from)) {
      src = src.replace(v.from, v.to);
      count++;
      if (count > 10) break; // safety
    }
  }
  if (count === 0) {
    bad('could not find any <StreamCard ... /> JSX usage to swap');
  } else {
    ok('swapped ' + count + ' <StreamCard ...> JSX usage(s) → <StreamCardMemo ...>');
  }
}

// ---------------------------------------------------------------------
// Sanity: verify no closing `</StreamCard>` left dangling (rare, but check)
// ---------------------------------------------------------------------
{
  if (src.includes('</StreamCard>')) {
    info('found </StreamCard> closing tag — also swapping');
    src = src.replace(/<\/StreamCard>/g, '</StreamCardMemo>');
    ok('also swapped closing tag(s)');
  }
}

// Save (restoring CRLF if original was CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (src === orig) {
  info('no changes needed');
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
  console.log('\nV21 done. Rebuild and test:');
  console.log('  ✓ Stream list re-renders less aggressively during progressive load');
  console.log('  ✓ Scrolling stream list is smoother on Firestick');
  console.log('  ✓ Nothing else changes');
  console.log('\nIf this builds and runs cleanly, tell me and we go to V22.');
}
