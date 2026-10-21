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
