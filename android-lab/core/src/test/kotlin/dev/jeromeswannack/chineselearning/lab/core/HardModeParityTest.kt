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
import kotlinx.serialization.json.long
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Hard mode reproduces shared/study/hardMode.ts (parity/fixtures/hard-mode.ts). */
class HardModeParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "hard-mode.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content
    private val JsonElement.intOrNull: Int? get() = if (this is JsonNull) null else jsonPrimitive.int

    @Test
    fun settingAndCards() {
        val f = fixture()
        for (c in f["parse"]!!.jsonArray) assertEquals(c.jsonObject["mode"]!!.str, HardMode.parse(c.jsonObject["raw"]!!.str), c.toString())
        for (c in f["next"]!!.jsonArray) assertEquals(c.jsonObject["next"]!!.str, HardMode.next(c.jsonObject["mode"]!!.str!!), c.toString())
        for (c in f["red"]!!.jsonArray) assertEquals(c.jsonObject["red"]!!.jsonPrimitive.boolean, HardMode.isRedCard(c.jsonObject["queue"]!!.intOrNull), c.toString())
        val applies = f["applies"]!!.jsonArray
        assertTrue(applies.size >= 60)
        for (c in applies) {
            val o = c.jsonObject
            assertEquals(o["applies"]!!.jsonPrimitive.boolean, HardMode.applies(o["mode"]!!.str!!, o["cardType"]!!.str!!, o["queue"]!!.intOrNull), o.toString())
        }
    }

    @Test
    fun questionResults() {
        for (c in fixture()["results"]!!.jsonArray) {
            val o = c.jsonObject
            val verdict = o["answerVerdict"]!!.str?.let { AnswerKey.Verdict.valueOf(it.uppercase()) }
            val take = o["take"]!!.let { if (it is JsonNull) null else it.jsonObject }
            val result = HardMode.questionResult(
                verdict, take?.get("status")?.str,
                take?.get("isMatch")?.jsonPrimitive?.boolean ?: false, take?.get("containsExpected")?.jsonPrimitive?.boolean ?: false,
            )
            assertEquals(o["result"]!!.str, result, o.toString())
            for (fl in o["follows"]!!.jsonArray) {
                val fo = fl.jsonObject
                assertEquals(fo["follows"]!!.jsonPrimitive.boolean, HardMode.roundFollows(result, fo["count"]!!.intOrNull), o.toString())
            }
        }
    }

    @Test
    fun locks() {
        for (c in fixture()["locks"]!!.jsonArray) {
            val o = c.jsonObject
            val right = o["right"]!!.jsonArray.map { it.str!! }
            val gate = SentencePractise.gate(true, "hanzi_to_meaning", o["count"]!!.intOrNull, right)
            val want = o["lock"]!!.jsonObject
            val lock = HardMode.lock(gate, o["gaveUp"]!!.jsonPrimitive.boolean, SentencePractise.label(gate), SentencePractise.blockedNote(gate))
            assertEquals(HardMode.Lock(want["locked"]!!.jsonPrimitive.boolean, want["label"]!!.str, want["blockedNote"]!!.str!!, want["gaveUp"]!!.jsonPrimitive.boolean), lock, o.toString())
        }
    }

    @Test
    fun copyMatches() {
        val c = fixture()["copy"]!!.jsonObject
        assertEquals(c["modes"]!!.jsonArray.map { it.str }, HardMode.MODES)
        assertEquals(c["title"]!!.str, HardMode.TITLE)
        assertEquals(c["description"]!!.str, HardMode.DESCRIPTION)
        assertEquals(c["option"]!!.jsonObject.mapValues { it.value.str }, HardMode.OPTION)
        assertEquals(c["optionHint"]!!.jsonObject.mapValues { it.value.str }, HardMode.OPTION_HINT)
        assertEquals(c["chip"]!!.jsonObject.mapValues { it.value.str }, HardMode.CHIP)
        assertEquals(c["chipLabel"]!!.jsonObject.mapValues { it.value.str }, HardMode.MODES.associateWith { HardMode.chipLabel(it) })
        assertEquals(c["result"]!!.jsonObject.mapValues { it.value.str }, HardMode.RESULT)
        assertEquals(c["checking"]!!.str, HardMode.CHECKING)
        assertEquals(c["unknown"]!!.str, HardMode.UNKNOWN)
        assertEquals(c["tryAgain"]!!.str, HardMode.TRY_AGAIN)
        assertEquals(c["showAnswer"]!!.str, HardMode.SHOW_ANSWER)
        assertEquals(c["missNote"]!!.str, HardMode.MISS_NOTE)
        assertEquals(c["gaveUpLine"]!!.str, HardMode.GAVE_UP_LINE)
        assertEquals(c["gaveUpBlocked"]!!.str, HardMode.GAVE_UP_BLOCKED)
        assertEquals(c["beatMs"]!!.jsonPrimitive.long, HardMode.RIGHT_BEAT_MS)
        assertEquals(c["nextRound"]!!.str, HardMode.nextLabel(true))
        assertEquals(c["nextAnswer"]!!.str, HardMode.nextLabel(false))
        assertEquals(c["saidSpoken"]!!.str, HardMode.saidLine("银航", true))
        assertEquals(c["saidTyped"]!!.str, HardMode.saidLine("银行。", false))
    }
}
