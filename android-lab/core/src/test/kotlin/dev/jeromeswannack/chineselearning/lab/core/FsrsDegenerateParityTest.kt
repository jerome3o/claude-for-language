package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * FSRS on unusable stored card states — a reviewed card with stability 0 / negative / NaN / ±∞, a
 * difficulty outside 1–10, an unknown queue, a missing or garbage date — reproduces the web's
 * guarded `computedStateToFsrsCard` exactly (parity/fixtures/fsrs-degenerate.ts). Before the guard
 * such a row threw inside CardScheduler.intervalPreviews and the study screen never showed the card.
 */
class FsrsDegenerateParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "fsrs-degenerate.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    /** A number the fixture wrote as a string when it isn't finite. */
    private val JsonElement.num: Double
        get() = if (jsonPrimitive.isString) {
            when (val s = jsonPrimitive.content) {
                "NaN" -> Double.NaN
                "Infinity" -> Double.POSITIVE_INFINITY
                "-Infinity" -> Double.NEGATIVE_INFINITY
                else -> fail("unexpected number $s")
            }
        } else {
            jsonPrimitive.double
        }

    private fun stateOf(o: JsonObject) = ComputedCardState(
        queue = o["queue"]!!.jsonPrimitive.int,
        stability = o["stability"]!!.num,
        difficulty = o["difficulty"]!!.num,
        scheduledDays = 3,
        reps = 4,
        lapses = 1,
        nextReviewAt = o["next_review_at"]!!.str,
        dueTimestamp = null,
        lastReviewedAt = o["last_reviewed_at"]!!.str,
        easeFactor = 2.5,
        interval = 3,
        repetitions = 4,
        learningStep = 0,
    )

    @Test
    fun unusableStatesScheduleLikeTypeScript() {
        val now = fixture["now"]!!.jsonPrimitive.long
        val nowIso = Js.toIsoString(now)
        val cases = fixture["cases"]!!.jsonArray
        assertTrue(cases.size > 1000)
        for ((i, el) in cases.withIndex()) {
            val c = el.jsonObject
            val state = stateOf(c["state"]!!.jsonObject)
            val where = "case $i $state"
            val previews = CardScheduler.intervalPreviews(state, now)
            c["previews"]!!.jsonArray.forEachIndexed { r, pEl ->
                val p = pEl.jsonObject
                assertEquals(p["intervalText"]!!.str, previews[r].intervalText, "$where preview $r text")
                assertEquals(p["intervalDays"]!!.num, previews[r].intervalDays, "$where preview $r days")
                assertEquals(p["nextState"]!!.jsonPrimitive.int, previews[r].nextState, "$where preview $r state")
            }
            c["applied"]!!.jsonArray.forEachIndexed { r, aEl ->
                val e = aEl.jsonObject
                val a = CardScheduler.applyReview(state, r, nowIso)
                assertEquals(e["queue"]!!.jsonPrimitive.int, a.queue, "$where apply $r queue")
                assertEquals(e["stability"]!!.num, a.stability, "$where apply $r stability")
                assertEquals(e["difficulty"]!!.num, a.difficulty, "$where apply $r difficulty")
                assertEquals(e["scheduled_days"]!!.jsonPrimitive.long, a.scheduledDays, "$where apply $r scheduled_days")
                assertEquals(e["reps"]!!.jsonPrimitive.int, a.reps, "$where apply $r reps")
                assertEquals(e["lapses"]!!.jsonPrimitive.int, a.lapses, "$where apply $r lapses")
                assertEquals(e["next_review_at"]!!.str, a.nextReviewAt, "$where apply $r next_review_at")
                assertEquals(e["last_reviewed_at"]!!.str, a.lastReviewedAt, "$where apply $r last_reviewed_at")
                assertEquals(e["ease_factor"]!!.num, a.easeFactor, "$where apply $r ease_factor")
                assertTrue(a.stability.isFinite() && a.difficulty.isFinite(), "$where apply $r finite")
            }
            assertEquals(c["retrievability"]!!.num, CardScheduler.retrievability(state, now), "$where retrievability")
        }
        println("FSRS degenerate parity: ${cases.size} unusable states")
    }

    /** The Lab's freeze, reproduced: a REVIEW card with stability 0 must give its previews, quickly. */
    @Test
    fun reviewCardWithZeroStabilityGivesPreviewsPromptly() {
        val state = ComputedCardState(
            queue = CardQueue.REVIEW, stability = 0.0, difficulty = 5.0, scheduledDays = 3, reps = 4, lapses = 0,
            nextReviewAt = "2026-10-10T10:00:00.000Z", dueTimestamp = null, lastReviewedAt = "2026-10-11T09:00:00.000Z",
            easeFactor = 2.5, interval = 3, repetitions = 4, learningStep = 0,
        )
        val now = Js.parseDate("2026-10-11T10:00:00.000Z")
        val pool = Executors.newSingleThreadExecutor()
        try {
            val previews = pool.submit<List<IntervalPreview>> { CardScheduler.intervalPreviews(state, now) }.get(5, TimeUnit.SECONDS)
            assertEquals(listOf("10m", "1d", "2d", "3d"), previews.map { it.intervalText })
            assertTrue(previews.all { it.intervalDays.isFinite() && it.intervalDays > 0 })
        } finally {
            pool.shutdownNow()
        }
    }
}
