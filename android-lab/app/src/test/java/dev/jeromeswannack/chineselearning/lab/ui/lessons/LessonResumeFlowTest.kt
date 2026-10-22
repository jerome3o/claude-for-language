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
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonRun
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore
import dev.jeromeswannack.chineselearning.lab.data.lessons.SavedLessonRun
import dev.jeromeswannack.chineselearning.lab.data.lessons.SavedRecording
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Jerome (Oct 2026): "Make sure homework progress isn't lost over multiple days" — a half-done
 * homework lesson reopened the next day had reset (runs were dropped on another local day, after
 * 18 h, or when the spec's JSON changed at all). A run now waits until it is finished or started
 * over: another day, a new process, a content fix — only a change in the lesson's SHAPE (the
 * exercise types) starts fresh. Closing records nothing.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class LessonResumeFlowTest {
    @get:Rule val compose = createComposeRule()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice))))
    private val shape = LessonProgressStore.shape(spec)
    private val now = 1_790_000_000_000L // 2026-09-21 14:13 UTC

    @Before fun clean() {
        context.getSharedPreferences("lab_lesson_progress", Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** A fresh store on the same SharedPreferences: what a new process reads. */
    private fun newProcess() = LessonProgressStore(context)

    private fun saveAfterFirstExercise(store: LessonProgressStore, recording: File? = null, savedAt: Long = now) = store.save(
        SavedLessonRun(
            "L1", shape, state = LessonRun.State(pos = 1), startedAt = now - 60_000, savedAt = savedAt,
            attempts = listOf(ExerciseAttempt(0, 0, "note", durationMs = 20_000)),
            recordings = listOfNotNull(recording?.let { SavedRecording("s0e1", it.absolutePath, "audio/mp4") }),
        ),
    )

    @Test fun survivesProcessDeathAndOtherDays() {
        val take = File(context.filesDir, "take.m4a").apply { writeText("aac") }
        // Saved three days ago, late in the evening: still there, recordings too.
        saveAfterFirstExercise(newProcess(), take, savedAt = now - 3 * 86_400_000L)
        val restored = assertNotNull(newProcess().restore("L1", shape))
        assertEquals(1, restored.state.pos)
        assertEquals("note", restored.attempts.single().type)
        assertEquals(take.absolutePath, restored.recordings.single().path)
        assertEquals(setOf("L1"), newProcess().inProgress().keys)
    }

    @Test fun aContentFixKeepsTheRunButANewShapeStartsFresh() {
        val take = File(context.filesDir, "take2.m4a").apply { writeText("aac") }
        saveAfterFirstExercise(newProcess(), take)
        // A pinyin fix / a picture drawn later: same exercise types, the run continues.
        val fixed = spec.copy(title = "把 sentences (v2)")
        assertNotNull(newProcess().restore("L1", LessonProgressStore.shape(fixed)))
        // An exercise added: another shape — fresh, and the take nobody will send is thrown away.
        val reshaped = spec.copy(sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice, LessonSamples.translate))))
        assertNull(newProcess().restore("L1", LessonProgressStore.shape(reshaped)))
        assertFalse(newProcess().has("L1"))
        assertFalse(take.exists())
    }

    @Test fun thePlayerContinuesWhereItWasAndStartOverClears() {
        saveAfterFirstExercise(newProcess())
        val store = newProcess()
        val handle = lessonResumeHandle(store, "L1", spec)
        assertNotNull(handle.saved)
        compose.setContent {
            LabTheme { LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = {}, onEnd = {}, resume = handle) }
        }
        compose.onNodeWithTag(CONTINUE_TAG).assertIsDisplayed()
        compose.onNodeWithText("Continue where you left off (2 of 2)").assertIsDisplayed()
        compose.onNodeWithText(LessonSamples.choice.question).assertIsDisplayed() // straight to exercise 2
        compose.onNodeWithText("Start over").performClick()
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodesWithTag(CONTINUE_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText(LessonSamples.note.body!!.split("\n\n")[0]).assertIsDisplayed() // back to exercise 1
        assertFalse(store.has("L1"))
    }

    @Test fun thePlayerSavesAfterEveryExerciseAndClosingRecordsNothing() {
        val store = newProcess()
        var completed = 0
        var ended = 0
        compose.setContent {
            LabTheme {
                LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Lesson(), onComplete = { completed++ }, onEnd = { ended++ }, resume = lessonResumeHandle(store, "L1", spec))
            }
        }
        compose.onNodeWithText("Continue").performClick() // the note → exercise 2
        compose.waitForIdle()
        val saved = assertNotNull(newProcess().restore("L1", shape))
        assertEquals(1, saved.state.pos)
        assertEquals(1, saved.attempts.size)
        compose.onNodeWithContentDescription("Close lesson").performClick()
        assertEquals(1, ended)
        assertEquals(0, completed)
        assertTrue(newProcess().has("L1")) // the run waits
    }

    @Test fun previewsNeverRestore() {
        saveAfterFirstExercise(newProcess())
        val store = newProcess()
        val handle = LessonResumeHandle(store.restore("L1", shape))
        compose.setContent {
            LabTheme { LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Preview, onComplete = {}, onEnd = {}, resume = handle) }
        }
        assertEquals(0, compose.onAllNodesWithTag(CONTINUE_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText(LessonSamples.note.body!!.split("\n\n")[0]).assertIsDisplayed()
        assertTrue(store.has("L1")) // untouched
    }
}
