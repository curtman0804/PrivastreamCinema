package com.privastream.cinema

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PrivastreamLiveTVGuideManager :
    SimpleViewManager<PrivastreamLiveTVGuideView>() {

    override fun getName(): String =
        REACT_CLASS

    override fun createViewInstance(
        context: ThemedReactContext
    ): PrivastreamLiveTVGuideView =
        PrivastreamLiveTVGuideView(context)

    @ReactProp(name = "items")
    fun setItems(
        view: PrivastreamLiveTVGuideView,
        items: ReadableArray?
    ) {
        view.setItems(items)
    }

    @ReactProp(
        name = "rowHeight",
        defaultFloat = 52f
    )
    fun setRowHeight(
        view: PrivastreamLiveTVGuideView,
        value: Float
    ) {
        view.setRowHeight(value)
    }

    @ReactProp(
        name = "channelWidth",
        defaultFloat = 340f
    )
    fun setChannelWidth(
        view: PrivastreamLiveTVGuideView,
        value: Float
    ) {
        view.setChannelWidth(value)
    }

    @ReactProp(
        name = "slotWidth",
        defaultFloat = 210f
    )
    fun setSlotWidth(
        view: PrivastreamLiveTVGuideView,
        value: Float
    ) {
        view.setSlotWidth(value)
    }

    @ReactProp(
        name = "slotCount",
        defaultInt = 16
    )
    fun setSlotCount(
        view: PrivastreamLiveTVGuideView,
        value: Int
    ) {
        view.setSlotCount(value)
    }

    @ReactProp(
        name = "slotMs",
        defaultDouble = 1800000.0
    )
    fun setSlotMs(
        view: PrivastreamLiveTVGuideView,
        value: Double
    ) {
        view.setSlotMs(value)
    }

    @ReactProp(
        name = "timelineStartMs",
        defaultDouble = 0.0
    )
    fun setTimelineStartMs(
        view: PrivastreamLiveTVGuideView,
        value: Double
    ) {
        view.setTimelineStartMs(value)
    }

    @ReactProp(
        name = "nowMs",
        defaultDouble = 0.0
    )
    fun setNowMs(
        view: PrivastreamLiveTVGuideView,
        value: Double
    ) {
        view.setNowMs(value)
    }

    @ReactProp(
        name = "preferredFocusIndex",
        defaultInt = 0
    )
    fun setPreferredFocusIndex(
        view: PrivastreamLiveTVGuideView,
        value: Int
    ) {
        view.setPreferredFocusIndex(value)
    }

    // V788T8V_RETURN_FOCUS_HANDSHAKE
    @ReactProp(name = "focusRestoreRequest")
    fun setFocusRestoreRequest(
        view: PrivastreamLiveTVGuideView,
        value: String?
    ) {
        view.requestFocusRestore(value)
    }

    override fun
        getExportedCustomDirectEventTypeConstants():
        MutableMap<String, Any> {

        val out =
            mutableMapOf<String, Any>()

        out["topItemFocus"] =
            MapBuilder.of(
                "registrationName",
                "onItemFocus"
            )

        out["topItemPress"] =
            MapBuilder.of(
                "registrationName",
                "onItemPress"
            )

        out["topHorizontalScroll"] =
            MapBuilder.of(
                "registrationName",
                "onHorizontalScroll"
            )

        return out
    }

    companion object {
        const val REACT_CLASS =
            "PrivastreamLiveTVGuide"
    }
}