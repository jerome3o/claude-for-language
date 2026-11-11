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
            }
        }
        assertEquals(0, reused, "a sentence is in at most one exercise")
        assertTrue(small >= 7, "vectors with 2 and 3 sentences")
    }

    @Test
    fun answerSideMatches() {
        val f = fixture()
        for (c in f["parts"]!!.jsonArray) {
            val o = c.jsonObject
            val want = o["parts"]!!.let { if (it is JsonNull) null else it.jsonObject["mode"]!!.str!! to it.jsonObject["key"]!!.str!! }
            assertEquals(want, SentenceRound.exerciseParts(o["id"]!!.str!!), o.toString())
        }
        val cases = f["answerSide"]!!.jsonArray
        assertTrue(cases.size >= 100)
        for (c in cases) {
            val o = c.jsonObject
            val what = o.toString()
            val log = o["log"]!!.jsonArray.map { val e = it.jsonObject; SentenceRound.LogEntry(e["id"]!!.str!!, e["result"]?.str) }
            val right = o["right"]!!.jsonArray.map { it.str!! }
            val marks = SentenceRound.rowMarks(log, right)
            val want = o["marks"]!!.jsonArray.map { val m = it.jsonObject; SentenceRound.RowMark(m["key"]!!.str!!, m["mode"]!!.str!!, m["outcome"]!!.str!!, m["label"]!!.str!!) }
            assertEquals(want, marks, what)
            val keys = o["keys"]!!.jsonArray.map { it.str!! }
            assertEquals(o["order"]!!.jsonArray.map { it.str!! }, SentenceRound.orderKeys(keys, marks), what)
            val hiddenKey = o["hiddenKey"]!!.str
            val fromLog = SentenceRound.exercisesFromLog(keys.map { SentenceRound.Sentence(it, "${it}好", "x") }, log.map { it.id }) { it == hiddenKey }
            val wantFrom = o["fromLog"]!!.let { el ->
                if (el is JsonNull) null else el.jsonArray.map {
                    val e = it.jsonObject
                    SentenceRound.Exercise(e["id"]!!.str!!, e["key"]!!.str!!, e["mode"]!!.str!!, e["index"]!!.jsonPrimitive.int)
                }
            }
            assertEquals(wantFrom, fromLog, what)
        }
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
    fun englishShownMatches() {
        val cases = fixture()["english"]!!.jsonArray
        assertEquals(72, cases.size)
        for (c in cases) {
            val o = c.jsonObject
            val toggled = o["toggled"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.boolean }
            assertEquals(
                o["shown"]!!.jsonPrimitive.boolean,
                SentenceRound.englishShown(o["mode"]!!.str!!, o["status"]!!.str, o["answered"]!!.jsonPrimitive.boolean, toggled),
                o.toString(),
            )
        }
    }

    @Test
    fun copyMatches() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["size"]!!.jsonPrimitive.int, SentenceRound.SIZE)
        assertEquals(c["title"]!!.str, SentenceRound.TITLE)
        assertEquals(c["skip"]!!.str, SentenceRound.SKIP)
        assertEquals(c["skipConfirm"]!!.str, SentenceRound.SKIP_CONFIRM)
        assertEquals(c["skipConfirmYes"]!!.str, SentenceRound.SKIP_CONFIRM_YES)
        assertEquals(c["skipConfirmNo"]!!.str, SentenceRound.SKIP_CONFIRM_NO)
        assertEquals(c["tryAgain"]!!.str, SentenceRound.TRY_AGAIN)
        assertEquals(c["seeAnswer"]!!.str, SentenceRound.SEE_ANSWER)
        assertEquals(c["showEnglish"]!!.str, SentenceRound.SHOW_ENGLISH)
        assertEquals(c["hideEnglish"]!!.str, SentenceRound.HIDE_ENGLISH)
        assertEquals(c["prompt"]!!.jsonObject.mapValues { it.value.str }, SentenceRound.PROMPT)
        assertEquals(c["result"]!!.jsonObject.mapValues { it.value.str }, SentenceRound.RESULT)
        assertEquals(c["englishChip"]!!.str, SentenceRound.ENGLISH_CHIP)
        assertEquals(c["translationOffline"]!!.str, SentenceRound.TRANSLATION_OFFLINE)
        assertEquals(c["translating"]!!.str, SentenceRound.TRANSLATING)
        assertEquals(c["translationFailed"]!!.str, SentenceRound.TRANSLATION_FAILED)
        assertEquals(c["listenSize"]!!.jsonPrimitive.int, SentenceRound.LISTEN_SIZE)
        assertEquals(c["listenLead"]!!.str, SentenceRound.LISTEN_LEAD)
        assertEquals(c["listenSelfCheck"]!!.str, SentenceRound.LISTEN_SELF_CHECK_NOTE)
        assertEquals(c["listenShowChinese"]!!.str, SentenceRound.LISTEN_SHOW_CHINESE)
        assertEquals(c["listenSelfRight"]!!.str, SentenceRound.LISTEN_SELF_RIGHT)
        assertEquals(c["listenSelfWrong"]!!.str, SentenceRound.LISTEN_SELF_WRONG)
        for (i in c["listenIntros"]!!.jsonArray) {
            val o = i.jsonObject
            val got = o["got"]!!.jsonPrimitive.int
            val needed = o["needed"]!!.jsonPrimitive.int
            assertEquals(o["intro"]!!.str, SentenceRound.listenIntro(SentenceRound.Progress(needed, got, got >= needed), o["n"]!!.jsonPrimitive.int), o.toString())
        }
        for (k in c["cardKeys"]!!.jsonArray) assertEquals(k.jsonObject["card"]!!.jsonPrimitive.boolean, SentenceRound.isCardSentenceKey(k.jsonObject["key"]!!.str!!), k.toString())
    }

    private fun exercise(e: JsonElement): SentenceRound.Exercise {
        val o = e.jsonObject
        return SentenceRound.Exercise(o["id"]!!.str!!, o["key"]!!.str!!, o["mode"]!!.str!!, o["index"]!!.jsonPrimitive.int)
    }

    @Test
    fun sentencesByEarMatches() {
        val l = fixture()["listen"]!!.jsonObject
        for (c in l["canListen"]!!.jsonArray) {
            val o = c.jsonObject
            val s = SentenceRound.Sentence("k", "好", o["translation"]!!.str, o["audio"]!!.jsonPrimitive.boolean)
            assertEquals(o["can"]!!.jsonPrimitive.boolean, SentenceRound.canListen(s, o["byEar"]!!.jsonPrimitive.boolean, o["online"]!!.jsonPrimitive.boolean), o.toString())
        }
        val exercises = l["asRead"]!!.jsonArray.map { exercise(it.jsonObject["ex"]!!) }
        for (c in l["asRead"]!!.jsonArray) assertEquals(exercise(c.jsonObject["read"]!!), SentenceRound.asRead(exercise(c.jsonObject["ex"]!!)), c.toString())
        for (c in l["active"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["id"]!!.str, SentenceRound.listenActiveId(exercises, o["answered"]!!.jsonArray.map { it.str!! }, o["chosen"]!!.str), o.toString())
        }
        for (c in l["checkBy"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["by"]!!.str, SentenceRound.listenCheckBy(o["online"]!!.jsonPrimitive.boolean, o["translation"]!!.str), o.toString())
        }
        val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
        for (c in l["inputs"]!!.jsonArray) {
            val o = c.jsonObject
            val row = o["row"]!!.jsonObject
            val want = json.decodeFromJsonElement(AnswerCheckInput.serializer(), o["check"]!!)
            assertEquals(want, SentenceRound.listenCheckInput(row["hanzi"]!!.str!!, row["pinyin"]!!.str, row["translation"]!!.str, o["said"]!!.str!!, o["input"]!!.str!!), o.toString())
        }
        for (c in l["verdicts"]!!.jsonArray) assertEquals(c.jsonObject["result"]!!.str, SentenceRound.listenVerdictResult(c.jsonObject["verdict"]!!.str!!))
        for (c in l["self"]!!.jsonArray) assertEquals(c.jsonObject["result"]!!.str, SentenceRound.listenSelfResult(c.jsonObject["gotIt"]!!.jsonPrimitive.boolean))
        for (c in l["byEar"]!!.jsonArray) assertEquals(c.jsonObject["on"]!!.jsonPrimitive.boolean, SentenceRound.parseByEar(c.jsonObject["raw"]!!.str), c.toString())
        val copy = l["copy"]!!.jsonObject
        assertEquals(copy["title"]!!.str, SentenceRound.BY_EAR_TITLE)
        assertEquals(copy["hint"]!!.str, SentenceRound.BY_EAR_HINT)
        assertEquals(copy["slowRate"]!!.jsonPrimitive.content.toDouble(), SentenceRound.LISTEN_SLOW_RATE)
        assertEquals(copy["placeholder"]!!.str, SentenceRound.LISTEN_EX_PLACEHOLDER)
        assertEquals(copy["listening"]!!.str, SentenceRound.LISTEN_EX_LISTENING)
        assertEquals(copy["checking"]!!.str, SentenceRound.LISTEN_EX_CHECKING)
        assertEquals(copy["play"]!!.str, SentenceRound.LISTEN_EX_PLAY)
        assertEquals(copy["slow"]!!.str, SentenceRound.LISTEN_EX_SLOW)
        assertEquals(copy["showAnswer"]!!.str, SentenceRound.LISTEN_EX_SHOW_ANSWER)
        assertEquals(copy["submit"]!!.str, SentenceRound.LISTEN_EX_SUBMIT)
        assertEquals(copy["selfQuestion"]!!.str, SentenceRound.LISTEN_EX_SELF_QUESTION)
        assertEquals(copy["gotIt"]!!.str, SentenceRound.LISTEN_EX_GOT_IT)
        assertEquals(copy["missedIt"]!!.str, SentenceRound.LISTEN_EX_MISSED_IT)
        assertEquals(copy["youSaid"]!!.str, SentenceRound.LISTEN_EX_YOU_SAID)
        assertEquals(copy["noAudio"]!!.str, SentenceRound.LISTEN_EX_NO_AUDIO)
    }

    @Test
    fun cardOwnSentenceMatches() {
        val c = fixture()["cardHanzi"]!!.jsonObject
        var same = 0
        for (x in c["sameText"]!!.jsonArray) {
            val o = x.jsonObject
            val want = o["same"]!!.jsonPrimitive.boolean
            assertEquals(want, SentenceRound.isCardHanziSentence(o["hanzi"]!!.str!!, o["card"]!!.str), o.toString())
            if (want) same++
        }
        assertTrue(same > 10, "vectors where the sentence is the card")
        var dropped = 0
        for (x in c["lists"]!!.jsonArray) {
            val o = x.jsonObject
            val what = o.toString()
            val card = o["card"]!!.str!!
            val sentences = o["sentences"]!!.jsonArray.map { sentence(it)!! }
            assertEquals(o["exercises"]!!.jsonArray.map { exercise(it) }, SentenceRound.pick(sentences, cardHanzi = card), what)
            val count = o["count"]!!.jsonPrimitive.int
            assertEquals(count, SentenceRound.roundSentenceCount(sentences, null, card), what)
            assertEquals(o["listen"]!!.jsonArray.map { exercise(it) }, SentenceRound.pickListen(sentences, card), what)
            assertEquals(o["listenCount"]!!.jsonPrimitive.int, SentenceRound.listenSentenceCount(sentences, card), what)
            if (count < sentences.size) dropped++
        }
        assertTrue(dropped >= 5, "vectors that drop the card's own sentence")
    }
}
