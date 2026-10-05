package com.privastream.cinema

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
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
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * V788T8P_WHOLE_ROW_NATIVE_GUIDE
 *
 * ONE vertical RecyclerView item owns:
 *   station | programs
 *
 * Therefore station + EPG can never vertically separate.
 *
 * UP/DOWN are NOT consumed here.
 * Android/RecyclerView owns vertical navigation exactly as it did in
 * the successful native station-list test.
 */
class PrivastreamLiveTVGuideView(
    context: Context
) : FrameLayout(context) {

    data class ProgramItem(
        val id: String,
        val title: String,
        val startMs: Long,
        val endMs: Long
    )

    data class GuideItem(
        val key: String,
        val title: String,
        val logo: String?,
        val favorite: Boolean,
        val programs: List<ProgramItem>
    )

    data class ProgramTag(
        val index: Int,
        val startMs: Long,
        val endMs: Long
    )

    private val density =
        resources.displayMetrics.density

    private var rowHeightDp = 52f
    private var channelWidthDp = 340f
    private var slotWidthDp = 210f
    private var slotCount = 16
    private var slotMs = 30L * 60L * 1000L

    private var timelineStartMs = 0L
    private var nowMs = System.currentTimeMillis()

    private var preferredFocusIndex = 0
    private var preferredFocusApplied = false

    private var horizontalOffsetPx = 0

    private var focusedRow = -1
    private var focusedZone = "station"
    private var focusedProgramAnchorMs: Long? = null

    // V788T8U_FIXED_TIME_COLUMN
    private var timeEntrySlotIndex = 0

    // V788T8Q2_NATIVE_VERTICAL_ZONE_LOCK
    private var logicalVerticalRow = -1
    private var pendingVerticalRow = -1
    private var pendingVerticalZone = "station"
    private var pendingVerticalAnchorMs: Long? = null
    private var pendingVerticalTopPx = 0
    private var verticalFocusPosted = false
    private var verticalFocusRetries = 0
    private val maxVerticalFocusRetries = 8

    private val rootColumn =
        LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            clipChildren = true
            clipToPadding = true
        }

    private val header =
        LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.rgb(21, 21, 21))
        }

    private val stationHeader =
        TextView(context).apply {
            text = "CHANNEL"
            setTextColor(Color.rgb(153, 153, 153))
            textSize = 13f
            setTypeface(typeface, Typeface.BOLD)
            gravity = Gravity.CENTER_VERTICAL
            setPadding(px(12f), 0, 0, 0)
        }

    private val headerViewport =
        FrameLayout(context).apply {
            clipChildren = true
            clipToPadding = true
            setBackgroundColor(Color.rgb(21, 21, 21))
        }

    private val headerCanvas =
        FrameLayout(context).apply {
            clipChildren = false
            clipToPadding = false
        }

    private val layoutManager =
        LinearLayoutManager(
            context,
            RecyclerView.VERTICAL,
            false
        )

    private val adapter =
        GuideAdapter()

    // V788T8S_RECYCLERVIEW_VERTICAL_OWNER
    // Standard RecyclerView/LinearLayoutManager owns Up/Down.
    private val recycler =
        RecyclerView(context).apply {
            layoutManager = this@PrivastreamLiveTVGuideView.layoutManager
            adapter = this@PrivastreamLiveTVGuideView.adapter

            setHasFixedSize(true)
            itemAnimator = null

            overScrollMode = View.OVER_SCROLL_NEVER

            clipChildren = true
            clipToPadding = true

            isFocusable = false

            descendantFocusability =
                ViewGroup.FOCUS_AFTER_DESCENDANTS

            /*
             * Native/recycled only.
             * No hundreds of React Pressables.
             */
            setItemViewCacheSize(14)
        }

    init {
        clipChildren = true
        clipToPadding = true

        header.addView(
            stationHeader,
            LinearLayout.LayoutParams(
                px(channelWidthDp),
                px(42f)
            )
        )

        headerViewport.addView(
            headerCanvas,
            FrameLayout.LayoutParams(
                guideWidthPx(),
                px(42f)
            )
        )

        header.addView(
            headerViewport,
            LinearLayout.LayoutParams(
                0,
                px(42f),
                1f
            )
        )

        // V788T8Q2_SINGLE_VISIBLE_HEADER
        // Existing React pinned header is the only header.
        rootColumn.addView(
            recycler,
            LinearLayout.LayoutParams(
                LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        )

        addView(
            rootColumn,
            LayoutParams(
                LayoutParams.MATCH_PARENT,
                LayoutParams.MATCH_PARENT
            )
        )

        rebuildHeader()
    }

    private fun px(dp: Float): Int =
        (dp * density).roundToInt()

    private fun guideWidthPx(): Int =
        px(slotWidthDp * slotCount.toFloat())

    private fun timelineEndMs(): Long =
        timelineStartMs +
            slotMs * slotCount.toLong()

    // V788T8R_COLD_START_FOCUS_REPAIR
    override fun onWindowFocusChanged(
        hasWindowFocus: Boolean
    ) {
        super.onWindowFocusChanged(hasWindowFocus)

        if (!hasWindowFocus) return

        post {
            if (adapter.itemCount <= 0) {
                return@post
            }

            if (recycler.findFocus() == null) {
                focusRow(
                    preferredFocusIndex.coerceIn(
                        0,
                        adapter.itemCount - 1
                    ),
                    "station",
                    null
                )
            }
        }
    }
    fun setRowHeight(value: Float) {
        if (value <= 0f || value == rowHeightDp) return
        rowHeightDp = value
        adapter.notifyDataSetChanged()
    }

    fun setChannelWidth(value: Float) {
        if (value <= 0f || value == channelWidthDp) return

        channelWidthDp = value

        stationHeader.layoutParams =
            LinearLayout.LayoutParams(
                px(channelWidthDp),
                px(42f)
            )

        adapter.notifyDataSetChanged()
    }

    fun setSlotWidth(value: Float) {
        if (value <= 0f || value == slotWidthDp) return
        slotWidthDp = value
        rebuildHeader()
        adapter.notifyDataSetChanged()
    }

    fun setSlotCount(value: Int) {
        if (value <= 0 || value == slotCount) return
        slotCount = value
        rebuildHeader()
        adapter.notifyDataSetChanged()
    }

    fun setSlotMs(value: Double) {
        val next = value.toLong()
        if (next <= 0L || next == slotMs) return
        slotMs = next
        rebuildHeader()
        adapter.notifyDataSetChanged()
    }

    fun setTimelineStartMs(value: Double) {
        val next = value.toLong()
        if (next == timelineStartMs) return
        timelineStartMs = next
        horizontalOffsetPx = 0
        rebuildHeader()
        adapter.notifyDataSetChanged()
    }

    // V788T8Y_R3_NOW_TICK_FOCUS_SAFE
    fun setNowMs(value: Double) {
        val next = value.toLong()

        if (next == nowMs) {
            return
        }

        nowMs = next

        recycler.post {
            for (index in 0 until recycler.childCount) {
                val child =
                    recycler.getChildAt(index)

                val holder =
                    recycler
                        .getChildViewHolder(child)
                        as? Holder
                        ?: continue

                renderRowSelection(
                    holder,
                    holder.root.hasFocus(),
                    false
                )
            }
        }
    }

    fun setPreferredFocusIndex(value: Int) {
        android.util.Log.d(
            "PSTV",
            "W121ZSY34 SET_PREFERRED " +
                "value=$value " +
                "beforeIndex=$preferredFocusIndex " +
                "beforeApplied=$preferredFocusApplied " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "guideHasFocus=${hasFocus()}"
        )

        preferredFocusIndex = value
        preferredFocusApplied = false

        // V789R_TOP_VISIBLE_CATEGORY_DOWN
        // -1 is a one-shot "focus first visible row" request carried by
        // focusRestoreRequest. Do not let the normal preferred-focus path
        // coerce it to absolute row 0.
        if (value < 0) {
            return
        }

        post {
            applyPreferredFocusIfNeeded()
        }
    }

    // V788T8V_RETURN_FOCUS_HANDSHAKE
    fun requestFocusRestore(value: String?) {
        val requested =
            value
                ?.substringBefore(':')
                ?.toIntOrNull()
                ?: return

        android.util.Log.d(
            "PSTV",
            "W121ZSY34 REQUEST_RESTORE " +
                "raw=$value " +
                "requested=$requested " +
                "beforeIndex=$preferredFocusIndex " +
                "beforeApplied=$preferredFocusApplied " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "guideHasFocus=${hasFocus()}"
        )

        preferredFocusIndex = requested
        preferredFocusApplied = false

        post {
            if (adapter.itemCount <= 0) {
                return@post
            }

            val row =
                if (requested == -1) {
                    // V789R_TOP_VISIBLE_CATEGORY_DOWN
                    // Categories sit outside this RecyclerView, so its vertical
                    // viewport is unchanged while the category rail owns focus.
                    // Re-enter on the channel that is visibly at the top.
                    val firstVisible =
                        layoutManager
                            .findFirstVisibleItemPosition()

                    val resolved =
                        if (
                            firstVisible ==
                                RecyclerView.NO_POSITION
                        ) {
                            0
                        } else {
                            firstVisible
                        }

                    android.util.Log.d(
                        "PSTV",
                        "V789R TOP_VISIBLE_FOCUS " +
                            "row=$resolved " +
                            "items=${adapter.itemCount}"
                    )

                    resolved.coerceIn(
                        0,
                        adapter.itemCount - 1
                    )
                } else {
                    requested.coerceIn(
                        0,
                        adapter.itemCount - 1
                    )
                }

            preferredFocusIndex = row

            // W121ZSY40_PRESERVE_RETURN_VIEWPORT
            //
            // Playback return already has the correct channel and viewport.
            // Do NOT center the returned row. Replace any stale pending
            // LinearLayoutManager anchor with the row's current pixel position.
            if (requested >= 0) {
                val restoredHolder =
                    recycler.findViewHolderForAdapterPosition(row) as? Holder

                if (restoredHolder != null) {
                    val preservedTop =
                        restoredHolder.itemView.top

                    val firstVisible =
                        layoutManager.findFirstVisibleItemPosition()

                    val lastVisible =
                        layoutManager.findLastVisibleItemPosition()

                    android.util.Log.d(
                        "PSTV",
                        "W121ZSY40 RETURN_PRESERVE " +
                            "row=$row " +
                            "top=$preservedTop " +
                            "first=$firstVisible " +
                            "last=$lastVisible"
                    )

                    // Overwrite any stale pending anchor with a visual no-op.
                    // The returned channel stays exactly where it already is.
                    layoutManager.scrollToPositionWithOffset(
                        row,
                        preservedTop
                    )

                    val focused =
                        restoredHolder.root.requestFocus()

                    android.util.Log.d(
                        "PSTV",
                        "W121ZSY40 RETURN_FOCUS " +
                            "row=$row " +
                            "top=$preservedTop " +
                            "focused=$focused"
                    )

                    if (focused) {
                        preferredFocusApplied = true
                    } else {
                        recycler.postOnAnimation {
                            val retryHolder =
                                recycler.findViewHolderForAdapterPosition(row)
                                    as? Holder

                            val retryFocused =
                                retryHolder?.root?.requestFocus() == true

                            android.util.Log.d(
                                "PSTV",
                                "W121ZSY40 RETURN_FOCUS_RETRY " +
                                    "row=$row focused=$retryFocused"
                            )

                            if (retryFocused) {
                                preferredFocusApplied = true
                            }
                        }
                    }

                    return@post
                }

                android.util.Log.d(
                    "PSTV",
                    "W121ZSY40 RETURN_HOLDER_MISSING row=$row"
                )

                focusRow(row, "station", null)
                return@post
            }
            val holder =
                recycler
                    .findViewHolderForAdapterPosition(row)
                    as? Holder

            if (
                holder != null &&
                holder.root.requestFocus()
            ) {
                preferredFocusApplied = true
            } else {
                focusRow(
                    row,
                    "station",
                    null
                )
            }
        }
    }

    fun setItems(items: ReadableArray?) {
        val next =
            ArrayList<GuideItem>()

        if (items != null) {
            for (i in 0 until items.size()) {
                val map =
                    items.getMap(i) ?: continue

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

                val programs =
                    ArrayList<ProgramItem>()

                val arr =
                    try {
                        if (
                            map.hasKey("programs") &&
                            !map.isNull("programs")
                        ) {
                            map.getArray("programs")
                        } else {
                            null
                        }
                    } catch (_: Throwable) {
                        null
                    }

                if (arr != null) {
                    for (j in 0 until arr.size()) {
                        val p =
                            arr.getMap(j) ?: continue

                        val start =
                            try {
                                p.getDouble("startMs").toLong()
                            } catch (_: Throwable) {
                                0L
                            }

                        val end =
                            try {
                                p.getDouble("endMs").toLong()
                            } catch (_: Throwable) {
                                0L
                            }

                        if (end <= start) continue

                        val id =
                            if (
                                p.hasKey("id") &&
                                !p.isNull("id")
                            ) {
                                p.getString("id") ?: ""
                            } else {
                                ""
                            }

                        val programTitle =
                            if (
                                p.hasKey("title") &&
                                !p.isNull("title")
                            ) {
                                p.getString("title") ?: "Programming"
                            } else {
                                "Programming"
                            }

                        programs.add(
                            ProgramItem(
                                id,
                                programTitle,
                                start,
                                end
                            )
                        )
                    }
                }

                next.add(
                    GuideItem(
                        key,
                        title,
                        logo,
                        favorite,
                        programs
                    )
                )
            }
        }

        if (adapter.sameData(next)) {
            return
        }

        // V788T8X_BOOKMARK_ZERO_FOCUS_CHURN
        if (adapter.updateFavoritesOnly(next)) {
            return
        }

        val oldKey =
            adapter.itemAt(
                focusedRow
            )?.key

        val oldZone = focusedZone
        val oldAnchor = focusedProgramAnchorMs

        android.util.Log.d(
            "PSTV",
            "W121ZSY34 SET_ITEMS_REPLACE " +
                "oldKey=$oldKey " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "oldZone=$oldZone " +
                "preferredIndex=$preferredFocusIndex " +
                "preferredApplied=$preferredFocusApplied " +
                "nextCount=${next.size} " +
                "guideHasFocus=${hasFocus()}"
        )

        adapter.replace(next)

        val restored =
            if (oldKey != null) {
                adapter.indexOfKey(oldKey)
            } else {
                -1
            }

        preferredFocusApplied = false

        android.util.Log.d(
            "PSTV",
            "W121ZSY34 SET_ITEMS_RESTORED " +
                "oldKey=$oldKey " +
                "restored=$restored " +
                "preferredIndex=$preferredFocusIndex " +
                "preferredApplied=$preferredFocusApplied " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "guideHasFocus=${hasFocus()}"
        )

        post {
            // V788T12D_KEEP_EXISTING_FOCUSED_HOLDER
            //
            // DiffUtil may have shifted this row's adapter position,
            // but if the same keyed holder still owns focus there is
            // nothing to restore. Updating our logical row bookkeeping
            // is sufficient and avoids the visible selector dropout.
            if (restored >= 0) {
                val restoredHolder =
                    recycler.findViewHolderForAdapterPosition(
                        restored
                    ) as? Holder

                if (
                    restoredHolder != null &&
                    restoredHolder.root.hasFocus()
                ) {
                    focusedRow = restored
                    logicalVerticalRow = restored
                    focusedZone = oldZone
                    focusedProgramAnchorMs = oldAnchor

                    preferredFocusIndex = restored
                    preferredFocusApplied = true

                    android.util.Log.d(
                        "PSTV",
                        "V788T12D FOCUS PRESERVED " +
                            "row=$restored key=$oldKey"
                    )

                    return@post
                }
            }

            // Existing recovery path remains intact for genuine holder
            // loss, playback return, cold start, or another real focus
            // transition.
            if (hasFocus() && restored >= 0) {
                android.util.Log.d(
                    "PSTV",
                    "W121ZSY34 SET_ITEMS_RESTORE_BY_KEY " +
                        "restored=$restored " +
                        "oldKey=$oldKey " +
                        "zone=$oldZone " +
                        "preferredIndex=$preferredFocusIndex " +
                        "preferredApplied=$preferredFocusApplied"
                )

                focusRow(
                    restored,
                    oldZone,
                    oldAnchor
                )
            } else {
                android.util.Log.d(
                    "PSTV",
                    "W121ZSY34 SET_ITEMS_FALLBACK_PREFERRED " +
                        "restored=$restored " +
                        "oldKey=$oldKey " +
                        "preferredIndex=$preferredFocusIndex " +
                        "preferredApplied=$preferredFocusApplied " +
                        "focusedRow=$focusedRow " +
                        "logicalRow=$logicalVerticalRow " +
                        "guideHasFocus=${hasFocus()}"
                )

                applyPreferredFocusIfNeeded()
            }
        }
    }

    private fun rebuildHeader() {
        headerCanvas.removeAllViews()

        headerCanvas.layoutParams =
            FrameLayout.LayoutParams(
                guideWidthPx(),
                px(42f)
            )

        val formatter =
            SimpleDateFormat(
                "h:mm a",
                Locale.getDefault()
            )

        for (i in 0 until slotCount) {
            val time =
                timelineStartMs +
                    i.toLong() * slotMs

            val label =
                TextView(context).apply {
                    text =
                        formatter.format(
                            Date(time)
                        )

                    setTextColor(
                        Color.rgb(187, 187, 187)
                    )

                    textSize = 13f

                    setTypeface(
                        typeface,
                        Typeface.BOLD
                    )

                    gravity =
                        Gravity.CENTER_VERTICAL

                    setPadding(
                        px(10f),
                        0,
                        0,
                        0
                    )

                    setBackgroundColor(
                        Color.rgb(21, 21, 21)
                    )
                }

            val lp =
                FrameLayout.LayoutParams(
                    px(slotWidthDp),
                    px(42f)
                )

            lp.leftMargin =
                px(
                    i.toFloat() *
                        slotWidthDp
                )

            headerCanvas.addView(
                label,
                lp
            )
        }

        applyHorizontalOffset()
    }

    private fun applyPreferredFocusIfNeeded() {
        android.util.Log.d(
            "PSTV",
            "W121ZSY34 APPLY_PREFERRED_ENTRY " +
                "preferredIndex=$preferredFocusIndex " +
                "preferredApplied=$preferredFocusApplied " +
                "itemCount=${adapter.itemCount} " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "guideHasFocus=${hasFocus()}"
        )

        if (preferredFocusApplied) return
        if (adapter.itemCount <= 0) return

        // V789R_TOP_VISIBLE_CATEGORY_DOWN
        // Negative values are focusRestoreRequest sentinels, not row indexes.
        if (preferredFocusIndex < 0) return

        val p =
            preferredFocusIndex.coerceIn(
                0,
                adapter.itemCount - 1
            )

        android.util.Log.d(
            "PSTV",
            "W121ZSY34 APPLY_PREFERRED_FIRE " +
                "resolvedRow=$p " +
                "preferredIndex=$preferredFocusIndex " +
                "focusedRow=$focusedRow " +
                "logicalRow=$logicalVerticalRow " +
                "guideHasFocus=${hasFocus()}"
        )

        preferredFocusApplied = true

        focusRow(
            p,
            "station",
            null
        )
    }

    private fun focusRow(
        row: Int,
        zone: String,
        anchorMs: Long?
    ) {
        android.util.Log.d(
            "PSTV",
            "W121ZSY34 FOCUS_ROW_REQUEST " +
                "row=$row " +
                "zone=$zone " +
                "anchorMs=$anchorMs " +
                "itemCount=${adapter.itemCount} " +
                "beforeFocusedRow=$focusedRow " +
                "beforeLogicalRow=$logicalVerticalRow " +
                "preferredIndex=$preferredFocusIndex " +
                "preferredApplied=$preferredFocusApplied " +
                "guideHasFocus=${hasFocus()}"
        )

        if (row !in 0 until adapter.itemCount) return

        focusedRow = row
        logicalVerticalRow = row

        focusedZone =
            if (zone == "program") {
                "program"
            } else {
                "station"
            }

        focusedProgramAnchorMs =
            if (focusedZone == "program") {
                anchorMs
            } else {
                null
            }

        layoutManager.scrollToPositionWithOffset(
            row,
            0
        )

        recycler.post {
            requestRowRootFocusWithRetry(
                row,
                0
            )
        }
    }

    // V788T10P_POST_REFRESH_ROOT_FOCUS_RETRY
    // RecyclerView.notifyDataSetChanged() can invalidate a holder after
    // requestFocus() has already returned true. Keep the established root
    // focus target, but confirm that the CURRENT holder still owns focus
    // on the next animation frame before considering restoration complete.
    private fun requestRowRootFocusWithRetry(
        row: Int,
        attempt: Int
    ) {
        if (row !in 0 until adapter.itemCount) {
            return
        }

        val holder =
            recycler.findViewHolderForAdapterPosition(row)
                as? Holder

        val requested =
            holder?.root?.requestFocus() == true

        recycler.postOnAnimation {
            if (row !in 0 until adapter.itemCount) {
                return@postOnAnimation
            }

            val currentHolder =
                recycler.findViewHolderForAdapterPosition(row)
                    as? Holder

            if (
                requested &&
                currentHolder != null &&
                currentHolder.root.hasFocus()
            ) {
                if (attempt > 0) {
                    android.util.Log.d(
                        "PSTV",
                        "V788T10P ROOT FOCUS RESTORED " +
                            "row=$row attempt=$attempt"
                    )
                }

                return@postOnAnimation
            }

            if (attempt >= maxVerticalFocusRetries) {
                android.util.Log.w(
                    "PSTV",
                    "V788T10P ROOT FOCUS GIVEUP " +
                        "row=$row attempts=$attempt"
                )

                return@postOnAnimation
            }

            android.util.Log.d(
                "PSTV",
                "V788T10P ROOT FOCUS RETRY " +
                    "row=$row attempt=${attempt + 1}"
            )

            layoutManager.scrollToPositionWithOffset(
                row,
                0
            )

            recycler.post {
                requestRowRootFocusWithRetry(
                    row,
                    attempt + 1
                )
            }
        }
    }
    private fun findProgramForAnchor(
        holder: Holder,
        anchorMs: Long?
    ): View? {
        if (holder.programViews.isEmpty()) {
            return null
        }

        if (anchorMs == null) {
            return holder.programViews.firstOrNull()
        }

        var best: View? = null
        var bestDistance = Long.MAX_VALUE

        for (view in holder.programViews) {
            val tag =
                view.tag as? ProgramTag
                    ?: continue

            if (
                anchorMs >= tag.startMs &&
                anchorMs < tag.endMs
            ) {
                return view
            }

            val mid =
                tag.startMs +
                    (tag.endMs - tag.startMs) / 2L

            val distance =
                abs(mid - anchorMs)

            if (distance < bestDistance) {
                bestDistance = distance
                best = view
            }
        }

        return best
    }

    // W121ZSY36_VIEWPORT_EDGE_ROOT_FOCUS
    //
    // Root-to-root navigation succeeds while the destination holder is
    // already visible. At a viewport edge, shift the RecyclerView exactly
    // one row first, then focus the newly visible adjacent root.
    //
    // Do NOT use the playback-return root retry loop here. That loop uses
    // scrollToPositionWithOffset() and was proven to stall repeatedly at
    // viewport boundaries while the old root retained focus.
    private fun moveRootVertical(
        sourceHolder: Holder,
        delta: Int
    ): Boolean {
        if (adapter.itemCount <= 0) {
            return false
        }

        val actualFocus =
            recycler.findFocus()

        val actualHolder =
            actualFocus?.let { focusedView ->
                recycler.findContainingViewHolder(
                    focusedView
                ) as? Holder
            }

        var current =
            actualHolder?.bindingAdapterPosition
                ?: RecyclerView.NO_POSITION

        if (current !in 0 until adapter.itemCount) {
            current =
                sourceHolder.bindingAdapterPosition
        }

        if (current !in 0 until adapter.itemCount) {
            current =
                logicalVerticalRow
        }

        if (current !in 0 until adapter.itemCount) {
            current =
                focusedRow
        }

        if (current !in 0 until adapter.itemCount) {
            return false
        }

        val target =
            current + delta

        // Preserve the existing category/top and true bottom boundary paths.
        if (target !in 0 until adapter.itemCount) {
            return false
        }

        android.util.Log.d(
            "PSTV",
            "W121ZSY36 ROOT_VERTICAL " +
                "current=$current " +
                "target=$target " +
                "delta=$delta " +
                "itemCount=${adapter.itemCount}"
        )

        // Fast path: destination is already visible and can take focus.
        val attachedTarget =
            recycler.findViewHolderForAdapterPosition(
                target
            ) as? Holder

        if (
            attachedTarget != null &&
            attachedTarget.root.requestFocus()
        ) {
            return true
        }

        // Proven failure case:
        // the adjacent holder is at/just beyond the viewport edge.
        // Move the viewport by exactly one guide row, synchronously.
        val rowStepPx =
            px(rowHeightDp)
                .coerceAtLeast(1)

        android.util.Log.d(
            "PSTV",
            "W121ZSY36 EDGE_SCROLL " +
                "current=$current " +
                "target=$target " +
                "delta=$delta " +
                "stepPx=$rowStepPx"
        )

        recycler.scrollBy(
            0,
            delta * rowStepPx
        )

        // scrollBy() normally lays out the adjacent row immediately.
        val shiftedTarget =
            recycler.findViewHolderForAdapterPosition(
                target
            ) as? Holder

        if (
            shiftedTarget != null &&
            shiftedTarget.root.requestFocus()
        ) {
            android.util.Log.d(
                "PSTV",
                "W121ZSY36 EDGE_FOCUS " +
                    "target=$target mode=immediate result=success"
            )

            return true
        }

        // One frame is enough for RecyclerView to finish an edge attachment.
        // Do not start overlapping eight-attempt retry chains.
        recycler.postOnAnimation {
            val frameTarget =
                recycler.findViewHolderForAdapterPosition(
                    target
                ) as? Holder

            if (
                frameTarget != null &&
                frameTarget.root.requestFocus()
            ) {
                android.util.Log.d(
                    "PSTV",
                    "W121ZSY36 EDGE_FOCUS " +
                        "target=$target mode=frame result=success"
                )

                return@postOnAnimation
            }

            // Last deterministic fallback: put the requested target fully
            // inside the viewport, then try exactly once on the next frame.
            val visibleOffset =
                if (delta > 0) {
                    (
                        recycler.height -
                            rowStepPx
                    ).coerceAtLeast(0)
                } else {
                    0
                }

            layoutManager.scrollToPositionWithOffset(
                target,
                visibleOffset
            )

            recycler.postOnAnimation {
                val finalTarget =
                    recycler.findViewHolderForAdapterPosition(
                        target
                    ) as? Holder

                val focused =
                    finalTarget?.root?.requestFocus() == true

                android.util.Log.d(
                    "PSTV",
                    "W121ZSY36 EDGE_FOCUS " +
                        "target=$target " +
                        "mode=final " +
                        "result=${if (focused) "success" else "failed"}"
                )
            }
        }

        // Consume the vertical key because this function owns the pending
        // one-row transition. Actual focusedRow remains updated only by the
        // real root focus-change listener.
        return true
    }
    // V788T8Q2_NATIVE_VERTICAL_ZONE_LOCK
    private fun moveVertical(delta: Int): Boolean {
        if (adapter.itemCount <= 0) return false

        // V788T8R_REAL_NATIVE_FOCUS_SOURCE
        // Never trust stale logical focus state.
        // Ask Android which RecyclerView child ACTUALLY owns focus.
        val actualFocus = recycler.findFocus()

        val actualHolder =
            actualFocus?.let { focusedView ->
                recycler.findContainingViewHolder(
                    focusedView
                ) as? Holder
            }

        val actualRow =
            actualHolder?.bindingAdapterPosition
                ?: RecyclerView.NO_POSITION

        var current = actualRow

        if (current !in 0 until adapter.itemCount) {
            current = logicalVerticalRow
        }

        if (current !in 0 until adapter.itemCount) {
            current = focusedRow
        }

        if (current !in 0 until adapter.itemCount) {
            return false
        }

        if (
            actualHolder != null &&
            actualRow in 0 until adapter.itemCount
        ) {
            focusedRow = actualRow
            logicalVerticalRow = actualRow

            if (actualFocus === actualHolder.station) {
                focusedZone = "station"
                focusedProgramAnchorMs = null
            } else {
                focusedZone = "program"

                val programTag =
                    actualFocus?.tag as? ProgramTag

                if (programTag != null) {
                    focusedProgramAnchorMs =
                        programTag.startMs +
                            (
                                programTag.endMs -
                                    programTag.startMs
                            ) / 2L
                }
            }
        }

        val target = current + delta

        // Let Android search outside the guide only at
        // the actual top or bottom boundary.
        if (target !in 0 until adapter.itemCount) {
            return false
        }

        val currentHolder =
            recycler.findViewHolderForAdapterPosition(current)
                as? Holder

        pendingVerticalTopPx =
            currentHolder?.itemView?.top ?: 0

        logicalVerticalRow = target
        pendingVerticalRow = target
        pendingVerticalZone = focusedZone
        pendingVerticalAnchorMs = focusedProgramAnchorMs
        verticalFocusRetries = 0

        layoutManager.scrollToPositionWithOffset(
            target,
            pendingVerticalTopPx
        )

        scheduleVerticalFocus()
        return true
    }

    private fun scheduleVerticalFocus() {
        if (verticalFocusPosted) return

        verticalFocusPosted = true

        recycler.postOnAnimation {
            verticalFocusPosted = false

            val row = pendingVerticalRow

            if (row !in 0 until adapter.itemCount) {
                return@postOnAnimation
            }

            val holder =
                recycler.findViewHolderForAdapterPosition(row)
                    as? Holder

            if (holder == null) {
                if (
                    verticalFocusRetries <
                    maxVerticalFocusRetries
                ) {
                    verticalFocusRetries++

                    layoutManager.scrollToPositionWithOffset(
                        row,
                        pendingVerticalTopPx
                    )

                    recycler.post {
                        scheduleVerticalFocus()
                    }
                }

                return@postOnAnimation
            }

            val targetView =
                if (pendingVerticalZone == "program") {
                    findProgramForAnchor(
                        holder,
                        pendingVerticalAnchorMs
                    ) ?: holder.station
                } else {
                    holder.station
                }

            if (!targetView.requestFocus()) {
                if (
                    verticalFocusRetries <
                    maxVerticalFocusRetries
                ) {
                    verticalFocusRetries++

                    recycler.post {
                        scheduleVerticalFocus()
                    }
                }
            } else {
                verticalFocusRetries = 0
            }
        }
    }
    private fun ensureProgramVisible(
        holder: Holder,
        leftPx: Int,
        widthPx: Int
    ) {
        val viewportWidth =
            holder.programViewport.width

        if (viewportWidth <= 0) return

        var next =
            horizontalOffsetPx

        if (leftPx < next) {
            next =
                max(
                    0,
                    leftPx - px(40f)
                )
        } else if (
            leftPx + widthPx >
            next + viewportWidth
        ) {
            next =
                max(
                    0,
                    leftPx -
                        px(40f)
                )
        }

        val maxOffset =
            max(
                0,
                guideWidthPx() -
                    viewportWidth
            )

        next =
            next.coerceIn(
                0,
                maxOffset
            )

        if (next == horizontalOffsetPx) {
            return
        }

        horizontalOffsetPx = next
        applyHorizontalOffset()
        emitHorizontalOffset()
    }

    private fun applyHorizontalOffset() {
        headerViewport.scrollTo(horizontalOffsetPx, 0)

        for (i in 0 until recycler.childCount) {
            val child =
                recycler.getChildAt(i)

            val holder =
                recycler.getChildViewHolder(child)
                    as? Holder
                    ?: continue

            holder.programViewport.scrollTo(horizontalOffsetPx, 0)
        }
    }

    @Suppress("DEPRECATION")
    private fun emit(
        name: String,
        payload: com.facebook.react.bridge.WritableMap
    ) {
        val reactContext =
            context as? ReactContext
                ?: return

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

    // V788T8Q2_PINNED_HEADER_SYNC
    private fun emitHorizontalOffset() {
        val payload = Arguments.createMap()

        payload.putDouble(
            "offset",
            horizontalOffsetPx / density.toDouble()
        )

        emit(
            "topHorizontalScroll",
            payload
        )
    }
    private fun emitFocus(
        row: Int,
        zone: String,
        programIndex: Int,
        anchorMs: Long?
    ) {
        val payload =
            Arguments.createMap()

        payload.putInt(
            "index",
            row
        )

        payload.putString(
            "zone",
            zone
        )

        payload.putInt(
            "programIndex",
            programIndex
        )

        if (anchorMs != null) {
            payload.putDouble(
                "anchorMs",
                anchorMs.toDouble()
            )
        }

        // W121ZSY15A_SELECTOR_DIAG
        android.util.Log.d(
            "PSTVSEL",
            "EMIT_FOCUS " +
                "row=$row zone=$zone " +
                "program=$programIndex"
        )

        emit(
            "topItemFocus",
            payload
        )
    }

    private fun emitPress(
        row: Int,
        zone: String,
        programIndex: Int
    ) {
        val payload =
            Arguments.createMap()

        payload.putInt(
            "index",
            row
        )

        payload.putString(
            "zone",
            zone
        )

        payload.putInt(
            "programIndex",
            programIndex
        )

        emit(
            "topItemPress",
            payload
        )
    }

    private fun stationBackground(
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
                px(
                    if (focused) 2f
                    else 1f
                ),
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

    private fun programBackground(
        focused: Boolean,
        current: Boolean
    ): GradientDrawable =
        GradientDrawable().apply {
            shape =
                GradientDrawable.RECTANGLE

            cornerRadius =
                px(6f).toFloat()

            setColor(
                when {
                    focused ->
                        Color.argb(
                            77,
                            184,
                            160,
                            92
                        )

                    current ->
                        Color.argb(
                            51,
                            184,
                            160,
                            92
                        )

                    else ->
                        Color.rgb(
                            28,
                            28,
                            28
                        )
                }
            )

            setStroke(
                px(2f),
                if (focused) {
                    Color.rgb(
                        184,
                        160,
                        92
                    )
                } else {
                    Color.TRANSPARENT
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

    // =====================================================
    // V788T8S_SINGLE_ROW_FOCUS
    //
    // Exactly one native focus owner exists per RecyclerView
    // item: Holder.root.
    //
    // Up/Down is NOT intercepted here. Android RecyclerView
    // owns vertical navigation and recycling.
    //
    // Left/Right changes only the logical selection painted
    // inside the already-focused row.
    // =====================================================

    private fun programRangeMs(
        view: View
    ): Pair<Long, Long>? {
        val lp =
            view.layoutParams
                as? FrameLayout.LayoutParams
                ?: return null

        val slotPx =
            px(slotWidthDp).coerceAtLeast(1)

        val start =
            timelineStartMs +
                (
                    lp.leftMargin.toDouble() /
                        slotPx.toDouble() *
                        slotMs.toDouble()
                ).toLong()

        val end =
            timelineStartMs +
                (
                    (lp.leftMargin + lp.width)
                        .toDouble() /
                        slotPx.toDouble() *
                        slotMs.toDouble()
                ).toLong()

        return start to
                end.coerceAtLeast(start + 1L)
    }

    private fun programCenterMs(
        view: View
    ): Long {
        val range =
            programRangeMs(view)
                ?: return timelineStartMs

        return range.first +
            (range.second - range.first) / 2L
    }

    private fun programIsCurrent(
        view: View
    ): Boolean {
        val range =
            programRangeMs(view)
                ?: return false

        return nowMs >= range.first &&
                nowMs < range.second
    }

    private fun selectedProgramIndex(
        holder: Holder
    ): Int {
        if (holder.programViews.isEmpty()) {
            return -1
        }

        val end =
            timelineEndMs()

        val maxAnchor =
            max(
                timelineStartMs,
                end - 1L
            )

        val anchor =
            (focusedProgramAnchorMs ?: nowMs)
                .coerceIn(
                    timelineStartMs,
                    maxAnchor
                )

        var best = 0
        var bestDistance = Long.MAX_VALUE

        holder.programViews.forEachIndexed {
                index,
                view ->

            val range =
                programRangeMs(view)
                    ?: return@forEachIndexed

            val distance =
                when {
                    anchor < range.first ->
                        range.first - anchor

                    anchor >= range.second ->
                        anchor - range.second

                    else -> 0L
                }

            if (distance < bestDistance) {
                bestDistance = distance
                best = index
            }
        }

        return best
    }

    private fun ensureSelectedProgramVisible(
        holder: Holder,
        selected: View
    ) {
        val lp =
            selected.layoutParams
                as? FrameLayout.LayoutParams
                ?: return

        val viewportWidth =
            if (holder.programViewport.width > 0) {
                holder.programViewport.width
            } else {
                (
                    recycler.width -
                        px(channelWidthDp)
                ).coerceAtLeast(1)
            }

        if (viewportWidth <= 0) return

        val pad = px(16f)
        val left = lp.leftMargin
        val right = left + lp.width

        val maxOffset =
            (guideWidthPx() - viewportWidth)
                .coerceAtLeast(0)

        var next = horizontalOffsetPx

        if (left < next + pad) {
            next =
                (left - pad)
                    .coerceAtLeast(0)
        } else if (
            right >
                next + viewportWidth - pad
        ) {
            next =
                (
                    right - viewportWidth + pad
                ).coerceAtMost(maxOffset)
        }

        if (next != horizontalOffsetPx) {
            horizontalOffsetPx = next
            applyHorizontalOffset()
            emitHorizontalOffset()
        }
    }

    private fun renderRowSelection(
        holder: Holder,
        focused: Boolean,
        emitEvent: Boolean
    ) {
        val row =
            holder.bindingAdapterPosition

        // W121ZSY15A_SELECTOR_DIAG
        android.util.Log.d(
            "PSTVSEL",
            "RENDER " +
                "row=$row " +
                "focusedArg=$focused " +
                "rootHasFocus=${holder.root.hasFocus()} " +
                "stationHasFocus=${holder.station.hasFocus()} " +
                "zone=$focusedZone " +
                "emit=$emitEvent"
        )

        val validRow =
            row != RecyclerView.NO_POSITION

        var selectedProgram = -1

        if (
            focused &&
            focusedZone == "program" &&
            holder.programViews.isNotEmpty()
        ) {
            if (focusedProgramAnchorMs == null) {
                val end = timelineEndMs()

                focusedProgramAnchorMs =
                    nowMs.coerceIn(
                        timelineStartMs,
                        max(
                            timelineStartMs,
                            end - 1L
                        )
                    )
            }

            selectedProgram =
                selectedProgramIndex(holder)
        }

        holder.station.background =
            stationBackground(
                focused &&
                    focusedZone == "station"
            )

        holder.programViews.forEachIndexed {
                index,
                view ->

            view.background =
                programBackground(
                    focused &&
                        focusedZone == "program" &&
                        index == selectedProgram,
                    programIsCurrent(view)
                )
        }

        // V788T8U_TIME_COLUMN_OWNS_HORIZONTAL_SCROLL
        // Do not reposition by program width here.

        if (!emitEvent || !focused || !validRow) {
            return
        }

        if (
            focusedZone == "program" &&
            selectedProgram >= 0
        ) {
            emitFocus(
                row,
                "program",
                selectedProgram,
                focusedProgramAnchorMs
            )
        } else {
            focusedZone = "station"
            focusedProgramAnchorMs = null

            emitFocus(
                row,
                "station",
                -1,
                null
            )
        }
    }

    // V788T8U_TIME_COLUMN_NAV
    private fun timeSlotPx(): Int =
        px(slotWidthDp).coerceAtLeast(1)

    private fun maxTimeSlotIndex(): Int =
        (slotCount - 1).coerceAtLeast(0)

    private fun timeSlotFromAnchor(
        anchorMs: Long?
    ): Int {
        val maxSlot = maxTimeSlotIndex()

        if (anchorMs == null) {
            return (horizontalOffsetPx / timeSlotPx())
                    .coerceIn(0, maxSlot)
        }

        val safeSlotMs =
            slotMs.coerceAtLeast(1L)

        return (
                (
                    anchorMs - timelineStartMs
                ).coerceAtLeast(0L) / safeSlotMs
            ).toInt().coerceIn(0, maxSlot)
    }

    private fun applyTimeSlot(
        holder: Holder,
        requestedSlot: Int
    ) {
        val slot =
            requestedSlot.coerceIn(
                0,
                maxTimeSlotIndex()
            )

        val safeSlotMs =
            slotMs.coerceAtLeast(1L)

        focusedZone = "program"

        focusedProgramAnchorMs =
            timelineStartMs +
                slot.toLong() * safeSlotMs +
                safeSlotMs / 2L

        val viewportWidth =
            if (holder.programViewport.width > 0) {
                holder.programViewport.width
            } else {
                (
                    recycler.width -
                        px(channelWidthDp)
                ).coerceAtLeast(1)
            }

        val maxOffset =
            (guideWidthPx() - viewportWidth)
                .coerceAtLeast(0)

        horizontalOffsetPx =
            (slot * timeSlotPx())
                .coerceIn(0, maxOffset)

        applyHorizontalOffset()
        emitHorizontalOffset()

        renderRowSelection(
            holder,
            true,
            true
        )
    }

    private fun moveRowSelection(
        holder: Holder,
        direction: Int
    ): Boolean {
        if (!holder.root.hasFocus()) {
            return false
        }

        if (direction > 0) {
            if (focusedZone == "station") {
                timeEntrySlotIndex =
                    (horizontalOffsetPx / timeSlotPx())
                        .coerceIn(
                            0,
                            maxTimeSlotIndex()
                        )

                applyTimeSlot(
                    holder,
                    timeEntrySlotIndex
                )

                return true
            }

            val current =
                timeSlotFromAnchor(
                    focusedProgramAnchorMs
                )

            applyTimeSlot(
                holder,
                (current + 1)
                    .coerceAtMost(
                        maxTimeSlotIndex()
                    )
            )

            return true
        }

        if (direction < 0) {
            // IMPORTANT:
            // Left on CHANNEL is consumed.
            // Android spatial search must never steal focus.
            if (focusedZone == "station") {
                return true
            }

            val current =
                timeSlotFromAnchor(
                    focusedProgramAnchorMs
                )

            if (current <= timeEntrySlotIndex) {
                focusedZone = "station"
                focusedProgramAnchorMs = null

                renderRowSelection(
                    holder,
                    true,
                    true
                )

                return true
            }

            applyTimeSlot(
                holder,
                current - 1
            )

            return true
        }

        return false
    }

    // V788T8Y_R3_CENTER_POSITION_FALLBACK
    private fun emitRowPress(
        holder: Holder
    ) {
        var row =
            holder.bindingAdapterPosition

        if (
            row == RecyclerView.NO_POSITION
        ) {
            row =
                recycler
                    .getChildAdapterPosition(
                        holder.root
                    )
        }

        if (row !in 0 until adapter.itemCount) {
            row = focusedRow
        }

        if (row !in 0 until adapter.itemCount) {
            row = logicalVerticalRow
        }

        if (row !in 0 until adapter.itemCount) {
            return
        }

        emitPress(
            row,
            "station",
            -1
        )
    }

    private inner class Holder(
        val root: LinearLayout,
        val station: LinearLayout,
        val logo: ImageView,
        val fallback: ImageView,
        val title: TextView,
        val badge: FrameLayout,
        val programViewport: FrameLayout,
        val programCanvas: FrameLayout
    ) : RecyclerView.ViewHolder(root) {

        val programViews =
            ArrayList<View>()
    }

    private inner class GuideAdapter :
        RecyclerView.Adapter<Holder>() {

        private val data =
            ArrayList<GuideItem>()

        fun sameData(
            next: List<GuideItem>
        ): Boolean =
            data == next

        // V788T8X_DIRECT_BOOKMARK_VISIBILITY
        fun updateFavoritesOnly(
            next: List<GuideItem>
        ): Boolean {
            if (data.size != next.size) {
                return false
            }

            // Favorite must be the ONLY difference.
            for (i in next.indices) {
                val current = data[i]
                val incoming = next[i]

                if (
                    current.key != incoming.key ||
                    current.title != incoming.title ||
                    current.logo != incoming.logo ||
                    current.programs != incoming.programs
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
                        // V788T8ZB_REALTIME_ALPHA_BOOKMARK
                        holder.badge.visibility =
                            View.VISIBLE

                        holder.badge.alpha =
                            if (incoming.favorite) {
                                1f
                            } else {
                                0f
                            }

                        // Draw only. Never request/rebind row.
                        holder.badge.invalidate()
                        holder.badge.postInvalidateOnAnimation()
                        holder.station.invalidate()
                        holder.station.postInvalidateOnAnimation()
                    }

                    changed = true
                }
            }

            return changed
        }

        // V788T12D_FOCUS_SAFE_DIFF_UPDATE
        //
        // Inventory growth must not invalidate every visible holder.
        // Channels already present retain identity through GuideItem.key.
        // DiffUtil therefore reports insert/change operations instead of
        // notifyDataSetChanged(), allowing RecyclerView to keep the
        // currently focused holder alive while background inventory grows.
        fun replace(
            next: List<GuideItem>
        ) {
            val previous =
                ArrayList(data)

            val diff =
                androidx.recyclerview.widget.DiffUtil.calculateDiff(
                    object :
                        androidx.recyclerview.widget.DiffUtil.Callback() {

                        override fun getOldListSize(): Int =
                            previous.size

                        override fun getNewListSize(): Int =
                            next.size

                        override fun areItemsTheSame(
                            oldItemPosition: Int,
                            newItemPosition: Int
                        ): Boolean =
                            previous[oldItemPosition].key ==
                                next[newItemPosition].key

                        override fun areContentsTheSame(
                            oldItemPosition: Int,
                            newItemPosition: Int
                        ): Boolean =
                            previous[oldItemPosition] ==
                                next[newItemPosition]
                    },

                    // Existing A-Z rows retain relative ordering while
                    // new channels are inserted between them. Move
                    // detection is unnecessary and adds UI-thread work
                    // on lower-powered Fire TV hardware.
                    false
                )

            data.clear()
            data.addAll(next)

            diff.dispatchUpdatesTo(this)
        }

        fun itemAt(
            position: Int
        ): GuideItem? =
            data.getOrNull(position)

        fun indexOfKey(
            key: String
        ): Int =
            data.indexOfFirst {
                it.key == key
            }

        override fun getItemCount(): Int =
            data.size

        override fun onCreateViewHolder(
            parent: ViewGroup,
            viewType: Int
        ): Holder {

            val root =
                LinearLayout(context).apply {
                    id = View.generateViewId()

                    orientation =
                        LinearLayout.HORIZONTAL

                    clipChildren = true
                    clipToPadding = true

                    isFocusable = true
                    isFocusableInTouchMode = false
                    isClickable = true

                    descendantFocusability =
                        ViewGroup.FOCUS_BLOCK_DESCENDANTS
                }

            val station =
                LinearLayout(context).apply {
                    id = View.generateViewId()

                    orientation =
                        LinearLayout.HORIZONTAL

                    gravity =
                        Gravity.CENTER_VERTICAL

                    isFocusable = false
                    isFocusableInTouchMode = false
                    isClickable = false

                    descendantFocusability =
                        ViewGroup.FOCUS_BLOCK_DESCENDANTS

                    setPadding(
                        px(8f),
                        0,
                        px(8f),
                        0
                    )

                    background =
                        stationBackground(false)
                }

            val logoFrame =
                FrameLayout(context)

            val logoFrameLp =
                LinearLayout.LayoutParams(
                    px(84f),
                    px(48f)
                )

            logoFrameLp.marginEnd =
                px(8f)

            station.addView(
                logoFrame,
                logoFrameLp
            )

            val logo =
                ImageView(context).apply {
                    scaleType =
                        ImageView.ScaleType.FIT_CENTER

                    isFocusable = false
                }

            logoFrame.addView(
                logo,
                FrameLayout.LayoutParams(
                    px(80f),
                    px(44f),
                    Gravity.CENTER
                )
            )

            // V789S13C_INCOGNITO_TV_FALLBACK
            // Missing station logos use the same gold TV visual language as
            // the Live TV tray icon, with the Privastream incognito mark
            // baked into the TV. The old gold "TV" text fallback is removed.
            val fallback =
                ImageView(context).apply {
                    setImageResource(
                        R.drawable.pstv_live_tv_incognito_fallback
                    )

                    scaleType =
                        ImageView.ScaleType.FIT_CENTER

                    isFocusable = false
                }

            logoFrame.addView(
                fallback,
                FrameLayout.LayoutParams(
                    px(56f),
                    px(36f),
                    Gravity.CENTER
                )
            )

            val title =
                TextView(context).apply {
                    setTextColor(Color.WHITE)

                    textSize = 16f

                    setTypeface(
                        typeface,
                        Typeface.BOLD
                    )

                    maxLines = 1

                    ellipsize =
                        TextUtils.TruncateAt.END

                    isFocusable = false
                }

            station.addView(
                title,
                LinearLayout.LayoutParams(
                    0,
                    LayoutParams.WRAP_CONTENT,
                    1f
                )
            )

            // V788T8ZB_ALWAYS_LAID_OUT_BOOKMARK
            val badge =
                FrameLayout(context).apply {
                    background =
                        badgeBackground()

                    // Never use GONE here.
                    // Keep geometry resident so realtime add
                    // requires drawing only, not row layout.
                    visibility =
                        View.VISIBLE

                    alpha = 0f

                    isFocusable = false
                }

            val badgeLp =
                LinearLayout.LayoutParams(
                    px(20f),
                    px(20f)
                )

            badgeLp.marginStart =
                px(8f)

            // V788T8X_BARE_GOLD_BOOKMARK
            badge.background = null
            badge.setPadding(0, 0, 0, 0)

            station.addView(
                badge,
                badgeLp
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
                    px(22f),
                    px(22f),
                    Gravity.CENTER
                )
            )

            root.addView(
                station,
                LinearLayout.LayoutParams(
                    px(channelWidthDp),
                    px(rowHeightDp)
                )
            )

            val programViewport =
                FrameLayout(context).apply {
                    clipChildren = true
                    clipToPadding = true

                    setBackgroundColor(
                        Color.rgb(
                            17,
                            17,
                            17
                        )
                    )
                }

            val programCanvas =
                FrameLayout(context).apply {
                    clipChildren = false
                    clipToPadding = false
                }

            programViewport.addView(
                programCanvas,
                FrameLayout.LayoutParams(
                    guideWidthPx(),
                    px(rowHeightDp)
                )
            )

            root.addView(
                programViewport,
                LinearLayout.LayoutParams(
                    0,
                    px(rowHeightDp),
                    1f
                )
            )

            return Holder(
                root,
                station,
                logo,
                fallback,
                title,
                badge,
                programViewport,
                programCanvas
            )
        }

        override fun onBindViewHolder(
            holder: Holder,
            position: Int
        ) {
            val item =
                data[position]

            holder.root.layoutParams =
                RecyclerView.LayoutParams(
                    LayoutParams.MATCH_PARENT,
                    px(rowHeightDp)
                )

            holder.station.layoutParams =
                LinearLayout.LayoutParams(
                    px(channelWidthDp),
                    px(rowHeightDp)
                )

            holder.title.text =
                item.title

            // V788T8ZB_BIND_ALPHA_BOOKMARK
            holder.badge.visibility =
                View.VISIBLE

            holder.badge.alpha =
                if (item.favorite) {
                    1f
                } else {
                    0f
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

            // W121ZSY15A_SELECTOR_DIAG
            android.util.Log.d(
                "PSTVSEL",
                "BIND_BEFORE " +
                    "position=$position " +
                    "adapterRow=${holder.bindingAdapterPosition} " +
                    "rootHasFocus=${holder.root.hasFocus()} " +
                    "stationHasFocus=${holder.station.hasFocus()} " +
                    "zone=$focusedZone"
            )

            holder.station.background =
                stationBackground(
                    holder.station.hasFocus()
                )

            holder.station.nextFocusLeftId =
                holder.station.id

            holder.station.setOnFocusChangeListener {
                    view,
                    focused ->

                view.background =
                    stationBackground(focused)

                if (focused) {
                    val row =
                        holder.bindingAdapterPosition

                    if (
                        row !=
                        RecyclerView.NO_POSITION
                    ) {
                        focusedRow = row
                        logicalVerticalRow = row
                        focusedZone = "station"
                        focusedProgramAnchorMs = null

                        emitFocus(
                            row,
                            "station",
                            -1,
                            null
                        )
                    }
                }
            }

            holder.station.setOnClickListener {
                val row =
                    holder.bindingAdapterPosition

                if (
                    row !=
                    RecyclerView.NO_POSITION
                ) {
                    emitPress(
                        row,
                        "station",
                        -1
                    )
                }
            }

            bindPrograms(
                holder,
                item
            )

            // V788T8S_ONE_FOCUS_OWNER_PER_ROW
            holder.root.setOnFocusChangeListener {
                    _,
                    focused ->

                val row =
                    holder.bindingAdapterPosition

                // W121ZSY15A_SELECTOR_DIAG
                android.util.Log.d(
                    "PSTVSEL",
                    "ROOT_FOCUS " +
                        "row=$row " +
                        "focused=$focused " +
                        "rootHasFocus=${holder.root.hasFocus()} " +
                        "stationHasFocus=${holder.station.hasFocus()} " +
                        "zone=$focusedZone"
                )

                if (
                    focused &&
                    row != RecyclerView.NO_POSITION
                ) {
                    focusedRow = row
                    logicalVerticalRow = row

                    renderRowSelection(
                        holder,
                        true,
                        true
                    )
                } else {
                    renderRowSelection(
                        holder,
                        false,
                        false
                    )
                }
            }

            holder.root.setOnClickListener {
                emitRowPress(holder)
            }

            // V788T8U_DETERMINISTIC_ROW_KEYS
            holder.root.setOnKeyListener {
                    _,
                    keyCode,
                    event ->

                when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_UP
                        ) {
                            emitRowPress(holder)
                        }

                        true
                    }

                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_DOWN
                        ) {
                            moveRowSelection(
                                holder,
                                -1
                            )
                        }

                        true
                    }

                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_DOWN
                        ) {
                            moveRowSelection(
                                holder,
                                1
                            )
                        }

                        true
                    }

                    // W121ZSY35_DETERMINISTIC_ROOT_VERTICAL_NAV
                    //
                    // Do not delegate vertical focus search to RecyclerView.
                    // The root row is the actual focus owner, so move one
                    // adapter row deterministically and consume the key.
                    KeyEvent.KEYCODE_DPAD_UP -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_DOWN
                        ) {
                            moveRootVertical(
                                holder,
                                -1
                            )
                        } else {
                            true
                        }
                    }

                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_DOWN
                        ) {
                            moveRootVertical(
                                holder,
                                1
                            )
                        } else {
                            true
                        }
                    }

                    else -> false
                }
            }

            renderRowSelection(
                holder,
                holder.root.hasFocus(),
                false
            )

            // W121ZSY15A_SELECTOR_DIAG
            android.util.Log.d(
                "PSTVSEL",
                "BIND_AFTER " +
                    "position=$position " +
                    "adapterRow=${holder.bindingAdapterPosition} " +
                    "rootHasFocus=${holder.root.hasFocus()} " +
                    "stationHasFocus=${holder.station.hasFocus()} " +
                    "zone=$focusedZone"
            )
        }

        private fun bindPrograms(
            holder: Holder,
            item: GuideItem
        ) {
            holder.programCanvas.removeAllViews()
            holder.programViews.clear()

            holder.programCanvas.layoutParams =
                FrameLayout.LayoutParams(
                    guideWidthPx(),
                    px(rowHeightDp)
                )

            holder.programViewport.scrollTo(horizontalOffsetPx, 0)

            val visible =
                ArrayList<Pair<Int, ProgramItem>>()

            val endOfTimeline =
                timelineEndMs()

            item.programs.forEachIndexed {
                    index,
                    program ->

                if (
                    program.endMs >
                        timelineStartMs &&
                    program.startMs <
                        endOfTimeline
                ) {
                    visible.add(
                        index to program
                    )
                }
            }

            if (visible.isEmpty()) {
                val noGuide =
                    TextView(context).apply {
                        id =
                            View.generateViewId()

                        text =
                            "No guide data"

                        setTextColor(
                            Color.rgb(
                                102,
                                102,
                                102
                            )
                        )

                        textSize = 14f

                        gravity =
                            Gravity.CENTER_VERTICAL

                        setPadding(
                            px(14f),
                            0,
                            0,
                            0
                        )

                        isFocusable = false
                        isClickable = false

                        tag =
                            ProgramTag(
                                -1,
                                timelineStartMs,
                                endOfTimeline
                            )

                        background =
                            programBackground(
                                false,
                                false
                            )
                    }

                val lp =
                    FrameLayout.LayoutParams(
                        guideWidthPx(),
                        px(rowHeightDp - 8f)
                    )

                lp.topMargin =
                    px(4f)

                holder.programCanvas.addView(
                    noGuide,
                    lp
                )

                holder.programViews.add(
                    noGuide
                )

                noGuide.nextFocusLeftId =
                    holder.station.id

                noGuide.nextFocusRightId =
                    noGuide.id

                noGuide.setOnFocusChangeListener {
                        view,
                        focused ->

                    view.background =
                        programBackground(
                            focused,
                            false
                        )

                    if (focused) {
                        val row =
                            holder.bindingAdapterPosition

                        if (
                            row !=
                            RecyclerView.NO_POSITION
                        ) {
                            focusedRow = row
                        logicalVerticalRow = row
                            focusedZone = "program"

                            focusedProgramAnchorMs =
                                timelineStartMs

                            emitFocus(
                                row,
                                "program",
                                -1,
                                timelineStartMs
                            )
                        }
                    }
                }

                noGuide.setOnClickListener {
                    val row =
                        holder.bindingAdapterPosition

                    if (
                        row !=
                        RecyclerView.NO_POSITION
                    ) {
                        emitPress(
                            row,
                            "program",
                            -1
                        )
                    }
                }

                holder.station.nextFocusRightId =
                    noGuide.id

                return
            }

            for (
                visibleIndex in
                visible.indices
            ) {
                val pair =
                    visible[visibleIndex]

                val originalIndex =
                    pair.first

                val program =
                    pair.second

                val clippedStart =
                    max(
                        program.startMs,
                        timelineStartMs
                    )

                val clippedEnd =
                    min(
                        program.endMs,
                        endOfTimeline
                    )

                val leftDp =
                    (
                        (
                            clippedStart -
                                timelineStartMs
                        ).toDouble() /
                            slotMs.toDouble() *
                            slotWidthDp.toDouble()
                    ).toFloat()

                val widthDp =
                    max(
                        4f,
                        (
                            (
                                clippedEnd -
                                    clippedStart
                            ).toDouble() /
                                slotMs.toDouble() *
                                slotWidthDp.toDouble()
                        ).toFloat() - 4f
                    )

                val current =
                    nowMs >= program.startMs &&
                        nowMs < program.endMs

                val cell =
                    TextView(context).apply {
                        id =
                            View.generateViewId()

                        text =
                            program.title.ifBlank {
                                "Programming"
                            }

                        setTextColor(Color.WHITE)

                        textSize =
                            if (widthDp < 80f) {
                                12f
                            } else {
                                15f
                            }

                        setTypeface(
                            typeface,
                            Typeface.BOLD
                        )

                        gravity =
                            Gravity.CENTER_VERTICAL

                        setPadding(
                            px(12f),
                            0,
                            px(12f),
                            0
                        )

                        maxLines = 1

                        ellipsize =
                            TextUtils.TruncateAt.END

                        isFocusable = false
                        isClickable = false

                        tag =
                            ProgramTag(
                                originalIndex,
                                clippedStart,
                                clippedEnd
                            )

                        background =
                            programBackground(
                                false,
                                current
                            )
                    }

                val lp =
                    FrameLayout.LayoutParams(
                        px(widthDp),
                        px(rowHeightDp - 6f)
                    )

                lp.leftMargin =
                    px(leftDp)

                lp.topMargin =
                    px(3f)

                holder.programCanvas.addView(
                    cell,
                    lp
                )

                holder.programViews.add(
                    cell
                )

                cell.setOnFocusChangeListener {
                        view,
                        focused ->

                    view.background =
                        programBackground(
                            focused,
                            current
                        )

                    if (focused) {
                        val row =
                            holder.bindingAdapterPosition

                        if (
                            row ==
                            RecyclerView.NO_POSITION
                        ) {
                            return@setOnFocusChangeListener
                        }

                        val tag =
                            view.tag as?
                                ProgramTag
                                ?: return@setOnFocusChangeListener

                        val anchor =
                            tag.startMs +
                                (
                                    tag.endMs -
                                        tag.startMs
                                ) / 2L

                        focusedRow = row
                        logicalVerticalRow = row
                        focusedZone = "program"

                        focusedProgramAnchorMs =
                            anchor

                        ensureProgramVisible(
                            holder,
                            lp.leftMargin,
                            lp.width
                        )

                        emitFocus(
                            row,
                            "program",
                            tag.index,
                            anchor
                        )
                    }
                }

                cell.setOnClickListener {
                    val row =
                        holder.bindingAdapterPosition

                    if (
                        row ==
                        RecyclerView.NO_POSITION
                    ) {
                        return@setOnClickListener
                    }

                    val tag =
                        cell.tag as?
                            ProgramTag
                            ?: return@setOnClickListener

                    emitPress(
                        row,
                        "program",
                        tag.index
                    )
                }
            }

            val programViews =
                holder.programViews

            if (programViews.isNotEmpty()) {
                holder.station.nextFocusRightId =
                    programViews.first().id

                programViews.forEachIndexed {
                        index,
                        view ->

                    view.nextFocusLeftId =
                        if (index == 0) {
                            holder.station.id
                        } else {
                            programViews[index - 1].id
                        }

                    view.nextFocusRightId =
                        if (
                            index ==
                            programViews.lastIndex
                        ) {
                            view.id
                        } else {
                            programViews[index + 1].id
                        }
                }
            }
        }

        override fun onViewRecycled(
            holder: Holder
        ) {
            // W121ZSY15A_SELECTOR_DIAG
            android.util.Log.d(
                "PSTVSEL",
                "RECYCLE " +
                    "row=${holder.bindingAdapterPosition} " +
                    "rootHasFocus=${holder.root.hasFocus()} " +
                    "stationHasFocus=${holder.station.hasFocus()} " +
                    "zone=$focusedZone"
            )

            // W121ZSY30_FOCUSED_HOLDER_RECYCLE_RECOVERY
            //
            // W121ZSY29 captured RecyclerView recycling the exact
            // row root that Android had just focused. The holder then
            // retained focus with bindingAdapterPosition == NO_POSITION,
            // leaving the selector invisible while the app/window still
            // owned Android focus.
            //
            // Do not alter normal Up/Down focus search. Recover only
            // this impossible state, and only if Android has not already
            // landed on another valid adapter row by the next frame.
            val recycledRow =
                holder.bindingAdapterPosition

            val recycledHadRootFocus =
                holder.root.hasFocus()

            val recycledKey =
                if (
                    recycledRow in
                        0 until adapter.itemCount
                ) {
                    adapter.itemAt(
                        recycledRow
                    )?.key
                } else {
                    null
                }

            val recycledZone =
                focusedZone

            val recycledAnchor =
                focusedProgramAnchorMs

            if (
                recycledHadRootFocus &&
                recycledRow in
                    0 until adapter.itemCount
            ) {
                android.util.Log.w(
                    "PSTVSEL",
                    "FOCUSED_RECYCLE_DETECTED " +
                        "row=$recycledRow " +
                        "key=$recycledKey " +
                        "zone=$recycledZone"
                )

                recycler.postOnAnimation {
                    val actualFocus =
                        recycler.findFocus()

                    val actualHolder =
                        actualFocus?.let {
                                focusedView ->
                            recycler
                                .findContainingViewHolder(
                                    focusedView
                                ) as? Holder
                        }

                    val actualRow =
                        actualHolder
                            ?.bindingAdapterPosition
                            ?: RecyclerView.NO_POSITION

                    if (
                        actualRow in
                            0 until adapter.itemCount
                    ) {
                        android.util.Log.d(
                            "PSTVSEL",
                            "FOCUSED_RECYCLE_RECOVERY_SKIP " +
                                "validRow=$actualRow"
                        )

                        return@postOnAnimation
                    }

                    val recoveryRow =
                        recycledKey
                            ?.let {
                                adapter.indexOfKey(it)
                            }
                            ?.takeIf {
                                it in
                                    0 until adapter.itemCount
                            }
                            ?: recycledRow
                                .takeIf {
                                    it in
                                        0 until adapter.itemCount
                                }
                            ?: RecyclerView.NO_POSITION

                    if (
                        recoveryRow ==
                            RecyclerView.NO_POSITION
                    ) {
                        android.util.Log.w(
                            "PSTVSEL",
                            "FOCUSED_RECYCLE_RECOVERY_ABORT " +
                                "oldRow=$recycledRow " +
                                "key=$recycledKey"
                        )

                        return@postOnAnimation
                    }

                    android.util.Log.w(
                        "PSTVSEL",
                        "FOCUSED_RECYCLE_RECOVERY_APPLY " +
                            "oldRow=$recycledRow " +
                            "recoveryRow=$recoveryRow " +
                            "key=$recycledKey " +
                            "zone=$recycledZone"
                    )

                    focusRow(
                        recoveryRow,
                        recycledZone,
                        recycledAnchor
                    )
                }
            }

            holder.station.setOnFocusChangeListener(
                null
            )

            holder.station.setOnClickListener(
                null
            )

            holder.programViews.forEach {
                it.setOnFocusChangeListener(null)
                it.setOnClickListener(null)
            }

            holder.programViews.clear()
            holder.programCanvas.removeAllViews()

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