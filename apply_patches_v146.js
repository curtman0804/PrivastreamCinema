/* eslint-disable */
// apply_patches_v146_audio_codec_penalty.js
//
// AUDIO CODEC PENALTY — stop picking streams the device can't decode.
//
// Symptom from your latest logcat:
//
//   Format(2, DTS:X 7.1, ..., audio/vnd.dts, [8, 48000]), format_supported=YES
//   AudioSink$InitializationException: AudioTrack init failed 0 Config(48000, 6396, 47998)
//   Caused by: java.lang.UnsupportedOperationException: Cannot create AudioTrack
//
// Translation: ExoPlayer's static codec capability lookup says "yes I can
// decode DTS:X" (because the parser exists), but when AudioTrack actually
// tries to instantiate at runtime with an 8-channel DTS:X object-audio
// config (channel mask 6396), the hardware refuses.  Google TV Streamer
// and Firestick both fail DTS:X / TrueHD / Atmos JOC unless an Atmos AVR
// is downstream over HDMI eARC.
//
// v141 correctly picked the highest-quality cached stream — which
// happened to be "Hot Fuzz 2007.UHD.BluRay.2160p.DTS-X.7.1.HEVC-DDR.mkv".
// Five cached streams were available; the sort never cared about audio
// codec compatibility, so it kept handing the player a file it can't
// render.  Player errors → onError retry → same DTS:X stream → flashing.
//
// v146 adds an audio codec compatibility penalty inside computeScore so
// hardware-incompatible audio loses to standard codecs even at a lower
// resolution:
//
//   DTS:X / DTS-X / DTSX            -900 (object audio, never works without Atmos AVR)
//   TrueHD                          -800 (lossless, Atmos-only path on TV sticks)
//   Atmos (any "ATMOS" tag)         -700 (E-AC-3 JOC fallback is unreliable)
//   DTS-HD MA / DTS-HD              -400 (often works via passthrough, sometimes not)
//   plain DTS / DTS 5.1             -100 (usually works)
//   AC-3 / EAC-3 / AAC / OPUS / no tag → 0 (universal)
//
// Penalty floors are tuned so:
//   • 1080p AC3  (score ~1650) beats 4K DTS:X (1850 - 900 = 950)
//   • 4K AC3     (score ~1850) beats 4K DTS:X
//   • 4K DTS-HD MA (1850-400=1450) still loses to 1080p AC3 (1650) on
//     devices that hate DTS-HD, but beats 720p AC3 — reasonable.
//
// Pairs with v141.  Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v146.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v146_audio_codec_penalty.js && node apply_patches_v146.js
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
  console.error('[v146] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v146';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v146] Backup: ${backupPath}`);
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
// PATCH — insert codec penalty inside computeScore right after the
// HEVC/HDR rebalance line, before the cached-URL boost.  The anchor
// is unchanged by v141 (v141 only modified the lines below it).
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_audio_codec_penalty',
  'PATCH_V146_AUDIO_PENALTY',
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;
    if (stream.url) s += 50;`,
  `    /* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;
    /* PATCH_V146_AUDIO_PENALTY — penalize audio codecs that the Google TV
       Streamer / Firestick can't initialize at runtime even when ExoPlayer
       reports format_supported=YES.  Order matters: check the most specific
       string first (DTS:X) so we don't double-penalize via the DTS-HD branch. */
    {
      const _v146t = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();
      if (/\\bDTS[\\s\\-:]?X\\b|\\bDTSX\\b/.test(_v146t)) {
        s -= 900;
      } else if (/\\bTRUEHD\\b|\\bTRUE[\\s\\-]?HD\\b/.test(_v146t)) {
        s -= 800;
      } else if (/\\bATMOS\\b/.test(_v146t)) {
        s -= 700;
      } else if (/\\bDTS[\\s\\-]?HD(\\s*MA)?\\b/.test(_v146t)) {
        s -= 400;
      } else if (/\\bDTS\\b/.test(_v146t)) {
        s -= 100;
      }
    }
    if (stream.url) s += 50;`
);

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v146] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v146] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v146] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
