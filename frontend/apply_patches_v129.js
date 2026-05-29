/* eslint-disable */
// apply_patches_v129_manual_upgrade.js
//
// v129 — Extends v128's quality-upgrade race to the MANUAL Play button
// in id.tsx, so first-play (no binge) also gets 1080p when available.
//
// Three changes, all in app/details/[type]/[id].tsx:
//
//   P1: Play button onPress fetches /api/streams/...?upgrade=1
//   P2: Auto-pick prefers any upgrade_candidate (strictly higher quality
//       tier per backend) when one exists in the pool.
//   P3: At the top of handleStreamSelect, if the chosen stream is an
//       upgrade_candidate (uncached higher-quality), call
//       /api/stream/start_and_wait with a 6.5s timeout while keeping the
//       cinematic overlay visible. If PM caches it in time, navigate to
//       /player with directUrl=<resolved>. Otherwise auto-fallback to the
//       top cached stream in `streams` and proceed.
//
// Pairs with patch_backend_v128b_quality_upgrade.py (the ?upgrade=1
// endpoint flag) which is already deployed on the VPS.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v129_manual_upgrade.js -o apply_patches_v129.js && node apply_patches_v129.js
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
  console.error('[v129] FATAL: could not locate app/details/[type]/[id].tsx');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v129';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v129] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, pattern, replacement) {
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
  src = src.replace(pattern, replacement);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// P1 — append ?upgrade=1 to the Play button's stream-list fetch.
// ---------------------------------------------------------------------------
applyOnce(
  'P1: Play button fetch uses ?upgrade=1',
  '/* v129-upgrade-fetch */',
  /const resp = await fetch\(\s*`\$\{backendUrl\}\/api\/streams\/\$\{type\}\/\$\{encodedId\}`,\s*\{ headers: authToken \? \{ Authorization: `Bearer \$\{authToken\}` \} : \{\} \}\s*\);/,
  `/* v129-upgrade-fetch */${NL}                          const resp = await fetch(${NL}                            \`\${backendUrl}/api/streams/\${type}/\${encodedId}?upgrade=1\`,${NL}                            { headers: authToken ? { Authorization: \`Bearer \${authToken}\` } : {} }${NL}                          );`
);

// ---------------------------------------------------------------------------
// P2 — auto-pick prefers upgrade_candidate when present.  Replaces the
// existing v121d3-resolved-only block.
// ---------------------------------------------------------------------------
applyOnce(
  'P2: auto-pick prefers upgrade candidate',
  '/* v129-prefer-upgrade */',
  /\/\* v121d3-resolved-only \*\/[\s\S]*?const resolved = pool\.filter\(\(s: any\) => s && \(s\.url \|\| s\.externalUrl \|\| s\.direct_url\)\);\s*const candidates = resolved\.length > 0 \? resolved : pool;\s*const sorted = sortStreamsByLanguage\(candidates\);\s*if \(sorted\[0\]\) handleStreamSelect\(sorted\[0\]\);/,
  `/* v121d3-resolved-only */${NL}                      /* v129-prefer-upgrade */${NL}                      // Auto-pick from pre-resolved (cached) streams. If the${NL}                      // backend (v128b) returned upgrade_candidate items (uncached,${NL}                      // strictly higher quality tier), prefer the top one — the${NL}                      // race in handleStreamSelect will try to resolve it and${NL}                      // auto-fallback to the top cached if PM can't cache in time.${NL}                      const upgradeCandidates = pool.filter((s: any) => s?.upgrade_candidate && s?.infoHash);${NL}                      const resolved = pool.filter((s: any) => s && (s.url || s.externalUrl || s.direct_url));${NL}                      const candidates = resolved.length > 0 ? resolved : pool;${NL}                      const sorted = sortStreamsByLanguage(candidates);${NL}                      let picked: any = sorted[0];${NL}                      if (upgradeCandidates.length > 0) {${NL}                        const upgradeSorted = sortStreamsByLanguage(upgradeCandidates);${NL}                        if (upgradeSorted[0]) {${NL}                          console.log('[DETAILS v129] preferring upgrade candidate:', upgradeSorted[0].name || '');${NL}                          picked = upgradeSorted[0];${NL}                        }${NL}                      }${NL}                      if (picked) handleStreamSelect(picked);`
);

// ---------------------------------------------------------------------------
// P3 — race-and-fallback at the top of handleStreamSelect for any stream
// that is an upgrade_candidate (uncached, higher quality tier).
// ---------------------------------------------------------------------------
applyOnce(
  'P3: handleStreamSelect race-and-fallback',
  '/* v129-handle-upgrade */',
  /const handleStreamSelect = async \(stream: Stream\) => \{\s*const subtitleContentId = isEpisodePage/,
  `const handleStreamSelect = async (stream: Stream) => {${NL}    /* v129-handle-upgrade */${NL}    // If this is an upgrade candidate (backend-flagged uncached higher${NL}    // quality tier), race start_and_wait. PM-cache wins -> ride upgrade.${NL}    // PM-cache loses -> swap to top cached stream and proceed.${NL}    if ((stream as any).upgrade_candidate && stream.infoHash && !stream.url) {${NL}      try {${NL}        setIsPlayLoading(true);${NL}        const _authT = await AsyncStorage.getItem('auth_token');${NL}        const _bUrl = process.env.EXPO_PUBLIC_BACKEND_URL || (Constants.expoConfig as any)?.extra?.backendUrl || '';${NL}        const _hdrs: any = { 'Content-Type': 'application/json', ...(_authT ? { Authorization: \`Bearer \${_authT}\` } : {}) };${NL}        const _idP = ((id as string) || '').split(':');${NL}        const _sn = _idP.length >= 3 ? parseInt(_idP[_idP.length - 2], 10) : NaN;${NL}        const _en = _idP.length >= 3 ? parseInt(_idP[_idP.length - 1], 10) : NaN;${NL}        console.log('[DETAILS v129] upgrade-race start hash=', stream.infoHash.slice(0, 8));${NL}        const _resp = await fetch(\`\${_bUrl}/api/stream/start_and_wait\`, {${NL}          method: 'POST',${NL}          headers: _hdrs,${NL}          body: JSON.stringify({${NL}            infoHash: stream.infoHash,${NL}            fileIdx: stream.fileIdx != null ? stream.fileIdx : null,${NL}            filename: stream.filename || null,${NL}            season: isNaN(_sn) ? null : _sn,${NL}            episode: isNaN(_en) ? null : _en,${NL}            timeout_ms: 6500,${NL}          }),${NL}        });${NL}        const _data = await _resp.json().catch(() => ({}));${NL}        console.log('[DETAILS v129] upgrade-race status=', _data && _data.status);${NL}        if (_data && _data.status === 'ready' && _data.debrid_url) {${NL}          // Upgrade wins — inject resolved URL, fall through to existing path${NL}          stream = { ...stream, url: \`\${_bUrl}\${_data.debrid_url}\` } as any;${NL}          console.log('[DETAILS v129] UPGRADED (quality-upgraded)');${NL}        } else {${NL}          // Upgrade lost — pick top cached stream from this content's streams${NL}          const _cachedFallback = streams.find((s) => s !== stream && s.url && !(s as any).upgrade_candidate);${NL}          if (_cachedFallback) {${NL}            console.log('[DETAILS v129] upgrade lost — using cached fallback:', _cachedFallback.name || '');${NL}            stream = _cachedFallback;${NL}          } else {${NL}            console.log('[DETAILS v129] no cached fallback — proceeding with infoHash (player resolves)');${NL}          }${NL}        }${NL}      } catch (_v129e) {${NL}        console.log('[DETAILS v129] upgrade-race threw:', _v129e);${NL}      }${NL}      // Note: we deliberately leave setIsPlayLoading(true) — router.push${NL}      // will unmount this screen and the overlay vanishes with it.${NL}    }${NL}    const subtitleContentId = isEpisodePage`
);

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v129] === PATCH REPORT =====================================');
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
console.log('[v129] =====================================================');

if (failed.length) {
  console.error('[v129] One or more patches failed. File NOT written.');
  process.exit(2);
}
if (src.length === originalLen) {
  console.log('[v129] No changes (file already at v129).');
  process.exit(0);
}
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v129] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v129] Done. Rebuild and side-load the app.');
