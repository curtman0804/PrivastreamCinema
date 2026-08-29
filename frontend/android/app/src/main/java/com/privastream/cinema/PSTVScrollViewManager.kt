package com.privastream.cinema

import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager

/**
 * V540_PSTV_SCROLL - reuses every prop/command/event of the core vertical
 * ScrollView manager, but hands back a PSTVScrollView instance. Exposed to JS
 * under the name "PSTVScrollView".
 */
class PSTVScrollViewManager : ReactScrollViewManager() {
  override fun getName(): String = REACT_CLASS

  override fun createViewInstance(context: ThemedReactContext): ReactScrollView =
      PSTVScrollView(context)

  companion object {
    const val REACT_CLASS: String = "PSTVScrollView"
  }
}
