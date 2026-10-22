package dev.jeromeswannack.chineselearning.lab.ui.cardcontrols

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardHolds
import dev.jeromeswannack.chineselearning.lab.data.holds.HoldStore
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabToast
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/cards/held` — "Suspended & snoozed cards" (web pages/HeldCardsPage.tsx). Registered in FeatureGraphs. */
fun NavGraphBuilder.heldCardsGraph(nav: LabNav) {
    composable(Routes.route("/cards/held")) {
        val vm: HeldCardsViewModel = viewModel(factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <V : ViewModel> create(modelClass: Class<V>): V = HeldCardsViewModel(nav.app) as V
        })
        val ui by vm.ui.collectAsStateWithLifecycle()
        HeldCardsScreen(ui, HeldCardsActions(
            onBack = nav::back,
            onQuery = vm::setQuery,
            onFilter = vm::setFilter,
            onToggle = vm::toggle,
            onToggleAll = vm::toggleAll,
            onRelease = vm::release,
            onUndo = vm::undo,
            onOpen = { noteId -> nav.open("/cards/$noteId") },
        ))
    }
}

data class HeldCardsUi(
    val loaded: Boolean = false,
    val rows: List<HoldStore.Row> = emptyList(),
    val query: String = "",
    /** "all" | "suspended" | "snoozed". */
    val filter: String = "all",
    val picked: Set<String> = emptySet(),
    val today: String = HoldStore.localToday(),
    val toast: String? = null,
    val canUndo: Boolean = false,
) {
    val shown: List<HoldStore.Row> get() {
        val byId = rows.associateBy { it.list.cardId }
        return CardHolds.filterRows(rows.map { it.list }, query, filter).mapNotNull { byId[it.cardId] }
    }
    fun count(f: String): Int = when (f) {
        "suspended" -> rows.count { it.list.hold.kind == CardHolds.SUSPEND }
        "snoozed" -> rows.count { it.list.hold.kind == CardHolds.SNOOZE }
        else -> rows.size
    }
}

class HeldCardsActions(
    val onBack: () -> Unit = {},
    val onQuery: (String) -> Unit = {},
    val onFilter: (String) -> Unit = {},
    val onToggle: (String) -> Unit = {},
    val onToggleAll: () -> Unit = {},
    /** Unsuspend / Wake now for these cards. */
    val onRelease: (List<String>) -> Unit = {},
    val onUndo: () -> Unit = {},
    val onOpen: (noteId: String) -> Unit = {},
)

/** From Room (HoldStore; offline-first): reloads whenever local data changes. */
class HeldCardsViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(HeldCardsUi())
    val ui: StateFlow<HeldCardsUi> = _ui
    private var lastReleased: List<dev.jeromeswannack.chineselearning.lab.core.CardHold> = emptyList()
    private var toastJob: Job? = null

    init {
        viewModelScope.launch { app.repo.dataVersion.collect { reload() } }
    }

    private suspend fun reload() {
        val rows = withContext(Dispatchers.IO) { HoldStore.rows(app.repo.dao) }
        _ui.update { u -> u.copy(loaded = true, rows = rows, today = HoldStore.localToday(), picked = u.picked.filterTo(HashSet()) { id -> rows.any { it.list.cardId == id } }) }
    }

    fun setQuery(q: String) = _ui.update { it.copy(query = q) }
    fun setFilter(f: String) = _ui.update { it.copy(filter = f) }
    fun toggle(id: String) = _ui.update { it.copy(picked = if (id in it.picked) it.picked - id else it.picked + id) }
    fun toggleAll() = _ui.update { u ->
        val shown = u.shown.map { it.list.cardId }.toSet()
        u.copy(picked = if (shown.isNotEmpty() && u.picked.containsAll(shown)) emptySet() else shown)
    }

    fun release(ids: List<String>) {
        viewModelScope.launch {
            lastReleased = _ui.value.rows.filter { it.list.cardId in ids }.map { it.list.hold }
            val message = HoldStore.release(app, ids, "held_list")
            app.haptics.correct()
            show(message, canUndo = true)
            _ui.update { it.copy(picked = emptySet()) }
        }
    }

    fun undo() {
        val holds = lastReleased
        lastReleased = emptyList()
        viewModelScope.launch {
            HoldStore.restore(app, holds)
            _ui.update { it.copy(toast = null, canUndo = false) }
        }
    }

    private fun show(message: String, canUndo: Boolean) {
        toastJob?.cancel()
        _ui.update { it.copy(toast = message, canUndo = canUndo) }
        toastJob = viewModelScope.launch { delay(6000); _ui.update { it.copy(toast = null, canUndo = false) } }
    }
}

private val FILTERS = listOf("all" to "All", "suspended" to "⏸ Suspended", "snoozed" to "💤 Snoozed")

@Composable
fun HeldCardsScreen(ui: HeldCardsUi, actions: HeldCardsActions) {
    Box(Modifier.fillMaxSize()) {
        LabScreen(title = "Suspended & snoozed cards", onBack = actions.onBack) {
            item {
                Text(
                    "These cards are out of study for now. Their history and schedule are kept — bring one back and it carries on where it was.",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
            }
            item {
                OutlinedTextField(
                    value = ui.query, onValueChange = actions.onQuery, singleLine = true,
                    placeholder = { Text("Search hanzi, pinyin or English") },
                    modifier = Modifier.fillMaxWidth().testTag("held-search"),
                )
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((id, label) in FILTERS) {
                        val on = ui.filter == id
                        val shape = RoundedCornerShape(50)
                        Text(
                            (if (on) "✓ " else "") + "$label (${ui.count(id)})",
                            fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                            color = Lab.colors.ink,
                            modifier = Modifier.clip(shape).border(if (on) 2.dp else 1.dp, if (on) Lab.colors.ink else Lab.colors.outline, shape)
                                .bouncyClickable { actions.onFilter(id) }.heightIn(min = 40.dp).padding(horizontal = 14.dp, vertical = 9.dp)
                                .testTag("held-filter-$id"),
                        )
                    }
                }
            }
            val shown = ui.shown
            if (!ui.loaded) return@LabScreen
            if (shown.isEmpty()) {
                item {
                    Text(
                        if (ui.rows.isEmpty()) "Nothing is suspended or snoozed. On a card's answer side, ⋯ → Snooze… or Suspend… takes it out of study." else "No held card matches.",
                        color = Lab.colors.muted, modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp).testTag("held-empty"),
                    )
                }
                return@LabScreen
            }
            item {
                val picked = shown.filter { it.list.cardId in ui.picked }
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Checkbox(checked = picked.size == shown.size, onCheckedChange = { actions.onToggleAll() }, modifier = Modifier.testTag("held-select-all"))
                    Text(if (picked.isEmpty()) "Select all ${shown.size}" else "${picked.size} selected", color = Lab.colors.muted, modifier = Modifier.weight(1f))
                    if (picked.isNotEmpty()) {
                        val verb = when {
                            picked.all { it.list.hold.kind == CardHolds.SNOOZE } -> "Wake now"
                            picked.all { it.list.hold.kind == CardHolds.SUSPEND } -> "Unsuspend"
                            else -> "Back to study"
                        }
                        PrimaryPill("$verb (${picked.size})", onClick = { actions.onRelease(picked.map { it.list.cardId }) }, modifier = Modifier.testTag("held-bulk-release"))
                    }
                }
            }
            items(shown, key = { it.list.cardId }) { r -> HeldRow(r, ui, actions) }
        }
        LabToast(ui.toast?.let { if (ui.canUndo) "$it  ·  Undo" else it }, Modifier.align(Alignment.BottomCenter).bouncyClickable(enabled = ui.canUndo) { actions.onUndo() })
    }
}

@Composable
private fun HeldRow(r: HoldStore.Row, ui: HeldCardsUi, actions: HeldCardsActions) {
    val hold = r.list.hold
    val (icon, text) = CardHolds.tag(hold.kind, hold.until, ui.today)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Lab.colors.card)
            .border(1.dp, Lab.colors.cardBorder, RoundedCornerShape(14.dp)).padding(horizontal = 8.dp, vertical = 10.dp).testTag("held-row"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(checked = r.list.cardId in ui.picked, onCheckedChange = { actions.onToggle(r.list.cardId) })
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.list.hanzi, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.bouncyClickable { actions.onOpen(r.noteId) })
                Spacer(Modifier.width(8.dp))
                HoldTag(icon, text)
            }
            Text("${r.list.pinyin} · ${r.list.english}", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            Text(
                "${cardTypeLabel(r.cardType)} · ${r.deckName}" + if (hold.kind == CardHolds.SUSPEND && CardHolds.isLocalDate(hold.createdAt.take(10))) " · since ${CardHolds.shortDate(hold.createdAt.take(10), ui.today)}" else "",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
            )
        }
        SecondaryPill(if (hold.kind == CardHolds.SNOOZE) "Wake now" else "Unsuspend", onClick = { actions.onRelease(listOf(r.list.cardId)) }, modifier = Modifier.testTag("held-release"))
    }
}
