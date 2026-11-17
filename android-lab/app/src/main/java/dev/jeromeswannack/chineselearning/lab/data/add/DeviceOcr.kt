package dev.jeromeswannack.chineselearning.lab.data.add

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import dev.jeromeswannack.chineselearning.lab.core.add.AddTab
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * The ＋ Add tab's photo → Chinese ON THE PHONE (docs/ADD_TAB.md "Photo → words"): ML Kit's Chinese
 * text recognizer, the UNBUNDLED one — its model is downloaded by Google Play services (at install,
 * AndroidManifest `com.google.mlkit.vision.DEPENDENCIES` = ocr_chinese), so the APK only carries the
 * small client. Instant and offline once the model is there; when it isn't (no Play services, not
 * downloaded yet) or nothing Chinese is found, the screen asks the server (`POST /api/ocr/words`).
 *
 * Its lines are put on the same 0–1000 grid as the server's and ordered by the same rule
 * (core AddTab.orderLines: the big central subtitle first).
 */
interface PhotoReader {
    /** The Chinese lines, most prominent first; null = the recognizer isn't available (ask the server). */
    suspend fun read(bitmap: Bitmap): List<AddTab.Line>?
}

object DeviceOcr : PhotoReader {
    /** Longer than this and the server is asked instead. */
    private const val TIMEOUT_MS = 4_000L

    private val recognizer by lazy { TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build()) }

    override suspend fun read(bitmap: Bitmap): List<AddTab.Line>? = runCatching {
        withTimeoutOrNull(TIMEOUT_MS) {
            suspendCancellableCoroutine<List<AddTab.Line>?> { cont ->
                recognizer.process(InputImage.fromBitmap(bitmap, 0))
                    .addOnSuccessListener { text ->
                        val w = bitmap.width.toDouble().coerceAtLeast(1.0)
                        val h = bitmap.height.toDouble().coerceAtLeast(1.0)
                        val lines = text.textBlocks.flatMap { block ->
                            block.lines.map { line ->
                                val r = line.boundingBox
                                AddTab.Line(
                                    line.text,
                                    r?.let { listOf(it.top / h * 1000, it.left / w * 1000, it.bottom / h * 1000, it.right / w * 1000) },
                                )
                            }
                        }
                        if (cont.isActive) cont.resume(AddTab.orderLines(lines))
                    }
                    .addOnFailureListener { if (cont.isActive) cont.resume(null) }
            }
        }
    }.getOrNull()
}
