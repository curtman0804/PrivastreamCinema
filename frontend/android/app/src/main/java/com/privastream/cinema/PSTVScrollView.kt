package com.privastream.cinema

import android.content.Context
import android.graphics.Rect
import android.util.Log
import com.facebook.react.views.scroll.ReactScrollView

/**
 * V540_PSTV_SCROLL - ReactScrollView that never auto-scrolls to reveal a newly
 * focused child. Returning 0 removes Android's competing "just-visible" scroll
 * on Fire TV so Discover's JS title-to-top anchor is the ONLY scroll = one
 * smooth move per D-pad press. Programmatic scrollTo(x, y) is unaffected.
 */
class PSTVScrollView(context: Context) : ReactScrollView(context) {
  init {
    Log.d("PSTV", "PSTVScrollView created - native focus auto-scroll suppressed (V540)")
  }

  override fun computeScrollDeltaToGetChildRectOnScreen(rect: Rect?): Int = 0
}
