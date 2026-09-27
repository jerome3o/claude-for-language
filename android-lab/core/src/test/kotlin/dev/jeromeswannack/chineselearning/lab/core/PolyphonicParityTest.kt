package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package K: Pinyin.readings must equal pinyin-pro's `polyphonic(char)[0]` (parity/fixtures/polyphonic.ts). */
class PolyphonicParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "polyphonic.json").readText()).jsonObject
    }

    @Test
    fun everyCharacterMatches() {
        val readings = fixture["readings"]!!.jsonObject
        assertTrue(readings.size > 20_000)
        var multi = 0
        for ((ch, v) in readings) {
            val want = v.jsonPrimitive.content.split(' ').filter { it.isNotEmpty() }
            assertEquals(want, Pinyin.readings(ch), "polyphonic($ch)")
            if (want.size > 1) multi++
        }
        assertTrue(multi > 500, "expected many polyphones, got $multi")
        val echo = fixture["echo"]!!.jsonPrimitive.content
        for (ch in echo.map { it.toString() }) assertEquals(listOf(ch).filter { it.isNotBlank() }, Pinyin.readings(ch), "echo($ch)")
        assertEquals(listOf("zhōng", "zhòng"), Pinyin.readings("中"))
    }
}
