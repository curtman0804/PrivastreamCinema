/* eslint-disable */
// apply_patches_v149_smooth_loading_transition.js
//
// SMOOTH: kill the visual jump when navigating Details → Player.
//
// The two "Loading…" overlays already exist (Details' autoPlayOverlay
// + Player's PATCH_V8_UNIFIED_LOADING).  They look almost identical
// but have five subtle differences that, combined with a non-zero
// router transition, produce a perceptible "screen jump":
//
//                Details (AutoPlayLoadingBar)      Player (loadingBarAnim)
//   Track width  260 px (fixed)                    min(W*0.6, 480) px
//   Bar width    100 px                            120 px
//   Bar height   4 px                              3 px
//   Track alpha  rgba(255,255,255,0.12)            rgba(255,255,255,0.15)
//   Cycle        1200 ms inOut.ease                1400 ms linear
//   Bar phase    starts at -100 on mount           starts at -120 on mount
//
// v149 makes Player adopt Details' bar exactly: 260 × 4 px track,
// 100 × 4 px slider, 1200 ms inOut.ease, 0.12 alpha track.  And it
// derives the initial bar offset from Date.now() % 1200 so the
// player's bar starts at the same wall-clock phase the details bar
// was at when the user pressed Play — no visible reset.
//
// Combined with v148 (which slashes the buffer time so the overlay
// is on-screen briefly anyway), Details → Player feels like a single
// continuous loading screen.
//
// Idempotent.  CRLF-safe.
//
//   curl -s -o apply_patches_v149.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v149_smooth_loading_transition.js && node apply_patches_v149.js
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
  console.error('[v149] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v149';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v149] Backup: ${backupPath}`);
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
// PATCH 1 — replace the loadingBarAnim init + animation params so
// they exactly match Details' AutoPlayLoadingBar (260 / 100 / 1200 /
// inOut.ease) AND start the bar at the matching wall-clock phase.
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_match_loading_bar',
  'PATCH_V149_SMOOTH_BAR',
  `  const loadingBarAnim = useRef(new Animated.Value(-120)).current;`,
  `  // PATCH_V149_SMOOTH_BAR — initial offset derived from wall-clock so the
  // bar starts where Details' AutoPlayLoadingBar was when user pressed Play.
  // Details cycle = 1200 ms, range -100 → 260, inOut.ease.
  const _v149InitOffset = (() => {
    const _phase = (Date.now() % 1200) / 1200;            // 0..1 within cycle
    // Approximate inOut.ease with a smoothstep; close enough to avoid the snap
    const _e = _phase < 0.5 ? 2 * _phase * _phase : 1 - Math.pow(-2 * _phase + 2, 2) / 2;
    return -100 + _e * 360;                                // span = 260 - (-100)
  })();
  const loadingBarAnim = useRef(new Animated.Value(_v149InitOffset)).current;`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — match Details' animation params (1200 ms inOut.ease,
// slide from -100 to 260; instant reset to -100).
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_match_loading_loop',
  'PATCH_V149_SMOOTH_LOOP',
  `        Animated.timing(loadingBarAnim, { toValue: w * 0.6, duration: 1400, useNativeDriver: true }),
        Animated.timing(loadingBarAnim, { toValue: -120, duration: 0, useNativeDriver: true }),`,
  `        // PATCH_V149_SMOOTH_LOOP — exact-match Details' bar (1200ms inOut.ease, -100..260)
        Animated.timing(loadingBarAnim, { toValue: 260, duration: 1200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(loadingBarAnim, { toValue: -100, duration: 0, useNativeDriver: true }),`
);

// ─────────────────────────────────────────────────────────────
// PATCH 3 — match Details' track + slider dimensions / alpha in
// the unified loading view.
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p3_match_loading_track',
  'PATCH_V149_SMOOTH_TRACK',
  `            {/* Indeterminate sliding gold bar */}
            <View
              style={{
                width: Math.min(Dimensions.get('window').width * 0.6, 480),
                height: 3,
                backgroundColor: 'rgba(255,255,255,0.15)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 120,
                  height: '100%',
                  backgroundColor: '#B8A05C',
                  borderRadius: 2,
                  transform: [{ translateX: loadingBarAnim }],
                }}
              />
            </View>`,
  `            {/* Indeterminate sliding gold bar — PATCH_V149_SMOOTH_TRACK
                exact-match Details' AutoPlayLoadingBar (260×4 track, 100×4 slider, 0.12 alpha) */}
            <View
              style={{
                width: 260,
                height: 4,
                backgroundColor: 'rgba(255,255,255,0.12)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: 100,
                  height: 4,
                  backgroundColor: '#B8A05C',
                  borderRadius: 2,
                  transform: [{ translateX: loadingBarAnim }],
                }}
              />
            </View>`
);

// ─────────────────────────────────────────────────────────────
// PATCH 4 — ensure Easing is imported from 'react-native'.
// ─────────────────────────────────────────────────────────────
{
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/);
  if (m && /\bEasing\b/.test(m[1])) {
    reports.push({ label: 'p4_easing_import', status: 'SKIP_ALREADY_IMPORTED' });
  } else if (m && /\bAnimated\b/.test(m[1])) {
    const before = src;
    src = src.replace(m[0], m[0].replace(/\bAnimated\b/, 'Animated, Easing'));
    if (src !== before) {
      reports.push({ label: 'p4_easing_import', status: 'OK', delta: src.length - before.length });
    } else {
      reports.push({ label: 'p4_easing_import', status: 'NOT_FOUND' });
    }
  } else {
    reports.push({ label: 'p4_easing_import', status: 'NOT_FOUND' });
  }
}

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT' || r.status === 'SKIP_ALREADY_IMPORTED')) {
  console.log('[v149] Already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v149] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v149] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT' && r.status !== 'SKIP_ALREADY_IMPORTED').length;
process.exit(failCount > 0 ? 1 : 0);
