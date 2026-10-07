package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.Revisit
import dev.jeromeswannack.chineselearning.lab.core.RevisitSettings
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * "Revisit later" for mini lessons and graded readers (shared/study/revisit.ts, worker
 * routes/revisit.ts): the account's gaps (`users.revisit_settings`, also on /api/auth/me and
 * /api/sync/changes as `revisit_settings`) and every "Done for good" / "Bring back" event.
 */

/** `RevisitSettingsInfo`. */
@Serializable
data class RevisitSettingsDto(
    val hard_days: Double = 2.0,
    val good_days: Double = 14.0,
    val easy_days: Double = 42.0,
    val growth: Double = 2.0,
    val cap_days: Double = 180.0,
    /** "New lessons a day" (absent from servers before Oct 2026 → the default, 1). */
    val new_lessons_per_day: Double = 1.0,
    val is_default: Boolean = true,
) {
    /** Through `parseRevisitSettings`, so a broken value can never break the schedule. */
    fun toSettings(): RevisitSettings = Revisit.parse(buildJsonObject {
        put("hard_days", JsonPrimitive(hard_days))
        put("good_days", JsonPrimitive(good_days))
        put("easy_days", JsonPrimitive(easy_days))
        put("growth", JsonPrimitive(growth))
        put("cap_days", JsonPrimitive(cap_days))
        put("new_lessons_per_day", JsonPrimitive(new_lessons_per_day))
    })
}

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
data class RevisitDto(val settings: RevisitSettingsDto? = null, val events: List<RevisitEventDto> = emptyList())

/** POST /api/me/revisit-events body (idempotent by id). */
@Serializable
data class RevisitEventsUpload(val events: List<RevisitEventDto>)

/** GET /api/me/revisit — the gaps and every Done-for-good / Bring-back event. */
suspend fun Api.revisit(): RevisitDto = get("/api/me/revisit")

/**
 * PUT /api/profile/revisit-settings — a partial body (null = that field's default) or
 * `{ reset: true }`. A 400 carries `problems` (HttpException.problems()).
 */
suspend fun Api.saveRevisitSettings(body: JsonObject): RevisitSettingsDto = put("/api/profile/revisit-settings", body)

/** The body for [saveRevisitSettings]: the changed fields, or every default. */
fun revisitSettingsBody(changes: Map<String, Double>, reset: Boolean): JsonObject = buildJsonObject {
    if (reset) put("reset", JsonPrimitive(true))
    else for ((k, v) in changes) put(k, JsonPrimitive(v))
}
