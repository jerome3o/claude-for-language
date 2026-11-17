package dev.jeromeswannack.chineselearning.lab.core

/*
 * Port of shared/lesson/scrambleOrder.ts — rearranging a word order (scramble) by hand (docs/STUDY_SESSION.md
 * "Mini lessons" → "Word order"). Jerome: "it would be nice if I could click and drag and rearrange stuff so that
 * the order that I click them in isn't final." A tap still places (at the end) / takes out a tile; a DRAG moves a
 * placed tile, brings a pool tile in at a place, or takes a placed tile back to the pool; Move left / right moves a
 * placed tile one place (the a11y actions). Orders are lists of tile indexes. Parity-tested by ScrambleOrderParityTest
 * (parity/fixtures/scramble-order.ts). Checking is untouched (ScrambleCheck).
 */
object ScrambleOrder {
    /** Port of SCRAMBLE_DRAG_START (px on the web, dp here): travel before a press is a drag. */
    const val DRAG_START = 8.0

    /** Port of SCRAMBLE_DROP_SLACK (px / dp outside the answer / pool that still counts as on it). */
    const val DROP_SLACK = 24.0

    /** Port of SCRAMBLE_TILE_HINT. */
    const val TILE_HINT = "Tap to take it out. Drag, or use the arrow keys, to move it."

    data class Rect(val left: Double, val top: Double, val width: Double, val height: Double)

    /** Port of ScrambleDrag: a placed tile (its place) or a pool tile (its tile index). */
    sealed class Drag {
        data class FromAnswer(val index: Int) : Drag()
        data class FromPool(val tile: Int) : Drag()
    }

    /** Port of ScrambleZone. */
    enum class Zone(val key: String) { Answer("answer"), Pool("pool"), None("none") }

    /** What a drop did — `change` of analytics `lesson.scramble_reorder`. */
    data class Dropped(val order: List<Int>, val change: String)

    private fun inside(r: Rect?, x: Double, y: Double, slack: Double): Boolean =
        r != null && x >= r.left - slack && x <= r.left + r.width + slack && y >= r.top - slack && y <= r.top + r.height + slack

    /** Port of scrambleZone(). */
    fun zone(answer: Rect?, pool: Rect?, x: Double, y: Double, slack: Double = DROP_SLACK): Zone = when {
        inside(answer, x, y, slack) -> Zone.Answer
        inside(pool, x, y, slack) -> Zone.Pool
        else -> Zone.None
    }

    /** Port of scrambleRows(): [start, end) per wrapped line. */
    fun rows(rects: List<Rect>): List<Pair<Int, Int>> {
        val out = mutableListOf<Pair<Int, Int>>()
        if (rects.isEmpty()) return out
        var start = 0
        for (i in 1 until rects.size) {
            val first = rects[start]
            if (rects[i].top >= first.top + first.height / 2) {
                out += start to i
                start = i
            }
        }
        out += start to rects.size
        return out
    }

    /** Port of scrambleDropSlot(): 0..rects.size, nearest gap over wrapped lines. */
    fun dropSlot(rects: List<Rect>, x: Double, y: Double): Int {
        val rows = rows(rects)
        if (rows.isEmpty()) return 0
        var best = rows[0]
        var bestDist = Double.POSITIVE_INFINITY
        for (row in rows) {
            var top = Double.POSITIVE_INFINITY
            var bottom = Double.NEGATIVE_INFINITY
            for (i in row.first until row.second) {
                top = minOf(top, rects[i].top)
                bottom = maxOf(bottom, rects[i].top + rects[i].height)
            }
            val d = if (y < top) top - y else if (y > bottom) y - bottom else 0.0
            if (d < bestDist) {
                bestDist = d
                best = row
            }
        }
        for (i in best.first until best.second) {
            val r = rects[i]
            if (x < r.left + r.width / 2) return i
        }
        return best.second
    }

    /** Port of scrambleDragTile(). */
    fun dragTile(order: List<Int>, drag: Drag): Int = when (drag) {
        is Drag.FromAnswer -> order[drag.index]
        is Drag.FromPool -> drag.tile
    }

    /** Port of scrambleOthers(). */
    fun others(order: List<Int>, drag: Drag): List<Int> = when (drag) {
        is Drag.FromAnswer -> order.filterIndexed { i, _ -> i != drag.index }
        is Drag.FromPool -> order.filter { it != drag.tile }
    }

    /** Port of scrambleInsertAt(). */
    fun insertAt(order: List<Int>, tile: Int, at: Int): List<Int> =
        order.toMutableList().apply { add(at.coerceIn(0, size), tile) }

    /** Port of scrambleRemoveAt(). */
    fun removeAt(order: List<Int>, at: Int): List<Int> =
        if (at < 0 || at >= order.size) order else order.filterIndexed { i, _ -> i != at }

    /** Port of scrambleMoveTo(). */
    fun moveTo(order: List<Int>, from: Int, to: Int): List<Int> {
        if (from < 0 || from >= order.size) return order
        val target = to.coerceIn(0, order.size - 1)
        if (target == from) return order
        val next = order.filterIndexed { i, _ -> i != from }.toMutableList()
        next.add(target, order[from])
        return next
    }

    /** Port of scrambleNudge(): one place left (-1) / right (+1). */
    fun nudge(order: List<Int>, index: Int, dir: Int): List<Int> = moveTo(order, index, index + dir)

    /** Port of scramblePreview(). */
    fun preview(order: List<Int>, drag: Drag, zone: Zone, slot: Int): List<Int> {
        val others = others(order, drag)
        if (zone == Zone.Answer) return insertAt(others, dragTile(order, drag), slot)
        if (drag is Drag.FromAnswer && zone == Zone.None) return order.toList()
        return others
    }

    /** Port of scrambleDrop(). */
    fun drop(order: List<Int>, drag: Drag, zone: Zone, slot: Int): Dropped {
        val unchanged = Dropped(order.toList(), "none")
        if (drag is Drag.FromAnswer && (drag.index < 0 || drag.index >= order.size)) return unchanged
        if (zone == Zone.Answer) {
            val next = insertAt(others(order, drag), dragTile(order, drag), slot)
            if (drag is Drag.FromPool) return Dropped(next, if (drag.tile in order) "moved" else "inserted")
            return if (next == order) unchanged else Dropped(next, "moved")
        }
        if (zone == Zone.Pool && drag is Drag.FromAnswer) return Dropped(removeAt(order, drag.index), "removed")
        return unchanged
    }

    /** Port of scrambleTileLabel(). */
    fun tileLabel(text: String, index: Int, count: Int): String = "${text.trim()}, ${index + 1} of $count"

    /** Port of scrambleMovedAnnouncement(). */
    fun movedAnnouncement(text: String, index: Int, count: Int): String = "${text.trim()} moved to ${index + 1} of $count"
}
