package dev.jeromeswannack.chineselearning.lab.ui.readers

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.data.api.SentenceChunkDto
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabFormSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabChip
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.launch

/** Where a word can go (a deck) and how to add it — the reading view's port of AddChunkModal. */
class AddWordActions(
    val decks: suspend () -> List<DeckChoice> = { emptyList() },
    val isDuplicate: suspend (deckId: String, hanzi: String) -> Boolean = { _, _ -> false },
    val add: suspend (deckId: String, chunk: SentenceChunkDto) -> Unit = { _, _ -> },
)

/** A tapped word: hanzi · pinyin · English, which deck, Add to deck (Add anyway when it's already there). */
@Composable
fun AddWordSheet(
    chunk: SentenceChunkDto, actions: AddWordActions, onDismiss: () -> Unit, onAdded: () -> Unit = {},
    bumpSource: String = "reader",
    /** "⚡ Study it today" when the word is already a card (null = none: previews). */
    bump: dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpHanzi? = dev.jeromeswannack.chineselearning.lab.ui.bumps.rememberBumpHanzi(bumpSource),
) {
    var bumped by remember { mutableStateOf<String?>(null) }
    var decks by remember { mutableStateOf<List<DeckChoice>>(emptyList()) }
    var deckId by remember { mutableStateOf<String?>(null) }
    var duplicate by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { decks = actions.decks(); deckId = decks.firstOrNull()?.id }
    LaunchedEffect(deckId) { duplicate = deckId?.let { actions.isDuplicate(it, chunk.hanzi) } ?: false }
    fun add() {
        val id = deckId ?: return
        busy = true
        error = null
        scope.launch {
            try {
                actions.add(id, chunk)
                done = true
                onAdded()
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.userMessage()
            } finally {
                busy = false
            }
        }
    }
    // Many decks: the deck chips scroll, "Add to deck" stays pinned (LabFormSheet).
    LabFormSheet(
        onDismiss = onDismiss,
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 4.dp),
        spacing = 8.dp,
        footerAbove = if (error == null && !done && bumped == null) null else {
            {
                error?.let { InlineNotice(it, kind = NoticeKind.Error) }
                if (done) InlineNotice("Added — it arrives with the next sync.", kind = NoticeKind.Success)
                bumped?.let { InlineNotice(it, kind = NoticeKind.Success) }
            }
        },
        footer = if (done) null else if (duplicate && bump != null) {
            {
                dev.jeromeswannack.chineselearning.lab.ui.bumps.BumpFirstRow(bumped, busy, onAddAnyway = ::add, onBump = {
                    busy = true
                    error = null
                    scope.launch {
                        try { bumped = bump(listOf(chunk.hanzi), deckId) } catch (e: Exception) {
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            error = e.userMessage()
                        } finally { busy = false }
                    }
                })
            }
        } else {
            {
                PrimaryPill(
                    if (busy) "Adding…" else if (duplicate) "Add anyway" else "Add to deck",
                    Modifier.weight(1f).height(54.dp),
                    enabled = !busy && deckId != null,
                ) { add() }
            }
        },
    ) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(chunk.hanzi, fontSize = 52.sp, color = Lab.colors.ink)
            Text(chunk.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent)
            Text(chunk.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink, textAlign = TextAlign.Center)
            chunk.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, textAlign = TextAlign.Center) }
            if (duplicate && !done && bumped == null) InlineNotice("This word is already in the selected deck.", kind = NoticeKind.Warning)
            Text("Save to deck:", style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted, modifier = Modifier.fillMaxWidth())
            ChipRow(Modifier.fillMaxWidth()) {
                for (d in decks) LabChip(d.name, selected = d.id == deckId) { deckId = d.id }
            }
        }
    }
}
