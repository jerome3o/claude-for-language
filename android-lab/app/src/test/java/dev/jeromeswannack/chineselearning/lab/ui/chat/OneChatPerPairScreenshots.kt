package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsActions
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsSamples
import dev.jeromeswannack.chineselearning.lab.ui.chats.ChatsScreen
import dev.jeromeswannack.chineselearning.lab.ui.connections.ConnectionsScreenshots
import dev.jeromeswannack.chineselearning.lab.ui.connections.TutorPageActions
import dev.jeromeswannack.chineselearning.lab.ui.connections.TutorPageScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.teaching.ActivityCard
import dev.jeromeswannack.chineselearning.lab.ui.teaching.ConversationsCard
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import dev.jeromeswannack.chineselearning.lab.ui.teaching.TeachingSamples as S

/**
 * One chat per pair (docs/CHAT.md): the inbox has one row per person, a person's chat menu has
 * no New conversation / title / All conversations (a Claude practice chat keeps them), and the
 * student / tutor pages show ONE chat entry point instead of a list of conversations.
 */
class OneChatPerPairScreenshots : LabScreenshotTest() {
    private val person = ChatScreenshots.base
    private val claude = ChatScreenshots.aiUi

    @Test fun inbox() = shootInShell("one-chat-01-inbox", active = TabId.CHATS) { ChatsScreen(ChatsSamples.loaded, ChatsActions()) }

    @Test fun personMenu() = shoot("one-chat-02-menu-person") {
        LabScreen("王老师 · ⋯") { item { ChatMenuContent(person, ChatSheetActions()) } }
    }

    @Test fun claudeMenu() = shoot("one-chat-03-menu-claude") {
        LabScreen("Claude · ⋯") { item { ChatMenuContent(claude, ChatSheetActions()) } }
    }

    @Test fun tutorPage() = shootInShell("one-chat-04-tutor-page", active = TabId.TUTOR) {
        TutorPageScreen(ConnectionsScreenshots.pageUi, TutorPageActions())
    }

    @Test fun studentPageChat() = shoot("one-chat-05-student-page-chat") {
        Column(Modifier.fillMaxSize().background(Lab.colors.background).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ConversationsCard("Jerome Swannack", S.conversations, onMessage = {}, now = S.now)
            ActivityCard("rel-jerome", S.jeromeOverview.activity, open = {}, today = java.time.LocalDate.of(2026, 9, 27))
        }
    }

    // ---------------- behaviour ----------------

    @Test fun aPersonsMenuHasNoNewConversationTitleOrList() {
        compose.setContent { LabTheme { Column { ChatMenuContent(person, ChatSheetActions()) } } }
        compose.onNodeWithText("Search").assertExists()
        compose.onNodeWithText("Make flashcards").assertExists()
        for (gone in listOf("New conversation", "Add a title", "Rename conversation", "All conversations", "Voice settings")) {
            compose.onAllNodesWithText(gone).assertCountEquals(0)
        }
    }

    @Test fun aClaudePracticeChatKeepsItsConversationTools() {
        val calls = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                Column {
                    ChatMenuContent(claude, ChatSheetActions(onNewConversation = { calls += "new" }, onOpenRename = { calls += "rename" }, onAllConversations = { calls += "all" }))
                }
            }
        }
        compose.onNodeWithText("New conversation").performClick()
        compose.onNodeWithText("Rename conversation").performClick()
        compose.onNodeWithText("All conversations").performClick()
        compose.onNodeWithText("Voice settings").assertExists()
        assertEquals(listOf("new", "rename", "all"), calls)
    }

    @Test fun theTutorPageHasOneChatEntryPoint() {
        var opened = 0
        compose.setContent { LabTheme { TutorPageScreen(ConnectionsScreenshots.pageUi, TutorPageActions(onMessage = { opened++ })) } }
        compose.onAllNodesWithText("Conversations").assertCountEquals(0)
        compose.onNodeWithText("Chat with 王老师").assertExists()
        compose.onNodeWithTag("one-chat").performClick()
        assertEquals(1, opened)
    }

    @Test fun theStudentPageChatCardIsMessage() {
        var opened = 0
        compose.setContent { LabTheme { ConversationsCard("Jerome", S.conversations, onMessage = { opened++ }, now = S.now) } }
        compose.onNodeWithText("Chat with Jerome").assertExists()
        compose.onNodeWithTag("one-chat").performClick()
        assertEquals(1, opened)
    }
}
