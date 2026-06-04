/*
 * apply_patches_v174_widen_fallback_cascade.js
 *
 * V174 — Stop "stream timed out" when there are 35+ unused alternatives.
 *
 * Problem:
 *   When the user clicks Play on a title with 40 streams, the cascade
 *   only ever gets 5 alternatives.  After 1 primary + 5 fallbacks fail
 *   (dead torrents, no peers, codec issues, Premiumize timeouts), the
 *   player gives up despite 30+ healthy streams sitting unused.
 *
 *   Root cause: every site that builds the player's `fallbackStreams`
 *   array uses `.slice(0, 5)`.  The v162 comment claims fallbacks were
 *   widened to 15 -- only one of four sites was actually changed.
 *
 * Fix:
 *   Bump every `.slice(0, 5)` / `.slice(0, 15)` callsite that feeds
 *   the player to `.slice(0, 20)`.  Twenty top-ranked streams gives
 *   the cascade real room to find a working one without making the
 *   navigation params unreasonably large (each entry is ~150 bytes,
 *   so 20 ≈ 3KB -- well within router param limits).
 *
 *   Files touched: player.tsx (3 spots), [id].tsx (2 spots).
 *
 * Idempotent.  Re-runs are a no-op once V174_WIDEN_FALLBACK marker
 * is present on each file.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v174_widen_fallback_cascade.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PLAYER_PATH = path.join(ROOT, 'app', 'player.tsx');
const ID_PATH     = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v174] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v174] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: player.tsx — 3 hard-coded slice(0, 5) sites.
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V174_WIDEN_FALLBACK') !== -1) {
    console.log('[v174] player.tsx: already patched (V174 marker present), skipping');
  } else {
    let changes = 0;

    const sites = [
      'fallbackStreams: list.filter((s: any) => s.infoHash !== _top.infoHash).slice(0, 5),',
      'fallbackStreams: list.filter((s: any) => s.infoHash !== _alt.infoHash).slice(0, 5),',
      'fallbackStreams: list.filter((_s: any) => _s.infoHash !== _h).slice(0, 5),',
    ];

    for (const oldLine of sites) {
      if (src.indexOf(oldLine) === -1) {
        console.error('[v174] FATAL: player.tsx — could not locate fallback slice site:');
        console.error('       ' + oldLine);
        process.exit(2);
      }
      const newLine = oldLine.replace('.slice(0, 5)', '.slice(0, 20) /* V174_WIDEN_FALLBACK */');
      src = src.replace(oldLine, newLine);
      changes++;
    }

    write(file, src);
    console.log(`[v174] player.tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: [id].tsx — 2 sites that build the player's fallbackStreams.
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V174_WIDEN_FALLBACK') !== -1) {
    console.log('[v174] [id].tsx: already patched (V174 marker present), skipping');
  } else {
    let changes = 0;

    // 2a) line 1352 area — was .slice(0, 5)
    const before1 = src;
    src = src.replace(
      /(\.\s*slice\(0,\s*5\)[^;]*)\n(\s*\.\s*map\([^)]*\)[^;]*;|\s*;|\s*\.)/g,
      function(match) {
        if (/\.slice\(0, 20\)/.test(match)) return match;
        return match.replace('.slice(0, 5)', '.slice(0, 20) /* V174_WIDEN_FALLBACK */');
      }
    );
    if (src !== before1) changes++;

    // 2b) line 1444 area — was .slice(0, 15) (the partial v162 widening)
    const before2 = src;
    src = src.replace(
      /\.slice\(0,\s*15\)(?!\s*\/\*\s*V174)/g,
      '.slice(0, 20) /* V174_WIDEN_FALLBACK */'
    );
    if (src !== before2) changes++;

    // Sanity: ensure at least one .slice was bumped, otherwise the patch
    // pattern missed and we should hard-fail.
    if (changes === 0) {
      console.error('[v174] FATAL: [id].tsx — no slice() callsites bumped.  File may have diverged.');
      process.exit(3);
    }

    write(file, src);
    console.log(`[v174] [id].tsx: ${changes} change(s) applied`);
  }
}

console.log('[v174] DONE.  Rebuild your Expo app and sideload to test.');
