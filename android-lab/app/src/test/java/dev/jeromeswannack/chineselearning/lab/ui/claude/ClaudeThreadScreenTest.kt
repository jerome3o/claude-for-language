package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.core.claude.ClaudeChats
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatTags
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachLessonTags
import dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadSamples as S

/**
 * The Claude thread screen (ui/claude; docs/CHAT.md "Claude thread view"): the composer's intents per
 * context, the suggestion chips, the card chip, streaming / tool status, queued and refused messages,
 * the practice banner — plus the Roborazzi shots, light + dark.
 */
class ClaudeThreadScreenTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val typing = VoiceDictationUi(mode = "type")

    private data class Sent(val text: String, val spoken: Boolean, val intent: String, val chip: String?)

    private fun show(ui: ClaudeThreadUi, actions: ClaudeThreadActions) {
        compose.setContent { LabTheme { ClaudeThreadScreen(ui, actions, voicePreview = typing) } }
        compose.waitForIdle()
    }

    // ---------------- composer ----------------

    @Test fun aNewPlainChatOffersCheckAndExplainForChinese() {
        val sent = mutableListOf<Sent>()
        show(S.newChinese, ClaudeThreadActions(onSend = { t, s, i, c -> sent += Sent(t, s, i, c) }))
        compose.onNodeWithTag(ClaudeThreadTags.INTENTS).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.intent("translate")).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.intent("explain")).assertIsEnabled()
        compose.onNodeWithTag(ClaudeThreadTags.intent("check")).assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(listOf(Sent("我昨天去了商店买东西了", false, "check", null)), sent)
    }

    @Test fun englishOffersTranslate() {
        val sent = mutableListOf<Sent>()
        show(ClaudeThreadUi(isNew = true, draft = "I'm running late"), ClaudeThreadActions(onSend = { t, s, i, c -> sent += Sent(t, s, i, c) }))
        compose.onNodeWithTag(ClaudeThreadTags.intent("check")).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.intent("translate")).performClick()
        compose.waitForIdle()
        assertEquals("translate", sent.single().intent)
    }

    @Test fun anEmptyBoxDisablesTheButtons() {
        show(ClaudeThreadUi(isNew = true), ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeThreadTags.intent("check")).assertIsNotEnabled()
        compose.onNodeWithTag(ClaudeThreadTags.intent("explain")).assertIsNotEnabled()
    }

    @Test fun aStartedChatOnlyAsks() {
        show(S.generalStreaming.copy(messages = S.generalStreaming.messages.take(2), draft = "我昨天去了商店"), ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeThreadTags.INTENTS).assertDoesNotExist()
    }

    @Test fun aCardThreadOnlyAsksAndOffersItsChips() {
        val sent = mutableListOf<Sent>()
        show(S.cardEmpty.copy(draft = "我昨天去了商店"), ClaudeThreadActions(onSend = { t, s, i, c -> sent += Sent(t, s, i, c) }))
        compose.onNodeWithTag(ClaudeThreadTags.INTENTS).assertDoesNotExist()
        val chips = ClaudeChats.chipsFor(S.cardContext.core(), S.cardEmpty.language, hasSentence = true)
        compose.onNodeWithTag(ClaudeThreadTags.CHIPS).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.chip(chips[0].id)).performClick()
        compose.waitForIdle()
        assertEquals(Sent(chips[0].question, false, "ask", chips[0].id), sent.single())
    }

    @Test fun chipsHideWhileClaudeAnswersAndAfterTheyWereAsked() {
        show(S.generalStreaming, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeThreadTags.CHIPS).assertDoesNotExist()
        val asked = ClaudeChats.chipsFor(S.cardContext.core(), S.cardThread.language, hasSentence = true)[0]
        val ui = S.cardThread.copy(messages = S.cardThread.messages + S.cardThread.messages[0].copy(id = "u9", content = asked.question))
        assertEquals(false, ui.chips.any { it.id == asked.id })
        // Once the thread has a message: no chips at all (Jerome, Nov 2026); an empty card thread has them.
        assertEquals(emptyList(), ui.chips)
        assertEquals(true, S.cardEmpty.chips.isNotEmpty())
    }

    // ---------------- header ----------------

    @Test fun theCardChipOpensTheCard() {
        var opened: ClaudeChats.Link? = null
        show(S.cardThread, ClaudeThreadActions(onContext = { opened = it }))
        compose.onNodeWithText("📇 Asked on card · 银行", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.CONTEXT_CHIP).performClick()
        compose.waitForIdle()
        assertEquals(ClaudeChats.Link(ClaudeChats.CARD, noteId = "n1"), opened)
    }

    @Test fun aPracticeChatIsReadOnly() {
        show(S.practice, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeThreadTags.READ_ONLY).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.COMPOSER).assertDoesNotExist()
        compose.onNodeWithText("🎭 Practice · 点菜", useUnmergedTree = true).assertIsDisplayed()
    }

    // ---------------- the thread ----------------

    @Test fun aStreamingReplyShowsItsTextSoFar() {
        show(S.generalStreaming, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeChatTags.STREAMING).assertIsDisplayed()
        compose.onNodeWithText("串串就是把菜和肉穿在竹签上，\n放在锅里煮", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeChatTags.PENDING).assertDoesNotExist()
    }

    @Test fun aToolSaysWhatClaudeIsDoing() {
        show(S.generalTool, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeChatTags.PENDING).assertIsDisplayed()
        compose.onNodeWithText(ClaudeChats.turnStatusLine("tool", "search_cards", S.generalTool.language)!!, useUnmergedTree = true).assertIsDisplayed()
    }

    @Test fun aCheckResultIsTheCoachsCard() {
        var asked = 0
        show(S.checkResult, ClaudeThreadActions(coach = dev.jeromeswannack.chineselearning.lab.ui.coach.CoachChatActions(onMistakeLesson = { asked++ })))
        compose.onNodeWithTag(ClaudeChatTags.SPECIAL).assertIsDisplayed()
        compose.onNodeWithText("Needs a little work").assertIsDisplayed()
        compose.onNodeWithTag(CoachLessonTags.CHIP).performClick()
        compose.waitForIdle()
        assertEquals(1, asked)
    }

    @Test fun aQueuedMessageWaits() {
        show(S.queuedOffline, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeChatTags.QUEUED).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.OFFLINE).assertIsDisplayed()
    }

    @Test fun aRefusedMessageSaysWhyAndCanGo() {
        var discarded: String? = null
        show(S.queueRefused, ClaudeThreadActions(thread = ClaudeChatThreadActions(onDiscardQueued = { discarded = it.id })))
        compose.onNodeWithText("Couldn’t send: Keep a message under 2000 characters", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeChatTags.DISCARD).performClick()
        compose.waitForIdle()
        assertEquals("u3", discarded)
    }

    @Test fun theMenuIsOffUntilThereIsAThread() {
        show(S.newChinese, ClaudeThreadActions())
        compose.onNodeWithTag(ClaudeThreadTags.MORE).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.MENU).assertDoesNotExist()
    }

    @Test fun theMenuOpensTheRecap() {
        var recap = 0
        show(S.cardThread.copy(recapCount = 2), ClaudeThreadActions(onRecap = { recap++ }))
        compose.onNodeWithTag(ClaudeThreadTags.MORE).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(ClaudeThreadTags.RECAP).assertTextEquals("📝 2 words to recap").performClick()
        compose.waitForIdle()
        assertEquals(1, recap)
    }

    @Test fun theSheetIsCompact() {
        compose.setContent { LabTheme { ClaudeThreadScreen(S.cardThread, ClaudeThreadActions(), sheet = true, voicePreview = typing) } }
        // No ← and no ✕ (the sheet's grab handle closes it), no context chip, no tutor line.
        assertNull(compose.onAllNodes(androidx.compose.ui.test.hasContentDescription("Back")).fetchSemanticsNodes().firstOrNull())
        compose.onNodeWithTag(ClaudeThreadTags.CLOSE).assertDoesNotExist()
        compose.onNodeWithText("✕").assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.CONTEXT_CHIP).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.SHARED).assertDoesNotExist()
        compose.onNodeWithTag(ClaudeThreadTags.TITLE).assertIsDisplayed()
        compose.onNodeWithTag(ClaudeThreadTags.MORE).assertIsDisplayed()
    }

    @Test fun theTypedComposerIsOneRow() {
        var sent = 0
        compose.setContent { LabTheme { ClaudeThreadScreen(S.cardThread.copy(draft = "为什么？"), ClaudeThreadActions(onSend = { _, _, _, _ -> sent++ }), sheet = true, voicePreview = typing) } }
        // No full-width "✓ Send" pill: a round ➤ beside the box and the 🎤.
        compose.onNodeWithText("✓  Send").assertDoesNotExist()
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).assertIsDisplayed()
        compose.onNodeWithText("➤").assertIsDisplayed()
        compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.MIC).assertIsDisplayed()
        val box = compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.TEXT).fetchSemanticsNode().boundsInRoot
        val send = compose.onNodeWithTag(dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceTextFieldTags.SUBMIT).fetchSemanticsNode().boundsInRoot
        // Same row: the send button sits beside the box, not under it; the box is one line high.
        assertEquals(true, send.top < box.bottom && send.left >= box.right)
        assertEquals(true, box.height < 90f * compose.density.density, "box height ${box.height}")
    }

    @Test fun theTallSheetsHandleCloses() {
        var closed = 0
        compose.setContent { LabTheme { dev.jeromeswannack.chineselearning.lab.ui.kit.LabTallSheet(onDismiss = { closed++ }) { androidx.compose.material3.Text("thread") } } }
        compose.waitForIdle()
        compose.onNode(androidx.compose.ui.test.hasContentDescription("Close")).performClick()
        compose.waitForIdle()
        assertEquals(1, closed)
    }

    @Test fun aSheetsMenuItemsComeFirst() {
        var picked = 0
        val items = listOf(ThreadMenuItem("＋ New chat", "x-new") { picked++ })
        compose.setContent { LabTheme { ClaudeThreadScreen(S.cardThread, ClaudeThreadActions(), sheet = true, voicePreview = typing, menuItems = items) } }
        compose.onNodeWithTag(ClaudeThreadTags.MORE).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("x-new").assertTextEquals("＋ New chat").performClick()
        compose.waitForIdle()
        assertEquals(1, picked)
    }

    // ---------------- screenshots ----------------

    @Test fun shotGeneralStreaming() = shoot("claude-thread-01-general-streaming", settleMs = 600) { ClaudeThreadScreen(S.generalStreaming, ClaudeThreadActions()) }
    @Test fun shotGeneralStreamingDark() = shoot("claude-thread-02-general-streaming-dark", dark = true, settleMs = 600) { ClaudeThreadScreen(S.generalStreaming, ClaudeThreadActions()) }
    @Test fun shotCardThread() = shoot("claude-thread-03-card-chips") { ClaudeThreadScreen(S.cardThread, ClaudeThreadActions()) }
    @Test fun shotCardThreadDark() = shoot("claude-thread-04-card-chips-dark", dark = true) { ClaudeThreadScreen(S.cardThread, ClaudeThreadActions()) }
    @Test fun shotCheckResult() = shoot("claude-thread-05-check-result") { ClaudeThreadScreen(S.checkResult, ClaudeThreadActions()) }
    @Test fun shotCheckResultDark() = shoot("claude-thread-06-check-result-dark", dark = true) { ClaudeThreadScreen(S.checkResult, ClaudeThreadActions()) }
    @Test fun shotQueued() = shoot("claude-thread-07-queued-offline") { ClaudeThreadScreen(S.queuedOffline, ClaudeThreadActions()) }
    @Test fun shotQueuedDark() = shoot("claude-thread-08-queued-offline-dark", dark = true) { ClaudeThreadScreen(S.queuedOffline, ClaudeThreadActions()) }
    @Test fun shotNewChat() = shoot("claude-thread-09-new-chat-composer") { ClaudeThreadScreen(S.newChinese, ClaudeThreadActions(), voicePreview = typing) }
    @Test fun shotTool() = shoot("claude-thread-10-tool-status", settleMs = 600) { ClaudeThreadScreen(S.generalTool, ClaudeThreadActions()) }
}
