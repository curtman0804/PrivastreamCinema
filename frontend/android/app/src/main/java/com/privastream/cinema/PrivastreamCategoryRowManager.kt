package com.privastream.cinema

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PrivastreamCategoryRowManager :
    SimpleViewManager<PrivastreamCategoryRowView>() {

    override fun getName(): String =
        REACT_CLASS

    override fun createViewInstance(
        context: ThemedReactContext
    ): PrivastreamCategoryRowView =
        PrivastreamCategoryRowView(
            context
        )

    @ReactProp(name = "items")
    fun setItems(
        view: PrivastreamCategoryRowView,
        items: ReadableArray?
    ) {
        view.setItems(items)
    }

    @ReactProp(
        name = "itemWidth",
        defaultFloat = 156f
    )
    fun setItemWidth(
        view: PrivastreamCategoryRowView,
        value: Float
    ) {
        view.setItemWidth(value)
    }

    @ReactProp(
        name = "itemHeight",
        defaultFloat = 46f
    )
    fun setItemHeight(
        view: PrivastreamCategoryRowView,
        value: Float
    ) {
        view.setItemHeight(value)
    }

    @ReactProp(
        name = "gap",
        defaultFloat = 12f
    )
    fun setGap(
        view: PrivastreamCategoryRowView,
        value: Float
    ) {
        view.setGap(value)
    }

    @ReactProp(
        name = "leftPadding",
        defaultFloat = 0f
    )
    fun setLeftPadding(
        view: PrivastreamCategoryRowView,
        value: Float
    ) {
        view.setLeftPadding(value)
    }

    @ReactProp(
        name = "rightPadding",
        defaultFloat = 320f
    )
    fun setRightPadding(
        view: PrivastreamCategoryRowView,
        value: Float
    ) {
        view.setRightPadding(value)
    }

    @ReactProp(
        name = "anchorColumn",
        defaultInt = 5
    )
    fun setAnchorColumn(
        view: PrivastreamCategoryRowView,
        value: Int
    ) {
        view.setAnchorColumn(value)
    }

    @ReactProp(
        name = "preferredFocusIndex",
        defaultInt = 0
    )
    fun setPreferredFocusIndex(
        view: PrivastreamCategoryRowView,
        value: Int
    ) {
        view.setPreferredFocusIndex(
            value
        )
    }

    @ReactProp(name = "focusRequest")
    fun setFocusRequest(
        view: PrivastreamCategoryRowView,
        value: String?
    ) {
        view.setFocusRequest(value)
    }

    @ReactProp(
        name = "active",
        defaultBoolean = false
    )
    fun setActive(
        view: PrivastreamCategoryRowView,
        value: Boolean
    ) {
        view.setActive(value)
    }

    override fun getExportedCustomDirectEventTypeConstants():
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

        out["topRowBlur"] =
            MapBuilder.of(
                "registrationName",
                "onRowBlur"
            )

        return out
    }

    companion object {
        const val REACT_CLASS =
            "PrivastreamCategoryRow"
    }
}