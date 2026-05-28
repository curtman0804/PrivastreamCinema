// apply_patches_v124c_back_contextual.js
//
// Finishes the v124b work on the details file. v124b already patched
// app/player.tsx successfully but bailed on the details file because the
// user's "seasons" useEffect uses paramSelectedSeason. This script:
//   1. Adds focusS / focusE to useLocalSearchParams destructure
//   2. Inserts a new useEffect that selects the season from focusS when
//      paramSelectedSeason is not set
//   3. Adds hasTVPreferredFocus to the matching EpisodeCard
//   4. Adds hasTVPreferredFocus prop to EpisodeCard signature + Pressable
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124c_back_contextual.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124c-back-contextual';

function die(msg) { console.error('[v124c] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);

let dsrc = fs.readFileSync(DETAILS, 'utf8');

if (dsrc.includes(MARKER)) {
  console.log('[v124c] already applied - nothing to do.');
  process.exit(0);
}

// 1) Extend useLocalSearchParams destructuring to include focusS and focusE.
if (!dsrc.includes('focusS: focusSParam,')) {
  const paramAnchor = /autoPlay:\s*autoPlayParam,/;
  if (!paramAnchor.test(dsrc)) die('could not find autoPlay param destructure.');
  dsrc = dsrc.replace(
    paramAnchor,
    "autoPlay: autoPlayParam,\n    focusS: focusSParam,\n    focusE: focusEParam,"
  );
}

// 2) Extend the param type definition the same way.
if (!dsrc.includes('focusS?: string;')) {
  const typeAnchor = /autoPlay\?:\s*string;/;
  if (!typeAnchor.test(dsrc)) die('could not find autoPlay param type.');
  dsrc = dsrc.replace(
    typeAnchor,
    "autoPlay?: string;\n    focusS?: string;\n    focusE?: string;"
  );
}

// 3) Inject a separate useEffect that handles focusSParam, BEFORE the
// existing season effect. Anchor on the existing seasons useEffect that
// uses paramSelectedSeason.
const seasonEffectAnchor = /(useEffect\(\(\) => \{\s*[\r\n]+\s*if \(seasons\.length === 0\) return;\s*[\r\n]+\s*const fromParam = paramSelectedSeason)/;
if (!seasonEffectAnchor.test(dsrc)) die('could not find season effect anchor.');

dsrc = dsrc.replace(
  seasonEffectAnchor,
  "useEffect(() => {\n" +
  "    /* v124c-back-contextual: prefer focusS over default first-season */\n" +
  "    if (seasons.length === 0) return;\n" +
  "    const wantedSeason = focusSParam ? parseInt(String(focusSParam), 10) : NaN;\n" +
  "    if (!isNaN(wantedSeason) && seasons.includes(wantedSeason) && selectedSeason !== wantedSeason) {\n" +
  "      setSelectedSeason(wantedSeason);\n" +
  "    }\n" +
  "  }, [seasons, focusSParam]);\n" +
  "\n" +
  "  $1"
);

// 4) Add hasTVPreferredFocus prop to EpisodeCard signature.
const epcSigRe = /function EpisodeCard\(\{\s*[\r\n]+\s*episode,\s*[\r\n]+\s*fallbackPoster,\s*[\r\n]+\s*onPress,\s*[\r\n]+\s*isWatched,\s*[\r\n]+\s*onMarkUnwatched,\s*[\r\n]+\s*\}: \{\s*[\r\n]+\s*episode: Episode;\s*[\r\n]+\s*fallbackPoster\?: string;\s*[\r\n]+\s*onPress: \(\) => void;\s*[\r\n]+\s*isWatched\?: boolean;\s*[\r\n]+\s*onMarkUnwatched\?: \(\) => void;\s*[\r\n]+\s*\}\) \{/;
if (!epcSigRe.test(dsrc)) die('could not find EpisodeCard signature.');
dsrc = dsrc.replace(
  epcSigRe,
  "function EpisodeCard({\n" +
  "  episode,\n" +
  "  fallbackPoster,\n" +
  "  onPress,\n" +
  "  isWatched,\n" +
  "  onMarkUnwatched,\n" +
  "  hasTVPreferredFocus,\n" +
  "}: {\n" +
  "  episode: Episode;\n" +
  "  fallbackPoster?: string;\n" +
  "  onPress: () => void;\n" +
  "  isWatched?: boolean;\n" +
  "  onMarkUnwatched?: () => void;\n" +
  "  hasTVPreferredFocus?: boolean;\n" +
  "}) {"
);

// 5) Wire hasTVPreferredFocus on the EpisodeCard Pressable.
// Use a broad non-greedy capture from <Pressable through delayLongPress={600}.
// Earlier strict patterns failed because of `=>` arrows inside callbacks.
const epcPressRe = /(<Pressable[\s\S]*?delayLongPress=\{600\}\s*[\r\n]+\s*)>/;
if (!epcPressRe.test(dsrc)) die('could not find EpisodeCard Pressable.');
dsrc = dsrc.replace(epcPressRe, "$1  hasTVPreferredFocus={hasTVPreferredFocus}\n    >");

// 6) Compute isFocusTarget in renderEpisodeItem and pass it to EpisodeCard.
// Anchor on existing renderEpisodeItem body. The user's file has the
// epContentId/epWatched lines already.
const renderRe = /(const epContentId = `\$\{baseId \|\| id\}:\$\{item\.season\}:\$\{item\.episode\}`;\s*[\r\n]+\s*const epWatched = !!watchedEpisodes\[epContentId\];)\s*[\r\n]+\s*return \(\s*[\r\n]+\s*<EpisodeCard\s+([\s\S]*?)\/>/;
if (!renderRe.test(dsrc)) die('could not find renderEpisodeItem body.');

dsrc = dsrc.replace(renderRe,
  "$1\n" +
  "    /* v124c-back-contextual: focus the episode the user just finished */\n" +
  "    const isFocusTarget = !!(focusSParam && focusEParam && parseInt(String(focusSParam), 10) === item.season && parseInt(String(focusEParam), 10) === item.episode);\n" +
  "    return (\n" +
  "      <EpisodeCard\n" +
  "        $2\n" +
  "        hasTVPreferredFocus={isFocusTarget}\n" +
  "      />"
);

// 7) Insert a final marker to make re-runs idempotent.
dsrc = dsrc.replace(
  /(const autoPlayTriggeredRef\s*=\s*useRef\(false\);)/,
  "$1\n  // v124c-back-contextual"
);

const dbak = DETAILS + '.bak.v124c';
if (!fs.existsSync(dbak)) fs.copyFileSync(DETAILS, dbak);
fs.writeFileSync(DETAILS, dsrc, 'utf8');
console.log('[v124c] patched ' + DETAILS);
console.log('[v124c] backup: ' + dbak);
console.log('[v124c] OK - rebuild and sideload.');
