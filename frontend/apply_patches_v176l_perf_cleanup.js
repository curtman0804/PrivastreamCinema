/*
 * apply_patches_v176l_perf_cleanup.js
 *
 * V176L — Restore snappy performance after the v176 series shipped.
 *
 *   1) Remove the diagnostic console.log added in v176f.  It runs on
 *      EVERY TV key press (D-pad up/down/left/right) — each call does
 *      a JSON.stringify and a JS<->native bridge round-trip.  On
 *      Android TV with rapid D-pad navigation this fires hundreds of
 *      times per second and is the dominant source of lag.
 *
 *   2) Replace the v176g library-membership scan with a memoized Set
 *      built once per library change.  Old code did:
 *          [].concat(movies).concat(series).concat(channels).some(...)
 *      → O(N) per card per library change.  With ~50 visible cards
 *      and ~50 library items that's 2500 iterations on every Add.
 *      New code: contentStore exposes a librarySet (Set<string>), cards
 *      do O(1) librarySet.has(myId).
 *
 *   3) Drop the noisy [V176I] / [V176G] logs that fired on every
 *      mark-watched / exit-mark.  Keep error logs only.
 *
 *   Idempotent.  CRLF preserved.  Metro reload OR rebuild.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH    = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const STORE_PATH = path.join(ROOT, 'src', 'store', 'contentStore.ts');
const PLAYER_PATH= path.join(ROOT, 'app', 'player.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176l] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176l] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/components/ContentCard.tsx  (kill per-keypress log + O(1) lib)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176L_PERF_CLEANUP') !== -1) {
    console.log('[v176l] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1a) Strip the per-key-press JSON.stringify console.log from the
    //     v173/v176f onTVKeyEvent listener.  Keep the dispatch logic
    //     intact; just remove the diagnostic line that runs on EVERY key.
    const oldLog =
      "    try { console.log('[V176F] TV event:', JSON.stringify(evt), 'hasFocusedLP=', !!_v173FocusedLP); } catch (_) {}\n";
    if (src.indexOf(oldLog) !== -1) {
      src = src.replace(oldLog, '    /* V176L_PERF_CLEANUP — diagnostic log removed (fired per keypress). */\n');
      changes++;
    }

    // 1b) Also drop the [V176I] dispatching/ignored logs — they fire on
    //     long-press which is rare, but they\'re bridge calls so still
    //     cheap to remove.
    const oldDispatchLog =
      "        console.log('[V176I] longSelect -> dispatching to focused card');\n" +
      "        try { target(); } catch (e) { console.log('[V176I] dispatch error:', e); }\n";
    if (src.indexOf(oldDispatchLog) !== -1) {
      src = src.replace(
        oldDispatchLog,
        '        /* V176L_PERF_CLEANUP — silent fast-path. */\n' +
        "        try { target(); } catch (e) { console.log('[V176L] dispatch error:', e); }\n"
      );
      changes++;
    }
    const oldIgnoredLog =
      "        console.log('[V176I] longSelect ignored — no focused card registered');\n";
    if (src.indexOf(oldIgnoredLog) !== -1) {
      src = src.replace(oldIgnoredLog, '        /* V176L_PERF_CLEANUP — silent. */\n');
      changes++;
    }

    // 1c) Replace the v176g O(N) library subscription with an O(1) Set
    //     lookup.  Anchor on the v176g useEffect block.
    const oldLibBlock =
      '  /* V176G_LIBRARY_SUBSCRIBE — keep isInLibrary in sync with the global\n' +
      '     library snapshot so removing an item from the Library tab also flips\n' +
      '     the Add/Remove button on the same poster in Discover/Search.  The\n' +
      '     contentStore was already imported as _v169UseContentStore for the\n' +
      '     V169 prefetch path — reusing it here costs nothing extra. */\n' +
      '  const _v176gLibrary = _v169UseContentStore((s: any) => s.library);\n' +
      '  useEffect(() => {\n' +
      '    if (!item) return;\n' +
      "    const myId = String((item as any).imdb_id || (item as any).id || (item as any).content_id || '');\n" +
      '    if (!myId) return;\n' +
      '    const lib = _v176gLibrary;\n' +
      '    if (!lib) return;\n' +
      '    const all: any[] = []\n' +
      '      .concat((lib as any).movies || [])\n' +
      '      .concat((lib as any).series || [])\n' +
      '      .concat((lib as any).channels || [])\n' +
      '      .concat((lib as any).tv || []);\n' +
      '    const found = all.some((it: any) => {\n' +
      "      const candidate = String(it.imdb_id || it.id || it.content_id || '');\n" +
      '      return candidate && candidate === myId;\n' +
      '    });\n' +
      '    setIsInLibrary(found);\n' +
      '  }, [_v176gLibrary, item]);';
    if (src.indexOf(oldLibBlock) !== -1) {
      const newLibBlock =
        '  /* V176L_PERF_CLEANUP — O(1) lookup via librarySet (built once per\n' +
        '     library change in contentStore).  The previous v176g version\n' +
        '     flattened movies+series+channels+tv into a fresh array and ran\n' +
        '     .some() on every library change for every card.  With ~50 cards\n' +
        '     and ~50 items that was 2500 string comparisons per Add/Remove. */\n' +
        '  const _v176lLibSet = _v169UseContentStore((s: any) => s.librarySet);\n' +
        '  useEffect(() => {\n' +
        '    if (!item) return;\n' +
        "    const myId = String((item as any).imdb_id || (item as any).id || (item as any).content_id || '');\n" +
        '    if (!myId) return;\n' +
        '    if (!_v176lLibSet) return;\n' +
        '    setIsInLibrary((_v176lLibSet as Set<string>).has(myId));\n' +
        '  }, [_v176lLibSet, item]);';
      src = src.replace(oldLibBlock, newLibBlock);
      changes++;
    } else {
      console.log('[v176l] WARN: ContentCard.tsx v176g library block not found in expected form — skipping lib-set swap.');
    }

    // Mark the file so idempotency works even if all sub-edits were already done.
    if (changes > 0) {
      src = src.replace(
        '/* V176K_POPOVER — Stremio-style anchored popover. */',
        '/* V176K_POPOVER — Stremio-style anchored popover. */\n' +
        '  /* V176L_PERF_CLEANUP marker */'
      );
    }

    if (changes > 0) {
      write(file, src);
      console.log(`[v176l] ContentCard.tsx: ${changes} change(s) applied`);
      totalChanges += changes;
    } else {
      console.log('[v176l] ContentCard.tsx: nothing to change');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — src/store/contentStore.ts  (build librarySet alongside library)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = STORE_PATH;
  let src = read(file);

  if (src.indexOf('V176L_LIBRARY_SET') !== -1) {
    console.log('[v176l] contentStore.ts: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Extend the LibraryState type to include librarySet.
    const oldStateField = 'library: LibraryResponse | null;';
    if (src.indexOf(oldStateField) !== -1) {
      src = src.replace(
        oldStateField,
        oldStateField + '\n' +
        '  /* V176L_LIBRARY_SET — precomputed membership Set for O(1) lookup\n' +
        '     by cards.  Built every time library is updated. */\n' +
        '  librarySet: Set<string>;'
      );
      changes++;
    }

    // 2b) Initialize librarySet alongside library in the store create().
    const oldInit = 'library: null,';
    if (src.indexOf(oldInit) !== -1) {
      src = src.replace(oldInit, 'library: null,\n  librarySet: new Set<string>(),');
      changes++;
    }

    // 2c) Update fetchLibrary to compute librarySet whenever library is set.
    //     The set() call may include other fields, so we match the line and
    //     replace the whole `library: <var>,` portion to also set librarySet.
    const oldSetLine = 'set({ library: data, isLoadingLibrary: false });';
    if (src.indexOf(oldSetLine) !== -1) {
      const replacement =
        '/* V176L_LIBRARY_SET — also build the membership Set so every\n' +
        '         subscribed ContentCard can do O(1) lookups. */\n' +
        '      const _v176lSet = new Set<string>();\n' +
        '      try {\n' +
        '        const _v176lArr: any[] = []\n' +
        '          .concat(((data as any) && (data as any).movies) || [])\n' +
        '          .concat(((data as any) && (data as any).series) || [])\n' +
        '          .concat(((data as any) && (data as any).channels) || [])\n' +
        '          .concat(((data as any) && (data as any).tv) || []);\n' +
        '        for (const it of _v176lArr) {\n' +
        "          const id = String((it && (it.imdb_id || it.id || it.content_id)) || '');\n" +
        '          if (id) _v176lSet.add(id);\n' +
        '        }\n' +
        '      } catch (_) {}\n' +
        '      set({ library: data, librarySet: _v176lSet, isLoadingLibrary: false });';
      src = src.replace(oldSetLine, replacement);
      changes++;
    } else {
      console.log('[v176l] WARN: contentStore.ts — could not locate set({library: data, isLoadingLibrary: false}) call.  librarySet build skipped.');
    }

    if (changes > 0) {
      write(file, src);
      console.log(`[v176l] contentStore.ts: ${changes} change(s) applied`);
      totalChanges += changes;
    } else {
      console.log('[v176l] contentStore.ts: nothing to change');
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 — app/player.tsx  (drop v176g/v176c chatty marks)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V176L_QUIET_PLAYER') !== -1) {
    console.log('[v176l] player.tsx: already patched, skipping');
  } else {
    let changes = 0;

    const drops = [
      "console.log('[V176G] exit-mark watched:', contentId);",
      "console.log('[PLAYER] v176c marked as watched:', contentId);",
    ];
    for (const d of drops) {
      if (src.indexOf(d) !== -1) {
        src = src.replace(d, '/* V176L_QUIET_PLAYER — log dropped. */');
        changes++;
      }
    }

    if (changes > 0) {
      write(file, src);
      console.log(`[v176l] player.tsx: ${changes} change(s) applied`);
      totalChanges += changes;
    } else {
      console.log('[v176l] player.tsx: nothing to change');
    }
  }
}

console.log('');
console.log(`[v176l] DONE.  ${totalChanges} total change(s).`);
console.log('[v176l] Pure JS — Metro reload OR rebuild + sideload both work.');
console.log('[v176l] D-pad navigation on Discover should feel SNAPPY after this.');
