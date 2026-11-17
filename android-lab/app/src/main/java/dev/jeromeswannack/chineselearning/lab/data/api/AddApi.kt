package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody

/* The ＋ Add tab (docs/ADD_TAB.md) — the web's api/add.ts, worker routes/add-words.ts. */

@Serializable
data class OcrLineDto(val text: String, val box: List<Double>? = null, val main: Boolean = false)

@Serializable
data class OcrDto(val lines: List<OcrLineDto> = emptyList(), val ms: Long = 0)

@Serializable
data class ChineseCandidateDto(val hanzi: String, val pinyin: String = "", val english: String = "", val note: String? = null)

@Serializable
data class EnglishWordsDto(val words: List<ChineseCandidateDto> = emptyList())

@Serializable
private data class EnglishWordsBody(val text: String)

@Serializable
data class LessonRequestDto(
    val id: String,
    val prompt: String = "",
    val status: String = "generating",
    @SerialName("lesson_id") val lessonId: String? = null,
    val error: String? = null,
)

@Serializable
data class LessonRequestEnvelope(val request: LessonRequestDto)

@Serializable
private data class LessonRequestBody(val prompt: String)

/** `POST /api/ocr/words` with the (resized, EXIF-free) JPEG as the raw body: the Chinese lines, most prominent first. */
suspend fun Api.readPhotoWords(jpeg: ByteArray): OcrDto = withContext(Dispatchers.IO) {
    val req = request("/api/ocr/words").post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
    http.newCall(req).execute().use { res ->
        val body = res.body?.string().orEmpty()
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) throw HttpException(res.code, body.take(200), body)
        json.decodeFromString(OcrDto.serializer(), body)
    }
}

/** English (or toneless pinyin) → up to 4 Chinese words. */
suspend fun Api.englishWords(text: String): List<ChineseCandidateDto> =
    post<EnglishWordsBody, EnglishWordsDto>("/api/ai/english-words", EnglishWordsBody(text)).words

/** "🎯 Mini lesson": Claude writes it into my Mini Lessons in the background. */
suspend fun Api.requestLesson(prompt: String): LessonRequestDto =
    post<LessonRequestBody, LessonRequestEnvelope>("/api/custom-lessons/generate", LessonRequestBody(prompt)).request

suspend fun Api.lessonRequest(id: String): LessonRequestDto = get<LessonRequestEnvelope>("/api/custom-lessons/requests/${enc(id)}").request
