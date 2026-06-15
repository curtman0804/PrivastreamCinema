// =============================================================================
// PATCH v233 — Disable overly-strict client-side stream filters
//
// Backend confirmed 19 streams for Love Island.  Frontend shows 0.  The
// _v157 (wrong-title for movies) and _v161 (wrong-series-title) filters
// in app/details/[type]/[id].tsx are too strict — they fire false-
// positives on Torrentio streams that have multi-line titles with
// emojis (👤 5 💾 2.36 GB ⚙️ TorrentGalaxy).
//
// This patch makes both filters NO-OP by forcing them to return false
// (= "this stream is fine, keep it") at the top of each function.  The
// rest of the filter logic stays intact for future re-enable.
//
// Backend already filters by addon-provided id, so removing client-side
// filtering doesn't risk wrong-show streams — the addons themselves
// only return streams for the requested id.
//
// CRLF-safe.  Idempotent.  APK rebuild required.
//
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v233_disable_client_filters.js -o v233.js
//   node v233.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const F = path.join(process.cwd(), 'app/details/[type]/[id].tsx');
if (!fs.existsSync(F)) {
  console.log('[ERR] file not found: ' + F);
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const before = raw;
const usesCRLF = /\r\n/.test(raw);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(raw);

if (work.includes('// v233 client filters disabled')) {
  console.log('[noop] v233 already applied.');
  process.exit(0);
}

// Disable v157 movie filter — add early return at function start
const v157_old = 'function _v157_isWrongTitleStream(stream: any, meta: { title: string; year: string; isMovie: boolean }): boolean {';
const v157_new = `function _v157_isWrongTitleStream(stream: any, meta: { title: string; year: string; isMovie: boolean }): boolean {
  return false; // v233 client filters disabled — backend already returns only id-matched streams`;

if (work.includes(v157_old)) {
  work = work.replace(v157_old, v157_new);
  console.log('[ok]   disabled _v157_isWrongTitleStream');
} else {
  console.log('[warn] _v157 signature not found — skipping (file shape changed)');
}

// Disable v161 series filter — add early return at function start
const v161_old = 'function _v161_isWrongSeriesStream(stream: any, meta: { isSeries: boolean; seriesWords: string[] }): boolean {';
const v161_new = `function _v161_isWrongSeriesStream(stream: any, meta: { isSeries: boolean; seriesWords: string[] }): boolean {
  return false; // v233 client filters disabled — backend already returns only id-matched streams`;

if (work.includes(v161_old)) {
  work = work.replace(v161_old, v161_new);
  console.log('[ok]   disabled _v161_isWrongSeriesStream');
} else {
  console.log('[warn] _v161 signature not found — skipping (file shape changed)');
}

if (work === normalize(before)) {
  console.log('[ERR] nothing changed — both filter functions missing?');
  process.exit(1);
}

fs.writeFileSync(F + '.bak_v233', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/details/[type]/[id].tsx patched');
console.log('       backup at app/details/[type]/[id].tsx.bak_v233');
console.log('');
console.log('Now rebuild APK + sideload to Firestick.');
console.log('After install, Love Island should show 19 stream cards.');
