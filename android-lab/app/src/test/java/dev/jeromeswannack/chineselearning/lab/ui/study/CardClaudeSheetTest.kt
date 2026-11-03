package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.layout.Box
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onAllNodesWithTag
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
        compose.onNodeWithTag(ClaudeThreadTags.CONTEXT_CHIP).assertTextContains("Asked on card · 银行", substring = true)
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

    @Test fun earlierThreads() {
        compose.setContent { LabTheme { CardThreadPreview(S.conversation, earlier = S.earlier) } }
        compose.onNodeWithTag(CardClaudeTags.EARLIER).assertTextContains("Earlier about 银行 · 2 chats", substring = true).performClick()
        assertEquals(2, compose.onAllNodesWithTag(CardClaudeTags.EARLIER_ROW).fetchSemanticsNodes().size)
        compose.onNodeWithTag(CardClaudeTags.NEW_CHAT).assertExists()
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
    @Test fun shotQueued() = shoot("card-claude-05-offline-queued") {
        OverStudyCard(view) { CardThreadPreview(S.ui(listOf(S.mine("u1", "银行和很行有什么不同？", queued = true)), online = false), height = androidx.compose.ui.unit.Dp(560f)) }
    }
}
