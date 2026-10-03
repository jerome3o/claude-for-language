package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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
 * The 一 / 不 tone changes must come out exactly as shared/pinyin/toneChange.ts writes them —
 * the test table, edge cases, pinyin-pro's own output and `autoPinyin`
 * (parity/fixtures/tone-change.ts → tone-change.json).
 */
class ToneChangeParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "tone-change.json").readText()).jsonObject
    }

    @Test
    fun applyMatchesTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 1000)
        var changed = 0
        for (c in cases) {
            val hanzi = c["hanzi"]!!.jsonPrimitive.content
            val pinyin = c["pinyin"]!!.jsonPrimitive.content
            val want = c["out"]!!.jsonPrimitive.content
            if (want != pinyin) changed++
            assertEquals(want, ToneChange.applyYiBuToneChanges(hanzi, pinyin), "$hanzi / $pinyin")
        }
        assertTrue(changed >= 200, "only $changed cases change anything")
    }

    @Test
    fun autoPinyinMatchesTypeScript() {
        val auto = fixture["auto"]!!.jsonArray.map { it.jsonObject }
        assertTrue(auto.size >= 300)
        for (a in auto) {
            val text = a["text"]!!.jsonPrimitive.content
            assertEquals(a["raw"]!!.jsonPrimitive.content, Pinyin.toPinyin(text), "pinyin-pro $text")
            assertEquals(a["out"]!!.jsonPrimitive.content, ToneChange.autoPinyin(text), "autoPinyin $text")
        }
    }

    @Test
    fun syllableToneMatchesTypeScript() {
        for (t in fixture["tones"]!!.jsonArray.map { it.jsonObject }) {
            val s = t["s"]!!.jsonPrimitive.content
            assertEquals(t["tone"]!!.jsonPrimitive.int, ToneChange.syllableTone(s), s)
        }
    }

    @Test
    fun readsLikeTheWebTests() {
        assertEquals("yí gè", ToneChange.applyYiBuToneChanges("一个", "yī gè"))
        assertEquals("kàn yi kàn", ToneChange.applyYiBuToneChanges("看一看", "kàn yī kàn"))
        assertEquals("Bú shì wǒ.", ToneChange.applyYiBuToneChanges("不是我。", "Bù shì wǒ."))
        assertEquals("yìdiǎnr", ToneChange.applyYiBuToneChanges("一点儿", "yīdiǎnr"))
        assertEquals("", ToneChange.autoPinyin(""))
    }
}
