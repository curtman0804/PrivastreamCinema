/* eslint-disable */
// apply_patches_v126_binge_fastpath.js
//
// v126 — Instant-binge-watching fast path (the "A" half of v126).
// Pairs with patch_backend_v126_start_and_wait.py on the VPS.
//
// What this does:
//   1) Adds a preResolveRef ref to /player that holds the next-episode
//      pre-resolved Premiumize URL (or its infoHash if still resolving).
//   2) Rewrites the credits-time pre-resolve so that during the
//      "Up Next" countdown the player:
//         a. Fetches next episode's stream list (/api/streams/series/{id})
//         b. Picks the top stream
//         c. Calls the NEW /api/stream/start_and_wait endpoint to
//            synchronously resolve the Premiumize URL (up to 8s)
//         d. Stores the result on preResolveRef
//   3) Rewrites the countdown-end navigation AND the manual "Play Next"
//      handler so that, if we have a pre-resolved directUrl, navigation
//      goes DIRECTLY to /player (bypassing details/series/{id}.tsx
//      entirely — kills the cinematic loading overlay between episodes).
//      If only an infoHash is pre-resolved (still buffering), we still
//      bypass details/id.tsx and let /player resume the regular polling
//      with the known hash.  If pre-resolve hasn't returned anything,
//      we fall back to the existing details/{id}?autoPlay=true flow so
//      binge-watching never gets stuck.
//
// CRLF-safe.  Idempotent.  Windows CMD users run as:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v126_binge_fastpath.js -o apply_patches_v126.js && node apply_patches_v126.js
//
const fs = require('fs');
const path = require('path');

function findFile() {
  const candidates = [
    path.join(process.cwd(), 'app', 'player.tsx'),
    path.join(process.cwd(), 'frontend', 'app', 'player.tsx'),
    path.join(process.cwd(), '..', 'frontend', 'app', 'player.tsx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const filePath = findFile();
if (!filePath) {
  console.error('[v126] FATAL: Could not find app/player.tsx');
  console.error('       Run this script from the frontend project root.');
  process.exit(1);
}
console.log('[v126] Patching:', filePath);

let src = fs.readFileSync(filePath, 'utf8');
const originalLen = src.length;
const NL = src.includes('\r\n') ? '\r\n' : '\n';
console.log('[v126] Line endings:', NL === '\r\n' ? 'CRLF (Windows)' : 'LF (Unix)');

const backupPath = filePath + '.bak_v126';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log('[v126] Backup written:', backupPath);
}

const reports = [];
function applyOnce(label, alreadyAppliedMarker, pattern, replacement) {
  if (alreadyAppliedMarker && src.indexOf(alreadyAppliedMarker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const gFlags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const gPattern = new RegExp(pattern.source, gFlags);
  const fullMatches = [];
  let m;
  while ((m = gPattern.exec(src)) !== null) {
    fullMatches.push(m[0]);
    if (gPattern.lastIndex === m.index) gPattern.lastIndex++;
  }
  if (fullMatches.length === 0) {
    reports.push({ label, status: 'NOT_FOUND' });
    return false;
  }
  if (fullMatches.length > 1) {
    reports.push({ label, status: 'AMBIGUOUS', count: fullMatches.length });
    return false;
  }
  const before = src.length;
  src = src.replace(pattern, replacement);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// P1 — Add preResolveRef just after the creditsShownRef declaration.
// ---------------------------------------------------------------------------
applyOnce(
  'P1: declare preResolveRef',
  '/* v126-preresolve-ref */',
  /const creditsShownRef = useRef\(false\); \/\/ Track if we've shown the credits popup/,
  `const creditsShownRef = useRef(false); // Track if we've shown the credits popup${NL}  /* v126-preresolve-ref */${NL}  // Holds the pre-resolved next-episode stream (populated during credits).${NL}  //   directUrl present  -> we navigate straight to /player, no torrent poll${NL}  //   only infoHash      -> /player resumes regular status polling${NL}  //   null               -> fall back to /details/series/{id}?autoPlay=true${NL}  const preResolveRef = useRef<null | {${NL}    directUrl?: string;${NL}    infoHash?: string;${NL}    sources?: string[];${NL}    fileIdx?: number | null;${NL}    filename?: string;${NL}    fallbackStreams?: any[];${NL}    contentId?: string;${NL}    title?: string;${NL}    poster?: string;${NL}    backdrop?: string;${NL}    season?: string;${NL}    episode?: string;${NL}  }>(null);`
);

// ---------------------------------------------------------------------------
// P2 — Replace the existing PRE-RESOLVE block (lines ~866-880) with the new
// stream-list-fetch + start_and_wait flow.  The existing block fires only
// /api/stream/start using the CURRENT episode's infoHash (wrong for most
// shows where each ep has its own torrent), so this is a strict upgrade.
//
// Anchor: the comment "// PRE-RESOLVE: Start resolving the next episode NOW"
// through the close of the `if (nextEpisodeId && infoHash) { ... }` block.
// ---------------------------------------------------------------------------
applyOnce(
  'P2: rewrite credits-time pre-resolve block',
  '/* v126-preresolve-block */',
  /\/\/ PRE-RESOLVE: Start resolving the next episode NOW so it's ready when we navigate\s*if \(nextEpisodeId && infoHash\) \{[\s\S]*?AsyncStorage\.getItem\('auth_token'\)\.then\(token => \{[\s\S]*?fetch\(`\$\{backendUrl\}\/api\/stream\/start`, \{[\s\S]*?\}\)\.catch\(\(\) => \{\}\);[\s\S]*?\}\);[\s\S]*?\}/,
  `/* v126-preresolve-block */${NL}    // v126 BINGE FAST PATH: pre-resolve the next episode's BEST stream${NL}    // synchronously via the new /api/stream/start_and_wait endpoint.${NL}    // Stores the resolved directUrl on preResolveRef so countdown-end${NL}    // can navigate DIRECTLY to /player (no details/id.tsx middleman).${NL}    if (nextEpisodeId && contentType === 'series') {${NL}      const _nextIdParts = (nextEpisodeId as string).split(':');${NL}      const _baseId = _nextIdParts[0] || '';${NL}      const _nextSeason = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 2] : '';${NL}      const _nextEpisodeNum = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 1] : '';${NL}      const _backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';${NL}      preResolveRef.current = null;${NL}      (async () => {${NL}        try {${NL}          const token = await AsyncStorage.getItem('auth_token');${NL}          const authHeaders: any = token ? { Authorization: \`Bearer \${token}\` } : {};${NL}          // 1) fetch next episode stream list (uses backend cache when warm)${NL}          const listResp = await fetch(${NL}            \`\${_backendUrl}/api/streams/series/\${encodeURIComponent(nextEpisodeId as string)}\`,${NL}            { headers: authHeaders }${NL}          );${NL}          if (!listResp.ok) {${NL}            console.log('[PLAYER v126] streams fetch failed:', listResp.status);${NL}            return;${NL}          }${NL}          const listData = await listResp.json();${NL}          const list = Array.isArray(listData?.streams) ? listData.streams : [];${NL}          if (list.length === 0) {${NL}            console.log('[PLAYER v126] no streams for next episode');${NL}            return;${NL}          }${NL}          // 2) pick best (backend already returns cached-first, sorted)${NL}          const best = list[0];${NL}          const bestHash = best && best.infoHash;${NL}          if (!bestHash) {${NL}            console.log('[PLAYER v126] top stream has no infoHash');${NL}            return;${NL}          }${NL}          console.log('[PLAYER v126] pre-resolving next ep, top hash=', String(bestHash).slice(0, 8));${NL}          // 3) start_and_wait — synchronous resolve up to 8s${NL}          const sn = parseInt(_nextSeason, 10);${NL}          const en = parseInt(_nextEpisodeNum, 10);${NL}          const startResp = await fetch(\`\${_backendUrl}/api/stream/start_and_wait\`, {${NL}            method: 'POST',${NL}            headers: { 'Content-Type': 'application/json', ...authHeaders },${NL}            body: JSON.stringify({${NL}              infoHash: bestHash,${NL}              fileIdx: best.fileIdx != null ? best.fileIdx : null,${NL}              filename: best.filename || null,${NL}              season: isNaN(sn) ? null : sn,${NL}              episode: isNaN(en) ? null : en,${NL}              timeout_ms: 8000,${NL}            }),${NL}          });${NL}          const startData = await startResp.json().catch(() => ({}));${NL}          console.log('[PLAYER v126] start_and_wait status=', startData && startData.status);${NL}          const baseTitle = nextEpisodeTitle || \`Episode \${_nextEpisodeNum}\`;${NL}          const basePoster = (nextEpisodePoster || poster || '') as string;${NL}          const baseBackdrop = (backdrop || '') as string;${NL}          if (startData && startData.status === 'ready' && startData.debrid_url) {${NL}            preResolveRef.current = {${NL}              directUrl: \`\${_backendUrl}\${startData.debrid_url}\`,${NL}              infoHash: bestHash,${NL}              sources: best.sources || [],${NL}              fileIdx: best.fileIdx != null ? best.fileIdx : null,${NL}              filename: best.filename || '',${NL}              fallbackStreams: list.slice(1, 6),${NL}              contentId: nextEpisodeId as string,${NL}              title: baseTitle,${NL}              poster: basePoster,${NL}              backdrop: baseBackdrop,${NL}              season: _nextSeason,${NL}              episode: _nextEpisodeNum,${NL}            };${NL}          } else if (startData && startData.status === 'buffering') {${NL}            // Still resolving — store the hash so /player can keep polling${NL}            preResolveRef.current = {${NL}              infoHash: bestHash,${NL}              sources: best.sources || [],${NL}              fileIdx: best.fileIdx != null ? best.fileIdx : null,${NL}              filename: best.filename || '',${NL}              fallbackStreams: list.slice(1, 6),${NL}              contentId: nextEpisodeId as string,${NL}              title: baseTitle,${NL}              poster: basePoster,${NL}              backdrop: baseBackdrop,${NL}              season: _nextSeason,${NL}              episode: _nextEpisodeNum,${NL}            };${NL}          } else {${NL}            console.log('[PLAYER v126] pre-resolve gave status=', startData && startData.status, '- will fall back to details/id.tsx autoplay path');${NL}          }${NL}        } catch (e) {${NL}          console.log('[PLAYER v126] pre-resolve threw:', e);${NL}        }${NL}      })();${NL}    }`
);

// ---------------------------------------------------------------------------
// P3 — Replace the countdown-end navigation (router.replace into
// /details/series/{id}?autoPlay=true) with: if preResolveRef has a directUrl
// or infoHash, navigate DIRECTLY to /player; otherwise fall back to the
// existing details/{id} autoplay path.
//
// Anchor: the unique `// Navigate to next episode with autoPlay (no
// preferHash — Stremio` comment + the router.replace call that follows.
// ---------------------------------------------------------------------------
applyOnce(
  'P3: countdown-end fast-path navigation',
  '/* v126-countdown-nav */',
  /\/\/ Navigate to next episode with autoPlay \(no preferHash — Stremio\s*\/\/ does fresh lookup per episode to avoid stale-cache races\)\.\s*console\.log\('\[PLAYER\] Countdown ended - auto-playing next episode:', nextEpisodeId\);\s*router\.replace\(\{\s*pathname: `\/details\/series\/\$\{nextEpisodeId\}`,\s*params: \{ autoPlay: 'true', nextTitle: nextEpisodeTitle \|\| '', nextPoster: \(nextEpisodePoster \|\| poster \|\| ''\) as string, nextBackdrop: \(backdrop \|\| ''\) as string \},\s*\}\);/,
  `/* v126-countdown-nav */${NL}          console.log('[PLAYER] Countdown ended - auto-playing next episode:', nextEpisodeId);${NL}          // v126 BINGE FAST PATH: if pre-resolve populated preResolveRef${NL}          // we can navigate DIRECTLY to /player and skip the details${NL}          // page entirely (no cinematic loading overlay).${NL}          const _pre = preResolveRef.current;${NL}          if (_pre && (_pre.directUrl || _pre.infoHash)) {${NL}            const _baseId = ((nextEpisodeId as string) || '').split(':')[0];${NL}            const _params: any = {${NL}              title: _pre.title || nextEpisodeTitle || '',${NL}              poster: _pre.poster || (nextEpisodePoster || poster || '') as string,${NL}              backdrop: _pre.backdrop || (backdrop || '') as string,${NL}              contentType: 'series',${NL}              contentId: _pre.contentId || (nextEpisodeId as string),${NL}              seriesId: _baseId,${NL}              season: _pre.season || '',${NL}              episode: _pre.episode || '',${NL}              isLive: 'false',${NL}            };${NL}            if (_pre.directUrl) {${NL}              _params.directUrl = _pre.directUrl;${NL}            } else if (_pre.infoHash) {${NL}              _params.infoHash = _pre.infoHash;${NL}              _params.fileIdx = _pre.fileIdx != null ? String(_pre.fileIdx) : '';${NL}              _params.filename = _pre.filename || '';${NL}              _params.sources = JSON.stringify(_pre.sources || []);${NL}            }${NL}            if (_pre.fallbackStreams && _pre.fallbackStreams.length > 0) {${NL}              _params.fallbackStreams = JSON.stringify(_pre.fallbackStreams);${NL}            }${NL}            console.log('[PLAYER v126] BINGE FAST PATH: direct /player nav,', _pre.directUrl ? 'pre-resolved URL' : 'hash-only');${NL}            preResolveRef.current = null;${NL}            router.replace({ pathname: '/player', params: _params });${NL}          } else {${NL}            // Fallback (pre-resolve incomplete) — original autoplay flow.${NL}            router.replace({${NL}              pathname: \`/details/series/\${nextEpisodeId}\`,${NL}              params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '', nextPoster: (nextEpisodePoster || poster || '') as string, nextBackdrop: (backdrop || '') as string },${NL}            });${NL}          }`
);

// ---------------------------------------------------------------------------
// P4 — Replace the manual playNextEpisode() router.replace with the same
// fast-path logic so "Play Next" button clicks also bypass details/id.tsx
// when pre-resolve is ready.
//
// Anchor: the unique comment block that introduces the playNextEpisode
// router.replace.
// ---------------------------------------------------------------------------
applyOnce(
  'P4: manual playNextEpisode fast-path',
  '/* v126-manual-nav */',
  /\/\/ Navigate to the next episode details page with autoPlay\.\s*\/\/ Stremio-style: do NOT carry over the previous hash\. Each episode does\s*\/\/ a fresh stream lookup and resolves the top stream on demand\. This\s*\/\/ guarantees we never reuse stale RD state from the previous episode\.\s*router\.replace\(\{\s*pathname: `\/details\/series\/\$\{nextEpisodeId\}`,\s*params: \{ autoPlay: 'true', nextTitle: nextEpisodeTitle \|\| '' \},\s*\}\);/,
  `/* v126-manual-nav */${NL}    // v126 BINGE FAST PATH: same logic as the countdown branch — if we${NL}    // already pre-resolved during credits, navigate straight to /player.${NL}    const _preM = preResolveRef.current;${NL}    if (_preM && (_preM.directUrl || _preM.infoHash)) {${NL}      const _baseIdM = ((nextEpisodeId as string) || '').split(':')[0];${NL}      const _paramsM: any = {${NL}        title: _preM.title || nextEpisodeTitle || '',${NL}        poster: _preM.poster || (poster || '') as string,${NL}        backdrop: _preM.backdrop || (backdrop || '') as string,${NL}        contentType: 'series',${NL}        contentId: _preM.contentId || (nextEpisodeId as string),${NL}        seriesId: _baseIdM,${NL}        season: _preM.season || '',${NL}        episode: _preM.episode || '',${NL}        isLive: 'false',${NL}      };${NL}      if (_preM.directUrl) {${NL}        _paramsM.directUrl = _preM.directUrl;${NL}      } else if (_preM.infoHash) {${NL}        _paramsM.infoHash = _preM.infoHash;${NL}        _paramsM.fileIdx = _preM.fileIdx != null ? String(_preM.fileIdx) : '';${NL}        _paramsM.filename = _preM.filename || '';${NL}        _paramsM.sources = JSON.stringify(_preM.sources || []);${NL}      }${NL}      if (_preM.fallbackStreams && _preM.fallbackStreams.length > 0) {${NL}        _paramsM.fallbackStreams = JSON.stringify(_preM.fallbackStreams);${NL}      }${NL}      console.log('[PLAYER v126] BINGE FAST PATH (manual): direct /player nav,', _preM.directUrl ? 'pre-resolved URL' : 'hash-only');${NL}      preResolveRef.current = null;${NL}      router.replace({ pathname: '/player', params: _paramsM });${NL}    } else {${NL}      // Fallback (pre-resolve not ready) — original autoplay flow.${NL}      router.replace({${NL}        pathname: \`/details/series/\${nextEpisodeId}\`,${NL}        params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '' },${NL}      });${NL}    }`
);

// ---------------------------------------------------------------------------
// Report + write.
// ---------------------------------------------------------------------------
const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v126] === PATCH REPORT =====================================');
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
console.log('[v126] =====================================================');

if (failed.length) {
  console.error('[v126] One or more patches failed.  File NOT written.');
  console.error('[v126] Backup remains at:', backupPath);
  process.exit(2);
}

if (src.length === originalLen) {
  console.log('[v126] No changes (file already at v126).  Nothing to write.');
  process.exit(0);
}

fs.writeFileSync(filePath, src, 'utf8');
console.log(`[v126] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v126] Done. Rebuild and side-load the app.');
console.log('');
console.log('[v126] >>> ALSO: deploy the backend patch on your VPS: <<<');
console.log('[v126]   curl -O https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v126_start_and_wait.py');
console.log('[v126]   docker cp patch_backend_v126_start_and_wait.py privastream-app:/app/backend/');
console.log('[v126]   docker exec privastream-app python3 /app/backend/patch_backend_v126_start_and_wait.py');
console.log('[v126]   docker restart privastream-app');
