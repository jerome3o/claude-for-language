package dev.jeromeswannack.chineselearning.lab.ui.coach

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CoachBreakdownWord
import dev.jeromeswannack.chineselearning.lab.core.CoachNewWords
import dev.jeromeswannack.chineselearning.lab.data.api.BatchExistingDto
import dev.jeromeswannack.chineselearning.lab.ui.bumps.STUDY_IT_TODAY
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The Coach's "➕ Add new words (N)" picker (core CoachNewWords — shared/coach/newWords.ts; web
 * components/coach/NewWordsSheet.tsx; docs/CHAT.md "Chat ↔ Coach"): the words of the sentence that
 * are in none of his decks, one row each, NOTHING ticked. The ticked ones become full cards in ONE
 * `POST /api/decks/:id/notes/batch?skip_existing=1` into the chosen deck (the top of the study queue
 * by default); a word that turns out to be in a deck already gets "⚡ Study it today" instead.
 */

/** The picker's state (owned by [CoachChatViewModel]). */
data class NewWordsSheetUi(
    val words: List<CoachBreakdownWord>,
    /** In study-queue order: the first is the default. */
    val decks: List<CoachDeck>,
    val deckId: String? = decks.firstOrNull()?.id,
    val picked: Set<String> = emptySet(),
    val saving: Boolean = false,
    val error: String? = null,
    /** Set once saved: the done screen. */
    val result: NewWordsResult? = null,
    /** Notes bumped from the done screen ("⚡ In today"). */
    val bumped: Set<String> = emptySet(),
) {
    val deck: CoachDeck? get() = decks.firstOrNull { it.id == deckId }
    val chosen: List<CoachBreakdownWord> get() = words.filter { it.hanzi in picked }
}

data class NewWordsResult(
    val added: List<String>,
    val deckName: String,
    val existing: List<BatchExistingDto>,
    /** "银行: reason" lines for rows the server refused. */
    val failed: List<String>,
)

/** Test tags. */
object CoachNewWordsTags {
    const val CHIP = "coach-quick-new-words"
    const val SENTENCE_CARD = "coach-quick-sentence-card"
    const val SHEET = "coach-new-words-sheet"
    const val ADD = "coach-new-words-add"
    const val DONE = "coach-new-words-done"
    const val CLOSE = "coach-new-words-close"
    fun row(hanzi: String) = "coach-new-word-row-$hanzi"
    fun bump(noteId: String) = "coach-new-word-bump-$noteId"
}

class NewWordsActions(
    val onToggle: (String) -> Unit = {},
    val onDeck: (String) -> Unit = {},
    val onAdd: () -> Unit = {},
    val onBump: (String) -> Unit = {},
    val onClose: () -> Unit = {},
)

/** The picker / done screen (stateless, so tests and screenshots render it without a sheet). */
@Composable
fun CoachNewWordsForm(ui: NewWordsSheetUi, actions: NewWordsActions) {
    val r = ui.result
    if (r != null) return DoneForm(ui, r, actions)
    SheetScaffold(
        modifier = Modifier.testTag(CoachNewWordsTags.SHEET),
        header = { SheetTitle("Add new words") },
        footer = {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp), enabled = !ui.saving, onClick = actions.onClose)
            PrimaryPill(
                if (ui.saving) "Adding…" else CoachNewWords.addButton(ui.chosen.size),
                Modifier.weight(1.4f).height(52.dp).testTag(CoachNewWordsTags.ADD),
                enabled = !ui.saving && ui.chosen.isNotEmpty() && ui.deck != null,
                onClick = actions.onAdd,
            )
        },
        footerAbove = ui.error?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        spacing = 0.dp,
    ) {
        Text(
            "These words aren’t in any of your decks yet. Tick the ones to learn.",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(bottom = 6.dp),
        )
        ui.words.forEachIndexed { i, w ->
            WordRow(w, checked = w.hanzi in ui.picked, enabled = !ui.saving) { actions.onToggle(w.hanzi) }
            if (i < ui.words.lastIndex) HorizontalDivider(color = Lab.colors.cardBorder)
        }
        if (ui.decks.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            DeckPicker(ui, actions)
        }
    }
}

@Composable
private fun WordRow(w: CoachBreakdownWord, checked: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).bouncyClickable(enabled = enabled, pressedScale = 0.98f, role = Role.Checkbox, onClick = onToggle)
            .testTag(CoachNewWordsTags.row(w.hanzi)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked, { onToggle() }, enabled = enabled)
        Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(w.hanzi, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                if (w.pinyin.isNotBlank()) Text(w.pinyin, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(bottom = 2.dp))
            }
            if (w.gloss.isNotBlank()) Text(w.gloss, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink, maxLines = 2)
        }
    }
}

@Composable
private fun DeckPicker(ui: NewWordsSheetUi, actions: NewWordsActions) {
    var open by remember { mutableStateOf(false) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Add to", fontSize = 14.sp, color = Lab.colors.muted)
        Spacer(Modifier.width(8.dp))
        Box {
            Text(
                "${ui.deck?.name ?: "—"} ▾",
                fontSize = 15.sp,
                fontWeight = FontWeight.SemiBold,
                color = Lab.colors.ink,
                modifier = Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(Lab.colors.faint)
                    .clickable(enabled = !ui.saving) { open = true }.padding(horizontal = 12.dp, vertical = 12.dp),
            )
            DropdownMenu(open, onDismissRequest = { open = false }) {
                ui.decks.forEach { d -> DropdownMenuItem(text = { Text(d.name) }, onClick = { open = false; actions.onDeck(d.id) }) }
            }
        }
    }
}

@Composable
private fun DoneForm(ui: NewWordsSheetUi, r: NewWordsResult, actions: NewWordsActions) {
    SheetScaffold(
        modifier = Modifier.testTag(CoachNewWordsTags.SHEET),
        header = { SheetTitle("Cards added") },
        footer = { PrimaryPill("Done", Modifier.weight(1f).height(52.dp).testTag(CoachNewWordsTags.CLOSE), onClick = actions.onClose) },
    ) {
        if (r.added.isNotEmpty()) {
            Text(
                "✓ Added ${r.added.size} card${if (r.added.size == 1) "" else "s"} to ${r.deckName}: ${r.added.joinToString("、")}",
                style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, color = Palette.Good,
                modifier = Modifier.testTag(CoachNewWordsTags.DONE),
            )
        }
        r.existing.forEachIndexed { i, e ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(e.hanzi, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
                    Text("Already in ${e.deck_name}", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
                }
                val on = e.note_id in ui.bumped
                SecondaryPill(
                    if (on) "⚡ In today" else STUDY_IT_TODAY,
                    Modifier.height(44.dp).testTag(CoachNewWordsTags.bump(e.note_id)), enabled = !on,
                ) { actions.onBump(e.note_id) }
            }
            if (i < r.existing.lastIndex) HorizontalDivider(color = Lab.colors.cardBorder)
        }
        if (r.failed.isNotEmpty()) InlineNotice("Couldn’t add ${r.failed.joinToString("; ")}", kind = NoticeKind.Error)
    }
}

/** [CoachNewWordsForm] as a bottom sheet (not dismissable while saving). */
@Composable
fun CoachNewWordsSheet(ui: NewWordsSheetUi, actions: NewWordsActions) {
    LabSheetFrame(onDismiss = { if (!ui.saving) actions.onClose() }) { CoachNewWordsForm(ui, actions) }
}
