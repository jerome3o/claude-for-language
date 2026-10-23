package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** Sentence Coach buttons / actions / sentence card reproduce shared/coach exactly (parity/fixtures/coach.ts). */
class CoachParityTest {
    private fun fixture(): JsonObject {
        val dir = System.getProperty("parity.dir") ?: fail("parity.dir not set — run through Gradle")
        return Json.parseToJsonElement(File(dir, "coach.json").readText()).jsonObject
    }

    private val JsonElement.str: String? get() = if (this is JsonNull) null else jsonPrimitive.content

    @Test
    fun buttonsMatchTypeScript() {
        val cases = fixture()["buttons"]!!.jsonArray
        assertTrue(cases.size >= 20)
        for (c in cases) {
            val o = c.jsonObject
            val text = o["text"]!!.str!!
            val r = o["result"]!!.jsonObject
            val b = CoachActions.buttons(text)
            assertEquals(r["kind"]!!.str, b.kind, "kind of '$text'")
            assertEquals(r["actions"]!!.jsonArray.map { it.str }, b.actions.map { it.id }, "actions of '$text'")
            assertEquals(r["enabled"]!!.jsonPrimitive.boolean, b.enabled, "enabled of '$text'")
            assertEquals(r["hint"]?.str, b.hint, "hint of '$text'")
        }
    }

    @Test
    fun conversationActionMatchesTypeScript() {
        for (c in fixture()["actions"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["result"]!!.str, CoachActions.conversationAction(o["action"]?.str, o["input_language"]?.str).id, o.toString())
        }
    }

    @Test
    fun sentenceCardMatchesTypeScript() {
        for (c in fixture()["cards"]!!.jsonArray) {
            val i = c.jsonObject["in"]!!.jsonObject
            val out = c.jsonObject["out"]!!.jsonObject
            val words = i["words"]!!.jsonArray.map { w ->
                val wo = w.jsonObject
                CoachBreakdownWord(wo["hanzi"]!!.str!!, wo["pinyin"]!!.str!!, wo["gloss"]!!.str!!)
            }
            val card = CoachActions.sentenceCard(i["hanzi"]!!.str!!, i["pinyin"]!!.str!!, i["translation"]?.str, words, i["construction"]?.str)
            assertEquals(out["hanzi"]!!.str, card.hanzi)
            assertEquals(out["pinyin"]!!.str, card.pinyin)
            assertEquals(out["english"]!!.str, card.english)
            assertEquals(out["fun_facts"]?.str, card.funFacts, i.toString())
        }
    }

    @Test
    fun deepLinkActionMatchesTypeScript() {
        val cases = fixture()["deepLinks"]!!.jsonArray
        assertTrue(cases.size >= 100)
        for (c in cases) {
            val o = c.jsonObject
            val text = o["text"]!!.str!!
            val action = o["action"]?.str
            assertEquals(o["run"]?.str, CoachActions.deepLinkAction(text, action)?.id, "coachDeepLinkAction('$text', $action)")
            assertEquals(o["resolved"]?.str, CoachActions.resolveAction(NoteSearch.jsTrim(text), action)?.id, "resolveCoachAction('$text', $action)")
        }
    }

    private fun word(e: JsonElement): CoachBreakdownWord {
        val o = e.jsonObject
        return CoachBreakdownWord(o["hanzi"]!!.str!!, o["pinyin"]!!.str!!, o["gloss"]!!.str!!)
    }

    @Test
    fun newWordsMatchTypeScript() {
        val f = fixture()
        assertEquals(f["maxNewWords"]!!.jsonPrimitive.content.toInt(), CoachNewWords.MAX)
        assertEquals(f["skipWords"]!!.jsonArray.map { it.str }.toSet(), CoachNewWords.SKIP_WORDS)
        assertEquals(f["sentenceCardLabel"]!!.str, CoachNewWords.SENTENCE_CARD_LABEL)
        for (c in f["newWords"]!!.jsonArray) {
            val o = c.jsonObject
            val notes = o["notes"]!!.jsonArray.map { it.str }
            val got = CoachNewWords.newWordsInSentence(o["words"]!!.jsonArray.map(::word), notes, o["max"]!!.jsonPrimitive.content.toInt())
            assertEquals(o["result"]!!.jsonArray.map(::word), got, "newWordsInSentence $notes max=${o["max"]}")
        }
        for (c in f["wordCards"]!!.jsonArray) {
            val o = c.jsonObject
            val s = o["sentence"]!!.jsonObject
            val got = CoachNewWords.newWordCards(o["words"]!!.jsonArray.map(::word), s["hanzi"]!!.str!!, s["pinyin"]?.str, s["translation"]?.str)
            val want = o["result"]!!.jsonArray.map { e ->
                val r = e.jsonObject
                CoachNewWords.WordCard(
                    r["hanzi"]!!.str!!, r["pinyin"]!!.str!!, r["english"]!!.str!!,
                    r["sentence_clue"]?.str, r["sentence_clue_pinyin"]?.str, r["sentence_clue_translation"]?.str,
                )
            }
            assertEquals(want, got, "newWordCards $o")
        }
        for (c in f["newWordLabels"]!!.jsonArray) {
            val o = c.jsonObject
            val n = o["n"]!!.jsonPrimitive.content.toInt()
            assertEquals(o["label"]!!.str, CoachNewWords.label(n))
            assertEquals(o["button"]!!.str, CoachNewWords.addButton(n))
        }
    }

    @Test
    fun mistakeLessonMatchesTypeScript() {
        val f = fixture()
        assertEquals(f["mistakeLabel"]!!.str, CoachMistakeLesson.LABEL)
        assertEquals(f["mistakeBusy"]!!.str, CoachMistakeLesson.BUSY)
        assertEquals(f["mistakeContentType"]!!.str, CoachMistakeLesson.CONTENT_TYPE)
        val checks = f["mistakeChecks"]!!.jsonArray
        assertTrue(checks.size >= 10)
        for (c in checks) {
            val o = c.jsonObject
            val original = o["originalInput"]!!.str!!
            assertEquals(o["core"]!!.str, CoachMistakeLesson.sentenceCore(original), "sentenceCore('$original')")
            assertEquals(
                o["offered"]!!.jsonPrimitive.boolean,
                CoachMistakeLesson.offered(original, o["isCorrect"]!!.jsonPrimitive.boolean, o["corrected"]!!.str),
                "coachMistakeLessonOffered $o",
            )
        }
        for (c in f["mistakeCardLines"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["line"]!!.str, CoachMistakeLesson.cardLine(o["n"]!!.jsonPrimitive.content.toInt()))
        }
        for (c in f["mistakeContents"]!!.jsonArray) {
            val o = c.jsonObject
            val got = CoachMistakeLesson.parse(o["raw"]!!.str)
            val want = o["parsed"]
            if (want == null || want is JsonNull) {
                assertEquals(null, got, "parse ${o["raw"]}")
                continue
            }
            val w = want.jsonObject
            assertEquals(w["lesson_id"]?.str, got?.lessonId)
            assertEquals(w["completed"]!!.jsonPrimitive.boolean, got?.completed)
            assertEquals(w["title"]!!.str, got?.spec?.title)
            assertEquals(w["exercises"]!!.jsonPrimitive.content.toInt(), got?.let { CoachMistakeLesson.exerciseCount(it.spec) })
        }
    }

    @Test
    fun practiseMatchesTypeScript() {
        val f = fixture()
        val cases = f["practise"]!!.jsonArray
        assertTrue(cases.size >= 10)
        for (c in cases) {
            val o = c.jsonObject
            val transcript = o["transcript"]!!.str!!
            val target = o["target"]!!.str!!
            val p = CoachPractise.practise(transcript, target)
            val what = "'$transcript' for '$target'"
            assertEquals(o["said"]!!.str, p.said, "said $what")
            assertEquals(o["verdict"]!!.str, AnswerKey.verdictName(p.verdict), "verdict $what")
            assertEquals(o["state"]!!.str, SpokenAnswerResult.stateName(p.result.state), "state $what")
            assertEquals(
                o["chars"]!!.jsonArray.map { it.jsonObject["char"]!!.str + ":" + it.jsonObject["mark"]!!.str },
                p.result.chars.map { it.char + ":" + SpokenAnswerResult.markName(it.mark) },
                "marks $what",
            )
            assertEquals(o["outcome"]!!.str, CoachPractise.outcome(p, null), "outcome $what")
        }
        for (c in f["practiseBlocks"]!!.jsonArray) {
            val o = c.jsonObject
            val blocked = o["blocked"]?.str
            assertEquals(o["note"]?.str, CoachPractise.blockNote(blocked), "note $blocked")
            assertEquals(o["mic"]!!.jsonPrimitive.boolean, CoachPractise.micEnabled(blocked), "mic $blocked")
        }
        for (c in f["practiseOutcomes"]!!.jsonArray) {
            val o = c.jsonObject
            assertEquals(o["outcome"]!!.str, CoachPractise.outcome(null, o["failure"]?.str))
        }
        val copy = f["practiseCopy"]!!.jsonObject
        assertEquals(copy["respond"]!!.str, CoachPractise.RESPOND_LABEL)
        assertEquals(copy["label"]!!.str, CoachPractise.LABEL)
        assertEquals(copy["stop"]!!.str, CoachPractise.STOP)
        assertEquals(copy["again"]!!.str, CoachPractise.AGAIN)
        assertEquals(copy["listen"]!!.str, CoachPractise.LISTEN)
        assertEquals(copy["listening"]!!.str, CoachPractise.LISTENING)
        assertEquals(copy["checking"]!!.str, CoachPractise.CHECKING)
        assertEquals(copy["offline"]!!.str, CoachPractise.OFFLINE)
        assertEquals(copy["empty"]!!.str, CoachPractise.EMPTY)
    }
}
