/*
 * apply_patches_v176h_episode_menu_and_badge_position.js
 *
 * V176H — Three issues from current build:
 *
 *   1) Episode poster long-press silently does nothing.
 *      Root cause discovered in id.tsx EpisodeCard: there are TWO
 *      onFocus props and TWO onBlur props on the same Pressable
 *      (line 761 v173 reg + line 764 v135 focus state).  React only
 *      keeps the LAST one, so v173RegLP() never fires on focus and
 *      'longSelect' never reaches this card.
 *      Also onLongPress only handles the watched case ("unwatch") -
 *      no path to "Mark as Watched" for unwatched episodes.
 *
 *      Fix: collapse to a single onFocus + onBlur that does BOTH the
 *      v173 registration AND the v135 focus-state bookkeeping, and
 *      register a unified opener that toggles mark/unmark based on
 *      the current watched flag.  Adds Mark as Watched alongside the
 *      existing Mark Unwatched.
 *
 *   2) Bookmark library badge sits in the top-right corner and
 *      collides with the "IN CINEMA" badge on Discover.  Move it to
 *      the bottom-right of the poster (above the progress bar).
 *
 *   3) Add a Mark-as-Watched helper to id.tsx so the menu can toggle
 *      in both directions.  Reuses v176MarkWatched from ContentCard.
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176h_episode_menu_and_badge_position.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176h] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176h] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/components/ContentCard.tsx  (bookmark badge to bottom-right)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176H_BOOKMARK_POSITION') !== -1) {
    console.log('[v176h] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    const oldBadge =
      '  libraryBadge: {\n' +
      "    position: 'absolute',\n" +
      '    top: 8,\n' +
      '    right: 8,\n' +
      '    backgroundColor: colors.primary,\n' +
      '    borderRadius: 4,\n' +
      '    padding: 4,\n' +
      '  },';
    if (src.indexOf(oldBadge) === -1) {
      console.error('[v176h] FATAL: ContentCard.tsx — could not locate libraryBadge style.');
      process.exit(2);
    }
    const newBadge =
      '  /* V176H_BOOKMARK_POSITION — moved from top-right to bottom-right so it\n' +
      '     doesn\'t collide with the IN CINEMA badge that sits top-left/center. */\n' +
      '  libraryBadge: {\n' +
      "    position: 'absolute',\n" +
      '    bottom: 8,\n' +
      '    right: 8,\n' +
      '    backgroundColor: colors.primary,\n' +
      '    borderRadius: 4,\n' +
      '    padding: 4,\n' +
      '    zIndex: 6,\n' +
      '    elevation: 6,\n' +
      '  },';
    src = src.replace(oldBadge, newBadge);
    changes++;

    write(file, src);
    console.log(`[v176h] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/details/[type]/[id].tsx  (EpisodeCard menu fixes)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V176H_EPISODE_MENU') !== -1) {
    console.log('[v176h] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Extend the v173 import line to also pull v176MarkWatched + Alert.
    const oldImport = "import { v173RegisterLongPress as _v173RegLP } from '../../../src/components/ContentCard';";
    if (src.indexOf(oldImport) === -1) {
      console.error('[v176h] FATAL: id.tsx — could not locate v173RegLP import.');
      process.exit(3);
    }
    const newImport =
      "/* V176H_EPISODE_MENU — additional imports for unified episode menu. */\n" +
      "import {\n" +
      "  v173RegisterLongPress as _v173RegLP,\n" +
      "  v172IsWatched as _v176hV172IsWatched,\n" +
      "  v172SubscribeWatched as _v176hV172SubWatched,\n" +
      "  v176MarkWatched as _v176hMarkWatched,\n" +
      "} from '../../../src/components/ContentCard';\n" +
      "import { Alert as _V176hAlert } from 'react-native';";
    src = src.replace(oldImport, newImport);
    changes++;

    // 2b) Replace EpisodeCard's broken Pressable.  We anchor on the exact
    //     line sequence that exists today (onPress, onLongPress, the v173
    //     comment, the v173-registering onFocus/onBlur, then the v135
    //     onFocus/onBlur that overrides them) and emit a clean single set
    //     of handlers.
    const oldPressableBlock =
      '      onPress={onPress}\n' +
      '      onLongPress={isWatched ? onMarkUnwatched : undefined}\n' +
      '      /* V173_TV_LONGPRESS_EPISODE — register the mark-unwatched callback\n' +
      '         while this card is focused so the TV \'longSelect\' dispatcher in\n' +
      '         ContentCard.tsx can fire it.  Skips when nothing to unmark. */\n' +
      '      onFocus={() => { try { _v173RegLP(isWatched && typeof onMarkUnwatched === \'function\' ? onMarkUnwatched : null); } catch (_) {} if (autoFocus) { /* preserve any existing autoFocus behaviour */ } }}\n' +
      '      onBlur={() => { try { _v173RegLP(null); } catch (_) {} }}\n' +
      '      /* v135-focus-unlock-blur */\n' +
      '      onFocus={() => {\n' +
      '        setIsFocused(true);\n' +
      '        hasFocusedRef.current = true;\n' +
      '        focusGrabbedOnceRef.current = true;\n' +
      "        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');\n" +
      '      }}\n' +
      '      onBlur={() => {\n' +
      '        setIsFocused(false);\n' +
      '        if (hasFocusedRef.current) {\n' +
      '          userMovedRef.current = true;\n' +
      "          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');\n" +
      '        }\n' +
      '      }}\n' +
      '      delayLongPress={600}\n' +
      '      hasTVPreferredFocus={tvPreferred}';
    if (src.indexOf(oldPressableBlock) === -1) {
      console.error('[v176h] FATAL: id.tsx — could not locate EpisodeCard Pressable handlers block.');
      process.exit(4);
    }
    const newPressableBlock =
      '      onPress={onPress}\n' +
      '      /* V176H_EPISODE_MENU — single onLongPress that toggles Mark Watched\n' +
      '         / Mark Unwatched based on the current isWatched prop.  Touch\n' +
      '         fallback only; TV remote OK long-press is handled by the v173\n' +
      '         registry below (the OS-level dispatcher). */\n' +
      '      onLongPress={_v176hOpenEpisodeMenu}\n' +
      '      delayLongPress={500}\n' +
      '      /* V176H_EPISODE_MENU — ONE merged onFocus that does BOTH v135\n' +
      '         focus-state bookkeeping AND v173 long-press registration.  The\n' +
      '         previous build had two onFocus props on the same Pressable\n' +
      '         which silently dropped the v173 registration (React only keeps\n' +
      '         the last prop), so TV remote long-press never reached this\n' +
      '         card.  Now unified. */\n' +
      '      onFocus={() => {\n' +
      '        setIsFocused(true);\n' +
      '        hasFocusedRef.current = true;\n' +
      '        focusGrabbedOnceRef.current = true;\n' +
      "        console.log('[FOCUS v135] onFocus ep=' + episode.episode + ' (one-shot guard set)');\n" +
      '        try { _v173RegLP(_v176hOpenEpisodeMenu); } catch (_) {}\n' +
      '      }}\n' +
      '      onBlur={() => {\n' +
      '        setIsFocused(false);\n' +
      '        if (hasFocusedRef.current) {\n' +
      '          userMovedRef.current = true;\n' +
      "          console.log('[FOCUS v135] onBlur ep=' + episode.episode + ' (userMoved=true)');\n" +
      '        }\n' +
      '        try { _v173RegLP(null); } catch (_) {}\n' +
      '      }}\n' +
      '      hasTVPreferredFocus={tvPreferred}';
    src = src.replace(oldPressableBlock, newPressableBlock);
    changes++;

    // 2c) Add the menu opener inside EpisodeCard, right before the return.
    //     Splice after the existing `const thumbUri = ...` line.
    const thumbAnchor = '  const thumbUri = episode.thumbnail || fallbackPoster;';
    if (src.indexOf(thumbAnchor) === -1) {
      console.error('[v176h] FATAL: id.tsx — could not locate thumbUri anchor.');
      process.exit(5);
    }
    const menuOpener =
      thumbAnchor + '\n' +
      '\n' +
      '  /* V176H_EPISODE_MENU — unified Mark Watched / Mark Unwatched menu.\n' +
      '     Uses Alert for now (matches the other surfaces); v176h does not\n' +
      '     ship the Stremio-style popover overhaul — that comes next. */\n' +
      '  const _v176hEpId = (episode as any).content_id || (episode as any).id || null;\n' +
      '  const _v176hOpenEpisodeMenu = useCallback(() => {\n' +
      '    const id = _v176hEpId;\n' +
      '    if (!id) return;\n' +
      "    const title = `S${(episode as any).season || '?'} \\u00B7 E${(episode as any).episode || '?'}`\n" +
      "      + ((episode as any).name ? ` \\u2014 ${(episode as any).name}` : '');\n" +
      '    const watchedNow = !!isWatched || _v176hV172IsWatched(id);\n' +
      '    const buttons: any[] = [];\n' +
      '    if (watchedNow) {\n' +
      '      buttons.push({ text: \'Mark as Unwatched\', onPress: () => { try { onMarkUnwatched && onMarkUnwatched(); } catch (_) {} } });\n' +
      '    } else {\n' +
      '      buttons.push({ text: \'Mark as Watched\', onPress: () => { _v176hMarkWatched(id); } });\n' +
      '    }\n' +
      '    buttons.push({ text: \'Cancel\', style: \'cancel\' });\n' +
      '    _V176hAlert.alert(title, undefined, buttons);\n' +
      '  }, [_v176hEpId, isWatched, onMarkUnwatched, episode]);';
    src = src.replace(thumbAnchor, menuOpener);
    changes++;

    write(file, src);
    console.log(`[v176h] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176h] DONE.  ${totalChanges} total change(s).`);
console.log('[v176h] Pure JS changes — Metro reload OR rebuild + sideload both work.');
console.log('');
console.log('After install, verify:');
console.log('  1. Discover a movie poster that\'s in your library — bookmark');
console.log('     badge should now be bottom-right, NOT colliding with IN CINEMA.');
console.log('  2. Open a series detail screen, focus any episode poster, press');
console.log('     OK and HOLD on the TV remote — menu pops with Mark as Watched');
console.log('     or Mark as Unwatched.');
console.log('  3. On touch, finger-hold an episode poster — same menu pops.');
