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
import kotlin.math.sign
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Practice per example sentence reproduces shared/study/sentenceHistory.ts (+ the round's picks with it). */
class SentenceHistoryParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "sentence-history.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private fun JsonObject.s(k: String) = this[k]?.str

    private fun mode(o: JsonObject) = SentenceHistory.ModeStats(o["attempts"]!!.jsonPrimitive.int, o["rights"]!!.jsonPrimitive.int, o["misses"]!!.jsonPrimitive.int, o.s("last_at"))

    @Test
    fun casesMatch() {
        val cases = fixture()["cases"]!!.jsonArray
        assertTrue(cases.size >= 100)
        var withHistory = 0
        for (c in cases) {
            val o = c.jsonObject
            val what = o.toString().take(2000)
            val sentences = o["sentences"]!!.jsonArray.map { val x = it.jsonObject; SentenceRound.Sentence(x.s("key")!!, x.s("hanzi")!!, x.s("translation")) }
            val events = o["events"]!!.jsonArray.map {
                val x = it.jsonObject
                SentenceHistory.Event(x.s("id")!!, x.s("note_id")!!, x.s("sentence_key")!!, x.s("kind")!!, x.s("mode"), x.s("result"), x.s("reason"), x.s("at")!!)
            }
            val stats = SentenceHistory.stats(events, "n1")
            val want = o["stats"]!!.jsonObject.mapValues { (_, v) ->
                val x = v.jsonObject
                SentenceHistory.Stats(mode(x["read"]!!.jsonObject), mode(x["translate"]!!.jsonObject), x["hidden"]!!.let { h -> if (h is JsonNull) null else SentenceHistory.Hidden(h.jsonObject.s("at")!!, h.jsonObject.s("reason")) })
            }
            assertEquals(want, stats.toSortedMap(), what)
            if (stats.isNotEmpty()) withHistory++
            for (k in o["known"]!!.jsonArray) {
                val x = k.jsonObject
                assertEquals(x["read"]!!.jsonPrimitive.boolean, SentenceHistory.known(stats[x.s("key")], SentencePractise.READ), what)
                assertEquals(x["translate"]!!.jsonPrimitive.boolean, SentenceHistory.known(stats[x.s("key")], SentencePractise.TRANSLATE), what)
            }
            for (k in o["compares"]!!.jsonArray) {
                val x = k.jsonObject
                val m = x.s("mode")!!
                assertEquals(x["c"]!!.jsonPrimitive.int, SentenceHistory.compareLeastKnown(stats[x.s("a")]?.mode(m), stats[x.s("b")]?.mode(m)).sign, what)
            }
            assertEquals(o["wantsMore"]!!.jsonPrimitive.boolean, SentenceHistory.wantsMore(sentences, stats), what)
            val expected = o["exercises"]!!.jsonArray.map {
                val e = it.jsonObject
                SentenceRound.Exercise(e.s("id")!!, e.s("key")!!, e.s("mode")!!, e["index"]!!.jsonPrimitive.int)
            }
            val picked = SentenceRound.pick(sentences, stats)
            assertEquals(expected, picked, what)
            for (p in o["progress"]!!.jsonArray) {
                val po = p.jsonObject
                val w = po["progress"]!!.jsonObject
                assertEquals(
                    SentenceRound.Progress(w["needed"]!!.jsonPrimitive.int, w["got"]!!.jsonPrimitive.int, w["done"]!!.jsonPrimitive.boolean),
                    SentenceRound.progress(picked, po["ids"]!!.jsonArray.map { it.str!! }, sentences.map { it.key }),
                    what,
                )
            }
        }
        assertTrue(withHistory > 50)
    }

    @Test
    fun spreadsKeysAndCopyMatch() {
        val f = fixture()
        for (s in f["spreads"]!!.jsonArray) {
            val o = s.jsonObject
            assertEquals(o["order"]!!.jsonArray.map { it.jsonPrimitive.int }, SentenceRound.spreadOrder(o["n"]!!.jsonPrimitive.int))
        }
        for (k in f["keys"]!!.jsonArray) assertEquals(k.jsonObject.s("key"), SentenceHistory.key(k.jsonObject.s("row")!!))
        val c = f["copy"]!!.jsonObject
        assertEquals(c.s("clueKey"), SentenceHistory.CLUE_KEY)
        assertEquals(c["knownRights"]!!.jsonPrimitive.int, SentenceHistory.KNOWN_RIGHTS)
        assertEquals(c["minVisible"]!!.jsonPrimitive.int, SentenceHistory.MIN_VISIBLE)
        assertEquals(c["reasons"]!!.jsonArray.map { it.str }, SentenceHistory.HIDE_REASONS)
        assertEquals(c["reasonLabels"]!!.jsonObject.mapValues { it.value.str }, SentenceHistory.HIDE_REASON_LABEL)
        assertEquals(c.s("coming"), SentenceHistory.COMING_NOTE)
        assertEquals(c.s("hideTitle"), SentenceHistory.HIDE_TITLE)
        assertEquals(c.s("hideHint"), SentenceHistory.HIDE_HINT)
        assertEquals(c.s("hiddenToast"), SentenceHistory.HIDDEN_TOAST)
        assertEquals(c.s("showAgain"), SentenceHistory.SHOW_AGAIN)
        assertEquals(c["showHidden"]!!.jsonArray.map { it.str }, listOf(0, 1, 7).map(SentenceHistory::showHiddenLabel))
    }
}
