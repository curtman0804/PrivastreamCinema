/* eslint-disable */
// apply_patches_v151_preresolve_first_batch.js
//
// SNAP v2: make v148 fire on the first stream batch, not after all addons report.
//
// v148 gates on `isLoadingStreams === false`, which means it waits for
// ALL sources (Torrentio, TPB, backend merge) to come back before firing
// start_and_wait.  In your trace that gate held for 2-3 seconds even
// though a perfectly fine cached stream had arrived in batch 1 (the
// "2 then 14 then 50" pattern you described).
//
// v151 tightens v148 in three ways:
//   1. Drop the `isLoadingStreams` gate — fire as soon as ANY streams arrive.
//   2. Pre-resolve the TOP TWO streams in parallel, so if a slightly better
//      stream lands in batch 2/3 the resolve has a head start.
//   3. Re-fire when the top stream's infoHash changes (better stream arrived).
//
// Backend dedupes concurrent calls (start_resolve = no-op if in-flight),
// so the worst case is two parallel resolves that share a PM pool slot.
//
// Pairs cleanly with v148 — this patch REPLACES the v148-injected useEffect.
// If v148 wasn't applied yet, this script will say NOT_FOUND and stop.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v151.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v151_preresolve_first_batch.js?v=1" && node apply_patches_v151.js
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
  console.error('[v151] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v151';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v151] Backup: ${backupPath}`);
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

// Replace v148's useEffect block with the v151 version.
applyOnce(
  'p1_v148_to_v151_first_batch',
  'PATCH_V151_PRERESOLVE',
  `  // PATCH_V148_PRERESOLVE — fire start_and_wait NOW so the Premiumize URL
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
  }, [streams, isLoadingStreams, id]);`,
  `  // PATCH_V151_PRERESOLVE — superset of v148.  Fire start_and_wait on the
  // FIRST stream batch (no isLoadingStreams gate) and pre-warm the top TWO
  // hashes in parallel so a late-arriving better stream is also ready.
  const preresolvedHashesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!streams || streams.length === 0) return;
    const sorted = sortStreamsByLanguage(streams);
    // Pre-resolve top 2 candidates that don't already have a URL
    const targets = sorted.slice(0, 4).filter((s: any) => s && s.infoHash && !s.url).slice(0, 2);
    if (targets.length === 0) {
      // All top candidates already cached — record their hashes and skip
      for (const s of sorted.slice(0, 2)) {
        if (s?.infoHash) preresolvedHashesRef.current.add(s.infoHash);
      }
      return;
    }
    for (const tgt of targets) {
      if (preresolvedHashesRef.current.has(tgt.infoHash)) continue;
      preresolvedHashesRef.current.add(tgt.infoHash);
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
          console.log('[PRERESOLVE v151] start_and_wait hash=', tgt.infoHash.slice(0, 8), 'fileIdx=', tgt.fileIdx ?? null);
          const _ctrl = new AbortController();
          const _to = setTimeout(() => _ctrl.abort(), 8000);
          const _resp = await fetch(\`\${_bUrl}/api/stream/start_and_wait\`, {
            method: 'POST',
            headers: _hdrs,
            signal: _ctrl.signal,
            body: JSON.stringify({
              infoHash: tgt.infoHash,
              fileIdx: tgt.fileIdx != null ? tgt.fileIdx : null,
              filename: tgt.filename || null,
              season: isNaN(_sn) ? null : _sn,
              episode: isNaN(_en) ? null : _en,
              timeout_ms: 7500,
            }),
          });
          clearTimeout(_to);
          const _data = await _resp.json().catch(() => ({}));
          const _dt = Date.now() - _t0;
          console.log('[PRERESOLVE v151] hash=', tgt.infoHash.slice(0, 8), 'status=', _data?.status, 'in', _dt, 'ms');
        } catch (_e: any) {
          if (_e?.name === 'AbortError') {
            console.log('[PRERESOLVE v151] aborted (8s budget) hash=', tgt.infoHash.slice(0, 8));
          } else {
            console.log('[PRERESOLVE v151] failed:', _e?.message || _e);
          }
        }
      })();
    }
  }, [streams, id]);`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v151] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v151] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v151] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
