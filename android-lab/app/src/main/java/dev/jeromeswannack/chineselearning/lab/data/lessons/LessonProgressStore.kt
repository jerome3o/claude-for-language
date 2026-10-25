package dev.jeromeswannack.chineselearning.lab.data.lessons

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.ExerciseAttempt
import dev.jeromeswannack.chineselearning.lab.core.LessonRun
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

/** A recording made in an exercise already answered (its staged file on the phone). */
@Serializable
data class SavedRecording(@SerialName("media_key") val mediaKey: String, val path: String, val mime: String)

/**
 * A half-done run of a mini lesson (web: services/lessonRuns.ts `SavedLessonRun`; rules in core
 * [LessonRun]): where it stands (main pass / retry round), the score so far, every answer (the
 * attempt rows) and the recordings already made.
 */
@Serializable
data class SavedLessonRun(
    @SerialName("lesson_id") val lessonId: String,
    /** [LessonRun.shape] when it was saved. */
    val shape: String,
    /** "full" | "revision". */
    val mode: String = "full",
    /** A revision's scored keys; null = the whole lesson. */
    val keys: List<String>? = null,
    val state: LessonRun.State = LessonRun.NEW_RUN,
    val correct: Int = 0,
    val total: Int = 0,
    @SerialName("started_at") val startedAt: Long,
    @SerialName("saved_at") val savedAt: Long,
    val attempts: List<ExerciseAttempt> = emptyList(),
    val recordings: List<SavedRecording> = emptyList(),
)

/**
 * Half-done mini lessons on this phone: one saved run per lesson in SharedPreferences, written
 * after every exercise, so closing the app — or the process dying — keeps it. A run continues
 * until it is finished ([LessonStore.complete]) or "Start over" — across days, restarts and
 * offline (Jerome, Oct 2026: a half-done homework lesson reopened the next day had reset: runs
 * used to be dropped on another local day, after 18 h, or when the spec's JSON changed at all).
 * Keyed on the lesson's SHAPE ([LessonRun.shape]), so a picture drawn later or a pinyin fix keeps
 * it. Local only: nothing goes to the server until the run is finished.
 */
class LessonProgressStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }

    private fun raw(lessonId: String): SavedLessonRun? =
        sp.getString(KEY + lessonId, null)?.let { runCatching { json.decodeFromString(SavedLessonRun.serializer(), it) }.getOrNull() }

    /**
     * The run to continue for this lesson (null = start fresh). One that can't continue (another
     * lesson shape, nothing answered) is cleared here, recordings too. Never bounded by date.
     */
    @Synchronized
    fun restore(lessonId: String, shape: String): SavedLessonRun? {
        val saved = raw(lessonId) ?: return null
        if (!LessonRun.canResume(saved.lessonId, saved.shape, saved.state, lessonId, shape)) {
            clear(lessonId, deleteRecordings = true)
            return null
        }
        return saved.copy(recordings = saved.recordings.filter { File(it.path).exists() })
    }

    /** After every exercise: where the run stands. */
    @Synchronized
    fun save(run: SavedLessonRun) {
        sp.edit().putString(KEY + run.lessonId, json.encodeToString(SavedLessonRun.serializer(), run)).apply()
        changes.value++
    }

    /**
     * Forget the saved run. [deleteRecordings]: "Start over" / can't continue (the takes are thrown
     * away); a completion keeps them — they have moved to the upload queue.
     */
    @Synchronized
    fun clear(lessonId: String, deleteRecordings: Boolean = false) {
        if (deleteRecordings) raw(lessonId)?.recordings?.forEach { File(it.path).delete() }
        sp.edit().remove(KEY + lessonId).apply()
        changes.value++
    }

    fun has(lessonId: String): Boolean = sp.contains(KEY + lessonId)

    /** Runs in progress on this phone (Mini Lessons' "▶ Continue"). */
    fun inProgress(): Map<String, SavedLessonRun> =
        sp.all.keys.filter { it.startsWith(KEY) }.mapNotNull { raw(it.removePrefix(KEY)) }.associateBy { it.lessonId }

    init {
        // Before Oct 2026: runs saved by day + spec hash, and "opened today" marks — neither is read any more.
        val stale = sp.all.keys.filter { it.startsWith(LEGACY_KEY) || it.startsWith(LEGACY_STARTED) }
        if (stale.isNotEmpty()) sp.edit().apply { stale.forEach { remove(it) } }.apply()
    }

    companion object {
        /** Bumped on every save / clear: the rows' retry bars (Home, /homework, Mini Lessons) follow it. */
        val changes = kotlinx.coroutines.flow.MutableStateFlow(0)

        /**
         * The retry bar of each lesson with a run in progress (core LessonRun.savedRunBar), by lesson id —
         * the bar on its row; a lesson not started has none.
         */
        fun runBars(runs: Map<String, SavedLessonRun>, specs: Map<String, CustomLessonSpec>, skipHandwriting: Boolean): Map<String, dev.jeromeswannack.chineselearning.lab.core.RetryBar?> =
            runs.mapNotNull { (id, run) ->
                val spec = specs[id] ?: return@mapNotNull null
                id to LessonRun.savedRunBar(run.lessonId, run.shape, run.state, run.keys, id, spec.sections.map { s -> s.exercises.map { it.type } }, skipHandwriting)
            }.toMap()

        private const val PREFS = "lab_lesson_progress"
        private const val KEY = "run/"
        private const val LEGACY_KEY = "progress/"
        private const val LEGACY_STARTED = "started/"

        @Volatile private var instance: LessonProgressStore? = null
        fun get(context: Context): LessonProgressStore = instance ?: synchronized(this) {
            instance ?: LessonProgressStore(context).also { instance = it }
        }

        /** The lesson's shape: its exercise types in order (a saved run continues while it is unchanged). */
        fun shape(spec: CustomLessonSpec): String = LessonRun.shape(spec)
    }
}
