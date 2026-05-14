/* eslint-disable */
// apply_patches_v19a4.js — dedup the _parseStreamInfoCache declaration
// Run from project root:   node apply_patches_v19a4.js
//
// Symptoms: build error
//   124 | const _parseStreamInfoCache = new WeakMap<Stream, any>();
//   125 | // PATCH_V19A_PARSE_CACHE — module-level WeakMap cache ...
//   126 | const _parseStreamInfoCache = new WeakMap<Stream, any>();
//
// An earlier patch attempt left an orphan declaration on line 124 (no
// preceding marker comment), then V19-A3 added a properly-marked one
// on lines 125-126. We remove the orphan (the one without a comment
// above it) and keep the V19-A3 properly-commented declaration.
//
// Idempotent: if there's only one declaration, no-op.

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
const bak = DETAILS + '.bak.v19a4.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Dedup ' + DETAILS + ' ===');

// =====================================================================
// 1. Find ALL `const _parseStreamInfoCache = new WeakMap` declarations
// =====================================================================
const lines = src.split('\n');
const declRegex = /^const\s+_parseStreamInfoCache\s*=\s*new\s+WeakMap/;
const declIndices = [];
for (let i = 0; i < lines.length; i++) {
  if (declRegex.test(lines[i].trim())) declIndices.push(i);
}

console.log('  found ' + declIndices.length + ' _parseStreamInfoCache declaration(s):');
for (const i of declIndices) {
  console.log('    line ' + (i+1) + ': ' + lines[i].trim());
}

if (declIndices.length === 0) {
  bad('no _parseStreamInfoCache declarations found at all');
} else if (declIndices.length === 1) {
  ok('exactly one declaration — nothing to dedup');
} else {
  // 2. Identify which declaration is the V19-A "blessed" one (has the
  //    marker comment immediately above it). Remove all others.
  const MARKER_COMMENT = 'PATCH_V19A_PARSE_CACHE';
  let blessedIdx = -1;
  for (const di of declIndices) {
    if (di > 0 && lines[di - 1].includes(MARKER_COMMENT)) {
      blessedIdx = di;
      break;
    }
  }

  if (blessedIdx < 0) {
    info('no declaration has the V19-A marker comment above it — keeping the LAST one');
    blessedIdx = declIndices[declIndices.length - 1];
  } else {
    info('blessed declaration is at line ' + (blessedIdx + 1) + ' (has V19-A marker above)');
  }

  // 3. Remove all OTHER declarations (and any comment line directly above an orphan that says "PATCH_V11_PARSE_CACHE" — that was V11's marker).
  const toRemove = new Set();
  for (const di of declIndices) {
    if (di === blessedIdx) continue;
    toRemove.add(di);
    // If the line ABOVE is a V11 marker comment, remove that too.
    if (di > 0 && /PATCH_V11_PARSE_CACHE/.test(lines[di - 1])) toRemove.add(di - 1);
    // If the line ABOVE is the legacy comment "// Parse stream info helper..."
    // and the line below is the function declaration (it would be redundant
    // because the V19-A insertion has its own comment), preserve as-is —
    // we only want to remove the orphan declaration line itself.
  }

  // Build new lines array
  const newLines = lines.filter((_, i) => !toRemove.has(i));
  src = newLines.join('\n');
  ok('removed ' + toRemove.size + ' orphan line(s) (kept blessed declaration at line ' + (blessedIdx+1) + ')');
}

// 4. Sanity: re-count after dedup
{
  const reLines = src.split('\n');
  let cnt = 0;
  for (const l of reLines) if (declRegex.test(l.trim())) cnt++;
  if (cnt === 1) {
    ok('post-dedup: exactly 1 declaration remains');
  } else {
    bad('post-dedup: ' + cnt + ' declarations remain (expected 1)');
  }
}

// Save
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (src === orig) {
  info('no changes needed — file already clean');
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
  console.log('\nV19-A4 done. Rebuild — duplicate declaration error should be gone.');
}
