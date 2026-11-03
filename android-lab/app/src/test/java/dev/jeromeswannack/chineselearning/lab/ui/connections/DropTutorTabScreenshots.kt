package dev.jeromeswannack.chineselearning.lab.ui.connections

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ChatPersonLinks
import dev.jeromeswannack.chineselearning.lab.data.SyncStatus
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.RelationshipDto
import dev.jeromeswannack.chineselearning.lab.data.api.UserSummaryDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatActions
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatMenuContent
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatScreen
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatScreenshots
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatSheetActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeActions
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeScreen
import dev.jeromeswannack.chineselearning.lab.ui.home.HomeUi
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreActions
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreScreen
import dev.jeromeswannack.chineselearning.lab.ui.more.MoreUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals

/**
 * The learner's Tutor tab is gone (Jerome, Nov 2026: "it seems like a dud page"): Study · Chats ·
 * Progress · More; the tutor page is the chat header's name, its parts are in the chat ⋯ menu,
 * connections are More → Tutors & connections, a request waiting shows on Home, and the legacy
 * Claude practice partner is not listed.
 */
class DropTutorTabScreenshots : LabScreenshotTest() {
    private val chat = ChatScreenshots.base.copy(relationshipId = "rel1", otherName = "明慧")
    private val claudeChat = ChatScreenshots.aiUi.copy(relationshipId = "rel2")
    private val learner = NavRole(hasTutor = true, loaded = true)
    private val more = MoreUi(
        userName = "Jerome Swannack", email = "jerome@example.com", role = learner,
        sync = SyncStatus(lastSyncAt = System.currentTimeMillis()), native = setOf(Routes.CONNECTIONS, Routes.homework(), Routes.tutorNotes(), Routes.lessonNotes()),
    )
    private val home = HomeUi(loaded = true, userName = "Jerome Swannack", due = Samples.counts, decks = Samples.decks, reviewedToday = 31)
    private val request = "🤝 明慧 wants to be your tutor"

    private fun homeShot(dark: Boolean) = shootInShell(if (dark) "drop-tutor-01-home-tabs-dark" else "drop-tutor-01-home-tabs", TabId.STUDY, dark = dark) {
        HomeScreen(home, Samples.sync(), online = true, actions = HomeActions(), homework = { ConnectionRequestsRow(request) {} })
    }
    @Test fun homeTabs() = homeShot(false)
    @Test fun homeTabsDark() = homeShot(true)

    private fun menuShot(dark: Boolean) = shoot(if (dark) "drop-tutor-02-chat-menu-dark" else "drop-tutor-02-chat-menu", dark) {
        // The chat dimmed with the ⋯ sheet over it, scrolled to its end (the dialog window isn't captured).
        Box(Modifier.fillMaxSize()) {
            ChatScreen(chat, ChatActions())
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 640.dp).clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card)
                    .verticalScroll(rememberScrollState(Int.MAX_VALUE)).padding(top = 20.dp, bottom = 16.dp),
            ) { ChatMenuContent(chat, ChatSheetActions()) }
        }
    }
    @Test fun chatMenu() = menuShot(false)
    @Test fun chatMenuDark() = menuShot(true)

    private fun moreShot(dark: Boolean) = shootInShell(if (dark) "drop-tutor-03-more-dark" else "drop-tutor-03-more", TabId.MORE, dark = dark) {
        MoreScreen(more, MoreActions(), listState = rememberLazyListState(initialFirstVisibleItemIndex = 3))
    }
    @Test fun moreRow() = moreShot(false)
    @Test fun moreRowDark() = moreShot(true)

    private fun connectionsShot(dark: Boolean) = shootInShell(if (dark) "drop-tutor-04-connections-dark" else "drop-tutor-04-connections", TabId.MORE, dark = dark) {
        ConnectionsScreen(ConnectionsUi(Loadable(ConnectionsScreenshots.rels), ConnectionsScreenshots.ME), ConnectionsActions(onBack = {}))
    }
    @Test fun connections() = connectionsShot(false)
    @Test fun connectionsDark() = connectionsShot(true)

    // ---------------- behaviour ----------------

    @Test fun theHeaderNameOpensTheTutorPage() {
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { ChatScreen(chat, ChatActions(onOpenPerson = { opened += it })) } }
        compose.onNodeWithTag("chat-header-person").performClick()
        assertEquals(listOf("/connections/rel1"), opened)
    }

    @Test fun aClaudeChatHeaderIsNotALink() {
        compose.setContent { LabTheme { ChatScreen(claudeChat, ChatActions()) } }
        compose.onAllNodesWithTag("chat-header-person").assertCountEquals(0)
    }

    @Test fun theMenuListsTheTutorPageParts() {
        val picked = mutableListOf<String>()
        compose.setContent { LabTheme { Column { ChatMenuContent(chat, ChatSheetActions(onPersonLink = { picked += it.labPath })) } } }
        for (id in listOf("person", "lesson_board", "homework", "flags", "tutor_notes")) compose.onNodeWithTag("chat-person-link-$id").assertExists()
        compose.onNodeWithText("Homework from 明慧").assertExists()
        compose.onNodeWithTag("chat-person-link-homework").performClick()
        compose.onNodeWithTag("chat-person-link-flags").performClick()
        compose.onNodeWithTag("chat-person-link-lesson_board").performClick()
        assertEquals(listOf("/connections/rel1?section=homework", "/connections/rel1?section=flags", "/connections/rel1/board"), picked)
    }

    @Test fun aClaudeChatMenuHasNoPersonLinks() {
        compose.setContent { LabTheme { Column { ChatMenuContent(claudeChat, ChatSheetActions()) } } }
        compose.onAllNodesWithTag("chat-person-link-person").assertCountEquals(0)
    }

    @Test fun connectionsHideTheClaudePartnerAndTitleTheScreen() {
        compose.setContent { LabTheme { ConnectionsScreen(ConnectionsUi(Loadable(ConnectionsScreenshots.rels), ConnectionsScreenshots.ME), ConnectionsActions(onBack = {})) } }
        compose.onNodeWithText(ChatPersonLinks.CONNECTIONS_TITLE).assertExists()
        compose.onAllNodesWithText("Practice Chinese conversations").assertCountEquals(0)
        compose.onAllNodesWithTag("connection-tutor").assertCountEquals(1)
    }

    @Test fun inviteIsARoundButtonThatOpensTheForm() {
        compose.setContent { LabTheme { ConnectionsScreen(ConnectionsUi(Loadable(MyRelationshipsDto()), ConnectionsScreenshots.ME), ConnectionsActions(onBack = {})) } }
        compose.onNodeWithContentDescription("Invite").performClick()
        compose.onNodeWithTag("invite-form").assertExists()
        compose.onNodeWithContentDescription("Cancel").performClick()
        compose.onAllNodesWithTag("invite-form").assertCountEquals(0)
    }

    @Test fun moreHasTutorsAndConnectionsForALearnerOnly() {
        val opened = mutableListOf<String>()
        compose.setContent { LabTheme { MoreScreen(more, MoreActions(open = { opened += it }), listState = rememberLazyListState(initialFirstVisibleItemIndex = 3)) } }
        compose.onNodeWithText(ChatPersonLinks.CONNECTIONS_TITLE).performClick()
        assertEquals(listOf(Routes.CONNECTIONS), opened)
    }

    @Test fun incomingRequestsSkipMineAndClaude() {
        val me = UserSummaryDto("me", null, "Jerome")
        val rels = MyRelationshipsDto(
            pending_incoming = listOf(
                RelationshipDto("r1", "t1", "me", "tutor", "pending", requester = UserSummaryDto("t1", "m@x.com", "明慧"), recipient = me),
                RelationshipDto("r2", "me", "t2", "student", "pending", requester = me),
                RelationshipDto("r3", "claude-ai", "me", "tutor", "pending", requester = UserSummaryDto("claude-ai", null, "Claude")),
            ),
        )
        val requests = incomingRequests(rels, "me")
        assertEquals(listOf(ChatPersonLinks.Request("明慧", "tutor")), requests)
        assertEquals(request, ChatPersonLinks.requestsLine(requests))
        assertEquals(null, ChatPersonLinks.requestsLine(incomingRequests(null, "me")))
    }

    @Test fun homeRequestRowOpens() {
        var taps = 0
        compose.setContent { LabTheme { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { ConnectionRequestsRow(request) { taps++ } } } }
        compose.onNodeWithTag("home-connection-requests").performClick()
        assertEquals(1, taps)
    }
}
