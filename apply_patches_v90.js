/**
 * apply_patches_v90.js — reset v89 + minimal up-snap fix
 * ========================================================
 * This script:
 *   1. Restores discover.tsx from the most recent .bak.v89.* backup
 *      (undoes everything v89 changed → back to v88 baseline, which
 *      was responsive and rendered correctly, but had the up-snap
 *      stuck-at-75% bug).
 *   2. Applies ONLY this small change to the outer FlatList:
 *        + contentContainerStyle={{ paddingBottom: height }}
 *        + overScrollMode="never"
 *        + bounces={false}
 *      No render-window changes. No handler changes. No styling
 *      changes. This is the SMALLEST possible patch that addresses
 *      the up-snap and bottom-overscroll issues.
 *
 * Hold-to-fly is intentionally NOT in this patch — it'll come in a
 * follow-up once this is verified, so we never break the screen again.
 *
 * Run from project root on Windows:
 *   node apply_patches_v90.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v90] FATAL:', msg); process.exit(1); }

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

const dir = path.dirname(file);
const baseName = path.basename(file);

// ─── 1. Restore from most recent v89 backup ──────────────────────────
const baks = fs.readdirSync(dir)
  .filter(n => n.startsWith(baseName + '.bak.v89.'))
  .map(n => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);

let src;
if (baks.length > 0) {
  const latest = baks[0];
  // Save current broken state for forensics, then restore.
  const broken = file + '.bak.broken_v89.' + Date.now();
  fs.writeFileSync(broken, fs.readFileSync(file, 'utf8'));
  src = fs.readFileSync(latest.full, 'utf8');
  fs.writeFileSync(file, src);
  console.log('[v90]   ok restored from', latest.name);
  console.log('[v90]   (saved broken state to ' + path.basename(broken) + ')');
} else {
  // No v89 backup — current file is presumably already at v88 baseline.
  src = fs.readFileSync(file, 'utf8');
  console.log('[v90]   no .bak.v89.* found; treating current file as v88 baseline.');
}

// ─── 2. Apply the minimal additive patch ─────────────────────────────
const MARKER = '/* V90_MIN_PATCH */';
if (src.includes(MARKER)) {
  console.log('[v90] minimal patch already present. Done.');
  process.exit(0);
}

const useCRLF = src.includes('\r\n');
const eol = useCRLF ? '\r\n' : '\n';

// Anchor on the v88 FlatList opening — three exact lines.
const anchor =
  '          <FlatList' + eol +
  '            ref={flatListRef}' + eol +
  '            style={styles.scrollView}' + eol +
  '            data={flatRowsV54}';

const injected =
  '          <FlatList' + eol +
  '            ref={flatListRef}' + eol +
  '            style={styles.scrollView}' + eol +
  '            contentContainerStyle={{ paddingBottom: height }} ' + MARKER + eol +
  '            overScrollMode="never"' + eol +
  '            bounces={false}' + eol +
  '            data={flatRowsV54}';

if (!src.includes(anchor)) fail('FlatList anchor not found verbatim (expected v88 baseline).');

src = src.replace(anchor, injected);
fs.writeFileSync(file, src);

console.log('[v90]   ok added contentContainerStyle paddingBottom + overScrollMode + bounces.');
console.log('');
console.log('[v90] OK done.');
console.log('');
console.log('[v90] Clear caches + rebuild:');
console.log('[v90]   del /q frontend\\android\\app\\src\\main\\assets\\index.android.bundle 2>nul');
console.log('[v90]   rmdir /s /q frontend\\android\\app\\build 2>nul');
console.log('[v90]   rmdir /s /q frontend\\node_modules\\.cache 2>nul');
console.log('');
console.log('[v90] Expected behavior on Firestick:');
console.log('[v90]   * Down-snap (already works) keeps working.');
console.log('[v90]   * Up-snap from bottom rows lands at the top (no more 75% stop).');
console.log('[v90]   * Pressing D-pad past last row no longer overscrolls.');
console.log('[v90]   * Discover screen renders normally (no v89 lag/blank).');
