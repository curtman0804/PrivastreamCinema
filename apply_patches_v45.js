/* eslint-disable */
// apply_patches_v45.js — Stremio-style instant detail screen.
//
// Your details screen already supports instant render via route params
// (name, poster, background). But the callers don't pass them. This patches
// the 5 navigation call sites in discover/library/search/category to pass
// the item's metadata so the details page renders title + poster instantly.
//
// Idempotent. Per-file backup auto-created.

const fs = require('fs');
const path = require('path');

const MARKER = 'PATCH_V45_INSTANT_DETAILS';
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

// Files + their callsites. We use a tolerant regex that finds
// `pathname: `/details/<expr>/<expr>`,` not already followed by `params:`.
const TARGETS = [
  // file, item variable name used to build params, optional explicit
  { file: path.join('frontend', 'app', '(tabs)', 'discover.tsx'),                itemVar: 'item' },
  { file: path.join('frontend', 'app', '(tabs)', 'library.tsx'),                 itemVar: 'item' },
  { file: path.join('frontend', 'app', '(tabs)', 'search.tsx'),                  itemVar: 'item' },
  { file: path.join('frontend', 'app', 'search.tsx'),                            itemVar: 'item' },
  { file: path.join('frontend', 'app', 'category', '[service]', '[type].tsx'),   itemVar: 'item' },
];

function patchFile(target) {
  const F = target.file;
  if (!fs.existsSync(F)) { bad('not found: ' + F); return; }

  let src = fs.readFileSync(F, 'utf8');
  const orig = src;
  const hadCRLF = src.indexOf('\r\n') >= 0;
  if (hadCRLF) src = src.replace(/\r\n/g, '\n');

  if (src.includes(MARKER)) { ok('already patched: ' + F); return; }

  // Match: pathname: `/details/<anything>/<anything>`,
  // Followed by NOT a params: line in the next ~3 lines.
  // We insert a `params:` line right after the pathname line.
  //
  // Capture groups:
  //   1 = full pathname line incl. trailing comma
  //   2 = indentation of next line (we'll match it)
  const re = /([ \t]*)(pathname:\s*`\/details\/[^`]+`,)\n(?![ \t]*params\s*:)/g;

  let count = 0;
  src = src.replace(re, (match, indent, pathLine) => {
    count++;
    const iv = target.itemVar;
    // Build params line. Use ?. to be safe if item is undefined.
    const paramsLine =
      `${indent}params: { name: ${iv}?.name || '', poster: ${iv}?.poster || '', background: ${iv}?.background || '' }, // ${MARKER}`;
    return `${indent}${pathLine}\n${paramsLine}\n`;
  });

  if (count === 0) {
    bad('no pathname callsites matched in ' + F);
    return;
  }
  if (src === orig) {
    bad('regex matched but nothing changed in ' + F);
    return;
  }

  // Backup + write
  const bak = F + '.bak.v45.' + Date.now();
  fs.copyFileSync(F, bak);
  info('backup → ' + bak);

  fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
  ok('inserted params at ' + count + ' site(s) in ' + F);
}

console.log('=== V45 — Stremio-style instant detail screen ===\n');
TARGETS.forEach(patchFile);

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome files failed. Backups (if created) preserved with .bak.v45.<ts>.');
  process.exit(1);
} else {
  console.log('\nV45 done. Rebuild + force-stop + relaunch on Firestick.');
  console.log('Expected behavior:');
  console.log('  ✓ Tap any poster → title + poster appears INSTANTLY (no "Loading...")');
  console.log('  ✓ Meta (cast, genres, description) fades in over ~300ms');
  console.log('  ✓ Streams populate as they arrive');
  console.log('\nIf cold start is finally Stremio-fast on detail tap:');
  console.log('  git add -A');
  console.log('  git commit -m "perf: V45 — instant detail screen via route params"');
}
