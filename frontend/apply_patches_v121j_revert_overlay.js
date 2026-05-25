// apply_patches_v121j_revert_overlay.js
//
// Removes the v121i Play-button loading overlay (which showed "episode null"
// for movies and stuck around after backing out of the player). The player
// screen's own loading indicator is enough.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121j_revert_overlay.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v121j-overlay-removed';

function die(msg) { console.error('[v121j] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121j] already applied - nothing to do.');
  process.exit(0);
}

let changed = 0;

// 1) Remove the useState line added by v121i.
const stateRe = /\n\s*\/\/ v121i-play-loading: show full-screen overlay while Play button waits\n\s*const \[isInitiatingPlay, setIsInitiatingPlay\] = useState\(false\);/;
if (stateRe.test(src)) { src = src.replace(stateRe, ''); changed++; }

// 2) Remove the setIsInitiatingPlay(true) call from the Play onPress.
const setterRe = /\s*\/\* v121i-play-loading \*\/\n\s*setIsInitiatingPlay\(true\);\n/;
if (setterRe.test(src)) { src = src.replace(setterRe, '\n'); changed++; }

// 3) Restore the overlay render condition to the original (autoPlay only).
const condRe = /\{\/\* v121i-play-loading \*\/\}\s*[\r\n]+\s*\{\(\(autoPlayParam === 'true' && !autoPlayTriggeredRef\.current\) \|\| isInitiatingPlay\) && \(/;
if (condRe.test(src)) {
  src = src.replace(condRe, "{autoPlayParam === 'true' && !autoPlayTriggeredRef.current && (");
  changed++;
}

if (changed === 0) {
  console.log('[v121j] nothing to revert (v121i markers not found).');
  process.exit(0);
}

// Add a marker so re-running is a no-op.
src = src.replace(
  /(const autoPlayTriggeredRef\s*=\s*useRef\(false\);)/,
  "$1\n  // v121j-overlay-removed"
);

const bak = TARGET + '.bak.v121j';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121j] removed ' + changed + ' v121i fragments from ' + TARGET);
console.log('[v121j] backup: ' + bak);
console.log('[v121j] OK - rebuild and sideload.');
