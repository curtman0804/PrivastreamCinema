/* eslint-disable */
// apply_patches_v143c_revert_position_throttle.js
//
// REVERT the v143b setPosition throttle + v143 progressUpdateIntervalMillis.
//
// Symptom after v143b landed:
//   - Holding FF: moves in 10s increments but only ~1 step per second held
//   - UI shows position 3:05 while video is actually playing S1E2 content
//
// Root cause: combining setPosition throttle (500ms) + progressUpdateIntervalMillis=500
// means React's `position` state can lag the actual playhead by up to 1000ms.
// Any logic that derives a NEW seek target from `position` overshoots, and
// the credits/auto-next-episode check can fire while the UI still shows an
// early time.  Seekbar drift is purely cosmetic; auto-next is functional and
// not acceptable.
//
// v143c keeps the SAFE perf wins from v143:
//   • Top-level Route-params log dropped (per-render log removed) ✓
//   • Resume / resume-check logs gated behind __DEV__         ✓
//
// and REVERTS the dangerous parts:
//   ✗ setPosition throttle (now fires every status update)
//   ✗ progressUpdateIntervalMillis={500} (returns to expo-av default,
//      which gives the FF handler accurate frame-rate updates)
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v143c.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v143c_revert_position_throttle.js?v=1" && node apply_patches_v143c.js
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
  console.error('[v143c] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v143c';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v143c] Backup: ${backupPath}`);
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
// PATCH 1 — Revert the setPosition throttle.  Anchor exactly on
// the v143b/p3b-injected block.
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_revert_setposition_throttle',
  'PATCH_V143C_NO_THROTTLE',
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
      setDuration(status.durationMillis || 0);`,
  `  // PATCH_V143C_NO_THROTTLE — reverted v143b's setPosition throttle because
  // it desynced the UI position from the actual playhead, breaking the FF
  // handler (which read state to compute the next seek target) and tripping
  // credits/auto-next-episode logic at the wrong moment.
  
  // Handle playback status updates
  const handlePlaybackStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — Remove progressUpdateIntervalMillis so expo-av falls
// back to its default high-frequency reporting (gives the seekbar
// and FF/auto-next logic accurate values).
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_revert_progress_interval',
  'PATCH_V143C_REMOVED_INTERVAL',
  `                progressUpdateIntervalMillis={500} /* PATCH_V143_PERF_INTERVAL — match throttle */
                onPlaybackStatusUpdate={handlePlaybackStatus}`,
  `                {/* PATCH_V143C_REMOVED_INTERVAL — reverted v143's 500ms cadence;
                    default expo-av reporting restored so FF math + auto-next
                    use accurate playhead values. */}
                onPlaybackStatusUpdate={handlePlaybackStatus}`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v143c] Already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v143c] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v143c] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
