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

/**
 * What the ear can't tell reproduces shared/lesson/heardCheck.ts exactly (parity/fixtures/heard-check.ts) — Jerome's
 * 她责怪我 answered "He blames me.", Nov 2026.
 */
class HeardCheckParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "heard-check.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun strings(e: JsonElement?) = e!!.jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun constantsMatch() {
        assertEquals(data["version"]!!.jsonPrimitive.int, LessonAnswerCheck.VERSION)
        assertEquals(data["meaningVersion"]!!.jsonPrimitive.int, LessonAnswerCheck.MEANING_VERSION)
        assertEquals(strings(data["markers"]), HeardCheck.TENSE_MARKERS)
        assertEquals(strings(data["third"]), HeardCheck.THIRD_PERSON_WORDS)
        val h = data["headlines"]!!.jsonObject
        assertEquals(h["both"].str, HeardCheck.BOTH_HEADLINE)
        assertEquals(h["pronoun"].str, HeardCheck.PRONOUN_HEADLINE)
        assertEquals(h["tense"].str, HeardCheck.TENSE_HEADLINE)
        assertEquals(h["right"].str, HeardCheck.RIGHT_HEADLINE)
        assertEquals(h["ta"].str, HeardCheck.TA_HEADLINE)
    }

    @Test
    fun meaningKeysMatch() {
        val combos = listOf(false to false, true to false, false to true, true to true)
        for (c in data["meaningKeys"]!!.jsonArray.map { it.jsonObject }) {
            val text = c["text"].str!!
            assertEquals(strings(c["words"]), HeardCheck.englishWords(text), text)
            assertEquals(strings(c["keys"]), combos.map { (p, t) -> HeardCheck.meaningKey(text, p, t) }, text)
        }
    }

    @Test
    fun stemsMatch() {
        for (c in data["stems"]!!.jsonArray.map { it.jsonObject }) {
            val w = c["word"].str!!
            assertEquals(c["tense"].str, HeardCheck.tenseStem(w), w)
            assertEquals(c["plural"].str, HeardCheck.pluralStem(w), w)
        }
    }

    @Test
    fun chineseRulesMatch() {
        for (c in data["zh"]!!.jsonArray.map { it.jsonObject }) {
            val text = c["text"].str!!
            assertEquals(c["marks"]!!.jsonPrimitive.boolean, HeardCheck.marksTense(text), text)
            assertEquals(c["ta"]!!.jsonPrimitive.boolean, HeardCheck.hasTaPronoun(text), text)
            assertEquals(c["key"].str, HeardCheck.taKey(text), text)
        }
    }

    @Test
    fun lineRulesMatch() {
        val cases = data["lines"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.any { it["pronoun"]!!.jsonPrimitive.boolean } && cases.any { it["tense"]!!.jsonPrimitive.boolean })
        for (c in cases) {
            val text = c["text"].str!!
            assertEquals(c["pronoun"]!!.jsonPrimitive.boolean, HeardCheck.pronounLine(text, c["quote"].str), text)
            assertEquals(c["tense"]!!.jsonPrimitive.boolean, HeardCheck.tenseLine(text, c["quote"].str), text)
        }
        for (c in data["roles"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["same"]!!.jsonPrimitive.boolean, HeardCheck.sameRolesAndPolarity(c["a"].str!!, c["b"].str!!), c.toString())
        }
    }

    @Test
    fun forgiveMatches() {
        val cases = data["forgiven"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 20)
        assertTrue(cases.any { it["check"]!!.jsonObject["verdict"].str == "correct" } && cases.any { it["check"]!!.jsonObject["verdict"].str == "almost" })
        for (c in cases) {
            val input = json.decodeFromJsonElement(AnswerCheckInput.serializer(), c["input"]!!)
            val want = json.decodeFromJsonElement(AnswerCheck.serializer(), c["check"]!!)
            val normalized = LessonAnswerCheck.normalize(c["raw"], input.answer, input.modelAnswer)
            assertEquals(want, HeardCheck.forgive(normalized, input), c.toString())
        }
    }
}
