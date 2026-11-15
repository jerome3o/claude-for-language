package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.ScrambleExercise
import dev.jeromeswannack.chineselearning.lab.core.TakeLock
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.LocalTakeLock
import dev.jeromeswannack.chineselearning.lab.ui.kit.ReportTake
import dev.jeromeswannack.chineselearning.lab.ui.kit.TakeLockState
import dev.jeromeswannack.chineselearning.lab.ui.kit.TakeLockTags
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.random.Random
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The take lock in a lesson (core TakeLock; Jerome: the tap meant to stop 🎤 Say it again pressed Continue and skipped
 * the exercise): word order checked → a take recording → Continue IS "■ Stop recording" (stops the take, never
 * advances) → the take stopped → Continue advances. The answer's sentence is words to explore with ▶.
 */
class TakeLockUiTest : LabScreenshotTest() {
    private val homework = ScrambleExercise("I finished my homework.", listOf("作业", "我", "做完了", "把"), listOf("我", "把", "作业", "做完了"))

    @Test
    fun continueIsStopRecordingWhileATakeRecords() {
        var phase by mutableStateOf(TakeLock.IDLE)
        var stops = 0
        var advanced: Boolean? = null
        val lock = TakeLockState()
        compose.setContent {
            LabTheme {
                CompositionLocalProvider(LocalTakeLock provides lock) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        ReportTake(phase) { stops++; phase = TakeLock.CHECKING }
                        ExerciseView(homework, ExerciseEnv(random = Random(3)), null) { c, _, _ -> advanced = c }
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        for (tile in homework.correctOrder) {
            compose.onAllNodesWithText(tile).onFirst().performClick()
            compose.mainClock.advanceTimeBy(200)
        }
        compose.onAllNodesWithText("Check").onFirst().performClick()
        compose.mainClock.advanceTimeBy(800)
        // Checked: the right sentence with ▶, his blocks to explore.
        assertTrue(compose.onAllNodesWithTag("scramble-correct-sentence").fetchSemanticsNodes().isNotEmpty())
        assertTrue(compose.onAllNodesWithTag("lesson-replay").fetchSemanticsNodes().isNotEmpty())
        assertEquals(4, compose.onAllNodesWithTag("scramble-answer-tile").fetchSemanticsNodes().size)

        phase = TakeLock.RECORDING
        compose.mainClock.advanceTimeBy(500)
        assertTrue(compose.onAllNodesWithText("Continue").fetchSemanticsNodes().isEmpty())
        compose.onRoot().captureRoboImage("screenshots/lesson-take-lock-01-recording.png")
        compose.onAllNodesWithTag(TakeLockTags.STOP).onFirst().performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(1, stops)
        assertEquals(null, advanced)
        assertTrue(compose.onAllNodesWithText(TakeLock.CHECKING_LINE).fetchSemanticsNodes().isNotEmpty())

        phase = TakeLock.IDLE
        compose.mainClock.advanceTimeBy(500)
        assertTrue(compose.onAllNodesWithTag(TakeLockTags.STOP).fetchSemanticsNodes().isEmpty())
        compose.onAllNodesWithText("Continue").onFirst().performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(true, advanced)
    }

    @Test
    fun leavingWhileRecordingStopsTheTakeFirst() {
        val lock = TakeLockState()
        var stops = 0
        var left = 0
        compose.setContent {
            CompositionLocalProvider(LocalTakeLock provides lock) { ReportTake(TakeLock.RECORDING) { stops++ } }
        }
        compose.mainClock.advanceTimeBy(300)
        lock.guardLeave { left++ }
        assertEquals(1, stops)
        assertEquals(0, left)
        assertEquals(false, lock.mayProceed())
    }
}
