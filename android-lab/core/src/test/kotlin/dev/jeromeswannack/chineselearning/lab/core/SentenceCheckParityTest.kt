package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.fail

/** sentence_making's honest grade (shared/lesson/sentenceCheck.ts) + "a pause is never grammar" — golden vectors from the TS. */
class SentenceCheckParityTest {
    private val json = Json { ignoreUnknownKeys = true }
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "sentence-check.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun JsonElement.strings(): List<String> = jsonArray.map { it.jsonPrimitive.content }

    @Test
    fun versionsAndCopy() {
        val f = fixture()
        val v = f["versions"]!!.jsonObject
        assertEquals(v["check"]!!.jsonPrimitive.int, SentenceCheck.CHECK_VERSION)
        assertEquals(v["fix"]!!.jsonPrimitive.int, SentenceCheck.FIX_VERSION)
        assertEquals(v["answer"]!!.jsonPrimitive.int, LessonAnswerCheck.VERSION)
        assertEquals(v["speaking"]!!.jsonPrimitive.int, LessonAnswerCheck.SPEAKING_VERSION)
        val c = f["copy"]!!.jsonObject
        assertEquals(c["tryAgain"].str, SentenceCheck.TRY_AGAIN_LABEL)
        assertEquals(c["showFix"].str, SentenceCheck.SHOW_FIX_LABEL)
        assertEquals(c["fixLabel"].str, SentenceCheck.FIX_LABEL)
        assertEquals(c["sayFix"].str, SentenceCheck.SAY_FIX_LABEL)
        assertEquals(c["more"].str, SentenceCheck.MORE_LABEL)
        assertEquals(c["example"].str, SentenceCheck.EXAMPLE_TOGGLE)
        assertEquals(c["fixing"].str, SentenceCheck.FIXING_LINE)
        assertEquals(c["fixOffline"].str, SentenceCheck.FIX_OFFLINE)
        assertEquals(c["fixFailed"].str, SentenceCheck.FIX_FAILED)
        assertEquals(c["retryOffline"].str, SentenceCheck.RETRY_OFFLINE)
        assertEquals(c["retryNote"].str, SentenceCheck.RETRY_NOTE)
        assertEquals(c["selfCheck"].str, SentenceCheck.SELF_CHECK)
        assertEquals(c["selfCheckHandwritten"].str, SentenceCheck.SELF_CHECK_HANDWRITTEN)
        assertEquals(c["right"].str, SentenceCheck.RIGHT_HEADLINE)
        assertEquals(c["missing"].str, SentenceCheck.MISSING_WORD_HEADLINE)
        assertEquals(c["wrong"].str, SentenceCheck.WRONG_HEADLINE)
        for (e in f["chips"]!!.jsonArray) {
            val o = e.jsonObject
            val chip = SentenceCheck.chip(o["grade"].str!!)
            assertEquals(o["icon"].str, chip.icon)
            assertEquals(o["tone"].str, chip.tone)
            assertEquals(o["label"].str, chip.label)
        }
        for (e in f["phrases"]!!.jsonArray) {
            val o = e.jsonObject
            val words = o["words"]!!.strings()
            assertEquals(o["phrase"].str, SentenceCheck.targetWordsPhrase(words))
            assertEquals(o["headline"].str, SentenceCheck.needsWorkHeadline(words))
        }
    }

    @Test
    fun guardAndLines() {
        val f = fixture()
        for (e in f["problems"]!!.jsonArray) {
            val o = e.jsonObject
            val t = o["text"].str!!
            assertEquals(o["names"]!!.jsonPrimitive.boolean, SentenceCheck.namesProblem(t), t)
            assertEquals(o["clause"].str, SentenceCheck.problemClause(t), t)
            assertEquals(o["clauses"]!!.strings(), SentenceCheck.explanationClauses(t), t)
        }
        for (e in f["guard"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["out"].str, SentenceCheck.guardGrade(o["grade"].str!!, o["lines"]!!.strings(), o["uses"]!!.jsonPrimitive.boolean), o.toString())
        }
        for (e in f["legacy"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["out"].str, SentenceCheck.legacyGrade(o["verdict"].str, o["uses"]!!.jsonPrimitive.boolean))
        }
        for (e in f["lineCuts"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["out"].str, SentenceCheck.sentenceLine(o["text"].str, o["max"]!!.jsonPrimitive.int), o.toString())
        }
    }

    @Test
    fun viewsMatchTypeScript() {
        for (e in fixture()["views"]!!.jsonArray) {
            val o = e.jsonObject
            val fb = json.decodeFromJsonElement(SentenceFeedback.serializer(), o["feedback"]!!)
            val v = SentenceCheck.view(fb, o["words"]!!.strings())
            val want = o["view"]!!.jsonObject
            val ctx = o.toString()
            assertEquals(want["grade"].str, v.grade, ctx)
            assertEquals(want["icon"].str, v.icon, ctx)
            assertEquals(want["tone"].str, v.tone, ctx)
            assertEquals(want["label"].str, v.label, ctx)
            assertEquals(want["state"].str, v.state, ctx)
            assertEquals(want["headline"].str, v.headline, ctx)
            assertEquals(want["reason"].str, v.reason, ctx)
            assertEquals(want["more"].str, v.more, ctx)
            assertEquals(want["fixable"]!!.jsonPrimitive.boolean, v.fixable, ctx)
            assertEquals(want["right"]!!.jsonPrimitive.boolean, v.right, ctx)
            assertEquals(want["downgraded"]!!.jsonPrimitive.boolean, v.downgraded, ctx)
        }
    }

    @Test
    fun aPauseIsNeverGrammar() {
        val f = fixture()
        for (e in f["scrub"]!!.jsonArray) {
            val o = e.jsonObject
            val t = o["text"].str!!
            assertEquals(o["out"].str, AnswerKey.scrubSpokenTranscript(t), t)
            assertEquals(o["spoken"].str, AnswerKey.spokenCheckAnswer(t, "spoken"), t)
            assertEquals(o["edited"].str, AnswerKey.spokenCheckAnswer(t, "edited"), t)
            assertEquals(o["typed"].str, AnswerKey.spokenCheckAnswer(t, "typed"), t)
        }
        for (e in f["complaints"]!!.jsonArray) {
            val o = e.jsonObject
            assertEquals(o["out"]!!.jsonPrimitive.boolean, LessonAnswerCheck.punctuationComplaint(o["text"].str!!), o["text"].str)
        }
        for (e in f["normalized"]!!.jsonArray) {
            val o = e.jsonObject
            val spoken = o["spoken"]!!.jsonPrimitive.booleanOrNull ?: false
            val c = LessonAnswerCheck.normalize(o["raw"], o["answer"].str!!, o["model"].str, spoken)
            val want = o["check"]!!.jsonObject
            assertEquals(want["verdict"].str, c.verdict, o.toString())
            assertEquals(want["headline"].str, c.headline, o.toString())
            assertEquals((want["tips"] as JsonArray).map { it.jsonObject["text"].str }, c.tips.map { it.text }, o.toString())
        }
    }
}
