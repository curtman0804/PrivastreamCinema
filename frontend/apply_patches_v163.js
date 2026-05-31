/* eslint-disable */
// apply_patches_v163_fallback_ref_fix.js
//
// REAL FIX for "Play button → all streams failed" while clicking the 3rd
// card directly DOES work.
//
// Root cause (the closure timing bug):
//   In player.tsx useEffect:
//     line 1875: setTorrentFallbacks(parsed)   // STATE update — queued, async
//     line 1898: startTorrentStream()           // sets up polling closure NOW
//   The polling closure captures `torrentFallbacks` from the CURRENT render,
//   which still has the initial value [] because the state hasn't flushed
//   yet.  When the primary stream fails and the cascade calls
//   tryNextFallbackTorrent(), the closure-captured torrentFallbacks is
//   still [].  So the cascade says "no more fallback streams or torrents
//   available" — even though we just logged "[PLAYER] Loaded 4 fallback
//   torrents" 1 second earlier.
//
// Fix: keep the parsed fallback array in a useRef alongside the state.
// useRef.current is read synchronously and is never stale.
//
// Also: tighten v162's overly-aggressive codec-fast-fail patterns and
// drop the redundant "audiotrack" / "exoplaybackexception" matchers
// (these matched ordinary buffering errors and caused the orange
// "unexpected error" screen).  We now ONLY fast-fail on patterns that
// indicate a permanent decode failure.  (Same set as v162b, kept here
// in case v162b was skipped or rolled back.)
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v163.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v163_fallback_ref_fix.js?v=1" && node apply_patches_v163.js
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
if (!playerPath) { console.error('[v163] FATAL: app/player.tsx not found'); process.exit(1); }

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const bakPath = playerPath + '.bak_v163';
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

// ============================================================
// 1) Declare the ref alongside torrentFallbackIdxRef (line 420).
// ============================================================
applyOnce(
  '1_declare_fallback_ref',
  'V163_TORRENT_FALLBACKS_REF',
  `  const torrentFallbackIdxRef = useRef(0);`,
  `  const torrentFallbackIdxRef = useRef(0);
  // V163_TORRENT_FALLBACKS_REF — the React STATE \`torrentFallbacks\` cannot
  // be read from closures that were created BEFORE the state update
  // flushed (see the parseFallbacks → startTorrentStream race in
  // useEffect).  This ref mirrors the state and is read synchronously
  // by tryNextFallbackTorrent so the cascade actually sees the
  // available fallbacks.
  const torrentFallbacksRef = useRef<any[]>([]);`,
);

// ============================================================
// 2) Mirror the state into the ref the instant we parse fallbacks.
// ============================================================
applyOnce(
  '2_mirror_into_ref',
  'V163_MIRROR_REF',
  `        if (Array.isArray(parsed)) {
          setTorrentFallbacks(parsed);
          torrentFallbackIdxRef.current = 0;
          console.log('[PLAYER] Loaded', parsed.length, 'fallback torrents');
        }`,
  `        if (Array.isArray(parsed)) {
          setTorrentFallbacks(parsed);
          torrentFallbacksRef.current = parsed; // V163_MIRROR_REF — read-now-safe
          torrentFallbackIdxRef.current = 0;
          console.log('[PLAYER] Loaded', parsed.length, 'fallback torrents (ref synced)');
        }`,
);

// ============================================================
// 3) Read from the ref inside tryNextFallbackTorrent so it can never
// be stale.
// ============================================================
applyOnce(
  '3_use_ref_in_try_next',
  'V163_TRY_NEXT_USES_REF',
  `  const tryNextFallbackTorrent = () => {
    const idx = torrentFallbackIdxRef.current;
    if (idx < torrentFallbacks.length) {
      const fb = torrentFallbacks[idx];
      torrentFallbackIdxRef.current = idx + 1;
      console.log(\`[PLAYER] Trying fallback torrent \${idx + 1}/\${torrentFallbacks.length}: \${fb.infoHash?.slice(0,8)}... (\${fb.name || fb.title || ''})\`);`,
  `  const tryNextFallbackTorrent = () => {
    /* V163_TRY_NEXT_USES_REF — read from torrentFallbacksRef.current so
       the cascade is not held hostage by React's async state update. */
    const _v163_list: any[] = (torrentFallbacksRef.current && torrentFallbacksRef.current.length > 0)
      ? torrentFallbacksRef.current
      : (torrentFallbacks || []);
    const idx = torrentFallbackIdxRef.current;
    if (idx < _v163_list.length) {
      const fb = _v163_list[idx];
      torrentFallbackIdxRef.current = idx + 1;
      console.log(\`[PLAYER] Trying fallback torrent \${idx + 1}/\${_v163_list.length}: \${fb.infoHash?.slice(0,8)}... (\${fb.name || fb.title || ''})\`);`,
);

// ============================================================
// 4) Tighten v162's codec patterns (defensive — applies whether or
// not v162b was already applied).
// ============================================================
applyOnce(
  '4_tighten_codec_patterns',
  'V163_TIGHT_CODEC',
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
  `                    /* V163_TIGHT_CODEC */
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
  console.log(`[v163] Wrote ${playerPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v163] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
