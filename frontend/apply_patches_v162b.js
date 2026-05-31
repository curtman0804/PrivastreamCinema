/* eslint-disable */
// apply_patches_v162b_tighten_codec_detection.js
//
// v162's codec-error detection was too aggressive: it matched generic
// patterns like "exoplaybackexception", "codec", "decoder", "audiotrack"
// (without "init failed") and "mediacodec".  These match EVERY
// ExoPlayer error including normal buffering hiccups.  So a normal
// transient error fast-failed through all 15 fallbacks in seconds,
// arriving at "Unable to play video — all streams failed" (the warning
// screen) when the stream would have worked with a normal retry.
//
// Fix: tighten the patterns to ONLY clear, permanent codec issues:
//   - "audiotrack init failed"          (DTS-HD MA / TrueHD on Firestick)
//   - "format not supported"
//   - "unsupported format"
//   - "no suitable decoder"
//   - "decoder init failed"
//   - "decoder failed to initialize"
//   - "not playable"
// All other errors get the normal retry-then-advance flow.
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v162b.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v162b_tighten_codec_detection.js?v=1" && node apply_patches_v162b.js
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
if (!playerPath) { console.error('[v162b] FATAL: app/player.tsx not found'); process.exit(1); }

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const bakPath = playerPath + '.bak_v162b';
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
  'tighten_codec_patterns',
  'V162B_TIGHT_CODEC',
  `                    const _v162_isCodecErr = (
                      _v162_errMsg.includes('audiotrack init failed')
                      || _v162_errMsg.includes('audiotrack')
                      || _v162_errMsg.includes('mediacodec')
                      || _v162_errMsg.includes('decoder')
                      || _v162_errMsg.includes('unsupported')
                      || _v162_errMsg.includes('not playable')
                      || _v162_errMsg.includes('format not supported')
                      || _v162_errMsg.includes('exoplaybackexception')
                      || _v162_errMsg.includes('codec')
                    );`,
  `                    // V162B_TIGHT_CODEC — match ONLY clear, permanent codec
                    // problems.  Removed overly-broad patterns ("audiotrack"
                    // without "init failed", bare "codec", bare "decoder",
                    // "mediacodec", "exoplaybackexception") which matched
                    // normal buffering errors and fast-failed every stream.
                    const _v162_isCodecErr = (
                      _v162_errMsg.includes('audiotrack init failed')
                      || _v162_errMsg.includes('format not supported')
                      || _v162_errMsg.includes('unsupported format')
                      || _v162_errMsg.includes('no suitable decoder')
                      || _v162_errMsg.includes('decoder init failed')
                      || _v162_errMsg.includes('decoder failed to initialize')
                      || _v162_errMsg.includes('not playable')
                    );`,
);

if (src.length !== originalLen) {
  fs.writeFileSync(playerPath, src, 'utf8');
  console.log(`[v162b] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
} else {
  console.log('[v162b] No changes (idempotent skip).');
}

console.log('[v162b] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
