package dev.jeromeswannack.chineselearning.lab.ui.upnext

import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.LazyListItemInfo
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
import dev.jeromeswannack.chineselearning.lab.core.UpNext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** LazyColumn keys of the Up next screen: list rows, search results, the list's head / end. */
object UpNextKeys {
    fun row(id: String) = "row:$id"
    fun result(id: String) = "res:$id"
    const val LIST_HEAD = "list-head"
    const val LIST_END = "list-end"
    fun idOf(key: Any): String? = (key as? String)?.substringAfter(':', "")?.takeIf { it.isNotEmpty() && (key.startsWith("row:") || key.startsWith("res:")) }
}

/**
 * The Up next screen's drag — the web's `useUpNextDrag` (services/upNextDrag.ts) on Compose
 * gestures, built like the Decks tab's DragReorderState: press and hold a LIST ROW to move it, or
 * a SEARCH RESULT to drag it into a place in the list (it joins the list as a placeholder row only
 * while the finger is over the list). Slot math = the parity-tested DeckQueue.indexUnderPointer /
 * moveToIndex and UpNext.insertIntoOrder. Near the edges the list scrolls itself.
 */
@Stable
class UpNextDragState internal constructor(
    private val listState: LazyListState,
    private val scope: CoroutineScope,
    private val ids: () -> List<String>,
    private val draggableResults: () -> Set<String>,
    private val onLift: () -> Unit,
    private val onSlot: () -> Unit,
    private val onReorder: (List<String>) -> Unit,
    private val onDrop: (String, Int) -> Unit,
) {
    /** The live preview while dragging (a dragged result included while over the list), else null. */
    var preview by mutableStateOf<List<String>?>(null)
        internal set
    var dragId by mutableStateOf<String?>(null)
        internal set
    var dragIsResult by mutableStateOf(false)
        internal set
    /** How far the lifted ROW is drawn from its slot, so it stays under the finger. */
    var dragOffsetY by mutableFloatStateOf(0f)
        private set

    private var pointerY = 0f
    private var grabY = 0f
    private var scrollJob: Job? = null

    fun order(): List<String> = preview ?: ids()

    internal fun start(listY: Float) {
        val info = listState.layoutInfo
        val y = listY + info.viewportStartOffset
        val item = info.visibleItemsInfo.firstOrNull { y >= it.offset && y <= it.offset + it.size } ?: return
        val key = item.key as? String ?: return
        val id = UpNextKeys.idOf(key) ?: return
        val isResult = key.startsWith("res:")
        if (isResult && id !in draggableResults()) return
        if (!isResult && id !in ids()) return
        pointerY = y
        grabY = y - item.offset
        dragId = id
        dragIsResult = isResult
        preview = if (isResult) null else ids()
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
        val id = dragId
        val final = preview
        val before = ids()
        val wasResult = dragIsResult
        scrollJob?.cancel()
        dragId = null
        preview = null
        dragIsResult = false
        dragOffsetY = 0f
        if (cancelled || id == null || final == null) return
        if (!wasResult && final != before) onReorder(final)
        if (wasResult && id in final) onDrop(id, final.indexOf(id))
    }

    private fun rowItems(info: List<LazyListItemInfo>) = info.filter { (it.key as? String)?.startsWith("row:") == true }

    private fun update() {
        val id = dragId ?: return
        val info = listState.layoutInfo
        val width = info.viewportSize.width.toDouble()
        val rows = rowItems(info.visibleItemsInfo)
        val rects = rows.map { DeckQueue.Rect(0.0, it.offset.toDouble(), width, it.size.toDouble()) }
        val current = preview
        if (!dragIsResult) {
            if (current == null) return
            val idx = DeckQueue.indexUnderPointer(rects, width / 2, pointerY.toDouble())
            if (idx >= 0) {
                val target = current.indexOf(UpNextKeys.idOf(rows[idx].key))
                if (target >= 0) {
                    val next = DeckQueue.moveToIndex(current, id, target)
                    if (next !== current) { preview = next; onSlot() }
                }
            }
            val slot = info.visibleItemsInfo.firstOrNull { it.key == UpNextKeys.row(id) }
            dragOffsetY = if (slot != null) pointerY - grabY - slot.offset else 0f
            return
        }
        // A search result: in the list only while the finger is over it.
        val head = info.visibleItemsInfo.firstOrNull { it.key == UpNextKeys.LIST_HEAD }
        val end = info.visibleItemsInfo.firstOrNull { it.key == UpNextKeys.LIST_END }
        val top = head?.offset?.toFloat() ?: if (rows.isNotEmpty()) Float.NEGATIVE_INFINITY else Float.POSITIVE_INFINITY
        val bottom = end?.let { (it.offset + it.size).toFloat() } ?: if (rows.isNotEmpty()) Float.POSITIVE_INFINITY else Float.NEGATIVE_INFINITY
        val over = pointerY >= top && pointerY <= bottom
        if (!over) {
            if (current != null) { preview = null; onSlot() }
            return
        }
        val idx = DeckQueue.indexUnderPointer(rects, width / 2, pointerY.toDouble())
        if (current == null) {
            val base = ids()
            val at = if (idx < 0) (if (end != null && head == null) base.size else 0) else {
                val rowId = UpNextKeys.idOf(rows[idx].key)
                val i = base.indexOf(rowId).coerceAtLeast(0)
                if (pointerY > rows[idx].offset + rows[idx].size / 2f) i + 1 else i
            }
            preview = UpNext.insertIntoOrder(base, listOf(id), at)
            onSlot()
            return
        }
        if (idx >= 0) {
            val target = current.indexOf(UpNextKeys.idOf(rows[idx].key))
            if (target >= 0) {
                val next = DeckQueue.moveToIndex(current, id, target)
                if (next !== current) { preview = next; onSlot() }
            }
        }
    }

    private suspend fun autoScroll() {
        val liftY = pointerY
        var moved = false
        while (scope.isActive && dragId != null) {
            val info = listState.layoutInfo
            val y = pointerY - info.viewportStartOffset
            if (!moved && kotlin.math.abs(pointerY - liftY) > 24f) moved = true
            val edge = info.viewportSize.height * 0.12f
            val step = when {
                !moved -> 0f
                y < edge -> -(edge - y) / 3f
                y > info.viewportSize.height - edge -> (y - (info.viewportSize.height - edge)) / 3f
                else -> 0f
            }
            if (step != 0f) {
                val scrolled = listState.scrollBy(step)
                pointerY += scrolled
                update()
            }
            delay(16)
        }
    }
}

@Composable
fun rememberUpNextDragState(
    listState: LazyListState,
    ids: List<String>,
    draggableResults: Set<String>,
    onLift: () -> Unit,
    onSlot: () -> Unit,
    onReorder: (List<String>) -> Unit,
    onDrop: (String, Int) -> Unit,
): UpNextDragState {
    val scope = rememberCoroutineScope()
    val currentIds by rememberUpdatedState(ids)
    val results by rememberUpdatedState(draggableResults)
    val lift by rememberUpdatedState(onLift)
    val slot by rememberUpdatedState(onSlot)
    val reorder by rememberUpdatedState(onReorder)
    val drop by rememberUpdatedState(onDrop)
    return remember(listState) {
        UpNextDragState(listState, scope, { currentIds }, { results }, { lift() }, { slot() }, { reorder(it) }, { id, i -> drop(id, i) })
    }
}

/** On the LazyColumn: press and hold a row / a result to lift it. */
fun Modifier.upNextDrag(state: UpNextDragState): Modifier = pointerInput(state) {
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
