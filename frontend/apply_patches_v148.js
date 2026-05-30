/* eslint-disable */
// apply_patches_v148_snap_preresolve.js
//
// SNAP: pre-resolve start_and_wait on Details mount, not on Play click.
//
// From the 50 s R&M timeline:
//
//   19:00:34.880  [DETAILS] Privacy proxy: routing through RD unrestrict
//   19:00:35.096  player mount
//   19:00:35…01:05  ← 30 s of silence: start_and_wait hung
//   19:01:05      Playback timeout
//
//   Second attempt:
//   19:01:45.895  /api/streams cache HIT: 226 ms
//   19:01:45.958  start_and_wait status=ready in 63 ms (already cached server-side)
//   19:01:53.675  Playback started (8 s buffer)
//
// The 30 s wait was the Premiumize resolve on a COLD backend cache.
// On retry it was 63 ms because PM had pre-resolved in the meantime.
//
// v148: fire start_and_wait the moment streams are sorted on Details,
// before the user clicks Play.  By the time they click Play the
// Premiumize URL is already cached server-side — start_and_wait from
// the player will hit the cache and return in < 200 ms.
//
// Complements the existing `api.stream.prewarm` (which just starts the
// torrent on PM's side).  prewarm warms the torrent; v148 warms the URL.
//
// Idempotent.  CRLF-safe.
//
//   curl -s -o apply_patches_v148.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v148_snap_preresolve.js && node apply_patches_v148.js
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
  console.error('[v148] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v148';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v148] Backup: ${backupPath}`);
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
// PATCH — append a sibling useEffect right after the existing
// PREWARM useEffect that fires `start_and_wait` for the top stream.
// Anchor is the closing of the existing PREWARM hook (unchanged by
// any prior patch).
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_preresolve_start_and_wait',
  'PATCH_V148_PRERESOLVE',
  `  // PRE-WARM: When streams are loaded, silently pre-start the top ENGLISH torrent
  // This saves 5-10 seconds of metadata download when user taps play
  const prewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (streams && streams.length > 0 && !isLoadingStreams) {
      // Find the best English stream to prewarm (highest seeders)
      const sorted = sortStreamsByLanguage(streams);
      const topStream = sorted[0]; // English first, highest seeders
      if (topStream?.infoHash && topStream.infoHash !== prewarmedRef.current) {
        prewarmedRef.current = topStream.infoHash;
        console.log(\`[PREWARM] Pre-warming top English stream: \${topStream.infoHash} (\${topStream.title || topStream.name})\`);
        // Pass tracker sources from Torrentio for better peer discovery during prewarm
        api.stream.prewarm(topStream.infoHash, topStream.sources || []);
      }
    }
  }, [streams, isLoadingStreams]);`,
  `  // PRE-WARM: When streams are loaded, silently pre-start the top ENGLISH torrent
  // This saves 5-10 seconds of metadata download when user taps play
  const prewarmedRef = useRef<string | null>(null);
  useEffect(() => {
    if (streams && streams.length > 0 && !isLoadingStreams) {
      // Find the best English stream to prewarm (highest seeders)
      const sorted = sortStreamsByLanguage(streams);
      const topStream = sorted[0]; // English first, highest seeders
      if (topStream?.infoHash && topStream.infoHash !== prewarmedRef.current) {
        prewarmedRef.current = topStream.infoHash;
        console.log(\`[PREWARM] Pre-warming top English stream: \${topStream.infoHash} (\${topStream.title || topStream.name})\`);
        // Pass tracker sources from Torrentio for better peer discovery during prewarm
        api.stream.prewarm(topStream.infoHash, topStream.sources || []);
      }
    }
  }, [streams, isLoadingStreams]);

  // PATCH_V148_PRERESOLVE — fire start_and_wait NOW so the Premiumize URL
  // is cached server-side before user clicks Play.  When player calls
  // start_and_wait later it will hit the cache and return in < 200 ms
  // instead of the cold-cache 5-30 s resolve we saw in the R&M trace.
  const preresolvedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!streams || streams.length === 0 || isLoadingStreams) return;
    const sorted = sortStreamsByLanguage(streams);
    const topStream = sorted[0];
    if (!topStream?.infoHash) return;
    if (topStream.infoHash === preresolvedRef.current) return;
    // Skip if the stream already has a resolved URL (cached at fetch time)
    if ((topStream as any).url) {
      preresolvedRef.current = topStream.infoHash;
      return;
    }
    preresolvedRef.current = topStream.infoHash;
    (async () => {
      try {
        const _authT = await AsyncStorage.getItem('auth_token');
        const _bUrl = process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig as any)?.extra?.backendUrl || '';
        if (!_bUrl) return;
        const _hdrs: any = { 'Content-Type': 'application/json', ...(_authT ? { Authorization: \`Bearer \${_authT}\` } : {}) };
        const _idP = ((id as string) || '').split(':');
        const _sn = _idP.length >= 3 ? parseInt(_idP[_idP.length - 2], 10) : NaN;
        const _en = _idP.length >= 3 ? parseInt(_idP[_idP.length - 1], 10) : NaN;
        const _t0 = Date.now();
        console.log('[PRERESOLVE v148] start_and_wait hash=', topStream.infoHash.slice(0, 8), 'fileIdx=', (topStream as any).fileIdx ?? null);
        // 8 s budget — long enough for cold PM, short enough to not hang on a dead torrent
        const _ctrl = new AbortController();
        const _to = setTimeout(() => _ctrl.abort(), 8000);
        const _resp = await fetch(\`\${_bUrl}/api/stream/start_and_wait\`, {
          method: 'POST',
          headers: _hdrs,
          signal: _ctrl.signal,
          body: JSON.stringify({
            infoHash: topStream.infoHash,
            fileIdx: (topStream as any).fileIdx != null ? (topStream as any).fileIdx : null,
            filename: (topStream as any).filename || null,
            season: isNaN(_sn) ? null : _sn,
            episode: isNaN(_en) ? null : _en,
            timeout_ms: 7500,
          }),
        });
        clearTimeout(_to);
        const _data = await _resp.json().catch(() => ({}));
        const _dt = Date.now() - _t0;
        console.log('[PRERESOLVE v148] status=', _data?.status, 'in', _dt, 'ms');
        // No state update — backend already cached the result.  Next
        // start_and_wait call (from player) will be a cache hit.
      } catch (_e: any) {
        if (_e?.name === 'AbortError') {
          console.log('[PRERESOLVE v148] aborted (8s budget)');
        } else {
          console.log('[PRERESOLVE v148] failed:', _e?.message || _e);
        }
      }
    })();
  }, [streams, isLoadingStreams, id]);`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v148] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v148] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v148] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
