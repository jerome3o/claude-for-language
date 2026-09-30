package dev.jeromeswannack.chineselearning.lab.data.lessons

import dev.jeromeswannack.chineselearning.lab.core.CardQueue
import dev.jeromeswannack.chineselearning.lab.core.ComputedCardState
import dev.jeromeswannack.chineselearning.lab.core.ItemEvent
import dev.jeromeswannack.chineselearning.lab.core.ItemSchedule
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.LessonSchedule
import dev.jeromeswannack.chineselearning.lab.core.Lessons
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
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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

/** A cached lesson with its merged completion history and replayed FSRS state. */
data class LessonEntry(val lesson: CustomLessonDto, val events: List<ItemEvent>, val state: ComputedCardState) {
    val id: String get() = lesson.id
    val item: ScheduledItem get() = ScheduledItem(lesson.id, lesson.createdAt, state)
    val reps: Int get() = state.reps
}

/**
 * Offline store for custom mini lessons — the web's services/custom-lesson-study.ts on
 * the Lab platform: the lesson list (spec + server completions) lives in the JsonCache,
 * completions made here are appended locally and sent through the Outbox
 * (`POST /api/custom-lessons/offline-complete`, idempotent by event id, carrying the
 * attempt), recordings queue in their own list and go up by media key once their
 * attempt is on the server (a 404 means "not yet"). Scheduling is always replayed from
 * the merged events.
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

    fun observe(): Flow<List<LessonEntry>> =
        combine(cache.observe(LIST, listSerializer), cache.observe(LOCAL, localSerializer)) { list, local -> merge(list.orEmpty(), local.orEmpty()) }

    suspend fun entries(): List<LessonEntry> = merge(cache.get(LIST, listSerializer).orEmpty(), cache.get(LOCAL, localSerializer).orEmpty())

    suspend fun hasCache(): Boolean = cache.entry(LIST) != null

    suspend fun entry(id: String): LessonEntry? = entries().firstOrNull { it.id == id }

    /** `getDueCustomLessons` over the cache. */
    suspend fun dueLessons(cutoff: StudyCutoff): List<LessonEntry> {
        val all = entries()
        val byId = all.associateBy { it.id }
        return LessonSchedule.dueLessons(all.map { it.item }, homework.oneOffOnly(), cutoff).mapNotNull { byId[it.id] }
    }

    private fun merge(list: List<CustomLessonDto>, local: List<LocalCompletion>): List<LessonEntry> {
        val localByLesson = local.groupBy { it.lessonId }
        return list.map { lesson ->
            val server = lesson.completions.map { ItemEvent(it.id, it.lessonId, it.rating, it.completedAt) }
            val seen = server.mapTo(HashSet()) { it.id }
            val mine = localByLesson[lesson.id].orEmpty().filter { it.id !in seen }.map { ItemEvent(it.id, it.lessonId, it.rating, it.completedAt) }
            val events = server + mine
            LessonEntry(lesson, events, ItemSchedule.state(events))
        }
    }

    /**
     * `completeCustomLesson`: append the rated completion (with its attempt) and queue it for
     * upload; recordings wait in the media queue; the homework assignment is marked done.
     * Returns the new scheduling state.
     */
    suspend fun complete(
        lessonId: String,
        correct: Int,
        total: Int,
        rating: Int,
        attempt: LessonAttemptData?,
        recordings: List<LessonRecording>,
        nowMs: Long = System.currentTimeMillis(),
    ): ComputedCardState = lock.withLock {
        val now = Js.toIsoString(nowMs)
        val before = entries().firstOrNull { it.id == lessonId }?.events.orEmpty()
        val newState = ItemSchedule.afterRating(before, rating, now)
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
        homework.recordDone("lesson", lessonId)
        // Completed: the half-done run is over (its recordings now wait in the media queue).
        progress?.clear(lessonId, deleteRecordings = false)
        newState
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
        val due = dueLessons(cutoff)
        // Stroke-order data for handwriting, so the writing pad checks strokes offline.
        val handwritten = due.flatMap { dev.jeromeswannack.chineselearning.lab.core.StrokeQuiz.writableCharacters(Lessons.handwritingText(it.lesson.spec)) }.distinct()
        if (handwritten.isNotEmpty()) runCatching { dev.jeromeswannack.chineselearning.lab.data.strokes.StrokeStore(File(filesDir, "strokes")).prefetch(handwritten) }
        val voices = ConversationVoiceCache.get(cache)
        for (entry in due) {
            for (clip in Lessons.ttsClips(entry.lesson.spec, voices)) {
                if (clip.text.isBlank()) continue
                media.tts(clip.text, clip.voice, speed = clip.speed ?: LessonMedia.DEFAULT_SPEED, online = true)
            }
        }
        // Pictures of EVERY lesson on the phone, not only today's: homework-only lessons skip
        // the FSRS mix, and a picture drawn after the lesson first synced arrives with a later
        // sync (its key written in server-side).
        for (entry in entries()) {
            for (key in dev.jeromeswannack.chineselearning.lab.core.LessonImages.keys(entry.lesson.spec)) media.image(key, online = true)
        }
        // Hourly: pictures the server has drawn since go into this account's lessons, missing
        // ones are queued, and the catalogue samples' pictures come down.
        runCatching { pictures.topUpIfDue() }
    }

    /** Cached queue state for the Mini Lessons chip. */
    fun isLearning(entry: LessonEntry) = CardQueue.isLearning(entry.state.queue)

    companion object {
        const val KIND = "lessons"
        const val LIST = "lessons/list"
        const val LOCAL = "lessons/local-completions"
        const val MEDIA = "lessons/media-queue"
        private const val UPLOADED_TTL_MS = 14L * 24 * 60 * 60 * 1000
        private val lock = Mutex()
    }
}
