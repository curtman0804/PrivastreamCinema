package com.privastream.cinema
import android.os.SystemClock
import android.media.AudioManager
import android.content.Context

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

  // V643B_SINGLE_SOUND_OWNER
  // Exactly one audio emitter for TV navigation/click effects.
  private var v643bAudioManager: AudioManager? = null
  private var v643bTvEnabled: Boolean = false
  private var v643bPendingNavEffect: Int? = null
  private var v643bPendingNavAt: Long = 0L

  private fun v643bMuteTree(view: android.view.View?) {
    if (view == null) return

    try {
      view.setSoundEffectsEnabled(false)
    } catch (_: Throwable) {}

    if (view is android.view.ViewGroup) {
      for (i in 0 until view.childCount) {
        v643bMuteTree(view.getChildAt(i))
      }
    }
  }

  private fun v643bEffectForKey(keyCode: Int): Int? =
    when (keyCode) {
      KeyEvent.KEYCODE_DPAD_LEFT ->
        AudioManager.FX_FOCUS_NAVIGATION_LEFT

      KeyEvent.KEYCODE_DPAD_RIGHT ->
        AudioManager.FX_FOCUS_NAVIGATION_RIGHT

      KeyEvent.KEYCODE_DPAD_UP ->
        AudioManager.FX_FOCUS_NAVIGATION_UP

      KeyEvent.KEYCODE_DPAD_DOWN ->
        AudioManager.FX_FOCUS_NAVIGATION_DOWN

      else -> null
    }

  private fun v643bClearPendingNav() {
    v643bPendingNavEffect = null
    v643bPendingNavAt = 0L
  }

  private fun v643bArmGlobalNavigation(keyCode: Int) {
    val effect = v643bEffectForKey(keyCode) ?: return
    val stamp = SystemClock.uptimeMillis()

    v643bPendingNavEffect = effect
    v643bPendingNavAt = stamp

    try {
      window.decorView.postDelayed({
        if (v643bPendingNavAt == stamp) {
          v643bClearPendingNav()
        }
      }, 450L)
    } catch (_: Throwable) {}
  }

  private fun v643bConfirmGlobalNavigation() {
    if (!v643bTvEnabled) return

    // V644_PLATFORM_OWNS_STANDARD_NAV_SOUND
    // Standard React/Android focus surfaces already emit
    // the device navigation sound. Do not add AudioManager
    // sound here or CW/tray/Details focus moves double-fire.
    v643bClearPendingNav()

    android.util.Log.d(
      "PSTVSOUND",
      "V644 PLATFORM NAV ONLY"
    )
  }

  fun v643bNativeHorizontalMove(direction: Int) {
    if (!v643bTvEnabled) return
    if (direction == 0) return

    // Native TV rows report only AFTER a real successful L/R focus move.
    // Clear any stale global request so only this one sound can fire.
    v643bClearPendingNav()

    val effect =
      if (direction < 0)
        AudioManager.FX_FOCUS_NAVIGATION_LEFT
      else
        AudioManager.FX_FOCUS_NAVIGATION_RIGHT

    try {
      v643bAudioManager?.playSoundEffect(effect)

      android.util.Log.d(
        "PSTVSOUND",
        "V643B NATIVE HORIZONTAL direction=" + direction
      )
    } catch (_: Throwable) {}
  }

  private fun v643bPlayClick() {
    if (!v643bTvEnabled) return

    v643bClearPendingNav()

    try {
      v643bAudioManager?.playSoundEffect(
        AudioManager.FX_KEY_CLICK
      )

      android.util.Log.d(
        "PSTVSOUND",
        "V643B CLICK"
      )
    } catch (_: Throwable) {}
  }



  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);

    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen

    super.onCreate(null)

    // V643B_SINGLE_SOUND_OWNER
    v643bTvEnabled =
      (
        resources.configuration.uiMode and
          android.content.res.Configuration.UI_MODE_TYPE_MASK
      ) ==
        android.content.res.Configuration.UI_MODE_TYPE_TELEVISION

    if (v643bTvEnabled) {
      try {
        v643bAudioManager =
          getSystemService(Context.AUDIO_SERVICE) as? AudioManager

        // Disable framework/View sound effects now.
        v643bMuteTree(window.decorView)

        window.decorView.viewTreeObserver
          .addOnGlobalFocusChangeListener { oldFocus, newFocus ->

            // Keep both sides muted as focus moves.
            v643bMuteTree(oldFocus)
            v643bMuteTree(newFocus)

            if (
              oldFocus !== newFocus &&
              newFocus != null
            ) {
              // Non-native controls: one real focus transition consumes
              // one pending D-pad direction.
              v643bConfirmGlobalNavigation()
            }
          }
      } catch (t: Throwable) {
        android.util.Log.e(
          "PSTVSOUND",
          "V643B setup failed",
          t
        )
      }
    }

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


    // V643B_SINGLE_SOUND_OWNER
    if (
      v643bTvEnabled &&
      event.action == KeyEvent.ACTION_DOWN
    ) {
      val navEffect = v643bEffectForKey(keyCode)

      if (navEffect != null) {
        // Suppress all currently-mounted View/RN auto focus effects
        // BEFORE Android performs the actual focus move.
        v643bMuteTree(window.decorView)

        val nativeHorizontal =
          (
            keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
            keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
          ) &&
          v625FindNativeRow(currentFocus) != null

        if (nativeHorizontal) {
          // Native row confirms successful movement itself.
          v643bClearPendingNav()
        } else {
          v643bArmGlobalNavigation(keyCode)
        }
      } else if (
        isOk ||
        keyCode == KeyEvent.KEYCODE_BACK
      ) {
        // Suppress automatic View click effects before selection/back.
        v643bMuteTree(window.decorView)
        v643bClearPendingNav()
      }
    }

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
      // V643B_SINGLE_SOUND_OWNER
      if (v643bTvEnabled) {
        v643bMuteTree(window.decorView)
        v643bPlayClick()
      }

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

    // V646_APP_OWNED_VERTICAL_NAV_SOUND
    //
    // UP/DOWN ONLY.
    //
    // If focus changes DURING super.dispatchKeyEvent(), the focused
    // Android/RN view hierarchy owned the move. ViewRootImpl therefore
    // does not get its normal fallback opportunity to provide the TV
    // navigation sound.
    //
    // Emit exactly one manual vertical sound only when:
    //   1. this is an UP/DOWN ACTION_DOWN,
    //   2. super handled the event,
    //   3. actual Activity focus changed.
    //
    // Platform-owned moves are untouched.
    // Blocked moves are silent.
    // Native poster LEFT/RIGHT remains owned by V643B.
    val v646BeforeFocus = currentFocus

    val v646Handled = super.dispatchKeyEvent(event)

    val v646AfterFocus = currentFocus

    // V647_EPISODE_STREAM_HORIZONTAL_SOUND
    //
    // LEFT/RIGHT ONLY.
    //
    // Targets ONLY:
    //   EpisodeCard -> EpisodeCard
    //   StreamCard  -> StreamCard
    //
    // V646 vertical navigation sound is untouched.
    // Native poster V643B horizontal sound is untouched.
    // Details controls are untouched.
    // Focus/navigation behavior is untouched.
    val v647Horizontal =
      event.action == KeyEvent.ACTION_DOWN &&
      (
        keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
        keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
      )

    if (
      v643bTvEnabled &&
      v647Horizontal
    ) {
      val v647ChangedInsideDispatch =
        v646BeforeFocus !== v646AfterFocus

      fun v647FindCardTag(
        start: android.view.View?
      ): String? {
        var node = start

        while (node != null) {
          val tag =
            try {
              node.tag as? String
            } catch (_: Throwable) {
              null
            }

          if (
            tag == "V647_EPISODE_CARD" ||
            tag == "V647_STREAM_CARD"
          ) {
            return tag
          }

          node =
            try {
              node.parent as? android.view.View
            } catch (_: Throwable) {
              null
            }
        }

        return null
      }

      val v647BeforeTag =
        v647FindCardTag(v646BeforeFocus)

      val v647AfterTag =
        v647FindCardTag(v646AfterFocus)

      val v647EpisodeMove =
        v647BeforeTag == "V647_EPISODE_CARD" &&
        v647AfterTag == "V647_EPISODE_CARD"

      val v647StreamMove =
        v647BeforeTag == "V647_STREAM_CARD" &&
        v647AfterTag == "V647_STREAM_CARD"

      if (
        v646Handled &&
        v647ChangedInsideDispatch &&
        (
          v647EpisodeMove ||
          v647StreamMove
        )
      ) {
        val v647Effect =
          v643bEffectForKey(keyCode)

        if (v647Effect != null) {
          try {
            v643bAudioManager?.playSoundEffect(v647Effect)
          } catch (_: Throwable) {}

          android.util.Log.d(
            "PSTVSOUND",
            "V647 CARD HORIZONTAL" +
              " type=" +
              (
                if (v647EpisodeMove)
                  "episode"
                else
                  "stream"
              ) +
              " key=" + keyCode
          )
        }
      }
    }
    val v646Vertical =
      event.action == KeyEvent.ACTION_DOWN &&
      (
        keyCode == KeyEvent.KEYCODE_DPAD_UP ||
        keyCode == KeyEvent.KEYCODE_DPAD_DOWN
      )

    if (
      v643bTvEnabled &&
      v646Vertical
    ) {
      val v646ChangedInsideDispatch =
        v646BeforeFocus !== v646AfterFocus

      if (
        v646Handled &&
        v646ChangedInsideDispatch
      ) {
        val v646Effect = v643bEffectForKey(keyCode)

        if (v646Effect != null) {
          try {
            v643bAudioManager?.playSoundEffect(v646Effect)
          } catch (_: Throwable) {}

          android.util.Log.d(
            "PSTVSOUND",
            "V646 APP VERTICAL" +
              " key=" + keyCode +
              " handled=" + v646Handled +
              " before=" +
                (v646BeforeFocus?.javaClass?.simpleName ?: "null") +
              "#" + (v646BeforeFocus?.id ?: -1) +
              " after=" +
                (v646AfterFocus?.javaClass?.simpleName ?: "null") +
              "#" + (v646AfterFocus?.id ?: -1)
          )
        }
      } else {
        android.util.Log.d(
          "PSTVSOUNDOWN",
          "V646 VERTICAL NO MANUAL SOUND" +
            " key=" + keyCode +
            " handled=" + v646Handled +
            " changedInsideDispatch=" + v646ChangedInsideDispatch
        )
      }
    }

    return v646Handled
  }
}