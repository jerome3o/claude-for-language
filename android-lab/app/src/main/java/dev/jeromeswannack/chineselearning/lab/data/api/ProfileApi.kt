package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import java.io.File

/* The Profile screen — the same endpoints as frontend/src/api/profile.ts (worker routes/profile.ts). */

@Serializable
data class ProfileDto(
    val id: String = "",
    val email: String? = null,
    val name: String? = null,
    val picture_url: String? = null,
    /** google | upload | none */
    val picture_source: String = "google",
    val name_custom: Boolean = false,
    val google_name: String? = null,
    val google_picture_url: String? = null,
    val bio: String? = null,
    val about: String? = null,
    val time_zone: String? = null,
)

/** One field of `PUT /api/profile`: absent = leave it, [value] null = clear it (name: back to Google's). */
data class ProfileField(val value: String?)

suspend fun Api.profile(): ProfileDto = get("/api/profile")

/**
 * PUT /api/profile with only the fields that changed. The body is built by hand: the API's Json
 * drops nulls, and a null here means something (clear / Google name). A 400 carries `problems`.
 */
suspend fun Api.saveProfile(name: ProfileField? = null, about: ProfileField? = null, timeZone: ProfileField? = null, bio: ProfileField? = null): ProfileDto {
    val body = buildJsonObject {
        fun field(key: String, f: ProfileField?) { if (f != null) put(key, f.value?.let(::JsonPrimitive) ?: JsonNull) }
        field("name", name)
        field("about", about)
        field("time_zone", timeZone)
        field("bio", bio)
    }
    return put<JsonObject, ProfileDto>("/api/profile", body)
}

/** POST /api/profile/picture — a cropped JPEG (the server sniffs the bytes, ≤ 2 MB). */
suspend fun Api.uploadProfilePicture(jpeg: File): ProfileDto {
    val res = upload("/api/profile/picture", jpeg, fileField = "picture", fileName = "profile.jpg", mime = "image/jpeg")
    if (!res.ok) throw HttpException(res.code, res.body.take(200), res.body)
    return json.decodeFromString(ProfileDto.serializer(), res.body)
}

/** DELETE /api/profile/picture?use=google|none — back to the Google photo, or no photo. */
suspend fun Api.removeProfilePicture(useGoogle: Boolean): ProfileDto =
    delete("/api/profile/picture?use=${if (useGoogle) "google" else "none"}")
