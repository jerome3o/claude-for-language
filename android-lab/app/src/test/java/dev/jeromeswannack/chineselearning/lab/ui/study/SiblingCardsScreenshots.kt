package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.CardHold
import dev.jeromeswannack.chineselearning.lab.core.CardTypes
import dev.jeromeswannack.chineselearning.lab.core.SiblingStatus
import dev.jeromeswannack.chineselearning.lab.testing.LabScreenshotTest
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import org.junit.Test
import kotlin.test.assertEquals

/**
 * The ⋯ sheet's top row — the word's other cards (core SiblingStatus) — and one card's small sheet:
 * `sibling-cards-*.png`, plus the interactions (a tile opens its sheet; ⚡ is disabled with its reason
 * when the card is already in today; a missing card type is a disabled tile).
 */
class SiblingCardsScreenshots : LabScreenshotTest() {
    private val day = 86_400_000L
    private val cutoff = 1_794_974_399_999L // 18 Nov 2026 03:59:59.999 (London): the end of the study day of the 17th
    private val ctx = SiblingStatus.Context(cutoff, "2026-11-17")

    private fun card(id: String, type: String, queue: Int, due: Long?, stability: Double = 0.0, lapses: Int = 0) =
        SiblingStatus.Card(id, type, queue, due, stability, lapses)

    /** On the read card of 银行: 写 Write not started, 听 Listen known. */
    private val notStartedAndKnown = SiblingsUi(
        SiblingStatus.tiles(
            listOf(
                card("h", CardTypes.HANZI_TO_MEANING, 2, cutoff - day, 12.0),
                card("m", CardTypes.MEANING_TO_HANZI, 0, null),
                card("a", CardTypes.AUDIO_TO_HANZI, 2, cutoff + 74 * day, 96.0),
            ),
            "h", ctx,
        ),
    )

    /** Other states: 写 Write in review (12 d), 听 Listen snoozed. */
    private val reviewAndSnoozed = SiblingsUi(
        SiblingStatus.tiles(
            listOf(
                card("h", CardTypes.HANZI_TO_MEANING, 2, cutoff - day, 12.0),
                card("m", CardTypes.MEANING_TO_HANZI, 2, cutoff + 11 * day + 3_600_000L, 14.0),
                card("a", CardTypes.AUDIO_TO_HANZI, 1, cutoff - 3_600_000L),
            ),
            "h", ctx.copy(holds = mapOf("a" to CardHold("x", "a", "snooze", "2026-11-24", ""))),
        ),
    )

    /** A word with no audio: no listening card. */
    private val noListening = SiblingsUi(
        SiblingStatus.tiles(
            listOf(card("h", CardTypes.HANZI_TO_MEANING, 2, cutoff - day, 12.0), card("m", CardTypes.MEANING_TO_HANZI, 2, cutoff - 1, 4.0)),
            "h", ctx,
        ),
        SiblingStatus.missingTypes(listOf(CardTypes.HANZI_TO_MEANING, CardTypes.MEANING_TO_HANZI), CardTypes.HANZI_TO_MEANING),
    )

    private val items = listOf(
        StudyMenuItem("regen-audio", "Regenerate audio", "🔊", onSelect = {}),
        StudyMenuItem("new-voice", "New voice", "🗣️", onSelect = {}),
        StudyMenuItem("roleplay", "Roleplay this word", "🎭", onSelect = {}),
        StudyMenuItem("coach", "Sentence coach", "✏️", onSelect = {}),
        StudyMenuItem("write", "Write it", "✍️", "Preview", onSelect = {}),
        StudyMenuItem("snooze", "Snooze…", "💤", "Not today", onSelect = {}),
        StudyMenuItem("suspend", "Suspend…", "⏸️", onSelect = {}),
        StudyMenuItem("forget", "Forget this card…", "↺", "Back to New", onSelect = {}),
    )

    @Composable
    private fun overScrim(content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Lab.colors.background)) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.4f)))
            Column(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)).background(Lab.colors.card).padding(top = 24.dp, bottom = 16.dp),
            ) { content() }
        }
    }

    @Composable
    private fun more(siblings: SiblingsUi, onOpen: (SiblingStatus.Tile) -> Unit = {}) = overScrim {
        StudyMoreList(items, "Added 3 Oct", onDismiss = {}, top = { SiblingTilesRow(siblings, onOpen) })
    }

    @Composable
    private fun sheet(tile: SiblingStatus.Tile, ui: SiblingSheetUi = SiblingSheetUi(tile.cardId)) = overScrim {
        SiblingCardForm(
            "银行", tile, ui, SiblingActions(), canBump = true, holds = true, forget = true, details = true,
            onHoldSheet = {}, onForgetSheet = {}, onDismiss = {}, autoClose = false,
        )
    }

    /** Before: the ⋯ sheet had no status of the other cards, only "Practise this word other ways…". */
    @Test fun menuBefore() = shoot("sibling-cards-00-menu-before", dark = true) {
        overScrim {
            val before = items.take(4) + StudyMenuItem("other-cards", "Practise this word other ways…", "🔀", onSelect = {}) + items.drop(4)
            StudyMoreList(before, "Added 3 Oct", onDismiss = {})
        }
    }

    @Test fun menuLight() = shoot("sibling-cards-01-menu-light") { more(notStartedAndKnown) }
    @Test fun menuDark() = shoot("sibling-cards-02-menu-dark", dark = true) { more(notStartedAndKnown) }
    @Test fun menuOtherStates() = shoot("sibling-cards-03-menu-review-snoozed", dark = true) { more(reviewAndSnoozed) }
    @Test fun sheetNotStarted() = shoot("sibling-cards-04-sheet", dark = true) { sheet(notStartedAndKnown.tiles[0]) }
    @Test fun sheetAdded() = shoot("sibling-cards-05-added", dark = true) {
        sheet(notStartedAndKnown.tiles[0], SiblingSheetUi("m", done = SiblingStatus.bumpedMessage("English → 汉字", true)))
    }
    @Test fun sheetKnown() = shoot("sibling-cards-06-sheet-known", dark = true) { sheet(notStartedAndKnown.tiles[1]) }
    @Test fun menuNoListening() = shoot("sibling-cards-07-no-listening", dark = true) { more(noListening) }

    @Test
    fun aTileOpensItsSheetAndAlreadyTodayDisablesTheBump() {
        val inToday = SiblingsUi(
            SiblingStatus.tiles(
                listOf(card("h", CardTypes.HANZI_TO_MEANING, 2, cutoff - day, 12.0), card("m", CardTypes.MEANING_TO_HANZI, 0, null), card("a", CardTypes.AUDIO_TO_HANZI, 0, null)),
                "h", ctx.copy(inToday = setOf("a")),
            ),
        )
        var opened: String? = null
        compose.setContent {
            dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme {
                var open by remember { mutableStateOf<SiblingStatus.Tile?>(null) }
                val t = open
                if (t == null) more(inToday) { tile -> opened = tile.cardId; open = tile } else sheet(t)
            }
        }
        compose.onNodeWithTag("sibling-tile-meaning_to_hanzi").assertExists()
        compose.onNodeWithText("Not started").assertExists()
        compose.onNodeWithText("New · in today’s queue").assertExists()
        compose.onNodeWithTag("sibling-tile-audio_to_hanzi").performClick()
        compose.waitForIdle()
        assertEquals("a", opened)
        compose.onNodeWithTag("sibling-sheet").assertExists()
        compose.onNodeWithTag("sibling-action-bump").assertIsNotEnabled()
        compose.onNodeWithText("Already in today’s study").assertExists()
        // A NEW card can't be forgotten; it can be snoozed / suspended and opened.
        compose.onNodeWithTag("sibling-action-forget").assertDoesNotExist()
        compose.onNodeWithTag("sibling-action-snooze").assertExists()
        compose.onNodeWithTag("sibling-action-details").assertExists()
    }

    @Test
    fun aMissingCardTypeIsADisabledTile() {
        compose.setContent { dev.jeromeswannack.chineselearning.lab.ui.theme.LabTheme { more(noListening) } }
        compose.onNodeWithTag("sibling-tile-audio_to_hanzi").assertIsNotEnabled()
        compose.onNodeWithText("No listening card (no audio)").assertExists()
        compose.onNodeWithText("Due today").assertExists()
    }
}
