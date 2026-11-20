package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.SiblingStatus
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerItem
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.study.SiblingsUi
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The explorer's card variants (CardVariants.kt; web components/explorer/CardVariants.tsx): under "📚 You have
 * this", every card of the word as the study card ⋯ sheet's tiles (core SiblingStatus) — 读 Read · 写 Write ·
 * 听 Listen with status + strength; a tap opens the card's panel; ⚡ there is a card-level bump of that type.
 * Screenshots: explorer-variants-*.png.
 */
class ExplorerCardVariantsTest : LabScreenshotTest() {
    private val day = 86_400_000L
    private val cutoff = 1_794_974_399_999L // the end of the study day of 17 Nov 2026 (London)
    private val ctx = SiblingStatus.Context(cutoff, "2026-11-17")

    private fun card(id: String, type: String, queue: Int, due: Long?, stability: Double = 0.0) =
        SiblingStatus.Card(id, type, queue, due, stability, 0)

    /** 银行: read it well (known, next in 3 months), never written it, listening due today. */
    private val cards = listOf(
        card("c-h", CardTypes.HANZI_TO_MEANING, 2, cutoff + 92 * day, 96.0),
        card("c-m", CardTypes.MEANING_TO_HANZI, 0, null),
        card("c-a", CardTypes.AUDIO_TO_HANZI, 2, cutoff - 3_600_000L, 9.0),
    )

    private fun siblings(inToday: Set<String> = emptySet()) =
        SiblingsUi(SiblingStatus.tiles(cards, "", ctx.copy(inToday = inToday)), SiblingStatus.missingTypes(cards.map { it.cardType }, ""))

    @Composable
    private fun overCard(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 12.dp),
            ) {
                CompositionLocalProvider(LocalExplorer provides ExplorerController()) { content() }
            }
        }
    }

    @Composable
    private fun word(ui: CardVariantsUi) = overCard {
        WordView(
            ExplorerSamples.wordUi(), listOf(ExplorerSamples.item()), canOpenCard = true, canBump = true,
            actions = WordViewActions(cardExtras = { CardVariantsBlock(ui, "银行", onTile = {}, onBump = {}, onRelease = {}) }),
        )
    }

    @Test fun tilesLight() = shoot("explorer-variants-01-light") { word(CardVariantsUi(siblings())) }
    @Test fun tilesDark() = shoot("explorer-variants-02-dark", dark = true) { word(CardVariantsUi(siblings())) }
    @Test fun panelOpen() = shoot("explorer-variants-03-panel", dark = true) { word(CardVariantsUi(siblings(), openId = "c-m")) }
    @Test fun bumped() = shoot("explorer-variants-04-bumped", dark = true) {
        word(CardVariantsUi(siblings(inToday = setOf("c-m")), done = SiblingStatus.bumpedMessage("English → 汉字", false)))
    }
    @Test fun dueToday() = shoot("explorer-variants-05-due", dark = true) { word(CardVariantsUi(siblings(), openId = "c-a")) }

    @Test fun aTileOpensItsPanelAndBumpsThatCardType() {
        val events = ArrayList<Pair<String, Map<String, Any?>>>()
        val bumped = ArrayList<Pair<String, String>>()
        var inToday = emptySet<String>()
        val controller = ExplorerController(track = { e, p -> events += e to p })
        val env = ExplorerSamples.env(mine = ExplorerSamples.mine).let { base ->
            ExplorerEnv(
                chars = base.chars, wordLookup = base.wordLookup, myWord = base.myWord, ownCards = base.ownCards, rank = base.rank,
                online = base.online, bump = base.bump, openCard = {},
                wordCards = { noteId -> assertEquals("n-yinhang", noteId); siblings(inToday) },
                bumpCardType = { noteId, type -> bumped += noteId to type; inToday = setOf("c-m") },
                releaseCard = {},
            )
        }
        compose.setContent {
            LabTheme { CompositionLocalProvider(LocalExplorer provides controller) { ExplorerHost(controller, env) } }
        }
        compose.runOnIdle { controller.open(ExplorerItem.Word("银行", "yínháng", "bank"), "add") }
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_VARIANTS_TAG).performScrollTo()
        compose.onNodeWithText("Not started").assertExists()
        compose.onNodeWithText("Due today").assertExists()

        // Listening is due today already: ⚡ is greyed with the reason.
        compose.onNodeWithTag(explorerVariantTag(CardTypes.AUDIO_TO_HANZI)).performClick()
        compose.waitForIdle()
        compose.onNodeWithTag(EXPLORER_VARIANT_BUMP_TAG).assertIsNotEnabled()
        compose.onNodeWithText("Already due today").assertExists()

        compose.onNodeWithTag(explorerVariantTag(CardTypes.MEANING_TO_HANZI)).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("写 English → 汉字 · 银行").assertExists()
        compose.onNodeWithTag(EXPLORER_VARIANT_BUMP_TAG).performClick()
        compose.waitForIdle()
        assertEquals(listOf("n-yinhang" to CardTypes.MEANING_TO_HANZI), bumped)
        compose.onNodeWithText("⚡ English → 汉字 added to today").assertExists()
        compose.onNodeWithText("New · in today’s queue").assertExists()
        compose.onNodeWithTag(EXPLORER_VARIANT_PANEL_TAG).assertDoesNotExist()
        assertTrue(events.any { it.first == "explorer.card_variant_open" && it.second["card_type"] == CardTypes.MEANING_TO_HANZI && it.second["status"] == "not_started" })
        assertTrue(events.any { it.first == "explorer.card_variant_action" && it.second["action"] == "bump" && it.second["kind"] == "word" })
        // Opened from the ＋ Add tab: the bump counts as the word added.
        assertTrue(events.any { it.first == "add.word_added" && it.second["via"] == "bump" })
        // The footer's one-tap ⚡ Study it today is still there.
        compose.onNodeWithTag("explorer-bump").assertExists()
        // The tile's status is in its semantics too.
        val state = compose.onNodeWithTag(explorerVariantTag(CardTypes.MEANING_TO_HANZI)).fetchSemanticsNode().config[SemanticsProperties.StateDescription]
        assertEquals("new_today", state)
    }
}
