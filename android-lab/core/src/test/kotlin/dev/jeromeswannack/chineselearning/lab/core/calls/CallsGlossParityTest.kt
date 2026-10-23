package dev.jeromeswannack.chineselearning.lab.core.calls

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
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
        assertEquals(root["maxEnWords"]!!.jsonPrimitive.int, CallGloss.MAX_EN_WORDS)
        assertEquals(root["maxEnChars"]!!.jsonPrimitive.int, CallGloss.MAX_EN_CHARS)
        assertEquals(root["minEnLetters"]!!.jsonPrimitive.int, CallGloss.MIN_EN_LETTERS)
        assertEquals(root["cacheVersion"]!!.jsonPrimitive.int, CallGloss.CACHE_VERSION)
    }

    @Test
    fun whenToSuggest() {
        val cases = root["checks"]!!.jsonArray
        assertTrue(cases.size > 1000)
        var ok = 0
        var en = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val text = o["text"]!!.jsonPrimitive.content
            val got = CallGloss.findSegment(text, o["start"]!!.jsonPrimitive.int, o["end"]!!.jsonPrimitive.int, o["composing"]!!.jsonPrimitive.boolean)
            val want = o["result"]!!.jsonObject
            val expected = if (want["ok"]!!.jsonPrimitive.boolean) {
                ok++
                val direction = want["direction"]!!.jsonPrimitive.content
                if (direction == "en") en++
                CallGloss.Check.Ok(want["segment"]!!.jsonPrimitive.content, want["start"]!!.jsonPrimitive.int, want["end"]!!.jsonPrimitive.int, direction)
            } else CallGloss.Check.Skip(want["reason"]!!.jsonPrimitive.content)
            assertEquals(expected, got, "case $i: ${Json.encodeToString(kotlinx.serialization.json.JsonElement.serializer(), c)}")
        }
        assertTrue(ok > 100, "enough positive cases ($ok)")
        assertTrue(en > 50, "enough English cases ($en)")
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
        for (c in root["enFormats"]!!.jsonArray) {
            val o = c.jsonObject
            val zh = o["chinese"]!!.jsonPrimitive.content
            val p = o["pinyin"]!!.jsonPrimitive.content
            assertEquals(o["format"]!!.jsonPrimitive.content, CallGloss.formatEn(zh, p))
            assertEquals(o["chip"]!!.jsonPrimitive.content, CallGloss.chipLabelEn(zh, p))
        }
        for (c in root["keys"]!!.jsonArray) {
            val o = c.jsonObject
            val s = o["s"]!!.jsonPrimitive.content
            assertEquals(o["key"]!!.jsonPrimitive.content, CallGloss.cacheKey(s))
            assertEquals(o["zh"]!!.jsonPrimitive.content, CallGloss.storeKey(s, CallGloss.ZH))
            assertEquals(o["en"]!!.jsonPrimitive.content, CallGloss.storeKey(s, CallGloss.EN))
            assertEquals(o["direction"]!!.jsonPrimitive.content, CallGloss.directionOf(s))
        }
    }

    @Test
    fun reliability() {
        assertEquals(root["localAfter"]!!.jsonPrimitive.long, CallGloss.LOCAL_AFTER_MS)
        assertEquals(root["retryAfterFailure"]!!.jsonPrimitive.long, CallGloss.RETRY_AFTER_FAILURE_MS)
        assertEquals(root["rateLimitWait"]!!.jsonPrimitive.long, CallGloss.RATE_LIMIT_WAIT_MS)
        assertEquals(root["maxWait"]!!.jsonPrimitive.long, CallGloss.MAX_WAIT_MS)
        for (c in root["backoff"]!!.jsonArray) {
            val o = c.jsonObject
            val status = o["status"]!!.jsonPrimitive.intOrNull
            val ra = o["retryAfter"]!!.jsonPrimitive.doubleOrNull
            assertEquals(o["ms"]!!.jsonPrimitive.long, CallGloss.backoffMs(status, ra), "backoff $o")
        }
        for (c in root["outcomes"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["outcome"]!!.jsonPrimitive.content, CallGloss.outcomeForStatus(o["status"]!!.jsonPrimitive.intOrNull))
        }
    }

    @Test
    fun deviceGloss() {
        val cases = root["locals"]!!.jsonArray
        assertTrue(cases.size > 200)
        var withLocal = 0
        for ((i, c) in cases.withIndex()) {
            val o = c.jsonObject
            val words = o["words"]!!.jsonArray.map { w -> CallGloss.Word(w.jsonObject["text"]!!.jsonPrimitive.content, w.jsonObject["pinyin"]!!.jsonPrimitive.content) }
            assertEquals(o["pinyin"]!!.jsonPrimitive.content, CallGloss.localPinyin(words), "pinyin $i")
            assertEquals((o["lookup"] as? JsonPrimitive)?.contentOrNull, CallGloss.lookupWord(words), "lookup $i")
            val dict = o["dict"] as? JsonObject
            val got = CallGloss.localGloss(words, (dict?.get("pinyin") as? JsonPrimitive)?.contentOrNull, (dict?.get("english") as? JsonPrimitive)?.contentOrNull)
            val want = o["local"] as? JsonObject
            if (want == null) assertEquals(null, got, "local $i")
            else {
                withLocal++
                assertEquals(CallGloss.Local(want["pinyin"]!!.jsonPrimitive.content, want["english"]!!.jsonPrimitive.content), got, "local $i")
            }
        }
        assertTrue(withLocal > 50, "enough device glosses ($withLocal)")
        for (c in root["dictMeanings"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["short"]!!.jsonPrimitive.content, CallGloss.shortDictMeaning(o["raw"]!!.jsonPrimitive.content), "meaning $o")
        }
    }
}
