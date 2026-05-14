/* eslint-disable */
// fix_dup_cache.js — remove duplicate _parseStreamInfoCache declaration
// Run from project root:   node fix_dup_cache.js
//
// THE BUG (build failure):
//   frontend/app/details/[type]/[id].tsx has two byte-identical lines:
//     L124: const _parseStreamInfoCache = new WeakMap<Stream, any>();
//     L125: // PATCH_V19A_PARSE_CACHE — module-level WeakMap cache for parseStreamInfo.
//     L126: const _parseStreamInfoCache = new WeakMap<Stream, any>();
//   This is left-over patch sediment from V19A being applied twice.
//   Result: SyntaxError "Identifier '_parseStreamInfoCache' has already been declared"
//
// THE FIX:
//   Delete the FIRST occurrence (the original, un-commented declaration).
//   Keep the one introduced by the PATCH_V19A_PARSE_CACHE comment.
//
// Safe, idempotent, single-file, CRLF-preserving.

const fs = require('fs');
const path = require('path');

const FILE = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(FILE)) { bad('file not found: ' + FILE); process.exit(1); }

let src = fs.readFileSync(FILE, 'utf8');
const orig = src;
const bak = FILE + '.bak.fixdup.' + Date.now();
fs.copyFileSync(FILE, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');

console.log('\n=== Removing duplicate _parseStreamInfoCache ===');

const DECL = "const _parseStreamInfoCache = new WeakMap<Stream, any>();";
const occ = src.split(DECL).length - 1;

if (occ === 0) {
  bad("declaration not found at all — nothing to fix (build error may be elsewhere)");
} else if (occ === 1) {
  ok("only one declaration found — already clean, no fix needed");
} else if (occ === 2) {
  // Find the position of the FIRST occurrence and delete that entire line
  // (including its trailing newline).
  const lines = src.split('\n');
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === DECL) { firstIdx = i; break; }
  }
  if (firstIdx === -1) {
    bad("could not isolate first declaration line (whitespace mismatch?)");
  } else {
    info('first occurrence at line ' + (firstIdx + 1) + ', removing it');
    lines.splice(firstIdx, 1);
    src = lines.join('\n');
    ok('removed duplicate declaration (kept the V19A-commented one)');
  }
} else {
  bad("found " + occ + " copies of the declaration — refusing to guess which to keep");
  info("open the file manually and reduce to exactly one occurrence");
}

if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(FILE, finalOut, 'utf8');
  ok('saved ' + FILE);
} else if (fail > 0) {
  info('failures — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nDone. Try the build again.');
  console.log("If it fails on ANOTHER duplicate declaration, paste the error and I'll");
  console.log("write the next one-liner. We'll clean them up one by one.");
}
