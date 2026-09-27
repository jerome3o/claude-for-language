package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/**
 * POST /api/transcribe/live — `LiveTranscriptionSession` in shared/transcription/soniox.ts:
 * a short-lived Soniox key for streaming a take (`provider: "soniox"`), or `"upload"` when
 * the server has no live provider (the take is then uploaded to POST /api/transcribe).
 */
@Serializable
data class LiveTranscriptionSessionDto(
    val provider: String,
    val api_key: String? = null,
    val expires_at: String? = null,
    val websocket_url: String? = null,
    val model: String? = null,
    val language_hints: List<String> = emptyList(),
)

suspend fun Api.liveTranscriptionSession(): LiveTranscriptionSessionDto = post("/api/transcribe/live")
