package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Test
import kotlin.test.assertEquals
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachBackgroundSamples as B

/** Coach replies written in the background, no quick actions; the new-words picker the podcast episodes use (docs/CHAT.md "Chat ↔ Coach"). */
class CoachBackgroundTest : dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest() {

    @Test fun pendingAnalysisIsTheLoadingCard() {
        compose.setContent { LabTheme { CoachConversationPreview(CoachChatUi(thread = Loadable(B.pendingAnalysis)), CoachChatActions()) } }
        compose.onNodeWithTag(COACH_REPLY_PENDING_TAG).assertIsDisplayed()
        compose.onNodeWithText("Checking your sentence…").assertIsDisplayed()
    }

    @Test fun failedReplyRetries() {
        var retried: String? = null
        compose.setContent { LabTheme { CoachConversationPreview(CoachChatUi(thread = Loadable(B.failedReply), followUp = "x"), CoachChatActions(onRetryReply = { retried = it })) } }
        compose.onNodeWithText("Claude is busy right now — try again in a moment.").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertEquals("p4", retried)
    }

    @Test fun noQuickActionsOrDeckPicker() {
        compose.setContent { LabTheme { CoachConversationPreview(B.quickActions, CoachChatActions()) } }
        compose.onNodeWithText("Yesterday I went to the shop to buy things.").assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTextCount("Cards go to"))
        assertEquals(0, compose.onAllNodesWithTextCount("➕ Add new words (2)"))
        assertEquals(0, compose.onAllNodesWithTextCount("🃏 Card for this sentence"))
        assertEquals(0, compose.onAllNodesWithTextCount("💬 More examples"))
        assertEquals(0, compose.onAllNodesWithTextCount("📝 Card for the whole sentence"))
    }

    @Test fun pickerStartsWithNothingTicked() {
        val ticked = mutableListOf<String>()
        compose.setContent { LabTheme { CoachNewWordsForm(B.sheet, NewWordsActions(onToggle = { ticked += it })) } }
        compose.onNodeWithTag(CoachNewWordsTags.ADD).assertIsNotEnabled()
        compose.onNodeWithText("Tick the words to add").assertIsDisplayed()
        compose.onNodeWithTag(CoachNewWordsTags.row("商店")).performClick()
        assertEquals(listOf("商店"), ticked)
    }

    @Test fun pickerWithTwoTicked() {
        compose.setContent { LabTheme { CoachNewWordsForm(B.sheet.copy(picked = setOf("商店", "东西")), NewWordsActions()) } }
        compose.onNodeWithText("➕ Add 2 words").assertIsDisplayed()
        compose.onNodeWithTag(CoachNewWordsTags.ADD).assertIsEnabled()
    }

    @Test fun doneScreenOffersStudyItToday() {
        var bumped: String? = null
        val done = B.sheet.copy(
            picked = setOf("商店", "东西"),
            result = NewWordsResult(listOf("商店"), "HSK 3 · Plans & time", listOf(dev.jeromeswannack.chineselearning.lab.data.api.BatchExistingDto(1, "东西", "n7", "Everyday words")), emptyList()),
        )
        compose.setContent { LabTheme { CoachNewWordsForm(done, NewWordsActions(onBump = { bumped = it })) } }
        compose.onNodeWithText("✓ Added 1 card to HSK 3 · Plans & time: 商店").assertIsDisplayed()
        compose.onNodeWithText("Already in Everyday words").assertIsDisplayed()
        compose.onNodeWithTag(CoachNewWordsTags.bump("n7")).performClick()
        assertEquals("n7", bumped)
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTextCount(text: String): Int =
        onAllNodes(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size
}
