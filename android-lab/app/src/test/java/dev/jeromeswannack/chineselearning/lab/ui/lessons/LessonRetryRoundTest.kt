package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
 * The retry round (Jerome: "at the end of the lesson, go over all the things you didn't get"):
 * a wrong answer on the main pass is owed — the bar grows an orange part at its right end — and
 * comes back after the last exercise until it is right; the completion's outcome keeps the miss
 * (a revision in a week), there is no rating, and the end says so.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class LessonRetryRoundTest {
    @get:Rule val compose = createComposeRule()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice))))

    @Before fun clean() {
        context.getSharedPreferences("lab_lesson_progress", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun aMistakeComesBackAtTheEndUntilRight() {
        val store = LessonProgressStore(context)
        var result: LessonResult? = null
        compose.setContent {
            LabTheme {
                LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(random = kotlin.random.Random(1)), PlayerContext.Lesson(), onComplete = { result = it }, onEnd = {}, resume = lessonResumeHandle(store, "L1", spec))
            }
        }
        compose.onNodeWithText("Continue").performClick() // the note
        compose.onNodeWithText(LessonSamples.choice.options[1].hanzi).performClick() // wrong
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        // The retry round: the choice again, the line over it, the bar's orange "↺ 1".
        compose.onNodeWithTag(LESSON_RETRY_TAG).assertIsDisplayed()
        compose.onNodeWithText("🔁 Let's put this one right · last one").assertIsDisplayed()
        compose.onNodeWithText("↺ 1").assertIsDisplayed()
        compose.onNodeWithText(LessonSamples.choice.question).assertIsDisplayed()
        // Saved mid-retry: closing now would continue in the retry round.
        assertEquals(listOf("s0e1"), assertNotNull(LessonProgressStore(context).restore("L1", LessonProgressStore.shape(spec))).state.owed)
        compose.onNodeWithText(LessonSamples.choice.options[0].hanzi).performClick() // right
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        val r = assertNotNull(result)
        assertEquals(listOf("s0e1"), r.outcome.missed)
        assertEquals(listOf(1), r.attempt.exercises.mapNotNull { it.retry })
        compose.onNodeWithTag(LESSON_END_TAG).assertIsDisplayed()
        compose.onNodeWithText("Back in a week as a revision: the 1 you missed first time + a few you got").assertIsDisplayed()
        compose.onNodeWithTag(LESSON_DONE_TAG).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithText("Good", substring = true).fetchSemanticsNodes().size) // no rating
    }

    @Test fun allRightFirstTimeIsDoneForGood() {
        var result: LessonResult? = null
        compose.setContent {
            LabTheme { LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(random = kotlin.random.Random(1)), PlayerContext.Lesson(), onComplete = { result = it }, onEnd = {}) }
        }
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText(LessonSamples.choice.options[0].hanzi).performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(emptyList<String>(), assertNotNull(result).outcome.missed)
        compose.onNodeWithText("All right first time — done for good! 🎉").assertIsDisplayed()
    }
}
