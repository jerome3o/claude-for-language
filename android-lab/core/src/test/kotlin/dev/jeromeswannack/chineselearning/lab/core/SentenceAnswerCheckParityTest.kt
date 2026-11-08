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
import java.util.Locale
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Sentence answers checked by Claude reproduce shared/study/sentenceAnswerCheck.ts (parity/fixtures/sentence-answer-check.ts). */
class SentenceAnswerCheckParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "sentence-answer-check.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun verdict(s: String?) = s?.let { AnswerKey.Verdict.valueOf(it.uppercase(Locale.ROOT)) }
    private fun name(v: AnswerKey.Verdict) = v.name.lowercase(Locale.ROOT)

    @Test
    fun whichAnswersGoToClaude() {
        val f = fixture()
        for (c in f["sentence"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["sentence"]!!.jsonPrimitive.boolean, SentenceAnswerCheck.isSentenceAnswer(o["hanzi"]!!.str!!), o.toString())
        }
        val cases = f["applies"]!!.jsonArray
        assertTrue(cases.size > 1000)
        var yes = 0
        for (c in cases) {
            val o = c.jsonObject
            val got = SentenceAnswerCheck.applies(
                o["cardType"]!!.str!!, o["hanzi"]!!.str!!, o["answer"]!!.str, verdict(o["verdict"]!!.str), o["multipleChoice"]!!.jsonPrimitive.boolean,
            )
            assertEquals(o["applies"]!!.jsonPrimitive.boolean, got, o.toString())
            if (got) yes++
        }
        assertTrue(yes > 4)
    }

    @Test
    fun theRequestAndItsCacheKey() {
        for (c in fixture()["inputs"]!!.jsonArray) {
            val o = c.jsonObject
            val input = SentenceAnswerCheck.input(
                " I drink coffee in the morning so I'm not sleepy at work. ", " 我早上喝咖啡是为了上班不困。", o["pinyin"]!!.str,
                " 我早上喝咖啡，因为工作不困。 ", o["spoken"]!!.jsonPrimitive.boolean,
            )
            val want = o["input"]!!.jsonObject
            assertEquals(want["prompt_en"]!!.str, input.promptEn)
            assertEquals(want["model_answer"]!!.str, input.modelAnswer)
            assertEquals(want["model_pinyin"]?.str, input.modelPinyin)
            assertEquals(want["answer"]!!.str, input.answer)
            assertEquals(want["exercise_type"]!!.str, input.exerciseType)
            assertEquals(want["input"]!!.str, input.input)
            assertEquals(o["cacheText"]!!.str, LessonAnswerCheck.cacheText(input), o.toString())
        }
    }

    @Test
    fun theVerdictMapping() {
        val f = fixture()
        for (c in f["checked"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["verdict"]!!.str, name(SentenceAnswerCheck.checkedVerdict(verdict(o["local"]!!.str)!!, o["claude"]!!.str)), o.toString())
        }
        for (c in f["outcomes"]!!.jsonArray) {
            val o = c.jsonObject
            val want = o["outcome"]!!.jsonObject
            val got = SentenceAnswerCheck.outcome(o["claude"]!!.str!!)
            assertEquals(want["answerVerdict"]!!.str, name(got.answerVerdict), o.toString())
            assertEquals(want["question"]!!.str, got.question, o.toString())
            assertEquals(want["pass"]!!.str, got.pass, o.toString())
            assertEquals(want["right"]!!.jsonPrimitive.boolean, got.right, o.toString())
        }
        for (c in f["differences"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["reason"]!!.str, SentenceAnswerCheck.difference(o["said"]!!.str!!, o["model"]!!.str!!, o["claude"]!!.str), o.toString())
        }
        val copy = f["copy"]!!.jsonObject
        assertEquals(copy["cardTypes"]!!.jsonArray.map { it.str }, SentenceAnswerCheck.CARD_TYPES)
        assertEquals(copy["checking"]!!.str, SentenceAnswerCheck.CHECKING)
        assertEquals(copy["typeInstead"]!!.str, SentenceAnswerCheck.TYPE_INSTEAD)
        assertEquals(copy["answer"]!!.str, SentenceAnswerCheck.ANSWER)
        assertEquals(copy["yourFix"]!!.str, SentenceAnswerCheck.YOUR_FIX)
        assertEquals(copy["moveOnNote"]!!.str, SentenceAnswerCheck.MOVE_ON_NOTE)
    }

    @Test
    fun whatTheQuestionShows() {
        val cases = fixture()["views"]!!.jsonArray
        assertTrue(cases.size > 100)
        var fixes = 0
        for (c in cases) {
            val o = c.jsonObject
            val want = o["view"]!!.jsonObject
            val got = SentenceAnswerCheck.view(
                o["applies"]!!.jsonPrimitive.boolean, o["checking"]!!.jsonPrimitive.boolean, o["claude"]!!.str,
                o["said"]!!.str!!, o["model"]!!.str!!, o["corrected"]!!.str,
            )
            assertEquals(want["answerFirst"]!!.jsonPrimitive.boolean, got.answerFirst, o.toString())
            assertEquals(want["accepted"]!!.jsonPrimitive.boolean, got.accepted, o.toString())
            assertEquals(want["checking"]!!.jsonPrimitive.boolean, got.checking, o.toString())
            assertEquals(want["corrected"]!!.str, got.corrected, o.toString())
            assertEquals(want["readAgain"]!!.jsonPrimitive.boolean, got.readAgain, o.toString())
            if (got.corrected != null) fixes++
        }
        assertTrue(fixes > 0)
    }
}
