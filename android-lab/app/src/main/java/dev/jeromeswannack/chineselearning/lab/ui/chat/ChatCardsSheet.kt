package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ProposedCard
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** What the review sheet can do (wired to ChatViewModel). */
class ReviewActions(
    val onClose: () -> Unit = {},
    val onToggle: (Int) -> Unit = {},
    val onEdit: (Int, ProposedCard) -> Unit = { _, _ -> },
    val onOpenEdit: (Int?) -> Unit = {},
    val onPickDeck: (String) -> Unit = {},
    /** null closes "+ New deck"; a string is the name typed so far. */
    val onNewDeck: (String?) -> Unit = {},
    val onSave: () -> Unit = {},
)

/**
 * "Make flashcards" review (docs/CHAT.md PR 3): Claude's cards, each checkable (one already in
 * the decks starts unchecked) and editable (✎ opens its fields), with the message it came from;
 * the deck (the last one used is preselected, or a new deck); "Add N cards" in one batch.
 */
@Composable
fun ReviewPanel(r: ReviewUi, decks: List<DeckChoice>, online: Boolean, actions: ReviewActions) {
    val review = r.review
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("chat-review"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Column {
            Text(r.title, style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink)
            Text(
                "${review.count} of ${review.cards.size} checked · tap ✎ to change a card",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            )
        }
        review.cards.forEachIndexed { i, c ->
            ProposedCardRow(
                c, checked = i in review.checked, editing = r.editing == i, problem = review.problems[i],
                source = c.sourceMessageId?.let { r.sources[it] },
                onToggle = { actions.onToggle(i) },
                onOpenEdit = { actions.onOpenEdit(i) },
                onEdit = { actions.onEdit(i, it) },
            )
        }
        Text("Add to", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.padding(top = 4.dp))
        ChipRow(Modifier.fillMaxWidth().testTag("chat-review-decks")) {
            for (d in decks) LabChip((if (d.pinned) "📌 " else "") + d.name, selected = r.newDeck == null && d.id == r.deckId) { actions.onPickDeck(d.id) }
            LabChip("+ New deck", selected = r.newDeck != null) { actions.onNewDeck(if (r.newDeck == null) "" else null) }
        }
        AnimatedVisibility(r.newDeck != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
            OutlinedTextField(r.newDeck.orEmpty(), { actions.onNewDeck(it) }, label = { Text("New deck name") }, placeholder = { Text("e.g. From my chats") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("chat-review-new-deck"))
        }
        r.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (!online) InlineNotice("You're offline — adding cards needs a connection. Your picks stay here.", kind = NoticeKind.Offline)
        val n = review.count
        PrimaryPill(
            if (r.saving) "Adding…" else if (n == 0) "Check the cards to add" else "Add $n card${if (n == 1) "" else "s"}",
            Modifier.fillMaxWidth().height(56.dp).testTag("chat-review-add"),
            enabled = n > 0 && !r.saving && online && (r.deckId != null || !r.newDeck.isNullOrBlank()),
            onClick = actions.onSave,
        )
        SecondaryPill("Not now", Modifier.fillMaxWidth(), onClick = actions.onClose)
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun ProposedCardRow(
    c: ProposedCard,
    checked: Boolean,
    editing: Boolean,
    problem: String?,
    source: String?,
    onToggle: () -> Unit,
    onOpenEdit: () -> Unit,
    onEdit: (ProposedCard) -> Unit,
) {
    val shape = RoundedCornerShape(16.dp)
    val border = when {
        problem != null -> Palette.Again
        checked -> Lab.colors.accent
        else -> Lab.colors.cardBorder
    }
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Lab.colors.background).border(if (checked || problem != null) 2.dp else 1.dp, border, shape)
            .animateContentSize(spring(Spring.DampingRatioLowBouncy)).testTag("chat-review-card"),
    ) {
        Row(Modifier.fillMaxWidth().bouncyClickable(pressedScale = 0.985f, onClick = onToggle).padding(start = 4.dp, end = 2.dp, top = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.Top) {
            SelectCircle(checked, enabled = true)
            Column(Modifier.weight(1f).padding(top = 6.dp).alpha(if (checked) 1f else 0.62f)) {
                Text(c.hanzi, fontSize = 24.sp, color = Lab.colors.ink)
                if (c.pinyin.isNotBlank()) Text(c.pinyin, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.accent)
                Text(c.english, style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
                if (c.sentenceClue.isNotBlank()) Text("“${c.sentenceClue}”", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 2, modifier = Modifier.padding(top = 2.dp))
                if (c.alreadyHave) {
                    Text(
                        "✓ Already in your decks",
                        style = MaterialTheme.typography.labelMedium, color = Palette.Good,
                        modifier = Modifier.padding(top = 4.dp).clip(CircleShape).background(Palette.Good.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 3.dp).testTag("chat-review-have"),
                    )
                }
                source?.let { Text("From: $it", style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, maxLines = 1, modifier = Modifier.padding(top = 4.dp)) }
            }
            Box(
                Modifier.size(44.dp).clip(CircleShape).clickable(onClickLabel = if (editing) "Done editing" else "Edit this card", onClick = onOpenEdit).testTag("chat-review-edit"),
                contentAlignment = Alignment.Center,
            ) { Text(if (editing) "✓" else "✎", fontSize = 18.sp, color = if (editing) Lab.colors.accent else Lab.colors.muted) }
        }
        problem?.let { Box(Modifier.padding(horizontal = 12.dp).padding(bottom = 8.dp)) { InlineNotice(it, kind = NoticeKind.Error) } }
        if (editing) CardFields(c, onEdit)
    }
}

@Composable
private fun CardFields(c: ProposedCard, onEdit: (ProposedCard) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = 14.dp, end = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Field("Hanzi", c.hanzi) { onEdit(c.copy(hanzi = it)) }
        Field("Pinyin", c.pinyin) { onEdit(c.copy(pinyin = it)) }
        Field("Meaning", c.english) { onEdit(c.copy(english = it)) }
        Field("Explanation", c.funFacts, single = false) { onEdit(c.copy(funFacts = it)) }
        Field("Example sentence", c.sentenceClue) { onEdit(c.copy(sentenceClue = it)) }
        if (c.sentenceClue.isNotBlank()) {
            Field("Sentence pinyin", c.sentenceCluePinyin) { onEdit(c.copy(sentenceCluePinyin = it)) }
            Field("Sentence meaning", c.sentenceClueTranslation) { onEdit(c.copy(sentenceClueTranslation = it)) }
        }
    }
}

@Composable
private fun Field(label: String, value: String, single: Boolean = true, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, label = { Text(label) }, singleLine = single, minLines = if (single) 1 else 2, maxLines = if (single) 1 else 6, modifier = Modifier.fillMaxWidth())
}

/**
 * The tutor's "Correct this": their message, the corrected text (prefilled), an optional note and
 * the live character diff; Save / Remove.
 */
@Composable
fun CorrectPanel(m: ChatMessageDto, ui: ChatUi, actions: ChatSheetActions) {
    var text by rememberSaveable(m.id) { mutableStateOf(m.correction?.text ?: m.content) }
    var note by rememberSaveable(m.id) { mutableStateOf(m.correction?.note.orEmpty()) }
    val saving = ui.correcting == m.id
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("chat-correct-sheet"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("${m.sender.name ?: ui.otherName} wrote", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted)
        Text(m.content, fontSize = 18.sp, lineHeight = 26.sp, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).padding(12.dp))
        OutlinedTextField(text, { if (it.length <= 2000) text = it }, label = { Text("Corrected") }, minLines = 2, maxLines = 5, modifier = Modifier.fillMaxWidth().testTag("chat-correct-text"))
        OutlinedTextField(note, { if (it.length <= 500) note = it }, label = { Text("Note (optional)") }, placeholder = { Text("e.g. 了 goes right after the verb here") }, minLines = 1, maxLines = 4, modifier = Modifier.fillMaxWidth().testTag("chat-correct-note"))
        CorrectionPreview(m.content, text)
        ui.modalNotice?.let { InlineNotice(it.text, kind = if (it.error) NoticeKind.Error else NoticeKind.Success) }
        if (!ui.online) InlineNotice("You're offline — corrections need a connection.", kind = NoticeKind.Offline)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (m.correction != null) SecondaryPill("Remove", Modifier.weight(1f), danger = true, enabled = !saving && ui.online) { actions.onRemoveCorrection(m) }
            PrimaryPill(
                if (saving) "Saving…" else "Save correction",
                Modifier.weight(1f).height(52.dp).testTag("chat-correct-save"),
                enabled = text.isNotBlank() && !saving && ui.online,
            ) { actions.onSaveCorrection(m, text, note) }
        }
        Text("${ui.otherName.ifEmpty { "They" }} gets a notification and sees what changed under the message.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        Spacer(Modifier.height(4.dp))
    }
}
