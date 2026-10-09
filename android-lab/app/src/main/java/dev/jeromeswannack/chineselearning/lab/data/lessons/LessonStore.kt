package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonSchedule
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlock
import dev.jeromeswannack.chineselearning.lab.core.LessonUnlocks
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.LessonUnlockUpload
import dev.jeromeswannack.chineselearning.lab.data.api.LessonUnlockUploadBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListenedBody
import dev.jeromeswannack.chineselearning.lab.data.api.ListenedEvent
import dev.jeromeswannack.chineselearning.lab.core.Lessons
import dev.jeromeswannack.chineselearning.lab.core.RevisitMark
import dev.jeromeswannack.chineselearning.lab.core.RevisitSettings
import dev.jeromeswannack.chineselearning.lab.core.RevisitState
import dev.jeromeswannack.chineselearning.lab.core.ScheduledItem
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
    val rating: Int?,
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

/** A cached lesson with its merged completion history and replayed "revisit later" state. */
data class LessonEntry(
    val lesson: CustomLessonDto,
    val events: List<ItemEvent>,
    val state: RevisitState,
    /** The account's gaps the state was replayed with (for the rating buttons' labels). */
    val settings: RevisitSettings = dev.jeromeswannack.chineselearning.lab.core.Revisit.DEFAULT,
    /** When it was unlocked: the server's, or this phone's pending unlock (the earliest). */
    val unlockedAt: String? = lesson.unlockedAt,
) {
    val id: String get() = lesson.id
    val item: ScheduledItem get() = ScheduledItem(lesson.id, lesson.createdAt, state)
    val reps: Int get() = state.finishes
    val retired: Boolean get() = state.isRetired
    /** Unlockable lessons (core LessonUnlocks): the condition, null = none. */
    val unlock: LessonUnlock? get() = lesson.unlockCondition
    /** "none" | "locked" | "unlocked". */
    val lockStatus: String get() = LessonUnlocks.status(unlock, unlockedAt)
    val locked: Boolean get() = lockStatus == "locked"
    val unlockItem: LessonUnlocks.Item get() = LessonUnlocks.Item(id, unlock, unlockedAt)
}

/**
 * Offline store for custom mini lessons — the web's services/custom-lesson-study.ts on
 * the Lab platform: the lesson list (spec + server completions) lives in the JsonCache,
 * completions made here are appended locally and sent through the Outbox
 * (`POST /api/custom-lessons/offline-complete`, idempotent by event id, carrying the
 * attempt), recordings queue in their own list and go up by media key once their
 * attempt is on the server (a 404 means "not yet"). The "revisit later" schedule is always
 * replayed from the merged events + the Done-for-good / Bring-back marks ([RevisitStore]).
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
    /** Done for good / Bring back and the account's gaps ("revisit later"). */
    val revisit = RevisitStore(cache, outbox, api)

    private val unlocksSerializer = ListSerializer(LocalUnlock.serializer())
    private val listensSerializer = ListSerializer(LocalListen.serializer())

    fun observe(): Flow<List<LessonEntry>> =
        combine(cache.observe(LIST, listSerializer), cache.observe(LOCAL, localSerializer), revisit.observeMarks(), revisit.observeSettings(), cache.observe(UNLOCKS, unlocksSerializer)) { list, local, marks, settings, unlocks ->
            merge(list.orEmpty(), local.orEmpty(), marks, settings, unlocks.orEmpty())
        }.flowOn(Dispatchers.Default)

    suspend fun entries(): List<LessonEntry> =
        merge(cache.get(LIST, listSerializer).orEmpty(), cache.get(LOCAL, localSerializer).orEmpty(), revisit.marks(), revisit.settings(), cache.get(UNLOCKS, unlocksSerializer).orEmpty())

    suspend fun hasCache(): Boolean = cache.entry(LIST) != null

    suspend fun entry(id: String): LessonEntry? = entries().firstOrNull { it.id == id }

    /**
     * `getDueCustomLessons` over the cache — `pickTodaysLessons` (LessonSchedule.todaysLessons):
     * revisits capped per day, homework lessons on top of "New lessons a day", lessons opened
     * today ([startedToday]) kept, Done-for-good out.
     */
    suspend fun dueLessons(
        cutoff: StudyCutoff,
        nowMs: Long = System.currentTimeMillis(),
        zone: java.time.ZoneId = java.time.ZoneId.systemDefault(),
        startedToday: Set<String> = emptySet(),
    ): List<LessonEntry> {
        val all = entries()
        val byId = all.associateBy { it.id }
        val oneOff = homework.oneOffOnly()
        val events = all.flatMap { it.events }
        val revisited = LessonSchedule.revisitsToday(events, nowMs, zone)
        val dayStart = java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()
        val perDay = revisit.settings().newLessonsPerDayInt
        // Locked lessons wait; unlocked new ones come today on top of the daily place.
        val (locked, unlocked) = LessonUnlocks.lockSets(all.map { it.unlockItem })
        return LessonSchedule.todaysLessons(all.map { it.item }, events, dayStart, cutoff, oneOff, homework.homeworkPass(), startedToday, revisited, perDay, locked, unlocked)
            .mapNotNull { byId[it.id] }
    }

    private fun merge(list: List<CustomLessonDto>, local: List<LocalCompletion>, marks: List<RevisitMark>, settings: RevisitSettings, unlocks: List<LocalUnlock> = emptyList()): List<LessonEntry> {
        val localByLesson = local.groupBy { it.lessonId }
        val marksByLesson = marks.filter { it.itemKind == "lesson" }.groupBy { it.itemId }
        val unlockByLesson = unlocks.associateBy { it.lessonId }
        return list.map { lesson ->
            val server = lesson.completions.map { ItemEvent(it.id, it.lessonId, it.rating, it.completedAt) }
            val seen = server.mapTo(HashSet()) { it.id }
            val mine = localByLesson[lesson.id].orEmpty().filter { it.id !in seen }.map { ItemEvent(it.id, it.lessonId, it.rating, it.completedAt) }
            val events = server + mine
            val unlockedAt = if (lesson.unlock == null) null else LessonUnlocks.earlier(lesson.unlockedAt, unlockByLesson[lesson.id]?.unlockedAt)
            LessonEntry(lesson, events, ItemSchedule.state(events, marksByLesson[lesson.id].orEmpty(), settings), settings, unlockedAt)
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

    /** "✓ Done for good" / "↩ Bring back" from the Mini Lessons list (`markRevisit`). */
    suspend fun markRevisit(lessonId: String, action: String, source: String = "list") {
        revisit.mark("lesson", lessonId, action, source)
    }

    /**
     * `completeCustomLesson`: append the rated completion (with its attempt) and queue it for
     * upload; recordings wait in the media queue; the homework assignment is marked done.
     * [retire] = "Done for good": finished, and never scheduled again (a retire event too).
     * Returns the new "revisit later" state.
     */
    suspend fun complete(
        lessonId: String,
        correct: Int,
        total: Int,
        rating: Int,
        attempt: LessonAttemptData?,
        recordings: List<LessonRecording>,
        nowMs: Long = System.currentTimeMillis(),
        retire: Boolean = false,
        source: String = "session",
    ): RevisitState = lock.withLock {
        val now = Js.toIsoString(nowMs)
        val id = UUID.randomUUID().toString()
        val event = LocalCompletion(id, lessonId, correct, total, now, rating)
        cache.put(LOCAL, KIND, cache.get(LOCAL, localSerializer).orEmpty() + event, localSerializer)
        outbox.enqueueJson(
            "lessons", "POST", "/api/custom-lessons/offline-complete",
            CompletionUploadBody(listOf(CompletionUpload(id, lessonId, correct, total, now, rating, attempt))),
            id = id,
        )
        if (recordings.isNotEmpty()) {
            val queued = cache.get(MEDIA, mediaSerializer).orEmpty() + recordings.map { PendingMedia(id, it.mediaKey, it.file.absolutePath, it.mime, nowMs) }
            cache.put(MEDIA, KIND, queued, mediaSerializer)
        }
        if (retire) revisit.mark("lesson", lessonId, RevisitStore.RETIRE, source, nowMs)
        homework.recordDone("lesson", lessonId)
        // Completed: the half-done run is over (its recordings now wait in the media queue).
        progress?.clear(lessonId, deleteRecordings = false)
        entries().firstOrNull { it.id == lessonId }?.state ?: RevisitState.INITIAL
    }

    /** Where the player records an oral answer (moved into the media queue on completion). */
    fun recordingFile(): File = outbox.stageFile("lesson-recording.m4a")

    /** Deletes a lesson on the server, then locally. */
    suspend fun delete(id: String) {
        api.deleteCustomLesson(id)
        cache.put(LIST, KIND, cache.get(LIST, listSerializer).orEmpty().filter { it.id != id }, listSerializer)
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
        val list = api.customLessons().lessons
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

    /** `prefetchCustomLessonMedia`: every clip and illustration of the lessons coming up. */
    suspend fun prefetchMedia(online: Boolean) {
        if (!online) return
        val cutoff = dev.jeromeswannack.chineselearning.lab.core.StudyQueue.cutoff(System.currentTimeMillis(), java.time.ZoneId.systemDefault())
        // Locked lessons too: one is often unlocked on the train, right after its podcast.
        val due = dueLessons(cutoff).let { d -> d + entries().filter { e -> e.locked && d.none { it.id == e.id } } }
        // Stroke-order data for handwriting, so the writing pad checks strokes offline.
        val handwritten = due.flatMap { dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz.writableCharacters(Lessons.handwritingText(it.lesson.spec)) }.distinct()
        if (handwritten.isNotEmpty()) runCatching { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore(File(filesDir, "strokes")).prefetch(handwritten) }
        val voices = ConversationVoiceCache.get(cache)
        val audio = ConversationAudioCache.get(cache)
        for (entry in due) {
            for (text in Lessons.ttsTexts(entry.lesson.spec)) {
                if (text.isBlank()) continue
                media.tts(text, online = true)
            }
            // Conversation lines in this account's voices / speed / delivery (the ⚙︎ Audio menu).
            val clips = dev.jeromeswannack.chineselearning.lab.core.ConversationAudio.lessonClips(entry.lesson.spec) { ConversationAudioCache.resolve(audio, voices, it) }
            for (clip in clips) media.conversationLine(clip, online = true)
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
        const val LISTENS = "audio-lessons/listened"
        /** Outbox kind of unlocks and listens (`POST /api/custom-lessons/unlock`, `/api/audio-lessons/listened`). */
        const val UNLOCK_KIND = "lesson-unlocks"
        private const val UPLOADED_TTL_MS = 14L * 24 * 60 * 60 * 1000
        private val lock = Mutex()
    }
}
