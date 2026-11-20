package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The one "why" sentence + "Explain more" reproduce shared/cards/answer-why.ts (parity/fixtures/answer-diff.ts). */
class AnswerWhyParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "answer-diff.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun check(e: JsonElement?): AnswerWhy.Check? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return AnswerWhy.Check(
            headline = o["headline"]?.str,
            tips = o["tips"]?.jsonArray?.map { it.jsonObject["text"]!!.str!! } ?: emptyList(),
            corrected = o["corrected"]?.str,
            alternative = o["alternative"]?.str,
        )
    }

    private fun more(e: JsonElement?): AnswerWhy.More? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return AnswerWhy.More(o["tips"]!!.jsonArray.map { it.str!! }, o["corrected"]?.str, o["alternative"]?.str)
    }

    @Test
    fun whysAndMore() {
        val whys = fixture()["whys"]!!.jsonArray
        assertTrue(whys.size >= 50)
        for (w in whys) {
            val o = w.jsonObject
            val said = o["said"]!!.str!!
            val d = AnswerDiff.of(said, o["expected"]!!.str!!)
            val c = check(o["check"])
            val ctx = o.toString()
            assertEquals(o["line"]!!.str, AnswerDiff.line(d, false, c?.headline), ctx)
            val why = AnswerWhy.why(d, c, o["line"]!!.str)
            assertEquals(o["why"]!!.str, why, ctx)
            assertEquals(o["whyNoLine"]!!.str, AnswerWhy.why(d, c), ctx)
            assertEquals(o["device"]!!.str, AnswerWhy.device(d), ctx)
            assertEquals(more(o["more"]), AnswerWhy.more(c, why, said), ctx)
            assertEquals(more(o["moreNoWhy"]), AnswerWhy.more(c, null), ctx)
            assertEquals(more(o["moreExpected"]), AnswerWhy.more(c, why, said, o["expected"]!!.str!!), ctx)
        }
    }

    @Test
    fun askClaudeFallback() {
        val f = fixture()
        assertEquals(f["askLabel"]!!.str, AnswerWhy.ASK_CLAUDE)
        val asks = f["asks"]!!.jsonArray
        assertTrue(asks.size >= 24)
        for (a in asks) {
            val o = a.jsonObject
            val more = if (o["more"]!!.jsonPrimitive.content == "true") AnswerWhy.More(listOf("x"), null, null) else null
            val offered = AnswerWhy.askOffered(o["tone"]!!.str!!, o["why"]!!.str, more, o["canAsk"]!!.jsonPrimitive.content == "true")
            assertEquals(o["offered"]!!.jsonPrimitive.content == "true", offered, o.toString())
        }
        for (q in f["askQuestions"]!!.jsonArray) {
            val o = q.jsonObject
            val spoken = o["spoken"]?.jsonPrimitive?.content != "false"
            assertEquals(o["question"]!!.str, AnswerWhy.askQuestion(o["said"]!!.str!!, o["expected"]!!.str!!, o["prompt"]?.str, spoken), o.toString())
        }
    }

    @Test
    fun copy() {
        val c = fixture()["whyCopy"]!!.jsonObject
        assertEquals(c["max"]!!.jsonPrimitive.int, AnswerWhy.MAX)
        assertEquals(c["more"]!!.str, AnswerWhy.MORE)
        assertEquals(c["less"]!!.str, AnswerWhy.LESS)
        assertEquals(c["corrected"]!!.str, AnswerWhy.CORRECTED)
        assertEquals(c["alternative"]!!.str, AnswerWhy.ALTERNATIVE)
        assertEquals(c["stock"]!!.jsonArray.map { it.str }, AnswerWhy.STOCK)
    }
}
