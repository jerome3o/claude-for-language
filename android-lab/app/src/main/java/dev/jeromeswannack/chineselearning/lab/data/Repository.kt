package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import dev.jeromeswannack.chineselearning.lab.data.platform.LabPlatform
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** How long one step of a sync took, with what it moved ("24 decks · 3,000 notes"). */
data class SyncPhase(val name: String, val ms: Long, val detail: String = "")

/** The last finished sync, for Lab settings (and debugging a slow one). */
data class SyncRun(val full: Boolean, val atMs: Long, val totalMs: Long, val ok: Boolean, val phases: List<SyncPhase>)

data class SyncStatus(
    val running: Boolean = false,
    val lastSyncAt: Long = 0,
    val error: String? = null,
    val signedOut: Boolean = false,
    val unsynced: Int = 0,
    val audioTotal: Int = 0,
    val audioCached: Int = 0,
    /** While running: the step in progress ("Downloading reviews"). */
    val phase: String? = null,
    /** While running: how far that step is ("12,000 so far", "12 of 24"). */
    val progress: String? = null,
    val lastRun: SyncRun? = null,
)

/**
 * Sync with the same API contract the web client uses (frontend/src/services/sync.ts,
 * review-events.ts, sentence-sets.ts), plus the local writes the study session makes.
 *
 * Speed (a first sync of a big account is 24 decks / 3,000 notes / 9,000 cards / ~45k
 * events): deck downloads run a few at a time; review pages are large and the next one is
 * fetched while the current one is written; card states are recomputed ONCE per sync, after
 * the events are in, in a few batched transactions (never one per card); audio downloads
 * run after the sync in their own job, outside the sync lock, so uploading a review never
 * waits for them.
 *
 * Card state stays exactly `CardScheduler.computeCardState(all events of the card)`:
 * [stateMutex] serialises every read-events → compute → write-card, so a review recorded
 * during a sync can't be overwritten by a replay that didn't see it.
 */
class Repository(context: Context, val db: LabDatabase, val api: Api, val prefs: Prefs) {
    val dao = db.dao()

    /** Feature platform: JSON cache, outbox, per-feature sync steps (data/platform/). */
    val platform = LabPlatform(db, api, context.filesDir)
    private val audioDir = File(context.filesDir, "audio").apply { mkdirs() }
    private val syncMutex = Mutex()
    /** Review upload/download: pushEvents only waits for the events step, not a whole sync. */
    private val eventsMutex = Mutex()
    /** Card-state writes (see class doc). */
    private val stateMutex = Mutex()
    private val background = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val audioLock = Any()
    private var audioJob: Job? = null
    private val audioAgain = AtomicBoolean(false)
    private val _status = MutableStateFlow(SyncStatus(lastSyncAt = prefs.lastSyncAt))
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    /** Bumped whenever local data changed (sync or review), so screens reload. */
    private val _dataVersion = MutableStateFlow(0)
    val dataVersion: StateFlow<Int> = _dataVersion.asStateFlow()

    /** A feature mirrored a server write into Room (deck / note edits, data/decks/): screens reload. */
    fun notifyLocalChange() = _dataVersion.update { it + 1 }

    val isSignedIn get() = prefs.sessionToken != null

    // ---------------- sync ----------------

    /** Cards whose state must be recomputed at the end of this sync. */
    private class Dirty {
        @Volatile var all = false
        val ids: MutableSet<String> = java.util.Collections.synchronizedSet(HashSet())
    }

    /** Times each step and reports it to [status] while it runs. */
    private inner class Clock {
        val phases = ArrayList<SyncPhase>()
        val startNs = System.nanoTime()

        inner class Step(val name: String) {
            var detail = ""
            fun progress(text: String) = _status.update { it.copy(phase = name, progress = text) }
        }

        suspend fun <T> phase(name: String, block: suspend (Step) -> T): T {
            val step = Step(name)
            _status.update { it.copy(phase = name, progress = null) }
            val t0 = System.nanoTime()
            try {
                return block(step)
            } finally {
                phases += SyncPhase(name, (System.nanoTime() - t0) / 1_000_000, step.detail)
            }
        }

        fun totalMs() = (System.nanoTime() - startNs) / 1_000_000
    }

    /** Full or incremental sync, then events, card states and sentences; audio follows in the background. */
    suspend fun sync(forceFull: Boolean = false) {
        if (!isSignedIn) return
        if (!syncMutex.tryLock()) return
        val clock = Clock()
        var full = false
        try {
            _status.update { it.copy(running = true, error = null, phase = null, progress = null) }
            withContext(Dispatchers.IO) {
                clock.phase("Profile") { refreshProfile() }
                full = forceFull || prefs.lastFullSync == 0L || dao.noteCount() == 0
                val dirty = Dirty()
                try {
                    if (full) fullSync(clock, dirty) else incrementalSync(clock, dirty)
                    syncEvents(clock, dirty)
                } finally {
                    // Whatever arrived before a failure is replayed too (the cursors have moved past it).
                    withContext(NonCancellable) { clock.phase("Card states") { recompute(dirty, it) } }
                }
                clock.phase("Sentences") { syncSentences(it) }
                clock.phase("Features") { platform.afterSync(full = forceFull) } // outbox drain + every feature's sync step
            }
            prefs.lastSyncAt = System.currentTimeMillis()
            val run = SyncRun(full, prefs.lastSyncAt, clock.totalMs(), true, clock.phases.toList())
            _status.update { it.copy(running = false, lastSyncAt = prefs.lastSyncAt, unsynced = dao.unsyncedCount(), phase = null, progress = null, lastRun = run) }
            _dataVersion.update { it + 1 }
            prefetchAudioInBackground()
        } catch (e: UnauthorizedException) {
            _status.update { it.copy(running = false, signedOut = true, error = "Signed out — sign in again", phase = null, progress = null) }
        } catch (e: Exception) {
            val run = SyncRun(full, System.currentTimeMillis(), clock.totalMs(), false, clock.phases.toList())
            _status.update {
                it.copy(
                    running = false, error = e.message ?: e.javaClass.simpleName, phase = null, progress = null, lastRun = run,
                    unsynced = runCatching { dao.unsyncedCount() }.getOrDefault(it.unsynced),
                )
            }
            _dataVersion.update { it + 1 }
        } finally {
            syncMutex.unlock()
        }
    }

    /** Upload pending reviews only (after each rating; cheap). Waits for a running sync's events step at most. */
    suspend fun pushEvents() {
        if (!isSignedIn) return
        eventsMutex.withLock {
            try {
                withContext(Dispatchers.IO) { uploadPending() }
                _status.update { it.copy(unsynced = dao.unsyncedCount(), error = null) }
            } catch (e: UnauthorizedException) {
                _status.update { it.copy(signedOut = true) }
            } catch (_: Exception) {
                _status.update { it.copy(unsynced = runCatching { dao.unsyncedCount() }.getOrDefault(it.unsynced)) }
            }
        }
    }

    private suspend fun refreshProfile() {
        val me = api.me()
        prefs.saveProfile(me)
        prefs.budget = StudyBudget(me.new_cards_per_day.coerceIn(0, StudyBudget.MAX), me.secondary_cards_per_day.coerceIn(0, StudyBudget.MAX))
        me.conversation_voices?.let { dev.jeromeswannack.chineselearning.lab.data.lessons.ConversationVoiceCache.put(platform.cache, it) }
    }

    private fun deckEntity(d: DeckDto) = DeckEntity(d.id, d.name, d.description, d.new_cards_per_day, d.secondary_cards_per_day, d.study_priority, d.created_at)

    private fun noteEntity(n: NoteDto, deckId: String = n.deck_id) = NoteEntity(
        id = n.id, deckId = deckId, hanzi = n.hanzi, pinyin = n.pinyin, english = n.english, audioUrl = n.audio_url,
        funFacts = n.fun_facts, context = n.context, sentenceClue = n.sentence_clue, sentenceCluePinyin = n.sentence_clue_pinyin,
        sentenceClueTranslation = n.sentence_clue_translation, sentenceClueAudioUrl = n.sentence_clue_audio_url,
        alternatives = n.alternatives, createdAt = n.created_at,
    )

    /** `fullSync`: replace decks + notes wholesale; keep cards we have (their state comes from events). */
    private suspend fun fullSync(clock: Clock, dirty: Dirty) {
        // Server changes after this moment are picked up by the next incremental sync; five
        // minutes of slack covers clock skew (re-applying a change is harmless).
        val snapshotAt = System.currentTimeMillis() - 5 * 60_000
        val decks = clock.phase("Downloading decks") { step ->
            val list = api.decks()
            val done = AtomicInteger()
            step.progress("0 of ${list.size}")
            val gate = Semaphore(DECK_DOWNLOADS)
            // Same order as the list (awaitAll keeps it), a few requests in flight.
            val got = coroutineScope {
                list.map { d ->
                    async { gate.withPermit { api.deck(d.id) }.also { step.progress("${done.incrementAndGet()} of ${list.size}") } }
                }.awaitAll()
            }.filterNotNull()
            step.detail = "%,d decks · %,d notes".format(got.size, got.sumOf { it.notes.size })
            got
        }
        clock.phase("Saving decks") { step ->
            val notes = decks.flatMap { d -> d.notes.map { noteEntity(it, d.id) } }
            val serverCards = decks.flatMap { d -> d.notes.flatMap { n -> n.cards.map { CardEntity(it.id, n.id, d.id, it.card_type) } } }
            db.withTransaction {
                dao.clearDecks()
                dao.upsertDecks(decks.map(::deckEntity))
                dao.clearNotes()
                notes.chunked(500).forEach { dao.upsertNotes(it) }
                val keep = serverCards.mapTo(HashSet()) { it.id }
                val placed = dao.cardPlacements().associateBy { it.id }
                placed.keys.filter { it !in keep }.chunked(500).forEach { dao.deleteCards(it) }
                serverCards.chunked(500).forEach { dao.insertCardsIfMissing(it) }
                // Notes can move between decks (only the placement columns: the state is the replay's).
                for (c in serverCards) {
                    val p = placed[c.id] ?: continue
                    if (p.deckId != c.deckId || p.noteId != c.noteId) dao.placeCard(c.id, c.noteId, c.deckId)
                }
                dao.deleteOrphanSentences()
            }
            step.detail = "%,d notes · %,d cards".format(notes.size, serverCards.size)
        }
        prefs.lastFullSync = System.currentTimeMillis()
        prefs.changesCursor = snapshotAt
        // A full sync is also the repair path: every card is replayed from its events.
        dirty.all = true
    }

    /** `incrementalSync`: GET /api/sync/changes since the cursor, tombstones first. */
    private suspend fun incrementalSync(clock: Clock, dirty: Dirty) {
        val changes = clock.phase("Changes") { step ->
            api.changes(prefs.changesCursor).also { step.detail = "${it.notes.size} notes · ${it.cards.size} cards · ${it.deleted.note_ids.size + it.deleted.deck_ids.size} deleted" }
        }
        clock.phase("Saving changes") {
            db.withTransaction {
                val deckIds = changes.deleted.deck_ids
                if (deckIds.isNotEmpty()) deckIds.chunked(500).forEach {
                    dao.deleteCardsOfDecks(it); dao.deleteNotesOfDecks(it); dao.deleteDecks(it)
                }
                val noteIds = changes.deleted.note_ids
                if (noteIds.isNotEmpty()) noteIds.chunked(500).forEach {
                    dao.deleteCardsOfNotes(it); dao.deleteSentencesOf(it); dao.deleteNotes(it)
                }
                if (changes.deleted.card_ids.isNotEmpty()) changes.deleted.card_ids.chunked(500).forEach { dao.deleteCards(it) }
                dao.upsertDecks(changes.decks.map(::deckEntity))
                val notes = changes.notes.map { noteEntity(it) }
                dao.upsertNotes(notes)
                notes.forEach { dao.moveCardsOfNote(it.id, it.deckId) }
                val deckOfNote = HashMap<String, String>()
                changes.cards.map { it.note_id }.distinct().chunked(500).forEach { ids -> dao.notes(ids).forEach { deckOfNote[it.id] = it.deckId } }
                val newCards = changes.cards.mapNotNull { c -> deckOfNote[c.note_id]?.let { CardEntity(c.id, c.note_id, it, c.card_type) } }
                newCards.chunked(500).forEach { dao.insertCardsIfMissing(it) }
                dao.deleteOrphanSentences()
            }
        }
        prefs.changesCursor = Js.parseDate(changes.server_time)
        // New cards may already have events (reviewed on another device).
        changes.cards.mapTo(dirty.ids) { it.id }
    }

    private suspend fun uploadPending(): Int {
        for (p in dao.pendingDeletions()) {
            api.deleteEvent(p.eventId)
            dao.removePendingDeletion(p.eventId)
        }
        var sent = 0
        while (true) {
            val batch = dao.unsyncedEvents(100)
            if (batch.isEmpty()) break
            api.uploadEvents(batch.map { EventDto(it.id, it.cardId, it.rating, it.reviewedAt, it.timeSpentMs, it.userAnswer) })
            dao.markSynced(batch.map { it.id })
            sent += batch.size
        }
        return sent
    }

    /**
     * `syncEvents`: deletions, upload, then download new events (the cards they touch are
     * marked for the recompute). Pages are large and the next page is requested while the
     * current one is written; the cursor only advances once a page is stored.
     */
    private suspend fun syncEvents(clock: Clock, dirty: Dirty) = eventsMutex.withLock {
        clock.phase("Uploading reviews") { step -> step.detail = "${uploadPending()} sent" }
        clock.phase("Downloading reviews") { step ->
            coroutineScope {
                var since = prefs.eventsCursor
                var afterId: String? = null
                var received = 0
                var added = 0
                var pages = 0
                var next: Deferred<EventsPageDto>? = async { api.events(since, afterId, EVENTS_PAGE) }
                while (next != null && pages++ < MAX_EVENT_PAGES) {
                    val page = next.await()
                    next = null
                    if (page.events.isEmpty()) break
                    val last = page.events.last()
                    val cursor = sqlTimestamp(last.created_at ?: last.reviewed_at)
                    val stuck = cursor == since && last.id == afterId
                    val more = page.has_more && !stuck
                    if (more) next = async { api.events(cursor, last.id, EVENTS_PAGE) }

                    // Undone reviews must not come back (re-read per page: an undo can happen meanwhile).
                    val deleting = dao.pendingDeletions().mapTo(HashSet()) { it.eventId }
                    val fresh = page.events.filter { it.id !in deleting }
                    val known = fresh.map { it.id }.chunked(500).flatMap { dao.existingEventIds(it) }.toHashSet()
                    val insert = fresh.filter { it.id !in known }
                    dao.insertEvents(insert.map { ReviewEventEntity(it.id, it.card_id, it.rating, it.reviewed_at, it.time_spent_ms, it.user_answer, synced = true) })
                    insert.mapTo(dirty.ids) { it.card_id }
                    received += page.events.size
                    added += insert.size
                    step.progress("%,d so far".format(received))
                    if (stuck) break
                    since = cursor
                    afterId = last.id
                    prefs.eventsCursor = since
                    if (!more) break
                }
                next?.cancel()
                step.detail = "%,d received · %,d new · %d pages".format(received, added, pages)
            }
        }
    }

    /** The server compares `created_at` (SQL format); normalise an ISO cursor like the web does. */
    private fun sqlTimestamp(s: String): String =
        s.replace('T', ' ').substringBefore('.').removeSuffix("Z")

    private suspend fun syncSentences(step: Clock.Step) {
        val page = api.sentences(prefs.sentencesCursor)
        if (page.sentences.isNotEmpty()) {
            val byNote = page.sentences.groupBy { it.note_id }
            db.withTransaction {
                byNote.keys.chunked(500).forEach { dao.deleteSentencesOf(it) }
                page.sentences.chunked(500).forEach { chunk ->
                    dao.upsertSentences(chunk.map { SentenceEntity(it.id, it.note_id, it.position, it.hanzi, it.pinyin, it.translation, it.audio_url, it.focus, it.focus_note) })
                }
                dao.deleteOrphanSentences()
            }
        }
        step.detail = "${page.sentences.size} sentences"
        page.server_time?.let { prefs.sentencesCursor = it }
    }

    // ---------------- state ----------------

    /**
     * Replays the dirty cards (all of them after a full sync) in chunks: one query for the
     * cards, one for their events, compute, and one transaction writing only the cards whose
     * state changed.
     */
    private suspend fun recompute(dirty: Dirty, step: Clock.Step) {
        val ids = if (dirty.all) dao.cardIds() else synchronized(dirty.ids) { dirty.ids.toList() }
        var done = 0
        var written = 0
        for (chunk in ids.chunked(RECOMPUTE_CHUNK)) {
            stateMutex.withLock {
                val cards = dao.cardsByIds(chunk)
                val events = dao.replayEventsForCards(chunk).groupBy { it.cardId }
                val changed = cards.mapNotNull { c ->
                    val replayed = c.withState(CardScheduler.computeCardState(events[c.id].orEmpty().map { ReviewEventInput(it.id, it.cardId, it.rating, it.reviewedAt) }))
                    replayed.takeIf { it != c }
                }
                if (changed.isNotEmpty()) db.withTransaction { dao.upsertCards(changed) }
                written += changed.size
            }
            done += chunk.size
            step.progress("%,d of %,d cards".format(done, ids.size))
        }
        step.detail = "%,d replayed · %,d changed".format(ids.size, written)
    }

    private suspend fun recomputeCard(cardId: String): CardEntity? {
        val card = dao.card(cardId) ?: return null
        val state = CardScheduler.computeCardState(dao.eventsForCard(cardId).map(::input))
        return card.withState(state).also { dao.upsertCards(listOf(it)) }
    }

    private fun input(e: ReviewEventEntity) = ReviewEventInput(e.id, e.cardId, e.rating, e.reviewedAt)

    // ---------------- study writes ----------------

    /** Record a review: append the event, recompute the card from its events. */
    suspend fun recordReview(cardId: String, rating: Int, timeSpentMs: Long?, userAnswer: String?, nowMs: Long = System.currentTimeMillis()): Pair<String, CardEntity?> =
        withContext(Dispatchers.IO) {
            val id = UUID.randomUUID().toString()
            val card = stateMutex.withLock {
                dao.insertEvents(listOf(ReviewEventEntity(id, cardId, rating, Js.toIsoString(nowMs), timeSpentMs, userAnswer?.takeIf { it.isNotEmpty() }, synced = false)))
                recomputeCard(cardId)
            }
            _status.update { it.copy(unsynced = it.unsynced + 1) }
            id to card
        }

    /** Undo one review: drop the event (and tell the server if it already has it). */
    suspend fun undoReview(eventId: String): CardEntity? = withContext(Dispatchers.IO) {
        stateMutex.withLock {
            val event = dao.event(eventId) ?: return@withLock null
            db.withTransaction {
                dao.deleteEvent(eventId)
                if (event.synced) dao.addPendingDeletion(PendingDeletionEntity(eventId))
            }
            recomputeCard(event.cardId)
        }
    }

    // ---------------- audio ----------------

    fun cachedAudio(key: String?): File? {
        if (key.isNullOrBlank()) return null
        return File(audioDir, fileName(key)).takeIf { it.exists() && it.length() > 0 }
    }

    private fun fileName(key: String) = key.removePrefix("/api/audio/").replace(Regex("[^A-Za-z0-9._-]"), "_")

    /**
     * Starts downloading missing clips in the background (after a sync). Never inside the
     * sync lock: a first download of thousands of clips must not hold up review uploads. A
     * request while it runs makes it go round once more (new clips from that sync).
     */
    fun prefetchAudioInBackground() {
        synchronized(audioLock) {
            if (audioJob?.isActive == true) { audioAgain.set(true); return }
            audioJob = background.launch {
                do {
                    audioAgain.set(false)
                    runCatching { prefetchAudio() }
                } while (audioAgain.get() && isActive)
            }
        }
    }

    /** For tests: wait until the background audio download is done. */
    suspend fun awaitAudioPrefetch() {
        synchronized(audioLock) { audioJob }?.join()
    }

    private suspend fun stopAudioPrefetch() {
        synchronized(audioLock) { audioJob }?.cancelAndJoin()
    }

    /** Download every clip the cards and sentences reference (offline on the train). */
    suspend fun prefetchAudio() = coroutineScope {
        val keys = LinkedHashSet<String>()
        dao.allNotes().forEach { n -> n.audioUrl?.let(keys::add); n.sentenceClueAudioUrl?.let(keys::add) }
        dao.allSentences().forEach { s -> s.audioUrl?.let(keys::add) }
        // One directory listing instead of a stat per clip.
        val have = audioDir.listFiles()?.filter { it.length() > 0 }?.mapTo(HashSet()) { it.name }.orEmpty()
        val missing = keys.filter { key -> key.isNotBlank() && fileName(key) !in have }
        _status.update { it.copy(audioTotal = keys.size, audioCached = keys.size - missing.size) }
        val gate = Semaphore(4)
        missing.map { key ->
            async {
                gate.withPermit {
                    runCatching { api.download(Config.audioUrl(key, api.baseUrl), File(audioDir, fileName(key))) }
                        .onSuccess { _status.update { it.copy(audioCached = it.audioCached + 1) } }
                }
            }
        }.awaitAll()
    }

    suspend fun signOut() = withContext(Dispatchers.IO) {
        stopAudioPrefetch()
        db.clearAllTables()
        prefs.clearAccount()
        audioDir.listFiles()?.forEach { it.delete() }
        platform.clearFiles()
        _status.value = SyncStatus()
        _dataVersion.update { it + 1 }
    }

    fun onSignedIn(token: String) {
        prefs.sessionToken = token
        prefs.pendingAuthNonce = null
        _status.update { it.copy(signedOut = false, error = null) }
    }

    private companion object {
        /** Deck downloads in flight during a full sync. */
        const val DECK_DOWNLOADS = 4
        /** Events per `GET /api/reviews` page. */
        const val EVENTS_PAGE = 5000
        const val MAX_EVENT_PAGES = 500
        /** Cards per replay batch (also the SQL `IN` size — old SQLite caps variables at 999). */
        const val RECOMPUTE_CHUNK = 500
    }
}
