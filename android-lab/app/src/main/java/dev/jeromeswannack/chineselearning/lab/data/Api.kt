package dev.jeromeswannack.chineselearning.lab.data

import dev.jeromeswannack.chineselearning.lab.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

// Wire shapes of the endpoints the web client's sync uses (see docs in android-lab/README.md).

@Serializable
data class MeDto(
    val id: String,
    val name: String? = null,
    val email: String? = null,
    val new_cards_per_day: Int = 3,
    val secondary_cards_per_day: Int = 6,
)

@Serializable
data class CardDto(val id: String, val note_id: String, val card_type: String, val created_at: String? = null)

@Serializable
data class NoteDto(
    val id: String,
    val deck_id: String,
    val hanzi: String,
    val pinyin: String = "",
    val english: String = "",
    val audio_url: String? = null,
    val fun_facts: String? = null,
    val context: String? = null,
    val sentence_clue: String? = null,
    val sentence_clue_pinyin: String? = null,
    val sentence_clue_translation: String? = null,
    val sentence_clue_audio_url: String? = null,
    val alternatives: String? = null,
    val created_at: String? = null,
    val updated_at: String? = null,
    val cards: List<CardDto> = emptyList(),
)

@Serializable
data class DeckDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val new_cards_per_day: Int = 3,
    val secondary_cards_per_day: Int? = null,
    val study_priority: Int = 0,
    val created_at: String = "",
    val updated_at: String? = null,
    val notes: List<NoteDto> = emptyList(),
)

@Serializable
data class DeletedDto(val deck_ids: List<String> = emptyList(), val note_ids: List<String> = emptyList(), val card_ids: List<String> = emptyList())

@Serializable
data class ChangesDto(
    val decks: List<DeckDto> = emptyList(),
    val notes: List<NoteDto> = emptyList(),
    val cards: List<CardDto> = emptyList(),
    val deleted: DeletedDto = DeletedDto(),
    val server_time: String,
)

@Serializable
data class EventDto(
    val id: String,
    val card_id: String,
    val rating: Int,
    val reviewed_at: String,
    val time_spent_ms: Long? = null,
    val user_answer: String? = null,
    val created_at: String? = null,
)

@Serializable
data class EventsPageDto(val events: List<EventDto> = emptyList(), val has_more: Boolean = false)

@Serializable
data class UploadDto(val events: List<EventDto>)

@Serializable
data class SentenceDto(
    val id: String,
    val note_id: String,
    val position: Int = 0,
    val hanzi: String,
    val pinyin: String? = null,
    val translation: String? = null,
    val audio_url: String? = null,
    val focus: String? = null,
    val focus_note: String? = null,
)

@Serializable
data class SentencesPageDto(val sentences: List<SentenceDto> = emptyList(), val server_time: String? = null)

class UnauthorizedException : IOException("Signed out")
class HttpException(val code: Int, message: String) : IOException("HTTP $code: $message")

class Api(val baseUrl: String = Config.API_BASE, private val tokenProvider: () -> String?) {
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false }
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    private fun request(path: String): Request.Builder {
        val b = Request.Builder().url("$baseUrl$path")
        tokenProvider()?.let { b.header("Authorization", "Bearer $it") }
        return b
    }

    private suspend fun <T> call(req: Request, serializer: KSerializer<T>): T = withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res ->
            val body = res.body?.string().orEmpty()
            if (res.code == 401) throw UnauthorizedException()
            if (!res.isSuccessful) throw HttpException(res.code, body.take(200))
            json.decodeFromString(serializer, body)
        }
    }

    private suspend fun status(req: Request): Int = withContext(Dispatchers.IO) {
        http.newCall(req).execute().use { res ->
            if (res.code == 401) throw UnauthorizedException()
            res.code
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun me(): MeDto = call(request("/api/auth/me").build(), MeDto.serializer())

    suspend fun decks(): List<DeckDto> = call(request("/api/decks").build(), ListSerializer(DeckDto.serializer()))

    /** Deck with its notes and their cards; null when it was deleted meanwhile. */
    suspend fun deck(id: String): DeckDto? = try {
        call(request("/api/decks/${enc(id)}").build(), DeckDto.serializer())
    } catch (e: HttpException) {
        if (e.code == 404) null else throw e
    }

    suspend fun changes(sinceMs: Long): ChangesDto = call(request("/api/sync/changes?since=$sinceMs").build(), ChangesDto.serializer())

    suspend fun uploadEvents(events: List<EventDto>) {
        val body = json.encodeToString(UploadDto.serializer(), UploadDto(events)).toRequestBody(JSON)
        status(request("/api/reviews").post(body).build()).let { if (it !in 200..299) throw HttpException(it, "upload failed") }
    }

    suspend fun events(since: String, afterId: String?, limit: Int = 1000): EventsPageDto {
        val q = StringBuilder("/api/reviews?since=${enc(since)}&limit=$limit")
        if (afterId != null) q.append("&after_id=${enc(afterId)}")
        return call(request(q.toString()).build(), EventsPageDto.serializer())
    }

    /** Undo of an already-synced review. 404 = already gone, which is fine. */
    suspend fun deleteEvent(id: String) {
        val code = status(request("/api/reviews/${enc(id)}").delete().build())
        if (code !in 200..299 && code != 404) throw HttpException(code, "delete failed")
    }

    suspend fun sentences(since: String?): SentencesPageDto =
        call(request("/api/sentences/changes" + (since?.let { "?since=${enc(it)}" } ?: "")).build(), SentencesPageDto.serializer())

    /** Downloads a public audio clip (no auth needed) into [dest]. */
    suspend fun download(url: String, dest: File) = withContext(Dispatchers.IO) {
        http.newCall(Request.Builder().url(url).build()).execute().use { res ->
            if (!res.isSuccessful) throw HttpException(res.code, url)
            val tmp = File(dest.parentFile, dest.name + ".part")
            res.body!!.byteStream().use { input -> tmp.outputStream().use { input.copyTo(it) } }
            if (!tmp.renameTo(dest)) throw IOException("rename failed")
        }
    }

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
