/* eslint-disable */
// show_back_state.js — READ-ONLY: print the EXACT current state of all back handlers
// Run from project root:  node show_back_state.js > back_state.txt
// Then paste back_state.txt
//
// Shows me:
//   - All BackHandler.addEventListener registrations + 30 lines of context
//   - All router.back / router.replace / router.push calls
//   - The handleBack function definition (on-screen back button handler)
//   - Imports from react-native / expo-router
//   - Any PATCH_V*_BACK_NAV / PATCH_V*_BACK_ESCAPE / PATCH_V*_NO_OP markers
//
// Read-only — does NOT write anything. Safe to run anytime.

const fs = require('fs');
const path = require('path');

const FILES = {
  details: path.join('frontend', 'app', 'details', '[type]', '[id].tsx'),
  player:  path.join('frontend', 'app', 'player.tsx'),
  layout:  path.join('frontend', 'app', '(tabs)', '_layout.tsx'),
};

function header(t) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + t);
  console.log('='.repeat(70));
}

function dumpRegion(label, src, regex, before, after) {
  const lines = src.split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length; i++) if (regex.test(lines[i])) hits.push(i);
  console.log('\n  -- ' + label + ' (' + hits.length + ' hit' + (hits.length === 1 ? '' : 's') + ') --');
  if (hits.length === 0) { console.log('    (none)'); return; }
  for (const i of hits) {
    const a = Math.max(0, i - before), b = Math.min(lines.length - 1, i + after);
    console.log('    [L' + (i + 1) + ']');
    for (let k = a; k <= b; k++) {
      console.log('    L' + (k + 1).toString().padStart(4) + (k === i ? ' >> ' : '    ') + lines[k]);
    }
    console.log('    ----');
  }
}

console.log('# show_back_state.js — read-only');
console.log('# generated: ' + new Date().toISOString());

for (const [key, p] of Object.entries(FILES)) {
  header(key + '  →  ' + p);
  if (!fs.existsSync(p)) { console.log('  [MISSING]'); continue; }
  const src = fs.readFileSync(p, 'utf8');
  console.log('  lines: ' + src.split(/\r?\n/).length + '   eol: ' + (src.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF'));

  // Every BackHandler registration plus 25 lines of context
  dumpRegion('BackHandler.addEventListener (+25 lines context)',
    src, /BackHandler\.addEventListener/, 2, 25);

  // Every router.back / router.replace call
  dumpRegion('router.back / router.replace',
    src, /\brouter\.(back|replace)\s*\(/, 0, 2);

  // handleBack function (on-screen back)
  dumpRegion('handleBack / onBackPress definitions',
    src, /\b(const|function|async)\s+(handleBack|onBackPress)\b/, 0, 8);

  // V-series patch markers actually present in this file
  dumpRegion('PATCH_V* markers present',
    src, /PATCH_V\d+/, 0, 0);

  // react-native imports
  dumpRegion('react-native import (to confirm BackHandler is imported)',
    src, /from\s+['"]react-native['"]/, 0, 0);
}

console.log('\n# done.');
