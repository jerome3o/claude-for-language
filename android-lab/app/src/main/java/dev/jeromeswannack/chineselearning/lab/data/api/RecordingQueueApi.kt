package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/*
 * "Needs your ear" — the tutor's recording review queue (web: api/insights.ts getRecordingQueue,
 * shared/recordings/queue.ts RecordingQueueResponse). Membership, reasons and the human labels
 * ("Heard: 音响", "Sounded off: 银 (tone)") are decided on the server; the app renders them.
 */

@Serializable
data class QueueNoteDto(
    val id: String = "",
    val hanzi: String = "",
    val pinyin: String = "",
    val english: String = "",
    val deck_name: String? = null,
    /** R2 key of the reference clip (the card's word audio); null = none yet. */
    val audio_url: String? = null,
)

/** One character that sounded off: kind = tone | sound | missing | extra. */
@Serializable
data class WeakCharDto(val char: String, val score: Double? = null, val kind: String = "sound")

@Serializable
data class RecordingCheckDto(
    /** pending | done | failed | skipped */
    val status: String = "done",
    val transcript: String? = null,
    /** null = no transcript (not transcribed yet / every provider failed). */
    val transcript_match: Boolean? = null,
    /** Azure accuracy 0–100, null = not scored. */
    val score: Double? = null,
    val weak_chars: List<WeakCharDto> = emptyList(),
    val score_note: String? = null,
)

@Serializable
data class QueueFlagDto(val id: String = "", val message: String = "", val created_at: String = "")

@Serializable
data class RecordingQueueItemDto(
    val event_id: String,
    val note: QueueNoteDto = QueueNoteDto(),
    val card_type: String = "hanzi_to_meaning",
    val rating: Int = 2,
    val reviewed_at: String = "",
    /** R2 key of the take. */
    val recording_url: String = "",
    val user_answer: String? = null,
    val mark: RecordingMarkDto? = null,
    val check: RecordingCheckDto? = null,
    val flag: QueueFlagDto? = null,
    val reasons: List<String> = emptyList(),
    val labels: List<String> = emptyList(),
    val in_queue: Boolean = false,
)

@Serializable
data class RecordingQueueCountsDto(val queue: Int = 0, val all: Int = 0, val checking: Int = 0)

@Serializable
data class RecordingQueueDto(
    val range: InsightRangeDto = InsightRangeDto(),
    /** queue | all */
    val view: String = "queue",
    val items: List<RecordingQueueItemDto> = emptyList(),
    val counts: RecordingQueueCountsDto = RecordingQueueCountsDto(),
    /** Azure scoring is set up on the server (else only transcripts / ratings / flags count). */
    val scoring: Boolean = false,
)

/** `GET /api/relationships/:relId/recordings/queue?from&to&view=queue|all`. */
suspend fun Api.recordingQueue(relId: String, view: String, from: String? = null, to: String? = null): RecordingQueueDto {
    val q = buildList {
        if (!from.isNullOrEmpty()) add("from=${enc(from)}")
        if (!to.isNullOrEmpty()) add("to=${enc(to)}")
        add("view=${enc(view)}")
    }.joinToString("&")
    return get("/api/relationships/${enc(relId)}/recordings/queue?$q")
}
