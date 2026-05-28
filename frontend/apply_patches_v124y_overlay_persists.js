// apply_patches_v124y_overlay_persists.js
//
// v124y - keep the autoplay overlay visible until /details actually unmounts.
//
// Bug at id.tsx line ~759:
//   autoPlayTriggeredRef.current = true;          // overlay hides here
//   ...
//   setTimeout(() => handleStreamSelect(...), 200);  // nav fires 200ms later
//
// During that 200ms, the overlay (gated on !autoPlayTriggeredRef.current)
// disappears and the user sees the episode card flash before /player mounts.
//
// Fix: change the overlay condition so the overlay is shown the WHOLE time
// autoPlay=true, not just until the trigger ref flips. The overlay goes away
// naturally when /details unmounts after navigating to /player.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124y_overlay_persists.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124y-overlay-persists';

function die(msg) { console.error('[v124y] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124y] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// Replace the gated condition with one that stays true the whole autoplay.
const oldCond = "{((autoPlayParam === 'true' && !autoPlayTriggeredRef.current) || isPlayLoading) && (";
const newCond = "{/* v124y-overlay-persists: keep overlay up the WHOLE autoplay so user never sees episode card */}\r\n      {((autoPlayParam === 'true') || isPlayLoading) && (";

if (src.indexOf(oldCond) === -1) die('cannot find original autoplay overlay condition');

src = src.replace(oldCond, newCond);
info('replaced overlay condition - now persists for full autoPlay window');

const bak = DETAILS + '.bak.v124y';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
info('Expected: no more episode-card flash between binge episodes.');
