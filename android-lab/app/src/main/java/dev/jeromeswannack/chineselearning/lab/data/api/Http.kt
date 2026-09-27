package dev.jeromeswannack.chineselearning.lab.data.api

import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.UnauthorizedException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.serializer
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.net.URLEncoder

/*
 * Generic authenticated HTTP helpers every feature builds on. A feature's own calls
 * live in data/api/<Feature>Api.kt as extension functions, e.g.
 *
 *   @Serializable data class ReaderDto(val id: String, val title: String)
 *   suspend fun Api.readers(): List<ReaderDto> = get("/api/readers")
 *   suspend fun Api.shareReader(relId: String, readerId: String): ShareDto =
 *       post("/api/relationships/${enc(relId)}/share-reader", ShareReaderBody(readerId))
 *
 * Decoding ignores unknown keys, so DTOs declare only the fields they use.
 * Errors: 401 → UnauthorizedException, other non-2xx → HttpException (with the body),
 * no network → IOException. Show them with Throwable.userMessage() in an InlineNotice.
 */

/** A raw answer: [send] / [upload] never throw for a non-2xx status (except 401). */
data class ApiResponse(val code: Int, val body: String) {
    val ok: Boolean get() = code in 200..299
}

private val JSON_TYPE = "application/json".toMediaType()

/** URL-encodes one path segment or query value. */
fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")

/** Sends [method] [path] with an optional JSON body. Throws only for 401 and network errors. */
suspend fun Api.send(method: String, path: String, bodyJson: String? = null): ApiResponse = withContext(Dispatchers.IO) {
    val body = when {
        bodyJson != null -> bodyJson.toRequestBody(JSON_TYPE)
        method == "POST" || method == "PUT" || method == "PATCH" -> ByteArray(0).toRequestBody(null)
        else -> null
    }
    http.newCall(request(path).method(method, body).build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        ApiResponse(res.code, res.body?.string().orEmpty())
    }
}

/**
 * Multipart upload (e.g. a voice recording: `upload("/api/audio/upload", file, fields = mapOf("card_id" to id))`).
 * Throws only for 401 and network errors.
 */
suspend fun Api.upload(
    path: String,
    file: File,
    fileField: String = "file",
    fileName: String = file.name,
    mime: String = "application/octet-stream",
    fields: Map<String, String> = emptyMap(),
    method: String = "POST",
): ApiResponse = withContext(Dispatchers.IO) {
    val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
        addFormDataPart(fileField, fileName, file.asRequestBody(mime.toMediaTypeOrNull()))
        fields.forEach { (k, v) -> addFormDataPart(k, v) }
    }.build()
    http.newCall(request(path).method(method, body).build()).execute().use { res ->
        if (res.code == 401) throw UnauthorizedException()
        ApiResponse(res.code, res.body?.string().orEmpty())
    }
}

/** [send] that throws [HttpException] for a non-2xx answer; decodes the body with [serializer]. */
suspend fun <T> Api.exchange(method: String, path: String, bodyJson: String?, serializer: KSerializer<T>): T {
    val res = send(method, path, bodyJson)
    if (!res.ok) throw HttpException(res.code, res.body.take(200), res.body)
    @Suppress("UNCHECKED_CAST")
    if (serializer.descriptor == Unit.serializer().descriptor) return Unit as T
    return withContext(Dispatchers.Default) { json.decodeFromString(serializer, res.body) }
}

/** Encodes a request body with the API's Json settings. */
inline fun <reified B> Api.encode(body: B): String = json.encodeToString(json.serializersModule.serializer<B>(), body)

suspend inline fun <reified T> Api.get(path: String): T = exchange("GET", path, null, json.serializersModule.serializer<T>())

suspend inline fun <reified T> Api.delete(path: String): T = exchange("DELETE", path, null, json.serializersModule.serializer<T>())

/** POST without a body. */
suspend inline fun <reified T> Api.post(path: String): T = exchange("POST", path, null, json.serializersModule.serializer<T>())

/** POST [body] as JSON; `val r: ReaderDto = api.post("/api/readers", NewReader(...))` (use `Unit` to ignore the answer). */
suspend inline fun <reified B, reified T> Api.post(path: String, body: B): T =
    exchange("POST", path, encode(body), json.serializersModule.serializer<T>())

suspend inline fun <reified B, reified T> Api.put(path: String, body: B): T =
    exchange("PUT", path, encode(body), json.serializersModule.serializer<T>())

suspend inline fun <reified B, reified T> Api.patch(path: String, body: B): T =
    exchange("PATCH", path, encode(body), json.serializersModule.serializer<T>())

// ---------------- errors for people ----------------

/** The server's own explanation: `{ error }`, `{ message }` or the first of `{ problems }`. */
fun HttpException.serverMessage(): String? {
    val obj = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(body ?: return null) as? JsonObject }.getOrNull() ?: return null
    (obj["error"] as? JsonPrimitive)?.contentOrNull?.let { return it }
    (obj["message"] as? JsonPrimitive)?.contentOrNull?.let { return it }
    return problems().firstOrNull()
}

/** Validation problems of a 400 (`{ problems: [...] }`), as strings. */
fun HttpException.problems(): List<String> {
    val obj = runCatching { kotlinx.serialization.json.Json.parseToJsonElement(body ?: return emptyList()) as? JsonObject }.getOrNull() ?: return emptyList()
    val list = obj["problems"] as? JsonArray ?: return emptyList()
    return list.map { el ->
        (el as? JsonPrimitive)?.contentOrNull
            ?: (el as? JsonObject)?.let { o -> (o["message"] ?: o["problem"] ?: o["error"])?.jsonPrimitive?.contentOrNull }
            ?: el.toString()
    }
}

/** A sentence to show in an InlineNotice for any failure — never a stack trace. */
fun Throwable.userMessage(): String = when (this) {
    is UnauthorizedException -> "You're signed out — sign in again from More."
    is HttpException -> serverMessage() ?: when (code) {
        404 -> "That isn't there any more."
        403 -> "You don't have access to that."
        in 500..599 -> "The server had a problem ($code). Try again in a moment."
        else -> "The server said no ($code)."
    }
    is IOException -> "No connection — try again when you're online."
    else -> message ?: javaClass.simpleName
}
