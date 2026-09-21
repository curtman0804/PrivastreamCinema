package com.privastream.cinema

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PrivastreamLiveTVStationListManager :
    SimpleViewManager<PrivastreamLiveTVStationListView>() {

    override fun getName(): String =
        REACT_CLASS

    override fun createViewInstance(
        context: ThemedReactContext
    ): PrivastreamLiveTVStationListView =
        PrivastreamLiveTVStationListView(
            context
        )

    @ReactProp(name = "items")
    fun setItems(
        view: PrivastreamLiveTVStationListView,
        items: ReadableArray?
    ) {
        view.setItems(items)
    }

    @ReactProp(
        name = "rowHeight",
        defaultFloat = 52f
    )
    fun setRowHeight(
        view: PrivastreamLiveTVStationListView,
        value: Float
    ) {
        view.setRowHeight(value)
    }

    @ReactProp(
        name = "preferredFocusIndex",
        defaultInt = 0
    )
    fun setPreferredFocusIndex(
        view: PrivastreamLiveTVStationListView,
        value: Int
    ) {
        view.setPreferredFocusIndex(value)
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

        out["topScroll"] =
            MapBuilder.of(
                "registrationName",
                "onScrollPosition"
            )

        out["topRowBlur"] =
            MapBuilder.of(
                "registrationName",
                "onRowBlur"
            )

        return out
    }

    companion object {
        const val REACT_CLASS =
            "PrivastreamLiveTVStationList"
    }
}