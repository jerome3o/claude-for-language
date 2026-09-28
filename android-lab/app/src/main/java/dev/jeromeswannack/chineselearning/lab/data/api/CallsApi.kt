package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

// Video calls (package J) — worker/src/routes/calls.ts, web: frontend/src/api/calls.ts + types/calls.ts.

@Serializable
data class CallListItemDto(
    val id: String,
    val relationship_id: String? = null,
    val created_by: String = "",
    val title: String? = null,
    /** live | ended */
    val status: String = "ended",
    /** none | waiting_uploads | transcribing | summarizing | done | failed */
    val processing_status: String = "none",
    val started_at: Long? = null,
    val ended_at: Long? = null,
    val created_at: String = "",
    val other_user_name: String? = null,
    val segment_count: Int = 0,
    val has_summary: Boolean = false,
)

@Serializable
data class CallInfoDto(
    val id: String,
    val relationship_id: String? = null,
    val created_by: String = "",
    val title: String? = null,
    val status: String = "ended",
    val processing_status: String = "none",
    val processing_error: String? = null,
    val started_at: Long? = null,
    val ended_at: Long? = null,
    val created_at: String = "",
)

@Serializable
data class CallParticipantDto(val id: String, val name: String? = null, val email: String = "", val picture_url: String? = null) {
    val displayName: String get() = name?.takeIf { it.isNotBlank() } ?: email.substringBefore('@')
}

@Serializable
data class CallPieceDto(
    val id: String,
    val user_id: String = "",
    val piece_index: Int = 0,
    val started_at: Long = 0,
    val duration_ms: Long? = null,
    /** recording | ready | queued | transcribing | done | failed */
    val status: String = "recording",
    val error: String? = null,
    val provider: String? = null,
    val audio_url: String? = null,
)

@Serializable
data class CallReportWordDto(
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val fun_facts: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
    val from_call: String? = null,
)

@Serializable
data class CallCorrectionDto(val said: String = "", val better: String = "", val pinyin: String? = null, val explanation: String = "")

@Serializable
data class CallReportDto(
    val summary: String = "",
    val topics: List<String> = emptyList(),
    val vocabulary: List<CallReportWordDto> = emptyList(),
    val corrections: List<CallCorrectionDto> = emptyList(),
    val follow_ups: List<String> = emptyList(),
)

@Serializable
data class TranscriptSegmentDto(
    val id: String,
    val user_id: String = "",
    val piece_id: String = "",
    val start_ms: Long = 0,
    val end_ms: Long = 0,
    val text: String = "",
    val language: String? = null,
    val pinyin: String? = null,
    val translation: String? = null,
)

@Serializable
data class CallChatDto(val id: String, val user_id: String = "", val name: String = "", val text: String = "", val at: Long = 0)

@Serializable
data class CallDetailDto(
    val call: CallInfoDto,
    val participants: List<CallParticipantDto> = emptyList(),
    /** Whiteboard items (shared/calls/board.ts) — parsed with core CallBoard.parseItems. */
    val board: JsonArray = JsonArray(emptyList()),
    /** What was typed on the shared text board (shared/calls/textDoc.ts). */
    val board_text: String = "",
    val chat: List<CallChatDto> = emptyList(),
    val report: CallReportDto? = null,
    val pieces: List<CallPieceDto> = emptyList(),
    val transcript: List<TranscriptSegmentDto> = emptyList(),
    val transcriber: String = "",
)

@Serializable
data class IceServerDto(val urls: JsonElement, val username: String? = null, val credential: String? = null)

@Serializable
data class CallJoinDto(val ticket: String, val ws_path: String, val ice_servers: List<IceServerDto> = emptyList(), val turn: Boolean = false)

@Serializable
private data class CallsListDto(val calls: List<CallListItemDto> = emptyList())

@Serializable
data class NewCallRequest(val relationship_id: String? = null, val title: String? = null)

@Serializable
private data class NewCallDto(val call: CallInfoDto)

@Serializable
data class FlashcardsRequest(val deck_id: String? = null, val deck_name: String? = null, val words: List<CallReportWordDto>)

@Serializable
data class FlashcardsFailureDto(val index: Int = 0, val hanzi: String = "", val error: String = "")

@Serializable
data class FlashcardsResultDto(val deck_id: String, val created: Int = 0, val failed: List<FlashcardsFailureDto> = emptyList())

@Serializable
data class CallHomeworkRequest(val priority: String = "core", val auto_share: Boolean = true, val log_lesson: Boolean = true)

@Serializable
private data class CallJobsDto(val jobs: List<SessionJobDto> = emptyList())

@Serializable
private data class CallJobDto(val job: SessionJobDto)

@Serializable
data class RegisterPieceBody(val id: String, val piece_index: Int, val started_at: Long, val mime_type: String)

@Serializable
data class ClosePieceBody(val chunk_count: Int, val duration_ms: Long)

private fun callPath(id: String) = "/api/calls/${enc(id)}"

suspend fun Api.listCalls(): List<CallListItemDto> = get<CallsListDto>("/api/calls").calls

suspend fun Api.createCall(relationshipId: String?): CallInfoDto = post<NewCallRequest, NewCallDto>("/api/calls", NewCallRequest(relationshipId)).call

suspend fun Api.getCall(id: String): CallDetailDto = get(callPath(id))

suspend fun Api.deleteCall(id: String) = delete<Unit>(callPath(id))

suspend fun Api.joinCall(id: String): CallJoinDto = post("${callPath(id)}/join")

suspend fun Api.endCall(id: String) = post<Unit>("${callPath(id)}/end")

suspend fun Api.processCall(id: String) = post<Unit>("${callPath(id)}/process")

suspend fun Api.makeCallFlashcards(id: String, body: FlashcardsRequest): FlashcardsResultDto = post("${callPath(id)}/flashcards", body)

suspend fun Api.callHomework(id: String): List<SessionJobDto> = get<CallJobsDto>("${callPath(id)}/homework").jobs

suspend fun Api.makeCallHomework(id: String): SessionJobDto = post<CallHomeworkRequest, CallJobDto>("${callPath(id)}/homework", CallHomeworkRequest()).job

/** Upload paths (queued through the Outbox by data/calls/CallUploads.kt). */
object CallPaths {
    fun pieces(callId: String) = "${callPath(callId)}/pieces"
    fun chunk(callId: String, pieceId: String, idx: Int) = "${callPath(callId)}/pieces/${enc(pieceId)}/chunks/$idx"
    fun close(callId: String, pieceId: String) = "${callPath(callId)}/pieces/${enc(pieceId)}/close"
    fun prefix(callId: String) = "${callPath(callId)}/"
}
