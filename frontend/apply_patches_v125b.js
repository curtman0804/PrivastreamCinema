/* eslint-disable */
// apply_patches_v125b_focus_and_flash.js
//
// v125b — surgical rewrite that targets the CURRENT state of your local file
// (post-v124ab).  Three changes only:
//
//   P1 (FIX A): Reorder the autoplay trigger so `setIsPlayLoading(true)`
//       fires BEFORE `autoPlayTriggeredRef.current = true` and the
//       `router.setParams({ autoPlay: '' })` clear, eliminating the
//       single-frame window where the cinematic overlay disappears (the
//       "episode card flash").
//
//   P2 (FIX B-1): Inject `targetEpisodeNumber` + `targetEpisodeIndex` memos
//       just after `episodesForSeason`.  Picks the explicit
//       `paramSelectedEpisode` first, else falls back to the highest watched
//       episode in the current season.
//
//   P3 (FIX B-2): Rewrite `renderEpisodeItem` to use `targetEpisodeNumber`
//       (so the focused card is also the "last-watched" card, not only the
//       one with an explicit param).
//
//   P4 (FIX B-3): Add `initialScrollIndex`, `getItemLayout`, and
//       `initialNumToRender` to the Episodes FlatList so the target card is
//       actually mounted at first paint (without this, virtualization skips
//       far-right items and the existing v124ab setNativeProps retry has
//       no node to grab).
//
// All patches are idempotent — re-running this script is a no-op if v125b
// has already been applied.
//
// CRLF-safe.  Windows CMD users run as:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v125b_focus_and_flash.js -o apply_patches_v125b.js && node apply_patches_v125b.js
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
  console.error('[v125b] FATAL: Could not find app/details/[type]/[id].tsx');
  console.error('        Run this script from the frontend project root.');
  process.exit(1);
}
console.log('[v125b] Patching:', filePath);

let src = fs.readFileSync(filePath, 'utf8');
const originalLen = src.length;
const NL = src.includes('\r\n') ? '\r\n' : '\n';
console.log('[v125b] Line endings:', NL === '\r\n' ? 'CRLF (Windows)' : 'LF (Unix)');

const backupPath = filePath + '.bak_v125b';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log('[v125b] Backup written:', backupPath);
}

const reports = [];
function applyOnce(label, alreadyAppliedMarker, pattern, replacement) {
  if (alreadyAppliedMarker && src.indexOf(alreadyAppliedMarker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const matches = src.match(pattern);
  if (!matches) {
    reports.push({ label, status: 'NOT_FOUND' });
    return false;
  }
  const fullMatches = [];
  const gPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let m;
  while ((m = gPattern.exec(src)) !== null) {
    fullMatches.push(m[0]);
    if (gPattern.lastIndex === m.index) gPattern.lastIndex++;
  }
  if (fullMatches.length > 1) {
    reports.push({ label, status: 'AMBIGUOUS', count: fullMatches.length });
    return false;
  }
  const before = src.length;
  src = src.replace(pattern, replacement);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// P1 — autoplay no-flash.  In the autoplay useEffect block, reorder so
// setIsPlayLoading fires BEFORE the trigger ref flip and the autoPlay param
// clear.  Anchored on the `[AUTOPLAY] Content ready:` log line which is
// unique to this useEffect.
//
// Current block (your v124z):
//   autoPlayTriggeredRef.current = true;
//   try { router.setParams({ autoPlay: '' } as any); } catch (_) {}
//   const sorted = sortStreamsByLanguage(streams);
//   const bestStream = sorted[0];
//   if (bestStream) {
//     console.log('[AUTOPLAY] Content ready:', ...);
//     setTimeout(() => handleStreamSelect(bestStream), 200);
//   }
// ---------------------------------------------------------------------------
applyOnce(
  'P1: autoplay no-flash (setIsPlayLoading before triggered)',
  '/* v125b-no-flash */',
  /autoPlayTriggeredRef\.current = true;[\s\S]*?try \{ router\.setParams\(\{ autoPlay: '' \} as any\); \} catch \(_\) \{\}[\s\S]*?const sorted = sortStreamsByLanguage\(streams\);[\s\S]*?const bestStream = sorted\[0\];[\s\S]*?if \(bestStream\) \{[\s\S]*?console\.log\('\[AUTOPLAY\] Content ready:'[\s\S]*?\);[\s\S]*?setTimeout\(\(\) => handleStreamSelect\(bestStream\), 200\);[\s\S]*?\}/,
  `/* v125b-no-flash */${NL}      const sorted = sortStreamsByLanguage(streams);${NL}      const bestStream = sorted[0];${NL}      if (bestStream) {${NL}        console.log('[AUTOPLAY] Content ready:', contentReady, '- selecting best stream for', id, '->', bestStream.title || bestStream.name);${NL}        // v125b FIX A: keep the cinematic overlay continuously visible.${NL}        // setIsPlayLoading(true) must fire BEFORE we flip the trigger ref${NL}        // or clear the autoPlay param, otherwise the overlay condition${NL}        // (autoPlay && !triggered) || isPlayLoading goes false for one${NL}        // frame and the bare episode card paints (the "flash").${NL}        setIsPlayLoading(true);${NL}        autoPlayTriggeredRef.current = true;${NL}        try { router.setParams({ autoPlay: '' } as any); } catch (_) {}${NL}        setTimeout(() => handleStreamSelect(bestStream), 200);${NL}      } else {${NL}        autoPlayTriggeredRef.current = true;${NL}        try { router.setParams({ autoPlay: '' } as any); } catch (_) {}${NL}      }`
);

// ---------------------------------------------------------------------------
// P2 — inject targetEpisodeNumber + targetEpisodeIndex memos right after
// the `episodesForSeason` useMemo block.  These compute which episode the
// user was last on (param > highest watched > none).
// ---------------------------------------------------------------------------
applyOnce(
  'P2: targetEpisodeNumber + targetEpisodeIndex memos',
  '/* v125b-target-episode */',
  /const episodesForSeason = useMemo\(\(\) => \{[\s\S]*?\.sort\(\(a, b\) => a\.episode - b\.episode\);[\s\S]*?\}, \[content\?\.videos, selectedSeason\]\);/,
  (m) => `${m}${NL}${NL}  /* v125b-target-episode */${NL}  // Which episode should take TV focus when the series root renders?${NL}  // Priority:${NL}  //   1) explicit paramSelectedEpisode (set by goToSeriesRootWithFocus${NL}  //      when the user backs out of an episode page)${NL}  //   2) highest-numbered watched episode in the current season${NL}  //   3) null → first card takes focus (FlatList default)${NL}  const targetEpisodeNumber = useMemo(() => {${NL}    if (type !== 'series') return null;${NL}    const fromParam = paramSelectedEpisode != null${NL}      ? parseInt(String(paramSelectedEpisode), 10)${NL}      : NaN;${NL}    if (!isNaN(fromParam)) return fromParam;${NL}    const prefix = \`\${baseId || id}:\${selectedSeason}:\`;${NL}    const watchedNums = Object.keys(watchedEpisodes)${NL}      .filter((k) => k.startsWith(prefix) && watchedEpisodes[k])${NL}      .map((k) => parseInt(k.split(':')[2], 10))${NL}      .filter((n) => !isNaN(n));${NL}    if (watchedNums.length === 0) return null;${NL}    return Math.max(...watchedNums);${NL}  }, [type, paramSelectedEpisode, watchedEpisodes, baseId, id, selectedSeason]);${NL}${NL}  const targetEpisodeIndex = useMemo(() => {${NL}    if (targetEpisodeNumber == null) return 0;${NL}    const idx = episodesForSeason.findIndex(${NL}      (ep) => ep.episode === targetEpisodeNumber${NL}    );${NL}    return idx >= 0 ? idx : 0;${NL}  }, [episodesForSeason, targetEpisodeNumber]);`
);

// ---------------------------------------------------------------------------
// P3 — rewrite renderEpisodeItem to consume targetEpisodeNumber, so the
// fallback (highest watched ep) also receives autoFocus, not only the
// param-driven case.  Anchored on the unique v124x-selector-focus comment.
// ---------------------------------------------------------------------------
applyOnce(
  'P3: renderEpisodeItem uses targetEpisodeNumber',
  '/* v125b-focus-target */',
  /\/\/ Render episode item for FlatList\s*const renderEpisodeItem = \(\{ item \}: \{ item: Episode \}\) => \{\s*\/\/ v124x-selector-focus:[\s\S]*?const epContentId = `\$\{baseId \|\| id\}:\$\{item\.season\}:\$\{item\.episode\}`;[\s\S]*?const epWatched = !!watchedEpisodes\[epContentId\];[\s\S]*?const selEpNum = paramSelectedEpisode \? parseInt\(String\(paramSelectedEpisode\), 10\) : NaN;[\s\S]*?const isCurrentEp = !isNaN\(selEpNum\) && item\.season === selectedSeason && item\.episode === selEpNum;[\s\S]*?return \(\s*<EpisodeCard\s*episode=\{item\}\s*fallbackPoster=\{content\?\.poster\}\s*onPress=\{\(\) => handleEpisodePress\(item\)\}\s*isWatched=\{epWatched\}\s*onMarkUnwatched=\{\(\) => handleMarkUnwatched\(epContentId\)\}\s*autoFocus=\{isCurrentEp\}\s*\/>\s*\);\s*\};/,
  `// Render episode item for FlatList${NL}  /* v125b-focus-target */${NL}  const renderEpisodeItem = ({ item }: { item: Episode }) => {${NL}    // v125b: focus the targetEpisodeNumber card (param-driven OR last-watched).${NL}    const epContentId = \`\${baseId || id}:\${item.season}:\${item.episode}\`;${NL}    const epWatched = !!watchedEpisodes[epContentId];${NL}    const isFocusTarget = targetEpisodeNumber != null${NL}      && item.season === selectedSeason${NL}      && item.episode === targetEpisodeNumber;${NL}    return (${NL}      <EpisodeCard${NL}        episode={item}${NL}        fallbackPoster={content?.poster}${NL}        onPress={() => handleEpisodePress(item)}${NL}        isWatched={epWatched}${NL}        onMarkUnwatched={() => handleMarkUnwatched(epContentId)}${NL}        autoFocus={isFocusTarget}${NL}      />${NL}    );${NL}  };`
);

// ---------------------------------------------------------------------------
// P4 — Episodes FlatList: add initialScrollIndex + getItemLayout +
// initialNumToRender so the target card is mounted at first paint.  Card
// width=160, gap=12 → 172px pitch.
// ---------------------------------------------------------------------------
applyOnce(
  'P4: Episodes FlatList initialScrollIndex + getItemLayout',
  '/* v125b-flatlist-scroll */',
  /\{\/\* Episodes List \*\/\}\s*<FlatList\s*key=\{`episodes-\$\{selectedSeason\}-\$\{paramSelectedEpisode \|\| ''\}`\}\s*data=\{episodesForSeason\}\s*renderItem=\{renderEpisodeItem\}\s*keyExtractor=\{\(item\) => `\$\{item\.season\}-\$\{item\.episode\}`\}\s*horizontal\s*showsHorizontalScrollIndicator=\{false\}\s*contentContainerStyle=\{styles\.episodesList\}\s*\/>/,
  `{/* Episodes List */}${NL}              {/* v125b-flatlist-scroll */}${NL}              <FlatList${NL}                key={\`episodes-\${selectedSeason}-\${targetEpisodeIndex}\`}${NL}                data={episodesForSeason}${NL}                renderItem={renderEpisodeItem}${NL}                keyExtractor={(item) => \`\${item.season}-\${item.episode}\`}${NL}                horizontal${NL}                showsHorizontalScrollIndicator={false}${NL}                contentContainerStyle={styles.episodesList}${NL}                // v125b FIX B: mount the target card at first paint, scroll it${NL}                // into view, and guarantee the existing v124ab pressableRef${NL}                // + setNativeProps retry actually has a node to focus.${NL}                initialScrollIndex={targetEpisodeIndex}${NL}                getItemLayout={(_, index) => ({ length: 160, offset: 172 * index, index })}${NL}                initialNumToRender={Math.max(8, targetEpisodeIndex + 3)}${NL}                onScrollToIndexFailed={() => {${NL}                  // getItemLayout makes this practically unreachable, but${NL}                  // keep a no-op handler so React Native doesn't warn.${NL}                }}${NL}              />`
);

// ---------------------------------------------------------------------------
// Report and write.
// ---------------------------------------------------------------------------
const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v125b] === PATCH REPORT =====================================');
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
console.log('[v125b] =====================================================');

if (failed.length) {
  console.error('[v125b] One or more patches failed.  File NOT written.');
  console.error('[v125b] Backup remains at:', backupPath);
  process.exit(2);
}

if (src.length === originalLen) {
  console.log('[v125b] No changes (file already at v125b).  Nothing to write.');
  process.exit(0);
}

fs.writeFileSync(filePath, src, 'utf8');
console.log(`[v125b] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v125b] Done. Rebuild and side-load the app.');
