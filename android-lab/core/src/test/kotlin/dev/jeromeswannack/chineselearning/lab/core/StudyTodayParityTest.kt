package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Every ⚡ "Study it today" must bump exactly what the web bumps — an unstarted word's listening card (else
 * its lead card, with the long-term opt-in), a started word's listening card, the whole note without one —
 * with the same labels, hint and toast (parity/fixtures/study-today.ts → study-today.json, from
 * shared/decks/study-today.ts).
 */
class StudyTodayParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "study-today.json").readText()).jsonObject
    }

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.jsonPrimitive.content }
    private fun stringsOrNull(e: JsonElement?): List<String>? = if (e == null || e is JsonNull) null else strings(e)
    private fun intOrNull(e: JsonElement?): Int? = if (e == null || e is JsonNull) null else e.jsonPrimitive.int

    @Test
    fun plansMatchTypeScript() {
        val cases = fixture["plans"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 500)
        val seen = HashSet<String>()
        for ((n, c) in cases.withIndex()) {
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map { StudyToday.NoteCard(it["card_type"]!!.jsonPrimitive.content, it["queue"]!!.jsonPrimitive.int) }
            val known = c["known"]!!.jsonPrimitive.boolean
            val started = c["started"]!!.jsonPrimitive.boolean
            val got = StudyToday.plan(
                cards, started, c["hasAudio"]!!.jsonPrimitive.boolean, intOrNull(c["longTermPref"]), c["deckInReview"]!!.jsonPrimitive.boolean,
                knownCharactersLead = { known },
                newWordsByEar = c["newWordsByEar"]!!.jsonPrimitive.boolean,
            )
            val want = c["plan"]!!.jsonObject
            assertEquals(want["kind"]!!.jsonPrimitive.content, got.kind, "$n kind")
            assertEquals(stringsOrNull(want["cardTypes"]), got.cardTypes, "$n cardTypes")
            val lt = want["longTerm"]!!
            val keep = lt is JsonPrimitive && lt.isString && lt.content == "keep"
            assertEquals(!keep, got.setLongTerm, "$n setLongTerm")
            if (!keep) assertEquals(intOrNull(lt), got.longTerm, "$n longTerm")
            seen += "${if (started) "started" else "new"}:${got.kind}"
            // "Start new words by ear": a word whose clip is still being made (just added) — its listening card.
            if (!started && !c["hasAudio"]!!.jsonPrimitive.boolean && got.kind == StudyToday.LISTENING) seen += "new:listening:no-clip-yet"
        }
        // Every branch: unstarted listening / lead / whole, started listening / whole.
        assertTrue(seen.containsAll(setOf("new:listening", "new:lead", "started:listening", "started:whole", "new:listening:no-clip-yet")), "$seen")
    }

    @Test
    fun copyMatchesTypeScript() {
        for (c in fixture["copy"]!!.jsonArray.map { it.jsonObject }) {
            val kind = c["kind"]!!.jsonPrimitive.content
            assertEquals(c["off"]!!.jsonPrimitive.content, StudyToday.label(kind, false))
            assertEquals(c["on"]!!.jsonPrimitive.content, StudyToday.label(kind, true))
            assertEquals(c["hint"]!!.jsonPrimitive.content, StudyToday.hint(kind, c["started"]!!.jsonPrimitive.boolean))
        }
        for (r in fixture["rows"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(r["kind"]!!.jsonPrimitive.content, StudyToday.kindOfRow(stringsOrNull(r["cardTypes"])))
        }
    }

    @Test
    fun messagesMatchTypeScript() {
        val cases = fixture["messages"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        for ((n, c) in cases.withIndex()) {
            val added = c["added"]!!.jsonArray.map { it.jsonObject }.map { it["hanzi"]!!.jsonPrimitive.content to it["kind"]!!.jsonPrimitive.content }
            assertEquals(c["message"]!!.jsonPrimitive.content, StudyToday.message(added, c["already"]!!.jsonPrimitive.int), "$n")
        }
    }
}
