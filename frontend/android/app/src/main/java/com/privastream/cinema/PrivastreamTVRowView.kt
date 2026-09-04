package com.privastream.cinema

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Drawable
import android.text.TextUtils
import android.os.SystemClock
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.SoundEffectConstants
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.Priority
import com.bumptech.glide.load.engine.DiskCacheStrategy
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.util.LinkedHashMap
import kotlin.math.roundToInt

/**
 * V589_DETERMINISTIC_TV_FOCUS
 *
 * Horizontal TV navigation is deterministic:
 *  - LEFT/RIGHT are consumed HERE and can never escape into another row.
 *  - UP/DOWN are not consumed, so Android can move vertically between rails.
 *  - Held LEFT/RIGHT repeat events update one logical adapter position.
 *  - Positions 0..5 leave the list at the beginning.
 *  - Position 6+ stays pinned at the sixth visible card location.
 *
 * This also restores the visible gold focus border and rounded poster clipping.
 */
class PrivastreamTVRowView(context: Context) : FrameLayout(context) {

    data class RowItem(
        val id: String,
        val title: String,
        val poster: String?
    )

    private val density = resources.displayMetrics.density

    private var cardWidthDp: Float = 180f
    private var cardHeightDp: Float = 270f
    private var gapDp: Float = 16f
    private var leftPaddingDp: Float = 48f
    private var rightPaddingDp: Float = 1280f
    private var anchorColumn: Int = 5
    private var preferredFocusIndex: Int = -1
    private var preferredFocusApplied: Boolean = false

    // V591C_ROW_AWARE_DIAG
    // Diagnostic label only. No navigation behavior is changed.
    private var diagnosticLabel: String = "unknown-row"

    /**
     * Logical focus moves immediately when a key-repeat arrives.
     * Actual View focus is coalesced to the next frame. This prevents a busy
     * Firestick from queueing dozens of stale requestFocus() calls.
     */
    private var logicalFocusPosition: Int = -1
    private var pendingFocusPosition: Int = -1
    private var focusFramePosted: Boolean = false

    // V598B_CONTINUOUS_HORIZONTAL_HANDOFF
    //
    // A physical held D-pad can deliver the next repeat before RecyclerView
    // has attached the target holder. Never drop that repeat and never let
    // logical focus run ahead. Queue the exact input events until the forced
    // target holder is attached/focused, then drain them one step at a time.
    private var pendingHorizontalTarget: Int = -1
    private var pendingHorizontalDirection: Int = 0
    private var pendingHorizontalRetryPosted: Boolean = false

    // V600_PENDING_FOCUS_ESCAPE
    // A failed requestFocus must never become a permanent frame loop.
    // Give RecyclerView a short settle window, then abandon the stale
    // target and resync to the card Android actually still owns.
    private var pendingHorizontalRetryCount: Int = 0
    private val maxPendingHorizontalFocusRetries: Int = 12
    private var queuedHorizontalDirection: Int = 0
    private var queuedHorizontalSteps: Int = 0

    // V598C_EDGE_HOLD_CONTINUE
    //
    // Track the actual physical LEFT/RIGHT key state. If RIGHT reaches the
    // temporary end of the currently-loaded data while the key is still held,
    // remember that intent and resume automatically when an append arrives.
    private var physicalHorizontalDirection: Int = 0
    private var waitingForRightAppend: Boolean = false

    // V596_IMAGE_DIAG_ONLY
    private var imageBindSequence: Long = 0L

    // V594B_TRUE_ORIGIN_SAFE_PREFETCH
    // Avoid launching duplicate Glide preloads on every D-pad repeat.
    // V598G_DIRECTIONAL_RETURN_WARM
    // A poster warmed while moving RIGHT must still be eligible for a fresh
    // warm-up when direction reverses LEFT. The old global URL set suppressed
    // that reverse warm-up and is the reason LEFT could flash blank while
    // RIGHT stayed clean.
    private val preloadedPosterDirectionKeys = LinkedHashSet<String>()
    private var lastPreloadPosition: Int = -1
    private var lastPreloadDirection: Int = 0

    // V596_LAYOUT_MANAGER_FOCUS_CONTROL
    //
    // AndroidX RecyclerView.requestChildFocus() asks the LayoutManager whether
    // it wants to handle focus positioning. Returning true here suppresses the
    // LayoutManager's default "scroll focused child on screen" behavior.
    // LEFT/RIGHT positioning remains owned by moveHorizontal().
    private val layoutManager =
        object : LinearLayoutManager(context, RecyclerView.HORIZONTAL, false) {
            override fun onRequestChildFocus(
                parent: RecyclerView,
                state: RecyclerView.State,
                child: View,
                focused: View?
            ): Boolean {
                val p = parent.getChildAdapterPosition(child)

                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id LM_FOCUS_SUPPRESS " +
                        "position=$p offset=${parent.computeHorizontalScrollOffset()}"
                )

                return true
            }
        }

    private val recycler = object : RecyclerView(context) {

        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            when (event.keyCode) {
                KeyEvent.KEYCODE_DPAD_LEFT -> {
                    when (event.action) {
                        KeyEvent.ACTION_DOWN -> {
                            physicalHorizontalDirection = -1
                            waitingForRightAppend = false

                            Log.e(
                                "PSTVROW",
                                "row=\"$diagnosticLabel\" view=$id KEY LEFT repeat=${event.repeatCount}"
                            )
                            enqueueOrMoveHorizontal(-1)
                        }

                        KeyEvent.ACTION_UP -> {
                            if (physicalHorizontalDirection == -1) {
                                physicalHorizontalDirection = 0
                            }

                            // A released key must never keep draining repeats.
                            queuedHorizontalDirection = 0
                            queuedHorizontalSteps = 0
                        }
                    }
                    return true
                }

                KeyEvent.KEYCODE_DPAD_RIGHT -> {
                    when (event.action) {
                        KeyEvent.ACTION_DOWN -> {
                            physicalHorizontalDirection = 1

                            Log.e(
                                "PSTVROW",
                                "row=\"$diagnosticLabel\" view=$id KEY RIGHT repeat=${event.repeatCount}"
                            )
                            enqueueOrMoveHorizontal(1)
                        }

                        KeyEvent.ACTION_UP -> {
                            if (physicalHorizontalDirection == 1) {
                                physicalHorizontalDirection = 0
                            }

                            waitingForRightAppend = false

                            // Finish at most the already-pending target, but do
                            // not replay queued repeats after the user releases.
                            queuedHorizontalDirection = 0
                            queuedHorizontalSteps = 0
                        }
                    }
                    return true
                }
            }

            // V599B_VERTICAL_NAV_SOUND
            // Keep Android's existing UP/DOWN focus navigation completely intact.
            // Only add the platform directional sound when focus actually changes.
            if (
                event.action == KeyEvent.ACTION_DOWN &&
                (
                    event.keyCode == KeyEvent.KEYCODE_DPAD_UP ||
                    event.keyCode == KeyEvent.KEYCODE_DPAD_DOWN
                )
            ) {
                val beforeFocus = rootView.findFocus()
                val soundEffect =
                    if (event.keyCode == KeyEvent.KEYCODE_DPAD_UP)
                        SoundEffectConstants.NAVIGATION_UP
                    else
                        SoundEffectConstants.NAVIGATION_DOWN

                val handled = super.dispatchKeyEvent(event)
                val afterFocus = rootView.findFocus()

                if (afterFocus != null && afterFocus !== beforeFocus) {
                    try {
                        afterFocus.playSoundEffect(soundEffect)
                    } catch (_: Throwable) {
                    }
                } else {
                    // Some Android TV devices finish spatial focus on the
                    // following UI turn. Check once more without changing focus.
                    post {
                        val deferredFocus = rootView.findFocus()
                        if (deferredFocus != null && deferredFocus !== beforeFocus) {
                            try {
                                deferredFocus.playSoundEffect(soundEffect)
                            } catch (_: Throwable) {
                            }
                        }
                    }
                }

                return handled
            }

            // CENTER/BACK and UP/DOWN key-up retain normal Android/React behavior.
            return super.dispatchKeyEvent(event)
        }
    }

    private val rowAdapter = RowAdapter()

    init {
        clipChildren = false
        clipToPadding = false

        recycler.layoutManager = layoutManager
        recycler.adapter = rowAdapter
        recycler.setHasFixedSize(true)
        recycler.itemAnimator = null
        recycler.overScrollMode = View.OVER_SCROLL_NEVER
        recycler.clipChildren = false
        recycler.clipToPadding = false
        recycler.isFocusable = false
        recycler.descendantFocusability = ViewGroup.FOCUS_AFTER_DESCENDANTS

        // V598E_RECENT_POSTER_RETENTION
        //
        // Keep a larger *bounded* set of already-bound cards alive so reversing
        // direction does not immediately recycle/blank the posters the user just
        // saw. This is intentionally finite for Fire TV memory safety.
        recycler.setItemViewCacheSize(18)
        layoutManager.initialPrefetchItemCount = 12

        // V596_SCROLL_DIAG_ONLY
        recycler.addOnScrollListener(
            object : RecyclerView.OnScrollListener() {
                override fun onScrolled(rv: RecyclerView, dx: Int, dy: Int) {
                    if (dx != 0) {
                        Log.e(
                            "PSTVROW",
                            "row=\"$diagnosticLabel\" view=$id RV_SCROLLED dx=$dx " +
                                "offset=${rv.computeHorizontalScrollOffset()} " +
                                "logical=$logicalFocusPosition focused=${currentAdapterFocus()}"
                        )
                    }
                }
            }
        )

        addView(
            recycler,
            LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        )
    }

    private fun px(dp: Float): Int = (dp * density).roundToInt()

    fun setItems(items: ReadableArray?) {
        val next = ArrayList<RowItem>()

        if (items != null) {
            for (i in 0 until items.size()) {
                val m = items.getMap(i) ?: continue

                val id =
                    if (m.hasKey("id") && !m.isNull("id"))
                        m.getString("id") ?: ""
                    else ""

                val title =
                    if (m.hasKey("title") && !m.isNull("title"))
                        m.getString("title") ?: ""
                    else ""

                val poster =
                    if (m.hasKey("poster") && !m.isNull("poster"))
                        m.getString("poster")
                    else null

                next.add(RowItem(id, title, poster))
            }
        }

        // V592C_APPEND_SAFE_REFRESH
        //
        // Preserve focus and scroll when an existing row merely grows
        // (e.g. 50 -> 100 items from fetchMore).  The old path reset logical
        // focus to -1 and replaced the entire adapter, which destroyed the
        // focused holder while the rail was horizontally scrolled.
        val logicalBeforeRefresh = logicalFocusPosition
        val focusedBeforeRefresh = currentAdapterFocus()

        val appendSafe = rowAdapter.replaceOrAppend(next)

        if (appendSafe) {
            logicalFocusPosition =
                when {
                    focusedBeforeRefresh >= 0 -> focusedBeforeRefresh
                    logicalBeforeRefresh >= 0 -> logicalBeforeRefresh
                    else -> logicalFocusPosition
                }

            pendingFocusPosition = -1

            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id ITEMS_APPEND_SAFE " +
                    "count=${next.size} logical=$logicalFocusPosition " +
                    "focused=${currentAdapterFocus()} " +
                    "offset=${recycler.computeHorizontalScrollOffset()}"
            )
        } else {
            // Real replacement/reorder/shrink: retain the original reset path.
            logicalFocusPosition = -1
            pendingFocusPosition = -1
            preferredFocusApplied = false

            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id ITEMS_REPLACED count=${next.size}"
            )

            recycler.post { applyPreferredFocusIfNeeded() }
        }
    }

    fun setCardWidth(value: Float) {
        cardWidthDp = value.coerceAtLeast(1f)
        rowAdapter.notifyDataSetChanged()
    }

    fun setCardHeight(value: Float) {
        cardHeightDp = value.coerceAtLeast(1f)
        rowAdapter.notifyDataSetChanged()
    }

    fun setGap(value: Float) {
        gapDp = value.coerceAtLeast(0f)
        rowAdapter.notifyDataSetChanged()
    }

    fun setLeftPadding(value: Float) {
        leftPaddingDp = value.coerceAtLeast(0f)
        rowAdapter.notifyDataSetChanged()
    }

    fun setRightPadding(value: Float) {
        rightPaddingDp = value.coerceAtLeast(0f)
        rowAdapter.notifyDataSetChanged()
    }

    fun setDiagnosticLabel(value: String?) {
        diagnosticLabel =
            value?.trim()?.takeIf { it.isNotEmpty() } ?: "unknown-row"
    }
    fun setAnchorColumn(value: Int) {
        anchorColumn = value.coerceAtLeast(0)
    }

    fun setPreferredFocusIndex(value: Int) {
        preferredFocusIndex = value
        preferredFocusApplied = false
        recycler.post { applyPreferredFocusIfNeeded() }
    }

    private fun currentAdapterFocus(): Int {
        val focused = recycler.focusedChild
        if (focused != null) {
            val p = recycler.getChildAdapterPosition(focused)
            if (p != RecyclerView.NO_POSITION) return p
        }

        val direct = recycler.findFocus()
        if (direct != null) {
            val holder = recycler.findContainingViewHolder(direct)
            if (holder != null && holder.bindingAdapterPosition != RecyclerView.NO_POSITION) {
                return holder.bindingAdapterPosition
            }
        }

        return -1
    }

    // V591C_ROW_AWARE_DIAG
    // LOGGING ONLY: reads RecyclerView state; never scrolls or changes focus.
    private fun diagState(
        label: String,
        current: Int = logicalFocusPosition,
        target: Int = -1
    ) {
        try {
            val first = layoutManager.findFirstVisibleItemPosition()
            val last = layoutManager.findLastVisibleItemPosition()

            val firstView =
                if (first != RecyclerView.NO_POSITION)
                    layoutManager.findViewByPosition(first)
                else
                    null

            val focused = currentAdapterFocus()
            val firstLeft = firstView?.left ?: Int.MIN_VALUE
            val scrollOffset = recycler.computeHorizontalScrollOffset()
            val stride = px(cardWidthDp + gapDp)

            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id count=${rowAdapter.itemCount} " +
                    "label=$label logical=$logicalFocusPosition current=$current target=$target " +
                    "focused=$focused first=$first last=$last firstLeft=$firstLeft " +
                    "scrollOffset=$scrollOffset stridePx=$stride anchor=$anchorColumn"
            )
        } catch (t: Throwable) {
            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id label=$label " +
                    "diagError=${t.javaClass.simpleName}"
            )
        }
    }
    /**
     * V590_HORIZONTAL_STRIDE
     *
     * LEFT/RIGHT stay entirely inside this RecyclerView.
     *
     * Cards 0..5:
     *   Focus walks across the fixed six-column grid. No horizontal scroll.
     *
     * Beyond card 6:
     *   Move the RecyclerView by EXACTLY one card stride first, then focus the
     *   newly-attached adjacent adapter item. This keeps the selector physically
     *   pinned in column 6 and avoids V589's off-screen
     *   scrollToPositionWithOffset() + delayed requestFocus() handoff.
     *
     * UP/DOWN are intentionally untouched.
     */
    private fun enqueueOrMoveHorizontal(delta: Int) {
        if (pendingHorizontalTarget < 0) {
            moveHorizontal(delta)
            return
        }

        if (
            queuedHorizontalSteps == 0 ||
            queuedHorizontalDirection == delta
        ) {
            queuedHorizontalDirection = delta
            queuedHorizontalSteps += 1
        } else {
            // If the user reverses direction while a target is attaching,
            // honor the newest physical input rather than replaying stale
            // repeats in the old direction.
            queuedHorizontalDirection = delta
            queuedHorizontalSteps = 1
        }

        Log.e(
            "PSTVROW",
            "row=\"$diagnosticLabel\" view=$id HORIZONTAL_REPEAT_QUEUED " +
                "delta=$delta pending=$pendingHorizontalTarget " +
                "queuedDirection=$queuedHorizontalDirection queuedSteps=$queuedHorizontalSteps"
        )
    }

    private fun clearPendingHorizontal(reason: String) {
        if (
            pendingHorizontalTarget >= 0 ||
            queuedHorizontalSteps > 0
        ) {
            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id HORIZONTAL_PENDING_CLEAR " +
                    "reason=$reason pending=$pendingHorizontalTarget " +
                    "queuedDirection=$queuedHorizontalDirection queuedSteps=$queuedHorizontalSteps"
            )
        }

        pendingHorizontalTarget = -1
        pendingHorizontalDirection = 0
        pendingHorizontalRetryPosted = false
        pendingHorizontalRetryCount = 0
        queuedHorizontalDirection = 0
        queuedHorizontalSteps = 0
    }

    private fun drainQueuedHorizontalAfterFocus(position: Int) {
        if (position != pendingHorizontalTarget) return

        Log.e(
            "PSTVROW",
            "row=\"$diagnosticLabel\" view=$id HORIZONTAL_TARGET_LANDED " +
                "position=$position queuedDirection=$queuedHorizontalDirection " +
                "queuedSteps=$queuedHorizontalSteps"
        )

        pendingHorizontalTarget = -1
        pendingHorizontalDirection = 0
        pendingHorizontalRetryPosted = false
        pendingHorizontalRetryCount = 0

        if (queuedHorizontalSteps <= 0) {
            queuedHorizontalDirection = 0
            return
        }

        val delta = queuedHorizontalDirection
        queuedHorizontalSteps -= 1

        if (queuedHorizontalSteps == 0) {
            queuedHorizontalDirection = 0
        }

        recycler.postOnAnimation {
            if (recycler.hasFocus()) {
                moveHorizontal(delta)
            } else {
                clearPendingHorizontal("ROW_NO_LONGER_FOCUSED")
            }
        }
    }

    private fun schedulePendingHorizontalFocus() {
        if (
            pendingHorizontalTarget < 0 ||
            pendingHorizontalRetryPosted
        ) {
            return
        }

        pendingHorizontalRetryPosted = true

        recycler.postOnAnimation {
            pendingHorizontalRetryPosted = false

            val target = pendingHorizontalTarget
            if (target !in 0 until rowAdapter.itemCount) {
                clearPendingHorizontal("TARGET_INVALID")
                return@postOnAnimation
            }

            if (!recycler.hasFocus()) {
                clearPendingHorizontal("ROW_NO_LONGER_FOCUSED")
                return@postOnAnimation
            }

            val holder = recycler.findViewHolderForAdapterPosition(target)
            if (holder != null) {
                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id FOCUS_FORCED_ATTACHED position=$target"
                )

                val soundDirection = pendingHorizontalDirection

                if (holder.itemView.requestFocus()) {
                    playHorizontalNavigationSound(soundDirection, holder.itemView)
                    // CARD_FOCUS synchronously calls
                    // drainQueuedHorizontalAfterFocus().
                    return@postOnAnimation
                }
            }

            pendingHorizontalRetryCount += 1

            if (pendingHorizontalRetryCount >= maxPendingHorizontalFocusRetries) {
                val actual = currentAdapterFocus()

                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id FOCUS_RETRY_ABORT " +
                        "target=$target actual=$actual " +
                        "direction=$pendingHorizontalDirection " +
                        "retries=$pendingHorizontalRetryCount"
                )

                clearPendingHorizontal("FOCUS_RETRY_EXHAUSTED")

                if (actual in 0 until rowAdapter.itemCount) {
                    logicalFocusPosition = actual
                }

                return@postOnAnimation
            }

            // Do not hammer scrollToPositionWithOffset every frame.
            // focusAttachedPosition() already positioned the target once.
            // One additional correction is enough; later frames only wait
            // for RecyclerView/focus to settle.
            if (pendingHorizontalRetryCount == 1) {
                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id FOCUS_RETRY_LAYOUT " +
                        "position=$target direction=$pendingHorizontalDirection"
                )

                positionForTarget(target)
            }

            schedulePendingHorizontalFocus()
        }
    }

    private fun moveHorizontal(delta: Int) {
        val count = rowAdapter.itemCount
        if (count <= 0) return

        var current = logicalFocusPosition
        if (current !in 0 until count) {
            current = currentAdapterFocus()
        }
        if (current !in 0 until count) {
            current = 0
        }

        // V598_FOCUS_TRUTH
        //
        // Horizontal movement must never let a speculative logical index run
        // ahead of the card Android actually focused.  This makes held-repeat
        // and single-click input obey the same column state.
        val focusedBeforeMove = currentAdapterFocus()
        if (
            focusedBeforeMove in 0 until count &&
            focusedBeforeMove != current
        ) {
            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id FOCUS_RESYNC " +
                    "logical=$current actual=$focusedBeforeMove"
            )
            current = focusedBeforeMove
            logicalFocusPosition = current
        }

        val target = (current + delta).coerceIn(0, count - 1)

        diagState("MOVE_BEFORE delta=$delta", current, target)

        // At the true LEFT edge there is nowhere else to go.
        //
        // At the temporary RIGHT edge, however, ServiceRow may already be
        // fetching another page. If the physical RIGHT key is still held,
        // remember the intent so replaceOrAppend() can continue automatically
        // as soon as new items exist.
        if (target == current) {
            logicalFocusPosition = current

            if (
                delta > 0 &&
                current == count - 1 &&
                physicalHorizontalDirection == 1
            ) {
                if (!waitingForRightAppend) {
                    Log.e(
                        "PSTVROW",
                        "row=\"$diagnosticLabel\" view=$id RIGHT_EDGE_WAIT " +
                            "position=$current count=$count"
                    )
                }

                waitingForRightAppend = true
            }

            return
        }

        if (delta > 0) {
            waitingForRightAppend = false
        }

        val stridePx = px(cardWidthDp + gapDp)

        // V598G_PRELOAD_BEFORE_LAYOUT
        // Start the directional warm-up BEFORE RecyclerView lays out the newly
        // entering edge card. On a hard reverse this gives Glide the maximum
        // available head start instead of waiting until after scrollBy().
        val directionChanged =
            lastPreloadDirection != 0 &&
                lastPreloadDirection != delta

        if (directionChanged) {
            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" PRELOAD_DIRECTION_CHANGE " +
                    "from=$lastPreloadDirection to=$delta target=$target"
            )
        }

        preloadPosters(target, delta, directionChanged)

        when {
            // Walking RIGHT after the sixth visible poster:
            // shift content left one exact column.
            delta > 0 && current >= anchorColumn -> {
                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id EXPLICIT_SCROLL dx=$stridePx " +
                        "from=$current to=$target"
                )
                recycler.scrollBy(stridePx, 0)
            }


            // Walking LEFT while still beyond the sixth-column anchor:
            // shift content right one exact column.
            delta < 0 && current > anchorColumn -> {
                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id EXPLICIT_SCROLL dx=${-stridePx} " +
                        "from=$current to=$target"
                )
                recycler.scrollBy(-stridePx, 0)
            }

            // Inside posters 1..6 there is deliberately no horizontal scroll.
        }

        diagState("MOVE_AFTER_SCROLL delta=$delta", current, target)

        logicalFocusPosition = target

        // V598G_PRELOAD_BEFORE_LAYOUT
        // Warm-up now starts before scrollBy(), above. Do not issue a second
        // preload pass after RecyclerView has already laid out the edge card.

        focusAttachedPosition(target, delta)

        recycler.post {
            diagState("MOVE_POST_FOCUS delta=$delta", current, target)
        }
    }

    /**
     * V590_HORIZONTAL_STRIDE
     *
     * recycler.scrollBy() lays out the newly-visible neighbor synchronously in
     * normal RecyclerView operation, so the target holder should already exist.
     * The single post() fallback handles a slow layout without changing scroll
     * position or involving Android spatial focus search.
     */
    // V593_EXACT_ORIGIN_POSTER_PREFETCH
    // Warm the next few posters in the active D-pad direction.  Visible binds
    // still own HIGH priority; these preloads run at NORMAL priority.
        // V594B_TRUE_ORIGIN_SAFE_PREFETCH
    // V598E_GLIDE_POSTER_WINDOW
    //
    // Keep a small symmetric poster window warm around the current focus.
    // Visible loads remain HIGH priority. These preloads are LOW priority and
    // use the exact same dimensions/cache key as the visible card, so reversing
    // LEFT normally resolves from Glide memory/resource cache instead of
    // re-fetching/re-decoding the poster.
    // V598G_DIRECTIONAL_RETURN_WARM
    //
    // The previous implementation keyed preloads by URL only. Once a poster
    // had been warmed on the RIGHT trip, every LEFT-trip attempt for that URL
    // was skipped, even after Glide/RecyclerView had evicted it from the hot
    // path. Key by direction so the return trip gets its own warm-up.
    private fun preloadPosters(
        position: Int,
        direction: Int,
        directionChanged: Boolean = false
    ) {
        if (direction == 0) return

        if (
            position == lastPreloadPosition &&
            direction == lastPreloadDirection
        ) {
            return
        }

        lastPreloadPosition = position
        lastPreloadDirection = direction

        val width = (px(cardWidthDp) - px(6f)).coerceAtLeast(1)
        val height = (px(cardHeightDp) - px(6f)).coerceAtLeast(1)

        // Normal motion keeps twelve cards hot around focus. On the first move
        // after a direction reversal, widen the return runway so a hard LEFT
        // hold has several frames of cached posters already queued.
        val radius = if (directionChanged) 18 else 12
        val directionPrefix = if (direction > 0) "R|" else "L|"
        val preloadPriority =
            if (directionChanged) Priority.NORMAL else Priority.LOW

        for (offset in -radius..radius) {
            if (offset == 0) continue

            val p = position + offset
            val poster = rowAdapter.posterAt(p)
            if (poster.isNullOrBlank()) continue

            val preloadKey = directionPrefix + poster
            if (!preloadedPosterDirectionKeys.add(preloadKey)) {
                continue
            }

            // Roughly 240 poster URLs per direction. Old entries become
            // eligible again on very long traversals without unbounded growth.
            if (preloadedPosterDirectionKeys.size > 480) {
                val iterator = preloadedPosterDirectionKeys.iterator()
                repeat(120) {
                    if (iterator.hasNext()) {
                        iterator.next()
                        iterator.remove()
                    }
                }
            }

            Glide.with(recycler)
                .load(poster)
                .dontAnimate()
                .priority(preloadPriority)
                .diskCacheStrategy(DiskCacheStrategy.RESOURCE)
                .skipMemoryCache(false)
                .override(width, height)
                .preload(width, height)
        }
    }

    // V599_HORIZONTAL_NAV_SOUND
    // LEFT/RIGHT are manually consumed by this RecyclerView.
    // Play Android's normal directional sound only after focus
    // actually moves to another horizontal poster.
    private fun playHorizontalNavigationSound(direction: Int, targetView: View) {
        val soundEffect = when {
            direction < 0 -> SoundEffectConstants.NAVIGATION_LEFT
            direction > 0 -> SoundEffectConstants.NAVIGATION_RIGHT
            else -> return
        }

        try {
            targetView.playSoundEffect(soundEffect)
        } catch (_: Throwable) {
        }
    }

    private fun focusAttachedPosition(
        position: Int,
        direction: Int
    ) {
        if (position !in 0 until rowAdapter.itemCount) return

        val holder = recycler.findViewHolderForAdapterPosition(position)

        if (holder != null) {
            Log.e(
                "PSTVROW",
                "row=\"$diagnosticLabel\" view=$id FOCUS_IMMEDIATE position=$position"
            )

            if (holder.itemView.requestFocus()) {
                playHorizontalNavigationSound(direction, holder.itemView)
                return
            }
        }

        Log.e(
            "PSTVROW",
            "row=\"$diagnosticLabel\" view=$id FOCUS_MISS position=$position"
        )

        pendingHorizontalTarget = position
        pendingHorizontalDirection = direction
        pendingHorizontalRetryCount = 0

        // Force the exact adapter item to the exact column; once it attaches,
        // focus completes automatically and queued physical repeats continue.
        positionForTarget(position)
        schedulePendingHorizontalFocus()
    }

    /**
     * Exact Stremio-style geometry requested:
     *
     * 0..5: row stays at the beginning; focus walks across the six cards.
     * 6+:   focused item is positioned where card #6 normally lives.
     *
     * On the way LEFT, reaching position 5 exposes poster #1 again and the
     * selector then walks normally back through positions 4..0.
     */
    // V595_BLOCK_NATIVE_FOCUS_REVEAL
    private fun snapToOrigin() {
        recycler.stopScroll()
        layoutManager.scrollToPositionWithOffset(0, 0)

        // A second correction after the current focus/layout turn guarantees
        // there is no residual scroll left from an older focus reveal.
        recycler.post {
            recycler.stopScroll()
            layoutManager.scrollToPositionWithOffset(0, 0)
        }
    }
    private fun positionForTarget(position: Int) {
        if (position <= anchorColumn) {
            // Item zero already owns leftPadding as a margin; offset must be 0,
            // otherwise the old implementation double-counted the left pad.
            snapToOrigin()
        } else {
            layoutManager.scrollToPositionWithOffset(position, anchorOffsetPx())
        }
    }

    // V598C_EXACT_COLUMN_MATH
    //
    // Do not round the entire dp sum in one operation. Normal movement uses
    // separately-rounded left padding + stride, so the anchor MUST use the
    // exact same pixel arithmetic. On the Google Streamer the old formula was
    // 1589px while the real grid was 1591px, causing a repair layout on every
    // focused card.
    private fun anchorOffsetPx(): Int =
        px(leftPaddingDp) + anchorColumn * px(cardWidthDp + gapDp)

    /**
     * Coalesce fast key-repeat to one real requestFocus() per display frame.
     * The logical adapter index still advances on every repeat.
     */
    private fun scheduleFocus(position: Int) {
        pendingFocusPosition = position
        if (focusFramePosted) return

        focusFramePosted = true

        recycler.postOnAnimation {
            focusFramePosted = false

            val target = pendingFocusPosition
            pendingFocusPosition = -1

            if (target !in 0 until rowAdapter.itemCount) return@postOnAnimation

            val holder = recycler.findViewHolderForAdapterPosition(target)

            if (holder != null) {
                holder.itemView.requestFocus()
            } else {
                // scrollToPositionWithOffset() has already chosen the layout
                // position. Give RecyclerView one layout turn, then focus it.
                recycler.post {
                    val retry = recycler.findViewHolderForAdapterPosition(target)
                    if (retry != null) {
                        retry.itemView.requestFocus()
                    } else {
                        recycler.scrollToPosition(target)
                        recycler.post {
                            recycler
                                .findViewHolderForAdapterPosition(target)
                                ?.itemView
                                ?.requestFocus()
                        }
                    }
                }
            }
        }
    }

    private fun applyPreferredFocusIfNeeded() {
        if (preferredFocusApplied) return

        val p = preferredFocusIndex
        if (p !in 0 until rowAdapter.itemCount) return

        preferredFocusApplied = true
        logicalFocusPosition = p

        positionForTarget(p)
        scheduleFocus(p)
    }

    @Suppress("DEPRECATION")
    private fun emit(
        name: String,
        payload: com.facebook.react.bridge.WritableMap?
    ) {
        val reactContext = context as? ReactContext ?: return

        try {
            reactContext
                .getJSModule(RCTEventEmitter::class.java)
                .receiveEvent(id, name, payload)
        } catch (_: Throwable) {
        }
    }

    private fun emitItemFocus(position: Int, itemView: View) {
        val loc = IntArray(2)
        itemView.getLocationOnScreen(loc)

        val p = Arguments.createMap()
        p.putInt("index", position)
        p.putDouble("x", loc[0] / density.toDouble())
        p.putDouble("y", loc[1] / density.toDouble())
        p.putDouble("width", cardWidthDp.toDouble())
        p.putDouble("height", cardHeightDp.toDouble())

        emit("topItemFocus", p)
    }

    private fun emitRowBlurIfNeeded() {
        recycler.post {
            if (!recycler.hasFocus()) {
                Log.e(
                    "PSTVROW",
                    "row=\"$diagnosticLabel\" view=$id ROW_BLUR logical=$logicalFocusPosition"
                )
                diagState("ROW_BLUR")

                clearPendingHorizontal("ROW_BLUR")

                // V598F_ACTIVE_ROW_CACHE_LIFETIME
                // Only the focused rail owns the synchronous poster window.
                // Release it when focus leaves the row so multiple TV rails
                // cannot accumulate large bitmap-retaining caches.
                rowAdapter.clearRecentPosterRenderCache()

                logicalFocusPosition = -1
                emit("topRowBlur", Arguments.createMap())
            }
        }
    }

    private fun posterFrameBackground(focused: Boolean): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = px(6f).toFloat()
            setColor(Color.rgb(26, 26, 26))
            setStroke(
                px(3f),
                if (focused) Color.rgb(184, 160, 92)
                else Color.TRANSPARENT
            )
        }

    /**
     * ImageView needs its own rounded outline. A rounded background on the
     * parent does NOT clip the bitmap on Android.
     */
    private fun posterImageBackground(): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = px(4f).toFloat()
            setColor(Color.rgb(26, 26, 26))
        }

    private inner class Holder(
        val root: LinearLayout,
        val posterFrame: FrameLayout,
        val image: ImageView,
        val title: TextView
    ) : RecyclerView.ViewHolder(root) {
        var bindToken: Long = 0L
        var boundId: String = ""
        var boundPoster: String? = null
        var boundPosition: Int = RecyclerView.NO_POSITION

        // V601_RETURN_POSTER_RESTORE
        var lastBindUptimeMs: Long = 0L

        // V598B_POSTER_RENDER_OWNERSHIP
        // Glide never owns the ImageView directly. Only the CustomTarget for
        // this exact holder/bind token may paint the poster.
        var activePosterTarget: CustomTarget<Drawable>? = null
    }

    private inner class RowAdapter : RecyclerView.Adapter<Holder>() {
        private val data = ArrayList<RowItem>()

        // V598F_SYNCHRONOUS_RETURN_POSTER_CACHE
        //
        // Glide's memory cache is already returning these posters in a few
        // milliseconds, but RecyclerView rebinds were explicitly blanking the
        // ImageView before that callback. Keep a bounded cache of Drawable
        // ConstantStates for the ACTIVE row so a known poster can be painted
        // synchronously during bind with the correct identity. This avoids the
        // one-frame blank without ever showing the recycled holder's old image.
        private val recentPosterStates =
            LinkedHashMap<String, Drawable.ConstantState>(
                64,
                0.75f,
                true
            )

        private fun rememberPosterDrawable(
            poster: String?,
            drawable: Drawable
        ) {
            if (poster.isNullOrBlank()) return
            val state = drawable.constantState ?: return

            recentPosterStates[poster] = state

            while (recentPosterStates.size > 64) {
                val iterator = recentPosterStates.entries.iterator()
                if (!iterator.hasNext()) break
                iterator.next()
                iterator.remove()
            }
        }

        private fun cachedPosterDrawable(poster: String?): Drawable? {
            if (poster.isNullOrBlank()) return null
            return recentPosterStates[poster]?.newDrawable(resources)
        }

        fun clearRecentPosterRenderCache() {
            recentPosterStates.clear()
        }

        // V601_RETURN_POSTER_RESTORE
        // React-Native Screens can leave an already-bound native holder
        // alive while its Glide target has been cleared. When Discover
        // regains focus, rebind ONLY old attached holders whose poster
        // is actually blank/invisible.
        private var lastPosterRestoreCheckUptimeMs: Long = 0L

        fun restoreAttachedPostersIfBlank() {
            val now = SystemClock.uptimeMillis()

            // Horizontal focus changes can occur very rapidly.
            // Do not scan/rebind on every held-repeat frame.
            if (now - lastPosterRestoreCheckUptimeMs < 500L) return
            lastPosterRestoreCheckUptimeMs = now

            val restorePositions = LinkedHashSet<Int>()

            for (i in 0 until recycler.childCount) {
                val child = recycler.getChildAt(i)
                val holder = recycler.getChildViewHolder(child) as? Holder ?: continue
                val pos = holder.bindingAdapterPosition
                val item = data.getOrNull(pos) ?: continue

                val identityMatches =
                    holder.boundId == item.id &&
                        holder.boundPoster == item.poster

                val staleBlank =
                    item.poster?.isNotBlank() == true &&
                        (holder.image.visibility != View.VISIBLE ||
                            holder.image.drawable == null) &&
                        now - holder.lastBindUptimeMs >= 500L

                if (identityMatches && staleBlank) {
                    restorePositions.add(pos)
                }
            }

            if (restorePositions.isEmpty()) return

            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" RETURN_POSTER_REBIND " +
                    "positions=${restorePositions.joinToString(",")}"
            )

            restorePositions.forEach { position ->
                notifyItemChanged(position)
            }
        }

        private fun posterKey(poster: String?): String =
            if (poster.isNullOrBlank()) "none" else poster.hashCode().toString(16)

        private fun holderKey(holder: Holder): Int =
            System.identityHashCode(holder)

        private fun logAttachedPosterDuplicates() {
            val seen = HashMap<String, Pair<Int, String>>()

            for (i in 0 until recycler.childCount) {
                val child = recycler.getChildAt(i)
                val holder = recycler.getChildViewHolder(child) as? Holder ?: continue
                val pos = holder.bindingAdapterPosition
                if (pos == RecyclerView.NO_POSITION) continue

                val key = posterKey(holder.boundPoster)
                if (key == "none") continue

                val previous = seen[key]

                if (previous == null) {
                    seen[key] = Pair(pos, holder.boundId)
                    continue
                }

                if (previous.first != pos) {
                    Log.e(
                        "PSTVIMG",
                        "row=\"$diagnosticLabel\" DUP_BOUND poster=$key " +
                            "posA=${previous.first} idA=${previous.second} " +
                            "posB=$pos idB=${holder.boundId}"
                    )
                }
            }
        }

        // V592C_APPEND_SAFE_REFRESH
        //
        // true  = same existing prefix; preserve RecyclerView holders/focus
        // false = different/reordered/shrunk dataset; full replacement
        fun replaceOrAppend(next: List<RowItem>): Boolean {
            val oldSize = data.size

            val samePrefix =
                oldSize > 0 &&
                next.size >= oldSize &&
                (0 until oldSize).all { i ->
                    sameRowIdentity(data[i], next[i])
                }

            if (samePrefix) {
                // Refresh metadata for existing positions without invalidating
                // the entire RecyclerView.
                for (i in 0 until oldSize) {
                    data[i] = next[i]
                }

                val added = next.size - oldSize
                if (added > 0) {
                    val oldLastPosition = oldSize - 1
                    val focusedBeforeAppend = currentAdapterFocus()
                    val logicalBeforeAppend = logicalFocusPosition

                    data.addAll(next.subList(oldSize, next.size))
                    notifyItemRangeInserted(oldSize, added)

                    // V598C_APPEND_NO_FOCUSED_REBIND
                    //
                    // The former last card already exists and only needs its
                    // oversized end margin changed to the normal gap. Rebinding
                    // that focused holder with notifyItemChanged() caused
                    // RecyclerView's next layout to recover focus at position 0
                    // in the captured 97 -> 98 append failure.
                    //
                    // If the holder is attached, change the margin directly.
                    // If it is not attached, there is no stale on-screen margin;
                    // its next normal bind will calculate the correct margin from
                    // the new data.lastIndex automatically.
                    val oldLastHolder =
                        recycler.findViewHolderForAdapterPosition(oldLastPosition)
                    val oldLastLayoutParams =
                        oldLastHolder?.itemView?.layoutParams as? RecyclerView.LayoutParams

                    if (oldLastLayoutParams != null) {
                        oldLastLayoutParams.rightMargin = px(gapDp)
                        oldLastHolder.itemView.layoutParams = oldLastLayoutParams
                    }

                    Log.e(
                        "PSTVROW",
                        "row=\"$diagnosticLabel\" view=$id END_MARGIN_RELEASE " +
                            "oldLast=$oldLastPosition added=$added " +
                            "holderAttached=${oldLastHolder != null} " +
                            "focusedBefore=$focusedBeforeAppend logicalBefore=$logicalBeforeAppend"
                    )

                    // V598C_EDGE_HOLD_CONTINUE
                    //
                    // If the user is still physically holding RIGHT at the old
                    // loaded edge, resume automatically as soon as the new page
                    // is in the adapter. No release/re-press is required.
                    val shouldContinueRight =
                        waitingForRightAppend &&
                            physicalHorizontalDirection == 1 &&
                            logicalBeforeAppend == oldLastPosition &&
                            focusedBeforeAppend == oldLastPosition

                    if (shouldContinueRight) {
                        recycler.postOnAnimation {
                            if (
                                waitingForRightAppend &&
                                physicalHorizontalDirection == 1 &&
                                recycler.hasFocus() &&
                                logicalFocusPosition == oldLastPosition &&
                                rowAdapter.itemCount > oldSize
                            ) {
                                waitingForRightAppend = false

                                Log.e(
                                    "PSTVROW",
                                    "row=\"$diagnosticLabel\" view=$id RIGHT_EDGE_APPEND_CONTINUE " +
                                        "from=$oldLastPosition count=${rowAdapter.itemCount}"
                                )

                                enqueueOrMoveHorizontal(1)
                            }
                        }
                    }
                }

                return true
            }

            data.clear()
            data.addAll(next)
            notifyDataSetChanged()
            return false
        }

        private fun sameRowIdentity(a: RowItem, b: RowItem): Boolean {
            if (a.id.isNotEmpty() || b.id.isNotEmpty()) {
                return a.id == b.id
            }

            return a.title == b.title && a.poster == b.poster
        }

        override fun getItemCount(): Int = data.size

        fun posterAt(position: Int): String? =
            data.getOrNull(position)?.poster

        override fun onCreateViewHolder(
            parent: ViewGroup,
            viewType: Int
        ): Holder {
            val root = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.TOP
                isFocusable = true
                isFocusableInTouchMode = false
                isClickable = false

                // Only the card root participates in Android TV focus search.
                descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS

                importantForAccessibility =
                    View.IMPORTANT_FOR_ACCESSIBILITY_YES
            }

            val posterFrame = FrameLayout(context).apply {
                isFocusable = false

                // Reserve 3dp so the image can never paint over the selector.
                val b = px(3f)
                setPadding(b, b, b, b)

                background = posterFrameBackground(false)

                // The frame itself is rounded.
                outlineProvider = ViewOutlineProvider.BACKGROUND
                clipToOutline = true
            }

            val image = ImageView(context).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                isFocusable = false

                // THIS is what clips the actual poster bitmap to round corners.
                background = posterImageBackground()
                outlineProvider = ViewOutlineProvider.BACKGROUND
                clipToOutline = true
            }

            posterFrame.addView(
                image,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )

            val title = TextView(context).apply {
                setTextColor(Color.rgb(184, 160, 92))
                textSize = 13f
                gravity = Gravity.CENTER
                maxLines = 2
                ellipsize = TextUtils.TruncateAt.END
                includeFontPadding = false
                isFocusable = false
            }

            root.addView(posterFrame)
            root.addView(title)

            root.onFocusChangeListener =
                View.OnFocusChangeListener { v, hasFocus ->
                    posterFrame.background = posterFrameBackground(hasFocus)

                    if (hasFocus) {
                        val p = recycler.getChildAdapterPosition(v)

                        if (p != RecyclerView.NO_POSITION) {
                            logicalFocusPosition = p
                            drainQueuedHorizontalAfterFocus(p)

                            // V601_RETURN_POSTER_RESTORE
                            // Posted so RecyclerView is outside the current
                            // focus/layout transaction before rebinding.
                            recycler.post {
                                rowAdapter.restoreAttachedPostersIfBlank()
                            }

                            // V598A_FOCUS_GEOMETRY_INVARIANT
                            //
                            // A row can regain focus vertically while preserving
                            // an old RecyclerView scroll offset. Android may then
                            // focus a deep adapter item in column 1 instead of the
                            // required pinned column 6. Every later relative
                            // scroll would preserve that bad geometry.
                            //
                            // Enforce the horizontal column invariant on EVERY
                            // focus gain. This does not consume or synthesize
                            // UP/DOWN; it only repairs this row's horizontal
                            // position when the focused card is physically wrong.
                            val stridePx = px(cardWidthDp + gapDp)
                            val expectedLeft =
                                if (p <= anchorColumn)
                                    px(leftPaddingDp) + (p * stridePx)
                                else
                                    anchorOffsetPx()

                            if (v.left != expectedLeft) {
                                Log.e(
                                    "PSTVROW",
                                    "row=\"$diagnosticLabel\" view=$id FOCUS_GEOMETRY_REPAIR " +
                                        "position=$p actualLeft=${v.left} expectedLeft=$expectedLeft " +
                                        "offset=${recycler.computeHorizontalScrollOffset()}"
                                )

                                recycler.post {
                                    if (
                                        logicalFocusPosition == p &&
                                        v.hasFocus()
                                    ) {
                                        positionForTarget(p)

                                        recycler.post {
                                            Log.e(
                                                "PSTVROW",
                                                "row=\"$diagnosticLabel\" view=$id FOCUS_GEOMETRY_REPAIRED " +
                                                    "position=$p left=${v.left} expectedLeft=$expectedLeft " +
                                                    "offset=${recycler.computeHorizontalScrollOffset()}"
                                            )
                                        }
                                    }
                                }
                            }

                            Log.e(
                                "PSTVROW",
                                "row=\"$diagnosticLabel\" view=$id CARD_FOCUS position=$p left=${v.left} top=${v.top}"
                            )
                            diagState("CARD_FOCUS", p, p)

                            emitItemFocus(p, v)
                        }
                    } else {
                        emitRowBlurIfNeeded()
                    }
                }

            return Holder(root, posterFrame, image, title)
        }

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val item = data[position]

            val bindToken = ++imageBindSequence
            val holderIdentity = holderKey(holder)
            val expectedPosterKey = posterKey(item.poster)

            holder.bindToken = bindToken
            holder.boundId = item.id
            holder.boundPoster = item.poster
            holder.boundPosition = position
            holder.lastBindUptimeMs = SystemClock.uptimeMillis()

            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" BIND holder=$holderIdentity token=$bindToken " +
                    "pos=$position id=${item.id} poster=$expectedPosterKey"
            )

            val cardW = px(cardWidthDp)
            val cardH = px(cardHeightDp)
            val titleH = px(38f)

            holder.root.layoutParams =
                RecyclerView.LayoutParams(cardW, cardH + titleH).apply {
                    leftMargin =
                        if (position == 0) px(leftPaddingDp)
                        else 0

                    rightMargin =
                        if (position == data.lastIndex)
                            px(rightPaddingDp)
                        else
                            px(gapDp)
                }

            holder.posterFrame.layoutParams =
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    cardH
                )

            holder.title.layoutParams =
                LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    titleH
                )

            holder.root.contentDescription =
                item.title.ifBlank { "Content" }

            holder.title.text = item.title

            // V598B_POSTER_RENDER_OWNERSHIP
            //
            // The diagnostics have already ruled out duplicate source URLs and
            // stale READY callbacks. The remaining transient duplication occurs
            // during rapid holder recycling. Do not let Glide's ImageViewTarget
            // own/repaint a recycled ImageView at all. A generation-guarded
            // CustomTarget is now the ONLY code allowed to set the poster.
            val previousTarget = holder.activePosterTarget
            holder.activePosterTarget = null
            if (previousTarget != null) {
                try {
                    Glide.with(context.applicationContext).clear(previousTarget)
                } catch (_: Throwable) {
                }
            }

            val poster = item.poster

            // V598F_NO_BLANK_ON_MEMORY_HIT
            //
            // Never leave a known poster blank while waiting for Glide to call
            // back from its memory cache. If this exact poster was rendered
            // recently in the active row, paint a fresh Drawable instance
            // synchronously before issuing the normal guarded Glide request.
            val synchronousPoster = cachedPosterDrawable(poster)
            val hadSynchronousPoster = synchronousPoster != null

            if (synchronousPoster != null) {
                holder.image.setImageDrawable(synchronousPoster)
                holder.image.visibility = View.VISIBLE
                holder.image.invalidate()

                Log.e(
                    "PSTVIMG",
                    "row=\"$diagnosticLabel\" SYNC_CACHE_HIT holder=$holderIdentity " +
                        "token=$bindToken pos=$position id=${item.id} poster=$expectedPosterKey"
                )
            } else {
                holder.image.visibility = View.INVISIBLE
                holder.image.setImageDrawable(null)
                holder.image.invalidate()
            }

            if (poster.isNullOrBlank()) {
                holder.image.setImageDrawable(
                    ColorDrawable(Color.rgb(26, 26, 26))
                )
                holder.image.visibility = View.VISIBLE
                holder.image.invalidate()
            } else {
                val renderTarget =
                    object : CustomTarget<Drawable>(
                        (cardW - px(6f)).coerceAtLeast(1),
                        (cardH - px(6f)).coerceAtLeast(1)
                    ) {
                        override fun onResourceReady(
                            resource: Drawable,
                            transition: Transition<in Drawable>?
                        ) {
                            val currentPos = holder.bindingAdapterPosition
                            val mismatch =
                                holder.activePosterTarget !== this ||
                                    holder.bindToken != bindToken ||
                                    holder.boundId != item.id ||
                                    holder.boundPosition != position ||
                                    currentPos != position

                            Log.e(
                                "PSTVIMG",
                                "row=\"$diagnosticLabel\" READY holder=$holderIdentity " +
                                    "token=$bindToken currentToken=${holder.bindToken} " +
                                    "expectedPos=$position currentPos=$currentPos " +
                                    "expectedId=${item.id} currentId=${holder.boundId} " +
                                    "poster=$expectedPosterKey renderer=CustomTarget " +
                                    "drawable=${System.identityHashCode(resource)} " +
                                    "mismatch=$mismatch"
                            )

                            if (!mismatch) {
                                // V598F_SYNCHRONOUS_RETURN_POSTER_CACHE
                                rememberPosterDrawable(poster, resource)

                                holder.image.setImageDrawable(resource)
                                holder.image.visibility = View.VISIBLE
                                holder.image.invalidate()
                            }

                            recycler.post { logAttachedPosterDuplicates() }
                        }

                        override fun onLoadFailed(errorDrawable: Drawable?) {
                            val currentPos = holder.bindingAdapterPosition
                            val mismatch =
                                holder.activePosterTarget !== this ||
                                    holder.bindToken != bindToken ||
                                    holder.boundId != item.id ||
                                    holder.boundPosition != position ||
                                    currentPos != position

                            Log.e(
                                "PSTVIMG",
                                "row=\"$diagnosticLabel\" FAIL holder=$holderIdentity " +
                                    "token=$bindToken currentToken=${holder.bindToken} " +
                                    "expectedPos=$position currentPos=$currentPos " +
                                    "expectedId=${item.id} currentId=${holder.boundId} " +
                                    "poster=$expectedPosterKey renderer=CustomTarget " +
                                    "mismatch=$mismatch"
                            )

                            if (!mismatch && !hadSynchronousPoster) {
                                holder.image.setImageDrawable(
                                    ColorDrawable(Color.rgb(26, 26, 26))
                                )
                                holder.image.visibility = View.VISIBLE
                                holder.image.invalidate()
                            }
                        }

                        override fun onLoadCleared(placeholder: Drawable?) {
                            if (holder.activePosterTarget === this) {
                                Log.e(
                                    "PSTVIMG",
                                    "row=\"$diagnosticLabel\" ACTIVE_TARGET_CLEARED " +
                                        "holder=$holderIdentity pos=${holder.bindingAdapterPosition} " +
                                        "id=${holder.boundId} poster=$expectedPosterKey"
                                )

                                // V603_KEEP_RENDERED_POSTER_ON_CLEAR
                                // Do not turn a still-bound poster black.
                                // True recycling clears it separately.
                                holder.activePosterTarget = null
                                if (holder.image.drawable != null) {
                                    holder.image.visibility = View.VISIBLE
                                    holder.image.invalidate()
                                }
                            }
                        }
                    }

                holder.activePosterTarget = renderTarget

                // V603_POSTER_LIFECYCLE_FIX
                // Keep poster ownership independent of React Navigation
                // screen detach/reattach. Holder recycling still clears
                // the CustomTarget explicitly below.
                Glide.with(context.applicationContext)
                    .load(poster)
                    .dontAnimate()
                    .priority(Priority.HIGH)
                    .diskCacheStrategy(DiskCacheStrategy.RESOURCE)
                    .skipMemoryCache(false)
                    .override(
                        (cardW - px(6f)).coerceAtLeast(1),
                        (cardH - px(6f)).coerceAtLeast(1)
                    )
                    .into(renderTarget)
            }
        }

        override fun onViewAttachedToWindow(holder: Holder) {
            super.onViewAttachedToWindow(holder)

            // V598C_ATTACH_RENDER_GUARD
            //
            // A detached holder can be cached and reattached without a fresh
            // bind. Never show its bitmap unless the holder identity still
            // matches the adapter item at its current position.
            val pos = holder.bindingAdapterPosition
            val currentItem = data.getOrNull(pos)
            val identityMatches =
                currentItem != null &&
                    holder.boundId == currentItem.id &&
                    holder.boundPoster == currentItem.poster

            if (!identityMatches) {
                holder.image.visibility = View.INVISIBLE
                holder.image.invalidate()

                Log.e(
                    "PSTVIMG",
                    "row=\"$diagnosticLabel\" ATTACH_IDENTITY_MISMATCH " +
                        "holder=${holderKey(holder)} pos=$pos " +
                        "boundId=${holder.boundId} actualId=${currentItem?.id ?: "none"}"
                )
            } else if (holder.image.drawable != null) {
                holder.image.visibility = View.VISIBLE
            }

            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" ATTACH holder=${holderKey(holder)} " +
                    "pos=$pos token=${holder.bindToken} " +
                    "id=${holder.boundId} poster=${posterKey(holder.boundPoster)}"
            )
        }

        override fun onViewDetachedFromWindow(holder: Holder) {
            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" DETACH holder=${holderKey(holder)} " +
                    "pos=${holder.bindingAdapterPosition} token=${holder.bindToken} " +
                    "id=${holder.boundId} poster=${posterKey(holder.boundPoster)}"
            )

            // V602_KEEP_POSTER_ON_DETACH
            // A screen transition can detach an otherwise-valid RecyclerView
            // holder without recycling or rebinding it. Do NOT blank its
            // poster here. onViewRecycled() still clears recycled holders,
            // and onBindViewHolder() still owns identity-safe replacement.

            super.onViewDetachedFromWindow(holder)
        }

        override fun onViewRecycled(holder: Holder) {
            Log.e(
                "PSTVIMG",
                "row=\"$diagnosticLabel\" RECYCLE holder=${holderKey(holder)} " +
                    "token=${holder.bindToken} pos=${holder.bindingAdapterPosition} " +
                    "boundPos=${holder.boundPosition} id=${holder.boundId} " +
                    "poster=${posterKey(holder.boundPoster)}"
            )

            // V598B_POSTER_RENDER_OWNERSHIP
            val activeTarget = holder.activePosterTarget
            holder.activePosterTarget = null

            if (activeTarget != null) {
                try {
                    Glide.with(context.applicationContext).clear(activeTarget)
                } catch (_: Throwable) {
                }
            }

            holder.image.visibility = View.INVISIBLE
            holder.image.setImageDrawable(null)
            holder.image.invalidate()

            super.onViewRecycled(holder)
        }
    }
}
