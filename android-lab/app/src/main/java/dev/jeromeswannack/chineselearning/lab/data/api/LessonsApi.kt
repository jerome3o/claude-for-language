package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.CustomLessonSpec
import dev.jeromeswannack.chineselearning.lab.core.LessonAttemptData
import dev.jeromeswannack.chineselearning.lab.core.SentenceFeedback
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

/*
 * Package B — custom mini lessons: the endpoints the web app's
 * services/custom-lesson-study.ts, api/lessonPractice.ts and pages/MiniLessonsPage.tsx call.
 */

@Serializable
data class LessonCompletionDto(
    val id: String,
    @SerialName("lesson_id") val lessonId: String,
    val correct: Int = 0,
    val total: Int = 0,
    @SerialName("completed_at") val completedAt: String,
    val rating: Int? = null,
)

@Serializable
data class CustomLessonDto(
    val id: String,
    val title: String = "",
    val description: String? = null,
    val icon: String? = null,
    val source: String = "",
    val status: String = "active",
    @SerialName("created_at") val createdAt: String = "",
    @SerialName("assigned_by") val assignedBy: String? = null,
    val spec: CustomLessonSpec = CustomLessonSpec(),
    val completions: List<LessonCompletionDto> = emptyList(),
)

@Serializable
data class CustomLessonsDto(val lessons: List<CustomLessonDto> = emptyList())

/** One completion event for `POST /api/custom-lessons/offline-complete` (idempotent by id). */
@Serializable
data class CompletionUpload(
    val id: String,
    @SerialName("lesson_id") val lessonId: String,
    val correct: Int,
    val total: Int,
    @SerialName("completed_at") val completedAt: String,
    val rating: Int?,
    val attempt: LessonAttemptData? = null,
)

@Serializable
data class CompletionUploadBody(val events: List<CompletionUpload>)

@Serializable
data class SentenceFeedbackBody(val words: List<String>, val task: String?, val sentence: String)

@Serializable
data class SentenceFeedbackDto(val feedback: SentenceFeedback)

@Serializable
data class PracticeTtsBody(val text: String, val speed: Double? = null, @SerialName("voice_id") val voiceId: String? = null)

@Serializable
data class PracticeTtsDto(@SerialName("audio_base64") val audioBase64: String, @SerialName("content_type") val contentType: String = "audio/mpeg")

@Serializable
data class AttemptSummaryDto(
    val id: String,
    @SerialName("lesson_id") val lessonId: String = "",
    @SerialName("lesson_title") val lessonTitle: String = "",
    @SerialName("lesson_icon") val lessonIcon: String? = null,
    @SerialName("completed_at") val completedAt: String = "",
    @SerialName("duration_ms") val durationMs: Long = 0,
    val correct: Int? = null,
    val total: Int? = null,
    val rating: Int? = null,
    val recordings: Int = 0,
)

@Serializable
data class AttemptListDto(val attempts: List<AttemptSummaryDto> = emptyList())

@Serializable
data class AttemptMediaDto(
    @SerialName("media_key") val mediaKey: String,
    @SerialName("audio_key") val audioKey: String = "",
    @SerialName("transcript_status") val transcriptStatus: String = "",
    val transcript: String? = null,
    @SerialName("transcript_translation") val transcriptTranslation: String? = null,
)

@Serializable
data class AttemptDetailDto(
    val id: String,
    @SerialName("lesson_id") val lessonId: String = "",
    @SerialName("completed_at") val completedAt: String = "",
    @SerialName("duration_ms") val durationMs: Long = 0,
    val correct: Int? = null,
    val total: Int? = null,
    val rating: Int? = null,
    val spec: CustomLessonSpec = CustomLessonSpec(),
    val data: LessonAttemptData = LessonAttemptData(),
    val media: List<AttemptMediaDto> = emptyList(),
)

@Serializable
data class AttemptDetailEnvelope(val attempt: AttemptDetailDto)

/** Homework rows the lesson / reader rotation needs (docs/HOMEWORK.md). */
@Serializable
data class HomeworkAssignmentLite(
    val id: String,
    val kind: String = "",
    @SerialName("target_id") val targetId: String = "",
    val mode: String = "fsrs",
    val status: String = "active",
)

@Serializable
data class HomeworkEventLite(val id: String, @SerialName("assignment_id") val assignmentId: String, val result: String = "")

@Serializable
data class HomeworkLiteDto(val assignments: List<HomeworkAssignmentLite> = emptyList(), val events: List<HomeworkEventLite> = emptyList())

@Serializable
data class HomeworkEventUpload(
    val id: String,
    @SerialName("assignment_id") val assignmentId: String,
    @SerialName("item_id") val itemId: String,
    val result: String,
    @SerialName("created_at") val createdAt: String,
)

@Serializable
data class HomeworkEventsBody(val events: List<HomeworkEventUpload>)

suspend fun Api.customLessons(): CustomLessonsDto = get("/api/custom-lessons")

suspend fun Api.deleteCustomLesson(id: String): Unit = delete("/api/custom-lessons/${enc(id)}")

suspend fun Api.sentenceFeedback(words: List<String>, task: String?, sentence: String): SentenceFeedback =
    post<SentenceFeedbackBody, SentenceFeedbackDto>("/api/lessons/sentence-feedback", SentenceFeedbackBody(words, task, sentence)).feedback

suspend fun Api.practiceTts(text: String, speed: Double?, voiceId: String?): PracticeTtsDto =
    post("/api/practice/tts", PracticeTtsBody(text, speed, voiceId))

suspend fun Api.lessonAttempts(lessonId: String?): List<AttemptSummaryDto> =
    get<AttemptListDto>("/api/lesson-attempts" + (lessonId?.let { "?lesson_id=${enc(it)}" } ?: "")).attempts

suspend fun Api.lessonAttempt(id: String): AttemptDetailDto = get<AttemptDetailEnvelope>("/api/lesson-attempts/${enc(id)}").attempt

suspend fun Api.homeworkLite(): HomeworkLiteDto = get("/api/me/homework")

/**
 * `PUT /api/lesson-attempts/:id/media/:key` with the recording as the raw body (the web's
 * uploadLessonAttemptMedia). Returns the status; 404 = the attempt hasn't landed yet.
 */
suspend fun Api.putAttemptMedia(attemptId: String, mediaKey: String, file: File, mime: String): Int = withContext(Dispatchers.IO) {
    val body = file.asRequestBody(mime.toMediaTypeOrNull())
    http.newCall(request("/api/lesson-attempts/${enc(attemptId)}/media/${enc(mediaKey)}").put(body).build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        res.code
    }
}
