// =============================================================================
// PATCH v215 — Poster registry key uniqueness for non-IMDB addons
//
// ROOT CAUSE of JerkTank / PornTube duplicate posters:
//
//   src/components/ContentCard.tsx exposes v160RegisterPoster /
//   v160SubscribePoster / v160GetPoster which dedupe poster URLs per
//   "canonical" id.  The canonical id is computed as:
//
//       const key = String(imdbId).split(':')[0];
//
//   For IMDB ids ("tt1234:1:5") this correctly groups every episode of a
//   series under "tt1234" so the row paints one shared poster.
//
//   For CUSTOM addon ids ("jerktank:1", "jerktank:2", "porndb:abc")
//   split(':')[0] collapses every item in the row to ONE key ("jerktank"
//   or "porndb") so the FIRST registered poster wins for the whole row,
//   producing a wall of identical thumbnails.
//
// FIX: only collapse-by-prefix for true IMDB ids (^tt\d+). All other ids
// stay UNIQUE and each card paints the addon-supplied poster verbatim.
//
// This is a FRONTEND patch — APK rebuild + sideload required.
// CRLF-safe. Idempotent.
//
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v215_poster_key_uniqueness.js -o v215.js
//   node v215.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const F = path.join(process.cwd(), 'src/components/ContentCard.tsx');
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

if (work.includes('// v215 poster key uniqueness')) {
  console.log('[noop] already applied.');
  process.exit(0);
}

// 1) Inject the helper just before the v160RegisterPoster declaration.
//    Locate the registry object line as the anchor.
const anchor = 'const _v160PosterRegistry: Record<string, string> = {};';
if (!work.includes(anchor)) {
  console.log('[ERR] registry anchor not found — file structure changed.');
  process.exit(1);
}

const helper = `const _v160PosterRegistry: Record<string, string> = {};
// v215 poster key uniqueness — only collapse IMDB-style ids ("tt1234:1:5")
// to the series prefix ("tt1234").  Custom addon ids like "jerktank:1" or
// "porndb:abc" are kept UNIQUE so each card in the row paints its own
// addon-supplied poster instead of all sharing the first-rendered poster.
function _v215PosterKey(id: string | undefined | null): string {
  if (!id) return '';
  const s = String(id);
  if (/^tt\\d+/.test(s)) return s.split(':')[0];
  return s;
}`;

work = work.replace(anchor, helper);

// 2) Replace all 3 occurrences of the broken key extraction with the helper.
//    Match with leading whitespace so we replace cleanly without leaking.
const broken = `String(imdbId).split(':')[0]`;
const fixed  = `_v215PosterKey(imdbId)`;

const matches = work.split(broken).length - 1;
if (matches < 1) {
  console.log('[ERR] no occurrences of the broken key extraction found — file structure changed.');
  process.exit(1);
}
work = work.split(broken).join(fixed);
console.log('[info] replaced ' + matches + ' occurrence(s) of the broken key extraction.');

if (work === normalize(before)) {
  console.log('[noop] nothing changed.');
  process.exit(0);
}

fs.writeFileSync(F + '.bak_v215', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');

console.log('[ok]   src/components/ContentCard.tsx patched');
console.log('       backup at src/components/ContentCard.tsx.bak_v215');
console.log('');
console.log('Rebuild APK + sideload.  Expected:');
console.log('  • JerkTank / PornTube / other custom-id addon rows now show');
console.log('    distinct posters per card (whatever the addon supplied).');
console.log('  • Cinemeta / Torrentio / IMDB-id surfaces unchanged — series');
console.log('    still share one canonical poster across all episodes.');
console.log('');
console.log('Rollback:');
console.log('  copy /Y "src\\\\components\\\\ContentCard.tsx.bak_v215" "src\\\\components\\\\ContentCard.tsx"');
