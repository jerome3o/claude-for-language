package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.claude.AddedCardChips
import dev.jeromeswannack.chineselearning.lab.ui.claude.AddedCardTags
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachToolResults
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "When in the chat with Claude … it creates a card, a little UI element says 'added one card'. I'd
 * like to be able to tap that and see that word in the graph view so I can click ⚡ Study it today"
 * (Jerome, Nov 2026): each word of the "✓ Added" line is a chip → the explorer on it, the line's
 * cards marked just added, so ⚡ Study it today is there before the sync brings the note into Room.
 * Web: ClaudeThreadView.test.tsx / WordView.test.tsx.
 */
class ClaudeAddedCardsTest : LabScreenshotTest() {
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val bumps = ArrayList<Pair<List<String>, String?>>()

    private val cards = listOf(
        CardTools.AddedCard("n1", "银行", "yínháng", "bank", "d-claude", "From Claude"),
        CardTools.AddedCard("n2", "这次机会很难得。", "zhè cì jīhuì hěn nándé.", "This chance is rare.", "d-claude", "From Claude"),
    )

    private fun host(controller: ExplorerController) = compose.setContent {
        LabTheme {
            CompositionLocalProvider(LocalExplorer provides controller) {
                Column(Modifier.padding(16.dp)) { AddedCardChips(cards, "thread", Palette.Good) }
                ExplorerHost(controller, ExplorerSamples.env(bump = { h, deck -> bumps += h to deck; "⚡ ${h.first()} is in today's study" }))
            }
        }
    }

    @Test fun aChipOpensTheExplorerOnItsWordWithStudyItTodayAtOnce() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller)
        compose.waitForIdle()
        assertEquals(2, compose.onAllNodesWithTag(AddedCardTags.CHIP).fetchSemanticsNodes().size)
        compose.onNodeWithText("银行").performClick()
        compose.waitForIdle()

        assertEquals(ExplorerItem.Word("银行", "yínháng", "bank", null), controller.current)
        assertEquals("claude_card", controller.openSource)
        assertTrue(events.any { it.first == "claude.added_card_open" && it.second["surface"] == "thread" && it.second["count"] == 2 })
        assertTrue(events.any { it.first == "explorer.open" && it.second["source"] == "claude_card" })
        // Not in Room yet (the sample env has no card): shown as just added — never "+ Add as card".
        compose.onNodeWithTag(EXPLORER_ADDED_TAG).assertIsDisplayed()
        compose.onNodeWithText("Added to From Claude", substring = true).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag("explorer-add").fetchSemanticsNodes().size)
        compose.onNodeWithTag("explorer-bump").performClick()
        compose.waitForIdle()
        assertEquals(listOf(listOf("银行") to "d-claude"), bumps)
    }

    @Test fun aSentenceCardOpensTheWordViewOfItsCharacters() {
        val controller = ExplorerController()
        compose.setContent { LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { AddedCardChips(cards, "card_sheet", Palette.Good) } } }
        compose.onNodeWithText("这次机会很难得。").performClick()
        compose.waitForIdle()
        assertEquals(ExplorerItem.Word("这次机会很难得", "zhè cì jīhuì hěn nándé.", "This chance is rare.", null), controller.current)
        assertEquals(setOf("银行", "这次机会很难得"), controller.justAdded.keys)
    }

    private val twoCards = """[{"tool":"create_flashcards","success":true,"data":{"deck_id":"d-claude","deck_name":"From Claude","deck_source_key":"claude","notes":[{"id":"n1","hanzi":"机会","pinyin":"jīhuì","english":"opportunity"},{"id":"n2","hanzi":"难得","pinyin":"nándé","english":"rare"}]}}]"""

    @Test fun theThreadsAddedLineHasAChipPerCard() {
        val controller = ExplorerController()
        compose.setContent { LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { Column { CoachToolResults(twoCards) } } } }
        compose.onNodeWithTag("claude-added-cards").assertIsDisplayed()
        compose.onNodeWithText("✓ Added 2 cards to From Claude").assertIsDisplayed()
        assertEquals(2, compose.onAllNodesWithTag(AddedCardTags.CHIP).fetchSemanticsNodes().size)
        compose.onNodeWithText("难得").performClick()
        compose.waitForIdle()
        assertEquals("难得", (controller.current as ExplorerItem.Word).hanzi)
    }

    @Test fun shotTwoCards() = shoot("claude-added-cards-01") {
        CompositionLocalProvider(LocalExplorer provides ExplorerController()) { Column(Modifier.padding(16.dp)) { CoachToolResults(twoCards) } }
    }

    @Test fun shotTwoCardsDark() = shoot("claude-added-cards-02-dark", dark = true) {
        CompositionLocalProvider(LocalExplorer provides ExplorerController()) { Column(Modifier.padding(16.dp)) { CoachToolResults(twoCards) } }
    }
}
