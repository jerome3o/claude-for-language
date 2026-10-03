package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Listening mode as the user touches it (docs/CHAT.md "Listening mode"): new messages from the
 * other person render as hidden bubbles (no text), a tap plays, a long press reveals and does NOT
 * open the message menu, 👁 reveals too; a revealed message's long press opens the menu again.
 * Photos and my own messages never hide; the menu shows the toggle.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatListeningComposeTest {
    @get:Rule val compose = createComposeRule()

    private val calls = mutableListOf<String>()
    private val s = ListeningSamples

    private fun actions() = ChatActions(
        onOpenSheet = { sh -> calls += when (sh) { is ChatSheet.Actions -> "menu ${sh.message.id}"; null -> "close"; else -> "sheet" } },
        onListen = { calls += "listen ${it.id}" },
        onReveal = { calls += "reveal ${it.id}" },
        onListeningSlow = { calls += "slow" },
        onToggleTime = { calls += "time $it" },
    )

    private fun show(ui: ChatUi) = compose.setContent { LabTheme { ChatScreen(ui, actions()) } }

    private fun longPress(node: androidx.compose.ui.test.SemanticsNodeInteraction) {
        node.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(LONG_PRESS_MS + 100)
        node.performTouchInput { up() }
        compose.waitForIdle()
    }

    /** Only h3 (the newest, on screen at the end): fewer rows to scroll. */
    private val one = s.ui.copy(messages = listOf(s.old1, s.mine, s.h3))

    @Test fun newMessageFromTheOtherPersonIsHidden() {
        show(s.ui)
        // h1, h2, h3 hidden; the old message, the photo and mine are not.
        assertTrue(compose.onAllNodesWithTag("chat-listening-bubble").fetchSemanticsNodes().isNotEmpty())
        compose.onAllNodesWithText("早上八点，在地铁站见。").assertCountEquals(0)
        compose.onAllNodesWithText("好啊！几点出发？", substring = true).assertCountEquals(1)
        compose.onAllNodesWithText(LISTENING_HINT).onFirst()
        compose.onNodeWithTag("chat-listening-subtitle").assertExists()
    }

    @Test fun tapPlays() {
        show(one)
        compose.onNodeWithTag("chat-listening-bubble").performClick()
        compose.waitForIdle()
        assertEquals(listOf("listen h3"), calls)
        compose.onNodeWithTag("chat-listening-slow").performClick()
        assertEquals("slow", calls.last())
    }

    @Test fun longPressRevealsAndDoesNotOpenTheMenu() {
        show(one)
        longPress(compose.onNodeWithTag("chat-listening-bubble"))
        assertEquals(listOf("reveal h3"), calls)
        assertTrue(calls.none { it.startsWith("menu") })
    }

    @Test fun eyeReveals() {
        show(one)
        compose.onNodeWithTag("chat-listening-reveal").performClick()
        assertEquals(listOf("reveal h3"), calls)
    }

    @Test fun revealedMessageShowsTextAndLongPressOpensTheMenu() {
        show(one.copy(listening = one.listening.copy(revealed = setOf("h3"))))
        compose.onAllNodesWithTag("chat-listening-bubble").assertCountEquals(0)
        compose.onAllNodesWithText("早上八点，在地铁站见。", substring = true).assertCountEquals(1)
        val bubbles = compose.onAllNodesWithTag("chat-bubble")
        longPress(bubbles[bubbles.fetchSemanticsNodes().size - 1])
        assertEquals(listOf("menu h3"), calls)
    }

    @Test fun offShowsEverything() {
        show(s.ui.copy(listening = ListeningUi(setting = ChatListening.Setting(false, s.since))))
        compose.onAllNodesWithTag("chat-listening-bubble").assertCountEquals(0)
        compose.onAllNodesWithTag("chat-listening-subtitle").assertCountEquals(0)
    }

    @Test fun menuHasTheToggleAndHideAll() {
        val toggles = mutableListOf<String>()
        compose.setContent { LabTheme { ChatMenuContent(s.ui, ChatSheetActions(onToggleListening = { toggles += "toggle" }, onHideAll = { toggles += "hide-all" })) } }
        compose.onNodeWithTag("chat-menu-listening").performClick()
        compose.onAllNodesWithText("Hide all messages").onFirst().performClick()
        assertEquals(listOf("toggle", "hide-all"), toggles)
    }
}
