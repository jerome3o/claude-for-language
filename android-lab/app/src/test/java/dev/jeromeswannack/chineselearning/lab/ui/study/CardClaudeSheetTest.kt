package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.chinese.Segmenter
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.testing.Samples
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadActions
import dev.jeromeswannack.chineselearning.lab.ui.claude.ClaudeThreadTags
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatMsg
import dev.jeromeswannack.chineselearning.lab.ui.claudechat.ClaudeChatTags
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.study.CardClaudeSamples as S

/**
 * Ask Claude on a study card = the card's Claude thread in a sheet (ui/study/CardClaudeSheet.kt; the
 * web's components/claude/CardClaudeSheet.tsx): the card's chips and Ask only (no Check / Explain),
 * my checked question's ✎ + Open in Coach, "Earlier about 银行", Claude's card tools as lines with Undo,
 * a question written offline that will send when online. Roborazzi: `card-claude-*` (over the card,
 * light + dark).
 */
class CardClaudeSheetTest : LabScreenshotTest() {
    @Before fun words() = DeviceWords.setForTests(Segmenter.shipped)
    @After fun noWords() = DeviceWords.setForTests(null)

    private val note = Samples.note.copy(hanzi = "银行", pinyin = "yínháng", english = "bank", sentenceClue = "我去银行取钱。")
    private val view = CardView(
        QueueCard("c1", note.id, "d1", CardTypes.HANZI_TO_MEANING, CardScheduler.initialCardState()), note, Samples.sentences,
        CardScheduler.intervalPreviews(CardScheduler.initialCardState(), Js.parseDate("2026-11-03T09:30:00.000Z")), emptyList(), 1, "HSK 2", true,
    )

    @Test fun cardChipsAndAskOnly() {
        val sent = mutableListOf<Pair<String, String?>>()
        compose.setContent { LabTheme { CardThreadPreview(S.empty, actions = ClaudeThreadActions(onSend = { text, _, _, chip -> sent += text to chip })) } }
        // Compact (Jerome, Nov 2026): no ✕, no "Asked on card" chip, no tutor line in the sheet.
        assertTrue(compose.onAllNodesWithTag(ClaudeThreadTags.CONTEXT_CHIP).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithTag(ClaudeThreadTags.CLOSE).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithText("✕").fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithTag(ClaudeThreadTags.SHARED).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag(ClaudeThreadTags.EMPTY).assertTextContains("simple Chinese", substring = true)
        compose.onNodeWithTag(ClaudeThreadTags.chip("fun_fact")).assertExists()
        compose.onNodeWithTag(ClaudeThreadTags.chip("sentence")).assertExists()
        assertEquals(0, compose.onAllNodesWithTag(ClaudeThreadTags.INTENTS).fetchSemanticsNodes().size)
        compose.onNodeWithTag(ClaudeThreadTags.chip("sentences")).performClick()
        assertEquals("sentences", sent.single().second)
    }

    @Test fun checkedQuestionAndCardTools() {
        var undone: String? = null
        val coach = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                CardThreadPreview(
                    S.conversation, height = androidx.compose.ui.unit.Dp(1400f),
                    actions = ClaudeThreadActions(onOpenCoach = { m: ClaudeChatMsg, source -> coach += "${m.id}:$source" }),
                    claude = CardClaudeActions(canUndo = { true }, undo = { id -> undone = id }),
                )
            }
        }
        // My question: the ✎ mark and the Open in Coach chip (the chat's auto-check).
        compose.onNodeWithTag(ClaudeChatTags.MARK, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("🎓 Open in Coach", substring = true).performClick()
        assertEquals(listOf("u1:chip"), coach)
        // Claude's edit: a line with Undo.
        compose.onNodeWithTag(CardClaudeTags.tool("edited")).assertExists()
        compose.onNodeWithText("✓ Claude edited this card · notes", substring = true).assertExists()
        compose.onNodeWithTag(CardClaudeTags.UNDO).performClick()
        compose.waitForIdle()
        assertEquals("a4", undone)
        compose.onNodeWithText("Undone", substring = true).assertExists()
    }

    @Test fun longPressOpensTheMenu() {
        compose.setContent { LabTheme { CardThreadPreview(S.conversation, height = androidx.compose.ui.unit.Dp(1400f), actions = ClaudeThreadActions(onOpenCoach = { _, _ -> })) } }
        compose.onAllNodesWithTag(ClaudeChatTags.MINE)[0].performTouchInput { longClick() }
        compose.onNodeWithTag(ClaudeChatTags.MENU).assertIsDisplayed()
        compose.onNodeWithText("How to say it better", substring = true).assertExists()
    }

    @Test fun earlierThreadsAndNewChatAreInTheMenu() {
        var fresh = 0
        compose.setContent { LabTheme { CardThreadPreview(S.conversation, earlier = S.earlier, onNew = { fresh++ }) } }
        // Not under the header any more; no chips once the thread has messages.
        assertTrue(compose.onAllNodesWithTag(CardClaudeTags.EARLIER).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithTag(CardClaudeTags.NEW_CHAT).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodesWithTag(ClaudeThreadTags.CHIPS).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag(ClaudeThreadTags.MORE).performClick()
        compose.onNodeWithTag(CardClaudeTags.EARLIER).assertTextContains("🕘 Earlier about 银行 · 2 chats").performClick()
        assertEquals(2, compose.onAllNodesWithTag(CardClaudeTags.EARLIER_ROW).fetchSemanticsNodes().size)
        compose.onNodeWithTag(CardClaudeTags.EARLIER_HIDE).performClick()
        assertTrue(compose.onAllNodesWithTag(CardClaudeTags.EARLIER_ROW).fetchSemanticsNodes().isEmpty())
        compose.onNodeWithTag(ClaudeThreadTags.MORE).performClick()
        compose.onNodeWithTag(CardClaudeTags.NEW_CHAT).assertTextContains("＋ New chat").performClick()
        assertEquals(1, fresh)
    }

    @Test fun menuItemsOfANewChat() {
        assertEquals(listOf(CardClaudeTags.EARLIER), cardMenuItems("银行", 2, canStartNew = false, onEarlier = {}, onNew = {}).map { it.tag })
        assertEquals(emptyList(), cardMenuItems("银行", 0, canStartNew = false, onEarlier = {}, onNew = {}))
        assertEquals(listOf("🕘 Earlier about 银行 · 1 chat", "＋ New chat"), cardMenuItems("银行", 1, canStartNew = true, onEarlier = {}, onNew = {}).map { it.label })
    }

    @Test fun aChineseReplyAskedForEnglishWithACardEditIsTappable() {
        // Jerome, Nov 2026 (空间): "on the second message the text isn't clickable" — the turn asked for
        // English (stored 'en'), Claude edited the card and answered in Chinese: drawn as Markdown, no chips.
        val ui = S.kongJian
        compose.setContent { LabTheme { CardThreadPreview(ui, height = androidx.compose.ui.unit.Dp(1600f)) } }
        val replies = compose.onAllNodesWithTag(ClaudeChatTags.REPLY, useUnmergedTree = true).fetchSemanticsNodes()
        assertEquals(2, replies.size)
        compose.onNodeWithTag(CardClaudeTags.tool("edited")).assertExists()
        // Both of Claude's replies are word chips (the second one too).
        compose.onAllNodesWithContentDescription("已经", substring = false, useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.isNotEmpty(), "已经 is a chip") }
        compose.onAllNodesWithContentDescription("用法", useUnmergedTree = true).fetchSemanticsNodes().let { assertTrue(it.isNotEmpty(), "用法 is a chip") }
        assertEquals(2, compose.onAllNodesWithTag(ClaudeChatTags.PLAY, useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    @Test fun queuedOffline() {
        compose.setContent { LabTheme { CardThreadPreview(S.ui(listOf(S.mine("u1", "银行和很行有什么不同？", queued = true)), online = false)) } }
        compose.onNodeWithTag(ClaudeChatTags.QUEUED).assertTextContains("Will send when you’re online", substring = true)
    }

    @Test fun deletedCardHasNoComposer() {
        compose.setContent { LabTheme { CardThreadPreview(S.conversation, closedNote = "This card was deleted — moving on to the next one.") } }
        compose.onNodeWithTag(ClaudeThreadTags.CLOSED).assertIsDisplayed()
        assertTrue(compose.onAllNodesWithTag(ClaudeThreadTags.COMPOSER).fetchSemanticsNodes().isEmpty())
    }

    // ---- Roborazzi: the sheet over the card, light + dark ----

    @Test fun shotEmpty() = shoot("card-claude-01-empty") { OverStudyCard(view) { CardThreadPreview(S.empty, height = androidx.compose.ui.unit.Dp(640f)) } }
    @Test fun shotConversation() = shoot("card-claude-02-reply-edit") { OverStudyCard(view) { CardThreadPreview(S.edited, height = androidx.compose.ui.unit.Dp(760f), earlier = S.earlier) } }
    @Test fun shotConversationDark() = shoot("card-claude-03-reply-edit-dark", dark = true) { OverStudyCard(view) { CardThreadPreview(S.edited, height = androidx.compose.ui.unit.Dp(760f), earlier = S.earlier) } }
    @Test fun shotEmptyDark() = shoot("card-claude-04-empty-dark", dark = true) { OverStudyCard(view) { CardThreadPreview(S.empty, height = androidx.compose.ui.unit.Dp(640f)) } }
    // Jerome's 稍等 example, the whole height the sheet now takes (top just under the status bar).
    @Test fun shotLongAnswer() = shoot("card-claude-06-long-answer") { OverStudyCard(view) { CardThreadPreview(S.shaoDeng, height = androidx.compose.ui.unit.Dp(880f), earlier = S.earlier) } }
    @Test fun shotLongAnswerDark() = shoot("card-claude-07-long-answer-dark", dark = true) { OverStudyCard(view) { CardThreadPreview(S.shaoDeng, height = androidx.compose.ui.unit.Dp(880f), earlier = S.earlier) } }
    @Test fun shotMenuDark() = shoot("card-claude-08-menu-dark", dark = true) { OverStudyCard(view) { CardThreadPreview(S.shaoDeng, height = androidx.compose.ui.unit.Dp(880f), earlier = S.earlier, menuOpen = true) } }
    // The typed composer: ONE row (box · 🎤 · ➤), no full-width Send.
    @Test fun shotTypedDark() = shoot("card-claude-09-typed-dark", dark = true) {
        OverStudyCard(view) { CardThreadPreview(S.shaoDeng.copy(draft = "「稍等」可以跟老师说吗？"), height = androidx.compose.ui.unit.Dp(880f), voicePreview = dev.jeromeswannack.chineselearning.lab.ui.kit.VoiceDictationUi(mode = "type")) }
    }
    // Jerome's 空间 chat: the reply after the card edit (asked for English, written in Chinese) is word chips now.
    @Test fun shotSecondReplyChipsDark() = shoot("card-claude-10-second-reply-dark", dark = true) {
        OverStudyCard(view) { CardThreadPreview(S.kongJian, height = androidx.compose.ui.unit.Dp(880f)) }
    }
    @Test fun shotQueued() = shoot("card-claude-05-offline-queued") {
        OverStudyCard(view) { CardThreadPreview(S.ui(listOf(S.mine("u1", "银行和很行有什么不同？", queued = true)), online = false), height = androidx.compose.ui.unit.Dp(560f)) }
    }
}
