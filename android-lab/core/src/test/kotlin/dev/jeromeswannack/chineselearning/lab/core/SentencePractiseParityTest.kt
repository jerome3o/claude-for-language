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

/** The sentence rows' 🎤 and the Good / Easy gate reproduce shared/study/sentencePractise.ts (parity/fixtures/sentence-practise.ts). */
class SentencePractiseParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "sentence-practise.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.bool: Boolean get() = jsonPrimitive.boolean

    @Test
    fun modesMatch() {
        val cases = fixture()["modes"]!!.jsonArray
        assertEquals(16, cases.size)
        for (c in cases) {
            val o = c.jsonObject
            assertEquals(o["mode"]?.str, SentencePractise.mode(o["englishFirst"]!!.bool, o["hanziShown"]!!.bool, o["translation"]?.str), o.toString())
        }
    }

    @Test
    fun takesMatch() {
        val f = fixture()
        val cases = f["takes"]!!.jsonArray
        assertTrue(cases.size >= 100)
        val verdicts = listOf(null, "correct", "acceptable", "almost", "wrong")
        for (c in cases) {
            val o = c.jsonObject
            val t = SentencePractise.take(o["mode"]!!.str!!, o["transcript"]!!.str!!, o["target"]!!.str!!)
            val what = o.toString()
            assertEquals(o["said"]!!.str, t.practised.said, what)
            assertEquals(o["state"]!!.str, SpokenAnswerResult.stateName(t.practised.result.state), what)
            assertEquals(o["askClaude"]!!.bool, t.askClaude, what)
            assertEquals(o["results"]!!.jsonArray.map { it.str }, verdicts.map { SentencePractise.result(t.practised, it) }, what)
            assertEquals(o["via"]!!.jsonArray.map { it.str }, listOf(SentencePractise.via(t, false), SentencePractise.via(t, true)), what)
            assertEquals(
                o["checkOnline"]!!.jsonArray.map { it.bool },
                listOf(SentencePractise.showCheckOnline(t, false, false), SentencePractise.showCheckOnline(t, false, true), SentencePractise.showCheckOnline(t, true, false)),
                what,
            )
        }
        for (c in f["failures"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.str, SentencePractise.result(null, null, o["failure"]?.str))
        }
    }

    @Test
    fun checkInputsMatch() {
        for (c in fixture()["checkInputs"]!!.jsonArray) {
            val o = c.jsonObject
            val i = o["input"]!!.jsonObject
            val got = SentencePractise.checkInput(o["hanzi"]!!.str!!, o["pinyin"]?.str, o["translation"]?.str, o["said"]!!.str!!)
            assertEquals(i["prompt_en"]!!.str, got.promptEn)
            assertEquals(i["model_answer"]!!.str, got.modelAnswer)
            assertEquals(i["model_pinyin"]?.str, got.modelPinyin)
            assertEquals(i["answer"]!!.str, got.answer)
            assertEquals(i["exercise_type"]!!.str, got.exerciseType)
            assertEquals(i["input"]!!.str, got.input)
        }
    }

    @Test
    fun gatesMatch() {
        val cases = fixture()["gates"]!!.jsonArray
        assertTrue(cases.size >= 200)
        for (c in cases) {
            val o = c.jsonObject
            val count = o["sentenceCount"]?.let { if (it is JsonNull) null else it.jsonPrimitive.int }
            val keys = o["rightKeys"]!!.jsonArray.map { it.str!! }
            val g = SentencePractise.gate(o["enabled"]!!.bool, o["cardType"]!!.str!!, count, keys)
            val want = o["gate"]!!.jsonObject
            val what = o.toString()
            assertEquals(SentencePractise.Gate(want["needed"]!!.jsonPrimitive.int, want["got"]!!.jsonPrimitive.int, want["locked"]!!.bool), g, what)
            assertEquals(o["locked"]!!.jsonArray.map { it.bool }, (0..3).map { SentencePractise.ratingLocked(it, g) }, what)
            assertEquals(o["label"]?.str, SentencePractise.label(g), what)
            assertEquals(o["note"]!!.str, SentencePractise.blockedNote(g), what)
        }
    }

    @Test
    fun copyMatches() {
        val copy = fixture()["copy"]!!.jsonObject
        assertEquals(copy["label"]!!.jsonObject.mapValues { it.value.str }, SentencePractise.LABEL)
        assertEquals(copy["listening"]!!.jsonObject.mapValues { it.value.str }, SentencePractise.LISTENING)
        assertEquals(copy["stop"]!!.str, SentencePractise.STOP)
        assertEquals(copy["checking"]!!.str, SentencePractise.CHECKING)
        assertEquals(copy["checkOnline"]!!.str, SentencePractise.CHECK_ONLINE)
        assertEquals(copy["target"]!!.jsonPrimitive.int, SentencePractise.GATE_TARGET)
        assertEquals(copy["cardTypes"]!!.jsonArray.map { it.str }, SentencePractise.GATE_CARD_TYPES)
    }
}
