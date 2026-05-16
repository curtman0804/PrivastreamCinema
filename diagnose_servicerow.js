/* eslint-disable */
// diagnose_servicerow.js — Read-only. Dumps ServiceRow.tsx so V43 anchors are exact.

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'components', 'ServiceRow.tsx');
if (!fs.existsSync(F)) { console.log('[FAIL] not found: ' + F); process.exit(1); }

const src = fs.readFileSync(F, 'utf8');
const lines = src.split(/\r?\n/);

console.log('=== ' + F + ' (' + lines.length + ' lines, ' + src.length + ' bytes) ===\n');

// Print full file with line numbers
lines.forEach((ln, i) => {
  const num = String(i + 1).padStart(4, ' ');
  console.log(num + ' | ' + ln);
});

console.log('\n=== Quick scans ===');
const scan = (label, re) => {
  const hits = [];
  lines.forEach((ln, i) => { if (re.test(ln)) hits.push((i + 1) + ': ' + ln.trim()); });
  console.log('\n[' + label + '] ' + hits.length + ' hit(s)');
  hits.forEach(h => console.log('  ' + h));
};

scan('imports of react-native', /from ['"]react-native['"]/);
scan('FlatList usage',           /<FlatList\b/);
scan('ContentCard usage',        /<ContentCard\b/);
scan('useState declarations',    /useState[<\(]/);
scan('useEffect declarations',   /useEffect\b/);
scan('memo / React.memo',        /\bmemo\(/);
scan('export default',           /^export\s+default/);
scan('renderItem / keyExtractor',/renderItem|keyExtractor/);
scan('rowIndex prop',            /\browIndex\b/);
scan('InteractionManager',       /InteractionManager/);
