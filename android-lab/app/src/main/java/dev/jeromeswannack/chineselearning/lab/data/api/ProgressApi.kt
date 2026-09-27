package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/*
 * Package D (Progress). The numbers themselves are computed on the phone (data/progress/);
 * the server is only asked for what the phone doesn't keep: the recording of a review.
 */

@Serializable
data class ServerReviewDto(
    val id: String,
    val reviewed_at: String,
    val rating: Int,
    val recording_url: String? = null,
)

@Serializable
data class CardReviewsDto(val reviews: List<ServerReviewDto> = emptyList())

/** GET /api/progress/day/:date/card/:cardId — the web's card-on-a-day page (for recording URLs). */
suspend fun Api.myCardReviews(date: String, cardId: String): CardReviewsDto =
    get("/api/progress/day/${enc(date)}/card/${enc(cardId)}")

@Serializable
data class SessionReviewCardNoteDto(val hanzi: String, val pinyin: String = "", val english: String = "", val audio_url: String? = null)

@Serializable
data class SessionReviewCardDto(val card_type: String = "", val note: SessionReviewCardNoteDto)

@Serializable
data class SessionReviewDto(
    val id: String,
    val rating: Int,
    val time_spent_ms: Long? = null,
    val user_answer: String? = null,
    val recording_url: String? = null,
    val card: SessionReviewCardDto,
)

@Serializable
data class StudySessionDto(val id: String, val started_at: String, val reviews: List<SessionReviewDto> = emptyList())

/** GET /api/study/sessions/:id — the web's Session Review page. */
suspend fun Api.studySession(id: String): StudySessionDto = get("/api/study/sessions/${enc(id)}")
