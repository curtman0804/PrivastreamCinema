// apply_patches_v121k_speed.js
//
// 1. Reverts v121h so direct Torrentio/TPB streams show as fast as they
//    arrive (~500ms) instead of waiting for backend.
// 2. Changes v121c-backend-override from REPLACE to UPGRADE: when backend
//    arrives, it augments the existing list in-place with resolved URLs
//    on matching infoHashes. The list does NOT shrink - no flicker.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121k_speed.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('src', 'api', 'client.ts');
const MARKER = '/* v121k-upgrade-merge */';

function die(msg) { console.error('[v121k] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121k] already applied - nothing to do.');
  process.exit(0);
}

let changed = 0;

// 1) Revert v121h: restore the suppressed onProgress call.
const h_re = /\/\* v121h-suppress-direct \*\/\s*[\r\n]+\s*\/\/[^\n]*[\r\n]+\s*\/\/[^\n]*[\r\n]+\s*\/\/[^\n]*[\r\n]+\s*\/\/[^\n]*/;
if (h_re.test(src)) {
  src = src.replace(h_re, "if (onProgress) onProgress([...allStreams]);");
  changed++;
} else {
  // Fallback: maybe it was already reverted manually
  console.log('[v121k] v121h marker not found - skipping revert (already reverted?)');
}

// 2) Replace v121c-backend-override block with upgrade-merge.
// Match the entire block from its marker to its `return;`.
const c_re = /\/\* v121c-backend-override \*\/[\s\S]*?return;\s*[\r\n]+\s*\}/;
if (!c_re.test(src)) die('could not find v121c-backend-override block to upgrade.');

const newBlock =
  "/* v121k-upgrade-merge */\n" +
  "        // When backend returns pre-resolved streams, UPGRADE existing\n" +
  "        // entries in place (add url/externalUrl to matching hashes) and\n" +
  "        // append any new ones. The list doesn't shrink, so no flicker.\n" +
  "        if (sourceName === 'Backend' && newStreams.some((s: any) => s.externalUrl || s.url || s.direct_url)) {\n" +
  "          let upgraded = 0;\n" +
  "          let added = 0;\n" +
  "          for (const newS of newStreams as any[]) {\n" +
  "            const newHash = (newS.infoHash || '').toLowerCase();\n" +
  "            if (!newHash) continue;\n" +
  "            const idx = allStreams.findIndex((s: any) => (s.infoHash || '').toLowerCase() === newHash);\n" +
  "            if (idx >= 0) {\n" +
  "              if (newS.url || newS.externalUrl || newS.direct_url) {\n" +
  "                Object.assign(allStreams[idx], newS);\n" +
  "                upgraded++;\n" +
  "              }\n" +
  "            } else {\n" +
  "              allStreams.push(newS);\n" +
  "              existingHashes.add(newHash);\n" +
  "              added++;\n" +
  "            }\n" +
  "          }\n" +
  "          allStreams.sort((a: any, b: any) => (b.seeders || 0) - (a.seeders || 0));\n" +
  "          console.log(`[STREAMS] v121k: Backend upgrade-merge - upgraded ${upgraded}, added ${added}, total ${allStreams.length}`);\n" +
  "          if (onProgress) onProgress(allStreams.slice());\n" +
  "          return;\n" +
  "        }";

src = src.replace(c_re, newBlock);
changed++;

if (changed === 0) die('nothing changed - bailing out.');

const bak = TARGET + '.bak.v121k';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121k] patched ' + TARGET);
console.log('[v121k] backup: ' + bak);
console.log('[v121k] OK - rebuild and sideload.');
