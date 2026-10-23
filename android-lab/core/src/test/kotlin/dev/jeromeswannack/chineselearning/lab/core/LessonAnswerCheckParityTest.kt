package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/** Claude's lesson answer check reproduces shared/lesson/answerCheck.ts exactly (parity/fixtures/lesson-answer-check.ts). */
class LessonAnswerCheckParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson-answer-check.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    @Test
    fun appliesMatches() {
        val cases = data["applies"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.any { it["applies"]!!.jsonPrimitive.boolean })
        for (c in cases) assertEquals(c["applies"]!!.jsonPrimitive.boolean, LessonAnswerCheck.applies(c["type"].str!!, c["answer"].str), c.toString())
    }

    @Test
    fun cacheTextMatches() {
        for (c in data["cacheTexts"]!!.jsonArray.map { it.jsonObject }) {
            val input = json.decodeFromJsonElement(AnswerCheckInput.serializer(), c["input"]!!)
            assertEquals(c["text"].str, LessonAnswerCheck.cacheText(input), c.toString())
        }
    }

    @Test
    fun normalizeMatches() {
        val cases = data["normalized"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.count { !it["error"]!!.jsonPrimitive.boolean } >= 5)
        for (c in cases) {
            val raw = c["raw"]
            val got = LessonAnswerCheck.parse(raw, c["answer"].str!!)
            if (c["error"]!!.jsonPrimitive.boolean) {
                assertNull(got, c.toString())
            } else {
                val want = json.decodeFromJsonElement(AnswerCheck.serializer(), c["check"]!!)
                assertEquals(want, got, c.toString())
            }
        }
    }

    @Test
    fun chipsAndSuggestion() {
        for (c in data["chips"]!!.jsonArray.map { it.jsonObject }) {
            val v = c["verdict"].str!!
            val chip = c["chip"]!!.jsonObject
            assertEquals(LessonAnswerCheck.Chip(chip["label"].str!!, chip["tone"].str!!), LessonAnswerCheck.chip(v))
            assertEquals(c["suggested"].str, LessonAnswerCheck.suggestedFor(v))
        }
    }

    @Test
    fun tipSegmentsMatch() {
        for (c in data["tips"]!!.jsonArray.map { it.jsonObject }) {
            val tip = json.decodeFromJsonElement(AnswerCheckTip.serializer(), c["tip"]!!)
            val r = c["result"]!!.jsonObject
            val want = LessonAnswerCheck.TipSegments(
                r["segments"]!!.jsonArray.map { it.jsonObject }.map { LessonAnswerCheck.TipSegment(it["text"].str!!, it["han"]!!.jsonPrimitive.boolean, it["quote"]!!.jsonPrimitive.boolean) },
                r["quoteInText"]!!.jsonPrimitive.boolean,
            )
            assertEquals(want, LessonAnswerCheck.tipSegments(tip), c.toString())
        }
    }

    @Test
    fun exactMatches() {
        val cases = data["exact"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.count { it["check"] !is JsonNull } >= 3)
        for (c in cases) {
            val i = c["input"]!!.jsonObject
            val got = LessonAnswerCheck.exact(i["exercise_type"].str!!, i["answer"].str!!, i["model_answer"].str!!)
            val want = c["check"]?.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(AnswerCheck.serializer(), it) }
            assertEquals(want, got, c.toString())
        }
    }

    @Test
    fun quickQuestions() {
        for (c in data["quick"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c["questions"]!!.jsonArray.map { it.str!! }, LessonAnswerCheck.askQuickQuestions(c["verdict"].str), c.toString())
        }
    }
}
