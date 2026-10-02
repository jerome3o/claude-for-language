package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.util.LruCache
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.api.downloadChatMedia
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/** Pure sizes for chat photos (unit-tested in ChatMediaTest). */
object ChatMediaSizing {
    /** docs/CHAT.md PR 2: photos go up as ≤ 1600 px JPEG, quality ≈ 0.8. */
    const val MAX_SIDE = 1600
    const val JPEG_QUALITY = 80

    /** The upload size: the long side down to [max], aspect kept, never upscaled. */
    fun targetSize(width: Int, height: Int, max: Int = MAX_SIDE): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return 0 to 0
        val long = maxOf(width, height)
        if (long <= max) return width to height
        val scale = max.toDouble() / long
        return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
    }

    /** Largest power-of-two sample that still decodes at least [max] on the long side. */
    fun sampleSize(width: Int, height: Int, max: Int = MAX_SIDE): Int {
        var sample = 1
        while (maxOf(width, height) / (sample * 2) >= max) sample *= 2
        return sample
    }

    /**
     * The bubble's size in dp for a [width]×[height] photo: as wide as [maxW] allows, tall ones
     * capped at [maxH] (narrower then), never shorter than [minH] (a panorama is cropped a little).
     */
    fun bubbleSize(width: Int, height: Int, maxW: Float = 260f, maxH: Float = 280f, minH: Float = 110f): Pair<Float, Float> {
        if (width <= 0 || height <= 0) return maxW to maxW * 0.75f
        val ratio = height.toFloat() / width
        var w = maxW
        var h = w * ratio
        if (h > maxH) { h = maxH; w = h / ratio }
        if (h < minH) h = minH
        return w to h
    }
}

/**
 * Chat photos and voice messages on disk: `GET /api/chat-media/:id` with the session's auth,
 * kept in `cacheDir/chat-media/` (the server says immutable), plus decoded bubble bitmaps in
 * memory. My own uploads are adopted under their client id at send time, so my photo shows and
 * my recording plays without a download once the server copy replaces the pending bubble.
 */
class ChatMediaStore(private val app: LabApp) {
    private val dir get() = File(app.cacheDir, "chat-media").apply { mkdirs() }
    private val locks = HashMap<String, Mutex>()
    private val bitmaps = object : LruCache<String, ImageBitmap>(32 * 1024 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4
    }

    private fun ext(m: ChatMessageDto) = if (m.isVoice) "m4a" else "jpg"
    private fun fileFor(m: ChatMessageDto) = File(dir, "${safe(m.id)}.${ext(m)}")
    private fun adoptedFor(clientId: String, ext: String) = File(dir, "c-${safe(clientId)}.$ext")

    /** A copy of my staged upload under [clientId] (the outbox deletes its own after the upload). */
    fun adopt(clientId: String, source: File, ext: String) {
        runCatching { source.copyTo(adoptedFor(clientId, ext), overwrite = true) }
    }

    /** The message's bytes on disk: cached, adopted from my upload, or downloaded (null offline / failed). */
    suspend fun file(m: ChatMessageDto): File? = withContext(Dispatchers.IO) {
        val url = m.media_url ?: return@withContext null
        val f = fileFor(m)
        if (f.exists() && f.length() > 0) return@withContext f
        val lock = synchronized(locks) { locks.getOrPut(m.id) { Mutex() } }
        lock.withLock {
            if (f.exists() && f.length() > 0) return@withLock f
            m.client_id?.let { adoptedFor(it, ext(m)) }?.takeIf { it.exists() }?.let { a ->
                if (a.renameTo(f) || runCatching { a.copyTo(f, overwrite = true); a.delete() }.isSuccess) return@withLock f
            }
            runCatching { app.repo.api.downloadChatMedia(url, f) }.getOrNull()?.let { f }
        }
    }

    /** A photo for a bubble ([maxSide] px) or the viewer; memory first. */
    suspend fun image(m: ChatMessageDto, maxSide: Int): ImageBitmap? {
        val key = "${m.id}@$maxSide"
        bitmaps.get(key)?.let { return it }
        val f = file(m) ?: return null
        return decode(f, maxSide)?.also { if (maxSide <= 1080) bitmaps.put(key, it) }
    }

    /** A staged (pending) photo. */
    suspend fun localImage(path: String, maxSide: Int): ImageBitmap? {
        val key = "local:$path@$maxSide"
        bitmaps.get(key)?.let { return it }
        return decode(File(path), maxSide)?.also { bitmaps.put(key, it) }
    }

    private suspend fun decode(f: File, maxSide: Int): ImageBitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.absolutePath, bounds)
            val sample = ChatMediaSizing.sampleSize(bounds.outWidth, bounds.outHeight, maxSide)
            BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }.getOrNull()
    }

    private fun safe(id: String) = id.replace(Regex("[^A-Za-z0-9_-]"), "_")

    /** Sign-out. */
    fun clear() { dir.listFiles()?.forEach { it.delete() }; bitmaps.evictAll() }

    companion object {
        @Volatile private var shared: ChatMediaStore? = null

        /** One store per process (the bitmap cache outlives a chat screen). */
        fun of(app: LabApp): ChatMediaStore = shared ?: synchronized(this) { shared ?: ChatMediaStore(app).also { shared = it } }

        /** Bounds of a JPEG on disk (pending photo bubbles). */
        fun dims(path: String): Pair<Int, Int>? = runCatching {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, o)
            if (o.outWidth > 0 && o.outHeight > 0) o.outWidth to o.outHeight else null
        }.getOrNull()
    }
}

/**
 * A photo from the camera or the picker, ready to send: EXIF orientation applied, ≤ 1600 px on the
 * long side, JPEG q80 written to [dest] (a re-encoded bitmap carries no EXIF, so no location
 * leaves the phone). Returns the written size.
 */
object ChatPhoto {
    fun prepare(context: Context, uri: Uri, dest: File): Pair<Int, Int> {
        val bitmap = decode(context, uri) ?: throw IllegalArgumentException("This photo couldn't be opened. Try a JPEG or PNG.")
        val (w, h) = ChatMediaSizing.targetSize(bitmap.width, bitmap.height)
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(out)
        canvas.drawColor(android.graphics.Color.WHITE)
        canvas.drawBitmap(bitmap, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        FileOutputStream(dest).use { out.compress(Bitmap.CompressFormat.JPEG, ChatMediaSizing.JPEG_QUALITY, it) }
        return w to h
    }

    private fun decode(context: Context, uri: Uri): Bitmap? {
        val max = ChatMediaSizing.MAX_SIDE
        if (Build.VERSION.SDK_INT >= 28) {
            // ImageDecoder applies the EXIF orientation itself; sample big camera photos while decoding.
            runCatching {
                return ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
                    val long = maxOf(info.size.width, info.size.height)
                    if (long > max * 2) {
                        val f = long.toDouble() / (max * 2)
                        decoder.setTargetSize((info.size.width / f).toInt().coerceAtLeast(1), (info.size.height / f).toInt().coerceAtLeast(1))
                    }
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
            }
        }
        val resolver = context.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val sample = ChatMediaSizing.sampleSize(bounds.outWidth, bounds.outHeight, max)
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

/** Voice messages: AAC in MP4 (`audio/mp4`, .m4a), mono 44.1 kHz, with a 0..1 level for the meter. */
class ChatVoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var startedAt = 0L
    var file: File? = null
        private set

    fun start(dest: File) {
        stopQuietly()
        @Suppress("DEPRECATION")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(44_100)
        r.setAudioEncodingBitRate(64_000)
        r.setOutputFile(dest.absolutePath)
        r.prepare()
        r.start()
        recorder = r
        file = dest
        startedAt = System.currentTimeMillis()
    }

    fun elapsedMs(): Long = if (recorder == null) 0 else System.currentTimeMillis() - startedAt

    /** 0..1 from MediaRecorder's peak amplitude since the last call. */
    fun level(): Float = runCatching { (recorder?.maxAmplitude ?: 0) / 32767f }.getOrDefault(0f).coerceIn(0f, 1f)

    /** Stops and returns (file, duration ms); null when it was too short to keep or failed. */
    fun stop(): Pair<File, Long>? {
        val r = recorder ?: return null
        val duration = elapsedMs()
        recorder = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file
        return if (ok && f != null && f.exists() && duration >= MIN_MS) f to duration else { f?.delete(); null }
    }

    fun cancel() { stopQuietly(); file?.delete(); file = null }

    private fun stopQuietly() {
        recorder?.let { r -> runCatching { r.stop() }; r.release() }
        recorder = null
    }

    companion object {
        const val MIN_MS = 600L
        /** docs/CHAT.md: ≤ 5 min. */
        const val MAX_MS = 5 * 60_000L
    }
}
