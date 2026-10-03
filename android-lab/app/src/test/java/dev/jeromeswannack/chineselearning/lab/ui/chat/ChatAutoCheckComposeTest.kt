package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.assertCountEquals
import dev.jeromeswannack.chineselearning.lab.core.MessageMenu
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatAutoCheckSamples as A

/** The ✎ on my bubble, the menu's first row, and the "How to say it better" sheet as the user touches them. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatAutoCheckComposeTest {
    @get:Rule val compose = createComposeRule()

    @Test fun indicatorOnMyImprovableMessageOnly() {
        compose.setContent { LabTheme { ChatScreen(A.ui, ChatActions()) } }
        // ac is not the last of its group: the ✎ shows alone, labelled for TalkBack.
        compose.onNodeWithContentDescription("Could be better — hold to see").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("Could be better", substring = true).assertCountEquals(1)
    }

    @Test fun theTutorNeverSeesIt() {
        // The server sends auto_check to the sender only; even if it were there, the other side shows nothing.
        compose.setContent { LabTheme { ChatScreen(ChatLearningSamples.tutor.copy(messages = A.ui.messages, aids = A.ui.aids), ChatActions()) } }
        compose.onAllNodesWithContentDescription("Could be better", substring = true).assertCountEquals(0)
    }

    @Test fun menuFirstRowOpensTheSheet() {
        var action: String? = null
        compose.setContent {
            LabTheme { MessageMenuContent(A.ac, A.ui.menu(A.ac), online = false, recent = emptyList(), mine = true, onReact = {}, onAction = { action = it }) }
        }
        // Offline too: everything in the sheet is stored on the message.
        compose.onNodeWithTag(menuTag(MessageMenu.SAY_BETTER)).assertIsDisplayed().performClick()
        assertEquals(MessageMenu.SAY_BETTER, action)
    }

    @Test fun sheetShowsMistakesAlternativeAndAddsCards() {
        val v = assertNotNull(SayBetterView.of(A.ac, "me", "Minghui"))
        var played = 0
        var asked = 0
        compose.setContent {
            LabTheme {
                Column(Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                    SayBetterContent(
                        v, online = true, playing = false,
                        cards = SentenceActions(decks = { listOf("d1" to "From my chats", "d2" to "HSK 3") }),
                        onPlay = { played++ }, onAsk = { asked++ }, onClose = {},
                    )
                }
            }
        }
        compose.onNodeWithText("How to say it better").assertIsDisplayed()
        compose.onNodeWithText("You wrote").assertIsDisplayed()
        compose.onNodeWithText("你说 去了 → 去").assertIsDisplayed()
        compose.onNodeWithText("One 了 at the end is enough here.").assertIsDisplayed()
        compose.onNodeWithText("More natural").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("我昨天去商店买了点东西").assertIsDisplayed()
        compose.onNodeWithTag(SayBetterTags.PLAY).performClick()
        assertEquals(1, played)
        compose.onNodeWithTag(SayBetterTags.ASK).performScrollTo().performClick()
        assertEquals(1, asked)
        // The mistake's own card → the add-card step with it.
        compose.onNodeWithTag(SayBetterTags.mistakeCard(0)).performClick()
        compose.onNodeWithText("Add as flashcard").assertIsDisplayed()
        compose.onNodeWithText("去商店买东西").assertIsDisplayed()
        compose.onNodeWithText("Cancel").performClick()
        // The primary button → the corrected sentence's card.
        compose.onNodeWithTag(SayBetterTags.ADD).performScrollTo().performClick()
        compose.onNodeWithText("Yesterday I went to the shop to buy things.").assertIsDisplayed()
        compose.onNodeWithText("Add to deck").assertIsDisplayed()
    }

    @Test fun askNeedsInternet() {
        val v = assertNotNull(SayBetterView.of(A.ac, "me", "Minghui"))
        compose.setContent { LabTheme { Column(Modifier.verticalScroll(rememberScrollState())) { SayBetterContent(v, online = false, playing = false, cards = SentenceActions(), onPlay = {}, onAsk = {}, onClose = {}) } } }
        compose.onNodeWithText("💬 Ask Claude about this · needs internet").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("你说 去了 → 去").assertIsDisplayed()
    }
}
