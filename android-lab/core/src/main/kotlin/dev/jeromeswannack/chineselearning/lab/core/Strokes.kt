package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.sqrt

/*
 * Handwriting / stroke-order practice — port of shared/strokes (types.ts, geometry.ts,
 * match.ts, data.ts, quiz.ts). Everything here is pure; StrokesParityTest feeds the same
 * drawings to both and requires the same verdicts and the same doubles, bit for bit.
 *
 * Character data is Make Me a Hanzi as shipped by hanzi-writer-data (Arphic Public
 * License, docs/STROKE_ORDER.md): per stroke an SVG outline and a median (centre line, in
 * writing order and direction), in a 1024 box with y pointing UP (x 0..1024, y -124..900).
 * The matcher follows hanzi-writer's quiz criteria (MIT), re-implemented to say WHY.
 */

/** A point in character-data space (y up). Port of `Point`. */
data class StrokePoint(val x: Double, val y: Double)

/** One character's stroke data, as served from /strokes/<hex>.json. Port of `CharStrokeData`. */
data class CharStrokeData(
    /** SVG path per stroke (the filled outline), writing order. */
    val strokes: List<String>,
    /** Centre line per stroke, start → end in writing direction. */
    val medians: List<List<StrokePoint>>,
    val radStrokes: List<Int>? = null,
)

/** How the learner is writing: over a grey outline, or from memory on an empty 米字格. */
enum class WritingMode(val wire: String) {
    TRACE("trace"), RECALL("recall");

    companion object { fun of(s: String) = entries.first { it.wire == s } }
}

/** What one drawn stroke was judged to be. Port of `StrokeVerdict`. */
enum class StrokeVerdict(val wire: String) {
    CORRECT("correct"), BACKWARDS("backwards"), WRONG_ORDER("wrong_order"), TOO_SHORT("too_short"), WRONG("wrong"), IGNORED("ignored");

    val isMistake: Boolean get() = this != CORRECT && this != IGNORED

    companion object { fun of(s: String) = entries.first { it.wire == s } }
}

/** Port of `StrokeMatch`. */
data class StrokeMatch(val verdict: StrokeVerdict, val matchedIndex: Int? = null, val avgDist: Double? = null)

/** Per-stroke result — the unit a tutor would review. Port of `StrokeResult`. */
data class StrokeResult(
    val index: Int,
    val misses: Int,
    val mistakes: List<StrokeVerdict>,
    val hinted: Boolean,
    val revealed: Boolean,
    val ms: Long,
    /** The accepted drawing, ≤ 24 rounded points in data space; null when revealed. */
    val drawn: List<IntArray>? = null,
)

enum class WritingGrade(val wire: String) {
    PERFECT("perfect"), GOOD("good"), PRACTICE("practice");

    companion object { fun of(s: String) = entries.first { it.wire == s } }
}

/** Port of `CharacterWritingResult`. */
data class CharacterWritingResult(
    val character: String,
    val mode: WritingMode,
    val strokes: List<StrokeResult>,
    val mistakes: Int,
    val hints: Int,
    val revealed: Int,
    val ms: Long,
    val grade: WritingGrade,
    /** 0..1 — share of strokes written unaided at the first attempt. */
    val accuracy: Double,
)

/** Port of `WritingExerciseResult` — what a lesson exercise or the practice page reports. */
data class WritingExerciseResult(
    val text: String,
    val mode: WritingMode,
    val characters: List<CharacterWritingResult>,
    val skipped: List<String>,
    val startedAt: Long,
    val finishedAt: Long,
    val grade: WritingGrade,
)

// ---------------- geometry.ts ----------------

object StrokeGeometry {
    /**
     * `Math.hypot(x, y)` exactly as V8 computes it (builtins math.tq): normalise by the
     * larger magnitude, Kahan-sum the squares, sqrt, scale back. Java's hypot rounds
     * differently in the last bit, which would make distances drift from the web's.
     */
    fun hypot(x: Double, y: Double): Double {
        if (x.isNaN() || y.isNaN()) {
            return if (x.isInfinite() || y.isInfinite()) Double.POSITIVE_INFINITY else Double.NaN
        }
        val ax = kotlin.math.abs(x)
        val ay = kotlin.math.abs(y)
        var max = 0.0
        if (ax > max) max = ax
        if (ay > max) max = ay
        if (max == Double.POSITIVE_INFINITY) return Double.POSITIVE_INFINITY
        if (max == 0.0) return 0.0
        var sum = 0.0
        var compensation = 0.0
        for (v in doubleArrayOf(ax, ay)) {
            val n = v / max
            val summand = n * n - compensation
            val preliminary = sum + summand
            compensation = (preliminary - sum) - summand
            sum = preliminary
        }
        return sqrt(sum) * max
    }

    fun sub(a: StrokePoint, b: StrokePoint) = StrokePoint(a.x - b.x, a.y - b.y)
    fun mag(p: StrokePoint) = hypot(p.x, p.y)
    fun dist(a: StrokePoint, b: StrokePoint) = hypot(a.x - b.x, a.y - b.y)

    fun pathLength(points: List<StrokePoint>): Double {
        var total = 0.0
        for (i in 1 until points.size) total += dist(points[i - 1], points[i])
        return total
    }

    fun stripDuplicates(points: List<StrokePoint>): List<StrokePoint> {
        val out = ArrayList<StrokePoint>(points.size)
        for (p in points) {
            val last = out.lastOrNull()
            if (last == null || last.x != p.x || last.y != p.y) out += p
        }
        return out
    }

    /** `n` points equally spaced along the polyline (n ≥ 2); zero length → n copies of the first. */
    fun resample(points: List<StrokePoint>, n: Int): List<StrokePoint> {
        if (points.isEmpty()) return emptyList()
        val total = pathLength(points)
        if (points.size == 1 || total == 0.0) return List(n) { points[0] }
        val cum = DoubleArray(points.size)
        for (i in 1 until points.size) cum[i] = cum[i - 1] + dist(points[i - 1], points[i])
        val out = ArrayList<StrokePoint>(n)
        out += points[0]
        var seg = 1
        for (k in 1 until n - 1) {
            val target = (total * k) / (n - 1)
            while (seg < points.size - 1 && cum[seg] < target) seg += 1
            val a = points[seg - 1]
            val b = points[seg]
            val span = cum[seg] - cum[seg - 1]
            val t = if (span == 0.0) 0.0 else (target - cum[seg - 1]) / span
            out += StrokePoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
        }
        out += points[points.size - 1]
        return out
    }

    fun cosineSimilarity(a: StrokePoint, b: StrokePoint): Double {
        val m = mag(a) * mag(b)
        return if (m == 0.0) 0.0 else (a.x * b.x + a.y * b.y) / m
    }

    fun meanNearestDistance(points: List<StrokePoint>, target: List<StrokePoint>): Double {
        if (points.isEmpty() || target.isEmpty()) return Double.POSITIVE_INFINITY
        var total = 0.0
        for (p in points) {
            var best = Double.POSITIVE_INFINITY
            for (t in target) {
                val d = dist(p, t)
                if (d < best) best = d
            }
            total += best
        }
        return total / points.size
    }

    /** Discrete Fréchet distance (Eiter & Mannila). */
    fun frechet(a: List<StrokePoint>, b: List<StrokePoint>): Double {
        if (a.isEmpty() || b.isEmpty()) return Double.POSITIVE_INFINITY
        var prev = DoubleArray(0)
        for (i in a.indices) {
            val cur = DoubleArray(b.size)
            for (j in b.indices) {
                val d = dist(a[i], b[j])
                cur[j] = when {
                    i == 0 && j == 0 -> d
                    i == 0 -> jsMax(cur[j - 1], d)
                    j == 0 -> jsMax(prev[0], d)
                    else -> jsMax(jsMin(jsMin(prev[j], prev[j - 1]), cur[j - 1]), d)
                }
            }
            prev = cur
        }
        return prev[b.size - 1]
    }

    /** Resample, centre on the mean, scale so the endpoints sit at unit RMS distance. */
    fun normalizeShape(points: List<StrokePoint>, n: Int = 24): List<StrokePoint> {
        val r = resample(points, n)
        var sx = 0.0
        var sy = 0.0
        for (p in r) sx += p.x
        for (p in r) sy += p.y
        val mx = sx / r.size
        val my = sy / r.size
        val c = r.map { StrokePoint(it.x - mx, it.y - my) }
        val first = c[0]
        val last = c[c.size - 1]
        val s = sqrt((first.x * first.x + first.y * first.y + last.x * last.x + last.y * last.y) / 2)
        val scale = if (s == 0.0 || s.isNaN()) 1.0 else s
        return c.map { StrokePoint(it.x / scale, it.y / scale) }
    }

    fun rotate(points: List<StrokePoint>, theta: Double): List<StrokePoint> {
        val cos = StrictMath.cos(theta)
        val sin = StrictMath.sin(theta)
        return points.map { StrokePoint(cos * it.x - sin * it.y, sin * it.x + cos * it.y) }
    }

    private val ROTATIONS = doubleArrayOf(Math.PI / 16, Math.PI / 32, 0.0, -Math.PI / 32, -Math.PI / 16)

    /** Smallest Fréchet distance between the normalised shapes over a few small rotations. */
    fun shapeDistance(a: List<StrokePoint>, b: List<StrokePoint>): Double {
        val na = normalizeShape(a)
        val nb = normalizeShape(b)
        var best = Double.POSITIVE_INFINITY
        for (theta in ROTATIONS) best = jsMin(best, frechet(na, rotate(nb, theta)))
        return best
    }

    /** Average best cosine between the drawing's segments and the median's; > 0 = same way round. */
    fun directionSimilarity(points: List<StrokePoint>, median: List<StrokePoint>): Double {
        val drawn = resample(points, 16)
        val segs = (1 until drawn.size).map { sub(drawn[it], drawn[it - 1]) }
        val ref = (1 until median.size).map { sub(median[it], median[it - 1]) }
        if (segs.isEmpty() || ref.isEmpty()) return 0.0
        var total = 0.0
        for (s in segs) {
            var best = -1.0
            for (r in ref) best = jsMax(best, cosineSimilarity(s, r))
            total += best
        }
        return total / segs.size
    }

    /** Downsample + round a drawing for storage (≤ [maxPoints] points). */
    fun compactStroke(points: List<StrokePoint>, maxPoints: Int = 24): List<IntArray> {
        val clean = stripDuplicates(points)
        val n = maxOf(2, minOf(maxPoints, clean.size))
        return resample(clean, n).map { intArrayOf(Js.round(it.x).toInt(), Js.round(it.y).toInt()) }
    }

    /** JS Math.max / Math.min: NaN wins. */
    private fun jsMax(a: Double, b: Double) = if (a.isNaN() || b.isNaN()) Double.NaN else if (a >= b) a else b
    private fun jsMin(a: Double, b: Double) = if (a.isNaN() || b.isNaN()) Double.NaN else if (a <= b) a else b
}

// ---------------- match.ts ----------------

/** Port of `MatchOptions`: leniency > 1 is more forgiving; outline on screen = trace mode. */
data class MatchOptions(val leniency: Double = 1.0, val outlineVisible: Boolean = false)

/** Port of `StrokeFit`. */
data class StrokeFit(
    val isMatch: Boolean,
    val avgDist: Double,
    val startDist: Double,
    val endDist: Double,
    val direction: Double,
    val lengthRatio: Double,
)

object StrokeMatcher {
    /** Drawings shorter than this (data units) are taps, not strokes. */
    const val MIN_STROKE_LENGTH = 24.0

    private const val AVG_DIST_THRESHOLD = 175.0
    private const val AVG_DIST_THRESHOLD_FIRST_RECALL = 300.0
    private const val START_END_THRESHOLD = 250.0
    private const val SHAPE_THRESHOLD = 0.4
    private const val MIN_LENGTH_RATIO = 0.35
    private const val SAMPLES = 24
    private const val CLEARLY_BETTER = 0.4
    private const val CLEARLY_BETTER_MIN = 60.0

    /** Port of `fitStroke`: how well `points` (already cleaned) fit one median. */
    fun fitStroke(points: List<StrokePoint>, median: List<StrokePoint>, leniency: Double, avgThreshold: Double): StrokeFit {
        val g = StrokeGeometry
        val drawn = g.resample(points, SAMPLES)
        val ref = g.resample(median, SAMPLES)
        val avgDist = g.meanNearestDistance(drawn, ref)
        val startDist = g.dist(points[0], median[0])
        val endDist = g.dist(points[points.size - 1], median[median.size - 1])
        val lengthRatio = (g.pathLength(points) + 25) / (g.pathLength(median) + 25)
        val l = leniency
        if (avgDist > avgThreshold * l) return StrokeFit(false, avgDist, startDist, endDist, 0.0, lengthRatio)
        val direction = g.directionSimilarity(points, median)
        val isMatch = startDist <= START_END_THRESHOLD * l &&
            endDist <= START_END_THRESHOLD * l &&
            direction > 0 &&
            lengthRatio * l >= MIN_LENGTH_RATIO &&
            g.shapeDistance(points, median) <= SHAPE_THRESHOLD * l
        return StrokeFit(isMatch, avgDist, startDist, endDist, direction, lengthRatio)
    }

    /** Port of `matchStroke`: classify a drawing made while stroke [expected] is next. */
    fun matchStroke(rawPoints: List<StrokePoint>, data: CharStrokeData, expected: Int, options: MatchOptions = MatchOptions()): StrokeMatch {
        val g = StrokeGeometry
        val points = g.stripDuplicates(rawPoints)
        if (points.size < 2 || g.pathLength(points) < MIN_STROKE_LENGTH) return StrokeMatch(StrokeVerdict.IGNORED)
        if (expected < 0 || expected >= data.medians.size) return StrokeMatch(StrokeVerdict.IGNORED)

        val leniency = options.leniency
        val firstInRecall = expected == 0 && !options.outlineVisible
        val fitThreshold = if (firstInRecall) AVG_DIST_THRESHOLD_FIRST_RECALL else AVG_DIST_THRESHOLD
        val medians = data.medians

        val exp = fitStroke(points, medians[expected], leniency, fitThreshold)

        var laterIndex = -1
        var laterFit: StrokeFit? = null
        for (j in expected + 1 until medians.size) {
            val fit = fitStroke(points, medians[j], leniency, AVG_DIST_THRESHOLD)
            if (fit.isMatch && (laterFit == null || fit.avgDist < laterFit.avgDist)) {
                laterIndex = j
                laterFit = fit
            }
        }

        if (exp.isMatch) {
            if (laterFit != null && exp.avgDist > CLEARLY_BETTER_MIN && laterFit.avgDist < exp.avgDist * CLEARLY_BETTER) {
                return StrokeMatch(StrokeVerdict.WRONG_ORDER, laterIndex, exp.avgDist)
            }
            if (exp.avgDist > CLEARLY_BETTER_MIN) {
                for (j in 0 until expected) {
                    val fit = fitStroke(points, medians[j], leniency, AVG_DIST_THRESHOLD)
                    if (fit.isMatch && fit.avgDist < exp.avgDist * CLEARLY_BETTER) return StrokeMatch(StrokeVerdict.WRONG, null, exp.avgDist)
                }
            }
            return StrokeMatch(StrokeVerdict.CORRECT, null, exp.avgDist)
        }

        val back = fitStroke(points.reversed(), medians[expected], leniency, fitThreshold)
        if (back.isMatch && !(laterFit != null && laterFit.avgDist < back.avgDist * 0.5)) {
            return StrokeMatch(StrokeVerdict.BACKWARDS, null, exp.avgDist)
        }

        if (laterFit != null) return StrokeMatch(StrokeVerdict.WRONG_ORDER, laterIndex, exp.avgDist)

        val medLen = g.pathLength(medians[expected])
        if (exp.avgDist <= fitThreshold * leniency &&
            exp.startDist <= START_END_THRESHOLD * leniency &&
            exp.direction > 0 &&
            g.pathLength(points) < medLen * 0.75
        ) {
            return StrokeMatch(StrokeVerdict.TOO_SHORT, null, exp.avgDist)
        }
        return StrokeMatch(StrokeVerdict.WRONG, null, exp.avgDist)
    }
}

// ---------------- data.ts ----------------

/** A stroke's start point and unit direction (the "start here →" hint). */
data class StrokeStart(val start: StrokePoint, val dir: StrokePoint)

/** A brush path along a median (as points) with its length. */
data class BrushPath(val points: List<StrokePoint>, val length: Double) {
    /** The same path as the web's SVG `d` string (for tests). */
    fun d(): String = StrokeData.medianPath(points)
}

object StrokeData {
    /** Port of `strokeDataFile`: `/strokes/<code point in hex>.json`. */
    fun file(char: String): String {
        require(char.isNotEmpty()) { "empty character" }
        return "${Integer.toHexString(char.codePointAt(0))}.json"
    }

    /**
     * Port of `parseCharStrokeData`: validate untrusted JSON (a kotlinx JsonElement) as
     * stroke data; null when it isn't (e.g. an SPA fallback page).
     */
    fun parse(json: kotlinx.serialization.json.JsonElement?): CharStrokeData? {
        val o = json as? kotlinx.serialization.json.JsonObject ?: return null
        val strokes = o["strokes"] as? kotlinx.serialization.json.JsonArray ?: return null
        val medians = o["medians"] as? kotlinx.serialization.json.JsonArray ?: return null
        if (strokes.isEmpty() || strokes.size != medians.size) return null
        val strokeList = strokes.map { (it as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { p -> p.isString }?.content ?: return null }
        val medianList = medians.map { m ->
            val arr = m as? kotlinx.serialization.json.JsonArray ?: return null
            if (arr.isEmpty()) return null
            arr.map { p ->
                val pair = p as? kotlinx.serialization.json.JsonArray ?: return null
                if (pair.size != 2) return null
                val x = number(pair[0]) ?: return null
                val y = number(pair[1]) ?: return null
                StrokePoint(x, y)
            }
        }
        val rad = (o["radStrokes"] as? kotlinx.serialization.json.JsonArray)?.mapNotNull { number(it)?.toInt() }
        return CharStrokeData(strokeList, medianList, rad)
    }

    private fun number(e: kotlinx.serialization.json.JsonElement): Double? {
        val p = e as? kotlinx.serialization.json.JsonPrimitive ?: return null
        if (p.isString) return null
        return p.content.toDoubleOrNull()
    }

    /** Port of `medianPath` (SVG `d` along a median). */
    fun medianPath(median: List<StrokePoint>): String {
        if (median.isEmpty()) return ""
        val pts = if (median.size == 1) listOf(median[0], median[0]) else median
        return pts.mapIndexed { i, p -> "${if (i == 0) "M" else "L"} ${Js.numberToString(p.x)} ${Js.numberToString(p.y)}" }.joinToString(" ")
    }

    fun medianLength(median: List<StrokePoint>): Double = StrokeGeometry.pathLength(median)

    /**
     * Port of `brushPath`: the median with its start pulled back by [extend] units, so the
     * round cap of the painting brush starts outside the outline.
     */
    fun brushPath(median: List<StrokePoint>, extend: Double = 90.0): BrushPath {
        if (median.isEmpty()) return BrushPath(emptyList(), 0.0)
        val pts = if (median.size == 1) listOf(median[0], median[0]) else median
        val (x0, y0) = pts[0]
        val (x1, y1) = pts[1]
        val m = StrokeGeometry.hypot(x1 - x0, y1 - y0)
        val start = if (m == 0.0) StrokePoint(x0, y0) else StrokePoint(x0 - ((x1 - x0) / m) * extend, y0 - ((y1 - y0) / m) * extend)
        val full = listOf(start) + pts
        return BrushPath(full, medianLength(full))
    }

    /** Port of `strokeStart`. */
    fun strokeStart(median: List<StrokePoint>): StrokeStart {
        val start = median[0]
        val target = median.firstOrNull { StrokeGeometry.hypot(it.x - start.x, it.y - start.y) > 60 } ?: median[median.size - 1]
        val dx = target.x - start.x
        val dy = target.y - start.y
        val h = StrokeGeometry.hypot(dx, dy)
        val m = if (h == 0.0 || h.isNaN()) 1.0 else h
        return StrokeStart(start, StrokePoint(dx / m, dy / m))
    }
}

// ---------------- quiz.ts ----------------

/** Port of `QuizOptions` (defaults: start hint after 2 misses, stroke hint after 3, reveal after 5). */
data class QuizOptions(
    val mode: WritingMode,
    val leniency: Double = 1.0,
    val startHintAfter: Int = 2,
    val strokeHintAfter: Int = 3,
    val revealAfter: Int = 5,
)

/** How much help to show for the current stroke. */
enum class HintLevel(val wire: String) { NONE("none"), START("start"), STROKE("stroke") }

data class PendingStroke(val misses: Int, val mistakes: List<StrokeVerdict>, val hinted: Boolean, val startedAt: Long)

/** Port of `CharacterQuizState` — immutable; every call returns a new state. */
data class CharacterQuizState(
    val character: String,
    val data: CharStrokeData,
    val options: QuizOptions,
    /** Index of the next stroke to write; == strokeCount when finished. */
    val current: Int,
    val done: List<StrokeResult>,
    val pending: PendingStroke,
    val startedAt: Long,
    val finishedAt: Long?,
) {
    val strokeCount: Int get() = data.strokes.size
    val isComplete: Boolean get() = current >= strokeCount
}

/** Port of `QuizFeedback`. */
sealed interface QuizFeedback {
    data object Ignored : QuizFeedback
    data class Correct(val index: Int, val complete: Boolean) : QuizFeedback
    data class Mistake(val verdict: StrokeVerdict, val index: Int, val matchedIndex: Int?, val misses: Int, val hint: HintLevel) : QuizFeedback
    data class Revealed(val index: Int, val complete: Boolean) : QuizFeedback
}

object StrokeQuiz {
    fun create(character: String, data: CharStrokeData, options: QuizOptions, now: Long) = CharacterQuizState(
        character = character,
        data = data,
        options = options,
        current = 0,
        done = emptyList(),
        pending = PendingStroke(0, emptyList(), false, now),
        startedAt = now,
        finishedAt = null,
    )

    /** Port of `hintLevel`. */
    fun hintLevel(state: CharacterQuizState): HintLevel {
        val p = state.pending
        if (p.hinted || p.misses >= state.options.strokeHintAfter) return HintLevel.STROKE
        if (p.misses >= state.options.startHintAfter) return HintLevel.START
        return HintLevel.NONE
    }

    private fun finishStroke(state: CharacterQuizState, now: Long, revealed: Boolean, drawn: List<IntArray>? = null, hinted: Boolean = false): CharacterQuizState {
        val result = StrokeResult(
            index = state.current,
            misses = state.pending.misses,
            mistakes = state.pending.mistakes,
            hinted = state.pending.hinted || hinted || revealed,
            revealed = revealed,
            ms = maxOf(0L, now - state.pending.startedAt),
            drawn = drawn,
        )
        val current = state.current + 1
        return state.copy(
            current = current,
            done = state.done + result,
            pending = PendingStroke(0, emptyList(), false, now),
            finishedAt = if (current >= state.strokeCount) now else null,
        )
    }

    /** Port of `submitStroke`: grade one drawn stroke. */
    fun submit(state: CharacterQuizState, points: List<StrokePoint>, now: Long): Pair<CharacterQuizState, QuizFeedback> {
        if (state.isComplete) return state to QuizFeedback.Ignored
        val match = StrokeMatcher.matchStroke(points, state.data, state.current, MatchOptions(state.options.leniency, state.options.mode == WritingMode.TRACE))
        if (match.verdict == StrokeVerdict.IGNORED) return state to QuizFeedback.Ignored

        if (match.verdict == StrokeVerdict.CORRECT) {
            val index = state.current
            val next = finishStroke(state, now, revealed = false, drawn = StrokeGeometry.compactStroke(points), hinted = hintLevel(state) == HintLevel.STROKE)
            return next to QuizFeedback.Correct(index, next.isComplete)
        }

        val pending = state.pending.copy(misses = state.pending.misses + 1, mistakes = state.pending.mistakes + match.verdict)
        val missed = state.copy(pending = pending)
        if (pending.misses >= state.options.revealAfter) {
            val index = state.current
            val next = finishStroke(missed, now, revealed = true)
            return next to QuizFeedback.Revealed(index, next.isComplete)
        }
        val hint = hintLevel(missed)
        val withHint = if (hint == HintLevel.STROKE) missed.copy(pending = pending.copy(hinted = true)) else missed
        return withHint to QuizFeedback.Mistake(match.verdict, state.current, match.matchedIndex, pending.misses, hint)
    }

    /** Port of `requestHint`: show the current stroke (counts as hinted). */
    fun requestHint(state: CharacterQuizState): CharacterQuizState =
        if (state.isComplete) state else state.copy(pending = state.pending.copy(hinted = true))

    /** Port of `revealStroke`: fill the current stroke in and move on (counts as revealed). */
    fun revealStroke(state: CharacterQuizState, now: Long): CharacterQuizState =
        if (state.isComplete) state else finishStroke(state, now, revealed = true)

    fun gradeCharacter(strokes: List<StrokeResult>): WritingGrade {
        val n = strokes.size
        val mistakes = strokes.sumOf { it.misses }
        val hints = strokes.count { it.hinted }
        val revealed = strokes.count { it.revealed }
        if (mistakes == 0 && hints == 0) return WritingGrade.PERFECT
        if (revealed == 0 && hints <= 1 && mistakes <= maxOf(1.0, Js.round(n * 0.25))) return WritingGrade.GOOD
        return WritingGrade.PRACTICE
    }

    /** Port of `summarizeCharacter`. */
    fun summarizeCharacter(state: CharacterQuizState, now: Long): CharacterWritingResult {
        val strokes = state.done
        val n = state.strokeCount
        val clean = strokes.count { it.misses == 0 && !it.hinted }
        return CharacterWritingResult(
            character = state.character,
            mode = state.options.mode,
            strokes = strokes,
            mistakes = strokes.sumOf { it.misses },
            hints = strokes.count { it.hinted },
            revealed = strokes.count { it.revealed },
            ms = maxOf(0L, (state.finishedAt ?: now) - state.startedAt),
            grade = if (strokes.size < n) WritingGrade.PRACTICE else gradeCharacter(strokes),
            accuracy = if (n == 0) 1.0 else clean.toDouble() / n,
        )
    }

    fun gradeExercise(characters: List<CharacterWritingResult>): WritingGrade = when {
        characters.isEmpty() -> WritingGrade.GOOD
        characters.any { it.grade == WritingGrade.PRACTICE } -> WritingGrade.PRACTICE
        characters.all { it.grade == WritingGrade.PERFECT } -> WritingGrade.PERFECT
        else -> WritingGrade.GOOD
    }

    fun summarizeExercise(text: String, mode: WritingMode, characters: List<CharacterWritingResult>, skipped: List<String>, startedAt: Long, finishedAt: Long) =
        WritingExerciseResult(text, mode, characters, skipped, startedAt, finishedAt, gradeExercise(characters))

    /**
     * Port of `writtenFromMemory`: a handwriting exercise counts as correct only when the
     * word was written FROM MEMORY with nothing revealed and at most light help (grade
     * perfect / good). A traced run — incl. switching to "Trace it" — is not correct.
     */
    fun writtenFromMemory(mode: WritingMode, grade: WritingGrade): Boolean = mode == WritingMode.RECALL && grade != WritingGrade.PRACTICE
    fun writtenFromMemory(result: WritingExerciseResult): Boolean = writtenFromMemory(result.mode, result.grade)

    /** Port of `writableCharacters`: the Han ideographs of [text], in order (duplicates kept). */
    fun writableCharacters(text: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            if (Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN) out += String(Character.toChars(cp))
            i += Character.charCount(cp)
        }
        return out
    }

    /** Port of `mistakeMessage` (stroke numbers 1-based for people). */
    fun mistakeMessage(fb: QuizFeedback.Mistake): String {
        val n = fb.index + 1
        return when (fb.verdict) {
            StrokeVerdict.BACKWARDS -> "Right stroke, other direction — start from the dot."
            StrokeVerdict.WRONG_ORDER ->
                if (fb.matchedIndex != null) "That's stroke ${fb.matchedIndex + 1} — stroke $n comes first." else "That stroke comes later — stroke $n first."
            StrokeVerdict.TOO_SHORT -> "Keep going — draw stroke $n all the way to its end."
            else -> if (fb.hint == HintLevel.NONE) "Not quite — try stroke $n again." else "Follow the hint for stroke $n."
        }
    }
}
