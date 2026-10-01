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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Known.kt vs shared/progress/known.ts (parity/fixtures/known.ts). Exact equality, doubles included. */
class KnownParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val data = fixture("known.json")

    private fun counts(o: JsonElement) = o.jsonObject.let { KnownCounts(it["known"]!!.jsonPrimitive.int, it["learning"]!!.jsonPrimitive.int) }

    private fun expected(r: JsonObject) = KnownProgress(
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

    @Test fun progress() {
        val cases = data["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 50)
        cases.forEachIndexed { i, c ->
            val notes = c["notes"]!!.jsonArray.map { val o = it.jsonObject; KnownNote(o["id"]!!.str!!, o["hanzi"]!!.str!!) }
            val cards = c["cards"]!!.jsonArray.map { val o = it.jsonObject; KnownCard(o["id"]!!.str!!, o["note_id"]!!.str!!) }
            val events = c["events"]!!.jsonArray.map {
                val o = it.jsonObject
                KnownEvent(o["id"]?.str, o["card_id"]!!.str!!, o["rating"]!!.jsonPrimitive.int, o["reviewed_at"]!!.str!!)
            }
            val now = c["now_ms"]!!.jsonPrimitive.long
            val points = Known.historyPoints(events, now, c["max_points"]!!.jsonPrimitive.int)
            assertEquals(c["points"]!!.jsonArray.map { it.jsonPrimitive.long }, points, "case $i points")
            val actual = Known.progress(notes, cards, events, points, c["recent_limit"]!!.jsonPrimitive.int)
            assertEquals(expected(c["result"]!!.jsonObject), actual, "case $i")
        }
    }

    @Test fun timelines() = data["timelines"]!!.jsonArray.forEachIndexed { i, t ->
        val o = t.jsonObject
        val events = o["events"]!!.jsonArray.map {
            val e = it.jsonObject
            ReviewEventInput(e["id"]!!.str!!, e["card_id"]!!.str!!, e["rating"]!!.jsonPrimitive.int, e["reviewed_at"]!!.str!!)
        }
        val expected = o["timeline"]!!.jsonArray.map {
            val p = it.jsonObject
            CardScheduler.TimelinePoint(p["reviewed_at"]!!.str!!, p["queue"]!!.jsonPrimitive.int, p["stability"]!!.jsonPrimitive.double)
        }
        assertEquals(expected, CardScheduler.computeCardTimeline(events), "timeline $i")
    }

    @Test fun classification() = data["texts"]!!.jsonArray.forEach {
        val o = it.jsonObject
        val text = o["text"]!!.str!!
        assertEquals(o["chars"]!!.jsonArray.map { c -> c.str!! }, Known.hanCharacters(text), "chars of '$text'")
        assertEquals(o["kind"]!!.str, Known.noteKind(text).name.lowercase(), "kind of '$text'")
        assertEquals(o["key"]!!.str, Known.noteKey(text), "key of '$text'")
    }

    @Test fun countsFromTiers() = data["tiers"]!!.jsonArray.forEachIndexed { i, t ->
        val o = t.jsonObject
        val notes = o["notes"]!!.jsonArray.map { val n = it.jsonObject; n["hanzi"]!!.str!! to n["tier"]!!.jsonPrimitive.int }
        val r = o["result"]!!.jsonObject
        assertEquals(KnownHeadline(counts(r["characters"]!!), counts(r["words"]!!), counts(r["sentences"]!!)), Known.countsFromTiers(notes), "tiers $i")
    }
}
