/* V176F_OK_LONGPRESS — native OK long-press detection via
   event.isLongPress, plus PSTV logcat tag.  Requires:
       npx expo prebuild --clean -p android
   to regenerate MainActivity.kt from this plugin. */
const { withMainActivity } = require("expo/config-plugins");

/**
 * Expo config plugin that adds key event interception to MainActivity.
 * Captures Fire Stick / Android TV remote button presses and forwards to React Native.
 * 
 * CRITICAL CHANGES for RN 0.81 / Expo 54:
 * - Tries BOTH new arch (reactHost) and old arch (reactNativeHost) paths
 * - CONSUMES media key events (play/pause, ff, rw) so Android doesn't steal them
 * - Adds KEYCODE_SPACE for Bluetooth keyboards
 */
const withTVKeyEvents = (config) => {
  return withMainActivity(config, (config) => {
    const contents = config.modResults.contents;
    
    let modified = contents;
    
    // Add KeyEvent import
    if (!modified.includes("import android.view.KeyEvent")) {
      modified = modified.replace(
        "import android.os.Bundle",
        "import android.os.Bundle\nimport android.view.KeyEvent"
      );
    }
    
    // Add event emitter imports
    if (!modified.includes("import com.facebook.react.bridge.Arguments")) {
      modified = modified.replace(
        "import android.os.Bundle",
        "import android.os.Bundle\nimport com.facebook.react.bridge.Arguments\nimport com.facebook.react.modules.core.DeviceEventManagerModule"
      );
    }
    
    // Add dispatchKeyEvent override before the closing brace of the class
    if (!modified.includes("dispatchKeyEvent")) {
      const dispatchKeyEventCode = `
  /* V176F_OK_LONGPRESS — track whether the most-recent OK long-press
     consumed itself so we can also swallow the trailing KEY_UP and
     stop Pressable.onPress from firing after the menu opens. */
  private var v176fConsumeOkUp: Boolean = false

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    /* V176F diagnostic — see in logcat with: adb logcat -d -t 500 PSTV:V *:S */
    android.util.Log.d("PSTV", "key action=" + event.action + " code=" + event.keyCode + " isLong=" + event.isLongPress + " repeat=" + event.repeatCount)

    val keyCode = event.keyCode
    val isOk = keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER || keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER

    /* OK long-press: fire longSelect AND consume the next KEY_UP. */
    if (isOk && event.action == KeyEvent.ACTION_DOWN && event.isLongPress) {
      android.util.Log.d("PSTV", "OK long-press detected -> emitting longSelect")
      try {
        val reactApp = application as? com.facebook.react.ReactApplication
        if (reactApp != null) {
          var ctx: com.facebook.react.bridge.ReactContext? = null
          try { ctx = reactApp.reactHost?.currentReactContext } catch (e: Exception) {}
          if (ctx == null) {
            try { ctx = reactApp.reactNativeHost?.reactInstanceManager?.currentReactContext } catch (e: Exception) {}
          }
          if (ctx != null) {
            val params = Arguments.createMap()
            params.putString("eventType", "longSelect")
            params.putInt("keyCode", event.keyCode)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onTVKeyEvent", params)
          }
        }
      } catch (e: Exception) {}
      v176fConsumeOkUp = true
      return true
    }

    /* Suppress the KEY_UP that pairs with a consumed long-press so the
       focused Pressable doesn't also fire onPress and navigate away. */
    if (isOk && event.action == KeyEvent.ACTION_UP && v176fConsumeOkUp) {
      v176fConsumeOkUp = false
      android.util.Log.d("PSTV", "consumed OK KEY_UP after long-press")
      return true
    }

    if (event.action == KeyEvent.ACTION_DOWN) {
      val eventName = when (event.keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playPause"
        KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
        KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "fastForward"
        KeyEvent.KEYCODE_SPACE -> "playPause"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_MENU -> "longSelect"
        KeyEvent.KEYCODE_DPAD_CENTER -> "select"
        KeyEvent.KEYCODE_ENTER -> "select"
        else -> null
      }

      if (eventName != null) {
        var emitted = false
        try {
          val reactApp = application as? com.facebook.react.ReactApplication
          if (reactApp != null) {
            var ctx: com.facebook.react.bridge.ReactContext? = null
            try { ctx = reactApp.reactHost?.currentReactContext } catch (e: Exception) {}
            if (ctx == null) {
              try { ctx = reactApp.reactNativeHost?.reactInstanceManager?.currentReactContext } catch (e: Exception) {}
            }
            if (ctx != null) {
              val params = Arguments.createMap()
              params.putString("eventType", eventName)
              params.putInt("keyCode", event.keyCode)
              ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("onTVKeyEvent", params)
              emitted = true
            }
          }
        } catch (e: Exception) {}

        val isMediaKey = eventName == "playPause" || eventName == "play" ||
                         eventName == "pause" || eventName == "rewind" ||
                         eventName == "fastForward"
        if (isMediaKey && emitted) {
          return true
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;
      const lastBrace = modified.lastIndexOf("}");
      modified = modified.substring(0, lastBrace) + dispatchKeyEventCode + "\n}";
    }
    
    config.modResults.contents = modified;
    return config;
  });
};

module.exports = withTVKeyEvents;
