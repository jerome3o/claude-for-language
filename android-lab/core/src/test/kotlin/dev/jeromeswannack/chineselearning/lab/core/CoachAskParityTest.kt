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
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** "💬 Ask Claude" chats reproduce shared/coach/askChat.ts (parity/fixtures/coach-ask.ts). */
class CoachAskParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "coach-ask.json").readText()).jsonObject
    }

    private val JsonElement?.str: String? get() = if (this == null || this is JsonNull) null else jsonPrimitive.content
    private fun list(e: JsonElement?) = e!!.jsonArray.map { it.str!! }

    private fun word(e: JsonElement): CoachAsk.RecapWord {
        val o = e.jsonObject
        return CoachAsk.RecapWord(
            hanzi = o["hanzi"].str!!, sentence = o["sentence"].str ?: "", reasons = list(o["reasons"]),
            pinyin = o["pinyin"].str, gloss = o["gloss"].str, reasonLine = o["reason_line"].str,
        )
    }

    @Test
    fun kindsTitlesAndOffers() {
        val f = fixture()
        for (c in f["kinds"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"].str, CoachAsk.conversationKind(o["kind"].str, o["action"].str, o["input_language"].str), o.toString())
        }
        for (c in f["titles"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, CoachAsk.title(c.jsonObject["in"].str!!))
        for (c in f["offered"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.jsonPrimitive.boolean, CoachAsk.readBackOffered(o["role"].str!!, o["content"].str!!, o["answer_lang"].str, o["status"].str), o["content"].str!!.take(20))
        }
        for (c in f["keys"]!!.jsonArray) assertEquals(c.jsonObject["out"].str, CoachAsk.recapKey(c.jsonObject["in"].str!!))
        val copy = f["copy"]!!.jsonObject
        assertEquals(copy["label"].str, CoachAsk.LABEL)
        assertEquals(copy["hint"].str, CoachAsk.HINT)
        assertEquals(copy["emptyEn"].str, CoachAsk.EMPTY_EN)
        assertEquals(copy["placeholderZh"].str, CoachAsk.PLACEHOLDER_ZH)
        assertEquals(copy["placeholderEn"].str, CoachAsk.PLACEHOLDER_EN)
        assertEquals(copy["thinkingZh"].str, CoachAsk.THINKING_ZH)
        assertEquals(copy["thinkingEn"].str, CoachAsk.THINKING_EN)
        assertEquals(copy["readBack"].str, CoachAsk.READ_BACK_LABEL)
        assertEquals(copy["readBackListening"].str, CoachAsk.READ_BACK_LISTENING)
        assertEquals(copy["recapMax"]!!.jsonPrimitive.int, CoachAsk.RECAP_MAX)
        assertEquals(copy["maxChars"]!!.jsonPrimitive.int, CoachAsk.MAX_CHARS)
    }

    @Test
    fun recapWordsMergeLikeTypeScript() {
        for (run in fixture()["recapRuns"]!!.jsonArray) {
            val o = run.jsonObject
            val max = o["max"]!!.jsonPrimitive.int
            val steps = o["steps"]!!.jsonArray.map(::word)
            val states = o["states"]!!.jsonArray
            var cur = emptyList<CoachAsk.RecapWord>()
            for ((i, s) in steps.withIndex()) {
                cur = CoachAsk.addRecapWord(cur, s, max)
                assertEquals(states[i].jsonArray.map(::word), cur, "max $max step $i")
            }
            assertEquals(o["all"]!!.jsonArray.map(::word), CoachAsk.addRecapWords(emptyList(), steps, max))
        }
    }

    @Test
    fun readBackMistakesLikeTypeScript() {
        val f = fixture()
        val reads = f["reads"]!!.jsonArray
        assertTrue(reads.size >= 8)
        for (c in reads) {
            val o = c.jsonObject
            val text = o["text"].str!!
            val r = ReadAloud.judge(text, o["said"].str!!)
            assertEquals(o["out"]!!.jsonArray.map(::word), CoachAsk.readBackMistakeWords(text, list(o["words"]), r), text)
        }
        for (c in f["reasonLines"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["line"].str, CoachAsk.readBackReasonLine(ReadAloud.judge(o["text"].str!!, o["said"].str!!).chars))
        }
    }

    @Test
    fun labelsTicksAndFocus() {
        val f = fixture()
        for (c in f["labels"]!!.jsonArray) assertEquals(c.jsonObject["label"].str, CoachAsk.recapCountLabel(c.jsonObject["n"]!!.jsonPrimitive.int))
        for (c in f["cards"]!!.jsonArray) {
            val o = c.jsonObject
            val card = o["card"]!!.jsonObject
            assertEquals(o["checked"]!!.jsonPrimitive.boolean, CoachAsk.cardChecked(card["hanzi"].str!!, card["already_have"]!!.jsonPrimitive.boolean, list(o["recap"])), o.toString())
        }
        for (c in f["focus"]!!.jsonArray) assertEquals(list(c.jsonObject["out"]), CoachAsk.focusWords(list(c.jsonObject["list"])))
    }
}
