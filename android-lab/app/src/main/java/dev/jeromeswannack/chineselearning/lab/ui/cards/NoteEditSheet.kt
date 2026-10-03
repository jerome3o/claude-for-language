package dev.jeromeswannack.chineselearning.lab.ui.cards

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.decks.NoteFields
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabSheetFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.SheetScaffold
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** What the editor sheet shows around the form. */
data class NoteEditUi(
    /** Null = adding a new word (the web's NoteForm), else editing that note (CardEditModal). */
    val noteId: String?,
    val initial: NoteFields,
    val busy: Boolean = false,
    /** A refusal / failure sentence (card standard, server, offline). */
    val error: String? = null,
    /** "Saved on this phone…" and similar. */
    val info: String? = null,
    val hasAudio: Boolean = false,
    val online: Boolean = true,
    /** Bumped when the server rewrote the fields (✨ sentence) so the form reloads them. */
    val revision: Int = 0,
)

data class NoteEditActions(
    val onSave: (NoteFields) -> Unit = {},
    val onClose: () -> Unit = {},
    val onDelete: (() -> Unit)? = null,
    val onMove: (() -> Unit)? = null,
    val onOpenHub: (() -> Unit)? = null,
    val onPlay: (() -> Unit)? = null,
    val onGenerateAudio: (() -> Unit)? = null,
    val onGenerateSentence: ((NoteFields) -> Unit)? = null,
)

/**
 * The card editor as a bottom sheet (web: components/CardEditModal.tsx; "+ Add word" =
 * NoteForm). Hanzi, pinyin, English, fun facts, accepted alternatives (one per line) and the
 * card's example sentence; ⋯ holds Move to another deck, the card page and Delete (with the
 * web's "Delete this note and all three of its cards?" strip).
 */
@Composable
fun NoteEditSheet(ui: NoteEditUi, actions: NoteEditActions, extras: (@Composable (NoteFields) -> Unit)? = null) {
    LabSheetFrame(onDismiss = actions.onClose) {
        NoteEditForm(ui, actions, extras)
    }
}

/**
 * The sheet's body — also rendered on its own in screenshots. Title + ⋯ fixed, fields
 * scrolling, Cancel / Add word / Save pinned at the bottom ([SheetScaffold]).
 */
@Composable
fun NoteEditForm(ui: NoteEditUi, actions: NoteEditActions, extras: (@Composable (NoteFields) -> Unit)? = null, modifier: Modifier = Modifier) {
    var f by rememberSaveable(ui.noteId, ui.revision, saver = NoteFieldsSaver) { mutableStateOf(ui.initial) }
    var confirmDelete by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val adding = ui.noteId == null

    SheetScaffold(
        modifier,
        header = {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (adding) "Add a word" else "Edit card", style = MaterialTheme.typography.titleLarge, color = Lab.colors.ink, modifier = Modifier.weight(1f))
                    if (ui.onPlayAvailable(actions)) {
                        Text("▶", color = Lab.colors.accent, fontSize = 20.sp, modifier = Modifier.clickable { actions.onPlay?.invoke() }.padding(12.dp))
                    }
                    if (!adding && (actions.onDelete != null || actions.onMove != null || actions.onOpenHub != null)) {
                        Column {
                            Text("⋯", color = Lab.colors.ink, fontSize = 22.sp, modifier = Modifier.clickable { menu = true }.padding(horizontal = 14.dp, vertical = 8.dp))
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                actions.onOpenHub?.let { open -> DropdownMenuItem(text = { Text("🗂 Card page: history, flags & Claude chats") }, onClick = { menu = false; open() }) }
                                actions.onMove?.let { move -> DropdownMenuItem(text = { Text("↪ Move to another deck") }, onClick = { menu = false; move() }) }
                                if (!ui.hasAudio) actions.onGenerateAudio?.let { gen -> DropdownMenuItem(text = { Text("🔊 Generate audio") }, onClick = { menu = false; gen() }, enabled = ui.online) }
                                actions.onDelete?.let { DropdownMenuItem(text = { Text("🗑 Delete note", color = Palette.Again) }, onClick = { menu = false; confirmDelete = true }) }
                            }
                        }
                    }
                }

                AnimatedVisibility(confirmDelete) {
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Delete this note and all three of its cards?", color = Lab.colors.ink, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        SecondaryPill("Keep") { confirmDelete = false }
                        SecondaryPill("Yes, delete", danger = true, enabled = !ui.busy) { actions.onDelete?.invoke() }
                    }
                }
            }
        },
        footerAbove = if (ui.error == null && ui.info == null) null else {
            {
                ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                ui.info?.let { InlineNotice(it, kind = NoticeKind.Offline) }
            }
        },
        footer = {
            SecondaryPill("Cancel", Modifier.weight(1f).height(52.dp)) { actions.onClose() }
            PrimaryPill(
                if (ui.busy) "Saving…" else if (adding) "Add word" else "Save",
                Modifier.weight(1f).height(52.dp),
                enabled = !ui.busy && (!adding || ui.online) && f.hanzi.isNotBlank(),
            ) { actions.onSave(f) }
        },
    ) {
        if (adding && !ui.online) InlineNotice("You're offline — adding a word needs the server (it makes the three cards and the audio).", kind = NoticeKind.Offline)

        Field("Hanzi", f.hanzi, big = true) { f = f.copy(hanzi = it) }
        Field("Pinyin", f.pinyin, hint = "with tone marks: nǐ hǎo") { f = f.copy(pinyin = it) }
        Field("English", f.english) { f = f.copy(english = it) }
        Field("Fun facts", f.funFacts, lines = 3, hint = "Every character, how it's used, the common mistake") { f = f.copy(funFacts = it) }
        Field("Acceptable alternatives", f.alternatives, lines = 2, hint = "One alternative per line, e.g. 我很高兴") { f = f.copy(alternatives = it) }
        Text("Other valid hanzi answers (one per line). Marked correct during review.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)

        Spacer(Modifier.height(4.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Sentence clue", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, modifier = Modifier.weight(1f))
            if (f.sentenceClue.isNotEmpty()) {
                Text("Clear", color = Lab.colors.muted, modifier = Modifier.clickable { f = f.copy(sentenceClue = "", sentenceCluePinyin = "", sentenceClueTranslation = "") }.padding(10.dp))
            }
            actions.onGenerateSentence?.let { gen ->
                Text(
                    if (f.sentenceClue.isEmpty()) "✨ Generate" else "✨ Regenerate",
                    color = if (ui.online && !ui.busy) Lab.colors.accent else Lab.colors.muted,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clickable(enabled = ui.online && !ui.busy) { gen(f) }.padding(10.dp),
                )
            }
        }
        Field("Example sentence", f.sentenceClue, lines = 2, hint = "Example sentence using this word…") { f = f.copy(sentenceClue = it) }
        Field("Sentence pinyin", f.sentenceCluePinyin) { f = f.copy(sentenceCluePinyin = it) }
        Field("Translation", f.sentenceClueTranslation) { f = f.copy(sentenceClueTranslation = it) }

        // Editing an existing note: its sentence set and audio recordings (CardEditModal.tsx).
        if (!adding) extras?.invoke(f)

    }
}

private fun NoteEditUi.onPlayAvailable(a: NoteEditActions) = a.onPlay != null && noteId != null

@Composable
internal fun Field(label: String, value: String, modifier: Modifier = Modifier, lines: Int = 1, big: Boolean = false, hint: String? = null, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        label = { Text(label) },
        placeholder = hint?.let { { Text(it, color = Lab.colors.muted) } },
        singleLine = lines == 1,
        minLines = lines,
        textStyle = if (big) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.bodyLarge,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None),
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Lab.colors.accent,
            unfocusedBorderColor = Lab.colors.cardBorder,
            focusedLabelColor = Lab.colors.accent,
            cursorColor = Lab.colors.accent,
            focusedTextColor = Lab.colors.ink,
            unfocusedTextColor = Lab.colors.ink,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

private val NoteFieldsSaver = androidx.compose.runtime.saveable.Saver<androidx.compose.runtime.MutableState<NoteFields>, List<String>>(
    save = { s -> with(s.value) { listOf(hanzi, pinyin, english, funFacts, sentenceClue, sentenceCluePinyin, sentenceClueTranslation, alternatives) } },
    restore = { l -> mutableStateOf(NoteFields(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7])) },
)

/** A list of decks to move a note to (the deck page's ⋯ → Move). */
@Composable
fun MoveToDeckSheet(decks: List<Pair<String, String>>, currentDeckId: String?, count: Int, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    LabBottomSheet(onDismiss = onDismiss, title = if (count == 1) "Move to…" else "Move $count words to…") {
        MoveToDeckList(decks, currentDeckId, onPick)
    }
}

@Composable
fun ColumnScope.MoveToDeckList(decks: List<Pair<String, String>>, currentDeckId: String?, onPick: (String) -> Unit) {
    Text(
        "Cards, progress and history move with the word.",
        style = MaterialTheme.typography.bodySmall,
        color = Lab.colors.muted,
        modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp),
    )
    for ((id, name) in decks) {
        if (id == currentDeckId) continue
        dev.jeromeswannack.chineselearning.lab.ui.kit.NavRow("🗂️", name, onClick = { onPick(id) })
    }
}
