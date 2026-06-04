/*
 * apply_patches_v171_stable_stream_tiebreaker.js
 *
 * V171 — Make the stream pick deterministic across runs.
 *
 * Problem:
 *   The user reported playing Rick & Morty S1E1 twice -- first time
 *   low-res, second time fine.  The scoring code (computeScore) is
 *   deterministic given a fixed input, but the input order can vary
 *   run-to-run because the three addon sources (Backend / Torrentio /
 *   TPB+) merge in whatever order they happen to complete.  When two
 *   streams have identical real scores, JavaScript's stable sort
 *   preserves the *input* order -- so a different source winning the
 *   race changes which stream sorts first.
 *
 * Fix:
 *   Add a tiny deterministic tiebreaker derived from a stable hash of
 *   the stream's infoHash (or URL/title fallback).  Magnitude < 0.1 so
 *   it CANNOT override any real score difference (quality, codec,
 *   language all weigh hundreds of points), but two streams with the
 *   same real score always resolve in the same order regardless of
 *   addon-response ordering.
 *
 * Idempotent.  Re-runs are a no-op once V171_STABLE_TIEBREAKER marker
 * is present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v171_stable_stream_tiebreaker.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v171] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v171] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = ID_PATH;
let src = read(file);

if (src.indexOf('V171_STABLE_TIEBREAKER') !== -1) {
  console.log('[v171] [id].tsx: already patched (V171 marker present), skipping');
  process.exit(0);
}

// Inject the tiebreaker contribution right before computeScore returns.
const anchor =
  '    // v141: was Math.min(log10(sd)*5, 20) — capped at +20, basically noise.\n' +
  '    // Now scales up to +240 so seeders meaningfully break quality ties.\n' +
  '    if (sd > 0) s += Math.min(Math.log10(sd + 1) * 80, 240);\n' +
  '    return s;\n' +
  '  };';
if (src.indexOf(anchor) === -1) {
  console.error('[v171] FATAL: [id].tsx — could not locate computeScore return statement.');
  process.exit(2);
}
const replacement =
  '    // v141: was Math.min(log10(sd)*5, 20) — capped at +20, basically noise.\n' +
  '    // Now scales up to +240 so seeders meaningfully break quality ties.\n' +
  '    if (sd > 0) s += Math.min(Math.log10(sd + 1) * 80, 240);\n' +
  '    /* V171_STABLE_TIEBREAKER — add a tiny deterministic value from a\n' +
  '       stable hash of infoHash/URL/title.  Magnitude < 0.1 so it CANNOT\n' +
  '       override any real score difference (quality / codec / language /\n' +
  '       seeders all weigh hundreds of points), but it pins the order of\n' +
  '       tied streams so back-nav + re-pick gives the SAME result every\n' +
  '       time regardless of which addon source happened to respond first. */\n' +
  '    {\n' +
  '      const _v171Key = String((stream as any).infoHash || stream.url || stream.title || stream.name || \'\');\n' +
  '      if (_v171Key) {\n' +
  '        let _v171H = 0;\n' +
  '        const _v171N = Math.min(_v171Key.length, 40);\n' +
  '        for (let _v171i = 0; _v171i < _v171N; _v171i++) {\n' +
  '          _v171H = ((_v171H << 5) - _v171H + _v171Key.charCodeAt(_v171i)) | 0;\n' +
  '        }\n' +
  '        s += ((Math.abs(_v171H) % 1000) / 10000); // range [0, 0.0999]\n' +
  '      }\n' +
  '    }\n' +
  '    return s;\n' +
  '  };';
src = src.replace(anchor, replacement);

write(file, src);
console.log('[v171] [id].tsx: 1 change applied');
console.log('[v171] DONE.  Rebuild your Expo app and sideload to test.');
