package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.activity.OnBackPressedDispatcher
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalOnBackPressedDispatcherOwner
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.TakeLock
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.HardModeFeedbackPanel
import dev.jeromeswannack.chineselearning.lab.ui.study.HardModeTags
import dev.jeromeswannack.chineselearning.lab.ui.study.ReadAgainContent
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The take lock (docs/STUDY_SESSION.md "While a take is recording"; web services/takeLock.test.tsx): while a
 * take records, a row of advancing buttons gives way to ONE red ■ Stop recording (a tap stops the take, never
 * advances), then a held "Checking what you said…"; a guarded ✕ stops instead of closing; system back stops
 * the take instead of leaving. Plus the screenshots.
 */
class TakeLockTest : LabScreenshotTest() {
    @After fun clear() = TakeLocks.reset()

    @Test
    fun aRowGivesWayToStopAndComesBack() {
        var phase by mutableStateOf("idle")
        var stops = 0
        var nexts = 0
        var closes = 0
        compose.setContent {
            LabTheme {
                RegisterTake(phase) { stops++; phase = "finishing" }
                TakeLockedActions(stopTag = "row-stop") {
                    PrimaryPill("Next", Modifier.fillMaxWidth().height(52.dp).testTag("next")) { nexts++ }
                }
            }
        }
        compose.onNodeWithTag("next").assertIsDisplayed()

        phase = "listening"
        compose.waitForIdle()
        assertTrue(TakeLocks.recording)
        assertEquals(0, compose.onAllNodes(hasTestTag("next")).fetchSemanticsNodes().size)
        compose.onNodeWithTag("row-stop").assertContentDescriptionEquals(TakeLock.STOP_RECORDING).performClick()
        compose.waitForIdle()
        assertEquals(1, stops)
        assertEquals(0, nexts)
        compose.onNodeWithTag("row-stop").assertContentDescriptionEquals(TakeLock.CHECKING_LABEL).assertIsNotEnabled()

        // A guarded ✕ while it is checked: nothing happens.
        TakeLocks.guard { closes++ }()
        assertEquals(0, closes)

        phase = "review"
        compose.waitForIdle()
        assertFalse(TakeLocks.locked)
        compose.onNodeWithTag("next").performClick()
        assertEquals(1, nexts)
        TakeLocks.guard { closes++ }()
        assertEquals(1, closes)
    }

    @Test
    fun backStopsATakeInsteadOfLeaving() {
        var phase by mutableStateOf("idle")
        var stops = 0
        var left = 0
        lateinit var dispatcher: OnBackPressedDispatcher
        compose.setContent {
            LabTheme {
                dispatcher = LocalOnBackPressedDispatcherOwner.current!!.onBackPressedDispatcher
                // The screen's own back (leaving), composed first like a route's.
                BackHandler { left++ }
                TakeBackGuard()
                RegisterTake(phase) { stops++; phase = "finishing" }
            }
        }
        phase = "listening"
        compose.waitForIdle()
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.waitForIdle()
        assertEquals(1, stops)
        assertEquals(0, left)
        // Being checked: back waits.
        compose.runOnIdle { dispatcher.onBackPressed() }
        compose.waitForIdle()
        assertEquals(0, left)
        phase = "idle"
        compose.waitForIdle()
        compose.runOnIdle { dispatcher.onBackPressed() }
        assertEquals(1, left)
    }

    @Test
    fun ownBackTakesAreLeftToTheirScreen() {
        var left = 0
        lateinit var dispatcher: OnBackPressedDispatcher
        compose.setContent {
            LabTheme {
                dispatcher = LocalOnBackPressedDispatcherOwner.current!!.onBackPressedDispatcher
                BackHandler { left++ }
                TakeBackGuard()
                RegisterTake("listening", ownBack = true) {}
            }
        }
        assertTrue(TakeLocks.locked)
        compose.runOnIdle { dispatcher.onBackPressed() }
        assertEquals(1, left)
    }

    @Test
    fun hardModeReadAgainHoldsContinue() {
        var nexts = 0
        var stops = 0
        compose.setContent {
            LabTheme {
                RegisterTake("listening") { stops++ }
                HardModeFeedbackPanel(
                    result = "revealed", said = "银航", spoken = true, roundFollows = true,
                    onTryAgain = {}, onShowAnswer = {}, onNext = { nexts++ },
                    answer = Triple("银行", "yínháng", "bank"),
                )
            }
        }
        assertEquals(0, compose.onAllNodes(hasTestTag(HardModeTags.CONTINUE)).fetchSemanticsNodes().size)
        compose.onNodeWithTag(HardModeTags.TAKE_STOP).performClick()
        assertEquals(1, stops)
        assertEquals(0, nexts)
    }

    @Test
    fun screenshotReadAgain() {
        TakeLocks.reset()
        shoot("take-lock-01-hard-read-again") {
            RegisterTake("listening") {}
            Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
                Column {
                    HardModeFeedbackPanel(
                        result = "revealed", said = "银航", spoken = true, roundFollows = true,
                        onTryAgain = {}, onShowAnswer = {}, onNext = {},
                        answer = Triple("银行", "yínháng", "bank"),
                        readAgainPreview = {
                            ReadAgainContent(VoiceDictationUi(mode = "voice", phase = "listening", finalText = "银行"), null, 0, "银行", onMic = {}, onRetry = {})
                        },
                    )
                }
            }
        }
    }

    @Test
    fun screenshotChecking() {
        TakeLocks.reset()
        shoot("take-lock-02-checking") {
            RegisterTake("finishing") {}
            Box(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp)) {
                Column {
                    Text("银行", color = Lab.colors.ink)
                    TakeLockedActions { PrimaryPill("Got it", Modifier.fillMaxWidth()) {} }
                }
            }
        }
    }
}
