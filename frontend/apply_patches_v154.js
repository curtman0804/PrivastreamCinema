/* eslint-disable */
// apply_patches_v154_content_mismatch_diagnostic.js
//
// CONTENT MISMATCH DIAGNOSTIC — logs every step of click→playback so the
// next "wrong content" report tells us exactly where the swap happened.
//
// Adds three log lines around the click→sort→play pipeline in id.tsx:
//
//   [MATCH v154] requested  title="Guardians of the Galaxy Vol 2" id=tt3896198
//   [MATCH v154] sort top   title="GotG.Vol.3.2023..." hash=abc12345 fileIdx=2
//   [MATCH v154] playing    title="GotG.Vol.3.2023..." url=https://...
//   [MATCH v154] WARNING — no title-word overlap (this is when bad happens)
//
// Frontend-only.  Doesn't block playback.  Once we see a WARNING line in
// a logcat we'll know whether the bug is:
//   • Sort already wrong  → addon returned wrong streams for the IMDB id
//   • Sort right, play wrong → PM cache poisoning / wrong file in torrent
//
//   curl -s -o apply_patches_v154.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v154_content_mismatch_diagnostic.js?v=1" && node apply_patches_v154.js
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
  console.error('[v154] FATAL: app/details/[type]/[id].tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v154';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v154] Backup: ${backupPath}`);
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
// PATCH — inject a helper + log at the [SORT v141] picked-top
// line, then again at the [DETAILS] Playing external URL line.
// ─────────────────────────────────────────────────────────────

// Step 1: inject the title-overlap helper near the top of the component.
// Anchor: the existing parseStreamInfo cache import or a stable top-level
// declaration.  Using the AutoPlayLoadingBar component close-brace as anchor.
applyOnce(
  'p1_inject_helper',
  'PATCH_V154_MATCH_HELPER',
  `function AutoPlayLoadingBar() {`,
  `// PATCH_V154_MATCH_HELPER — sanity check that the stream we are about to play
// actually has SOME word from the requested content title.  Returns count of
// matching significant words; 0 means the filename is unrelated to the request.
function _v154TitleOverlap(requestedTitle: string, streamTitle: string): number {
  try {
    if (!requestedTitle || !streamTitle) return 0;
    const stop = new Set(['THE','A','AN','AND','OR','OF','IN','ON','TO','FOR','VS','VS.','PART','VOL']);
    const norm = (s: string) => s.toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\\s+/)
      .filter(w => w.length >= 3 && !stop.has(w));
    const reqWords = new Set(norm(requestedTitle));
    if (reqWords.size === 0) return 99; // can't judge; assume ok
    const streamWords = norm(streamTitle);
    let hits = 0;
    for (const w of streamWords) if (reqWords.has(w)) hits++;
    return hits;
  } catch (_) { return 99; }
}

function AutoPlayLoadingBar() {`
);

// Step 2: log at the [SORT v141] picked top line.  Anchor finds existing
// sort log; injects a [MATCH v154] line right before it.
applyOnce(
  'p2_log_sort_pick',
  'PATCH_V154_LOG_SORT',
  `    const _top = parsed[0];
    const _topInfo = _top.info;
    console.log('[SORT v141] picked top:',`,
  `    const _top = parsed[0];
    const _topInfo = _top.info;
    /* PATCH_V154_LOG_SORT — content mismatch trace */
    try {
      const _v154Req = (((content as any)?.name || (content as any)?.title || (name as any) || '') as string);
      const _v154Pick = ((_top.stream?.title || _top.stream?.name || '') as string);
      const _v154Hits = _v154TitleOverlap(_v154Req, _v154Pick);
      console.log('[MATCH v154]', _v154Hits === 0 ? 'WARNING-NO-OVERLAP' : 'ok-overlap=' + _v154Hits, '| requested=', _v154Req.slice(0,60), '| pick=', _v154Pick.slice(0,80), '| hash=', (_top.stream?.infoHash || '').slice(0,8), 'fileIdx=', (_top.stream as any)?.fileIdx ?? null);
    } catch (_) {}
    console.log('[SORT v141] picked top:',`
);

// Step 3: log at the externalUrl play path so we capture the actual URL.
applyOnce(
  'p3_log_play',
  'PATCH_V154_LOG_PLAY',
  `      const streamUrl = stream.externalUrl || stream.url;
      console.log('[DETAILS] Playing external URL in internal player:', streamUrl);`,
  `      const streamUrl = stream.externalUrl || stream.url;
      /* PATCH_V154_LOG_PLAY — content mismatch trace at play time */
      try {
        const _v154Req2 = (((content as any)?.name || (content as any)?.title || (name as any) || '') as string);
        const _v154Pick2 = ((stream.title || stream.name || '') as string);
        const _v154Hits2 = _v154TitleOverlap(_v154Req2, _v154Pick2);
        console.log('[MATCH v154 PLAY]', _v154Hits2 === 0 ? 'WARNING-NO-OVERLAP' : 'ok-overlap=' + _v154Hits2, '| requested=', _v154Req2.slice(0,60), '| picked=', _v154Pick2.slice(0,80), '| hash=', (stream.infoHash || '').slice(0,8), 'fileIdx=', (stream as any).fileIdx ?? null, '| url=', (streamUrl || '').slice(0,80));
      } catch (_) {}
      console.log('[DETAILS] Playing external URL in internal player:', streamUrl);`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v154] Already applied — no changes written.');
} else {
  fs.writeFileSync(idPath, src, 'utf8');
  console.log(`[v154] Wrote ${idPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v154] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
