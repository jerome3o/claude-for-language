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
                take?.get("tonesOff")?.jsonPrimitive?.boolean ?: false,
            )
            assertEquals(o["result"]!!.str, result, o.toString())
            for (fl in o["follows"]!!.jsonArray) {
                val fo = fl.jsonObject
                assertEquals(fo["follows"]!!.jsonPrimitive.boolean, HardMode.roundFollows(result, fo["count"]!!.intOrNull), o.toString())
            }
        }
    }

    @Test
    fun goodEasyGates() {
        val cases = fixture()["locks"]!!.jsonArray
        assertTrue(cases.size >= 48)
        for (c in cases) {
            val o = c.jsonObject
            val right = o["right"]!!.jsonArray.map { it.str!! }
            val gate = SentencePractise.gate(true, o["cardType"]!!.str!!, o["count"]!!.intOrNull, right)
            val want = o["lock"]!!.jsonObject
            val g = HardMode.goodEasy(gate, o["gaveUp"]!!.jsonPrimitive.boolean, SentencePractise.label(gate))
            assertEquals(HardMode.GoodEasy(want["state"]!!.str!!, want["reason"]!!.str, want["label"]!!.str, want["gaveUp"]!!.jsonPrimitive.boolean), g, o.toString())
            assertEquals(o["needsOverride"]!!.jsonArray.map { it.jsonPrimitive.boolean }, (0..3).map { HardMode.needsOverride(it, g) }, o.toString())
            assertEquals(o["suggested"]!!.intOrNull, HardMode.suggestedRating(g), o.toString())
        }
    }

    @Test
    fun overrideTaps() {
        val cases = fixture()["taps"]!!.jsonArray
        assertTrue(cases.size >= 100)
        fun arm(e: JsonElement?): HardMode.Arm? = if (e == null || e is JsonNull) null else HardMode.Arm(e.jsonObject["rating"]!!.jsonPrimitive.int, e.jsonObject["at"]!!.jsonPrimitive.long)
        for (c in cases) {
            val o = c.jsonObject
            val want = o["tap"]!!.jsonObject
            val tap = HardMode.overrideTap(o["needsOverride"]!!.jsonPrimitive.boolean, o["rating"]!!.jsonPrimitive.int, arm(o["armed"]), o["now"]!!.jsonPrimitive.long)
            assertEquals(HardMode.Tap(want["rate"]!!.jsonPrimitive.boolean, want["override"]!!.jsonPrimitive.boolean, arm(want["armed"])), tap, o.toString())
        }
    }

    @Test
    fun feels() {
        val f = fixture()["feels"]!!.jsonObject
        for (c in f["question"]!!.jsonArray) assertEquals(c.jsonObject["feel"]!!.str, HardMode.questionFeel(c.jsonObject["result"]!!.str), c.toString())
        for (c in f["round"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["feel"]!!.str, HardMode.roundTakeFeel(o["result"]!!.str!!, o["done"]!!.jsonPrimitive.boolean), o.toString())
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
        assertEquals(c["overrideMs"]!!.jsonPrimitive.long, HardMode.OVERRIDE_MS)
        for (g in c["giveUpInPlace"]!!.jsonArray) assertEquals(g.jsonObject["inPlace"]!!.jsonPrimitive.boolean, HardMode.giveUpInPlace(g.jsonObject["count"]!!.intOrNull), g.toString())
        assertEquals(c["revealedTitle"]!!.str, HardMode.REVEALED_TITLE)
        assertEquals(c["revealedNote"]!!.str, HardMode.REVEALED_NOTE)
        assertEquals(c["revealedNext"]!!.jsonArray.map { it.str }, listOf(true, false).map { HardMode.revealedNextLabel(it) })
        assertEquals(c["gaveUpCheer"]!!.str, HardMode.gaveUpCheer(2, 2))
        assertEquals(c["suggested"]!!.str, HardMode.SUGGESTED)
        assertEquals(c["tapTwice"]!!.str, HardMode.TAP_TWICE)
        assertEquals(c["tapAgain"]!!.str, HardMode.TAP_AGAIN)
        assertEquals(c["prompts"]!!.jsonArray.map { it.str }, listOf(0, 1, 2, 3, 9).map { HardMode.overridePrompt(it) })
        assertEquals(c["vibration"]!!.jsonObject.mapValues { e -> e.value.jsonArray.map { it.jsonPrimitive.long } }, HardMode.FEEL_VIBRATION)
        assertEquals(c["beatMs"]!!.jsonPrimitive.long, HardMode.RIGHT_BEAT_MS)
        assertEquals(c["nextRound"]!!.str, HardMode.nextLabel(true))
        assertEquals(c["nextAnswer"]!!.str, HardMode.nextLabel(false))
        assertEquals(c["saidSpoken"]!!.str, HardMode.saidLine("银航", true))
        assertEquals(c["saidTyped"]!!.str, HardMode.saidLine("银行。", false))
    }
}
