/*
 * apply_patches_v182_legal_addon_example.js
 *
 * V182 — Replace placeholder addon examples with legal Cinemeta.
 *
 * Today's Addons screen shows two demo placeholders:
 *   Line 347:  placeholder="e.g. 970280"                       (Downloader code)
 *   Line 386:  placeholder="https://example.com/manifest.json" (Manifest URL)
 *
 * `970280` is an opaque demo code that, if anyone Googles it, may resolve to
 * a piracy-flavoured addon — risky example to ship publicly.  Replace with
 * the official Cinemeta downloader code (8762337) + the official Cinemeta
 * manifest URL.  Cinemeta is Stremio's first-party metadata addon — 100 %
 * legal, ships in every official Stremio install, no streaming claims.
 *
 * Properties
 *   - Idempotent (marker V182_LEGAL_EXAMPLE)
 *   - CRLF preserved
 *   - Backup: addons.tsx.v182.bak
 *   - 2 anchored edits, brace balance preserved
 *
 * Usage
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v182_legal_addon_example.js -o apply_patches_v182_legal_addon_example.js
 *   node apply_patches_v182_legal_addon_example.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const cands = [
  ['app', '(tabs)', 'addons.tsx'],
  ['app', 'addons.tsx'],
  ['app', 'settings', 'addons.tsx'],
];
let target = null;
for (const c of cands) { const p = path.join(ROOT, ...c); if (fs.existsSync(p)) { target = p; break; } }
if (!target) { console.error('[v182] FATAL: addons.tsx not found.'); process.exit(1); }
console.log('[v182] target:', path.relative(ROOT, target));

const raw = fs.readFileSync(target, 'utf8');
const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;

if (text.indexOf('V182_LEGAL_EXAMPLE') !== -1) {
  console.log('[v182] already patched, skipping.');
  process.exit(0);
}

const edits = [
  {
    label: '1. Downloader-code placeholder 970280 → 8762337',
    old: '                  placeholder="e.g. 970280"',
    new: '                  /* V182_LEGAL_EXAMPLE — Cinemeta\'s official downloader code. */\n' +
         '                  placeholder="e.g. 8762337"',
  },
  {
    label: '2. Manifest URL placeholder example.com → v3-cinemeta.strem.io',
    old: '                  placeholder="https://example.com/manifest.json"',
    new: '                  /* V182_LEGAL_EXAMPLE — Cinemeta (Stremio first-party metadata addon, 100% legal). */\n' +
         '                  placeholder="https://v3-cinemeta.strem.io/manifest.json"',
  },
];

for (const e of edits) {
  if (text.indexOf(e.old) === -1) {
    console.error(`[v182] FATAL: anchor missed: ${e.label}`);
    process.exit(2);
  }
  text = text.replace(e.old, e.new, 1);
  console.log(`[v182] ${e.label}`);
}

const bak = target + '.v182.bak';
if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
fs.writeFileSync(target, out, 'utf8');
console.log(`[v182] wrote ${path.relative(ROOT, target)} (${eol.toUpperCase()}, backup=.v182.bak)`);
console.log('');
console.log('Next: rebuild & install APK.');
