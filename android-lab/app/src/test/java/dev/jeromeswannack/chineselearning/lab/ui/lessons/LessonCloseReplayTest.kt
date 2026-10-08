package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Jerome, 8 Oct: "I was on the front page of it, closed out of it, went back, opened it, closed
 * out of it — I think that sets them as done." It never did (every completion on the server has
 * a rating and an attempt): closing calls onEnd only. What changes now: opening a lesson makes it
 * today's (it can't vanish from today's list), coming back to it says so, and a lesson can be
 * replayed outside the session ("▶ Do it again", with Practice only when it isn't due).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class LessonCloseReplayTest {
    @get:Rule val compose = createComposeRule()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val spec = CustomLessonSpec("China trip 1", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice))))
    private val oneNote = CustomLessonSpec("Before you go", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note))))
    private val previews = ItemSchedule.previews(RevisitState.INITIAL)

    @Before fun clean() {
        context.getSharedPreferences("lab_lesson_progress", Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test fun closingOnTheIntroRecordsNothingAndTheLessonStaysTodays() {
        val store = LessonProgressStore(context)
        var completed = 0
        var ended = 0
        compose.setContent {
            LabTheme {
                LessonPlayer("China trip 1", "✈️", spec, ExerciseEnv(), PlayerContext.Today, previews = previews,
                    onComplete = { completed++ }, onEnd = { ended++ }, resume = lessonResumeHandle(store, "trip1", spec))
            }
        }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("End session").performClick()
        compose.waitForIdle()
        assertEquals(1, ended)
        assertEquals(0, completed) // ✕ never completes
        assertFalse(store.has("trip1")) // nothing answered: nothing saved
        assertTrue("trip1" in store.startedToday()) // but it is today's lesson now
        assertTrue(store.startedTodayBefore("trip1"))
    }

    @Test fun openingItAgainSaysItIsTodaysLesson() {
        val store = LessonProgressStore(context)
        store.markStarted("trip1") // opened earlier and closed on the intro
        compose.setContent {
            LabTheme {
                LessonPlayer("China trip 1", "✈️", spec, ExerciseEnv(), PlayerContext.Today, previews = previews,
                    onComplete = {}, onEnd = {}, resume = lessonResumeHandle(store, "trip1", spec))
            }
        }
        compose.onNodeWithText("Back to today's lesson · 1 of 2").assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithText("Start over").fetchSemanticsNodes().size)
    }

    @Test fun aReplayThatIsNotDueOffersPracticeOnlyWhichRecordsNothing() {
        var completed = 0
        var practiced = 0
        compose.setContent {
            LabTheme {
                LessonPlayer("Before you go", "✈️", oneNote, ExerciseEnv(), PlayerContext.Replay(practice = true), previews = previews,
                    onComplete = { completed++ }, onEnd = {}, onPracticeDone = { practiced++ })
            }
        }
        compose.onNodeWithText("Mini lesson · again").assertIsDisplayed()
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(PRACTICE_ONLY_TAG).performClick()
        compose.waitForIdle()
        assertEquals(1, practiced)
        assertEquals(0, completed)
    }

    @Test fun aReplayThatIsDueIsANormalRun() {
        var completed = 0
        compose.setContent {
            LabTheme {
                LessonPlayer("Before you go", "✈️", oneNote, ExerciseEnv(), PlayerContext.Replay(practice = false), previews = previews,
                    onComplete = { completed++ }, onEnd = {})
            }
        }
        compose.onNodeWithText("Continue").performClick()
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodesWithTag(PRACTICE_ONLY_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText("Good").performClick()
        compose.waitForIdle()
        assertEquals(1, completed)
    }
}

private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithText(text: String) =
    onAllNodes(androidx.compose.ui.test.hasText(text))
