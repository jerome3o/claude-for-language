package dev.jeromeswannack.chineselearning.lab.ui.study

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import dev.jeromeswannack.chineselearning.lab.data.noteHanzi
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
class StudyViewModel(
    private val app: LabApp,
    private val deckId: String?,
    /** The tutor-notes practice: just these cards, a rating counts only when the card is due. */
    private val practice: PracticeSpec? = null,
) : ViewModel() {
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

    // ---- Package B: mini lessons and today's reader after the cards (ui/lessons/StudyExtras.kt) ----
    private val extras = dev.jeromeswannack.chineselearning.lab.ui.lessons.StudyExtras(app, deckId)
    private val todayData = dev.jeromeswannack.chineselearning.lab.ui.today.TodayData(app)

    /**
     * Lab "today split": Continue was pressed on the "Flashcards done" pause — lessons and the
     * reader are shown now. Until then the session is flashcards only (no lesson every 8
     * reviews); a new load (next visit, another day) starts with the cards again.
     */
    private var extrasMode = false

    private fun todayLeft() = TodayLeft(extras.remainingLessons, extras.readerLeft)

    /** Shows what [StudyExtras.next] picked: a card, a lesson, or nothing. */
    private suspend fun presentNext(item: dev.jeromeswannack.chineselearning.lab.core.SessionItem?) {
        if (practice == null && !extrasMode && (item is dev.jeromeswannack.chineselearning.lab.core.SessionItem.Lesson || item is dev.jeromeswannack.chineselearning.lab.core.SessionItem.Reader)) {
            // The cards come first: a learning card still due today that fell out of the queue
            // is shown before the pause, so "Flashcards done" really means done.
            findDelayedLearningCard()?.let { queue.add(it); return present(it) }
            return showExtrasBreak()
        }
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

    private fun nextItem(lastRatedCardId: String?) =
        extras.next(queue, reviewedNoteIds, recentNoteIds, lastRatedCardId, System.currentTimeMillis(), cutoff, random)

    /** "Flashcards done ✓ — 2 mini lessons and today's story left · Continue / Later" (celebrates the cards once a day). */
    private fun showExtrasBreak() {
        val wasBreak = _ui.value.phase is StudyPhase.Extras
        val left = todayLeft()
        _ui.update { it.copy(phase = StudyPhase.Extras(left.lessons, left.reader, extras.titles()), counts = StudyQueue.counts(queue, reviewedNoteIds), todayLeft = left) }
        dayStore.clearResumePoint()
        if (!wasBreak || _ui.value.today == null) celebrate()
    }

    /** Continue on the pause: the leftover lessons, then today's story (the usual order). */
    fun continueToExtras() {
        if (busy || _ui.value.phase !is StudyPhase.Extras) return
        extrasMode = true
        _ui.update { it.copy(today = null) } // the Done screen works today's numbers out again
        app.haptics.tick()
        viewModelScope.launch { presentNext(nextItem(null)) }
    }

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
            _ui.update { it.copy(todayLeft = todayLeft()) }
            var next = nextItem(null)
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
            _ui.update { it.copy(todayLeft = todayLeft()) }
            var next = nextItem(null)
            if (next == null) next = findDelayedLearningCard()?.also { queue.add(it) }?.let { dev.jeromeswannack.chineselearning.lab.core.SessionItem.Card(it) }
            presentNext(next)
            busy = false
        }
    }

    /** Today's reader finished generating mid-session: if the session had run dry, show it now. */
    private fun onReaderArrived() {
        _ui.update { it.copy(todayLeft = todayLeft()) }
        val phase = _ui.value.phase
        if ((phase is StudyPhase.Done || phase is StudyPhase.Extras) && !busy) viewModelScope.launch { presentNext(nextItem(null)) }
    }
    // ---- end Package B ----

    init {
        viewModelScope.launch { app.online.collect { online -> _ui.update { it.copy(online = online) }; onConnectivity() } }
        viewModelScope.launch { studyPrefs.forcedOffline.collect { f -> _ui.update { it.copy(forcedOffline = f) }; onConnectivity() } }
        viewModelScope.launch { app.noteAudio.statuses.collect { onAudioStatus() } }
        viewModelScope.launch { app.noteAudio.updates.collect(::onAudioMade) }
        viewModelScope.launch {
            val none = withContext(Dispatchers.IO) { repo.dao.reviewsSince("0000") == 0 }
            _ui.update { it.copy(showExplainer = none && !studyPrefs.explainerSeen) }
        }
        viewModelScope.launch { load(resetRecent = true) }
    }

    private val aiAvailable get() = _ui.value.aiAvailable

    private fun today() = LocalDate.now(zone).toString()
    private val scopeKey get() = deckId ?: "all"

    // ---- the tutor-notes practice (/tutor-notes/practice; web TutorNotesPracticePage) ----
    private var practiceQueue: List<String> = emptyList()
    private val practiceCards = HashMap<String, QueueCard>()
    private var pinnedNotes: List<TutorNote> = emptyList()

    private suspend fun loadPractice(spec: PracticeSpec) {
        cutoff = StudyQueue.cutoff(System.currentTimeMillis(), zone)
        val (cards, pinned) = withContext(Dispatchers.IO) {
            deckNames = repo.dao.decks().associate { it.id to it.name }
            val wanted = spec.cardIds.toHashSet()
            val cards = repo.dao.cards().filter { it.id in wanted }.map { it.toQueueCard() }
            val ids = spec.noteIds.toHashSet()
            val list = TutorNotes.list(app.cache) { null }
            cards to (list.fresh + list.earlier).filter { it.id in ids }.map(TutorNotes::asCardNote)
        }
        cards.forEach { practiceCards[it.id] = it }
        practiceQueue = spec.cardIds.filter { it in practiceCards }
        pinnedNotes = pinned
        queue = practiceQueue.mapNotNull { practiceCards[it] }.toMutableList()
        reviewedNoteIds = HashSet()
        _ui.update { it.copy(practice = PracticeUi()) }
        present(practiceQueue.firstOrNull()?.let { practiceCards[it] })
    }

    /** Does rating [card] now write a review? Only when it is due today (core TutorNotesRules). */
    private fun practiceCounts(card: QueueCard): Boolean =
        dev.jeromeswannack.chineselearning.lab.core.TutorNotesRules.practiceRatingCounts(card.queue, card.state.dueTimestamp, StudyQueue.cutoff(System.currentTimeMillis(), zone).ts)

    private fun ratePractice(card: QueueCard, rating: Int, timeSpentMs: Long, userAnswer: String?, stats: SessionStats) {
        val counts = practiceCounts(card)
        _ui.update { u -> u.copy(stats = stats, lastRating = rating, practice = u.practice?.let { p -> if (counts) p.copy(counted = p.counted + 1) else p.copy(practiceOnly = p.practiceOnly + 1) }) }
        viewModelScope.launch {
            if (recorder.recording) { takeJob?.cancel(); keepNewTake() }
            if (counts) {
                val (eventId, updated) = repo.recordReview(card.id, rating, timeSpentMs, userAnswer)
                queueTake(eventId)
                updated?.toQueueCard()?.let { practiceCards[it.id] = it }
            } else {
                // Practice only: nothing is written — no review event, no recording kept.
                take?.delete()
                take = null
            }
            practiceQueue = dev.jeromeswannack.chineselearning.lab.core.TutorNotesRules.practiceAfterRating(practiceQueue, card.id, rating)
            queue = practiceQueue.mapNotNull { practiceCards[it] }.toMutableList()
            val next = practiceQueue.firstOrNull()?.let { practiceCards[it] }
            present(next) // the end of the practice celebrates in present(null)
            busy = false
            if (counts) schedulePush()
        }
    }
    /** A card left the queue (orphaned / its note deleted): the next practice card, or the session's next item. */
    private suspend fun presentAfterRemoval() {
        if (practice == null) return presentNext(nextItem(null))
        practiceQueue = practiceQueue.filter { id -> queue.any { it.id == id } }
        present(practiceQueue.firstOrNull()?.let { practiceCards[it] })
    }
    // ---- end practice ----

    private suspend fun load(resetRecent: Boolean) {
        practice?.let { loadPractice(it); return }
        val now = System.currentTimeMillis()
        cutoff = StudyQueue.cutoff(now, zone)
        val bonus = app.prefs.bonus(scopeKey, today())
        val built = withContext(Dispatchers.IO) {
            val decks = repo.dao.decks()
            deckNames = decks.associate { it.id to it.name }
            val cards = repo.dao.cards().map { it.toQueueCard() }
            val first = repo.dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
            val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(now, zone))
            StudyQueue.build(decks.map { it.toQueueDeck() }, cards, app.prefs.budget, bonus, introduced, cutoff, deckId, repo.dao.noteHanzi(), longTerm = repo.dao.noteLongTerm())
        }
        queue = built.dueCards.toMutableList()
        reviewedNoteIds = built.reviewedNoteIds.toMutableSet()
        if (resetRecent) recentNoteIds = emptyList()
        loadedDay = today()
        extrasMode = false // every visit starts with the cards (Lab today split)
        _ui.update { it.copy(hasMoreNew = built.hasMoreNew, bonus = bonus, deckName = deckId?.let { id -> deckNames[id] }, today = null) }
        extras.load(cutoff, queue.map { it.noteId }.distinct(), viewModelScope, ::onReaderArrived) // Package B
        _ui.update { it.copy(todayLeft = todayLeft()) }
        // The card left on screen (even by a process that's gone) comes back first, as it was.
        if (!resumeChecked && practice == null) {
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
        val now = System.currentTimeMillis()
        leftAt = now
        dayStore.pause()
        // The time spent on the card so far travels with it; time away won't count.
        currentView()?.let { v -> setViewStart(v.presentation, ((if (progressPresentation == v.presentation) progress else null) ?: v.start).copy(elapsedMs = (now - shownAt).coerceAtLeast(0))) }
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
                _ui.value.phase is StudyPhase.Done || _ui.value.phase is StudyPhase.Extras -> load(resetRecent = true)
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
            StudyQueue.build(decks.map { it.toQueueDeck() }, cards, app.prefs.budget, bonus, introduced, cutoff, deckId, repo.dao.noteHanzi(), longTerm = repo.dao.noteLongTerm())
        }
        queue = built.dueCards.toMutableList()
        reviewedNoteIds = built.reviewedNoteIds.toMutableSet()
        // Lessons / the story may have been done from Home meanwhile (Lab today split).
        if (_ui.value.phase is StudyPhase.Showing) extras.reload()
        _ui.update { it.copy(hasMoreNew = built.hasMoreNew, counts = StudyQueue.counts(queue, reviewedNoteIds), todayLeft = todayLeft()) }
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
        val p = CardStartState(flipped = revealed, answer = answer, mcSlots = mcSlots, showClue = v.start.showClue, elapsedMs = v.start.elapsedMs)
        progress = p
        progressPresentation = presentation
        if (answer.isNotEmpty()) onInteraction() // typing is activity too
        // The card carries how it stands, so when Study is composed again (back from the coach,
        // Home) the card starts from it at once — its own state isn't kept while it's away.
        setViewStart(presentation, p)
        saveResumePoint()
    }

    private fun setViewStart(presentation: Int, start: CardStartState) {
        _ui.update { u ->
            val v = (u.phase as? StudyPhase.Showing)?.view
            if (v?.presentation != presentation || v.start == start) u else u.copy(phase = StudyPhase.Showing(v.copy(start = start)))
        }
    }

    private fun saveResumePoint() {
        if (practice != null) return // the practice isn't today's queue: nothing to resume
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
            if (practice == null) dayStore.clearResumePoint()
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
            presentAfterRemoval()
            return
        }
        if (recorder.recording) recorder.stop()?.delete()
        take?.delete()
        take = null
        dropLive()
        _ui.update { it.copy(phase = StudyPhase.Showing(view), counts = StudyQueue.counts(queue, reviewedNoteIds), extras = CardExtras(), practice = it.practice?.copy(counts = practiceCounts(card))) }
        playWhenMade = null
        onAudioStatus()
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
            val unseen = TutorNotes.forCard(app.cache, view.card.id, view.note.id)
            // Practising from the notes page: the tutor's note stays on the back even though it was seen.
            val pinned = pinnedNotes.filter { n -> (if (n.kind == "recording") n.cardId == view.card.id else n.noteId == view.note.id) && unseen.none { it.id == n.id } }
            val notes = unseen + pinned
            updateExtras(view) { it.copy(tutorNotes = notes, flagTutors = CardExtrasLogic.humanTutors(rel), roleplayRelId = CardExtrasLogic.claudeRelationshipId(rel)) }
            setUpMc(view)
            // Auto-audio: a missing or 404ing clip is made now (queued while offline).
            app.noteAudio.checkCard(view.note)
            if (!aiAvailable) return@launch
            if (view.card.cardType == dev.jeromeswannack.chineselearning.lab.core.CardTypes.HANZI_TO_MEANING) liveKeys.prefetch(viewModelScope)
            runCatching { tools.voices(view.note.id) }.getOrNull()?.let { v -> updateExtras(view) { it.copy(voices = v) } }
            // Nothing cached but online: the set may exist server-side and not have synced yet.
            if (view.sentences.isEmpty()) runCatching { tools.fetchSetIfMissing(view.note.id) }.getOrNull()?.let { showSentences(view.note.id, it) }
            backgroundFill(view.note)
        }
    }

    /**
     * The web's StudyCard effects: a missing fun fact / example sentence is written in the
     * background — once per note, online only. (A missing clip is [NoteAudioFixer]'s: checkCard.)
     */
    private suspend fun backgroundFill(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity) {
        if (!backgroundFilled.add(note.id)) return
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
        // A new sentence (or a changed word) may need its clip.
        if (currentView()?.note?.id == note.id && app.noteAudio.missing(note).isNotEmpty()) app.noteAudio.checkCard(note)
        onAudioStatus()
    }

    // ---------------- auto-audio (data/audio/NoteAudioFixer) ----------------

    /** The presentation whose word clip should play as soon as it is made (it would have auto-played / was tapped). */
    private var playWhenMade: Int? = null

    /** The Play buttons' state for the card on screen. */
    private fun onAudioStatus() {
        val v = currentView()
        val audio = if (v == null) CardAudio() else CardAudioRules.of(app.noteAudio.missing(v.note), app.noteAudio.statuses.value[v.note.id], aiAvailable)
        val prev = _ui.value.cardAudio
        if (audio != prev) _ui.update { it.copy(cardAudio = audio) }
        // Couldn't be made: whatever was waiting to play gets the device voice instead.
        if (v != null && audio.word == ClipState.FAILED && prev.word != ClipState.FAILED && playWhenMade == v.presentation) {
            playWhenMade = null
            play(null, v.note.hanzi)
        }
    }

    /** New clips arrived for [note]: show them, and play the word if the card was waiting to. */
    private fun onAudioMade(note: dev.jeromeswannack.chineselearning.lab.data.NoteEntity) {
        val v = currentView() ?: return
        if (v.note.id != note.id) return
        showNote(note)
        if (playWhenMade == v.presentation && _ui.value.cardAudio.word == ClipState.READY && !note.audioUrl.isNullOrBlank()) {
            playWhenMade = null
            if (_ui.value.extras.voices.isEmpty()) play(note.audioUrl, note.hanzi)
        }
    }

    /** Back online (or forced offline switched off) with the card waiting for its clips: make them now. */
    private fun onConnectivity() {
        onAudioStatus()
        val v = currentView() ?: return
        if (aiAvailable && app.noteAudio.missing(v.note).isNotEmpty()) app.noteAudio.checkCard(v.note)
    }

    /** "Couldn't make audio — retry": no backoff wait; the word plays when it arrives. */
    fun retryAudio() {
        val v = currentView() ?: return
        app.haptics.tick()
        if (ClipState.FAILED == _ui.value.cardAudio.word) playWhenMade = v.presentation
        viewModelScope.launch { app.noteAudio.ensure(v.note.id, manual = true) }
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
        if (voices.isEmpty() && _ui.value.cardAudio.word == ClipState.GENERATING) {
            // Being made right now: play it the moment it arrives (auto-play, or the tap asked for it).
            playWhenMade = v.presentation
            if (advance) app.haptics.tick()
            return
        }
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
            presentAfterRemoval()
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

    /**
     * "Record your pronunciation" (front) / "Record again" (back; the permission was granted by
     * the card). Record again keeps the previous take and its "You said" until the new take is
     * saved: Stop replaces it, Cancel ([cancelRecording]) brings it back untouched.
     */
    fun startRecording(skipDelay: Boolean = false) {
        val v = currentView() ?: return
        val again = _ui.value.extras.take.hasTake
        if (!again) {
            take?.delete()
            take = null
            takeGeneration++
        }
        dropLive()
        app.audio.stop()
        val live = liveKeys.usable()?.takeIf { aiAvailable }?.let { runCatching { SonioxStream(repo.api.http, it) }.getOrNull() }
        val started = when {
            live != null && recorder.startLive { buf, n -> live.send(buf, n) } -> { liveStream = live; true }
            else -> { live?.abort(); recorder.start() }
        }
        if (!started) {
            updateExtras(v) { it.copy(notice = "Couldn't open the microphone.", take = if (again) it.take else TakeUi()) }
            return
        }
        app.haptics.tick()
        updateTake(v) { if (again) it.copy(recording = true, starting = !skipDelay) else TakeUi(recording = true, starting = !skipDelay) }
        takeJob?.cancel()
        if (!skipDelay) takeJob = viewModelScope.launch { delay(500); updateTake(v) { it.copy(starting = false) } }
    }

    /** Stop: keep the take and transcribe it straight away (it shows on the back). */
    fun stopRecording(@Suppress("UNUSED_PARAMETER") flipped: Boolean) {
        val v = currentView() ?: return
        takeJob?.cancel()
        val fresh = keepNewTake()
        liveResult = liveStream?.takeIf { fresh }?.let { s -> viewModelScope.async { s.finish() } }
        if (!fresh) liveStream?.abort()
        liveStream = null
        app.haptics.tick()
        if (!fresh) return updateTake(v) { it.copy(recording = false, starting = false) }
        updateTake(v) { TakeUi(hasTake = take != null) }
        transcribe(v)
    }

    /**
     * Stop the recorder and keep what it made: the new take replaces the previous one (deleted)
     * and older transcriptions no longer land. Nothing came out → the previous take stays.
     */
    private fun keepNewTake(): Boolean {
        val fresh = recorder.stop() ?: return false
        if (take != fresh) take?.delete()
        take = fresh
        takeGeneration++
        return true
    }

    /**
     * Cancel a "Record again" (back gesture / Cancel on the question side): the new take is
     * thrown away and the previous one — its file and its "You said" — is back as it was.
     */
    fun cancelRecording() {
        val v = currentView() ?: return
        if (!recorder.recording) return
        takeJob?.cancel()
        recorder.stop()?.delete()
        liveStream?.abort()
        liveStream = null
        updateTake(v) { it.copy(recording = false, starting = false, hasTake = take != null) }
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
     * uploaded (Whisper → Soniox async → Gemini on the server, told why live gave nothing);
     * compared in pinyin here; offline says so; both failing shows "tap to retry".
     */
    private fun transcribe(v: CardView, useLive: Boolean = true) {
        val file = take ?: return
        val live = liveResult.takeIf { useLive }
        if (!aiAvailable && live == null) return updateTake(v) { it.copy(transcription = TranscriptionUi.Offline) }
        val gen = takeGeneration
        val mime = recorder.mime
        updateTake(v) { it.copy(transcription = TranscriptionUi.Working) }
        viewModelScope.launch {
            val started = System.currentTimeMillis()
            val outcome = TakeTranscription.outcome(
                live = live,
                online = { aiAvailable },
                compare = { text -> Transcription.compare(text, v.note.hanzi) },
                upload = { liveError -> repo.api.transcribe(file, mime, liveError).text },
            )
            outcome.liveError?.let { reason ->
                android.util.Log.w("transcribe", "live gave nothing, uploaded instead: $reason")
                // A refused key would fail every take until it expires: mint a fresh one.
                if (SonioxProtocol.invalidatesKey(reason)) liveKeys.invalidate()
            }
            android.util.Log.i("transcribe", "${outcome.via ?: "no result"} after ${System.currentTimeMillis() - started} ms")
            if (gen == takeGeneration) updateTake(v) { it.copy(transcription = outcome.ui) }
        }
    }

    /** "Couldn't transcribe — tap to retry": the same saved take, straight to the upload path. */
    fun retryTranscription() {
        val v = currentView() ?: return
        if (take == null || _ui.value.extras.take.transcription == TranscriptionUi.Working) return
        transcribe(v, useLive = false)
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

        if (practice != null) return ratePractice(card, rating, timeSpentMs, userAnswer, stats)

        val snapshotQueue = queue.toList()
        val snapshotReviewed = reviewedNoteIds.toSet()
        val snapshotRecent = recentNoteIds
        _ui.update { it.copy(stats = stats, lastRating = rating) }

        viewModelScope.launch {
            if (recorder.recording) { takeJob?.cancel(); keepNewTake() }
            val (eventId, updated) = repo.recordReview(card.id, rating, timeSpentMs, userAnswer)
            queueTake(eventId)
            undo = UndoSnapshot(eventId, card, snapshotQueue, snapshotReviewed, snapshotRecent, before)
            queue.removeAll { it.id == card.id }
            val next = updated?.toQueueCard()
            if (next != null && CardQueue.isLearning(next.queue)) queue.add(next)
            reviewedNoteIds.add(card.noteId)
            recentNoteIds = recentNoteIds.takeLast(4) + card.noteId
            _ui.update { it.copy(canUndo = true) }

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
        if (practice != null) {
            // The tutor-notes practice is its own little finish: celebrated whenever something was rated.
            if (_ui.value.stats.reviews > 0) { app.sounds.play(Sounds.Sfx.FANFARE, 0.8f); app.haptics.celebrate() }
            return
        }
        viewModelScope.launch {
            val dayStart = StudyQueue.startOfDay(System.currentTimeMillis(), zone)
            val summary = withContext(Dispatchers.IO) { repo.dao.reviewSummarySince(Js.toIsoString(dayStart)) }
            val celebrate = dayStore.claimCelebration(summary.reviews, queueEmpty = true)
            if (celebrate) {
                app.sounds.play(Sounds.Sfx.FANFARE, 0.8f)
                app.haptics.celebrate()
            }
            // Lab today split: the lessons / story done today, and — the session over with
            // everything done — the second, smaller celebration (once a day; never on top of the first).
            val snap = if (deckId == null) runCatching { todayData.snapshot() }.getOrNull() else null
            val lessonsDone = snap?.lessons?.done?.size ?: 0
            val readerDone = snap?.reader == dev.jeromeswannack.chineselearning.lab.core.TodayPlan.Reader.Done
            val finished = _ui.value.phase is StudyPhase.Done && snap != null && snap.lessons.toDo.isEmpty() && snap.readerEntry == null
            val allClear = finished && (lessonsDone > 0 || readerDone) && dayStore.claimAllClear() && !celebrate
            if (allClear) {
                app.sounds.play(Sounds.Sfx.MILESTONE, 0.7f)
                app.haptics.correct()
            }
            _ui.update { it.copy(today = TodaySummary(dayStore.activeToday(), summary.reviews, summary.correct, celebrate, lessonsDone, readerDone, allClear)) }
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

    class Factory(private val app: LabApp, private val deckId: String?, private val practice: PracticeSpec? = null) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = StudyViewModel(app, deckId, practice) as T
    }
}
