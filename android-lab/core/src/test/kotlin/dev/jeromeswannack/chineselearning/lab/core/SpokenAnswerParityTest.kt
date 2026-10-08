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
 * The typing cards' answer check and its spoken mode must decide exactly like
 * shared/cards/answer.ts (parity/fixtures/spoken-answer.ts → spoken-answer.json): the typed
 * verdict, the spoken verdict (homophones = sound, other tones = close), the pinyin keys and
 * the line shown under a spoken answer.
 */
class SpokenAnswerParityTest {
    private val fixture: JsonObject by lazy {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        Json.parseToJsonElement(File(dir, "spoken-answer.json").readText()).jsonObject
    }

    @Test
    fun verdictsMatchTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue(cases.size >= 4000)
        for (c in cases) {
            val transcript = c["transcript"]!!.jsonPrimitive.content
            val correct = c["correct"]!!.jsonPrimitive.content
            val alternatives = c["alternatives"]!!.jsonArray.map { it.jsonPrimitive.content }
            val notePinyin = c["note_pinyin"]!!.jsonPrimitive.content
            val what = "'$transcript' for '$correct' $alternatives / '$notePinyin'"
            assertEquals(c["typed"]!!.jsonPrimitive.content, AnswerKey.verdictName(AnswerKey.check(transcript, correct, alternatives)), "typed $what")
            assertEquals(c["spoken"]!!.jsonPrimitive.content, AnswerKey.verdictName(AnswerKey.checkSpoken(transcript, correct, alternatives, notePinyin)), "spoken $what")
            assertEquals(c["heard_key"]!!.jsonPrimitive.content, AnswerKey.spokenPinyinKey(transcript), "heard key $what")
            assertEquals(c["correct_key"]!!.jsonPrimitive.content, AnswerKey.spokenPinyinKey(correct), "correct key $what")
            assertEquals(c["note_key"]!!.jsonPrimitive.content, AnswerKey.normalizeSpokenPinyin(notePinyin), "note key $what")
            assertEquals(c["toneless"]!!.jsonPrimitive.content, AnswerKey.tonelessPinyin(AnswerKey.spokenPinyinKey(correct)), "toneless $what")
        }
        // Every verdict is exercised.
        val counts = fixture["counts"]!!.jsonObject
        for (v in AnswerKey.Verdict.entries) assertTrue(counts[AnswerKey.verdictName(v)]!!.jsonPrimitive.int > 0, "no ${v.name} case")
    }

    @Test
    fun notesMatchTypeScript() {
        for (el in fixture["notes"]!!.jsonArray) {
            val o = el.jsonObject
            val verdict = AnswerKey.Verdict.valueOf(o["verdict"]!!.jsonPrimitive.content.uppercase())
            val want = o["note"]!!.let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(want, AnswerKey.spokenVerdictNote(verdict, " 由 "), verdict.name)
        }
    }

    @Test
    fun acceptedVerdicts() {
        assertTrue(AnswerKey.isAccepted(AnswerKey.Verdict.SOUND))
        assertTrue(!AnswerKey.isAccepted(AnswerKey.Verdict.CLOSE))
        assertTrue(!AnswerKey.isAccepted(AnswerKey.Verdict.WRONG))
    }
}
