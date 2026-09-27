package dev.jeromeswannack.chineselearning.lab.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId

data class DeckSummary(val id: String, val name: String, val noteCount: Int, val due: QueueCounts)

data class HomeUi(
    val loaded: Boolean = false,
    val userName: String? = null,
    val due: QueueCounts = QueueCounts(0, 0, 0, 0),
    val decks: List<DeckSummary> = emptyList(),
    val reviewedToday: Int = 0,
)

class HomeViewModel(private val app: LabApp) : ViewModel() {
    private val _ui = MutableStateFlow(HomeUi())
    val ui: StateFlow<HomeUi> = _ui

    init {
        viewModelScope.launch { app.repo.dataVersion.collect { refresh() } }
    }

    fun refresh() {
        viewModelScope.launch {
            _ui.value = withContext(Dispatchers.IO) { load() }
        }
    }

    private suspend fun load(): HomeUi {
        val zone = ZoneId.systemDefault()
        val now = System.currentTimeMillis()
        val dao = app.repo.dao
        val decks = dao.decks()
        val cards = dao.cards().map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val dayStart = StudyQueue.startOfDay(now, zone)
        val introduced = StudyQueue.introducedToday(cards, first, dayStart)
        val cutoff = StudyQueue.cutoff(now, zone)
        val queueDecks = decks.map { it.toQueueDeck() }
        val today = LocalDate.now(zone).toString()
        val all = StudyQueue.build(queueDecks, cards, app.prefs.budget, app.prefs.bonus("all", today), introduced, cutoff, null)
        val noteCounts = dao.noteCounts().associate { it.deckId to it.count }
        val summaries = decks.map { d ->
            val q = StudyQueue.build(queueDecks, cards, app.prefs.budget, app.prefs.bonus(d.id, today), introduced, cutoff, d.id)
            DeckSummary(d.id, d.name, noteCounts[d.id] ?: 0, StudyQueue.counts(q.dueCards, q.reviewedNoteIds))
        }
        val ordered = dev.jeromeswannack.chineselearning.lab.core.Budget.sortForQueue(summaries, { s -> decks.first { it.id == s.id }.studyPriority }, { s -> decks.first { it.id == s.id }.createdAt })
        return HomeUi(
            loaded = true,
            userName = app.prefs.userName,
            due = StudyQueue.counts(all.dueCards, all.reviewedNoteIds),
            decks = ordered,
            reviewedToday = dao.reviewsSince(Js.toIsoString(dayStart)),
        )
    }

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeViewModel(app) as T
    }
}
