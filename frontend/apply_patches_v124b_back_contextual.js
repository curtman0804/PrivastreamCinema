// apply_patches_v124b_back_contextual.js
//
// REPLACES v124. Implements contextual back from the player:
//   - MOVIE: router.back() returns to /details/movie/<id> (stream cards page).
//     No change from default behavior - just makes sure handleBack stays as
//     router.back() for movies.
//   - SERIES: router.replace to /details/series/<seriesId> (the SHOW root,
//     not the specific-episode page), with focusS / focusE params so the
//     show-root page can:
//       1. Pre-select the season the user was watching
//       2. Put the D-pad selector on the exact episode they just finished
//
// Patches BOTH app/player.tsx and app/details/[type]/[id].tsx in one run.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124b_back_contextual.js

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('app', 'player.tsx');
const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124b-back-contextual';

function die(msg) { console.error('[v124b] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(PLAYER)) die('cannot find ' + PLAYER);
if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);

let psrc = fs.readFileSync(PLAYER, 'utf8');
let dsrc = fs.readFileSync(DETAILS, 'utf8');

if (psrc.includes(MARKER) && dsrc.includes(MARKER)) {
  console.log('[v124b] already applied to both files - nothing to do.');
  process.exit(0);
}

// =========================================================================
// PLAYER.TSX  -  handleBack becomes series-aware
// =========================================================================
if (!psrc.includes(MARKER)) {
  // Match either the original `handleBack = () => { router.back(); };` or
  // a previously-applied v124 version. Whitespace flexible.
  const re = /\/\/ Handle back button\s*[\r\n]+\s*(?:\/\/ v124-back-to-root:[^\n]*[\r\n]+\s*\/\/[^\n]*[\r\n]+\s*)?const handleBack = \(\) => \{[\s\S]*?\};/;
  if (!re.test(psrc)) die('could not find handleBack function in player.tsx.');

  const replacement =
    "// v124b-back-contextual: contextual back from player.\n" +
    "  //   Series -> show root with current episode focused.\n" +
    "  //   Movie  -> default router.back() (stream cards page).\n" +
    "  const handleBack = () => {\n" +
    "    try {\n" +
    "      if (contentType === 'series' && seriesId && season && episode) {\n" +
    "        router.replace({\n" +
    "          pathname: `/details/series/${seriesId}`,\n" +
    "          params: { focusS: String(season), focusE: String(episode) },\n" +
    "        });\n" +
    "        return;\n" +
    "      }\n" +
    "    } catch (e) {\n" +
    "      console.log('[PLAYER] v124b handleBack error', e);\n" +
    "    }\n" +
    "    router.back();\n" +
    "  };";

  psrc = psrc.replace(re, replacement);

  const pbak = PLAYER + '.bak.v124b';
  if (!fs.existsSync(pbak)) fs.copyFileSync(PLAYER, pbak);
  fs.writeFileSync(PLAYER, psrc, 'utf8');
  console.log('[v124b] patched ' + PLAYER);
}

// =========================================================================
// DETAILS_ID.TSX  -  read focusS/focusE; set selectedSeason; focus the card
// =========================================================================
if (!dsrc.includes(MARKER)) {
  // 1) Extend useLocalSearchParams destructuring to include focusS and focusE.
  // Anchor on the existing autoPlay destructure.
  const paramAnchor = /autoPlay:\s*autoPlayParam,/;
  if (!paramAnchor.test(dsrc)) die('could not find autoPlay param destructure in details.');
  dsrc = dsrc.replace(
    paramAnchor,
    "autoPlay: autoPlayParam,\n    focusS: focusSParam,\n    focusE: focusEParam,"
  );

  // 2) Extend the param type definition the same way.
  const typeAnchor = /autoPlay\?:\s*string;/;
  if (!typeAnchor.test(dsrc)) die('could not find autoPlay param type.');
  dsrc = dsrc.replace(
    typeAnchor,
    "autoPlay?: string;\n    focusS?: string;\n    focusE?: string;"
  );

  // 3) Pre-select the season when focusSParam is present. Anchor on the
  // existing seasons-defaulting useEffect.
  const seasonEffectRe = /useEffect\(\(\) => \{\s*[\r\n]+\s*if \(seasons\.length > 0 && !seasons\.includes\(selectedSeason\)\) \{\s*[\r\n]+\s*setSelectedSeason\(seasons\[0\]\);\s*[\r\n]+\s*\}\s*[\r\n]+\s*\}, \[seasons\]\);/;
  if (!seasonEffectRe.test(dsrc)) die('could not find seasons useEffect anchor.');
  dsrc = dsrc.replace(
    seasonEffectRe,
    "useEffect(() => {\n" +
    "    /* v124b-back-contextual */\n" +
    "    // If returning from the player via contextual back, jump to the\n" +
    "    // season we were watching - even if it isn't the first season.\n" +
    "    const wantedSeason = focusSParam ? parseInt(String(focusSParam)) : null;\n" +
    "    if (wantedSeason && seasons.includes(wantedSeason) && selectedSeason !== wantedSeason) {\n" +
    "      setSelectedSeason(wantedSeason);\n" +
    "      return;\n" +
    "    }\n" +
    "    if (seasons.length > 0 && !seasons.includes(selectedSeason)) {\n" +
    "      setSelectedSeason(seasons[0]);\n" +
    "    }\n" +
    "  }, [seasons, focusSParam]);"
  );

  // 4) Pass hasTVPreferredFocus on the matching EpisodeCard. Anchor on
  // renderEpisodeItem so we can rewrite its body.
  const renderRe = /const renderEpisodeItem = \(\{ item \}: \{ item: Episode \}\) => \{[\s\S]*?return \(\s*[\r\n]+\s*<EpisodeCard\s+[\s\S]*?\/>\s*[\r\n]+\s*\);\s*[\r\n]+\s*\};/;
  if (!renderRe.test(dsrc)) die('could not find renderEpisodeItem anchor.');
  dsrc = dsrc.replace(
    renderRe,
    "const renderEpisodeItem = ({ item }: { item: Episode }) => {\n" +
    "    // v124b-back-contextual: focus the episode the user just finished\n" +
    "    const epContentId = `${baseId || id}:${item.season}:${item.episode}`;\n" +
    "    const epWatched = !!watchedEpisodes[epContentId];\n" +
    "    const isFocusTarget = !!(focusSParam && focusEParam && parseInt(String(focusSParam)) === item.season && parseInt(String(focusEParam)) === item.episode);\n" +
    "    return (\n" +
    "      <EpisodeCard\n" +
    "        episode={item}\n" +
    "        fallbackPoster={content?.poster}\n" +
    "        onPress={() => handleEpisodePress(item)}\n" +
    "        isWatched={epWatched}\n" +
    "        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}\n" +
    "        hasTVPreferredFocus={isFocusTarget}\n" +
    "      />\n" +
    "    );\n" +
    "  };"
  );

  // 5) Add hasTVPreferredFocus prop to EpisodeCard signature + Pressable.
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

  // 6) Pass hasTVPreferredFocus into the Pressable inside EpisodeCard.
  const epcPressRe = /<Pressable\s*[\r\n]+\s*style=\{\[styles\.episodeCard, isFocused && styles\.episodeCardFocused\]\}\s*[\r\n]+\s*onPress=\{onPress\}\s*[\r\n]+\s*onLongPress=\{isWatched \? onMarkUnwatched : undefined\}\s*[\r\n]+\s*onFocus=\{\(\) => setIsFocused\(true\)\}\s*[\r\n]+\s*onBlur=\{\(\) => setIsFocused\(false\)\}\s*[\r\n]+\s*delayLongPress=\{600\}\s*[\r\n]+\s*>/;
  if (!epcPressRe.test(dsrc)) die('could not find EpisodeCard Pressable.');
  dsrc = dsrc.replace(
    epcPressRe,
    "<Pressable\n" +
    "      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\n" +
    "      onPress={onPress}\n" +
    "      onLongPress={isWatched ? onMarkUnwatched : undefined}\n" +
    "      onFocus={() => setIsFocused(true)}\n" +
    "      onBlur={() => setIsFocused(false)}\n" +
    "      delayLongPress={600}\n" +
    "      hasTVPreferredFocus={hasTVPreferredFocus}\n" +
    "    >"
  );

  // 7) Add a marker comment so re-runs are no-ops.
  dsrc = dsrc.replace(
    /(const autoPlayTriggeredRef\s*=\s*useRef\(false\);)/,
    "$1\n  // v124b-back-contextual"
  );

  const dbak = DETAILS + '.bak.v124b';
  if (!fs.existsSync(dbak)) fs.copyFileSync(DETAILS, dbak);
  fs.writeFileSync(DETAILS, dsrc, 'utf8');
  console.log('[v124b] patched ' + DETAILS);
}

console.log('[v124b] OK - rebuild and sideload.');
