package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import kotlinx.serialization.Serializable
import java.io.File

/* Podcasts — worker routes/podcasts.ts (docs/PODCASTS.md). Lab app only for now (PARITY.md "Podcasts"). */

/** A transcription's state on a feed row / in "My episodes". */
@Serializable
data class PodcastTranscriptDto(
    val status: String,
    val progress: String? = null,
    val progress_done: Int? = null,
    val progress_total: Int? = null,
    val error: String? = null,
    val duration_ms: Long? = null,
)

@Serializable
data class PodcastSubscriptionDto(
    val id: String,
    val feed_url: String,
    val title: String = "",
    val author: String? = null,
    val image_url: String? = null,
    val description: String? = null,
    val created_at: String = "",
)

@Serializable
data class SuggestedPodcastDto(
    val feed_url: String,
    val title: String,
    val blurb: String = "",
    val level: String = "intermediate",
    val subscribed: Boolean = false,
)

/** One segment: ≈ 3–15 s of the episode with its Chinese, pinyin and (once translated) English. */
@Serializable
data class PodcastSegmentDto(
    val i: Int,
    val start_ms: Long,
    val end_ms: Long,
    val text: String,
    val speaker: String? = null,
    val lang: String = "zh",
    val pinyin: String? = null,
    val english: String? = null,
)

@Serializable
data class PodcastLessonStateDto(val status: String, val lesson_id: String? = null, val error: String? = null)

/** An episode's transcription (`GET /api/podcasts/episodes/:id`; the list rows carry no segments). */
@Serializable
data class PodcastEpisodeDto(
    val id: String,
    val feed_url: String = "",
    val guid: String? = null,
    val title: String = "",
    val podcast_title: String? = null,
    val image_url: String? = null,
    val published_at: String? = null,
    val status: String = "queued",
    val progress: String? = null,
    val progress_done: Int? = null,
    val progress_total: Int? = null,
    val error: String? = null,
    val duration_ms: Long? = null,
    val audio_bytes: Long? = null,
    val audio_mime: String? = null,
    val has_audio: Boolean = false,
    val segments: List<PodcastSegmentDto> = emptyList(),
    val lesson: PodcastLessonStateDto? = null,
    val finished_at: String? = null,
)

@Serializable
data class PodcastsHomeDto(
    val subscriptions: List<PodcastSubscriptionDto> = emptyList(),
    val suggested: List<SuggestedPodcastDto> = emptyList(),
    val episodes: List<PodcastEpisodeDto> = emptyList(),
    val transcription_available: Boolean = false,
)

/** One episode of a feed, with its transcription's state (null = nobody asked yet). */
@Serializable
data class FeedEpisodeDto(
    val id: String,
    val guid: String,
    val title: String = "",
    val published_at: String? = null,
    val duration_s: Long? = null,
    val enclosure_bytes: Long? = null,
    val image_url: String? = null,
    val description: String = "",
    val transcript: PodcastTranscriptDto? = null,
)

@Serializable
data class PodcastInfoDto(
    val feed_url: String,
    val title: String = "",
    val author: String? = null,
    val image_url: String? = null,
    val description: String = "",
    val link: String? = null,
)

@Serializable
data class PodcastFeedViewDto(
    val podcast: PodcastInfoDto,
    val episodes: List<FeedEpisodeDto> = emptyList(),
    val subscription_id: String? = null,
    val fetched_at: String = "",
    val stale: Boolean = false,
    val transcription_available: Boolean = false,
    val max_minutes: Int = 150,
)

@Serializable data class SubscribeBody(val url: String)
@Serializable data class SubscribedDto(val subscription: PodcastSubscriptionDto, val feed: PodcastFeedViewDto)
@Serializable data class TranscribeBody(val feed_url: String, val guid: String)
@Serializable data class PodcastEpisodeEnvelopeDto(val episode: PodcastEpisodeDto, val existing: Boolean = false)
@Serializable data class PodcastLessonBody(val from: Int)
@Serializable data class PodcastLessonEnvelopeDto(val lesson: PodcastLessonStateDto)
@Serializable data class DeletedDto(val deleted: Boolean = false, val removed: Boolean = false)

object PodcastPaths {
    const val HOME = "/api/podcasts"
    const val SUBSCRIPTIONS = "/api/podcasts/subscriptions"
    fun subscription(id: String) = "/api/podcasts/subscriptions/${enc(id)}"
    fun feed(url: String, refresh: Boolean = false) = "/api/podcasts/feed?url=${enc(url)}" + if (refresh) "&refresh=1" else ""
    const val EPISODES = "/api/podcasts/episodes"
    fun episode(id: String) = "/api/podcasts/episodes/${enc(id)}"
    fun audio(id: String) = "/api/podcasts/episodes/${enc(id)}/audio"
    fun retry(id: String) = "/api/podcasts/episodes/${enc(id)}/retry"
    fun lesson(id: String) = "/api/podcasts/episodes/${enc(id)}/lesson"
}

suspend fun Api.podcastsHome(): PodcastsHomeDto = get(PodcastPaths.HOME)
suspend fun Api.subscribePodcast(url: String): SubscribedDto = post<SubscribeBody, SubscribedDto>(PodcastPaths.SUBSCRIPTIONS, SubscribeBody(url))
suspend fun Api.unsubscribePodcast(id: String) {
    val res = send("DELETE", PodcastPaths.subscription(id))
    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
}
suspend fun Api.podcastFeedView(url: String, refresh: Boolean = false): PodcastFeedViewDto = get(PodcastPaths.feed(url, refresh))
suspend fun Api.transcribeEpisode(feedUrl: String, guid: String): PodcastEpisodeDto =
    post<TranscribeBody, PodcastEpisodeEnvelopeDto>(PodcastPaths.EPISODES, TranscribeBody(feedUrl, guid)).episode
suspend fun Api.podcastEpisode(id: String): PodcastEpisodeDto = get<PodcastEpisodeEnvelopeDto>(PodcastPaths.episode(id)).episode
suspend fun Api.retryPodcastEpisode(id: String): PodcastEpisodeDto = post<PodcastEpisodeEnvelopeDto>(PodcastPaths.retry(id)).episode
suspend fun Api.makePodcastLesson(id: String, from: Int): PodcastLessonStateDto =
    post<PodcastLessonBody, PodcastLessonEnvelopeDto>(PodcastPaths.lesson(id), PodcastLessonBody(from)).lesson
suspend fun Api.forgetPodcastEpisode(id: String) {
    val res = send("DELETE", PodcastPaths.episode(id))
    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
}

/** The episode's audio (the copy that was transcribed) into [dest], through a `.part` file. */
suspend fun Api.downloadPodcastAudio(id: String, dest: File, onProgress: (Double, Long) -> Unit = { _, _ -> }) =
    downloadAuthed(PodcastPaths.audio(id), dest, onProgress)
