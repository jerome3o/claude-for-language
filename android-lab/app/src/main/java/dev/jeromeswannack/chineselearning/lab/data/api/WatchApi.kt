package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/* 📺 Watch — worker routes/watch.ts (docs/WATCH.md "API"). Shapes: shared/watch/index.ts. */

/** One timed line of a video's transcript (WatchLine). */
@Serializable
data class WatchLineDto(
    val i: Int = 0,
    val start_ms: Long,
    val end_ms: Long,
    val zh: String = "",
    val pinyin: String? = null,
    val english: String? = null,
    val speaker: String? = null,
)

@Serializable
data class WatchGapDto(val start_ms: Long, val end_ms: Long)

/** A video in "My videos" (WatchVideoSummary) or one video with its lines so far (WatchVideoDetail). */
@Serializable
data class WatchVideoDto(
    val id: String,
    val title: String = "",
    val channel: String? = null,
    val duration_ms: Long? = null,
    val status: String = "queued",
    val progress: String? = null,
    val chunks_done: Int = 0,
    val chunks_total: Int = 0,
    val progress_done: Int? = null,
    val progress_total: Int? = null,
    val error: String? = null,
    val position_ms: Long = 0,
    val last_opened_at: String? = null,
    val added_at: String = "",
    val lines: List<WatchLineDto> = emptyList(),
    val gaps: List<WatchGapDto> = emptyList(),
    val finished_at: String? = null,
) {
    val statusLine: String get() = Watch.statusLine(status, chunks_done, chunks_total, progress_done, progress_total, error)
    val working: Boolean get() = Watch.isWorking(status)
}

@Serializable
data class WatchListDto(val videos: List<WatchVideoDto> = emptyList(), val available: Boolean = true)

@Serializable
data class WatchVideoResponse(val video: WatchVideoDto, val existing: Boolean = false)

@Serializable
data class WatchAddBody(val video_id: String, val duration_ms: Long, val title: String? = null, val source: String = "paste")

@Serializable
data class WatchPositionBody(val position_ms: Long)

@Serializable
data class WatchSavedDto(val saved: Boolean = false)

@Serializable
data class WatchRemovedDto(val removed: Boolean = false)

suspend fun Api.watchList(): WatchListDto = get("/api/watch")

suspend fun Api.watchVideo(id: String): WatchVideoDto = get<WatchVideoResponse>("/api/watch/videos/${seg(id)}").video

/** Adds a video once the player knows its length (202 while the transcript is made; 200 when one exists). */
suspend fun Api.addWatchVideo(body: WatchAddBody): WatchVideoResponse = post("/api/watch/videos", body)

suspend fun Api.saveWatchPosition(id: String, positionMs: Long): WatchSavedDto = put("/api/watch/videos/${seg(id)}/position", WatchPositionBody(positionMs))

suspend fun Api.retryWatchVideo(id: String): WatchVideoDto = post<WatchVideoResponse>("/api/watch/videos/${seg(id)}/retry").video

suspend fun Api.removeWatchVideo(id: String): WatchRemovedDto = delete("/api/watch/videos/${seg(id)}")

private fun seg(s: String) = java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20")
