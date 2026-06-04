/*
 * apply_patches_v176g_library_sync_and_exit_mark.js
 *
 * V176G — Two correctness bugs:
 *
 *   1. ContentCard's `isInLibrary` is set once at mount from the prop
 *      and only flips when THIS card's own long-press menu Add/Remove
 *      fires.  If you remove an item from the Library tab and then
 *      long-press the same poster on Discover, it still says
 *      "Remove from Library" because nobody told that card.
 *
 *      Fix: subscribe ContentCard to contentStore.library (already
 *      imported as _v169UseContentStore) and recompute isInLibrary
 *      from the live library snapshot on every change.
 *
 *   2. The V173_FORCE_WATCHED_ON_EXIT path in player.tsx writes raw
 *      AsyncStorage on unmount, never updates the in-memory
 *      _v172WatchedSet, never notifies subscribers — so the gold
 *      checkmark never lights up on Apex (or any other movie) until
 *      the next cold start.  v176c only fixed the throttled tick path.
 *
 *      Fix: route the exit-time mark through v176MarkWatched (the
 *      sister of v172UnmarkWatched), which updates the Set + writes
 *      AsyncStorage + notifies every visible card.
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176g_library_sync_and_exit_mark.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH     = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const PLAYER_PATH = path.join(ROOT, 'app', 'player.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176g] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176g] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/components/ContentCard.tsx  (live library sync)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176G_LIBRARY_SUBSCRIBE') !== -1) {
    console.log('[v176g] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // Anchor on the existing `const [isInLibrary, setIsInLibrary] = useState(inLibrary);`
    // line and inject a useEffect right after that subscribes to the global
    // library snapshot.
    const stateLine = '  const [isInLibrary, setIsInLibrary] = useState(inLibrary);';
    if (src.indexOf(stateLine) === -1) {
      console.error('[v176g] FATAL: ContentCard.tsx — could not locate isInLibrary state declaration.');
      process.exit(2);
    }
    const liveSync =
      stateLine + '\n' +
      '\n' +
      '  /* V176G_LIBRARY_SUBSCRIBE — keep isInLibrary in sync with the global\n' +
      '     library snapshot so removing an item from the Library tab also flips\n' +
      '     the Add/Remove button on the same poster in Discover/Search.  The\n' +
      '     contentStore was already imported as _v169UseContentStore for the\n' +
      '     V169 prefetch path — reusing it here costs nothing extra. */\n' +
      '  const _v176gLibrary = _v169UseContentStore((s: any) => s.library);\n' +
      '  useEffect(() => {\n' +
      '    if (!item) return;\n' +
      '    const myId = String((item as any).imdb_id || (item as any).id || (item as any).content_id || \'\');\n' +
      '    if (!myId) return;\n' +
      '    const lib = _v176gLibrary;\n' +
      '    if (!lib) return;\n' +
      '    const all: any[] = []\n' +
      '      .concat((lib as any).movies || [])\n' +
      '      .concat((lib as any).series || [])\n' +
      '      .concat((lib as any).channels || [])\n' +
      '      .concat((lib as any).tv || []);\n' +
      '    const found = all.some((it: any) => {\n' +
      '      const candidate = String(it.imdb_id || it.id || it.content_id || \'\');\n' +
      '      return candidate && candidate === myId;\n' +
      '    });\n' +
      '    setIsInLibrary(found);\n' +
      '  }, [_v176gLibrary, item]);';
    src = src.replace(stateLine, liveSync);
    changes++;

    write(file, src);
    console.log(`[v176g] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/player.tsx  (exit-mark via v176MarkWatched)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V176G_EXIT_MARK_WATCHED') !== -1) {
    console.log('[v176g] player.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // The existing exit-mark block from v173 — write raw AsyncStorage, no in-mem.
    const oldExitBlock =
      '        /* V173_FORCE_WATCHED_ON_EXIT — if the user fast-forwarded past 90%\n' +
      '           but backed out before the throttled saveProgress tick could fire,\n' +
      '           write privastream_watched here so the gold checkmark lands. */\n' +
      '        try {\n' +
      '          const _v173Pct = (currentPositionRef.current / currentDurationRef.current) * 100;\n' +
      '          if (_v173Pct >= 90) {\n' +
      "            const _v173Key = 'privastream_watched';\n" +
      '            AsyncStorage.getItem(_v173Key).then((raw) => {\n' +
      '              const set: Record<string, boolean> = raw ? JSON.parse(raw) : {};\n' +
      '              if (!set[contentId]) {\n' +
      '                set[contentId] = true;\n' +
      '                return AsyncStorage.setItem(_v173Key, JSON.stringify(set));\n' +
      '              }\n' +
      '            }).catch(() => {});\n' +
      '          }\n' +
      '        } catch (_) {}';
    if (src.indexOf(oldExitBlock) === -1) {
      console.error('[v176g] FATAL: player.tsx — could not locate V173_FORCE_WATCHED_ON_EXIT block.');
      process.exit(3);
    }
    const newExitBlock =
      '        /* V176G_EXIT_MARK_WATCHED — supersedes the v173 raw AsyncStorage\n' +
      '           write.  v176MarkWatched updates the in-memory _v172WatchedSet,\n' +
      '           writes AsyncStorage, AND notifies every subscribed ContentCard\n' +
      '           so the gold check appears the moment the user lands back on\n' +
      '           Discover — no app restart required. */\n' +
      '        try {\n' +
      '          const _v176gPct = (currentPositionRef.current / currentDurationRef.current) * 100;\n' +
      '          if (_v176gPct >= 90) {\n' +
      '            _v176cMark(contentId).then(() => {\n' +
      "              console.log('[V176G] exit-mark watched:', contentId);\n" +
      '            }).catch(() => {});\n' +
      '          }\n' +
      '        } catch (_) {}';
    src = src.replace(oldExitBlock, newExitBlock);
    changes++;

    write(file, src);
    console.log(`[v176g] player.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176g] DONE.  ${totalChanges} total change(s).`);
console.log('[v176g] Rebuild your Expo app and sideload to test.');
console.log('');
console.log('After install, verify:');
console.log('  1. Watch Apex to ≥90%, back out — gold check should appear');
console.log('     on the poster INSTANTLY (no app restart needed).');
console.log('  2. Add a movie to library on Discover, switch to Library tab,');
console.log('     remove it.  Go back to Discover, long-press that same');
console.log('     poster — menu should now say "Add to Library", not "Remove".');
