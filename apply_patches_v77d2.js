/**
 * apply_patches_v77d2.js
 * ======================
 * Robust version of v77d that uses regex matching to find the type
 * filter line regardless of whitespace, quote style, or operator order.
 *
 * Matches any of:
 *   if (!item || item.type !== 'movie') return;
 *   if (!item || item.type !== "movie") return;
 *   if (item.type !== 'movie') return;
 *   if (item && item.type !== 'movie') return;
 *
 * Replaces it with an opt-OUT filter that lets all items through
 * EXCEPT known non-movie types (series, tv, channel, episode).
 *
 * Idempotent.
 *
 * Run from project root:
 *   node apply_patches_v77d2.js
 */
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('src', 'components', 'ContentCard.tsx'),
];
const MARKER = '/* V77D2_TYPE_FILTER */';

function fail(msg) { console.error('[v77d2] FATAL:', msg); process.exit(1); }

const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('Could not find ContentCard.tsx');

let src = fs.readFileSync(file, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v77d2] Filter already relaxed — nothing to do.');
  process.exit(0);
}

// Flexible regex: matches the type filter line with any whitespace, quote
// style, and optional `!item ||` prefix.
const RE = /if\s*\(\s*(?:!item\s*\|\|\s*)?(?:item\s*&&\s*)?item\.type\s*!==\s*['"]movie['"]\s*\)\s*return\s*;/;

const m = src.match(RE);
if (!m) {
  // As a fallback, show the area around the useEffect so user can paste it
  const idx = src.indexOf('_v77bRequestReleaseStatus');
  if (idx === -1) {
    fail('Neither the type filter nor the v77b batcher call were found. Did v77b apply at all?');
  }
  const ctx = src.slice(Math.max(0, idx - 400), idx + 100);
  console.error('[v77d2] Could not match the filter regex. Here is the context around the useEffect:');
  console.error('---');
  console.error(ctx);
  console.error('---');
  console.error('Please paste the above block to the agent.');
  process.exit(2);
}

console.log('[v77d2] Found existing filter:', JSON.stringify(m[0]));

const backup = file + '.bak.v77d2.' + Date.now();
fs.writeFileSync(backup, src);
console.log('[v77d2] Backup:', backup);

const REPLACEMENT =
  "if (!item) return; " + MARKER + " " +
  "if (item.type === 'series' || item.type === 'tv' || item.type === 'channel' || item.type === 'episode') return;";

src = src.replace(RE, REPLACEMENT);
fs.writeFileSync(file, src);

console.log('[v77d2] ✅ Type filter relaxed to opt-out.');
console.log('[v77d2]    File:', file);
console.log('[v77d2]    Rebuild your APK and re-test.');
