package com.privastream.cinema
import expo.modules.splashscreen.SplashScreenManager
import com.reactnative.googlecast.api.RNGCCastContext

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
// @generated begin react-native-google-cast-onCreate - expo prebuild (DO NOT MODIFY) sync-489050f2bf9933a98bbd9d93137016ae14c22faa
    RNGCCastContext.getSharedInstance(this)
// @generated end react-native-google-cast-onCreate
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

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
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
        KeyEvent.KEYCODE_DPAD_CENTER -> "select"
        KeyEvent.KEYCODE_ENTER -> "select"
        else -> null
      }
      
      if (eventName != null) {
        var emitted = false
        try {
          val reactApp = application as? com.facebook.react.ReactApplication
          if (reactApp != null) {
            // Try NEW architecture path first (RN 0.81+)
            var ctx: com.facebook.react.bridge.ReactContext? = null
            try {
              ctx = reactApp.reactHost?.currentReactContext
            } catch (e: Exception) { /* not available */ }
            
            // Fallback to OLD architecture path
            if (ctx == null) {
              try {
                ctx = reactApp.reactNativeHost?.reactInstanceManager?.currentReactContext
              } catch (e: Exception) { /* not available */ }
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
        } catch (e: Exception) {
          // Ignore - React context not ready
        }
        
        // CRITICAL: For media keys, CONSUME the event to prevent Android from
        // handling it via MediaSession/ExoPlayer directly (which bypasses our JS controls)
        val isMediaKey = eventName == "playPause" || eventName == "play" || 
                         eventName == "pause" || eventName == "rewind" || 
                         eventName == "fastForward"
        if (isMediaKey && emitted) {
          return true  // Consume the event - we handled it in JS
        }
      }
    }
    return super.dispatchKeyEvent(event)
  }

}