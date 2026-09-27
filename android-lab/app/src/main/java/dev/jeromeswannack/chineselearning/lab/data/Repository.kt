package dev.jeromeswannack.chineselearning.lab.data

import android.content.Context
import androidx.room.withTransaction
import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.core.CardScheduler
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.ReviewEventInput
import dev.jeromeswannack.chineselearning.lab.core.StudyBudget
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

data class SyncStatus(
    val running: Boolean = false,
    val lastSyncAt: Long = 0,
    val error: String? = null,
    val signedOut: Boolean = false,
    val unsynced: Int = 0,
    val audioTotal: Int = 0,
    val audioCached: Int = 0,
)

/**
 * Sync with the same API contract the web client uses (frontend/src/services/sync.ts,
 * review-events.ts, sentence-sets.ts), plus the local writes the study session makes.
 */
class Repository(context: Context, val db: LabDatabase, val api: Api, val prefs: Prefs) {
    val dao = db.dao()
    private val audioDir = File(context.filesDir, "audio").apply { mkdirs() }
    private val syncMutex = Mutex()
    private val _status = MutableStateFlow(SyncStatus(lastSyncAt = prefs.lastSyncAt))
    val status: StateFlow<SyncStatus> = _status.asStateFlow()

    /** Bumped whenever local data changed (sync or review), so screens reload. */
    private val _dataVersion = MutableStateFlow(0)
    val dataVersion: StateFlow<Int> = _dataVersion.asStateFlow()

    val isSignedIn get() = prefs.sessionToken != null

    // ---------------- sync ----------------

    /** Full or incremental sync, then events, sentences and audio. Safe to call any time. */
    suspend fun sync(forceFull: Boolean = false) {
        if (!isSignedIn) return
        if (!syncMutex.tryLock()) return
        try {
            _status.update { it.copy(running = true, error = null) }
            withContext(Dispatchers.IO) {
                refreshProfile()
                if (forceFull || prefs.lastFullSync == 0L || dao.noteCount() == 0) fullSync() else incrementalSync()
                syncEvents()
                syncSentences()
            }
            prefs.lastSyncAt = System.currentTimeMillis()
            _status.update { it.copy(running = false, lastSyncAt = prefs.lastSyncAt, unsynced = dao.unsyncedCount()) }
            _dataVersion.update { it + 1 }
            withContext(Dispatchers.IO) { prefetchAudio() }
        } catch (e: UnauthorizedException) {
            _status.update { it.copy(running = false, signedOut = true, error = "Signed out — sign in again") }
        } catch (e: Exception) {
            _status.update { it.copy(running = false, error = e.message ?: e.javaClass.simpleName, unsynced = runCatching { dao.unsyncedCount() }.getOrDefault(it.unsynced)) }
            _dataVersion.update { it + 1 }
        } finally {
            syncMutex.unlock()
        }
    }

    /** Upload pending reviews only (after each rating; cheap). */
    suspend fun pushEvents() {
        if (!isSignedIn) return
        syncMutex.withLock {
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
        prefs.userName = me.name
        prefs.budget = StudyBudget(me.new_cards_per_day.coerceIn(0, StudyBudget.MAX), me.secondary_cards_per_day.coerceIn(0, StudyBudget.MAX))
    }

    private fun deckEntity(d: DeckDto) = DeckEntity(d.id, d.name, d.description, d.new_cards_per_day, d.secondary_cards_per_day, d.study_priority, d.created_at)

    private fun noteEntity(n: NoteDto, deckId: String = n.deck_id) = NoteEntity(
        id = n.id, deckId = deckId, hanzi = n.hanzi, pinyin = n.pinyin, english = n.english, audioUrl = n.audio_url,
        funFacts = n.fun_facts, context = n.context, sentenceClue = n.sentence_clue, sentenceCluePinyin = n.sentence_clue_pinyin,
        sentenceClueTranslation = n.sentence_clue_translation, sentenceClueAudioUrl = n.sentence_clue_audio_url,
        alternatives = n.alternatives, createdAt = n.created_at,
    )

    /** `fullSync`: replace decks + notes wholesale; keep cards we have (their state comes from events). */
    private suspend fun fullSync() {
        // Server changes after this moment are picked up by the next incremental sync; five
        // minutes of slack covers clock skew (re-applying a change is harmless).
        val snapshotAt = System.currentTimeMillis() - 5 * 60_000
        val decks = api.decks().mapNotNull { api.deck(it.id) }
        val notes = decks.flatMap { d -> d.notes.map { noteEntity(it, d.id) } }
        val serverCards = decks.flatMap { d -> d.notes.flatMap { n -> n.cards.map { CardEntity(it.id, n.id, d.id, it.card_type) } } }
        db.withTransaction {
            dao.clearDecks()
            dao.upsertDecks(decks.map(::deckEntity))
            dao.clearNotes()
            notes.chunked(500).forEach { dao.upsertNotes(it) }
            val keep = serverCards.mapTo(HashSet()) { it.id }
            dao.cardIds().filter { it !in keep }.chunked(500).forEach { dao.deleteCards(it) }
            serverCards.chunked(500).forEach { dao.insertCardsIfMissing(it) }
            // Notes can move between decks.
            val existing = dao.cards().associateBy { it.id }
            dao.upsertCards(serverCards.mapNotNull { c -> existing[c.id]?.takeIf { it.deckId != c.deckId || it.noteId != c.noteId }?.copy(deckId = c.deckId, noteId = c.noteId) })
            dao.deleteOrphanSentences()
        }
        prefs.lastFullSync = System.currentTimeMillis()
        prefs.changesCursor = snapshotAt
        recomputeAll()
    }

    /** `incrementalSync`: GET /api/sync/changes since the cursor, tombstones first. */
    private suspend fun incrementalSync() {
        val changes = api.changes(prefs.changesCursor)
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
            for (c in changes.cards) {
                val deck = deckOfNote.getOrPut(c.note_id) { dao.note(c.note_id)?.deckId ?: "" }
                if (deck.isNotEmpty()) dao.insertCardsIfMissing(listOf(CardEntity(c.id, c.note_id, deck, c.card_type)))
            }
            dao.deleteOrphanSentences()
        }
        prefs.changesCursor = Js.parseDate(changes.server_time)
        // New cards may already have events (reviewed on another device).
        if (changes.cards.isNotEmpty()) recompute(changes.cards.map { it.id })
    }

    private suspend fun uploadPending() {
        for (p in dao.pendingDeletions()) {
            api.deleteEvent(p.eventId)
            dao.removePendingDeletion(p.eventId)
        }
        while (true) {
            val batch = dao.unsyncedEvents(100)
            if (batch.isEmpty()) break
            api.uploadEvents(batch.map { EventDto(it.id, it.cardId, it.rating, it.reviewedAt, it.timeSpentMs, it.userAnswer) })
            dao.markSynced(batch.map { it.id })
        }
    }

    /** `syncEvents`: deletions, upload, then download new events and recompute those cards. */
    private suspend fun syncEvents() {
        uploadPending()
        val deleting = dao.pendingDeletions().mapTo(HashSet()) { it.eventId }
        var since = prefs.eventsCursor
        var afterId: String? = null
        val affected = HashSet<String>()
        var pages = 0
        while (pages++ < 500) {
            val page = api.events(since, afterId)
            if (page.events.isEmpty()) break
            val fresh = page.events.filter { it.id !in deleting }
            val known = fresh.map { it.id }.chunked(500).flatMap { dao.existingEventIds(it) }.toHashSet()
            val insert = fresh.filter { it.id !in known }
            dao.insertEvents(insert.map { ReviewEventEntity(it.id, it.card_id, it.rating, it.reviewed_at, it.time_spent_ms, it.user_answer, synced = true) })
            insert.mapTo(affected) { it.card_id }
            val last = page.events.last()
            val next = sqlTimestamp(last.created_at ?: last.reviewed_at)
            if (next == since && last.id == afterId) break
            since = next
            afterId = last.id
            prefs.eventsCursor = since
            if (!page.has_more) break
        }
        if (affected.isNotEmpty()) recompute(affected)
    }

    /** The server compares `created_at` (SQL format); normalise an ISO cursor like the web does. */
    private fun sqlTimestamp(s: String): String =
        s.replace('T', ' ').substringBefore('.').removeSuffix("Z")

    private suspend fun syncSentences() {
        val page = api.sentences(prefs.sentencesCursor)
        if (page.sentences.isNotEmpty()) {
            val byNote = page.sentences.groupBy { it.note_id }
            db.withTransaction {
                byNote.keys.chunked(500).forEach { dao.deleteSentencesOf(it) }
                dao.upsertSentences(page.sentences.map { SentenceEntity(it.id, it.note_id, it.position, it.hanzi, it.pinyin, it.translation, it.audio_url, it.focus, it.focus_note) })
                dao.deleteOrphanSentences()
            }
        }
        page.server_time?.let { prefs.sentencesCursor = it }
    }

    // ---------------- state ----------------

    private suspend fun recomputeAll() {
        val events = dao.allEvents().groupBy { it.cardId }
        val cards = dao.cards()
        val updated = cards.map { c -> c.withState(CardScheduler.computeCardState(events[c.id].orEmpty().map(::input))) }
        updated.chunked(500).forEach { dao.upsertCards(it) }
    }

    private suspend fun recompute(cardIds: Collection<String>) {
        for (id in cardIds) recomputeCard(id)
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
            dao.insertEvents(listOf(ReviewEventEntity(id, cardId, rating, Js.toIsoString(nowMs), timeSpentMs, userAnswer?.takeIf { it.isNotEmpty() }, synced = false)))
            val card = recomputeCard(cardId)
            _status.update { it.copy(unsynced = it.unsynced + 1) }
            id to card
        }

    /** Undo one review: drop the event (and tell the server if it already has it). */
    suspend fun undoReview(eventId: String): CardEntity? = withContext(Dispatchers.IO) {
        val event = dao.event(eventId) ?: return@withContext null
        db.withTransaction {
            dao.deleteEvent(eventId)
            if (event.synced) dao.addPendingDeletion(PendingDeletionEntity(eventId))
        }
        recomputeCard(event.cardId)
    }

    // ---------------- audio ----------------

    fun cachedAudio(key: String?): File? {
        if (key.isNullOrBlank()) return null
        return File(audioDir, fileName(key)).takeIf { it.exists() && it.length() > 0 }
    }

    private fun fileName(key: String) = key.removePrefix("/api/audio/").replace(Regex("[^A-Za-z0-9._-]"), "_")

    /** Download every clip the cards and sentences reference (offline on the train). */
    suspend fun prefetchAudio() = coroutineScope {
        val keys = LinkedHashSet<String>()
        dao.allNotes().forEach { n -> n.audioUrl?.let(keys::add); n.sentenceClueAudioUrl?.let(keys::add) }
        dao.allSentences().forEach { s -> s.audioUrl?.let(keys::add) }
        val missing = keys.filter { cachedAudio(it) == null }
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
        db.clearAllTables()
        prefs.clearAccount()
        audioDir.listFiles()?.forEach { it.delete() }
        _status.value = SyncStatus()
        _dataVersion.update { it + 1 }
    }

    fun onSignedIn(token: String) {
        prefs.sessionToken = token
        prefs.pendingAuthNonce = null
        _status.update { it.copy(signedOut = false, error = null) }
    }
}
