package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
import dev.jeromeswannack.chineselearning.lab.core.RetryBars
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonEntry
import dev.jeromeswannack.chineselearning.lab.data.lessons.LessonRuntime
import dev.jeromeswannack.chineselearning.lab.data.readers.ReaderEntry
import dev.jeromeswannack.chineselearning.lab.ui.lessons.LessonResult
import dev.jeromeswannack.chineselearning.lab.ui.readers.SessionReader
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import dev.jeromeswannack.chineselearning.lab.data.api.DeckCapsBody
import dev.jeromeswannack.chineselearning.lab.data.api.setDeckCaps
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.data.homework.LongTermStore
import dev.jeromeswannack.chineselearning.lab.core.LongTerm
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.study.sentenceRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/homework` and Home's Homework card: the mirror, as to-do / done items (web: useHomeworkItems). */
class HomeworkListViewModel(app: LabApp) : ViewModel() {
    /** Home's card rows: its lesson rows (revisions due + new tutor-sent lessons) are listed here too. */
    private val card: Flow<HomeHomeworkUi> =
        HomeHomeworkSource(app).card
            .catch { e -> android.util.Log.e("Homework", "lesson rows failed", e); emit(HomeHomeworkUi()) }
            .onStart { emit(HomeHomeworkUi()) }

    val ui: StateFlow<HomeworkListUi> = combine(HomeworkStore.observe(app.cache), card) { data, c ->
        if (data == null) HomeworkListUi(loaded = true, lessons = c.lessonRows, runBars = c.runBars)
        else {
            val today = Homework.localDate()
            val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(data.first, data.second, today))
            HomeworkListUi(true, sorted.todo, sorted.done, today, c.lessonRows, sorted.skipped, c.runBars)
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, HomeworkListUi())

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeworkListViewModel(app) as T
    }
}

/**
 * `/homework/:id` — one ONE-OFF pass (no spaced repetition). A word list: each word once, on the
 * STUDY CARD (the route hands [PassUi.Deck] to StudyRoute's pass mode — the read card's 🎤 take,
 * "You said", Show answer, the back), "Not yet" words come back at the end until they are right;
 * events are written locally and uploaded through the outbox. Nothing is a review event. A
 * lesson / reader: the regular player, once.
 */
class HomeworkPassViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private data class Local(
        val busy: Boolean = false,
        val add: AddState = AddState.Idle,
        val finished: Boolean = false,
        /** Link homework: "Mark as done" in flight / done in this sitting. */
        val linkBusy: Boolean = false,
        val linkJustDone: Boolean = false,
    )

    /** The lessons / readers on this phone (package B's stores); null until read. */
    private data class Targets(val lessons: Map<String, LessonEntry>, val readers: Map<String, ReaderEntry>)

    private val local = MutableStateFlow(Local())
    private val notes = MutableStateFlow<Map<String, PassNote>?>(null)
    /** "⚡ Study it today": the notes in today's pocket on this phone → who bumped them (null = the learner). */
    private val bumped = MutableStateFlow<Map<String, String?>>(emptyMap())
    /** The deck copy's own long-term default (null until read): false for a 0 + 0 one-off copy. */
    @Volatile private var deckInReview: Boolean? = null
    private val runtime by lazy { LessonRuntime.of(app) }
    private val targets: Flow<Targets?> = flow { emit(null); emitAll(combine(runtime.store.observe(), runtime.readers.observe()) { l, r -> Targets(l.associateBy { it.id }, r.associateBy { it.id }) }) }
    private var celebrated = false
    /** homework.pass_start recorded for this visit. */
    private var startTracked = false
    private var wasComplete: Boolean? = null

    val ui: StateFlow<PassUi> = combine(HomeworkStore.observe(app.cache), notes, combine(local, bumped) { l, b -> l to b }, app.online, targets) { data, notes, lb, online, targets ->
        val (l, bumpedNotes) = lb
        val a = data?.first?.firstOrNull { it.id == id } ?: return@combine if (data == null) PassUi.Loading else PassUi.Missing
        val passEvents = data.second.filter { it.assignment_id == a.id }
        val progress = Homework.passProgress(Homework.passItemIds(a), passEvents)
        val items = Homework.passItemIds(a).size
        if (!startTracked) {
            startTracked = true
            app.analytics.track("homework.pass_start", mapOf("kind" to a.kind, "items" to items))
        }
        noteComplete(progress.complete, a.kind, items)
        if (a.kind == "link") return@combine linkUi(a, progress.complete, data.second, l)
        if (a.kind != "deck") return@combine playerUi(a, progress.complete, targets, l.finished)
        val parts = Homework.titleParts(a)
        val current = Homework.nextPassItem(progress)
        val attempt = current?.let { c -> data.second.count { it.assignment_id == a.id && it.item_id == c } } ?: 0
        // ↺: the last live Got it / Not yet can be taken back (docs/HOMEWORK.md §3b).
        val canUndo = !l.busy && Homework.lastPassAnswer(data.second.filter { it.assignment_id == a.id }) != null
        PassUi.Deck(
            title = parts.base,
            part = parts.part,
            due = Homework.dueLabel(a.due_date, Homework.localDate()),
            progress = progress,
            bar = RetryBars.passRetryBar(Homework.passItemIds(a), passEvents),
            note = current?.let { notes?.get(it) },
            attempt = attempt,
            assignmentId = a.id,
            bumped = current != null && current in bumpedNotes,
            bumpedBy = current?.let { bumpedNotes[it] },
            deckId = a.target_id,
            oneOffOnly = !Homework.hasFsrs(a.mode),
            addState = l.add,
            online = online,
            busy = l.busy,
            canUndo = canUndo,
            deckInReview = deckInReview ?: Homework.hasFsrs(a.mode),
            longTermSummary = notes?.let { n ->
                LongTerm.summary(Homework.passItemIds(a).map { id -> LongTerm.Word(n[id]?.longTerm, n[id]?.started == true) }, deckInReview ?: Homework.hasFsrs(a.mode))
            },
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, PassUi.Loading)

    init {
        // The ⚡ pocket as this phone has it (refreshed by every sync and every toggle).
        viewModelScope.launch { app.repo.dataVersion.collect { refreshBumps() } }
        viewModelScope.launch {
            combine(HomeworkStore.assignments(app.cache), app.repo.dataVersion) { list, _ -> list?.firstOrNull { it.id == id } }.collect { a ->
                if (a == null || a.kind != "deck") return@collect
                val ids = Homework.passItemIds(a)
                notes.value = withContext(Dispatchers.IO) {
                    val dao = app.repo.dao
                    deckInReview = dao.decks().firstOrNull { it.id == a.target_id }?.let { d ->
                        LongTerm.deckInDailyReview(d.newCardsPerDay, d.secondaryCardsPerDay ?: StudyQueue.DEFAULT_SECONDARY_CAP)
                    }
                    val started = ids.chunked(500).flatMap { dao.startedNoteIds(it) }.toHashSet()
                    dao.notes(ids).associate { n ->
                        // The study card's rows: the card's own sentence, then the generated set.
                        val rows = sentenceRows(n, dao.sentencesFor(n.id))
                        n.id to PassNote(n.id, n.hanzi, n.pinyin, n.english, n.audioUrl, rows, n.deckId, n.longTerm, n.id in started)
                    }
                }
            }
        }
    }

    /** Fanfare once, when the last word goes right in this sitting (not when opening a finished pass). */
    private fun noteComplete(complete: Boolean, kind: String, items: Int) {
        val before = wasComplete
        wasComplete = complete
        if (complete && before == false && !celebrated) {
            celebrated = true
            app.analytics.track("homework.pass_done", mapOf("kind" to kind, "items" to items))
            app.haptics.celebrate()
            app.sounds.play(Sounds.Sfx.FANFARE)
        }
    }

    private fun current(): PassUi.Deck? = ui.value as? PassUi.Deck

    /** Lesson / reader (web: LessonPass / ReaderPass): the local copy to play, or none (→ Missing). */
    private fun playerUi(a: HomeworkAssignment, complete: Boolean, targets: Targets?, finished: Boolean): PassUi.Player {
        val title = a.title.ifEmpty { if (a.kind == "reader") "Reader" else "Mini lesson" }
        val lesson = targets?.lessons?.get(a.target_id)?.takeIf { a.kind == "lesson" }?.let {
            PassLesson(it.id, it.lesson.title, it.lesson.icon, it.lesson.spec)
        }
        val reader = targets?.readers?.get(a.target_id)?.takeIf { a.kind == "reader" }?.let {
            SessionReader(it.reader, key = 1)
        }
        return PassUi.Player(a.kind, title, complete, loaded = targets != null, lesson = lesson, reader = reader, finished = finished)
    }

    /** Link homework (web: LinkPass): the assignment's snapshot of the link + whether it is done (and the note sent). */
    private fun linkUi(a: HomeworkAssignment, complete: Boolean, events: List<dev.jeromeswannack.chineselearning.lab.core.HomeworkEvent>, l: Local): PassUi.Link {
        val done = a.status == "done" || complete
        val note = events.filter { it.assignment_id == a.id && it.result == "done" && !it.note.isNullOrBlank() }.maxByOrNull { it.created_at }?.note
        val url = a.details?.url?.takeIf { it.isNotBlank() }
        return PassUi.Link(
            LinkPassUi(
                title = a.title.ifEmpty { "Link" },
                url = url,
                instructions = a.details?.instructions,
                thumbnailUrl = a.details?.thumbnail_url ?: url?.let { dev.jeromeswannack.chineselearning.lab.core.HomeworkLinks.linkThumbnail(it) },
                due = Homework.dueLabel(a.due_date, Homework.localDate()),
                tutorName = a.tutor_name,
                done = done,
                note = note,
                busy = l.linkBusy,
                justDone = l.linkJustDone,
            ),
        )
    }

    /** "Mark as done" on link homework: a `done` event with the optional note, written locally and uploaded through the outbox. */
    fun markLinkDone(note: String?) {
        val a = (ui.value as? PassUi.Link) ?: return
        if (a.link.done || local.value.linkBusy) return
        viewModelScope.launch {
            local.value = local.value.copy(linkBusy = true)
            val assignment = app.cache.get<List<HomeworkAssignment>>(dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkKeys.ASSIGNMENTS)?.firstOrNull { it.id == id }
            if (assignment != null) {
                runCatching { HomeworkStore.recordPassEvent(app, id, assignment.target_id, "done", note = note) }
            }
            local.value = local.value.copy(linkBusy = false, linkJustDone = assignment != null)
        }
    }

    /** The tap on "Open link ↗" (the route starts the browser). */
    fun linkOpened() {
        app.haptics.tick()
    }

    /** Finished in this pass's player (its Done then shows the pass's end). */
    private var lessonCompletedHere = false

    /**
     * `completeCustomLesson` from the pass: the completion with its attempt, outcome and recordings,
     * which also records the homework `done` (the outcome decides: all right first time → done
     * forever, else a revision in a week); then uploaded straight away when online.
     */
    fun completeLesson(result: LessonResult) {
        val lessonId = (ui.value as? PassUi.Player)?.lesson?.id ?: return
        lessonCompletedHere = true
        viewModelScope.launch {
            runCatching { runtime.store.complete(lessonId, result.correct, result.total, result.attempt, result.recordings, result.outcome, source = "homework") }
            runtime.uploadSoon()
        }
    }

    /** The player's Done / ✕: the pass's end when the lesson was finished here, else [close]. */
    fun lessonEnded(close: () -> Unit) {
        if (lessonCompletedHere) local.value = local.value.copy(finished = true) else close()
    }

    /** `recordReaderFinish` from the pass (also records the homework `done`). */
    fun finishReader(timeSpentMs: Long, how: String = "finish") {
        val readerId = (ui.value as? PassUi.Player)?.reader?.reader?.id ?: return
        viewModelScope.launch {
            runCatching { runtime.readers.finish(readerId, timeSpentMs, how) }
            local.value = local.value.copy(finished = true)
            runtime.uploadSoon()
        }
    }

    fun play() {
        val note = current()?.note ?: return
        app.audio.play(note.audioUrl, note.hanzi, app.online.value)
    }

    /** ▶ on an example sentence: its clip, else the device voice. Nothing is recorded. */
    fun playSentence(key: String?, text: String) = app.audio.play(key, text, app.online.value)

    /**
     * Not yet / Got it on the study card: the pass's event (never a review). [answered] / [suggested]
     * are the card's (analytics: how it was tried, what the answer side suggested, whether he followed it).
     */
    fun answer(right: Boolean, answered: String = "none", suggested: String? = null) {
        val d = current() ?: return
        val note = d.note ?: return
        if (local.value.busy) return
        if (right) { app.haptics.correct(); app.sounds.play(Sounds.Sfx.CORRECT) } else { app.haptics.wrong(); app.sounds.play(Sounds.Sfx.AGAIN, 0.6f) }
        local.value = local.value.copy(busy = true)
        app.analytics.track("homework.pass_item", mapOf(
            "result" to if (right) "right" else "wrong",
            "card_type" to Homework.PASS_CARD_TYPE,
            "answered" to answered,
            "suggested" to (suggested ?: "none"),
            "followed" to (suggested != null && (suggested == "right") == right),
        ))
        viewModelScope.launch {
            try {
                HomeworkStore.recordPassEvent(app, id, note.id, if (right) "right" else "wrong")
            } finally {
                local.value = local.value.copy(busy = false)
            }
        }
    }

    /**
     * ↺ Undo (web DeckPass `undo`, docs/HOMEWORK.md §3b): takes back the last Got it / Not yet with an
     * `undo` event, one further back each time; the word comes back as it was before the answer (a
     * fresh card — its attempt count moves on), and a pass the undone Got it finished is open again.
     * The long-term switch and ⚡ are separate actions and stay as they are.
     */
    fun undo() {
        val d = current() ?: return
        if (local.value.busy || !d.canUndo) return
        val wasComplete = d.progress.complete
        local.value = local.value.copy(busy = true)
        app.haptics.tick()
        viewModelScope.launch {
            try {
                val undone = HomeworkStore.recordPassUndo(app, id)
                if (undone != null) app.analytics.track("homework.pass_undo", mapOf("result" to undone.result, "reopened" to wasComplete))
            } finally {
                local.value = local.value.copy(busy = false)
            }
        }
    }

    /**
     * ⚡ Study it today on the answer side (shared/decks/bumps.ts, data/bumps/BumpStore.kt): on puts
     * this word first in today's study — its NEW cards too, past the budget, even from a one-off
     * copy (the pocket is outside the pools) — off takes it out of the pocket. Offline-first.
     */
    fun setBump(on: Boolean) {
        val note = current()?.note ?: return
        app.haptics.tick()
        // Optimistic: the toggle moves now; the pocket read back confirms it.
        bumped.value = if (on) bumped.value + (note.id to null) else bumped.value - note.id
        viewModelScope.launch {
            runCatching {
                if (on) dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.bumpNotes(app, listOf(note.id), SOURCE_BUMP)
                else dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.clear(app, note.id, SOURCE_BUMP)
            }
            refreshBumps()
        }
    }

    private suspend fun refreshBumps() {
        bumped.value = withContext(Dispatchers.IO) {
            runCatching {
                val dao = app.repo.dao
                // The rows in the pocket (pending clears left out) — the web BumpButton's `useBumps`.
                dev.jeromeswannack.chineselearning.lab.data.bumps.BumpStore.active(dao).associate { it.noteId to it.bumpedByName }
            }.getOrDefault(bumped.value)
        }
    }

    /**
     * The answer side's "Add to my long-term review" switch: stored on the note at once (the queue
     * follows, offline too) and sent through the Outbox (LongTermStore). Back to the deck's own
     * default stores null.
     */
    fun setLongTerm(on: Boolean) {
        val d = current() ?: return
        val note = d.note ?: return
        if (note.started) return
        app.haptics.tick()
        val pref = LongTerm.prefForToggle(on, d.deckInReview)
        // Optimistic: the switch moves now; the reload after notifyLocalChange confirms it.
        notes.value = notes.value?.let { m -> m + (note.id to note.copy(longTerm = pref)) }
        viewModelScope.launch { runCatching { LongTermStore.set(app, note.id, pref) } }
    }

    /** One-off-only deck: caps back to the new-deck defaults (3 + 6) so the daily budget introduces it. */
    fun addToDaily() {
        val d = current() ?: return
        local.value = local.value.copy(add = AddState.Busy)
        viewModelScope.launch {
            val ok = runCatching {
                app.repo.api.setDeckCaps(d.deckId, DEFAULT_CAPS)
                withContext(Dispatchers.IO) {
                    app.repo.dao.decks().firstOrNull { it.id == d.deckId }?.let {
                        app.repo.dao.upsertDecks(listOf(it.copy(newCardsPerDay = DEFAULT_CAPS.new_cards_per_day, secondaryCardsPerDay = DEFAULT_CAPS.secondary_cards_per_day)))
                    }
                }
            }.isSuccess
            local.value = local.value.copy(add = if (ok) AddState.Done else AddState.Error)
            if (ok) { app.haptics.correct(); app.scope.launch { app.repo.sync() } }
        }
    }

    fun retrySync() {
        app.scope.launch { app.repo.sync() }
    }

    class Factory(private val app: LabApp, private val id: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeworkPassViewModel(app, id) as T
    }

    companion object {
        /** The bump's source (analytics + the API), shared/decks/bumps.ts BUMP_SOURCES. */
        const val SOURCE_BUMP = "homework_pass"

        /** shared/decks DEFAULT_DECK_SETTINGS: 3 new + 6 secondary a day. */
        val DEFAULT_CAPS = DeckCapsBody(new_cards_per_day = 3, secondary_cards_per_day = 6)
    }
}
