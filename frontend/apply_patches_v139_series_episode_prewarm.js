/*
 * apply_patches_v139_series_episode_prewarm.js
 *
 * V139 — Series episode prefetch on series-root page.
 *
 * When the user opens a series root page (no episode suffix), the
 * episode selector auto-focuses one card -- either the param-driven
 * one from a back-nav, or the highest watched episode in the current
 * season.  Until now, streams for that episode are only fetched after
 * the user clicks it.
 *
 * Fix:
 *   The instant we have `baseId`, `selectedSeason`, and a non-null
 *   `targetEpisodeNumber`, fire `prefetchStreams('series', epId)` for
 *   `${baseId}:${selectedSeason}:${targetEpisodeNumber}`.  v170b's
 *   prefetch/fetch dedupe means the user's subsequent click on that
 *   card will await the in-flight prefetch -- streams paint instantly
 *   with no spinner.
 *
 * Also re-fires when the user switches season, so the new season's
 * auto-focused card is similarly pre-warmed.
 *
 * Idempotent.  Re-runs are a no-op once V139_SERIES_EPISODE_PREWARM
 * marker is present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v139_series_episode_prewarm.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v139] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v139] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = ID_PATH;
let src = read(file);

if (src.indexOf('V139_SERIES_EPISODE_PREWARM') !== -1) {
  console.log('[v139] [id].tsx: already patched (V139 marker present), skipping');
  process.exit(0);
}

// Inject our useEffect immediately AFTER the targetEpisodeIndex memo.
const anchor =
  '  const targetEpisodeIndex = useMemo(() => {\n' +
  '    if (targetEpisodeNumber == null) return 0;\n' +
  '    const idx = episodesForSeason.findIndex(\n' +
  '      (ep) => ep.episode === targetEpisodeNumber\n' +
  '    );\n' +
  '    return idx >= 0 ? idx : 0;\n' +
  '  }, [episodesForSeason, targetEpisodeNumber]);\n';
if (src.indexOf(anchor) === -1) {
  console.error('[v139] FATAL: [id].tsx — could not locate targetEpisodeIndex memo to inject after.');
  process.exit(2);
}
const inject =
  anchor +
  '\n' +
  '  /* V139_SERIES_EPISODE_PREWARM — when the user lands on a series-root\n' +
  '     page, kick off prefetchStreams for the auto-focused episode in the\n' +
  '     background.  v170b\'s registry means the click will await the same\n' +
  '     in-flight promise -- streams paint instantly with no spinner. */\n' +
  '  useEffect(() => {\n' +
  '    if (type !== \'series\') return;\n' +
  '    if (isEpisodePage) return;            // only on series root\n' +
  '    if (!baseId) return;\n' +
  '    if (!selectedSeason) return;\n' +
  '    if (targetEpisodeNumber == null) return;\n' +
  '    const epId = `${baseId}:${selectedSeason}:${targetEpisodeNumber}`;\n' +
  '    try {\n' +
  '      const pf = useContentStore.getState().prefetchStreams;\n' +
  '      if (typeof pf === \'function\') pf(\'series\', epId);\n' +
  '    } catch (_) { /* prefetch is best-effort */ }\n' +
  '  }, [type, isEpisodePage, baseId, selectedSeason, targetEpisodeNumber]);\n';
src = src.replace(anchor, inject);

write(file, src);
console.log('[v139] [id].tsx: 1 change applied');
console.log('[v139] DONE.  Rebuild your Expo app and sideload to test.');
