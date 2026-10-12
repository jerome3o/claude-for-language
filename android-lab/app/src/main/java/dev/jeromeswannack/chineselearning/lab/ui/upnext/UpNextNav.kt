package dev.jeromeswannack.chineselearning.lab.ui.upnext

import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.UpNext
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextAddBody
import dev.jeromeswannack.chineselearning.lab.data.api.UpNextDto
import dev.jeromeswannack.chineselearning.lab.data.api.addUpNext
import dev.jeromeswannack.chineselearning.lab.data.api.removeUpNext
import dev.jeromeswannack.chineselearning.lab.data.api.reorderUpNext
import dev.jeromeswannack.chineselearning.lab.data.api.searchNotes
import dev.jeromeswannack.chineselearning.lab.data.api.searchStudentNotes
import dev.jeromeswannack.chineselearning.lab.data.api.upNext
import dev.jeromeswannack.chineselearning.lab.data.api.upNextPosition
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore
import dev.jeromeswannack.chineselearning.lab.data.upnext.UpNextStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.LabNav
import dev.jeromeswannack.chineselearning.lab.ui.nav.Routes
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** `/up-next` (the learner's list, web pages/UpNextPage.tsx) and `/connections/:relId/up-next` (the tutor's view). */
fun NavGraphBuilder.upNextGraph(nav: LabNav) {
    composable(Routes.route("/up-next")) {
        val vm: UpNextViewModel = viewModel(factory = factory { UpNextViewModel(nav.app) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        UpNextScreen(ui, vm.actions(onBack = nav::back))
    }
    composable(Routes.route("/connections/{relId}/up-next?name={name}")) { entry ->
        val relId = entry.arguments?.getString("relId").orEmpty()
        val name = entry.arguments?.getString("name")?.takeIf { it.isNotBlank() }
        val vm: StudentUpNextViewModel = viewModel(key = "student-up-next-$relId", factory = factory { StudentUpNextViewModel(nav.app, relId, name) })
        val ui by vm.ui.collectAsStateWithLifecycle()
        UpNextScreen(ui, vm.actions(onBack = nav::back))
    }
}

private inline fun <reified T : ViewModel> factory(crossinline make: () -> T) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <V : ViewModel> create(modelClass: Class<V>): V = make() as V
}

/**
 * The learner's list, from Room (UpNextStore; offline-first): ⚡ Today from the bump pocket, the list
 * with each note's status from the local cards, search over the local notes (the server's search
 * when the phone finds nothing and is online — those are added through the API).
 */
class UpNextViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(UpNextUi(loading = true))
    val ui: StateFlow<UpNextUi> = _ui
    private var undo: (suspend () -> Unit)? = null
    private var searchJob: Job? = null

    init {
        viewModelScope.launch { app.repo.dataVersion.collect { runCatching { load() } } }
    }

    private suspend fun load() {
        val dao = app.repo.dao
        val list = dao.upNext()
        val bumps = BumpStore.active(dao)
        val open = runCatching { BumpStore.openNoteIds(dao) }.getOrDefault(bumps.map { it.noteId }.toSet())
        val ids = (list.map { it.noteId } + bumps.map { it.noteId }).distinct()
        val notes = dao.notes(ids).associateBy { it.id }
        val decks = dao.decks().associate { it.id to it.name }
        val statuses = UpNextStore.statuses(dao, ids)
        val onList = list.map { it.noteId }.toSet()
        val rows = list.mapNotNull { r ->
            val (status, fresh) = statuses[r.noteId] ?: (UpNext.MISSING to 0)
            if (status == UpNext.DONE) return@mapNotNull null
            val n = notes[r.noteId]
            UpNextRowUi(r.noteId, n?.hanzi ?: "…", n?.pinyin.orEmpty(), n?.english.orEmpty(), n?.let { decks[it.deckId] }.orEmpty(), UpNext.statusLabel(status, fresh), r.addedByName)
        }
        val today = bumps.filter { it.noteId in open }.map { b ->
            val n = notes[b.noteId]
            val (status, _) = statuses[b.noteId] ?: (UpNext.MISSING to 0)
            UpNextTodayUi(b.noteId, n?.hanzi ?: "…", n?.pinyin.orEmpty(), n?.english.orEmpty(), n?.let { decks[it.deckId] }.orEmpty(), b.bumpedByName,
                canMoveToUpNext = (status == UpNext.NEW || status == UpNext.STARTED) && b.noteId !in onList)
        }
        _ui.update { it.copy(loading = false, rows = rows, today = today) }
        if (_ui.value.query.isNotBlank()) search(_ui.value.query, debounce = false)
    }

    private fun search(q: String, debounce: Boolean = true) {
        searchJob?.cancel()
        if (q.isBlank()) { _ui.update { it.copy(hits = null, searching = false) }; return }
        searchJob = viewModelScope.launch {
            if (debounce) delay(200)
            _ui.update { it.copy(searching = true) }
            val hits = try { find(q) } catch (e: CancellationException) { throw e } catch (e: Throwable) { emptyList() }
            _ui.update { if (it.query == q) it.copy(hits = hits, searching = false) else it }
        }
    }

    private suspend fun find(raw: String): List<UpNextHitUi> {
        val dao = app.repo.dao
        val q = NoteSearch.prepare(raw)
        val stripped = NoteSearch.stripTones(q)
        val decks = dao.decks().associate { it.id to it.name }
        val onList = dao.upNext().map { it.noteId }.toSet()
        val matches = dao.allNotes().filter { it.deckId in decks && NoteSearch.matches(it.hanzi, it.pinyin, it.english, it.sentenceClue, q, stripped) }.take(25)
        if (matches.isNotEmpty()) {
            val st = UpNextStore.statuses(dao, matches.map { it.id })
            return matches.map { n ->
                val status = st[n.id]?.first ?: UpNext.MISSING
                UpNextHitUi(n.id, n.hanzi, n.pinyin, n.english, decks[n.deckId].orEmpty(), n.id in onList, studied = status == UpNext.DONE || status == UpNext.MISSING)
            }
        }
        if (!app.online.value) return emptyList()
        return app.repo.api.searchNotes(raw.trim(), 20).notes.map { UpNextHitUi(it.id, it.hanzi, it.pinyin, it.english, it.deck_name.orEmpty(), it.id in onList) }
    }

    private fun toast(text: String, undoWith: (suspend () -> Unit)? = null) {
        undo = undoWith
        _ui.update { it.copy(toast = text, toastUndo = undoWith != null) }
    }

    fun actions(onBack: () -> Unit) = UpNextActions(
        onBack = onBack,
        onQuery = { q -> _ui.update { it.copy(query = q, hits = if (q.isBlank()) null else it.hits) }; search(q) },
        onAdd = { id, position ->
            viewModelScope.launch {
                if (app.repo.dao.notes(listOf(id)).isEmpty()) {
                    // From the server search: not on this phone yet — straight to the API, then sync.
                    val r = runCatching { app.repo.api.addUpNext(UpNextAddBody(note_ids = listOf(id), position = upNextPosition(position), source = "search")) }
                    toast(r.getOrNull()?.added?.firstOrNull()?.let { "↑ ${it.hanzi} is up next" } ?: "That card isn’t on this phone yet — try again online.")
                    if (r.isSuccess) app.scope.launch { runCatching { app.repo.sync() } }
                    return@launch
                }
                if (position is Int) app.haptics.correct()
                toast(UpNextStore.add(app, listOf(id), position, "search").message)
            }
        },
        onReorder = { order, how -> viewModelScope.launch { UpNextStore.reorder(app, order, how) } },
        onRemove = { id ->
            viewModelScope.launch {
                val hanzi = app.repo.dao.notes(listOf(id)).firstOrNull()?.hanzi.orEmpty()
                val index = UpNextStore.remove(app, id) ?: return@launch
                toast("Removed $hanzi from Up next") { UpNextStore.add(app, listOf(id), index, "up_next_page") }
            }
        },
        onBolt = { id ->
            viewModelScope.launch {
                val r = BumpStore.bumpNotes(app, listOf(id), "up_next")
                UpNextStore.remove(app, id)
                toast(r.message)
            }
        },
        onBoltHit = { id -> viewModelScope.launch { toast(BumpStore.bumpNotes(app, listOf(id), "up_next").message) } },
        onTodayToUpNext = { id ->
            viewModelScope.launch {
                UpNextStore.add(app, listOf(id), "top", "up_next_page")
                BumpStore.clear(app, id, "up_next")
                toast("${app.repo.dao.notes(listOf(id)).firstOrNull()?.hanzi.orEmpty()} moved to Up next")
            }
        },
        onTodayClear = { id -> viewModelScope.launch { BumpStore.clear(app, id, "up_next") } },
        onUndo = { val u = undo; undo = null; _ui.update { it.copy(toast = null) }; if (u != null) viewModelScope.launch { u() } },
        onToastDone = { undo = null; _ui.update { it.copy(toast = null) } },
        onLift = { app.haptics.tick() },
        onSlot = { app.haptics.tick() },
    )
}

/**
 * The tutor's view of a student's list, online through /api/relationships/:relId/student-up-next
 * (search = the student's notes on the server). Offline: read-only with a notice.
 */
class StudentUpNextViewModel(private val app: LabApp, private val relId: String, name: String?) : ViewModel() {
    private val who = name ?: "your student"
    private val _ui = MutableStateFlow(
        UpNextUi(
            title = if (name != null) "$name’s Up next" else "Up next",
            intro = "The words $who learns next: they take the first of $who’s daily new cards, in this order. Nothing is sent and nothing extra is added — only the order of $who’s own cards changes.",
            loading = true,
            learner = false,
            searchPlaceholder = "Search $who’s cards…",
            emptyText = "Nothing chosen yet — search above to pick the words $who learns next.",
        ),
    )
    val ui: StateFlow<UpNextUi> = _ui
    private var list: List<UpNextDto> = emptyList()
    private var undo: (suspend () -> Unit)? = null
    private var searchJob: Job? = null

    init {
        viewModelScope.launch { app.online.collect { on -> _ui.update { it.copy(readOnlyReason = if (on) null else "You’re offline — the list can be changed again once you’re back online.") } } }
        load()
    }

    private fun load() = viewModelScope.launch {
        try {
            show(app.repo.api.upNext(relId))
            _ui.update { it.copy(error = null) }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            _ui.update { it.copy(loading = false, error = e.userMessage()) }
        }
    }

    private fun show(next: List<UpNextDto>) {
        list = next
        _ui.update { s ->
            s.copy(loading = false, rows = next.map { e ->
                UpNextRowUi(e.note_id, e.hanzi, e.pinyin, e.english, e.deck_name.orEmpty(), UpNext.statusLabel(e.status, e.new_cards),
                    addedBy = e.added_by_name ?: if (e.added_by != null && e.source == "tutor") "you" else null)
            }, hits = s.hits?.map { h -> h.copy(onList = next.any { it.note_id == h.noteId }) })
        }
    }

    private fun run(block: suspend () -> List<UpNextDto>) = viewModelScope.launch {
        try {
            show(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            _ui.update { it.copy(toast = e.userMessage(), toastUndo = false) }
            load()
        }
    }

    private fun search(q: String) {
        searchJob?.cancel()
        if (q.isBlank()) { _ui.update { it.copy(hits = null, searching = false) }; return }
        searchJob = viewModelScope.launch {
            delay(250)
            _ui.update { it.copy(searching = true) }
            val hits = runCatching { app.repo.api.searchStudentNotes(relId, q.trim()) }.getOrDefault(emptyList())
            _ui.update {
                if (it.query != q) it else it.copy(searching = false, hits = hits.map { n ->
                    UpNextHitUi(n.id, n.hanzi, n.pinyin, n.english, n.deck_name.orEmpty(), onList = n.on_up_next || list.any { e -> e.note_id == n.id }, studied = n.new_cards == 0)
                })
            }
        }
    }

    fun actions(onBack: () -> Unit) = UpNextActions(
        onBack = onBack,
        onQuery = { q -> _ui.update { it.copy(query = q) }; search(q) },
        onAdd = { id, position ->
            run {
                val r = app.repo.api.addUpNext(UpNextAddBody(note_ids = listOf(id), position = upNextPosition(position)), relId)
                r.added.firstOrNull()?.let { a -> _ui.update { it.copy(toast = "↑ ${a.hanzi} is up next for $who", toastUndo = false) } }
                if (r.added.isEmpty() && r.no_new_cards.isNotEmpty()) _ui.update { it.copy(toast = "$who has already studied every card of that word", toastUndo = false) }
                r.up_next
            }
        },
        onReorder = { order, how ->
            val byId = list.associateBy { it.note_id }
            show(order.mapNotNull { byId[it] })
            app.analytics.track("study.up_next_moved", mapOf("how" to how))
            run { app.repo.api.reorderUpNext(order, relId) }
        },
        onRemove = { id ->
            val index = list.indexOfFirst { it.note_id == id }
            val hanzi = list.getOrNull(index)?.hanzi.orEmpty()
            app.analytics.track("study.up_next_removed", mapOf("source" to "tutor"))
            run {
                val r = app.repo.api.removeUpNext(id, relId)
                undo = { show(app.repo.api.addUpNext(UpNextAddBody(note_ids = listOf(id), position = upNextPosition(index)), relId).up_next) }
                _ui.update { it.copy(toast = "Removed $hanzi from $who’s Up next", toastUndo = true) }
                r.up_next
            }
        },
        onUndo = { val u = undo; undo = null; _ui.update { it.copy(toast = null) }; if (u != null) viewModelScope.launch { runCatching { u() } } },
        onToastDone = { undo = null; _ui.update { it.copy(toast = null) } },
        onLift = { app.haptics.tick() },
        onSlot = { app.haptics.tick() },
        onRetry = { load() },
    )
}
