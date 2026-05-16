/* eslint-disable */
// diagnose_discover_layout.js — READ-ONLY. Map out the ScrollView in discover.tsx
// so V42 can replace it with a vertical FlatList while preserving every section
// (Continue Watching, addons button, refresh control, rows, etc.) intact.
//
// Run from project root:  node diagnose_discover_layout.js > diag_discover.txt
// Then paste diag_discover.txt back.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'app', '(tabs)', 'discover.tsx');

if (!fs.existsSync(F)) { console.log('[MISSING] ' + F); process.exit(1); }

const src = fs.readFileSync(F, 'utf8');
const lines = src.split(/\r?\n/);

console.log('# diagnose_discover_layout.js — read-only');
console.log('# generated: ' + new Date().toISOString());
console.log('# file: ' + F + '   lines: ' + lines.length);

function header(t) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + t);
  console.log('='.repeat(70));
}

function show(label, from, to) {
  console.log('\n  -- ' + label + '  (L' + from + '–L' + to + ') --');
  const a = Math.max(0, from - 1);
  const b = Math.min(lines.length - 1, to - 1);
  for (let i = a; i <= b; i++) {
    console.log('  L' + (i + 1).toString().padStart(4) + ': ' + lines[i]);
  }
}

// =====================================================================
header('imports + top of TabScreen');
show('imports & state setup', 1, 75);

// =====================================================================
header('main return body — entire ScrollView + children');
// Find the outer ScrollView opening tag
const svOpenIdx = lines.findIndex(l => /<ScrollView\b/.test(l));
const svCloseIdx = svOpenIdx >= 0 ? lines.findIndex((l, i) => i > svOpenIdx && /<\/ScrollView>/.test(l)) : -1;

if (svOpenIdx === -1) {
  console.log('  [WARN] could not find <ScrollView> opening tag — searching for ScrollView usage');
  // fallback: show lines around any "ScrollView" mention
  const occ = [];
  lines.forEach((l, i) => { if (/ScrollView/.test(l)) occ.push(i); });
  for (const i of occ.slice(0, 10)) {
    console.log('    [L' + (i + 1) + '] ' + lines[i]);
  }
} else {
  console.log('  <ScrollView> opens at L' + (svOpenIdx + 1));
  console.log('  </ScrollView> closes at L' + (svCloseIdx + 1));
  show('FULL ScrollView body', svOpenIdx + 1, svCloseIdx + 1);
}

// =====================================================================
header('any ListHeaderComponent / ListFooterComponent / RefreshControl already in file');
let refsHit = false;
lines.forEach((l, i) => {
  if (/(ListHeaderComponent|ListFooterComponent|RefreshControl|<FlatList\b|<FlashList\b)/.test(l)) {
    if (!refsHit) refsHit = true;
    console.log('  L' + (i + 1).toString().padStart(4) + ': ' + l);
  }
});
if (!refsHit) console.log('  (none)');

// =====================================================================
header('outer container structure (SafeAreaView / View / etc. around ScrollView)');
if (svOpenIdx > 0) {
  // Show 20 lines above ScrollView opening to see wrappers
  show('20 lines above <ScrollView>', Math.max(1, svOpenIdx - 19), svOpenIdx + 1);
}

console.log('\n# done.');
