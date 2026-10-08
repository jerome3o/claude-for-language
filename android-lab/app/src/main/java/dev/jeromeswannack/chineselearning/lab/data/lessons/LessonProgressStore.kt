package dev.jeromeswannack.chineselearning.lab.data.lessons

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonResume
import kotlinx.serialization.json.Json
import java.io.File
import java.time.Instant
import java.time.ZoneId

/**
 * Half-done mini lessons on this phone (core [LessonResume] has the rules): one saved run per
 * lesson in SharedPreferences, written after every exercise, so closing the app — or the
 * process dying — keeps it. Local only: nothing goes to the server until the lesson is
 * completed. Cleared by completing the lesson ([LessonStore.complete]), "Start over", or as
 * soon as it's read on another day / after [LessonResume.MAX_AGE_MS] / for an edited spec.
 */
class LessonProgressStore(context: Context, private val zone: () -> ZoneId = { ZoneId.systemDefault() }) {
    private val sp = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    fun today(nowMs: Long = System.currentTimeMillis()): String = Instant.ofEpochMilli(nowMs).atZone(zone()).toLocalDate().toString()

    private fun raw(lessonId: String): LessonResume.Progress? =
        sp.getString(KEY + lessonId, null)?.let { runCatching { json.decodeFromString(LessonResume.Progress.serializer(), it) }.getOrNull() }

    /**
     * The run to continue for this lesson (null = start fresh). A saved run that can't be
     * continued any more (other spec, other day, too old) is cleared here, recordings too.
     */
    @Synchronized
    fun restore(lessonId: String, specHash: String, exerciseCount: Int, nowMs: Long = System.currentTimeMillis()): LessonResume.Progress? {
        val saved = raw(lessonId) ?: return null
        val ok = LessonResume.restorable(saved, lessonId, specHash, today(nowMs), nowMs, exerciseCount)
        if (ok == null) clear(lessonId, deleteRecordings = true)
        return ok?.let { p -> p.copy(recordings = p.recordings.filter { File(it.path).exists() }) }
    }

    /** After every exercise: where the run stands. */
    @Synchronized
    fun save(
        lessonId: String,
        specHash: String,
        index: Int,
        correct: Int,
        total: Int,
        startedAt: Long,
        attempts: List<ExerciseAttempt>,
        recordings: List<LessonRecording>,
        nowMs: Long = System.currentTimeMillis(),
    ) {
        val p = LessonResume.Progress(
            lessonId, specHash, today(nowMs), nowMs, startedAt, index, correct, total, attempts,
            recordings.map { LessonResume.SavedRecording(it.mediaKey, it.file.absolutePath, it.mime) },
        )
        sp.edit().putString(KEY + lessonId, json.encodeToString(LessonResume.Progress.serializer(), p)).apply()
    }

    /**
     * Forget the saved run. [deleteRecordings]: "Start over" / stale (the takes are thrown
     * away); a completion keeps them — they have moved to the upload queue.
     */
    @Synchronized
    fun clear(lessonId: String, deleteRecordings: Boolean = false) {
        if (deleteRecordings) raw(lessonId)?.recordings?.forEach { File(it.path).delete() }
        sp.edit().remove(KEY + lessonId).apply()
    }

    fun has(lessonId: String): Boolean = sp.contains(KEY + lessonId)

    /**
     * A real run of [lessonId] was opened (session, Home / today's list, homework pass, Mini
     * Lessons ▶): the lesson is today's from now on — leaving it, even on its intro, never drops
     * it from today (`pickNewLessonsForToday`'s startedToday). Nothing reaches the server.
     */
    @Synchronized
    fun markStarted(lessonId: String, nowMs: Long = System.currentTimeMillis()) {
        val day = today(nowMs)
        val edit = sp.edit()
        for ((k, v) in sp.all) if (k.startsWith(STARTED) && v != day) edit.remove(k)
        edit.putString(STARTED + lessonId, day).apply()
    }

    /** Lessons opened on today's local date. */
    fun startedToday(nowMs: Long = System.currentTimeMillis()): Set<String> {
        val day = today(nowMs)
        return sp.all.filter { (k, v) -> k.startsWith(STARTED) && v == day }.keys.mapTo(HashSet()) { it.removePrefix(STARTED) }
    }

    /** Opened earlier today (before this run): the player says it's picking today's lesson up again. */
    fun startedTodayBefore(lessonId: String, nowMs: Long = System.currentTimeMillis()): Boolean = sp.getString(STARTED + lessonId, null) == today(nowMs)

    companion object {
        private const val PREFS = "lab_lesson_progress"
        private const val KEY = "progress/"
        private const val STARTED = "started/"
        private val specJson = Json { encodeDefaults = true }

        @Volatile private var instance: LessonProgressStore? = null
        fun get(context: Context): LessonProgressStore = instance ?: synchronized(this) {
            instance ?: LessonProgressStore(context).also { instance = it }
        }

        /** The spec's identity: an edited or pushed-update lesson doesn't restore stale positions. */
        fun specHash(spec: CustomLessonSpec): String = LessonResume.specHash(specJson.encodeToString(CustomLessonSpec.serializer(), spec))
    }
}
