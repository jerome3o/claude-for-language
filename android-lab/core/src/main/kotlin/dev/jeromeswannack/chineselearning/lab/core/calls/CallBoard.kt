package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Port of shared/calls/board.ts — the shared whiteboard of a video call: a list of drawing
 * ops on a fixed virtual canvas. Coordinates are 0..1 of [BOARD_WIDTH] × [BOARD_HEIGHT], so
 * both sides draw the same picture whatever size their screen is. Parity-tested against the
 * TypeScript (parity/fixtures/calls.ts → CallsParityTest).
 */
object CallBoard {
    const val BOARD_WIDTH = 1600
    const val BOARD_HEIGHT = 1000

    /** Oldest ops are dropped past this — a board is a scratchpad, not an archive. */
    const val MAX_BOARD_OPS = 2000
    const val MAX_STROKE_POINTS = 4000
    const val MAX_TEXT_LENGTH = 500

    val BOARD_COLORS = listOf("#1f2937", "#dc2626", "#2563eb", "#16a34a", "#d97706")

    private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

    private fun clamp01(n: Double) = minOf(1.0, maxOf(0.0, n))
    private fun round4(n: Double) = Js.round(n * 10_000) / 10_000

    /** Port of sanitizeBoardOp: validate and normalise an op off the wire; null for junk. `by` is always [by]. */
    fun sanitize(raw: JsonElement?, by: String): BoardOp? {
        val op = raw as? JsonObject ?: return null
        val idRaw = (op["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        val id = idRaw?.takeIf { it.isNotEmpty() && it.length <= 64 }
        val color = (op["color"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { COLOR.matches(it) }
        return when ((op["type"] as? JsonPrimitive)?.takeIf { it.isString }?.content) {
            "stroke" -> {
                val pts = op["points"] as? JsonArray
                if (id == null || color == null || pts == null) return null
                val width = jsNumber(op["width"])
                if (!width.isFinite() || width <= 0 || width > 80) return null
                val points = ArrayList<BoardPoint>()
                for (p in pts.take(MAX_STROKE_POINTS)) {
                    if (p !is JsonArray || p.size < 2) continue
                    val x = jsNumber(p[0])
                    val y = jsNumber(p[1])
                    if (!x.isFinite() || !y.isFinite()) continue
                    points += BoardPoint(round4(clamp01(x)), round4(clamp01(y)))
                }
                if (points.isEmpty()) null else BoardItem.Stroke(id, by, color, width, points)
            }
            "text" -> {
                val rawText = (op["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content
                if (id == null || color == null || rawText == null) return null
                val text = JsJson.trim(rawText).take(MAX_TEXT_LENGTH)
                val x = jsNumber(op["x"])
                val y = jsNumber(op["y"])
                val size = jsNumber(op["size"])
                if (text.isEmpty() || !x.isFinite() || !y.isFinite() || !size.isFinite() || size < 8 || size > 200) return null
                BoardItem.Text(id, by, color, round4(clamp01(x)), round4(clamp01(y)), size, text)
            }
            "delete" -> id?.let { BoardOp.Delete(it, by) }
            "clear" -> BoardOp.Clear(by)
            else -> null
        }
    }

    /** Port of applyBoardOp: one op applied to the items on the board (returns a new list). */
    fun apply(items: List<BoardItem>, op: BoardOp): List<BoardItem> = when (op) {
        is BoardOp.Clear -> emptyList()
        is BoardOp.Delete -> items.filter { it.id != op.id }
        is BoardItem -> {
            val without = items.filterTo(ArrayList()) { it.id != op.id }
            without += op
            if (without.size > MAX_BOARD_OPS) without.subList(without.size - MAX_BOARD_OPS, without.size).toList() else without
        }
    }

    /** Port of lastItemBy: the id of [userId]'s most recent item — what Undo removes. */
    fun lastItemBy(items: List<BoardItem>, userId: String): String? = items.lastOrNull { it.by == userId }?.id

    /** Parses a stored / relayed op without re-validating it (the room already did); null when unreadable. */
    fun parse(el: JsonElement?): BoardOp? {
        val o = el as? JsonObject ?: return null
        val by = (o["by"] as? JsonPrimitive)?.contentOrNullString() ?: ""
        return sanitize(o, by)
    }

    fun parseItems(el: JsonElement?): List<BoardItem> = (el as? JsonArray)?.mapNotNull { parse(it) as? BoardItem }.orEmpty()

    /** JS `Number(value)` for the JSON values the board sees. */
    internal fun jsNumber(el: JsonElement?): Double {
        if (el == null) return Double.NaN
        if (el is JsonNull) return 0.0
        val p = el as? JsonPrimitive ?: return Double.NaN
        if (!p.isString) {
            return when (p.content) {
                "true" -> 1.0
                "false" -> 0.0
                else -> p.content.toDoubleOrNull() ?: Double.NaN
            }
        }
        val s = JsJson.trim(p.content)
        if (s.isEmpty()) return 0.0
        return when {
            s == "Infinity" || s == "+Infinity" -> Double.POSITIVE_INFINITY
            s == "-Infinity" -> Double.NEGATIVE_INFINITY
            Regex("^0[xX][0-9a-fA-F]+$").matches(s) -> s.substring(2).toLong(16).toDouble()
            Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$").matches(s) -> s.toDouble()
            else -> Double.NaN
        }
    }

    private fun JsonPrimitive.contentOrNullString(): String? = if (isString) content else null
}

data class BoardPoint(val x: Double, val y: Double)

/** Port of the BoardOp union: an item (stroke / text), a delete or a clear. */
sealed interface BoardOp {
    val by: String

    data class Delete(val id: String, override val by: String) : BoardOp
    data class Clear(override val by: String) : BoardOp

    fun toJson(): JsonObject = when (this) {
        is Delete -> buildJsonObject { put("type", "delete"); put("id", id); put("by", by) }
        is Clear -> buildJsonObject { put("type", "clear"); put("by", by) }
        is BoardItem.Stroke -> buildJsonObject {
            put("type", "stroke"); put("id", id); put("by", by); put("color", color); put("width", width)
            put("points", JsonArray(points.map { JsonArray(listOf(JsonPrimitive(it.x), JsonPrimitive(it.y))) }))
        }
        is BoardItem.Text -> buildJsonObject {
            put("type", "text"); put("id", id); put("by", by); put("color", color)
            put("x", x); put("y", y); put("size", size); put("text", text)
        }
    }
}

/** What stays on the board: a stroke or a piece of text. */
sealed interface BoardItem : BoardOp {
    val id: String

    data class Stroke(override val id: String, override val by: String, val color: String, val width: Double, val points: List<BoardPoint>) : BoardItem
    data class Text(override val id: String, override val by: String, val color: String, val x: Double, val y: Double, val size: Double, val text: String) : BoardItem
}

/** A stroke still being drawn ('board_live'): streamed, never stored. */
data class LiveStroke(val id: String, val color: String, val width: Double, val points: List<BoardPoint>) {
    fun toJson(): JsonObject = buildJsonObject {
        put("id", id); put("color", color); put("width", width)
        put("points", JsonArray(points.map { JsonArray(listOf(JsonPrimitive(it.x), JsonPrimitive(it.y))) }))
    }

    companion object {
        fun parse(el: JsonElement?): LiveStroke? {
            val o = el as? JsonObject ?: return null
            val id = (o["id"] as? JsonPrimitive)?.content ?: return null
            val color = (o["color"] as? JsonPrimitive)?.content ?: return null
            val width = CallBoard.jsNumber(o["width"]).takeIf { it.isFinite() } ?: return null
            val pts = (o["points"] as? JsonArray)?.mapNotNull { p ->
                val a = p as? JsonArray ?: return@mapNotNull null
                if (a.size < 2) return@mapNotNull null
                val x = CallBoard.jsNumber(a[0]); val y = CallBoard.jsNumber(a[1])
                if (x.isFinite() && y.isFinite()) BoardPoint(x, y) else null
            }.orEmpty()
            return LiveStroke(id, color, width, pts)
        }
    }
}
