/* eslint-disable */
// apply_patches_v143_player_perf.js
//
// PLAYER PERF FIX — kill the re-render storm during playback.
//
// Problem (from yesterday's logcat):
//   [PLAYER] Route params - resumePosition: "undefined", parsed: null
//   ...firing 30+ times per second during playback.
//
// Root cause: expo-av's onPlaybackStatusUpdate callback fires at video
// frame rate (~30Hz) during playback / much higher during buffering.
// handlePlaybackStatus calls setPosition(...) on every fire, which
// re-renders the entire PlayerScreen tree.  Additionally, a top-level
// `console.log(\`[PLAYER] Route params...\`)` was placed in the
// component body — it logs on EVERY render of the entire screen.
//
// v143 changes:
//   1. Drop the top-level Route params log (was firing per render).
//   2. Gate the "Setting pending resume position" + "Resume check"
//      logs behind __DEV__ — silent in release builds.
//   3. Throttle setPosition to 500ms inside handlePlaybackStatus.
//      Even if expo-av fires 30 times/sec, we only re-render twice.
//      Seekbar still updates smoothly (2 Hz is fine for a TV UI).
//   4. Explicitly set progressUpdateIntervalMillis={500} on the
//      <Video> component as an extra safeguard.
//
// Idempotent. CRLF-safe. Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v143_player_perf.js -o apply_patches_v143.js && node apply_patches_v143.js
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
  console.error('[v143] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v143';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v143] Backup: ${backupPath}`);
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
// PATCH 1 — drop top-level Route params log (fires every render)
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_drop_toplevel_route_log',
  'PATCH_V143_PERF_NOLOG',
  `  const parsedResumePosition = resumePosition ? parseFloat(resumePosition) : null;
  console.log(\`[PLAYER] Route params - resumePosition: "\${resumePosition}", parsed: \${parsedResumePosition}\`);
  
  const [pendingResumePosition, setPendingResumePosition] = useState<number | null>(parsedResumePosition);`,
  `  const parsedResumePosition = resumePosition ? parseFloat(resumePosition) : null;
  // PATCH_V143_PERF_NOLOG — removed top-level log (was firing every render)
  
  const [pendingResumePosition, setPendingResumePosition] = useState<number | null>(parsedResumePosition);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — gate "Setting pending resume position" log behind __DEV__
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_dev_gate_resume_set_log',
  'PATCH_V143_PERF_DEV1',
  `      if (!isNaN(parsed) && parsed > 0) {
        console.log(\`[PLAYER] Setting pending resume position from route param: \${parsed}s\`);
        setPendingResumePosition(parsed);`,
  `      if (!isNaN(parsed) && parsed > 0) {
        if (__DEV__) console.log(\`[PLAYER] Setting pending resume position from route param: \${parsed}s\`); // PATCH_V143_PERF_DEV1
        setPendingResumePosition(parsed);`
);

// ─────────────────────────────────────────────────────────────
// PATCH 3 — throttle setPosition to 500ms inside handlePlaybackStatus
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p3_throttle_setposition',
  'PATCH_V143_PERF_THROTTLE',
  `  const MIN_DURATION_FOR_CREDITS = 180000; // Only detect credits for videos > 3 minutes
  
  // Handle playback status updates
  const handlePlaybackStatus = (status: AVPlaybackStatus) => {
    if (status.isLoaded) {
      setIsPlaying(status.isPlaying);
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);`,
  `  const MIN_DURATION_FOR_CREDITS = 180000; // Only detect credits for videos > 3 minutes
  
  // PATCH_V143_PERF_THROTTLE — throttle setPosition to ~500ms.
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
// PATCH 4 — gate "Resume check" log behind __DEV__
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p4_dev_gate_resume_check_log',
  'PATCH_V143_PERF_DEV2',
  `        const currentPos = status.positionMillis || 0;
        
        console.log(\`[PLAYER] Resume check: pending=\${pendingResumePosition}s, current=\${currentPos/1000}s, duration=\${totalDuration/1000}s\`);`,
  `        const currentPos = status.positionMillis || 0;
        
        if (__DEV__) console.log(\`[PLAYER] Resume check: pending=\${pendingResumePosition}s, current=\${currentPos/1000}s, duration=\${totalDuration/1000}s\`); // PATCH_V143_PERF_DEV2`
);

// ─────────────────────────────────────────────────────────────
// PATCH 5 — add progressUpdateIntervalMillis={500} to <Video />
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p5_progress_interval',
  'PATCH_V143_PERF_INTERVAL',
  `                shouldPlay
                isLooping={false}
                volume={1.0}
                isMuted={false}
                onPlaybackStatusUpdate={handlePlaybackStatus}`,
  `                shouldPlay
                isLooping={false}
                volume={1.0}
                isMuted={false}
                progressUpdateIntervalMillis={500} /* PATCH_V143_PERF_INTERVAL — match throttle */
                onPlaybackStatusUpdate={handlePlaybackStatus}`
);

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v143] All patches already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v143] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v143] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}

const okCount = reports.filter(r => r.status === 'OK').length;
const skipCount = reports.filter(r => r.status === 'SKIP_IDEMPOTENT').length;
const failCount = reports.length - okCount - skipCount;
console.log(`[v143] Summary: ${okCount} applied, ${skipCount} already-applied, ${failCount} failed.`);
process.exit(failCount > 0 ? 1 : 0);
