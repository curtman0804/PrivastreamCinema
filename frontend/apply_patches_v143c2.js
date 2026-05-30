/* eslint-disable */
// apply_patches_v143c2_fix_jsx_comment.js
//
// HOTFIX for v143c: I used a `{/* */}` JSX-children comment between the
// <Video> props, which is a syntax error.  Inside JSX attribute lists
// only plain `/* */` comments are legal.  This patch removes the broken
// comment block (the prop it replaces is no longer needed anyway).
//
//   curl -s -o apply_patches_v143c2.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v143c2_fix_jsx_comment.js?v=1" && node apply_patches_v143c2.js
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

const playerPath = find(path.join('app', 'player.tsx'));
if (!playerPath) {
  console.error('[v143c2] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v143c2';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v143c2] Backup: ${backupPath}`);
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

// Remove the broken JSX-children comment.  The next line
// (`onPlaybackStatusUpdate=...`) keeps its position.
applyOnce(
  'p1_strip_bad_comment',
  'PATCH_V143C2_STRIPPED',
  `                {/* PATCH_V143C_REMOVED_INTERVAL — reverted v143's 500ms cadence;
                    default expo-av reporting restored so FF math + auto-next
                    use accurate playhead values. */}
                onPlaybackStatusUpdate={handlePlaybackStatus}`,
  `                /* PATCH_V143C2_STRIPPED — reverted v143's interval cadence so FF math + auto-next read accurate playhead values */
                onPlaybackStatusUpdate={handlePlaybackStatus}`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v143c2] Already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v143c2] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v143c2] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
