/* eslint-disable */
// apply_patches_v128_focus_and_upgrade.js
//
// v128 — Three changes:
//
//   P1 (id.tsx) — Focus retry cancel:
//       The v124ab retry block fires setNativeProps({ hasTVPreferredFocus: true })
//       at 60ms / 200ms / 500ms after mount.  If the user moves the D-pad to
//       another card around the 200-500ms mark, the later retries YANK focus
//       BACK to the previously-watched card.  We now bail out of subsequent
//       retries the moment this card loses focus AFTER having had it (i.e.
//       the user moved on).
//
//   P2 (player.tsx) — Binge fast-path quality race:
//       The credits-time pre-resolve in player.tsx now appends `?upgrade=1`
//       to the next-episode streams URL.  When the backend (v128) returns
//       an uncached higher-quality candidate as list[0], we still call
//       start_and_wait on it (~6s budget).  If PM caches it in time, ride
//       the upgrade.  If PM returns status=uncached, AUTO-FALLBACK to
//       list[1] (which is the top cached stream) and start_and_wait it
//       too with the remaining time budget.  preResolveRef ends up with
//       whichever wins.
//
// Pairs with patch_backend_v128_quality_upgrade.py on the VPS.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v128_focus_and_upgrade.js -o apply_patches_v128.js && node apply_patches_v128.js
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
  console.error('[v128] FATAL: could not locate target files');
  console.error('       app/player.tsx               ->', playerPath || 'NOT FOUND');
  console.error('       app/details/[type]/[id].tsx  ->', idPath || 'NOT FOUND');
  process.exit(1);
}

const reports = [];
function patchFile(filePath, label, applies) {
  let src = fs.readFileSync(filePath, 'utf8');
  const NL = src.includes('\r\n') ? '\r\n' : '\n';
  const original = src;

  const backupPath = filePath + '.bak_v128';
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, src, 'utf8');
    console.log(`[v128] Backup: ${backupPath}`);
  }

  for (const a of applies) {
    if (a.marker && src.indexOf(a.marker) !== -1) {
      reports.push({ file: label, label: a.label, status: 'SKIP_IDEMPOTENT' });
      continue;
    }
    const gFlags = a.pattern.flags.includes('g') ? a.pattern.flags : a.pattern.flags + 'g';
    const gPattern = new RegExp(a.pattern.source, gFlags);
    const all = [];
    let m;
    while ((m = gPattern.exec(src)) !== null) {
      all.push(m[0]);
      if (gPattern.lastIndex === m.index) gPattern.lastIndex++;
    }
    if (all.length === 0) {
      reports.push({ file: label, label: a.label, status: 'NOT_FOUND' });
      continue;
    }
    if (all.length > 1) {
      reports.push({ file: label, label: a.label, status: 'AMBIGUOUS', count: all.length });
      continue;
    }
    const before = src.length;
    const repl = typeof a.replacement === 'function' ? a.replacement(NL) : a.replacement;
    src = src.replace(a.pattern, repl);
    reports.push({ file: label, label: a.label, status: 'OK', delta: src.length - before });
  }

  if (src !== original) {
    fs.writeFileSync(filePath, src, 'utf8');
    return { wrote: true, before: original.length, after: src.length };
  }
  return { wrote: false, before: original.length, after: src.length };
}

// ---------------------------------------------------------------------------
// P1 — id.tsx: cancel focus retries after the card has been blurred by the
// user.  We add a `userMovedRef` next to `pressableRef`, set it true in
// onBlur (only after onFocus has fired), and check it at each retry.
// ---------------------------------------------------------------------------
const idReport = patchFile(idPath, '[id].tsx', [
  {
    label: 'P1a: add userMovedRef + hasFocusedRef to EpisodeCard',
    marker: '/* v128-focus-cancel */',
    pattern: /\/\/ v124ab-inject-useref: declare pressableRef \+ retry-focus effect for EpisodeCard\.[\s\S]*?const pressableRef = useRef<any>\(null\);[\s\S]*?useEffect\(\(\) => \{[\s\S]*?if \(!autoFocus\) return;[\s\S]*?const tries = \[60, 200, 500\];[\s\S]*?\}, \[autoFocus\]\);/,
    replacement: (NL) =>
      `// v124ab-inject-useref: declare pressableRef + retry-focus effect for EpisodeCard.${NL}  /* v128-focus-cancel */${NL}  const pressableRef = useRef<any>(null);${NL}  // v128: track whether the user has navigated AWAY from this card so the${NL}  // later retries (200ms / 500ms) don't yank focus back from wherever the${NL}  // user is now.${NL}  const hasFocusedRef = useRef(false);${NL}  const userMovedRef = useRef(false);${NL}  useEffect(() => {${NL}    if (!autoFocus) {${NL}      // Reset for next time this card becomes the target${NL}      hasFocusedRef.current = false;${NL}      userMovedRef.current = false;${NL}      return;${NL}    }${NL}    hasFocusedRef.current = false;${NL}    userMovedRef.current = false;${NL}    const tries = [60, 200, 500];${NL}    const timers = tries.map(delay => setTimeout(() => {${NL}      // If the user already moved D-pad away after we grabbed focus once,${NL}      // do NOT re-grab — that's the snap-back bug.${NL}      if (userMovedRef.current) return;${NL}      try {${NL}        const p: any = pressableRef.current;${NL}        if (!p) return;${NL}        if (typeof p.focus === 'function') { try { p.focus(); } catch (_) {} }${NL}        try { p.setNativeProps && p.setNativeProps({ hasTVPreferredFocus: true }); } catch (_) {}${NL}      } catch (_) {}${NL}    }, delay));${NL}    return () => { timers.forEach(t => clearTimeout(t)); };${NL}  }, [autoFocus]);`,
  },
  {
    label: 'P1b: wire onFocus/onBlur to userMovedRef/hasFocusedRef',
    marker: '/* v128-focus-cancel-blur */',
    pattern: /style=\{\[styles\.episodeCard, isFocused && styles\.episodeCardFocused\]\}\s*onPress=\{onPress\}\s*onLongPress=\{isWatched \? onMarkUnwatched : undefined\}\s*onFocus=\{\(\) => setIsFocused\(true\)\}\s*onBlur=\{\(\) => setIsFocused\(false\)\}\s*delayLongPress=\{600\}\s*hasTVPreferredFocus=\{!!autoFocus\}/,
    replacement: (NL) =>
      `style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}${NL}      onPress={onPress}${NL}      onLongPress={isWatched ? onMarkUnwatched : undefined}${NL}      /* v128-focus-cancel-blur */${NL}      onFocus={() => { setIsFocused(true); hasFocusedRef.current = true; }}${NL}      onBlur={() => { setIsFocused(false); if (hasFocusedRef.current) userMovedRef.current = true; }}${NL}      delayLongPress={600}${NL}      hasTVPreferredFocus={!!autoFocus}`,
  },
]);

// ---------------------------------------------------------------------------
// P2 — player.tsx: binge fast-path quality race.  We rewrite the v127 IIFE
// so that:
//   (1) the streams fetch URL gets `?upgrade=1`
//   (2) start_and_wait is tried on list[0] first
//   (3) on `status=uncached`, automatically fall back to list[1] and try
//       start_and_wait on that (with the remaining budget)
//   (4) preResolveRef.current ends up with whichever stream resolved
// ---------------------------------------------------------------------------
const playerReport = patchFile(playerPath, 'player.tsx', [
  {
    label: 'P2: rewrite v127 IIFE for quality race',
    marker: '/* v128-quality-race */',
    pattern: /if \(nextEpisodeId && contentType === 'series'\) \{\s*\/\* v127-preresolve-early \*\/[\s\S]*?\(async \(\) => \{[\s\S]*?\}\)\(\);\s*\}/,
    replacement: (NL) =>
      `if (nextEpisodeId && contentType === 'series') {${NL}      /* v127-preresolve-early */${NL}      /* v128-quality-race */${NL}      // v128: ask backend for upgrade candidates (?upgrade=1), then RACE${NL}      // start_and_wait against the top uncached-higher-quality stream.${NL}      // If PM can cache it in time, ride the upgrade. Otherwise fall back${NL}      // to the next stream (top cached) with the remaining budget.  The${NL}      // user perceives a single loading screen either way; the difference${NL}      // is whether they get 1080p or 720p.${NL}      const _nextIdParts = (nextEpisodeId as string).split(':');${NL}      const _baseId = _nextIdParts[0] || '';${NL}      const _nextSeason = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 2] : '';${NL}      const _nextEpisodeNum = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 1] : '';${NL}      const _backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';${NL}      preResolveRef.current = null;${NL}      (async () => {${NL}        const _t0 = Date.now();${NL}        const _budgetMs = 10000;${NL}        const _remaining = () => Math.max(500, _budgetMs - (Date.now() - _t0));${NL}        try {${NL}          const token = await AsyncStorage.getItem('auth_token');${NL}          const authHeaders: any = token ? { Authorization: \`Bearer \${token}\` } : {};${NL}          const listResp = await fetch(${NL}            \`\${_backendUrl}/api/streams/series/\${encodeURIComponent(nextEpisodeId as string)}?upgrade=1\`,${NL}            { headers: authHeaders }${NL}          );${NL}          if (!listResp.ok) { console.log('[PLAYER v128] streams fetch failed:', listResp.status); return; }${NL}          const listData = await listResp.json();${NL}          const list = Array.isArray(listData?.streams) ? listData.streams : [];${NL}          if (list.length === 0) { console.log('[PLAYER v128] no streams for next ep'); return; }${NL}          const sn = parseInt(_nextSeason, 10);${NL}          const en = parseInt(_nextEpisodeNum, 10);${NL}          const baseTitle = nextEpisodeTitle || \`Episode \${_nextEpisodeNum}\`;${NL}          const basePoster = (nextEpisodePoster || poster || '') as string;${NL}          const baseBackdrop = (backdrop || '') as string;${NL}          // Helper to commit a hash-only fast-path ref for a given stream${NL}          const _commitHashOnly = (stream: any) => {${NL}            const _h = stream && stream.infoHash;${NL}            if (!_h) return;${NL}            preResolveRef.current = {${NL}              infoHash: _h,${NL}              sources: stream.sources || [],${NL}              fileIdx: stream.fileIdx != null ? stream.fileIdx : null,${NL}              filename: stream.filename || '',${NL}              fallbackStreams: list.filter((_s: any) => _s.infoHash !== _h).slice(0, 5),${NL}              contentId: nextEpisodeId as string,${NL}              title: baseTitle, poster: basePoster, backdrop: baseBackdrop,${NL}              season: _nextSeason, episode: _nextEpisodeNum,${NL}            };${NL}            console.log('[PLAYER v128] hash-only ref committed for', String(_h).slice(0, 8), 'upgrade=', !!stream.upgrade_candidate);${NL}          };${NL}          // Helper to try start_and_wait on one stream with a timeout${NL}          const _tryResolve = async (stream: any, timeoutMs: number) => {${NL}            const _h = stream && stream.infoHash;${NL}            if (!_h) return null;${NL}            const startResp = await fetch(\`\${_backendUrl}/api/stream/start_and_wait\`, {${NL}              method: 'POST',${NL}              headers: { 'Content-Type': 'application/json', ...authHeaders },${NL}              body: JSON.stringify({${NL}                infoHash: _h,${NL}                fileIdx: stream.fileIdx != null ? stream.fileIdx : null,${NL}                filename: stream.filename || null,${NL}                season: isNaN(sn) ? null : sn,${NL}                episode: isNaN(en) ? null : en,${NL}                timeout_ms: Math.max(500, Math.min(timeoutMs, 10000)),${NL}              }),${NL}            });${NL}            const data = await startResp.json().catch(() => ({}));${NL}            return data;${NL}          };${NL}          // PHASE 1: commit hash-only for list[0] immediately so the fast${NL}          // path can fire even before any resolve finishes.${NL}          _commitHashOnly(list[0]);${NL}          // PHASE 2: try resolving list[0]${NL}          const r0 = await _tryResolve(list[0], Math.min(_remaining(), 6500));${NL}          console.log('[PLAYER v128] list[0] status=', r0 && r0.status, 'upgrade=', !!list[0].upgrade_candidate);${NL}          if (r0 && r0.status === 'ready' && r0.debrid_url) {${NL}            const _cur = preResolveRef.current || ({} as any);${NL}            preResolveRef.current = { ..._cur, directUrl: \`\${_backendUrl}\${r0.debrid_url}\`, infoHash: list[0].infoHash };${NL}            console.log('[PLAYER v128] UPGRADED via list[0]', list[0].upgrade_candidate ? '(quality-upgraded)' : '(cached)');${NL}            return;${NL}          }${NL}          // PHASE 3: list[0] was uncached/error/buffering past its share${NL}          // of the budget — fall through to list[1] if available.${NL}          if (list.length >= 2 && _remaining() > 800) {${NL}            console.log('[PLAYER v128] list[0] failed (', r0 && r0.status, ') — trying list[1] as fallback');${NL}            _commitHashOnly(list[1]);${NL}            const r1 = await _tryResolve(list[1], _remaining());${NL}            console.log('[PLAYER v128] list[1] status=', r1 && r1.status);${NL}            if (r1 && r1.status === 'ready' && r1.debrid_url) {${NL}              const _cur = preResolveRef.current || ({} as any);${NL}              preResolveRef.current = { ..._cur, directUrl: \`\${_backendUrl}\${r1.debrid_url}\`, infoHash: list[1].infoHash };${NL}              console.log('[PLAYER v128] UPGRADED via list[1] (cached fallback)');${NL}              return;${NL}            }${NL}            // Both list[0] and list[1] uncached/error — clear ref so we${NL}            // fall back to /details/series/{id}?autoPlay=true${NL}            if (r1 && r1.status === 'error') preResolveRef.current = null;${NL}          } else if (r0 && r0.status === 'error') {${NL}            preResolveRef.current = null;${NL}          }${NL}          // else: keep hash-only ref (list[0]); /player can keep trying${NL}        } catch (e) { console.log('[PLAYER v128] pre-resolve threw:', e); }${NL}      })();${NL}    }`,
  },
]);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
console.log('');
console.log('[v128] === PATCH REPORT =====================================');
for (const r of reports) {
  let tag;
  if (r.status === 'OK') tag = 'OK  ';
  else if (r.status === 'SKIP_IDEMPOTENT') tag = 'SKIP';
  else if (r.status === 'NOT_FOUND') tag = 'MISS';
  else tag = 'AMBI';
  let extras = '';
  if (r.delta != null) extras += `  (Δ ${r.delta} chars)`;
  if (r.count != null) extras += `  (×${r.count})`;
  console.log(`  [${tag}] ${r.file}  ${r.label}${extras}`);
}
console.log('[v128] =====================================================');
console.log(`[v128] [id].tsx  wrote=${idReport.wrote}   (${idReport.before} -> ${idReport.after})`);
console.log(`[v128] player.tsx wrote=${playerReport.wrote} (${playerReport.before} -> ${playerReport.after})`);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
if (failed.length) { console.error('[v128] One or more patches failed.'); process.exit(2); }
console.log('[v128] Done. Rebuild and side-load the app.');
console.log('');
console.log('[v128] >>> ALSO deploy the backend patch on your VPS: <<<');
console.log('[v128]   curl -O https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v128_quality_upgrade.py');
console.log('[v128]   docker cp patch_backend_v128_quality_upgrade.py privastream-app:/app/backend/');
console.log('[v128]   docker exec privastream-app python3 /app/backend/patch_backend_v128_quality_upgrade.py');
console.log('[v128]   docker restart privastream-app');
