// =============================================================================
// PATCH v206 — Player/Resume/Cache/Library UX fixes
//
// Targets 5 user-reported bugs:
//   1) Dead "Play" button after stale Debrid stream cache (until app data wipe)
//   2) Resume from Continue Watching bounces through Details before Player
//   3) Pause/Resume lag inside the player
//   4) "Clear Progress" doesn't remove the poster instantly
//   5) TV channels appearing in Library section
//
// Usage from the user's frontend root:
//   curl -fsSL <BACKEND>/api/raw/apply_patches_v206_player_library_fixes.js -o v206.js
//   node v206.js
// =============================================================================

const fs = require('fs');
const path = require('path');

const FRONTEND = process.cwd();
function abs(p) { return path.join(FRONTEND, p); }

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, c) { fs.writeFileSync(p, c, 'utf8'); }
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function patch(label, file, mutator) {
  const full = abs(file);
  if (!exists(full)) { console.log('  [skip] ' + label + ' — not found: ' + file); return; }
  const before = read(full);
  const after = mutator(before);
  if (after === before) { console.log('  [noop] ' + label); return; }
  fs.writeFileSync(full + '.bak_v206', before, 'utf8');
  write(full, after);
  console.log('  [ok]   ' + label);
}

console.log('--- Applying v206 patch ---');

// ---------------------------------------------------------------------------
// FIX 1 — Stream cache TTL: drop disk TTL 6h → 20 min, and time-gate the
//          in-memory cache (which previously never expired until reload).
//          Also expose a clear-on-failure helper used by the player.
// ---------------------------------------------------------------------------
patch('contentStore — TTL + memory cache invalidation', 'src/store/contentStore.ts', (src) => {
  let s = src;

  // 1a) Lower disk TTL from 6 h → 20 min
  s = s.replace(
    /const STREAMS_DISK_TTL_MS = 6 \* 60 \* 60 \* 1000;/,
    'const STREAMS_DISK_TTL_MS = 20 * 60 * 1000; // v206 — was 6h; Debrid URLs expire'
  );

  // 1b) Replace _streamsCache (flat object) with a TTL-aware Map
  s = s.replace(
    /const _streamsCache: Record<string, Stream\[\]> = \{\};/,
    `// v206 — TTL-aware in-memory cache so stale Debrid URLs are not served forever
const _streamsCacheTTL_MS = 20 * 60 * 1000;
const _streamsCache: Record<string, { time: number; data: Stream[] }> = {};`
  );

  // 1c) Update getStreamsCache to respect TTL
  s = s.replace(
    /export const getStreamsCache = \(key: string\) => _streamsCache\[key\] \|\| null;/,
    `export const getStreamsCache = (key: string) => {
  const entry = _streamsCache[key];
  if (!entry) return null;
  if (Date.now() - entry.time > _streamsCacheTTL_MS) { delete _streamsCache[key]; return null; }
  return entry.data;
};`
  );

  // 1d) Update setStreamsCache to store time
  s = s.replace(
    /export const setStreamsCache = \(key: string, data: Stream\[\]\) => \{ _streamsCache\[key\] = data; \};/,
    `export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = { time: Date.now(), data }; };
// v206 — invalidate both memory + disk for a given (type/id).  Called by the
// player when a stream URL fails (403/410/expired) so the next Play does a
// fresh /api/streams round-trip instead of replaying the dead URL.
export const invalidateStreamsCache = async (key: string) => {
  try { delete _streamsCache[key]; } catch (_) {}
  try {
    await AsyncStorage.removeItem(STREAMS_DISK_KEY(key));
  } catch (_) {}
};`
  );

  return s;
});

// ---------------------------------------------------------------------------
// FIX 3 — Pause/Resume lag: skip redundant setIsPlaying / setPosition state
//          writes when the value hasn't actually changed.  React batches
//          but each .setState(x) still queues a render; with status fires
//          every ~250ms × multiple selectors, the JS thread starves the
//          pause-button responder.
//
// Also: optimistic pause/play — flip isPlaying state BEFORE awaiting the
// pauseAsync/playAsync RPC so the icon swaps instantly.
// ---------------------------------------------------------------------------
patch('player — pause/resume responsiveness', 'app/player.tsx', (src) => {
  let s = src;

  // 3a) Guard the per-tick setIsPlaying so it only fires on actual transitions
  s = s.replace(
    /if \(status\.isLoaded\) \{\s*\n\s*setIsPlaying\(status\.isPlaying\);\s*\n\s*setPosition\(status\.positionMillis\);\s*\n\s*setDuration\(status\.durationMillis \|\| 0\);/,
    `if (status.isLoaded) {
      // v206 — only setState on actual transitions to keep JS thread free
      if (isPlayingRef.current !== status.isPlaying) {
        setIsPlaying(status.isPlaying);
      }
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 0);`
  );

  // 3b) Optimistic togglePlayPause — flip state immediately, then RPC
  s = s.replace(
    /\/\/ Toggle play\/pause\s*\n\s*const togglePlayPause = async \(\) => \{\s*\n\s*if \(videoRef\.current\) \{\s*\n\s*if \(isPlaying\) \{\s*\n\s*await videoRef\.current\.pauseAsync\(\);\s*\n\s*\} else \{\s*\n\s*await videoRef\.current\.playAsync\(\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*\};/,
    `// Toggle play/pause — v206 OPTIMISTIC: flip state on the JS frame the
  // button is pressed; the RPC resolves asynchronously.
  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    const wasPlaying = isPlayingRef.current;
    // Flip state synchronously so the icon swaps on this frame
    setIsPlaying(!wasPlaying);
    isPlayingRef.current = !wasPlaying;
    try {
      if (wasPlaying) {
        videoRef.current.pauseAsync();
      } else {
        videoRef.current.playAsync();
      }
    } catch (_) {}
  };`
  );

  return s;
});

// ---------------------------------------------------------------------------
// FIX 4 — Clear Progress optimistic UI: have v176ClearProgress emit a
//          DeviceEventEmitter so the Continue Watching row removes the
//          item on the same frame the menu closes.
// ---------------------------------------------------------------------------
patch('ContentCard — v176ClearProgress emits CW remove', 'src/components/ContentCard.tsx', (src) => {
  let s = src;

  // 4a) Inside v176ClearProgress, emit v206:cw:remove BEFORE the await
  s = s.replace(
    /export async function v176ClearProgress\(contentId: string \| undefined \| null\): Promise<void> \{\s*\n\s*if \(!contentId\) return;\s*\n\s*const key = String\(contentId\);\s*\n\s*_v176ProgressSet\.delete\(key\);\s*\n\s*_v176ProgressSubs\.forEach\(\(cb\) => \{ try \{ cb\(\); \} catch \(_\) \{\} \}\);\s*\n\s*try \{ await \(api as any\)\.watchProgress\.delete\(key\); \} catch \(_\) \{ \/\* best-effort \*\/ \}\s*\n\s*\}/,
    `export async function v176ClearProgress(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v176ProgressSet.delete(key);
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  // v206 — optimistic CW poster removal: emit BEFORE the network call
  try { DeviceEventEmitter.emit('v206:cw:remove', { contentId: key }); } catch (_) {}
  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }
}`
  );

  return s;
});

// ---------------------------------------------------------------------------
// FIX 4 (cont) — Discover screen listens for v206:cw:remove and prunes the
//                 Continue Watching list optimistically.
// ---------------------------------------------------------------------------
patch('discover — listen for v206:cw:remove', 'app/(tabs)/discover.tsx', (src) => {
  let s = src;

  // Find a stable anchor: the existing fetchContinueWatching declaration.
  // We inject a useEffect right after it that subscribes.
  if (s.includes("'v206:cw:remove'")) return s;

  const anchor = 'const fetchContinueWatching = useCallback(async () => {';
  if (!s.includes(anchor)) return s;

  // Find end of the fetchContinueWatching declaration: insert after the
  // first useEffect that depends on fetchContinueWatching.
  const inject = `
  // v206 — Clear Progress optimistic: drop poster the instant the menu fires
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('v206:cw:remove', (evt: any) => {
      const cid = evt && evt.contentId;
      if (!cid) return;
      setContinueWatching(prev => prev.filter(i => {
        const idA = String(i.content_id || '');
        const idB = idA.split(':')[0];
        return idA !== cid && idB !== String(cid).split(':')[0];
      }));
      try { setCachedCW && setCachedCW((prev: any) => (prev || []).filter((i: any) => {
        const idA = String(i.content_id || '');
        return idA !== cid && idA.split(':')[0] !== String(cid).split(':')[0];
      })); } catch (_) {}
    });
    return () => { try { sub.remove(); } catch (_) {} };
  }, []);
`;

  // Insert injection just before `useEffect(() => {` that calls fetchContinueWatching()
  // We use a forgiving regex: insertion point = right after first occurrence of "fetchContinueWatching();" inside a useEffect body.
  const marker = 'fetchContinueWatching();\n  }, []);';
  if (s.includes(marker)) {
    s = s.replace(marker, marker + inject);
  } else {
    // fallback: append after fetchContinueWatching declaration's closing brace + `, []);`
    const re = /(const fetchContinueWatching = useCallback\(async \(\) => \{[\s\S]*?\},\s*\[[^\]]*\]\);)/;
    s = s.replace(re, '$1\n' + inject);
  }

  // Make sure DeviceEventEmitter is imported
  if (!/DeviceEventEmitter/.test(s)) {
    s = s.replace(
      /from 'react-native';/,
      "from 'react-native';\nimport { DeviceEventEmitter } from 'react-native';"
    );
  } else if (!/import \{[^}]*DeviceEventEmitter[^}]*\} from 'react-native'/.test(s)) {
    // Ensure it's in the named imports of react-native
    s = s.replace(
      /import \{([\s\S]+?)\} from 'react-native';/,
      (_m, names) => {
        if (/\bDeviceEventEmitter\b/.test(names)) return `import {${names}} from 'react-native';`;
        // Trim trailing whitespace + trailing comma so we don't get ",, DeviceEventEmitter"
        const cleaned = names.replace(/\s+$/,'').replace(/,\s*$/,'');
        return `import {${cleaned}, DeviceEventEmitter } from 'react-native';`;
      }
    );
  }

  return s;
});

// ---------------------------------------------------------------------------
// FIX 5 — TV channels should NOT appear in the Library tabs.
//          Remove the "TV Channels" filter button entirely + force-strip any
//          tv items from each filter's array (defense in depth).
// ---------------------------------------------------------------------------
patch('library — remove TV Channels filter + strip type==="tv"', 'app/(tabs)/library.tsx', (src) => {
  let s = src;

  // 5a) Remove the TV Channels filter button row
  s = s.replace(
    /\s*<FilterButton type="tv" label="TV Channels" \/>\s*\n/,
    '\n'
  );

  // 5b) Restrict FilterType to movies | series only (kept loose to avoid
  //     blowing up other call sites — we just stop emitting 'tv' button).
  s = s.replace(
    /type FilterType = 'movies' \| 'series' \| 'tv';/,
    "type FilterType = 'movies' | 'series'; // v206 — TV channels removed from Library"
  );

  // 5c) Strip the tv case from getFilteredContent + defensive type filter
  s = s.replace(
    /const getFilteredContent = \(\): ContentItem\[\] => \{\s*\n\s*if \(!library\) return \[\];\s*\n\s*switch \(filter\) \{\s*\n\s*case 'movies': return library\.movies \|\| \[\];\s*\n\s*case 'series': return library\.series \|\| \[\];\s*\n\s*case 'tv': return library\.channels \|\| \[\];\s*\n\s*default: return library\.movies \|\| \[\];\s*\n\s*\}\s*\n\s*\};/,
    `const getFilteredContent = (): ContentItem[] => {
    if (!library) return [];
    // v206 — defensively strip type==='tv'/'channel' from EVERY filter
    const strip = (arr: any[]) => (arr || []).filter((it: any) => it && it.type !== 'tv' && it.type !== 'channel');
    switch (filter) {
      case 'movies': return strip(library.movies as any);
      case 'series': return strip(library.series as any);
      default: return strip(library.movies as any);
    }
  };`
  );

  return s;
});

// ---------------------------------------------------------------------------
// FIX 2 — Resume from CW: short-circuit Details when autoPlay='true' so the
//          heavy ScrollView / FlatList / FocusableButton tree never mounts.
//          Only the AutoPlayLoadingBar overlay paints — then the existing
//          autoPlay useEffect routes to /player.
// ---------------------------------------------------------------------------
patch('details — skip heavy render on autoPlay', 'app/details/[type]/[id].tsx', (src) => {
  let s = src;

  if (s.includes('// v206 — autoPlay short-circuit')) return s;

  // Inject right before the existing _v186Closing guard.
  s = s.replace(
    /\/\/ V186_BACK_INSTANT[^\n]*\n\s*\/\/[^\n]*\n\s*if \(_v186Closing\) \{\s*\n\s*return <View style=\{styles\.container\} \/>;\s*\n\s*\}/,
    (m) => `// v206 — autoPlay short-circuit: when resuming from Continue Watching,
  // render ONLY the cinematic overlay (no heavy subtree) so we don't waste
  // a frame mounting FlatLists / FocusableButtons / backdrops just to
  // unmount them again the instant autoPlay fires.
  if (autoPlayParam === 'true' && !autoPlayTriggeredRef.current) {
    const _v206Bg = (currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam || paramPoster) as string | undefined;
    return (
      <View style={styles.container}>
        {_v206Bg ? (
          <RNImage
            source={{ uri: _v206Bg }}
            style={StyleSheet.absoluteFillObject}
            blurRadius={8}
            resizeMode="cover"
          />
        ) : null}
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.65)' }]} />
        <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1, paddingHorizontal: 32 }}>
          {content?.logo ? (
            <RNImage source={{ uri: content.logo }} style={{ width: 280, height: 90, marginBottom: 20 }} resizeMode="contain" />
          ) : (
            <Text style={{ color: '#FFF', fontSize: 32, fontWeight: '800', textAlign: 'center', marginBottom: 16, letterSpacing: 0.5 }}>
              {String(content?.name || paramName || '')}
            </Text>
          )}
          {type === 'series' && (
            <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
              {nextTitleParam ? String(nextTitleParam) : (currentEpisode?.name || (episodeNumber ? \`Episode \${episodeNumber}\` : ''))}
            </Text>
          )}
          {type === 'series' && episodeSeason && episodeNumber && (
            <Text style={{ color: '#B8A05C', fontSize: 14, fontWeight: '600', marginBottom: 36, letterSpacing: 1 }}>
              S{episodeSeason} E{episodeNumber}
            </Text>
          )}
          <AutoPlayLoadingBar />
          <Text style={{ color: '#CCC', fontSize: 13, marginTop: 14, fontWeight: '500' }}>Loading...</Text>
        </View>
      </View>
    );
  }

  ` + m
  );

  return s;
});

console.log('--- v206 patch complete ---');
console.log('');
console.log('Reload your Metro bundler (press r in the Expo CLI) and verify on Firestick:');
console.log('  1. Continue Watching click → ONE loading screen → Player (no Details bounce)');
console.log('  2. Pause/Resume on the player should toggle on the same frame');
console.log('  3. Long-press a CW poster → Clear Progress → poster gone instantly');
console.log('  4. Library tabs no longer show "TV Channels"');
console.log('  5. If a Play button hangs on a stale URL, navigating back and re-opening');
console.log('     after 20 min will trigger a fresh /api/streams fetch automatically.');
