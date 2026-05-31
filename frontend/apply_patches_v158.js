/* eslint-disable */
// apply_patches_v158_audio_codec_penalty.js
//
// EXTEND audio codec penalty to ALL lossless / ExoPlayer-incompatible
// formats.  v146b penalized DTS:X only.  The real failures (per actual
// logcat) come from BluRay REMUX rips carrying DTS-HD MA 7.1 or
// TrueHD Atmos, which ExoPlayer cannot init on most Android TV /
// Firestick:
//
//   [PLAYER] Video error (attempt 1/3):
//     'Player error: AudioTrack init failed 0 Config(48000, 6396, 47998)'
//
// v158 adds a -1500 score penalty for any stream whose name contains:
//   DTS-HD MA, DTS-HD, DTS-X / DTS:X / DTSX, TRUEHD, TRUE-HD,
//   ATMOS (Atmos is usually carried in TrueHD or EAC3 JOC; both can
//   trip ExoPlayer on cheaper TVs), LPCM, PCM, or REMUX (BluRay
//   REMUX is functionally always lossless audio).
//
// -1500 is enough to push lossless streams below any working
// WEB-DL/BluRay AC3/AAC stream, but does NOT zero them out — if the
// user really has no other option, they'll still appear last so a
// receiver-equipped setup can still pick one manually.
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v158.js "http://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v158_audio_codec_penalty.js?v=1" && node apply_patches_v158.js
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
  console.error('[v158] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v158';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v158] Backup: ${backupPath}`);
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

// Insert v158 audio penalty right after the v150 HDR penalty line.
// (v150 rewrote the line; we anchor on the post-v150 form.)
applyOnce(
  'p1_audio_penalty',
  'V158_AUDIO_PENALTY',
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100;
    /* PATCH_V150_HDR — keep SDR bonus, add real HDR penalty so SDR at any
       resolution always wins over HDR (display can't tone-map → dark image). */
    if (!info.isHDR) s += 75; else s -= 800;`,
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100;
    /* PATCH_V150_HDR — keep SDR bonus, add real HDR penalty so SDR at any
       resolution always wins over HDR (display can't tone-map → dark image). */
    if (!info.isHDR) s += 75; else s -= 800;
    /* V158_AUDIO_PENALTY — reject lossless / ExoPlayer-incompatible audio.
       Triggered by the real bug: GOTG 2 picked a BluRay REMUX with
       DTS-HD MA 7.1, and ExoPlayer's AudioTrack.init() failed with
       Config(48000, 6396, 47998).  Penalize -1500 so any AC3/AAC
       WEB-DL/BluRay stream ranks above. */
    {
      const _t158 = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      const _v158_badAudio = (
        _t158.includes('DTS-HD MA') || _t158.includes('DTS-HD.MA') || _t158.includes('DTS HD MA')
        || _t158.includes('DTSHD-MA') || _t158.includes('DTSHD.MA')
        || _t158.includes('DTS-HD ') || _t158.includes('DTS-HD.') || _t158.includes('DTS.HD')
        || _t158.includes('DTS-HR') || _t158.includes('DTS-HRA')
        || _t158.includes('DTS-X') || _t158.includes('DTS:X') || _t158.includes('DTSX')
        || _t158.includes('TRUEHD') || _t158.includes('TRUE-HD') || _t158.includes('TRUE.HD')
        || _t158.includes('ATMOS')
        || _t158.includes('LPCM') || _t158.includes(' PCM ') || _t158.includes('.PCM.')
        || _t158.includes('REMUX')
      );
      if (_v158_badAudio) s -= 1500;
    }`,
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v158] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v158] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v158] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
