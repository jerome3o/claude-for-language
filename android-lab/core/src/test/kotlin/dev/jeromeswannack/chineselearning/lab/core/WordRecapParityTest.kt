package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Reader word recap reproduces shared/study/wordRecap.ts (parity/fixtures/word-recap.ts). */
class WordRecapParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "word-recap.json").readText()).jsonObject
    }

    private fun JsonObject.s(k: String) = this[k]!!.jsonPrimitive.content
    private fun JsonObject.sOrNull(k: String) = this[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
    private fun JsonObject.strings(k: String) = this[k]!!.jsonArray.map { it.jsonPrimitive.content }

    private fun page(o: JsonObject) = WordRecap.Page(
        index = o["index"]!!.jsonPrimitive.int,
        text = o.s("text"),
        english = o.s("english"),
        words = o["words"]?.takeIf { it !is JsonNull }?.jsonArray?.map { w -> w.jsonObject.let { WordRecap.Word(it.s("text"), it.s("pinyin"), it.s("gloss")) } },
    )

    private fun assertRun(want: JsonObject, got: WordRecapRun, where: String) {
        assertEquals(want.s("reader_id"), got.reader_id, where)
        assertEquals(want.sOrNull("finished_at"), got.finished_at, "$where finished_at")
        assertEquals(want.sOrNull("recapped_at"), got.recapped_at, "$where recapped_at")
        assertEquals(want.strings("keep"), got.keep, "$where keep")
        val words = want["words"]!!.jsonArray.map { it.jsonObject }
        assertEquals(words.map { it.s("hanzi") }, got.words.map { it.hanzi }, "$where words")
        for ((i, w) in words.withIndex()) {
            val g = got.words[i]
            val at = "$where word ${g.hanzi}"
            assertEquals(w.s("pinyin"), g.pinyin, at)
            assertEquals(w.s("gloss"), g.gloss, at)
            assertEquals(w.s("sentence"), g.sentence, at)
            assertEquals(w.s("page_english"), g.page_english, at)
            assertEquals(w["page"]!!.jsonPrimitive.int, g.page, at)
            assertEquals(w["pos"]!!.jsonPrimitive.int, g.pos, at)
            assertEquals(w.strings("reasons"), g.reasons, at)
            assertEquals(w.strings("said"), g.said, at)
            assertEquals(w.s("at"), g.at, at)
        }
        assertEquals(want["events"]!!.jsonArray.map { it.jsonObject.let { e -> e.s("item_id") to e.s("result") } }, got.events.map { it.item_id to it.result }, "$where events")
    }

    @Test
    fun keys() {
        for (k in fixture["keys"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(k.s("key"), WordRecap.key(k.s("text")), k.s("text"))
            assertEquals(k["word"]!!.jsonPrimitive.boolean, WordRecap.isWord(k.s("text")), k.s("text"))
        }
    }

    @Test
    fun mistakes() {
        for (c in fixture["mistakes"]!!.jsonArray.map { it.jsonObject }) {
            val words = c["words"]?.takeIf { it !is JsonNull }?.jsonArray?.map { it.jsonPrimitive.content }
            val got = WordRecap.mistakes(ReadAloud.judge(c.s("page"), c.s("transcript")), words)
            val want = c["out"]!!.jsonArray.map { it.jsonObject }
            val where = "${c.s("page")} / ${c.s("transcript")}"
            assertEquals(want.map { it.s("text") }, got.map { it.text }, where)
            assertEquals(want.map { it.s("pinyin") }, got.map { it.pinyin }, where)
            assertEquals(want.map { it["pos"]!!.jsonPrimitive.int }, got.map { it.pos }, where)
            assertEquals(want.map { it.strings("said") }, got.map { it.said }, where)
        }
    }

    @Test
    fun scriptsStepByStep() {
        val owned = setOf("采耳", "银行")
        var steps = 0
        for ((si, script) in fixture["scripts"]!!.jsonArray.map { it.jsonObject }.withIndex()) {
            var run = WordRecap.emptyRun("r-cd", "2026-11-03T08:00:00Z")
            val ops = script["ops"]!!.jsonArray.map { it.jsonObject }
            val want = script["steps"]!!.jsonArray.map { it.jsonObject }
            for ((i, o) in ops.withIndex()) {
                run = when (o.s("op")) {
                    "tap" -> {
                        val t = o["tap"]!!.jsonObject
                        WordRecap.addTap(run, WordRecap.Tap(t.s("text"), t.s("pinyin"), t.s("gloss"), t.s("sentence"), t["page"]!!.jsonPrimitive.int, t["pos"]!!.jsonPrimitive.int, t.s("page_english")), o.s("now"))
                    }
                    "take" -> {
                        val p = page(o["page"]!!.jsonObject)
                        WordRecap.addMistakes(run, p, ReadAloud.judge(p.text, o.s("transcript")), o.s("now"))
                    }
                    "answer" -> WordRecap.answer(run, o.s("key"), o["right"]!!.jsonPrimitive.boolean, o.s("now"), o.s("id"))
                    "keep" -> WordRecap.setKeep(run, o.s("key"), o["on"]!!.jsonPrimitive.boolean)
                    "finish" -> WordRecap.finish(run, o.s("now"))
                    "recapped" -> WordRecap.markRecapped(run, o.s("now"))
                    "restart" -> WordRecap.restart(run)
                    else -> fail("unknown op")
                }
                val w = want[i]
                val where = "script $si step $i (${o.s("op")})"
                assertRun(w["run"]!!.jsonObject, run, where)
                assertEquals(w["available"]!!.jsonPrimitive.boolean, WordRecap.available(run), where)
                val p = w["progress"]!!.jsonObject
                val gp = WordRecap.progress(run)
                assertEquals(p.strings("remaining"), gp.remaining, "$where remaining")
                assertEquals(p["done"]!!.jsonPrimitive.int, gp.done, where)
                assertEquals(p["complete"]!!.jsonPrimitive.boolean, gp.complete, where)
                val b = w["bar"]!!.jsonObject
                val gb = WordRecap.bar(run)
                assertEquals(b["answered"]!!.jsonPrimitive.int, gb.answered, where)
                assertEquals(b["retries"]!!.jsonPrimitive.int, gb.retries, where)
                assertEquals(b["doneFraction"]!!.jsonPrimitive.double, gb.doneFraction, where)
                assertEquals(b["onRetries"]!!.jsonPrimitive.boolean, gb.onRetries, where)
                assertEquals(w["rightFirstTime"]!!.jsonPrimitive.int, WordRecap.rightFirstTime(run), where)
                val c = WordRecap.choices(run) { it in owned }
                assertEquals(w.strings("add"), c.add.map { it.hanzi }, "$where add")
                assertEquals(w.strings("bump"), c.bump.map { it.hanzi }, "$where bump")
                assertEquals(w.s("promptLine"), WordRecap.promptLine(run), where)
                assertEquals(w["why"]!!.jsonArray.map { a -> a.jsonArray.map { it.jsonPrimitive.content } }, run.words.map(WordRecap::whyLines), "$where why")
                assertEquals(w.strings("clues"), run.words.map(WordRecap::sentenceClue), "$where clues")
                steps++
            }
        }
        assertTrue(steps > 15)
    }

    @Test
    fun runFor() {
        for (c in fixture["runFor"]!!.jsonArray.map { it.jsonObject }) {
            val existing = c["existing"]?.takeIf { it !is JsonNull }?.jsonObject?.let { e ->
                WordRecapRun(reader_id = e.s("reader_id"), started_at = e.s("started_at"), finished_at = e.sOrNull("finished_at"))
            }
            val got = WordRecap.runFor(existing, c.s("reader"), c.s("openedAt"), "NOW")
            val out = c["out"]!!.jsonObject
            assertEquals(out.s("reader_id"), got.reader_id)
            assertEquals(out.s("started_at"), got.started_at)
            assertEquals(out.sOrNull("finished_at"), got.finished_at)
        }
    }

    @Test
    fun cluesAndLabels() {
        for (c in fixture["sentenceClues"]!!.jsonArray.map { it.jsonObject }) {
            assertEquals(c.s("out"), WordRecap.sentenceClue(WordRecapWord(hanzi = "采耳", sentence = c.s("sentence"))), c.s("sentence"))
        }
        val labels = fixture["labels"]!!.jsonObject
        for (p in labels["prompt"]!!.jsonArray.map { it.jsonArray }) assertEquals(p[1].jsonPrimitive.content, WordRecap.promptLabel(p[0].jsonPrimitive.int))
        assertEquals(labels.strings("keep"), listOf(WordRecap.keepLabel(false), WordRecap.keepLabel(true)))
        for (d in labels["done"]!!.jsonArray.map { it.jsonArray }) assertEquals(d[2].jsonPrimitive.content, WordRecap.doneLine(d[0].jsonPrimitive.int, d[1].jsonPrimitive.int))
        assertTrue((labels["done"] as JsonArray).size == 5)
    }
}
