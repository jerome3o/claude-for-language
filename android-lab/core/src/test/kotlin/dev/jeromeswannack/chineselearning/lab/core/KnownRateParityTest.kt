package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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

/** KnownRate.kt vs shared/progress/known-rate.ts (the `cases` of parity/fixtures/known.ts). */
class KnownRateParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.longOrNull: Long? get() = if (this is JsonNull) null else jsonPrimitive.long
    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int
    private val data = fixture("known.json")

    private fun counts(o: JsonElement) = o.jsonObject.let { KnownCounts(it["known"]!!.jsonPrimitive.int, it["learning"]!!.jsonPrimitive.int) }

    private fun pace(o: JsonElement) = o.jsonObject.let {
        SeriesPace(it["per_week"]!!.jsonPrimitive.int, it["previous_per_week"]!!.intOrNull, it["trend"]!!.str)
    }

    private fun rate(o: JsonObject) = KnownRate(
        weeks = o["weeks"]!!.jsonArray.map {
            val w = it.jsonObject
            WeekGain(
                w["start_ms"]!!.jsonPrimitive.long, w["end_ms"]!!.jsonPrimitive.long, w["partial"]!!.jsonPrimitive.content == "true",
                w["characters"]!!.jsonPrimitive.int, w["words"]!!.jsonPrimitive.int,
            )
        },
        pace = o["pace"]!!.let { p -> if (p is JsonNull) null else KnownPace(pace(p.jsonObject["characters"]!!), pace(p.jsonObject["words"]!!)) },
    )

    private fun progress(r: JsonObject) = KnownProgress(
        characters = counts(r["characters"]!!),
        words = counts(r["words"]!!),
        sentences = counts(r["sentences"]!!),
        recentCharacters = r["recent_characters"]!!.jsonArray.map {
            val o = it.jsonObject
            RecentCharacter(o["char"]!!.str!!, o["known_at"]!!.str!!)
        },
        history = r["history"]!!.jsonArray.map {
            val o = it.jsonObject
            KnownPoint(o["at_ms"]!!.jsonPrimitive.long, counts(o["characters"]!!), counts(o["words"]!!))
        },
    )

    @Test fun rates() {
        val cases = data["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.count { c -> c["with_rate"]!!.jsonObject["rate"]!!.jsonObject["weeks"]!!.jsonArray.any { w -> w.jsonObject["words"]!!.jsonPrimitive.int < 0 || w.jsonObject["characters"]!!.jsonPrimitive.int < 0 } } > 0, "a negative week is covered")
        cases.forEachIndexed { i, c ->
            val notes = c["notes"]!!.jsonArray.map { val o = it.jsonObject; KnownNote(o["id"]!!.str!!, o["hanzi"]!!.str!!) }
            val cards = c["cards"]!!.jsonArray.map { val o = it.jsonObject; KnownCard(o["id"]!!.str!!, o["note_id"]!!.str!!) }
            val events = c["events"]!!.jsonArray.map {
                val o = it.jsonObject
                KnownEvent(o["id"]?.str, o["card_id"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["reviewed_at"]!!.str!!)
            }
            val now = c["now_ms"]!!.jsonPrimitive.long
            val tz = c["tz_offset_minutes"]!!.jsonPrimitive.int
            val maxWeeks = c["max_weeks"]!!.jsonPrimitive.int

            val points = KnownRates.ratePoints(events, now, tz, maxWeeks)
            assertEquals(c["rate_points"]!!.jsonArray.map { it.jsonPrimitive.long }, points, "case $i rate points")
            val history = Known.progress(notes, cards, events, points).history
            assertEquals(rate(c["rate"]!!.jsonObject), KnownRates.rate(history, c["first_ms"]!!.longOrNull, now, tz, maxWeeks), "case $i rate")

            val w = c["with_rate"]!!.jsonObject
            val actual = KnownRates.progressWithRate(notes, cards, events, now, tz)
            assertEquals(progress(w), actual.progress, "case $i progress")
            assertEquals(rate(w["rate"]!!.jsonObject), actual.rate, "case $i with rate")
            assertEquals(c["week_summaries"]!!.jsonArray.map { it.str }, actual.rate.weeks.map { KnownRates.weekSummary(it, tz) }, "case $i summaries")
            val labels = c["pace_labels"]!!
            val p = actual.rate.pace
            if (labels is JsonNull) assertEquals(null, p, "case $i pace")
            else assertEquals(
                labels.jsonArray.map { l -> l.jsonArray.map { it.str } },
                listOf("characters" to p!!.characters, "words" to p.words).map { (noun, s) -> listOf(KnownRates.paceLabel(s.perWeek, noun), KnownRates.paceTrendLabel(s)) },
                "case $i pace labels",
            )
        }
    }

    @Test fun weekStarts() = data["week_starts"]!!.jsonArray.forEach {
        val o = it.jsonObject
        val ms = o["ms"]!!.jsonPrimitive.long
        val tz = o["tz"]!!.jsonPrimitive.int
        assertEquals(o["start"]!!.jsonPrimitive.long, KnownRates.weekStart(ms, tz), "weekStart($ms, $tz)")
    }

    @Test fun signed() = data["signed"]!!.jsonArray.forEach {
        val o = it.jsonObject
        assertEquals(o["s"]!!.str, KnownRates.signedCount(o["n"]!!.jsonPrimitive.int))
    }

    @Test fun mode() {
        assertEquals(KnownChartMode.Rate, KnownChartMode.parse("rate"))
        assertEquals(KnownChartMode.Total, KnownChartMode.parse("total"))
        assertEquals(KnownChartMode.Total, KnownChartMode.parse(null))
        assertEquals(KnownChartMode.Total, KnownChartMode.parse("weekly"))
    }
}
