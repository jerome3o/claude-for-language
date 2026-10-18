package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueRecord
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeIssueSummary
import dev.jeromeswannack.chineselearning.lab.core.memereview.MemeLessonJob
import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.Serializable

/* 梗 Meme review (prototype) — the same endpoints as the web's api/memeReview.ts (worker routes/meme-review.ts). */

@Serializable
data class MemeIssueListDto(val issues: List<MemeIssueSummary> = emptyList(), val current_month: String = "", val can_generate: Boolean = false)

@Serializable
data class MemeIssueStatsDto(val rounds: Int = 0, val searches: Int = 0, val images: Int = 0, val cost_usd: Double = 0.0)

@Serializable
data class MemeIssueResponseDto(val issue: MemeIssueRecord, val lesson: MemeLessonJob? = null, val stats: MemeIssueStatsDto? = null)

@Serializable
data class MemeGenerateBody(val month: String)

@Serializable
data class MemeGenerateDto(val issue: MemeIssueRecord, val started: Boolean = false)

@Serializable
data class MemeLessonJobDto(val job: MemeLessonJob)

/** `GET /api/meme-review` — every issue (newest month first) + whether this account may generate. */
suspend fun Api.memeIssues(): MemeIssueListDto = get("/api/meme-review")

/** `GET /api/meme-review/:month` — the issue + this account's latest lesson job (+ stats for an admin). */
suspend fun Api.memeIssue(month: String): MemeIssueResponseDto = get("/api/meme-review/${enc(month)}")

/** `POST /api/meme-review/generate` — admin only. */
suspend fun Api.generateMemeIssue(month: String): MemeGenerateDto = post<MemeGenerateBody, MemeGenerateDto>("/api/meme-review/generate", MemeGenerateBody(month))

/** `POST /api/meme-review/:month/lesson` — a mini lesson in the caller's own account. */
suspend fun Api.startMemeLesson(month: String): MemeLessonJob = post<MemeLessonJobDto>("/api/meme-review/${enc(month)}/lesson").job

/** `GET /api/meme-review/lessons/:jobId`. */
suspend fun Api.memeLessonJob(jobId: String): MemeLessonJob = get<MemeLessonJobDto>("/api/meme-review/lessons/${enc(jobId)}").job
