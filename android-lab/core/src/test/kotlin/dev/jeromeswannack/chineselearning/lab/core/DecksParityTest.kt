package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Package C: the deck queue moves, the drag hit-test, the card search and the deck
 * settings validation must match shared/decks exactly (parity/fixtures/decks.ts).
 */
class DecksParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "decks.json").readText()).jsonObject
    }

    private fun JsonElement.strings() = jsonArray.map { it.jsonPrimitive.content }
    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun queueMovesMatch() {
        val cases = fixture["moves"]!!.jsonArray
        for (c in cases.map { it.jsonObject }) {
            val ids = c["ids"]!!.strings()
            val id = c["id"]!!.str!!
            val want = c["out"]!!.strings()
            val got = c["to"]?.let { DeckQueue.moveInOrder(ids, id, DeckQueue.move(it.str!!)!!) }
                ?: DeckQueue.moveToIndex(ids, id, c["index"]!!.jsonPrimitive.int)
            assertEquals(want, got, "move $id in $ids ${c["to"] ?: c["index"]}")
            if (want == ids) assertSame(ids, got, "unchanged order returns the same list")
        }
        assertTrue(cases.size > 250)
    }

    @Test
    fun pointerHitTestMatches() {
        for (c in fixture["pointer"]!!.jsonArray.map { it.jsonObject }) {
            val rects = c["rects"]!!.jsonArray.map { r ->
                val o = r.jsonObject
                DeckQueue.Rect(o["left"]!!.jsonPrimitive.double, o["top"]!!.jsonPrimitive.double, o["width"]!!.jsonPrimitive.double, o["height"]!!.jsonPrimitive.double)
            }
            val x = c["x"]!!.jsonPrimitive.double
            val y = c["y"]!!.jsonPrimitive.double
            assertEquals(c["out"]!!.jsonPrimitive.int, DeckQueue.indexUnderPointer(rects, x, y), "($x, $y) over $rects")
        }
    }

    @Test
    fun searchMatches() {
        val search = fixture["search"]!!.jsonObject
        val notes = search["notes"]!!.jsonArray.map { it.jsonObject }
        for (c in search["cases"]!!.jsonArray.map { it.jsonObject }) {
            val raw = c["raw"]!!.str!!
            val q = NoteSearch.prepare(raw)
            assertEquals(c["q"]!!.str, q, "prepare '$raw'")
            val stripped = NoteSearch.stripTones(q)
            assertEquals(c["stripped"]!!.str, stripped, "stripTones '$q'")
            c["matches"]!!.jsonArray.forEachIndexed { i, m ->
                val n = notes[i]
                fun f(k: String) = n[k]?.str
                assertEquals(m.jsonPrimitive.boolean, NoteSearch.matches(f("hanzi"), f("pinyin"), f("english"), f("sentence_clue"), q, stripped), "'$raw' vs note $i ${f("hanzi")}")
            }
        }
        for (c in search["strip"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["out"]!!.str, NoteSearch.stripTones(c["s"]!!.str!!), "stripTones ${c["s"]}")
        }
    }

    @Test
    fun deckSettingsValidationMatches() {
        for (c in fixture["settings"]!!.jsonArray.map { it.jsonObject }) {
            val input = c["input"]!!.let { el ->
                if (el is JsonNull) null else el.jsonObject.mapValues { (_, v) -> value(v) }
            }
            val got = DeckSettings.pick(input)
            val want = c["out"]!!.jsonObject
            val wantSettings = want["settings"]!!.jsonObject
            assertEquals(wantSettings.keys, got.settings.keys, "keys for $input")
            for ((k, v) in wantSettings) {
                val p = v.jsonPrimitive
                if (p.isString) assertEquals(p.content, got.settings[k], "$k for $input")
                else assertEquals(p.double, got.settings[k] as Double, "$k for $input")
            }
            val wantProblems = want["problems"]!!.jsonArray.map { it.jsonObject["field"]!!.str!! to it.jsonObject["message"]!!.str!! }
            assertEquals(wantProblems, got.problems.map { it.field to it.message }, "problems for $input")
        }
    }

    @Test
    fun cardStandardHardRulesMatch() {
        fun probs(el: JsonElement) = el.jsonArray.map { it.jsonObject["field"]!!.str!! to it.jsonObject["message"]!!.str!! }
        fun mine(l: List<CardStandard.Problem>) = l.map { it.field to it.message }
        for (c in fixture["standard"]!!.jsonArray.map { it.jsonObject }) {
            val t = c["text"]!!.str!!
            assertEquals(probs(c["hanzi"]!!), mine(CardStandard.problems(hanzi = t)), "hanzi '$t'")
            assertEquals(probs(c["pinyin"]!!), mine(CardStandard.problems(pinyin = t)), "pinyin '$t'")
            assertEquals(probs(c["clue"]!!), mine(CardStandard.problems(sentenceClue = t)), "clue '$t'")
        }
    }

    private fun value(v: JsonElement): Any? = when {
        v is JsonNull -> null
        v is JsonArray || v is JsonObject -> v.toString()
        (v as JsonPrimitive).isString -> v.content
        v.booleanOrNull != null -> v.boolean
        else -> v.doubleOrNull
    }
}
