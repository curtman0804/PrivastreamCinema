/* eslint-disable */
// apply_patches_v150_hdr_penalty.js
//
// HDR PENALTY — stop picking dark / hard-to-see streams on SDR displays.
//
// Symptom (Guardians of the Galaxy, yesterday):
//   - Stream picked was a 4K HDR / Dolby-Vision rip
//   - Played back crushed / very dark on the user's display because the
//     device passes HDR metadata but the panel can't tone-map properly
//   - This morning, a different "Continue Watching" attempt happened to
//     resolve a non-HDR copy → looked correct
//
// Existing scoring (id.tsx line 313):
//   if (!info.isHEVC) s += 100;     // mild SDR-ish bonus
//   if (!info.isHDR)  s += 75;      // micro SDR bonus
//
// The +75 SDR bonus is too small to overcome the resolution gap.
// A 4K HDR (QUALITY_PTS['4K']=800)   →  ~800 pts
// A 1080p SDR (QUALITY_PTS['1080p']=600 + 75) → ~675 pts
// HDR wins by ~125, every time.
//
// v150 turns the +75 SDR bonus into a real HDR PENALTY: -800 for any
// stream tagged HDR / Dolby Vision / 10-bit.  Math after:
//   4K HDR    →  800 - 800 = 0
//   4K SDR    →  800 + 75  = 875
//   1080p SDR →  600 + 75  = 675
//   1080p HDR →  600 - 800 = -200
//   720p SDR  →  400 + 75  = 475
//
// Result: any SDR stream at any resolution beats any HDR stream.  HDR
// is still in the candidate list (so playback works if NO SDR copy
// exists), just always picked last.  No toggle needed for now — we can
// add one later if you ever drive an HDR-capable display.
//
// Pairs with v141 (cached-first), v146b (audio codec penalty).
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v150.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v150_hdr_penalty.js?v=1" && node apply_patches_v150.js
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
  console.error('[v150] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v150';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v150] Backup: ${backupPath}`);
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

applyOnce(
  'p1_hdr_penalty',
  'PATCH_V150_HDR',
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;`,
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100;
    /* PATCH_V150_HDR — keep SDR bonus, add real HDR penalty so SDR at any
       resolution always wins over HDR (display can't tone-map → dark image). */
    if (!info.isHDR) s += 75; else s -= 800;`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v150] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v150] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v150] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
