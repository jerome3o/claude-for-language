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

/** The slim answer feedback reproduces shared/cards/answer-diff.ts (parity/fixtures/answer-diff.ts). */
class AnswerDiffParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "answer-diff.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun diffsSummariesAndLines() {
        val cases = fixture()["cases"]!!.jsonArray
        assertTrue(cases.size >= 30)
        for (c in cases) {
            val o = c.jsonObject
            val said = o["said"]!!.str!!
            val expected = o["expected"]!!.str!!
            val d = AnswerDiff.of(said, expected)
            val want = o["diff"]!!.jsonObject
            val parts = want["parts"]!!.jsonArray.map {
                val p = it.jsonObject
                AnswerDiff.Part(p["text"]!!.str!!, p["kind"]!!.str!!, p["expected"]!!.str!!)
            }
            val ctx = "$said / $expected"
            assertEquals(parts, d.parts, ctx)
            for (k in listOf("wrong", "tone", "missing", "extra", "sound")) assertEquals(want[k]!!.jsonPrimitive.int, d.count(k), "$ctx $k")
            assertEquals(want["right"]!!.jsonPrimitive.boolean, d.right, ctx)
            assertEquals(want["reordered"]!!.jsonPrimitive.boolean, d.reordered, ctx)
            assertEquals(want["empty"]!!.jsonPrimitive.boolean, d.empty, ctx)
            val summary = AnswerDiff.summary(d)
            assertEquals(o["summary"]!!.str, summary, ctx)
            assertEquals(o["tone"]!!.str, AnswerDiff.tone(d), ctx)
            assertEquals(o["toneAccepted"]!!.str, AnswerDiff.tone(d, true), ctx)
            for (l in o["lines"]!!.jsonArray) {
                val lo = l.jsonObject
                assertEquals(lo["line"]!!.str, AnswerDiff.line(d, lo["accepted"]!!.jsonPrimitive.boolean, lo["headline"]!!.str), "$ctx $lo")
            }
            assertEquals(o["label"]!!.str, AnswerDiff.label(d, summary), ctx)
            assertEquals(o["labelSaid"]!!.str, AnswerDiff.label(d, summary, AnswerDiff.YOU_SAID), ctx)
        }
    }

    @Test
    fun firstSentences() {
        for (s in fixture()["sentences"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(o["first"]!!.str, AnswerDiff.firstSentence(o["text"]!!.str), o.toString())
            assertEquals(o["first20"]!!.str, AnswerDiff.firstSentence(o["text"]!!.str, 20), o.toString())
        }
    }

    @Test
    fun verdicts() {
        for ((key, v) in fixture()["verdicts"]!!.jsonObject) {
            val o = v.jsonObject
            assertEquals(o["tone"]!!.str to o["label"]!!.str, AnswerDiff.verdict(key), key)
        }
    }

    @Test
    fun copy() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["right"]!!.str, AnswerDiff.RIGHT)
        assertEquals(c["worded"]!!.str, AnswerDiff.WORDED)
        assertEquals(c["order"]!!.str, AnswerDiff.ORDER)
        assertEquals(c["far"]!!.str, AnswerDiff.FAR)
        assertEquals(c["empty"]!!.str, AnswerDiff.EMPTY)
        assertEquals(c["youSaid"]!!.str, AnswerDiff.YOU_SAID)
        assertEquals(c["yourAnswer"]!!.str, AnswerDiff.YOUR_ANSWER)
    }
}
