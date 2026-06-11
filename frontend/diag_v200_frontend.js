/*
 * diag_v200_frontend.js — collects the EXACT current state of your frontend
 * discover/addon cache code and AUTO-UPLOADS it to the agent. No log pasting.
 *
 * Usage (Windows CMD, from the frontend folder):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/diag_v200_frontend.js -o diag_v200_frontend.js
 *   node diag_v200_frontend.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UPLOAD_URL = 'https://git-update-staging.preview.emergentagent.com/api/upload_user_file';
const ROOT = process.cwd();
function find(c){for(const p of c){const f=path.join(ROOT,...p);if(fs.existsSync(f))return f}return null}

const files = {
  contentStore: find([['src','store','contentStore.ts'],['src','stores','contentStore.ts']]),
  discover:     find([['app','(tabs)','discover.tsx'],['app','discover.tsx']]),
  addons:       find([['app','(tabs)','addons.tsx'],['app','addons.tsx']]),
  cacheUtil:    find([['src','utils','cache.ts'],['utils','cache.ts'],['src','utils','cache.js']]),
  client:       find([['src','api','client.ts'],['src','api','client.js']]),
};

const out = [];
out.push('==== diag_v200_frontend report ====');
out.push('date: ' + new Date().toISOString());
out.push('node: ' + process.version);
out.push('cwd: ' + ROOT);
out.push('');

// 1. File presence + backups
out.push('---- [1] files found ----');
for (const [k, v] of Object.entries(files)) out.push(`  ${k}: ${v || 'NOT FOUND'}`);
out.push('');
out.push('---- [2] .bak files (patch history evidence) ----');
for (const v of Object.values(files)) {
  if (!v) continue;
  const dir = path.dirname(v), base = path.basename(v);
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(base) && f !== base) {
      const st = fs.statSync(path.join(dir, f));
      out.push(`  ${f}  (${st.size} bytes, mtime ${st.mtime.toISOString()})`);
    }
  }
}
out.push('');

// 3. Marker presence
out.push('---- [3] marker counts ----');
const markers = ['V199_TRUE_WIPE','V198_NUKE_DISCOVER','PATCH_V144_CACHE_STATE','PATCH_V144_CACHE_FLATROWS','PATCH_V144_CACHE_HYDRATE','V190_STORE_DEF','discoverNukeStamp','nukeDiscoverCache'];
for (const [k, v] of Object.entries(files)) {
  if (!v) continue;
  const txt = fs.readFileSync(v, 'utf8');
  const hits = markers.map(m => `${m}=${txt.split(m).length - 1}`).join(', ');
  out.push(`  ${k}: ${hits}`);
}
out.push('');

// 4. Key code blocks (exact current text)
function grabBlock(txt, startRe, maxLines, label) {
  const lines = txt.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) {
      blocks.push(`  >>> ${label} @ line ${i + 1}:`);
      for (let j = i; j < Math.min(i + maxLines, lines.length); j++) blocks.push('  | ' + lines[j]);
      blocks.push('');
    }
  }
  return blocks.length ? blocks : [`  >>> ${label}: NO MATCH`, ''];
}

out.push('---- [4] contentStore.ts: nukeDiscoverCache + fetchDiscover ----');
if (files.contentStore) {
  const t = fs.readFileSync(files.contentStore, 'utf8');
  out.push(...grabBlock(t, /nukeDiscoverCache/, 14, 'nukeDiscoverCache'));
  out.push(...grabBlock(t, /fetchDiscover:\s*async/, 45, 'fetchDiscover'));
}
out.push('---- [5] addons.tsx: install/uninstall handlers ----');
if (files.addons) {
  const t = fs.readFileSync(files.addons, 'utf8');
  out.push(...grabBlock(t, /nukeDiscoverCache|fetchAddons\(true\)/, 8, 'fetch/nuke callsite'));
  out.push(...grabBlock(t, /uninstall|handleRemove|removeAddon|handleUninstall/i, 30, 'uninstall handler'));
}
out.push('---- [6] discover.tsx: V199 effect + flatRows fallback + focus effect ----');
if (files.discover) {
  const t = fs.readFileSync(files.discover, 'utf8');
  out.push(...grabBlock(t, /discoverNukeStamp/, 10, 'V199 nuke-stamp effect'));
  out.push(...grabBlock(t, /cachedDiscover\?\.services/, 6, 'flatRows/hasContent fallback'));
  out.push(...grabBlock(t, /useFocusEffect/, 22, 'focus effect'));
}
out.push('---- [7] src/utils/cache.ts FULL FILE (reveals key prefix) ----');
if (files.cacheUtil) {
  out.push(fs.readFileSync(files.cacheUtil, 'utf8'));
} else { out.push('  NOT FOUND'); }
out.push('');
out.push('---- [8] client.ts: uninstall + discover API calls ----');
if (files.client) {
  const t = fs.readFileSync(files.client, 'utf8');
  out.push(...grabBlock(t, /uninstall|delete.*addon|addons\//i, 8, 'addon api'));
  out.push(...grabBlock(t, /getDiscover/, 8, 'getDiscover'));
}

const report = out.join('\n');
const bundlePath = path.join(ROOT, 'diag_v200_bundle.txt');
fs.writeFileSync(bundlePath, report, 'utf8');
console.log(`[diag_v200] wrote ${bundlePath} (${report.length} bytes)`);

// Auto-upload (Node >= 18)
(async () => {
  try {
    const fd = new FormData();
    fd.append('file', new Blob([report], { type: 'text/plain' }), 'diag_v200_frontend_report.txt');
    const res = await fetch(UPLOAD_URL, { method: 'POST', body: fd, headers: { 'User-Agent': 'Mozilla/5.0 (diag_v200)' } });
    const j = await res.json();
    console.log('[diag_v200] UPLOAD RESULT:', JSON.stringify(j));
    if (j && j.ok) console.log('[diag_v200] DONE — the agent now has your frontend state. Nothing to paste.');
    else throw new Error('upload not ok');
  } catch (e) {
    console.log('[diag_v200] auto-upload failed (' + e.message + ').');
    console.log('[diag_v200] Run this instead:');
    console.log(`  curl.exe -s -X POST ${UPLOAD_URL} -F "file=@diag_v200_bundle.txt;filename=diag_v200_frontend_report.txt"`);
  }
})();
