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

    val tools = CardTools(app)
    private val studyPrefs = StudyPrefs.get(app)
    /** Notes whose missing fun fact / sentence / clip were already requested this session. */
    private val backgroundFilled = HashSet<String>()
    private var extrasJob: Job? = null

    init {
        viewModelScope.launch { app.online.collect { online -> _ui.update { it.copy(online = online) } } }
        viewModelScope.launch { studyPrefs.forcedOffline.collect { f -> _ui.update { it.copy(forcedOffline = f) } } }
        viewModelScope.launch {
            val none = withContext(Dispatchers.IO) { repo.dao.reviewsSince("0000") == 0 }
            _ui.update { it.copy(showExplainer = none && !studyPrefs.explainerSeen) }
        }
        viewModelScope.launch { load(resetRecent = true) }
    }

    private val aiAvailable get() = _ui.value.aiAvailable

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
                    audioCached = it.audioUrl.isNullOrBlank() || repo.cachedAudio(it.audioUrl) != null,
                )
            }
        }
        if (view == null) {
            // Orphaned card (note deleted on another device): drop it and move on.
            queue.removeAll { it.id == card.id }
            present(StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, null, System.currentTimeMillis(), cutoff, random))
            return
        }
        _ui.update { it.copy(phase = StudyPhase.Showing(view), counts = StudyQueue.counts(queue, reviewedNoteIds), extras = CardExtras()) }
        loadExtras(view)
    }

    // ---------------- the card's extras ----------------

    /** Tutor notes, tutors, the note's voices, and the background fills the web does on each card. */
    private fun loadExtras(view: CardView) {
        extrasJob?.cancel()
        extrasJob = viewModelScope.launch {
            val rel = app.cache.get<dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto>(dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys.RELATIONSHIPS)
            val notes = TutorNotes.forCard(app.cache, view.card.id, view.note.id)
            updateExtras(view) { it.copy(tutorNotes = notes, flagTutors = CardExtrasLogic.humanTutors(rel), roleplayRelId = CardExtrasLogic.claudeRelationshipId(rel)) }
            if (!aiAvailable) return@launch
            runCatching { tools.voices(view.note.id) }.getOrNull()?.let { v -> updateExtras(view) { it.copy(voices = v) } }
            backgroundFill(view.note)
        }
    }

    /**
     * The web's StudyCard effects: a note with no clip gets one generated, and a missing fun
     * fact / example sentence is written in the background — once per note, online only.
     */
    private suspend fun backgroundFill(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity) {
        if (!backgroundFilled.add(note.id)) return
        if (note.audioUrl.isNullOrBlank()) runCatching { tools.generateAudio(note.id) }.getOrNull()?.let(::showNote)
        if (note.funFacts.isNullOrBlank()) runCatching { tools.generateFunFact(note.id) }.getOrNull()?.let(::showNote)
        if (note.sentenceClue.isNullOrBlank()) runCatching { tools.generateSentenceClue(note.id) }.getOrNull()?.let(::showNote)
    }

    private fun updateExtras(view: CardView, change: (CardExtras) -> CardExtras) {
        _ui.update { u ->
            val showing = (u.phase as? StudyPhase.Showing)?.view
            if (showing?.presentation != view.presentation) u else u.copy(extras = change(u.extras))
        }
    }

    private fun currentView(): CardView? = (_ui.value.phase as? StudyPhase.Showing)?.view

    /** A changed note (mirrored into Room by CardTools) shows on the current card at once. */
    private fun showNote(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity) {
        _ui.update { u ->
            val showing = (u.phase as? StudyPhase.Showing)?.view
            if (showing == null || showing.note.id != note.id) u
            else u.copy(phase = StudyPhase.Showing(showing.copy(note = note, alternatives = parseAlternatives(note.alternatives))))
        }
    }

    private fun showSentences(noteId: String, rows: List<dev.jeromeswannack.chineselearning.lab.data.SentenceEntity>) {
        _ui.update { u ->
            val showing = (u.phase as? StudyPhase.Showing)?.view
            if (showing == null || showing.note.id != noteId) u else u.copy(phase = StudyPhase.Showing(showing.copy(sentences = rows)))
        }
    }

    private fun parseAlternatives(json: String?): List<String> =
        json?.let { runCatching { repo.api.json.decodeFromString(ListSerializer(String.serializer()), it) }.getOrDefault(emptyList()) }.orEmpty()

    /** Runs a ⋯ item with its busy flag; a failure becomes the card's inline notice. */
    private fun busy(which: CardBusy, block: suspend (CardView) -> Unit) {
        val view = currentView() ?: return
        if (which in _ui.value.extras.busy) return
        updateExtras(view) { it.copy(busy = it.busy + which, notice = null) }
        viewModelScope.launch {
            try {
                block(view)
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                updateExtras(view) { it.copy(notice = CardTools.message(e)) }
                app.haptics.wrong()
            } finally {
                updateExtras(view) { it.copy(busy = it.busy - which) }
            }
        }
    }

    fun generateFunFact() = busy(CardBusy.FUN_FACT) { v -> tools.generateFunFact(v.note.id)?.let(::showNote); app.haptics.correct() }

    fun regenerateAudio() = busy(CardBusy.REGEN_AUDIO) { v ->
        tools.regenerateAudio(v.note.id)?.let { n -> showNote(n); play(n.audioUrl, n.hanzi) }
    }

    fun newVoice() = busy(CardBusy.NEW_VOICE) { v ->
        val clip = tools.newVoice(v.note.id)
        val voices = runCatching { tools.voices(v.note.id) }.getOrDefault(_ui.value.extras.voices + clip)
        updateExtras(v) { it.copy(voices = voices, voiceIndex = voices.indexOf(clip).coerceAtLeast(0)) }
        play(clip, v.note.hanzi)
    }

    /** "Use in sentence" with no sentence yet, or ↻ on the shown one. */
    fun generateSentenceClue(onDone: () -> Unit = {}) = busy(CardBusy.SENTENCE_CLUE) { v ->
        tools.generateSentenceClue(v.note.id)?.let(::showNote)
        onDone()
    }

    fun roleplay(onOpen: (String) -> Unit) = busy(CardBusy.ROLEPLAY) { v ->
        val rel = _ui.value.extras.roleplayRelId ?: return@busy
        onOpen(tools.roleplay(rel, v.note))
    }

    /** Play on the card: the note's recordings in turn (primary first), else its own clip. */
    fun playWord(advance: Boolean) {
        val v = currentView() ?: return
        val voices = _ui.value.extras.voices
        if (voices.isEmpty()) return play(v.note.audioUrl, v.note.hanzi)
        val index = if (advance && voices.size > 1) (_ui.value.extras.voiceIndex + 1) % voices.size else if (advance) 0 else _ui.value.extras.voiceIndex.coerceIn(0, voices.lastIndex)
        updateExtras(v) { it.copy(voiceIndex = index) }
        play(voices[index], v.note.hanzi)
    }

    fun dismissNotice() {
        val v = currentView() ?: return
        updateExtras(v) { it.copy(notice = null) }
    }

    fun toggleForcedOffline() {
        studyPrefs.setForcedOffline(!studyPrefs.forcedOffline.value)
        app.haptics.tick()
    }

    fun dismissExplainer() {
        studyPrefs.explainerSeen = true
        _ui.update { it.copy(showExplainer = false) }
    }

    /** Edit sheet saved: mirror and show. Throws for the sheet to show the reason. */
    suspend fun saveEdit(update: dev.jeromeswannack.chineselearning.lab.data.api.NoteUpdate) {
        val v = currentView() ?: return
        tools.editNote(v.note.id, update)?.let(::showNote)
        app.haptics.correct()
    }

    /** Delete the current note (edit sheet ⋯, or Claude's delete_current_card) and move on. */
    suspend fun deleteCurrentNote(alreadyDeletedOnServer: Boolean = false) {
        val v = currentView() ?: return
        if (alreadyDeletedOnServer) tools.removeLocally(v.note.id) else tools.deleteNote(v.note.id)
        removeNoteFromSession(v.note.id)
    }

    /** `removeNoteFromSession`: every card of the note leaves the queue; the next one comes up. */
    fun removeNoteFromSession(noteId: String) {
        viewModelScope.launch {
            queue.removeAll { it.noteId == noteId }
            undo = null
            _ui.update { it.copy(canUndo = false, lastRating = null) }
            present(StudyQueue.selectNext(queue, reviewedNoteIds, recentNoteIds, null, System.currentTimeMillis(), cutoff, random))
        }
    }

    /** Sentences for the current note changed (generated / cleared): show them. */
    fun sentencesChanged(noteId: String) {
        viewModelScope.launch { showSentences(noteId, withContext(Dispatchers.IO) { repo.dao.sentencesFor(noteId) }) }
    }

    // ---------------- Ask Claude ----------------

    private fun updateAsk(view: CardView, change: (AskUi) -> AskUi) = updateExtras(view) { it.copy(ask = change(it.ask)) }

    /**
     * `handleAskClaude` / `sendQuickQuestion`: the typed answer rides along on typing cards,
     * the conversation so far is the history; tool results wait for Approve.
     */
    fun ask(question: String, withHistory: Boolean, userAnswer: String?) {
        val v = currentView() ?: return
        val q = question.trim()
        if (q.isEmpty() || _ui.value.extras.ask.asking) return
        updateAsk(v) { it.copy(asking = true, pendingQuestion = q, error = null) }
        viewModelScope.launch {
            val typing = v.card.cardType != dev.jeromeswannack.chineselearning.lab.core.CardTypes.HANZI_TO_MEANING
            val context = if (typing && !userAnswer.isNullOrEmpty()) dev.jeromeswannack.chineselearning.lab.data.api.AskContext(userAnswer, v.note.hanzi, v.card.cardType) else null
            val history = if (withHistory) _ui.value.extras.ask.conversation.map { dev.jeromeswannack.chineselearning.lab.data.api.AskHistoryItem(it.question, it.answer) } else null
            try {
                val answer = tools.ask(v.note.id, dev.jeromeswannack.chineselearning.lab.data.api.AskBody(q, context, history))
                updateAsk(v) { it.copy(conversation = it.conversation + answer, asking = false, pendingQuestion = null, pending = answer.toolResults?.takeIf { r -> r.isNotEmpty() }) }
                app.haptics.tick()
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                updateAsk(v) { it.copy(asking = false, pendingQuestion = null, error = CardExtrasLogic.describeAskError(e, aiAvailable)) }
            }
        }
    }

    /** `approveToolResults`: apply Claude's changes here (the server already made them). */
    fun approveTools() {
        val v = currentView() ?: return
        val pending = _ui.value.extras.ask.pending ?: return
        updateAsk(v) { it.copy(pending = null) }
        viewModelScope.launch {
            for (result in pending) {
                if (!result.success) continue
                when (result.tool) {
                    "edit_current_card" -> result.data?.get("note")?.let { el ->
                        runCatching { repo.api.json.decodeFromJsonElement(dev.jeromeswannack.chineselearning.lab.data.api.StudyNoteDto.serializer(), el) }.getOrNull()
                            ?.let { dto -> tools.mirror(dto.copy(id = v.note.id))?.let(::showNote) }
                    }
                    "delete_current_card" -> {
                        updateAsk(v) { it.copy(cardDeleted = true) }
                        tools.removeLocally(v.note.id)
                        delay(2000)
                        removeNoteFromSession(v.note.id)
                    }
                    "create_flashcards", "create_custom_lesson" -> tools.syncSoon()
                }
            }
            app.haptics.correct()
        }
    }

    fun rejectTools() {
        val v = currentView() ?: return
        updateAsk(v) { it.copy(pending = null) }
    }

    /** Decks for "+ make a card from this message" (the web's deck buttons). */
    suspend fun deckChoices(): List<Pair<String, String>> = withContext(Dispatchers.IO) { repo.dao.decks().map { it.id to it.name } }

    /** Flag sheet → queue / send. */
    suspend fun flag(tutor: FlagTutor, message: String): Boolean {
        val v = currentView() ?: return false
        return tools.flag(tutor, v.note.id, v.card.id, message).also { app.haptics.correct() }
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
        // The tutor's note was on screen for this review — show it once only.
        val seenNotes = _ui.value.extras.tutorNotes.map { it.id }
        if (seenNotes.isNotEmpty()) app.scope.launch { TutorNotes.markSeen(app.cache, app.outbox, seenNotes) }
        // Failing a card: start its sentence set so it is ready when the card comes back.
        if (rating == 0) app.scope.launch { tools.ensureSentenceSet(card.noteId) }
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

    fun play(key: String?, text: String) = app.audio.play(key, text, aiAvailable)

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
