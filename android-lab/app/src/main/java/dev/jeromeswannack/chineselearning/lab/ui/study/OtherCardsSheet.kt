package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.OtherCardTypes
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay

/**
 * ⋯ → "Practise this word other ways…" (core OtherCardTypes; web components/study/OtherCardTypesSheet.tsx).
 * [rows] = the note's card types with their state; [picked] = the ticked card ids (the first NEW
 * sibling when the sheet opens); [done] = the line after adding ("⚡ English → 汉字 comes up in a few cards").
 */
data class OtherCardsUi(
    val rows: List<OtherCardTypes.Row> = emptyList(),
    val picked: Set<String> = emptySet(),
    val loading: Boolean = true,
    val busy: Boolean = false,
    val done: String? = null,
    val error: String? = null,
) {
    /** The ticked rows that can do something (the button's count). */
    val chosen: List<OtherCardTypes.Row> get() = rows.filter { it.action != null && it.cardId in picked }
}

/** The sheet's actions (StudyViewModel: openOtherCards / toggleOtherCard / addOtherCards / closeOtherCards). */
class OtherCardsActions(
    val open: () -> Unit = {},
    val toggle: (cardId: String) -> Unit = {},
    val add: () -> Unit = {},
    val close: () -> Unit = {},
)

@Composable
fun OtherCardsSheet(hanzi: String, ui: OtherCardsUi, actions: OtherCardsActions, onDismiss: () -> Unit) {
    LabSheetFrame(onDismiss = onDismiss) { OtherCardsForm(hanzi, ui, actions, onDismiss) }
}

@Composable
fun OtherCardsForm(hanzi: String, ui: OtherCardsUi, actions: OtherCardsActions, onDismiss: () -> Unit, modifier: Modifier = Modifier, autoClose: Boolean = true) {
    LaunchedEffect(ui.done) { if (ui.done != null && autoClose) { delay(1400); onDismiss() } }
    val chosen = ui.chosen
    SheetScaffold(
        modifier.testTag("other-card-types-sheet"),
        spacing = 8.dp,
        header = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Practise $hanzi other ways", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
                Text(
                    "Added cards come up in a few cards, on top of today’s new cards, then on their own schedule.",
                    style = MaterialTheme.typography.bodySmall,
                    color = Lab.colors.muted,
                )
                Spacer8()
            }
        },
        footerAbove = ui.error?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        footer = if (ui.done != null) null else {
            {
                SecondaryPill("Close", Modifier.weight(1f).height(50.dp), enabled = !ui.busy, onClick = onDismiss)
                PrimaryPill(
                    OtherCardTypes.buttonLabel(chosen.size),
                    Modifier.weight(1.4f).height(50.dp).testTag("other-card-types-add"),
                    enabled = !ui.busy && chosen.isNotEmpty(),
                    color = Palette.Hard,
                ) { actions.add() }
            }
        },
    ) {
        if (ui.done != null) {
            Text(
                ui.done,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = Lab.colors.ink,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(Palette.Gold.copy(alpha = 0.18f))
                    .padding(horizontal = 14.dp, vertical = 16.dp)
                    .testTag("other-card-types-done"),
            )
        } else {
            for (row in ui.rows) OtherCardRow(row, on = row.action != null && row.cardId in ui.picked, enabled = !ui.busy) { actions.toggle(row.cardId) }
        }
    }
}

@Composable
private fun Spacer8() = androidx.compose.foundation.layout.Spacer(Modifier.height(4.dp))

@Composable
private fun OtherCardRow(row: OtherCardTypes.Row, on: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val actionable = row.action != null
    val border by animateColorAsState(if (on) Palette.Hard else Lab.colors.cardBorder, label = "other-card-border")
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 60.dp)
            .clip(shape)
            .background(if (on) Palette.Hard.copy(alpha = 0.08f) else Lab.colors.card)
            .border(1.dp, border, shape)
            .then(if (actionable) Modifier.bouncyClickable(enabled = enabled, onClick = onToggle) else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag("other-card-row-${row.cardType}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (actionable) {
            Checkbox(
                checked = on,
                onCheckedChange = { onToggle() },
                enabled = enabled,
                colors = CheckboxDefaults.colors(checkedColor = Palette.Hard),
            )
        }
        Column(Modifier.weight(1f).padding(start = if (actionable) 0.dp else 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(row.label, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
            Text(
                row.status,
                style = MaterialTheme.typography.labelMedium,
                color = Lab.colors.muted,
                fontWeight = if (row.isCurrent) FontWeight.SemiBold else FontWeight.Normal,
            )
        }
        if (row.action != null) {
            Text(
                if (row.action == OtherCardTypes.ACTION_ADD) "⚡ Add to today" else "Review it early today",
                style = MaterialTheme.typography.labelMedium,
                color = if (on) Palette.Hard else Lab.colors.muted,
                fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                textAlign = TextAlign.End,
                modifier = Modifier.widthIn(max = 130.dp).padding(start = 8.dp),
            )
        }
    }
}
