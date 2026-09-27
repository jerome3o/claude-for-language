package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/*
 * describe_image pictures by scene description (worker routes/lesson-images.ts; the web's
 * services/lessonImages.ts).
 */

@Serializable
data class LessonImageDto(
    val prompt: String = "",
    /** ready | pending | failed | unavailable | missing */
    val status: String = "unavailable",
    /** The R2 key (GET /api/audio/<key>) when ready. */
    @SerialName("image_url") val imageUrl: String? = null,
)

@OptIn(ExperimentalSerializationApi::class)
@Serializable
data class EnsureLessonImagesBody(
    val prompts: List<String>,
    /** false = only look up (the editor form while typing); nothing is drawn. */
    @EncodeDefault val queue: Boolean = true,
)

@Serializable
data class EnsureLessonImagesDto(val images: List<LessonImageDto> = emptyList())

@Serializable
data class LessonImagesTopUpDto(val pending: Int = 0, val applied: Int = 0)

suspend fun Api.ensureLessonImages(prompts: List<String>, queue: Boolean = true): List<LessonImageDto> =
    post<EnsureLessonImagesBody, EnsureLessonImagesDto>("/api/lesson-images/ensure", EnsureLessonImagesBody(prompts, queue)).images

suspend fun Api.topUpLessonImages(): LessonImagesTopUpDto = post<LessonImagesTopUpDto>("/api/lesson-images/top-up")
