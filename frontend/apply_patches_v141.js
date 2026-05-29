/* eslint-disable */
// apply_patches_v141_cached_first_seeds_matter.js
//
// HARD CACHED-FIRST PARTITION + SEEDS THAT ACTUALLY MATTER.
//
// Your "Stream timed out. The source may have too few peers" loop was
// caused by id.tsx's stream sort:
//
//   const QUALITY_PTS = { '4K': 800, '1080p': 600, ... };
//   if (stream.url) s += 50;                      // cached: +50 only
//   if (sd > 0) s += Math.min(Math.log10(sd)*5, 20);  // seeds: max +20
//
// 4K-uncached-1-peer (score 1875) beat 1080p-cached-10000-peers (score
// 1725) every time.  Your Play button picked a 4K season pack with
// almost no seeders, Premiumize couldn't cache it fast enough, and the
// player burned 30s trying each stream in the list before giving up.
//
// v141 changes:
//   1. HARD PARTITION by stream.url: every cached stream sorts above
//      every uncached stream.  Within each group, score-based sort
//      decides quality/seeds.  Cached PM URL = instant playback,
//      always tried first.
//   2. SEEDS WEIGHTED PROPERLY: was +20 ceiling, now +0 to +240.
//      For two cached streams of same quality, the one with more
//      seeders wins (relevant when PM has to re-resolve).
//   3. Diagnostic log on the chosen #1 stream so we can see in logcat
//      exactly what got picked and why.
//
// Pairs with v137/v140 backend (which expose more cached streams in
// the first 3s of /api/streams).
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v141_cached_first_seeds_matter.js -o apply_patches_v141.js && node apply_patches_v141.js
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
if (!idPath) {
  console.error('[v141] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v141';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v141] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// F1 — replace cache + seeds scoring lines.
// ---------------------------------------------------------------------------
const F1_OLD = `    if (stream.url) s += 50;
    const sd = info.seeders || 0;
    if (sd > 0) s += Math.min(Math.log10(sd) * 5, 20);
    return s;
  };
  parsed.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));`;

const F1_NEW = `    /* v141-cached-first-seeds-matter */
    // Cached / direct URL boost is now a partition gate — see below.  Keep
    // a small intra-bucket nudge so tied cached streams prefer ones with
    // a working URL set.
    if (stream.url) s += 50;
    const sd = info.seeders || 0;
    // v141: was Math.min(log10(sd)*5, 20) — capped at +20, basically noise.
    // Now scales up to +240 so seeders meaningfully break quality ties.
    if (sd > 0) s += Math.min(Math.log10(sd + 1) * 80, 240);
    return s;
  };
  // v141: HARD partition — every CACHED stream (stream.url present) sorts
  // above every UNCACHED stream, regardless of quality/score.  Inside each
  // bucket the score sort (cached-first, then quality, then seeders) wins.
  const _v141_cached = parsed.filter((p) => !!p.stream.url);
  const _v141_uncached = parsed.filter((p) => !p.stream.url);
  _v141_cached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
  _v141_uncached.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));
  parsed.length = 0;
  for (const p of _v141_cached) parsed.push(p);
  for (const p of _v141_uncached) parsed.push(p);
  if (parsed.length > 0) {
    const _top = parsed[0];
    const _topInfo = _top.info;
    console.log('[SORT v141] picked top:', _topInfo.quality || '?', 'cached=' + (!!_top.stream.url), 'seeders=' + (_topInfo.seeders || 0), 'lang=' + (_topInfo.language || '?'), '| cached_n=' + _v141_cached.length, 'uncached_n=' + _v141_uncached.length);
  }`;

applyOnce(
  'F1: cached-first hard partition + seeds weighted +0..+240',
  '/* v141-cached-first-seeds-matter */',
  F1_OLD,
  F1_NEW
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v141] === PATCH REPORT =====================================');
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
console.log('[v141] =====================================================');

if (failed.length) { console.error('[v141] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v141] No changes.'); process.exit(0); }
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v141] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v141] Done. Rebuild + side-load.');
