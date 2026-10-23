package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
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

/** Claude's check of free speaking reproduces shared/lesson/answerCheck.ts + speakingTake.ts (parity/fixtures/lesson-speaking-check.ts). */
class LessonSpeakingCheckParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val data: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "lesson-speaking-check.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun list(key: String) = data[key]!!.jsonArray.map { it.jsonObject }

    @Test
    fun appliesMatches() {
        val cases = list("applies")
        assertTrue(cases.any { it["applies"]!!.jsonPrimitive.boolean })
        for (c in cases) assertEquals(c["applies"]!!.jsonPrimitive.boolean, LessonAnswerCheck.applies(c["type"].str!!, c["answer"].str), c.toString())
    }

    @Test
    fun cacheTextMatches() {
        for (c in list("cacheTexts")) {
            val input = json.decodeFromJsonElement(AnswerCheckInput.serializer(), c["input"]!!)
            assertEquals(c["text"].str, LessonAnswerCheck.cacheText(input), c.toString())
        }
    }

    @Test
    fun normalizeAndCleanerMatch() {
        val cases = list("normalized")
        assertTrue(cases.any { it["check"]!!.jsonObject["parts"] != null })
        for (c in cases) {
            val got = LessonAnswerCheck.normalize(c["raw"], c["answer"].str!!)
            val want = json.decodeFromJsonElement(AnswerCheck.serializer(), c["check"]!!)
            assertEquals(want, got, c.toString())
            val cl = c["cleaner"]!!.jsonObject
            assertEquals(LessonAnswerCheck.CleanerVersion(cl["hanzi"].str!!, cl["pinyin"].str!!, cl["diffFrom"].str), LessonAnswerCheck.cleanerVersion(got), c.toString())
        }
    }

    @Test
    fun taskPartsMatch() {
        val cases = list("parts")
        assertTrue(cases.any { it["parts"]!!.jsonArray.size == 4 })
        for (c in cases) {
            val want = c["parts"]!!.jsonArray.map { it.jsonObject }.map { LessonAnswerCheck.TaskPart(it["marker"].str!!, it["structure"].str!!, it["description"].str!!) }
            assertEquals(want, LessonAnswerCheck.taskParts(c["prompt"].str), c.toString())
        }
    }

    @Test
    fun marksAndQuickQuestions() {
        for (c in list("chips")) {
            val chip = c["chip"]!!.jsonObject
            assertEquals(LessonAnswerCheck.Chip(chip["label"].str!!, chip["tone"].str!!), LessonAnswerCheck.chip(c["verdict"].str!!, speaking = true))
        }
        for (c in list("marks")) {
            val m = c["mark"]!!.jsonObject
            assertEquals(LessonAnswerCheck.PartMark(m["icon"].str!!, m["tone"].str!!), LessonAnswerCheck.partMark(c["status"].str!!))
        }
        for (c in list("quick")) {
            assertEquals(c["questions"]!!.jsonArray.map { it.str!! }, LessonAnswerCheck.askQuickQuestions("almost", c["type"].str), c.toString())
        }
    }

    @Test
    fun takeNumbers() {
        val t = data["take"]!!.jsonObject
        assertEquals(t["maxSeconds"]!!.jsonPrimitive.int, SpeakingTake.MAX_SECONDS)
        assertEquals(t["keyMarginMs"]!!.jsonPrimitive.long, SpeakingTake.LIVE_KEY_MARGIN_MS)
        assertEquals(t["finishTimeoutMs"]!!.jsonPrimitive.long, SpeakingTake.FINISH_TIMEOUT_MS)
        for (l in t["lines"]!!.jsonArray.map { it.jsonObject }) assertEquals(l["line"].str, SpeakingTake.line(l["phase"].str!!))
        for (c in t["clocks"]!!.jsonArray.map { it.jsonObject }) assertEquals(c["clock"].str, SpeakingTake.clock(c["s"]!!.jsonPrimitive.double))
    }
}
