package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * ↺ Undo in the lesson player (docs/STUDY_SESSION.md "Mini lessons" → "Undo"): Jerome tapped "✓ Got it" on a
 * translation he had wrong. ↺ brings it back on its answer side, "✗ Missed it" makes it owed in the retry round,
 * and the completion's outcome has it missed; an auto-checked exercise comes back fresh; the frames are saved
 * with the run.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class LessonUndoTest {
    @get:Rule val compose = createComposeRule()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.translate, LessonSamples.choice))))

    @Before fun clean() {
        context.getSharedPreferences("lab_lesson_progress", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun gotItByMistakeIsTakenBackAndRegraded() {
        val store = LessonProgressStore(context)
        var result: LessonResult? = null
        compose.setContent {
            LabTheme {
                LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(random = kotlin.random.Random(1)), PlayerContext.Homework, onComplete = { result = it }, onEnd = {}, resume = lessonResumeHandle(store, "L1", spec))
            }
        }
        compose.onNodeWithTag(LESSON_UNDO_TAG).assertIsNotEnabled() // nothing answered yet
        compose.onNodeWithText("Continue").performClick() // the note
        compose.onNodeWithTag(LESSON_UNDO_TAG).assertIsEnabled()
        compose.onNodeWithText("Show answer").performClick()
        compose.onNodeWithText("✓ Got it").performClick() // by mistake
        compose.waitForIdle()
        compose.onNodeWithText(LessonSamples.choice.question).assertIsDisplayed()
        // Saved with the run: the frames of the note and the translation.
        assertEquals(2, assertNotNull(store.restore("L1", LessonProgressStore.shape(spec))).undo.size)

        // ↺: the translation is back on its answer side — no Show answer, Got it / Missed it again.
        compose.onNodeWithTag(LESSON_UNDO_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(LessonSamples.translate.english).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithText("Show answer").fetchSemanticsNodes().size)
        val back = assertNotNull(store.restore("L1", LessonProgressStore.shape(spec)))
        assertEquals(1, back.state.pos)
        assertEquals(1, back.attempts.size)
        assertEquals(1, back.undo.size)
        compose.onNodeWithText("✗ Missed it").performClick()
        compose.waitForIdle()

        // The choice: answered, ↺, and it comes back fresh (no Continue until picked again).
        compose.onNodeWithText(LessonSamples.choice.options[0].hanzi).performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(LESSON_RETRY_TAG).assertIsDisplayed()
        compose.onNodeWithTag(LESSON_UNDO_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText(LessonSamples.choice.question).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag(LESSON_RETRY_TAG).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodesWithText("Continue").fetchSemanticsNodes().size)
        compose.onNodeWithText(LessonSamples.choice.options[0].hanzi).performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()

        // The retry round: the translation he now says he missed.
        compose.onNodeWithText("🔁 Let's put this one right · last one").assertIsDisplayed()
        compose.onNodeWithText("Show answer").performClick()
        compose.onNodeWithText("✓ Got it").performClick()
        compose.waitForIdle()
        val r = assertNotNull(result)
        assertEquals(listOf("s0e1"), r.outcome.missed)
        assertEquals(listOf("s0e1", "s0e2"), r.outcome.keys)
        assertEquals(1, r.correct)
        assertEquals(2, r.total)
        // Only the final grades: note, translation missed, choice, the retry.
        assertEquals(listOf(null, false, true, true), r.attempt.exercises.map { it.correct })
        assertEquals(listOf(1), r.attempt.exercises.mapNotNull { it.retry })
        // The end records the completion: no ↺ on the finish screen.
        assertEquals(0, compose.onAllNodesWithTag(LESSON_UNDO_TAG).fetchSemanticsNodes().size)
    }
}
