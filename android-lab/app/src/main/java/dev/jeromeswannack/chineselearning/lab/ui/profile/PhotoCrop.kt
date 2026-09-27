package dev.jeromeswannack.chineselearning.lab.ui.profile

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.io.File
import kotlin.math.max

/**
 * "Position your photo" (the web's PictureCropSheet): drag to move, pinch or the slider to
 * zoom, a round guide for the avatar. [onConfirm] gets the square of the source to keep.
 */
@Composable
fun PhotoCropSheet(
    photo: Bitmap,
    busy: Boolean,
    error: String?,
    onCancel: () -> Unit,
    onConfirm: (ProfileRules.SourceRect) -> Unit,
    initialZoom: Float = 1f,
) {
    val image = remember(photo) { photo.asImageBitmap() }
    var crop by remember(photo) { mutableStateOf<ProfileRules.Crop?>(null) }
    LabBottomSheet(onDismiss = { if (!busy) onCancel() }, title = "Position your photo") {
        Text(
            "Drag to move · pinch or use the slider to zoom",
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
            modifier = Modifier.padding(horizontal = 24.dp),
        )
        BoxWithConstraints(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
            val density = LocalDensity.current
            val edge = minOf(maxWidth, 360.dp)
            val viewPx = with(density) { edge.toPx() }
            val c = crop?.takeIf { it.view == viewPx } ?: ProfileRules.zoom(ProfileRules.initial(photo.width, photo.height, viewPx), initialZoom).also { crop = it }
            Box(
                Modifier.widthIn(max = edge).fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(Color(0xFF0F172A))
                    .pointerInput(photo, viewPx) {
                        detectTransformGestures { centroid, pan, zoomBy, _ ->
                            val cur = crop ?: return@detectTransformGestures
                            var next = ProfileRules.pan(cur, pan.x, pan.y)
                            if (zoomBy != 1f) next = ProfileRules.zoom(next, next.zoom * zoomBy, centroid.x, centroid.y)
                            crop = next
                        }
                    },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    drawImage(
                        image,
                        srcOffset = IntOffset.Zero,
                        srcSize = IntSize(photo.width, photo.height),
                        dstOffset = IntOffset(c.ox.toInt(), c.oy.toInt()),
                        dstSize = IntSize((photo.width * c.scale).toInt(), (photo.height * c.scale).toInt()),
                    )
                    // Dim outside the round guide, then the ring itself.
                    val r = size.minDimension / 2
                    val path = androidx.compose.ui.graphics.Path().apply {
                        fillType = androidx.compose.ui.graphics.PathFillType.EvenOdd
                        addRect(androidx.compose.ui.geometry.Rect(Offset.Zero, size))
                        addOval(androidx.compose.ui.geometry.Rect(center, r))
                    }
                    drawPath(path, Color(0x800F172A))
                    drawCircle(Color.White.copy(alpha = 0.9f), r - 1.dp.toPx(), style = Stroke(2.dp.toPx()))
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("−", style = MaterialTheme.typography.titleLarge, color = Lab.colors.muted)
            Slider(
                value = crop?.zoom ?: 1f,
                onValueChange = { z -> crop = crop?.let { ProfileRules.zoom(it, z) } },
                valueRange = 1f..ProfileRules.MAX_ZOOM,
                enabled = !busy,
                modifier = Modifier.weight(1f).padding(horizontal = 12.dp),
                colors = SliderDefaults.colors(thumbColor = Lab.colors.accent, activeTrackColor = Lab.colors.accent),
            )
            Text("+", style = MaterialTheme.typography.titleLarge, color = Lab.colors.muted)
        }
        error?.let { InlineNotice(it, Modifier.padding(horizontal = 24.dp, vertical = 8.dp), kind = NoticeKind.Error) }
        Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f), enabled = !busy, onClick = onCancel)
            PrimaryPill(if (busy) "Uploading…" else "Use this photo", Modifier.weight(1f), enabled = !busy && crop != null) {
                crop?.let { onConfirm(ProfileRules.sourceRect(it)) }
            }
        }
    }
}

/** Photos: decode a picked image (EXIF rotation applied), at most ~2048px on the long side. */
object PhotoFiles {
    private const val MAX_DECODE = 2048

    fun decode(context: Context, uri: Uri): Bitmap {
        if (Build.VERSION.SDK_INT >= 28) {
            val src = ImageDecoder.createSource(context.contentResolver, uri)
            return ImageDecoder.decodeBitmap(src) { decoder, info, _ ->
                val (w, h) = info.size.width to info.size.height
                val scale = MAX_DECODE.toFloat() / max(w, h)
                if (scale < 1f) decoder.setTargetSize((w * scale).toInt().coerceAtLeast(1), (h * scale).toInt().coerceAtLeast(1))
                decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DECODE) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalArgumentException("This photo couldn't be opened. Try a JPEG or PNG.")
    }

    /** Cut the chosen square, resize it (≤ 512px) and write a JPEG to [dir]. */
    fun renderJpeg(photo: Bitmap, rect: ProfileRules.SourceRect, dir: File): File {
        val square = Bitmap.createBitmap(photo, rect.sx, rect.sy, rect.side, rect.side)
        val size = ProfileRules.outputSize(rect.side)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(out).apply {
            drawColor(android.graphics.Color.WHITE) // transparent PNGs get white, not black
            drawBitmap(square, null, android.graphics.Rect(0, 0, size, size), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        }
        val file = File(dir.apply { mkdirs() }, "profile-upload.jpg")
        file.outputStream().use { out.compress(Bitmap.CompressFormat.JPEG, 88, it) }
        return file
    }
}
