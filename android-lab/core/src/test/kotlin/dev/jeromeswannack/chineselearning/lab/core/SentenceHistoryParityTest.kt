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
        var listenPicked = 0
        var listenExercises = 0
        val wanted = HashMap<String, Int>()
        for (c in cases) {
            val o = c.jsonObject
            val what = o.toString().take(2000)
            val sentences = o["sentences"]!!.jsonArray.map { val x = it.jsonObject; SentenceRound.Sentence(x.s("key")!!, x.s("hanzi")!!, x.s("translation"), x["audio"]?.jsonPrimitive?.boolean ?: false) }
            val events = o["events"]!!.jsonArray.map {
                val x = it.jsonObject
                SentenceHistory.Event(x.s("id")!!, x.s("note_id")!!, x.s("sentence_key")!!, x.s("kind")!!, x.s("mode"), x.s("result"), x.s("reason"), x.s("at")!!)
            }
            val stats = SentenceHistory.stats(events, "n1")
            val want = o["stats"]!!.jsonObject.mapValues { (_, v) ->
                val x = v.jsonObject
                SentenceHistory.Stats(
                    mode(x["read"]!!.jsonObject), mode(x["translate"]!!.jsonObject),
                    x["hidden"]!!.let { h -> if (h is JsonNull) null else SentenceHistory.Hidden(h.jsonObject.s("at")!!, h.jsonObject.s("reason")) },
                    mode(x["listen"]!!.jsonObject),
                )
            }
            assertEquals(want, stats.toSortedMap(), what)
            if (stats.isNotEmpty()) withHistory++
            for (k in o["known"]!!.jsonArray) {
                val x = k.jsonObject
                assertEquals(x["read"]!!.jsonPrimitive.boolean, SentenceHistory.known(stats[x.s("key")], SentencePractise.READ), what)
                assertEquals(x["translate"]!!.jsonPrimitive.boolean, SentenceHistory.known(stats[x.s("key")], SentencePractise.TRANSLATE), what)
                assertEquals(x["listen"]!!.jsonPrimitive.boolean, SentenceHistory.known(stats[x.s("key")], SentenceHistory.LISTEN), what)
                for (a in x["all"]!!.jsonArray) {
                    val ao = a.jsonObject
                    assertEquals(
                        ao["known"]!!.jsonPrimitive.boolean,
                        SentenceHistory.knownInAllModes(stats[x.s("key")], ao["translation"]!!.jsonPrimitive.boolean, ao["byEar"]!!.jsonPrimitive.boolean),
                        "$what all $ao",
                    )
                }
            }
            for (k in o["compares"]!!.jsonArray) {
                val x = k.jsonObject
                val m = x.s("mode")!!
                assertEquals(x["c"]!!.jsonPrimitive.int, SentenceHistory.compareLeastKnown(stats[x.s("a")]?.mode(m), stats[x.s("b")]?.mode(m)).sign, what)
            }
            assertEquals(o["wantsMore"]!!.jsonPrimitive.boolean, SentenceHistory.wantsMore(sentences, stats), what)
            val more = SentenceHistory.moreWanted(sentences, stats)
            assertEquals(moreWanted(o["moreWanted"]!!), more, what)
            more?.let { wanted[it.reason] = (wanted[it.reason] ?: 0) + 1 }
            assertEquals(o["comingShown"]!!.jsonPrimitive.boolean, SentenceHistory.comingShown(more), what)
            assertEquals(o["freshCount"]!!.jsonPrimitive.int, SentenceHistory.freshCount(sentences, stats), what)
            for (f in o["fresh"]!!.jsonArray) {
                val x = f.jsonObject
                assertEquals(x["fresh"]!!.jsonPrimitive.boolean, SentenceHistory.isFresh(stats[x.s("key")]), "$what fresh ${x.s("key")}")
            }
            val expected = o["exercises"]!!.jsonArray.map {
                val e = it.jsonObject
                SentenceRound.Exercise(e.s("id")!!, e.s("key")!!, e.s("mode")!!, e["index"]!!.jsonPrimitive.int)
            }
            val picked = SentenceRound.pick(sentences, stats)
            assertEquals(expected, picked, what)
            // Sentences by ear: the same round with listen in the read slots where a sentence can be heard.
            for (b in o["byEar"]!!.jsonArray) {
                val bo = b.jsonObject
                val online = bo["online"]!!.jsonPrimitive.boolean
                val want = bo["exercises"]!!.jsonArray.map {
                    val e = it.jsonObject
                    SentenceRound.Exercise(e.s("id")!!, e.s("key")!!, e.s("mode")!!, e["index"]!!.jsonPrimitive.int)
                }
                val got = SentenceRound.pick(sentences, stats, byEar = true, online = online)
                assertEquals(want, got, "$what byEar online=$online")
                listenExercises += got.count { it.mode == SentenceHistory.LISTEN }
            }
            for (l in o["listen"]!!.jsonArray) {
                val lo = l.jsonObject
                val word = lo.s("word")!!
                val want = lo["exercises"]!!.jsonArray.map {
                    val e = it.jsonObject
                    SentenceRound.Exercise(e.s("id")!!, e.s("key")!!, e.s("mode")!!, e["index"]!!.jsonPrimitive.int)
                }
                assertEquals(want, SentenceRound.pickListen(sentences, word, stats), "$what listen $word")
                assertEquals(lo["count"]!!.jsonPrimitive.int, SentenceRound.listenSentenceCount(sentences, word, stats), "$what listen $word")
                if (want.isNotEmpty()) listenPicked++
            }
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
        assertTrue(listenPicked > 100, "listening rounds picked")
        assertTrue(listenExercises > 200, "listen exercises picked: $listenExercises")
        assertTrue((wanted["few"] ?: 0) > 20 && (wanted["fresh"] ?: 0) > 20, "both reasons covered: $wanted")
    }

    private fun moreWanted(e: JsonElement): SentenceHistory.MoreWanted? =
        if (e is JsonNull) null else e.jsonObject.let { SentenceHistory.MoreWanted(it.s("reason")!!, it["fresh"]!!.jsonPrimitive.int, it["count"]!!.jsonPrimitive.int) }

    @Test
    fun freshBufferNumbersMatch() {
        val f = fixture()
        for (v in f["topUpCounts"]!!.jsonArray) {
            val o = v.jsonObject
            assertEquals(o["count"]!!.jsonPrimitive.int, SentenceHistory.freshTopUpCount(o["fresh"]!!.jsonPrimitive.int), o.toString())
        }
        for (v in f["comingShown"]!!.jsonArray) {
            val o = v.jsonObject
            val want = o["want"]!!.let { w -> if (w is JsonNull) null else SentenceHistory.MoreWanted(w.jsonObject.s("reason")!!, w.jsonObject["fresh"]!!.jsonPrimitive.int, 0) }
            assertEquals(o["shown"]!!.jsonPrimitive.boolean, SentenceHistory.comingShown(want), o.toString())
        }
        val c = f["copy"]!!.jsonObject
        assertEquals(c["freshBuffer"]!!.jsonPrimitive.int, SentenceHistory.FRESH_BUFFER)
        assertEquals(c["freshLow"]!!.jsonPrimitive.int, SentenceHistory.FRESH_LOW)
        assertEquals(c["topUpMin"]!!.jsonPrimitive.int, SentenceHistory.TOPUP_MIN)
        assertEquals(c["topUpMax"]!!.jsonPrimitive.int, SentenceHistory.TOPUP_MAX)
        assertEquals(c["topUpRetryMs"]!!.jsonPrimitive.int.toLong(), SentenceHistory.TOPUP_RETRY_MS)
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
