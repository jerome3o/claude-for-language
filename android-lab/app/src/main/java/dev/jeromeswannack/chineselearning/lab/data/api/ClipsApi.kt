package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.clips.ClipLessonState
import dev.jeromeswannack.chineselearning.lab.core.clips.ClipRecord
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/* 🎬 Clips (experimental) — the same endpoints as the web's api/clips.ts (worker routes/clips.ts, docs/CLIPS.md). */

@Serializable
data class ClipListDto(val clips: List<ClipRecord> = emptyList())

@Serializable
data class ClipDto(val clip: ClipRecord)

@Serializable
data class ClipEventDto(val id: String, val clip_id: String, val kind: String, val value: Int? = null, val created_at: String)

@Serializable
data class ClipEventsBody(val events: List<ClipEventDto>)

@Serializable
data class ClipGenerateBody(val topic: String? = null, val words: List<String>? = null, val count: Int = 2)

@Serializable
data class ClipLearnMoreBody(val action: String)

@Serializable
data class ClipIdStatusDto(val id: String, val status: String = "")

/** One of: { lesson, started } | { reader } | { audio_lesson } | { clips } (POST /api/clips/:id/learn-more). */
@Serializable
data class ClipLearnMoreDto(
    val lesson: ClipLessonState? = null,
    val started: Boolean = false,
    val reader: ClipIdStatusDto? = null,
    val audio_lesson: ClipIdStatusDto? = null,
    val clips: List<ClipRecord>? = null,
)

/** `GET /api/clips` — the feed (unseen first, then by fit). */
suspend fun Api.clipFeed(): List<ClipRecord> = get<ClipListDto>("/api/clips").clips

/** `GET /api/clips/:id`. */
suspend fun Api.clip(id: String): ClipRecord = get<ClipDto>("/api/clips/${enc(id)}").clip

/** `POST /api/clips/generate` — Claude writes them in the background (202). */
suspend fun Api.generateClips(topic: String?, count: Int = 2): List<ClipRecord> =
    post<ClipGenerateBody, ClipListDto>("/api/clips/generate", ClipGenerateBody(topic?.takeIf { it.isNotBlank() }, null, count)).clips

/** `POST /api/clips/:id/retry`. */
suspend fun Api.retryClip(id: String): ClipRecord = post<ClipDto>("/api/clips/${enc(id)}/retry").clip

/** `DELETE /api/clips/:id`. */
suspend fun Api.deleteClip(id: String) { delete<kotlinx.serialization.json.JsonObject>("/api/clips/${enc(id)}") }

/** `POST /api/clips/:id/learn-more { action: lesson | reader | podcast | more }`. */
suspend fun Api.clipLearnMore(id: String, action: String): ClipLearnMoreDto =
    post<ClipLearnMoreBody, ClipLearnMoreDto>("/api/clips/${enc(id)}/learn-more", ClipLearnMoreBody(action))
