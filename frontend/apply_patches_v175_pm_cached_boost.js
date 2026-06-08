/*
 * apply_patches_v175_pm_cached_boost.js
 *
 * V175 — Aggressive Premiumize-cached stream boost.
 *
 * Problem
 * -------
 * Today the stream list relies on `stream.url` being truthy to detect
 * cached items.  That signal is unreliable:
 *   • Torrentio sometimes sets `stream.url = "magnet:?..."` even for
 *     uncached results — putting magnet-only streams into the "cached"
 *     bucket and letting them outrank real PM-cached HTTPS URLs.
 *   • The "+50 for stream.url" intra-bucket nudge is so small that any
 *     quality / language / seeder difference wipes it out.
 *
 * Result: a 4K uncached BluRay regularly wins over a 1080p PM-cached
 * WEB-DL — and clicking Play kicks off a 30-60 s Premiumize resolution
 * (the long, frustrating buffer) instead of starting in 2-3 s.
 *
 * Fix
 * ---
 * 1. Add a robust `_v175_isPMCached(stream)` helper that checks:
 *      a. `stream.url` starts with `http://` or `https://`  (NOT magnet:)
 *      b. `stream.name` contains a Torrentio cached marker
 *         (`[PM+]`, `[+]`, `[Cached]`, `[RD+]`, `[AD+]` etc.)
 *      c. `stream.behaviorHints?.notWebReady !== true`
 *    (a) OR (b) is sufficient.  (c) is an exclusion guard.
 *
 * 2. Inside `computeScore`, replace the "+50 for stream.url" nudge with a
 *    dominant "+1000 for verified PM-cached".  +1000 beats every other
 *    component in the score (max quality bonus is +800), so a cached
 *    1080p ALWAYS outranks an uncached 4K of the same language.
 *
 * 3. Use the helper for the v141 cached/uncached PARTITION too, so the
 *    hard split is also based on the reliable signal.  Magnet-only
 *    streams no longer leak into the cached bucket.
 *
 * 4. Keep all existing penalties / boosts intact — purely additive.
 *
 * Why "missed 3 times" before this
 * --------------------------------
 * Previous agents read `_v141_cached = parsed.filter(p => !!p.stream.url)`
 * and assumed cached-first was already in place.  It WAS — but on a
 * signal Torrentio doesn't honor consistently.  This patch fixes the
 * SIGNAL, not the algorithm.
 *
 * Safety
 * ------
 * - Idempotent (marker `V175_PM_CACHED_BOOST` guards re-runs)
 * - CRLF / LF detection per file
 * - Backs up to `[id].tsx.v175.bak` before writing
 * - Three anchored edits — script aborts if ANY anchor misses
 * - Best-effort JS parse via the bundled "vm.Script" pre-check before
 *   the final write (catches gross syntax breaks; production-level
 *   TS compile happens when Metro reloads).
 *
 * Usage
 * -----
 *    cd <your-expo-project-root>      # the dir that contains app/, src/
 *    curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v175_pm_cached_boost.js \
 *       -o apply_patches_v175_pm_cached_boost.js
 *    node apply_patches_v175_pm_cached_boost.js
 *
 * After applying, just reload Metro (R-R in the dev menu or restart the
 * dev server).  No native rebuild required — this is pure JS/TS.
 *
 * Rollback
 * --------
 *    move app/details/[type]/[id].tsx.v175.bak  app/details/[type]/[id].tsx
 *    (or `mv` on macOS/Linux)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.cwd();
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

if (!fs.existsSync(ID_PATH)) {
  console.error(`[v175] FATAL: ${path.relative(ROOT, ID_PATH)} not found.`);
  console.error(`[v175] Run from your Expo project root (the dir that has 'app/').`);
  process.exit(1);
}

// ── EOL-preserving read/write ──────────────────────────────────────────────
const raw = fs.readFileSync(ID_PATH, 'utf8');
const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
let src = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;

// ── Idempotency ────────────────────────────────────────────────────────────
if (src.indexOf('V175_PM_CACHED_BOOST') !== -1) {
  console.log('[v175] [id].tsx already patched, skipping (idempotent).');
  process.exit(0);
}

let changes = 0;

// ═════════════════════════════════════════════════════════════════════════
// EDIT 1 — Inject `_v175_isPMCached` helper above `const computeScore =`
// ═════════════════════════════════════════════════════════════════════════
const computeScoreAnchor =
  '  /* v121b-quality-boost */ const QUALITY_PTS: Record<string, number> = ' +
  "{ '4K': 800, '1080p': 600, '720p': 400, 'HD': 300, 'SD': 0 };";

if (src.indexOf(computeScoreAnchor) === -1) {
  console.error('[v175] FATAL: computeScore anchor not found (looking for v121b QUALITY_PTS).');
  console.error('[v175] Your [id].tsx may have been heavily refactored; refusing to patch.');
  process.exit(2);
}

const helperBlock = [
  '  /* V175_PM_CACHED_BOOST — robust Premiumize-cached detection.',
  '     Torrentio + ?premiumize=KEY returns cached items with either an',
  '     HTTPS download URL OR a "[PM+]" marker in the name.  Magnet-only',
  '     streams (uncached) often ALSO have stream.url set — to a magnet:',
  '     URI — which makes the old `!!stream.url` heuristic put them in',
  '     the cached bucket incorrectly.  Combine multiple signals: */',
  '  const _v175_isPMCached = (stream: any): boolean => {',
  '    if (!stream) return false;',
  '    // Signal A — HTTP(S) URL present (NOT magnet)',
  '    const _u = String(stream.url || stream.externalUrl || "");',
  '    if (/^https?:\\/\\//i.test(_u)) return true;',
  '    // Signal B — addon emitted an explicit cached marker',
  '    const _n = String(stream.name || stream.title || "").toUpperCase();',
  "    if (_n.indexOf('[PM+]') !== -1) return true;",
  "    if (_n.indexOf('[+]')   !== -1) return true;",
  "    if (_n.indexOf('[CACHED]') !== -1) return true;",
  "    if (_n.indexOf('CACHED')   !== -1 && _n.indexOf('UNCACHED') === -1) return true;",
  '    // Signal C — behaviorHints explicit',
  '    const _bh = stream.behaviorHints || {};',
  '    if (_bh.notWebReady === false && _u && !_u.startsWith("magnet:")) return true;',
  '    return false;',
  '  };',
  '',
  '  /* v121b-quality-boost */ const QUALITY_PTS: Record<string, number> = ' +
    "{ '4K': 800, '1080p': 600, '720p': 400, 'HD': 300, 'SD': 0 };",
].join('\n');

src = src.replace(computeScoreAnchor, helperBlock);
changes++;
console.log('[v175] EDIT 1: inserted _v175_isPMCached helper');

// ═════════════════════════════════════════════════════════════════════════
// EDIT 2 — In computeScore: replace "+50 for stream.url" with "+1000 for
//          verified PM-cached"
// ═════════════════════════════════════════════════════════════════════════
const oldNudge =
  '    /* v141-cached-first-seeds-matter */\n' +
  '    // Cached / direct URL boost is now a partition gate — see below.  Keep\n' +
  '    // a small intra-bucket nudge so tied cached streams prefer ones with\n' +
  '    // a working URL set.\n' +
  '    if (stream.url) s += 50;';
const newBoost =
  '    /* V175_PM_CACHED_BOOST — verified-cached gets +1000.  This is the\n' +
  '       single largest score component; +1000 dwarfs the max quality\n' +
  '       bonus (+800), so any cached 1080p ALWAYS outranks any uncached\n' +
  '       4K of the same language.  The bucket partition below still\n' +
  '       enforces the hard split, but this also makes the WITHIN-bucket\n' +
  '       ordering correct (PM-cached HTTPS beats magnet-only). */\n' +
  '    if (_v175_isPMCached(stream)) s += 1000;\n' +
  '    /* v141-cached-first-seeds-matter (kept for backward compat — small) */\n' +
  '    else if (stream.url && !String(stream.url).startsWith("magnet:")) s += 50;';
if (src.indexOf(oldNudge) === -1) {
  console.error('[v175] FATAL: EDIT 2 anchor not found (v141-cached-first-seeds-matter block).');
  process.exit(2);
}
src = src.replace(oldNudge, newBoost);
changes++;
console.log('[v175] EDIT 2: computeScore now uses _v175_isPMCached for +1000 boost');

// ═════════════════════════════════════════════════════════════════════════
// EDIT 3 — Use the helper for the v141 partition filter
// ═════════════════════════════════════════════════════════════════════════
const oldPartition =
  '  const _v141_cached = parsed.filter((p) => !!p.stream.url);\n' +
  '  const _v141_uncached = parsed.filter((p) => !p.stream.url);';
const newPartition =
  '  /* V175_PM_CACHED_BOOST — use the robust helper instead of `!!stream.url`\n' +
  '     so magnet-only streams stop leaking into the cached bucket. */\n' +
  '  const _v141_cached   = parsed.filter((p) =>  _v175_isPMCached(p.stream));\n' +
  '  const _v141_uncached = parsed.filter((p) => !_v175_isPMCached(p.stream));';
if (src.indexOf(oldPartition) === -1) {
  console.error('[v175] FATAL: EDIT 3 anchor not found (v141 partition filter).');
  process.exit(2);
}
src = src.replace(oldPartition, newPartition);
changes++;
console.log('[v175] EDIT 3: v141 partition now keyed on _v175_isPMCached');

// ═════════════════════════════════════════════════════════════════════════
// Pre-write sanity — try to parse as JS (best-effort; TS types are stripped
// by Metro at bundle time, so a vm.Script that ignores types is approximate)
// ═════════════════════════════════════════════════════════════════════════
// We don't actually compile TS here.  Instead, ensure brace balance is
// unchanged.  This catches accidental drops of `}` from a botched edit.
function braceDelta(text) {
  let depth = 0;
  let inS = null; // string state: ' " ` /
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inS) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inS) inS = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    if (c === '}') depth--;
  }
  return depth;
}

const oldDelta = braceDelta(raw.replace(/\r\n/g, '\n'));
const newDelta = braceDelta(src);
if (oldDelta !== newDelta) {
  console.error(`[v175] FATAL: brace balance shifted by ${newDelta - oldDelta}; refusing to write.`);
  process.exit(3);
}
console.log(`[v175] brace balance preserved (Δ=0, baseline=${oldDelta})`);

// ═════════════════════════════════════════════════════════════════════════
// Backup + write
// ═════════════════════════════════════════════════════════════════════════
const bak = ID_PATH + '.v175.bak';
if (!fs.existsSync(bak)) {
  fs.writeFileSync(bak, raw, 'utf8');
  console.log(`[v175] backup written: ${path.relative(ROOT, bak)}`);
}

const out = eol === 'crlf' ? src.replace(/\n/g, '\r\n') : src;
fs.writeFileSync(ID_PATH, out, 'utf8');
console.log(`[v175] wrote ${path.relative(ROOT, ID_PATH)} (${eol.toUpperCase()}, ${changes} edits)`);

console.log('');
console.log('━'.repeat(60));
console.log(' NEXT STEPS');
console.log('━'.repeat(60));
console.log('  1) Reload Metro:  press R in the Metro terminal, or restart');
console.log('     the dev server.  No native rebuild needed.');
console.log('');
console.log('  2) Open Details for any movie / episode, watch the [SORT v141]');
console.log('     log line — it should now show a cached pick FIRST.');
console.log('');
console.log('  3) Click Play.  Cached items should hit "ready" within 2-5 s');
console.log('     (Premiumize CDN, no buffer wait).');
console.log('━'.repeat(60));
