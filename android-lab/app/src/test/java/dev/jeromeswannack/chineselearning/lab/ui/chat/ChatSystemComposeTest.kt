package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTouchInput
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatListeningStore
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatSystemSamples as S

/**
 * System messages (docs/CHAT.md "System messages") in the Lab chat: their own centred rows (never a
 * bubble), third person from each side, Join / Open card open the app path, a long press opens the
 * Copy-only menu, Copy copies what this person reads, listening mode never hides them.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatSystemComposeTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun rowsAreSystemRowsNotBubbles() {
        val rows = S.student.rows()
        val systems = rows.filterIsInstance<ChatRow.System>().map { it.message.id }
        assertEquals(listOf("s1", "s2", "s3", "s4", "s5"), systems)
        assertEquals(listOf("h1", "h2"), rows.filterIsInstance<ChatRow.Msg>().map { it.message.id })
    }

    @Test
    fun readsFromEachSide() {
        assertEquals("📚 Minghui set your new cards to 2 a day (+5 extra)", S.student.menuText(S.budget))
        assertEquals("📚 You set Jerome's new cards to 2 a day (+5 extra)", S.tutor.menuText(S.budget))
        assertEquals("🚩 You flagged 银行 for Minghui: “我总是和很行搞混”", S.student.menuText(S.flag))
        assertEquals("🚩 Jerome flagged 银行 for you: “我总是和很行搞混”", S.tutor.menuText(S.flag))
        assertEquals("/connections/rel1/cards/n1", S.tutor.systemView(S.flag)?.action?.path)
        assertEquals("/cards/n1", S.student.systemView(S.flagReply)?.action?.path)
        assertEquals("📹 Missed video call from Minghui", S.student.menuText(S.missed))
        assertEquals(null, S.student.systemView(S.hi))
    }

    @Test
    fun menuIsCopyOnlyAndListeningNeverHides() {
        val menu = S.tutor.menu(S.flag)
        assertFalse(menu.reactions)
        assertEquals(listOf(MessageMenu.COPY), menu.items.map { it.id })
        assertFalse(ChatListening.listeningCandidate(ChatListeningStore.listeningMessage(S.flag), "t1"))
    }

    @Test
    fun joinOpensTheCallAndLongPressOpensTheMenu() {
        val calls = mutableListOf<String>()
        val actions = ChatActions(
            onOpenPath = { path, kind -> calls += "open $path $kind" },
            onOpenSheet = { s -> calls += if (s is ChatSheet.Actions) "menu ${s.message.id}" else "sheet" },
        )
        compose.setContent { LabTheme { ChatScreen(S.student, actions) } }
        compose.onNodeWithText("Minghui started a video call", substring = true).performScrollTo()
        compose.onNodeWithText("Join").performScrollTo().performClick()
        compose.onNodeWithText("Minghui set your new cards to 2 a day (+5 extra)", substring = true).performScrollTo().performTouchInput { longClick() }
        assertEquals(listOf("open /calls/call-2 call_started", "menu s1"), calls)
        // Join on the live call, Open card on the flag and the reply; the missed call has none.
        assertEquals(1, compose.onAllNodesWithText("Join").fetchSemanticsNodes().size)
        assertEquals(2, compose.onAllNodesWithText("Open card").fetchSemanticsNodes().size)
        assertNotNull(compose.onNodeWithText("Missed video call from Minghui", substring = true).fetchSemanticsNode())
        assertTrue(compose.onAllNodesWithText("I've", substring = true).fetchSemanticsNodes().isEmpty())
    }
}
