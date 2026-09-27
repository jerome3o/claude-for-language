package dev.jeromeswannack.chineselearning.lab.ui.decks

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Press-and-hold to drag a deck to a new place in the queue — the web's
 * `useLongPressReorder` (services/dragReorder.ts) on Compose gestures: hold a card still
 * and it lifts (a haptic tick), moving reorders the list under the finger (the same
 * parity-tested `indexUnderPointer` / `moveToIndex`, core/DeckQueue.kt), letting go commits
 * the new order. Moving before the hold ends is a scroll. Near the top / bottom edge the
 * list scrolls itself so a deck can travel the whole queue.
 */
@Stable
class DragReorderState internal constructor(
    private val listState: LazyListState,
    private val scope: CoroutineScope,
    private val ids: () -> List<String>,
    private val onLift: () -> Unit,
    private val onSlot: () -> Unit,
    private val onCommit: (List<String>) -> Unit,
) {
    /** The live preview while dragging, else null (render [ids]). */
    var preview by mutableStateOf<List<String>?>(null)
        private set
    var dragId by mutableStateOf<String?>(null)
        private set

    /** How far the lifted card is drawn from its slot, so it stays under the finger. */
    var dragOffsetY by mutableFloatStateOf(0f)
        private set

    /** Finger position on the list's main axis, in the space of `LazyListItemInfo.offset`. */
    private var pointerY = 0f
    private var grabY = 0f
    private var scrollJob: Job? = null

    fun order(): List<String> = preview ?: ids()

    /** [listY]: the long-press position in the LazyColumn's own coordinates. */
    internal fun start(listY: Float) {
        val info = listState.layoutInfo
        val y = listY + info.viewportStartOffset
        val current = ids()
        val item = info.visibleItemsInfo.firstOrNull { it.key in current && y >= it.offset && y <= it.offset + it.size } ?: return
        pointerY = y
        grabY = y - item.offset
        dragId = item.key as String
        preview = current
        dragOffsetY = 0f
        onLift()
        scrollJob = scope.launch { autoScroll() }
    }

    internal fun dragBy(dy: Float) {
        if (dragId == null) return
        pointerY += dy
        update()
    }

    internal fun end(cancelled: Boolean) {
        val final = preview
        val before = ids()
        scrollJob?.cancel()
        dragId = null
        preview = null
        dragOffsetY = 0f
        if (!cancelled && final != null && final != before) onCommit(final)
    }

    /** The slot under the finger among the visible deck rows → the new preview order. */
    private fun update() {
        val id = dragId ?: return
        val current = preview ?: return
        val info = listState.layoutInfo
        val width = info.viewportSize.width.toDouble()
        val rows = info.visibleItemsInfo.filter { it.key in current }
        val rects = rows.map { DeckQueue.Rect(0.0, it.offset.toDouble(), width, it.size.toDouble()) }
        val idx = DeckQueue.indexUnderPointer(rects, width / 2, pointerY.toDouble())
        if (idx >= 0) {
            val target = current.indexOf(rows[idx].key)
            val next = DeckQueue.moveToIndex(current, id, target)
            if (next !== current) {
                preview = next
                onSlot()
            }
        }
        val slot = info.visibleItemsInfo.firstOrNull { it.key == id }
        dragOffsetY = if (slot != null) pointerY - grabY - slot.offset else 0f
    }

    private suspend fun autoScroll() {
        while (scope.isActive && dragId != null) {
            val info = listState.layoutInfo
            val edge = info.viewportSize.height * 0.12f
            val y = pointerY - info.viewportStartOffset // container space
            val step = when {
                y < edge -> -(edge - y) / 3f
                y > info.viewportSize.height - edge -> (y - (info.viewportSize.height - edge)) / 3f
                else -> 0f
            }
            if (step != 0f) {
                // The content moves under a still finger: keep the finger's place in content space.
                val moved = listState.scrollBy(step)
                pointerY += moved
                update()
            }
            delay(16)
        }
    }
}

@Composable
fun rememberDragReorderState(
    listState: LazyListState,
    ids: List<String>,
    onLift: () -> Unit,
    onSlot: () -> Unit,
    onCommit: (List<String>) -> Unit,
): DragReorderState {
    val scope = rememberCoroutineScope()
    val currentIds by rememberUpdatedState(ids)
    val lift by rememberUpdatedState(onLift)
    val slot by rememberUpdatedState(onSlot)
    val commit by rememberUpdatedState(onCommit)
    return remember(listState) { DragReorderState(listState, scope, { currentIds }, { lift() }, { slot() }, { commit(it) }) }
}

/**
 * On the LazyColumn (rows keyed by deck id): press and hold a row to lift it. The gesture
 * lives on the list, whose coordinates don't move while rows reflow under the finger.
 */
fun Modifier.dragReorderList(state: DragReorderState): Modifier = pointerInput(state) {
    detectDragGesturesAfterLongPress(
        onDragStart = { offset: Offset -> state.start(offset.y) },
        onDrag = { change, amount ->
            if (state.dragId != null) {
                change.consume()
                state.dragBy(amount.y)
            }
        },
        onDragEnd = { state.end(cancelled = false) },
        onDragCancel = { state.end(cancelled = true) },
    )
}
