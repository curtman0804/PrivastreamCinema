package com.privastream.cinema

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.Priority
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.events.RCTEventEmitter
import kotlin.math.roundToInt

/**
 * V788T8K_NATIVE_STATION_LIST
 *
 * Vertical Live-TV channel focus is owned natively.
 * React receives focus/press notifications, but held UP/DOWN does not
 * depend on React rendering in order to move the selector.
 *
 * PrivastreamTVRowView is intentionally NOT modified.
 */
class PrivastreamLiveTVStationListView(
    context: Context
) : FrameLayout(context) {

    data class StationItem(
        val key: String,
        val title: String,
        val logo: String?,
        val favorite: Boolean
    )

    private val density = resources.displayMetrics.density

    private var rowHeightDp = 52f
    private var preferredFocusIndex = 0
    private var preferredFocusApplied = false

    private var logicalFocusPosition = -1
    private var pendingFocusPosition = -1
    private var focusFramePosted = false

    private val layoutManager =
        LinearLayoutManager(
            context,
            RecyclerView.VERTICAL,
            false
        )

    private val stationAdapter = StationAdapter()

    // V788T8N_DISCOVER_STYLE_VERTICAL_NAV
    // Match the working Discover model:
    // do NOT consume UP/DOWN here.
    // Android + RecyclerView own focus search, scrolling,
    // recycling, and held-key movement.
    private val recycler = RecyclerView(context)

    init {
        clipChildren = false
        clipToPadding = false

        recycler.layoutManager = layoutManager
        recycler.adapter = stationAdapter

        recycler.setHasFixedSize(true)
        recycler.itemAnimator = null
        recycler.overScrollMode = View.OVER_SCROLL_NEVER

        recycler.clipChildren = false
        recycler.clipToPadding = false

        recycler.isFocusable = false
        recycler.descendantFocusability =
            ViewGroup.FOCUS_AFTER_DESCENDANTS

        /*
         * Bounded native cache only. This is deliberately not the
         * previous 329-React-view experiment.
         */
        recycler.setItemViewCacheSize(16)
        layoutManager.initialPrefetchItemCount = 12

        // V788T8K2_NATIVE_SCROLL_BRIDGE
        recycler.addOnScrollListener(
            object : RecyclerView.OnScrollListener() {
                override fun onScrolled(
                    recyclerView: RecyclerView,
                    dx: Int,
                    dy: Int
                ) {
                    if (dy != 0) {
                        emitScrollPosition()
                    }
                }
            }
        )

        addView(
            recycler,
            LayoutParams(
                LayoutParams.MATCH_PARENT,
                LayoutParams.MATCH_PARENT
            )
        )
    }

    private fun px(dp: Float): Int =
        (dp * density).roundToInt()

    fun setRowHeight(value: Float) {
        if (value <= 0f || value == rowHeightDp) return

        rowHeightDp = value
        stationAdapter.notifyDataSetChanged()
    }

    fun setPreferredFocusIndex(value: Int) {
        preferredFocusIndex = value
        preferredFocusApplied = false

        post {
            applyPreferredFocusIfNeeded()
        }
    }

    fun setItems(items: ReadableArray?) {
        val next = ArrayList<StationItem>()

        if (items != null) {
            for (i in 0 until items.size()) {
                val map = items.getMap(i) ?: continue

                val key =
                    if (
                        map.hasKey("key") &&
                        !map.isNull("key")
                    ) {
                        map.getString("key") ?: ""
                    } else {
                        ""
                    }

                if (key.isBlank()) continue

                val title =
                    if (
                        map.hasKey("title") &&
                        !map.isNull("title")
                    ) {
                        map.getString("title") ?: ""
                    } else {
                        ""
                    }

                val logo =
                    if (
                        map.hasKey("logo") &&
                        !map.isNull("logo")
                    ) {
                        map.getString("logo")
                    } else {
                        null
                    }

                val favorite =
                    map.hasKey("favorite") &&
                        !map.isNull("favorite") &&
                        map.getBoolean("favorite")

                next.add(
                    StationItem(
                        key = key,
                        title = title,
                        logo = logo,
                        favorite = favorite
                    )
                )
            }
        }

        if (stationAdapter.sameData(next)) {
            return
        }

        // W121ZPLAY10Y16_STATION_FAVORITE_FAST_PATH
        // Mirror the guide's proven favorite-only update: update the
        // attached star directly without replacing/rebinding the row.
        if (stationAdapter.updateFavoritesOnly(next)) {
            return
        }

        val oldFocusKey =
            stationAdapter.itemAt(
                currentAdapterFocus()
            )?.key

        stationAdapter.replace(next)

        logicalFocusPosition =
            if (oldFocusKey != null) {
                stationAdapter.indexOfKey(oldFocusKey)
            } else {
                -1
            }

        preferredFocusApplied = false

        post {
            if (
                hasFocus() &&
                logicalFocusPosition in
                    0 until stationAdapter.itemCount
            ) {
                positionForTarget(logicalFocusPosition)
                scheduleFocus(logicalFocusPosition)
            } else {
                applyPreferredFocusIfNeeded()
            }
        }
    }

    private fun currentAdapterFocus(): Int {
        val focused = recycler.findFocus()

        if (focused != null) {
            val holder =
                recycler.findContainingViewHolder(focused)

            val position =
                holder?.bindingAdapterPosition
                    ?: RecyclerView.NO_POSITION

            if (position != RecyclerView.NO_POSITION) {
                return position
            }
        }

        return logicalFocusPosition
    }

    private fun moveVertical(delta: Int): Boolean {
        if (stationAdapter.itemCount <= 0) {
            return false
        }

        var current = currentAdapterFocus()

        if (
            current !in
            0 until stationAdapter.itemCount
        ) {
            current =
                preferredFocusIndex.coerceIn(
                    0,
                    stationAdapter.itemCount - 1
                )
        }

        val target = current + delta

        if (
            target !in
            0 until stationAdapter.itemCount
        ) {
            return false
        }

        logicalFocusPosition = target

        positionForTarget(target)
        scheduleFocus(target)

        Log.d(
            "PSTVLIVE",
            "MOVE delta=$delta current=$current target=$target"
        )

        return true
    }

    private fun positionForTarget(position: Int) {
        if (
            recycler.findViewHolderForAdapterPosition(
                position
            ) != null
        ) {
            return
        }

        val rowPx = px(rowHeightDp)

        val centerOffset =
            (
                (recycler.height - rowPx) / 2
            ).coerceAtLeast(0)

        layoutManager.scrollToPositionWithOffset(
            position,
            centerOffset
        )
    }

    private fun scheduleFocus(position: Int) {
        pendingFocusPosition = position

        if (focusFramePosted) return

        focusFramePosted = true

        recycler.postOnAnimation {
            focusFramePosted = false

            val target = pendingFocusPosition
            pendingFocusPosition = -1

            if (
                target !in
                0 until stationAdapter.itemCount
            ) {
                return@postOnAnimation
            }

            val holder =
                recycler.findViewHolderForAdapterPosition(
                    target
                )

            if (holder != null) {
                holder.itemView.requestFocus()
                return@postOnAnimation
            }

            positionForTarget(target)

            recycler.post {
                recycler
                    .findViewHolderForAdapterPosition(target)
                    ?.itemView
                    ?.requestFocus()
            }
        }
    }

    private fun applyPreferredFocusIfNeeded() {
        if (preferredFocusApplied) return

        if (
            preferredFocusIndex !in
            0 until stationAdapter.itemCount
        ) {
            return
        }

        preferredFocusApplied = true
        logicalFocusPosition = preferredFocusIndex

        positionForTarget(preferredFocusIndex)
        scheduleFocus(preferredFocusIndex)
    }

    @Suppress("DEPRECATION")
    private fun emit(
        name: String,
        payload: com.facebook.react.bridge.WritableMap
    ) {
        val reactContext =
            context as? ReactContext ?: return

        try {
            reactContext
                .getJSModule(
                    RCTEventEmitter::class.java
                )
                .receiveEvent(
                    id,
                    name,
                    payload
                )
        } catch (_: Throwable) {
        }
    }

    // V788T8K2_NATIVE_SCROLL_BRIDGE
    private fun emitScrollPosition() {
        // V788T8N_EXACT_ROW_SCROLL_OFFSET
        // Fixed 52dp rows let us report the real guide Y position
        // instead of RecyclerView's estimated scrollbar metric.
        val first =
            layoutManager.findFirstVisibleItemPosition()

        val firstView =
            if (first >= 0)
                layoutManager.findViewByPosition(first)
            else
                null

        val offsetPx =
            if (first >= 0 && firstView != null) {
                first * px(rowHeightDp) - firstView.top
            } else {
                0
            }

        val payload = Arguments.createMap()

        payload.putDouble(
            "offset",
            offsetPx / density.toDouble()
        )

        emit("topScroll", payload)
    }

    private fun emitFocus(
        position: Int,
        itemView: View
    ) {
        val item =
            stationAdapter.itemAt(position)
                ?: return

        val loc = IntArray(2)
        itemView.getLocationOnScreen(loc)

        val payload = Arguments.createMap()

        payload.putInt("index", position)
        payload.putString("key", item.key)

        payload.putDouble(
            "x",
            loc[0] / density.toDouble()
        )

        payload.putDouble(
            "y",
            loc[1] / density.toDouble()
        )

        payload.putDouble(
            "width",
            width / density.toDouble()
        )

        payload.putDouble(
            "height",
            rowHeightDp.toDouble()
        )

        emit("topItemFocus", payload)
    }

    private fun emitPress(position: Int) {
        val item =
            stationAdapter.itemAt(position)
                ?: return

        val payload = Arguments.createMap()

        payload.putInt("index", position)
        payload.putString("key", item.key)

        emit("topItemPress", payload)
    }

    private fun emitRowBlurIfNeeded() {
        recycler.post {
            if (!recycler.hasFocus()) {
                emit(
                    "topRowBlur",
                    Arguments.createMap()
                )
            }
        }
    }

    private fun rowBackground(
        focused: Boolean
    ): GradientDrawable =
        GradientDrawable().apply {
            shape =
                GradientDrawable.RECTANGLE

            setColor(
                if (focused) {
                    Color.argb(
                        36,
                        184,
                        160,
                        92
                    )
                } else {
                    Color.rgb(
                        21,
                        21,
                        21
                    )
                }
            )

            setStroke(
                px(if (focused) 2f else 1f),
                if (focused) {
                    Color.rgb(
                        184,
                        160,
                        92
                    )
                } else {
                    Color.rgb(
                        41,
                        41,
                        41
                    )
                }
            )
        }

    private fun badgeBackground():
        GradientDrawable =
        GradientDrawable().apply {
            shape =
                GradientDrawable.RECTANGLE

            cornerRadius =
                px(4f).toFloat()

            setColor(
                Color.rgb(
                    184,
                    160,
                    92
                )
            )
        }

    private inner class Holder(
        val root: LinearLayout,
        val logoFrame: FrameLayout,
        val logo: ImageView,
        val fallback: TextView,
        val title: TextView,
        val badge: FrameLayout,
        val badgeIcon: ImageView
    ) : RecyclerView.ViewHolder(root)

    private inner class StationAdapter :
        RecyclerView.Adapter<Holder>() {

        private val data =
            ArrayList<StationItem>()

        fun sameData(
            next: List<StationItem>
        ): Boolean =
            data == next

        fun itemAt(
            position: Int
        ): StationItem? =
            data.getOrNull(position)

        fun indexOfKey(
            key: String
        ): Int =
            data.indexOfFirst {
                it.key == key
            }

        // W121ZPLAY10Y16_DIRECT_STATION_STAR
        fun updateFavoritesOnly(
            next: List<StationItem>
        ): Boolean {
            if (data.size != next.size) {
                return false
            }

            // Favorite must be the only difference.
            for (i in next.indices) {
                val current = data[i]
                val incoming = next[i]

                if (
                    current.key != incoming.key ||
                    current.title != incoming.title ||
                    current.logo != incoming.logo
                ) {
                    return false
                }
            }

            var changed = false

            for (i in next.indices) {
                val incoming = next[i]

                if (data[i].favorite != incoming.favorite) {
                    data[i] = incoming

                    val holder =
                        recycler
                            .findViewHolderForAdapterPosition(i)
                            as? Holder

                    if (holder != null) {
                        holder.badge.visibility =
                            if (incoming.favorite) {
                                View.VISIBLE
                            } else {
                                View.GONE
                            }

                        // Draw immediately; never rebind/request focus.
                        holder.badge.invalidate()
                        holder.badge.postInvalidateOnAnimation()
                    }

                    changed = true
                }
            }

            return changed
        }

        fun replace(
            next: List<StationItem>
        ) {
            data.clear()
            data.addAll(next)
            notifyDataSetChanged()
        }

        override fun getItemCount(): Int =
            data.size

        override fun onCreateViewHolder(
            parent: ViewGroup,
            viewType: Int
        ): Holder {

            val root =
                LinearLayout(context).apply {
                    orientation =
                        LinearLayout.HORIZONTAL

                    gravity =
                        Gravity.CENTER_VERTICAL

                    isFocusable = true
                    isFocusableInTouchMode = false
                    isClickable = true

                    descendantFocusability =
                        ViewGroup.FOCUS_BLOCK_DESCENDANTS

                    setPadding(
                        px(8f),
                        0,
                        px(8f),
                        0
                    )

                    background =
                        rowBackground(false)
                }

            root.layoutParams =
                RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    px(rowHeightDp)
                )

            val logoFrame =
                FrameLayout(context)

            val logoFrameParams =
                LinearLayout.LayoutParams(
                    px(84f),
                    px(48f)
                )

            logoFrameParams.marginEnd =
                px(8f)

            root.addView(
                logoFrame,
                logoFrameParams
            )

            val logo =
                ImageView(context).apply {
                    scaleType =
                        ImageView.ScaleType.FIT_CENTER

                    isFocusable = false
                }

            val logoParams =
                FrameLayout.LayoutParams(
                    px(80f),
                    px(44f),
                    Gravity.CENTER
                )

            logoFrame.addView(
                logo,
                logoParams
            )

            val fallback =
                TextView(context).apply {
                    text = "TV"
                    setTextColor(
                        Color.rgb(
                            184,
                            160,
                            92
                        )
                    )

                    textSize = 14f
                    gravity = Gravity.CENTER
                    isFocusable = false
                }

            logoFrame.addView(
                fallback,
                FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            )

            val title =
                TextView(context).apply {
                    setTextColor(Color.WHITE)
                    textSize = 16f

                    setTypeface(
                        typeface,
                        android.graphics.Typeface.BOLD
                    )

                    maxLines = 1

                    ellipsize =
                        TextUtils.TruncateAt.END

                    isFocusable = false
                }

            root.addView(
                title,
                LinearLayout.LayoutParams(
                    0,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                    1f
                )
            )

            val badge =
                FrameLayout(context).apply {
                    background =
                        badgeBackground()

                    visibility =
                        View.GONE

                    isFocusable = false
                }

            val badgeParams =
                LinearLayout.LayoutParams(
                    px(20f),
                    px(20f)
                )

            badgeParams.marginStart =
                px(8f)

            root.addView(
                badge,
                badgeParams
            )

            val badgeIcon =
                ImageView(context).apply {
                    setImageResource(
                        R.drawable.pstv_live_tv_bookmark
                    )

                    isFocusable = false
                }

            badge.addView(
                badgeIcon,
                FrameLayout.LayoutParams(
                    px(12f),
                    px(12f),
                    Gravity.CENTER
                )
            )

            return Holder(
                root,
                logoFrame,
                logo,
                fallback,
                title,
                badge,
                badgeIcon
            )
        }

        override fun onBindViewHolder(
            holder: Holder,
            position: Int
        ) {
            val item = data[position]

            holder.title.text =
                item.title

            holder.badge.visibility =
                if (item.favorite) {
                    View.VISIBLE
                } else {
                    View.GONE
                }

            try {
                Glide.with(holder.logo)
                    .clear(holder.logo)
            } catch (_: Throwable) {
            }

            holder.logo.setImageDrawable(null)

            if (item.logo.isNullOrBlank()) {
                holder.logo.visibility =
                    View.GONE

                holder.fallback.visibility =
                    View.VISIBLE
            } else {
                holder.logo.visibility =
                    View.VISIBLE

                holder.fallback.visibility =
                    View.GONE

                Glide.with(holder.logo)
                    .load(item.logo)
                    .dontAnimate()
                    .priority(Priority.LOW)
                    .placeholder(
                        ColorDrawable(
                            Color.TRANSPARENT
                        )
                    )
                    .error(
                        ColorDrawable(
                            Color.TRANSPARENT
                        )
                    )
                    .override(
                        px(80f),
                        px(44f)
                    )
                    .into(holder.logo)
            }

            holder.root.background =
                rowBackground(
                    holder.root.hasFocus()
                )

            holder.root.setOnFocusChangeListener {
                    view,
                    focused ->

                view.background =
                    rowBackground(focused)

                if (focused) {
                    val p =
                        holder.bindingAdapterPosition

                    if (
                        p !=
                        RecyclerView.NO_POSITION
                    ) {
                        logicalFocusPosition = p
                        emitFocus(p, view)
                    }
                } else {
                    emitRowBlurIfNeeded()
                }
            }

            holder.root.setOnClickListener {
                val p =
                    holder.bindingAdapterPosition

                if (
                    p !=
                    RecyclerView.NO_POSITION
                ) {
                    emitPress(p)
                }
            }
        }

        override fun onViewRecycled(
            holder: Holder
        ) {
            holder.root.setOnFocusChangeListener(
                null
            )

            holder.root.setOnClickListener(
                null
            )

            try {
                Glide.with(holder.logo)
                    .clear(holder.logo)
            } catch (_: Throwable) {
            }

            holder.logo.setImageDrawable(null)

            super.onViewRecycled(holder)
        }
    }
}