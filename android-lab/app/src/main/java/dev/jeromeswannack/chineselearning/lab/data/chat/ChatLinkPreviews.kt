package dev.jeromeswannack.chineselearning.lab.data.chat

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.data.api.enc
import dev.jeromeswannack.chineselearning.lab.data.api.send
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.Request
import java.io.File
import java.security.MessageDigest

/** `GET /api/link-preview?url=` (docs/CHAT.md "Round 2"): what the worker found on the page. */
@Serializable
data class LinkPreviewDto(
    val url: String = "",
    val title: String? = null,
    val description: String? = null,
    val image: String? = null,
    val site_name: String? = null,
) {
    /** Worth a card: something to show besides the URL. */
    val usable: Boolean get() = !title.isNullOrBlank() || !description.isNullOrBlank() || !image.isNullOrBlank()
}

/** A cached answer: [preview] null = the worker found nothing (404) — not asked again for a day. */
@Serializable
data class CachedLinkPreview(val url: String, val preview: LinkPreviewDto? = null, val at: Long = 0)

/**
 * Link previews for chat bubbles, cache-first: JsonCache `chat/link/<hash>` (the web keeps an LRU
 * of 200 in localStorage), fetched once when a bubble with a link comes on screen. Fails quietly —
 * a bubble without a preview is just the text. The preview's picture is fetched WITHOUT the
 * session (a plain request to a third-party host) and kept in `cacheDir/chat-link/`.
 */
class ChatLinkPreviews(private val app: LabApp) {
    private val dir get() = File(app.cacheDir, "chat-link").apply { mkdirs() }

    suspend fun cached(url: String): CachedLinkPreview? = runCatching { app.cache.get<CachedLinkPreview>(key(url)) }.getOrNull()

    /** The cached preview when fresh, else the worker's (null = none / offline / failed). */
    suspend fun preview(url: String): LinkPreviewDto? {
        val c = cached(url)
        if (c != null && (c.preview != null || System.currentTimeMillis() - c.at < NONE_TTL_MS)) return c.preview
        if (!app.online.value) return c?.preview
        val r = runCatching { app.repo.api.send("GET", "/api/link-preview?url=${enc(url)}") }.getOrNull() ?: return null
        val p = when {
            r.ok -> runCatching { app.repo.api.json.decodeFromString(LinkPreviewDto.serializer(), r.body) }.getOrNull()?.takeIf { it.usable }
            r.code == 404 -> null
            else -> return null // a server error: ask again next time
        }
        runCatching { app.cache.put(key(url), KIND, CachedLinkPreview(url, p, System.currentTimeMillis())) }
        return p
    }

    /** The preview's picture (≤ [maxSide] px), downloaded once; null when missing or too big. */
    suspend fun image(imageUrl: String, maxSide: Int): ImageBitmap? = withContext(Dispatchers.IO) {
        if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("http://")) return@withContext null
        val f = File(dir, hash(imageUrl))
        if (!f.exists() || f.length() == 0L) {
            if (!app.online.value) return@withContext null
            runCatching {
                app.repo.api.http.newCall(Request.Builder().url(imageUrl).build()).execute().use { res ->
                    val body = res.body ?: return@use
                    if (!res.isSuccessful || body.contentLength() > MAX_IMAGE_BYTES) return@use
                    val out = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(16 * 1024)
                    body.byteStream().use { input ->
                        while (out.size() <= MAX_IMAGE_BYTES) {
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                        }
                    }
                    if (out.size() <= MAX_IMAGE_BYTES) f.writeBytes(out.toByteArray())
                }
            }
        }
        if (!f.exists()) return@withContext null
        runCatching {
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(f.absolutePath, bounds)
            val sample = ChatMediaSizing.sampleSize(bounds.outWidth, bounds.outHeight, maxSide)
            BitmapFactory.decodeFile(f.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
        }.getOrNull()
    }

    companion object {
        const val KIND = "chat"
        /** "Nothing usable" is remembered for a day (the worker caches a day too). */
        const val NONE_TTL_MS = 24 * 60 * 60 * 1000L
        const val MAX_IMAGE_BYTES = 2L * 1024 * 1024

        fun key(url: String) = "chat/link/${hash(url)}"

        fun hash(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).take(12).joinToString("") { "%02x".format(it) }
    }
}
