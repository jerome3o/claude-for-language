package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The review of a handwriting run (web: StrokeRunView.tsx) and the preview's `renderable`. */
class StrokeRunReviewTest {
    private val json = """
        {"text":"你好","mode":"recall","grade":"good","skipped":["龘"],
         "characters":[
           {"character":"你","grade":"perfect","mistakes":0,"hints":0,"revealed":0,"ms":3450,"accuracy":1,
            "strokes":[{"misses":0,"mistakes":[],"hinted":false,"revealed":false,"drawn":[[100,700],[300,500]]}]},
           {"character":"好","grade":"practice","mistakes":3,"hints":1,"revealed":1,"ms":12000,"accuracy":0.5,
            "strokes":[
              {"misses":2,"mistakes":["wrong_direction","wrong_stroke"],"hinted":false,"revealed":false,"drawn":[[1,2],[3,4],[5,6]]},
              {"misses":1,"mistakes":["wrong_direction"],"hinted":true,"revealed":false,"drawn":[[1,2]]},
              {"misses":0,"mistakes":[],"hinted":false,"revealed":true}
            ]}
         ]}
    """.trimIndent()

    private val run = StrokeRunReview.parse(Json.parseToJsonElement(json))!!

    @Test fun parsesTheSummary() {
        assertEquals("你好", run.text)
        assertEquals(listOf("你", "好"), run.characters.map { it.character })
        assertEquals(listOf(StrokePoint(100.0, 700.0), StrokePoint(300.0, 500.0)), run.characters[0].strokes[0].drawn)
        assertNull(run.characters[1].strokes[2].drawn)
    }

    @Test fun strokeColourOrder() {
        val s = run.characters[1].strokes
        assertEquals(StrokeTone.FIRST_TRY, StrokeRunReview.tone(run.characters[0].strokes[0]))
        assertEquals(StrokeTone.AFTER_MISS, StrokeRunReview.tone(s[0]))
        assertEquals(StrokeTone.HINTED, StrokeRunReview.tone(s[1]))
        assertEquals(StrokeTone.SHOWN, StrokeRunReview.tone(s[2]))
        // Revealed wins over hinted and misses.
        assertEquals(StrokeTone.SHOWN, StrokeRunReview.tone(RunStroke(misses = 2, hinted = true, revealed = true)))
    }

    @Test fun inkNeedsTwoPoints() {
        assertTrue(StrokeRunReview.hasInk(run.characters[1].strokes[0]))
        assertFalse(StrokeRunReview.hasInk(run.characters[1].strokes[1]))
        assertFalse(StrokeRunReview.hasInk(run.characters[1].strokes[2]))
    }

    @Test fun labelsMatchTheWeb() {
        assertEquals("From memory · Good", StrokeRunReview.heading(run))
        assertEquals("Traced over the outline · Needs practice", StrokeRunReview.heading(run.copy(mode = "trace", grade = "practice")))
        assertEquals("你 · Perfect", StrokeRunReview.characterLabel(run.characters[0]))
        assertEquals("no mistakes · 3.5 s", StrokeRunReview.detail(run.characters[0]))
        assertEquals("3 mistakes · 1 hint · 1 shown · 12.0 s", StrokeRunReview.detail(run.characters[1]))
        assertEquals("1 mistake · 2 hints · 12.0 s", StrokeRunReview.detail(run.characters[1].copy(mistakes = 1, hints = 2, revealed = 0)))
        assertNull(StrokeRunReview.mistakeKinds(run.characters[0]))
        assertEquals("wrong direction, wrong stroke", StrokeRunReview.mistakeKinds(run.characters[1]))
        // Like JS String.replace with a string: only the first underscore.
        assertEquals("too far_off", StrokeRunReview.mistakeKinds(run.characters[0].copy(strokes = listOf(RunStroke(mistakes = listOf("too_far_off"))))))
        assertEquals("No stroke data for 龘.", StrokeRunReview.skippedLine(run))
        assertNull(StrokeRunReview.skippedLine(run.copy(skipped = emptyList())))
    }

    @Test fun notARun() {
        assertNull(StrokeRunReview.parse(null))
        assertNull(StrokeRunReview.parse(Json.parseToJsonElement("""{"strokes":[]}""")))
        assertNull(StrokeRunReview.parse(Json.parseToJsonElement("[1,2]")))
        // Lenient: missing fields default, characters without a character are dropped.
        val r = StrokeRunReview.parse(Json.parseToJsonElement("""{"characters":[{"character":"人"},{"grade":"good"}]}"""))!!
        assertEquals(1, r.characters.size)
        assertEquals("no mistakes · 0.0 s", StrokeRunReview.detail(r.characters[0]))
    }

    @Test fun renderableGuardsHalfTypedExercises() {
        assertTrue(Lessons.renderable(NoteExercise(title = "")))
        assertFalse(Lessons.renderable(ScrambleExercise(tiles = emptyList(), correctOrder = listOf("我"))))
        assertFalse(Lessons.renderable(ChoiceExercise(options = listOf(LessonSentence("a"), LessonSentence("b")), correct = 2)))
        assertTrue(Lessons.renderable(ChoiceExercise(options = listOf(LessonSentence("a"), LessonSentence("b")), correct = 1)))
        assertFalse(Lessons.renderable(ListenChoiceExercise(options = listOf(LessonSentence("a")), correct = 0)))
        assertFalse(Lessons.renderable(MatchExercise(listOf(MatchPair("一", english = "one")))))
        assertFalse(Lessons.renderable(SentenceMakingExercise(words = emptyList())))
        val speakers = listOf(ConversationSpeaker("A"), ConversationSpeaker("B"))
        val q = listOf(ConversationQuestion(question = "?"))
        assertTrue(Lessons.renderable(ConversationExercise(speakers = speakers, lines = listOf(ConversationLine(1, "你好")), questions = q)))
        assertFalse(Lessons.renderable(ConversationExercise(speakers = speakers, lines = listOf(ConversationLine(2, "你好")), questions = q)))
    }

    @Test fun decodeSpecNeverThrows() {
        assertNull(Lessons.decodeSpec(null))
        assertNull(Lessons.decodeSpec(Json.parseToJsonElement("""{"sections":"nope"}""")))
        val ok = Lessons.decodeSpec(Json.parseToJsonElement("""{"title":"T","sections":[{"exercises":[{"type":"note","body":"hi"},{"type":"future_type"}]}]}"""))!!
        assertEquals(2, ok.sections[0].exercises.size)
    }
}
