package dev.jeromeswannack.chineselearning.lab.data.noteimages

import dev.jeromeswannack.chineselearning.lab.Config
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.HttpException
import dev.jeromeswannack.chineselearning.lab.data.LabDao
import dev.jeromeswannack.chineselearning.lab.data.api.exchange
import dev.jeromeswannack.chineselearning.lab.data.api.get
import dev.jeromeswannack.chineselearning.lab.data.api.post
import dev.jeromeswannack.chineselearning.lab.data.api.put
import dev.jeromeswannack.chineselearning.lab.data.api.sendFile
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import java.io.File

/** A note's picture fields (GET|POST|PUT|DELETE /api/notes/:id/image). */
@Serializable
data class NoteImageView(
    val id: String,
    val deck_id: String = "",
    val image_key: String? = null,
    val image_source: String? = null,
    val image_status: String? = null,
)

@Serializable
data class NoteImageEnvelope(val note: NoteImageView)

@Serializable
data class IllustrateEstimateDto(val pictures: Int = 0, val usd: Double = 0.0, val label: String = "")

/** GET /api/decks/:id/illustrate — the "Illustrate this deck" sheet. */
@Serializable
data class DeckIllustrateDto(
    val deck_id: String,
    val deck_name: String = "",
    val total: Int = 0,
    val with_image: Int = 0,
    val pending: Int = 0,
    val failed: Int = 0,
    val missing: Int = 0,
    val estimate: IllustrateEstimateDto = IllustrateEstimateDto(),
    val illustrate_new: Boolean = false,
    val available: Boolean = false,
)

@Serializable
data class IllustrateResultDto(val ready: Int = 0, val pending: Int = 0, val queued: Int = 0, val status: DeckIllustrateDto)

@Serializable
private data class RegenerateBody(val regenerate: Boolean)

@Serializable
private data class IllustrateNewBody(val illustrate_new: Boolean)

@Serializable
data class IllustrateNewDto(val illustrate_new: Boolean)

/**
 * Pictures on cards on the phone (the web's services/noteImages.ts; worker routes/note-images.ts):
 * the API calls, the Room copy of a note's picture fields, and the pictures themselves as files in
 * `note-images/` — downloaded after each sync ([Sync]) so a card's picture shows on the train.
 */
class NoteImages(private val api: Api, private val dao: LabDao, filesDir: File) {
    private val dir = File(filesDir, "note-images").apply { mkdirs() }

    private fun fileFor(key: String) = File(dir, key.removePrefix("/api/audio/").replace(Regex("[^A-Za-z0-9._-]"), "_"))

    /** The picture's file when it is on the phone. */
    fun cached(key: String?): File? = key?.takeIf { it.isNotBlank() }?.let(::fileFor)?.takeIf { it.exists() && it.length() > 0 }

    /** The picture's file, downloaded once when [online] (null offline before it was downloaded). */
    suspend fun image(key: String?, online: Boolean): File? {
        if (key.isNullOrBlank()) return null
        cached(key)?.let { return it }
        if (!online) return null
        return try {
            val dest = fileFor(key)
            api.download(Config.audioUrl(key, api.baseUrl), dest)
            dest
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    /** Write the view's picture fields into Room so study / the deck page show it at once. */
    suspend fun applyLocally(v: NoteImageView) {
        val note = dao.note(v.id) ?: return
        dao.upsertNotes(listOf(note.copy(imageKey = v.image_key, imageSource = v.image_source, imageStatus = v.image_status)))
    }

    private suspend fun done(v: NoteImageView): NoteImageView {
        applyLocally(v)
        if (v.image_key != null) image(v.image_key, online = true)
        return v
    }

    suspend fun get(noteId: String): NoteImageView = done(api.get<NoteImageEnvelope>("/api/notes/$noteId/image").note)

    suspend fun generate(noteId: String, regenerate: Boolean): NoteImageView =
        done(api.post<RegenerateBody, NoteImageEnvelope>("/api/notes/$noteId/image/generate", RegenerateBody(regenerate)).note)

    /** Upload a square JPEG (already cropped + resized on the phone; re-encoding wrote no EXIF). */
    suspend fun upload(noteId: String, jpeg: File): NoteImageView {
        val res = api.sendFile("PUT", "/api/notes/$noteId/image", jpeg, "image/jpeg")
        if (!res.ok) throw HttpException(res.code, res.body.take(200), res.body)
        return done(api.json.decodeFromString(NoteImageEnvelope.serializer(), res.body).note)
    }

    suspend fun remove(noteId: String): NoteImageView =
        done(api.exchange("DELETE", "/api/notes/$noteId/image", null, NoteImageEnvelope.serializer()).note)

    suspend fun deckStatus(deckId: String): DeckIllustrateDto = api.get("/api/decks/$deckId/illustrate")

    suspend fun illustrateDeck(deckId: String): IllustrateResultDto = api.post<Map<String, Int>, IllustrateResultDto>("/api/decks/$deckId/illustrate", emptyMap())

    suspend fun setIllustrateNew(deckId: String, on: Boolean): Boolean =
        api.put<IllustrateNewBody, IllustrateNewDto>("/api/decks/$deckId/illustrate", IllustrateNewBody(on)).illustrate_new

    /** Download the pictures of the phone's notes that aren't here yet (at most [limit] a run). */
    suspend fun prefetch(limit: Int = PREFETCH_PER_SYNC): Int {
        var fetched = 0
        for (key in dao.allNotes().mapNotNull { it.imageKey }.distinct()) {
            if (fetched >= limit) break
            if (cached(key) != null) continue
            if (image(key, online = true) != null) fetched++
        }
        return fetched
    }

    /** After every sync: the pictures the phone doesn't have yet. */
    object Sync : FeatureSync {
        override suspend fun sync(ctx: SyncContext) {
            val filesDir = ctx.outbox.dir.parentFile ?: ctx.outbox.dir
            NoteImages(ctx.api, ctx.db.dao(), filesDir).prefetch()
        }
    }

    companion object {
        const val PREFETCH_PER_SYNC = 200
    }
}
