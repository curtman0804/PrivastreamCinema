// diag_v124i_back.js
// Dumps every BackHandler / hardwareBackPress block in player.tsx and
// details/[type]/[id].tsx so we can see what's actually installed.
// Run from FRONTEND root.

const fs = require('fs');
const path = require('path');

function dump(label, file) {
  if (!fs.existsSync(file)) { console.log(`MISSING: ${file}`); return; }
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  console.log('\n========================================');
  console.log(`FILE: ${file}`);
  console.log(`size: ${src.length} bytes, lines: ${lines.length}`);
  console.log('markers:');
  ['v124b-back-contextual','v124c-back-contextual','v124f','v124f2','v124g-back-order','v124h-back-order'].forEach(m => {
    console.log(`  ${m}: ${src.includes(m)}`);
  });
  console.log(`  fromPlayer destructure: ${src.includes('fromPlayer: fromPlayerParam')}`);
  console.log(`  autoPlay destructure: ${src.includes('autoPlay: autoPlayParam')}`);
  console.log('--- BackHandler / hardwareBackPress hits ---');
  const seen = new Set();
  lines.forEach((line, i) => {
    if (/BackHandler|hardwareBackPress|handleBack\s*=/.test(line)) {
      const start = Math.max(0, i - 4);
      const end = Math.min(lines.length, i + 14);
      const key = `${start}-${end}`;
      if (seen.has(key)) return;
      seen.add(key);
      console.log(`\n[${label}] lines ${start+1}-${end}:`);
      for (let j = start; j < end; j++) {
        console.log(`${String(j+1).padStart(4)}: ${lines[j]}`);
      }
    }
  });
}

dump('PLAYER', path.join('app', 'player.tsx'));
dump('DETAILS', path.join('app', 'details', '[type]', '[id].tsx'));
console.log('\n[diag_v124i] done.');
