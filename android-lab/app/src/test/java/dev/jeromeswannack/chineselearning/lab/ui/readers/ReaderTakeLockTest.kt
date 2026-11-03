package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.ReadAloud
import dev.jeromeswannack.chineselearning.lab.data.api.GradedReaderDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The reading view locks around a 🎤 Read it aloud take (Jerome: "accidentally clicked next"): while
 * it records, Previous / Next give way to ONE big red ■ Stop recording, the audio row and ▶ Play
 * whole story are disabled, system back and a guarded ✕ stop the take instead of leaving; then
 * "Checking your reading…" until the result; the whole page read right throws confetti. Plus the
 * screenshots.
 */
class ReaderTakeLockTest : LabScreenshotTest() {
    private val text = "早上好。我叫小徐。"
    private val words = listOf(
        ReaderWordDto("早上", "zǎoshang", "morning"), ReaderWordDto("好", "hǎo", "good"), ReaderWordDto("。", "", ""),
        ReaderWordDto("我", "wǒ", "I"), ReaderWordDto("叫", "jiào", "am called"), ReaderWordDto("小徐", "Xiǎo Xú", "Xiao Xu"), ReaderWordDto("。", "", ""),
    )
    private val reader = GradedReaderDto(
        "r1", "小徐的早上", "Xiao Xu's morning", "beginner",
        pages = listOf(
            ReaderPageDto("p1", 1, text, "Zǎoshang hǎo. Wǒ jiào Xiǎo Xú.", "Good morning. My name is Xiao Xu.", words = words),
            ReaderPageDto("p2", 2, "他在游泳。", "Tā zài yóuyǒng.", "He is swimming.", words = listOf(
                ReaderWordDto("他", "tā", "he"), ReaderWordDto("在", "zài", "is (doing)"), ReaderWordDto("游泳", "yóuyǒng", "swim"), ReaderWordDto("。", "", ""),
            )),
        ),
    )
    private val clip: File by lazy { File.createTempFile("clip", ".mp3") }
    private val env = ReaderEnv(
        pageAudio = { _, _ -> clip },
        analyze = { _, _ -> sampleClipAnalysis(5200, listOf(AudioBlocks.Block(0, 2600), AudioBlocks.Block(2600, 5200)), List(96) { i -> if (i % 48 in 4..40) (0.35 + 0.6 * Math.abs(Math.sin(i * 1.3))).toFloat() else 0.03f }) },
    )

    @Composable
    private fun View(handle: ReadAloudHandle, lock: ReaderTakeLock = rememberReaderTakeLock()) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            StudyReaderView(SessionReader(reader, 1), env, onFinish = { _, _ -> }, takeLock = lock, readAloudPreview = handle)
        }
    }

    @Test
    fun recordingLocksThePageAndStopRestoresIt() {
        var ui by mutableStateOf(ReadAloudUi())
        var perfect by mutableIntStateOf(0)
        var stops = 0
        var left = 0
        var closed = 0
        lateinit var dispatcher: OnBackPressedDispatcher
        val lock = ReaderTakeLock()
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme {
                dispatcher = LocalOnBackPressedDispatcherOwner.current!!.onBackPressedDispatcher
                // The route's own back (leaving the story): only when nothing is under way.
                BackHandler { left++ }
                val handle = ReadAloudHandle(
                    ui,
                    ReadAloudActions(onStop = { if (ui.phase == "listening") { stops++; ui = ui.copy(phase = "finishing") } }),
                    perfect,
                )
                View(handle, lock)
            }
        }
        compose.mainClock.advanceTimeBy(1_500)
        compose.onNodeWithText("Next").assertIsDisplayed()
        compose.onNodeWithTag(READER_PLAY_STORY_TAG).assertIsEnabled()
        assertFalse(lock.locked)

        // Recording: the footer is ONE big red Stop; nothing turns the page; the story is disabled.
        ui = ReadAloudUi(phase = "listening", finalText = "早上好")
        compose.mainClock.advanceTimeBy(800)
        assertTrue(lock.locked)
        compose.onNodeWithTag(ReadAloudTags.STOP_FOOTER).assertIsDisplayed().assertContentDescriptionEquals(ReadAloud.STOP_RECORDING)
        assertEquals(0, compose.onAllNodes(hasText("Next")).fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodes(hasText("Previous")).fetchSemanticsNodes().size)
        compose.onNodeWithTag(READER_PLAY_STORY_TAG).assertIsNotEnabled()
        compose.onNodeWithTag("reader-speed-chip").assertIsNotEnabled()
        // The in-row ⏹ stays.
        compose.onNodeWithTag(ReadAloudTags.MIC).assertContentDescriptionEquals(ReadAloud.STOP)

        // A guarded ✕ stops the take instead of closing.
        lock.guard { closed++ }()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(0, closed)
        assertEquals(1, stops)
        compose.onNodeWithTag(ReadAloudTags.STOP_FOOTER).assertContentDescriptionEquals(ReadAloud.CHECKING).assertIsNotEnabled()

        // Back while it is being checked: stays on the page (nothing to stop, nothing left).
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.mainClock.advanceTimeBy(300)
        assertEquals(0, left)

        // The result lands: unlocked, Next is back. Not all right: no confetti.
        ui = ReadAloudUi(result = ReadAloud.judge(text, "我叫小许"), said = "我叫小许")
        compose.mainClock.advanceTimeBy(800)
        assertFalse(lock.locked)
        compose.onNodeWithText("Next").assertIsDisplayed()
        assertEquals(0, compose.onAllNodes(hasTestTag(ReadAloudTags.STOP_FOOTER)).fetchSemanticsNodes().size)
        compose.onNodeWithTag(READER_PLAY_STORY_TAG).assertIsEnabled()
        assertEquals(0, compose.onAllNodes(hasTestTag(ReadAloudTags.CONFETTI)).fetchSemanticsNodes().size)
        lock.guard { closed++ }()
        assertEquals(1, closed)

        // System back while recording stops the take; the footer's Stop does too.
        ui = ReadAloudUi(phase = "listening")
        compose.mainClock.advanceTimeBy(500)
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.mainClock.advanceTimeBy(300)
        assertEquals(2, stops)
        assertEquals(0, left)
        ui = ReadAloudUi(phase = "listening")
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(ReadAloudTags.STOP_FOOTER).performClick()
        compose.mainClock.advanceTimeBy(300)
        assertEquals(3, stops)

        // The whole page read right: confetti over the reading view.
        val all = ReadAloud.judge(text, "早上好，我叫小徐。")
        assertTrue(ReadAloud.allRight(all))
        ui = ReadAloudUi(result = all, said = "早上好，我叫小徐。")
        perfect = 1
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithTag(ReadAloudTags.CONFETTI).assertExists()
        // Unlocked, the page turns again; back leaves.
        compose.runOnIdle { dispatcher.onBackPressed() }
        assertEquals(1, left)
    }

    private fun handle(ui: ReadAloudUi, perfect: Int = 0) = ReadAloudHandle(ui, ReadAloudActions(), perfect)

    @Test fun recording() = shoot("readers-45-read-aloud-recording-locked", settleMs = 2_500) {
        View(handle(ReadAloudUi(phase = "listening", finalText = "早上好。我叫", partialText = "小徐")))
    }

    @Test fun recordingDark() = shoot("readers-45-read-aloud-recording-locked-dark", dark = true, settleMs = 2_500) {
        View(handle(ReadAloudUi(phase = "listening", finalText = "早上好。我叫", partialText = "小徐")))
    }

    @Test fun checking() = shoot("readers-46-read-aloud-checking", settleMs = 2_500) {
        View(handle(ReadAloudUi(phase = "finishing")))
    }

    /** Caught mid-burst: the clock is stepped by hand (an auto-advancing clock runs the burst to its end before the capture). */
    @Test fun perfectConfetti() {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            LabTheme { View(handle(ReadAloudUi(result = ReadAloud.judge(text, "早上好，我叫小徐。"), said = "早上好，我叫小徐。"), perfect = 1)) }
        }
        compose.mainClock.advanceTimeBy(1_600)
        compose.onRoot().captureRoboImage("screenshots/readers-47-read-aloud-perfect-confetti.png")
    }
}
