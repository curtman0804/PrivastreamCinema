package com.privastream.cinema
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle
import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.view.KeyEvent

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }

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

}