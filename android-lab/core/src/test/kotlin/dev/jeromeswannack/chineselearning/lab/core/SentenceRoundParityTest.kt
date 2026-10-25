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

/** The Sentence round reproduces shared/study/sentenceRound.ts (parity/fixtures/sentence-round.ts). */
class SentenceRoundParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "sentence-round.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    private fun sentence(e: JsonElement?): SentenceRound.Sentence? {
        if (e == null || e is JsonNull) return null
        val o = e.jsonObject
        return SentenceRound.Sentence(o["key"]!!.str!!, o["hanzi"]!!.str!!, o["translation"]?.str)
    }

    @Test
    fun listsMatch() {
        val lists = fixture()["lists"]!!.jsonArray
        assertTrue(lists.size >= 100)
        var reused = 0
        var small = 0
        for (l in lists) {
            val o = l.jsonObject
            val what = o.toString()
            val sentences = SentenceRound.sentences(sentence(o["clue"]), o["set"]!!.jsonArray.map { sentence(it)!! })
            assertEquals(o["sentences"]!!.jsonArray.map { sentence(it)!! }, sentences, what)
            val exercises = SentenceRound.pick(sentences)
            val expected = o["exercises"]!!.jsonArray.map {
                val e = it.jsonObject
                SentenceRound.Exercise(e["id"]!!.str!!, e["key"]!!.str!!, e["mode"]!!.str!!, e["index"]!!.jsonPrimitive.int)
            }
            assertEquals(expected, exercises, what)
            if (exercises.map { it.key }.toSet().size < exercises.size) reused++
            if (sentences.size in 2..3) assertEquals(sentences.size, exercises.size, what)
            small += if (sentences.size in 2..3) 1 else 0
            for (p in o["progress"]!!.jsonArray) {
                val po = p.jsonObject
                val ids = po["ids"]!!.jsonArray.map { it.str!! }
                val got = SentenceRound.progress(exercises, ids)
                val want = po["progress"]!!.jsonObject
                assertEquals(SentenceRound.Progress(want["needed"]!!.jsonPrimitive.int, want["got"]!!.jsonPrimitive.int, want["done"]!!.jsonPrimitive.boolean), got, what)
                assertEquals(po["counter"]!!.str, SentenceRound.counter(got), what)
                assertEquals(po["intro"]!!.str, SentenceRound.intro(got, exercises.size), what)
                assertEquals(po["cheer"]!!.str, SentenceRound.cheer(got), what)
                assertEquals(po["skip"]!!.str, SentenceRound.skipNote(got), what)
            }
        }
        assertEquals(0, reused, "a sentence is in at most one exercise")
        assertTrue(small >= 7, "vectors with 2 and 3 sentences")
    }

    @Test
    fun opensMatch() {
        for (c in fixture()["opens"]!!.jsonArray) {
            val o = c.jsonObject
            val count = o["sentenceCount"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.int }
            assertEquals(o["opens"]!!.jsonPrimitive.boolean, SentenceRound.opens(o["enabled"]!!.jsonPrimitive.boolean, o["cardType"]!!.str!!, count), o.toString())
        }
    }

    @Test
    fun copyMatches() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["size"]!!.jsonPrimitive.int, SentenceRound.SIZE)
        assertEquals(c["title"]!!.str, SentenceRound.TITLE)
        assertEquals(c["skip"]!!.str, SentenceRound.SKIP)
        assertEquals(c["tryAgain"]!!.str, SentenceRound.TRY_AGAIN)
        assertEquals(c["seeAnswer"]!!.str, SentenceRound.SEE_ANSWER)
        assertEquals(c["showEnglish"]!!.str, SentenceRound.SHOW_ENGLISH)
        assertEquals(c["hideEnglish"]!!.str, SentenceRound.HIDE_ENGLISH)
        assertEquals(c["prompt"]!!.jsonObject.mapValues { it.value.str }, SentenceRound.PROMPT)
        assertEquals(c["result"]!!.jsonObject.mapValues { it.value.str }, SentenceRound.RESULT)
    }
}
