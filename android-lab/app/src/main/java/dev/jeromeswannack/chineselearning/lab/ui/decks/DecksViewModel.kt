package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.Budget
import dev.jeromeswannack.chineselearning.lab.core.DeckQueue
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.api.SearchHitDto
import dev.jeromeswannack.chineselearning.lab.data.api.searchNotes
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId

/** One deck on the Decks tab (the web's DeckCard). */
data class DeckCardUi(
    val id: String,
    val name: String,
    val noteCount: Int,
    val counts: QueueCounts,
    val hasMoreNew: Boolean,
    val totalCards: Int,
    val mastered: Int,
    val learning: Int,
    /** The deck's folder (null = Unfiled). Organisation only: the queue order is global. */
    val folderId: String? = null,
)

/** One local search hit (the web's NoteSearchResults row). */
data class SearchRowUi(
    val noteId: String,
    val deckId: String,
    val deckName: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val sentenceClue: String?,
    /** card type → most recent first, up to 8. */
    val ratings: Map<String, List<Int>>,
    val mastery: Int,
)

data class ServerSearchUi(
    val loading: Boolean = false,
    val hits: List<SearchHitDto> = emptyList(),
    val totalNotes: Int = 0,
    val failed: Boolean = false,
)

data class SearchUi(
    val query: String,
    val total: Int,
    val results: List<SearchRowUi>,
    val localNotes: Int,
    val server: ServerSearchUi? = null,
)

data class DecksUi(
    val loaded: Boolean = false,
    /** In queue order: the first is studied first. */
    val decks: List<DeckCardUi> = emptyList(),
    val newPerDay: Int = 3,
    val query: String = "",
    val search: SearchUi? = null,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    val online: Boolean = true,
    val busy: Boolean = false,
)

/**
 * The Decks tab (web: pages/DecksPage.tsx + components/NoteSearchResults.tsx): the deck
 * queue from Room with per-deck due counts (same allocation as Home), moves / drag reorder
 * (mirrored at once, sent through [DeckWrites]), "+10 more", New deck / starter deck, and
 * the card search — local first, the server when the phone has nothing.
 */
class DecksViewModel(private val env: DecksEnv, initialQuery: String? = null) : ViewModel() {
    private val _ui = MutableStateFlow(DecksUi(query = initialQuery.orEmpty()))
    val ui: StateFlow<DecksUi> = _ui
    val editor = dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditor(env, viewModelScope).apply {
        onDone = { msg -> _ui.update { it.copy(notice = msg, noticeIsError = false) } }
    }
    /** Folders on the Decks list (shared with the Library and Readers: ui/folders/). */
    val folders: dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController? = env.folderWrites?.let { w ->
        dev.jeromeswannack.chineselearning.lab.ui.folders.FolderController(
            viewModelScope, dev.jeromeswannack.chineselearning.lab.core.Folders.DECK, env.cache, w, env.folderFeel,
            currentFolderOf = { id -> _ui.value.decks.firstOrNull { it.id == id }?.folderId },
        )
    }
    private var searchJob: Job? = null
    private var serverJob: Job? = null

    init {
        viewModelScope.launch { env.dataVersion.collect { refresh() } }
        viewModelScope.launch { env.online.collect { on -> _ui.update { it.copy(online = on) } } }
        if (!initialQuery.isNullOrBlank()) setQuery(initialQuery, debounce = false)
    }

    fun refresh() {
        viewModelScope.launch {
            val decks = withContext(Dispatchers.IO) { loadDecks() }
            _ui.update { it.copy(loaded = true, decks = decks, newPerDay = env.budget().newCardsPerDay) }
            if (_ui.value.search != null) runSearch(_ui.value.query)
        }
    }

    private suspend fun loadDecks(): List<DeckCardUi> {
        val zone = ZoneId.systemDefault()
        val now = env.nowMs()
        val dao = env.dao
        val decks = dao.decks()
        val entities = dao.cards()
        val cards = entities.map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
        val cutoff = StudyQueue.cutoff(now, zone)
        val queueDecks = decks.map { it.toQueueDeck() }
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()
        val longTerm = dao.noteLongTerm()
        val noteCounts = dao.noteCounts().associate { it.deckId to it.count }
        val cardsByDeck = entities.groupBy { it.deckId }
        val ordered = Budget.sortForQueue(decks, { it.studyPriority }, { it.createdAt })
        return ordered.map { d ->
            val q = StudyQueue.build(queueDecks, cards, env.budget(), env.bonus(d.id, today), introduced, cutoff, d.id, longTerm = longTerm)
            val completion = DeckStats.completion(cardsByDeck[d.id].orEmpty())
            DeckCardUi(
                id = d.id, name = d.name, noteCount = noteCounts[d.id] ?: 0,
                counts = StudyQueue.counts(q.dueCards, q.reviewedNoteIds), hasMoreNew = q.hasMoreNew,
                totalCards = completion.total, mastered = completion.mastered, learning = completion.learning,
                folderId = d.folderId,
            )
        }
    }

    // ---------------- queue ----------------

    /** #N menu: Move to top / up / down / bottom. */
    fun move(deckId: String, to: DeckQueue.Move) {
        val order = _ui.value.decks.map { it.id }
        val next = DeckQueue.moveInOrder(order, deckId, to)
        if (next === order) return
        applyOrder(next)
        env.fx.drop()
        viewModelScope.launch { report(env.writes.moveDeck(deckId, to, order)) }
    }

    /** The end of a press-and-hold drag: the new whole order. */
    fun commitOrder(orderedIds: List<String>) {
        val order = _ui.value.decks.map { it.id }
        if (orderedIds == order) return
        applyOrder(orderedIds)
        env.fx.drop()
        viewModelScope.launch { report(env.writes.reorder(orderedIds)) }
    }

    /** Re-sort at once so the list never jumps back while the write is in flight. */
    private fun applyOrder(ids: List<String>) {
        val byId = _ui.value.decks.associateBy { it.id }
        _ui.update { s -> s.copy(decks = ids.mapNotNull(byId::get)) }
    }

    /** "+10 More" on a deck with nothing due but more new words (the web's bumpBonus). */
    fun addMore(deckId: String) {
        val zone = ZoneId.systemDefault()
        val today = Instant.ofEpochMilli(env.nowMs()).atZone(zone).toLocalDate().toString()
        env.setBonus(deckId, today, env.bonus(deckId, today) + StudyQueue.BONUS_INCREMENT)
        env.fx.tick()
        refresh()
    }

    // ---------------- create ----------------

    fun createDeck(name: String, description: String, onCreated: (String) -> Unit) {
        if (name.isBlank()) return
        _ui.update { it.copy(busy = true, notice = null) }
        viewModelScope.launch {
            env.writes.createDeck(name, description).fold(
                onSuccess = { deck -> env.fx.success(); _ui.update { it.copy(busy = false) }; onCreated(deck.id) },
                onFailure = { e -> env.fx.failure(); _ui.update { it.copy(busy = false, notice = e.message ?: "Couldn't create the deck.", noticeIsError = true) } },
            )
        }
    }

    fun addStarterDeck(onCreated: (String) -> Unit) {
        _ui.update { it.copy(busy = true, notice = null) }
        viewModelScope.launch {
            env.writes.starterDeck().fold(
                onSuccess = { deck -> env.fx.success(); _ui.update { it.copy(busy = false) }; onCreated(deck.id) },
                onFailure = { e -> _ui.update { it.copy(busy = false, notice = e.message, noticeIsError = true) } },
            )
        }
    }

    fun dismissNotice() = _ui.update { it.copy(notice = null) }

    private fun report(outcome: WriteOutcome) {
        when (outcome) {
            WriteOutcome.Saved -> Unit
            WriteOutcome.Queued -> _ui.update { it.copy(notice = "Saved on this phone — the new order goes to the server when you're back online.", noticeIsError = false) }
            is WriteOutcome.Refused -> {
                env.fx.failure()
                _ui.update { it.copy(notice = outcome.message, noticeIsError = true) }
                refresh()
            }
        }
    }

    // ---------------- search ----------------

    fun setQuery(q: String, debounce: Boolean = true) {
        _ui.update { it.copy(query = q) }
        searchJob?.cancel()
        if (NoteSearch.jsTrim(q).isEmpty()) {
            serverJob?.cancel()
            _ui.update { it.copy(search = null) }
            return
        }
        searchJob = viewModelScope.launch {
            if (debounce) delay(SEARCH_DEBOUNCE_MS)
            runSearch(q)
        }
    }

    private suspend fun runSearch(raw: String) {
        val q = NoteSearch.prepare(raw)
        if (q.isEmpty()) return
        val result = withContext(Dispatchers.IO) { searchLocally(raw, q) }
        _ui.update { it.copy(search = result) }
        serverJob?.cancel()
        if (result.results.isEmpty() && env.online.value) {
            _ui.update { it.copy(search = result.copy(server = ServerSearchUi(loading = true))) }
            serverJob = viewModelScope.launch {
                val server = try {
                    val r = withContext(Dispatchers.IO) { env.api.searchNotes(q, SERVER_LIMIT) }
                    ServerSearchUi(hits = r.notes, totalNotes = r.total_notes)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    ServerSearchUi(failed = true)
                }
                _ui.update { s -> if (s.search?.query == raw) s.copy(search = s.search.copy(server = server)) else s }
            }
        }
    }

    private suspend fun searchLocally(raw: String, q: String): SearchUi {
        val stripped = NoteSearch.stripTones(q)
        val notes = env.dao.allNotes()
        val matches = notes.filter { NoteSearch.matches(it.hanzi, it.pinyin, it.english, it.sentenceClue, q, stripped) }
        val shown = matches.take(MAX_RESULTS)
        // Cards and recent ratings only for the notes on screen.
        val cards = env.dao.cards().let { all -> val ids = shown.mapTo(HashSet()) { it.id }; all.filter { it.noteId in ids } }
        val events = cards.map { it.id }.chunked(500).flatMap { env.dao.replayEventsForCards(it) }
        val ratings = DeckStats.recentRatings(cards, events)
        val cardsByNote = cards.groupBy { it.noteId }
        val deckNames = env.dao.decks().associate { it.id to it.name }
        return SearchUi(
            query = raw,
            total = matches.size,
            results = shown.map { n ->
                SearchRowUi(
                    n.id, n.deckId, deckNames[n.deckId] ?: "Deck", n.hanzi, n.pinyin, n.english, n.sentenceClue,
                    ratings[n.id].orEmpty(), DeckStats.notePercent(cardsByNote[n.id].orEmpty()),
                )
            },
            localNotes = notes.size,
        )
    }

    /** Delete from a search row (the web's two-tap ×). */
    fun deleteNote(noteId: String) {
        viewModelScope.launch {
            when (val o = env.writes.deleteNote(noteId)) {
                is WriteOutcome.Refused -> _ui.update { it.copy(notice = o.message, noticeIsError = true) }
                else -> env.fx.tick()
            }
        }
    }

    class Factory(private val env: DecksEnv, private val query: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DecksViewModel(env, query) as T
    }

    companion object {
        /** Render at most this many matches (a one-character query can match thousands). */
        const val MAX_RESULTS = 200
        const val SERVER_LIMIT = 50
        const val SEARCH_DEBOUNCE_MS = 250L
    }
}
