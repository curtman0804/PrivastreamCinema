/* eslint-disable */
// diagnose_details2.js — Search the app folder for the details screen.
const fs = require('fs');
const path = require('path');

console.log('=== diagnose_details2 — cwd: ' + process.cwd() + ' ===');

// List frontend/app structure
const appDir = path.join('frontend', 'app');
console.log('\n=== frontend/app tree (depth 4) ===');
function walk(dir, depth, prefix) {
  if (depth > 4) return;
  if (!fs.existsSync(dir)) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  items.forEach(it => {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) {
      console.log(prefix + '[D] ' + it.name + '/');
      walk(p, depth + 1, prefix + '    ');
    } else {
      const sz = fs.statSync(p).size;
      console.log(prefix + '    ' + it.name + '  (' + sz + ' bytes)');
    }
  });
}
walk(appDir, 0, '');

// Recursive search for any file with "details" in name
console.log('\n=== Recursive search for details*.tsx / [id]*.tsx ===');
const hits = [];
function find(dir, depth) {
  if (depth > 6) return;
  if (dir.includes('node_modules') || dir.includes('.git') || dir.includes('android') || dir.includes('ios') || dir.includes('.expo') || dir.includes('build')) return;
  let items;
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) find(p, depth + 1);
    else if (/details|detail|\[id\]/i.test(it.name) && /\.(tsx|jsx|ts|js)$/.test(it.name)) {
      hits.push(p);
    }
  }
}
find('.', 0);
hits.forEach(p => console.log('  ' + p + '  (' + fs.statSync(p).size + ' bytes)'));

// Dump the first/largest match
if (hits.length > 0) {
  // Sort by size descending
  hits.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
  const target = hits[0];
  console.log('\n=== DUMPING ' + target + ' ===\n');
  const src = fs.readFileSync(target, 'utf8');
  const lines = src.split(/\r?\n/);
  console.log('(' + lines.length + ' lines, ' + src.length + ' bytes)\n');
  lines.forEach((ln, i) => console.log(String(i + 1).padStart(4, ' ') + ' | ' + ln));
}

// Also search for navigation to /details
console.log('\n=== Search for navigation to details (router.push) ===');
function grepFiles(rootDir, pattern) {
  const re = new RegExp(pattern);
  const out = [];
  function walk2(dir, depth) {
    if (depth > 6) return;
    if (dir.includes('node_modules') || dir.includes('.git') || dir.includes('.expo')) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) walk2(p, depth + 1);
      else if (/\.(tsx|jsx|ts|js)$/.test(it.name)) {
        try {
          const src = fs.readFileSync(p, 'utf8');
          const lines = src.split(/\r?\n/);
          lines.forEach((ln, i) => { if (re.test(ln)) out.push(p + ':' + (i + 1) + ': ' + ln.trim()); });
        } catch {}
      }
    }
  }
  walk2(rootDir, 0);
  return out;
}
const navHits = grepFiles('frontend', '/details|details/\\[');
navHits.slice(0, 30).forEach(h => console.log('  ' + h));
