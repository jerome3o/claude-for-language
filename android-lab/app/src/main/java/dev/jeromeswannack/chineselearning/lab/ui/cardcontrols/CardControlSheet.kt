package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CardHolds
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/** Port of `CARD_TYPE_LABELS` (shared/decks/holds.ts). */
fun cardTypeLabel(type: String): String = when (type) {
    "hanzi_to_meaning" -> "Hanzi → Meaning"
    "meaning_to_hanzi" -> "Meaning → Hanzi"
    "audio_to_hanzi" -> "Audio → Hanzi"
    else -> type
}

/**
 * Suspend… / Snooze… (web components/cardControls/CardControlSheet.tsx; docs/STUDY_SESSION.md
 * "Suspend & snooze"): this card only, or every card type of the word, then
 *   - snooze ("not today"): Until tomorrow · For a week · For a month — a tap applies it;
 *   - suspend: the explanation and ⏸️ Suspend.
 * Never a review event, never a change to the card's schedule.
 * [onApply] gets (length — null for suspend, wholeWord).
 */
@Composable
fun CardControlSheet(
    kind: String,
    hanzi: String,
    cardType: String,
    /** The word's card types (this one included); one = no "which cards" choice. */
    wordCardTypes: List<String>,
    today: String,
    onApply: (length: String?, wholeWord: Boolean) -> Unit,
    onDismiss: () -> Unit,
) {
    var wholeWord by remember { mutableStateOf(false) }
    val suspend = kind == CardHolds.SUSPEND
    LabBottomSheet(onDismiss = onDismiss) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 4.dp).testTag("card-$kind-sheet"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                (if (suspend) "⏸️ Suspend " else "💤 Snooze — not today ") + hanzi,
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink,
            )
            Text(CardHolds.EXPLANATION.getValue(kind), style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
            if (wordCardTypes.size > 1) {
                ScopeOption(on = !wholeWord, label = "This card only", sub = cardTypeLabel(cardType), tag = "cc-scope-card") { wholeWord = false }
                ScopeOption(
                    on = wholeWord, label = "All card types of this word",
                    sub = "${wordCardTypes.size} cards: " + wordCardTypes.joinToString(" · ") { cardTypeLabel(it) }, tag = "cc-scope-word",
                ) { wholeWord = true }
            }
            if (!suspend) {
                for ((length, label) in CardHolds.SNOOZE_OPTIONS) {
                    val back = if (length == "tomorrow") "tomorrow" else CardHolds.shortDate(CardHolds.snoozeUntil(today, length), today)
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(RoundedCornerShape(12.dp))
                            .border(1.dp, Lab.colors.outline, RoundedCornerShape(12.dp))
                            .background(Lab.colors.card)
                            .bouncyClickable { onApply(length, wholeWord); onDismiss() }
                            .padding(horizontal = 16.dp, vertical = 12.dp)
                            .testTag("cc-snooze-$length"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(label, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                        Text("back $back", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    PrimaryPill(
                        if (wholeWord && wordCardTypes.size > 1) "⏸️ Suspend ${wordCardTypes.size} cards" else "⏸️ Suspend card",
                        onClick = { onApply(null, wholeWord); onDismiss() },
                        modifier = Modifier.testTag("cc-suspend-confirm"),
                    )
                }
            }
            Spacer(Modifier.width(1.dp))
        }
    }
}

@Composable
private fun ScopeOption(on: Boolean, label: String, sub: String, tag: String, onClick: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 52.dp).clip(shape)
            .border(if (on) 2.dp else 1.dp, if (on) Lab.colors.ink else Lab.colors.outline, shape)
            .bouncyClickable(onClick = onClick)
            .semantics { role = Role.RadioButton; selected = on }
            .padding(horizontal = 12.dp, vertical = 10.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The state is in the mark and the weight, never colour alone.
        Text(if (on) "◉" else "○", fontSize = 18.sp, color = Lab.colors.ink)
        Spacer(Modifier.width(10.dp))
        Column {
            Text(label, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal, color = Lab.colors.ink)
            Text(sub, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        }
    }
}

/** "⏸️ Suspended" / "💤 Snoozed · 29 Oct" — icon + words (CardHolds.tag), never colour alone. */
@Composable
fun HoldTag(icon: String, text: String, modifier: Modifier = Modifier) {
    Text(
        "$icon $text",
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = Lab.colors.ink,
        modifier = modifier.clip(RoundedCornerShape(50)).border(1.dp, Lab.colors.outline, RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 2.dp),
    )
}
