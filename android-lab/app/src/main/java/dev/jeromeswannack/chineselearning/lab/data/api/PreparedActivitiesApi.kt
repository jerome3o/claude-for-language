package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.calls.PrepareJob
import dev.jeromeswannack.chineselearning.lab.core.calls.PreparedActivity
import dev.jeromeswannack.chineselearning.lab.core.calls.StudentCoverage
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// Prepared in-call activities + "What <student> has covered" (worker routes/prepared-activities.ts;
// web: frontend/src/api/preparedActivities.ts). Tutor only.

@Serializable
data class PreparedActivitiesDto(
    val activities: List<PreparedActivity> = emptyList(),
    val job: PrepareJob? = null,
    val can_prepare: Boolean = true,
)

@Serializable
data class PrepareStartedDto(val job: PrepareJob? = null, val started: Boolean = false)

@Serializable
data class PreparedOneDto(val activity: PreparedActivity? = null)

@Serializable
data class CoverageDto(val coverage: StudentCoverage = StudentCoverage())

suspend fun Api.preparedActivities(relId: String): PreparedActivitiesDto = get("/api/relationships/${enc(relId)}/prepared-activities")

/** "Prepare activities" / "↻ Make more": 202 started, 200 when one is already running. */
suspend fun Api.prepareActivities(relId: String): PrepareStartedDto = post("/api/relationships/${enc(relId)}/prepared-activities", emptyMap<String, Int>())

suspend fun Api.dismissPreparedActivity(id: String): PreparedOneDto = post("/api/prepared-activities/${enc(id)}/dismiss")

suspend fun Api.restorePreparedActivity(id: String): PreparedOneDto = post("/api/prepared-activities/${enc(id)}/restore")

suspend fun Api.studentCoverage(relId: String): CoverageDto = get("/api/relationships/${enc(relId)}/coverage")
