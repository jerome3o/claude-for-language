package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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

/**
 * Pinyin.kt must return exactly what pinyin-pro returns in the web editors. The corpus
 * comes from android-lab/parity/fixtures/pinyin.ts, which runs the real library.
 */
class PinyinParityTest {
    private fun fixture(name: String): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, name).readText()).jsonObject
    }

    private fun show(s: String) = s.map { c -> if (c.code in 0x20..0x7e || c.code in 0x3000..0x9fff) "$c" else "\\u%04x".format(c.code) }.joinToString("")

    @Test
    fun everyCaseMatchesPinyinPro() {
        val root = fixture("pinyin.json")
        val cases = root["cases"]!!.jsonArray
        val mismatches = mutableListOf<String>()
        var toneless = 0
        for (el in cases) {
            val row = el.jsonArray
            val input = row[0].jsonPrimitive.content
            val expected = row[1].jsonPrimitive.content
            val actual = Pinyin.toPinyin(input)
            if (actual != expected) mismatches += "symbol  ${show(input)}\n  expected ${show(expected)}\n  actual   ${show(actual)}"
            if (row[2] !is JsonNull) {
                toneless++
                val exp = row[2].jsonPrimitive.content
                val act = Pinyin.toPinyinToneless(input)
                if (act != exp) mismatches += "none    ${show(input)}\n  expected ${show(exp)}\n  actual   ${show(act)}"
            }
        }
        assertTrue(cases.size > 10_000, "corpus too small: ${cases.size}")
        assertTrue(root["repo_strings"]!!.jsonPrimitive.int > 100, "repo corpus missing")
        println("Pinyin parity: ${cases.size} cases (+$toneless toneless), ${mismatches.size} mismatches")
        if (mismatches.isNotEmpty()) {
            fail("${mismatches.size} pinyin mismatches, first ${minOf(20, mismatches.size)}:\n" + mismatches.take(20).joinToString("\n"))
        }
    }

    @Test
    fun knownOutputs() {
        val expected = mapOf(
            "" to "",
            "你好" to "nǐ hǎo",
            "一个" to "yí gè",
            "一天" to "yì tiān",
            "第一" to "dì yī",
            "十一" to "shí yī",
            "不对" to "bú duì",
            "说一说" to "shuō yi shuō",
            "看不看" to "kàn bu kàn",
            "了解" to "liǎo jiě",
            "好了" to "hǎo le",
            "人々" to "rén rén",
            "重庆" to "chóng qìng",
            "银行" to "yín háng",
            "Hello 世界!" to "H e l l o   shì jiè !",
            "你好吗？我很好。" to "nǐ hǎo ma ？ wǒ hěn hǎo 。",
            "😀一" to "😀 yī",
        )
        for ((input, out) in expected) assertEquals(out, Pinyin.toPinyin(input), input)
        assertEquals("yi ge", Pinyin.toPinyinToneless("一个"))
    }

    @Test
    fun fastAfterLoad() {
        Pinyin.preload()
        println("Pinyin: dictionary loaded in %.1f ms".format(Pinyin.loadMillis))
        val sentence = "我们明天一起去北京看长城，你觉得怎么样？不去的话就说一说为什么。"
        repeat(2000) { Pinyin.toPinyin(sentence) } // warm up the JIT
        val n = 5000
        val t0 = System.nanoTime()
        repeat(n) { Pinyin.toPinyin(sentence) }
        val perCallUs = (System.nanoTime() - t0) / 1000.0 / n
        println("Pinyin: %.1f µs per %d-char sentence".format(perCallUs, sentence.length))
        assertTrue(perCallUs < 1000.0, "toPinyin too slow: $perCallUs µs")
    }
}
