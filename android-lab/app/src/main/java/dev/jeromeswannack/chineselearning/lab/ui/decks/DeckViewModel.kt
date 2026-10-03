package dev.jeromeswannack.chineselearning.lab.ui.decks

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import dev.jeromeswannack.chineselearning.lab.core.DeckSettings
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.data.api.DeckTutorShareDto
import dev.jeromeswannack.chineselearning.lab.data.api.MyRelationshipsDto
import dev.jeromeswannack.chineselearning.lab.data.api.deckTutorShares
import dev.jeromeswannack.chineselearning.lab.data.api.deckTutorSharesKey
import dev.jeromeswannack.chineselearning.lab.data.api.studentShareDeck
import dev.jeromeswannack.chineselearning.lab.data.api.tutor
import dev.jeromeswannack.chineselearning.lab.data.api.unshareStudentDeck
import dev.jeromeswannack.chineselearning.lab.data.api.userMessage
import dev.jeromeswannack.chineselearning.lab.data.homework.HomeworkStore
import dev.jeromeswannack.chineselearning.lab.ui.nav.NavKeys
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.decks.WriteOutcome
import dev.jeromeswannack.chineselearning.lab.ui.cards.NoteEditor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId

/** One word on the deck page (the web's deck-note-progress-item). */
data class NoteRowUi(
    val id: String,
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val sentenceClue: String?,
    val audioUrl: String?,
    /** card type → most recent first, up to 8. */
    val ratings: Map<String, List<Int>>,
    val mastery: Int,
)

data class DeckHeaderUi(
    val id: String,
    val name: String,
    val description: String?,
    val newPerDay: Int,
    val secondaryPerDay: Int?,
)

data class AudioJobUi(val done: Int, val total: Int, val regenerate: Boolean)

/** A tutor this deck is shared with ("Shared with Tutors"). */
data class TutorShareUi(val relationshipId: String, val name: String?, val email: String?, val sharedAt: String)

/** A tutor the student could share this deck with (the Share with Tutor sheet). */
data class TutorOptionUi(val relationshipId: String, val name: String?, val email: String?)

data class DeckUi(
    val loaded: Boolean = false,
    /** Null once loaded = the deck is gone (deleted here or on another device). */
    val deck: DeckHeaderUi? = null,
    val due: Int = 0,
    val completion: DeckStats.Completion = DeckStats.Completion(0, 0, 0, 0),
    val breakdown: Map<String, DeckStats.TypeBreakdown> = emptyMap(),
    /** Sorted by mastery, highest first (as the web). */
    val notes: List<NoteRowUi> = emptyList(),
    val isTutorAccount: Boolean = false,
    val online: Boolean = true,
    /** Selection mode (long-press a word): move / regenerate audio for many. */
    val selected: Set<String>? = null,
    val audioJob: AudioJobUi? = null,
    val notice: String? = null,
    val noticeIsError: Boolean = false,
    val settingsError: String? = null,
    val busy: Boolean = false,
    /** A live one-off homework assignment whose target is this deck (the web's OneOffDeckBanner). */
    val oneOffAssignmentId: String? = null,
    val dailyReviewBusy: Boolean = false,
    val dailyReviewError: Boolean = false,
    val tutorShares: List<TutorShareUi> = emptyList(),
    /** My tutors (relationships where the other person is my tutor). */
    val tutors: List<TutorOptionUi> = emptyList(),
    val shareBusy: Boolean = false,
    val shareError: String? = null,
) {
    /**
     * The one-off banner: a live one-off assignment AND caps 0 + 0, so the daily budget never
     * introduces the deck. A null secondary cap is the default (not 0), as the web's `?? 1`.
     */
    val oneOffBanner: String? get() = oneOffAssignmentId?.takeIf { deck?.newPerDay == 0 && deck.secondaryPerDay == 0 }
    val missingAudio: Int get() = notes.count { it.audioUrl == null }
    val withAudio: Int get() = notes.count { it.audioUrl != null }
}

/**
 * The deck page (web: DeckDetailPage.tsx), from Room so it opens instantly and offline:
 * Study (or Try it for a tutor account), progress, every word with its recent ratings and
 * mastery, add / edit / delete / move words, generate missing audio, settings, delete.
 */
class DeckViewModel(private val env: DecksEnv, private val deckId: String) : ViewModel() {
    private val _ui = MutableStateFlow(DeckUi(isTutorAccount = env.isTutorAccount()))
    val ui: StateFlow<DeckUi> = _ui
    val editor = NoteEditor(env, viewModelScope).apply { onDone = { msg -> say(msg) } }
    private var sharesFetched = false

    init {
        viewModelScope.launch { env.dataVersion.collect { refresh() } }
        viewModelScope.launch { env.online.collect { on -> _ui.update { it.copy(online = on) } } }
        viewModelScope.launch {
            HomeworkStore.assignments(env.cache).collect { list ->
                val a = list.orEmpty().firstOrNull { it.target_id == deckId && it.mode == "one_off" && it.status != "cancelled" }
                _ui.update { it.copy(oneOffAssignmentId = a?.id) }
            }
        }
        viewModelScope.launch {
            env.cache.observe<MyRelationshipsDto>(NavKeys.RELATIONSHIPS).collect { rels ->
                val tutors = rels?.tutors.orEmpty().map { r -> r.tutor().let { t -> TutorOptionUi(r.id, t?.name, t?.email) } }
                _ui.update { it.copy(tutors = tutors) }
                // Only a student with a tutor can have shared this deck: ask the server then.
                if (tutors.isNotEmpty() && !sharesFetched) { sharesFetched = true; refreshTutorShares() }
            }
        }
        viewModelScope.launch {
            env.cache.observe<List<DeckTutorShareDto>>(deckTutorSharesKey(deckId)).collect { shares ->
                _ui.update { it.copy(tutorShares = shares.orEmpty().map { d -> TutorShareUi(d.relationship_id, d.tutor.name, d.tutor.email, d.shared_at) }) }
            }
        }
    }

    // ---------------- tutor shares ----------------

    /** GET /api/decks/:id/tutor-shares into the cache (shown offline from the last answer). */
    fun refreshTutorShares() {
        if (!env.online.value || env.isTutorAccount()) return
        viewModelScope.launch {
            runCatching { env.api.deckTutorShares(deckId) }.onSuccess { env.cache.put(deckTutorSharesKey(deckId), SHARES_KIND, it) }
        }
    }

    /** The Share with Tutor sheet → POST …/student-share-deck. */
    fun shareWithTutor(relationshipId: String, onDone: () -> Unit) {
        if (!env.online.value) return _ui.update { it.copy(shareError = "You're offline — sharing needs a connection.") }
        _ui.update { it.copy(shareBusy = true, shareError = null) }
        viewModelScope.launch {
            runCatching { env.api.studentShareDeck(relationshipId, deckId) }
                .onSuccess {
                    runCatching { env.api.deckTutorShares(deckId) }.onSuccess { env.cache.put(deckTutorSharesKey(deckId), SHARES_KIND, it) }
                    env.fx.success()
                    _ui.update { it.copy(shareBusy = false) }
                    onDone()
                }
                .onFailure { e -> env.fx.failure(); _ui.update { it.copy(shareBusy = false, shareError = e.userMessage()) } }
        }
    }

    fun clearShareError() = _ui.update { it.copy(shareError = null) }

    /** "Stop sharing" → DELETE …/student-shared-decks/:deckId. */
    fun unshareTutor(relationshipId: String) {
        if (!env.online.value) return say("You're offline — try again when you're back online.", error = true)
        _ui.update { it.copy(shareBusy = true) }
        viewModelScope.launch {
            runCatching { env.api.unshareStudentDeck(relationshipId, deckId) }
                .onSuccess {
                    env.cache.put(deckTutorSharesKey(deckId), SHARES_KIND, env.cache.get<List<DeckTutorShareDto>>(deckTutorSharesKey(deckId)).orEmpty().filter { it.relationship_id != relationshipId })
                    env.fx.tick()
                    _ui.update { it.copy(shareBusy = false) }
                }
                .onFailure { e -> _ui.update { it.copy(shareBusy = false) }; say("Couldn't stop sharing: ${e.userMessage()}", error = true) }
        }
    }

    // ---------------- one-off homework ----------------

    /** The banner's "Add to my daily review": the default caps (online only, as the web). */
    fun addToDailyReview() {
        if (!env.online.value) return
        _ui.update { it.copy(dailyReviewBusy = true, dailyReviewError = false) }
        viewModelScope.launch {
            val caps = mapOf(
                "new_cards_per_day" to DeckSettings.DEFAULT_NEW_PER_DAY.toString(),
                "secondary_cards_per_day" to DeckSettings.DEFAULT_SECONDARY_PER_DAY.toString(),
            )
            when (env.writes.updateSettings(deckId, caps)) {
                is WriteOutcome.Refused -> { env.fx.failure(); _ui.update { it.copy(dailyReviewBusy = false, dailyReviewError = true) } }
                else -> { env.fx.success(); _ui.update { it.copy(dailyReviewBusy = false) } }
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            val loaded = withContext(Dispatchers.IO) { load() }
            _ui.update { s ->
                loaded.copy(
                    online = s.online, selected = s.selected?.intersect(loaded.notes.map { it.id }.toSet()), audioJob = s.audioJob,
                    notice = s.notice, noticeIsError = s.noticeIsError, settingsError = s.settingsError, busy = s.busy,
                    oneOffAssignmentId = s.oneOffAssignmentId, dailyReviewBusy = s.dailyReviewBusy, dailyReviewError = s.dailyReviewError,
                    tutorShares = s.tutorShares, tutors = s.tutors, shareBusy = s.shareBusy, shareError = s.shareError,
                )
            }
        }
    }

    private suspend fun load(): DeckUi {
        val dao = env.dao
        val decks = dao.decks()
        val d = decks.firstOrNull { it.id == deckId } ?: return DeckUi(loaded = true, deck = null, isTutorAccount = env.isTutorAccount())
        val allCards = dao.cards()
        val cards = allCards.filter { it.deckId == deckId }
        val notes = dao.allNotes().filter { it.deckId == deckId }
        val events = cards.map { it.id }.chunked(500).flatMap { dao.replayEventsForCards(it) }
        val ratings = DeckStats.recentRatings(cards, events)
        val cardsByNote = cards.groupBy { it.noteId }
        val rows = notes.map { n ->
            NoteRowUi(n.id, n.hanzi, n.pinyin, n.english, n.sentenceClue, n.audioUrl, ratings[n.id].orEmpty(), DeckStats.notePercent(cardsByNote[n.id].orEmpty()))
        }.sortedByDescending { it.mastery } // stable: equal mastery keeps Room order

        // Due today with the same allocation as the Decks tab / Home.
        val zone = ZoneId.systemDefault()
        val now = env.nowMs()
        val queueCards = allCards.map { it.toQueueCard() }
        val first = dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(queueCards, first, StudyQueue.startOfDay(now, zone))
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().toString()
        val q = StudyQueue.build(decks.map { it.toQueueDeck() }, queueCards, env.budget(), env.bonus(deckId, today), introduced, StudyQueue.cutoff(now, zone), deckId, longTerm = dao.noteLongTerm())

        return DeckUi(
            loaded = true,
            deck = DeckHeaderUi(d.id, d.name, d.description, d.newCardsPerDay, d.secondaryCardsPerDay),
            due = q.dueCards.size,
            completion = DeckStats.completion(cards),
            breakdown = DeckStats.breakdown(cards),
            notes = rows,
            isTutorAccount = env.isTutorAccount(),
        )
    }

    fun play(row: NoteRowUi) = env.fx.playAudio(row.audioUrl, row.hanzi)

    // ---------------- selection ----------------

    fun startSelect(noteId: String) {
        env.fx.tick()
        _ui.update { it.copy(selected = setOf(noteId)) }
    }

    fun toggleSelect(noteId: String) = _ui.update { s ->
        val sel = s.selected ?: return@update s
        s.copy(selected = if (noteId in sel) sel - noteId else sel + noteId)
    }

    fun selectAll() = _ui.update { s -> s.copy(selected = s.notes.map { it.id }.toSet()) }

    fun endSelect() = _ui.update { it.copy(selected = null) }

    fun moveSelected() {
        val ids = _ui.value.selected?.toList().orEmpty()
        if (ids.isEmpty()) return
        editor.startMove(ids)
        endSelect()
    }

    // ---------------- audio ----------------

    /** ⋯ → Generate missing audio: one note at a time with progress (the web's generateAllMissingAudio). */
    fun generateMissingAudio() = runAudioJob(_ui.value.notes.filter { it.audioUrl == null }.map { it.id }, regenerate = false)

    /** Selection → Regenerate audio for the selected words that have a clip. */
    fun regenerateSelected() {
        val sel = _ui.value.selected.orEmpty()
        val ids = _ui.value.notes.filter { it.id in sel && it.audioUrl != null }.map { it.id }
        endSelect()
        runAudioJob(ids, regenerate = true)
    }

    private fun runAudioJob(ids: List<String>, regenerate: Boolean) {
        if (ids.isEmpty() || _ui.value.audioJob != null) return
        if (!env.online.value) return say("You're offline — audio is made on the server.", error = true)
        _ui.update { it.copy(audioJob = AudioJobUi(0, ids.size, regenerate)) }
        viewModelScope.launch {
            var failed = 0
            ids.forEachIndexed { i, id ->
                val r = if (regenerate) env.writes.regenerateAudio(id) else env.writes.generateAudio(id)
                if (r.isFailure) failed++
                _ui.update { it.copy(audioJob = AudioJobUi(i + 1, ids.size, regenerate)) }
            }
            _ui.update { it.copy(audioJob = null) }
            if (failed > 0) say("Audio couldn't be ${if (regenerate) "regenerated" else "generated"} for $failed of ${ids.size} words.", error = true)
            else { env.fx.success(); say("Audio ready for ${ids.size} ${if (ids.size == 1) "word" else "words"}.") }
        }
    }

    // ---------------- settings / delete ----------------

    fun saveSettings(name: String, description: String, newPerDay: String, secondaryPerDay: String, onSaved: () -> Unit) {
        val deck = _ui.value.deck ?: return
        _ui.update { it.copy(busy = true, settingsError = null) }
        viewModelScope.launch {
            var queued = false
            if (name != deck.name || description != deck.description.orEmpty()) {
                when (val o = env.writes.renameDeck(deckId, name, description)) {
                    is WriteOutcome.Refused -> return@launch _ui.update { it.copy(busy = false, settingsError = o.message) }
                    WriteOutcome.Queued -> queued = true
                    WriteOutcome.Saved -> Unit
                }
            }
            when (val o = env.writes.updateSettings(deckId, mapOf("new_cards_per_day" to newPerDay, "secondary_cards_per_day" to secondaryPerDay))) {
                is WriteOutcome.Refused -> return@launch _ui.update { it.copy(busy = false, settingsError = o.message) }
                WriteOutcome.Queued -> queued = true
                WriteOutcome.Saved -> Unit
            }
            env.fx.success()
            _ui.update { it.copy(busy = false) }
            onSaved()
            if (queued) say("Saved on this phone — it goes to the server when you're back online.")
        }
    }

    fun clearSettingsError() = _ui.update { it.copy(settingsError = null) }

    fun deleteDeck(onDeleted: () -> Unit) {
        _ui.update { it.copy(busy = true) }
        viewModelScope.launch {
            when (val o = env.writes.deleteDeck(deckId)) {
                is WriteOutcome.Refused -> { env.fx.failure(); _ui.update { it.copy(busy = false) }; say("Could not delete the deck: ${o.message}", error = true) }
                else -> { env.fx.tick(); onDeleted() }
            }
        }
    }

    fun say(message: String, error: Boolean = false) = _ui.update { it.copy(notice = message, noticeIsError = error) }

    fun dismissNotice() = _ui.update { it.copy(notice = null) }

    companion object {
        const val SHARES_KIND = "decks"
    }

    class Factory(private val env: DecksEnv, private val deckId: String) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = DeckViewModel(env, deckId) as T
    }
}
