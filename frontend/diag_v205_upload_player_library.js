/*
 * diag_v205_upload_player_library.js — uploads the CURRENT files involved in:
 *   1. Clear-watch-progress poster removal speed (long-press menu + CW row)
 *   2. Laggy resume flow (loading -> details -> loading -> player)
 *   3. Pause/resume lag (player)
 *   4. TV channels in Library
 *   5. Play button dead until app-data wipe (stream caching / stale links)
 *
 * Usage (Windows CMD, from the frontend folder):
 *   node diag_v205_upload_player_library.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UPLOAD_URL = 'https://git-update-staging.preview.emergentagent.com/api/upload_user_file';
const ROOT = process.cwd();

const targets = new Map();
function add(name, parts) { const f = path.join(ROOT, ...parts); if (fs.existsSync(f)) targets.set(name, f); }

add('p5_library.tsx',       ['app', '(tabs)', 'library.tsx']);
add('p5_discover.tsx',      ['app', '(tabs)', 'discover.tsx']);
add('p5_contentStore.ts',   ['src', 'store', 'contentStore.ts']);
add('p5_client.ts',         ['src', 'api', 'client.ts']);
add('p5_cache.ts',          ['src', 'utils', 'cache.ts']);

// player + details + components related to cards/menus/longpress, found by pattern
function walk(dir, depth) {
  if (depth > 5 || !fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, depth + 1); continue; }
    if (!/\.(tsx|ts)$/.test(e.name)) continue;
    const rel = path.relative(ROOT, full);
    if (/player|details|card|menu|longpress|long-press|progress|continue/i.test(rel)) {
      targets.set('p5_' + rel.replace(/[\\/\[\]()]+/g, '_'), full);
    }
  }
}
walk(path.join(ROOT, 'app'), 0);
walk(path.join(ROOT, 'src', 'components'), 0);
walk(path.join(ROOT, 'src', 'utils'), 0);

console.log('[diag_v205] uploading', targets.size, 'files...');
(async () => {
  let ok = 0, fail = 0;
  for (const [name, file] of targets) {
    try {
      const content = fs.readFileSync(file);
      const fd = new FormData();
      fd.append('file', new Blob([content]), name);
      const res = await fetch(UPLOAD_URL, { method: 'POST', body: fd, headers: { 'User-Agent': 'Mozilla/5.0 (diag_v205)' } });
      const j = await res.json();
      if (j && j.ok) { console.log(`  OK   ${name}  (${content.length} bytes)`); ok++; }
      else { console.log(`  FAIL ${name}: ${JSON.stringify(j)}`); fail++; }
    } catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
  }
  console.log(`[diag_v205] done: ${ok} uploaded, ${fail} failed.`);
  if (fail === 0) console.log('[diag_v205] The agent has everything. Nothing to paste.');
})();
