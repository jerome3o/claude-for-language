package dev.jeromeswannack.chineselearning.lab.data.audio

import dev.jeromeswannack.chineselearning.lab.data.noteLongTerm
import dev.jeromeswannack.chineselearning.lab.data.noteHanzi
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.NoteAudio
import dev.jeromeswannack.chineselearning.lab.core.StudyQueue
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.NoteEntity
import dev.jeromeswannack.chineselearning.lab.data.Repository
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import dev.jeromeswannack.chineselearning.lab.data.api.EnsureAudioResult
import dev.jeromeswannack.chineselearning.lab.data.api.ensureNoteAudio
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import java.time.ZoneId

/**
 * Auto-audio: a card never stays silent for want of a clip.
 *
 * The web's StudyCard asks for a word clip when a card shows with no `audio_url`
 * (StudyPage.tsx, `generateNoteAudio`). Here, through the idempotent
 * `POST /api/notes/:id/ensure-audio`:
 * - **on the card** ([checkCard]): a missing word or sentence clip, or one that 404s when it is
 *   fetched, is requested at once; the Play buttons show "Generating audio…" ([statuses]) and the
 *   new note arrives on [updates] (mirrored into Room, clips cached for offline);
 * - **offline**: the note waits in a queue (kept across restarts) and is made on the next sync;
 * - **ahead of time** ([Sync], after every sync, in the background so the sync never waits): the
 *   queued notes, then the upcoming study queue (today's cards, then the next new ones), a few
 *   at a time. Student copies of a tutor's deck take the tutor's clip server-side.
 * One request per note at a time, failures back off (core [NoteAudio.Tracker]); the retry
 * button ([ensure] with `manual`) skips the wait.
 */
class NoteAudioFixer(
    private val repo: Repository,
    /** Online and not forced offline (the study session's `aiAvailable`). */
    private val online: () -> Boolean,
    private val clock: () -> Long = System::currentTimeMillis,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
    // Best-effort background work: a failure (e.g. the database closing under it) is logged, never a crash.
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO + kotlinx.coroutines.CoroutineExceptionHandler { _, e -> android.util.Log.w("NoteAudio", "background clip job failed", e) }),
    /** The API call (tests swap it). */
    private val request: suspend (noteId: String, broken: List<String>) -> EnsureAudioResult = { id, broken -> repo.api.ensureNoteAudio(id, broken) },
) {
    private val tracker = NoteAudio.Tracker()
    private val broken = LinkedHashSet<String>()
    private val _statuses = MutableStateFlow<Map<String, NoteAudio.Status>>(emptyMap())
    private val _updates = MutableSharedFlow<NoteEntity>(extraBufferCapacity = 32)
    private var backfillJob: Job? = null
    private val saveLock = Mutex()
    private val restored = scope.launch { restoreQueue() }

    /** Where each note's clips stand (absent = nothing going on). */
    val statuses: StateFlow<Map<String, NoteAudio.Status>> = _statuses.asStateFlow()

    /** A note whose clips were just made (already in Room). */
    val updates: SharedFlow<NoteEntity> = _updates.asSharedFlow()

    init {
        repo.onClipNotFound = { key -> markBroken(key) }
    }

    fun brokenKeys(): Set<String> = synchronized(broken) { LinkedHashSet(broken) }

    fun clips(n: NoteEntity) = NoteAudio.Clips(n.id, n.audioUrl, n.sentenceClue, n.sentenceClueAudioUrl)

    /** Which clips [note] lacks (no url, or a clip that 404'd). */
    fun missing(note: NoteEntity): Set<NoteAudio.Clip> = NoteAudio.missing(clips(note), brokenKeys())

    /** A clip url could not be fetched (HTTP 404): treat it as missing. */
    fun markBroken(url: String) {
        synchronized(broken) { broken += NoteAudio.key(url) }
    }

    /**
     * The card is up: download its clips if they aren't on the device (a 404 marks them
     * missing) and request whatever is missing. Returns at once.
     */
    fun checkCard(note: NoteEntity): Job = scope.launch {
        if (missing(note).isEmpty() && online()) {
            val urls = listOfNotNull(note.audioUrl, note.sentenceClueAudioUrl.takeIf { !note.sentenceClue.isNullOrBlank() })
            for (url in urls) {
                if (url.isBlank() || repo.cachedAudio(url) != null) continue
                try {
                    repo.cacheClip(url)
                } catch (e: HttpException) {
                    if (e.code == 404) markBroken(url)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Flaky connection: Play streams it or falls back to the device voice.
                }
            }
        }
        if (missing(note).isNotEmpty()) ensure(note.id)
    }

    /**
     * Makes [noteId]'s missing clips now — or queues it while offline. Returns the updated
     * note when a request ran, null otherwise (deduped, backing off, offline, nothing missing).
     */
    suspend fun ensure(noteId: String, manual: Boolean = false): NoteEntity? = withContext(Dispatchers.IO) {
        restored.join()
        val note = repo.dao.note(noteId) ?: return@withContext null
        val reported = brokenKeys()
        val clips = clips(note)
        if (NoteAudio.missing(clips, reported).isEmpty()) {
            change { tracker.succeeded(noteId) }
            return@withContext null
        }
        if (!online()) {
            change { tracker.queueOffline(noteId) }
            saveQueue()
            return@withContext null
        }
        if (!change { tracker.start(noteId, clock(), manual) }) return@withContext null
        saveQueue()
        try {
            val sent = NoteAudio.brokenKeys(clips, reported)
            val res = request(noteId, sent)
            // The server re-checked the reported clips: they are fixed, or were never gone.
            synchronized(broken) { broken.removeAll(sent.toSet()) }
            val updated = res.note?.let { dto ->
                val local = repo.dao.note(noteId) ?: return@let null
                dto.applyTo(local).also { repo.dao.upsertNotes(listOf(it)) }
            } ?: note
            val stillMissing = NoteAudio.missing(clips(updated), brokenKeys())
            change { if (res.failed || stillMissing.isNotEmpty()) tracker.failed(noteId, clock()) else tracker.succeeded(noteId) }
            if (updated != note) _updates.emit(updated)
            // Keep the new clips for the train (the card can already stream them).
            listOfNotNull(updated.audioUrl, updated.sentenceClueAudioUrl).filter { it.isNotBlank() }
                .forEach { url -> runCatching { repo.cacheClip(url) } }
            updated
        } catch (e: CancellationException) {
            change { tracker.abandoned(noteId) }
            throw e
        } catch (e: UnauthorizedException) {
            change { tracker.abandoned(noteId) }
            null
        } catch (e: Exception) {
            android.util.Log.w("NoteAudio", "ensure-audio failed for $noteId", e)
            change { tracker.failed(noteId, clock()) }
            null
        }
    }

    /** The background pass after a sync (never blocks it; one at a time). */
    fun backfillInBackground(): Job = synchronized(this) {
        backfillJob?.takeIf { it.isActive } ?: scope.launch { runCatching { backfill() } }.also { backfillJob = it }
    }

    /** Queued notes first, then the upcoming study queue; [NoteAudio.MAX_PER_SYNC] requests, [NoteAudio.CONCURRENCY] at a time. */
    suspend fun backfill(): Int {
        restored.join()
        if (!online()) return 0
        val now = clock()
        val upcoming = upcomingNoteIds(now)
        val wanted = (synchronized(tracker) { tracker.queued } + upcoming).distinct()
        val notes = wanted.chunked(500).flatMap { repo.dao.notes(it) }.associate { it.id to clips(it) }
        val batch = synchronized(tracker) { NoteAudio.backfillBatch(tracker.queued, upcoming, notes, brokenKeys(), tracker, now) }
        // Queued notes that no longer exist (deleted) leave the queue.
        val gone = synchronized(tracker) { tracker.queued.filter { it !in notes } }
        if (gone.isNotEmpty()) { change { gone.forEach(tracker::succeeded) }; saveQueue() }
        if (batch.isEmpty()) return 0
        val gate = Semaphore(NoteAudio.CONCURRENCY)
        val made = coroutineScope { batch.map { id -> async { gate.withPermit { ensure(id) } } }.awaitAll() }.count { it != null }
        if (made > 0) repo.notifyLocalChange()
        return made
    }

    /** Today's cards in queue order, then the next new cards past today's budget. */
    private suspend fun upcomingNoteIds(nowMs: Long): List<String> {
        val cards = repo.dao.cards().map { it.toQueueCard() }
        if (cards.isEmpty()) return emptyList()
        val z = zone()
        val decks = repo.dao.decks().map { it.toQueueDeck() }
        val first = repo.dao.firstReviews().associate { it.cardId to Js.parseDate(it.firstAt) }
        val introduced = StudyQueue.introducedToday(cards, first, StudyQueue.startOfDay(nowMs, z))
        val cutoff = StudyQueue.cutoff(nowMs, z)
        val bonus = repo.prefs.bonus("all", java.time.Instant.ofEpochMilli(nowMs).atZone(z).toLocalDate().toString())
        val hanzi = repo.dao.noteHanzi()
        val longTerm = repo.dao.noteLongTerm()
        val today = StudyQueue.build(decks, cards, repo.prefs.budget, bonus, introduced, cutoff, null, hanzi, longTerm = longTerm).dueCards
        val ahead = StudyQueue.build(decks, cards, repo.prefs.budget, bonus + NEXT_NEW, introduced, cutoff, null, hanzi, longTerm = longTerm).dueCards
        return (today + ahead).map { it.noteId }.distinct()
    }

    private inline fun <T> change(block: () -> T): T {
        val out = synchronized(tracker) { block() }
        _statuses.value = synchronized(tracker) { tracker.all() }
        return out
    }

    /**
     * Snapshot and write under one lock: two concurrent requests (the backfill runs
     * [NoteAudio.CONCURRENCY] at a time) could otherwise write their snapshots out of order —
     * B snapshots [n1] before A starts n1, A writes [], then B's stale [n1] lands last and a
     * note that was already made stays queued across restarts.
     */
    private suspend fun saveQueue() {
        saveLock.withLock {
            val ids = synchronized(tracker) { tracker.queued.toList() }
            runCatching { repo.platform.cache.put(QUEUE_KEY, KIND, ids) }
        }
    }

    private suspend fun restoreQueue() {
        val ids = runCatching { repo.platform.cache.get<List<String>>(QUEUE_KEY) }.getOrNull().orEmpty()
        if (ids.isNotEmpty()) change { tracker.restoreQueued(ids) }
    }

    companion object {
        const val KIND = "audio"
        const val QUEUE_KEY = "audio/queued"
        /** New cards past today's budget that also get their clips ahead of time. */
        const val NEXT_NEW = 10

        /** The app's instance (LabApp installs it), for the sync step. */
        @Volatile var current: NoteAudioFixer? = null

        /** After every sync: start the background pass (drains the offline queue first). */
        val Sync = FeatureSync { current?.backfillInBackground() }
    }
}
