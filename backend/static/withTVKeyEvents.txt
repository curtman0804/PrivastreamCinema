const { withMainActivity } = require("expo/config-plugins");

/**
 * Expo config plugin that adds key event interception to MainActivity.
 * This captures Fire Stick / Android TV remote button presses (play/pause, rewind, fast forward)
 * and forwards them to React Native via DeviceEventEmitter.
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
    
    // Add ReactContext and event emitter imports
    if (!modified.includes("import com.facebook.react.bridge.WritableNativeMap")) {
      modified = modified.replace(
        "import android.os.Bundle",
        "import android.os.Bundle\nimport com.facebook.react.bridge.WritableNativeMap\nimport com.facebook.react.modules.core.DeviceEventManagerModule"
      );
    }
    
    // Add dispatchKeyEvent override before the closing brace of the class
    if (!modified.includes("dispatchKeyEvent")) {
      const dispatchKeyEventCode = `
  override fun dispatchKeyEvent(event: KeyEvent?): Boolean {
    if (event != null && event.action == KeyEvent.ACTION_DOWN) {
      val keyCode = event.keyCode
      val eventName = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "playPause"
        KeyEvent.KEYCODE_MEDIA_PLAY -> "play"
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "pause"
        KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "fastForward"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_CENTER -> "select"
        KeyEvent.KEYCODE_ENTER -> "select"
        else -> null
      }
      
      if (eventName != null) {
        try {
          // Try new architecture (ReactHost) first, then fall back to legacy
          val reactContext = try {
            reactHost?.currentReactContext
          } catch (e: Exception) {
            try {
              reactInstanceManager?.currentReactContext
            } catch (e2: Exception) {
              null
            }
          }
          
          if (reactContext != null) {
            val params = WritableNativeMap()
            params.putString("eventType", eventName)
            params.putInt("keyCode", keyCode)
            reactContext
              .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onTVKeyEvent", params)
          }
        } catch (e: Exception) {
          // Silently ignore if React context is not ready
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }
`;
      // Insert before the last closing brace of the class
      const lastBrace = modified.lastIndexOf("}");
      modified = modified.substring(0, lastBrace) + dispatchKeyEventCode + "\n}";
    }
    
    config.modResults.contents = modified;
    return config;
  });
};

module.exports = withTVKeyEvents;
