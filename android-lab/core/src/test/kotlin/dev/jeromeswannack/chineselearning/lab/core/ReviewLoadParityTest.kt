package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
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

/** "Pause new cards on heavy days" reproduces shared/decks/review-load.ts exactly (parity/fixtures/review-load.ts). */
class ReviewLoadParityTest {
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "review-load.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private val JsonElement?.intOrNull: Int? get() = if (this == null || this is JsonNull) null else jsonPrimitive.int
    private val JsonElement?.longOrNull: Long? get() = if (this == null || this is JsonNull) null else jsonPrimitive.long

    @Test
    fun loadToday() {
        val cases = data["loads"]!!.jsonArray
        assertTrue(cases.size >= 60)
        var nonZero = 0
        for (c in cases) {
            val o = c.jsonObject
            val cards = o["cards"]!!.jsonArray.map { e ->
                val x = e.jsonObject
                ReviewLoadCard(x["id"].str!!, x["queue"]!!.jsonPrimitive.int, x["due_ms"].longOrNull)
            }
            val reviewed = o["reviewed"]!!.jsonArray.map { it.str!! }.toSet()
            val first = o["first"]!!.jsonArray.associate { p -> p.jsonArray[0].str!! to p.jsonArray[1].jsonPrimitive.long }
            val want = o["load"]!!.jsonPrimitive.int
            if (want > 0) nonZero++
            assertEquals(want, ReviewLoad.reviewLoadToday(cards, reviewed, first, o["day_start"]!!.jsonPrimitive.long, o["cutoff"]!!.jsonPrimitive.long), "case ${cards.size} cards")
        }
        assertTrue(nonZero > 40)
    }

    /**
     * Evenings that run past midnight (Home at 00:44 with a 4 am rollover): the study day, the
     * reviews and cards since its start and the load, built the way the app builds them
     * (StudyQueue.startOfDay / cutoff, TodaysBudget → ReviewLoad.reviewLoadToday).
     */
    @Test
    fun nightsPastMidnight() {
        val cases = data["nights"]!!.jsonArray
        assertTrue(cases.size >= 300)
        var acrossMidnight = 0
        for (c in cases) {
            val o = c.jsonObject
            val now = o["now"]!!.jsonPrimitive.long
            val zone = java.time.ZoneId.of(o["zone"].str!!)
            val rollover = o["rollover"]!!.jsonPrimitive.int
            val cards = o["cards"]!!.jsonArray.map { e ->
                val x = e.jsonObject
                ReviewLoadCard(x["id"].str!!, x["queue"]!!.jsonPrimitive.int, x["due_ms"].longOrNull)
            }
            val events = o["events"]!!.jsonArray.map { p -> p.jsonArray[0].str!! to p.jsonArray[1].jsonPrimitive.long }
            val first = o["first"]!!.jsonArray.associate { p -> p.jsonArray[0].str!! to p.jsonArray[1].jsonPrimitive.long }
            val dayStart = StudyQueue.startOfDay(now, zone, rollover)
            val cutoff = StudyQueue.cutoff(now, zone, rollover).ts
            assertEquals(o["day_key"].str, StudyDay.key(now, rollover, zone), "$now r$rollover")
            assertEquals(o["day_start"]!!.jsonPrimitive.long, dayStart, "$now r$rollover")
            assertEquals(o["cutoff"]!!.jsonPrimitive.long, cutoff, "$now r$rollover")
            val today = events.filter { (_, t) -> t >= dayStart && t <= now }
            val reviewed = today.map { it.first }.toSet()
            assertEquals(o["reviews_today"]!!.jsonPrimitive.int, today.size, "$now r$rollover")
            assertEquals(o["cards_reviewed_today"]!!.jsonPrimitive.int, reviewed.size, "$now r$rollover")
            val load = ReviewLoad.reviewLoadToday(cards, reviewed, first, dayStart, cutoff)
            assertEquals(o["load"]!!.jsonPrimitive.int, load, "$now r$rollover")
            // Every card reviewed today that was not new today is in the load.
            assertTrue(load >= reviewed.count { (first[it] ?: 0) < dayStart })
            val local = java.time.Instant.ofEpochMilli(now).atZone(zone).toLocalTime()
            if (rollover == 4 && local.hour < 4 && today.any { (_, t) -> java.time.Instant.ofEpochMilli(t).atZone(zone).hour >= 18 }) acrossMidnight++
        }
        // Some cases are the screenshot's: after midnight, before 4 am, with last evening's reviews counted as today's.
        assertTrue(acrossMidnight > 10, "across midnight: $acrossMidnight")
    }

    @Test
    fun stateBudgetAndCopy() {
        for (c in data["states"]!!.jsonArray) {
            val o = c.jsonObject
            val st = o["state"]!!.jsonObject
            val got = ReviewLoad.state(o["load"]!!.jsonPrimitive.int, o["threshold"].intOrNull)
            assertEquals(ReviewLoadState(st["load"]!!.jsonPrimitive.int, st["threshold"].intOrNull, st["paused"]!!.jsonPrimitive.boolean), got, "$o")
            val b = o["budget"]!!.jsonObject
            assertEquals(StudyBudget(b["new_cards_per_day"]!!.jsonPrimitive.int, b["secondary_cards_per_day"]!!.jsonPrimitive.int), ReviewLoad.budgetForToday(StudyBudget(3, 6), got), "$o")
            assertEquals(o["label"].str, ReviewLoad.pausedLabel(got), "$o")
            assertEquals(o["tutor"].str, ReviewLoad.tutorPausedLabel(got), "$o")
            assertEquals(o["up_next"].str, ReviewLoad.upNextPausedLabel(got), "$o")
        }
        for (c in data["summaries"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["summary"].str, ReviewLoad.capSummary(o["threshold"].intOrNull), "$o")
        }
        for (c in data["caps"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["valid"]!!.jsonPrimitive.boolean, ReviewLoad.isValid(o["value"]!!.jsonPrimitive.int), "$o")
        }
        assertTrue(ReviewLoad.isValid(null))
        val k = data["constants"]!!.jsonObject
        assertEquals(k["min"]!!.jsonPrimitive.int, ReviewLoad.CAP_MIN)
        assertEquals(k["max"]!!.jsonPrimitive.int, ReviewLoad.CAP_MAX)
        assertEquals(k["suggested"]!!.jsonPrimitive.int, ReviewLoad.CAP_SUGGESTED)
        assertEquals(k["detail"].str, ReviewLoad.PAUSED_DETAIL)
    }
}
