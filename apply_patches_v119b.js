// apply_patches_v119b_fix_import.js
// Hotfix for v119 — InteractionManager import got mangled into a multi-line
// react-native import block. This script cleans it up.
const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', '(tabs)', 'search.tsx');
function fail(m) { console.error(`[v119b] FATAL: ${m}`); process.exit(1); }
function ok(m)   { console.log(`[v119b] ok: ${m}`); }

if (!fs.existsSync(TARGET)) fail(`${TARGET} not found.`);

const orig = fs.readFileSync(TARGET, 'utf8');
const hadCRLF = orig.includes('\r\n');
let src = orig.replace(/\r\n/g, '\n');

if (src.includes('V119B_FIX_IMPORT')) {
  console.log('[v119b] = already applied');
  process.exit(0);
}

// Detect the broken pattern: ", InteractionManager}" sitting on its own line
// inside the react-native import block.
const broken = /\n,\s*InteractionManager\}\s*from\s*['"]react-native['"];?/;
if (broken.test(src)) {
  // Strip the broken trailing chunk, then re-add InteractionManager properly
  src = src.replace(broken, "\n  InteractionManager,\n} from 'react-native';");
  ok('A: stripped broken trailing chunk and re-added InteractionManager');
} else {
  // Maybe formatted differently — search for any malformed standalone line
  const alt = /^,\s*InteractionManager\}/m;
  if (alt.test(src)) {
    src = src.replace(/(\n\s*)(\}\s*from\s*['"]react-native['"];?)/, '\n  InteractionManager,\n$2');
    src = src.replace(/^,\s*InteractionManager\}.*$/m, '');
    ok('A: alternate fix path applied');
  } else {
    console.log('[v119b] note: broken pattern not detected, double-checking import state');
  }
}

// Make sure InteractionManager is in the import exactly once
const matches = src.match(/InteractionManager/g) || [];
if (matches.length === 0) {
  // Re-add safely to the multi-line react-native import
  src = src.replace(/(\}\s*from\s*['"]react-native['"];?)/, '  InteractionManager,\n$1');
  ok('B: InteractionManager re-inserted into react-native import');
}

// Add idempotency marker
if (!src.includes('V119B_FIX_IMPORT')) {
  src = src.replace(/InteractionManager,/, 'InteractionManager, /* V119B_FIX_IMPORT */');
  ok('C: idempotency marker added');
}

// Sanity check: no orphan `, InteractionManager}` standalone line
if (/^\s*,\s*InteractionManager\}/m.test(src)) {
  fail('STILL malformed - manual fix needed. Open search.tsx and ensure InteractionManager is inside the { } of "from \\\'react-native\\\'" import list.');
}

const out = hadCRLF ? src.replace(/\n/g, '\r\n') : src;
const bak = TARGET + '.bak.v119b.' + Date.now();
fs.writeFileSync(bak, orig, 'utf8');
fs.writeFileSync(TARGET, out, 'utf8');
console.log(`[v119b] backup: ${bak}`);
console.log(`[v119b] OK wrote ${TARGET}`);
console.log('');
console.log('Now retry: cd android && gradlew assembleRelease');
