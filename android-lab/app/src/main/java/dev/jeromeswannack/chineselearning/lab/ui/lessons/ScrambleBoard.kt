package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.jeromeswannack.chineselearning.lab.core.ScrambleOrder
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.kit.dashedBorder
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlin.math.roundToInt

/** Test tags of the word-order board (ScrambleBoardUiTest). */
object ScrambleTags {
    const val ANSWER = "scramble-answer"
    const val POOL = "scramble-pool"
    const val PLACED = "scramble-placed-tile"
    const val POOL_TILE = "scramble-pool-tile"
    const val GAP = "scramble-gap"
    const val FLOATING = "scramble-floating-tile"
}

private data class BoardDrag(
    val src: ScrambleOrder.Drag,
    val tile: Int,
    val zone: ScrambleOrder.Zone,
    val slot: Int,
    /** The finger, and where on the tile it took hold — board-local px. */
    val pointer: Offset,
    val grab: Offset,
)

/** The laid-out pieces of the board, read by the gesture (never state: reading them must not recompose). */
private class BoardLayout {
    var board: LayoutCoordinates? = null
    var answer: LayoutCoordinates? = null
    var pool: LayoutCoordinates? = null
    /**
     * The answer row's tiles BY PLACE (the row is composed by place, not keyed by tile: FlowRow doesn't re-measure when
     * keyed children only move, so a moved tile stayed where it was) and which tile each place shows now.
     */
    val placedAt = HashMap<Int, LayoutCoordinates>()
    var shown: List<Int> = emptyList()

    /** The box of tile [tile] in the answer row, as laid out now. */
    fun placedRect(tile: Int): ScrambleOrder.Rect? = shown.indexOf(tile).takeIf { it >= 0 }?.let { rect(placedAt[it]) }
    val poolTiles = HashMap<Int, LayoutCoordinates>()

    fun rect(c: LayoutCoordinates?): ScrambleOrder.Rect? {
        val b = board ?: return null
        if (c == null || !c.isAttached || !b.isAttached) return null
        val r = b.localBoundingBoxOf(c, clipBounds = false)
        return ScrambleOrder.Rect(r.left.toDouble(), r.top.toDouble(), r.width.toDouble(), r.height.toDouble())
    }

    fun contains(c: LayoutCoordinates?, p: Offset): Boolean {
        val r = rect(c) ?: return false
        return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height
    }
}

/**
 * The word order's answer row + pool (port of the web's ScrambleExercise rows + useScrambleDrag; rules in core
 * ScrambleOrder, parity-tested): a tap places a pool tile at the end / takes a placed tile out (as before); a press that
 * travels past the touch slop DRAGS the tile — a copy follows the finger, the answer shows a dashed gap where it will
 * land (the other tiles move round it over lines that wrap), letting go over the answer puts it there, a placed tile
 * let go over the pool comes out, anywhere else nothing changes. The gesture is the board's, so the tile it started on
 * can change shape (gap / ghost) mid-drag without losing it; the drag consumes the moves, so the page never scrolls
 * under it (a swipe that starts off a tile still scrolls). A haptic tick on pick-up and drop. Each placed tile has the
 * a11y actions Move left / Move right. Checked: [doneTile] draws his blocks (to explore).
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ScrambleBoard(
    tiles: List<String>,
    pool: List<Int>,
    picked: SnapshotStateList<Int>,
    checked: Boolean,
    env: ExerciseEnv,
    doneTile: @Composable (String) -> Unit,
) {
    val layout = remember { BoardLayout() }
    var drag by remember { mutableStateOf<BoardDrag?>(null) }
    val enabled by rememberUpdatedState(!checked)
    val envNow by rememberUpdatedState(env)

    fun commit(next: List<Int>) {
        picked.clear()
        picked.addAll(next)
    }

    /** The zone under [p] and, over the answer, the slot among the OTHER placed tiles' boxes (as laid out now). */
    fun measure(src: ScrambleOrder.Drag, p: Offset, prev: BoardDrag?, slackPx: Double): Pair<ScrambleOrder.Zone, Int> {
        val zone = ScrambleOrder.zone(layout.rect(layout.answer), layout.rect(layout.pool), p.x.toDouble(), p.y.toDouble(), slackPx)
        val order = picked.toList()
        val slot = if (zone == ScrambleOrder.Zone.Answer) {
            val others = ScrambleOrder.others(order, src).mapNotNull { layout.placedRect(it) }
            ScrambleOrder.dropSlot(others, p.x.toDouble(), p.y.toDouble())
        } else prev?.slot ?: (src as? ScrambleOrder.Drag.FromAnswer)?.index ?: order.size
        return zone to slot
    }

    val gesture = Modifier.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            if (!enabled) return@awaitEachGesture
            val order = picked.toList()
            val placedAt = order.indexOfFirst { t -> layout.placedRect(t)?.let { r -> down.position.x >= r.left && down.position.x <= r.left + r.width && down.position.y >= r.top && down.position.y <= r.top + r.height } == true }
            val src: ScrambleOrder.Drag = when {
                placedAt >= 0 -> ScrambleOrder.Drag.FromAnswer(placedAt)
                else -> pool.firstOrNull { it !in order && layout.contains(layout.poolTiles[it], down.position) }
                    ?.let { ScrambleOrder.Drag.FromPool(it) } ?: return@awaitEachGesture
            }
            val slop = minOf(viewConfiguration.touchSlop, ScrambleOrder.DRAG_START.dp.toPx())
            val slackPx = ScrambleOrder.DROP_SLACK.dp.toPx().toDouble()
            // Until the finger travels past the slop it is a tap (the tile's own click).
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull { it.id == down.id } ?: return@awaitEachGesture
                if (!ch.pressed) return@awaitEachGesture
                if (ch.isConsumed) return@awaitEachGesture
                if ((ch.position - down.position).getDistance() > slop) {
                    ch.consume()
                    val tileRect = if (src is ScrambleOrder.Drag.FromAnswer) layout.placedRect(order[src.index]) else layout.rect(layout.poolTiles[(src as ScrambleOrder.Drag.FromPool).tile])
                    val grab = if (tileRect != null) Offset((down.position.x - tileRect.left).toFloat(), (down.position.y - tileRect.top).toFloat()) else Offset.Zero
                    val first = BoardDrag(
                        src, ScrambleOrder.dragTile(order, src),
                        if (src is ScrambleOrder.Drag.FromAnswer) ScrambleOrder.Zone.Answer else ScrambleOrder.Zone.Pool,
                        (src as? ScrambleOrder.Drag.FromAnswer)?.index ?: order.size,
                        ch.position, grab,
                    )
                    val (z, s) = measure(src, ch.position, first, slackPx)
                    drag = first.copy(zone = z, slot = s)
                    envNow.onTap()
                    break
                }
            }
            // Dragging: the gap follows the finger; letting go commits.
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull { it.id == down.id }
                val cur = drag ?: return@awaitEachGesture
                if (ch == null || !ch.pressed) {
                    drag = null
                    if (ch == null) return@awaitEachGesture
                    ch.consume()
                    val result = ScrambleOrder.drop(picked.toList(), cur.src, cur.zone, cur.slot)
                    envNow.onTap()
                    if (result.change != "none") {
                        commit(result.order)
                        Analytics.track("lesson.scramble_reorder", mapOf("how" to "drag", "from_pool" to (cur.src is ScrambleOrder.Drag.FromPool), "change" to result.change))
                    }
                    return@awaitEachGesture
                }
                ch.consume()
                val (z, s) = measure(cur.src, ch.position, cur, slackPx)
                drag = cur.copy(zone = z, slot = s, pointer = ch.position)
            }
        }
    }

    val d = drag
    val shown = if (d != null && !checked) ScrambleOrder.preview(picked.toList(), d.src, d.zone, d.slot) else picked.toList()
    Box(
        Modifier.fillMaxWidth()
            .onGloballyPositioned { layout.board = it }
            .then(if (checked) Modifier else gesture),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            // The answer row.
            val overAnswer = d?.zone == ScrambleOrder.Zone.Answer
            FlowRow(
                Modifier.fillMaxWidth().heightIn(min = 72.dp)
                    .onGloballyPositioned { layout.answer = it }
                    .clip(RoundedCornerShape(18.dp)).background(Lab.colors.faint)
                    .then(if (overAnswer) Modifier.border(1.5.dp, Lab.colors.accent, RoundedCornerShape(18.dp)) else Modifier)
                    .padding(10.dp)
                    .testTag(ScrambleTags.ANSWER),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (shown.isEmpty() && !overAnswer) Text("Tap tiles below", color = Lab.colors.muted, modifier = Modifier.padding(12.dp))
                if (checked) {
                    picked.forEach { doneTile(tiles[it]) }
                } else {
                    SideEffect { layout.shown = shown }
                    // By place, never keyed by tile (see BoardLayout.placedAt).
                    shown.forEachIndexed { i, tileIndex ->
                        run {
                            if (d?.tile == tileIndex) {
                                GapTile(tiles[tileIndex])
                            } else {
                                PlacedTile(
                                    tiles[tileIndex],
                                    label = ScrambleOrder.tileLabel(tiles[tileIndex], i, shown.size),
                                    onPositioned = { layout.placedAt[i] = it },
                                    onMove = { dir ->
                                        // Its place NOW (the action may outlive the composition that made it).
                                        val next = ScrambleOrder.nudge(picked.toList(), picked.indexOf(tileIndex), dir)
                                        if (next != picked.toList()) {
                                            commit(next)
                                            env.onTap()
                                            Analytics.track("lesson.scramble_reorder", mapOf("how" to "a11y", "from_pool" to false, "change" to "moved"))
                                            true
                                        } else false
                                    },
                                ) {
                                    picked.remove(tileIndex)
                                    env.onTap()
                                }
                            }
                        }
                    }
                }
            }
            // The pool.
            FlowRow(
                Modifier.fillMaxWidth().onGloballyPositioned { layout.pool = it }.testTag(ScrambleTags.POOL),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (i in pool) {
                    key(i) {
                        val isPicked = i in picked || (d?.src is ScrambleOrder.Drag.FromPool && d.tile == i)
                        PoolTile(tiles[i], ghost = isPicked, enabled = !isPicked && !checked, onPositioned = { layout.poolTiles[i] = it }) {
                            picked.add(i)
                            env.onTap()
                        }
                    }
                }
            }
        }
        // The copy under the finger.
        if (d != null && !checked) {
            Text(
                tiles[d.tile],
                fontSize = 22.sp,
                color = Lab.colors.ink,
                // The tag before clearAndSetSemantics (which clears what follows): the copy says nothing to TalkBack.
                modifier = Modifier
                    .testTag(ScrambleTags.FLOATING)
                    .clearAndSetSemantics { }
                    .offset { IntOffset((d.pointer.x - d.grab.x).roundToInt(), (d.pointer.y - d.grab.y).roundToInt()) }
                    .zIndex(2f)
                    .graphicsLayer { scaleX = 1.06f; scaleY = 1.06f }
                    .shadow(10.dp, RoundedCornerShape(12.dp))
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                    .border(1.5.dp, Lab.colors.accent, RoundedCornerShape(12.dp))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

private val TileShape = RoundedCornerShape(12.dp)

private fun Modifier.tileBox(): Modifier = this.heightIn(min = 48.dp)

@Composable
private fun PlacedTile(text: String, label: String, onPositioned: (LayoutCoordinates) -> Unit, onMove: (Int) -> Boolean, onClick: () -> Unit) {
    Text(
        text,
        fontSize = 22.sp,
        color = Lab.colors.ink,
        modifier = Modifier.tileBox()
            .onGloballyPositioned(onPositioned)
            .semantics {
                contentDescription = label
                customActions = listOf(
                    CustomAccessibilityAction("Move left") { onMove(-1) },
                    CustomAccessibilityAction("Move right") { onMove(1) },
                )
            }
            .bouncyClickable(true, 0.9f, onClick = onClick)
            .clip(TileShape).background(Lab.colors.card)
            .border(1.5.dp, Lab.colors.outline, TileShape)
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .testTag(ScrambleTags.PLACED),
    )
}

/** The dragged tile's place: the same size, a dashed accent outline, no text. */
@Composable
private fun GapTile(text: String) {
    Text(
        text,
        fontSize = 22.sp,
        color = Color.Transparent,
        modifier = Modifier.testTag(ScrambleTags.GAP).clearAndSetSemantics { }
            .tileBox()
            .clip(TileShape)
            .dashedBorder(TileShape, Lab.colors.accent, 1.5.dp)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun PoolTile(text: String, ghost: Boolean, enabled: Boolean, onPositioned: (LayoutCoordinates) -> Unit, onClick: () -> Unit) {
    val alpha by animateFloatAsState(if (ghost) 0.25f else 1f, tween(160), label = "tile")
    Text(
        text,
        fontSize = 22.sp,
        color = Lab.colors.ink.copy(alpha = alpha),
        modifier = Modifier.tileBox()
            .onGloballyPositioned(onPositioned)
            .bouncyClickable(enabled, 0.9f, onClick = onClick)
            .clip(TileShape).background(Lab.colors.card.copy(alpha = if (ghost) 0.4f else 1f))
            .border(1.5.dp, Lab.colors.outline.copy(alpha = alpha), TileShape)
            .padding(horizontal = 14.dp, vertical = 8.dp)
            .testTag(ScrambleTags.POOL_TILE),
    )
}
