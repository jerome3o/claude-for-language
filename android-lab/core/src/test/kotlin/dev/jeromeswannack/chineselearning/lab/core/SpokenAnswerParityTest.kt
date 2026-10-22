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
        assertTrue(cases.size >= 5000)
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
            assertEquals(within(c["within"]), AnswerKey.answerWithin(transcript, correct, alternatives, notePinyin)?.name?.lowercase(), "within $what")
            assertEquals(within(c["within_read"]), AnswerKey.answerWithin(transcript, correct)?.name?.lowercase(), "within (read card) $what")
            val syllables = c["syllables"]!!.jsonArray.map { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(syllables, AnswerKey.spokenSyllables(transcript), "syllables $what")
            assertEquals(c["tidy"]!!.jsonPrimitive.content, AnswerKey.tidySpokenTranscript(transcript, correct), "tidy $what")
        }
        assertTrue(cases.count { it["within"] !is JsonNull && it["spoken"]!!.jsonPrimitive.content == "contains" } > 100, "few contains cases")
        // Every verdict is exercised.
        val counts = fixture["counts"]!!.jsonObject
        for (v in AnswerKey.Verdict.entries) assertTrue(counts[AnswerKey.verdictName(v)]!!.jsonPrimitive.int > 0, "no ${v.name} case")
    }

    private fun within(el: kotlinx.serialization.json.JsonElement?): String? = if (el == null || el is JsonNull) null else el.jsonPrimitive.content

    @Test
    fun tidyTranscriptMatchesTypeScript() {
        val rows = fixture["tidy"]!!.jsonArray.map { it.jsonObject }
        assertTrue(rows.size >= 10)
        for (o in rows) {
            val transcript = o["transcript"]!!.jsonPrimitive.content
            val correct = o["correct"]!!.jsonPrimitive.content
            assertEquals(o["tidy"]!!.jsonPrimitive.content, AnswerKey.tidySpokenTranscript(transcript, correct), "'$transcript' for '$correct'")
        }
        // Jerome's card: 撤销 said, "撤销。" from the recogniser, shown as 撤销.
        assertEquals("撤销", AnswerKey.tidySpokenTranscript("撤销。", "撤销"))
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
        assertTrue(AnswerKey.isAccepted(AnswerKey.Verdict.CONTAINS))
        // Jerome's card: 他长得很好。 for 长得 counts — the word said inside a sentence.
        assertEquals(AnswerKey.Verdict.CONTAINS, AnswerKey.checkSpoken("他长得很好。", "长得", emptyList(), "zhǎngde"))
        assertTrue(!AnswerKey.isAccepted(AnswerKey.Verdict.CLOSE))
        assertTrue(!AnswerKey.isAccepted(AnswerKey.Verdict.WRONG))
    }

    /** The answer side's compact "You said" row (shared/cards/spoken-result.ts → SpokenAnswerResult). */
    @Test
    fun spokenResultRowMatchesTypeScript() {
        val cases = fixture["cases"]!!.jsonArray.map { it.jsonObject }
        val states = mutableSetOf<String>()
        val marks = mutableSetOf<String>()
        for (c in cases) {
            val transcript = c["transcript"]!!.jsonPrimitive.content
            val correct = c["correct"]!!.jsonPrimitive.content
            val alternatives = c["alternatives"]!!.jsonArray.map { it.jsonPrimitive.content }
            val notePinyin = c["note_pinyin"]!!.jsonPrimitive.content
            val what = "'$transcript' for '$correct' $alternatives / '$notePinyin'"
            val want = c["result"]!!.jsonObject
            val r = SpokenAnswerResult.of(transcript, correct, AnswerKey.checkSpoken(transcript, correct, alternatives, notePinyin))
            assertResult(want, r, what)
            assertEquals(want["label"]!!.jsonPrimitive.content, SpokenAnswerResult.label(r, correct, notePinyin), "label $what")
            states += SpokenAnswerResult.stateName(r.state)
            r.chars.forEach { marks += SpokenAnswerResult.markName(it.mark) }
        }
        assertEquals(setOf("match", "sound", "contains", "close", "wrong"), states)
        assertEquals(setOf("right", "differs", "wrong", "plain"), marks)
        for (el in fixture["results_by_verdict"]!!.jsonArray) {
            val o = el.jsonObject
            val verdict = AnswerKey.Verdict.valueOf(o["verdict"]!!.jsonPrimitive.content.uppercase())
            val r = SpokenAnswerResult.of(" 朗。", "狼 ", verdict)
            assertResult(o, r, verdict.name)
            assertEquals(o["label"]!!.jsonPrimitive.content, SpokenAnswerResult.label(r, "狼 ", " lǎng "), "label ${verdict.name}")
        }
        // Jerome's card: 狼 said 朗 — ≈ Close — tones off, 朗 marked.
        val close = SpokenAnswerResult.of("朗", "狼", AnswerKey.checkSpoken("朗", "狼"))
        assertEquals(SpokenAnswerResult.State.CLOSE, close.state)
        assertEquals("Close — tones off", close.chip)
        assertEquals(listOf(SpokenAnswerResult.Cell("朗", SpokenAnswerResult.Mark.WRONG)), close.chars)
    }

    private fun assertResult(want: JsonObject, r: SpokenAnswerResult.Result, what: String) {
        assertEquals(want["state"]!!.jsonPrimitive.content, SpokenAnswerResult.stateName(r.state), "state $what")
        assertEquals(want["accepted"]!!.jsonPrimitive.content.toBoolean(), r.accepted, "accepted $what")
        assertEquals(want["chip"]!!.jsonPrimitive.content, r.chip, "chip $what")
        assertEquals(want["icon"]!!.jsonPrimitive.content, r.icon, "icon $what")
        assertEquals(want["coach"]!!.jsonPrimitive.content.toBoolean(), r.coach, "coach $what")
        assertEquals(want["marks"]!!.jsonArray.map { it.jsonPrimitive.content }, r.chars.map { SpokenAnswerResult.markName(it.mark) }, "marks $what")
        want["chars"]?.let { chars -> assertEquals(chars.jsonArray.map { it.jsonPrimitive.content }, r.chars.map { it.char }, "chars $what") }
    }
}
