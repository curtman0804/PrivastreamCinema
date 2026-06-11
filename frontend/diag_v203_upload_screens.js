/*
 * diag_v203_upload_screens.js — uploads the CURRENT versions of the files
 * involved in the two lag issues (addons-screen lag after install, and
 * Details -> back -> Discover lag) so the fix can be surgical.
 *
 * Uploads: discover.tsx, addons.tsx, contentStore.ts, every *detail* screen
 * file under app/, and index/_layout (navigation shell).
 *
 * Usage (Windows CMD, from the frontend folder):
 *   node diag_v203_upload_screens.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UPLOAD_URL = 'https://git-update-staging.preview.emergentagent.com/api/upload_user_file';
const ROOT = process.cwd();

function exists(parts) { const f = path.join(ROOT, ...parts); return fs.existsSync(f) ? f : null; }

// Fixed, known-important files
const targets = new Map();
for (const [name, parts] of [
  ['cur_discover.tsx',     ['app', '(tabs)', 'discover.tsx']],
  ['cur_addons.tsx',       ['app', '(tabs)', 'addons.tsx']],
  ['cur_contentStore.ts',  ['src', 'store', 'contentStore.ts']],
  ['cur_tabs_layout.tsx',  ['app', '(tabs)', '_layout.tsx']],
  ['cur_root_layout.tsx',  ['app', '_layout.tsx']],
]) {
  const f = exists(parts);
  if (f) targets.set(name, f);
}

// Find detail/title screens anywhere under app/
function walk(dir, depth) {
  if (depth > 4) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, depth + 1); continue; }
    const rel = path.relative(path.join(ROOT, 'app'), full);
    if (/detail|title|movie|series|media|watch/i.test(rel) && /\.(tsx|ts)$/.test(e.name)) {
      targets.set('cur_' + rel.replace(/[\\/\[\]()]+/g, '_'), full);
    }
  }
}
walk(path.join(ROOT, 'app'), 0);

console.log('[diag_v203] uploading', targets.size, 'files...');
(async () => {
  let ok = 0, fail = 0;
  for (const [name, file] of targets) {
    try {
      const content = fs.readFileSync(file);
      const fd = new FormData();
      fd.append('file', new Blob([content]), name);
      const res = await fetch(UPLOAD_URL, { method: 'POST', body: fd, headers: { 'User-Agent': 'Mozilla/5.0 (diag_v203)' } });
      const j = await res.json();
      if (j && j.ok) { console.log(`  OK   ${name}  (${content.length} bytes)  <- ${path.relative(ROOT, file)}`); ok++; }
      else { console.log(`  FAIL ${name}: ${JSON.stringify(j)}`); fail++; }
    } catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
  }
  console.log(`[diag_v203] done: ${ok} uploaded, ${fail} failed.`);
  if (fail === 0) console.log('[diag_v203] The agent has everything. Nothing to paste.');
})();
