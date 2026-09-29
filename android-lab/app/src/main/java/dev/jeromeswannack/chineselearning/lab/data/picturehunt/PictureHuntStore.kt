package dev.jeromeswannack.chineselearning.lab.data.picturehunt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.media.ExifInterface
import dev.jeromeswannack.chineselearning.lab.data.Api
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntDto
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPaths
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPlayDto
import dev.jeromeswannack.chineselearning.lab.data.api.PictureHuntPlaysBody
import dev.jeromeswannack.chineselearning.lab.data.api.deletePictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.downloadPictureHuntImage
import dev.jeromeswannack.chineselearning.lab.data.api.pictureHunt
import dev.jeromeswannack.chineselearning.lab.data.api.pictureHunts
import dev.jeromeswannack.chineselearning.lab.data.platform.FeatureSync
import dev.jeromeswannack.chineselearning.lab.data.platform.JsonCache
import dev.jeromeswannack.chineselearning.lab.data.platform.Outbox
import dev.jeromeswannack.chineselearning.lab.data.platform.SyncContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Picture hunts on the phone — the web's services/pictureHunts.ts. Ready hunts are cached whole
 * (the list and each hunt with its objects in the [JsonCache], the picture's bytes on disk under
 * `files/picture-hunts/`) so a hunt plays on the train; plays go through the [Outbox]
 * (`POST /api/picture-hunts/plays`, idempotent by the play's client id).
 */
class PictureHuntStore(private val cache: JsonCache, private val outbox: Outbox, private val api: Api, filesDir: File) {
    val imageDir = File(filesDir, "picture-hunts")

    /** The cached picture of hunt [id], or null. */
    fun imageFile(id: String): File? =
        EXTENSIONS.map { File(imageDir, "${safe(id)}.$it") }.firstOrNull { it.exists() && it.length() > 0 }

    /** The picture: cached, else downloaded (and kept) when [online]; null offline with nothing cached. */
    suspend fun image(id: String, online: Boolean): File? {
        imageFile(id)?.let { return it }
        if (!online) return null
        return try {
            val tmp = File(imageDir, "${safe(id)}.download")
            val type = api.downloadPictureHuntImage(id, tmp)
            val dest = File(imageDir, "${safe(id)}.${extFor(type)}")
            withContext(Dispatchers.IO) { if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() } }
            dest
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    suspend fun cachedList(): List<PictureHuntDto> = cache.get<List<PictureHuntDto>>(LIST_KEY).orEmpty()

    suspend fun cachedHunt(id: String): PictureHuntDto? = cache.get<PictureHuntDto>(huntKey(id))

    /**
     * `storeHuntList`: keep the list, keep the cached objects of hunts that didn't change,
     * drop hunts deleted elsewhere (their objects and picture too).
     */
    suspend fun storeList(hunts: List<PictureHuntDto>) {
        val ids = hunts.map { it.id }.toSet()
        for (old in cachedList()) {
            if (old.id !in ids) forget(old.id)
        }
        for (h in hunts) {
            val prev = cachedHunt(h.id) ?: continue
            val keep = prev.objects != null && prev.updated_at == h.updated_at && h.status == "ready"
            cache.put(huntKey(h.id), KIND, if (keep) h.copy(objects = prev.objects) else h)
        }
        cache.put(LIST_KEY, KIND, hunts.map { it.copy(objects = null) })
    }

    /** `refreshPictureHunts`: the list, then the objects and picture of every ready hunt not on the phone yet. */
    suspend fun refresh(): List<PictureHuntDto> {
        val hunts = api.pictureHunts()
        storeList(hunts)
        for (summary in hunts) {
            if (summary.status != "ready") continue
            if (cachedHunt(summary.id)?.objects == null) {
                runCatching { cache.put(huntKey(summary.id), KIND, api.pictureHunt(summary.id)) }
            }
            if (imageFile(summary.id) == null) image(summary.id, online = true)
        }
        return hunts
    }

    /** `loadHunt`: the cached copy, fetched from the server when online and it isn't ready / has no objects here. */
    suspend fun load(id: String, online: Boolean): PictureHuntDto? {
        val local = cachedHunt(id)
        if (online && (local?.objects == null || local.status != "ready")) {
            try {
                val fresh = api.pictureHunt(id)
                cache.put(huntKey(id), KIND, fresh)
                return fresh
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (local == null) throw e
            }
        }
        return local
    }

    /** Remember a new / retried hunt at the top of the list at once (the web's storeHuntList([hunt, …rest])). */
    suspend fun upsertSummary(hunt: PictureHuntDto) {
        val list = cachedList()
        cache.put(LIST_KEY, KIND, listOf(hunt.copy(objects = null)) + list.filter { it.id != hunt.id })
    }

    /**
     * `recordHuntPlay`: queue the play (sent now when online, else by the next sync / the
     * background worker) and show it locally at once — best found, play count.
     */
    suspend fun recordPlay(play: PictureHuntPlayDto) {
        outbox.enqueueJson(OUTBOX_KIND, "POST", PictureHuntPaths.PLAYS, PictureHuntPlaysBody(listOf(play)), id = play.id)
        fun PictureHuntDto.withPlay() = copy(
            best_found = maxOf(best_found ?: 0, play.found_ids.size),
            play_count = play_count + 1,
            last_played_at = play.played_at,
        )
        cache.put(LIST_KEY, KIND, cachedList().map { if (it.id == play.hunt_id) it.withPlay() else it })
        cachedHunt(play.hunt_id)?.let { cache.put(huntKey(play.hunt_id), KIND, it.withPlay()) }
    }

    /** `deleteHuntEverywhere` (needs a connection). */
    suspend fun delete(id: String) {
        api.deletePictureHunt(id)
        cache.put(LIST_KEY, KIND, cachedList().filter { it.id != id })
        forget(id)
    }

    private suspend fun forget(id: String) {
        cache.delete(huntKey(id))
        withContext(Dispatchers.IO) { EXTENSIONS.forEach { File(imageDir, "${safe(id)}.$it").delete() } }
    }

    companion object {
        const val KIND = "picture-hunt"
        const val LIST_KEY = "picture-hunt/list"
        const val OUTBOX_KIND = "picture-hunt-play"
        fun huntKey(id: String) = "picture-hunt/h/$id"
        private val EXTENSIONS = listOf("jpg", "png", "webp")
        private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")
        private fun extFor(contentType: String) = when {
            contentType.contains("png") -> "png"
            contentType.contains("webp") -> "webp"
            else -> "jpg"
        }

        fun of(ctx: SyncContext) = PictureHuntStore(ctx.cache, ctx.outbox, ctx.api, ctx.outbox.dir.parentFile ?: ctx.outbox.dir)
    }
}

/** The sync step (web: syncPictureHunts): plays go up with the outbox; the hunts are refreshed at most every 10 minutes. */
object PictureHuntSync : FeatureSync {
    private const val REFRESH_EVERY_MS = 10 * 60 * 1000L

    override suspend fun sync(ctx: SyncContext) {
        if (!ctx.full && ctx.cache.isFresh(PictureHuntStore.LIST_KEY, REFRESH_EVERY_MS)) return
        PictureHuntStore.of(ctx).refresh()
    }
}

/**
 * `preparePhoto`: a photo ready to upload — at most [LONG_SIDE] px on the long side, EXIF
 * orientation applied, re-encoded as a JPEG (quality 85). Re-encoding a Bitmap writes no EXIF,
 * so location data never leaves the phone.
 */
object PhotoPrep {
    const val LONG_SIDE = 1600

    fun prepare(context: Context, uri: Uri): ByteArray {
        val bitmap = decode(context, uri) ?: throw IllegalArgumentException("This photo couldn't be opened. Try a JPEG or PNG.")
        return encode(bitmap)
    }

    /** Scale to [LONG_SIDE] and JPEG-encode on a white background (transparent PNGs). */
    fun encode(source: Bitmap): ByteArray {
        val scale = minOf(1.0, LONG_SIDE.toDouble() / maxOf(source.width, source.height))
        val w = maxOf(1, Math.round(source.width * scale).toInt())
        val h = maxOf(1, Math.round(source.height * scale).toInt())
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        canvas.drawColor(android.graphics.Color.WHITE)
        canvas.drawBitmap(source, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        return ByteArrayOutputStream().use { bytes ->
            out.compress(Bitmap.CompressFormat.JPEG, 85, bytes)
            bytes.toByteArray()
        }
    }

    private fun decode(context: Context, uri: Uri): Bitmap? {
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies the EXIF orientation itself; sample down big camera photos while decoding.
            return runCatching {
                ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                    val long = maxOf(info.size.width, info.size.height)
                    if (long > LONG_SIDE * 2) {
                        val f = long.toDouble() / (LONG_SIDE * 2)
                        decoder.setTargetSize((info.size.width / f).toInt().coerceAtLeast(1), (info.size.height / f).toInt().coerceAtLeast(1))
                    }
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
            }.getOrNull()
        }
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= LONG_SIDE) sample *= 2
        val raw = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) } ?: return null
        val degrees = runCatching {
            resolver.openInputStream(uri)?.use {
                when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            } ?: 0
        }.getOrDefault(0)
        if (degrees == 0) return raw
        return Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
    }
}
