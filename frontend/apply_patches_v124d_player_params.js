// apply_patches_v124d_player_params.js
//
// Ensures seriesId / season / episode are ALWAYS passed to /player when
// playing a series episode - not just when there's a next episode. Without
// this, v124b's series-aware handleBack falls through to default
// router.back() because contentType is set but seriesId/season/episode
// arrive as undefined.
//
// Patches all three router.push branches in handleStreamSelect:
//   - externalUrl path
//   - /api/proxy path
//   - infoHash path
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124d_player_params.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124d-player-params';

function die(msg) { console.error('[v124d] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v124d] already applied - nothing to do.');
  process.exit(0);
}

// We inject right before the closing brace of every `params: { ... }` block
// that contains `...nextEpisodeData,`. The `_seriesBack...` keys we add are
// guarded - they only emit values when this is a series episode.
const re = /(\.\.\.nextEpisodeData,\s*[\r\n]+\s*\.\.\.resumeData,)/g;

let changed = 0;
src = src.replace(re, (m) => {
  changed++;
  return (
    "...(type === 'series' ? {\n" +
    "            /* v124d-player-params */\n" +
    "            seriesId: baseId || (id as string),\n" +
    "            season: String(episodeSeason),\n" +
    "            episode: String(episodeNumber),\n" +
    "          } : {}),\n" +
    "          " + m
  );
});

if (changed === 0) die('could not find any nextEpisodeData/resumeData anchor.');

const bak = TARGET + '.bak.v124d';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v124d] patched ' + changed + ' router.push call(s) in ' + TARGET);
console.log('[v124d] backup: ' + bak);
console.log('[v124d] OK - rebuild and sideload.');
