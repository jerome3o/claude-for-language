package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.ChatLearning
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChatLearningSamples as S

/**
 * docs/CHAT.md PR 3 as the user taps it: a word chip → the sheet (message + word index), the
 * 拼 / EN toggles, selection quick picks + rows + Make cards, the review sheet's checks and Add,
 * the student's "Make a card" on a correction, ✓ check → Use this.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class, qualifiers = "w412dp-h915dp-xxhdpi")
class ChatLearningComposeTest {
    @get:Rule val compose = createComposeRule()

    private class Rec {
        val calls = mutableListOf<String>()
    }

    private fun actions(rec: Rec) = ChatActions(
        onChip = { m, i -> rec.calls += "chip ${m.id} $i" },
        onTogglePinyin = { rec.calls += "pinyin $it" },
        onToggleTranslation = { rec.calls += "translation $it" },
        onRequestWords = { m: ChatMessageDto -> rec.calls += "words ${m.id}" },
        onSelectToday = { rec.calls += "today" },
        onSelectLast = { rec.calls += "last" },
        onToggleSelect = { rec.calls += "select $it" },
        onPropose = { rec.calls += "propose" },
        onCorrectionCard = { rec.calls += "correction-card ${it.id}" },
        onCheckDraft = { rec.calls += "check" },
        onUseCheck = { rec.calls += "use" },
        onSendAsIs = { rec.calls += "send-as-is" },
    )

    private fun show(ui: ChatUi, rec: Rec) = compose.setContent { LabTheme { ChatScreen(ui, actions(rec)) } }

    private val two = S.student.copy(messages = listOf(S.m1, S.m2), aids = ChatLearning.Aids())

    @Test fun chipsOpenTheWordSheet_andBubblesCarryNoToggles() {
        val rec = Rec()
        show(two, rec)
        assertTrue(compose.onAllNodesWithTag("chat-word-chip").fetchSemanticsNodes().size >= 8)
        compose.onNodeWithText("商店").performClick()
        compose.onNodeWithText("周末").performClick()
        compose.waitForIdle()
        assertEquals(listOf("chip m2 3", "chip m1 0"), rec.calls.filter { !it.startsWith("words") })
        // Round 2: 拼 / EN live in the long-press menu now, not under every bubble.
        assertEquals(0, compose.onAllNodesWithTag("chat-toggle-pinyin").fetchSemanticsNodes().size)
        assertEquals(0, compose.onAllNodesWithTag("chat-toggle-translation").fetchSemanticsNodes().size)
    }

    @Test fun messagesWithoutWordsAskForThem_andShowThePhonesPinyin() {
        val rec = Rec()
        val bare = S.m1.copy(words = null)
        show(S.student.copy(messages = listOf(bare), aids = ChatLearning.Aids(pinyinAll = true)), rec)
        compose.waitForIdle()
        assertTrue("words m1" in rec.calls)
        compose.onNodeWithTag("chat-pinyin", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("周末你做了什么？").assertExists()
    }

    @Test fun selectionPicksAndMakesCards() {
        val rec = Rec()
        show(two.copy(selection = SelectionUi(setOf("m2"))), rec)
        compose.onNodeWithTag("chat-pick-today").performClick()
        compose.onNodeWithTag("chat-pick-last").performClick()
        compose.onAllNodesWithTag("chat-select-row")[0].performClick()
        compose.onNodeWithTag("chat-propose").performClick()
        compose.waitForIdle()
        assertEquals(listOf("today", "last", "select m1", "propose"), rec.calls.filter { !it.startsWith("words") })
    }

    @Test fun studentMakesACardFromTheCorrection_throughTheMenu() {
        val rec = Rec()
        show(two, rec)
        compose.onNodeWithTag("chat-correction").assertExists()
        // No button under the correction any more: it is "Make a card from the correction" in the menu.
        assertEquals(0, compose.onAllNodesWithTag("chat-correction-card").fetchSemanticsNodes().size)
        assertTrue(two.menu(S.m2).items.any { it.id == dev.jeromeswannack.chineselearning.lab.core.MessageMenu.CORRECTION_CARD })
    }

    @Test fun checkThenUseThis() {
        val rec = Rec()
        show(two.copy(draft = S.draft, draftCheck = S.check), rec)
        compose.onNodeWithTag("chat-check-panel").assertExists()
        compose.onNodeWithTag("chat-check-use").performClick()
        compose.onNodeWithTag("chat-check-send").performClick()
        compose.onNodeWithTag("chat-check-draft").performClick()
        compose.waitForIdle()
        assertEquals(listOf("use", "send-as-is", "check"), rec.calls.filter { !it.startsWith("words") })
    }

    @Test fun reviewChecksAndAdds() {
        val calls = mutableListOf<String>()
        compose.setContent {
            LabTheme {
                ReviewPanel(
                    S.review, S.decks, online = true,
                    ReviewActions(onToggle = { calls += "toggle $it" }, onSave = { calls += "save" }, onPickDeck = { calls += "deck $it" }, onOpenEdit = { calls += "edit $it" }),
                )
            }
        }
        // 买东西 is already in the decks: unchecked, so 3 of 4.
        compose.onNodeWithText("3 of 4 checked · tap ✎ to change a card").assertExists()
        compose.onNodeWithTag("chat-review-have", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("买东西").performClick()
        compose.onNodeWithText("HSK 3").performClick()
        compose.onAllNodesWithTag("chat-review-edit")[2].performClick()
        compose.onNodeWithText("Add 3 cards").performClick()
        compose.waitForIdle()
        assertEquals(listOf("toggle 1", "deck d2", "edit 2", "save"), calls)
    }
}
