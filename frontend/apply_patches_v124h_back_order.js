// apply_patches_v124h_back_order.js
//
// v124h - flexible re-do of v124g.
// Only patches DETAILS file (player.tsx already done by v124g).
// Uses relaxed regex tolerant of whitespace/formatting differences.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124h_back_order.js

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124g-back-order';
const MARKER_H = 'v124h-back-order';

function die(msg) { console.error('[v124h] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124h] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let dsrc = fs.readFileSync(DETAILS, 'utf8');

if (dsrc.includes(MARKER) || dsrc.includes(MARKER_H)) {
  info('details already patched - nothing to do.');
  process.exit(0);
}

// ---- 1) add fromPlayer to useLocalSearchParams destructure ----------------
if (!dsrc.includes('fromPlayer: fromPlayerParam')) {
  const r1 = /autoPlay:\s*autoPlayParam\s*,/;
  if (!r1.test(dsrc)) die('cannot find autoPlay: autoPlayParam, destructure');
  dsrc = dsrc.replace(r1, "autoPlay: autoPlayParam,\n    fromPlayer: fromPlayerParam,");
  info('added fromPlayer destructure');
}

// ---- 2) add fromPlayer to type --------------------------------------------
if (!dsrc.includes('fromPlayer?: string;')) {
  const r2 = /autoPlay\?:\s*string\s*;/;
  if (!r2.test(dsrc)) die('cannot find autoPlay?: string; type');
  dsrc = dsrc.replace(r2, "autoPlay?: string;\n    fromPlayer?: string;");
  info('added fromPlayer type');
}

// ---- 3) replace the autoPlay BackHandler useEffect ------------------------
// Locate by anchor strings, then walk to matching parens.
const anchor = "autoPlayParam !== 'true'";
const ai = dsrc.indexOf(anchor);
if (ai === -1) die("cannot find anchor \"autoPlayParam !== 'true'\" in details");

// Walk backwards to find the enclosing "useEffect((" call.
const head = dsrc.lastIndexOf('useEffect(() => {', ai);
if (head === -1) die('cannot find useEffect open before autoPlay anchor');

// Walk forward from `head` and balance braces+parens until we close useEffect.
// We look for the pattern `}, [ ... ]);` that closes it.
// Simpler: find the next `}, [autoPlayParam` after `head` and then `]);`.
const depsIdx = dsrc.indexOf('[autoPlayParam', head);
if (depsIdx === -1) die('cannot find deps array [autoPlayParam, ...]');
const depsEnd = dsrc.indexOf(']);', depsIdx);
if (depsEnd === -1) die('cannot find end of deps array');

const blockStart = head;
const blockEnd = depsEnd + 3; // include ]);
const oldBlock = dsrc.slice(blockStart, blockEnd);
info('matched existing block, length=' + oldBlock.length);

const newBlock =
  "useEffect(() => {\n" +
  "    // v124h-back-order: intercept hardware Back on series episode pages\n" +
  "    // when arriving from /player (fromPlayer=true) OR from autoplay.\n" +
  "    // Route to series root with focusS/focusE so the just-watched episode\n" +
  "    // is highlighted on the show page.\n" +
  "    const isFromPlayer = fromPlayerParam === 'true';\n" +
  "    const isAutoPlay = autoPlayParam === 'true';\n" +
  "    if ((!isFromPlayer && !isAutoPlay) || type !== 'series' || !baseId) return;\n" +
  "    const handler = () => {\n" +
  "      router.replace({\n" +
  "        pathname: `/details/series/${baseId}`,\n" +
  "        params: {\n" +
  "          focusS: String(episodeSeason || ''),\n" +
  "          focusE: String(episodeNumber || ''),\n" +
  "        },\n" +
  "      });\n" +
  "      return true;\n" +
  "    };\n" +
  "    const sub = BackHandler.addEventListener('hardwareBackPress', handler);\n" +
  "    return () => sub.remove();\n" +
  "  }, [autoPlayParam, fromPlayerParam, type, baseId, episodeSeason, episodeNumber]);";

dsrc = dsrc.slice(0, blockStart) + newBlock + dsrc.slice(blockEnd);
info('replaced BackHandler useEffect');

// ---- backup + write -------------------------------------------------------
const dbak = DETAILS + '.bak.v124h';
if (!fs.existsSync(dbak)) fs.copyFileSync(DETAILS, dbak);
fs.writeFileSync(DETAILS, dsrc, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
