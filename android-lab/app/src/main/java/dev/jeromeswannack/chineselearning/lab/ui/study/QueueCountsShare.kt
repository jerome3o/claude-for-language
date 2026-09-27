package dev.jeromeswannack.chineselearning.lab.ui.study

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import androidx.core.content.FileProvider
import dev.jeromeswannack.chineselearning.lab.core.QueueCounts
import java.io.File
import kotlin.math.ceil

/**
 * Which of the four top-bar counts the card on screen belongs to — port of
 * QueueCountsHeader.tsx (`isNewActive` / `isSecondaryActive` / `isLearningActive` /
 * `isReviewActive`). A NEW card is purple (secondary) when its note already has a
 * reviewed card in this session's live `reviewedNoteIds` — the same rule as the counts.
 */
enum class CountBucket { NEW, SECONDARY, LEARNING, REVIEW;

    companion object {
        /** CardQueue: NEW 0, LEARNING 1, REVIEW 2, RELEARNING 3. */
        fun of(queue: Int?, isSecondaryNew: Boolean): CountBucket? = when (queue) {
            0 -> if (isSecondaryNew) SECONDARY else NEW
            1, 3 -> LEARNING
            2 -> REVIEW
            else -> null
        }
    }
}

/**
 * Tap the counts → an image of them on the clipboard (the web's `copyQueueCountsImage`
 * in utils/queue-counts-image.ts: same segments, colours, 48px bold digits, 24px padding,
 * white background, 2× scale).
 */
object QueueCountsShare {
    private const val NEW = 0xFF3B82F6.toInt()
    private const val SECONDARY = 0xFF8B5CF6.toInt()
    private const val LEARNING = 0xFFEF4444.toInt()
    private const val REVIEW = 0xFF22C55E.toInt()
    private const val SEPARATOR = 0xFF6B7280.toInt()

    /** The plain-text form (the web's fallback when an image can't go on the clipboard). */
    fun text(c: QueueCounts) = "${c.new} + ${c.secondaryNew} + ${c.learning} + ${c.review}"

    fun render(c: QueueCounts, scale: Float = 2f): Bitmap {
        val fontSize = 48f * scale
        val padding = 24f * scale
        val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = fontSize; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD) }
        val plain = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = fontSize; typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL) }
        val segments = listOf(
            Triple("${c.new}", NEW, bold), Triple(" + ", SEPARATOR, plain),
            Triple("${c.secondaryNew}", SECONDARY, bold), Triple(" + ", SEPARATOR, plain),
            Triple("${c.learning}", LEARNING, bold), Triple(" + ", SEPARATOR, plain),
            Triple("${c.review}", REVIEW, bold),
        )
        val textWidth = segments.sumOf { (t, _, p) -> p.measureText(t).toDouble() }.toFloat()
        val width = ceil(textWidth + padding * 2).toInt()
        val height = ceil(fontSize + padding * 2).toInt()
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(android.graphics.Color.WHITE)
        var x = padding
        // textBaseline 'middle': centre the glyph box on the image's midline.
        val fm = bold.fontMetrics
        val y = height / 2f - (fm.ascent + fm.descent) / 2f
        for ((t, color, paint) in segments) {
            paint.color = color
            canvas.drawText(t, x, y, paint)
            x += paint.measureText(t)
        }
        return bitmap
    }

    /** Writes the PNG into the cache and returns a shareable content:// URI (FileProvider). */
    fun pngUri(context: Context, c: QueueCounts): Uri {
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        val file = File(dir, "queue-counts.png")
        file.outputStream().use { render(c).compress(Bitmap.CompressFormat.PNG, 100, it) }
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    /**
     * Puts the image on the clipboard (text as well, for apps that only paste text).
     * Returns false when it couldn't — the caller then offers the share sheet.
     */
    fun copy(context: Context, c: QueueCounts): Boolean = runCatching {
        val uri = pngUri(context, c)
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return false
        val clip = ClipData.newUri(context.contentResolver, "Study counts", uri)
        clip.addItem(ClipData.Item(text(c)))
        clipboard.setPrimaryClip(clip)
        true
    }.getOrDefault(false)

    /** The share sheet with the image (and the text) — for apps that don't paste images. */
    fun share(context: Context, c: QueueCounts) {
        runCatching {
            val uri = pngUri(context, c)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_TEXT, text(c))
                clipData = ClipData.newRawUri("Study counts", uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(send, "Share today's counts").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
