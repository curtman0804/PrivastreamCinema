package com.privastream.cinema

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PrivastreamTVRowManager : SimpleViewManager<PrivastreamTVRowView>() {

    override fun getName(): String = REACT_CLASS

    override fun createViewInstance(context: ThemedReactContext): PrivastreamTVRowView =
        PrivastreamTVRowView(context)

    @ReactProp(name = "items")
    fun setItems(view: PrivastreamTVRowView, items: ReadableArray?) {
        view.setItems(items)
    }

    @ReactProp(name = "cardWidth", defaultFloat = 180f)
    fun setCardWidth(view: PrivastreamTVRowView, value: Float) {
        view.setCardWidth(value)
    }

    @ReactProp(name = "cardHeight", defaultFloat = 270f)
    fun setCardHeight(view: PrivastreamTVRowView, value: Float) {
        view.setCardHeight(value)
    }

    @ReactProp(name = "gap", defaultFloat = 16f)
    fun setGap(view: PrivastreamTVRowView, value: Float) {
        view.setGap(value)
    }

    @ReactProp(name = "leftPadding", defaultFloat = 48f)
    fun setLeftPadding(view: PrivastreamTVRowView, value: Float) {
        view.setLeftPadding(value)
    }

    @ReactProp(name = "rightPadding", defaultFloat = 1280f)
    fun setRightPadding(view: PrivastreamTVRowView, value: Float) {
        view.setRightPadding(value)
    }

    @ReactProp(name = "diagnosticLabel")
    fun setDiagnosticLabel(view: PrivastreamTVRowView, value: String?) {
        view.setDiagnosticLabel(value)
    }
    @ReactProp(name = "anchorColumn", defaultInt = 5)
    fun setAnchorColumn(view: PrivastreamTVRowView, value: Int) {
        view.setAnchorColumn(value)
    }

    @ReactProp(name = "preferredFocusIndex", defaultInt = -1)
    fun setPreferredFocusIndex(view: PrivastreamTVRowView, value: Int) {
        view.setPreferredFocusIndex(value)
    }

    override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> {
        val out = mutableMapOf<String, Any>()
        out["topItemFocus"] = MapBuilder.of("registrationName", "onItemFocus")
        out["topRowBlur"] = MapBuilder.of("registrationName", "onRowBlur")
        return out
    }

    companion object {
        const val REACT_CLASS = "PrivastreamTVRow"
    }
}