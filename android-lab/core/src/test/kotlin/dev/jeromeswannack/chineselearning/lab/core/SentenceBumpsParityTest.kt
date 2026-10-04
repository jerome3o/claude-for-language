package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
 * The Coach's "⚡ Study … today" chip must offer exactly what the web offers: the note the
 * sentence is, else the same words in the same order (parity/fixtures/sentence-bumps.ts →
 * sentence-bumps.json, from shared/decks/sentence-bumps.ts).
 */
class SentenceBumpsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "sentence-bumps.json").readText()).jsonObject
    }

    private data class Note(val id: String, val hanzi: String)

    @Test
    fun matchesTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 300, "expected the seeded cases")
        var exacts = 0
        var picks = 0
        for (c in cases) {
            val text = c["text"]!!.jsonPrimitive.content
            val notes = c["notes"]!!.jsonArray.map { it.jsonObject }.map { Note(it["id"]!!.jsonPrimitive.content, it["hanzi"]!!.jsonPrimitive.content) }
            val max = c["max"]?.jsonPrimitive?.int ?: SentenceBumps.MAX_WORDS
            val r = SentenceBumps.match(text, notes, max) { it.hanzi }
            val exact = c["exact"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val words = c["words"]!!.jsonArray.map { it.jsonPrimitive.content }
            assertEquals(exact, r.exact?.id, "exact for '$text'")
            assertEquals(words, r.words.map { it.id }, "words for '$text'")
            if (exact != null) exacts++
            if (words.isNotEmpty()) picks++
        }
        assertTrue(exacts > 3 && picks > 50, "the vectors cover both chips ($exacts exact, $picks pickers)")
    }

    @Test
    fun labelsMatchTypeScript() {
        for (l in fixture["labels"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(l["label"]!!.jsonPrimitive.content, SentenceBumps.addToTodayLabel(l["n"]!!.jsonPrimitive.int))
        }
    }
}
