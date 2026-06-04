/*
 * apply_patches_v176j_library_refresh_and_cancelable.js
 *
 * V176J — Three correctness fixes:
 *
 *   1) Discover long-press → Remove from Library makes the bookmark
 *      disappear but the item is still in the Library tab.  Root
 *      cause: the menu's onPress calls api.library.remove() / .add()
 *      directly, bypassing contentStore.  So contentStore.library
 *      never gets refreshed and the Library tab keeps showing the
 *      stale item.
 *
 *      Fix: route Add/Remove through useContentStore actions
 *      (addToLibrary / removeFromLibrary), which already call
 *      fetchLibrary() after the API succeeds.
 *
 *   2) contentStore.removeFromLibrary's fetchLibrary() only runs in
 *      the happy path - the catch block swallows the error without
 *      refreshing.  If the API returns 404 because the item was
 *      already deleted by a previous attempt, the local cache stays
 *      stale forever and the X button on the Library tab does
 *      nothing visible.
 *
 *      Fix: move fetchLibrary() into a `finally` block so the cache
 *      is reconciled with the server regardless of API outcome.
 *
 *   3) Episode menu had Cancel removed in v176i, but on Android the
 *      hardware Back button does NOT dismiss an Alert that has no
 *      `cancel`-styled button.  Add { cancelable: true } as the 4th
 *      arg to Alert.alert so Back works.  Same for the main
 *      ContentCard menu - also remove its Cancel button now to match
 *      the episode menu (user request).
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage:
 *       node apply_patches_v176j_library_refresh_and_cancelable.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH    = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const STORE_PATH = path.join(ROOT, 'src', 'store', 'contentStore.ts');
const ID_PATH    = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176j] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176j] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — src/store/contentStore.ts  (finally-block refresh)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = STORE_PATH;
  let src = read(file);

  if (src.indexOf('V176J_STORE_FINALLY') !== -1) {
    console.log('[v176j] contentStore.ts: already patched, skipping');
  } else {
    let changes = 0;

    const oldAdd =
      '  addToLibrary: async (item: ContentItem) => {\n' +
      '    try {\n' +
      '      await api.library.add(item);\n' +
      '      await get().fetchLibrary();\n' +
      '    } catch (error: any) {\n' +
      "      console.log('[ContentStore] addToLibrary error:', error);\n" +
      '      set({ error: error.message });\n' +
      '    }\n' +
      '  },';
    if (src.indexOf(oldAdd) === -1) {
      console.error('[v176j] FATAL: contentStore.ts — could not locate addToLibrary block.');
      process.exit(2);
    }
    const newAdd =
      '  /* V176J_STORE_FINALLY — fetchLibrary in finally so the local cache\n' +
      '     re-syncs with the server even if the API call throws (e.g. a 409\n' +
      '     because the item is already present).  Without this, repeated\n' +
      '     errors leave the UI permanently stale. */\n' +
      '  addToLibrary: async (item: ContentItem) => {\n' +
      '    try {\n' +
      '      await api.library.add(item);\n' +
      '    } catch (error: any) {\n' +
      "      console.log('[ContentStore] addToLibrary error:', error);\n" +
      '      set({ error: error.message });\n' +
      '    } finally {\n' +
      '      try { await get().fetchLibrary(); } catch (_) {}\n' +
      '    }\n' +
      '  },';
    src = src.replace(oldAdd, newAdd);
    changes++;

    const oldRemove =
      '  removeFromLibrary: async (type: string, id: string) => {\n' +
      '    try {\n' +
      '      await api.library.remove(type, id);\n' +
      '      await get().fetchLibrary();\n' +
      '    } catch (error: any) {\n' +
      "      console.log('[ContentStore] removeFromLibrary error:', error);\n" +
      '      set({ error: error.message });\n' +
      '    }\n' +
      '  },';
    if (src.indexOf(oldRemove) === -1) {
      console.error('[v176j] FATAL: contentStore.ts — could not locate removeFromLibrary block.');
      process.exit(3);
    }
    const newRemove =
      '  removeFromLibrary: async (type: string, id: string) => {\n' +
      '    try {\n' +
      '      await api.library.remove(type, id);\n' +
      '    } catch (error: any) {\n' +
      "      console.log('[ContentStore] removeFromLibrary error:', error);\n" +
      '      set({ error: error.message });\n' +
      '    } finally {\n' +
      '      try { await get().fetchLibrary(); } catch (_) {}\n' +
      '    }\n' +
      '  },';
    src = src.replace(oldRemove, newRemove);
    changes++;

    write(file, src);
    console.log(`[v176j] contentStore.ts: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — src/components/ContentCard.tsx
//    (route menu through contentStore + remove Cancel + cancelable Alert)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176J_MENU_REFRESH') !== -1) {
    console.log('[v176j] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Route Remove through contentStore.removeFromLibrary.
    const oldRemoveCall =
      "      onPress: async () => {\n" +
      "        try { await (api as any).library.remove(contentType, contentId); } catch (_) {}\n" +
      "        try { onAfterChange && onAfterChange('removed'); } catch (_) {}\n" +
      "      },";
    if (src.indexOf(oldRemoveCall) === -1) {
      console.error('[v176j] FATAL: ContentCard.tsx — could not locate menu Remove onPress.');
      process.exit(4);
    }
    const newRemoveCall =
      "      onPress: async () => {\n" +
      "        /* V176J_MENU_REFRESH — route through contentStore so the Library tab\n" +
      "           refreshes after the remove succeeds.  Direct api.library.remove()\n" +
      "           left contentStore.library stale. */\n" +
      "        try {\n" +
      "          const removeFn = (_v169UseContentStore as any).getState().removeFromLibrary;\n" +
      "          await removeFn(contentType, contentId);\n" +
      "        } catch (e) { console.log('[V176J] remove error:', e); }\n" +
      "        try { onAfterChange && onAfterChange('removed'); } catch (_) {}\n" +
      "      },";
    src = src.replace(oldRemoveCall, newRemoveCall);
    changes++;

    // 2b) Route Add through contentStore.addToLibrary.
    const oldAddCall =
      '        try {\n' +
      '          await (api as any).library.add({\n' +
      '            id: contentId,\n' +
      "            imdb_id: contentId && String(contentId).startsWith('tt') ? contentId : undefined,\n" +
      '            name: title,\n' +
      '            type: contentType,\n' +
      "            poster: (item as any).poster || '',\n" +
      '          });\n' +
      "          console.log('[V176D] library.add OK:', contentId);\n" +
      '        } catch (e) {\n' +
      "          console.log('[V176D] library.add FAILED:', e);\n" +
      '        }';
    if (src.indexOf(oldAddCall) === -1) {
      console.error('[v176j] FATAL: ContentCard.tsx — could not locate menu Add onPress body.');
      process.exit(5);
    }
    const newAddCall =
      '        /* V176J_MENU_REFRESH — route through contentStore so the Library\n' +
      '           tab refreshes after the add. */\n' +
      '        try {\n' +
      '          const addFn = (_v169UseContentStore as any).getState().addToLibrary;\n' +
      '          await addFn({\n' +
      '            id: contentId,\n' +
      "            imdb_id: contentId && String(contentId).startsWith('tt') ? contentId : undefined,\n" +
      '            name: title,\n' +
      '            type: contentType,\n' +
      "            poster: (item as any).poster || '',\n" +
      '          });\n' +
      "          console.log('[V176J] library.add OK:', contentId);\n" +
      '        } catch (e) {\n' +
      "          console.log('[V176J] library.add FAILED:', e);\n" +
      '        }';
    src = src.replace(oldAddCall, newAddCall);
    changes++;

    // 2c) Drop the Cancel button from the ContentCard menu (user request).
    const oldCancelPush = "  buttons.push({ text: 'Cancel', style: 'cancel' });";
    if (src.indexOf(oldCancelPush) === -1) {
      console.error('[v176j] FATAL: ContentCard.tsx — could not locate Cancel button push.');
      process.exit(6);
    }
    src = src.replace(
      oldCancelPush,
      "  /* V176J_MENU_REFRESH — Cancel removed; Alert.alert is invoked with\n" +
      "     cancelable=true so hardware Back dismisses on Android. */"
    );
    changes++;

    // 2d) Make the Alert cancelable.
    const oldAlertCall = "  Alert.alert(title, undefined, buttons);";
    if (src.indexOf(oldAlertCall) === -1) {
      console.error('[v176j] FATAL: ContentCard.tsx — could not locate Alert.alert call.');
      process.exit(7);
    }
    src = src.replace(
      oldAlertCall,
      "  Alert.alert(title, undefined, buttons, { cancelable: true });"
    );
    changes++;

    write(file, src);
    console.log(`[v176j] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 — app/details/[type]/[id].tsx  (episode Alert cancelable)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V176J_EPISODE_CANCELABLE') !== -1) {
    console.log('[v176j] details/[type]/[id].tsx: already patched, skipping');
  } else {
    let changes = 0;

    const oldEpAlert = "    _V176cAlert.alert(title, undefined, buttons);";
    if (src.indexOf(oldEpAlert) === -1) {
      console.error('[v176j] FATAL: id.tsx — could not locate episode Alert.alert call.');
      process.exit(8);
    }
    src = src.replace(
      oldEpAlert,
      "    /* V176J_EPISODE_CANCELABLE — cancelable=true so hardware Back\n" +
      "       dismisses the menu (Cancel button was removed in v176i). */\n" +
      "    _V176cAlert.alert(title, undefined, buttons, { cancelable: true });"
    );
    changes++;

    write(file, src);
    console.log(`[v176j] details/[type]/[id].tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176j] DONE.  ${totalChanges} total change(s).`);
console.log('[v176j] Pure JS — Metro reload OR rebuild + sideload both work.');
console.log('');
console.log('After install, verify:');
console.log('  1. Discover → long-press → Add to Library → bookmark appears.');
console.log('     Go to Library tab → item appears.');
console.log('     Back to Discover → long-press same poster → "Remove from Library".');
console.log('     Confirm → bookmark gone.');
console.log('     Go to Library tab → item GONE (was stuck before v176j).');
console.log('  2. Library tab → X button on poster → item removed instantly.');
console.log('  3. Long-press any episode → menu pops → press hardware Back');
console.log('     button → menu dismisses (was trapped before v176j).');
