package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListLastMessage
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListPerson
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListRow
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeInbox
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRole
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavRules
import dev.jeromeswannack.chineselearning.lab.ui.nav.ShellFrame
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabId
import dev.jeromeswannack.chineselearning.lab.ui.nav.TabSpec
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Jerome (learner) and Minghui (tutor): the chats with people and the Claude threads, as the unified tab shows them. */
object UnifiedSamples {
    val now = ChatsSamples.now
    private val minghui = ChatListPerson("u-minghui", "Minghui 明慧", null)
    private val claude = ChatListPerson("claude-ai", "Claude", null)

    val learnerRows = listOf(
        ChatListRow("c-hw", "rel-minghui", null, false, minghui, "tutor",
            ChatListLastMessage("m1", "u-minghui", "明天上课见！别忘了带作业。", "2026-10-03T10:42:00Z"), unread = 1, lastActivityAt = "2026-10-03T10:42:00Z"),
        ChatListRow("c-zhang", "rel-zhang", null, false, ChatListPerson("u-zhang", "张老师", null), "tutor",
            ChatListLastMessage("m3", "me", "好的，明天见！", "2026-10-02T19:03:00Z"), lastActivityAt = "2026-10-02T19:03:00Z"),
        // An old role-play chat: shown once, as a Claude row of its own (no practice thread on the phone).
        ChatListRow("c-cafe", "rel-claude", "At the café", true, claude, "tutor",
            ChatListLastMessage("m5", "claude-ai", "您好！您想喝点什么？", "2026-09-30T18:30:00Z"), lastActivityAt = "2026-09-30T18:30:00Z"),
    )

    val checkThread = ClaudeInbox.Thread(
        "t-check", "我昨天去了商店买东西了", ClaudeChats.Context(ClaudeChats.GENERAL), firstIntent = "check",
        preview = "我昨天去了商店买东西了", lastMessageAt = "2026-10-03T11:30:00Z", createdAt = "2026-10-03T11:29:00Z", unread = 1,
    )
    val cardThread = ClaudeInbox.Thread(
        "t-card", "银行的“行”为什么读 háng？", ClaudeChats.Context(ClaudeChats.CARD, noteId = "n-yinhang", label = "银行"),
        firstIntent = "ask", preview = "这是一个好问题。我用简单的中文回答：行有两个读音……", lastMessageAt = "2026-10-03T09:15:00Z", createdAt = "2026-10-03T09:14:00Z",
    )
    val writingThread = ClaudeInbox.Thread(
        "t-ask", "“随便”什么时候不礼貌？", ClaudeChats.Context(ClaudeChats.GENERAL), firstIntent = "ask",
        preview = "", lastMessageAt = "2026-10-01T08:00:00Z", createdAt = "2026-10-01T08:00:00Z", pending = true,
    )
    val threads = listOf(checkThread, cardThread, writingThread)

    val learner = ChatsUi(
        loaded = true, rows = learnerRows, threads = threads, myId = "me", nowMs = now, offsetMinutes = 60,
        people = ChatsViewModel.peopleFor(learnerRows, null, "me"),
    )

    private fun student(id: String, name: String, text: String, at: String, unread: Int = 0) =
        ChatListRow("c-$id", "rel-$id", null, false, ChatListPerson("u-$id", name, null), "student", ChatListLastMessage("m-$id", "u-$id", text, at), unread = unread, lastActivityAt = at)

    val tutorRows = listOf(
        student("jerome", "Jerome", "老师，我做完作业了！", "2026-10-03T11:50:00Z", unread = 2),
        student("wei", "Wei Chen", "📷 Photo: 这是我的猫", "2026-10-03T08:15:00Z"),
        student("anna", "Anna Müller", "🎤 Voice message", "2026-09-28T16:20:00Z"),
    )
    val tutor = ChatsUi(
        loaded = true, rows = tutorRows, myId = "me", nowMs = now, offsetMinutes = 60, teacher = true,
        threads = listOf(
            ClaudeInbox.Thread("t-plan", "How do I explain 了 to a beginner?", ClaudeChats.Context(ClaudeChats.GENERAL), firstIntent = "ask",
                preview = "Start with 了 after a verb for a finished action…", lastMessageAt = "2026-10-03T12:10:00Z", createdAt = "2026-10-03T12:09:00Z", unread = 1),
            ClaudeInbox.Thread("t-tr", "We'll review the homework next lesson", ClaudeChats.Context(ClaudeChats.GENERAL), firstIntent = "translate",
                preview = "下节课我们复习作业。", lastMessageAt = "2026-10-02T09:00:00Z", createdAt = "2026-10-02T09:00:00Z"),
        ),
        people = ChatsViewModel.peopleFor(tutorRows, null, "me"),
    )
}

/**
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): the kind written on
 * each outline, a learner's unread tutor chats pinned, the filter chips, the context chip → the card, the
 * box's intents for Chinese / English, "To:" a tutor, the tutor's view — plus the Roborazzi shots,
 * light + dark.
 */
class ChatsUnifiedTest : LabScreenshotTest() {
    private val S = UnifiedSamples
    private val typing = VoiceDictationUi(mode = "type")
    private val studentTabs = NavRules.tabsFor(NavRole(hasTutor = true, loaded = true))
    private val tutorTabs = NavRules.tabsFor(NavRole(hasStudents = true, isTutorOnly = true, loaded = true, isTutorAccount = true))

    private var shown: androidx.compose.runtime.MutableState<Triple<ChatsUi, ChatsActions, VoiceDictationUi?>>? = null

    /** Renders the screen (again with new values: one setContent per test). */
    private fun show(ui: ChatsUi, actions: ChatsActions = ChatsActions(), voice: VoiceDictationUi? = null) {
        val state = shown
        if (state == null) {
            val s = androidx.compose.runtime.mutableStateOf(Triple(ui, actions, voice))
            shown = s
            compose.setContent { LabTheme { val (u, a, v) = s.value; ChatsScreen(u, a, voicePreview = v) } }
        } else {
            state.value = Triple(ui, actions, voice)
        }
        compose.waitForIdle()
    }

    private fun inShell(name: String, tabs: List<TabSpec> = studentTabs, dark: Boolean = false, content: @Composable () -> Unit) =
        shoot(name, dark) { ShellFrame(tabs, TabId.CHATS, showBar = true, onSelect = {}, badges = mapOf(TabId.CHATS to 1)) { content() } }

    // ---------------- the list ----------------

    @Test fun everyRowSaysItsKindOnTheOutline() {
        show(S.learner)
        compose.onNodeWithTag(ChatsTags.kind("h:c-hw")).assertTextEquals("🧑‍🏫 TUTOR")
        compose.onNodeWithTag(ChatsTags.kind("c:t-check")).assertTextEquals("✦ CLAUDE")
        // The old practice chat is a Claude row too, once.
        assertEquals(ClaudeInbox.CLAUDE, S.learner.items.single { it.key == "h:c-cafe" }.kind)
        compose.onNodeWithText("✦ Writing a reply…").assertExists()
    }

    @Test fun aLearnersUnreadTutorChatIsPinnedOnTop() {
        val keys = S.learner.shown.map { it.key }
        // The Check thread is newer, but Minghui's unread message comes first.
        assertEquals("h:c-hw", keys.first())
        assertEquals(listOf("h:c-hw", "c:t-check", "c:t-card", "h:c-zhang", "c:t-ask", "h:c-cafe"), keys)
        assertTrue(S.learner.items.first().pinned)
        // The tutor's view never pins.
        assertTrue(S.tutor.items.none { it.pinned })
    }

    @Test fun anOldPracticeChatWithItsThreadShowsOnce() {
        val practice = ClaudeInbox.Thread("pc-c-cafe", "At the café", ClaudeChats.Context(ClaudeChats.PRACTICE, conversationId = "c-cafe", scenario = "At the café"), createdAt = "2026-09-30T18:00:00Z", lastMessageAt = "2026-09-30T18:30:00Z")
        val ui = S.learner.copy(threads = S.threads + practice)
        assertEquals(1, ui.items.count { it.key == "c:pc-c-cafe" || it.key == "h:c-cafe" })
        assertEquals("c:pc-c-cafe", ui.items.single { it.badge?.icon == "🎭" }.key)
    }

    @Test fun filterChipsAllTutorClaude() {
        val picked = mutableListOf<String>()
        show(S.learner, ChatsActions(onFilter = { picked += it }))
        compose.onNodeWithTag(ChatsTags.filter(ClaudeInbox.ALL)).assertTextEquals("All")
        compose.onNodeWithTag(ChatsTags.filter(ClaudeInbox.PEOPLE)).assertTextEquals("🧑‍🏫 Tutors")
        compose.onNodeWithTag(ChatsTags.filter(ClaudeInbox.CLAUDE)).performClick()
        assertEquals(listOf(ClaudeInbox.CLAUDE), picked)
        show(S.learner.copy(filter = ClaudeInbox.CLAUDE))
        compose.onNodeWithTag(ChatsTags.item("h:c-hw")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsTags.item("c:t-check")).assertExists()
        // Search looks at the context chips too.
        assertEquals(listOf("c:t-card"), S.learner.copy(query = "银行").shown.map { it.key })
    }

    @Test fun noChipsWithoutBothKinds() {
        show(S.learner.copy(threads = emptyList(), rows = S.learnerRows.filter { !it.isAi }))
        compose.onNodeWithTag(ChatsTags.filter(ClaudeInbox.ALL)).assertDoesNotExist()
    }

    @Test fun theCardChipOpensTheCardAndTheRowTheThread() {
        val cards = mutableListOf<String>()
        val opened = mutableListOf<String>()
        show(S.learner, ChatsActions(onCard = { cards += it }, onOpen = { opened += it.key }))
        compose.onAllNodesWithTag(ChatsTags.CONTEXT_CHIP, useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.size >= 2) }
        compose.onNodeWithText("📇 Asked on card · 银行").performClick()
        assertEquals(listOf("n-yinhang"), cards)
        assertEquals(emptyList(), opened)
        compose.onNodeWithText("银行的“行”为什么读 háng？").performClick()
        assertEquals(listOf("c:t-card"), opened)
        assertEquals("/chats/claude/t-card?source=chats", ChatsViewModel.pathFor(S.learner.items.first { it.key == "c:t-card" }))
        assertEquals("/connections/rel-claude/chat/c-cafe", ChatsViewModel.pathFor(S.learner.items.first { it.key == "h:c-cafe" }))
    }

    // ---------------- the box ----------------

    private data class Sent(val text: String, val intent: String, val spoken: Boolean)

    @Test fun chineseOffersAskCheckAndExplain() {
        val sent = mutableListOf<Sent>()
        show(S.learner.copy(draft = "我昨天去了商店买东西了"), ChatsActions(compose = ChatsComposeActions(onSendToClaude = { t, i, s -> sent += Sent(t, i, s) })), typing)
        compose.onNodeWithTag(ChatsComposeTags.intent("translate")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.intent("explain")).assertIsEnabled()
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).performClick()
        assertEquals(listOf(Sent("我昨天去了商店买东西了", "check", false)), sent)
    }

    @Test fun askSendsTheTypedBox() {
        val sent = mutableListOf<Sent>()
        // A compose request (More → Ask Claude, /coach) opens the box for typing.
        show(S.learner.copy(draft = "成都有什么好吃的？", composeRequest = 1), ChatsActions(compose = ChatsComposeActions(onSendToClaude = { t, i, s -> sent += Sent(t, i, s) })))
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TEXT).assertExists()
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).performClick()
        assertEquals(listOf(Sent("成都有什么好吃的？", "ask", false)), sent)
    }

    @Test fun englishOffersTranslate() {
        val sent = mutableListOf<Sent>()
        show(S.learner.copy(draft = "I'm running late"), ChatsActions(compose = ChatsComposeActions(onSendToClaude = { t, i, s -> sent += Sent(t, i, s) })), typing)
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.intent("translate")).performClick()
        assertEquals("translate", sent.single().intent)
    }

    @Test fun toATutorOpensHerChatWithTheText() {
        val to = mutableListOf<Pair<String, String>>()
        show(S.learner.copy(draft = "老师，明天几点上课？"), ChatsActions(compose = ChatsComposeActions(onSendToPerson = { r, t -> to += r.conversationId to t })), typing)
        compose.onNodeWithTag(ChatsComposeTags.TO).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(ChatsComposeTags.to("rel-zhang")).assertExists()
        compose.onNodeWithTag(ChatsComposeTags.to("rel-minghui")).performClick()
        assertEquals(listOf("c-hw" to "老师，明天几点上课？"), to)
    }

    @Test fun offlineTheBoxSaysItWaits() {
        show(S.learner.copy(offline = true, draft = "你好"), voice = typing)
        compose.onNodeWithTag(ChatsComposeTags.OFFLINE).assertTextEquals(ChatsCompose.OFFLINE_NOTE)
    }

    @Test fun theComposersRules() {
        assertEquals(listOf("ask", "check", "explain"), ChatsCompose.composerFor("我想学中文", compact = false).intents)
        assertEquals(listOf("ask", "translate"), ChatsCompose.composerFor("I want to learn", compact = false).intents)
        // The tutor's box: Ask · Translate only.
        assertEquals(listOf("ask"), ChatsCompose.composerFor("我想学中文", compact = true).intents)
        assertEquals(null, ChatsCompose.composerFor("我想学中文", compact = true).hint)
        assertEquals(listOf("ask", "translate"), ChatsCompose.composerFor("I want to learn", compact = true).intents)
    }

    // ---------------- the tutor's view ----------------

    @Test fun theTutorSeesStudentsFirstAndHerClaudeChatsFolded() {
        var toggled = 0
        show(S.tutor, ChatsActions(onToggleClaude = { toggled++ }))
        compose.onNodeWithTag(ChatsTags.PEOPLE_TITLE).assertTextEquals("Students")
        compose.onNodeWithTag(ChatsTags.filter(ClaudeInbox.ALL)).assertDoesNotExist()
        compose.onNodeWithTag(ChatsTags.kind("h:c-jerome")).assertTextEquals("🎓 STUDENT")
        compose.onNodeWithTag(ChatsTags.item("c:t-plan")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsTags.CLAUDE_SECTION).performClick()
        assertEquals(1, toggled)
        show(S.tutor.copy(claudeOpen = true))
        compose.onNodeWithTag(ChatsTags.item("c:t-plan")).assertExists()
        // Search opens the folded section.
        show(S.tutor.copy(query = "了"))
        compose.onNodeWithTag(ChatsTags.item("c:t-plan")).assertExists()
    }

    @Test fun theTutorsBoxStartsAsOneButton() {
        show(S.tutor.copy(draft = "我想学中文"), voice = typing)
        compose.onNodeWithTag(ChatsComposeTags.ROOT).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.OPEN).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(ChatsComposeTags.ROOT).assertExists()
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.intent("explain")).assertDoesNotExist()
    }

    @Test fun aComposeRequestOpensTheTutorsBox() {
        show(S.tutor.copy(composeRequest = 1), voice = typing)
        compose.onNodeWithTag(ChatsComposeTags.ROOT).assertExists()
    }

    @Test fun theNewChatPickerOffersClaudeFirst() {
        var claude = 0
        show(S.learner.copy(pickerOpen = true), ChatsActions(onPickClaude = { claude++ }))
        compose.onNodeWithTag(ChatsTags.NEW_CLAUDE).performClick()
        assertEquals(1, claude)
    }

    // ---------------- shots ----------------

    @Test fun shotLearnerList() = inShell("chats-claude-01-learner-list") { ChatsScreen(S.learner, ChatsActions()) }

    @Test fun shotLearnerListDark() = inShell("chats-claude-02-learner-list-dark", dark = true) { ChatsScreen(S.learner, ChatsActions()) }

    @Test fun shotComposerChinese() = inShell("chats-claude-03-composer-chinese") {
        ChatsScreen(S.learner.copy(draft = "我昨天去了商店买东西了"), ChatsActions(), voicePreview = typing)
    }

    @Test fun shotComposerChineseDark() = inShell("chats-claude-04-composer-chinese-dark", dark = true) {
        ChatsScreen(S.learner.copy(draft = "我昨天去了商店买东西了"), ChatsActions(), voicePreview = typing)
    }

    @Test fun shotFilterClaude() = inShell("chats-claude-05-filter-claude") { ChatsScreen(S.learner.copy(filter = ClaudeInbox.CLAUDE), ChatsActions()) }

    @Test fun shotFilterClaudeDark() = inShell("chats-claude-06-filter-claude-dark", dark = true) { ChatsScreen(S.learner.copy(filter = ClaudeInbox.CLAUDE), ChatsActions()) }

    @Test fun shotTutorView() = inShell("chats-claude-07-tutor-view", tabs = tutorTabs) { ChatsScreen(S.tutor, ChatsActions()) }

    @Test fun shotTutorViewDark() = inShell("chats-claude-08-tutor-view-dark", tabs = tutorTabs, dark = true) { ChatsScreen(S.tutor, ChatsActions()) }

    @Test fun shotTutorViewOpen() = inShell("chats-claude-09-tutor-claude-open", tabs = tutorTabs) {
        ChatsScreen(S.tutor.copy(claudeOpen = true, composeRequest = 1, draft = "We'll review the homework next lesson"), ChatsActions(), voicePreview = typing)
    }

    @Test fun shotEmpty() = inShell("chats-claude-10-empty") { ChatsScreen(ChatsUi(loaded = true, nowMs = S.now), ChatsActions()) }
}
