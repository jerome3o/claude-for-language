package dev.jeromeswannack.chineselearning.lab.core

/**
 * Auto-audio: which clips a note is missing, and a tracker that keeps generation requests
 * deduped and backed off. The web's StudyCard asks `POST /api/notes/:id/generate-audio` when a
 * card shows with no `audio_url` (StudyPage.tsx, "Auto-generate audio if note has no
 * audio_url"); the Lab app does the same through the idempotent
 * `POST /api/notes/:id/ensure-audio`, and also for the example sentence, a clip that 404s,
 * notes queued while offline, and — during sync — the upcoming study queue.
 */
object NoteAudio {
    enum class Clip { WORD, SENTENCE }

    /** The note fields that decide what audio it needs. */
    data class Clips(val noteId: String, val audioUrl: String?, val sentenceClue: String?, val sentenceClueAudioUrl: String?)

    /** A clip url as the R2 key the server stores (`/api/audio/generated/x.mp3` → `generated/x.mp3`); worker `audioKeyOf`. */
    fun key(url: String): String = url.removePrefix("/").removePrefix("api/audio/").removePrefix("/")

    /**
     * What [note] is missing: the word clip when it has no url (or its clip 404'd — [broken]
     * holds keys), the sentence clip when it has a sentence and no clip for it.
     */
    fun missing(note: Clips, broken: Set<String> = emptySet()): Set<Clip> {
        val out = LinkedHashSet<Clip>()
        if (isMissing(note.audioUrl, broken)) out += Clip.WORD
        if (!note.sentenceClue.isNullOrBlank() && isMissing(note.sentenceClueAudioUrl, broken)) out += Clip.SENTENCE
        return out
    }

    private fun isMissing(url: String?, broken: Set<String>) = url.isNullOrBlank() || key(url) in broken

    /** The keys of [note]'s clips that are in [broken] (sent with the request so the server re-checks them). */
    fun brokenKeys(note: Clips, broken: Set<String>): List<String> =
        listOfNotNull(note.audioUrl, note.sentenceClueAudioUrl.takeIf { !note.sentenceClue.isNullOrBlank() })
            .filter { it.isNotBlank() }.map(::key).filter { it in broken }.distinct()

    /**
     * The sync's background pass: [queuedFirst] (queued offline / found broken) then the notes
     * of the upcoming study queue in order ([upcomingNoteIds]: today's due cards, then the next
     * new ones), deduped, keeping only notes that miss a clip and that [tracker] may start now,
     * at most [limit].
     */
    fun backfillBatch(
        queuedFirst: Collection<String>,
        upcomingNoteIds: List<String>,
        notes: Map<String, Clips>,
        broken: Set<String>,
        tracker: Tracker,
        nowMs: Long,
        limit: Int = MAX_PER_SYNC,
    ): List<String> {
        val out = ArrayList<String>()
        val seen = HashSet<String>()
        for (id in queuedFirst.asSequence() + upcomingNoteIds.asSequence()) {
            if (out.size >= limit) break
            if (!seen.add(id)) continue
            val note = notes[id] ?: continue
            if (missing(note, broken).isEmpty()) continue
            if (!tracker.mayStart(id, nowMs)) continue
            out += id
        }
        return out
    }

    /** Requests per sync pass (a few at a time — TTS is rate-limited server-side). */
    const val MAX_PER_SYNC = 12
    /** Requests in flight at once during the sync pass. */
    const val CONCURRENCY = 2
    /** After the 1st, 2nd … failure, wait this long before trying the note again (a tap on "retry" doesn't wait). */
    val BACKOFF_MS = longArrayOf(30_000, 2 * 60_000, 10 * 60_000, 60 * 60_000, 6 * 60 * 60_000)

    /** Where one note's clips stand, for the Play buttons. */
    sealed interface Status {
        data object Generating : Status
        /** Offline: queued, made on the next sync. */
        data object WaitingForConnection : Status
        data class Failed(val attempts: Int, val retryAtMs: Long) : Status
    }

    /**
     * Per-note request state: one request per note in flight, failures back off
     * ([BACKOFF_MS]), notes asked for while offline wait in [queued]. Pure (the clock is passed
     * in); not thread-safe — callers serialise.
     */
    class Tracker(private val backoffMs: LongArray = BACKOFF_MS) {
        private val statuses = LinkedHashMap<String, Status>()
        private val queuedIds = LinkedHashSet<String>()

        fun status(noteId: String): Status? = statuses[noteId]
        fun all(): Map<String, Status> = LinkedHashMap(statuses)
        val queued: Set<String> get() = LinkedHashSet(queuedIds)

        /** May a request for [noteId] start now? Not while one is in flight; not before its backoff ends unless [manual] (the retry button). */
        fun mayStart(noteId: String, nowMs: Long, manual: Boolean = false): Boolean = when (val s = statuses[noteId]) {
            Status.Generating -> false
            is Status.Failed -> manual || nowMs >= s.retryAtMs
            else -> true
        }

        /** Claims [noteId] for a request; false = don't send one (deduped / backing off). */
        fun start(noteId: String, nowMs: Long, manual: Boolean = false): Boolean {
            if (!mayStart(noteId, nowMs, manual)) return false
            statuses[noteId] = Status.Generating
            queuedIds -= noteId
            return true
        }

        fun succeeded(noteId: String) {
            statuses -= noteId
            queuedIds -= noteId
            previousAttempts -= noteId
        }

        /** The request failed: back off (longer each time); returns when it may be tried again. */
        fun failed(noteId: String, nowMs: Long): Long {
            val attempts = (previousAttempts[noteId] ?: 0) + 1
            previousAttempts[noteId] = attempts
            val retryAt = nowMs + backoffMs[(attempts - 1).coerceAtMost(backoffMs.lastIndex)]
            statuses[noteId] = Status.Failed(attempts, retryAt)
            return retryAt
        }

        /** Asked for while offline: wait for the next sync (unless a request is already running). */
        fun queueOffline(noteId: String) {
            if (statuses[noteId] == Status.Generating) return
            queuedIds += noteId
            if (statuses[noteId] !is Status.Failed) statuses[noteId] = Status.WaitingForConnection
        }

        /** Restores the queue saved across restarts. */
        fun restoreQueued(ids: Collection<String>) = ids.forEach(::queueOffline)

        /** The network request was abandoned without an answer (cancelled): forget it, try again later. */
        fun abandoned(noteId: String) {
            if (statuses[noteId] == Status.Generating) statuses -= noteId
        }

        // Failed → Generating → Failed must keep counting, so the count outlives the status.
        private val previousAttempts = HashMap<String, Int>()
    }
}
