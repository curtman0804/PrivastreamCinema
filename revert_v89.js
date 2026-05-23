/**
 * revert_v89.js — restore discover.tsx from the v89 backup
 * =========================================================
 * Use this if v89 made things worse (blank screen / lag).
 * Restores from the most recent .bak.v89.* file next to
 * discover.tsx.
 *
 * Run from project root on Windows:
 *   node revert_v89.js
 */

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) { console.error('[revert_v89] FATAL: discover.tsx not found.'); process.exit(1); }

const dir = path.dirname(file);
const baseName = path.basename(file);

const baks = fs.readdirSync(dir)
  .filter(n => n.startsWith(baseName + '.bak.v89.'))
  .map(n => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

if (baks.length === 0) {
  console.error('[revert_v89] FATAL: no .bak.v89.* backup found next to discover.tsx.');
  console.error('[revert_v89] If you have an older .bak.v88.* you can restore that manually.');
  process.exit(1);
}

const latest = baks[0];
console.log('[revert_v89] Found backup:', latest.name);

// Save a safety copy of the current (broken) state before overwriting.
const safety = file + '.bak.broken_v89.' + Date.now();
fs.writeFileSync(safety, fs.readFileSync(file, 'utf8'));
console.log('[revert_v89] Current state saved to:', safety);

fs.writeFileSync(file, fs.readFileSync(latest.full, 'utf8'));
console.log('[revert_v89] OK restored discover.tsx from', latest.name);

console.log('');
console.log('[revert_v89] Clear caches + rebuild:');
console.log('[revert_v89]   del /q frontend\\android\\app\\src\\main\\assets\\index.android.bundle 2>nul');
console.log('[revert_v89]   rmdir /s /q frontend\\android\\app\\build 2>nul');
console.log('[revert_v89]   rmdir /s /q frontend\\node_modules\\.cache 2>nul');
