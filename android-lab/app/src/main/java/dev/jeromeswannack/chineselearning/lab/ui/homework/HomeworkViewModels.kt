package dev.jeromeswannack.chineselearning.lab.ui.homework

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Homework
import dev.jeromeswannack.chineselearning.lab.core.HomeworkAssignment
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
import dev.jeromeswannack.chineselearning.lab.fx.Sounds
import dev.jeromeswannack.chineselearning.lab.ui.study.sentenceRows
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** `/homework` and Home's Homework card: the mirror, as to-do / done items (web: useHomeworkItems). */
class HomeworkListViewModel(app: LabApp) : ViewModel() {
    val ui: StateFlow<HomeworkListUi> = HomeworkStore.observe(app.cache).map { data ->
        if (data == null) HomeworkListUi(loaded = true)
        else {
            val sorted = Homework.sortHomeworkItems(Homework.toHomeworkItems(data.first, data.second, Homework.localDate()))
            HomeworkListUi(true, sorted.todo, sorted.done)
        }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, HomeworkListUi())

    class Factory(private val app: LabApp) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = HomeworkListViewModel(app) as T
    }
}

/**
 * `/homework/:id` — one ONE-OFF pass (no spaced repetition). A word list: each word once,
 * "Not yet" words come back at the end until they are right; events are written locally and
 * uploaded through the outbox. A lesson / reader: the regular player, once.
 */
class HomeworkPassViewModel(private val app: LabApp, private val id: String) : ViewModel() {
    private data class Local(val revealedFor: String? = null, val busy: Boolean = false, val add: AddState = AddState.Idle, val finished: Boolean = false)

    /** The lessons / readers on this phone (package B's stores); null until read. */
    private data class Targets(val lessons: Map<String, LessonEntry>, val readers: Map<String, ReaderEntry>)

    private val local = MutableStateFlow(Local())
    private val notes = MutableStateFlow<Map<String, PassNote>?>(null)
    private val runtime by lazy { LessonRuntime.of(app) }
    private val targets: Flow<Targets?> = flow { emit(null); emitAll(combine(runtime.store.observe(), runtime.readers.observe()) { l, r -> Targets(l.associateBy { it.id }, r.associateBy { it.id }) }) }
    private var celebrated = false
    private var wasComplete: Boolean? = null

    val ui: StateFlow<PassUi> = combine(HomeworkStore.observe(app.cache), notes, local, app.online, targets) { data, notes, l, online, targets ->
        val a = data?.first?.firstOrNull { it.id == id } ?: return@combine if (data == null) PassUi.Loading else PassUi.Missing
        val progress = Homework.passProgress(Homework.passItemIds(a), data.second.filter { it.assignment_id == a.id })
        noteComplete(progress.complete)
        if (a.kind != "deck") return@combine playerUi(a, progress.complete, targets, l.finished)
        val parts = Homework.titleParts(a)
        val current = Homework.nextPassItem(progress)
        PassUi.Deck(
            title = parts.base,
            part = parts.part,
            due = Homework.dueLabel(a.due_date, Homework.localDate()),
            progress = progress,
            note = current?.let { notes?.get(it) },
            revealed = current != null && l.revealedFor == current,
            deckId = a.target_id,
            oneOffOnly = !Homework.hasFsrs(a.mode),
            addState = l.add,
            online = online,
            busy = l.busy,
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, PassUi.Loading)

    init {
        viewModelScope.launch {
            combine(HomeworkStore.assignments(app.cache), app.repo.dataVersion) { list, _ -> list?.firstOrNull { it.id == id } }.collect { a ->
                if (a == null || a.kind != "deck") return@collect
                val ids = Homework.passItemIds(a)
                notes.value = withContext(Dispatchers.IO) {
                    app.repo.dao.notes(ids).associate { n ->
                        // The study card's rows: the card's own sentence, then the generated set.
                        val rows = sentenceRows(n, app.repo.dao.sentencesFor(n.id))
                        n.id to PassNote(n.id, n.hanzi, n.pinyin, n.english, n.audioUrl, rows, n.deckId)
                    }
                }
            }
        }
    }

    /** Fanfare once, when the last word goes right in this sitting (not when opening a finished pass). */
    private fun noteComplete(complete: Boolean) {
        val before = wasComplete
        wasComplete = complete
        if (complete && before == false && !celebrated) {
            celebrated = true
            app.haptics.celebrate()
            app.sounds.play(Sounds.Sfx.FANFARE)
        }
    }

    private fun current(): PassUi.Deck? = ui.value as? PassUi.Deck

    /** Lesson / reader (web: LessonPass / ReaderPass): the local copy to play, or none (→ Missing). */
    private fun playerUi(a: HomeworkAssignment, complete: Boolean, targets: Targets?, finished: Boolean): PassUi.Player {
        val title = a.title.ifEmpty { if (a.kind == "reader") "Reader" else "Mini lesson" }
        val now = System.currentTimeMillis()
        val lesson = targets?.lessons?.get(a.target_id)?.takeIf { a.kind == "lesson" }?.let {
            PassLesson(it.id, it.lesson.title, it.lesson.icon, it.lesson.spec, CardScheduler.intervalPreviews(it.state, now))
        }
        val reader = targets?.readers?.get(a.target_id)?.takeIf { a.kind == "reader" }?.let {
            SessionReader(it.reader, CardScheduler.intervalPreviews(it.state, now), key = 1)
        }
        return PassUi.Player(a.kind, title, complete, loaded = targets != null, lesson = lesson, reader = reader, finished = finished)
    }

    /**
     * `completeCustomLesson` from the pass: the rated completion with its attempt and
     * recordings (queued like a session's), which also records the homework `done`; then
     * uploaded straight away when online.
     */
    fun completeLesson(result: LessonResult) {
        val lessonId = (ui.value as? PassUi.Player)?.lesson?.id ?: return
        viewModelScope.launch {
            runCatching { runtime.store.complete(lessonId, result.correct, result.total, result.rating, result.attempt, result.recordings) }
            local.value = local.value.copy(finished = true)
            runtime.uploadSoon()
        }
    }

    /** `recordReaderReview` from the pass (also records the homework `done`). */
    fun rateReader(rating: Int, timeSpentMs: Long) {
        val readerId = (ui.value as? PassUi.Player)?.reader?.reader?.id ?: return
        viewModelScope.launch {
            runCatching { runtime.readers.rate(readerId, rating, timeSpentMs) }
            local.value = local.value.copy(finished = true)
            runtime.uploadSoon()
        }
    }

    fun reveal() {
        val d = current() ?: return
        val note = d.note ?: return
        app.haptics.flip()
        app.sounds.play(Sounds.Sfx.FLIP, 0.5f)
        local.value = local.value.copy(revealedFor = note.id)
        app.audio.play(note.audioUrl, note.hanzi, app.online.value)
    }

    fun play() {
        val note = current()?.note ?: return
        app.audio.play(note.audioUrl, note.hanzi, app.online.value)
    }

    /** ▶ on an example sentence: its clip, else the device voice. Nothing is recorded. */
    fun playSentence(key: String?, text: String) = app.audio.play(key, text, app.online.value)

    fun answer(right: Boolean) {
        val d = current() ?: return
        val note = d.note ?: return
        if (local.value.busy) return
        if (right) { app.haptics.correct(); app.sounds.play(Sounds.Sfx.CORRECT) } else { app.haptics.wrong(); app.sounds.play(Sounds.Sfx.AGAIN, 0.6f) }
        local.value = local.value.copy(busy = true)
        viewModelScope.launch {
            try {
                HomeworkStore.recordPassEvent(app, id, note.id, if (right) "right" else "wrong")
            } finally {
                local.value = local.value.copy(busy = false, revealedFor = null)
            }
        }
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
        /** shared/decks DEFAULT_DECK_SETTINGS: 3 new + 6 secondary a day. */
        val DEFAULT_CAPS = DeckCapsBody(new_cards_per_day = 3, secondary_cards_per_day = 6)
    }
}
