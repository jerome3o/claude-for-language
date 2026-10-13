package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.jeromeswannack.chineselearning.lab.core.BlockPlayback
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The hidden bubble's parts (the graded readers' phrase blocks): once the clip is analysed the bars
 * become its waveform split at the pauses; a tap on a part asks to play from there, a drag scrubs
 * (then ends), a long press still reveals; ▶ turns into ⏸ while it plays and the bubble's tap toggles.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatListeningPartsTest {
    @get:Rule val compose = createComposeRule()

    private val s = ListeningSamples
    private val calls = mutableListOf<String>()
    private val seeks = mutableListOf<Pair<Double, Boolean>>()

    private fun actions() = ChatActions(
        onListen = { calls += "listen ${it.id}" },
        onListenSeek = { m, ms, tap -> calls += "seek ${m.id}"; seeks += ms to tap },
        onListenSeekDone = { calls += "seek done" },
        onReveal = { calls += "reveal ${it.id}" },
        onOpenSheet = { calls += "sheet" },
    )

    /** Only h3 (two parts: 0–1500, 1500–3400 ms). */
    private fun one(l: ListeningUi = s.ui.listening.copy(analyses = s.analyses)) = s.ui.copy(messages = listOf(s.old1, s.mine, s.h3), listening = l)

    private fun show(ui: ChatUi) = compose.setContent { LabTheme { ChatScreen(ui, actions()) } }

    @Test fun partsShowOnceTheClipIsAnalysed() {
        show(one(s.ui.listening))
        compose.onAllNodesWithTag("chat-listening-parts", useUnmergedTree = true).assertCountEquals(0)
        compose.onAllNodesWithText(LISTENING_HINT).assertCountEquals(1)
    }

    @Test fun tapAPartPlaysFromIt() {
        show(one())
        compose.onAllNodesWithText(LISTENING_PARTS_HINT).assertCountEquals(1)
        compose.onNodeWithTag("chat-listening-play-icon", useUnmergedTree = true).assertExists()
        // The right end of the waveform = the second part.
        compose.onNodeWithTag("chat-listening-parts", useUnmergedTree = true).performTouchInput { click(androidx.compose.ui.geometry.Offset(width * 0.8f, centerY)) }
        compose.waitForIdle()
        assertEquals(listOf("seek h3"), calls, "the waveform's tap, not the bubble's")
        val (ms, tap) = seeks.single()
        assertTrue(tap)
        assertTrue(ms in 1500.0..3400.0, "in the second part: $ms")
    }

    @Test fun dragScrubsThenEnds() {
        show(one())
        compose.onNodeWithTag("chat-listening-parts", useUnmergedTree = true).performTouchInput {
            down(androidx.compose.ui.geometry.Offset(width * 0.1f, centerY))
            moveTo(androidx.compose.ui.geometry.Offset(width * 0.5f, centerY))
            moveTo(androidx.compose.ui.geometry.Offset(width * 0.9f, centerY))
            up()
        }
        compose.waitForIdle()
        assertTrue(seeks.isNotEmpty() && seeks.all { !it.second }, "drags only: $seeks")
        assertTrue(seeks.last().first > seeks.first().first, "the point follows the finger: $seeks")
        assertEquals("seek done", calls.last())
        assertTrue(calls.none { it.startsWith("listen") || it == "sheet" })
    }

    @Test fun playTurnsIntoPauseAndTheBubbleToggles() {
        val playing = s.ui.listening.copy(analyses = s.analyses, focus = "h3", playing = "h3", block = BlockPlayback.State(anchorMs = 1500.0, playing = true))
        show(one(playing))
        compose.onNodeWithTag("chat-listening-pause-icon", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("chat-listening-parts-playing", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("chat-listening-play", useUnmergedTree = true).performClick()
        compose.waitForIdle()
        assertEquals(listOf("listen h3"), calls)
    }

    @Test fun longPressOnTheWaveformReveals() {
        show(one())
        compose.onNodeWithTag("chat-listening-parts", useUnmergedTree = true).performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(LONG_PRESS_MS + 100)
        compose.onNodeWithTag("chat-listening-parts", useUnmergedTree = true).performTouchInput { up() }
        compose.waitForIdle()
        assertTrue("reveal h3" in calls, "$calls")
        assertTrue(calls.none { it == "sheet" })
    }
}
