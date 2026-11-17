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
