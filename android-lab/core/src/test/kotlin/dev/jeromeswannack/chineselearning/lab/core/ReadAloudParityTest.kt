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
        var allRight = 0
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
                assertEquals(str(w, "pinyin"), got.pinyin, "$where @$i pinyin")
                assertEquals(str(w, "heardPinyin"), got.heardPinyin, "$where @$i heardPinyin")
                assertEquals(str(w, "extraBeforePinyin"), got.extraBeforePinyin, "$where @$i extraBeforePinyin")
                assertEquals(w["unitCont"]!!.jsonPrimitive.boolean, got.unitCont, "$where @$i unitCont")
                if (got.mark != ReadAloud.Mark.OK && got.mark != ReadAloud.Mark.PLAIN) marked++
            }
            assertEquals(str(want, "extraAtEnd"), r.extraAtEnd, where)
            assertEquals(str(want, "extraAtEndPinyin"), r.extraAtEndPinyin, where)
            assertEquals(
                want["heard"]!!.jsonArray.map { it.jsonObject.let { h -> str(h, "char") to str(h, "mark") } },
                r.heard.map { it.char to it.mark },
                "$where heard",
            )
            assertDiffs(o["diffs"]!!.jsonArray, ReadAloud.differences(r), where)
            assertEquals(want["total"]!!.jsonPrimitive.int, r.total, where)
            assertEquals(want["right"]!!.jsonPrimitive.int, r.right, where)
            assertEquals(want["pct"]!!.jsonPrimitive.int, r.pct, where)
            assertEquals(want["toCheck"]!!.jsonPrimitive.int, r.toCheck, where)
            assertEquals(str(o, "line"), ReadAloud.line(r.pct, r.toCheck), where)
            assertEquals(str(o, "tone"), ReadAloud.tone(r.pct, r.toCheck), where)
            assertEquals(str(o, "bucket"), ReadAloud.bucket(r.pct), where)
            assertEquals(o["labels"]!!.jsonArray.map { it.jsonPrimitive.content }, r.chars.map(ReadAloud::charLabel), where)
            assertEquals(o["needsLook"]!!.jsonPrimitive.boolean, ReadAloud.needsLook(r.chars), where)
            assertEquals(o["legend"]!!.jsonArray.map { it.jsonPrimitive.content }, ReadAloud.legend(r), where)
            assertEquals(o["allRight"]!!.jsonPrimitive.boolean, ReadAloud.allRight(r), "$where allRight")
            if (ReadAloud.allRight(r)) allRight++
        }
        assertTrue(marked > 50)
        assertTrue(allRight > 3, "some takes are all right")
    }

    private fun assertDiffs(want: kotlinx.serialization.json.JsonArray, got: List<ReadAloud.Difference>, where: String) {
        assertEquals(want.size, got.size, "$where diffs")
        for ((i, w) in want.map { it.jsonObject }.withIndex()) {
            val d = got[i]
            assertEquals(w["start"]!!.jsonPrimitive.int, d.start, "$where diff $i start")
            assertEquals(w["end"]!!.jsonPrimitive.int, d.end, "$where diff $i end")
            assertEquals(str(w, "page"), d.page, "$where diff $i page")
            assertEquals(str(w, "pagePinyin"), d.pagePinyin, "$where diff $i pagePinyin")
            assertEquals(str(w, "heard"), d.heard, "$where diff $i heard")
            assertEquals(str(w, "heardPinyin"), d.heardPinyin, "$where diff $i heardPinyin")
            assertEquals(str(w, "kind"), d.kind, "$where diff $i kind")
            assertEquals(w["toCheck"]!!.jsonPrimitive.boolean, d.toCheck, "$where diff $i toCheck")
            assertEquals(w["reasons"]!!.jsonArray.map { it.jsonPrimitive.content }, d.reasons, "$where diff $i reasons")
        }
    }

    @Test
    fun differencesByWordAndTones() {
        val f = fixture()
        val cases = f["wordCases"]!!.jsonArray
        assertTrue(cases.size >= 7)
        for (c in cases) {
            val o = c.jsonObject
            val where = "${str(o, "page")} / ${str(o, "transcript")}"
            val diffs = ReadAloud.differences(ReadAloud.judge(str(o, "page"), str(o, "transcript")), o["words"]!!.jsonArray.map { it.jsonPrimitive.content })
            assertDiffs(o["diffs"]!!.jsonArray, diffs, where)
            assertEquals(o["at"]!!.jsonArray.map { it.jsonPrimitive.int }, o["at"]!!.jsonArray.indices.map { ReadAloud.differenceAt(diffs, it) }, "$where at")
        }
        // Jerome's take, spelled out: 成都 heard as 程度.
        val jerome = ReadAloud.differences(
            ReadAloud.judge("胆子大的话，可以试试麻辣兔头，这是很多成都人最爱的小吃。", "胆子大的话，可以试试麻辣兔头，这是很多程度人最爱的小吃。"),
            listOf("胆子", "大", "的话", "，", "可以", "试试", "麻辣", "兔头", "，", "这", "是", "很多", "成都", "人", "最", "爱", "的", "小吃", "。"),
        ).single()
        assertEquals("成都" to "程度", jerome.page to jerome.heard)
        assertEquals(listOf("成 chéng — sounded right (written 程)", "都 dū → you said dù (4th tone instead of 1st)"), jerome.reasons)
        for (t in f["tones"]!!.jsonArray) {
            val o = t.jsonObject
            assertEquals(o["tone"]!!.jsonPrimitive.int, ReadAloud.pinyinTone(str(o, "py")), str(o, "py"))
        }
        assertEquals(f["toneNames"]!!.jsonArray.map { it.jsonPrimitive.content }, (0..4).map(ReadAloud::toneName))
        val kinds = f["diffKinds"]!!.jsonObject
        for (k in listOf("wrong", "missed", "tone", "extra", "sound")) assertEquals(str(kinds, k), ReadAloud.diffKindLabel(k), k)
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
        assertEquals(str(copy, "stopRecording"), ReadAloud.STOP_RECORDING)
        for (l in f["locks"]!!.jsonArray) {
            val o = l.jsonObject
            assertEquals(o["locks"]!!.jsonPrimitive.boolean, ReadAloud.locksPage(str(o, "phase")), str(o, "phase"))
        }
        val legend = copy["legend"]!!.jsonObject
        for (k in listOf("close", "wrong", "missed", "extra")) assertEquals(str(legend, k), ReadAloud.legendLabel(k), k)
    }
}
