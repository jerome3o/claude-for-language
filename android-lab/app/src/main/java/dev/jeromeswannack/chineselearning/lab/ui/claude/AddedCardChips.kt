package dev.jeromeswannack.chineselearning.lab.ui.claude

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.claude.CardTools
import dev.jeromeswannack.chineselearning.lab.core.explorer.ExplorerStack
import dev.jeromeswannack.chineselearning.lab.ui.explorer.ExplorerController
import dev.jeromeswannack.chineselearning.lab.ui.explorer.LocalExplorer
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.study.AddedTo

/** Test tags of Claude's "✓ Added" word chips. */
object AddedCardTags {
    const val CHIPS = "added-card-chips"
    const val CHIP = "added-card-chip"
}

/**
 * The words of Claude's "✓ Added 2 cards" line (web components/claude/AddedCardChips.tsx; docs/CHAT.md
 * "Claude thread view" → "Cards Claude added"): one chip per card, wrapping; a tap opens the language
 * explorer on that word / sentence (source `claude_card`) with the cards marked as just added, so its
 * footer offers ⚡ Study it today at once — before the sync brings the note into Room. [surface] =
 * thread | card_sheet | coach (analytics). Without an explorer (previews) the chips do nothing.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AddedCardChips(cards: List<CardTools.AddedCard>, surface: String, color: Color, modifier: Modifier = Modifier) {
    if (cards.isEmpty()) return
    val explorer = LocalExplorer.current
    FlowRow(modifier.testTag(AddedCardTags.CHIPS), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (c in cards) {
            Row(
                Modifier.heightIn(min = 40.dp).widthIn(max = 260.dp).clip(RoundedCornerShape(50)).border(1.dp, color, RoundedCornerShape(50))
                    .bouncyClickable(enabled = explorer != null, pressedScale = 0.94f) { explorer?.let { openAddedCard(it, c, cards, surface) } }
                    .semantics { contentDescription = "Open ${c.hanzi} in the explorer" }
                    .padding(start = 12.dp, end = 10.dp).testTag(AddedCardTags.CHIP),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(c.hanzi, color = color, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                Text(" ›", color = color.copy(alpha = 0.75f), fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            }
        }
    }
}

/** The tap: the explorer on [card] (a sentence → the Word view of its characters), every card of the line marked just added. */
fun openAddedCard(explorer: ExplorerController, card: CardTools.AddedCard, cards: List<CardTools.AddedCard>, surface: String) {
    val item = ExplorerStack.itemForText(card.hanzi, pinyin = card.pinyin, gloss = card.english) ?: return
    explorer.record("claude.added_card_open", mapOf("surface" to surface, "count" to cards.size))
    explorer.open(item, "claude_card", justAdded = cards.map { AddedTo(it.hanzi, it.deckId.orEmpty(), it.deckName ?: "From Claude", it.noteId) })
}
