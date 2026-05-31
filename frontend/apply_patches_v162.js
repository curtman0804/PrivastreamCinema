/* eslint-disable */
// apply_patches_v162_play_at_all_costs.js
//
// "Play button at all costs" — when the top-ranked stream fails to
// play (typically due to a codec/audio decode error like
// `AudioTrack init failed Config(48000, 6396, ...)`), the player
// should immediately fall through to the next stream, NOT retry the
// same broken URL 15 times before giving up.
//
// Three surgical changes:
//
//   1) id.tsx — widen the torrent-fallback list from 5 to 15 streams.
//      With the wider list we always have a working option even when
//      the top 5 are all REMUX/lossless variants the TV can't decode.
//
//   2) player.tsx onError — detect codec/decode errors (AudioTrack
//      init failed, MediaCodec failure, Unsupported, etc.) and
//      IMMEDIATELY advance to the next fallback torrent instead of
//      burning 15 retries (~45s) on a stream the device can never
//      play.
//
//   3) player.tsx — lower maxVideoRetries from 15 → 6 for torrent
//      streams.  Six retries × 1-5s backoff is still enough headroom
//      for torrent buffer warmup, but caps the worst-case wait when
//      a stream is simply broken.
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v162.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v162_play_at_all_costs.js?v=1" && node apply_patches_v162.js
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
const playerPath = find(path.join('app', 'player.tsx'));
const missing = [];
if (!idPath) missing.push('app/details/[type]/[id].tsx');
if (!playerPath) missing.push('app/player.tsx');
if (missing.length) { console.error('[v162] FATAL: missing ' + missing.join(', ')); process.exit(1); }

const reports = [];
function patchFile(absPath, label, marker, oldStr, newStr) {
  let src = fs.readFileSync(absPath, 'utf8');
  const NL = src.includes('\r\n') ? '\r\n' : '\n';
  if (marker && src.indexOf(marker) !== -1) { reports.push({ file: path.basename(absPath), label, status: 'SKIP_IDEMPOTENT' }); return; }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ file: path.basename(absPath), label, status: 'NOT_FOUND' }); return; }
  if (occurrences > 1)  { reports.push({ file: path.basename(absPath), label, status: 'AMBIGUOUS', count: occurrences }); return; }
  const bakPath = absPath + '.bak_v162';
  if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, src, 'utf8');
  const before = src.length;
  src = src.replace(old2, new2);
  fs.writeFileSync(absPath, src, 'utf8');
  reports.push({ file: path.basename(absPath), label, status: 'OK', delta: src.length - before });
}

// ============================================================
// (1) id.tsx — widen fallback torrents from 5 → 15
// ============================================================
patchFile(idPath, '1_widen_fallback_torrents', 'V162_WIDER_FALLBACKS',
  `      // Build fallback torrents from other available torrent streams (sorted by seeders)
      const sortedStreams = sortStreamsByLanguage(streams);
      const fallbackTorrents = sortedStreams
        .filter(s => s.infoHash && s.infoHash !== stream.infoHash)
        .slice(0, 5)
        .map(s => ({`,
  `      // Build fallback torrents from other available torrent streams (sorted by seeders)
      // V162_WIDER_FALLBACKS — bumped from 5 to 15 so we always have a working
      // option even when the top picks share the same codec / lossless-audio
      // incompatibility that the device can't decode.
      const sortedStreams = sortStreamsByLanguage(streams);
      const fallbackTorrents = sortedStreams
        .filter(s => s.infoHash && s.infoHash !== stream.infoHash)
        .slice(0, 15)
        .map(s => ({`,
);

// ============================================================
// (2) player.tsx — lower torrent maxVideoRetries from 15 → 6
// ============================================================
patchFile(playerPath, '2_lower_max_retries', 'V162_RETRIES_LOWERED',
  `  const maxVideoRetries = isLive === 'true' ? 10 : directUrl ? 3 : 15; // Direct URLs fail fast, torrents need more time`,
  `  // V162_RETRIES_LOWERED — torrents used to retry 15× (~45s) on broken
  // streams before falling through to the next fallback.  6 retries with
  // 1-5s backoff (≤18s) is still enough headroom for buffer warmup but
  // gives "play at all costs" a chance to advance to the next stream.
  const maxVideoRetries = isLive === 'true' ? 10 : directUrl ? 3 : 6;`,
);

// ============================================================
// (3) player.tsx — fast-fail on codec/decoder errors.  Inject right
// AFTER the seek-cooldown guard and BEFORE the existing retry block.
// ============================================================
patchFile(playerPath, '3_fast_fail_on_codec', 'V162_CODEC_FAST_FAIL',
  `                  // PATCH_V10_COOLDOWN_GUARD — if a seek just failed, ignore the onError storm.
                  // ExoPlayer keeps emitting errors at the bad position; we already rewound.
                  if (Date.now() < seekCooldownUntilRef.current) {
                    console.log('[PLAYER] post-seek cooldown active, ignoring onError');
                    return;
                  }

                  // Retry aggressively - torrent data arrives progressively, each retry may succeed
                  if (videoRetryCountRef.current < maxVideoRetries) {`,
  `                  // PATCH_V10_COOLDOWN_GUARD — if a seek just failed, ignore the onError storm.
                  // ExoPlayer keeps emitting errors at the bad position; we already rewound.
                  if (Date.now() < seekCooldownUntilRef.current) {
                    console.log('[PLAYER] post-seek cooldown active, ignoring onError');
                    return;
                  }

                  // V162_CODEC_FAST_FAIL — detect codec / decode errors that no
                  // amount of retrying will fix (DTS-HD MA on a Firestick, etc.).
                  // Skip the retry loop and jump straight to the next fallback
                  // torrent so the user actually gets playback.
                  try {
                    const _v162_errMsg = String(
                      (error && typeof error === 'object' && (error as any).message)
                        ? (error as any).message
                        : error
                    ).toLowerCase();
                    const _v162_isCodecErr = (
                      _v162_errMsg.includes('audiotrack init failed')
                      || _v162_errMsg.includes('audiotrack')
                      || _v162_errMsg.includes('mediacodec')
                      || _v162_errMsg.includes('decoder')
                      || _v162_errMsg.includes('unsupported')
                      || _v162_errMsg.includes('not playable')
                      || _v162_errMsg.includes('format not supported')
                      || _v162_errMsg.includes('exoplaybackexception')
                      || _v162_errMsg.includes('codec')
                    );
                    if (_v162_isCodecErr) {
                      console.log('[v162] Codec/decode error — skipping retries, advancing to next stream:', _v162_errMsg.slice(0, 200));
                      videoRetryCountRef.current = 0;
                      // Prefer URL fallbacks if available (cached debrid links),
                      // otherwise fall through to the next torrent.
                      if (fallbackUrls.length > currentStreamIndex + 1) {
                        tryNextStream();
                      } else {
                        tryNextFallbackTorrent();
                      }
                      return;
                    }
                  } catch (_v162_e) { /* ignore — fall through to normal retry */ }

                  // Retry aggressively - torrent data arrives progressively, each retry may succeed
                  if (videoRetryCountRef.current < maxVideoRetries) {`,
);

// ============================================================
console.log('[v162] Report:');
for (const r of reports) {
  console.log('  ', r.file, '·', r.label, '→', r.status,
    r.delta !== undefined ? `(Δ${r.delta})` : '',
    r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
