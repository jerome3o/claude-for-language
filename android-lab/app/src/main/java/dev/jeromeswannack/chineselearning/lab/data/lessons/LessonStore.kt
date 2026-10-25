package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.HomeLesson
import dev.jeromeswannack.chineselearning.lab.core.HomeworkSize
import dev.jeromeswannack.chineselearning.lab.core.Handwriting
import dev.jeromeswannack.chineselearning.lab.core.LessonRevision
import dev.jeromeswannack.chineselearning.lab.core.LessonRun
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlock
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.LessonUnlockUpload
import dev.jeromeswannack.chineselearning.lab.data.api.LessonUnlockUploadBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListenedBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListenedEvent
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.RevisitMark
import dev.jeromeswannack.chineselearning.lab.core.StudyCutoff
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.CompletionUpload
import dev.jeromeswannack.chineselearning.lab.data.api.CompletionUploadBody
import dev.jeromeswannack.chineselearning.lab.data.api.CustomLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.customLessons
import dev.jeromeswannack.chineselearning.lab.data.api.deleteCustomLesson
import dev.jeromeswannack.chineselearning.lab.data.api.putAttemptMedia
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.revisit.RevisitStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import java.io.File
import java.io.IOException
import java.util.UUID

/** A completion made on this device (kept until the server's list carries it). */
@Serializable
data class LocalCompletion(
    val id: String,
    val lessonId: String,
    val correct: Int,
    val total: Int,
    val completedAt: String,
    /** Legacy (before Oct 2026 lessons were rated); null now. */
    val rating: Int? = null,
    /** What the run missed first time (core LessonRevision). */
    val outcome: LessonRevision.Outcome? = null,
)

/** An unlock of a locked lesson made on this phone (web: IndexedDB `lessonUnlocks`), kept until the server's list carries it. */
@Serializable
data class LocalUnlock(val lessonId: String, val unlockedAt: String, val via: String)

/** A listen that reached the end of an audio lesson on this phone (web: localStorage `audio-lessons-listened-v1`). */
@Serializable
data class LocalListen(val audioLessonId: String, val at: String)

/** A recording made in a lesson attempt, waiting to go up after its attempt (web: lessonAttemptMedia). */
@Serializable
data class PendingMedia(
    val attemptId: String,
    val mediaKey: String,
    val path: String,
    val mime: String,
    val createdAt: Long,
    val attempts: Int = 0,
    val synced: Boolean = false,
    val error: String? = null,
)

/** A recording handed over by the player. */
data class LessonRecording(val mediaKey: String, val file: File, val mime: String)

/**
 * A cached lesson with its merged completion history and its state — new / a revision (when,
 * which exercises) / done forever (core LessonRevision, replayed from the runs + the old Done for
 * good marks; never stored).
 */
data class LessonEntry(
    val lesson: CustomLessonDto,
    val runs: List<LessonRevision.RunRecord>,
    val learn: LessonRevision.State,
    /** When it was unlocked: the server's, or this phone's pending unlock (the earliest). */
    val unlockedAt: String? = lesson.unlockedAt,
    /** "Skip handwriting exercises" was on when this was computed (its runs leave write_handwriting out). */
    val skipHandwriting: Boolean = false,
) {
    val id: String get() = lesson.id
    val reps: Int get() = learn.runs
    /** Done forever (everything right first time, or an old "Done for good"). */
    val retired: Boolean get() = learn.status == "done"
    val isNew: Boolean get() = learn.status == "new"
    val isRevision: Boolean get() = learn.status == "revision"
    /** Unlockable lessons (core LessonUnlocks): the condition, null = none. */
    val unlock: LessonUnlock? get() = lesson.unlockCondition
    /** "none" | "locked" | "unlocked". */
    val lockStatus: String get() = LessonUnlocks.status(unlock, unlockedAt)
    val locked: Boolean get() = lockStatus == "locked"
    val unlockItem: LessonUnlocks.Item get() = LessonUnlocks.Item(id, unlock, unlockedAt)

    /** The scored exercises of its next revision (`revisionKeys`), in lesson order. */
    fun revisionKeys(): List<String> = LessonRevision.revisionKeys(learn, LessonRun.steps(lesson.spec, null, skipHandwriting), id)

    fun revisionDue(cutoffMs: Long): Boolean = LessonRevision.isDue(learn, cutoffMs)

    /** "18 exercises · ~12 min" — the whole lesson. */
    fun lessonSize(): String = HomeworkSize.lessonSizeLabel(LessonRun.steps(lesson.spec, null, skipHandwriting).map { it.type })

    /** "5 questions · ~4 min" — its revision as it would be played now. */
    fun revisionSize(): String {
        val keys = revisionKeys()
        return HomeworkSize.revisionSizeLabel(keys.size, LessonRun.steps(lesson.spec, keys, skipHandwriting).map { it.type })
    }

    /** As Home's card sees it (web `homeLessonOf`). */
    fun homeLesson(cutoffMs: Long, tutorName: String? = null): HomeLesson {
        val due = revisionDue(cutoffMs)
        return HomeLesson(
            id, lesson.title.ifBlank { lesson.spec.title }, lesson.createdAt, learn.status, locked, due, learn.revision, learn.dueMs,
            if (due) revisionSize() else lessonSize(), tutorName,
        )
    }
}

/**
 * Offline store for custom mini lessons — the web's services/custom-lesson-study.ts on
 * the Lab platform: the lesson list (spec + server completions) lives in the JsonCache,
 * completions made here are appended locally and sent through the Outbox
 * (`POST /api/custom-lessons/offline-complete`, idempotent by event id, carrying the
 * attempt and its outcome), recordings queue in their own list and go up by media key once their
 * attempt is on the server (a 404 means "not yet"). Each lesson's state (new / revision / done,
 * core LessonRevision) is always replayed from the merged runs + the old Done-for-good / Bring-back
 * marks ([RevisitStore], read only now).
 */
class LessonStore(
    private val cache: JsonCache,
    private val outbox: Outbox,
    private val api: Api,
    /** Half-done runs on this phone (cleared by a completion); null in plain data tests. */
    val progress: LessonProgressStore? = null,
) {
    /** Next to the outbox's own folder (app filesDir). */
    private val filesDir: File = outbox.dir.parentFile ?: outbox.dir
    val media = LessonMedia(filesDir, api)
    /** describe_image pictures by scene (drawn server-side, polled while pending). */
    val pictures = LessonPictures(cache, api, media)
    val homework = HomeworkLink(cache, outbox)

    private val listSerializer = ListSerializer(CustomLessonDto.serializer())
    private val localSerializer = ListSerializer(LocalCompletion.serializer())
    private val mediaSerializer = ListSerializer(PendingMedia.serializer())
    /** The old Done for good / Bring back marks (before Oct 2026; a retire = done forever). */
    val revisit = RevisitStore(cache, outbox, api)

    private val unlocksSerializer = ListSerializer(LocalUnlock.serializer())
    private val deletesSerializer = ListSerializer(String.serializer())
    private val listensSerializer = ListSerializer(LocalListen.serializer())

    fun observe(): Flow<List<LessonEntry>> =
        combine(cache.observe(LIST, listSerializer), cache.observe(LOCAL, localSerializer), revisit.observeMarks(), cache.observe(UNLOCKS, unlocksSerializer), SkipHandwriting.state) { list, local, marks, unlocks, skip ->
            merge(list.orEmpty(), local.orEmpty(), marks, unlocks.orEmpty(), skip)
        }.flowOn(Dispatchers.Default)

    suspend fun entries(): List<LessonEntry> =
        merge(cache.get(LIST, listSerializer).orEmpty(), cache.get(LOCAL, localSerializer).orEmpty(), revisit.marks(), cache.get(UNLOCKS, unlocksSerializer).orEmpty(), SkipHandwriting.state.value)

    suspend fun hasCache(): Boolean = cache.entry(LIST) != null

    suspend fun entry(id: String): LessonEntry? = entries().firstOrNull { it.id == id }

    /**
     * `lessonsToDo`: the lessons Home's card offers — revisions due by [cutoff] (most overdue
     * first), then new lessons (oldest first); locked ones wait.
     */
    suspend fun lessonsToDo(cutoff: StudyCutoff): List<LessonEntry> {
        val open = entries().filter { !it.locked }
        val revisions = open.filter { it.revisionDue(cutoff.ts) }.sortedBy { it.learn.dueMs ?: 0L }
        val fresh = open.filter { it.isNew }.sortedWith(compareBy({ it.lesson.createdAt }, { it.id }))
        return revisions + fresh
    }

    private fun merge(list: List<CustomLessonDto>, local: List<LocalCompletion>, marks: List<RevisitMark>, unlocks: List<LocalUnlock> = emptyList(), skipHandwriting: Boolean = false): List<LessonEntry> {
        val localByLesson = local.groupBy { it.lessonId }
        val marksByLesson = marks.filter { it.itemKind == "lesson" }.groupBy { it.itemId }
        val unlockByLesson = unlocks.associateBy { it.lessonId }
        return list.map { lesson ->
            val server = lesson.completions.map { LessonRevision.RunRecord(it.id, it.completedAt, LessonRevision.clean(it.outcome), it.rating) }
            val seen = server.mapTo(HashSet()) { it.id }
            val mine = localByLesson[lesson.id].orEmpty().filter { it.id !in seen }.map { LessonRevision.RunRecord(it.id, it.completedAt, it.outcome, it.rating) }
            val runs = server + mine
            val marksHere = marksByLesson[lesson.id].orEmpty().map { LessonRevision.MarkRecord(it.id, it.createdAt, it.action) }
            val unlockedAt = if (lesson.unlock == null) null else LessonUnlocks.earlier(lesson.unlockedAt, unlockByLesson[lesson.id]?.unlockedAt)
            // "Skip handwriting exercises": earlier handwriting misses stop counting (core Handwriting).
            val ignore = if (skipHandwriting) Handwriting.handwritingKeys(lesson.spec) else emptyList()
            LessonEntry(lesson, runs, LessonRevision.state(runs, marksHere, ignore), unlockedAt, skipHandwriting)
        }
    }

    // ============ Unlockable lessons (core LessonUnlocks; web services/lessonUnlock.ts) ============

    /**
     * `unlockLesson`: unlock a locked lesson here at once (today's lessons include it straight
     * away) and send it through the Outbox (`POST /api/custom-lessons/unlock`, idempotent). False
     * when it has no condition or is already unlocked.
     */
    suspend fun unlock(lessonId: String, via: String, nowMs: Long = System.currentTimeMillis()): Boolean = lock.withLock { unlockLocked(lessonId, via, nowMs) }

    private suspend fun unlockLocked(lessonId: String, via: String, nowMs: Long): Boolean {
        val entry = entries().firstOrNull { it.id == lessonId } ?: return false
        if (!entry.locked) return false
        val at = Js.toIsoString(nowMs)
        cache.put(UNLOCKS, KIND, cache.get(UNLOCKS, unlocksSerializer).orEmpty().filter { it.lessonId != lessonId } + LocalUnlock(lessonId, at, via), unlocksSerializer)
        outbox.enqueueJson(UNLOCK_KIND, "POST", "/api/custom-lessons/unlock", LessonUnlockUploadBody(listOf(LessonUnlockUpload(lessonId, at, via))), id = "unlock-$lessonId-$nowMs")
        Analytics.track("lesson.unlock", mapOf("via" to via, "kind" to (entry.unlock?.kind ?: LessonUnlock.MANUAL)))
        return true
    }

    /**
     * A listen reached the end of an audio lesson (`markAudioLessonListened`): remembered, the
     * lessons waiting on it unlocked here (`auto`), and uploaded (`POST /api/audio-lessons/listened`
     * — the server unlocks its copies too). Returns the lessons it unlocked.
     */
    suspend fun markAudioListened(audioLessonId: String, nowMs: Long = System.currentTimeMillis()): List<String> = lock.withLock {
        val at = Js.toIsoString(nowMs)
        val listens = cache.get(LISTENS, listensSerializer).orEmpty()
        if (listens.none { it.audioLessonId == audioLessonId }) cache.put(LISTENS, KIND, listens + LocalListen(audioLessonId, at), listensSerializer)
        outbox.enqueueJson(UNLOCK_KIND, "POST", "/api/audio-lessons/listened", ListenedBody(listOf(ListenedEvent(audioLessonId, at))), id = "listened-$audioLessonId-$nowMs")
        val ids = LessonUnlocks.unlockedByListen(entries().map { it.unlockItem }, audioLessonId)
        ids.filter { unlockLocked(it, "auto", nowMs) }
    }

    /** When this phone first heard [audioLessonId] to the end (null = not yet). */
    suspend fun listenedHere(audioLessonId: String): String? = cache.get(LISTENS, listensSerializer).orEmpty().firstOrNull { it.audioLessonId == audioLessonId }?.at

    fun observeListens(): Flow<List<LocalListen>> = cache.observe(LISTENS, listensSerializer).map { it.orEmpty() }

    /**
     * `completeCustomLesson`: append the completion (with its attempt and outcome) and queue it for
     * upload; recordings wait in the media queue; the homework assignment is marked done; the
     * half-done run is cleared. Returns the lesson's new state: done forever (all right first time)
     * or a revision in a week.
     */
    suspend fun complete(
        lessonId: String,
        correct: Int,
        total: Int,
        attempt: LessonAttemptData?,
        recordings: List<LessonRecording>,
        outcome: LessonRevision.Outcome?,
        nowMs: Long = System.currentTimeMillis(),
        source: String = "lessons_page",
    ): LessonRevision.State = lock.withLock {
        val now = Js.toIsoString(nowMs)
        val id = UUID.randomUUID().toString()
        val runOutcome = outcome ?: LessonRevision.runOutcome(attempt)
        val event = LocalCompletion(id, lessonId, correct, total, now, null, runOutcome)
        cache.put(LOCAL, KIND, cache.get(LOCAL, localSerializer).orEmpty() + event, localSerializer)
        outbox.enqueueJson(
            "lessons", "POST", "/api/custom-lessons/offline-complete",
            CompletionUploadBody(listOf(CompletionUpload(id, lessonId, correct, total, now, null, attempt, runOutcome))),
            id = id,
        )
        if (recordings.isNotEmpty()) {
            val queued = cache.get(MEDIA, mediaSerializer).orEmpty() + recordings.map { PendingMedia(id, it.mediaKey, it.file.absolutePath, it.mime, nowMs) }
            cache.put(MEDIA, KIND, queued, mediaSerializer)
        }
        homework.recordDone("lesson", lessonId)
        // Finished: the half-done run is over (its recordings now wait in the media queue).
        progress?.clear(lessonId, deleteRecordings = false)
        entries().firstOrNull { it.id == lessonId }?.learn ?: LessonRevision.NEW
    }

    /** Where the player records an oral answer (moved into the media queue on completion). */
    fun recordingFile(): File = outbox.stageFile("lesson-recording.m4a")

    /**
     * Deletes a lesson, offline-first (web services/lessonDeletes.ts): gone from this phone at once (its row,
     * its local completions, its half-done run), `DELETE /api/custom-lessons/:id` through the Outbox (now when
     * online, else on the next sync). Until the server's list stops carrying it, every refresh leaves it out
     * ([DELETES]) — it never comes back, not as a row, not as a revision.
     */
    suspend fun delete(id: String): Unit = lock.withLock {
        cache.put(DELETES, KIND, (cache.get(DELETES, deletesSerializer).orEmpty() + id).distinct(), deletesSerializer)
        cache.put(LIST, KIND, cache.get(LIST, listSerializer).orEmpty().filter { it.id != id }, listSerializer)
        cache.put(LOCAL, KIND, cache.get(LOCAL, localSerializer).orEmpty().filter { it.lessonId != id }, localSerializer)
        progress?.clear(id, deleteRecordings = true)
        outbox.enqueue("lessons", "DELETE", "/api/custom-lessons/$id", null, id = "delete-lesson-$id")
        Unit
    }

    /**
     * The row menu's "Stop revising — done for good" (action "retire") and its Undo ("restore"): a
     * revisit mark (local at once, uploaded through the outbox) — the lesson is done forever until a
     * restore (core LessonRevision). docs/STUDY_SESSION.md "Row menu".
     */
    suspend fun markDone(lessonId: String, action: String = RevisitStore.RETIRE) {
        revisit.mark("lesson", lessonId, action, source = "row_menu", track = false)
    }

    /**
     * `syncCustomLessons` (after the outbox has sent the completions): recordings, then the
     * list with every completion; local events the server has now are dropped, as are
     * events of lessons deleted on the server.
     */
    suspend fun sync(prefetch: Boolean = true, online: Boolean = true) {
        lock.withLock { refreshLocked() }
        // Outside the lock: a slow prefetch must never hold up rating a lesson.
        if (prefetch) prefetchMedia(online)
    }

    private suspend fun refreshLocked() {
        uploadMedia()
        // Deleted here, not yet on the server: left out; forgotten once the server's list no longer has it.
        val fetched = api.customLessons().lessons
        val deleted = cache.get(DELETES, deletesSerializer).orEmpty()
        if (deleted.isNotEmpty()) {
            val onServerIds = fetched.mapTo(HashSet()) { it.id }
            val stillThere = deleted.filter { it in onServerIds }
            if (stillThere.size != deleted.size) cache.put(DELETES, KIND, stillThere, deletesSerializer)
        }
        val list = fetched.filter { it.id !in deleted }
        cache.put(LIST, KIND, list, listSerializer)
        val onServer = list.flatMap { l -> l.completions.map { it.id } }.toHashSet()
        val ids = list.mapTo(HashSet()) { it.id }
        val pending = outbox.all().filter { it.kind == "lessons" && it.state == Outbox.PENDING }.mapTo(HashSet()) { it.id }
        val local = cache.get(LOCAL, localSerializer).orEmpty()
        val kept = local.filter { it.id !in onServer && (it.lessonId in ids || it.id in pending) }
        if (kept.size != local.size) cache.put(LOCAL, KIND, kept, localSerializer)
        // Unlocks: forget the ones the server's list carries now (and those of lessons gone), unless still queued.
        val unlocksPending = outbox.all().any { it.kind == UNLOCK_KIND && it.state == Outbox.PENDING }
        val unlockedOnServer = list.filter { !it.unlockedAt.isNullOrEmpty() }.mapTo(HashSet()) { it.id }
        val unlocks = cache.get(UNLOCKS, unlocksSerializer).orEmpty()
        val keptUnlocks = unlocks.filter { it.lessonId in ids && (it.lessonId !in unlockedOnServer || unlocksPending) }
        if (keptUnlocks.size != unlocks.size) cache.put(UNLOCKS, KIND, keptUnlocks, unlocksSerializer)
    }

    /** `uploadLessonAttemptMedia`: PUT each recording by media key; 404 waits, 400/413 give up. */
    suspend fun uploadMedia() {
        val queue = cache.get(MEDIA, mediaSerializer).orEmpty()
        if (queue.isEmpty()) return
        val out = ArrayList<PendingMedia>()
        for (m in queue) {
            if (m.synced) { out += m; continue }
            val file = File(m.path)
            if (!file.exists()) continue
            val code = try {
                api.putAttemptMedia(m.attemptId, m.mediaKey, file, m.mime)
            } catch (e: IOException) {
                if (e is dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException) throw e
                out += m.copy(error = e.message)
                continue
            }
            out += if (code in 200..299) {
                m.copy(synced = true, error = null)
            } else {
                val attempts = m.attempts + 1
                val giveUp = code == 413 || code == 400 || attempts >= 20
                m.copy(attempts = attempts, error = "HTTP $code", synced = giveUp)
            }
        }
        // Uploaded recordings stay on the device for two weeks (the learner may replay them).
        val cutoff = System.currentTimeMillis() - UPLOADED_TTL_MS
        val kept = out.filter { m -> !(m.synced && m.createdAt < cutoff).also { old -> if (old) File(m.path).delete() } }
        cache.put(MEDIA, KIND, kept, mediaSerializer)
    }

    suspend fun pendingMediaCount(): Int = cache.get(MEDIA, mediaSerializer).orEmpty().count { !it.synced }

    /**
     * `lessonsForPrefetch`: the lessons whose audio the sync keeps on the phone (core
     * `LessonAudioClips.lessonsToPrefetch`) — today's, every lesson with open homework (a one-off
     * pass is never in today's rotation, so it was never prefetched), the locked / unlocked ones
     * and the next few new ones.
     */
    suspend fun lessonsForPrefetch(cutoff: StudyCutoff): List<LessonEntry> {
        val all = entries()
        val byId = all.associateBy { it.id }
        val ids = dev.jeromeswannack.chineselearning.lab.core.LessonAudioClips.lessonsToPrefetch(
            todays = lessonsToDo(cutoff).map { it.id },
            homework = homework.refs(),
            lessons = all.map { dev.jeromeswannack.chineselearning.lab.core.LessonAudioClips.PrefetchRow(it.id, it.lesson.createdAt, it.learn.runs, it.retired, it.lockStatus) },
        )
        return ids.mapNotNull { byId[it] }
    }

    /**
     * `prefetchCustomLessonMedia`: every clip a coming-up lesson can play (core `LessonAudioClips`
     * — default-voice texts and conversation lines in this account's voices / speed / delivery),
     * [LessonAudioPrefetcher.CONCURRENCY] at a time, so each plays the moment it is asked for; stroke
     * data for handwriting and every lesson's pictures.
     */
    suspend fun prefetchMedia(online: Boolean) {
        if (!online) return
        val cutoff = dev.jeromeswannack.chineselearning.lab.core.StudyQueue.cutoff(System.currentTimeMillis(), java.time.ZoneId.systemDefault())
        val due = lessonsForPrefetch(cutoff)
        // Stroke-order data for handwriting, so the writing pad checks strokes offline.
        val handwritten = due.flatMap { dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz.writableCharacters(Lessons.handwritingText(it.lesson.spec)) }.distinct()
        if (handwritten.isNotEmpty()) runCatching { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore(File(filesDir, "strokes")).prefetch(handwritten) }
        val voices = ConversationVoiceCache.get(cache)
        val audio = ConversationAudioCache.get(cache)
        for (entry in due) {
            val clips = dev.jeromeswannack.chineselearning.lab.core.LessonAudioClips.lessonClips(entry.lesson.spec) { ConversationAudioCache.resolve(audio, voices, it) }
            LessonAudioPrefetcher(clips, isCached = { media.cachedClip(it) != null }, fetch = { media.clip(it, online = true) != null }).run()
        }
        // Pictures of EVERY lesson on the phone, not only today's: homework-only lessons skip
        // the session mix, and a picture drawn after the lesson first synced arrives with a later
        // sync (its key written in server-side).
        for (entry in entries()) {
            for (key in dev.jeromeswannack.chineselearning.lab.core.LessonImages.keys(entry.lesson.spec)) media.image(key, online = true)
        }
        // Hourly: pictures the server has drawn since go into this account's lessons, missing
        // ones are queued, and the catalogue samples' pictures come down.
        runCatching { pictures.topUpIfDue() }
    }

    companion object {
        const val KIND = "lessons"
        const val LIST = "lessons/list"
        const val LOCAL = "lessons/local-completions"
        const val MEDIA = "lessons/media-queue"
        const val UNLOCKS = "lessons/local-unlocks"
        /** Lessons deleted on this phone whose DELETE the server hasn't confirmed (left out of every refresh). */
        const val DELETES = "lessons/pending-deletes"
        const val LISTENS = "audio-lessons/listened"
        /** Outbox kind of unlocks and listens (`POST /api/custom-lessons/unlock`, `/api/audio-lessons/listened`). */
        const val UNLOCK_KIND = "lesson-unlocks"
        private const val UPLOADED_TTL_MS = 14L * 24 * 60 * 60 * 1000
        private val lock = Mutex()
    }
}
