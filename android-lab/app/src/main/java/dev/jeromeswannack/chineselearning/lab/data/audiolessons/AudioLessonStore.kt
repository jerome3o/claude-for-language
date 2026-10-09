package dev.jeromeswannack.chineselearning.lab.data.audiolessons

import android.content.Context
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonMusic
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.data.api.audioLesson
import dev.jeromeswannack.chineselearning.lab.data.api.audioLessons
import dev.jeromeswannack.chineselearning.lab.data.api.deleteAudioLesson
import dev.jeromeswannack.chineselearning.lab.data.api.downloadAudioLesson
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Audio lessons on the phone — the web's services/audioLessons.ts. The list and each ready
 * lesson's details (chapters, transcript, words) in the [JsonCache] (`audio-lessons/list`,
 * `audio-lessons/<id>`), the MP3 under `files/audio-lessons/<id>-<audio_version>.mp3` (a rebuilt
 * lesson gets a new version: the new file is downloaded and the old one deleted). A saved lesson
 * plays with no connection at all.
 */
class AudioLessonStore(private val cache: JsonCache, private val api: Api, filesDir: File) {
    val dir = File(filesDir, "audio-lessons")

    fun file(id: String, version: String): File = File(dir, "${safe(id)}-${safe(version)}.mp3")

    /** The saved file of this version, or null. */
    fun savedFile(id: String, version: String?): File? = version?.let { file(id, it) }?.takeIf { it.exists() && it.length() > 0 }

    /** Lesson ids with a saved file (any version) — the list's "✓ On this phone". */
    fun savedIds(lessons: List<AudioLessonDto>): Set<String> =
        lessons.filter { l -> filesOf(l.id).isNotEmpty() }.map { it.id }.toSet()

    private fun filesOf(id: String): List<File> =
        dir.listFiles { f -> f.name.startsWith("${safe(id)}-") && f.name.endsWith(".mp3") }?.toList().orEmpty()

    suspend fun cachedList(): List<AudioLessonDto> = cache.get<List<AudioLessonDto>>(LIST_KEY).orEmpty()

    suspend fun cachedDetail(id: String): AudioLessonDto? = cache.get<AudioLessonDto>(detailKey(id))

    /** `refreshLessonList` + forgetting lessons deleted elsewhere (details and files). */
    suspend fun storeList(lessons: List<AudioLessonDto>) {
        val ids = lessons.map { it.id }.toSet()
        for (old in cachedList()) if (old.id !in ids) forget(old.id)
        cache.put(LIST_KEY, KIND, lessons.map { it.summary() })
    }

    /** `rememberLessonInList`: a new / retried lesson at the top at once. */
    suspend fun remember(lesson: AudioLessonDto) {
        cache.put(LIST_KEY, KIND, listOf(lesson.summary()) + cachedList().filter { it.id != lesson.id })
    }

    /** `fetchLessonDetail`: fresh from the server; kept when ready. */
    suspend fun fetchDetail(id: String): AudioLessonDto {
        val lesson = api.audioLesson(id)
        if (lesson.ready) cache.put(detailKey(id), KIND, lesson)
        return lesson
    }

    /** The list, the details of every ready lesson not on the phone (or rebuilt) — what the sync does. */
    suspend fun refresh(): List<AudioLessonDto> {
        val lessons = api.audioLessons()
        storeList(lessons)
        for (l in lessons) {
            if (!l.ready) continue
            val have = cachedDetail(l.id)
            if (have == null || have.audio_version != l.audio_version || !have.hasDetail) runCatching { fetchDetail(l.id) }
        }
        return lessons
    }

    /** Downloads in flight on this phone (the player's or the sync's): lesson id → fraction (0 while the size is unknown). */
    val downloads: StateFlow<Map<String, Double>> get() = _downloads.asStateFlow()

    /**
     * `downloadLessonFile`: the saved file, else downloaded once (one download per lesson at a
     * time, shared by the player and the sync) and the other versions deleted.
     */
    suspend fun download(lesson: AudioLessonDto, onProgress: (Double, Long) -> Unit = { _, _ -> }): File {
        val version = lesson.audio_version ?: throw IllegalStateException("This lesson has no audio yet")
        savedFile(lesson.id, version)?.let { return it }
        return lock(lesson.id).withLock {
            savedFile(lesson.id, version)?.let { return@withLock it }
            val dest = file(lesson.id, version)
            _downloads.update { it + (lesson.id to 0.0) }
            try {
                api.downloadAudioLesson(lesson.id, dest) { fraction, bytes ->
                    _downloads.update { it + (lesson.id to fraction) }
                    onProgress(fraction, bytes)
                }
            } finally {
                _downloads.update { it - lesson.id }
            }
            withContext(Dispatchers.IO) { filesOf(lesson.id).filter { it.name != dest.name }.forEach { it.delete() } }
            Analytics.track("audio_lesson.download", mapOf("format" to lesson.format))
            dest
        }
    }

    /** Every ready lesson's file, so lessons play on the train without opening them first. */
    suspend fun downloadMissing(lessons: List<AudioLessonDto>) {
        for (l in lessons) {
            if (!l.ready || l.audio_version == null || savedFile(l.id, l.audio_version) != null) continue
            try {
                download(l)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                android.util.Log.w("AudioLessons", "couldn't save ${l.id}", e)
            }
        }
    }

    /** `deleteLessonEverywhere` (needs a connection). */
    suspend fun delete(id: String) {
        api.deleteAudioLesson(id)
        cache.put(LIST_KEY, KIND, cachedList().filter { it.id != id })
        forget(id)
    }

    private suspend fun forget(id: String) {
        cache.delete(detailKey(id))
        withContext(Dispatchers.IO) { filesOf(id).forEach { it.delete() } }
    }

    companion object {
        const val KIND = "audio-lessons"
        const val LIST_KEY = "audio-lessons/list"
        fun detailKey(id: String) = "audio-lessons/$id"

        private val _downloads = MutableStateFlow<Map<String, Double>>(emptyMap())
        private val locks = ConcurrentHashMap<String, Mutex>()
        private fun lock(id: String) = locks.getOrPut(id) { Mutex() }

        private fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_.]"), "_")

        /** The list keeps summaries only (the details are per lesson). */
        fun AudioLessonDto.summary() = copy(words = emptyList(), chapters = emptyList(), transcript = emptyList())

        fun of(ctx: SyncContext) = AudioLessonStore(ctx.cache, ctx.api, ctx.outbox.dir.parentFile ?: ctx.outbox.dir)
    }
}

/**
 * The sync step: the list (every 10 minutes, or on a full sync), the details of ready lessons,
 * and their files (Jerome: prefetch aggressively for the train; a lesson is ~5–10 MB).
 */
object AudioLessonsSync : FeatureSync {
    private const val REFRESH_EVERY_MS = 10 * 60 * 1000L

    override suspend fun sync(ctx: SyncContext) {
        val store = AudioLessonStore.of(ctx)
        val lessons = if (!ctx.full && ctx.cache.isFresh(AudioLessonStore.LIST_KEY, REFRESH_EVERY_MS)) store.cachedList() else store.refresh()
        store.downloadMissing(lessons)
    }
}

/** Per-device player memory: where each lesson stopped, and the speed (the web's localStorage keys). */
class AudioLessonPrefs(context: Context) {
    private val sp = context.getSharedPreferences("audio-lessons", Context.MODE_PRIVATE)

    fun position(id: String): Long = sp.getLong("pos:$id", 0L)

    fun savePosition(id: String, ms: Long) {
        sp.edit().putLong("pos:$id", ms.coerceAtLeast(0)).apply()
    }

    var speed: Double
        get() = AudioLessonTimeline.parseSpeed(sp.getFloat("speed", 1f).toDouble().let { f -> AudioLessonTimeline.SPEEDS.firstOrNull { kotlin.math.abs(it - f) < 0.001 } })
        set(v) { sp.edit().putFloat("speed", v.toFloat()).apply() }

    /** The music bed on / off for lessons of this format: the learner's last choice, else on for sleep, off for dialogue. */
    fun musicOn(format: String?): Boolean = AudioLessonMusic.parseOn(sp.getString("music-on:${format.orEmpty()}", null), format)

    fun setMusicOn(format: String?, on: Boolean) {
        sp.edit().putString("music-on:${format.orEmpty()}", if (on) "1" else "0").apply()
    }

    /** The transcript's 拼 / EN toggles (on until turned off; one choice for every lesson — the web's audio-lesson-transcript-*-v1). */
    var showPinyin: Boolean
        get() = sp.getBoolean("transcript-pinyin", true)
        set(v) { sp.edit().putBoolean("transcript-pinyin", v).apply() }
    var showEnglish: Boolean
        get() = sp.getBoolean("transcript-english", true)
        set(v) { sp.edit().putBoolean("transcript-english", v).apply() }

    /** The music's volume (0.05–1). */
    var musicVolume: Double
        get() = AudioLessonMusic.parseVolume(if (sp.contains("music-volume")) sp.getFloat("music-volume", 0f).toDouble() else null)
        set(v) { sp.edit().putFloat("music-volume", AudioLessonMusic.parseVolume(v).toFloat()).apply() }
}
