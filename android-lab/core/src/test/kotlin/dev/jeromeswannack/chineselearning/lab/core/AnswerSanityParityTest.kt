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

    @Test
    fun coherenceRulesMatch() {
        val c = data["croissant"]!!.jsonObject
        val mine = c["mine"].str!!
        val corrected = c["corrected"].str!!
        val model = c["model"].str!!
        assertEquals(mine, LessonAnswerCheck.checkKey("这个牛角包 3块多元。"))
        for (e in data["coherence"]!!.jsonArray.map { it.jsonObject }) {
            val text = e["text"].str!!
            val starts = Regex("\\p{IsHan}+").findAll(text).map { it.range.first }.toList()
            assertEquals(e["recommended"]!!.jsonArray.map { it.jsonPrimitive.boolean }, starts.map { LessonAnswerCheck.recommendedAt(text, it) }, text)
            assertEquals(e["wrongForm"]!!.jsonPrimitive.boolean, LessonAnswerCheck.recommendsWrongForm(text, mine, corrected, model), text)
            assertEquals(e["forbids"]!!.jsonPrimitive.boolean, LessonAnswerCheck.forbidsCorrected(text, corrected), text)
            assertEquals(e["forbidsNoFix"]!!.jsonPrimitive.boolean, LessonAnswerCheck.forbidsCorrected(text, ""), text)
        }
        for (n in data["neutral"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(n["headline"].str, LessonAnswerCheck.neutralHeadline(n["verdict"].str!!, n["fix"]!!.jsonPrimitive.boolean), n.toString())
        }
    }

    @Test
    fun digitsAsNumeralsMatch() {
        val cases = data["digits"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val text = c["text"].str!!
            assertEquals(c["hanzi"].str, AnswerKey.digitsToHanzi(text), text)
            assertEquals(c["key"].str, LessonAnswerCheck.checkKey(text), text)
            assertEquals(c["answerKey"].str, LessonFeedback.answerKey(text), text)
            assertEquals(c["display"].str, LessonAnswerCheck.correctedDisplay(text), text)
        }
        for (c in data["digitMarks"]!!.jsonArray.map { it.jsonObject }) {
            val a = c["answer"].str!!
            val m = c["model"].str!!
            fun shown(side: String) = c[side]!!.jsonArray.map { it.jsonObject }.map { LessonFeedback.ShownChar(it["ch"].str!!, it["hit"]!!.jsonPrimitive.boolean) }
            assertEquals(shown("answerSide"), LessonFeedback.markedChars(a, m, "answer"), c.toString())
            assertEquals(shown("modelSide"), LessonFeedback.markedChars(a, m, "model"), c.toString())
            val want = c["marks"]!!.jsonObject
            assertEquals(LessonFeedback.AnswerMarks(want["marks"]!!.jsonPrimitive.boolean, want["note"].str), LessonFeedback.answerMarks(a, m), c.toString())
        }
    }

    @Test
    fun wordsPinyinLineMatches() {
        for (c in data["wordLines"]!!.jsonArray.map { it.jsonObject }) {
            val words = c["words"]!!.jsonArray.map { it.jsonObject }.map { it["text"].str!! to it["pinyin"].str }
            assertEquals(c["line"].str, LessonAnswerCheck.wordsPinyinLine(words), c.toString())
        }
    }
}
