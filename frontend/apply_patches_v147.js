/* eslint-disable */
// apply_patches_v147_cw_no_stale_url.js
//
// FIX: Continue-Watching click was passing yesterday's saved Premiumize
// URL straight to the <Video> tag.  Those URLs are session-bound to your
// PM session/IP and expire within a few hours — today it 403s, the
// player retries the same URL 4 times, then dies with
// "No more fallback streams or torrents available".
//
// This bug pre-dates v143/144/145/146 — they don't touch this code path.
//
// v147: in discover.tsx handleContinueWatchingPress, remove the
// /player fast-path entirely and always route CW clicks through the
// Details page with `autoPlay=true`.  Details already:
//   - Re-fetches streams from /api/streams (fresh, < 2 min cache)
//   - Sorts with v141 (cached-first) + v146 (audio codec penalty)
//   - Auto-clicks the top stream when autoPlay=true (see [id].tsx
//     autoPlayParam logic at lines 681, 891)
//
// Net effect: CW click → ~1–3 s to fresh stream → playback.  Costs
// 1–2 s vs. the OLD instant-but-broken fast-path, but it actually works
// after the saved URL expires.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s -o apply_patches_v147.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v147_cw_no_stale_url.js && node apply_patches_v147.js
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

const discoverPath = find(path.join('app', '(tabs)', 'discover.tsx'));
if (!discoverPath) {
  console.error('[v147] FATAL: app/(tabs)/discover.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(discoverPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = discoverPath + '.bak_v147';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v147] Backup: ${backupPath}`);
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
// PATCH 1 — remove the /player fast-path (stale URL trap)
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_drop_stale_url_fastpath',
  'PATCH_V147_NO_STALE_URL',
  `  // Handle continue watching item press
  const handleContinueWatchingPress = (item: WatchProgress) => {
    if (item.stream_info_hash || item.stream_url) {
      router.push({
        pathname: '/player',
        params: {
          infoHash: item.stream_info_hash || '',
          directUrl: item.stream_url || '',
          fileIdx: item.stream_file_idx != null ? String(item.stream_file_idx) : '',
          filename: item.stream_filename || '',
          title: item.title || '',
          contentType: item.content_type,
          contentId: item.content_id,
          poster: item.poster || '',
          backdrop: item.backdrop || '',
          logo: item.logo || '',
          resumePosition: String(item.progress || 0),
          season: item.season != null ? String(item.season) : '',
          episode: item.episode != null ? String(item.episode) : '',
          seriesId: item.series_id || '',
        },
      });
      return;
    }
    
    let targetId = item.content_id;`,
  `  // Handle continue watching item press
  // PATCH_V147_NO_STALE_URL — never trust a saved Premiumize URL/infoHash
  // from yesterday.  Always route through Details which does a fresh
  // /api/streams fetch + v141 sort + v146 audio penalty + autoPlay.
  const handleContinueWatchingPress = (item: WatchProgress) => {
    let targetId = item.content_id;`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — add autoPlay=true to the Details push so user
// doesn't have to click Play themselves.
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_add_autoplay_param',
  'PATCH_V147_AUTOPLAY',
  `    const encodedId = encodeURIComponent(targetId);
    router.push({
      pathname: \`/details/\${targetType}/\${encodedId}\`,
      params: {
        name: item.title || '',
        poster: item.poster || '',
        resumeEpisodeId: item.content_type === 'series' ? item.content_id : '',
        resumePosition: String(item.progress || 0),
        resumeSeason: item.season !== undefined ? String(item.season) : '',
        resumeEpisode: item.episode !== undefined ? String(item.episode) : '',
      },
    });
  };`,
  `    const encodedId = encodeURIComponent(targetId);
    // PATCH_V147_AUTOPLAY — let details fire its built-in autoPlay path so
    // the user lands directly on playback after a fresh stream fetch.
    router.push({
      pathname: \`/details/\${targetType}/\${encodedId}\`,
      params: {
        name: item.title || '',
        poster: item.poster || '',
        resumeEpisodeId: item.content_type === 'series' ? item.content_id : '',
        resumePosition: String(item.progress || 0),
        resumeSeason: item.season !== undefined ? String(item.season) : '',
        resumeEpisode: item.episode !== undefined ? String(item.episode) : '',
        autoPlay: 'true',
      },
    });
  };`
);

if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v147] Already applied — no changes written.');
} else {
  fs.writeFileSync(discoverPath, src, 'utf8');
  console.log(`[v147] Wrote ${discoverPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v147] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
