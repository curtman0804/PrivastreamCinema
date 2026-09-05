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
   * Returns the name of the main component registered from JavaScript.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the ReactActivityDelegate.
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(
        this,
        mainComponentName,
        fabricEnabled
      ) {}
    )
  }

  /**
   * Align back behavior with Android.
   */
  override fun invokeDefaultOnBackPressed() {
    if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
      if (!moveTaskToBack(false)) {
        super.invokeDefaultOnBackPressed()
      }
      return
    }

    super.invokeDefaultOnBackPressed()
  }

  /* V176F_OK_LONGPRESS
     A consumed long press must also swallow its trailing KEY_UP so
     the poster does not open Details after the menu appears. */
  private var v176fConsumeOkUp: Boolean = false

  /* V625_DIRECT_NATIVE_LONGPRESS
     Walk upward from the currently focused poster and locate its
     native Privastream row. */
  private fun v625FindNativeRow(
    view: android.view.View?
  ): PrivastreamTVRowView? {
    var node: android.view.View? = view

    while (node != null) {
      if (node is PrivastreamTVRowView) {
        return node
      }

      node = node.parent as? android.view.View
    }

    return null
  }

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {

    /* V626_PLATFORM_GLOBAL_NAV_SOUND
       There is intentionally NO manual AudioManager/playSoundEffect
       navigation sound here. Android TV owns the normal focus sound. */

    android.util.Log.d(
      "PSTV",
      "key action=" + event.action +
        " code=" + event.keyCode +
        " isLong=" + event.isLongPress +
        " repeat=" + event.repeatCount
    )

    val keyCode = event.keyCode

    val isOk =
      keyCode == KeyEvent.KEYCODE_DPAD_CENTER ||
      keyCode == KeyEvent.KEYCODE_ENTER ||
      keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER

    /* =========================================================
       LONG PRESS
       ========================================================= */

    if (
      isOk &&
      event.action == KeyEvent.ACTION_DOWN &&
      !v176fConsumeOkUp &&
      (event.isLongPress || event.repeatCount > 0)
    ) {
      android.util.Log.d(
        "PSTV",
        "OK long-press detected"
      )

      /*
       * V625: native poster rows use the direct, proven native-row
       * route. Runtime already proved this reaches ServiceRow JS.
       */
      try {
        val nativeRow = v625FindNativeRow(currentFocus)

        if (
          nativeRow != null &&
          nativeRow.emitCurrentItemLongPress()
        ) {
          android.util.Log.d(
            "PSTV",
            "V625 native poster long-press dispatched directly"
          )

          v176fConsumeOkUp = true
          return true
        }
      } catch (e: Throwable) {
        android.util.Log.e(
          "PSTV",
          "V625 native long-press dispatch failed",
          e
        )
      }

      /*
       * Non-native cards / other TV surfaces retain the existing
       * generic JS longSelect path.
       */
      android.util.Log.d(
        "PSTV",
        "non-native long-press -> generic longSelect"
      )

      try {
        val reactApp =
          application as? com.facebook.react.ReactApplication

        if (reactApp != null) {
          var ctx:
            com.facebook.react.bridge.ReactContext? = null

          try {
            ctx = reactApp.reactHost?.currentReactContext
          } catch (_: Exception) {}

          if (ctx == null) {
            try {
              ctx =
                reactApp.reactNativeHost
                  ?.reactInstanceManager
                  ?.currentReactContext
            } catch (_: Exception) {}
          }

          if (ctx != null) {
            val params = Arguments.createMap()

            params.putString(
              "eventType",
              "longSelect"
            )

            params.putInt(
              "keyCode",
              event.keyCode
            )

            ctx.getJSModule(
              DeviceEventManagerModule
                .RCTDeviceEventEmitter::class.java
            ).emit(
              "onTVKeyEvent",
              params
            )
          }
        }
      } catch (_: Exception) {}

      v176fConsumeOkUp = true
      return true
    }

    /* =========================================================
       SWALLOW KEY_UP AFTER LONG PRESS
       ========================================================= */

    if (
      isOk &&
      event.action == KeyEvent.ACTION_UP &&
      v176fConsumeOkUp
    ) {
      v176fConsumeOkUp = false

      android.util.Log.d(
        "PSTV",
        "consumed OK KEY_UP after long-press"
      )

      return true
    }

    /* =========================================================
       NORMAL SHORT OK PRESS
       ========================================================= */

    if (
      isOk &&
      event.action == KeyEvent.ACTION_UP
    ) {
      try {
        val reactApp =
          application as? com.facebook.react.ReactApplication

        if (reactApp != null) {
          var ctx:
            com.facebook.react.bridge.ReactContext? = null

          try {
            ctx = reactApp.reactHost?.currentReactContext
          } catch (_: Exception) {}

          if (ctx == null) {
            try {
              ctx =
                reactApp.reactNativeHost
                  ?.reactInstanceManager
                  ?.currentReactContext
            } catch (_: Exception) {}
          }

          if (ctx != null) {
            val params = Arguments.createMap()

            params.putString(
              "eventType",
              "select"
            )

            params.putInt(
              "keyCode",
              event.keyCode
            )

            ctx.getJSModule(
              DeviceEventManagerModule
                .RCTDeviceEventEmitter::class.java
            ).emit(
              "onTVKeyEvent",
              params
            )
          }
        }
      } catch (_: Exception) {}
    }

    /* =========================================================
       EXISTING TV / PLAYER KEY EVENTS
       ========================================================= */

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

        else -> null
      }

      if (eventName != null) {

        var emitted = false

        try {
          val reactApp =
            application as? com.facebook.react.ReactApplication

          if (reactApp != null) {
            var ctx:
              com.facebook.react.bridge.ReactContext? = null

            try {
              ctx =
                reactApp.reactHost?.currentReactContext
            } catch (_: Exception) {}

            if (ctx == null) {
              try {
                ctx =
                  reactApp.reactNativeHost
                    ?.reactInstanceManager
                    ?.currentReactContext
              } catch (_: Exception) {}
            }

            if (ctx != null) {
              val params = Arguments.createMap()

              params.putString(
                "eventType",
                eventName
              )

              params.putInt(
                "keyCode",
                event.keyCode
              )

              ctx.getJSModule(
                DeviceEventManagerModule
                  .RCTDeviceEventEmitter::class.java
              ).emit(
                "onTVKeyEvent",
                params
              )

              emitted = true
            }
          }
        } catch (_: Exception) {}

        val isMediaKey =
          eventName == "playPause" ||
          eventName == "play" ||
          eventName == "pause" ||
          eventName == "rewind" ||
          eventName == "fastForward"

        if (isMediaKey && emitted) {
          return true
        }
      }
    }

    return super.dispatchKeyEvent(event)
  }
}