/* eslint-disable */
// apply_patches_v131_normalize_infohash.js
//
// v131 frontend — Fixes the "shit quality" bug found in logcat.
//
// Logcat showed:
//   [DETAILS v130] got 23 streams, 2 upgrade candidates
//   (no "[DETAILS v129] preferring upgrade candidate" line)
//
// Meaning v129 P2's filter `s?.upgrade_candidate && s?.infoHash` returned
// 0 even though there ARE 2 upgrade candidates.  Cause: the upgrade
// candidates use `info_hash` (snake_case) instead of `infoHash` in some
// cases.  Two fixes:
//
//   P1 — Drop the `s?.infoHash` requirement in the upgrade-candidate filter
//        in id.tsx (the v130 log already proves the upgrade flag is enough).
//
//   P2 — Normalize: when handleStreamSelect picks a stream, if it lacks
//        `infoHash` but has `info_hash`, copy it across.  Also do this in
//        the body of /api/stream/start_and_wait so backend gets the field
//        it expects.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v131_normalize_infohash.js -o apply_patches_v131.js && node apply_patches_v131.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!idPath) { console.error('[v131] FATAL: id.tsx not found'); process.exit(1); }

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v131';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v131] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, pattern, replacement) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const gFlags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const gPattern = new RegExp(pattern.source, gFlags);
  const all = [];
  let m;
  while ((m = gPattern.exec(src)) !== null) {
    all.push(m[0]);
    if (gPattern.lastIndex === m.index) gPattern.lastIndex++;
  }
  if (all.length === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (all.length > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: all.length }); return false; }
  const before = src.length;
  const replStr = typeof replacement === 'function' ? replacement(NL) : replacement;
  src = src.replace(pattern, () => replStr);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// P1 — drop the infoHash requirement and normalize info_hash -> infoHash in
//      the upgrade-candidate filter / pick block.
// ---------------------------------------------------------------------------
applyOnce(
  'P1: drop infoHash check + normalize info_hash on the picked upgrade',
  '/* v131-normalize-upgrade */',
  /const upgradeCandidates = pool\.filter\(\(s: any\) => s\?\.upgrade_candidate && s\?\.infoHash\);/,
  (NL) =>
    `/* v131-normalize-upgrade */${NL}                      // v131: don't require infoHash on filter (some streams from${NL}                      // aggregation use info_hash snake_case).  We normalize the${NL}                      // chosen stream's infoHash field a few lines below instead.${NL}                      const upgradeCandidates = pool.filter((s: any) => s?.upgrade_candidate && (s?.infoHash || s?.info_hash));`
);

applyOnce(
  'P2: normalize picked stream infoHash before handleStreamSelect',
  '/* v131-normalize-pick */',
  /if \(upgradeSorted\[0\]\) \{\s*console\.log\('\[DETAILS v129\] preferring upgrade candidate:', upgradeSorted\[0\]\.name \|\| ''\);\s*picked = upgradeSorted\[0\];\s*\}/,
  (NL) =>
    `if (upgradeSorted[0]) {${NL}                          /* v131-normalize-pick */${NL}                          picked = upgradeSorted[0];${NL}                          // Normalize: some streams come back with info_hash (snake_case).${NL}                          // Copy to infoHash so downstream code (handleStreamSelect, start_and_wait) works.${NL}                          if (!picked.infoHash && (picked as any).info_hash) {${NL}                            picked = { ...picked, infoHash: (picked as any).info_hash } as any;${NL}                          }${NL}                          console.log('[DETAILS v129/v131] preferring upgrade candidate:', picked.name || '', 'hash=', String(picked.infoHash || '').slice(0, 8));${NL}                        }`
);

// ---------------------------------------------------------------------------
// P3 — also normalize at the top of handleStreamSelect's race block, so any
// stream entering with info_hash gets infoHash copied across before we
// fetch start_and_wait.
// ---------------------------------------------------------------------------
applyOnce(
  'P3: normalize info_hash inside handleStreamSelect race block',
  '/* v131-handle-normalize */',
  /\/\* v129-handle-upgrade \*\/[\s\S]*?if \(\(stream as any\)\.upgrade_candidate && stream\.infoHash && !stream\.url\) \{/,
  (NL) =>
    `/* v129-handle-upgrade */${NL}    /* v131-handle-normalize */${NL}    // Normalize info_hash (snake) -> infoHash (camel) up-front so the${NL}    // upgrade-race condition + start_and_wait body both see the field.${NL}    if ((stream as any).info_hash && !stream.infoHash) {${NL}      stream = { ...stream, infoHash: (stream as any).info_hash } as any;${NL}    }${NL}    if ((stream as any).upgrade_candidate && stream.infoHash && !stream.url) {`
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v131] === PATCH REPORT =====================================');
for (const r of reports) {
  let tag;
  if (r.status === 'OK') tag = 'OK  ';
  else if (r.status === 'SKIP_IDEMPOTENT') tag = 'SKIP';
  else if (r.status === 'NOT_FOUND') tag = 'MISS';
  else tag = 'AMBI';
  let extras = '';
  if (r.delta != null) extras += `  (Δ ${r.delta} chars)`;
  if (r.count != null) extras += `  (×${r.count})`;
  console.log(`  [${tag}] ${r.label}${extras}`);
}
console.log('[v131] =====================================================');

if (failed.length) { console.error('[v131] One or more patches failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v131] No changes.'); process.exit(0); }
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v131] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v131] Done. Rebuild and side-load.');
