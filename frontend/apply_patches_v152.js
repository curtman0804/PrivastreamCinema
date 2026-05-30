/* eslint-disable */
// apply_patches_v152_strip_video_useragent.js
//
// PLAYBACK STALL FIX — let ExoPlayer use its default User-Agent.
//
// Observed (this morning's log): four different cached 1080p x264/x265
// Premiumize CDN URLs all open a TCP connection then sit silently for
// 30s before "Playback timeout - no more fallback streams".  No
// ExoPlayer error, no HTTP error, no audio error.
//
// Premiumize CDN URLs are session-bound and PM verifies the User-Agent
// on the redemption request.  player.tsx was overriding the Video
// source's UA to a desktop Chrome string while the backend's PM resolve
// uses a different (Python) UA.  Stremio doesn't override the UA and
// it works for the same URLs.
//
// v152 removes the custom UA so ExoPlayer uses its default
// ("ExoPlayerLib/2.x.x") which PM allows through.
//
//   curl -s -o apply_patches_v152.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v152_strip_video_useragent.js?v=1" && node apply_patches_v152.js
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
  console.error('[v152] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v152';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v152] Backup: ${backupPath}`);
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
  'p1_strip_custom_ua',
  'PATCH_V152_NO_UA_OVERRIDE',
  `                  // Help ExoPlayer detect format - important for MKV/x265 streams
                  overrideFileExtensionAndroid: (isLiveTV || streamUrl.includes('.m3u8') || isLive === 'true') ? 'm3u8' : 'mp4',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  },
                }}`,
  `                  // Help ExoPlayer detect format - important for MKV/x265 streams
                  overrideFileExtensionAndroid: (isLiveTV || streamUrl.includes('.m3u8') || isLive === 'true') ? 'm3u8' : 'mp4',
                  /* PATCH_V152_NO_UA_OVERRIDE — removed desktop Chrome UA override.
                     PM CDN refuses to send bytes when the redemption UA differs
                     from what was used to obtain the URL.  ExoPlayer's default UA
                     (ExoPlayerLib/2.x) is what Stremio uses and PM accepts. */
                }}`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v152] Already applied — no changes written.');
} else {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v152] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v152] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
