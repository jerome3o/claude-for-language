package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.AudioLessonChapter
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTranscriptLine
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonWord
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException
import kotlin.coroutines.coroutineContext

/* Audio lessons — the same endpoints as the web's api/audioLessons.ts (worker routes/audio-lessons.ts, docs/AUDIO_LESSONS.md). */

/**
 * AudioLessonSummary (`GET /api/audio-lessons`) and, from `GET /api/audio-lessons/:id`,
 * AudioLessonDetail (chapters, transcript, words; empty in the list).
 */
@Serializable
data class AudioLessonDto(
    val id: String,
    val format: String = "dialogue",
    val title: String = "",
    val status: String = "queued",
    val progress: String? = null,
    val progress_done: Int? = null,
    val progress_total: Int? = null,
    val error: String? = null,
    val duration_ms: Long? = null,
    val size_bytes: Long? = null,
    val word_count: Int = 0,
    /** Changes whenever the file changes: the phone's file name. */
    val audio_version: String? = null,
    val created_at: String = "",
    val finished_at: String? = null,
    val words: List<AudioLessonWord> = emptyList(),
    val chapters: List<AudioLessonChapter> = emptyList(),
    val transcript: List<AudioLessonTranscriptLine> = emptyList(),
    /** Story: "The text is long: this lesson covers the first …" when part of the text was left out. */
    val notice: String? = null,
    /** When a listen first reached the end (≥ 85 % or the last chapter, any device). */
    val listened_at: String? = null,
    /** Its companion mini lesson (shared/lesson/unlock.ts), if one was asked for. */
    val companion: AudioLessonCompanionDto? = null,
) {
    val ready: Boolean get() = status == "ready"
    val building: Boolean get() = AudioLessonTimeline.isBuilding(status)
    val statusLine: String get() = AudioLessonTimeline.statusLine(status, progress, progress_done, progress_total, error, duration_ms, word_count, size_bytes)
    val hasDetail: Boolean get() = chapters.isNotEmpty() || transcript.isNotEmpty()
}

/** AudioLessonCompanion: being written / failed, or made (locked / unlocked). */
@Serializable
data class AudioLessonCompanionDto(
    val status: String,
    val lesson_id: String? = null,
    val title: String? = null,
    val error: String? = null,
    val started: Boolean = false,
)

/** POST /api/audio-lessons/:id/companion-lesson. */
@Serializable data class CompanionRequestBody(val unlock: String? = null, val prompt: String? = null)
@Serializable data class CompanionRequestDto(val companion: AudioLessonCompanionDto? = null, val existing: Boolean = false, val started: Boolean = false)

/** POST /api/audio-lessons/listened. */
@Serializable data class ListenedEvent(val audio_lesson_id: String, val listened_at: String)
@Serializable data class ListenedBody(val events: List<ListenedEvent>)

@Serializable data class AudioLessonListDto(val lessons: List<AudioLessonDto> = emptyList())
@Serializable data class AudioLessonEnvelopeDto(val lesson: AudioLessonDto)

/** POST /api/audio-lessons → the lesson, and for a story: how many lines, and `notice` when only its first part fits. */
@Serializable data class AudioLessonCreatedDto(val lesson: AudioLessonDto, val notice: String? = null, val chunks: Int? = null)

/** NewAudioLesson (POST /api/audio-lessons). */
@Serializable
data class NewAudioLessonBody(
    val format: String,
    val description: String? = null,
    val dialogue: String? = null,
    val text: String? = null,
    val title: String? = null,
    val target_minutes: Int? = null,
)

object AudioLessonPaths {
    const val LIST = "/api/audio-lessons"
    fun lesson(id: String) = "/api/audio-lessons/${enc(id)}"
    fun audio(id: String) = "/api/audio-lessons/${enc(id)}/audio"
    fun retry(id: String) = "/api/audio-lessons/${enc(id)}/retry"
    fun companion(id: String) = "/api/audio-lessons/${enc(id)}/companion-lesson"
    const val LISTENED = "/api/audio-lessons/listened"
}

suspend fun Api.audioLessons(): List<AudioLessonDto> = get<AudioLessonListDto>(AudioLessonPaths.LIST).lessons
suspend fun Api.audioLesson(id: String): AudioLessonDto = get<AudioLessonEnvelopeDto>(AudioLessonPaths.lesson(id)).lesson
suspend fun Api.createAudioLesson(body: NewAudioLessonBody): AudioLessonCreatedDto = post<NewAudioLessonBody, AudioLessonCreatedDto>(AudioLessonPaths.LIST, body)
suspend fun Api.retryAudioLesson(id: String): AudioLessonDto = post<AudioLessonEnvelopeDto>(AudioLessonPaths.retry(id)).lesson
/** Ask for its companion mini lesson (written in the background). */
suspend fun Api.requestCompanionLesson(id: String, body: CompanionRequestBody = CompanionRequestBody()): CompanionRequestDto =
    post<CompanionRequestBody, CompanionRequestDto>(AudioLessonPaths.companion(id), body)
suspend fun Api.deleteAudioLesson(id: String) {
    val res = send("DELETE", AudioLessonPaths.lesson(id))
    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
}

/**
 * PodcastFeedInfo (`GET /api/me/podcast-feed`, worker routes/podcast.ts): the private RSS link of
 * every ready lesson for a podcast app. [url] is the only credential — never logged or cached.
 */
@Serializable
data class PodcastFeedDto(
    val url: String? = null,
    val podcast_url: String? = null,
    val apple_url: String? = null,
    val created_at: String = "",
    val rotated_at: String? = null,
    val last_fetched_at: String? = null,
    val fetch_count: Int = 0,
)

@Serializable data class PodcastFeedEnvelopeDto(val feed: PodcastFeedDto)

object PodcastFeedPaths {
    const val FEED = "/api/me/podcast-feed"
    const val RESET = "/api/me/podcast-feed/reset"
}

/** The feed, made on first use. */
suspend fun Api.podcastFeed(): PodcastFeedDto = get<PodcastFeedEnvelopeDto>(PodcastFeedPaths.FEED).feed
/** A new link: the old one stops working at once. */
suspend fun Api.resetPodcastFeed(): PodcastFeedDto = post<PodcastFeedEnvelopeDto>(PodcastFeedPaths.RESET).feed
/** Turn the feed off. */
suspend fun Api.deletePodcastFeed() {
    val res = send("DELETE", PodcastFeedPaths.FEED)
    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
}

/**
 * The lesson's MP3 (owner only, so authenticated) streamed into [dest] through a `.part` file;
 * [onProgress] gets (fraction 0..1 when the size is known, bytes so far).
 */
suspend fun Api.downloadAudioLesson(id: String, dest: File, onProgress: (Double, Long) -> Unit = { _, _ -> }) = withContext(Dispatchers.IO) {
    http.newCall(request(AudioLessonPaths.audio(id)).build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) {
            val body = res.body?.string().orEmpty()
            throw HttpException(res.code, body.take(200), body)
        }
        val body = res.body ?: throw IOException("empty answer")
        val total = body.contentLength()
        dest.parentFile?.mkdirs()
        val tmp = File(dest.parentFile, dest.name + ".part")
        var got = 0L
        var lastReport = 0L
        body.byteStream().use { input ->
            tmp.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    coroutineContext.ensureActive()
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    got += n
                    if (got - lastReport > 128 * 1024) {
                        lastReport = got
                        onProgress(if (total > 0) got.toDouble() / total else 0.0, got)
                    }
                }
            }
        }
        if (total > 0 && got != total) {
            tmp.delete()
            throw IOException("download cut off ($got of $total bytes)")
        }
        if (!tmp.renameTo(dest)) {
            tmp.copyTo(dest, overwrite = true)
            tmp.delete()
        }
        onProgress(1.0, got)
    }
}
