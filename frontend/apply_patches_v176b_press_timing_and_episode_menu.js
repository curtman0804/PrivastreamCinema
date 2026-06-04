/*
 * apply_patches_v176b_press_timing_and_episode_menu.js
 *
 * V176B — Fixes & expansions on top of v176:
 *
 *   1) PRESS-TIMING long-press on every poster surface.
 *      Pressable.onLongPress is unreliable on Firestick / Android TV OK
 *      button, and the v173 onTVKeyEvent listener never fires on user's
 *      hardware.  Solution: do the timing ourselves with onPressIn /
 *      onPressOut / onPress.  Works on touch AND TV remote since both
 *      go through the same press lifecycle.
 *
 *   2) Player marks watched via v176MarkWatched (not raw AsyncStorage).
 *      Previously the ≥90% write only touched AsyncStorage; the in-memory
 *      _v172WatchedSet was already hydrated at app start and never
 *      refreshed, so the gold check never appeared until the next app
 *      launch.  v176MarkWatched updates the Set + AsyncStorage + notifies
 *      every subscribed card so the check appears instantly.
 *
 *   3) EpisodeCard long-press menu in id.tsx.  Stremio-style choices for
 *      episodes (no library since episodes aren't library items):
 *        - Mark as Watched / Mark as Unwatched
 *        - Clear Progress  (when the episode has progress)
 *        - Cancel
 *
 *   Idempotent.  CRLF preserved.  Each file gates on a unique V176B marker.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176b_press_timing_and_episode_menu.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH       = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const LIBRARY_PATH  = path.join(ROOT, 'app', '(tabs)', 'library.tsx');
const DISCOVER_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');
const DETAILS_PATH  = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');
const PLAYER_PATH   = path.join(ROOT, 'app', 'player.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176b] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176b] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 of 5 — src/components/ContentCard.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176B_PRESS_TIMING') !== -1) {
    console.log('[v176b] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // Inject press-timing refs + handlers right BEFORE the existing
    // `if (!item) return null;` line that sits between handleLongPress and the
    // V172 watched-flag derivation.
    const earlyReturnAnchor = '  if (!item) return null;';
    if (src.indexOf(earlyReturnAnchor) === -1) {
      console.error('[v176b] FATAL: ContentCard.tsx — could not find `if (!item) return null;` anchor.');
      process.exit(2);
    }
    const pressTimingBlock =
      '  /* V176B_PRESS_TIMING — Pressable.onLongPress is unreliable on\n' +
      '     Firestick / Android TV OK buttons.  Do our own timing via\n' +
      '     onPressIn / onPressOut so it works on touch AND TV remotes. */\n' +
      '  const _v176bLpTimer = useRef<any>(null);\n' +
      '  const _v176bLpFired = useRef<boolean>(false);\n' +
      '  const _v176bPressIn = useCallback(() => {\n' +
      '    _v176bLpFired.current = false;\n' +
      '    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);\n' +
      '    _v176bLpTimer.current = setTimeout(() => {\n' +
      '      _v176bLpFired.current = true;\n' +
      '      try { handleLongPress(); } catch (_) {}\n' +
      '    }, 500);\n' +
      '  }, [handleLongPress]);\n' +
      '  const _v176bPressOut = useCallback(() => {\n' +
      '    if (_v176bLpTimer.current) {\n' +
      '      clearTimeout(_v176bLpTimer.current);\n' +
      '      _v176bLpTimer.current = null;\n' +
      '    }\n' +
      '  }, []);\n' +
      '  const _v176bOnPress = useCallback(() => {\n' +
      '    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }\n' +
      '    try { onPress && onPress(); } catch (_) {}\n' +
      '  }, [onPress]);\n' +
      '\n' +
      earlyReturnAnchor;
    src = src.replace(earlyReturnAnchor, pressTimingBlock);
    changes++;

    // Swap the Pressable wiring to use the new handlers.
    const oldPressable =
      '    <Pressable\n' +
      '      ref={pressableRef}\n' +
      '      focusable={true}\n' +
      '      onPress={onPress}\n' +
      '      onLongPress={handleLongPress}\n' +
      '      delayLongPress={500}\n' +
      '      onFocus={handleFocus}\n' +
      '      onBlur={handleBlur}';
    if (src.indexOf(oldPressable) === -1) {
      console.error('[v176b] FATAL: ContentCard.tsx — could not locate Pressable block.');
      process.exit(3);
    }
    const newPressable =
      '    <Pressable\n' +
      '      ref={pressableRef}\n' +
      '      focusable={true}\n' +
      '      onPress={_v176bOnPress}\n' +
      '      onPressIn={_v176bPressIn}\n' +
      '      onPressOut={_v176bPressOut}\n' +
      '      onLongPress={handleLongPress}\n' +
      '      delayLongPress={500}\n' +
      '      onFocus={handleFocus}\n' +
      '      onBlur={handleBlur}';
    src = src.replace(oldPressable, newPressable);
    changes++;

    write(file, src);
    console.log(`[v176b] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 of 5 — app/(tabs)/library.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = LIBRARY_PATH;
  let src = read(file);

  if (src.indexOf('V176B_PRESS_TIMING') !== -1) {
    console.log('[v176b] library.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // Inject press-timing handlers right BEFORE the existing return statement
    // of LibraryCard.  Splice after the _v176OpenMenu useCallback.
    const v176OpenMenuAnchor =
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: { ...(item as any), content_id: _v176ContentId, content_type: (item as any).type },\n' +
      '      inLibraryOverride: true,\n' +
      '      hasProgressOverride: _v176HasProg,\n' +
      '      onAfterChange: (action) => {\n' +
      '        if (action === \'removed\') { try { onRemove && onRemove(); } catch (_) {} }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, _v176HasProg, onRemove]);';
    if (src.indexOf(v176OpenMenuAnchor) === -1) {
      console.error('[v176b] FATAL: library.tsx — could not locate _v176OpenMenu anchor.');
      process.exit(4);
    }
    const pressTimingBlock =
      v176OpenMenuAnchor + '\n' +
      '\n' +
      '  /* V176B_PRESS_TIMING — fire menu via onPressIn/Out timing so the\n' +
      '     TV remote OK button works (Pressable.onLongPress is flaky). */\n' +
      '  const _v176bLpTimer = useRef<any>(null);\n' +
      '  const _v176bLpFired = useRef<boolean>(false);\n' +
      '  const _v176bPressIn = useCallback(() => {\n' +
      '    _v176bLpFired.current = false;\n' +
      '    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);\n' +
      '    _v176bLpTimer.current = setTimeout(() => {\n' +
      '      _v176bLpFired.current = true;\n' +
      '      try { _v176OpenMenu(); } catch (_) {}\n' +
      '    }, 500);\n' +
      '  }, [_v176OpenMenu]);\n' +
      '  const _v176bPressOut = useCallback(() => {\n' +
      '    if (_v176bLpTimer.current) {\n' +
      '      clearTimeout(_v176bLpTimer.current);\n' +
      '      _v176bLpTimer.current = null;\n' +
      '    }\n' +
      '  }, []);\n' +
      '  const _v176bOnPress = useCallback(() => {\n' +
      '    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }\n' +
      '    try { onPress && onPress(); } catch (_) {}\n' +
      '  }, [onPress]);';
    src = src.replace(v176OpenMenuAnchor, pressTimingBlock);
    changes++;

    // Swap the poster Pressable.
    const oldLibPressable =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    if (src.indexOf(oldLibPressable) === -1) {
      console.error('[v176b] FATAL: library.tsx — could not locate poster Pressable post-v176.');
      process.exit(5);
    }
    const newLibPressable =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={_v176bOnPress}\n' +
      '        onPressIn={_v176bPressIn}\n' +
      '        onPressOut={_v176bPressOut}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    src = src.replace(oldLibPressable, newLibPressable);
    changes++;

    // useRef must be in scope (already used by xButtonRef etc., so it is).
    // Mark file with V176B_PRESS_TIMING via the comment above; done.

    write(file, src);
    console.log(`[v176b] library.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 of 5 — app/(tabs)/discover.tsx
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DISCOVER_PATH;
  let src = read(file);

  if (src.indexOf('V176B_PRESS_TIMING') !== -1) {
    console.log('[v176b] discover.tsx: already patched, skipping');
  } else {
    let changes = 0;

    const v176CWOpenAnchor =
      '  const _v176OpenMenu = useCallback(() => {\n' +
      '    _v176ShowLongPressMenu({\n' +
      '      item: {\n' +
      '        content_id: _v176ContentId,\n' +
      '        content_type: (item as any).content_type || (item as any).type || \'movie\',\n' +
      '        title: (item as any).title,\n' +
      '        name: (item as any).title,\n' +
      '        poster: (item as any).poster || (item as any).backdrop,\n' +
      '      },\n' +
      '      inLibraryOverride: false,\n' +
      '      hasProgressOverride: true,\n' +
      '      onAfterChange: (action) => {\n' +
      '        if (action === \'cleared\') { try { onRemove && onRemove(); } catch (_) {} }\n' +
      '      },\n' +
      '    });\n' +
      '  }, [item, _v176ContentId, onRemove]);';
    if (src.indexOf(v176CWOpenAnchor) === -1) {
      console.error('[v176b] FATAL: discover.tsx — could not locate ContinueWatchingItem _v176OpenMenu anchor.');
      process.exit(6);
    }
    const cwPressTiming =
      v176CWOpenAnchor + '\n' +
      '\n' +
      '  /* V176B_PRESS_TIMING — TV remote OK long-press detection. */\n' +
      '  const _v176bLpTimer = useRef<any>(null);\n' +
      '  const _v176bLpFired = useRef<boolean>(false);\n' +
      '  const _v176bPressIn = useCallback(() => {\n' +
      '    _v176bLpFired.current = false;\n' +
      '    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);\n' +
      '    _v176bLpTimer.current = setTimeout(() => {\n' +
      '      _v176bLpFired.current = true;\n' +
      '      try { _v176OpenMenu(); } catch (_) {}\n' +
      '    }, 500);\n' +
      '  }, [_v176OpenMenu]);\n' +
      '  const _v176bPressOut = useCallback(() => {\n' +
      '    if (_v176bLpTimer.current) {\n' +
      '      clearTimeout(_v176bLpTimer.current);\n' +
      '      _v176bLpTimer.current = null;\n' +
      '    }\n' +
      '  }, []);\n' +
      '  const _v176bOnPress = useCallback(() => {\n' +
      '    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }\n' +
      '    try { onPress && onPress(); } catch (_) {}\n' +
      '  }, [onPress]);';
    src = src.replace(v176CWOpenAnchor, cwPressTiming);
    changes++;

    // Swap the CW poster Pressable.
    const oldCwPressable =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={onPress}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => setIsFocused(false)}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    if (src.indexOf(oldCwPressable) === -1) {
      console.error('[v176b] FATAL: discover.tsx — could not locate CW poster Pressable post-v176.');
      process.exit(7);
    }
    const newCwPressable =
      '      <Pressable\n' +
      '        ref={posterRef}\n' +
      '        onPress={_v176bOnPress}\n' +
      '        onPressIn={_v176bPressIn}\n' +
      '        onPressOut={_v176bPressOut}\n' +
      '        onLongPress={_v176OpenMenu}\n' +
      '        delayLongPress={500}\n' +
      '        onFocus={handleFocus}\n' +
      '        onBlur={() => setIsFocused(false)}\n' +
      '        android_ripple={null}\n' +
      '        nextFocusUp={xButtonTag}';
    src = src.replace(oldCwPressable, newCwPressable);
    changes++;

    write(file, src);
    console.log(`[v176b] discover.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 4 of 5 — app/details/[type]/[id].tsx  (EpisodeCard long-press menu)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DETAILS_PATH;
  let src = read(file);

  if (src.indexOf('V176B_EPISODE_MENU') !== -1) {
    console.log('[v176b] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 4a) Import the v176 helpers we need at the top of the file.
    const asyncStorageImportAnchor = "import AsyncStorage from '@react-native-async-storage/async-storage';";
    if (src.indexOf(asyncStorageImportAnchor) === -1) {
      console.error('[v176b] FATAL: id.tsx — could not locate AsyncStorage import.');
      process.exit(8);
    }
    if (src.indexOf("v176MarkWatched") === -1) {
      src = src.replace(
        asyncStorageImportAnchor,
        asyncStorageImportAnchor + '\n' +
        "/* V176B_EPISODE_MENU — Stremio-style long-press menu helpers for episodes. */\n" +
        "import {\n" +
        "  v172IsWatched as _v172IsWatched,\n" +
        "  v172SubscribeWatched as _v172SubscribeWatched,\n" +
        "  v172UnmarkWatched as _v172UnmarkWatched,\n" +
        "  v176MarkWatched as _v176MarkWatched,\n" +
        "  v176HasProgress as _v176HasProgress,\n" +
        "  v176SubscribeProgress as _v176SubscribeProgress,\n" +
        "  v176ClearProgress as _v176ClearProgress,\n" +
        "} from '../../../src/components/ContentCard';\n" +
        "import { Alert as _V176Alert } from 'react-native';"
      );
      changes++;
    }

    // 4b) Replace the EpisodeCard's Pressable onLongPress to a press-timing
    //     mechanism + multi-action menu.  We inject helper refs + an
    //     openMenu callback inside EpisodeCard, then swap the Pressable
    //     wiring.
    const epCardThumbAnchor = '  const thumbUri = episode.thumbnail || fallbackPoster;';
    if (src.indexOf(epCardThumbAnchor) === -1) {
      console.error('[v176b] FATAL: id.tsx — could not locate EpisodeCard thumbUri anchor.');
      process.exit(9);
    }
    const epMenuBlock =
      epCardThumbAnchor + '\n' +
      '\n' +
      '  /* V176B_EPISODE_MENU — Stremio-style long-press for episode posters.\n' +
      '     Press-timing approach because Pressable.onLongPress is unreliable\n' +
      '     on Android TV.  The contentId we use here is the EXACT same key\n' +
      '     the player writes to AsyncStorage / privastream_watched. */\n' +
      '  const _v176bEpId = (episode as any).content_id || (episode as any).id || null;\n' +
      '  const [, _v176bEpBump] = useState(0);\n' +
      '  useEffect(() => _v172SubscribeWatched(() => _v176bEpBump((x) => (x + 1) & 0xff)), []);\n' +
      '  useEffect(() => _v176SubscribeProgress(() => _v176bEpBump((x) => (x + 1) & 0xff)), []);\n' +
      '\n' +
      '  const _v176bEpOpenMenu = useCallback(() => {\n' +
      '    const id = _v176bEpId;\n' +
      '    if (!id) return;\n' +
      '    const watchedNow = !!isWatched || _v172IsWatched(id);\n' +
      '    const hasProg = _v176HasProgress(id);\n' +
      '    const title = `S${episode.season || \'?\'} · E${episode.episode || \'?\'}` + (episode.name ? ` — ${episode.name}` : \'\');\n' +
      '    const buttons: any[] = [];\n' +
      '    if (hasProg) {\n' +
      '      buttons.push({ text: \'Clear Progress\', onPress: () => { _v176ClearProgress(id); } });\n' +
      '    }\n' +
      '    if (watchedNow) {\n' +
      '      buttons.push({ text: \'Mark as Unwatched\', onPress: () => { _v172UnmarkWatched(id); try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });\n' +
      '    } else {\n' +
      '      buttons.push({ text: \'Mark as Watched\', onPress: () => { _v176MarkWatched(id); } });\n' +
      '    }\n' +
      '    buttons.push({ text: \'Cancel\', style: \'cancel\' });\n' +
      '    _V176Alert.alert(title, undefined, buttons);\n' +
      '  }, [episode, isWatched, onMarkUnwatched, _v176bEpId]);\n' +
      '\n' +
      '  const _v176bLpTimer = useRef<any>(null);\n' +
      '  const _v176bLpFired = useRef<boolean>(false);\n' +
      '  const _v176bPressIn = useCallback(() => {\n' +
      '    _v176bLpFired.current = false;\n' +
      '    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);\n' +
      '    _v176bLpTimer.current = setTimeout(() => {\n' +
      '      _v176bLpFired.current = true;\n' +
      '      try { _v176bEpOpenMenu(); } catch (_) {}\n' +
      '    }, 500);\n' +
      '  }, [_v176bEpOpenMenu]);\n' +
      '  const _v176bPressOut = useCallback(() => {\n' +
      '    if (_v176bLpTimer.current) {\n' +
      '      clearTimeout(_v176bLpTimer.current);\n' +
      '      _v176bLpTimer.current = null;\n' +
      '    }\n' +
      '  }, []);\n' +
      '  const _v176bOnPress = useCallback(() => {\n' +
      '    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }\n' +
      '    try { onPress && onPress(); } catch (_) {}\n' +
      '  }, [onPress]);';
    src = src.replace(epCardThumbAnchor, epMenuBlock);
    changes++;

    // 4c) Swap the EpisodeCard Pressable wiring.
    const oldEpPressable =
      '    <Pressable\n' +
      '      ref={pressableRef}\n' +
      '      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\n' +
      '      onPress={onPress}\n' +
      '      onLongPress={isWatched ? onMarkUnwatched : undefined}\n' +
      '      /* v135-focus-unlock-blur */\n' +
      '      onFocus={() => {';
    if (src.indexOf(oldEpPressable) === -1) {
      console.error('[v176b] FATAL: id.tsx — could not locate EpisodeCard Pressable head.');
      process.exit(10);
    }
    const newEpPressable =
      '    <Pressable\n' +
      '      ref={pressableRef}\n' +
      '      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\n' +
      '      onPress={_v176bOnPress}\n' +
      '      onPressIn={_v176bPressIn}\n' +
      '      onPressOut={_v176bPressOut}\n' +
      '      onLongPress={_v176bEpOpenMenu}\n' +
      '      /* v135-focus-unlock-blur */\n' +
      '      onFocus={() => {';
    src = src.replace(oldEpPressable, newEpPressable);
    changes++;

    write(file, src);
    console.log(`[v176b] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 5 of 5 — app/player.tsx  (mark watched via v176MarkWatched)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V176B_PLAYER_MARK_WATCHED') !== -1) {
    console.log('[v176b] player.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 5a) Import v176MarkWatched.
    const playerAsyncImport = "import AsyncStorage from '@react-native-async-storage/async-storage';";
    if (src.indexOf(playerAsyncImport) === -1) {
      console.error('[v176b] FATAL: player.tsx — could not locate AsyncStorage import.');
      process.exit(11);
    }
    if (src.indexOf("v176MarkWatched") === -1) {
      src = src.replace(
        playerAsyncImport,
        playerAsyncImport + '\n' +
        "/* V176B_PLAYER_MARK_WATCHED — keep the in-memory _v172WatchedSet in sync\n" +
        "   so visible posters show the gold check immediately, no app restart. */\n" +
        "import { v176MarkWatched as _v176MarkWatched } from '../src/components/ContentCard';"
      );
      changes++;
    }

    // 5b) Replace the raw AsyncStorage write block.
    const oldMarkBlock =
      '    // Mark as watched in AsyncStorage FIRST — independent of API success\n' +
      '    const percentWatched = (currentPosition / totalDuration) * 100;\n' +
      '    if (percentWatched >= 90 && contentId) {\n' +
      '      try {\n' +
      "        const watchedKey = 'privastream_watched';\n" +
      '        const existing = await AsyncStorage.getItem(watchedKey);\n' +
      '        const watchedSet: Record<string, boolean> = existing ? JSON.parse(existing) : {};\n' +
      '        if (!watchedSet[contentId]) {\n' +
      '          watchedSet[contentId] = true;\n' +
      '          await AsyncStorage.setItem(watchedKey, JSON.stringify(watchedSet));\n' +
      "          console.log('[PLAYER] Marked as watched:', contentId);\n" +
      '        }\n' +
      '      } catch (e) {\n' +
      "        console.log('[PLAYER] Error saving watched status:', e);\n" +
      '      }\n' +
      '    }';
    if (src.indexOf(oldMarkBlock) === -1) {
      console.error('[v176b] FATAL: player.tsx — could not locate watched-mark block.');
      process.exit(12);
    }
    const newMarkBlock =
      '    /* V176B_PLAYER_MARK_WATCHED — route through v176MarkWatched so the\n' +
      '       in-memory _v172WatchedSet (used by every ContentCard) updates\n' +
      '       immediately and all visible posters re-render with the gold check. */\n' +
      '    const percentWatched = (currentPosition / totalDuration) * 100;\n' +
      '    if (percentWatched >= 90 && contentId) {\n' +
      '      try {\n' +
      '        await _v176MarkWatched(contentId);\n' +
      "        console.log('[PLAYER] v176b marked as watched:', contentId);\n" +
      '      } catch (e) {\n' +
      "        console.log('[PLAYER] Error saving watched status:', e);\n" +
      '      }\n' +
      '    }';
    src = src.replace(oldMarkBlock, newMarkBlock);
    changes++;

    write(file, src);
    console.log(`[v176b] player.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176b] DONE.  ${totalChanges} total change(s) across all files.`);
console.log('[v176b] Rebuild your Expo app and sideload to test.');
