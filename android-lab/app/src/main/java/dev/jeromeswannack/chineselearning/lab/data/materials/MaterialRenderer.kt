package dev.jeromeswannack.chineselearning.lab.data.materials

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ImageDecoder
import android.graphics.pdf.PdfRenderer
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.ext.SdkExtensions
import dev.jeromeswannack.chineselearning.lab.core.Materials
import dev.jeromeswannack.chineselearning.lab.core.PptxSlides
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipFile
import kotlin.coroutines.coroutineContext

/** One rendered page: its JPEG on disk, its size and its text (agents read it). */
data class RenderedPage(val image: File, val width: Int, val height: Int, val text: String, val notes: String)

data class RenderResult(val pages: List<RenderedPage>, val renderNote: String?)

/**
 * Renders a lesson material to page pictures on the phone (web services/materials/render.ts), so the
 * server, the other person and both apps only ever show pictures:
 * - PDF: Android's PdfRenderer draws each page [Materials.MATERIAL_RENDER_WIDTH] px wide. Its text comes
 *   from `Page.getTextContents()` where the phone has it (Android 15+ PDF extension); older phones send
 *   empty text (the web reads pdf.js's text layer) — the pictures are the same;
 * - picture: as it is (orientation applied, at most 2400 px on the long side), re-encoded;
 * - PowerPoint: core [PptxSlides] reads the slide XML and [SlideDrawer] paints text boxes + pictures —
 *   the same approximation as the web, said so in `renderNote` ([Materials.PPTX_RENDER_NOTE]).
 * Pages are JPEG (quality 86, like the web's canvas.toBlob) in [outDir].
 */
class MaterialRenderer(private val outDir: File) {
    private fun out(i: Int) = File(outDir.apply { mkdirs() }, "page-$i.jpg")

    private fun save(bitmap: Bitmap, i: Int): File {
        val f = out(i)
        f.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 86, it) }
        return f
    }

    suspend fun render(file: File, kind: Materials.Kind, onProgress: (done: Int, total: Int) -> Unit = { _, _ -> }): RenderResult = withContext(Dispatchers.Default) {
        when (kind) {
            Materials.Kind.PDF -> renderPdf(file, onProgress)
            Materials.Kind.PPTX -> renderPptx(file, onProgress)
            Materials.Kind.IMAGE -> renderImage(file)
        }
    }

    private suspend fun renderPdf(file: File, onProgress: (Int, Int) -> Unit): RenderResult {
        val pages = ArrayList<RenderedPage>()
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { pdf ->
                val total = minOf(pdf.pageCount, Materials.MAX_MATERIAL_PAGES)
                if (total == 0) throw IllegalArgumentException("This PDF has no pages")
                for (i in 0 until total) {
                    coroutineContext.ensureActive()
                    pdf.openPage(i).use { page ->
                        val w = Materials.MATERIAL_RENDER_WIDTH
                        val h = Math.max(1, Math.round(w.toDouble() * page.height / page.width).toInt())
                        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(Color.WHITE)
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        val image = save(bmp, i)
                        bmp.recycle()
                        pages += RenderedPage(image, w, h, Materials.cleanPageText(pageText(page)), "")
                    }
                    onProgress(i + 1, total)
                }
            }
        }
        return RenderResult(pages, null)
    }

    /** The page's text where the phone's PDF renderer can read it (Android 15+), else "". */
    @SuppressLint("NewApi")
    private fun pageText(page: PdfRenderer.Page): String {
        if (Build.VERSION.SDK_INT < 35) return ""
        return runCatching {
            if (SdkExtensions.getExtensionVersion(Build.VERSION_CODES.S) < 13) return ""
            page.textContents.joinToString("\n") { it.text }
        }.getOrDefault("")
    }

    private fun renderImage(file: File): RenderResult {
        val src = decode(file) ?: throw IllegalArgumentException("Couldn’t read that picture")
        val k = Math.min(1.0, 2400.0 / Math.max(src.width, src.height))
        val w = Math.max(1, Math.round(src.width * k).toInt())
        val h = Math.max(1, Math.round(src.height * k).toInt())
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        Canvas(bmp).apply {
            drawColor(Color.WHITE)
            drawBitmap(src, null, android.graphics.Rect(0, 0, w, h), android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        }
        src.recycle()
        val image = save(bmp, 0)
        bmp.recycle()
        return RenderResult(listOf(RenderedPage(image, w, h, "", "")), null)
    }

    /** Orientation applied (ImageDecoder), software bitmaps so they can be drawn onto a canvas. */
    private fun decode(file: File): Bitmap? = runCatching {
        if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { d, info, _ ->
            d.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val long = Math.max(info.size.width, info.size.height)
            if (long > 4800) { val k = 4800.0 / long; d.setTargetSize(Math.round(info.size.width * k).toInt(), Math.round(info.size.height * k).toInt()) }
        } else BitmapFactory.decodeFile(file.path)
    }.getOrNull() ?: BitmapFactory.decodeFile(file.path)

    private suspend fun renderPptx(file: File, onProgress: (Int, Int) -> Unit): RenderResult {
        val pages = ArrayList<RenderedPage>()
        val zip = runCatching { ZipFile(file) }.getOrElse { throw IllegalArgumentException("This isn’t a PowerPoint file") }
        zip.use { z ->
            fun text(path: String): String? = z.getEntry(path)?.let { e -> z.getInputStream(e).use { it.readBytes().toString(Charsets.UTF_8) } }
            val slides = PptxSlides.read(::text).take(Materials.MAX_MATERIAL_PAGES)
            if (slides.isEmpty()) throw IllegalArgumentException("No slides found in this PowerPoint")
            val images = HashMap<String, Bitmap>()
            try {
                for ((i, s) in slides.withIndex()) {
                    coroutineContext.ensureActive()
                    for (sh in s.shapes) {
                        if (sh !is PptxSlides.Picture || images.containsKey(sh.path)) continue
                        val bytes = z.getEntry(sh.path)?.let { e -> z.getInputStream(e).use { it.readBytes() } } ?: continue
                        // A format Android can't decode is left out (like the web).
                        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sampleFor(bytes) })?.let { images[sh.path] = it }
                    }
                    val w = Materials.MATERIAL_RENDER_WIDTH
                    val h = Math.max(1, Math.round(w * s.height / s.width).toInt())
                    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                    SlideDrawer.draw(Canvas(bmp), s, w, images)
                    val image = save(bmp, i)
                    bmp.recycle()
                    pages += RenderedPage(image, w, h, Materials.cleanPageText(PptxSlides.slideText(s)), Materials.cleanPageText(s.notes))
                    onProgress(i + 1, slides.size)
                }
            } finally {
                images.values.forEach { it.recycle() }
            }
        }
        return RenderResult(pages, Materials.PPTX_RENDER_NOTE)
    }

    /** Big slide pictures are decoded at most ~3200 px on the long side (memory). */
    private fun sampleFor(bytes: ByteArray): Int {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
        var s = 1
        while (Math.max(o.outWidth, o.outHeight) / s > 3200) s *= 2
        return s
    }
}
