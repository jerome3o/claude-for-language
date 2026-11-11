package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.SourceDecks
import dev.jeromeswannack.chineselearning.lab.data.api.AddedNote
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.study.CardTools
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/**
 * Source decks (docs/STUDY_SESSION.md "Source decks"; web components/sourceDecks/AddedToDeckLine.tsx):
 * where a card added from around the app went — "✓ Added to From readers · Change" — and the one way
 * to put it elsewhere: Change lists the decks (study-queue order) and moves the just-added note(s).
 */
class SourceDeckActions(
    /** The decks to move to (id, name), study-queue order. */
    val decks: suspend () -> List<Pair<String, String>> = { emptyList() },
    /** Move the note(s); returns where they are now. */
    val move: suspend (added: AddedNote, deckId: String, deckName: String) -> AddedNote = { a, id, name -> a.copy(deckId = id, deckName = name) },
) {
    companion object {
        /** The real thing: CardTools' deck list and `POST /api/notes/move`. */
        fun from(tools: CardTools, surface: String) = SourceDeckActions(
            decks = { tools.decksForMove() },
            move = { a, id, name -> tools.moveAdded(a, id, name, surface) },
        )

        fun from(app: LabApp, surface: String) = from(CardTools(app), surface)
    }
}

/** "✓ Added to From readers · Change" ("Moved to HSK 2" after a move). `actions == null` = no Change (previews). */
@Composable
fun AddedToDeckRow(
    added: AddedNote,
    actions: SourceDeckActions?,
    modifier: Modifier = Modifier,
    onMoved: (AddedNote) -> Unit = {},
) {
    var now by remember(added.noteIds) { mutableStateOf(added) }
    var moved by remember(added.noteIds) { mutableStateOf(false) }
    var changing by remember { mutableStateOf(false) }
    val count = now.noteIds.size
    val line = if (moved) SourceDecks.movedLine(now.deckName, count) else SourceDecks.addedLine(now.deckName, count)
    InlineNotice(
        line,
        modifier.fillMaxWidth().testTag("added-to-deck"),
        kind = NoticeKind.Success,
        actionLabel = if (actions != null && count > 0) "Change" else null,
        onAction = if (actions != null && count > 0) ({ changing = true }) else null,
    )
    if (changing && actions != null) {
        MoveToDeckSheet(
            current = now,
            actions = actions,
            onDismiss = { changing = false },
            onMoved = {
                now = it
                moved = true
                changing = false
                onMoved(it)
            },
        )
    }
}

/** The deck list for "Change": tap a deck → the note(s) move there. */
@Composable
fun MoveToDeckSheet(current: AddedNote, actions: SourceDeckActions, onDismiss: () -> Unit, onMoved: (AddedNote) -> Unit) {
    var decks by remember { mutableStateOf<List<Pair<String, String>>?>(null) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(current.deckId) {
        val list = runCatching { actions.decks() }.getOrDefault(emptyList())
        // The deck it is in now is always listed (a source deck made a moment ago may not be on the phone yet).
        decks = if (current.deckId.isNotEmpty() && list.none { it.first == current.deckId }) listOf(current.deckId to current.deckName) + list else list
    }
    LabFormSheet(
        onDismiss = onDismiss,
        title = "Move to another deck",
        footerAbove = error?.let { e -> { InlineNotice(e, kind = NoticeKind.Error) } },
        footer = { SecondaryPill("Cancel", Modifier.weight(1f).heightIn(min = 50.dp)) { onDismiss() } },
    ) {
        val list = decks
        if (list == null) {
            Text("Loading your decks…", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        } else {
            Column(Modifier.fillMaxWidth().padding(bottom = 4.dp).testTag("move-to-deck"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ChipRow(Modifier.fillMaxWidth()) {
                    for ((id, name) in list) {
                        LabChip(if (busy == id) "Moving…" else name, selected = id == current.deckId, enabled = busy == null) {
                            if (id == current.deckId) {
                                onDismiss()
                                return@LabChip
                            }
                            busy = id
                            error = null
                            scope.launch {
                                try {
                                    onMoved(actions.move(current, id, name))
                                } catch (e: Exception) {
                                    if (e is kotlinx.coroutines.CancellationException) throw e
                                    error = e.userMessage()
                                } finally {
                                    busy = null
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
