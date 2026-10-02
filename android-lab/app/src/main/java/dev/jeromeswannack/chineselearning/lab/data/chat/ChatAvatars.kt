package dev.jeromeswannack.chineselearning.lab.data.chat

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import dev.jeromeswannack.chineselearning.lab.Config
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * The sender's picture for a chat notification: downloaded once with OkHttp, circle-cropped and
 * kept on disk (cacheDir/chat-avatars), so later notifications draw it offline. No picture (or no
 * network the first time) → a coloured circle with their initial.
 */
object ChatAvatars {
    const val SIZE = 192
    private val client by lazy { OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS).readTimeout(5, TimeUnit.SECONDS).build() }

    fun absoluteUrl(url: String): String = if (url.startsWith("/")) Config.API_BASE + url else url

    suspend fun load(context: Context, url: String?, name: String): Bitmap = withContext(Dispatchers.IO) {
        val cached = url?.takeIf { it.isNotBlank() }?.let { u ->
            val file = File(File(context.cacheDir, "chat-avatars").apply { mkdirs() }, sha1(u) + ".png")
            (if (file.exists()) BitmapFactory.decodeFile(file.absolutePath) else null) ?: download(u, file)
        }
        cached ?: initial(name)
    }

    private fun download(url: String, file: File): Bitmap? = runCatching {
        client.newCall(Request.Builder().url(absoluteUrl(url)).build()).execute().use { res ->
            if (!res.isSuccessful) return@use null
            val bytes = res.body?.bytes() ?: return@use null
            val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return@use null
            circle(raw).also { c -> file.outputStream().use { c.compress(Bitmap.CompressFormat.PNG, 100, it) } }
        }
    }.getOrNull()

    fun circle(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        canvas.drawOval(RectF(0f, 0f, SIZE.toFloat(), SIZE.toFloat()), paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        val side = minOf(src.width, src.height)
        val from = Rect((src.width - side) / 2, (src.height - side) / 2, (src.width + side) / 2, (src.height + side) / 2)
        canvas.drawBitmap(src, from, Rect(0, 0, SIZE, SIZE), paint)
        return out
    }

    fun initial(name: String): Bitmap {
        val out = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        val colors = intArrayOf(0xFF5B8DEF.toInt(), 0xFFE0716B.toInt(), 0xFF4CAF84.toInt(), 0xFFB77FE0.toInt(), 0xFFE0A84C.toInt())
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = colors[Math.floorMod(name.hashCode(), colors.size)] }
        canvas.drawOval(RectF(0f, 0f, SIZE.toFloat(), SIZE.toFloat()), bg)
        val letter = name.trim().let { if (it.isEmpty()) "?" else String(Character.toChars(it.codePointAt(0))).uppercase() }
        val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = SIZE * 0.45f; textAlign = Paint.Align.CENTER }
        canvas.drawText(letter, SIZE / 2f, SIZE / 2f - (text.descent() + text.ascent()) / 2, text)
        return out
    }

    private fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
}
