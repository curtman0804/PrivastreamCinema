/*
 * apply_patches_v176i_ref_dispatch_and_episode_paint.js
 *
 * V176I — Three follow-up fixes:
 *
 *   1) Long-press still says "Add to Library" after a successful Add
 *      (and vice versa for Remove).
 *
 *      Root cause: v173RegisterLongPress(handleLongPress) freezes a
 *      closure with the CURRENT isInLibrary value into the global
 *      _v173FocusedLP slot.  When the menu's Add resolves we
 *      setIsInLibrary(true) and rebuild handleLongPress, but the
 *      stale closure is only re-registered on the next onFocus -
 *      which never fires because the card never lost focus.
 *
 *      Fix: change the dispatcher to read from a ref (always points
 *      at the latest handler) instead of a frozen function.  Update
 *      the ref on every render of ContentCard.
 *
 *   2) Episode poster gold check doesn't appear after Mark as Watched.
 *
 *      Root cause: EpisodeCard renders `{isWatched && ...}` using
 *      only the parent prop, which is derived once at mount from
 *      `watchedEpisodes[epContentId]`.  v176MarkWatched updates the
 *      in-memory _v172WatchedSet but the parent state was never
 *      told.  EpisodeCard already subscribes to v172, but the badge
 *      visibility check ignores the registry.
 *
 *      Fix: badge visibility check = isWatched || _v172IsWatched(id).
 *
 *   3) Remove the Cancel button from the episode menu (user requested).
 *      Back button on the remote already dismisses Alert.
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage:
 *       node apply_patches_v176i_ref_dispatch_and_episode_paint.js
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
    console.error(`[v176i] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176i] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/components/ContentCard.tsx
//    (ref-based dispatch + auto-update ref on every handler change)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176I_REF_DISPATCH') !== -1) {
    console.log('[v176i] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 1a) Replace the v173 module-level slot + dispatcher + register fn
    //     with a ref-based version so the dispatcher always reads the
    //     CURRENT handler at fire-time, not a frozen closure.
    const oldSlot = 'let _v173FocusedLP: (() => void) | null = null;';
    if (src.indexOf(oldSlot) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate v173 focused-LP slot.');
      process.exit(2);
    }
    src = src.replace(
      oldSlot,
      '/* V176I_REF_DISPATCH — the previous v173 implementation cached a\n' +
      '   frozen closure here.  When the focused card setState-updated\n' +
      '   (e.g. isInLibrary flips after Add), the cached closure became\n' +
      '   stale and the next longSelect fired the old behavior.  Using a\n' +
      '   ref-of-ref pattern: this slot now holds a *getter* that returns\n' +
      '   the most recent handler.  Each ContentCard installs its own\n' +
      '   getter on focus and clears on blur.  Inside the card we keep a\n' +
      '   useRef updated by every render so the getter always returns the\n' +
      '   freshest closure. */\n' +
      'let _v173FocusedLP: (() => void) | null = null;\n' +
      'let _v176iLatestGetter: (() => (() => void) | null) | null = null;'
    );
    changes++;

    // 1b) Update the dispatcher to prefer the getter when present.
    const oldDispatch =
      "    if (evt && evt.eventType === 'longSelect') {\n" +
      "      if (_v173FocusedLP) {\n" +
      "        console.log('[V176F] longSelect -> dispatching to focused card');\n" +
      "        try { _v173FocusedLP(); } catch (e) { console.log('[V176F] dispatch error:', e); }\n" +
      "      } else {\n" +
      "        console.log('[V176F] longSelect ignored — no focused card registered');\n" +
      '      }\n' +
      '    }';
    if (src.indexOf(oldDispatch) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate longSelect dispatcher.');
      process.exit(3);
    }
    src = src.replace(
      oldDispatch,
      "    if (evt && evt.eventType === 'longSelect') {\n" +
      '      /* V176I_REF_DISPATCH — prefer the getter; falls back to the\n' +
      '         legacy slot for any callers that still set it directly. */\n' +
      '      let target: (() => void) | null = null;\n' +
      '      try { if (_v176iLatestGetter) target = _v176iLatestGetter(); } catch (_) {}\n' +
      '      if (!target) target = _v173FocusedLP;\n' +
      '      if (target) {\n' +
      "        console.log('[V176I] longSelect -> dispatching to focused card');\n" +
      "        try { target(); } catch (e) { console.log('[V176I] dispatch error:', e); }\n" +
      '      } else {\n' +
      "        console.log('[V176I] longSelect ignored — no focused card registered');\n" +
      '      }\n' +
      '    }'
    );
    changes++;

    // 1c) Extend v173RegisterLongPress so callers can ALSO pass a getter.
    //     We add a sister v176iRegisterGetter export and keep legacy alive.
    const oldRegister =
      'export function v173RegisterLongPress(fn: (() => void) | null): void {\n' +
      '  _v173FocusedLP = fn;\n' +
      '}';
    if (src.indexOf(oldRegister) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate v173RegisterLongPress.');
      process.exit(4);
    }
    src = src.replace(
      oldRegister,
      'export function v173RegisterLongPress(fn: (() => void) | null): void {\n' +
      '  _v173FocusedLP = fn;\n' +
      '}\n' +
      '\n' +
      '/* V176I_REF_DISPATCH — register a *getter* (closure-stable) that the\n' +
      '   dispatcher invokes at fire-time.  Callers should pass a fn that\n' +
      '   reads from a useRef whose .current is updated by every render. */\n' +
      'export function v176iRegisterGetter(get: (() => (() => void) | null) | null): void {\n' +
      '  _v176iLatestGetter = get;\n' +
      '}'
    );
    changes++;

    // 1d) Inside ContentCard, add a ref that always points to the latest
    //     handleLongPress.  Update it on every render after handleLongPress
    //     is declared.  Splice right after the handleLongPress useCallback.
    const lpAnchor =
      "  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);";
    if (src.indexOf(lpAnchor) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate handleLongPress deps array.');
      process.exit(5);
    }
    src = src.replace(
      lpAnchor,
      lpAnchor + '\n' +
      '\n' +
      '  /* V176I_REF_DISPATCH — keep a ref pointing at the freshest\n' +
      '     handleLongPress so the global dispatcher reads the current one\n' +
      '     (not a stale closure frozen at the last onFocus). */\n' +
      '  const _v176iLpRef = useRef<(() => void) | null>(null);\n' +
      '  _v176iLpRef.current = handleLongPress;'
    );
    changes++;

    // 1e) On focus, register the GETTER (not the closure) so the dispatcher
    //     always reads the ref-current.  Anchor on the existing v173 call
    //     inside handleFocus.
    const oldRegOnFocus = "    try { v173RegisterLongPress(handleLongPress); } catch (_) {}";
    if (src.indexOf(oldRegOnFocus) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate v173 register-on-focus call.');
      process.exit(6);
    }
    src = src.replace(
      oldRegOnFocus,
      "    /* V176I_REF_DISPATCH — register a getter, not the closure itself. */\n" +
      "    try { v176iRegisterGetter(() => _v176iLpRef.current); } catch (_) {}\n" +
      "    try { v173RegisterLongPress(handleLongPress); } catch (_) {}"
    );
    changes++;

    // 1f) On blur, clear both registrations.
    const oldClearOnBlur = "    try { v173RegisterLongPress(null); } catch (_) {}";
    if (src.indexOf(oldClearOnBlur) === -1) {
      console.error('[v176i] FATAL: ContentCard.tsx — could not locate v173 clear-on-blur call.');
      process.exit(7);
    }
    src = src.replace(
      oldClearOnBlur,
      "    try { v176iRegisterGetter(null); } catch (_) {}\n" +
      "    try { v173RegisterLongPress(null); } catch (_) {}"
    );
    changes++;

    write(file, src);
    console.log(`[v176i] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/details/[type]/[id].tsx
//    (episode badge reads from registry too + no Cancel button +
//     same ref-dispatch trick so re-long-pressing immediately reflects
//     the current watched state)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V176I_EPISODE_PAINT') !== -1) {
    console.log('[v176i] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Render the gold check whenever the registry knows the episode
    //     is watched, even if the parent prop hasn't refreshed.
    const oldBadge =
      '        {isWatched && (\n' +
      '          <View style={styles.watchedBadge}>\n' +
      '            <Ionicons name="checkmark" size={14} color="#B8A05C" />\n' +
      '          </View>\n' +
      '        )}';
    if (src.indexOf(oldBadge) === -1) {
      console.error('[v176i] FATAL: id.tsx — could not locate EpisodeCard watched badge JSX.');
      process.exit(8);
    }
    const newBadge =
      '        {/* V176I_EPISODE_PAINT — also consult the in-memory _v172WatchedSet\n' +
      '            so Mark-as-Watched lights up the gold check the instant the menu\n' +
      '            closes, no parent state refresh required. */}\n' +
      '        {(isWatched || (!!_v176cEpId && _v176cV172IsWatched(_v176cEpId))) && (\n' +
      '          <View style={styles.watchedBadge}>\n' +
      '            <Ionicons name="checkmark" size={14} color="#B8A05C" />\n' +
      '          </View>\n' +
      '        )}';
    src = src.replace(oldBadge, newBadge);
    changes++;

    // 2b) Drop the Cancel button.  Anchor on the existing buttons.push call.
    const oldCancel = "    buttons.push({ text: 'Cancel', style: 'cancel' });";
    if (src.indexOf(oldCancel) === -1) {
      console.error('[v176i] FATAL: id.tsx — could not locate Cancel button push.');
      process.exit(9);
    }
    src = src.replace(
      oldCancel,
      "    /* V176I_EPISODE_PAINT — Cancel removed; back button dismisses Alert. */"
    );
    changes++;

    // 2c) Apply the same ref-dispatch pattern so an immediate second
    //     long-press reflects the just-flipped watched state without
    //     waiting for re-focus.  Wrap the menu opener through a ref.
    const oldOpenerDep = "  }, [episode, isWatched, onMarkUnwatched, _v176cEpId]);";
    if (src.indexOf(oldOpenerDep) === -1) {
      console.error('[v176i] FATAL: id.tsx — could not locate _v176cOpenEpMenu deps array.');
      process.exit(10);
    }
    src = src.replace(
      oldOpenerDep,
      oldOpenerDep + '\n' +
      '\n' +
      '  /* V176I_EPISODE_PAINT — ref-of-latest-opener so the v173 dispatcher\n' +
      '     never holds a stale watched-state closure between long-presses. */\n' +
      '  const _v176iEpLpRef = useRef<(() => void) | null>(null);\n' +
      '  _v176iEpLpRef.current = _v176cOpenEpMenu;'
    );
    changes++;

    // 2d) Swap the v173 focus registration to use the ref-stable wrapper.
    const oldRegEp = '        try { _v173RegLP(_v176cOpenEpMenu); } catch (_) {}';
    if (src.indexOf(oldRegEp) === -1) {
      console.error('[v176i] FATAL: id.tsx — could not locate _v173RegLP(_v176cOpenEpMenu) call.');
      process.exit(11);
    }
    src = src.replace(
      oldRegEp,
      "        /* V176I_EPISODE_PAINT — register a stable wrapper that reads\n" +
      "           the latest opener from the ref, so toggling watched in the\n" +
      "           menu doesn't strand the next long-press with a stale value. */\n" +
      "        try { _v173RegLP(() => { try { _v176iEpLpRef.current && _v176iEpLpRef.current(); } catch (_) {} }); } catch (_) {}"
    );
    changes++;

    write(file, src);
    console.log(`[v176i] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176i] DONE.  ${totalChanges} total change(s).`);
console.log('[v176i] Pure JS changes — Metro reload OR rebuild + sideload both work.');
console.log('');
console.log('After install, verify:');
console.log('  1. Long-press Discover poster → Add to Library → check bookmark badge');
console.log('     bottom-right.  Long-press SAME poster again → now says');
console.log('     "Remove from Library".  Confirm → badge disappears → long-press');
console.log('     a third time → back to "Add to Library".');
console.log('  2. Series detail → focus an unwatched episode → OK+HOLD → Mark as');
console.log('     Watched → gold check appears INSTANTLY on that episode poster.');
console.log('     OK+HOLD again on the same episode → menu now says Mark as Unwatched.');
console.log('  3. Episode menu shows ONLY Mark as Watched/Unwatched (+ Clear Progress');
console.log('     if applicable) — no Cancel button.  Back button dismisses.');
