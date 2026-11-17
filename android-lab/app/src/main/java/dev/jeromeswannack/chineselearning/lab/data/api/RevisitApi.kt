package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/*
 * The old "Done for good" / "Bring back" marks on mini lessons (`revisit_events`, worker
 * routes/revisit.ts), still read by the revision rule (core LessonRevision). The "revisit later"
 * gaps and "New lessons a day" settings are gone (Oct 2026): the server still answers
 * `settings` and `PUT /api/profile/revisit-settings` for older builds, this app reads neither.
 */

/** One `revisit_events` row (retire = Done for good, restore = Bring back). */
@Serializable
data class RevisitEventDto(
    val id: String,
    val item_kind: String,
    val item_id: String,
    val action: String,
    val created_at: String,
)

@Serializable
data class RevisitDto(val events: List<RevisitEventDto> = emptyList())

/** POST /api/me/revisit-events body (idempotent by id). */
@Serializable
data class RevisitEventsUpload(val events: List<RevisitEventDto>)

/** GET /api/me/revisit — every Done-for-good / Bring-back event. */
suspend fun Api.revisit(): RevisitDto = get("/api/me/revisit")
