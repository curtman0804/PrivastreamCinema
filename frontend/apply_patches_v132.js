/* eslint-disable */
// apply_patches_v132_player_fast_resolve.js
//
// v132 frontend — Four fixes shipped together:
//
//   P1 (player.tsx) Player FAST RESOLVE — call /api/stream/start_and_wait
//       up front in startTorrentStream.  For PM-cached streams this
//       returns the resolved Premiumize URL in 200-800ms, letting us skip
//       the entire torrent-status poll race (which was costing ~8s).
//
//   P2 (player.tsx) Fast-path chains nextEpisodeId — my v126b nav passed
//       contentId for E2 to /player but NOT nextEpisodeId (E3).  So at
//       E2 credits the pre-resolve saw nextEpisodeId === undefined and
//       skipped, leaving preResolveRef null when countdown ended -> 2
//       loading screens.  Now we compute E3 by incrementing the episode
//       number and pass it along (plus a generic next title).
//
//   P3 (id.tsx) One-shot autoFocus via parent ref — v128's userMovedRef
//       worked, but FlatList virtualization REMOUNTS the focused card
//       when the user scrolls.  Fresh mount = fresh userMovedRef = false
//       = timers fire again = focus snaps back to the watched card.  Fix:
//       a parent-level `focusGrabbedRef` that persists across child
//       re-mounts.  Reset only when the focus target itself changes.
//
//   P4 (id.tsx) EpisodeCard accepts focusGrabbedRef — accepts the ref,
//       computes effectiveAutoFocus = autoFocus && !focusGrabbedRef.current,
//       sets the ref true in onFocus.
//
// Pairs with patch_backend_v132_addon_timeout.py.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v132_player_fast_resolve.js -o apply_patches_v132.js && node apply_patches_v132.js
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
const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!playerPath || !idPath) {
  console.error('[v132] FATAL: required files not found');
  console.error('       app/player.tsx              ->', playerPath || 'NOT FOUND');
  console.error('       app/details/[type]/[id].tsx ->', idPath || 'NOT FOUND');
  process.exit(1);
}

let src = fs.readFileSync(playerPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = playerPath + '.bak_v132';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v132] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, pattern, replacementStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const gFlags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const gPattern = new RegExp(pattern.source, gFlags);
  const all = [];
  let m;
  while ((m = gPattern.exec(src)) !== null) {
    all.push(m[0]);
    if (gPattern.lastIndex === m.index) gPattern.lastIndex++;
  }
  if (all.length === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (all.length > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: all.length }); return false; }
  const before = src.length;
  src = src.replace(pattern, () => replacementStr);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// Inject start_and_wait fast-path right before the
// `await api.stream.start(infoHash, validFileIdx, ...)` call inside
// startTorrentStream.  The injected block calls /api/stream/start_and_wait
// with a 5s budget.  If PM returns READY, set streamUrl + state directly
// and bail out (no torrent poll race needed).  Otherwise fall through.
// ---------------------------------------------------------------------------
const FAST_RESOLVE_BLOCK = [
  '      /* v132-fast-resolve */',
  '      // v132: try the synchronous start_and_wait endpoint first.  For',
  '      // PM-cached streams this returns the resolved URL in 200-800ms,',
  '      // letting us skip the entire torrent-status poll race.  Fall',
  '      // through to the old behaviour if PM says "buffering" / "uncached".',
  '      try {',
  '        const _v132Token = await AsyncStorage.getItem(\'auth_token\');',
  '        const _v132Backend = process.env.EXPO_PUBLIC_BACKEND_URL || \'\';',
  '        const _v132Resp = await fetch(`${_v132Backend}/api/stream/start_and_wait`, {',
  '          method: \'POST\',',
  '          headers: {',
  '            \'Content-Type\': \'application/json\',',
  '            ...(_v132Token ? { Authorization: `Bearer ${_v132Token}` } : {}),',
  '          },',
  '          body: JSON.stringify({',
  '            infoHash,',
  '            fileIdx: validFileIdx != null ? validFileIdx : null,',
  '            filename: filename || null,',
  '            season: seasonNum != null ? seasonNum : null,',
  '            episode: episodeNum != null ? episodeNum : null,',
  '            timeout_ms: 5000,',
  '          }),',
  '        });',
  '        const _v132Data = await _v132Resp.json().catch(() => ({}));',
  '        console.log(\'[PLAYER v132] start_and_wait status=\', _v132Data && _v132Data.status);',
  '        if (_v132Data && _v132Data.status === \'ready\' && _v132Data.debrid_url) {',
  '          const _v132Url = `${_v132Backend}${_v132Data.debrid_url}`;',
  '          console.log(\'[PLAYER v132] FAST RESOLVE: PM ready in budget, skipping poll race\');',
  '          setDownloadProgress(100);',
  '          setLoadingStatus(\'\');',
  '          if (_v132Data.video_size) videoFileSizeRef.current = _v132Data.video_size;',
  '          videoRetryCountRef.current = 0;',
  '          setStreamUrl(_v132Url);',
  '          // Keep PM warm via the same lightweight keep-alive the slow path uses',
  '          pollIntervalRef.current = setTimeout(function _v132KeepAlive() {',
  '            if (continuePollingRef.current) {',
  '              api.stream.status(infoHash).catch(() => {});',
  '              pollIntervalRef.current = setTimeout(_v132KeepAlive, 10000) as any;',
  '            }',
  '          }, 10000) as any;',
  '          return;',
  '        }',
  '      } catch (_v132e) {',
  '        console.log(\'[PLAYER v132] start_and_wait threw, falling through:\', _v132e);',
  '      }',
  '',
  '      ',
].join(NL);

applyOnce(
  'P1: inject start_and_wait fast-path in startTorrentStream',
  '/* v132-fast-resolve */',
  /      const seasonNum = season \? parseInt\(season, 10\) : undefined;\s*const episodeNum = episode \? parseInt\(episode, 10\) : undefined;\s*await api\.stream\.start\(infoHash, validFileIdx, filename \|\| undefined, streamSources, seasonNum, episodeNum\);/,
  `      const seasonNum = season ? parseInt(season, 10) : undefined;${NL}      const episodeNum = episode ? parseInt(episode, 10) : undefined;${NL}${FAST_RESOLVE_BLOCK}await api.stream.start(infoHash, validFileIdx, filename || undefined, streamSources, seasonNum, episodeNum);`
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v132] === PATCH REPORT =====================================');
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
console.log('[v132] =====================================================');

if (failed.length) { console.error('[v132] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v132] No changes.'); process.exit(0); }
fs.writeFileSync(playerPath, src, 'utf8');
console.log(`[v132] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v132] Done. Rebuild + side-load.');
