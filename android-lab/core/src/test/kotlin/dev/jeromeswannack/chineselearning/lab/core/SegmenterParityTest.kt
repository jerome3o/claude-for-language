package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * chinese/Segmenter.kt reproduces shared/chinese/segment.ts exactly (parity/fixtures/segment.ts):
 * the costs, the shipped dictionary (read from the same files as core resources), the segments
 * and their auto-pinyin over the corpus of shared/chinese/__fixtures__/corpus.txt + edge cases.
 */
class SegmenterParityTest {
    private val f: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "segment.json").readText()).jsonObject
    }

    private val dict by lazy { assertNotNull(Segmenter.shipped, "the shipped word lists load") }

    @Test
    fun costsMatch() {
        for (c in f["costs"]!!.jsonArray) {
            val (rank, cost) = c.jsonArray.map { it.jsonPrimitive.int }
            assertEquals(cost, Segmenter.rankCost(rank), "rankCost($rank)")
        }
    }

    @Test
    fun shippedDictionaryMatches() {
        val d = f["dictionary"]!!.jsonObject
        assertEquals(d["size"]!!.jsonPrimitive.int, dict.costs.size)
        assertEquals(d["maxLength"]!!.jsonPrimitive.int, dict.maxLength)
        val sample = d["sample"]!!.jsonArray
        assertTrue(sample.size > 600)
        for (e in sample) {
            val a = e.jsonArray
            val w = a[0].jsonPrimitive.content
            assertEquals(a[1].jsonPrimitive.int, dict.costs[w], "cost of $w")
        }
    }

    @Test
    fun segmentsAndPinyinMatchTypeScript() {
        val cases = f["cases"]!!.jsonArray
        assertTrue(cases.size > 400)
        for (c in cases) {
            val o = c.jsonObject
            val text = o["text"]!!.jsonPrimitive.content
            val expected = o["words"]!!.jsonArray.map { w -> w.jsonArray.let { it[0].jsonPrimitive.content to it[1].jsonPrimitive.content } }
            val actual = Segmenter.segment(text, dict, Segmenter.autoPinyin).map { it.text to it.pinyin }
            assertEquals(expected, actual, "segment($text)")
            assertEquals(text, actual.joinToString("") { it.first })
        }
    }

    @Test
    fun runsMatch() {
        val r = f["runs"]!!.jsonObject
        val expected = r["runs"]!!.jsonArray.map { e -> e.jsonArray.let { it[0].jsonPrimitive.content to it[1].jsonPrimitive.content } }
        val actual = Segmenter.textRuns(r["text"]!!.jsonPrimitive.content).map { it.first.name.lowercase() to it.second }
        assertEquals(expected, actual)
    }

    @Test
    fun fastEnough() {
        val texts = f["cases"]!!.jsonArray.map { it.jsonObject["text"]!!.jsonPrimitive.content }
        texts.forEach { Segmenter.texts(it, dict) } // warm up
        val t0 = System.nanoTime()
        repeat(5) { texts.forEach { Segmenter.texts(it, dict) } }
        val perText = (System.nanoTime() - t0) / 1e6 / (5 * texts.size)
        assertTrue(perText < 5.0, "≈$perText ms per text")
    }
}
