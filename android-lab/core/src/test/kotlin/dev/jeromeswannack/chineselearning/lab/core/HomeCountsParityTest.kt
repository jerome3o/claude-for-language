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

/**
 * Home's numbers right after a study session must follow the web exactly
 * (parity/fixtures/home-counts.ts → home-counts.json, from shared/study/homeCounts.ts).
 */
class HomeCountsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "home-counts.json").readText()).jsonObject
    }

    private fun counts(e: JsonElement?): QueueCounts? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return QueueCounts(o["new"]!!.jsonPrimitive.int, o["secondaryNew"]!!.jsonPrimitive.int, o["learning"]!!.jsonPrimitive.int, o["review"]!!.jsonPrimitive.int)
    }

    private fun countsMap(e: JsonElement?): Map<String, QueueCounts> =
        e!!.jsonObject.mapValues { counts(it.value)!! }

    private fun session(e: JsonElement?): SessionCounts? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return SessionCounts(
            day = o["day"]!!.jsonPrimitive.content,
            at = o["at"]!!.jsonPrimitive.long,
            deckId = o["deckId"]?.let { if (it is JsonNull) null else it.jsonPrimitive.content },
            remaining = counts(o["remaining"])!!,
            byDeck = countsMap(o["byDeck"]),
            bumpedNotes = o["bumpedNotes"]!!.jsonPrimitive.int,
        )
    }

    @Test
    fun whichNumbersHomePaints() {
        val cases = fixture["newer"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 200)
        for ((n, c) in cases.withIndex()) {
            val computed = c["computed"]!!.let { if (it is JsonNull) null else ComputedStamp(it.jsonObject["at"]!!.jsonPrimitive.long, it.jsonObject["day"]!!.jsonPrimitive.content) }
            val got = HomeCounts.sessionNewer(session(c["session"]), computed, c["today"]!!.jsonPrimitive.content)
            assertEquals(c["newer"]!!.jsonPrimitive.boolean, got, "case $n")
        }
    }

    @Test
    fun rowsTotalAndBumpedAfterASession() {
        val cases = fixture["after"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 300)
        for ((n, c) in cases.withIndex()) {
            val s = session(c["session"])!!
            val rows = countsMap(c["rows"])
            for ((deck, want) in countsMap(c["decks"])) {
                assertEquals(want, HomeCounts.deckAfterSession(rows[deck], s, deck), "case $n deck $deck")
            }
            assertEquals(counts(c["total_after"]), HomeCounts.totalAfterSession(counts(c["total"]), rows, s), "case $n total")
            assertEquals(c["bumped_after"]!!.jsonPrimitive.int, HomeCounts.bumpedAfterSession(c["bumped"]!!.jsonPrimitive.int, s), "case $n bumped")
        }
    }

    @Test
    fun sessionCardsByDeck() {
        for ((n, c) in fixture["cards"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            val list = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                Triple(it["deck_id"]!!.jsonPrimitive.content, it["note_id"]!!.jsonPrimitive.content, it["queue"]!!.jsonPrimitive.int)
            }
            val reviewed = c["reviewed"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()
            val (total, byDeck) = HomeCounts.countSessionCards(list, reviewed)
            assertEquals(counts(c["total"]), total, "case $n total")
            assertEquals(countsMap(c["byDeck"]), byDeck, "case $n byDeck")
        }
    }
}
