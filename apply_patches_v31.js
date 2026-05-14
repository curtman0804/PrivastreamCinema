/* eslint-disable */
// apply_patches_v31.js — Firestick-friendly auto-pick (Premiumize cached always wins)
// Run from project root:   node apply_patches_v31.js
//
// THE BUG (Apex super-laggy playback):
//   In details/[type]/[id].tsx, PATCH_V9_SCORED_SORT ranks streams by
//     score = QUALITY_PTS[q] + (stream.url ? 50 : 0) + seeders_bonus + ...
//   QUALITY_PTS = { '4K':80, '1080p':60, '720p':40, ... }, so:
//     - 4K RAW torrent  : 80 + seeders  →  often beats
//     - 1080p Premiumize: 60 + 50 = 110 (only +30 head start)
//   A few seeders are enough to flip the pick to the 4K torrent. On a
//   Firestick on WiFi, that torrent: spins up the torrent server, hunts
//   peers, and even when it plays, bandwidth/CPU can't keep up → "super
//   laggy" exactly as reported. Meanwhile player.tsx ALREADY skips the
//   torrent stack when handed `directUrl` (L1573), so the only fix needed
//   is in the picker.
//
// THE FIX:
//   Bump the cached-HTTPS bonus from +50 to +500. Now ANY Premiumize/RD
//   cached HTTPS stream outranks ANY raw torrent regardless of quality or
//   seeders. Within the cached pool the existing 4K > 1080p > 720p order
//   stays intact (so quality is still chosen sensibly). If no cached
//   stream is found at all, the picker naturally falls back to the
//   highest-scoring raw torrent — exactly the "Premiumize first, torrent
//   fallback within 2 s" behavior you asked for. The progressive
//   fetchStreams already delivers streams within ~1 s, so the 2 s window
//   is implicit (the sort runs every render as new streams arrive).
//
// Single file. Single anchor. Single string-replace. LF preserved.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok   = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad  = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found at ' + DETAILS); process.exit(1); }

let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v31.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');
info('detected line endings: ' + (_hadCRLF ? 'CRLF' : 'LF'));

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V31_CACHED_DOMINANT';

if (src.includes(MARKER)) {
  ok('V31 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Single anchor — confirmed by your diag_v31.txt at L307:
//   `    if (stream.url) s += 50;`
// (only one occurrence; line is inside computeScore())
// ---------------------------------------------------------------------
{
  const anchor = "    if (stream.url) s += 50;";
  const occ = src.split(anchor).length - 1;

  if (occ === 0) {
    bad("could not find `if (stream.url) s += 50;` anchor (4-space indent)");

    // 2-space fallback in case file uses different indent
    const anchor2 = "  if (stream.url) s += 50;";
    const occ2 = src.split(anchor2).length - 1;
    if (occ2 === 1) {
      const replacement2 = "  // " + MARKER + " — cached HTTPS dominates (was +50, tiebreaker). " +
        "Now ANY Premiumize/RD cached stream beats ANY raw torrent, regardless of quality/seeders.\n" +
        "  if (stream.url) s += 500;";
      src = src.replace(anchor2, replacement2);
      ok('replaced +50 → +500 (2-space variant)');
    } else if (occ2 > 1) {
      bad('2-space anchor matches ' + occ2 + ' times — refusing ambiguous');
    } else {
      bad('2-space variant also not found — refusing to patch');
    }
  } else if (occ > 1) {
    bad("anchor matches " + occ + " times — refusing ambiguous swap");
  } else {
    const replacement = [
      "    // " + MARKER + " — cached HTTPS dominates (was +50, tiebreaker).",
      "    // Now ANY Premiumize/RD cached stream beats ANY raw torrent, regardless of",
      "    // quality or seeders. Within the cached pool, the existing 4K > 1080p >",
      "    // 720p order still applies. If no cached stream is available at all, the",
      "    // picker falls back naturally to the highest-scoring raw torrent.",
      "    if (stream.url) s += 500;",
    ].join('\n');

    src = src.replace(anchor, replacement);
    ok('replaced +50 → +500 (cached HTTPS now dominant)');
  }
}

// ---------------------------------------------------------------------
// Save (restore original line endings)
// ---------------------------------------------------------------------
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(DETAILS, finalOut, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV31 done. Rebuild and test on Firestick:');
  console.log('  ✓ Apex → press Play → should jump to player almost instantly');
  console.log('    (Premiumize cached HTTPS picked, no torrent server init)');
  console.log('  ✓ Playback should be smooth (HTTPS direct → ExoPlayer, no peer hunting)');
  console.log('  ✓ Rick & Morty episodes → same behavior, cached preferred');
  console.log('  ✓ If a movie has NO cached stream at all, falls back to top torrent');
  console.log('    (rare, but still works — just slower as before)');
  console.log('  ✓ Quality within cached: still 4K > 1080p > 720p (unchanged)');
  console.log('\nIf you find 4K Premiumize stutters on Firestick WiFi, tell me');
  console.log('and V32 will demote 4K below 1080p inside the cached pool');
  console.log('("most probable to play" wins over "highest pixels").');
}
