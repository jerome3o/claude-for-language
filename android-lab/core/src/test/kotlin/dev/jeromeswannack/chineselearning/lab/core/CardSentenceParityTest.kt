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
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** CardSentence.kt reproduces shared/study/cardSentence.ts exactly (parity/fixtures/card-sentence.ts). */
class CardSentenceParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "card-sentence.json").readText()).jsonObject
    }

    private fun str(e: JsonElement?): String? = if (e == null || e is JsonNull) null else e.jsonPrimitive.content

    private fun row(o: JsonObject) = CardSentence.Row(
        id = o["id"]!!.jsonPrimitive.content, noteId = o["note_id"]!!.jsonPrimitive.content, position = o["position"]!!.jsonPrimitive.int,
        hanzi = o["hanzi"]!!.jsonPrimitive.content, pinyin = str(o["pinyin"]), translation = str(o["translation"]),
        audioUrl = str(o["audio_url"]), focus = str(o["focus"]), focusNote = str(o["focus_note"]), explanation = str(o["explanation"]),
        isCard = (o["is_card"]?.let { if (it is JsonNull) 0 else it.jsonPrimitive.int } ?: 0) == 1,
    )

    @Test
    fun withCardSentenceMatchesTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 100)
        var made = 0
        var removed = 0
        for (c in cases) {
            val note = (c["note"] as? JsonObject)?.let {
                CardSentence.NoteFields(it["id"]!!.jsonPrimitive.content, str(it["sentence_clue"]), str(it["sentence_clue_pinyin"]), str(it["sentence_clue_translation"]), str(it["sentence_clue_audio_url"]))
            }
            val rows = c["rows"]!!.jsonArray.map { row(it.jsonObject) }
            val out = CardSentence.withCardSentence(note, rows)
            val expected = c["out"]!!.jsonArray.map { row(it.jsonObject) }
            assertEquals(expected, out, c.toString())
            if (out.firstOrNull()?.let { CardSentence.isCardRow(it) } == true && rows.none { CardSentence.isCardRow(it) }) made++
            if (rows.any { CardSentence.isCardRow(it) } && out.none { CardSentence.isCardRow(it) }) removed++
        }
        assertTrue(made > 10, "a card row made from the note is exercised")
        assertTrue(removed > 5, "a removed card sentence is exercised")
    }

    @Test
    fun idsAndKeysMatch() {
        assertEquals(fixture["id"]!!.jsonPrimitive.content, CardSentence.id("abc"))
        for (k in fixture["keys"]!!.jsonArray.map { it.jsonObject }) {
            val key = k["key"]!!.jsonPrimitive.content
            assertEquals(k["card"]!!.jsonPrimitive.boolean, CardSentence.isCardKey(key), key)
            assertEquals(k["canonical"]!!.jsonPrimitive.content, CardSentence.canonicalKey(key, "n9"), key)
        }
    }
}
