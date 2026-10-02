package dev.jeromeswannack.chineselearning.lab.data.calls

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.net.Uri
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import dev.jeromeswannack.chineselearning.lab.ui.calls.Annotations
import dev.jeromeswannack.chineselearning.lab.ui.calls.annotationsActive
import dev.jeromeswannack.chineselearning.lab.ui.calls.drawAnnotTexts
import dev.jeromeswannack.chineselearning.lab.ui.calls.layoutAnnotTexts
import kotlin.math.max
import kotlin.math.min

/**
 * The drawings on my shared screen — theirs and my own — on top of MY real screen while I share it
 * (Android can do what a browser can't): a see-through, untouchable window over every app ("Display
 * over other apps" permission). Screen sharing captures the whole display, so the shared picture's
 * 0..1 points map straight onto this full-screen window. Kept drawings ("Keep", on by default) stay;
 * others fade. Texts typed on the shared screen (round 4) are drawn here too.
 * Shown only while the call screen is in the background: in the call the screen tile shows them.
 */
class ScreenAnnotationOverlay(private val context: Context) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private var view: OverlayView? = null

    fun permitted(): Boolean = Settings.canDrawOverlays(context)

    /** Android's "Display over other apps" page for this app. */
    fun permissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    val showing: Boolean get() = view != null

    fun show() {
        if (view != null || !permitted()) return
        val v = OverlayView(context)
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        }
        runCatching { wm.addView(v, lp) }.onSuccess { view = v }
    }

    fun hide() {
        view?.let { runCatching { wm.removeView(it) } }
        view = null
    }

    fun update(a: Annotations) {
        view?.let { it.annotations = a; it.invalidate() }
    }

    private class OverlayView(context: Context) : View(context) {
        var annotations = Annotations()
        private val density = resources.displayMetrics.density
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }

        private fun color(hex: String) = (0xFF000000 or hex.removePrefix("#").toLong(16)).toInt()

        override fun onDraw(canvas: Canvas) {
            val now = System.currentTimeMillis()
            // The window covers the display: the picture fills it exactly.
            val box = VideoFit.Size(width.toDouble(), height.toDouble())
            val scale = min(width, height).toFloat()
            for (s in annotations.strokes.values) {
                val alpha = CallAnnotate.strokeAlpha(s.doneAt, now, annotations.persist).toFloat()
                if (alpha <= 0f || s.stroke.points.isEmpty()) continue
                val path = Path()
                s.stroke.points.forEachIndexed { i, p ->
                    val (x, y) = CallAnnotate.denormalizePoint(p, box, box)
                    if (i == 0) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat())
                }
                if (s.stroke.points.size == 1) path.rLineTo(0.01f, 0f)
                val w = max(2.5f * density, s.stroke.width.toFloat() * scale)
                paint.style = Paint.Style.STROKE
                paint.color = android.graphics.Color.BLACK; paint.alpha = (115 * alpha).toInt(); paint.strokeWidth = w + 3 * density
                canvas.drawPath(path, paint)
                paint.color = color(s.stroke.color); paint.alpha = (255 * alpha).toInt(); paint.strokeWidth = w
                canvas.drawPath(path, paint)
            }
            // Round 4: the texts typed on my screen, as the call screen draws them.
            if (annotations.texts.isNotEmpty()) {
                drawAnnotTexts(canvas, layoutAnnotTexts(annotations.texts.values, width.toFloat(), height.toFloat(), box, density), now, annotations.persist, density)
            }
            for (p in annotations.pings) {
                val t = CallAnnotate.pingProgress(p.at, now) ?: continue
                val (x, y) = CallAnnotate.denormalizePoint(p.x to p.y, box, box)
                paint.color = 0xFFFACC15.toInt()
                for (k in listOf(0.0, 0.35)) {
                    val tt = t - k
                    if (tt < 0) continue
                    paint.style = Paint.Style.STROKE; paint.strokeWidth = 4 * density; paint.alpha = (230 * max(0.0, 1 - tt)).toInt()
                    canvas.drawCircle(x.toFloat(), y.toFloat(), ((10 + tt * 42) * density).toFloat(), paint)
                }
                paint.style = Paint.Style.FILL; paint.alpha = (255 * max(0.0, 1 - t)).toInt()
                canvas.drawCircle(x.toFloat(), y.toFloat(), 6 * density, paint)
            }
            if (annotationsActive(annotations, now)) postInvalidateOnAnimation()
        }
    }
}
