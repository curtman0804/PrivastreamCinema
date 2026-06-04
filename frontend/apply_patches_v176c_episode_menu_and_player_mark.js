/*
 * apply_patches_v176c_episode_menu_and_player_mark.js
 *
 * V176C — Finishes the v176b work for two files that didn't land:
 *
 *   • app/details/[type]/[id].tsx  — EpisodeCard long-press menu
 *     (Mark Watched / Mark Unwatched / Clear Progress) + press-timing.
 *     The v176b anchor missed because v173 inserted extra onFocus/onBlur
 *     props between onLongPress and the v135 block.  This patch uses
 *     narrow single-line anchors so it matches the current file layout.
 *
 *   • app/player.tsx — replace the raw AsyncStorage write at ≥90%
 *     with v176MarkWatched(contentId).  Updates the in-memory watched
 *     Set so the gold check appears the moment you back out of the
 *     player, no app restart.
 *
 *   Idempotent.  Skip files that already have V176C marker.
 *   CRLF preserved.
 *
 *   Usage:
 *       node apply_patches_v176c_episode_menu_and_player_mark.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DETAILS_PATH  = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');
const PLAYER_PATH   = path.join(ROOT, 'app', 'player.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176c] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176c] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 of 2 — app/details/[type]/[id].tsx  (EpisodeCard menu)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DETAILS_PATH;
  let src = read(file);

  if (src.indexOf('V176C_EPISODE_MENU') !== -1) {
    console.log('[v176c] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1a) Add v176 helper imports + Alert alias once.
    const asyncImport = "import AsyncStorage from '@react-native-async-storage/async-storage';";
    if (src.indexOf(asyncImport) === -1) {
      console.error('[v176c] FATAL: id.tsx — could not locate AsyncStorage import.');
      process.exit(2);
    }
    if (src.indexOf('V176C_EPISODE_MENU_IMPORT') === -1) {
      src = src.replace(
        asyncImport,
        asyncImport + '\n' +
        "/* V176C_EPISODE_MENU_IMPORT — Stremio-style menu helpers for episode posters. */\n" +
        "import {\n" +
        "  v172IsWatched as _v176cV172IsWatched,\n" +
        "  v172SubscribeWatched as _v176cV172SubWatched,\n" +
        "  v172UnmarkWatched as _v176cV172Unmark,\n" +
        "  v176MarkWatched as _v176cV176Mark,\n" +
        "  v176HasProgress as _v176cV176HasProg,\n" +
        "  v176SubscribeProgress as _v176cV176SubProg,\n" +
        "  v176ClearProgress as _v176cV176Clear,\n" +
        "} from '../../../src/components/ContentCard';\n" +
        "import { Alert as _V176cAlert } from 'react-native';"
      );
      changes++;
    }

    // 1b) Inject the menu opener + press-timing refs right before the
    //     `return (` of EpisodeCard.  Anchor on the line directly above
    //     return — `  const thumbUri = episode.thumbnail || fallbackPoster;`.
    const thumbAnchor = '  const thumbUri = episode.thumbnail || fallbackPoster;';
    if (src.indexOf(thumbAnchor) === -1) {
      console.error('[v176c] FATAL: id.tsx — could not locate EpisodeCard thumbUri anchor.');
      process.exit(3);
    }
    const epMenuBlock =
      thumbAnchor + '\n' +
      '\n' +
      '  /* V176C_EPISODE_MENU — press-timing long-press (Pressable.onLongPress\n' +
      '     is unreliable on Firestick / Android TV) opens a Stremio-style menu\n' +
      '     for this episode.  The id must match what the player writes to\n' +
      '     AsyncStorage[privastream_watched]. */\n' +
      '  const _v176cEpId = ((episode as any).content_id || (episode as any).id) as string | undefined;\n' +
      '  const [, _v176cBump] = useState(0);\n' +
      '  useEffect(() => _v176cV172SubWatched(() => _v176cBump((x) => (x + 1) & 0xff)), []);\n' +
      '  useEffect(() => _v176cV176SubProg(() => _v176cBump((x) => (x + 1) & 0xff)), []);\n' +
      '\n' +
      '  const _v176cOpenEpMenu = useCallback(() => {\n' +
      '    const id = _v176cEpId;\n' +
      '    if (!id) return;\n' +
      '    const watchedNow = !!isWatched || _v176cV172IsWatched(id);\n' +
      '    const hasProg = _v176cV176HasProg(id);\n' +
      '    const title = `S${(episode as any).season ?? \'?\'} · E${(episode as any).episode ?? \'?\'}`\n' +
      '      + ((episode as any).name ? ` — ${(episode as any).name}` : \'\');\n' +
      '    const buttons: any[] = [];\n' +
      '    if (hasProg) {\n' +
      '      buttons.push({ text: \'Clear Progress\', onPress: () => { _v176cV176Clear(id); } });\n' +
      '    }\n' +
      '    if (watchedNow) {\n' +
      '      buttons.push({ text: \'Mark as Unwatched\', onPress: () => { _v176cV172Unmark(id); try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });\n' +
      '    } else {\n' +
      '      buttons.push({ text: \'Mark as Watched\', onPress: () => { _v176cV176Mark(id); } });\n' +
      '    }\n' +
      '    buttons.push({ text: \'Cancel\', style: \'cancel\' });\n' +
      '    _V176cAlert.alert(title, undefined, buttons);\n' +
      '  }, [episode, isWatched, onMarkUnwatched, _v176cEpId]);\n' +
      '\n' +
      '  const _v176cLpTimer = useRef<any>(null);\n' +
      '  const _v176cLpFired = useRef<boolean>(false);\n' +
      '  const _v176cPressIn = useCallback(() => {\n' +
      '    _v176cLpFired.current = false;\n' +
      '    if (_v176cLpTimer.current) clearTimeout(_v176cLpTimer.current);\n' +
      '    _v176cLpTimer.current = setTimeout(() => {\n' +
      '      _v176cLpFired.current = true;\n' +
      '      try { _v176cOpenEpMenu(); } catch (_) {}\n' +
      '    }, 500);\n' +
      '  }, [_v176cOpenEpMenu]);\n' +
      '  const _v176cPressOut = useCallback(() => {\n' +
      '    if (_v176cLpTimer.current) {\n' +
      '      clearTimeout(_v176cLpTimer.current);\n' +
      '      _v176cLpTimer.current = null;\n' +
      '    }\n' +
      '  }, []);\n' +
      '  const _v176cOnPress = useCallback(() => {\n' +
      '    if (_v176cLpFired.current) { _v176cLpFired.current = false; return; }\n' +
      '    try { onPress && onPress(); } catch (_) {}\n' +
      '  }, [onPress]);';
    src = src.replace(thumbAnchor, epMenuBlock);
    changes++;

    // 1c) Swap the EpisodeCard Pressable wiring.  Anchor on the unique
    //     line `style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}`
    //     which only exists in EpisodeCard.  Then replace the next two lines
    //     individually so we don't depend on what v173 inserted after.
    const epStyleLine = '      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\n      onPress={onPress}\n      onLongPress={isWatched ? onMarkUnwatched : undefined}';
    if (src.indexOf(epStyleLine) === -1) {
      console.error('[v176c] FATAL: id.tsx — could not locate EpisodeCard style+onPress+onLongPress sequence.');
      process.exit(4);
    }
    const newEpStyleBlock =
      '      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\n' +
      '      onPress={_v176cOnPress}\n' +
      '      onPressIn={_v176cPressIn}\n' +
      '      onPressOut={_v176cPressOut}\n' +
      '      onLongPress={_v176cOpenEpMenu}';
    src = src.replace(epStyleLine, newEpStyleBlock);
    changes++;

    write(file, src);
    console.log(`[v176c] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 of 2 — app/player.tsx  (route ≥90% via v176MarkWatched)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V176C_PLAYER_MARK_WATCHED') !== -1
      || src.indexOf('V176B_PLAYER_MARK_WATCHED') !== -1) {
    console.log('[v176c] player.tsx: already patched (v176b or v176c marker present), skipping');
  } else {
    let changes = 0;

    // 2a) Import v176MarkWatched.
    const asyncImport = "import AsyncStorage from '@react-native-async-storage/async-storage';";
    if (src.indexOf(asyncImport) === -1) {
      console.error('[v176c] FATAL: player.tsx — could not locate AsyncStorage import.');
      process.exit(7);
    }
    if (src.indexOf('v176MarkWatched') === -1) {
      src = src.replace(
        asyncImport,
        asyncImport + '\n' +
        "/* V176C_PLAYER_MARK_WATCHED — keep the in-memory _v172WatchedSet in sync\n" +
        "   so visible posters show the gold check immediately, no app restart. */\n" +
        "import { v176MarkWatched as _v176cMark } from '../src/components/ContentCard';"
      );
      changes++;
    }

    // 2b) Replace the raw AsyncStorage write block.
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
      console.error('[v176c] FATAL: player.tsx — could not locate watched-mark block.');
      process.exit(8);
    }
    const newMarkBlock =
      '    /* V176C_PLAYER_MARK_WATCHED — route through v176MarkWatched so the\n' +
      '       in-memory _v172WatchedSet (used by every ContentCard) updates\n' +
      '       immediately and all visible posters re-render with the gold check. */\n' +
      '    const percentWatched = (currentPosition / totalDuration) * 100;\n' +
      '    if (percentWatched >= 90 && contentId) {\n' +
      '      try {\n' +
      '        await _v176cMark(contentId);\n' +
      "        console.log('[PLAYER] v176c marked as watched:', contentId);\n" +
      '      } catch (e) {\n' +
      "        console.log('[PLAYER] Error saving watched status:', e);\n" +
      '      }\n' +
      '    }';
    src = src.replace(oldMarkBlock, newMarkBlock);
    changes++;

    write(file, src);
    console.log(`[v176c] player.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176c] DONE.  ${totalChanges} total change(s) across all files.`);
console.log('[v176c] Rebuild your Expo app and sideload to test.');
