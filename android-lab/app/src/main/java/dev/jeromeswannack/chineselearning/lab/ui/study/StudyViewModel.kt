package dev.jeromeswannack.chineselearning.lab.ui.study

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.AnswerKey
import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.QueueCard
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.time.LocalDate
import java.time.ZoneId
import kotlin.random.Random

/**
 * The study session — the native twin of frontend/src/hooks/useStudySession.ts.
 * Queue rules live in core/StudyQueue (pure, unit-tested); this class owns the
 * in-memory queue, the local writes and the feedback effects.
 */
class StudyViewModel(private val app: LabApp, private val deckId: String?) : ViewModel() {
    private val repo = app.repo
    private val zone = ZoneId.systemDefault()
    private val random = Random.Default

    private val _ui = MutableStateFlow(StudyUi())
    val ui: StateFlow<StudyUi> = _ui.asStateFlow()

    private var queue: MutableList<QueueCard> = ArrayList()
    private var reviewedNoteIds: MutableSet<String> = HashSet()
    private var recentNoteIds: List<String> = emptyList()
    private var presentation = 0
    private var cutoff = StudyCutoff(0)
    private var deckNames: Map<String, String> = emptyMap()
    private var pushJob: Job? = null
    /** A rating is being written; ignore double taps until the next card is up. */
    private var busy = false

    private data class UndoSnapshot(
        val eventId: String,
        val card: QueueCard,
        val queue: List<QueueCard>,
        val reviewed: Set<String>,
        val recent: List<String>,
        val stats: SessionStats,
    )
    private var undo: UndoSnapshot? = null

    init {
        viewModelScope.launch { app.online.collect { online -> _ui.update { it.copy(online = online) } } }
        viewModelScope.launch { load(resetRecent = true) }
    }

    private fun today() = LocalDate.now(zone).toString()
    private val scopeKey get() = deckId ?: "all"

    private suspend fun load(resetRecent: Boolean) {
        val now = System.currentTimeMillis()
        cutoff = StudyQueue.cutoff(now, zone)
        val bonus = app.prefs.bonus(scopeKey, today())
        val built = withContext(Dispatchers.IO) {
            val decks = repo.dao.decks()
            deckNames = decks.associate { it.id to it.name }
            val cards = repo.dao.cards().map { it.toQueueCard() }
            val first = repo.dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
            val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
            StudyQueue.build(decks.map { it.toQueueDeck() }, cards, app.prefs.budget, bonus, introduced, cutoff, deckId)
        }
        queue = built.dueCards.toMutableList()
        reviewedNoteIds = built.reviewedNoteIds.toMutableSet()
        if (resetRecent) recentNoteIds = emptyList()
        _ui.update { it.copy(hasMoreNew = built.hasMoreNew, bonus = bonus, deckName = deckId?.let { id -> deckNames[id] }) }
        present(StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, null, now, cutoff, random))
    }

    private suspend fun present(card: QueueCard?) {
        if (card == null) {
            _ui.update { it.copy(phase = StudyPhase.Done, counts = StudyQueue.counts(queue, reviewedNoteIds)) }
            return
        }
        val view = withContext(Dispatchers.IO) {
            val note = repo.dao.note(card.noteId)
            val sentences = repo.dao.sentencesFor(card.noteId)
            val alternatives = note?.alternatives?.let {
                runCatching { repo.api.json.decodeFromString(ListSerializer(String.serializer()), it) }.getOrDefault(emptyList())
            }.orEmpty()
            note?.let {
                CardView(
                    card = card,
                    note = it,
                    sentences = sentences,
                    previews = CardScheduler.intervalPreviews(card.state, System.currentTimeMillis()),
                    alternatives = alternatives,
                    presentation = ++presentation,
                    deckName = deckNames[card.deckId],
                )
            }
        }
        if (view == null) {
            // Orphaned card (note deleted on another device): drop it and move on.
            queue.removeAll { it.id == card.id }
            present(StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, null, System.currentTimeMillis(), cutoff, random))
            return
        }
        _ui.update { it.copy(phase = StudyPhase.Showing(view), counts = StudyQueue.counts(queue, reviewedNoteIds)) }
    }

    /** Typed answer checked (or the answer revealed): feedback only, nothing recorded yet. */
    fun onRevealed(verdict: AnswerKey.Verdict?) {
        when {
            verdict == null -> { app.sounds.play(Sounds.Sfx.FLIP, 0.5f); app.haptics.flip() }
            AnswerKey.isAccepted(verdict) -> { app.sounds.play(Sounds.Sfx.CORRECT); app.haptics.correct() }
            else -> { app.sounds.play(Sounds.Sfx.WRONG, 0.6f); app.haptics.wrong() }
        }
    }

    fun rate(rating: Int, timeSpentMs: Long, userAnswer: String?) {
        val showing = (_ui.value.phase as? StudyPhase.Showing)?.view ?: return
        if (busy) return
        busy = true
        val card = showing.card
        val before = _ui.value.stats
        val correct = rating >= 2
        val streak = if (correct) before.streak + 1 else 0
        val againByNote = if (rating == 0) before.againByNote + (card.noteId to ((before.againByNote[card.noteId] ?: 0) + 1)) else before.againByNote
        val stats = before.copy(
            reviews = before.reviews + 1,
            correct = before.correct + if (correct) 1 else 0,
            streak = streak,
            bestStreak = maxOf(before.bestStreak, streak),
            againCount = before.againCount + if (rating == 0) 1 else 0,
            againByNote = againByNote,
            leeches = againByNote.filterValues { it >= 2 }.keys.toList(),
        )

        // Feedback first — it must feel instant.
        app.haptics.rated(rating)
        when {
            rating == 0 -> app.sounds.play(Sounds.Sfx.AGAIN, 0.5f)
            correct -> app.sounds.streakPop(streak)
            else -> app.sounds.play(Sounds.Sfx.TAP, 0.6f)
        }
        if (correct && streak in MILESTONES) {
            app.sounds.play(Sounds.Sfx.MILESTONE)
            app.haptics.milestone()
        }

        val snapshotQueue = queue.toList()
        val snapshotReviewed = reviewedNoteIds.toSet()
        val snapshotRecent = recentNoteIds
        _ui.update { it.copy(stats = stats, lastRating = rating) }

        viewModelScope.launch {
            val (eventId, updated) = repo.recordReview(card.id, rating, timeSpentMs, userAnswer)
            undo = UndoSnapshot(eventId, card, snapshotQueue, snapshotReviewed, snapshotRecent, before)
            queue.removeAll { it.id == card.id }
            val next = updated?.toQueueCard()
            if (next != null && CardQueue.isLearning(next.queue)) queue.add(next)
            reviewedNoteIds.add(card.noteId)
            recentNoteIds = recentNoteIds.takeLast(4) + card.noteId
            _ui.update { it.copy(canUndo = true) }

            val now = System.currentTimeMillis()
            var chosen = StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, card.id, now, cutoff, random)
            if (chosen == null) chosen = findDelayedLearningCard()?.also { queue.add(it) }
            present(chosen)
            busy = false
            if (chosen == null) celebrate()
            schedulePush()
        }
    }

    /** `findDelayedLearningCard`: a learning card due before the cutoff that isn't queued. */
    private suspend fun findDelayedLearningCard(): QueueCard? = withContext(Dispatchers.IO) {
        val queued = queue.mapTo(HashSet()) { it.id }
        repo.dao.cards().asSequence()
            .map { it.toQueueCard() }
            .filter { (deckId == null || it.deckId == deckId) && it.id !in queued && CardQueue.isLearning(it.queue) }
            .filter { it.state.dueTimestamp == null || it.state.dueTimestamp!! <= cutoff.ts }
            .minByOrNull { it.state.dueTimestamp ?: 0L }
    }

    private fun celebrate() {
        if (_ui.value.stats.reviews == 0) return
        app.sounds.play(Sounds.Sfx.FANFARE, 0.8f)
        app.haptics.celebrate()
    }

    /** Push reviews shortly after rating; a WorkManager job covers the offline case. */
    private fun schedulePush() {
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(2500)
            if (app.online.value) repo.pushEvents()
            if (repo.dao.unsyncedCount() > 0) app.scheduleBackgroundUpload()
        }
    }

    fun undoLast() {
        val snap = undo ?: return
        if (busy) return
        undo = null
        viewModelScope.launch {
            val restored = repo.undoReview(snap.eventId)?.toQueueCard() ?: snap.card
            queue = snap.queue.map { if (it.id == restored.id) restored else it }.toMutableList()
            if (queue.none { it.id == restored.id }) queue.add(restored)
            reviewedNoteIds = snap.reviewed.toMutableSet()
            recentNoteIds = snap.recent
            _ui.update { it.copy(stats = snap.stats, canUndo = false, lastRating = null) }
            app.haptics.tick()
            present(restored)
        }
    }

    fun studyMore() {
        val bonus = app.prefs.bonus(scopeKey, today()) + StudyQueue.BONUS_INCREMENT
        app.prefs.setBonus(scopeKey, today(), bonus)
        _ui.update { it.copy(phase = StudyPhase.Loading) }
        viewModelScope.launch { load(resetRecent = true) }
    }

    fun play(key: String?, text: String) = app.audio.play(key, text, app.online.value)

    override fun onCleared() {
        app.audio.stop()
        app.scope.launch { if (app.online.value) repo.pushEvents() }
        if (_ui.value.stats.reviews > 0) app.scheduleBackgroundUpload()
    }

    class Factory(private val app: LabApp, private val deckId: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudyViewModel(app, deckId) as T
    }

    private companion object {
        val MILESTONES = setOf(5, 10, 20, 30, 50, 75, 100)
    }
}
