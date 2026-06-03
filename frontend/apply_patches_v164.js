/* eslint-disable */
// apply_patches_v164_playback_timeout_cascade.js
//
// Plug the second "Stream timed out" leak.  The PLAYBACK timeout at
// player.tsx ~line 1720 fires 30s after streamUrl is set if playback
// hasn't actually begun.  It currently only tries `tryNextStream()`
// (URL fallbacks — usually empty for the torrent flow) and then
// surfaces "Stream timed out" to the user.
//
// Mirror the onError cascade: when URL fallbacks are exhausted, fall
// through to `tryNextFallbackTorrent()` so a stalled torrent at the
// top of the list automatically advances to the next torrent fallback
// (which the v163 ref-fix now reaches correctly).
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v164.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v164_playback_timeout_cascade.js?v=1" && node apply_patches_v164.js
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
if (!playerPath) { console.error('[v164] FATAL: app/player.tsx not found'); process.exit(1); }

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const bakPath = playerPath + '.bak_v164';
if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, src, 'utf8');

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) { reports.push({ label, status: 'SKIP_IDEMPOTENT' }); return; }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
}

applyOnce(
  'cascade_on_playback_timeout',
  'V164_PLAYBACK_TIMEOUT_CASCADE',
  `      playbackTimeoutRef.current = setTimeout(() => {
        if (!playbackStarted) {
          if (fallbackUrls.length > currentStreamIndex + 1) {
            console.log('[PLAYER] Playback timeout - trying next stream');
            tryNextStream();
          } else {
            // No more fallback streams - show error to user
            console.log('[PLAYER] Playback timeout - no more fallback streams');
            setError('Stream timed out. The source may have too few peers. Try a different stream with more seeds.');
            setIsLoading(false);
          }
        }
      }, 30000); // 30 seconds then try next`,
  `      playbackTimeoutRef.current = setTimeout(() => {
        if (!playbackStarted) {
          if (fallbackUrls.length > currentStreamIndex + 1) {
            console.log('[PLAYER] Playback timeout - trying next stream');
            tryNextStream();
          } else {
            // V164_PLAYBACK_TIMEOUT_CASCADE — before surfacing a hard
            // "Stream timed out" error, fall through to the torrent
            // fallbacks (which v163 made reachable via ref).  This
            // closes the second "all streams failed" leak: user backs
            // out, clicks a different episode, the new debrid URL
            // never starts playback within 30s, we keep trying.
            const _v164_list: any[] = (typeof torrentFallbacksRef !== 'undefined' && torrentFallbacksRef.current && torrentFallbacksRef.current.length > 0)
              ? torrentFallbacksRef.current
              : (torrentFallbacks || []);
            const _v164_idx = (typeof torrentFallbackIdxRef !== 'undefined' && torrentFallbackIdxRef.current) ? torrentFallbackIdxRef.current : 0;
            if (_v164_idx < _v164_list.length) {
              console.log('[v164] Playback timeout - cascading to fallback torrent', _v164_idx + 1, '/', _v164_list.length);
              videoRetryCountRef.current = 0;
              tryNextFallbackTorrent();
            } else {
              console.log('[PLAYER] Playback timeout - no more fallback streams or torrents');
              setError('Stream timed out. The source may have too few peers. Try a different stream with more seeds.');
              setIsLoading(false);
            }
          }
        }
      }, 30000); // 30 seconds then try next`,
);

if (src.length !== originalLen) {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v164] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v164] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
