package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Package J: the text board's tab-complete rules reproduce shared/calls/gloss.ts exactly (parity/fixtures/calls-gloss.ts). */
class CallsGlossParityTest {
    private val root: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "calls-gloss.json").readText()).jsonObject
    }

    @Test
    fun constants() {
        assertEquals(root["debounce"]!!.jsonPrimitive.long, CallGloss.DEBOUNCE_MS)
        assertEquals(root["maxSegment"]!!.jsonPrimitive.int, CallGloss.MAX_SEGMENT)
    }

    @Test
    fun whenToSuggest() {
        val cases = root["checks"]!!.jsonArray
        assertTrue(cases.size > 1000)
        var ok = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val text = o["text"]!!.jsonPrimitive.content
            val got = CallGloss.findSegment(text, o["start"]!!.jsonPrimitive.int, o["end"]!!.jsonPrimitive.int, o["composing"]!!.jsonPrimitive.boolean)
            val want = o["result"]!!.jsonObject
            val expected = if (want["ok"]!!.jsonPrimitive.boolean) {
                ok++
                CallGloss.Check.Ok(want["segment"]!!.jsonPrimitive.content, want["start"]!!.jsonPrimitive.int, want["end"]!!.jsonPrimitive.int)
            } else CallGloss.Check.Skip(want["reason"]!!.jsonPrimitive.content)
            assertEquals(expected, got, "case $i: ${Json.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), c)}")
        }
        assertTrue(ok > 100, "enough positive cases ($ok)")
    }

    @Test
    fun formatting() {
        for (c in root["formats"]!!.jsonArray) {
            val o = c.jsonObject
            val p = o["pinyin"]!!.jsonPrimitive.content
            val e = o["english"]!!.jsonPrimitive.content
            assertEquals(o["format"]!!.jsonPrimitive.content, CallGloss.format(p, e))
            assertEquals(o["chip"]!!.jsonPrimitive.content, CallGloss.chipLabel(p, e))
            assertEquals(o["oneLine"]!!.jsonPrimitive.content, CallGloss.oneLine(e))
            assertTrue('\n' !in CallGloss.format(p, e) && '\r' !in CallGloss.format(p, e))
        }
        for (c in root["keys"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["key"]!!.jsonPrimitive.content, CallGloss.cacheKey(o["s"]!!.jsonPrimitive.content))
        }
    }
}
