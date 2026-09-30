package dev.jeromeswannack.chineselearning.lab.ui.lessons

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonSection
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonProgressStore
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRecording
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * A mini lesson left half-way comes back where it was — after the process died too — on the
 * same day and spec; "Start over", another day, an edited spec and completing it clear it.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class LessonResumeFlowTest {
    @get:Rule val compose = createComposeRule()
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val utc = ZoneId.of("UTC")
    private val spec = CustomLessonSpec("把 sentences", sections = listOf(LessonSection(exercises = listOf(LessonSamples.note, LessonSamples.choice))))
    private val hash = LessonProgressStore.specHash(spec)
    private val now = 1_790_000_000_000L // 2026-09-21 14:13 UTC

    @Before fun clean() {
        context.getSharedPreferences("lab_lesson_progress", Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** A fresh store on the same SharedPreferences: what a new process reads. */
    private fun newProcess() = LessonProgressStore(context) { utc }

    private fun saveAfterFirstExercise(store: LessonProgressStore, recording: File? = null) = store.save(
        "L1", hash, index = 1, correct = 0, total = 0, startedAt = now - 60_000,
        attempts = listOf(ExerciseAttempt(0, 0, "note", durationMs = 20_000)),
        recordings = listOfNotNull(recording?.let { LessonRecording("s0e1", it, "audio/mp4") }),
        nowMs = now,
    )

    @Test fun survivesProcessDeathOnTheSameDay() {
        val take = File(context.filesDir, "take.m4a").apply { writeText("aac") }
        saveAfterFirstExercise(newProcess(), take)
        val restored = assertNotNull(newProcess().restore("L1", hash, exerciseCount = 2, nowMs = now + 3_600_000))
        assertEquals(1, restored.index)
        assertEquals("note", restored.attempts.single().type)
        assertEquals(take.absolutePath, restored.recordings.single().path)
    }

    @Test fun anotherDayOrAnEditedSpecStartsFreshAndClears() {
        val take = File(context.filesDir, "take2.m4a").apply { writeText("aac") }
        saveAfterFirstExercise(newProcess(), take)
        assertNull(newProcess().restore("L1", hash, 2, nowMs = now + 86_400_000))
        assertFalse(newProcess().has("L1"))
        assertFalse(take.exists()) // a take nobody will send is thrown away

        saveAfterFirstExercise(newProcess())
        val edited = LessonProgressStore.specHash(spec.copy(title = "把 sentences (v2)"))
        assertNull(newProcess().restore("L1", edited, 2, nowMs = now))
        assertFalse(newProcess().has("L1"))
    }

    @Test fun thePlayerContinuesWhereItWasAndStartOverClears() {
        saveAfterFirstExercise(newProcess())
        val store = newProcess()
        // Restored at a fixed "now" (lessonResumeHandle would use the wall clock).
        val handle = LessonResumeHandle(store.restore("L1", hash, 2, now + 1_000), onStartOver = { store.clear("L1", deleteRecordings = true) })
        assertNotNull(handle.saved)
        compose.setContent {
            LabTheme {
                LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = handle)
            }
        }
        compose.onNodeWithTag(CONTINUE_TAG).assertIsDisplayed()
        compose.onNodeWithText("Continuing where you left off · 2 of 2").assertIsDisplayed()
        compose.onNodeWithText(LessonSamples.choice.question).assertIsDisplayed() // straight to exercise 2
        compose.onNodeWithText("Start over").performClick()
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodesWithTag(CONTINUE_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText(LessonSamples.note.body!!.split("\n\n")[0]).assertIsDisplayed() // back to exercise 1
        assertFalse(store.has("L1"))
    }

    @Test fun thePlayerSavesAfterEveryExercise() {
        val store = newProcess()
        compose.setContent {
            LabTheme {
                LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Today, previews = null, onComplete = {}, onEnd = {}, resume = lessonResumeHandle(store, "L1", spec))
            }
        }
        compose.onNodeWithText("Continue").performClick() // the note → exercise 2
        compose.waitForIdle()
        val saved = assertNotNull(newProcess().restore("L1", hash, 2))
        assertEquals(1, saved.index)
        assertEquals(1, saved.attempts.size)
    }

    @Test fun previewsNeverRestore() {
        saveAfterFirstExercise(newProcess())
        val store = newProcess()
        val handle = LessonResumeHandle(store.restore("L1", hash, 2, now + 1_000))
        compose.setContent {
            LabTheme { LessonPlayer("把 sentences", "🧱", spec, ExerciseEnv(), PlayerContext.Preview, previews = null, onComplete = {}, onEnd = {}, resume = handle) }
        }
        assertEquals(0, compose.onAllNodesWithTag(CONTINUE_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithText(LessonSamples.note.body!!.split("\n\n")[0]).assertIsDisplayed()
        assertTrue(store.has("L1")) // untouched
    }
}
