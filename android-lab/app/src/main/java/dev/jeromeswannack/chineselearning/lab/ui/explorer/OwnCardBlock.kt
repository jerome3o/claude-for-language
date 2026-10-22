package dev.jeromeswannack.chineselearning.lab.ui.explorer

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharWordStatus
import dev.jeromeswannack.chineselearning.lab.core.CharWords
import dev.jeromeswannack.chineselearning.lab.ui.bumps.STUDY_IT_TODAY
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * "Is this character itself one of my cards?" (docs/LANGUAGE_EXPLORER.md "Character view"; web
 * components/explorer/CardTieIn.tsx in CharacterView): right under the glyph — "📚 You have 性
 * as a card in HSK 5" / "✓ Known — …" with Open card + ⚡ Study it today, else "+ Add 性 as a
 * card", and a quiet placeholder while this phone's cards are read. The words come from core
 * CharWords (parity-tested); the tint only repeats what the icon and the words say.
 */

const val EXPLORER_CHAR_OWN_TAG = "explorer-char-own"
const val EXPLORER_CHAR_OWN_CHECKING_TAG = "explorer-char-own-checking"
const val EXPLORER_CHAR_ADD_TAG = "explorer-char-add"
const val EXPLORER_CHAR_OPEN_CARD_TAG = "explorer-char-open-card"
const val EXPLORER_CHAR_BUMP_TAG = "explorer-char-bump"
const val EXPLORER_CHAR_CHIP_OWN_TAG = "explorer-char-chip-own"

@Composable
private fun isDark() = Lab.colors.card.luminance() < 0.4f

/** Background + text of an own-card status (the related-word badges' tints). */
@Composable
fun ownCardColors(status: CharWordStatus): Pair<Color, Color> {
    val dark = isDark()
    return when (status) {
        CharWordStatus.Known -> if (dark) Palette.Good.copy(alpha = 0.2f) to Color(0xFF86EFAC) else Color(0xFFDCFCE7) to Color(0xFF166534)
        CharWordStatus.InDecks -> if (dark) Palette.Easy.copy(alpha = 0.2f) to Color(0xFF93C5FD) else Color(0xFFDBEAFE) to Color(0xFF1E40AF)
        CharWordStatus.None -> Lab.colors.faint to Lab.colors.ink
    }
}

@Composable
fun OwnCardBlock(char: String, ui: OwnCardUi, onOpenCard: () -> Unit, onBump: () -> Unit, onAdd: () -> Unit) {
    val own = ui.own
    Column(Modifier.fillMaxWidth().padding(top = 12.dp).testTag(EXPLORER_CHAR_OWN_TAG)) {
        when {
            own == null -> Text(
                "📚 Checking your cards…",
                style = MaterialTheme.typography.bodyMedium,
                color = Lab.colors.muted,
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint)
                    .padding(horizontal = 12.dp, vertical = 10.dp).testTag(EXPLORER_CHAR_OWN_CHECKING_TAG),
            )
            own.status == CharWordStatus.None -> PrimaryPill(
                CharWords.addOwnCardLabel(char),
                Modifier.fillMaxWidth().height(52.dp).testTag(EXPLORER_CHAR_ADD_TAG),
                onClick = onAdd,
            )
            else -> {
                val (bg, fg) = ownCardColors(own.status)
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(bg).padding(12.dp)) {
                    Text(
                        CharWords.ownCardLine(char, own.status, own.decks),
                        style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = fg,
                    )
                    if (ui.canOpenCard || ui.canBump) {
                        Spacer(Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            if (ui.canOpenCard) SecondaryPill("Open card", Modifier.weight(1f).height(48.dp).testTag(EXPLORER_CHAR_OPEN_CARD_TAG), onClick = onOpenCard)
                            if (ui.canBump) PrimaryPill(
                                if (ui.bumped != null) "⚡ Bumped" else if (ui.bumping) "Bumping…" else STUDY_IT_TODAY,
                                Modifier.weight(1.3f).height(48.dp).testTag(EXPLORER_CHAR_BUMP_TAG),
                                enabled = !ui.bumping && ui.bumped == null,
                                onClick = onBump,
                            )
                        }
                    }
                }
                ui.bumped?.let {
                    Spacer(Modifier.height(8.dp))
                    InlineNotice(it, kind = NoticeKind.Success)
                }
            }
        }
    }
}

/** The small 📚 / ✓ in a Word view character chip's corner (core CharWords.ownCardBadge); nothing for None. */
@Composable
fun OwnCardChipBadge(status: CharWordStatus, modifier: Modifier = Modifier) {
    if (status == CharWordStatus.None) return
    val (bg, fg) = ownCardColors(status)
    Box(
        // The chip's label says it in words (CharWords.charChipLabel): the badge itself is silent.
        modifier.testTag(EXPLORER_CHAR_CHIP_OWN_TAG).clearAndSetSemantics {}
            .defaultMinSize(minWidth = 22.dp).heightIn(min = 22.dp).clip(CircleShape).background(bg)
            .border(1.dp, fg.copy(alpha = 0.35f), CircleShape).padding(horizontal = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(CharWords.ownCardBadge(status), fontSize = 11.sp, lineHeight = 13.sp, fontWeight = FontWeight.Bold, color = fg)
    }
}
