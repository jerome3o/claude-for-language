package dev.jeromeswannack.chineselearning.lab.ui.settings

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.DupGroup
import dev.jeromeswannack.chineselearning.lab.core.DupItem
import dev.jeromeswannack.chineselearning.lab.core.DupNote
import dev.jeromeswannack.chineselearning.lab.core.Duplicates
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.api.send
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.ui.kit.ConfirmDialog
import dev.jeromeswannack.chineselearning.lab.ui.kit.EmptyState
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.StatusPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class DuplicatesUi(
    val loading: Boolean = true,
    val scanned: Boolean = false,
    val groups: List<DupGroup> = emptyList(),
    val deckNames: Map<String, String> = emptyMap(),
    val deleting: Set<String> = emptySet(),
    val error: String? = null,
) {
    val extraCount: Int get() = groups.sumOf { it.items.size - 1 }
}

/**
 * `/duplicate-finder` (web: DuplicateFinderPage): notes with the same hanzi across decks,
 * the most-reviewed one marked ★ Keep. A delete goes to the server (DELETE /api/notes/:id,
 * which writes the tombstone for other devices) and is mirrored on the phone at once.
 */
class DuplicateFinderViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(DuplicatesUi())
    val ui: StateFlow<DuplicatesUi> = _ui
    private val deleted = HashSet<String>()
    private var notes: List<DupNote> = emptyList()
    private var reviews: Map<String, Int> = emptyMap()
    private var reps: Map<String, Int> = emptyMap()

    init {
        viewModelScope.launch { load() }
    }

    private suspend fun load() = withContext(Dispatchers.IO) {
        val dao = app.repo.dao
        notes = dao.allNotes().map { DupNote(it.id, it.deckId, it.hanzi, it.pinyin, it.english) }
        reps = dao.cards().groupBy { it.noteId }.mapValues { (_, c) -> c.sumOf { it.reps } }
        reviews = app.repo.db.openHelper.readableDatabase
            .query("SELECT c.noteId, COUNT(*) FROM review_events e JOIN cards c ON c.id = e.cardId GROUP BY c.noteId").use { cur ->
                buildMap { while (cur.moveToNext()) put(cur.getString(0), cur.getInt(1)) }
            }
        val names = dao.decks().associate { it.id to it.name }
        _ui.update { it.copy(loading = false, deckNames = names, groups = if (it.scanned) groups() else it.groups) }
    }

    private fun groups() = Duplicates.find(notes, reviews, reps, deleted)

    fun scan() {
        app.haptics.tick()
        _ui.update { it.copy(scanned = true, groups = groups()) }
    }

    fun delete(ids: List<String>) = viewModelScope.launch {
        var failed = 0
        for (id in ids) {
            _ui.update { it.copy(deleting = it.deleting + id) }
            try {
                withContext(Dispatchers.IO) {
                    val res = app.repo.api.send("DELETE", "/api/notes/${enc(id)}")
                    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
                    // Mirror the answer (the sync would bring the tombstone anyway).
                    app.repo.dao.deleteSentencesOf(listOf(id))
                    app.repo.dao.deleteCardsOfNotes(listOf(id))
                    app.repo.dao.deleteNotes(listOf(id))
                }
                deleted += id
                _ui.update { it.copy(groups = groups()) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failed++
                _ui.update { it.copy(error = if (ids.size == 1) "Couldn't delete that note. ${e.userMessage()}" else "Some notes couldn't be deleted. ${e.userMessage()}") }
            } finally {
                _ui.update { it.copy(deleting = it.deleting - id) }
            }
        }
        if (failed == 0) app.haptics.correct()
        app.scope.launch { app.repo.sync() }
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DuplicateFinderViewModel(app) as T
    }
}

class DuplicateActions(val onBack: () -> Unit = {}, val scan: () -> Unit = {}, val delete: (List<String>) -> Unit = {})

@Composable
fun DuplicateFinderScreen(ui: DuplicatesUi, online: Boolean, actions: DuplicateActions) {
    var confirm by remember { mutableStateOf<Pair<String, List<String>>?>(null) }
    LabScreen(title = "Duplicate Finder", onBack = actions.onBack, subtitle = "Notes with the same hanzi. The one with the most reviews is the keeper.") {
        item {
            dev.jeromeswannack.chineselearning.lab.ui.kit.ChipRow {
                PrimaryPill(if (ui.loading) "Loading data..." else "🔍 Scan for Duplicates", enabled = !ui.loading, onClick = actions.scan)
                if (ui.scanned && ui.extraCount > 0) {
                    SecondaryPill("🗑️ Delete All Duplicates (${ui.extraCount})", danger = true, enabled = online) {
                        confirm = "Delete ${ui.extraCount} duplicate note${if (ui.extraCount == 1) "" else "s"}? This cannot be undone." to ui.groups.flatMap { g -> g.extras.map { it.note.id } }
                    }
                }
            }
        }
        if (!online && ui.scanned && ui.extraCount > 0) item { InlineNotice("Deleting needs a connection.", kind = NoticeKind.Offline) }
        ui.error?.let { item { InlineNotice(it, kind = NoticeKind.Error) } }
        if (ui.scanned) {
            if (ui.groups.isEmpty()) {
                item { EmptyState("✅", "No duplicates found!", body = "All your notes have unique hanzi.") }
            } else {
                item {
                    Text(
                        "Found ${ui.groups.size} duplicate group${if (ui.groups.size != 1) "s" else ""} (${ui.extraCount} extra note${if (ui.extraCount != 1) "s" else ""} to remove).",
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                    )
                }
                items(ui.groups, key = { it.hanzi }) { g ->
                    GroupCard(g, ui, online) { item ->
                        val deck = ui.deckNames[item.note.deckId] ?: "Unknown"
                        confirm = "Delete \"${item.note.hanzi}\" (${item.note.english}) from \"$deck\"? This cannot be undone." to listOf(item.note.id)
                    }
                }
            }
        }
    }
    confirm?.let { (text, ids) ->
        ConfirmDialog("Delete?", text, "Delete", danger = true, onConfirm = { actions.delete(ids) }, onDismiss = { confirm = null })
    }
}

@Composable
private fun GroupCard(g: DupGroup, ui: DuplicatesUi, online: Boolean, onDelete: (DupItem) -> Unit) {
    LabCard(Modifier.animateContentSize()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(g.hanzi, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = Lab.colors.ink)
            Spacer(Modifier.width(10.dp))
            StatusPill("${g.items.size} copies", Lab.colors.muted)
        }
        g.items.forEachIndexed { i, item ->
            RowDivider()
            val busy = item.note.id in ui.deleting
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp).alpha(if (busy) 0.5f else 1f).padding(horizontal = 16.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (i == 0) {
                    StatusPill("★ Keep", Palette.Good)
                    Spacer(Modifier.width(10.dp))
                }
                Column(Modifier.weight(1f)) {
                    Text(item.note.english, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Lab.colors.ink)
                    Text(item.note.pinyin, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    Text("Deck: ${ui.deckNames[item.note.deckId] ?: "Unknown"}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${item.totalReviews} review${if (item.totalReviews != 1) "s" else ""}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                    if (i > 0) SecondaryPill(if (busy) "Deleting…" else "Delete", danger = true, enabled = !busy && online) { onDelete(item) }
                }
            }
        }
    }
}
