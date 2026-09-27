package dev.jeromeswannack.chineselearning.lab.core

/**
 * Moving decks within the study queue — port of shared/decks/queue.ts (parity-tested in
 * DecksParityTest). The first id is studied first. Every function returns the SAME list
 * instance when nothing changes, like the TypeScript, so callers can skip a write.
 */
object DeckQueue {
    enum class Move(val wire: String) { TOP("top"), UP("up"), DOWN("down"), BOTTOM("bottom") }

    fun move(wire: String): Move? = Move.entries.firstOrNull { it.wire == wire }

    /** Port of `moveInOrder(orderedIds, id, to)`. */
    fun moveInOrder(orderedIds: List<String>, id: String, to: Move): List<String> {
        val i = orderedIds.indexOf(id)
        if (i < 0) return orderedIds
        val target = when (to) {
            Move.TOP -> 0
            Move.BOTTOM -> orderedIds.size - 1
            Move.UP -> i - 1
            Move.DOWN -> i + 1
        }
        if (target == i || target < 0 || target >= orderedIds.size) return orderedIds
        val next = orderedIds.filter { it != id }.toMutableList()
        next.add(target, id)
        return next
    }

    /** Port of `moveToIndex(ids, id, index)`: the order with [id] moved to [index]. */
    fun moveToIndex(ids: List<String>, id: String, index: Int): List<String> {
        val from = ids.indexOf(id)
        if (from < 0 || index < 0 || index >= ids.size || from == index) return ids
        val next = ids.filter { it != id }.toMutableList()
        next.add(index, id)
        return next
    }

    data class Rect(val left: Double, val top: Double, val width: Double, val height: Double)

    /**
     * Port of `indexUnderPointer(rects, x, y)`: the card containing the point, else the
     * nearest by centre; -1 for an empty list.
     */
    fun indexUnderPointer(rects: List<Rect>, x: Double, y: Double): Int {
        var best = -1
        var bestDist = Double.POSITIVE_INFINITY
        for (i in rects.indices) {
            val r = rects[i]
            if (x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height) return i
            val cx = r.left + r.width / 2
            val cy = r.top + r.height / 2
            val d = (cx - x) * (cx - x) + (cy - y) * (cy - y)
            if (d < bestDist) {
                bestDist = d
                best = i
            }
        }
        return best
    }

    /**
     * The priorities that make [orderedIds] the queue order (the web's `reorderQueue`:
     * first id = highest, `length - i`), for mirroring a reorder locally.
     */
    fun prioritiesFor(orderedIds: List<String>): Map<String, Int> =
        orderedIds.mapIndexed { i, id -> id to orderedIds.size - i }.toMap()

    /** The web's `moveDeckInQueue` local priority: above every deck (top) or below every deck (bottom). */
    fun edgePriority(priorities: Collection<Int>, top: Boolean): Int =
        if (top) maxOf(0, priorities.maxOrNull() ?: 0) + 1 else minOf(0, priorities.minOrNull() ?: 0) - 1
}
