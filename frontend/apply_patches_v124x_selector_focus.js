// apply_patches_v124x_selector_focus.js
//
// v124x - two small polishes to id.tsx, sitting on top of v124w.
//
//   1) Episode selector focus.
//      Currently EpisodeCard is a Pressable with no hasTVPreferredFocus.
//      When the user backs out of an episode page, v124w calls
//      router.setParams({selectedSeason, selectedEpisode}). The season tab
//      picks up the new season via the existing useEffect at line ~665,
//      but the TV focus still lands on the first episode card in the list.
//
//      Fix: thread an `autoFocus` prop through EpisodeCard, plumb it from
//      renderEpisodeItem based on a match against paramSelectedEpisode, and
//      re-key the FlatList so a setParams update forces a remount and a
//      fresh focus assignment.
//
//   2) "Loading next episode..." text.
//      Line ~1172 shows this even on the initial Play click. Replace with
//      plain "Loading..." for series too. The autoplay continuation already
//      has its own UX cues (countdown card before, episode title above).
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124x_selector_focus.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124x-selector-focus';

function die(msg) { console.error('[v124x] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124x] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// CHANGE 1a: extend EpisodeCard props to accept autoFocus.
// Anchor: the props destructure that ends with `onMarkUnwatched,` before
// the type annotation block.
// =========================================================================
{
  const destructureRe = /function EpisodeCard\(\{\s*\r?\n\s*episode,\s*\r?\n\s*fallbackPoster,\s*\r?\n\s*onPress,\s*\r?\n\s*isWatched,\s*\r?\n\s*onMarkUnwatched,\s*\r?\n\}: \{\s*\r?\n\s*episode: Episode;\s*\r?\n\s*fallbackPoster\?: string;\s*\r?\n\s*onPress: \(\) => void;\s*\r?\n\s*isWatched\?: boolean;\s*\r?\n\s*onMarkUnwatched\?: \(\) => void;\s*\r?\n\}\) \{/;
  if (!destructureRe.test(src)) die('cannot find EpisodeCard destructure');
  src = src.replace(destructureRe,
"function EpisodeCard({\r\n" +
"  episode,\r\n" +
"  fallbackPoster,\r\n" +
"  onPress,\r\n" +
"  isWatched,\r\n" +
"  onMarkUnwatched,\r\n" +
"  autoFocus,\r\n" +
"}: {\r\n" +
"  episode: Episode;\r\n" +
"  fallbackPoster?: string;\r\n" +
"  onPress: () => void;\r\n" +
"  isWatched?: boolean;\r\n" +
"  onMarkUnwatched?: () => void;\r\n" +
"  autoFocus?: boolean;\r\n" +
"}) {");
  info('1a: extended EpisodeCard props with autoFocus');
}

// =========================================================================
// CHANGE 1b: thread autoFocus into the Pressable as hasTVPreferredFocus.
// Anchor: the existing Pressable opening tag inside EpisodeCard.
// =========================================================================
{
  const pressableOld = '    <Pressable\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}\r\n      onLongPress={isWatched ? onMarkUnwatched : undefined}\r\n      onFocus={() => setIsFocused(true)}\r\n      onBlur={() => setIsFocused(false)}\r\n      delayLongPress={600}\r\n    >';
  const pressableNew = '    <Pressable\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}\r\n      onLongPress={isWatched ? onMarkUnwatched : undefined}\r\n      onFocus={() => setIsFocused(true)}\r\n      onBlur={() => setIsFocused(false)}\r\n      delayLongPress={600}\r\n      hasTVPreferredFocus={!!autoFocus}\r\n    >';
  if (src.indexOf(pressableOld) === -1) die('cannot find EpisodeCard Pressable opening tag');
  src = src.replace(pressableOld, pressableNew);
  info('1b: added hasTVPreferredFocus={autoFocus} to EpisodeCard Pressable');
}

// =========================================================================
// CHANGE 1c: in renderEpisodeItem, compute isCurrentEpisode and pass autoFocus.
// =========================================================================
{
  const renderOld = "  const renderEpisodeItem = ({ item }: { item: Episode }) => {\r\n" +
"    // Check watched status using series:season:episode format\r\n" +
"    const epContentId = `${baseId || id}:${item.season}:${item.episode}`;\r\n" +
"    const epWatched = !!watchedEpisodes[epContentId];\r\n" +
"    return (\r\n" +
"      <EpisodeCard \r\n" +
"        episode={item} \r\n" +
"        fallbackPoster={content?.poster}\r\n" +
"        onPress={() => handleEpisodePress(item)}\r\n" +
"        isWatched={epWatched}\r\n" +
"        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}\r\n" +
"      />\r\n" +
"    );\r\n" +
"  };";
  const renderNew = "  const renderEpisodeItem = ({ item }: { item: Episode }) => {\r\n" +
"    // v124x-selector-focus: focus the card that matches paramSelectedEpisode.\r\n" +
"    const epContentId = `${baseId || id}:${item.season}:${item.episode}`;\r\n" +
"    const epWatched = !!watchedEpisodes[epContentId];\r\n" +
"    const selEpNum = paramSelectedEpisode ? parseInt(String(paramSelectedEpisode), 10) : NaN;\r\n" +
"    const isCurrentEp = !isNaN(selEpNum) && item.season === selectedSeason && item.episode === selEpNum;\r\n" +
"    return (\r\n" +
"      <EpisodeCard \r\n" +
"        episode={item} \r\n" +
"        fallbackPoster={content?.poster}\r\n" +
"        onPress={() => handleEpisodePress(item)}\r\n" +
"        isWatched={epWatched}\r\n" +
"        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}\r\n" +
"        autoFocus={isCurrentEp}\r\n" +
"      />\r\n" +
"    );\r\n" +
"  };";
  if (src.indexOf(renderOld) === -1) die('cannot find renderEpisodeItem block');
  src = src.replace(renderOld, renderNew);
  info('1c: renderEpisodeItem passes autoFocus={isCurrentEp}');
}

// =========================================================================
// CHANGE 1d: add a key prop to the episodes FlatList so it remounts when
// paramSelectedEpisode changes. hasTVPreferredFocus only takes effect at
// mount; remount = fresh focus assignment.
// =========================================================================
{
  const flatListOld = "              {/* Episodes List */}\r\n" +
"              <FlatList\r\n" +
"                data={episodesForSeason}\r\n" +
"                renderItem={renderEpisodeItem}\r\n" +
"                keyExtractor={(item) => `${item.season}-${item.episode}`}\r\n" +
"                horizontal\r\n" +
"                showsHorizontalScrollIndicator={false}\r\n" +
"                contentContainerStyle={styles.episodesList}\r\n" +
"              />";
  const flatListNew = "              {/* Episodes List */}\r\n" +
"              <FlatList\r\n" +
"                key={`episodes-${selectedSeason}-${paramSelectedEpisode || ''}`}\r\n" +
"                data={episodesForSeason}\r\n" +
"                renderItem={renderEpisodeItem}\r\n" +
"                keyExtractor={(item) => `${item.season}-${item.episode}`}\r\n" +
"                horizontal\r\n" +
"                showsHorizontalScrollIndicator={false}\r\n" +
"                contentContainerStyle={styles.episodesList}\r\n" +
"              />";
  if (src.indexOf(flatListOld) === -1) die('cannot find episodes FlatList block');
  src = src.replace(flatListOld, flatListNew);
  info('1d: re-keyed episodes FlatList on selectedSeason+paramSelectedEpisode');
}

// =========================================================================
// CHANGE 2: kill the "Loading next episode..." text on initial play.
// =========================================================================
{
  const txtOld = "{type === 'movie' ? 'Loading...' : 'Loading next episode...'}";
  const txtNew = "{'Loading...'}  /* v124x: was 'Loading next episode...' for series */";
  if (src.indexOf(txtOld) === -1) die('cannot find Loading next episode text');
  src = src.replace(txtOld, txtNew);
  info('2: replaced "Loading next episode..." with "Loading..."');
}

// =========================================================================
// Backup + write.
// =========================================================================
const bak = DETAILS + '.bak.v124x';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
info('Expected: backing out of an episode lands selector on that episode.');
info('         "Loading..." instead of "Loading next episode..." on initial Play.');
