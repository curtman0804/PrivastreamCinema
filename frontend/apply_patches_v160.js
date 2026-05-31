/* eslint-disable */
// apply_patches_v160_backdrop_and_poster_consistency.js
//
// TWO fixes in one surgical patch:
//
// 1) BACKDROP FLASH on details screen.
//    The current chain in id.tsx (line ~1539):
//      const displayPoster = episodeBackdrop || content?.background || content?.poster || '';
//    falls back to content.poster when content.background is missing.
//    Initial render uses cachedMeta from the list view, which carries
//    poster (portrait) but NOT background (landscape).  So you see the
//    portrait poster STRETCHED across the wide backdrop area, then
//    swap to the real backdrop when fresh meta arrives.  That's the
//    flash.
//    Fix: drop the poster fallback for the backdrop.  Show only the
//    dark overlay until the real landscape backdrop is available.
//
// 2) POSTER INCONSISTENCY across surfaces.
//    Rick & Morty in addon rows looks different from Rick & Morty in
//    Continue Watching, because each surface holds its own snapshot of
//    `item.poster` from whichever data source it came from (addon row
//    vs watch_progress mongo doc).
//    Fix: add a module-level poster registry in ContentCard.tsx keyed
//    by IMDb id.  First valid render for an id "wins" — that URL is
//    cached.  Subsequent renders for the same id (anywhere — addon
//    rows, search, library, continue watching) all use the cached
//    URL.  Since addon rows mount before continue watching, the
//    TMDb/addon poster wins everywhere.  Continue Watching imports
//    the registry and uses it as the source of truth.
//
// Idempotent.  CRLF-safe.
//
//   curl -L --fail -o apply_patches_v160.js "https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v160_backdrop_and_poster_consistency.js?v=1" && node apply_patches_v160.js
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

const cardPath = find(path.join('src', 'components', 'ContentCard.tsx'));
const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
const discPath = find(path.join('app', '(tabs)', 'discover.tsx'));
const missing = [];
if (!cardPath) missing.push('src/components/ContentCard.tsx');
if (!idPath) missing.push('app/details/[type]/[id].tsx');
if (!discPath) missing.push('app/(tabs)/discover.tsx');
if (missing.length) {
  console.error('[v160] FATAL: could not find: ' + missing.join(', '));
  process.exit(1);
}

const reports = [];

function patchFile(absPath, label, marker, oldStr, newStr) {
  let src = fs.readFileSync(absPath, 'utf8');
  const NL = src.includes('\r\n') ? '\r\n' : '\n';
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ file: path.basename(absPath), label, status: 'SKIP_IDEMPOTENT' });
    return;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ file: path.basename(absPath), label, status: 'NOT_FOUND' }); return; }
  if (occurrences > 1)  { reports.push({ file: path.basename(absPath), label, status: 'AMBIGUOUS', count: occurrences }); return; }
  const before = src.length;
  const bakPath = absPath + '.bak_v160';
  if (!fs.existsSync(bakPath)) fs.writeFileSync(bakPath, src, 'utf8');
  src = src.replace(old2, new2);
  fs.writeFileSync(absPath, src, 'utf8');
  reports.push({ file: path.basename(absPath), label, status: 'OK', delta: src.length - before });
}

// ============================================================
// A1) ContentCard.tsx — inject the poster registry near the top of
// the file, right after the NO_POSTER_IMAGE require.
// ============================================================
patchFile(cardPath, 'A1_registry_block', 'V160_POSTER_REGISTRY',
  `const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');`,
  `const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// V160_POSTER_REGISTRY — single source of truth for posters across the app.
// First valid render per IMDb-id "wins" and all later renders (any surface:
// addon rows, search, library, continue-watching) use the same URL.  Fixes
// the case where the same content shows different posters depending on
// which screen rendered it first.
const _v160PosterRegistry: Record<string, string> = {};
export function v160RegisterPoster(imdbId: string | undefined | null, url: string | undefined | null): void {
  if (!imdbId || !url) return;
  // strip any episode suffix like "tt1234:1:5" so episodes share the series-level poster
  const key = String(imdbId).split(':')[0];
  if (!key) return;
  if (!_v160PosterRegistry[key]) _v160PosterRegistry[key] = String(url);
}
export function v160GetPoster(imdbId: string | undefined | null, fallback: string | undefined | null): string {
  if (imdbId) {
    const key = String(imdbId).split(':')[0];
    if (key && _v160PosterRegistry[key]) return _v160PosterRegistry[key];
  }
  return fallback ? String(fallback) : '';
}`,
);

// ============================================================
// A2) ContentCard.tsx — use the registry inside the render.
// Anchor: the line right before "return (".
// ============================================================
patchFile(cardPath, 'A2_use_registry', 'V160_USE_REGISTRY',
  `  // HARD TV FOCUS LOCK
  const selfNode = findNodeHandle(pressableRef.current);

  return (`,
  `  // HARD TV FOCUS LOCK
  const selfNode = findNodeHandle(pressableRef.current);

  // V160_USE_REGISTRY — register on first valid render, look up on every
  // render so the SAME poster URL renders no matter which surface mounted
  // this content first.
  const _v160_id = ((item as any).imdb_id || (item as any).id) as string | undefined;
  if (_v160_id && (item as any).poster) v160RegisterPoster(_v160_id, (item as any).poster as string);
  const _v160_poster = v160GetPoster(_v160_id, (item as any).poster);

  return (`,
);

// ============================================================
// A3) ContentCard.tsx — swap item.poster → _v160_poster in the Image
// source.  Surgical: only the JSX block that renders the poster.
// ============================================================
patchFile(cardPath, 'A3_swap_image_uri', 'V160_IMAGE_SWAPPED',
  `          {item.poster && !posterError ? (
            <Image
              source={{
                uri: useProxy
                  ? getProxiedPosterUrl(item.poster)
                  : item.poster,
              }}`,
  `          {/* V160_IMAGE_SWAPPED — use registry-resolved poster URL */}
          {_v160_poster && !posterError ? (
            <Image
              source={{
                uri: useProxy
                  ? getProxiedPosterUrl(_v160_poster)
                  : _v160_poster,
              }}`,
);

// ============================================================
// B) discover.tsx — import the registry and use it inside
// ContinueWatchingItem so the CW row shows the same poster as
// the addon rows / search results.
// ============================================================
patchFile(discPath, 'B1_import_registry', 'V160_IMPORT_POSTER_REGISTRY',
  `import { getCardWidth } from '../../src/components/ContentCard';`,
  `import { getCardWidth, v160GetPoster as _v160GetPoster /* V160_IMPORT_POSTER_REGISTRY */ } from '../../src/components/ContentCard';`,
);

patchFile(discPath, 'B2_cw_use_registry', 'V160_CW_USES_REGISTRY',
  `        <View style={[styles.continueImageContainer, { height: posterHeight }]}>
          {(item.poster || item.backdrop) ? (
            <Image
              source={{ uri: item.poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
            />`,
  `        <View style={[styles.continueImageContainer, { height: posterHeight }]}>
          {/* V160_CW_USES_REGISTRY — pull the canonical poster URL from
              the registry so Continue Watching matches the addon-row
              poster for the same content.  Falls back to item.poster
              then item.backdrop when no registry entry exists yet. */}
          {(_v160GetPoster((item as any).content_id, item.poster) || item.backdrop) ? (
            <Image
              source={{ uri: _v160GetPoster((item as any).content_id, item.poster) || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
            />`,
);

// ============================================================
// C) id.tsx — backdrop flash fix.  Drop the content?.poster fallback
// in displayPoster so we don't stretch a portrait across the wide
// backdrop area while waiting for fresh meta to deliver
// content.background.
// ============================================================
patchFile(idPath, 'C1_backdrop_no_poster_fallback', 'V160_BACKDROP_NO_POSTER',
  `  const displayPoster = episodeBackdrop || content?.background || content?.poster || '';`,
  `  // V160_BACKDROP_NO_POSTER — don't fall back to content?.poster for
  // the full-screen backdrop.  The portrait poster stretched across the
  // wide landscape area causes a visible "flash" until the real
  // content.background arrives from the meta fetch.  Showing just the
  // dark overlay is cleaner.
  const displayPoster = episodeBackdrop || content?.background || '';`,
);

// ============================================================
// Report
// ============================================================
console.log('[v160] Report:');
for (const r of reports) {
  console.log('  ', r.file, '·', r.label, '→', r.status,
    r.delta !== undefined ? `(Δ${r.delta})` : '',
    r.count !== undefined ? `(x${r.count})` : '');
}
const failCount = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT').length;
process.exit(failCount > 0 ? 1 : 0);
