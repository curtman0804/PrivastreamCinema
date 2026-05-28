/* eslint-disable */
// apply_patches_v127_fastpath_and_quality.js
//
// v127 — Two follow-up tweaks on top of v126b:
//
//   P1 (player.tsx) — guarantee 1 loading screen for binge transitions:
//       v126b's preResolveRef was only populated AFTER /api/stream/start_and_wait
//       completed (up to 8s).  If the user hit "Play Next" within the first
//       few seconds, the ref was still null and the navigation fell back to
//       /details/series/{id}?autoPlay=true → two loading screens.
//       Now we populate preResolveRef with the next-episode infoHash as
//       soon as the stream-list fetch returns, then UPGRADE it with the
//       resolved directUrl when start_and_wait finishes.  Result: as long as
//       streams come back (~500 ms), the fast path always fires.
//
//   P2 (id.tsx) — quality is finally king:
//       In sortStreamsByLanguage the codec/HDR rewards (+250 H.264, +150 SDR
//       = +400) exceeded TWO quality tiers (each tier = +200).  That made a
//       720p H.264 SDR stream rank ABOVE a 1080p HEVC HDR stream, which is
//       why the manually-clicked first episode looked grainy.  Penalty
//       rebalanced to +100/+75 = +175 max, less than one quality tier, so
//       quality (4K > 1080p > 720p) always wins the sort.
//
// Idempotent.  CRLF-safe.  Run from frontend root on Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v127_fastpath_and_quality.js -o apply_patches_v127.js && node apply_patches_v127.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const playerPath = find('app/player.tsx');
const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!playerPath || !idPath) {
  console.error('[v127] FATAL: could not locate one of the target files');
  console.error('       app/player.tsx                   ->', playerPath || 'NOT FOUND');
  console.error('       app/details/[type]/[id].tsx      ->', idPath     || 'NOT FOUND');
  process.exit(1);
}

const reports = [];
function patchFile(filePath, label, applies) {
  let src = fs.readFileSync(filePath, 'utf8');
  const NL = src.includes('\r\n') ? '\r\n' : '\n';
  const original = src;

  const backupPath = filePath + '.bak_v127';
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, src, 'utf8');
    console.log(`[v127] Backup: ${backupPath}`);
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
// PLAYER: P1 — early-populate preResolveRef so the fast path triggers
// even before /api/stream/start_and_wait returns.
// We replace the entire IIFE inside `if (nextEpisodeId && contentType === 'series') { ... }`
// (added by v126b).
// ---------------------------------------------------------------------------
const playerReport = patchFile(playerPath, 'player.tsx', [
  {
    label: 'P1: early-populate preResolveRef (hash-only, upgrade later)',
    marker: '/* v127-preresolve-early */',
    pattern: /if \(nextEpisodeId && contentType === 'series'\) \{[\s\S]*?\(async \(\) => \{[\s\S]*?\}\)\(\);\s*\}/,
    replacement: (NL) =>
      `if (nextEpisodeId && contentType === 'series') {${NL}      /* v127-preresolve-early */${NL}      // v127: populate preResolveRef with at least an infoHash as SOON${NL}      // as the stream list comes back, so the binge fast path triggers${NL}      // even if the user mashes "Play Next" within the first few seconds${NL}      // (before /api/stream/start_and_wait finishes).  We upgrade the ref${NL}      // with directUrl later when start_and_wait returns ready.${NL}      const _nextIdParts = (nextEpisodeId as string).split(':');${NL}      const _baseId = _nextIdParts[0] || '';${NL}      const _nextSeason = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 2] : '';${NL}      const _nextEpisodeNum = _nextIdParts.length >= 3 ? _nextIdParts[_nextIdParts.length - 1] : '';${NL}      const _backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || '';${NL}      preResolveRef.current = null;${NL}      (async () => {${NL}        try {${NL}          const token = await AsyncStorage.getItem('auth_token');${NL}          const authHeaders: any = token ? { Authorization: \`Bearer \${token}\` } : {};${NL}          // 1) fetch next-episode stream list${NL}          const listResp = await fetch(${NL}            \`\${_backendUrl}/api/streams/series/\${encodeURIComponent(nextEpisodeId as string)}\`,${NL}            { headers: authHeaders }${NL}          );${NL}          if (!listResp.ok) { console.log('[PLAYER v127] streams fetch failed:', listResp.status); return; }${NL}          const listData = await listResp.json();${NL}          const list = Array.isArray(listData?.streams) ? listData.streams : [];${NL}          if (list.length === 0) { console.log('[PLAYER v127] no streams for next ep'); return; }${NL}          const best = list[0];${NL}          const bestHash = best && best.infoHash;${NL}          if (!bestHash) { console.log('[PLAYER v127] top stream missing infoHash'); return; }${NL}          const baseTitle = nextEpisodeTitle || \`Episode \${_nextEpisodeNum}\`;${NL}          const basePoster = (nextEpisodePoster || poster || '') as string;${NL}          const baseBackdrop = (backdrop || '') as string;${NL}          // 2) PRE-COMMIT hash-only ref — fast path can fire any time now${NL}          preResolveRef.current = {${NL}            infoHash: bestHash,${NL}            sources: best.sources || [],${NL}            fileIdx: best.fileIdx != null ? best.fileIdx : null,${NL}            filename: best.filename || '',${NL}            fallbackStreams: list.slice(1, 6),${NL}            contentId: nextEpisodeId as string,${NL}            title: baseTitle,${NL}            poster: basePoster,${NL}            backdrop: baseBackdrop,${NL}            season: _nextSeason,${NL}            episode: _nextEpisodeNum,${NL}          };${NL}          console.log('[PLAYER v127] hash-only fast path armed, hash=', String(bestHash).slice(0, 8));${NL}          // 3) kick PM and long-poll for the resolved URL (upgrades the ref)${NL}          const sn = parseInt(_nextSeason, 10);${NL}          const en = parseInt(_nextEpisodeNum, 10);${NL}          const startResp = await fetch(\`\${_backendUrl}/api/stream/start_and_wait\`, {${NL}            method: 'POST',${NL}            headers: { 'Content-Type': 'application/json', ...authHeaders },${NL}            body: JSON.stringify({${NL}              infoHash: bestHash,${NL}              fileIdx: best.fileIdx != null ? best.fileIdx : null,${NL}              filename: best.filename || null,${NL}              season: isNaN(sn) ? null : sn,${NL}              episode: isNaN(en) ? null : en,${NL}              timeout_ms: 8000,${NL}            }),${NL}          });${NL}          const startData = await startResp.json().catch(() => ({}));${NL}          console.log('[PLAYER v127] start_and_wait status=', startData && startData.status);${NL}          if (startData && startData.status === 'ready' && startData.debrid_url) {${NL}            // UPGRADE — replace hash-only with directUrl so /player has${NL}            // nothing to resolve.${NL}            const _cur = preResolveRef.current || {};${NL}            preResolveRef.current = {${NL}              ..._cur,${NL}              directUrl: \`\${_backendUrl}\${startData.debrid_url}\`,${NL}              infoHash: bestHash,${NL}            };${NL}            console.log('[PLAYER v127] preResolveRef UPGRADED to directUrl');${NL}          } else if (startData && startData.status === 'uncached') {${NL}            // PM doesn't have it.  Keep hash-only ref; /player will fall${NL}            // through its existing fallback-torrents flow.${NL}            console.log('[PLAYER v127] PM uncached — keeping hash-only ref');${NL}          } else if (startData && startData.status === 'error') {${NL}            // Don't poison the ref — wipe it so we fall back to the${NL}            // details/{id}?autoPlay=true path which has its own retry.${NL}            console.log('[PLAYER v127] start_and_wait error — clearing ref to fall back');${NL}            preResolveRef.current = null;${NL}          }${NL}          // status === 'buffering': keep hash-only ref as-is${NL}        } catch (e) { console.log('[PLAYER v127] pre-resolve threw:', e); }${NL}      })();${NL}    }`,
  },
]);

// ---------------------------------------------------------------------------
// ID: P2 — rebalance HEVC / HDR penalty so quality always wins
// Old: +250 (!HEVC) + +150 (!HDR) = +400 = 2 quality tiers
// New: +100 (!HEVC) + +75  (!HDR) = +175 = less than 1 quality tier
// ---------------------------------------------------------------------------
const idReport = patchFile(idPath, '[id].tsx', [
  {
    label: 'P2: rebalance HEVC/HDR penalty so quality dominates',
    marker: '/* v127-codec-rebalance */',
    pattern: /\/\* v121e-codec-penalty \*\/ if \(!info\.isHEVC\) s \+= 250; if \(!info\.isHDR\) s \+= 150;/,
    replacement: (NL) =>
      `/* v121e-codec-penalty */ /* v127-codec-rebalance */ if (!info.isHEVC) s += 100; if (!info.isHDR) s += 75;`,
  },
]);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
console.log('');
console.log('[v127] === PATCH REPORT =====================================');
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
console.log('[v127] =====================================================');
console.log(`[v127] player.tsx: wrote=${playerReport.wrote} (${playerReport.before} -> ${playerReport.after})`);
console.log(`[v127] [id].tsx :  wrote=${idReport.wrote} (${idReport.before} -> ${idReport.after})`);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
if (failed.length) {
  console.error('[v127] One or more patches failed.  Files were rolled back where needed (per-file atomic).');
  process.exit(2);
}
console.log('[v127] Done. Rebuild and side-load the app.');
