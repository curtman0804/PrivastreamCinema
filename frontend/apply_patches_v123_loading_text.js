// apply_patches_v123_loading_text.js
//
// Removes the "Loading next episode..." text from the AutoPlayOverlay. The
// overlay still shows the episode title, S/E numbers, and the animated
// loading bar - which is enough.
//
// Movies: unchanged (already use the clean overlay from v121m).
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v123_loading_text.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v123-loading-text';

function die(msg) { console.error('[v123] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v123] already applied - nothing to do.');
  process.exit(0);
}

// Remove the entire <Text>...Loading next episode... or v121m dynamic version.
// Anchors flex to handle either pre-v121m or post-v121m state.
const re = /<Text style=\{\{ color: '#CCC', fontSize: 13, marginTop: 14, fontWeight: '500' \}\}>[\s\S]*?<\/Text>/;
if (!re.test(src)) die('could not find the loading-text Text node.');

src = src.replace(re, "{/* v123-loading-text: text removed; title + SE + bar are enough */}");

const bak = TARGET + '.bak.v123';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v123] patched ' + TARGET);
console.log('[v123] backup: ' + bak);
console.log('[v123] OK - rebuild and sideload.');
