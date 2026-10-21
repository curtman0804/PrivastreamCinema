package com.privastream.cinema

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.events.RCTEventEmitter
import kotlin.math.roundToInt

/**
 * V789N_NATIVE_CATEGORY_ROW
 *
 * Dedicated Live TV category rail.
 *
 * Horizontal navigation intentionally follows the same native
 * visible-column model used by PrivastreamTVRowView:
 *
 *  - React Native spatial LEFT/RIGHT search is not used.
 *  - Android's actual focused adapter item is authoritative.
 *  - One key event advances exactly one adapter position.
 *  - Focus walks through visible columns.
 *  - Beyond the anchor column, content moves one exact stride
 *    while the selector remains in the same physical column.
 *  - Held/repeated input is queued while RecyclerView attaches
 *    the next target.
 *
 * This class does not own Live TV vertical navigation.
 */
class PrivastreamCategoryRowView(
    context: Context
) : FrameLayout(context) {

    data class RowItem(
        val id: String,
        val label: String,
        val selected: Boolean
    )

    private val layoutManager =
        LinearLayoutManager(
            context,
            RecyclerView.HORIZONTAL,
            false
        )

    private val rowAdapter =
        CategoryAdapter()

    private val recycler =
        RecyclerView(context).apply {
            layoutManager = this@PrivastreamCategoryRowView.layoutManager
            adapter = rowAdapter
            itemAnimator = null
            clipToPadding = false
            isFocusable = false
            descendantFocusability =
                ViewGroup.FOCUS_AFTER_DESCENDANTS
            overScrollMode = View.OVER_SCROLL_NEVER
        }

    private var itemWidthDp = 156f
    private var itemHeightDp = 46f
    private var gapDp = 12f
    private var leftPaddingDp = 0f
    private var rightPaddingDp = 320f
    private var anchorColumn = 5

    private var preferredFocusIndex = 0
    private var focusRequest = ""
    private var active = false

    // V789S6_SUPPRESS_POST_SELECT_CATEGORY_REACQUIRE
    // After OK selects a category, the next owner is the guide. Any queued
    // preferred-focus work must not steal Android focus back from guide row 0.
    // A real future category entry (inactive -> active) clears this gate.
    private var suppressFocusReacquire = false

    // Same ownership principle as the poster row:
    // logical position advances from input, but actual Android
    // focus is re-read before each movement.
    private var logicalFocusPosition = -1

    // V598B / V720 style pending horizontal handoff.
    private var pendingHorizontalTarget = -1
    private var pendingHorizontalDirection = 0
    private var pendingHorizontalTargetLeftPx = Int.MIN_VALUE
    private var pendingHorizontalRetryPosted = false
    private var pendingHorizontalRetryCount = 0

    private var queuedHorizontalDirection = 0
    private var queuedHorizontalSteps = 0

    private var physicalHorizontalDirection = 0

    // V789N_R13_ENTRY_FOCUS_EVENT_TRUTH
    //
    // requestFocus() can report success even when RecyclerView does
    // not deliver another OnFocusChange callback for the same attached
    // category view. Track the last focus event that actually reached
    // our normal listener so entry can repair only a missing event.
    private var lastFocusEventPosition = -1

    private val maxPendingHorizontalFocusRetries = 8

    init {
        isFocusable = false
        descendantFocusability =
            ViewGroup.FOCUS_AFTER_DESCENDANTS

        addView(
            recycler,
            LayoutParams(
                LayoutParams.MATCH_PARENT,
                LayoutParams.MATCH_PARENT
            )
        )
    }

    fun setItems(items: ReadableArray?) {
        val next = ArrayList<RowItem>()

        if (items != null) {
            for (index in 0 until items.size()) {
                val map =
                    try {
                        items.getMap(index)
                    } catch (_: Throwable) {
                        null
                    } ?: continue

                val id =
                    try {
                        if (
                            map.hasKey("id") &&
                            !map.isNull("id")
                        ) {
                            map.getString("id")
                                .orEmpty()
                        } else {
                            ""
                        }
                    } catch (_: Throwable) {
                        ""
                    }

                val label =
                    try {
                        if (
                            map.hasKey("label") &&
                            !map.isNull("label")
                        ) {
                            map.getString("label")
                                .orEmpty()
                        } else {
                            id
                        }
                    } catch (_: Throwable) {
                        id
                    }

                val selected =
                    try {
                        map.hasKey("selected") &&
                            !map.isNull("selected") &&
                            map.getBoolean("selected")
                    } catch (_: Throwable) {
                        false
                    }

                next.add(
                    RowItem(
                        id = id,
                        label = label,
                        selected = selected
                    )
                )
            }
        }

        rowAdapter.submit(next)

        if (
            logicalFocusPosition >=
                rowAdapter.itemCount
        ) {
            logicalFocusPosition =
                rowAdapter.itemCount - 1
        }

        // V789N_CATEGORY_PRESERVE_FOCUS_ON_DATA
        //
        // A selected-state update must not reset LEFT/RIGHT
        // position. Android's actual focused holder wins.
        recycler.post {
            if (active) {
                val actual =
                    currentAdapterFocus()

                if (
                    actual in
                        0 until
                        rowAdapter.itemCount
                ) {
                    logicalFocusPosition =
                        actual
                } else {
                    requestPreferredFocus()
                }
            }
        }
    }

    fun setItemWidth(value: Float) {
        itemWidthDp =
            value.coerceAtLeast(40f)

        rowAdapter.notifyDataSetChanged()
    }

    fun setItemHeight(value: Float) {
        itemHeightDp =
            value.coerceAtLeast(28f)

        rowAdapter.notifyDataSetChanged()
    }

    fun setGap(value: Float) {
        gapDp =
            value.coerceAtLeast(0f)

        rowAdapter.notifyDataSetChanged()
    }

    fun setLeftPadding(value: Float) {
        leftPaddingDp =
            value.coerceAtLeast(0f)

        rowAdapter.notifyDataSetChanged()
    }

    fun setRightPadding(value: Float) {
        rightPaddingDp =
            value.coerceAtLeast(0f)

        rowAdapter.notifyDataSetChanged()
    }

    fun setAnchorColumn(value: Int) {
        anchorColumn =
            value.coerceAtLeast(0)
    }

    // W121ZNAV145E2: preferredFocusIndex is an entry/fallback hint, not
    // an instruction to override Android's already-focused category.
    fun setPreferredFocusIndex(value: Int) {
        if (preferredFocusIndex == value) return
        preferredFocusIndex = value

        recycler.post {
            if (active && currentAdapterFocus() !in 0 until rowAdapter.itemCount) {
                requestPreferredFocus()
            }
        }
    }

    fun setFocusRequest(value: String?) {
        val next =
            value.orEmpty()

        if (next == focusRequest) {
            return
        }

        focusRequest = next

        recycler.post {
            if (active) {
                requestPreferredFocus()
            }
        }
    }

    fun setActive(value: Boolean) {
        if (active == value) {
            // V789Q2_ACTIVE_TRUE_NO_REFOCUS
            //
            // A repeated active=true prop update must not reacquire category
            // focus. Runtime proof showed this path repeatedly fighting the
            // guide handoff after category selection.
            applyAttachedItemFocusability(
                value
            )

            return
        }

        active = value

        if (active) {
            // V789S6_SUPPRESS_POST_SELECT_CATEGORY_REACQUIRE
            // This is a genuine new category-entry transaction.
            suppressFocusReacquire =
                false
        }

        Log.e(
            "PSCATEGORY",
            "ACTIVE " +
                "value=$value " +
                "preferred=$preferredFocusIndex " +
                "items=${rowAdapter.itemCount} " +
                "children=${recycler.childCount}"
        )

        if (!active) {
            clearPendingHorizontal(
                "CATEGORY_INACTIVE"
            )

            logicalFocusPosition =
                -1

            physicalHorizontalDirection =
                0

            lastFocusEventPosition =
                -1
        }

        // V789N_R9_DIRECT_ATTACHED_FOCUS
        //
        // The existing attached item roots are the views Android
        // must actually focus. Change them directly.
        applyAttachedItemFocusability(
            active
        )

        // V789N_R20_VALID_ADAPTER_ENTRY
        //
        // Activating/deactivating category mode does not change the
        // category data set. The attached item roots have already
        // received their focusability state directly above.
        //
        // Do NOT notifyDataSetChanged() here: R19 proved that doing
        // so invalidates binding adapter positions exactly while
        // entry focus is being acquired.
        recycler.requestLayout()

        recycler.postOnAnimation {
            applyAttachedItemFocusability(
                active
            )

            if (active) {
                requestPreferredFocus()
            }
        }
    }
    private fun px(dp: Float): Int =
        (
            dp *
                resources.displayMetrics.density
        ).roundToInt()

    private fun stridePx(): Int =
        px(itemWidthDp + gapDp)

    private fun anchorOffsetPx(): Int =
        px(leftPaddingDp) +
            anchorColumn * stridePx()

    private fun currentAdapterFocus(): Int {
        val focused =
            recycler.focusedChild

        if (focused != null) {
            val position =
                recycler.getChildAdapterPosition(
                    focused
                )

            if (
                position !=
                RecyclerView.NO_POSITION
            ) {
                return position
            }
        }

        val direct =
            recycler.findFocus()

        if (direct != null) {
            val holder =
                recycler.findContainingViewHolder(
                    direct
                )

            if (
                holder != null &&
                holder.bindingAdapterPosition !=
                    RecyclerView.NO_POSITION
            ) {
                return holder.bindingAdapterPosition
            }
        }

        return -1
    }

    // V789N_R9_DIRECT_ATTACHED_FOCUS
    //
    // RecyclerView already has visible category item views attached.
    // Do not depend on notifyDataSetChanged() to eventually rebind
    // isFocusable. Apply the category-mode focus state directly to
    // every attached item root.
    private fun applyAttachedItemFocusability(
        value: Boolean
    ) {
        for (
            index in
            0 until recycler.childCount
        ) {
            val child =
                recycler.getChildAt(index)
                    ?: continue

            child.isFocusable =
                value

            child.isFocusableInTouchMode =
                false

            if (child is ViewGroup) {
                child.descendantFocusability =
                    ViewGroup.FOCUS_BLOCK_DESCENDANTS
            }
        }

        Log.e(
            "PSCATEGORY",
            "ATTACHED_FOCUSABILITY " +
                "value=$value " +
                "childCount=${recycler.childCount}"
        )
    }
    private fun enqueueOrMoveHorizontal(
        delta: Int
    ) {
        if (!active) return

        if (
            pendingHorizontalTarget < 0
        ) {
            moveHorizontal(delta)
            return
        }

        if (
            queuedHorizontalSteps == 0 ||
            queuedHorizontalDirection ==
                delta
        ) {
            queuedHorizontalDirection =
                delta

            queuedHorizontalSteps += 1
        } else {
            queuedHorizontalDirection =
                delta

            queuedHorizontalSteps = 1
        }

        Log.d(
            "PSCATEGORY",
            "HORIZONTAL_REPEAT_QUEUED " +
                "delta=$delta " +
                "pending=$pendingHorizontalTarget " +
                "queuedDirection=" +
                queuedHorizontalDirection +
                " queuedSteps=" +
                queuedHorizontalSteps
        )
    }

    private fun clearPendingHorizontal(
        reason: String
    ) {
        if (
            pendingHorizontalTarget >= 0 ||
            queuedHorizontalSteps > 0
        ) {
            Log.d(
                "PSCATEGORY",
                "HORIZONTAL_PENDING_CLEAR " +
                    "reason=$reason " +
                    "pending=" +
                    pendingHorizontalTarget +
                    " queuedDirection=" +
                    queuedHorizontalDirection +
                    " queuedSteps=" +
                    queuedHorizontalSteps
            )
        }

        pendingHorizontalTarget = -1
        pendingHorizontalDirection = 0
        pendingHorizontalTargetLeftPx =
            Int.MIN_VALUE
        pendingHorizontalRetryPosted =
            false
        pendingHorizontalRetryCount = 0
        queuedHorizontalDirection = 0
        queuedHorizontalSteps = 0
    }

    private fun drainQueuedHorizontalAfterFocus(
        position: Int
    ) {
        if (
            position !=
            pendingHorizontalTarget
        ) {
            return
        }

        pendingHorizontalTarget = -1
        pendingHorizontalDirection = 0
        pendingHorizontalTargetLeftPx =
            Int.MIN_VALUE
        pendingHorizontalRetryPosted =
            false
        pendingHorizontalRetryCount = 0

        if (
            queuedHorizontalSteps <= 0
        ) {
            queuedHorizontalDirection = 0
            return
        }

        val delta =
            queuedHorizontalDirection

        queuedHorizontalSteps -= 1

        if (
            queuedHorizontalSteps == 0
        ) {
            queuedHorizontalDirection = 0
        }

        recycler.postOnAnimation {
            if (
                active &&
                recycler.hasFocus()
            ) {
                moveHorizontal(delta)
            }
        }
    }

    private fun schedulePendingHorizontalFocus() {
        if (
            pendingHorizontalRetryPosted
        ) {
            return
        }

        pendingHorizontalRetryPosted =
            true

        recycler.postOnAnimation {
            pendingHorizontalRetryPosted =
                false

            val target =
                pendingHorizontalTarget

            if (
                target !in
                    0 until
                    rowAdapter.itemCount
            ) {
                clearPendingHorizontal(
                    "TARGET_INVALID"
                )

                return@postOnAnimation
            }

            if (
                !active ||
                !recycler.hasFocus()
            ) {
                clearPendingHorizontal(
                    "ROW_NO_LONGER_FOCUSED"
                )

                return@postOnAnimation
            }

            val holder =
                recycler
                    .findViewHolderForAdapterPosition(
                        target
                    )

            if (holder != null) {
                try {
                    holder.itemView
                        .isSoundEffectsEnabled =
                        false
                } catch (_: Throwable) {
                }

                val direction =
                    pendingHorizontalDirection

                if (
                    holder.itemView.requestFocus()
                ) {
                    playHorizontalNavigationSound(
                        direction
                    )

                    return@postOnAnimation
                }
            }

            pendingHorizontalRetryCount += 1

            if (
                pendingHorizontalRetryCount >=
                maxPendingHorizontalFocusRetries
            ) {
                val actual =
                    currentAdapterFocus()

                clearPendingHorizontal(
                    "FOCUS_RETRY_EXHAUSTED"
                )

                if (
                    actual in
                        0 until
                        rowAdapter.itemCount
                ) {
                    logicalFocusPosition =
                        actual
                }

                return@postOnAnimation
            }

            if (
                pendingHorizontalRetryCount == 1
            ) {
                positionHorizontalTarget(
                    target,
                    pendingHorizontalTargetLeftPx
                )
            }

            schedulePendingHorizontalFocus()
        }
    }

    /**
     * V789N_R13_VARIABLE_WIDTH_SCROLLBY
     *
     * Same ownership model as the proven On Demand poster rail:
     *
     * - Android's actual focused adapter item is authoritative.
     * - One LEFT/RIGHT advances exactly one adapter position.
     * - Inside the visible window, focus walks normally.
     * - At the anchor/boundary, RecyclerView content is physically
     *   moved BEFORE the adjacent item receives focus.
     *
     * Unlike posters, category buttons have variable widths.
     * Therefore the scroll distance is the actual rendered child
     * span (width + margins), not a guessed fixed stride.
     */
    private fun horizontalRenderedSpanPx(
        view: View
    ): Int {
        val margins =
            view.layoutParams as?
                ViewGroup.MarginLayoutParams

        return (
            view.width +
                (margins?.leftMargin ?: 0) +
                (margins?.rightMargin ?: 0)
            )
            .coerceAtLeast(1)
    }

    private fun moveHorizontal(delta: Int) {
        val count =
            rowAdapter.itemCount

        if (count <= 0) return

        var current =
            logicalFocusPosition

        val actualBeforeMove =
            currentAdapterFocus()

        if (
            actualBeforeMove in
                0 until count
        ) {
            current =
                actualBeforeMove
        }

        if (
            current !in
                0 until count
        ) {
            current = 0
        }

        logicalFocusPosition =
            current

        val target =
            (current + delta)
                .coerceIn(
                    0,
                    count - 1
                )

        if (target == current) {
            return
        }

        val currentView =
            layoutManager
                .findViewByPosition(
                    current
                )

        if (currentView == null) {
            logicalFocusPosition =
                current

            Log.e(
                "PSCATEGORY",
                "R13_CURRENT_VIEW_MISS " +
                    "current=$current " +
                    "target=$target " +
                    "delta=$delta"
            )

            return
        }

        val firstVisible =
            layoutManager
                .findFirstVisibleItemPosition()

        val lastVisible =
            layoutManager
                .findLastVisibleItemPosition()

        val currentColumn =
            if (
                firstVisible !=
                    RecyclerView.NO_POSITION
            ) {
                (current - firstVisible)
                    .coerceAtLeast(0)
            } else {
                0
            }

        val targetViewBeforeScroll =
            layoutManager
                .findViewByPosition(
                    target
                )

        val targetAttachedBeforeScroll =
            targetViewBeforeScroll != null &&
                target >= firstVisible &&
                target <= lastVisible

        // V789N_R15_EXACT_EIGHT_CLICK_ANCHOR
        //
        // Entry target is US Channels at index 1.
        //
        // RIGHT 1  -> News
        // RIGHT 2  -> Sports
        // RIGHT 3  -> Movies
        // RIGHT 4  -> Entertainment
        // RIGHT 5  -> Kids
        // RIGHT 6  -> Crime
        // RIGHT 7  -> Reality
        // RIGHT 8  -> Comedy
        //
        // Those first eight RIGHT presses move focus only.
        //
        // RIGHT 9 is Comedy -> Lifestyle. That is the first
        // press that physically scrolls the category rail.
        //
        // When returning LEFT from positions beyond Comedy,
        // reverse the viewport movement until Comedy is back
        // inside the original stationary section.
        // V789N_R17_SYMMETRIC_EIGHT_CLICK_ANCHOR
        //
        // RIGHT:
        //
        // Enter on US Channels at index 1.
        // Eight RIGHT presses move only focus:
        //
        //   1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9
        //
        // Index 9 is Comedy.
        // The ninth RIGHT, 9 -> 10, begins viewport movement.
        //
        // LEFT:
        //
        // At the far-right item, eight LEFT presses must also move
        // only focus. With 24 categories (0..23), that walks:
        //
        //   23 -> 22 -> 21 -> 20 -> 19 -> 18 -> 17 -> 16 -> 15
        //
        // The ninth LEFT, 15 -> 14, begins viewport movement.
        //
        // Derive that left anchor from item count so the exact
        // eight-focus-step behavior survives if categories are
        // added or removed later.
        val stationaryRightEdgePosition =
            9

        val stationaryLeftEdgePosition =
            (count - 9)
                .coerceAtLeast(
                    0
                )

        val shouldMoveContent =
            when {
                delta > 0 ->
                    current >=
                        stationaryRightEdgePosition

                delta < 0 ->
                    firstVisible > 0 &&
                        current <=
                            stationaryLeftEdgePosition

                else ->
                    false
            }

        // Preserve the selector's current physical X when the
        // content itself must move.
        val targetLeftPx =
            currentView.left

        var scrollDx =
            0

        if (shouldMoveContent) {
            scrollDx =
                if (delta > 0) {
                    // The next item sits immediately after current.
                    // Move exactly the rendered current span left.
                    horizontalRenderedSpanPx(
                        currentView
                    )
                } else {
                    // Prefer the exact previous item's rendered span
                    // when it is still attached. If it is just outside
                    // the viewport, current span is sufficient to expose
                    // the adjacent previous item; the existing focus
                    // fallback then positions it at targetLeftPx.
                    -(
                        targetViewBeforeScroll
                            ?.let {
                                horizontalRenderedSpanPx(
                                    it
                                )
                            }
                            ?: horizontalRenderedSpanPx(
                                currentView
                            )
                        )
                }
        }

        Log.d(
            "PSCATEGORY",
            "R13_VISIBLE_MOVE " +
                "delta=$delta " +
                "from=$current " +
                "to=$target " +
                "first=$firstVisible " +
                "last=$lastVisible " +
                "column=$currentColumn " +
                "targetAttachedBefore=" +
                targetAttachedBeforeScroll +
                " moveContent=" +
                shouldMoveContent +
                " stationaryRightEdge=" +
                stationaryRightEdgePosition +
                " stationaryLeftEdge=" +
                stationaryLeftEdgePosition +
                " currentLeft=" +
                currentView.left +
                " scrollDx=$scrollDx"
        )

        if (scrollDx != 0) {
            // Exact mechanism proven by PrivastreamTVRowView.
            recycler.scrollBy(
                scrollDx,
                0
            )

            Log.d(
                "PSCATEGORY",
                "R13_SCROLL_APPLIED " +
                    "delta=$delta " +
                    "from=$current " +
                    "to=$target " +
                    "scrollDx=$scrollDx " +
                    "firstAfter=" +
                    layoutManager
                        .findFirstVisibleItemPosition() +
                    " lastAfter=" +
                    layoutManager
                        .findLastVisibleItemPosition() +
                    " targetAttachedAfter=" +
                    (
                        layoutManager
                            .findViewByPosition(
                                target
                            ) != null
                        )
            )
        }

        logicalFocusPosition =
            target

        focusAttachedPosition(
            target,
            delta,
            if (shouldMoveContent) {
                targetLeftPx
            } else {
                layoutManager
                    .findViewByPosition(
                        target
                    )
                    ?.left
                    ?: targetLeftPx
            }
        )
    }
    private fun focusAttachedPosition(
        position: Int,
        direction: Int,
        targetLeftPx: Int
    ) {
        if (
            position !in
                0 until
                rowAdapter.itemCount
        ) {
            return
        }

        val holder =
            recycler
                .findViewHolderForAdapterPosition(
                    position
                )

        if (holder != null) {
            try {
                holder.itemView
                    .isSoundEffectsEnabled =
                    false
            } catch (_: Throwable) {
            }

            if (
                holder.itemView.requestFocus()
            ) {
                playHorizontalNavigationSound(
                    direction
                )

                return
            }
        }

        pendingHorizontalTarget =
            position

        pendingHorizontalDirection =
            direction

        pendingHorizontalTargetLeftPx =
            targetLeftPx

        pendingHorizontalRetryCount =
            0

        positionHorizontalTarget(
            position,
            targetLeftPx
        )

        schedulePendingHorizontalFocus()
    }

    private fun positionHorizontalTarget(
        position: Int,
        targetLeftPx: Int
    ) {
        if (
            position !in
                0 until
                rowAdapter.itemCount ||
            targetLeftPx ==
                Int.MIN_VALUE
        ) {
            return
        }

        val layoutOffset =
            if (position == 0) {
                targetLeftPx -
                    px(leftPaddingDp)
            } else {
                targetLeftPx
            }

        layoutManager
            .scrollToPositionWithOffset(
                position,
                layoutOffset
            )
    }

    private fun snapToOrigin() {
        recycler.stopScroll()

        layoutManager
            .scrollToPositionWithOffset(
                0,
                0
            )

        recycler.post {
            recycler.stopScroll()

            layoutManager
                .scrollToPositionWithOffset(
                    0,
                    0
                )
        }
    }

    private fun positionForTarget(
        position: Int
    ) {
        if (
            position <=
                anchorColumn
        ) {
            snapToOrigin()
        } else {
            layoutManager
                .scrollToPositionWithOffset(
                    position,
                    anchorOffsetPx()
                )
        }
    }

    private fun requestPreferredFocus() {
        if (suppressFocusReacquire) {
            Log.d(
                "PSCATEGORY",
                "V789S6_FOCUS_REACQUIRE_SUPPRESSED"
            )

            return
        }

        if (!active) {
            Log.d(
                "PSCATEGORY",
                "ENTRY_FOCUS_SKIP inactive"
            )

            return
        }

        val count =
            rowAdapter.itemCount

        if (count <= 0) {
            Log.d(
                "PSCATEGORY",
                "ENTRY_FOCUS_SKIP no_items"
            )

            return
        }

        val target =
            preferredFocusIndex
                .coerceIn(
                    0,
                    count - 1
                )

        logicalFocusPosition =
            target

        positionForTarget(
            target
        )

        Log.d(
            "PSCATEGORY",
            "ENTRY_FOCUS_REQUEST " +
                "target=$target " +
                "count=$count " +
                "width=${recycler.width} " +
                "height=${recycler.height}"
        )

        requestPreferredFocusAttempt(
            target,
            0
        )
    }

    // V789N_R9_DIRECT_ATTACHED_FOCUS
    private fun requestPreferredFocusAttempt(
        target: Int,
        attempt: Int
    ) {
        if (
            !active ||
            suppressFocusReacquire ||
            target !in
                0 until
                rowAdapter.itemCount
        ) {
            return
        }

        val delayMs =
            if (attempt == 0) {
                0L
            } else {
                40L
            }

        recycler.postDelayed(
            {
                if (
                    !active ||
                    target !in
                        0 until
                        rowAdapter.itemCount
                ) {
                    return@postDelayed
                }

                // The attached layout child is authoritative.
                // This remains available even when RecyclerView
                // has pending adapter-update bookkeeping.
                val layoutView =
                    layoutManager
                        .findViewByPosition(
                            target
                        )

                val layoutHolder =
                    recycler
                        .findViewHolderForLayoutPosition(
                            target
                        )

                val adapterHolder =
                    recycler
                        .findViewHolderForAdapterPosition(
                            target
                        )

                // V789N_R20_VALID_ADAPTER_ENTRY
                //
                // A layout-position child is not sufficient for
                // category navigation. The item key/focus handlers
                // use getChildAdapterPosition(), so accepting focus
                // while RecyclerView reports NO_POSITION creates the
                // split state seen in R19:
                //
                //   visual selector = US Channels
                //   Android focus   = another category
                //
                // Only accept the target after RecyclerView exposes
                // it as the real adapter-position holder.
                val candidate =
                    adapterHolder
                        ?.itemView
                        ?.takeIf {
                            recycler
                                .getChildAdapterPosition(
                                    it
                                ) ==
                                target
                        }

                Log.e(
                    "PSCATEGORY",
                    "ENTRY_FOCUS_ATTEMPT " +
                        "target=$target " +
                        "attempt=$attempt " +
                        "children=${recycler.childCount} " +
                        "first=" +
                        layoutManager
                            .findFirstVisibleItemPosition() +
                        " last=" +
                        layoutManager
                            .findLastVisibleItemPosition() +
                        " layoutView=" +
                        (layoutView != null) +
                        " layoutHolder=" +
                        (layoutHolder != null) +
                        " adapterHolder=" +
                        (adapterHolder != null) +
                        " candidate=" +
                        (candidate != null) +
                        " candidateAdapterPosition=" +
                        (
                            candidate
                                ?.let {
                                    recycler
                                        .getChildAdapterPosition(
                                            it
                                        )
                                }
                                ?: RecyclerView.NO_POSITION
                            )
                )

                if (candidate != null) {
                    candidate.isFocusable =
                        true

                    candidate
                        .isFocusableInTouchMode =
                        false

                    candidate.visibility =
                        View.VISIBLE

                    if (candidate is ViewGroup) {
                        candidate.descendantFocusability =
                            ViewGroup.FOCUS_BLOCK_DESCENDANTS
                    }

                    val accepted =
                        candidate.requestFocus()

                    Log.e(
                        "PSCATEGORY",
                        "ENTRY_FOCUS_RESULT " +
                            "target=$target " +
                            "attempt=$attempt " +
                            "accepted=$accepted " +
                            "candidateFocusable=" +
                            candidate.isFocusable +
                            " candidateHasFocus=" +
                            candidate.hasFocus() +
                            " recyclerHasFocus=" +
                            recycler.hasFocus()
                    )

                    if (accepted) {
                        logicalFocusPosition =
                            target

                        if (
                            candidate.hasFocus() &&
                            lastFocusEventPosition !=
                                target
                        ) {
                            // V789N_R13_ENTRY_FOCUS_EVENT_TRUTH
                            //
                            // Android owns the correct target, but the
                            // normal listener did not fire. Restore only
                            // the exact existing focused appearance/event.
                            candidate.background =
                                pillBackground(
                                    true,
                                    target ==
                                        preferredFocusIndex
                                )

                            candidate.scaleX =
                                1f

                            candidate.scaleY =
                                1f

                            lastFocusEventPosition =
                                target

                            Log.e(
                                "PSCATEGORY",
                                "ENTRY_FOCUS_EVENT_FALLBACK " +
                                    "target=$target " +
                                    "attempt=$attempt"
                            )

                            emitItemFocus(
                                target,
                                candidate
                            )
                        }

                        Log.e(
                            "PSCATEGORY",
                            "ENTRY_FOCUS_ACQUIRED " +
                                "target=$target " +
                                "attempt=$attempt"
                        )

                        return@postDelayed
                    }
                }

                if (attempt >= 12) {
                    Log.e(
                        "PSCATEGORY",
                        "ENTRY_FOCUS_FAILED " +
                            "target=$target " +
                            "children=${recycler.childCount} " +
                            "first=" +
                            layoutManager
                                .findFirstVisibleItemPosition() +
                            " last=" +
                            layoutManager
                                .findLastVisibleItemPosition()
                    )

                    return@postDelayed
                }

                if (
                    attempt == 2 ||
                    attempt == 6
                ) {
                    positionForTarget(
                        target
                    )

                    recycler.requestLayout()
                }

                recycler.postOnAnimation {
                    applyAttachedItemFocusability(
                        true
                    )

                    requestPreferredFocusAttempt(
                        target,
                        attempt + 1
                    )
                }
            },
            delayMs
        )
    }
    private fun playHorizontalNavigationSound(
        direction: Int
    ) {
        if (direction == 0) return

        try {
            val reactContext =
                context as?
                    ReactContext

            val activity =
                reactContext
                    ?.currentActivity as?
                    MainActivity

            activity
                ?.v643bNativeHorizontalMove(
                    direction
                )
        } catch (_: Throwable) {
        }
    }

    private fun emitItemFocus(
        position: Int,
        view: View
    ) {
        val reactContext =
            context as?
                ReactContext
                ?: return

        val event =
            Arguments.createMap().apply {
                putInt(
                    "index",
                    position
                )

                putDouble(
                    "x",
                    view.x.toDouble()
                )

                putDouble(
                    "y",
                    view.y.toDouble()
                )

                putDouble(
                    "width",
                    view.width.toDouble()
                )

                putDouble(
                    "height",
                    view.height.toDouble()
                )
            }

        reactContext
            .getJSModule(
                RCTEventEmitter::class.java
            )
            .receiveEvent(
                id,
                "topItemFocus",
                event
            )
    }

    private fun emitItemPress(
        position: Int
    ) {
        val reactContext =
            context as?
                ReactContext
                ?: return

        val event =
            Arguments.createMap().apply {
                putInt(
                    "index",
                    position
                )
            }

        reactContext
            .getJSModule(
                RCTEventEmitter::class.java
            )
            .receiveEvent(
                id,
                "topItemPress",
                event
            )
    }

    private fun emitRowBlur() {
        val reactContext =
            context as?
                ReactContext
                ?: return

        reactContext
            .getJSModule(
                RCTEventEmitter::class.java
            )
            .receiveEvent(
                id,
                "topRowBlur",
                Arguments.createMap()
            )
    }

    // V789N_R7_ORIGINAL_BUTTON_VISUALS
    //
    // Match the pre-native React Native category appearance:
    //
    // background #171717
    // border #333 / 2dp
    // selected #B8A05C
    // focused white / 3dp
    // radius 8dp
    // horizontal padding 14dp
    // text 14sp bold
    // focus scale 1.04
    private fun pillBackground(
        focused: Boolean,
        selected: Boolean
    ): GradientDrawable {
        return GradientDrawable().apply {
            shape =
                GradientDrawable.RECTANGLE

            cornerRadius =
                px(8f).toFloat()

            setColor(
                if (selected) {
                    Color.rgb(
                        184,
                        160,
                        92
                    )
                } else {
                    Color.rgb(
                        23,
                        23,
                        23
                    )
                }
            )

            when {
                focused && selected ->
                    // W121ZPLAY10Y16_SELECTED_FOCUS_WHITE
                    setStroke(
                        px(2f),
                        Color.WHITE
                    )

                focused ->
                    // V789S13B_MEDIUM_PLUS_GOLD_CATEGORY_FOCUS
                    // 2dp keeps the selector clearly visible while staying below the old heavy 3dp outline.
                    setStroke(
                        px(2f),
                        Color.rgb(
                            184,
                            160,
                            92
                        )
                    )

                selected ->
                    setStroke(
                        px(2f),
                        Color.rgb(
                            184,
                            160,
                            92
                        )
                    )

                else ->
                    setStroke(
                        px(2f),
                        Color.rgb(
                            51,
                            51,
                            51
                        )
                    )
            }
        }
    }

    // V789N_R9_SEPARATE_FAVORITES_STAR
    //
    // Preserve the original category structure:
    // a separate 17sp star, 7dp gap, then category text.
    private fun applyLabelAppearance(
        star: TextView,
        label: TextView,
        item: RowItem
    ) {
        val selectedTextColor =
            Color.rgb(
                12,
                12,
                12
            )

        val normalTextColor =
            Color.rgb(
                229,
                229,
                229
            )

        val gold =
            Color.rgb(
                184,
                160,
                92
            )

        star.text =
            "\u2605"

        star.textSize =
            17f

        star.setTypeface(
            Typeface.DEFAULT,
            Typeface.BOLD
        )

        star.setTextColor(
            if (item.selected) {
                selectedTextColor
            } else {
                gold
            }
        )

        star.visibility =
            if (
                item.id == "favorites"
            ) {
                View.VISIBLE
            } else {
                View.GONE
            }

        label.text =
            item.label

        label.textSize =
            14f

        label.setTypeface(
            Typeface.DEFAULT,
            Typeface.BOLD
        )

        label.setTextColor(
            if (item.selected) {
                selectedTextColor
            } else {
                normalTextColor
            }
        )
    }

    private fun measuredItemWidthPx(
        star: TextView,
        label: TextView,
        item: RowItem
    ): Int {
        val labelWidth =
            label.paint.measureText(
                item.label
            )

        val favoriteExtra =
            if (
                item.id == "favorites"
            ) {
                star.paint.measureText(
                    "\u2605"
                ) +
                    px(7f)
            } else {
                0f
            }

        return (
            labelWidth +
                favoriteExtra +
                px(28f)
            )
            .roundToInt()
            .coerceAtLeast(
                px(36f)
            )
    }
    private inner class Holder(
        val root: FrameLayout,
        val star: TextView,
        val label: TextView
    ) : RecyclerView.ViewHolder(root)
    private inner class CategoryAdapter :
        RecyclerView.Adapter<Holder>() {

        private val data =
            ArrayList<RowItem>()

        // V789S4_STABLE_SELECTED_STATE_UPDATE
        //
        // Category identity/order is static during an ordinary selection.
        // Do not invalidate every holder just because two selected flags
        // changed. Runtime proof showed notifyDataSetChanged() leaving visible
        // layout children attached while their adapter positions were invalid,
        // which made category re-entry fail after a category switch.
        fun submit(
            items: List<RowItem>
        ) {
            val sameStructure =
                data.size == items.size &&
                    data.indices.all { index ->
                        data[index].id ==
                            items[index].id
                    }

            if (sameStructure) {
                for (
                    index in
                    items.indices
                ) {
                    val next =
                        items[index]

                    if (
                        data[index] !=
                        next
                    ) {
                        data[index] =
                            next

                        // W121ZPLAY10Y23A_SUBMIT_SELECTED_VISUAL_SYNC
                        // JS-driven selected-state changes must repaint
                        // already-attached category holders immediately.
                        val holder =
                            (
                                recycler
                                    .findViewHolderForAdapterPosition(
                                        index
                                    )
                                    as? Holder
                            )
                                ?: (
                                    recycler
                                        .findViewHolderForLayoutPosition(
                                            index
                                        )
                                        as? Holder
                                )

                        if (holder != null) {
                            applyLabelAppearance(
                                holder.star,
                                holder.label,
                                next
                            )

                            holder.root.background =
                                pillBackground(
                                    holder.root.hasFocus(),
                                    next.selected
                                )

                            holder.root.invalidate()
                            holder.root.postInvalidateOnAnimation()
                        }

                        notifyItemChanged(
                            index
                        )
                    }
                }

                return
            }

            data.clear()
            data.addAll(items)
            notifyDataSetChanged()
        }

        // V789S4_IMMEDIATE_NATIVE_SELECTION
        // V789S7_SINGLE_GOLD_VISUAL_COMMIT
        //
        // S4 updates the adapter data immediately so the newly selected pill
        // turns gold before the JS round-trip. S6 then hands focus to the guide
        // quickly enough that RecyclerView can defer the notifyItemChanged()
        // rebind for the pill that was just deselected. React subsequently sees
        // the already-correct adapter data and has no logical change to rebind,
        // which leaves that old attached pill visually gold.
        //
        // Commit the visual state of every changed attached holder synchronously
        // before the guide handoff. Adapter-position lookup is preferred; layout
        // position is the runtime-proven fallback while RecyclerView is settling.
        fun selectPosition(
            position: Int
        ) {
            if (
                position !in
                    data.indices
            ) {
                return
            }

            for (
                index in
                data.indices
            ) {
                val current =
                    data[index]

                val shouldSelect =
                    index == position

                if (
                    current.selected !=
                        shouldSelect
                ) {
                    val next =
                        current.copy(
                            selected =
                                shouldSelect
                        )

                    data[index] =
                        next

                    val holder =
                        (
                            recycler
                                .findViewHolderForAdapterPosition(
                                    index
                                )
                                as? Holder
                        )
                            ?:
                            (
                                recycler
                                    .findViewHolderForLayoutPosition(
                                        index
                                    )
                                    as? Holder
                            )

                    if (holder != null) {
                        applyLabelAppearance(
                            holder.star,
                            holder.label,
                            next
                        )

                        holder.root.background =
                            pillBackground(
                                holder.root.hasFocus(),
                                next.selected
                            )

                        Log.d(
                            "PSCATEGORY",
                            "V789S7_SELECTION_VISUAL " +
                                "position=$index " +
                                "selected=${next.selected} " +
                                "focused=${holder.root.hasFocus()}"
                        )
                    }

                    // Keep RecyclerView's normal bind contract intact for
                    // off-screen holders and any later layout pass.
                    notifyItemChanged(
                        index
                    )
                }
            }
        }

        override fun getItemCount(): Int =
            data.size

        override fun onCreateViewHolder(
            parent: ViewGroup,
            viewType: Int
        ): Holder {
            val root =
                FrameLayout(context).apply {
                    isFocusable =
                        active

                    isFocusableInTouchMode =
                        false

                    isClickable =
                        false

                    isSoundEffectsEnabled =
                        false

                    clipChildren =
                        false

                    clipToPadding =
                        false

                    descendantFocusability =
                        ViewGroup.FOCUS_BLOCK_DESCENDANTS

                    importantForAccessibility =
                        View.IMPORTANT_FOR_ACCESSIBILITY_YES

                    // Original RN category button:
                    // paddingHorizontal: 14
                    setPadding(
                        px(14f),
                        0,
                        px(14f),
                        0
                    )
                }

            val content =
                LinearLayout(context).apply {
                    orientation =
                        LinearLayout.HORIZONTAL

                    gravity =
                        Gravity.CENTER

                    isFocusable =
                        false

                    descendantFocusability =
                        ViewGroup.FOCUS_BLOCK_DESCENDANTS
                }

            // Original Favorites used a separate Ionicons star
            // at size 17 followed by a 7dp gap.
            val star =
                TextView(context).apply {
                    text =
                        "\u2605"

                    textSize =
                        17f

                    gravity =
                        Gravity.CENTER

                    includeFontPadding =
                        false

                    isFocusable =
                        false
                }

            val label =
                TextView(context).apply {
                    gravity =
                        Gravity.CENTER

                    includeFontPadding =
                        false

                    maxLines =
                        1

                    textSize =
                        14f

                    isFocusable =
                        false
                }

            content.addView(
                star,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.MATCH_PARENT
                ).apply {
                    marginEnd =
                        px(7f)
                }
            )

            content.addView(
                label,
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT,
                    LinearLayout.LayoutParams.MATCH_PARENT
                )
            )

            root.addView(
                content,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
            root.setOnKeyListener {
                    view,
                    keyCode,
                    event ->

                val position =
                    recycler
                        .getChildAdapterPosition(
                            view
                        )

                if (
                    position ==
                        RecyclerView.NO_POSITION
                ) {
                    return@setOnKeyListener false
                }

                when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_LEFT -> {
                        when (event.action) {
                            KeyEvent.ACTION_DOWN -> {
                                // V789S6_USER_CATEGORY_NAV_REARMS_FOCUS
                                suppressFocusReacquire =
                                    false

                                physicalHorizontalDirection =
                                    -1

                                enqueueOrMoveHorizontal(
                                    -1
                                )
                            }

                            KeyEvent.ACTION_UP -> {
                                if (
                                    physicalHorizontalDirection ==
                                        -1
                                ) {
                                    physicalHorizontalDirection =
                                        0
                                }

                                queuedHorizontalDirection =
                                    0

                                queuedHorizontalSteps =
                                    0
                            }
                        }

                        true
                    }

                    KeyEvent.KEYCODE_DPAD_RIGHT -> {
                        when (event.action) {
                            KeyEvent.ACTION_DOWN -> {
                                // V789S6_USER_CATEGORY_NAV_REARMS_FOCUS
                                suppressFocusReacquire =
                                    false

                                physicalHorizontalDirection =
                                    1

                                enqueueOrMoveHorizontal(
                                    1
                                )
                            }

                            KeyEvent.ACTION_UP -> {
                                if (
                                    physicalHorizontalDirection ==
                                        1
                                ) {
                                    physicalHorizontalDirection =
                                        0
                                }

                                queuedHorizontalDirection =
                                    0

                                queuedHorizontalSteps =
                                    0
                            }
                        }

                        true
                    }

                    KeyEvent.KEYCODE_DPAD_UP -> {
                        // Categories are the top navigation boundary.
                        // Consume UP so Android cannot escape upward.
                        true
                    }

                    KeyEvent.KEYCODE_DPAD_DOWN -> {
                        // V789Q2_GLOBAL_CATEGORY_DOWN_OWNER
                        //
                        // Consume Android spatial search here. The app-level
                        // TV handler is the one runtime-proven receiver of
                        // category DOWN and owns the guide handoff.
                        true
                    }

                    KeyEvent.KEYCODE_DPAD_CENTER,
                    KeyEvent.KEYCODE_ENTER,
                    KeyEvent.KEYCODE_NUMPAD_ENTER -> {
                        if (
                            event.action ==
                                KeyEvent.ACTION_UP
                        ) {
                            // V789S9_SELECT_STAYS_CATEGORY
                            // OK commits the selected category but does not hand
                            // Android focus to the guide. Keep category focus
                            // reacquisition enabled; DOWN is the only exit.
                            suppressFocusReacquire =
                                false

                            Log.d(
                                "PSCATEGORY",
                                "V789S9_SELECT_STAY position=$position"
                            )

                            // V789S4_IMMEDIATE_NATIVE_SELECTION
                            rowAdapter.selectPosition(
                                position
                            )

                            emitItemPress(
                                position
                            )
                        }

                        true
                    }

                    else ->
                        false
                }
            }

            root.onFocusChangeListener =
                View.OnFocusChangeListener {
                        view,
                        hasFocus ->

                    val position =
                        recycler
                            .getChildAdapterPosition(
                                view
                            )

                    if (
                        position ==
                            RecyclerView.NO_POSITION
                    ) {
                        return@OnFocusChangeListener
                    }

                    val item =
                        data[position]

                    root.background =
                        pillBackground(
                            hasFocus,
                            item.selected
                        )

                    applyLabelAppearance(
                        star,
                        label,
                        item
                    )

                    if (hasFocus) {
                        val actual =
                            currentAdapterFocus()

                        if (
                            actual in
                                0 until
                                rowAdapter.itemCount
                        ) {
                            logicalFocusPosition =
                                actual
                        } else {
                            logicalFocusPosition =
                                position
                        }

                        lastFocusEventPosition =
                            position

                        // Exact previous RN focus scale.
                        view.scaleX = 1f
                        view.scaleY = 1f

                        Log.d(
                            "PSCATEGORY",
                            "ITEM_FOCUS " +
                                "position=$position"
                        )

                        emitItemFocus(
                            position,
                            view
                        )

                        drainQueuedHorizontalAfterFocus(
                            position
                        )
                    } else {
                        view.scaleX = 1f
                        view.scaleY = 1f

                        recycler.post {
                            if (
                                !recycler.hasFocus()
                            ) {
                                clearPendingHorizontal(
                                    "ROW_BLUR"
                                )

                                logicalFocusPosition =
                                    -1

                                physicalHorizontalDirection =
                                    0

                                lastFocusEventPosition =
                                    -1

                                emitRowBlur()
                            }
                        }
                    }
                }
            return Holder(
                root,
                star,
                label
            )
        }

        override fun onBindViewHolder(
            holder: Holder,
            position: Int
        ) {
            val item =
                data[position]

            holder.root.isFocusable =
                active

            holder.root
                .isFocusableInTouchMode =
                false

            holder.root.descendantFocusability =
                ViewGroup.FOCUS_BLOCK_DESCENDANTS

            holder.root.contentDescription =
                item.label

            applyLabelAppearance(
                holder.star,
                holder.label,
                item
            )

            holder.root.background =
                pillBackground(
                    holder.root.hasFocus(),
                    item.selected
                )

            holder.root.scaleX =
                if (
                    holder.root.hasFocus()
                ) {
                    1f
                } else {
                    1f
                }

            holder.root.scaleY =
                if (
                    holder.root.hasFocus()
                ) {
                    1f
                } else {
                    1f
                }

            holder.root.layoutParams =
                RecyclerView.LayoutParams(
                    measuredItemWidthPx(
                        holder.star,
                        holder.label,
                        item
                    ),
                    px(itemHeightDp)
                ).apply {
                    leftMargin =
                        if (position == 0) {
                            px(leftPaddingDp)
                        } else {
                            0
                        }

                    // Exact old RN button spacing was 8dp.
                    rightMargin =
                        if (
                            position ==
                                data.lastIndex
                        ) {
                            px(rightPaddingDp)
                        } else {
                            px(gapDp)
                        }
                }
        }

    }
}