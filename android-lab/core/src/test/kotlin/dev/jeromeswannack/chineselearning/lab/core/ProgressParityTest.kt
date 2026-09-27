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
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** Progress.kt vs shared/progress (parity/fixtures/progress.ts). Exact equality, doubles included. */
class ProgressParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.longOrNull: Long? get() = if (this is JsonNull) null else jsonPrimitive.long
    private val data = fixture("progress.json")

    private fun events(c: JsonObject) = c["events"]!!.jsonArray.map {
        val o = it.jsonObject
        ProgressEvent(o["card_id"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["reviewed_at"]!!.str!!, o["time_spent_ms"]?.longOrNull, o["user_answer"]?.str)
    }

    private fun cards(c: JsonObject) = c["cards"]!!.jsonArray.map {
        val o = it.jsonObject
        ProgressCardInfo(o["card_id"]!!.str!!, o["card_type"]!!.str!!, o["note_id"]!!.str!!, o["hanzi"]!!.str!!, o["pinyin"]!!.str!!, o["english"]!!.str!!)
    }

    private val cases get() = data["cases"]!!.jsonArray.map { it.jsonObject }

    @Test fun windowStart() = cases.forEach { c ->
        assertEquals(c["window_start"]!!.str, Progress.windowStart(c["now_ms"]!!.jsonPrimitive.long))
    }

    @Test fun dailyProgress() = cases.forEachIndexed { i, c ->
        val expected = c["daily"]!!.jsonObject
        val actual = Progress.dailyProgress(events(c), c["now_ms"]!!.jsonPrimitive.long)
        val s = expected["summary"]!!.jsonObject
        assertEquals(
            ProgressSummary(s["total_reviews_30d"]!!.jsonPrimitive.int, s["total_days_active"]!!.jsonPrimitive.int, s["average_accuracy"]!!.jsonPrimitive.int, s["total_time_ms"]!!.jsonPrimitive.long),
            actual.summary, "case $i summary",
        )
        val days = expected["days"]!!.jsonArray.map {
            val d = it.jsonObject
            ProgressDay(d["date"]!!.str!!, d["reviews_count"]!!.jsonPrimitive.int, d["unique_cards"]!!.jsonPrimitive.int, d["accuracy"]!!.jsonPrimitive.int, d["time_spent_ms"]!!.jsonPrimitive.long)
        }
        assertEquals(days, actual.days, "case $i days")
    }

    @Test fun dayCards() = cases.forEachIndexed { i, c ->
        val evs = events(c)
        val cards = cards(c)
        for (day in c["days"]!!.jsonArray.map { it.jsonObject }) {
            val date = day["date"]!!.str!!
            val actual = Progress.dayCards(evs, cards, date)
            val s = day["summary"]!!.jsonObject
            assertEquals(
                DaySummary(s["total_reviews"]!!.jsonPrimitive.int, s["unique_cards"]!!.jsonPrimitive.int, s["accuracy"]!!.jsonPrimitive.int, s["time_spent_ms"]!!.jsonPrimitive.long),
                actual.summary, "case $i $date summary",
            )
            val expectedCards = day["cards"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expectedCards.map { it["card_id"]!!.str }, actual.cards.map { it.card.cardId }, "case $i $date order")
            expectedCards.zip(actual.cards).forEach { (e, a) ->
                assertEquals(e["ratings"]!!.jsonArray.map { it.jsonPrimitive.int }, a.ratings)
                assertEquals(e["average_rating"]!!.jsonPrimitive.double, a.averageRating)
                assertEquals(e["total_time_ms"]!!.jsonPrimitive.long, a.totalTimeMs)
                assertEquals(e["has_answers"]!!.jsonPrimitive.content.toBoolean(), a.hasAnswers)
                assertEquals(e["card_type"]!!.str, a.card.cardType)
                assertEquals(e["note"]!!.jsonObject["hanzi"]!!.str, a.card.hanzi)
            }
        }
    }

    @Test fun streakInEveryZone() = cases.forEachIndexed { i, c ->
        val evs = events(c)
        val now = c["now_ms"]!!.jsonPrimitive.long
        for (s in c["streaks"]!!.jsonArray.map { it.jsonObject }) {
            val zone = s["zone"]!!.str!!
            val actual = Streak.studyStreak(evs, now, ZoneId.of(zone))
            val today = s["today"]!!.jsonObject
            val where = "case $i $zone"
            assertEquals(s["streak"]!!.jsonPrimitive.int, actual.streak, "$where streak")
            assertEquals(TodayStats(today["reviews"]!!.jsonPrimitive.int, today["accuracy"]!!.jsonPrimitive.int, today["time_ms"]!!.jsonPrimitive.long), actual.today, where)
            assertEquals(s["heatmap"]!!.jsonArray.map { h -> HeatDay(h.jsonObject["date"]!!.str!!, h.jsonObject["count"]!!.jsonPrimitive.int) }, actual.heatmap, "$where heatmap")
            assertEquals(s["max_count"]!!.jsonPrimitive.int, actual.maxCount, where)
        }
    }

    @Test fun mastery() = cases.forEachIndexed { i, c ->
        val cards = c["mastery_cards"]!!.jsonArray.map {
            val o = it.jsonObject
            MasteryCard(o["card_type"]!!.str!!, o["queue"]!!.jsonPrimitive.int, o["stability"]!!.jsonPrimitive.double)
        }
        assertEquals(c["levels"]!!.jsonArray.map { it.str }, cards.map { Mastery.level(it.queue, it.stability).name.lowercase() }, "case $i levels")
        val expected = c["mastery"]!!.jsonObject
        val comp = expected["completion"]!!.jsonObject
        val actual = Mastery.progress(cards)
        assertEquals(
            Completion(comp["total_cards"]!!.jsonPrimitive.int, comp["cards_seen"]!!.jsonPrimitive.int, comp["cards_mastered"]!!.jsonPrimitive.int, comp["percent_seen"]!!.jsonPrimitive.int, comp["percent_mastered"]!!.jsonPrimitive.int),
            actual.completion, "case $i completion",
        )
        fun counts(o: JsonObject) = MasteryCounts(o["total"]!!.jsonPrimitive.int, o["new"]!!.jsonPrimitive.int, o["learning"]!!.jsonPrimitive.int, o["familiar"]!!.jsonPrimitive.int, o["mastered"]!!.jsonPrimitive.int)
        assertEquals(counts(expected["counts"]!!.jsonObject), actual.counts)
        val breakdown = expected["breakdown"]!!.jsonObject
        Mastery.CARD_TYPES.forEach { assertEquals(counts(breakdown[it]!!.jsonObject), actual.breakdown[it], "case $i $it") }
    }

    @Test fun formatting() = data["times"]!!.jsonArray.map { it.jsonObject }.forEach { t ->
        val ms = t["ms"]!!.jsonPrimitive.long
        assertEquals(t["study"]!!.str, Progress.formatStudyTime(ms), "study $ms")
        assertEquals(t["streak"]!!.str, Progress.formatStreakTime(ms), "streak $ms")
    }
}
