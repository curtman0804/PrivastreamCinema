/*
 * apply_patches_v176e_menu_button_longpress.js
 *
 * V176E — Make the menu actually open on Firestick / Google TV.
 *
 *   Root cause discovered: withTVKeyEvents.js only emits 'select' on OK
 *   press and never 'longSelect'.  v173's DeviceEventEmitter listener
 *   has been silently dead on TV since v173 landed.
 *
 *   Fix: map the Menu button (KEYCODE_MENU) on the remote to 'longSelect'.
 *   The Firestick ≡ button and Google TV options/3-dots button are
 *   currently no-ops in the app, so claiming them is free.  v173's
 *   listener already routes longSelect to the focused card's handler.
 *
 *   Also wires v173 focus-registration into LibraryCard and
 *   ContinueWatchingItem (which never had it), so the Menu button works
 *   on every poster surface, not just ContentCard.
 *
 *   FILES CHANGED:
 *     • plugins/withTVKeyEvents.js              (native, requires rebuild)
 *     • app/(tabs)/library.tsx                  (LibraryCard v173 reg)
 *     • app/(tabs)/discover.tsx                 (ContinueWatchingItem v173 reg)
 *
 *   IMPORTANT: After this patch you MUST do a clean Android rebuild
 *   (the plugin gets baked into MainActivity.kt during expo prebuild),
 *   not just a Metro reload.  Typical Windows commands:
 *       npx expo prebuild --clean -p android
 *       npx expo run:android --variant release   (or your usual build)
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176e_menu_button_longpress.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PLUGIN_PATH   = path.join(ROOT, 'plugins', 'withTVKeyEvents.js');
const LIBRARY_PATH  = path.join(ROOT, 'app', '(tabs)', 'library.tsx');
const DISCOVER_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176e] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176e] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — plugins/withTVKeyEvents.js   (map MENU → 'longSelect')
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLUGIN_PATH;
  let src = read(file);

  if (src.indexOf('V176E_MENU_LONGSELECT') !== -1) {
    console.log('[v176e] withTVKeyEvents.js: already patched, skipping');
  } else {
    let changes = 0;

    // Inject the KEYCODE_MENU mapping into the existing `when` block.  Anchor
    // on the existing KEYCODE_DPAD_CENTER -> "select" line and add MENU above
    // it so the mapping is visible to anyone reading the plugin.
    const dpadCenterLine = 'KeyEvent.KEYCODE_DPAD_CENTER -> "select"';
    if (src.indexOf(dpadCenterLine) === -1) {
      console.error('[v176e] FATAL: withTVKeyEvents.js — could not locate KEYCODE_DPAD_CENTER mapping.');
      process.exit(2);
    }
    const newLines =
      '/* V176E_MENU_LONGSELECT — Firestick / Google TV remote Menu button\n' +
      '           is unused by the app today; claim it as the long-press trigger so\n' +
      '           the contextual menu can open from the OS-level remote.  v173\'s\n' +
      '           DeviceEventEmitter listener in ContentCard.tsx already routes the\n' +
      '           \'longSelect\' event to the currently-focused card\'s handler. */\n' +
      '        KeyEvent.KEYCODE_MENU -> "longSelect"\n' +
      '        ' + dpadCenterLine;
    src = src.replace(dpadCenterLine, newLines);
    changes++;

    write(file, src);
    console.log(`[v176e] withTVKeyEvents.js: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — app/(tabs)/library.tsx  (LibraryCard v173 focus registration)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = LIBRARY_PATH;
  let src = read(file);

  if (src.indexOf('V176E_TV_LONGPRESS') !== -1) {
    console.log('[v176e] library.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 2a) Extend the existing ContentCard import to also pull v173RegisterLongPress.
    const ccImportAnchor =
      "  v172IsWatched as _v172IsWatched,\n" +
      "  v172SubscribeWatched as _v172SubscribeWatched,\n" +
      "  v176HasProgress as _v176HasProgress,\n" +
      "  v176SubscribeProgress as _v176SubscribeProgress,\n" +
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "} from '../../src/components/ContentCard';";
    if (src.indexOf(ccImportAnchor) === -1) {
      console.error('[v176e] FATAL: library.tsx — could not locate v176 ContentCard import block.');
      process.exit(3);
    }
    const newImport = ccImportAnchor.replace(
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n",
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "  /* V176E_TV_LONGPRESS — register this card's menu handler with the\n" +
      "     v173 TV event dispatcher so the remote Menu button (now mapped to\n" +
      "     longSelect via withTVKeyEvents.js) fires this card's menu. */\n" +
      "  v173RegisterLongPress as _v173RegLP,\n"
    );
    src = src.replace(ccImportAnchor, newImport);
    changes++;

    // 2b) In LibraryCard's poster Pressable onFocus, register; onBlur, clear.
    //     Anchor on the existing handleFocus / onBlur lines.
    const focusAnchor = '        onFocus={handleFocus}\n        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}';
    if (src.indexOf(focusAnchor) === -1) {
      console.error('[v176e] FATAL: library.tsx — could not locate LibraryCard poster Pressable focus handlers.');
      process.exit(4);
    }
    const newFocus =
      '        onFocus={() => { try { _v173RegLP(_v176OpenMenu); } catch (_) {} handleFocus(); }}\n' +
      '        onBlur={() => { try { _v173RegLP(null); } catch (_) {} setIsFocused(false); onCardBlur?.(); }}';
    src = src.replace(focusAnchor, newFocus);
    changes++;

    write(file, src);
    console.log(`[v176e] library.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 3 — app/(tabs)/discover.tsx  (ContinueWatchingItem v173 reg)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = DISCOVER_PATH;
  let src = read(file);

  if (src.indexOf('V176E_TV_LONGPRESS') !== -1) {
    console.log('[v176e] discover.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // 3a) Extend the v176 ContentCard import block.
    const ccImportAnchor =
      "  v172IsWatched as _v172IsWatched,\n" +
      "  v172SubscribeWatched as _v172SubscribeWatched,\n" +
      "  v176RegisterProgress as _v176RegisterProgress,\n" +
      "  v176HasProgress as _v176HasProgress,\n" +
      "  v176SubscribeProgress as _v176SubscribeProgress,\n" +
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "} from '../../src/components/ContentCard';";
    if (src.indexOf(ccImportAnchor) === -1) {
      console.error('[v176e] FATAL: discover.tsx — could not locate v176 ContentCard import block.');
      process.exit(5);
    }
    const newImport = ccImportAnchor.replace(
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n",
      "  v176ShowLongPressMenu as _v176ShowLongPressMenu,\n" +
      "  /* V176E_TV_LONGPRESS — register this CW card's menu handler with v173. */\n" +
      "  v173RegisterLongPress as _v173RegLP,\n"
    );
    src = src.replace(ccImportAnchor, newImport);
    changes++;

    // 3b) Wire v173 register/clear into the ContinueWatchingItem poster
    //     Pressable focus handlers.
    const focusAnchor = '        onFocus={handleFocus}\n        onBlur={() => setIsFocused(false)}';
    if (src.indexOf(focusAnchor) === -1) {
      console.error('[v176e] FATAL: discover.tsx — could not locate ContinueWatchingItem focus handlers.');
      process.exit(6);
    }
    const newFocus =
      '        onFocus={() => { try { _v173RegLP(_v176OpenMenu); } catch (_) {} handleFocus(); }}\n' +
      '        onBlur={() => { try { _v173RegLP(null); } catch (_) {} setIsFocused(false); }}';
    src = src.replace(focusAnchor, newFocus);
    changes++;

    write(file, src);
    console.log(`[v176e] discover.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176e] DONE.  ${totalChanges} total change(s).`);
console.log('');
console.log('========================================================');
console.log(' IMPORTANT — REBUILD INSTRUCTIONS');
console.log('========================================================');
console.log(' withTVKeyEvents.js is a CONFIG PLUGIN that runs at');
console.log(' prebuild time and modifies MainActivity.kt.  A Metro');
console.log(' reload will NOT pick up the new MENU mapping.');
console.log('');
console.log(' You MUST do a clean native rebuild, for example:');
console.log('   npx expo prebuild --clean -p android');
console.log('   (then your usual gradle build / sideload)');
console.log('');
console.log(' After install, press the Menu button (the ≡ / 3-dots');
console.log(' button on your Firestick or Google TV remote) while a');
console.log(' poster is focused — the long-press menu should pop.');
console.log('========================================================');
