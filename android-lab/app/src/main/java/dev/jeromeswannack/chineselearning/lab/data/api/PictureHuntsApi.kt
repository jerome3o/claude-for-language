package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException

/* Picture hunts (看图找词) — the same endpoints as the web's api/pictureHunts.ts (worker routes/picture-hunts.ts). */

/**
 * A hunt: the summary fields (`GET /api/picture-hunts`) plus, from `GET /api/picture-hunts/:id`,
 * its objects (core's [HuntObject], serialised with the API's own field names).
 */
@Serializable
data class PictureHuntDto(
    val id: String,
    val title: String = "",
    val source: String = "generated",
    val prompt: String? = null,
    val status: String = "generating",
    val progress: String? = null,
    val error: String? = null,
    val object_count: Int = 0,
    val image_width: Int? = null,
    val image_height: Int? = null,
    val best_found: Int? = null,
    val play_count: Int = 0,
    val last_played_at: String? = null,
    val created_at: String = "",
    val updated_at: String = "",
    /** Only on `GET /api/picture-hunts/:id` (null in the list). */
    val objects: List<HuntObject>? = null,
)

/** PictureHuntPlay — one play-through, uploaded idempotently by its client id. */
@Serializable
data class PictureHuntPlayDto(
    val id: String,
    val hunt_id: String,
    val found_ids: List<String>,
    val total: Int,
    val hints_used: Int,
    val gave_up: Boolean,
    val duration_ms: Long,
    val played_at: String,
)

@Serializable data class PictureHuntListDto(val hunts: List<PictureHuntDto> = emptyList())
@Serializable data class PictureHuntEnvelopeDto(val hunt: PictureHuntDto)
@Serializable data class NewPictureHuntBody(val prompt: String, val deck_ids: List<String>? = null, val use_learning_words: Boolean = true)
@Serializable data class PictureHuntPlaysBody(val plays: List<PictureHuntPlayDto>)

object PictureHuntPaths {
    const val LIST = "/api/picture-hunts"
    const val PLAYS = "/api/picture-hunts/plays"
    fun hunt(id: String) = "/api/picture-hunts/${enc(id)}"
    fun image(id: String) = "/api/picture-hunts/${enc(id)}/image"
}

suspend fun Api.pictureHunts(): List<PictureHuntDto> = get<PictureHuntListDto>(PictureHuntPaths.LIST).hunts
suspend fun Api.pictureHunt(id: String): PictureHuntDto = get<PictureHuntEnvelopeDto>(PictureHuntPaths.hunt(id)).hunt
suspend fun Api.createPictureHunt(body: NewPictureHuntBody): PictureHuntDto = post<NewPictureHuntBody, PictureHuntEnvelopeDto>(PictureHuntPaths.LIST, body).hunt
suspend fun Api.retryPictureHunt(id: String): PictureHuntDto = post<PictureHuntEnvelopeDto>("${PictureHuntPaths.hunt(id)}/retry").hunt
suspend fun Api.deletePictureHunt(id: String) {
    val res = send("DELETE", PictureHuntPaths.hunt(id))
    if (!res.ok && res.code != 404) throw HttpException(res.code, res.body.take(200), res.body)
}

/** `POST /api/picture-hunts/upload?caption=` with the (already resized, EXIF-free) JPEG as the raw body. */
suspend fun Api.uploadPictureHunt(jpeg: ByteArray, caption: String?): PictureHuntDto = withContext(Dispatchers.IO) {
    val qs = caption?.trim()?.takeIf { it.isNotEmpty() }?.let { "?caption=${enc(it)}" }.orEmpty()
    val req = request("/api/picture-hunts/upload$qs").post(jpeg.toRequestBody("image/jpeg".toMediaType())).build()
    http.newCall(req).execute().use { res ->
        val body = res.body?.string().orEmpty()
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) throw HttpException(res.code, body.take(200), body)
        json.decodeFromString(PictureHuntEnvelopeDto.serializer(), body).hunt
    }
}

/** The picture's bytes (owner only, so authenticated) into [dest]; returns its Content-Type. */
suspend fun Api.downloadPictureHuntImage(id: String, dest: File): String = withContext(Dispatchers.IO) {
    http.newCall(request(PictureHuntPaths.image(id)).build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        if (!res.isSuccessful) throw HttpException(res.code, "picture ${res.code}")
        dest.parentFile?.mkdirs()
        val tmp = File(dest.parentFile, dest.name + ".part")
        res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
        if (!tmp.renameTo(dest)) throw IOException("rename failed")
        res.header("Content-Type") ?: "image/jpeg"
    }
}

