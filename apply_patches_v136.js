/* eslint-disable */
// apply_patches_v136_prewarm_next_episode.js
//
// FASTER STREAMS + ONE LOADING SCREEN BETWEEN EPISODES
//
// Before v136, the next-episode pre-resolve only kicked in when the
// credits popup fired -- which only happens at 98% complete or last
// 5 seconds.  Pre-resolve has a 10-second budget for /api/streams +
// start_and_wait, but the popup only gives ~5 seconds, so the resolve
// usually loses the race and the user sees the slow path: details
// page loading screen -> player loading screen -> finally video.
//
// v136 fires the same pre-resolve AS SOON as /player mounts with a
// nextEpisodeId.  By the time you FF to credits or natural credits
// roll, BOTH:
//   * /api/streams cache for next episode is hot (server-side, 2min)
//   * The top torrent is already cached in Premiumize via start_and_wait
//   * preResolveRef is populated with the resolved CDN URL
//
// When the user reaches credits, showCreditsPopup's existing IIFE
// re-runs but hits both caches instantly (cache HIT on /api/streams,
// PM-cached on start_and_wait) -> populates preResolveRef in <500ms.
// Countdown ends, binge fast-path triggers, direct nav to /player
// with the ready URL.  One loading screen.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v136_prewarm_next_episode.js -o apply_patches_v136.js && node apply_patches_v136.js
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

const playerPath = find('app/player.tsx');
if (!playerPath) {
  console.error('[v136] FATAL: app/player.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v136';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v136] Backup: ${backupPath}`);
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

// ---------------------------------------------------------------------------
// F1 — add preWarmStartedRef near creditsShownRef + a useEffect that fires
// the pre-resolve at /player mount time.
// ---------------------------------------------------------------------------
const F1_OLD = `  // Credits detection settings - show popup near the end
  const CREDITS_TIME_REMAINING_MS = 5000; // Show popup when 5 seconds remaining
  const CREDITS_PERCENTAGE = 0.98; // Or when 98% complete
  const MIN_DURATION_FOR_CREDITS = 180000; // Only detect credits for videos > 3 minutes`;

const F1_NEW = `  // Credits detection settings - show popup near the end
  const CREDITS_TIME_REMAINING_MS = 5000; // Show popup when 5 seconds remaining
  const CREDITS_PERCENTAGE = 0.98; // Or when 98% complete
  const MIN_DURATION_FOR_CREDITS = 180000; // Only detect credits for videos > 3 minutes

  /* v136-prewarm */
  // Pre-warm the next episode's stream cache AND start_and_wait as soon
  // as this player mounts with a nextEpisodeId.  By the time the user FFs
  // to credits or watches through, both server caches are hot and
  // preResolveRef is populated -> one loading screen on episode change.
  const preWarmStartedRef = useRef(false);
  useEffect(() => {
    if (preWarmStartedRef.current) return;
    if (!nextEpisodeId || contentType !== 'series') return;
    preWarmStartedRef.current = true;
    const _nid = nextEpisodeId as string;
    const _parts = _nid.split(':');
    const _baseId = _parts[0] || '';
    const _sn = _parts.length >= 3 ? parseInt(_parts[_parts.length - 2], 10) : NaN;
    const _en = _parts.length >= 3 ? parseInt(_parts[_parts.length - 1], 10) : NaN;
    const _backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    console.log('[PREWARM v136] starting next-episode pre-warm for', _nid);
    (async () => {
      const _t0 = Date.now();
      try {
        const token = await AsyncStorage.getItem('auth_token');
        const authHeaders: any = token ? { Authorization: \`Bearer \${token}\` } : {};
        // 1) Warm the /api/streams cache (2-min server-side TTL)
        const listResp = await fetch(
          \`\${_backendUrl}/api/streams/series/\${encodeURIComponent(_nid)}?upgrade=1\`,
          { headers: authHeaders }
        );
        const _tStreams = Date.now() - _t0;
        if (!listResp.ok) {
          console.log('[PREWARM v136] /api/streams failed', listResp.status, 'after', _tStreams, 'ms');
          return;
        }
        const listData = await listResp.json();
        const list = Array.isArray(listData?.streams) ? listData.streams : [];
        if (list.length === 0) {
          console.log('[PREWARM v136] no streams for next episode after', _tStreams, 'ms');
          return;
        }
        console.log('[PREWARM v136] /api/streams ready (', list.length, 'streams) in', _tStreams, 'ms');
        // Commit hash-only ref FIRST so binge fast-path can fire even
        // before start_and_wait finishes.
        const _top = list.find((s: any) => s && s.infoHash) || list[0];
        if (_top && _top.infoHash) {
          preResolveRef.current = {
            infoHash: _top.infoHash,
            sources: _top.sources || [],
            fileIdx: _top.fileIdx != null ? _top.fileIdx : null,
            filename: _top.filename || '',
            fallbackStreams: list.filter((s: any) => s.infoHash !== _top.infoHash).slice(0, 5),
            contentId: _nid,
            title: nextEpisodeTitle || \`Episode \${_parts[_parts.length - 1] || ''}\`,
            poster: (nextEpisodePoster || poster || '') as string,
            backdrop: (backdrop || '') as string,
            season: _parts[_parts.length - 2] || '',
            episode: _parts[_parts.length - 1] || '',
          };
          console.log('[PREWARM v136] hash-only preResolveRef committed for', String(_top.infoHash).slice(0, 8));
          // 2) Pre-resolve via start_and_wait (warms Premiumize cache)
          const _t1 = Date.now();
          try {
            const startResp = await fetch(\`\${_backendUrl}/api/stream/start_and_wait\`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...authHeaders },
              body: JSON.stringify({
                infoHash: _top.infoHash,
                fileIdx: _top.fileIdx != null ? _top.fileIdx : null,
                filename: _top.filename || null,
                season: isNaN(_sn) ? null : _sn,
                episode: isNaN(_en) ? null : _en,
                timeout_ms: 8000,
              }),
            });
            const startData = await startResp.json().catch(() => ({}));
            const _tResolve = Date.now() - _t1;
            console.log('[PREWARM v136] start_and_wait status=', startData && startData.status, 'in', _tResolve, 'ms');
            if (startData && startData.status === 'ready' && startData.debrid_url) {
              const _cur = preResolveRef.current || ({} as any);
              preResolveRef.current = { ..._cur, directUrl: \`\${_backendUrl}\${startData.debrid_url}\`, infoHash: _top.infoHash };
              console.log('[PREWARM v136] DONE - directUrl ready, next episode will be INSTANT');
            } else if (list.length >= 2) {
              // Try list[1] if list[0] didn't resolve
              const _alt = list.find((s: any, i: number) => i > 0 && s && s.infoHash);
              if (_alt) {
                console.log('[PREWARM v136] list[0] not ready, trying alt', String(_alt.infoHash).slice(0,8));
                const altResp = await fetch(\`\${_backendUrl}/api/stream/start_and_wait\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', ...authHeaders },
                  body: JSON.stringify({
                    infoHash: _alt.infoHash,
                    fileIdx: _alt.fileIdx != null ? _alt.fileIdx : null,
                    filename: _alt.filename || null,
                    season: isNaN(_sn) ? null : _sn,
                    episode: isNaN(_en) ? null : _en,
                    timeout_ms: 5000,
                  }),
                });
                const altData = await altResp.json().catch(() => ({}));
                if (altData && altData.status === 'ready' && altData.debrid_url) {
                  preResolveRef.current = {
                    infoHash: _alt.infoHash,
                    sources: _alt.sources || [],
                    fileIdx: _alt.fileIdx != null ? _alt.fileIdx : null,
                    filename: _alt.filename || '',
                    fallbackStreams: list.filter((s: any) => s.infoHash !== _alt.infoHash).slice(0, 5),
                    contentId: _nid,
                    title: nextEpisodeTitle || \`Episode \${_parts[_parts.length - 1] || ''}\`,
                    poster: (nextEpisodePoster || poster || '') as string,
                    backdrop: (backdrop || '') as string,
                    season: _parts[_parts.length - 2] || '',
                    episode: _parts[_parts.length - 1] || '',
                    directUrl: \`\${_backendUrl}\${altData.debrid_url}\`,
                  };
                  console.log('[PREWARM v136] DONE via alt - directUrl ready, next episode INSTANT');
                }
              }
            }
          } catch (e) {
            console.log('[PREWARM v136] start_and_wait threw', e);
          }
        }
      } catch (e) {
        console.log('[PREWARM v136] failed', e);
      }
    })();
  }, [nextEpisodeId, contentType]);`;

applyOnce(
  'F1: add preWarmStartedRef + mount-time pre-resolve useEffect',
  '/* v136-prewarm */',
  F1_OLD,
  F1_NEW
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v136] === PATCH REPORT =====================================');
for (const r of reports) {
  let tag;
  if (r.status === 'OK') tag = 'OK  ';
  else if (r.status === 'SKIP_IDEMPOTENT') tag = 'SKIP';
  else if (r.status === 'NOT_FOUND') tag = 'MISS';
  else tag = 'AMBI';
  let extras = '';
  if (r.delta != null) extras += `  (Δ ${r.delta} chars)`;
  if (r.count != null) extras += `  (×${r.count})`;
  console.log(`  [${tag}] ${r.label}${extras}`);
}
console.log('[v136] =====================================================');

if (failed.length) { console.error('[v136] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v136] No changes.'); process.exit(0); }
fs.writeFileSync(playerPath, src, 'utf8');
console.log(`[v136] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v136] Done. Rebuild + side-load.');
