package dev.jeromeswannack.chineselearning.lab.core.calls

import dev.jeromeswannack.chineselearning.lab.core.Js
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray

/** A stroke on a shared screen: points 0..1 of the shared picture. */
data class AnnotStroke(val id: String, val color: String, val width: Double, val points: List<Pair<Double, Double>>, val done: Boolean) {
    fun toJson() = buildJsonObject {
        put("id", id); put("color", color); put("width", width)
        putJsonArray("points") { points.forEach { (x, y) -> add(buildJsonArray { add(x); add(y) }) } }
        put("done", done)
    }
}

/** A stroke as shown: who drew it, when it was finished (local clock, null while drawing). */
data class ShownStroke(val stroke: AnnotStroke, val from: String, val doneAt: Long?)

data class AnnotPing(val id: String, val from: String, val x: Double, val y: Double, val at: Long)

/**
 * A text box on a shared screen (round 4, web `AnnotText`): top-left at ([x], [y]) on the shared picture
 * (0..1), [size] = font size as a fraction of the picture's shorter side, in the writer's colour.
 * [done] = the writer finished it (Enter / tapped away): it fades unless drawings are kept.
 */
data class AnnotText(val id: String, val color: String, val x: Double, val y: Double, val text: String, val size: Double = CallAnnotate.ANNOT_TEXT_SIZE, val done: Boolean) {
    fun toJson() = buildJsonObject {
        put("id", id); put("color", color); put("x", x); put("y", y); put("text", text); put("size", size); put("done", done)
    }
}

/** A text as shown: who last wrote / moved it, when it was finished (local clock, null while typed). */
data class ShownText(val text: AnnotText, val from: String, val doneAt: Long?)

/** Port of KeptAnnotations: what the room keeps while drawings are kept (sent in `welcome.annots`). */
data class KeptAnnotations(val strokes: List<KeptStroke> = emptyList(), val texts: List<KeptText> = emptyList()) {
    data class KeptStroke(val key: String, val from: String, val name: String, val stroke: AnnotStroke)
    data class KeptText(val from: String, val name: String, val text: AnnotText)

    fun toJson() = buildJsonObject {
        putJsonArray("strokes") { strokes.forEach { s -> add(buildJsonObject { put("key", s.key); put("from", s.from); put("name", s.name); put("stroke", s.stroke.toJson()) }) } }
        putJsonArray("texts") { texts.forEach { t -> add(buildJsonObject { put("from", t.from); put("name", t.name); put("text", t.text.toJson()) }) } }
    }
}

/**
 * Port of shared/calls/annotate.ts — drawing on a shared screen: normalised points on the shared
 * picture (so they land on the same spot in any window), fading after the pen lifts (or kept while
 * "Keep" is on — `annot_mode`, one setting for both people), pings, and the per-role default pen
 * (the sharer blue, the viewer red).
 * Parity-tested (parity/fixtures/calls-annotate.ts → CallsAnnotateParityTest).
 */
object CallAnnotate {
    val ANNOT_COLORS = listOf("#f43f5e", "#facc15", "#22c55e", "#38bdf8")
    const val MAX_ANNOT_POINTS = 600
    const val ANNOT_HOLD_MS = 3_000L
    const val ANNOT_FADE_MS = 1_200L
    const val PING_MS = 1_600L
    const val ANNOT_WIDTH = 0.006

    private val COLOR = Regex("^#[0-9a-fA-F]{6}$")
    private fun round4(n: Double) = Js.round(n * 10_000) / 10_000
    private fun clamp01(n: Double) = minOf(1.0, maxOf(0.0, n))

    /** Port of normalizePoint: box-relative pointer → [x, y] on the picture shown with contain, or null in the letterbox. */
    fun normalizePoint(px: Double, py: Double, box: VideoFit.Size, video: VideoFit.Size?): Pair<Double, Double>? {
        val r = VideoFit.containRect(video, box)
        if (r.width <= 0 || r.height <= 0) return null
        val x = (px - r.x) / r.width
        val y = (py - r.y) / r.height
        if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return null
        return round4(clamp01(x)) to round4(clamp01(y))
    }

    fun denormalizePoint(p: Pair<Double, Double>, box: VideoFit.Size, video: VideoFit.Size?): Pair<Double, Double> {
        val r = VideoFit.containRect(video, box)
        return (r.x + p.first * r.width) to (r.y + p.second * r.height)
    }

    /** The pen colour each person starts with, so two people drawing at once are told apart. */
    const val SHARER_ANNOT_COLOR = "#38bdf8"
    const val VIEWER_ANNOT_COLOR = "#f43f5e"

    /** Port of defaultAnnotColor. */
    fun defaultAnnotColor(iAmSharing: Boolean): String = if (iAmSharing) SHARER_ANNOT_COLOR else VIEWER_ANNOT_COLOR

    /** Port of strokeAlpha: 1 while drawing and for ANNOT_HOLD_MS after, then fading — or always 1 while drawings are kept ([persist]). */
    fun strokeAlpha(doneAt: Long?, now: Long, persist: Boolean = false): Double {
        if (doneAt == null || persist) return 1.0
        val t = (now - doneAt - ANNOT_HOLD_MS).toDouble()
        if (t <= 0) return 1.0
        return maxOf(0.0, 1 - t / ANNOT_FADE_MS)
    }

    fun pingProgress(at: Long, now: Long): Double? {
        val t = (now - at).toDouble() / PING_MS
        return if (t < 0) 0.0 else if (t >= 1) null else t
    }

    /** Port of pruneAnnotations: drop what has faded away (nothing while kept). */
    fun <T> pruneAnnotations(strokes: Map<String, T>, now: Long, persist: Boolean = false, doneAt: (T) -> Long?): Map<String, T> =
        strokes.filterValues { strokeAlpha(doneAt(it), now, persist) > 0 }

    private fun num(el: JsonElement?): Double? = when (el) {
        is JsonPrimitive -> if (el.isString) el.content.trim().let { s -> if (s.isEmpty()) 0.0 else s.toDoubleOrNull() }
        else el.booleanOrNull?.let { if (it) 1.0 else 0.0 } ?: el.doubleOrNull ?: if (el.content == "null") 0.0 else null
        else -> null
    }

    /** Port of sanitizeAnnotStroke. */
    fun sanitizeStroke(raw: JsonElement?): AnnotStroke? {
        val o = raw as? JsonObject ?: return null
        val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val color = (o["color"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val pts = o["points"] as? JsonArray ?: return null
        if (id.isEmpty() || id.length > 64 || !COLOR.matches(color)) return null
        val width = num(o["width"]) ?: return null
        if (!width.isFinite() || width <= 0 || width > 0.05) return null
        val points = ArrayList<Pair<Double, Double>>()
        for (p in pts.take(MAX_ANNOT_POINTS)) {
            val a = p as? JsonArray ?: continue
            if (a.size < 2) continue
            val x = num(a[0]) ?: continue
            val y = num(a[1]) ?: continue
            if (!x.isFinite() || !y.isFinite()) continue
            points.add(round4(clamp01(x)) to round4(clamp01(y)))
        }
        if (points.isEmpty()) return null
        val done = (o["done"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true
        return AnnotStroke(id, color, width, points, done)
    }

    fun sanitizePing(raw: JsonElement?): Pair<Double, Double>? {
        val o = raw as? JsonObject ?: return null
        val x = num(o["x"] ?: JsonPrimitive(Double.NaN)) ?: return null
        val y = num(o["y"] ?: JsonPrimitive(Double.NaN)) ?: return null
        if (!x.isFinite() || !y.isFinite()) return null
        return round4(clamp01(x)) to round4(clamp01(y))
    }

    // ------------------------------------------------------------ text boxes (round 4)

    const val ANNOT_TEXT_SIZE = 0.032
    const val MAX_ANNOT_TEXT_CHARS = 200
    /** The room keeps at most this many strokes / texts while drawings are kept. */
    const val MAX_KEPT_STROKES = 300
    const val MAX_KEPT_TEXTS = 100
    /** Keep drawings (and texts) until cleared: the default when the room never said otherwise. */
    const val DEFAULT_ANNOT_PERSIST = true

    /** Port of annotPersistOf: the room's stored setting → whether drawings are kept (null = never set = the default). */
    fun annotPersistOf(stored: Boolean?): Boolean = stored ?: DEFAULT_ANNOT_PERSIST

    private val CRLF = Regex("\r\n?")

    /** Port of sanitizeAnnotText: text kept as typed (Chinese, emoji), lines joined by \n, ≤ 200 characters (code points). */
    fun sanitizeText(raw: JsonElement?): AnnotText? {
        val o = raw as? JsonObject ?: return null
        val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val color = (o["color"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val rawText = (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        if (id.isEmpty() || id.length > 64 || !COLOR.matches(color)) return null
        val x = num(o["x"]) ?: return null
        val y = num(o["y"]) ?: return null
        if (!x.isFinite() || !y.isFinite()) return null
        val size = num(o["size"]) ?: Double.NaN
        val unix = CRLF.replace(rawText, "\n")
        val sb = StringBuilder()
        unix.codePoints().limit(MAX_ANNOT_TEXT_CHARS.toLong()).forEach { sb.appendCodePoint(it) }
        return AnnotText(
            id = id, color = color,
            x = round4(clamp01(x)), y = round4(clamp01(y)),
            text = sb.toString(),
            size = if (size.isFinite() && size >= 0.01 && size <= 0.12) round4(size) else ANNOT_TEXT_SIZE,
            done = (o["done"] as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull == true,
        )
    }

    /** Port of moveAnnotText: a text's top-left after dragging it by (dx, dy) of the picture, kept on the picture. */
    fun moveAnnotText(x: Double, y: Double, dx: Double, dy: Double): Pair<Double, Double> =
        round4(minOf(0.98, clamp01(x + dx))) to round4(minOf(0.98, clamp01(y + dy)))

    /** Port of textAlpha (same rule as strokes). */
    fun textAlpha(doneAt: Long?, now: Long, persist: Boolean = false): Double = strokeAlpha(doneAt, now, persist)

    /** Port of keepStroke: finished strokes only, by `from:id`, newest last, ≤ [MAX_KEPT_STROKES]. */
    fun keepStroke(k: KeptAnnotations, from: String, name: String, stroke: AnnotStroke): KeptAnnotations {
        if (!stroke.done) return k
        val key = "$from:${stroke.id}"
        return k.copy(strokes = (k.strokes.filter { it.key != key } + KeptAnnotations.KeptStroke(key, from, name, stroke)).takeLast(MAX_KEPT_STROKES))
    }

    /** Port of keepText: the latest of each text (by id), newest last, ≤ [MAX_KEPT_TEXTS]. */
    fun keepText(k: KeptAnnotations, from: String, name: String, text: AnnotText): KeptAnnotations =
        k.copy(texts = (k.texts.filter { it.text.id != text.id } + KeptAnnotations.KeptText(from, name, text)).takeLast(MAX_KEPT_TEXTS))

    fun dropText(k: KeptAnnotations, id: String): KeptAnnotations = k.copy(texts = k.texts.filter { it.text.id != id })

    /** `welcome.annots` off the wire (each stroke / text sanitized; null when absent). */
    fun parseKept(raw: JsonElement?): KeptAnnotations? {
        val o = raw as? JsonObject ?: return null
        fun str(e: JsonElement?) = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
        val strokes = (o["strokes"] as? JsonArray).orEmpty().mapNotNull { el ->
            val s = el as? JsonObject ?: return@mapNotNull null
            val from = str(s["from"]) ?: return@mapNotNull null
            val stroke = sanitizeStroke(s["stroke"]) ?: return@mapNotNull null
            KeptAnnotations.KeptStroke(str(s["key"]) ?: "$from:${stroke.id}", from, str(s["name"]).orEmpty(), stroke)
        }
        val texts = (o["texts"] as? JsonArray).orEmpty().mapNotNull { el ->
            val t = el as? JsonObject ?: return@mapNotNull null
            val text = sanitizeText(t["text"]) ?: return@mapNotNull null
            KeptAnnotations.KeptText(str(t["from"]).orEmpty(), str(t["name"]).orEmpty(), text)
        }
        return KeptAnnotations(strokes, texts)
    }

    /** Port of simplifyPoints. */
    fun simplifyPoints(points: List<Pair<Double, Double>>, minStep: Double = 0.002): List<Pair<Double, Double>> {
        val out = ArrayList<Pair<Double, Double>>()
        for ((i, p) in points.withIndex()) {
            val last = out.lastOrNull()
            if (last == null || i == points.size - 1 || Math.hypot(p.first - last.first, p.second - last.second) >= minStep) out.add(p)
        }
        return out.take(MAX_ANNOT_POINTS)
    }
}
