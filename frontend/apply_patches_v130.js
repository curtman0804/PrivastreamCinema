/* eslint-disable */
// apply_patches_v130_force_upgrade_fetch.js
//
// v130 — Tiny but critical fix to v129.  The Play button's stream-list
// refetch is gated by `if (!hasResolved(pool))`, which is FALSE in
// practice because the page-mount fetch (via contentStore.fetchStreams)
// already populated streams with backend-resolved entries.  As a result
// my v129 `?upgrade=1` URL never actually fired — backend logs show zero
// requests to /api/streams/series after a Play click.
//
// Fix: drop the guard.  Always refetch with ?upgrade=1 on Play click.
// Backend's stream cache key (v128b) already separates `upgrade=1` from
// the default, so the cost on a warm cache is ~50ms.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v130_force_upgrade_fetch.js -o apply_patches_v130.js && node apply_patches_v130.js
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
if (!idPath) { console.error('[v130] FATAL: id.tsx not found'); process.exit(1); }

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v130';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v130] Backup: ${backupPath}`);
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
// Drop the `if (!hasResolved(pool))` guard so the ?upgrade=1 refetch ALWAYS
// fires on Play click.  Replace the whole block with an unconditional fetch.
// ---------------------------------------------------------------------------
applyOnce(
  'P1: drop hasResolved guard so ?upgrade=1 always fires',
  '/* v130-force-upgrade-refetch */',
  /\/\* v121d-play-wait \*\/[\s\S]*?let pool = streams;[\s\S]*?const hasResolved = \(arr: any\[\]\) =>\s*arr\.some\(\(s: any\) => s && \(s\.url \|\| s\.externalUrl \|\| s\.direct_url\)\);\s*if \(!hasResolved\(pool\)\) \{\s*try \{[\s\S]*?\/\* v129-upgrade-fetch \*\/\s*const resp = await fetch\(\s*`\$\{backendUrl\}\/api\/streams\/\$\{type\}\/\$\{encodedId\}\?upgrade=1`,\s*\{ headers: authToken \? \{ Authorization: `Bearer \$\{authToken\}` \} : \{\} \}\s*\);\s*if \(resp\.ok\) \{\s*const data = await resp\.json\(\);\s*if \(Array\.isArray\(data\?\.streams\) && data\.streams\.length > 0\) \{\s*pool = data\.streams;\s*\}\s*\}\s*\} catch \(e\) \{\s*console\.log\('\[v121d\] backend fetch failed', e\);\s*\}\s*\}/,
  `/* v121d-play-wait */${NL}                      /* v130-force-upgrade-refetch */${NL}                      // v130: ALWAYS refetch with ?upgrade=1 on Play click. The${NL}                      // previous \`if (!hasResolved(pool))\` guard short-circuited${NL}                      // the refetch because the page-mount fetch had already${NL}                      // populated streams with backend-resolved entries — which${NL}                      // meant v129's \`?upgrade=1\` query never reached backend.${NL}                      let pool = streams;${NL}                      try {${NL}                        const authToken = await AsyncStorage.getItem('auth_token');${NL}                        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL${NL}                          || (Constants.expoConfig as any)?.extra?.backendUrl${NL}                          || '';${NL}                        const encodedId = encodeURIComponent(id as string);${NL}                        console.log('[DETAILS v130] fetching streams with ?upgrade=1 for', type, encodedId);${NL}                        const resp = await fetch(${NL}                          \`\${backendUrl}/api/streams/\${type}/\${encodedId}?upgrade=1\`,${NL}                          { headers: authToken ? { Authorization: \`Bearer \${authToken}\` } : {} }${NL}                        );${NL}                        if (resp.ok) {${NL}                          const data = await resp.json();${NL}                          if (Array.isArray(data?.streams) && data.streams.length > 0) {${NL}                            pool = data.streams;${NL}                            const _upcount = pool.filter((s: any) => s?.upgrade_candidate).length;${NL}                            console.log('[DETAILS v130] got', pool.length, 'streams,', _upcount, 'upgrade candidates');${NL}                          }${NL}                        } else {${NL}                          console.log('[DETAILS v130] upgrade fetch non-ok:', resp.status);${NL}                        }${NL}                      } catch (e) {${NL}                        console.log('[DETAILS v130] upgrade fetch failed:', e);${NL}                      }`
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v130] === PATCH REPORT =====================================');
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
console.log('[v130] =====================================================');

if (failed.length) { console.error('[v130] One or more patches failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v130] No changes.'); process.exit(0); }
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v130] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v130] Done. Rebuild and side-load the app.');
