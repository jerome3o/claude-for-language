package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/** Practice per example sentence (worker routes/sentence-practice.ts; core SentenceHistory). */
@Serializable
data class SentenceEventDto(
    val id: String,
    val note_id: String,
    val sentence_key: String,
    val kind: String,
    val mode: String? = null,
    val result: String? = null,
    val reason: String? = null,
    val at: String,
)

@Serializable
data class SentenceEventsBody(val events: List<SentenceEventDto>)

@Serializable
data class SentenceEventsPage(val events: List<SentenceEventDto> = emptyList(), val cursor: String? = null, val more: Boolean = false)

/** `GET /api/me/sentence-practice?since=` — every device's events received after the cursor. */
suspend fun Api.sentencePracticeSince(since: String?): SentenceEventsPage =
    get("/api/me/sentence-practice" + (since?.let { "?since=" + java.net.URLEncoder.encode(it, "UTF-8") } ?: ""))
