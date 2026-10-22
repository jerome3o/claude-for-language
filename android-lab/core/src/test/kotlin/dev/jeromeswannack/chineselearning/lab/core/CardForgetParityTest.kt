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
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * "Forget this card" + leeches (shared/scheduler forget events, shared/cards/leech.ts):
 * replay with forgets, timelines, leech info, which reviews still count, the merge order,
 * known counts with forgets, and the words — parity/fixtures/card-forget.ts. Exact equality.
 */
class CardForgetParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "card-forget.json").readText()).jsonObject
    }
    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun review(o: JsonObject) = ReviewEventInput(o["id"]!!.str!!, o["card_id"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["reviewed_at"]!!.str!!)
    private fun forget(o: JsonObject) = CardForget(o["id"]!!.str!!, o["card_id"]!!.str!!, o["forgotten_at"]!!.str!!)

    private fun assertState(expected: JsonObject, actual: ComputedCardState, where: String) {
        assertEquals(expected["queue"]!!.jsonPrimitive.int, actual.queue, "$where queue")
        assertEquals(expected["stability"]!!.jsonPrimitive.double, actual.stability, "$where stability")
        assertEquals(expected["difficulty"]!!.jsonPrimitive.double, actual.difficulty, "$where difficulty")
        assertEquals(expected["scheduled_days"]!!.jsonPrimitive.long, actual.scheduledDays, "$where scheduled_days")
        assertEquals(expected["reps"]!!.jsonPrimitive.int, actual.reps, "$where reps")
        assertEquals(expected["lapses"]!!.jsonPrimitive.int, actual.lapses, "$where lapses")
        assertEquals(expected["next_review_at"]!!.str, actual.nextReviewAt, "$where next_review_at")
        assertEquals(expected["due_timestamp"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.long }, actual.dueTimestamp, "$where due_timestamp")
        assertEquals(expected["last_reviewed_at"]!!.str, actual.lastReviewedAt, "$where last_reviewed_at")
        assertEquals(expected["ease_factor"]!!.jsonPrimitive.double, actual.easeFactor, "$where ease_factor")
        assertEquals(expected["interval"]!!.jsonPrimitive.long, actual.interval, "$where interval")
        assertEquals(expected["repetitions"]!!.jsonPrimitive.int, actual.repetitions, "$where repetitions")
    }

    @Test
    fun replayWithForgetsMatchesTypeScript() {
        val sequences = data["sequences"]!!.jsonArray.map { it.jsonObject }
        assertTrue(sequences.size >= 100)
        var forgetsSeen = 0
        var leeches = 0
        for (seq in sequences) {
            val id = seq["card_id"]!!.str!!
            val reviews = seq["reviews"]!!.jsonArray.map { review(it.jsonObject) }
            val forgets = seq["forgets"]!!.jsonArray.map { forget(it.jsonObject) }
            forgetsSeen += forgets.size
            val merged = Forgets.merge(reviews, forgets)
            assertEquals(seq["merged"]!!.jsonArray.map { it.str }, merged.map { it.id }, "$id merged")
            val timeline = CardScheduler.computeCardTimeline(merged)
            val expectedTl = seq["timeline"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expectedTl.size, timeline.size, "$id timeline size")
            expectedTl.forEachIndexed { i, p ->
                assertEquals(p["reviewed_at"]!!.str, timeline[i].reviewedAt, "$id tl $i at")
                assertEquals(p["queue"]!!.jsonPrimitive.int, timeline[i].queue, "$id tl $i queue")
                assertEquals(p["stability"]!!.jsonPrimitive.double, timeline[i].stability, "$id tl $i stability")
            }
            // Step by step: the history as it grew (each step = the first N reviews + the first M forgets).
            val steps = seq["steps"]!!.jsonArray.map { it.jsonObject }
            for ((i, step) in steps.withIndex()) {
                val r = reviews.take(step["reviews"]!!.jsonPrimitive.int)
                val f = forgets.take(step["forgets"]!!.jsonPrimitive.int)
                val stepAt = step["counting"]!!.jsonArray
                val wantLast = step["last_forget_at"]!!.str
                val m = Forgets.merge(r, f)
                assertState(step["state"]!!.jsonObject, CardScheduler.computeCardState(m), "$id step $i")
                val last = Forgets.lastAt(f)
                assertEquals(wantLast, last, "$id step $i last forget")
                assertEquals(stepAt.map { it.str }, Forgets.since(r, last) { it.reviewedAt }.map { it.id }, "$id step $i counting")
                val li = Leech.info(m)
                val el = step["leech"]!!.jsonObject
                assertEquals(el["lapses"]!!.jsonPrimitive.int, li.lapses, "$id step $i lapses")
                assertEquals(el["is_leech"]!!.jsonPrimitive.boolean, li.isLeech, "$id step $i is_leech")
                assertEquals(el["lapse_dates"]!!.jsonArray.map { it.str }, li.lapseDates, "$id step $i lapse dates")
                assertEquals(el["reviews"]!!.jsonPrimitive.int, li.reviews, "$id step $i reviews")
                assertEquals(el["forgotten_at"]!!.str, li.forgottenAt, "$id step $i forgotten_at")
                assertEquals(
                    el["recent"]!!.jsonArray.map { val o = it.jsonObject; Leech.Recent(o["reviewed_at"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["lapse"]!!.jsonPrimitive.boolean) },
                    li.recent, "$id step $i recent",
                )
                if (li.isLeech) leeches++
            }
        }
        assertTrue(forgetsSeen > 50, "fixture has forgets")
        assertTrue(leeches > 0, "fixture has leeches")
    }

    @Test
    fun mergeOrder() {
        val m = data["merge"]!!.jsonObject
        val merged = Forgets.merge(m["reviews"]!!.jsonArray.map { review(it.jsonObject) }, m["forgets"]!!.jsonArray.map { forget(it.jsonObject) })
        assertEquals(m["expected"]!!.jsonArray.map { it.str }, merged.map { it.id })
    }

    @Test
    fun knownWithForgets() {
        fun counts(o: JsonElement) = o.jsonObject.let { KnownCounts(it["known"]!!.jsonPrimitive.int, it["learning"]!!.jsonPrimitive.int) }
        data["known"]!!.jsonArray.forEachIndexed { i, el ->
            val c = el.jsonObject
            val notes = c["notes"]!!.jsonArray.map { val o = it.jsonObject; KnownNote(o["id"]!!.str!!, o["hanzi"]!!.str!!) }
            val cards = c["cards"]!!.jsonArray.map { val o = it.jsonObject; KnownCard(o["id"]!!.str!!, o["note_id"]!!.str!!) }
            val events = c["events"]!!.jsonArray.map {
                val o = it.jsonObject
                KnownEvent(o["id"]?.str, o["card_id"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["reviewed_at"]!!.str!!, o["kind"]?.str == "forget")
            }
            val points = c["points"]!!.jsonArray.map { it.jsonPrimitive.long }
            val r = c["expected"]!!.jsonObject
            val actual = Known.progress(notes, cards, events, points)
            assertEquals(counts(r["characters"]!!), actual.characters, "known $i characters")
            assertEquals(counts(r["words"]!!), actual.words, "known $i words")
            assertEquals(counts(r["sentences"]!!), actual.sentences, "known $i sentences")
            assertEquals(r["recent_characters"]!!.jsonArray.map { val o = it.jsonObject; RecentCharacter(o["char"]!!.str!!, o["known_at"]!!.str!!) }, actual.recentCharacters, "known $i recent")
            assertEquals(
                r["history"]!!.jsonArray.map { val o = it.jsonObject; KnownPoint(o["at_ms"]!!.jsonPrimitive.long, counts(o["characters"]!!), counts(o["words"]!!)) },
                actual.history, "known $i history",
            )
        }
    }

    @Test
    fun words() {
        val c = data["copy"]!!.jsonObject
        c["pills"]!!.jsonArray.forEach {
            val o = it.jsonObject
            val p = o["pill"]!!
            val want = if (p is JsonNull) null else Leech.Pill(p.jsonObject["icon"]!!.str!!, p.jsonObject["text"]!!.str!!)
            assertEquals(want, Leech.pill(o["lapses"]!!.jsonPrimitive.int))
        }
        c["headlines"]!!.jsonArray.forEach { val o = it.jsonObject; assertEquals(o["text"]!!.str, Leech.headline(o["lapses"]!!.jsonPrimitive.int)) }
        assertEquals(c["explanation"]!!.str, Leech.EXPLANATION)
        assertEquals(c["hook"]!!.str, Leech.memoryHookQuestion("银行", "bank", 9))
        assertEquals(c["ratings"]!!.jsonArray.map { it.str }, listOf(0, 1, 2, 3, 7).map(Leech::ratingTag))
        c["warnings"]!!.jsonArray.forEach { val o = it.jsonObject; assertEquals(o["text"]!!.str, Leech.forgetWarning(o["count"]!!.jsonPrimitive.int)) }
        c["titles"]!!.jsonArray.forEach { val o = it.jsonObject; assertEquals(o["text"]!!.str, Leech.forgetTitle(o["scope"]!!.str!!, o["count"]!!.jsonPrimitive.int)) }
        c["buttons"]!!.jsonArray.forEach { val o = it.jsonObject; assertEquals(o["text"]!!.str, Leech.forgetButton(o["count"]!!.jsonPrimitive.int)) }
        c["messages"]!!.jsonArray.forEach {
            val o = it.jsonObject
            assertEquals(o["text"]!!.str, Leech.forgetMessage(o["count"]!!.jsonPrimitive.int))
            assertEquals(o["undo"]!!.str, Leech.undoForgetMessage(o["count"]!!.jsonPrimitive.int))
        }
        assertEquals(c["history"]!!.str, Leech.FORGET_HISTORY_LABEL)
    }
}
