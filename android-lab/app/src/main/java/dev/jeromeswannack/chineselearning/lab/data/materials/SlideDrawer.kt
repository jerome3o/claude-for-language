package dev.jeromeswannack.chineselearning.lab.data.materials

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import dev.jeromeswannack.chineselearning.lab.core.PptxSlides

/**
 * Port of `drawSlide` / `wrap` (frontend/src/services/materials/pptx.ts): paints a slide model onto an
 * Android Canvas [width] px wide — background, pictures first, then each text box's paragraphs (font size
 * in points → px at the slide's scale, bold for titles, colour, bullets, indent per level, alignment),
 * wrapped to the box (CJK anywhere, Latin at spaces). Boxes a placeholder inherits from the layout get
 * the same fallback positions as the web.
 */
object SlideDrawer {
    private fun fallbackBox(t: PptxSlides.TextBox, s: PptxSlides.Slide, nth: Int): RectF {
        val w = s.width
        val h = s.height
        fun r(x: Double, y: Double, bw: Double, bh: Double) = RectF(x.toFloat(), y.toFloat(), (x + bw).toFloat(), (y + bh).toFloat())
        return when (t.placeholder) {
            "title" -> r(w * 0.06, h * 0.05, w * 0.88, h * 0.16)
            "ctrTitle" -> r(w * 0.1, h * 0.3, w * 0.8, h * 0.2)
            "subTitle" -> r(w * 0.15, h * 0.55, w * 0.7, h * 0.15)
            else -> r(w * 0.06, h * (0.25 + 0.05 * nth), w * 0.88, h * 0.65)
        }
    }

    private val TOKENS = Regex("[　-鿿＀-￯]|[^\\s　-鿿＀-￯]+|\\s+")

    /** `wrap`: one paragraph's characters into lines that fit [maxW]. */
    fun wrap(paint: Paint, text: String, maxW: Float): List<String> {
        val lines = ArrayList<String>()
        for (raw in text.split("\n")) {
            var line = ""
            val tokens = TOKENS.findAll(raw).map { it.value }.toList().ifEmpty { listOf("") }
            for (tok in tokens) {
                val next = line + tok
                if (line.isNotEmpty() && paint.measureText(next) > maxW) {
                    lines += line.trimEnd()
                    line = tok.trimStart()
                } else line = next
            }
            lines += line
        }
        return lines
    }

    private fun parseColor(hex: String?, fallback: Int): Int = runCatching { Color.parseColor(hex ?: return fallback) }.getOrDefault(fallback)

    fun draw(canvas: Canvas, s: PptxSlides.Slide, width: Int, images: Map<String, Bitmap>) {
        val scale = width / s.width
        val height = Math.round(s.height * scale).toInt()
        canvas.drawColor(Color.WHITE)
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), Paint().apply { color = parseColor(s.background, Color.WHITE) })
        // Pictures first (text usually sits on top of them).
        val picPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        for (sh in s.shapes) {
            if (sh !is PptxSlides.Picture) continue
            val img = images[sh.path] ?: continue
            canvas.drawBitmap(img, null, RectF((sh.x * scale).toFloat(), (sh.y * scale).toFloat(), ((sh.x + sh.w) * scale).toFloat(), ((sh.y + sh.h) * scale).toFloat()), picPaint)
        }
        var bodyN = 0
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        for (sh in s.shapes) {
            if (sh !is PptxSlides.TextBox) continue
            val box = if (sh.w > 0) RectF(sh.x.toFloat(), sh.y.toFloat(), (sh.x + sh.w).toFloat(), (sh.y + sh.h).toFloat()) else fallbackBox(sh, s, bodyN++)
            val bx = box.left * scale
            val bw = box.width() * scale
            val isTitle = sh.placeholder == "title" || sh.placeholder == "ctrTitle"
            var y = box.top * scale + 6
            for (p in sh.paragraphs) {
                val pt = p.runs.firstOrNull { it.size != 0.0 }?.size ?: if (isTitle) 36.0 else 20.0
                val px = Math.max(10.0, pt * 12_700 * scale)
                val bold = isTitle || p.runs.any { it.bold }
                paint.typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                paint.textSize = px.toFloat()
                paint.color = parseColor(p.runs.firstOrNull { it.color != null }?.color, Color.parseColor("#111827"))
                val indent = (if (p.bullet) px * 1.1 else 0.0) + p.level * px * 1.2
                val maxW = Math.max(40.0, bw - indent - 8)
                val text = p.text
                val lines = wrap(paint, text, maxW.toFloat())
                // Canvas draws at the baseline; the web's textBaseline is 'top'.
                val ascent = -paint.ascent()
                lines.forEachIndexed { i, line ->
                    val lw = paint.measureText(line)
                    val x0 = bx + 4 + indent
                    val x = when (p.align) {
                        "ctr" -> bx + (bw - lw) / 2
                        "r" -> bx + bw - lw - 4
                        else -> x0
                    }
                    if (i == 0 && p.bullet) canvas.drawText("•", (x0 - px * 0.9).toFloat(), (y + ascent).toFloat(), paint)
                    canvas.drawText(line, x.toFloat(), (y + ascent).toFloat(), paint)
                    y += px * 1.25
                }
                if (text.isEmpty()) y += px * 0.6
            }
        }
    }
}
