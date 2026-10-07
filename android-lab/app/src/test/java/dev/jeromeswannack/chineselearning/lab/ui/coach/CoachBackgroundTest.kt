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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachBackgroundSamples as B

/** Coach replies written in the background + the new-words quick actions (docs/CHAT.md "Chat ↔ Coach"). */
class CoachBackgroundTest : dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest() {

    @Test fun pendingAnalysisIsTheLoadingCard() {
        compose.setContent { LabTheme { CoachChatScreen(CoachChatUi(thread = Loadable(B.pendingAnalysis), decks = CoachSamples.decks), CoachChatActions()) } }
        compose.onNodeWithTag(COACH_REPLY_PENDING_TAG).assertIsDisplayed()
        compose.onNodeWithText("Checking your sentence…").assertIsDisplayed()
    }

    @Test fun pendingReplyDisablesSend() {
        var sent = 0
        compose.setContent {
            LabTheme { CoachChatScreen(CoachChatUi(thread = Loadable(B.pendingReply), decks = CoachSamples.decks, followUp = "And 去了?"), CoachChatActions(onSend = { sent++ })) }
        }
        compose.onNodeWithTag(COACH_REPLY_PENDING_TAG).assertIsDisplayed()
        compose.onNodeWithTag(COACH_SEND_TAG).assertIsNotEnabled()
        assertEquals(0, sent)
    }

    @Test fun failedReplyRetries() {
        var retried: String? = null
        compose.setContent { LabTheme { CoachChatScreen(CoachChatUi(thread = Loadable(B.failedReply), decks = CoachSamples.decks, followUp = "x"), CoachChatActions(onRetryReply = { retried = it })) } }
        compose.onNodeWithText("Claude is busy right now — try again in a moment.").assertIsDisplayed()
        compose.onNodeWithTag(COACH_SEND_TAG).assertIsEnabled()
        compose.onNodeWithText("Retry").performClick()
        assertEquals("p4", retried)
    }

    @Test fun listShowsThinkingAndFailed() {
        compose.setContent { LabTheme { CoachHomeScreen(CoachHomeUi(conversations = Loadable(B.conversations)), CoachHomeActions(onBack = {})) } }
        compose.onNodeWithTag(COACH_CONV_PENDING_TAG, useUnmergedTree = true).assertExists()
        compose.onNodeWithTag(COACH_CONV_FAILED_TAG, useUnmergedTree = true).assertExists()
    }

    @Test fun quickActionsOfferNewWordsAndTheSentenceCard() {
        var opened = 0
        compose.setContent { LabTheme { CoachChatScreen(B.quickActions, CoachChatActions(onOpenNewWords = { opened++ })) } }
        compose.onNodeWithText("➕ Add new words (2)").assertIsDisplayed().performClick()
        assertEquals(1, opened)
        compose.onNodeWithTag(CoachNewWordsTags.SENTENCE_CARD).assertIsDisplayed()
        // The chat-prompt version of the sentence card is replaced by the direct one.
        assertTrue(compose.onAllNodesWithTextCount("📝 Card for the whole sentence") == 0)
    }

    @Test fun sentenceCardOnlyWhenTheSentenceIsNotACard() {
        assertNotNull(B.quickActions.sentenceCard)
        assertNull(B.quickActions.copy(bumpExact = dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.BumpWord("n1", B.SENTENCE, "", "")).sentenceCard)
        assertNull(B.quickActions.copy(breakdown = B.breakdown.copy(translation = " ")).sentenceCard)
        val card = B.quickActions.sentenceCard!!
        assertEquals(B.SENTENCE, card.hanzi)
        assertTrue(card.funFacts!!.startsWith("我 (wǒ) I\n昨天 (zuótiān) yesterday"))
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
