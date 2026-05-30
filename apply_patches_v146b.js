/* eslint-disable */
// apply_patches_v146b_audio_codec_penalty.js
//
// Same as v146 but re-anchored.  v141 had inserted a multi-line comment
// block between the HEVC/HDR scoring line and the `if (stream.url)`
// line, so v146's two-line anchor missed.  v146b uses just the HEVC/HDR
// line as the anchor and inserts the penalty immediately after it.
//
// Windows CMD:
//
//   curl -s -o apply_patches_v146b.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v146b_audio_codec_penalty.js && node apply_patches_v146b.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!idPath) {
  console.error('[v146b] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v146b';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v146b] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// Single-line anchor — independent of v141's inserted block below it.
applyOnce(
  'p1_audio_codec_penalty',
  'PATCH_V146_AUDIO_PENALTY',
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;`,
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;
    /* PATCH_V146_AUDIO_PENALTY — penalize audio codecs that the Google TV
       Streamer / Firestick can't initialize at runtime even when ExoPlayer
       reports format_supported=YES.  Order matters: most specific first. */
    {
      const _v146t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      if (/\\bDTS[\\s\\-:]?X\\b|\\bDTSX\\b/.test(_v146t)) {
        s -= 900;
      } else if (/\\bTRUEHD\\b|\\bTRUE[\\s\\-]?HD\\b/.test(_v146t)) {
        s -= 800;
      } else if (/\\bATMOS\\b/.test(_v146t)) {
        s -= 700;
      } else if (/\\bDTS[\\s\\-]?HD(\\s*MA)?\\b/.test(_v146t)) {
        s -= 400;
      } else if (/\\bDTS\\b/.test(_v146t)) {
        s -= 100;
      }
    }`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v146b] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v146b] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v146b] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
