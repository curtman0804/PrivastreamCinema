/* eslint-disable */
// apply_patches_v143b_throttle_only.js
//
// FOLLOW-UP to v143: the throttle patch (p3) couldn't find its anchor
// because the v136 prewarm block (added since the upload snapshot)
// sits between `MIN_DURATION_FOR_CREDITS` and `handlePlaybackStatus`.
//
// v143b uses a tighter, local anchor that doesn't depend on
// MIN_DURATION_FOR_CREDITS being adjacent to handlePlaybackStatus.
// All other v143 patches (p1, p2, p4, p5) already landed.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v143b.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v143b_throttle_only.js && node apply_patches_v143b.js
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
  console.error('[v143b] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v143b';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v143b] Backup: ${backupPath}`);
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

// ─────────────────────────────────────────────────────────────
// PATCH — throttle setPosition (tight anchor; ignores prewarm block)
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p3b_throttle_setposition_tight_anchor',
  'PATCH_V143_PERF_THROTTLE',
  `  // Handle playback status updates
  const handlePlaybackStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);`,
  `  // PATCH_V143_PERF_THROTTLE — throttle setPosition to ~500ms.
  // expo-av fires onPlaybackStatusUpdate at video frame rate during playback
  // and at much higher rate during buffering, causing 30+ re-renders/sec of
  // the entire player tree. Throttling keeps the seekbar at 2 Hz (smooth
  // enough for a TV UI) while eliminating the re-render storm.
  const lastPositionUpdateMsRef = useRef<number>(0);
  
  // Handle playback status updates
  const handlePlaybackStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      const _v143Now = Date.now();
      if (_v143Now - lastPositionUpdateMsRef.current >= 500) {
        lastPositionUpdateMsRef.current = _v143Now;
        setPosition(status.positionMillis);
      }
      setDuration(status.durationMillis || 0);`
);

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v143b] Already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v143b] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v143b] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
