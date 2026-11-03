package dev.jeromeswannack.chineselearning.lab.ui.chats

import androidx.compose.runtime.Composable
import androidx.compose.ui.test.assertContentDescriptionEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
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
    val exerciseThread = ClaudeInbox.Thread(
        "t-ex", "explain this please", ClaudeChats.Context(ClaudeChats.EXERCISE, lessonId = "l-zenme", exerciseKey = "s0e2", exerciseType = "judge", label = "Judge each sentence"),
        firstIntent = "ask", preview = "这个练习是判断「怎么…了」的句子对不对。", lastMessageAt = "2026-10-03T08:42:00Z", createdAt = "2026-10-03T08:41:00Z",
    )
    val readerThread = ClaudeInbox.Thread(
        "t-reader", "熊猫为什么喜欢成都？", ClaudeChats.Context(ClaudeChats.READER, readerId = "r-panda", pageId = "p3", page = 3, label = "小明在成都"),
        firstIntent = "ask", preview = "因为成都有很多竹子。", lastMessageAt = "2026-10-02T21:10:00Z", createdAt = "2026-10-02T21:09:00Z",
    )
    val threads = listOf(checkThread, cardThread, writingThread, exerciseThread, readerThread)

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
 * The unified Chats tab (docs/CHAT.md "Chats tab — one list for people and Claude"): the people first
 * (a learner's unread tutor chats on top), a thin divider, then Claude — compact one-line rows, no
 * previews, no filter chips; a Claude row's ONE context emoji → its popover (full text + "Open card ›");
 * the box (always to Claude; Check / Explain / Translate only once there is text); the tutor's view
 * (the same layout) — plus the Roborazzi shots, light + dark.
 */
class ChatsUnifiedTest : LabScreenshotTest() {
    private val S = UnifiedSamples
    private val typing = VoiceDictationUi(mode = "type")
    private val idle = VoiceDictationUi()
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

    /** Screenshots with a popup (the context popover) need the whole screen. */
    private fun shootScreen(name: String, dark: Boolean = false, tabs: List<TabSpec> = studentTabs, content: @Composable () -> Unit) {
        compose.setContent {
            LabTheme(dark = dark) { ShellFrame(tabs, TabId.CHATS, showBar = true, onSelect = {}, badges = mapOf(TabId.CHATS to 1)) { content() } }
        }
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        com.github.takahirom.roborazzi.captureScreenRoboImage("screenshots/$name.png")
    }

    // ---------------- the list ----------------

    @Test fun peopleFirstThenADividerThenClaude() {
        show(S.learner)
        val keys = S.learner.shown.map { it.key }
        val sections = ClaudeInbox.sections(S.learner.shown)
        // Minghui's unread chat first, then 张老师 — the people — then every Claude chat, newest first.
        assertEquals(listOf("h:c-hw", "h:c-zhang"), sections.people.map { it.key })
        assertEquals(listOf("c:t-check", "c:t-card", "c:t-ex", "c:t-reader", "c:t-ask", "h:c-cafe"), sections.claude.map { it.key })
        assertEquals(sections.people.map { it.key } + sections.claude.map { it.key }, keys)
        assertTrue(S.learner.items.first().pinned)
        compose.onNodeWithTag(ChatsTags.DIVIDER).assertExists()
        // The kind is in words for TalkBack, on the avatar (no outline label any more).
        compose.onNodeWithTag(ChatsTags.kind("h:c-hw")).assertContentDescriptionEquals("Tutor")
        compose.onNodeWithTag(ChatsTags.kind("c:t-check")).assertContentDescriptionEquals("Claude")
        // No previews, no filter chips.
        compose.onNodeWithText("明天上课见！别忘了带作业。").assertDoesNotExist()
        compose.onNodeWithText("All").assertDoesNotExist()
        // A Claude chat being written says so where the time goes.
        compose.onNodeWithTag(ChatsTags.status("c:t-ask"), useUnmergedTree = true).assertContentDescriptionEquals(ClaudeInbox.ROW_WRITING.text)
        // The tutor's view never pins.
        assertTrue(S.tutor.items.none { it.pinned })
    }

    @Test fun noDividerWithOnlyPeople() {
        show(S.learner.copy(threads = emptyList(), rows = S.learnerRows.filter { !it.isAi }))
        compose.onNodeWithTag(ChatsTags.DIVIDER).assertDoesNotExist()
    }

    @Test fun anOldPracticeChatWithItsThreadShowsOnce() {
        val practice = ClaudeInbox.Thread("pc-c-cafe", "At the café", ClaudeChats.Context(ClaudeChats.PRACTICE, conversationId = "c-cafe", scenario = "At the café"), createdAt = "2026-09-30T18:00:00Z", lastMessageAt = "2026-09-30T18:30:00Z")
        val ui = S.learner.copy(threads = S.threads + practice)
        assertEquals(1, ui.items.count { it.key == "c:pc-c-cafe" || it.key == "h:c-cafe" })
        assertEquals("c:pc-c-cafe", ui.items.single { it.badge?.icon == "🎭" }.key)
        // Search still looks at the context too.
        assertEquals(listOf("c:t-card"), S.learner.copy(query = "银行").shown.map { it.key })
    }

    @Test fun theContextEmojiOpensItsPopoverAndTheCard() {
        val info = mutableListOf<String?>()
        val cards = mutableListOf<String>()
        val opened = mutableListOf<String>()
        show(S.learner, ChatsActions(onContextInfo = { info += it }, onCard = { cards += it }, onOpen = { opened += it.key }))
        val emojis = compose.onAllNodesWithTag(ChatsTags.CONTEXT_CHIP, useUnmergedTree = true).fetchSemanticsNodes()
        assertTrue(emojis.size >= 4)
        compose.onNodeWithContentDescription("Asked on card · 银行", useUnmergedTree = true).performClick()
        assertEquals(listOf<String?>("c:t-card"), info)
        assertEquals(emptyList(), opened)
        // Open: the full text and "Open card ›".
        show(S.learner.copy(contextInfo = "c:t-card"), ChatsActions(onContextInfo = { info += it }, onCard = { cards += it }, onOpen = { opened += it.key }))
        compose.onNodeWithText("📇 Asked on card · 银行").assertExists()
        compose.onNodeWithText("Open card ›").performClick()
        assertEquals(listOf("n-yinhang"), cards)
        assertEquals(null, info.last())
        // A Check chat's popover has no action.
        show(S.learner.copy(contextInfo = "c:t-check"))
        compose.onNodeWithText("✏️ Check").assertExists()
        compose.onNodeWithTag(ChatsTags.CONTEXT_OPEN).assertDoesNotExist()
        // The row still opens the thread.
        show(S.learner, ChatsActions(onOpen = { opened += it.key }))
        compose.onNodeWithText("银行的“行”为什么读 háng？").performClick()
        assertEquals(listOf("c:t-card"), opened)
        assertEquals("/chats/claude/t-card?source=chats", ChatsViewModel.pathFor(S.learner.items.first { it.key == "c:t-card" }))
        assertEquals("/connections/rel-claude/chat/c-cafe", ChatsViewModel.pathFor(S.learner.items.first { it.key == "h:c-cafe" }))
    }

    @Test fun aReaderAndAnExerciseOpenTheirPages() {
        val paths = mutableListOf<String>()
        show(S.learner.copy(contextInfo = "c:t-reader"), ChatsActions(onPath = { paths += it }))
        compose.onNodeWithText("Open story ›").performClick()
        show(S.learner.copy(contextInfo = "c:t-ex"), ChatsActions(onPath = { paths += it }))
        compose.onNodeWithText("Open lesson ›").performClick()
        assertEquals(2, paths.size)
        assertTrue(paths[0].contains("r-panda"), paths.toString())
        assertTrue(paths[1].contains("l-zenme"), paths.toString())
    }

    // ---------------- the box ----------------

    private data class Sent(val text: String, val intent: String, val spoken: Boolean)

    @Test fun idleTheBoxIsOneRowWithoutCheckOrExplain() {
        show(S.learner, voice = idle)
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SAY).assertExists()
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TYPE).assertExists()
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.intent("explain")).assertDoesNotExist()
        compose.onNodeWithText("To: ").assertDoesNotExist()
        // Typing, but nothing typed yet: still none.
        show(S.learner, voice = typing)
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        // Mid-speech: none; under the review of a finished take: there they are.
        show(S.learner, voice = VoiceDictationUi(phase = "listening", finalText = "我昨天"))
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        show(S.learner, voice = VoiceDictationUi(phase = "review", finalText = "我昨天去了商店"))
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertExists()
    }

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

    @Test fun theTutorSeesTheSameLayout() {
        show(S.tutor)
        compose.onNodeWithTag(ChatsTags.kind("h:c-jerome")).assertContentDescriptionEquals("Student")
        // Her Claude chats are right there, below the divider — no fold.
        compose.onNodeWithTag(ChatsTags.DIVIDER).assertExists()
        compose.onNodeWithTag(ChatsTags.item("c:t-plan")).assertExists()
        assertEquals(listOf("h:c-jerome", "h:c-wei", "h:c-anna"), ClaudeInbox.sections(S.tutor.shown).people.map { it.key })
    }

    @Test fun theTutorsBoxHasNoCheckOrExplain() {
        show(S.tutor.copy(draft = "我想学中文"), voice = typing)
        compose.onNodeWithTag(ChatsComposeTags.ROOT).assertExists()
        compose.onNodeWithTag(ChatsComposeTags.intent("check")).assertDoesNotExist()
        compose.onNodeWithTag(ChatsComposeTags.intent("explain")).assertDoesNotExist()
    }

    @Test fun theNewChatPickerOffersClaudeFirst() {
        var claude = 0
        show(S.learner.copy(pickerOpen = true), ChatsActions(onPickClaude = { claude++ }))
        compose.onNodeWithTag(ChatsTags.NEW_CLAUDE).performClick()
        assertEquals(1, claude)
    }

    // ---------------- shots ----------------

    @Test fun shotLearnerList() = inShell("chats-claude-01-learner-list") { ChatsScreen(S.learner, ChatsActions(), voicePreview = idle) }

    @Test fun shotLearnerListDark() = inShell("chats-claude-02-learner-list-dark", dark = true) { ChatsScreen(S.learner, ChatsActions(), voicePreview = idle) }

    @Test fun shotComposerChinese() = inShell("chats-claude-03-composer-chinese") {
        ChatsScreen(S.learner.copy(draft = "我昨天去了商店买东西了"), ChatsActions(), voicePreview = typing)
    }

    @Test fun shotComposerChineseDark() = inShell("chats-claude-04-composer-chinese-dark", dark = true) {
        ChatsScreen(S.learner.copy(draft = "我昨天去了商店买东西了"), ChatsActions(), voicePreview = typing)
    }

    @Test fun shotContextPopover() = shootScreen("chats-claude-05-context-popover") {
        ChatsScreen(S.learner.copy(contextInfo = "c:t-card"), ChatsActions(), voicePreview = idle)
    }

    @Test fun shotContextPopoverDark() = shootScreen("chats-claude-06-context-popover-dark", dark = true) {
        ChatsScreen(S.learner.copy(contextInfo = "c:t-card"), ChatsActions(), voicePreview = idle)
    }

    @Test fun shotTutorView() = inShell("chats-claude-07-tutor-view", tabs = tutorTabs) { ChatsScreen(S.tutor, ChatsActions(), voicePreview = idle) }

    @Test fun shotTutorViewDark() = inShell("chats-claude-08-tutor-view-dark", tabs = tutorTabs, dark = true) { ChatsScreen(S.tutor, ChatsActions(), voicePreview = idle) }

    @Test fun shotComposerReview() = inShell("chats-claude-09-composer-spoken-review") {
        ChatsScreen(S.learner, ChatsActions(), voicePreview = VoiceDictationUi(phase = "review", finalText = "说不定明天会下雨"))
    }

    @Test fun shotEmpty() = inShell("chats-claude-10-empty") { ChatsScreen(ChatsUi(loaded = true, nowMs = S.now), ChatsActions(), voicePreview = idle) }
}
