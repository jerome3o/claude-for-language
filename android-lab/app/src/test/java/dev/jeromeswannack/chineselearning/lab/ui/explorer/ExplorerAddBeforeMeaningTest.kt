package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import dev.jeromeswannack.chineselearning.lab.core.SourceDecks
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.api.AddedNote
import dev.jeromeswannack.chineselearning.lab.data.chars.WordDict
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.ADD_CHUNK_FILL_ENGLISH_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.ADD_CHUNK_FILL_HINT_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.ADD_CHUNK_FILL_PINYIN_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.ADD_CHUNK_FILL_SAVE_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.ADD_CHUNK_FILL_TAG
import dev.jeromeswannack.chineselearning.lab.ui.study.Chunk
import dev.jeromeswannack.chineselearning.lab.ui.study.SentenceActions
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "+ Add as card" tapped before the word's meaning has loaded failed with "english is required"
 * (the ＋ Add tab sends him straight into the Word view and he taps fast). Now the tap WAITS for
 * the lookup ("Adding…"), asks the gloss path for a meaning the phone lacks, and otherwise opens
 * the add sheet's fill mode — "What does 吴侬 mean?" — offline too, never a raw error.
 * Web: WordView.test.tsx ("+ Add as card before the meaning has loaded").
 */
class ExplorerAddBeforeMeaningTest : LabScreenshotTest() {
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val added = ArrayList<Pair<String, Chunk>>()
    private val addActions = SentenceActions(
        addCard = { deckId, c ->
            added += deckId to c
            val key = SourceDecks.parseRef(deckId)!!
            AddedNote(listOf("n-new"), "d-$key", SourceDecks.name(key), key)
        },
    )

    private fun host(controller: ExplorerController, env: ExplorerEnv) = compose.setContent {
        LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, env) } }
    }

    @Test fun addTappedBeforeTheLookupWaitsThenSavesWithTheMeaning() {
        val lookup = CompletableDeferred<WordDict.Lookup>()
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, ExplorerSamples.env(addActions = addActions, wordLookup = { lookup.await() }))
        compose.runOnIdle { controller.open(ExplorerItem.Word("银行"), "add") }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        compose.onNodeWithTag("explorer-add").performClick()
        compose.mainClock.advanceTimeByFrame()
        // Still looking it up: nothing sent, the pill says so.
        compose.onNodeWithTag("explorer-add").assertTextContains("Adding…").assertIsNotEnabled()
        assertTrue(added.isEmpty())
        lookup.complete(WordDict.Lookup.Ok(ExplorerSamples.yinhang))
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
        assertEquals(listOf("source:explorer" to Chunk("银行", "yínháng", "bank", null)), added)
        assertEquals(0, compose.onAllNodesWithTag(ADD_CHUNK_FILL_TAG).fetchSemanticsNodes().size)
    }

    @Test fun aWordTheDictionaryLacksIsGlossedThenAdded() {
        val glossed = ArrayList<Pair<String, String?>>()
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(
            controller,
            ExplorerSamples.env(
                addActions = addActions,
                word = WordDict.Lookup.Missing,
                gloss = { h, p -> glossed += h to p; "wrong" to "soft-spoken Wu speech" },
            ),
        )
        compose.runOnIdle { controller.open(ExplorerItem.Word("吴侬"), "add") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        // The phone's own reading (not the gloss's) goes with it.
        assertEquals(listOf("吴侬" to "wúnóng"), glossed)
        assertEquals(listOf("source:explorer" to Chunk("吴侬", "wúnóng", "soft-spoken Wu speech", null)), added)
        assertTrue(events.any { it.first == "explorer.add_gloss" && it.second["found"] == true })
    }

    @Test fun noMeaningAnywhereOpensTheFillSheetAndAddsWhatHeTypes() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, ExplorerSamples.env(addActions = addActions, word = WordDict.Lookup.Missing))
        compose.runOnIdle { controller.open(ExplorerItem.Word("吴侬"), "add") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        assertTrue(added.isEmpty())
        compose.onNodeWithTag(ADD_CHUNK_FILL_TAG).assertIsDisplayed()
        compose.onNodeWithText("What does 吴侬 mean?").assertIsDisplayed()
        compose.onNodeWithTag(ADD_CHUNK_FILL_PINYIN_TAG).assertTextContains("wúnóng")
        compose.onNodeWithTag(ADD_CHUNK_FILL_SAVE_TAG).assertIsNotEnabled()
        compose.onNodeWithTag(ADD_CHUNK_FILL_ENGLISH_TAG).performTextInput("Wu people")
        compose.onNodeWithTag(ADD_CHUNK_FILL_SAVE_TAG).assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(listOf("source:explorer" to Chunk("吴侬", "wúnóng", "Wu people", null)), added)
        assertTrue(events.any { it.first == "explorer.add_fill" && it.second["reason"] == "no_meaning" })
    }

    @Test fun offlineOpensTheFillSheetWithAClearPromptAndWaitsForAConnection() {
        var online = false
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, ExplorerSamples.env(addActions = addActions, word = WordDict.Lookup.Offline, onlineNow = { online }))
        compose.runOnIdle { controller.open(ExplorerItem.Word("吴侬"), "add") }
        compose.waitForIdle()
        compose.onNodeWithTag("explorer-add").performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(ADD_CHUNK_FILL_TAG).assertIsDisplayed()
        compose.onNodeWithText("What does 吴侬 mean?").assertIsDisplayed()
        compose.onNodeWithTag(ADD_CHUNK_FILL_HINT_TAG).assertTextContains("offline", substring = true)
        compose.onNodeWithTag(ADD_CHUNK_FILL_ENGLISH_TAG).performTextInput("Wu people")
        compose.onNodeWithTag(ADD_CHUNK_FILL_SAVE_TAG).assertTextContains("Waiting for a connection…").assertIsNotEnabled()
        assertTrue(added.isEmpty())
        online = true
        compose.mainClock.advanceTimeBy(1500)
        compose.waitForIdle()
        compose.onNodeWithTag(ADD_CHUNK_FILL_SAVE_TAG).assertIsEnabled().performClick()
        compose.waitForIdle()
        assertEquals(listOf("source:explorer" to Chunk("吴侬", "wúnóng", "Wu people", null)), added)
        assertTrue(events.any { it.first == "explorer.add_fill" && it.second["reason"] == "offline" })
    }

    @Test fun theCharacterViewsAddAsksTooWhenTheCharacterIsntOnThePhone() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, ExplorerSamples.env(addActions = addActions))
        compose.runOnIdle { controller.open(ExplorerItem.Char("侬"), "add") }
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_CHAR_ADD_TAG).performClick()
        compose.waitForIdle()
        assertTrue(added.isEmpty())
        compose.onNodeWithText("What does 侬 mean?").assertIsDisplayed()
        compose.onNodeWithTag(ADD_CHUNK_FILL_PINYIN_TAG).assertTextContains("nóng")
    }
}
