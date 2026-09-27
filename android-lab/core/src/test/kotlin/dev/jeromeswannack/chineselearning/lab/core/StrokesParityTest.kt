package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The stroke matcher and quiz must judge a drawing exactly as the web app does:
 * parity/fixtures/strokes.ts runs shared/strokes on real characters with synthetic
 * handwriting (right, sloppy, small, reversed, short, later, earlier, scribbles, taps)
 * and whole quiz runs; this replays every one and compares verdicts, messages,
 * summaries AND the doubles (avgDist, geometry) for exact equality.
 */
class StrokesParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "strokes.json").readText()).jsonObject
    }
    private val chars: Map<String, CharStrokeData> by lazy {
        root["chars"]!!.jsonObject.mapValues { (c, v) -> StrokeData.parse(v) ?: fail("chars[$c] failed to parse") }
    }

    private fun points(e: JsonElement): List<StrokePoint> =
        e.jsonArray.map { StrokePoint(it.jsonArray[0].jsonPrimitive.double, it.jsonArray[1].jsonPrimitive.double) }

    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int
    private val JsonElement.doubleOrNull: Double? get() = if (this is JsonNull) null else jsonPrimitive.double

    @Test
    fun hypotMatchesV8() {
        for (h in root["hypots"]!!.jsonArray) {
            val (x, y, want) = h.jsonArray.map { it.jsonPrimitive.double }
            assertEquals(want, StrokeGeometry.hypot(x, y), "hypot($x, $y)")
        }
    }

    @Test
    fun geometryMatches() {
        val g = StrokeGeometry
        root["geometry"]!!.jsonArray.forEachIndexed { i, el ->
            val o = el.jsonObject
            val a = points(o["a"]!!)
            val b = points(o["b"]!!)
            val n = o["n"]!!.jsonPrimitive.int
            assertEquals(o["pathLength"]!!.jsonPrimitive.double, g.pathLength(a), "$i pathLength")
            assertEquals(points(o["resample"]!!), g.resample(a, n), "$i resample")
            assertEquals(points(o["normalize"]!!), g.normalizeShape(a), "$i normalize")
            assertEquals(o["frechet"]!!.jsonPrimitive.double, g.frechet(a, b), "$i frechet")
            assertEquals(o["meanNearest"]!!.jsonPrimitive.double, g.meanNearestDistance(a, b), "$i meanNearest")
            assertEquals(o["shape"]!!.jsonPrimitive.double, g.shapeDistance(a, b), "$i shape")
            assertEquals(o["direction"]!!.jsonPrimitive.double, g.directionSimilarity(a, b), "$i direction")
            assertEquals(ints(o["compact"]!!), g.compactStroke(a).map { it.toList() }, "$i compact")
            assertEquals(ints(o["compact5"]!!), g.compactStroke(a, 5).map { it.toList() }, "$i compact5")
        }
    }

    private fun ints(e: JsonElement) = e.jsonArray.map { p -> p.jsonArray.map { it.jsonPrimitive.int } }

    @Test
    fun matchStrokeMatches() {
        val matches = root["matches"]!!.jsonArray
        var checked = 0
        val byVerdict = HashMap<String, Int>()
        for ((i, el) in matches.withIndex()) {
            val o = el.jsonObject
            val c = o["char"]!!.jsonPrimitive.content
            val opts = o["options"]!!.jsonObject
            val options = MatchOptions(
                leniency = opts["leniency"]?.jsonPrimitive?.double ?: 1.0,
                outlineVisible = opts["outlineVisible"]?.jsonPrimitive?.boolean ?: false,
            )
            val m = StrokeMatcher.matchStroke(points(o["points"]!!), chars[c]!!, o["expected"]!!.jsonPrimitive.int, options)
            val where = "match $i ($c #${o["expected"]} ${o["kind"]})"
            assertEquals(o["verdict"]!!.jsonPrimitive.content, m.verdict.wire, "$where verdict")
            assertEquals(o["matchedIndex"]!!.intOrNull, m.matchedIndex, "$where matchedIndex")
            assertEquals(o["avgDist"]!!.doubleOrNull, m.avgDist, "$where avgDist")
            byVerdict.merge(m.verdict.wire, 1, Int::plus)
            checked++
        }
        assertTrue(checked > 3000, "only $checked cases")
        // Every verdict must be exercised, or the fixtures stopped covering the matcher.
        for (v in StrokeVerdict.entries) assertTrue((byVerdict[v.wire] ?: 0) > 0, "no ${v.wire} case: $byVerdict")
    }

    @Test
    fun quizRunsMatch() {
        val runs = root["runs"]!!.jsonArray
        val summaries = ArrayList<CharacterWritingResult>()
        for ((r, el) in runs.withIndex()) {
            val run = el.jsonObject
            val c = run["char"]!!.jsonPrimitive.content
            val opts = run["options"]!!.jsonObject
            val options = QuizOptions(
                mode = WritingMode.of(opts["mode"]!!.jsonPrimitive.content),
                leniency = opts["leniency"]?.jsonPrimitive?.double ?: 1.0,
                startHintAfter = opts["startHintAfter"]?.jsonPrimitive?.int ?: 2,
                strokeHintAfter = opts["strokeHintAfter"]?.jsonPrimitive?.int ?: 3,
                revealAfter = opts["revealAfter"]?.jsonPrimitive?.int ?: 5,
            )
            var state = StrokeQuiz.create(c, chars[c]!!, options, run["startedAt"]!!.jsonPrimitive.long)
            for ((a, actEl) in run["actions"]!!.jsonArray.withIndex()) {
                val act = actEl.jsonObject
                val now = act["now"]!!.jsonPrimitive.long
                val where = "run $r ($c) action $a"
                when (act["t"]!!.jsonPrimitive.content) {
                    "hint" -> {
                        state = StrokeQuiz.requestHint(state)
                        assertEquals(act["hint"]!!.jsonPrimitive.content, StrokeQuiz.hintLevel(state).wire, "$where hint")
                    }
                    "reveal" -> {
                        state = StrokeQuiz.revealStroke(state, now)
                        assertEquals(act["finishedAt"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }, state.finishedAt, "$where finishedAt")
                    }
                    "draw" -> {
                        val (next, fb) = StrokeQuiz.submit(state, points(act["points"]!!), now)
                        state = next
                        assertFeedback(act["feedback"]!!.jsonObject, fb, where)
                        assertEquals(act["hint"]!!.jsonPrimitive.content, StrokeQuiz.hintLevel(state).wire, "$where hint")
                        assertEquals(act["misses"]!!.jsonPrimitive.int, state.pending.misses, "$where misses")
                    }
                }
                assertEquals(act["current"]!!.jsonPrimitive.int, state.current, "$where current")
            }
            val summary = StrokeQuiz.summarizeCharacter(state, run["endNow"]!!.jsonPrimitive.long)
            assertSummary(run["summary"]!!.jsonObject, summary, "run $r ($c)")
            summaries += summary
        }

        for ((e, el) in root["exercises"]!!.jsonArray.withIndex()) {
            val o = el.jsonObject
            val picked = o["characters"]!!.jsonArray.map { summaries[it.jsonPrimitive.int] }
            val ex = StrokeQuiz.summarizeExercise(
                o["text"]!!.jsonPrimitive.content,
                WritingMode.of(o["mode"]!!.jsonPrimitive.content),
                picked,
                o["skipped"]!!.jsonArray.map { it.jsonPrimitive.content },
                1_790_000_000_000,
                1_790_000_060_000,
            )
            assertEquals(o["grade"]!!.jsonPrimitive.content, ex.grade.wire, "exercise $e grade")
            assertEquals(o["writtenFromMemory"]!!.jsonPrimitive.boolean, StrokeQuiz.writtenFromMemory(ex), "exercise $e writtenFromMemory")
        }
    }

    private fun assertFeedback(want: JsonObject, got: QuizFeedback, where: String) {
        val kind = want["kind"]!!.jsonPrimitive.content
        when (got) {
            QuizFeedback.Ignored -> assertEquals(kind, "ignored", where)
            is QuizFeedback.Correct -> {
                assertEquals(kind, "correct", where)
                assertEquals(want["index"]!!.jsonPrimitive.int, got.index, "$where index")
                assertEquals(want["complete"]!!.jsonPrimitive.boolean, got.complete, "$where complete")
            }
            is QuizFeedback.Revealed -> {
                assertEquals(kind, "revealed", where)
                assertEquals(want["index"]!!.jsonPrimitive.int, got.index, "$where index")
                assertEquals(want["complete"]!!.jsonPrimitive.boolean, got.complete, "$where complete")
            }
            is QuizFeedback.Mistake -> {
                assertEquals(kind, "mistake", where)
                assertEquals(want["verdict"]!!.jsonPrimitive.content, got.verdict.wire, "$where verdict")
                assertEquals(want["index"]!!.jsonPrimitive.int, got.index, "$where index")
                assertEquals(want["matchedIndex"]!!.intOrNull, got.matchedIndex, "$where matchedIndex")
                assertEquals(want["misses"]!!.jsonPrimitive.int, got.misses, "$where misses")
                assertEquals(want["hint"]!!.jsonPrimitive.content, got.hint.wire, "$where hint")
                assertEquals(want["message"]!!.jsonPrimitive.content, StrokeQuiz.mistakeMessage(got), "$where message")
            }
        }
    }

    private fun assertSummary(want: JsonObject, got: CharacterWritingResult, where: String) {
        assertEquals(want["character"]!!.jsonPrimitive.content, got.character, "$where character")
        assertEquals(want["mode"]!!.jsonPrimitive.content, got.mode.wire, "$where mode")
        assertEquals(want["mistakes"]!!.jsonPrimitive.int, got.mistakes, "$where mistakes")
        assertEquals(want["hints"]!!.jsonPrimitive.int, got.hints, "$where hints")
        assertEquals(want["revealed"]!!.jsonPrimitive.int, got.revealed, "$where revealed")
        assertEquals(want["ms"]!!.jsonPrimitive.long, got.ms, "$where ms")
        assertEquals(want["grade"]!!.jsonPrimitive.content, got.grade.wire, "$where grade")
        assertEquals(want["accuracy"]!!.jsonPrimitive.double, got.accuracy, "$where accuracy")
        val strokes = want["strokes"]!!.jsonArray
        assertEquals(strokes.size, got.strokes.size, "$where stroke count")
        strokes.forEachIndexed { i, sEl ->
            val s = sEl.jsonObject
            val g = got.strokes[i]
            val w = "$where stroke $i"
            assertEquals(s["index"]!!.jsonPrimitive.int, g.index, "$w index")
            assertEquals(s["misses"]!!.jsonPrimitive.int, g.misses, "$w misses")
            assertEquals(s["mistakes"]!!.jsonArray.map { it.jsonPrimitive.content }, g.mistakes.map { it.wire }, "$w mistakes")
            assertEquals(s["hinted"]!!.jsonPrimitive.boolean, g.hinted, "$w hinted")
            assertEquals(s["revealed"]!!.jsonPrimitive.boolean, g.revealed, "$w revealed")
            assertEquals(s["ms"]!!.jsonPrimitive.long, g.ms, "$w ms")
            val drawn = s["drawn"]
            if (drawn == null) assertNull(g.drawn, "$w drawn") else assertEquals(ints(drawn), assertNotNull(g.drawn).map { it.toList() }, "$w drawn")
        }
    }

    @Test
    fun dataHelpersMatch() {
        for (el in root["dataHelpers"]!!.jsonArray) {
            val o = el.jsonObject
            val c = o["char"]!!.jsonPrimitive.content
            val d = chars[c]!!
            assertEquals(o["file"]!!.jsonPrimitive.content, StrokeData.file(c), "$c file")
            o["starts"]!!.jsonArray.forEachIndexed { i, s ->
                val (sx, sy, dx, dy) = s.jsonArray.map { it.jsonPrimitive.double }
                val got = StrokeData.strokeStart(d.medians[i])
                assertEquals(listOf(sx, sy, dx, dy), listOf(got.start.x, got.start.y, got.dir.x, got.dir.y), "$c start $i")
            }
            o["brush"]!!.jsonArray.forEachIndexed { i, b ->
                val got = StrokeData.brushPath(d.medians[i])
                assertEquals(b.jsonArray[0].jsonPrimitive.content, got.d(), "$c brush $i d")
                assertEquals(b.jsonArray[1].jsonPrimitive.double, got.length, "$c brush $i length")
            }
            assertEquals(o["medianPath"]!!.jsonPrimitive.content, StrokeData.medianPath(d.medians[0]), "$c medianPath")
            assertEquals(o["medianLength"]!!.jsonPrimitive.double, StrokeData.medianLength(d.medians[0]), "$c medianLength")
        }
        for (el in root["parse"]!!.jsonArray) {
            val o = el.jsonObject
            val got = StrokeData.parse(o["json"])
            assertEquals(o["ok"]!!.jsonPrimitive.boolean, got != null, "parse ${o["json"]}")
            val rad = o["radStrokes"]!!
            if (got != null) assertEquals(if (rad is JsonNull) null else rad.jsonArray.map { it.jsonPrimitive.int }, got.radStrokes, "radStrokes ${o["json"]}")
        }
        for (el in root["writable"]!!.jsonArray) {
            val o = el.jsonObject
            val text = o["text"]!!.jsonPrimitive.content
            assertEquals(o["chars"]!!.jsonArray.map { it.jsonPrimitive.content }, StrokeQuiz.writableCharacters(text), "writable '$text'")
        }
    }

    @Test
    fun writtenFromMemoryRule() {
        // Jerome's rule (docs/STROKE_ORDER.md): only recall with grade perfect/good counts.
        assertTrue(StrokeQuiz.writtenFromMemory(WritingMode.RECALL, WritingGrade.PERFECT))
        assertTrue(StrokeQuiz.writtenFromMemory(WritingMode.RECALL, WritingGrade.GOOD))
        assertEquals(false, StrokeQuiz.writtenFromMemory(WritingMode.RECALL, WritingGrade.PRACTICE))
        assertEquals(false, StrokeQuiz.writtenFromMemory(WritingMode.TRACE, WritingGrade.PERFECT))
    }
}

