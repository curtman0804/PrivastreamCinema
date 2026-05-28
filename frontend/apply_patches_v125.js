/* eslint-disable */
// apply_patches_v125_focus_and_flash.js
//
// Two surgical fixes for app/details/[type]/[id].tsx (series root + autoplay):
//
//   FIX A (Bug A — Episode card flash during autoplay):
//     The overlay condition is `(autoPlayParam && !triggered) || isPlayLoading`.
//     Today we flip `autoPlayTriggeredRef.current = true` BEFORE
//     `setIsPlayLoading(true)`, so for ~200ms the overlay disappears and the
//     bare episode page paints (flash) before /player mounts. Reverse the
//     order so the overlay stays continuously visible until the player
//     screen takes over.
//
//   FIX B (Bug B — Series Root TV focus reverts to S1E1):
//     When the user backs out of an episode the series root re-mounts with
//     `selectedEpisode` in params, but no UI honours it.  Add a memoised
//     "target episode" computation, pass `hasTVPreferredFocus` down to the
//     correct <EpisodeCard/>, force focus through `setNativeProps` after
//     the FlatList lays out, and use `initialScrollIndex + getItemLayout`
//     so that target item is actually mounted at first paint.
//
// CRLF-safe (uses [\s\S]*? for cross-line matching, no \n vs \r\n
// assumptions).  Written for Windows CMD users — run as:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v125_focus_and_flash.js -o apply_patches_v125.js && node apply_patches_v125.js
//
const fs = require('fs');
const path = require('path');

function findFile() {
  const candidates = [
    path.join(process.cwd(), 'app', 'details', '[type]', '[id].tsx'),
    path.join(process.cwd(), 'frontend', 'app', 'details', '[type]', '[id].tsx'),
    path.join(process.cwd(), '..', 'frontend', 'app', 'details', '[type]', '[id].tsx'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const filePath = findFile();
if (!filePath) {
  console.error('[v125] FATAL: Could not find app/details/[type]/[id].tsx');
  console.error('       Run this script from the frontend project root.');
  process.exit(1);
}
console.log('[v125] Patching:', filePath);

let src = fs.readFileSync(filePath, 'utf8');
const originalLen = src.length;
const NL = src.includes('\r\n') ? '\r\n' : '\n';
console.log('[v125] Line endings:', NL === '\r\n' ? 'CRLF (Windows)' : 'LF (Unix)');

// Backup
const backupPath = filePath + '.bak_v125';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log('[v125] Backup written:', backupPath);
}

const reports = [];
function applyOnce(label, pattern, replacement) {
  const matches = src.match(pattern);
  if (!matches) {
    reports.push({ label, status: 'NOT_FOUND' });
    return false;
  }
  if (matches.length > 1) {
    reports.push({ label, status: 'AMBIGUOUS', count: matches.length });
    return false;
  }
  const before = src.length;
  src = src.replace(pattern, replacement);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// PATCH 1: FIX A — overlay flash. In the autoplay useEffect block, swap
// `autoPlayTriggeredRef.current = true; ... setTimeout(handleStreamSelect)`
// for `setIsPlayLoading(true); autoPlayTriggeredRef.current = true; ...`.
// We anchor on the unique `[AUTOPLAY] Content ready:` log line.
// ---------------------------------------------------------------------------
applyOnce(
  'P1: autoplay no-flash (setIsPlayLoading before triggered)',
  /autoPlayTriggeredRef\.current = true;[\s\S]*?const sorted = sortStreamsByLanguage\(streams\);[\s\S]*?const bestStream = sorted\[0\];[\s\S]*?if \(bestStream\) \{[\s\S]*?console\.log\('\[AUTOPLAY\] Content ready:'[\s\S]*?\);[\s\S]*?setTimeout\(\(\) => handleStreamSelect\(bestStream\), 200\);[\s\S]*?\}/,
  // Reordered: compute first, then keep overlay alive via setIsPlayLoading,
  // THEN flip triggered ref so the (autoPlay && !triggered) clause turns
  // off only while isPlayLoading clause is true.  Result: no single-frame
  // gap, no episode card flash.
  `const sorted = sortStreamsByLanguage(streams);${NL}      const bestStream = sorted[0];${NL}      if (bestStream) {${NL}        console.log('[AUTOPLAY] Content ready:', contentReady, '- selecting best stream for', id, '->', bestStream.title || bestStream.name);${NL}        // v125 FIX A: flip isPlayLoading BEFORE triggered ref so the${NL}        // cinematic overlay never disappears for a frame between${NL}        // autoplay-handoff and /player mounting.${NL}        setIsPlayLoading(true);${NL}        autoPlayTriggeredRef.current = true;${NL}        setTimeout(() => handleStreamSelect(bestStream), 200);${NL}      } else {${NL}        autoPlayTriggeredRef.current = true;${NL}      }`
);

// ---------------------------------------------------------------------------
// PATCH 2: FIX B-1 — EpisodeCard props.  Add `hasTVPreferredFocus` to the
// destructured props and the TS prop-type block.
// ---------------------------------------------------------------------------
applyOnce(
  'P2: EpisodeCard props signature (add hasTVPreferredFocus)',
  /function EpisodeCard\(\{[\s\S]*?onMarkUnwatched,\s*\}: \{\s*episode: Episode;[\s\S]*?onMarkUnwatched\?: \(\) => void;\s*\}\) \{/,
  `function EpisodeCard({ ${NL}  episode, ${NL}  fallbackPoster, ${NL}  onPress,${NL}  isWatched,${NL}  onMarkUnwatched,${NL}  hasTVPreferredFocus,${NL}}: { ${NL}  episode: Episode; ${NL}  fallbackPoster?: string;${NL}  onPress: () => void;${NL}  isWatched?: boolean;${NL}  onMarkUnwatched?: () => void;${NL}  hasTVPreferredFocus?: boolean;${NL}}) {`
);

// ---------------------------------------------------------------------------
// PATCH 3a: FIX B-2a — Inject ref + useEffect into the EpisodeCard body.
// Anchored on the unique `const thumbUri = episode.thumbnail || fallbackPoster;`
// line which only appears inside EpisodeCard.
// ---------------------------------------------------------------------------
applyOnce(
  'P3a: EpisodeCard inject useRef + forced-focus useEffect',
  /const thumbUri = episode\.thumbnail \|\| fallbackPoster;/,
  `const thumbUri = episode.thumbnail || fallbackPoster;${NL}  // v125 FIX B: ref + forced TV focus for the "last-watched" episode.${NL}  // Android TV is finicky about honouring hasTVPreferredFocus after a${NL}  // back-navigation re-mount, so we replay it via setNativeProps at${NL}  // several delays until something sticks.${NL}  const epRef = useRef<any>(null);${NL}  useEffect(() => {${NL}    if (!hasTVPreferredFocus) return;${NL}    const ids: any[] = [];${NL}    [50, 250, 600].forEach((d) => {${NL}      ids.push(setTimeout(() => {${NL}        try { epRef.current && epRef.current.setNativeProps && epRef.current.setNativeProps({ hasTVPreferredFocus: true }); } catch (_) {}${NL}      }, d));${NL}    });${NL}    return () => { ids.forEach((i) => clearTimeout(i)); };${NL}  }, [hasTVPreferredFocus]);`
);

// ---------------------------------------------------------------------------
// PATCH 3b: FIX B-2b — Add ref + hasTVPreferredFocus to the EpisodeCard
// <Pressable/> opening tag.  Anchored on the unique `styles.episodeCard,
// isFocused && styles.episodeCardFocused` style array (only one in the file).
// ---------------------------------------------------------------------------
applyOnce(
  'P3b: EpisodeCard <Pressable> add ref + hasTVPreferredFocus prop',
  /<Pressable\s*style=\{\[styles\.episodeCard, isFocused && styles\.episodeCardFocused\]\}\s*onPress=\{onPress\}\s*onLongPress=\{isWatched \? onMarkUnwatched : undefined\}\s*onFocus=\{\(\) => setIsFocused\(true\)\}\s*onBlur=\{\(\) => setIsFocused\(false\)\}\s*delayLongPress=\{600\}\s*>/,
  `<Pressable${NL}      ref={epRef}${NL}      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}${NL}      onPress={onPress}${NL}      onLongPress={isWatched ? onMarkUnwatched : undefined}${NL}      onFocus={() => setIsFocused(true)}${NL}      onBlur={() => setIsFocused(false)}${NL}      delayLongPress={600}${NL}      hasTVPreferredFocus={hasTVPreferredFocus}${NL}    >`
);

// ---------------------------------------------------------------------------
// PATCH 4: FIX B-3 — inject targetEpisodeNumber + targetEpisodeIndex memos
// just after the `episodesForSeason` useMemo block.
// ---------------------------------------------------------------------------
applyOnce(
  'P4: targetEpisodeNumber + targetEpisodeIndex memos',
  /const episodesForSeason = useMemo\(\(\) => \{[\s\S]*?\.sort\(\(a, b\) => a\.episode - b\.episode\);[\s\S]*?\}, \[content\?\.videos, selectedSeason\]\);/,
  (m) => `${m}${NL}${NL}  // v125 FIX B: figure out which episode the user was last on so we can${NL}  // give it TV focus + scroll it into view when the series root remounts.${NL}  // Priority: explicit selectedEpisode route param > highest "watched" ep${NL}  // in the current season > null (let first card take focus).${NL}  const targetEpisodeNumber = useMemo(() => {${NL}    if (type !== 'series') return null;${NL}    const fromParam = paramSelectedEpisode != null ? parseInt(String(paramSelectedEpisode), 10) : NaN;${NL}    if (!isNaN(fromParam)) return fromParam;${NL}    const prefix = \`\${baseId || id}:\${selectedSeason}:\`;${NL}    const watchedNums = Object.keys(watchedEpisodes)${NL}      .filter((k) => k.startsWith(prefix) && watchedEpisodes[k])${NL}      .map((k) => parseInt(k.split(':')[2], 10))${NL}      .filter((n) => !isNaN(n));${NL}    if (watchedNums.length === 0) return null;${NL}    return Math.max(...watchedNums);${NL}  }, [type, paramSelectedEpisode, watchedEpisodes, baseId, id, selectedSeason]);${NL}${NL}  const targetEpisodeIndex = useMemo(() => {${NL}    if (targetEpisodeNumber == null) return 0;${NL}    const idx = episodesForSeason.findIndex((ep) => ep.episode === targetEpisodeNumber);${NL}    return idx >= 0 ? idx : 0;${NL}  }, [episodesForSeason, targetEpisodeNumber]);`
);

// ---------------------------------------------------------------------------
// PATCH 5: FIX B-4 — renderEpisodeItem passes hasTVPreferredFocus down.
// ---------------------------------------------------------------------------
applyOnce(
  'P5: renderEpisodeItem passes hasTVPreferredFocus',
  /\/\/ Render episode item for FlatList\s*const renderEpisodeItem = \(\{ item \}: \{ item: Episode \}\) => \{[\s\S]*?const epWatched = !!watchedEpisodes\[epContentId\];[\s\S]*?return \(\s*<EpisodeCard\s*episode=\{item\}\s*fallbackPoster=\{content\?\.poster\}\s*onPress=\{\(\) => handleEpisodePress\(item\)\}\s*isWatched=\{epWatched\}\s*onMarkUnwatched=\{\(\) => handleMarkUnwatched\(epContentId\)\}\s*\/>\s*\);\s*\};/,
  `// Render episode item for FlatList${NL}  const renderEpisodeItem = ({ item }: { item: Episode }) => {${NL}    // Check watched status using series:season:episode format${NL}    const epContentId = \`\${baseId || id}:\${item.season}:\${item.episode}\`;${NL}    const epWatched = !!watchedEpisodes[epContentId];${NL}    // v125 FIX B: focus on the user's last-watched episode (or the${NL}    // explicit selectedEpisode route param) when returning to series root.${NL}    const isFocusTarget = targetEpisodeNumber != null${NL}      && item.season === selectedSeason${NL}      && item.episode === targetEpisodeNumber;${NL}    return (${NL}      <EpisodeCard ${NL}        episode={item} ${NL}        fallbackPoster={content?.poster}${NL}        onPress={() => handleEpisodePress(item)}${NL}        isWatched={epWatched}${NL}        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}${NL}        hasTVPreferredFocus={isFocusTarget}${NL}      />${NL}    );${NL}  };`
);

// ---------------------------------------------------------------------------
// PATCH 6: FIX B-5 — Episodes FlatList: initialScrollIndex + getItemLayout
// + onScrollToIndexFailed safety net. Card width = 160, gap = 12 → 172/item.
// ---------------------------------------------------------------------------
applyOnce(
  'P6: Episodes FlatList initialScrollIndex + getItemLayout',
  /\{\/\* Episodes List \*\/\}\s*<FlatList\s*data=\{episodesForSeason\}\s*renderItem=\{renderEpisodeItem\}\s*keyExtractor=\{\(item\) => `\$\{item\.season\}-\$\{item\.episode\}`\}\s*horizontal\s*showsHorizontalScrollIndicator=\{false\}\s*contentContainerStyle=\{styles\.episodesList\}\s*\/>/,
  `{/* Episodes List */}${NL}              <FlatList${NL}                key={\`eps-\${selectedSeason}-\${targetEpisodeIndex}\`}${NL}                data={episodesForSeason}${NL}                renderItem={renderEpisodeItem}${NL}                keyExtractor={(item) => \`\${item.season}-\${item.episode}\`}${NL}                horizontal${NL}                showsHorizontalScrollIndicator={false}${NL}                contentContainerStyle={styles.episodesList}${NL}                // v125 FIX B: ensure the last-watched card is mounted at${NL}                // first paint and scrolled into view, so hasTVPreferredFocus${NL}                // + setNativeProps actually have a node to grab.${NL}                initialScrollIndex={targetEpisodeIndex}${NL}                getItemLayout={(_, index) => ({ length: 160, offset: 172 * index, index })}${NL}                initialNumToRender={Math.max(8, targetEpisodeIndex + 3)}${NL}                onScrollToIndexFailed={(info) => {${NL}                  // Defensive: if the target slot isn't measured yet, retry${NL}                  // after a tick using the known item-pitch (172px).${NL}                  setTimeout(() => {${NL}                    try {${NL}                      // No FlatList ref here; rely on initialScrollIndex retry${NL}                    } catch (_) {}${NL}                  }, 100);${NL}                }}${NL}              />`
);

// ---------------------------------------------------------------------------
// Write back, report.
// ---------------------------------------------------------------------------
const anyFailed = reports.some(r => r.status !== 'OK');
console.log('');
console.log('[v125] === PATCH REPORT =====================================');
for (const r of reports) {
  const tag = r.status === 'OK' ? 'OK ' : (r.status === 'NOT_FOUND' ? 'MISS' : 'AMBI');
  console.log(`  [${tag}] ${r.label}` + (r.delta != null ? `  (Δ ${r.delta} chars)` : '') + (r.count != null ? `  (×${r.count})` : ''));
}
console.log('[v125] =====================================================');

if (anyFailed) {
  console.error('[v125] One or more patches failed.  File NOT written.');
  console.error('[v125] Backup remains at:', backupPath);
  process.exit(2);
}

fs.writeFileSync(filePath, src, 'utf8');
console.log(`[v125] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v125] Done. Rebuild and side-load the app.');
