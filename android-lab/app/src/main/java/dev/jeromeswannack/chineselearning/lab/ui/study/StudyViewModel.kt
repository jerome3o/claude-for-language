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
import dev.jeromeswannack.chineselearning.lab.data.api.generateMultipleChoice
import dev.jeromeswannack.chineselearning.lab.data.api.studyNote
import dev.jeromeswannack.chineselearning.lab.data.api.transcribe
import dev.jeromeswannack.chineselearning.lab.data.api.liveTranscriptionSession
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.async
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

    // ---- Today is the session (docs/STUDY_SESSION.md) ----
    // This view model belongs to the activity: leaving Study (✕, back, the coach, Home) ends
    // nothing — the queue, the card on screen with its take, and the undo stay here.
    private val dayStore = dev.jeromeswannack.chineselearning.lab.data.study.StudyDayStore.get(app)
    private val scope = dev.jeromeswannack.chineselearning.lab.core.StudyResume.scope(deckId)
    /** The local date the queue was built for: a new day rebuilds it on return. */
    private var loadedDay = ""
    /** The saved resume point is looked at once per day (the first load). */
    private var resumeChecked = false
    /** When the card on screen came up (moved forward on return by the time spent away). */
    private var shownAt = 0L
    /** Set while Study is left (the time away doesn't count on the card). */
    private var leftAt: Long? = null
    /** The card on screen as it stands — what a return shows again. */
    private var progress: CardStartState? = null
    private var progressPresentation = -1

    val tools = CardTools(app)
    private val studyPrefs = StudyPrefs.get(app)
    /** Notes whose missing fun fact / sentence / clip were already requested this session. */
    private val backgroundFilled = HashSet<String>()
    private var extrasJob: Job? = null

    // ---- Package B: mini lessons mixed into the cards (ui/lessons/StudyExtras.kt) ----
    private val extras = dev.jeromeswannack.chineselearning.lab.ui.lessons.StudyExtras(app, deckId)

    /** Shows what [StudyExtras.next] picked: a card, a lesson, or nothing. */
    private suspend fun presentNext(item: dev.jeromeswannack.chineselearning.lab.core.SessionItem?) {
        when (item) {
            is dev.jeromeswannack.chineselearning.lab.core.SessionItem.Lesson -> {
                val lesson = extras.present(item.lesson) ?: return present(null)
                _ui.update { it.copy(phase = StudyPhase.Lesson(lesson), counts = StudyQueue.counts(queue, reviewedNoteIds)) }
            }
            is dev.jeromeswannack.chineselearning.lab.core.SessionItem.Reader -> {
                val reader = extras.presentReader(item.reader) ?: return present(null)
                _ui.update { it.copy(phase = StudyPhase.Reader(reader), counts = StudyQueue.counts(queue, reviewedNoteIds)) }
            }
            is dev.jeromeswannack.chineselearning.lab.core.SessionItem.Card -> present(item.card)
            else -> present(null)
        }
    }

    private fun nextItem(lastRatedCardId: String?, breakAllowed: Boolean = true) =
        extras.next(queue, reviewedNoteIds, recentNoteIds, lastRatedCardId, System.currentTimeMillis(), cutoff, random, breakAllowed)

    /** A finished mini lesson was rated: record it, count it in the session, move on. */
    fun completeLesson(result: dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult) {
        val lesson = (_ui.value.phase as? StudyPhase.Lesson)?.lesson ?: return
        if (busy) return
        busy = true
        val before = _ui.value.stats
        val correct = result.rating >= 2
        _ui.update {
            it.copy(lastRating = result.rating, stats = before.copy(
                reviews = before.reviews + 1, correct = before.correct + if (correct) 1 else 0,
                againCount = before.againCount + if (result.rating == 0) 1 else 0,
            ))
        }
        app.haptics.rated(result.rating)
        viewModelScope.launch {
            extras.complete(lesson, result)
            var next = nextItem(null, breakAllowed = false)
            if (next == null) next = findDelayedLearningCard()?.also { queue.add(it) }?.let { dev.jeromeswannack.chineselearning.lab.core.SessionItem.Card(it) }
            presentNext(next)
            busy = false
        }
    }
    /** The last page of today's reader was rated: record it, count it, move on. */
    fun rateReader(rating: Int, timeSpentMs: Long) {
        val reader = (_ui.value.phase as? StudyPhase.Reader)?.reader ?: return
        if (busy) return
        busy = true
        undo = null
        val before = _ui.value.stats
        val correct = rating >= 2
        _ui.update {
            it.copy(lastRating = rating, canUndo = false, stats = before.copy(
                reviews = before.reviews + 1, correct = before.correct + if (correct) 1 else 0,
                againCount = before.againCount + if (rating == 0) 1 else 0,
            ))
        }
        app.haptics.rated(rating)
        viewModelScope.launch {
            extras.rateReader(reader.reader.id, rating, timeSpentMs)
            var next = nextItem(null)
            if (next == null) next = findDelayedLearningCard()?.also { queue.add(it) }?.let { dev.jeromeswannack.chineselearning.lab.core.SessionItem.Card(it) }
            presentNext(next)
            busy = false
        }
    }

    /** Today's reader finished generating mid-session: if the session had run dry, show it now. */
    private fun onReaderArrived() {
        if (_ui.value.phase is StudyPhase.Done && !busy) viewModelScope.launch { presentNext(nextItem(null)) }
    }
    // ---- end Package B ----

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
        loadedDay = today()
        _ui.update { it.copy(hasMoreNew = built.hasMoreNew, bonus = bonus, deckName = deckId?.let { id -> deckNames[id] }, today = null) }
        extras.load(cutoff, queue.map { it.noteId }.distinct(), viewModelScope, ::onReaderArrived) // Package B
        // The card left on screen (even by a process that's gone) comes back first, as it was.
        if (!resumeChecked) {
            resumeChecked = true
            val point = dayStore.resumePoint()
            val id = dev.jeromeswannack.chineselearning.lab.core.StudyResume.cardId(point, today(), scope, queue.map { it.id })
            val card = id?.let { i -> queue.firstOrNull { it.id == i } }
            if (point != null && card != null) {
                present(card, CardStartState(flipped = point.revealed, answer = point.answer, elapsedMs = dev.jeromeswannack.chineselearning.lab.core.StudyResume.elapsedMs(point)))
                return
            }
        }
        presentNext(nextItem(null)) // Package B (was StudyQueue.selectNext)
    }

    // ---------------- leaving and coming back ----------------

    /** A touch / key on the study screen: active study time. */
    fun onInteraction() {
        if (leftAt == null) dayStore.interact()
    }

    fun onForeground() = onInteraction()

    /** Backgrounded / screen off: the clock stops at once. */
    fun onBackground() {
        dayStore.pause()
        saveResumePoint()
    }

    /**
     * Study left (✕, back, the coach, Home): stop the clock and the sound, keep a take that was
     * being recorded, save where the card stands (a process death keeps that too), send the reviews.
     */
    fun onLeave() {
        if (leftAt != null) return
        leftAt = System.currentTimeMillis()
        dayStore.pause()
        saveResumePoint()
        app.audio.stop()
        extras.stopAudio() // Package B
        if (recorder.recording) currentView()?.let { stopRecording(flipped = false) }
        app.scope.launch {
            if (app.online.value) {
                repo.pushEvents()
                dayStore.report(repo.api, force = true)
            }
        }
        if (_ui.value.stats.reviews > 0) app.scheduleBackgroundUpload()
    }

    /** Back in Study: same card, same state — unless the day rolled over or the card was answered elsewhere. */
    fun onReturn() {
        dayStore.interact()
        val left = leftAt ?: return
        leftAt = null
        val now = System.currentTimeMillis()
        shownAt += now - left // time away doesn't count on the card
        viewModelScope.launch {
            if (busy) return@launch
            when {
                today() != loadedDay -> { resumeChecked = false; _ui.update { it.copy(phase = StudyPhase.Loading) }; load(resetRecent = true) }
                _ui.value.phase is StudyPhase.Done -> load(resetRecent = true)
                else -> refreshKeepingCard()
            }
        }
    }

    /** Rebuilds today's queue (a sync may have changed it) and keeps the card on screen while it's still due. */
    private suspend fun refreshKeepingCard() {
        val showing = currentView()
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
        _ui.update { it.copy(hasMoreNew = built.hasMoreNew, counts = StudyQueue.counts(queue, reviewedNoteIds)) }
        if (showing == null) return // a lesson / reader stays as it is
        if (queue.none { it.id == showing.card.id }) {
            dayStore.clearResumePoint(showing.card.id)
            presentNext(nextItem(null))
            return
        }
        // Same presentation, so the card isn't re-dealt; it starts from how it was left.
        val start = (if (progressPresentation == showing.presentation) progress else null) ?: showing.start
        _ui.update { u ->
            val v = (u.phase as? StudyPhase.Showing)?.view
            if (v?.presentation != showing.presentation) u
            else u.copy(phase = StudyPhase.Showing(v.copy(start = start.copy(elapsedMs = System.currentTimeMillis() - shownAt))))
        }
    }

    /** CardStage reports how the card stands (revealed, typed answer, grid result). */
    fun onCardProgress(presentation: Int, revealed: Boolean, answer: String, mcSlots: List<MultipleChoice.Slot>?) {
        val v = currentView() ?: return
        if (v.presentation != presentation) return
        progress = CardStartState(flipped = revealed, answer = answer, mcSlots = mcSlots, showClue = v.start.showClue)
        progressPresentation = presentation
        if (answer.isNotEmpty()) onInteraction() // typing is activity too
        saveResumePoint()
    }

    private fun saveResumePoint() {
        val v = currentView() ?: return
        val p = (if (progressPresentation == v.presentation) progress else null) ?: v.start
        val end = leftAt ?: System.currentTimeMillis()
        dayStore.saveResumePoint(
            dev.jeromeswannack.chineselearning.lab.core.StudyResume.Point(today(), scope, v.card.id, p.flipped, p.answer, (end - shownAt).coerceAtLeast(0)),
        )
    }

    private suspend fun present(card: QueueCard?, start: CardStartState = CardStartState()) {
        if (card == null) {
            val wasDone = _ui.value.phase is StudyPhase.Done
            _ui.update { it.copy(phase = StudyPhase.Done, counts = StudyQueue.counts(queue, reviewedNoteIds)) }
            dayStore.clearResumePoint()
            if (!wasDone || _ui.value.today == null) celebrate()
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
                    isSecondaryNew = card.queue == 0 && card.noteId in reviewedNoteIds,
                    start = start,
                )
            }
        }
        if (view == null) {
            // Orphaned card (note deleted on another device): drop it and move on.
            queue.removeAll { it.id == card.id }
            presentNext(nextItem(null)) // Package B (was StudyQueue.selectNext)
            return
        }
        if (recorder.recording) recorder.stop()?.delete()
        take?.delete()
        take = null
        dropLive()
        _ui.update { it.copy(phase = StudyPhase.Showing(view), counts = StudyQueue.counts(queue, reviewedNoteIds), extras = CardExtras()) }
        shownAt = System.currentTimeMillis() - start.elapsedMs
        progress = null
        progressPresentation = -1
        saveResumePoint()
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
            setUpMc(view)
            if (!aiAvailable) return@launch
            if (view.card.cardType == dev.jeromeswannack.chineselearning.lab.core.CardTypes.HANZI_TO_MEANING) liveKeys.prefetch(viewModelScope)
            runCatching { tools.voices(view.note.id) }.getOrNull()?.let { v -> updateExtras(view) { it.copy(voices = v) } }
            // Nothing cached but online: the set may exist server-side and not have synced yet.
            if (view.sentences.isEmpty()) runCatching { tools.fetchSetIfMissing(view.note.id) }.getOrNull()?.let { showSentences(view.note.id, it) }
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
            presentNext(nextItem(null)) // Package B (was StudyQueue.selectNext)
        }
    }

    /** Sentences for the current note changed (generated / cleared): show them. */
    fun sentencesChanged(noteId: String) {
        viewModelScope.launch { showSentences(noteId, withContext(Dispatchers.IO) { repo.dao.sentencesFor(noteId) }) }
    }

    // ---------------- my recording ----------------

    val recorder = VoiceRecorder(app, viewModelScope)
    /** The current card's finished take (deleted when the card goes without a rating). */
    private var take: java.io.File? = null
    private var takeJob: Job? = null
    val level get() = recorder.level

    private fun updateTake(view: CardView, change: (TakeUi) -> TakeUi) = updateExtras(view) { it.copy(take = change(it.take)) }

    // Live transcription (Soniox, streamed while speaking): the key is fetched when a read
    // card shows, so Record never waits for it; without one the take is uploaded as before.
    private val liveKeys = LiveSessionCache { repo.api.liveTranscriptionSession() }
    private var liveStream: SonioxStream? = null
    private var liveResult: kotlinx.coroutines.Deferred<String>? = null
    /** Bumped by every new take so a slower, older transcription never lands on it. */
    private var takeGeneration = 0

    private fun dropLive() {
        liveStream?.abort()
        liveStream = null
        liveResult = null
    }

    /** "Record your pronunciation" / "Record again" (the permission was granted by the card). */
    fun startRecording(skipDelay: Boolean = false) {
        val v = currentView() ?: return
        take?.delete()
        take = null
        takeGeneration++
        dropLive()
        app.audio.stop()
        val live = liveKeys.usable()?.takeIf { aiAvailable }?.let { runCatching { SonioxStream(repo.api.http, it) }.getOrNull() }
        val started = when {
            live != null && recorder.startLive { buf, n -> live.send(buf, n) } -> { liveStream = live; true }
            else -> { live?.abort(); recorder.start() }
        }
        if (!started) {
            updateExtras(v) { it.copy(notice = "Couldn't open the microphone.", take = TakeUi()) }
            return
        }
        app.haptics.tick()
        updateTake(v) { TakeUi(recording = true, starting = !skipDelay) }
        takeJob?.cancel()
        if (!skipDelay) takeJob = viewModelScope.launch { delay(500); updateTake(v) { it.copy(starting = false) } }
    }

    /** Stop: keep the take and transcribe it straight away (it shows on the back). */
    fun stopRecording(@Suppress("UNUSED_PARAMETER") flipped: Boolean) {
        val v = currentView() ?: return
        takeJob?.cancel()
        take = recorder.stop()
        liveResult = liveStream?.let { s -> viewModelScope.async { s.finish() } }
        liveStream = null
        app.haptics.tick()
        updateTake(v) { TakeUi(hasTake = take != null) }
        transcribe(v)
    }

    /** "Re-record" on the front: drop the take. */
    fun clearRecording() {
        val v = currentView() ?: return
        take?.delete()
        take = null
        takeGeneration++
        dropLive()
        updateTake(v) { TakeUi() }
    }

    fun playMyRecording() { take?.let { recorder.play(it) } }

    /**
     * `useTranscription`: the live (Soniox) text when the take was streamed, else the take
     * uploaded to Whisper; compared in pinyin here; offline says so.
     */
    private fun transcribe(v: CardView) {
        val file = take ?: return
        val live = liveResult
        if (!aiAvailable && live == null) return updateTake(v) { it.copy(transcription = TranscriptionUi.Offline) }
        val gen = takeGeneration
        val mime = recorder.mime
        updateTake(v) { it.copy(transcription = TranscriptionUi.Working) }
        viewModelScope.launch {
            val started = System.currentTimeMillis()
            val liveText = live?.let { d -> runCatching { d.await() }.onFailure { android.util.Log.w("transcribe", "live failed, uploading: ${it.message}") }.getOrNull() }
                ?.takeIf { it.isNotBlank() }
            val outcome: TranscriptionUi = when {
                liveText != null -> TranscriptionUi.Done(Transcription.compare(liveText, v.note.hanzi))
                !aiAvailable -> TranscriptionUi.Offline
                else -> runCatching { repo.api.transcribe(file, mime) }
                    .fold({ r -> TranscriptionUi.Done(Transcription.compare(r.text, v.note.hanzi)) }, { TranscriptionUi.Failed })
            }
            android.util.Log.i("transcribe", "${if (liveText != null) "live (Soniox)" else "upload (Whisper)"} ready ${System.currentTimeMillis() - started} ms after stop")
            if (gen == takeGeneration) updateTake(v) { it.copy(transcription = outcome) }
        }
    }

    /** The take goes up with its review: `POST /api/audio/upload { review_id }`, queued (offline-first). */
    private suspend fun queueTake(eventId: String) {
        val file = take ?: return
        take = null
        val staged = app.outbox.stageFile("recording.${file.extension}")
        withContext(Dispatchers.IO) { if (!file.renameTo(staged)) { file.copyTo(staged, overwrite = true); file.delete() } }
        app.outbox.enqueueUpload(
            kind = "recording", path = "/api/audio/upload", file = staged,
            fileName = "recording.${file.extension}", mime = recorder.mime,
            fields = mapOf("review_id" to eventId), id = "rec-$eventId",
        )
    }

    // ---------------- multiple choice ----------------

    private fun updateMc(view: CardView, change: (McUi) -> McUi) = updateExtras(view) { it.copy(mc = change(it.mc)) }

    /** The note's cached options + pinyin-only flag (MultipleChoice.Sync / earlier generation). */
    private suspend fun mcExtra(noteId: String): MultipleChoice.NoteExtra? =
        app.cache.get<Map<String, MultipleChoice.NoteExtra>>(MultipleChoice.KEY)?.get(noteId)

    private suspend fun cacheMc(noteId: String, extra: MultipleChoice.NoteExtra) {
        val map = app.cache.get<Map<String, MultipleChoice.NoteExtra>>(MultipleChoice.KEY).orEmpty()
        app.cache.put(MultipleChoice.KEY, TutorNotes.KIND, map + (noteId to extra))
    }

    /** Called per card: auto-show MC for listen cards and pinyin-only meaning cards. */
    private suspend fun setUpMc(view: CardView) {
        val type = view.card.cardType
        if (type == dev.jeromeswannack.chineselearning.lab.core.CardTypes.HANZI_TO_MEANING) return
        val extra = mcExtra(view.note.id)
        val cached = MultipleChoice.parse(extra?.options) != null
        val isAudio = type == dev.jeromeswannack.chineselearning.lab.core.CardTypes.AUDIO_TO_HANZI
        val auto = isAudio || (extra?.pinyinOnly == true && type == dev.jeromeswannack.chineselearning.lab.core.CardTypes.MEANING_TO_HANZI)
        updateMc(view) { it.copy(cached = cached, auto = auto) }
        if (!auto) return
        // Offline with nothing cached: straight to typing, no pre-load, no spinner.
        if (!aiAvailable && !cached) return updateMc(view) { it.copy(skip = true) }
        loadMc(view, hideInitially = isAudio, fresh = false)
    }

    /**
     * `handleShowMultipleChoice`: cached options, or a generation cut at 8 s; any failure
     * falls back to typing with a one-line note. [fresh] = Regenerate.
     */
    private fun loadMc(view: CardView, hideInitially: Boolean, fresh: Boolean) {
        updateMc(view) { it.copy(loading = true, fallbackNote = null) }
        viewModelScope.launch {
            val noteId = view.note.id
            val cachedRaw = if (fresh) null else mcExtra(noteId)?.options
            val result = MultipleChoice.load(cachedRaw, aiAvailable) {
                // The server may already hold options (made on another device): use them first.
                val existing = if (fresh) null else runCatching { tools.api().studyNote(noteId) }.getOrNull()
                val raw = existing?.multiple_choice_options?.takeIf { MultipleChoice.parse(it) != null }
                    ?: tools.api().generateMultipleChoice(noteId).multiple_choice_options
                if (raw != null) cacheMc(noteId, MultipleChoice.NoteExtra(raw, mcExtra(noteId)?.pinyinOnly ?: (existing?.pinyin_only == 1)))
                raw
            }
            when (result) {
                is MultipleChoice.Load.Ready -> updateMc(view) {
                    it.copy(rows = MultipleChoice.shuffle(result.rows, random), loading = false, cached = true, ready = hideInitially, showing = !hideInitially, skip = false)
                }
                is MultipleChoice.Load.Fallen -> updateMc(view) {
                    it.copy(loading = false, skip = true, showing = false, ready = false, fallbackNote = result.reason.message)
                }
            }
        }
    }

    /** "Multiple choice" on the front of a typing card. */
    fun showMc() {
        val v = currentView() ?: return
        updateMc(v) { it.copy(skip = false) }
        loadMc(v, hideInitially = false, fresh = false)
    }

    fun regenerateMc() { currentView()?.let { loadMc(it, hideInitially = false, fresh = true) } }

    /** Listen card: "Show options". */
    fun revealMc() { currentView()?.let { v -> updateMc(v) { it.copy(ready = false, showing = true) } } }

    /** "Type instead" (grid or spinner). */
    fun typeInstead() { currentView()?.let { v -> updateMc(v) { it.copy(showing = false, ready = false, skip = true) } } }

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

    /** Sentence list ⋯ / "+ 5 more": generate for the current note and show the new set. */
    suspend fun generateSentences(count: Int, keepExisting: Boolean, customPrompt: String?) {
        val v = currentView() ?: return
        showSentences(v.note.id, tools.generateSet(v.note.id, count, customPrompt, keepExisting))
        app.haptics.correct()
    }

    suspend fun clearSentences() {
        val v = currentView() ?: return
        tools.clearSet(v.note.id)
        showSentences(v.note.id, emptyList())
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
        currentView()?.let { v ->
            if (_ui.value.extras.take.recording) stopRecording(flipped = true)
            else if (take != null && _ui.value.extras.take.transcription == null) transcribe(v)
        }
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
        // Answered: nothing to resume on this card any more.
        dayStore.clearResumePoint(card.id)
        progress = null
        // The tutor's note was on screen for this review — show it once only.
        val seenNotes = _ui.value.extras.tutorNotes.map { it.id }
        if (seenNotes.isNotEmpty()) app.scope.launch { TutorNotes.markSeen(app.cache, app.outbox, seenNotes) }
        // Failing a card: start its sentence set so it is ready when the card comes back.
        if (rating == 0) app.scope.launch { tools.ensureSentenceSet(card.noteId) }
        val correct = rating >= 2
        val againByNote = if (rating == 0) before.againByNote + (card.noteId to ((before.againByNote[card.noteId] ?: 0) + 1)) else before.againByNote
        val stats = before.copy(
            reviews = before.reviews + 1,
            correct = before.correct + if (correct) 1 else 0,
            againCount = before.againCount + if (rating == 0) 1 else 0,
            againByNote = againByNote,
            leeches = againByNote.filterValues { it >= 2 }.keys.toList(),
        )

        // Feedback first — it must feel instant. The same tap and pop for every rating:
        // an honest Again is worth exactly as much as an Easy (no streaks, no rising pitch).
        app.haptics.rated(rating)
        app.sounds.ratingPop()

        val snapshotQueue = queue.toList()
        val snapshotReviewed = reviewedNoteIds.toSet()
        val snapshotRecent = recentNoteIds
        _ui.update { it.copy(stats = stats, lastRating = rating) }

        viewModelScope.launch {
            if (recorder.recording) { takeJob?.cancel(); take = recorder.stop() }
            val (eventId, updated) = repo.recordReview(card.id, rating, timeSpentMs, userAnswer)
            queueTake(eventId)
            undo = UndoSnapshot(eventId, card, snapshotQueue, snapshotReviewed, snapshotRecent, before)
            queue.removeAll { it.id == card.id }
            val next = updated?.toQueueCard()
            if (next != null && CardQueue.isLearning(next.queue)) queue.add(next)
            reviewedNoteIds.add(card.noteId)
            recentNoteIds = recentNoteIds.takeLast(4) + card.noteId
            _ui.update { it.copy(canUndo = true) }

            extras.cardRated() // Package B
            var chosen = nextItem(card.id) // Package B (was StudyQueue.selectNext)
            if (chosen == null) chosen = findDelayedLearningCard()?.also { queue.add(it) }?.let { dev.jeromeswannack.chineselearning.lab.core.SessionItem.Card(it) }
            presentNext(chosen)
            busy = false
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

    /**
     * Today's queue ran dry: today's numbers for the All done screen, and the celebration —
     * once a day, again only when more cards became due and were cleared (core Celebration).
     */
    private fun celebrate() {
        viewModelScope.launch {
            val dayStart = StudyQueue.startOfDay(System.currentTimeMillis(), zone)
            val summary = withContext(Dispatchers.IO) { repo.dao.reviewSummarySince(Js.toIsoString(dayStart)) }
            val celebrate = dayStore.claimCelebration(summary.reviews, queueEmpty = true)
            if (celebrate) {
                app.sounds.play(Sounds.Sfx.FANFARE, 0.8f)
                app.haptics.celebrate()
            }
            _ui.update { it.copy(today = TodaySummary(dayStore.activeToday(), summary.reviews, summary.correct, celebrate)) }
            if (app.online.value) {
                dayStore.report(repo.api, force = true)
                _ui.update { u -> u.copy(today = u.today?.copy(activeMs = dayStore.activeToday())) }
            }
        }
    }

    /** Push reviews shortly after rating; a WorkManager job covers the offline case. */
    private fun schedulePush() {
        pushJob?.cancel()
        pushJob = viewModelScope.launch {
            delay(2500)
            if (app.online.value) repo.pushEvents()
            if (repo.dao.unsyncedCount() > 0 || app.outbox.pendingCount() > 0) app.scheduleBackgroundUpload()
        }
    }

    fun undoLast() {
        val snap = undo ?: return
        if (busy) return
        undo = null
        dayStore.clearResumePoint()
        viewModelScope.launch {
            // The recording tied to that review goes too (the web deletes its pendingRecording).
            app.repo.platform.dao.deleteOutbox("rec-${snap.eventId}")
            val restored = repo.undoReview(snap.eventId)?.toQueueCard() ?: snap.card
            queue = snap.queue.map { if (it.id == restored.id) restored else it }.toMutableList()
            if (queue.none { it.id == restored.id }) queue.add(restored)
            reviewedNoteIds = snap.reviewed.toMutableSet()
            recentNoteIds = snap.recent
            _ui.update { it.copy(stats = snap.stats, canUndo = false, lastRating = null, today = null) }
            app.haptics.tick()
            present(restored)
        }
    }

    fun studyMore() {
        val bonus = app.prefs.bonus(scopeKey, today()) + StudyQueue.BONUS_INCREMENT
        app.prefs.setBonus(scopeKey, today(), bonus)
        _ui.update { it.copy(phase = StudyPhase.Loading, today = null) }
        viewModelScope.launch { load(resetRecent = true) }
    }

    fun play(key: String?, text: String) = app.audio.play(key, text, aiAvailable)

    override fun onCleared() {
        app.audio.stop()
        liveStream?.abort()
        recorder.release()
        take?.delete()
        extras.stopAudio() // Package B
        app.scope.launch { if (app.online.value) repo.pushEvents() }
        if (_ui.value.stats.reviews > 0) app.scheduleBackgroundUpload()
    }

    class Factory(private val app: LabApp, private val deckId: String?) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudyViewModel(app, deckId) as T
    }
}
