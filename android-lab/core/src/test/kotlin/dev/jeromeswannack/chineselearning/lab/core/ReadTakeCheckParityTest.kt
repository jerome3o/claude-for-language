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

/** A read card's take checked by Claude reproduces shared/study/readTakeCheck.ts (parity/fixtures/read-take-check.ts). */
class ReadTakeCheckParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "read-take-check.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.bool(k: String) = this[k]!!.jsonPrimitive.boolean
    private fun take(o: JsonObject) = ReadTakeCheck.Take(o.bool("isMatch"), o.bool("containsExpected"), o.bool("tonesOff"))

    @Test
    fun countsAndStates() {
        val f = fixture()
        for (c in f["counts"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["count"]!!.jsonPrimitive.int, ReadTakeCheck.hanCount(o["hanzi"]!!.str!!), o.toString())
        }
        for (c in f["states"]!!.jsonArray) {
            val o = c.jsonObject
            val t = take(o["take"]!!.jsonObject)
            assertEquals(o["state"]!!.str, ReadTakeCheck.deviceState(t.isMatch, t.containsExpected, t.tonesOff), o.toString())
        }
    }

    @Test
    fun whichTakesGoToClaude() {
        val cases = fixture()["applies"]!!.jsonArray
        assertTrue(cases.size > 400)
        var yes = 0
        for (c in cases) {
            val o = c.jsonObject
            val t = take(o["take"]!!.jsonObject)
            val got = ReadTakeCheck.applies(o["cardType"]!!.str!!, o["hanzi"]!!.str!!, o["transcript"]!!.str, t.isMatch, t.containsExpected, t.tonesOff)
            assertEquals(o["applies"]!!.jsonPrimitive.boolean, got, o.toString())
            if (got) yes++
        }
        assertTrue(yes > 4)
    }

    @Test
    fun theRequestAndItsCacheKey() {
        for (c in fixture()["inputs"]!!.jsonArray) {
            val o = c.jsonObject
            val input = ReadTakeCheck.input(" 我越学中文，越觉得英文很繁琐。 ", o["pinyin"]!!.str, o["english"]!!.str, o["transcript"]!!.str!!)
            val want = o["input"]!!.jsonObject
            assertEquals(want["prompt_en"]!!.str, input.promptEn, o.toString())
            assertEquals(want["model_answer"]!!.str, input.modelAnswer)
            assertEquals(want["model_pinyin"]?.str, input.modelPinyin)
            assertEquals(want["answer"]!!.str, input.answer, o.toString())
            assertEquals(want["exercise_type"]!!.str, input.exerciseType)
            assertEquals(want["input"]!!.str, input.input)
            assertEquals(o["cacheText"]!!.str, LessonAnswerCheck.cacheText(input), o.toString())
        }
    }

    @Test
    fun claudesVerdict() {
        val f = fixture()
        for (c in f["claudeStates"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["state"]!!.str, ReadTakeCheck.claudeState(o["verdict"]!!.str!!), o.toString())
        }
        for (c in f["checked"]!!.jsonArray) {
            val o = c.jsonObject
            val got = ReadTakeCheck.checked(take(o["take"]!!.jsonObject), o["claude"]!!.str)
            assertEquals(take(o["out"]!!.jsonObject), got, o.toString())
        }
        for (c in f["reasons"]!!.jsonArray) {
            val o = c.jsonObject
            val tips = o["tips"]!!.jsonArray.map { AnswerCheckTip(it.jsonObject["text"]!!.str!!) }
            val got = ReadTakeCheck.reason(AnswerCheck(verdict = o["verdict"]!!.str!!, headline = o["headline"]!!.str!!, tips = tips))
            val want = o["reason"]!!.jsonObject
            assertEquals(want["reason"]!!.str, got.reason, o.toString())
            assertEquals(want["tip"]!!.str, got.tip, o.toString())
        }
    }

    @Test
    fun theWords() {
        val copy = fixture()["copy"]!!.jsonObject
        assertEquals(copy["checking"]!!.str, ReadTakeCheck.CHECKING)
        val chip = copy["chip"]!!.jsonObject
        assertEquals(chip.keys, ReadTakeCheck.CHIP.keys)
        for ((k, v) in chip) assertEquals(v.str, ReadTakeCheck.CHIP[k])
    }
}
