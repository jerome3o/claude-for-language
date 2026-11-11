package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.chars.OwnCardInfo
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.core.SourceDecks
import dev.jeromeswannack.chineselearning.lab.data.api.AddedNote
import dev.jeromeswannack.chineselearning.lab.ui.kit.SourceDeckActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "After I add one of these as a card, it doesn't allow me to then select ⚡ Study it today …
 * you end up having to close the view and open it again a few times" (Jerome, Nov 2026): the new
 * note reaches Room only with the sync the add starts, so right after "+ Add as card" the view
 * says "✓ Added to <deck>" and offers ⚡ Study it today at once (the server has the note, the bump
 * goes by the word + that deck), then shows the card itself as soon as the sync brings it.
 * Web: WordView.test.tsx.
 */
class ExplorerJustAddedTest : LabScreenshotTest() {
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val bumps = ArrayList<Pair<List<String>, String?>>()
    private val added = ArrayList<Pair<String, String>>()
    private val moved = ArrayList<Pair<List<String>, String>>()
    // Source decks: the sheet adds at once into the source deck (the ref), the server names the deck.
    private val addActions = SentenceActions(
        decks = { listOf("d-hsk2" to "HSK 2", "d-travel" to "China trip") },
        addCard = { deckId, c ->
            added += deckId to c.hanzi
            val key = SourceDecks.parseRef(deckId)!!
            AddedNote(listOf("n-new"), "d-$key", SourceDecks.name(key), key)
        },
        move = SourceDeckActions(
            decks = { listOf("d-readers" to "From readers", "d-hsk2" to "HSK 2") },
            move = { a, id, name -> moved += a.noteIds to id; a.copy(deckId = id, deckName = name) },
        ),
    )

    private fun host(controller: ExplorerController, env: ExplorerEnv) = compose.setContent {
        LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, env) } }
    }

    /** ONE tap: the sheet saves by itself (no deck picker), says where it went, Done closes it. */
    private fun addThroughTheSheet(deckName: String) {
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodesWithTag("add-chunk-decks").fetchSemanticsNodes().size)
        compose.onNodeWithTag("added-to-deck").assertIsDisplayed()
        assertTrue(compose.onAllNodesWithText("Added to $deckName", substring = true).fetchSemanticsNodes().isNotEmpty())
        compose.onNodeWithTag("add-chunk-done").performClick()
        compose.waitForIdle()
    }

    @Test fun aWordJustAddedOffersStudyItTodayAtOnce() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, ExplorerSamples.env(addActions = addActions, bump = { h, deck -> bumps += h to deck; "⚡ ${h.first()} is in today's study" }))
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        // Opened from a reader → "From readers" (core SourceDecks.forExplorer).
        addThroughTheSheet("From readers")

        assertEquals(listOf("source:readers" to "银行"), added)
        compose.onNodeWithText("Added to From readers", substring = true).assertIsDisplayed()
        compose.onNodeWithTag(EXPLORER_ADDED_TAG).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag("explorer-add").fetchSemanticsNodes().size)
        compose.onNodeWithTag("explorer-bump").performClick()
        compose.waitForIdle()
        assertEquals(listOf(listOf("银行") to "d-readers"), bumps)
        assertTrue(events.any { it.first == "explorer.add_card" && it.second["source_deck"] == true && it.second["deck_key"] == "readers" })
        compose.onNodeWithText("⚡ 银行 is in today's study").assertExists()
        assertTrue(events.any { it.first == "explorer.bump" && it.second["just_added"] == true })
    }

    @Test fun theCardItselfShowsOnceTheSyncBringsIt() {
        var synced = false
        val controller = ExplorerController()
        host(controller, ExplorerSamples.env(addActions = addActions, myWord = { _, _ -> if (synced) ExplorerSamples.mine else MyWord() }))
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        addThroughTheSheet("From readers")
        compose.onNodeWithTag(EXPLORER_ADDED_TAG).assertIsDisplayed()

        synced = true
        compose.mainClock.advanceTimeBy(2_000)
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodesWithTag(EXPLORER_ADDED_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithTag("explorer-open-card").assertIsDisplayed()
    }

    @Test fun aCharacterJustAddedOffersStudyItTodayToo() {
        val controller = ExplorerController()
        host(controller, ExplorerSamples.env(addActions = addActions, bump = { h, deck -> bumps += h to deck; "⚡ ${h.first()} is in today's study" }))
        compose.runOnIdle { controller.open(ExplorerItem.Char("银"), "study") }
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_CHAR_ADD_TAG).performClick()
        compose.waitForIdle()
        // Opened from the study card → no source of its own → "From the explorer".
        addThroughTheSheet("From the explorer")
        compose.onNodeWithTag(EXPLORER_CHAR_ADDED_TAG).assertIsDisplayed()
        compose.onNodeWithText("Added to From the explorer", substring = true).assertIsDisplayed()
        compose.onNodeWithTag(EXPLORER_CHAR_BUMP_TAG).performClick()
        compose.waitForIdle()
        assertEquals(listOf(listOf("银") to "d-explorer"), bumps)
    }

    @Test fun changeMovesTheJustAddedCard() {
        val controller = ExplorerController()
        host(controller, ExplorerSamples.env(addActions = addActions))
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        compose.onAllNodesWithText("Change")[0].performClick()
        compose.waitForIdle()
        compose.onNodeWithTag("move-to-deck").assertExists()
        compose.onNode(androidx.compose.ui.test.hasText("HSK 2") and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.hasTestTag("move-to-deck"))).performClick()
        compose.waitForIdle()
        assertEquals(listOf(listOf("n-new") to "d-hsk2"), moved)
        assertTrue(compose.onAllNodesWithText("Moved to HSK 2", substring = true).fetchSemanticsNodes().isNotEmpty())
    }
}
