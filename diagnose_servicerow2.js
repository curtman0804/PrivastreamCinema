/* eslint-disable */
// diagnose_servicerow2.js — Search the project tree for ServiceRow.tsx
// and dump it. Always prints output (no silent failures).

const fs = require('fs');
const path = require('path');

console.log('=== diagnose_servicerow2 — cwd: ' + process.cwd() + ' ===\n');

// 1) List frontend/src/components if it exists
const tryDirs = [
  path.join('frontend', 'src', 'components'),
  path.join('frontend', 'components'),
  path.join('frontend', 'src'),
  path.join('src', 'components'),
  'frontend',
];
for (const d of tryDirs) {
  if (fs.existsSync(d)) {
    console.log('[dir exists] ' + d);
    try {
      const items = fs.readdirSync(d, { withFileTypes: true });
      items.slice(0, 50).forEach(it => console.log('    ' + (it.isDirectory() ? '[D] ' : '    ') + it.name));
    } catch (e) { console.log('    (cannot read: ' + e.message + ')'); }
  } else {
    console.log('[missing  ] ' + d);
  }
}

// 2) Recursive search for ServiceRow.tsx and related files
console.log('\n=== Searching for ServiceRow.tsx, ContentCard.tsx, discover.tsx ===');
const targets = ['ServiceRow.tsx', 'ServiceRow.jsx', 'ContentCard.tsx', 'discover.tsx'];
const hits = {};
targets.forEach(t => hits[t] = []);

function walk(dir, depth) {
  if (depth > 6) return;
  if (dir.includes('node_modules') || dir.includes('.git') || dir.includes('android') || dir.includes('ios') || dir.includes('build') || dir.includes('.expo')) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, depth + 1);
    else if (targets.includes(it.name)) {
      hits[it.name].push(p);
    }
  }
}
walk('.', 0);
targets.forEach(t => {
  console.log('\n[' + t + '] ' + hits[t].length + ' match(es):');
  hits[t].forEach(p => {
    const sz = fs.statSync(p).size;
    console.log('    ' + p + '   (' + sz + ' bytes)');
  });
});

// 3) Dump the first ServiceRow.tsx found
const sr = hits['ServiceRow.tsx'][0] || hits['ServiceRow.jsx'][0];
if (!sr) {
  console.log('\n[FAIL] ServiceRow.tsx not found anywhere. Tell me what your component file is called for the row.');
  process.exit(0);
}

console.log('\n=== DUMPING ' + sr + ' ===\n');
const src = fs.readFileSync(sr, 'utf8');
const lines = src.split(/\r?\n/);
console.log('(' + lines.length + ' lines, ' + src.length + ' bytes)\n');
lines.forEach((ln, i) => {
  const num = String(i + 1).padStart(4, ' ');
  console.log(num + ' | ' + ln);
});

console.log('\n=== END DUMP ===');
