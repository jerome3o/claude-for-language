package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
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

/** 🎤 Read it aloud reproduces shared/reader/readAloud.ts (parity/fixtures/read-aloud.ts). */
class ReadAloudParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "read-aloud.json").readText()).jsonObject
    }

    private fun str(o: JsonObject, k: String) = o[k]!!.jsonPrimitive.content

    @Test
    fun judgesEveryCaseExactly() {
        val cases = fixture()["cases"]!!.jsonArray
        assertTrue(cases.size > 100)
        var marked = 0
        for (c in cases) {
            val o = c.jsonObject
            val page = str(o, "page")
            val transcript = str(o, "transcript")
            val where = "$page / $transcript"
            assertEquals(o["heard"]!!.jsonPrimitive.boolean, ReadAloud.heardAnything(transcript), where)
            val r = ReadAloud.judge(page, transcript)
            val want = o["result"]!!.jsonObject
            val chars = want["chars"]!!.jsonArray.map { it.jsonObject }
            assertEquals(chars.size, r.chars.size, where)
            for ((i, w) in chars.withIndex()) {
                val got = r.chars[i]
                assertEquals(str(w, "char"), got.char, "$where @$i")
                assertEquals(str(w, "mark"), ReadAloud.markName(got.mark), "$where @$i")
                assertEquals(str(w, "heard"), got.heard, "$where @$i heard")
                assertEquals(str(w, "extraBefore"), got.extraBefore, "$where @$i extra")
                if (got.mark != ReadAloud.Mark.OK && got.mark != ReadAloud.Mark.PLAIN) marked++
            }
            assertEquals(str(want, "extraAtEnd"), r.extraAtEnd, where)
            assertEquals(want["total"]!!.jsonPrimitive.int, r.total, where)
            assertEquals(want["right"]!!.jsonPrimitive.int, r.right, where)
            assertEquals(want["pct"]!!.jsonPrimitive.int, r.pct, where)
            assertEquals(want["toCheck"]!!.jsonPrimitive.int, r.toCheck, where)
            assertEquals(str(o, "line"), ReadAloud.line(r.pct, r.toCheck), where)
            assertEquals(str(o, "tone"), ReadAloud.tone(r.pct, r.toCheck), where)
            assertEquals(str(o, "bucket"), ReadAloud.bucket(r.pct), where)
            assertEquals(o["labels"]!!.jsonArray.map { it.jsonPrimitive.content }, r.chars.map(ReadAloud::charLabel), where)
            assertEquals(o["needsLook"]!!.jsonPrimitive.boolean, ReadAloud.needsLook(r.chars), where)
        }
        assertTrue(marked > 50)
    }

    @Test
    fun bucketsAndCopy() {
        val f = fixture()
        for (b in f["buckets"]!!.jsonArray) {
            val o = b.jsonObject
            assertEquals(str(o, "bucket"), ReadAloud.bucket(o["pct"]!!.jsonPrimitive.int))
        }
        val copy = f["copy"]!!.jsonObject
        assertEquals(str(copy, "label"), ReadAloud.LABEL)
        assertEquals(str(copy, "again"), ReadAloud.AGAIN)
        assertEquals(str(copy, "stop"), ReadAloud.STOP)
        assertEquals(str(copy, "listening"), ReadAloud.LISTENING)
        assertEquals(str(copy, "checking"), ReadAloud.CHECKING)
        assertEquals(str(copy, "offline"), ReadAloud.OFFLINE)
        assertEquals(str(copy, "empty"), ReadAloud.EMPTY)
        assertEquals(str(copy, "youSaid"), ReadAloud.YOU_SAID)
    }
}
