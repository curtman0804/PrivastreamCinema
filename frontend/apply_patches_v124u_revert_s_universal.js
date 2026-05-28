// apply_patches_v124u_revert_s_universal.js
//
// v124u - universal revert of v124s.
//
// v124t's revert was too strict (looked for a specific marker line). This
// version searches the file for ANY trace of the v124s autoplay overlay
// (marker comments, the early-return block, the ActivityIndicator render)
// and surgically removes the inserted block. Also tells you whether v124s
// was actually present or not.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124u_revert_s_universal.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');

function die(msg) { console.error('[v124u] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124u] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');
const origLen = src.length;

// Diagnostic: does the file even contain v124s traces?
const hits = [
  { tag: 'v124s-autoplay-overlay', present: src.indexOf('v124s-autoplay-overlay') !== -1 },
  { tag: 'v124s', present: src.indexOf('v124s') !== -1 },
  { tag: 'Loading next episode...', present: src.indexOf("'Loading next episode...'") !== -1 },
  { tag: 'autoplay loading overlay', present: src.indexOf('autoplay loading overlay') !== -1 },
  { tag: 'ActivityIndicator from v124s', present: src.indexOf("ActivityIndicator size=\"large\" color=\"#B8A05C\"") !== -1 },
];
info('--- v124s presence check ---');
hits.forEach(h => info('  ' + (h.present ? 'YES' : 'no') + '  ' + h.tag));

// Try every plausible block-start marker.
const startMarkers = [
  '  // v124s-autoplay-overlay:',
  '// v124s-autoplay-overlay:',
  '  if (autoPlayParam === \'true\') {\n    const _bg = ',
  '  // v124s-autoplay-overlay: when',
];
let startIdx = -1;
for (const m of startMarkers) {
  const i = src.indexOf(m);
  if (i !== -1) { startIdx = i; info('matched startMarker: ' + JSON.stringify(m.slice(0, 60))); break; }
}

if (startIdx === -1) {
  info('No v124s start marker found in details file.');
  info('File length: ' + origLen + ' bytes.');
  info('Either v124s never applied OR was already reverted.');
  info('Nothing to do. Exiting cleanly.');
  process.exit(0);
}

// End anchor: the original main render's "  return (".
const endAnchor = '\n  return (';
const eIdx = src.indexOf(endAnchor, startIdx);
if (eIdx === -1) die('found start but cannot find following "\\n  return (" anchor');

// Delete the inserted block, restoring the original return.
src = src.slice(0, startIdx) + src.slice(eIdx + 1); // keep the "\n  return ("
info('removed ' + (eIdx + 1 - startIdx) + ' bytes of v124s block');

// Sanity: still expect "  return (" to exist now.
if (src.indexOf('\n  return (') === -1) {
  die('after removal, lost the main return - aborting write');
}

const bak = DETAILS + '.bak.v124u';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('original ' + origLen + ' -> ' + src.length + ' bytes');
info('OK - rebuild and sideload.');
