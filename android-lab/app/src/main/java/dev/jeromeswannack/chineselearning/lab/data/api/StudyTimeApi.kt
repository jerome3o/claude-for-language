package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

// Active study time per local day (worker routes/study-time.ts, the web's services/studyTime.ts).

@Serializable
data class StudyTimeDayBody(val date: String, val active_ms: Long)

@Serializable
data class StudyTimeReportBody(val device_id: String, val days: List<StudyTimeDayBody>)

/** A day over every device; [device_ms] = this device's share. */
@Serializable
data class StudyTimeDayTotalDto(val date: String, val active_ms: Long = 0, val device_ms: Long = 0)

@Serializable
data class StudyTimeTotalsDto(val days: List<StudyTimeDayTotalDto> = emptyList())

/** `PUT /api/me/study-time`: this device's running per-day totals (rows only go up) → every device's. */
suspend fun Api.putStudyTime(deviceId: String, days: List<StudyTimeDayBody>): List<StudyTimeDayTotalDto> =
    put<StudyTimeReportBody, StudyTimeTotalsDto>("/api/me/study-time", StudyTimeReportBody(deviceId, days)).days
