/*
 * apply_patches_v176f_ok_longpress_native.js
 *
 * V176F — Native OK long-press via event.isLongPress() + diagnostic logs.
 *
 *   Why this works:
 *     Android's KeyEvent.isLongPress() returns true on the repeat KEY_DOWN
 *     that fires after the system long-press threshold (~500ms held).
 *     This is the OS-native, hardware-agnostic way to detect long-press
 *     on the OK button without needing a physical Menu button.
 *
 *   What the patched plugin does:
 *     • On OK button held ~500ms → emit 'longSelect' to JS
 *     • Consume the corresponding KEY_UP so Pressable.onPress does NOT
 *       also fire after the long-press (otherwise the poster would
 *       navigate immediately after the menu opens)
 *     • Keeps KEYCODE_MENU → 'longSelect' as a secondary trigger
 *     • Adds Log.d("PSTV", ...) lines visible in:
 *           adb logcat -d -t 500 PSTV:V ReactNativeJS:V *:S
 *
 *   Also adds JS-side diagnostic logs in ContentCard.tsx's v173 listener
 *   so we can confirm events arrive on the JS side.
 *
 *   FILES CHANGED:
 *     • plugins/withTVKeyEvents.js     (REQUIRES expo prebuild --clean -p android)
 *     • src/components/ContentCard.tsx (JS-only, picks up on Metro reload)
 *
 *   Idempotent.  CRLF preserved.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v176f_ok_longpress_native.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const PLUGIN_PATH = path.join(ROOT, 'plugins', 'withTVKeyEvents.js');
const CC_PATH     = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v176f] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v176f] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

let totalChanges = 0;

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 1 — plugins/withTVKeyEvents.js  (OK long-press via isLongPress + logs)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = PLUGIN_PATH;
  let src = read(file);

  if (src.indexOf('V176F_OK_LONGPRESS') !== -1) {
    console.log('[v176f] withTVKeyEvents.js: already patched, skipping');
  } else {
    let changes = 0;

    // We're going to REPLACE the entire dispatchKeyEventCode template string
    // with a new version that adds:
    //   - Log.d diagnostics
    //   - Long-press detection on OK button via event.isLongPress
    //   - Consume the trailing KEY_UP to suppress the regular onPress
    //
    // The current template starts after `const dispatchKeyEventCode = ` and
    // ends at the matching backtick.  Match the whole block including the
    // backticks so we preserve the trailing `;`.
    const oldTemplateStart = "const dispatchKeyEventCode = `";
    const oldTemplateEndMarker = "    return super.dispatchKeyEvent(event)\n  }\n`;";
    const startIdx = src.indexOf(oldTemplateStart);
    const endIdx   = src.indexOf(oldTemplateEndMarker);
    if (startIdx === -1 || endIdx === -1) {
      console.error('[v176f] FATAL: withTVKeyEvents.js — could not locate dispatchKeyEventCode template bounds.');
      process.exit(2);
    }
    const fullOldTemplate = src.substring(startIdx, endIdx + oldTemplateEndMarker.length);

    // Build the new template.  Note we keep all the existing select / media
    // key behavior so nothing else regresses.
    const newTemplate = "const dispatchKeyEventCode = `\n" +
"  /* V176F_OK_LONGPRESS — track whether the most-recent OK long-press\n" +
"     consumed itself so we can also swallow the trailing KEY_UP and\n" +
"     stop Pressable.onPress from firing after the menu opens. */\n" +
"  private var v176fConsumeOkUp: Boolean = false\n" +
"\n" +
"  override fun dispatchKeyEvent(event: KeyEvent): Boolean {\n" +
"    /* V176F diagnostic — see in logcat with: adb logcat -d -t 500 PSTV:V *:S */\n" +
"    android.util.Log.d(\"PSTV\", \"key action=\" + event.action + \" code=\" + event.keyCode + \" isLong=\" + event.isLongPress + \" repeat=\" + event.repeatCount)\n" +
"\n" +
"    val keyCode = event.keyCode\n" +
"    val isOk = keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER\n" +
"\n" +
"    /* OK long-press: fire longSelect AND consume the next KEY_UP. */\n" +
"    if (isOk && event.action == KeyEvent.ACTION_DOWN && event.isLongPress) {\n" +
"      android.util.Log.d(\"PSTV\", \"OK long-press detected -> emitting longSelect\")\n" +
"      try {\n" +
"        val reactApp = application as? com.facebook.react.ReactApplication\n" +
"        if (reactApp != null) {\n" +
"          var ctx: com.facebook.react.bridge.ReactContext? = null\n" +
"          try { ctx = reactApp.reactHost?.currentReactContext } catch (e: Exception) {}\n" +
"          if (ctx == null) {\n" +
"            try { ctx = reactApp.reactNativeHost?.reactInstanceManager?.currentReactContext } catch (e: Exception) {}\n" +
"          }\n" +
"          if (ctx != null) {\n" +
"            val params = Arguments.createMap()\n" +
"            params.putString(\"eventType\", \"longSelect\")\n" +
"            params.putInt(\"keyCode\", event.keyCode)\n" +
"            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
"              .emit(\"onTVKeyEvent\", params)\n" +
"          }\n" +
"        }\n" +
"      } catch (e: Exception) {}\n" +
"      v176fConsumeOkUp = true\n" +
"      return true\n" +
"    }\n" +
"\n" +
"    /* Suppress the KEY_UP that pairs with a consumed long-press so the\n" +
"       focused Pressable doesn't also fire onPress and navigate away. */\n" +
"    if (isOk && event.action == KeyEvent.ACTION_UP && v176fConsumeOkUp) {\n" +
"      v176fConsumeOkUp = false\n" +
"      android.util.Log.d(\"PSTV\", \"consumed OK KEY_UP after long-press\")\n" +
"      return true\n" +
"    }\n" +
"\n" +
"    if (event.action == KeyEvent.ACTION_DOWN) {\n" +
"      val eventName = when (event.keyCode) {\n" +
"        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> \"playPause\"\n" +
"        KeyEvent.KEYCODE_MEDIA_PLAY -> \"play\"\n" +
"        KeyEvent.KEYCODE_MEDIA_PAUSE -> \"pause\"\n" +
"        KeyEvent.KEYCODE_MEDIA_REWIND -> \"rewind\"\n" +
"        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> \"fastForward\"\n" +
"        KeyEvent.KEYCODE_SPACE -> \"playPause\"\n" +
"        KeyEvent.KEYCODE_DPAD_LEFT -> \"left\"\n" +
"        KeyEvent.KEYCODE_DPAD_RIGHT -> \"right\"\n" +
"        KeyEvent.KEYCODE_DPAD_UP -> \"up\"\n" +
"        KeyEvent.KEYCODE_DPAD_DOWN -> \"down\"\n" +
"        KeyEvent.KEYCODE_MENU -> \"longSelect\"\n" +
"        KeyEvent.KEYCODE_DPAD_CENTER -> \"select\"\n" +
"        KeyEvent.KEYCODE_ENTER -> \"select\"\n" +
"        else -> null\n" +
"      }\n" +
"\n" +
"      if (eventName != null) {\n" +
"        var emitted = false\n" +
"        try {\n" +
"          val reactApp = application as? com.facebook.react.ReactApplication\n" +
"          if (reactApp != null) {\n" +
"            var ctx: com.facebook.react.bridge.ReactContext? = null\n" +
"            try { ctx = reactApp.reactHost?.currentReactContext } catch (e: Exception) {}\n" +
"            if (ctx == null) {\n" +
"              try { ctx = reactApp.reactNativeHost?.reactInstanceManager?.currentReactContext } catch (e: Exception) {}\n" +
"            }\n" +
"            if (ctx != null) {\n" +
"              val params = Arguments.createMap()\n" +
"              params.putString(\"eventType\", eventName)\n" +
"              params.putInt(\"keyCode\", event.keyCode)\n" +
"              ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)\n" +
"                .emit(\"onTVKeyEvent\", params)\n" +
"              emitted = true\n" +
"            }\n" +
"          }\n" +
"        } catch (e: Exception) {}\n" +
"\n" +
"        val isMediaKey = eventName == \"playPause\" || eventName == \"play\" ||\n" +
"                         eventName == \"pause\" || eventName == \"rewind\" ||\n" +
"                         eventName == \"fastForward\"\n" +
"        if (isMediaKey && emitted) {\n" +
"          return true\n" +
"        }\n" +
"      }\n" +
"    }\n" +
"    return super.dispatchKeyEvent(event)\n" +
"  }\n`;";

    src = src.substring(0, startIdx) + newTemplate + src.substring(endIdx + oldTemplateEndMarker.length);

    // Add a V176F marker comment at top so idempotency check passes.
    src = src.replace(
      "const { withMainActivity } = require(\"expo/config-plugins\");",
      "/* V176F_OK_LONGPRESS — native OK long-press detection via\n" +
      "   event.isLongPress, plus PSTV logcat tag.  Requires:\n" +
      "       npx expo prebuild --clean -p android\n" +
      "   to regenerate MainActivity.kt from this plugin. */\n" +
      "const { withMainActivity } = require(\"expo/config-plugins\");"
    );

    changes++;
    write(file, src);
    console.log(`[v176f] withTVKeyEvents.js: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  FILE 2 — src/components/ContentCard.tsx  (JS-side diagnostic logs)
// ═════════════════════════════════════════════════════════════════════════════
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V176F_TV_DIAG') !== -1) {
    console.log('[v176f] ContentCard.tsx: already patched, skipping');
  } else {
    let changes = 0;

    // Replace the entire v173 listener body with one that logs everything.
    const oldListener =
      "  DeviceEventEmitter.addListener('onTVKeyEvent', (evt: any) => {\n" +
      "    if (evt && evt.eventType === 'longSelect' && _v173FocusedLP) {\n" +
      "      try { _v173FocusedLP(); } catch (_) {}\n" +
      "    }\n" +
      "  });";
    if (src.indexOf(oldListener) === -1) {
      console.error('[v176f] FATAL: ContentCard.tsx — could not locate v173 onTVKeyEvent listener.');
      process.exit(3);
    }
    const newListener =
      "  /* V176F_TV_DIAG — diagnostic logs so we can SEE in logcat which TV\n" +
      "     key events arrive on the JS side.  Filter with:\n" +
      "         adb logcat -d -t 500 ReactNativeJS:V *:S | findstr V176F */\n" +
      "  DeviceEventEmitter.addListener('onTVKeyEvent', (evt: any) => {\n" +
      "    try { console.log('[V176F] TV event:', JSON.stringify(evt), 'hasFocusedLP=', !!_v173FocusedLP); } catch (_) {}\n" +
      "    if (evt && evt.eventType === 'longSelect') {\n" +
      "      if (_v173FocusedLP) {\n" +
      "        console.log('[V176F] longSelect -> dispatching to focused card');\n" +
      "        try { _v173FocusedLP(); } catch (e) { console.log('[V176F] dispatch error:', e); }\n" +
      "      } else {\n" +
      "        console.log('[V176F] longSelect ignored — no focused card registered');\n" +
      "      }\n" +
      "    }\n" +
      "  });";
    src = src.replace(oldListener, newListener);
    changes++;

    write(file, src);
    console.log(`[v176f] ContentCard.tsx: ${changes} change(s) applied`);
    totalChanges += changes;
  }
}

console.log('');
console.log(`[v176f] DONE.  ${totalChanges} total change(s).`);
console.log('');
console.log('========================================================');
console.log(' REBUILD INSTRUCTIONS (CRITICAL)');
console.log('========================================================');
console.log(' The plugin change requires a CLEAN native rebuild — a');
console.log(' Metro reload will NOT pick it up because the Kotlin');
console.log(' code is baked into MainActivity.kt at prebuild time.');
console.log('');
console.log('   npx expo prebuild --clean -p android');
console.log('   (then your usual gradle build / sideload)');
console.log('');
console.log(' AFTER REBUILD — capture logs and send back:');
console.log('   1. Long-press OK on a focused poster (hold ~1 second)');
console.log('   2. From cmd: adb logcat -d -t 500 PSTV:V ReactNativeJS:V *:S > tv2.txt');
console.log('   3. curl -X POST -F "file=@tv2.txt" https://git-update-staging.preview.emergentagent.com/api/upload_user_file');
console.log('========================================================');
