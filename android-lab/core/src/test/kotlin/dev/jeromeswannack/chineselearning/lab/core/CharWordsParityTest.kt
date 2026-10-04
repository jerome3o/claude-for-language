package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
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
 * The character sheet's "Words with 字" list must mark, order and summarise exactly like the
 * web (parity/fixtures/char-words.ts → char-words.json, from shared/chars/status.ts).
 */
class CharWordsParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "char-words.json").readText()).jsonObject
    }

    @Test
    fun rowsAndSummaryMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size > 300, "expected the seeded cases")
        val seen = HashSet<String>()
        for ((i, c) in cases.withIndex()) {
            val words = c["words"]!!.jsonArray.map { it.jsonObject["hanzi"]!!.jsonPrimitive.content }
            val notes = c["notes"]!!.jsonArray.map { it.jsonObject }.map { CharStatusNote(it["id"]!!.jsonPrimitive.content, it["hanzi"]!!.jsonPrimitive.content) }
            val cards = c["cards"]!!.jsonArray.map { it.jsonObject }.map {
                CharStatusCard(it["note_id"]!!.jsonPrimitive.content, it["queue"]!!.jsonPrimitive.int, it["stability"]!!.jsonPrimitive.double)
            }
            val cardHanzi = c["card_hanzi"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            val rows = CharWords.rows(words, notes, cards, cardHanzi) { it }
            val expected = c["rows"]!!.jsonArray.map { it.jsonObject }
            assertEquals(expected.size, rows.size, "row count, case $i")
            for ((e, r) in expected.zip(rows)) {
                assertEquals(e["hanzi"]!!.jsonPrimitive.content, r.word, "hanzi, case $i")
                assertEquals(e["status"]!!.jsonPrimitive.content, r.status.wire, "status of ${r.word}, case $i")
                assertEquals(e["note_ids"]!!.jsonArray.map { it.jsonPrimitive.content }, r.noteIds, "note ids of ${r.word}, case $i")
                assertEquals(e["current"]!!.jsonPrimitive.boolean, r.current, "current of ${r.word}, case $i")
                seen += r.status.wire
            }
            assertEquals(c["summary"]!!.jsonPrimitive.content, CharWords.summary(rows.map { it.status }), "summary, case $i")
        }
        assertEquals(setOf("known", "in_decks", "none"), seen, "the vectors cover every status")
    }

    @Test
    fun wordInCardMatchesTypeScript() {
        for (e in fixture["in_card"]!!.jsonArray.map { it.jsonObject }) {
            val card = e["card"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(e["result"]!!.jsonPrimitive.boolean, CharWords.wordInCard(e["word"]!!.jsonPrimitive.content, card), "wordInCard(${e["word"]}, $card)")
        }
    }

    @Test
    fun labelsMatchTypeScript() {
        val labels = fixture["labels"]!!.jsonObject
        for (s in CharWordStatus.entries) assertEquals(labels[s.wire]!!.jsonPrimitive.content, CharWords.label(s))
    }
}
