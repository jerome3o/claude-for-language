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
 * The answer screen's sanity rules reproduce shared/lesson/answerCheck.ts (insaneTip / saneHeadline) and
 * shared/lesson/feedback.ts (answerMarks) exactly (parity/fixtures/answer-sanity.ts) — Jerome's 因为 answer, Nov 2026.
 */
class AnswerSanityParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "answer-sanity.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content

    @Test
    fun constantsMatch() {
        assertEquals(data["version"]!!.jsonPrimitive.int, LessonAnswerCheck.VERSION)
        val p = data["plain"]!!.jsonObject
        assertEquals(p["correct"].str, LessonAnswerCheck.PLAIN_CORRECT_HEADLINE)
        assertEquals(p["acceptable"].str, LessonAnswerCheck.PLAIN_ACCEPTABLE_HEADLINE)
        assertEquals(p["reordered"].str, LessonFeedback.REORDERED_NOTE)
    }

    @Test
    fun normalizeWithModelMatches() {
        val cases = data["normalized"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val want = json.decodeFromJsonElement(AnswerCheck.serializer(), c["check"]!!)
            assertEquals(want, LessonAnswerCheck.normalize(c["raw"], c["answer"].str!!, c["model"].str), c.toString())
        }
    }

    @Test
    fun textRulesMatch() {
        val mine = data["mine"].str!!
        for (c in data["texts"]!!.jsonArray.map { it.jsonObject }) {
            val text = c["text"].str!!
            assertEquals(c["compares"]!!.jsonPrimitive.boolean, LessonAnswerCheck.comparesIdenticalTexts(text), text)
            assertEquals(c["recommends"]!!.jsonPrimitive.boolean, LessonAnswerCheck.recommendsText(text, mine), text)
        }
    }

    @Test
    fun answerMarksMatch() {
        val cases = data["marks"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.isNotEmpty())
        for (c in cases) {
            val a = c["answer"].str!!
            val m = c["model"].str!!
            assertEquals(c["same"]!!.jsonPrimitive.boolean, LessonFeedback.sameCharacters(a, m), c.toString())
            val want = c["marks"]!!.jsonObject
            assertEquals(LessonFeedback.AnswerMarks(want["marks"]!!.jsonPrimitive.boolean, want["note"].str), LessonFeedback.answerMarks(a, m, c["verdict"].str), c.toString())
        }
    }
}
