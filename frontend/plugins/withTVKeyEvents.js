const { withMainActivity } = require("expo/config-plugins");

/**
 * Expo config plugin that adds key event interception to MainActivity.
 * Captures Fire Stick / Android TV remote button presses and forwards to React Native.
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
  override fun dispatchKeyEvent(event: KeyEvent?): Boolean {
    if (event != null && event.action == KeyEvent.ACTION_DOWN) {
      val eventName = when (event.keyCode) {
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
          val reactApp = application as? com.facebook.react.ReactApplication
          val ctx = reactApp?.reactHost?.currentReactContext
          if (ctx != null) {
            val params = Arguments.createMap()
            params.putString("eventType", eventName)
            params.putInt("keyCode", event.keyCode)
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("onTVKeyEvent", params)
          }
        } catch (e: Exception) {
          // Ignore - React context not ready
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
