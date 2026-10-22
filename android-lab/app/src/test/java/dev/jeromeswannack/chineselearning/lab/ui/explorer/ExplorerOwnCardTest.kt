package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CharStatusCard
import dev.jeromeswannack.chineselearning.lab.core.CharStatusNote
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.data.chars.CharDict
import dev.jeromeswannack.chineselearning.lab.data.chars.OwnCardInfo
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.chars.CharSheetUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "In the explorer, it's hard to tell if I already have a card for a single character" (Jerome):
 * the Character view says first whether the character ITSELF is one of his cards — "📚 You have
 * 银 as a card in …" / "✓ Known — …" with Open card + ⚡ Study it today, else "+ Add 银 as a
 * card" — and the Word view's character chips carry 📚 / ✓ (said in their label too). Web:
 * CharacterView.test.tsx, WordView.test.tsx. Screenshots: explorer-own-*.png.
 */
class ExplorerOwnCardTest : LabScreenshotTest() {
    private val events = ArrayList<Pair<String, Map<String, Any?>>>()
    private val inDecks = OwnCardInfo(CharWordStatus.InDecks, listOf("n-yin"), listOf("HSK 3 · Money & shopping"))
    private val known = OwnCardInfo(CharWordStatus.Known, listOf("n-xing"), listOf("HSK 2"))

    private fun host(controller: ExplorerController, own: Map<String, OwnCardInfo>) = compose.setContent {
        LabTheme {
            CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, ExplorerSamples.env(ownCards = own)) }
        }
    }

    @Test fun aCharacterHeHasSaysSoWithOpenCardAndStudyToday() {
        val controller = ExplorerController(track = { e, p -> events += e to p })
        host(controller, mapOf("银" to inDecks))
        compose.runOnIdle { controller.open(ExplorerItem.Char("银"), "study") }
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_CHAR_OWN_TAG).assertIsDisplayed()
        compose.onNodeWithText("📚 You have 银 as a card in HSK 3 · Money & shopping").assertIsDisplayed()
        compose.onNodeWithTag(EXPLORER_CHAR_OPEN_CARD_TAG).assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag(EXPLORER_CHAR_ADD_TAG).fetchSemanticsNodes().size)
        compose.onNodeWithTag(EXPLORER_CHAR_BUMP_TAG).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("⚡ 银 is in today's study").assertExists()
        assertTrue(events.any { it.first == "explorer.bump" && it.second["kind"] == "char" })
    }

    @Test fun aKnownCharacterSaysKnownInWords() {
        val controller = ExplorerController()
        host(controller, mapOf("行" to known))
        compose.runOnIdle { controller.open(ExplorerItem.Char("行"), "study") }
        compose.waitForIdle()
        compose.onNodeWithText("✓ Known — you have 行 as a card in HSK 2").assertIsDisplayed()
    }

    @Test fun noCardOfItsOwnOffersAddCharAsACard() {
        val controller = ExplorerController()
        host(controller, emptyMap())
        compose.runOnIdle { controller.open(ExplorerItem.Char("银"), "study") }
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_CHAR_ADD_TAG).assertIsDisplayed()
        compose.onNodeWithText("+ Add 银 as a card").assertIsDisplayed()
        assertEquals(0, compose.onAllNodesWithTag(EXPLORER_CHAR_OPEN_CARD_TAG).fetchSemanticsNodes().size)
    }

    @Test fun wordViewChipsCarryTheBadgeAndSayItInTheLabel() {
        val controller = ExplorerController()
        host(controller, mapOf("银" to inDecks, "行" to known))
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()
        assertEquals(2, compose.onAllNodes(hasTestTag(EXPLORER_CHAR_CHIP_OWN_TAG), useUnmergedTree = true).fetchSemanticsNodes().size)
        val labels = compose.onAllNodesWithTag(EXPLORER_WORD_CHAR_TAG).fetchSemanticsNodes()
            .map { it.config.getOrElse(SemanticsProperties.ContentDescription) { emptyList() }.joinToString() }
        assertEquals(
            listOf(CharWords.charChipLabel("银", "yín", CharWordStatus.InDecks), CharWords.charChipLabel("行", "háng", CharWordStatus.Known)),
            labels,
        )
    }

    @Test fun noOwnCardsNoBadges() {
        val controller = ExplorerController()
        host(controller, emptyMap())
        compose.runOnIdle { controller.open(ExplorerSamples.item(), "reader") }
        compose.waitForIdle()
        assertEquals(0, compose.onAllNodes(hasTestTag(EXPLORER_CHAR_CHIP_OWN_TAG), useUnmergedTree = true).fetchSemanticsNodes().size)
    }

    // ---------------- screenshots ----------------

    @Composable
    private fun overCard(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().heightIn(max = 860.dp)
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp),
            ) {
                Spacer(Modifier.height(8.dp))
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) { content() }
            }
        }
    }

    private fun yinUi(): CharSheetUi {
        val rows = CharWords.rows(ExplorerSamples.yin.words, listOf(CharStatusNote("n", "银行")), listOf(CharStatusCard("n", 2, 9.0)), "银行") { it.hanzi }
        return CharSheetUi("银", CharDict.Lookup.Ok(ExplorerSamples.yin), rows, decalOf = ExplorerSamples.decals)
    }

    private val stack = listOf(ExplorerSamples.item(), ExplorerItem.Char("银"))

    @Test fun shotInDecks() = shoot("explorer-own-01-char-in-decks") {
        overCard { CharacterView(yinUi(), stack, canWrite = true, ownCard = OwnCardUi(inDecks)) }
    }

    @Test fun shotKnownDark() = shoot("explorer-own-02-char-known-dark", dark = true) {
        overCard { CharacterView(yinUi(), stack, canWrite = true, ownCard = OwnCardUi(OwnCardInfo(CharWordStatus.Known, listOf("n"), listOf("HSK 3 · Money & shopping")))) }
    }

    @Test fun shotNone() = shoot("explorer-own-03-char-add") {
        overCard { CharacterView(yinUi(), stack, canWrite = true, ownCard = OwnCardUi(OwnCardInfo(CharWordStatus.None, emptyList(), emptyList()))) }
    }

    @Test fun shotNoneDark() = shoot("explorer-own-04-char-add-dark", dark = true) {
        overCard { CharacterView(yinUi(), stack, canWrite = true, ownCard = OwnCardUi(OwnCardInfo(CharWordStatus.None, emptyList(), emptyList()))) }
    }

    @Test fun shotWordChips() = shoot("explorer-own-05-word-chips") {
        overCard {
            WordView(
                ExplorerSamples.wordUi().copy(ownCards = mapOf("银" to CharWordStatus.InDecks, "行" to CharWordStatus.Known)),
                listOf(ExplorerItem.Char("银"), ExplorerSamples.item()), canOpenCard = true, canBump = true,
            )
        }
    }

    @Test fun shotWordChipsDark() = shoot("explorer-own-06-word-chips-dark", dark = true) {
        overCard {
            WordView(
                ExplorerSamples.wordUi().copy(ownCards = mapOf("银" to CharWordStatus.InDecks, "行" to CharWordStatus.Known)),
                listOf(ExplorerItem.Char("银"), ExplorerSamples.item()), canOpenCard = true, canBump = true,
            )
        }
    }
}
