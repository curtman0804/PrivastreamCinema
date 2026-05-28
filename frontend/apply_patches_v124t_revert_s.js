// apply_patches_v124t_revert_s.js
//
// v124t - EMERGENCY REVERT of v124s.
//
// v124s injected a full-screen loading overlay early-return that broke the
// autoplay logic in app/details/[type]/[id].tsx. Symptoms: infinite loading
// after "Play Now", and stale state causing wrong episodes to play on
// subsequent attempts.
//
// This script removes the v124s early-return block, restoring normal
// details-page rendering. The autoplay flash returns until we ship a
// proper fix at the player.tsx level (which won't touch the details page
// render path at all).
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124t_revert_s.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124t-revert-s';

function die(msg) { console.error('[v124t] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124t] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// Find the v124s block. It starts with the comment marker and ends with the
// closing "}" of the if-block, which is immediately followed by the original
// "  return (" of the main component render.
// =========================================================================
const startMarker = '  // v124s-autoplay-overlay:';
const sIdx = src.indexOf(startMarker);
if (sIdx === -1) die('cannot find v124s start marker - was v124s applied?');

// The block ends at the closing "  }" line that comes right before "\n  return (".
// Walk forward from sIdx and look for the unique "  }\n  return (".
const endKey = '  }\n  return (';
const eIdx = src.indexOf(endKey, sIdx);
if (eIdx === -1) die('cannot find v124s closing brace + return anchor');
// blockEnd points at the "  return (" (we want to keep that intact).
const blockEnd = eIdx + 3; // includes "  }\n" (length 4? compute precisely)
// Actually we want to delete everything from sIdx up to (but not including)
// the "  return (" line. That means delete from sIdx through "  }\n".
const deleteUntil = eIdx + '  }\n'.length;

// Insert a small replacement marker so re-running is detected, then slice.
const replacement = '  // v124t-revert-s: v124s overlay block removed.\n';
src = src.slice(0, sIdx) + replacement + src.slice(deleteUntil);
info('removed v124s overlay block (' + (deleteUntil - sIdx) + ' bytes)');

// =========================================================================
// Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124t';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload. App should load normally again.');
