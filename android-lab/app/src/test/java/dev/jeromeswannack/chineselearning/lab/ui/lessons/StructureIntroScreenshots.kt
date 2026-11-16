package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonJson
import dev.jeromeswannack.chineselearning.lab.core.LessonPatternIntro
import dev.jeromeswannack.chineselearning.lab.core.LessonPatterns
import dev.jeromeswannack.chineselearning.lab.core.NoteExercise
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipPlayState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.core.spec.LessonCatalogue
import dev.jeromeswannack.chineselearning.lab.data.clips.ClipStore
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.clips.ClipPlayer
import dev.jeromeswannack.chineselearning.lab.ui.clips.ClipPlayerActions
import dev.jeromeswannack.chineselearning.lab.ui.clips.SpeechClock
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * "▶ Watch the intro" (docs/STUDY_SESSION.md "Structure intro"): frames of the catalogue sample's first structure as
 * an intro clip — the title, the pattern building, an example with a part lit as it is read, the end card.
 */
class StructureIntroScreenshots : LabScreenshotTest() {
    private val note: NoteExercise
        get() = LessonJson.decodeFromJsonElement(CustomLessonSpec.serializer(), LessonCatalogue.sample("note")!!.spec).sections[0].exercises[0] as NoteExercise

    private val card: LessonPatterns.Card
        get() = assertNotNull(LessonPatterns.noteView(note.body, note.sentences, note.patterns)).cards[0]

    private fun frame(name: String, state: ClipPlayState, speech: SpeechClock? = null, dark: Boolean = false) {
        val spec = LessonPatternIntro.clip(card)
        val clip = ClipRecord(id = "intro", status = "ready", source = "generated", title = spec.title, spec = spec)
        compose.setContent {
            LabTheme(dark = dark) {
                ClipPlayer(clip, active = true, prefs = ClipStore.CaptionPrefs(), actions = ClipPlayerActions(), animate = false, clock = false, previewState = state, previewSpeech = speech, introDone = {})
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onRoot().captureRoboImage("screenshots/$name.png")
    }

    @Test fun usesTheAuthoredIntro() {
        val lines = LessonPatternIntro.lines(card)
        assertEquals("今天我们学“把”字句。", lines.first().zh)
        assertEquals("pattern", LessonPatternIntro.clip(card).scenes[1].layout)
    }

    @Test fun title() = frame("structure-intro-01-title", ClipPlayState(0, 800.0, null, false))
    @Test fun pattern() = frame("structure-intro-02-pattern", ClipPlayState(1, 2500.0, null, false))
    @Test fun example() {
        val spec = LessonPatternIntro.clip(card)
        val i = spec.scenes.indexOfFirst { it.pattern?.example != null }
        val hanzi = spec.scenes[i].pattern!!.example!!.hanzi
        frame("structure-intro-03-example", ClipPlayState(i, 2500.0, null, false), SpeechClock(i, 0, hanzi, "zh", { 900L }, { 2600L }, live = false))
    }
    @Test fun exampleDark() {
        val spec = LessonPatternIntro.clip(card)
        val i = spec.scenes.indexOfFirst { it.pattern?.example != null }
        val hanzi = spec.scenes[i].pattern!!.example!!.hanzi
        frame("structure-intro-04-example-dark", ClipPlayState(i, 2500.0, null, false), SpeechClock(i, 0, hanzi, "zh", { 1700L }, { 2600L }, live = false), dark = true)
    }
    @Test fun end() {
        val n = LessonPatternIntro.clip(card).scenes.size
        frame("structure-intro-05-end", ClipPlayState(n - 1, 0.0, null, true))
    }
}
