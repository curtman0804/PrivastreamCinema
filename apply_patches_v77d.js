/**
 * apply_patches_v77d.js
 * =====================
 * Companion to v77b/v77c. Relaxes the `item.type === 'movie'` filter
 * inside ContentCard's release-status useEffect to an opt-OUT check.
 *
 * Reason: items in your Discover feed don't carry an explicit
 * `type: 'movie'` field, so the original filter was bailing for every
 * card and no /api/movie/release_status requests were ever sent.
 *
 * After this: any item with an IMDb ID starting with 'tt' is checked,
 * EXCEPT for known non-movie types (series, tv, channel, episode).
 * The backend's TMDB lookup naturally returns "none" for non-movies.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v77d.js
 */
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('src', 'components', 'ContentCard.tsx'),
];
const MARKER_V77D = '/* V77D_TYPE_FILTER */';

function fail(msg) { console.error('[v77d] FATAL:', msg); process.exit(1); }

const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('Could not find ContentCard.tsx');

let src = fs.readFileSync(file, 'utf8');

if (src.includes(MARKER_V77D)) {
  console.log('[v77d] Filter already relaxed — nothing to do.');
  process.exit(0);
}

// Old filter line written by v77b
const OLD = "if (!item || item.type !== 'movie') return;";
if (!src.includes(OLD)) {
  fail('Old v77b filter line not found. Did you apply v77b? Or has the file been edited?');
}

const NEW =
  "if (!item) return; " + MARKER_V77D + " " +
  "if (item.type === 'series' || item.type === 'tv' || item.type === 'channel' || item.type === 'episode') return;";

const backup = file + '.bak.v77d.' + Date.now();
fs.writeFileSync(backup, src);
console.log('[v77d] Backup:', backup);

src = src.replace(OLD, NEW);
fs.writeFileSync(file, src);

console.log('[v77d] ✅ Type filter relaxed (opt-out instead of opt-in).');
console.log('[v77d]    File:', file);
console.log('[v77d]    Now any IMDb-ID-bearing card will be checked, except series/tv/channel/episode.');
console.log('[v77d]    Rebuild your APK and re-test.');
