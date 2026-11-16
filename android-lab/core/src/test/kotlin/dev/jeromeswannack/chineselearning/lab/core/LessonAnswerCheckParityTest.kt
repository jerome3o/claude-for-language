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

    private fun strings(e: JsonElement?): List<String> = e!!.jsonArray.map { it.str!! }

    @Test
    fun scrambleLocalVerdictMatches() {
        for (c in data["scrambleLocal"]!!.jsonArray.map { it.jsonObject }) {
            val alts = c["alts"]?.takeIf { it !is JsonNull }?.jsonArray?.map { strings(it) }
            val got = ScrambleCheck.localVerdict(strings(c["picked"]), listOf("高兴起来了", "孩子", "就", "蛋糕", "一看见"), listOf("孩子", "一看见", "蛋糕", "就", "高兴起来了"), alts)
            assertEquals(c["verdict"].str, got, c.toString())
        }
    }

    @Test
    fun scrambleCheckInputMatches() {
        val cases = data["scrambleInputs"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.count { it["input"] !is JsonNull } >= 2)
        for (c in cases) {
            val picked = strings(c["picked"])
            val got = ScrambleCheck.checkInput(c["english"].str, strings(c["correct_order"]), picked, c["focus"].str)
            val want = c["input"]?.takeIf { it !is JsonNull }?.let { json.decodeFromJsonElement(AnswerCheckInput.serializer(), it) }
            assertEquals(want, got, c.toString())
            assertEquals(c["sentence"].str, ScrambleCheck.sentence(picked), c.toString())
            assertEquals(c["text"].str, ScrambleCheck.orderText(picked), c.toString())
            if (got != null) assertTrue(LessonAnswerCheck.applies(got.exerciseType, got.answer))
        }
    }

    @Test
    fun scrambleOutcomeMatches() {
        val jerome = listOf("一看见", "蛋糕", "孩子", "就", "高兴起来了")
        val correct = listOf("孩子", "一看见", "蛋糕", "就", "高兴起来了")
        val cases = data["scrambleOutcomes"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 20)
        for (c in cases) {
            val st = c["status"]?.takeIf { it !is JsonNull }?.jsonObject
            val status: ScrambleCheck.Status? = when (st?.get("status").str) {
                null -> null
                "checking" -> ScrambleCheck.Status.Checking
                "unavailable" -> ScrambleCheck.Status.Unavailable
                else -> ScrambleCheck.Status.Done(json.decodeFromJsonElement(AnswerCheck.serializer(), st!!["check"]!!))
            }
            val o = c["outcome"]!!.jsonObject
            val want = ScrambleCheck.Outcome(
                o["kind"].str!!, o["banner"].str!!, o["tone"].str!!, o["correct"]!!.jsonPrimitive.boolean,
                o["expectedLabel"].str, o["note"].str, o["checking"]!!.jsonPrimitive.boolean, o["moment"].str,
            )
            val got = ScrambleCheck.outcome(c["local"].str!!, status, c["same"]!!.jsonPrimitive.boolean)
            assertEquals(want, got, c.toString())
            assertEquals(c["spoken"].str, ScrambleCheck.spokenSentence(got.kind, jerome, correct), c.toString())
        }
    }
}
