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

/** "Right, but said differently" reproduces shared/study/answerDifference.ts (parity/fixtures/answer-difference.ts). */
class AnswerDifferenceParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "answer-difference.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun state(s: String) = SpokenAnswerResult.State.valueOf(s.uppercase(Locale.ROOT))

    @Test
    fun roundTakes() {
        val cases = fixture()["round"]!!.jsonArray
        assertTrue(cases.size >= 400)
        var held = 0
        for (c in cases) {
            val o = c.jsonObject
            val reason = AnswerDifference.roundTake(o["mode"]!!.str!!, o["said"]!!.str!!, o["model"]!!.str!!, state(o["local"]!!.str!!), o["claude"]!!.str)
            assertEquals(o["reason"]!!.str, reason, o.toString())
            if (reason != null) held++
        }
        assertTrue(held > 10)
    }

    @Test
    fun questionsAndSameWords() {
        val f = fixture()
        for (c in f["question"]!!.jsonArray) {
            val o = c.jsonObject
            val v = o["verdict"]!!.str?.let { AnswerKey.Verdict.valueOf(it.uppercase(Locale.ROOT)) }
            assertEquals(o["reason"]!!.str, AnswerDifference.question(v), o.toString())
        }
        for (c in f["same"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["same"]!!.jsonPrimitive.boolean, AnswerDifference.sameWords(o["said"]!!.str!!, o["model"]!!.str!!), o.toString())
        }
    }

    @Test
    fun lines() {
        for (c in fixture()["lines"]!!.jsonArray) {
            val o = c.jsonObject
            val got = AnswerDifference.lines(o["said"]!!.str!!, o["model"]!!.str!!, o["accepted"]!!.jsonPrimitive.boolean)
            val want = o["lines"]!!.jsonObject
            fun cells(e: JsonElement) = e.jsonArray.map { it.jsonObject["char"]!!.str!! to it.jsonObject["mark"]!!.str!! }
            fun cells(l: List<SpokenAnswerResult.Cell>) = l.map { it.char to SpokenAnswerResult.markName(it.mark) }
            assertEquals(cells(want["said"]!!), cells(got.said), o.toString())
            assertEquals(cells(want["model"]!!), cells(got.model), o.toString())
        }
    }

    @Test
    fun copy() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["reasons"]!!.jsonArray.map { it.str }, AnswerDifference.REASONS)
        for (r in AnswerDifference.REASONS) assertEquals(c["title"]!!.jsonObject[r]!!.str, AnswerDifference.TITLE[r])
        assertEquals(c["said"]!!.str, AnswerDifference.SAID)
        assertEquals(c["model"]!!.str, AnswerDifference.MODEL)
        assertEquals(c["card"]!!.str, AnswerDifference.CARD)
        assertEquals(c["holdNote"]!!.str, AnswerDifference.HOLD_NOTE)
        assertEquals(c["continue"]!!.str, AnswerDifference.CONTINUE)
    }
}
