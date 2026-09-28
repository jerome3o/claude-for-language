package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

private fun parse(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))

fun annotationsActive(a: Annotations, now: Long): Boolean =
    a.strokes.values.any { CallAnnotate.strokeAlpha(it.doneAt, now) > 0 } || a.pings.any { CallAnnotate.pingProgress(it.at, now) != null }

/** Draw every stroke and ping over the shared picture shown whole (contain) in this box. */
fun DrawScope.drawAnnotations(a: Annotations, video: VideoFit.Size?, now: Long) {
    val box = VideoFit.Size(size.width.toDouble(), size.height.toDouble())
    val scale = min(size.width, size.height)
    for (s in a.strokes.values) {
        val alpha = CallAnnotate.strokeAlpha(s.doneAt, now).toFloat()
        if (alpha <= 0f || s.stroke.points.isEmpty()) continue
        val path = Path()
        s.stroke.points.forEachIndexed { i, p ->
            val (x, y) = CallAnnotate.denormalizePoint(p, box, video)
            if (i == 0) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat())
        }
        if (s.stroke.points.size == 1) path.relativeLineTo(0.01f, 0f)
        val w = max(2.5f * density, (s.stroke.width.toFloat()) * scale)
        drawPath(path, Color.Black.copy(alpha = 0.45f * alpha), style = Stroke(width = w + 3 * density, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawPath(path, parse(s.stroke.color).copy(alpha = alpha), style = Stroke(width = w, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
    val yellow = Color(0xFFFACC15)
    for (p in a.pings) {
        val t = CallAnnotate.pingProgress(p.at, now) ?: continue
        val (x, y) = CallAnnotate.denormalizePoint(p.x to p.y, box, video)
        val c = Offset(x.toFloat(), y.toFloat())
        for (k in listOf(0.0, 0.35)) {
            val tt = t - k
            if (tt < 0) continue
            drawCircle(yellow.copy(alpha = (max(0.0, 1 - tt) * 0.9).toFloat()), radius = ((10 + tt * 42) * density).toFloat(), center = c, style = Stroke(4 * density))
        }
        drawCircle(yellow.copy(alpha = max(0.0, 1 - t).toFloat()), radius = 6 * density, center = c)
    }
}

/**
 * The drawings over a video of a shared screen (web: AnnotationLayer.tsx). With [interactive], a drag
 * is a stroke and a quick tap is a "look here" ping; points are normalised to the shared picture.
 */
@Composable
fun AnnotationCanvas(
    annotations: Annotations,
    video: VideoFit.Size?,
    modifier: Modifier = Modifier,
    interactive: Boolean = false,
    color: String = CallAnnotate.ANNOT_COLORS[0],
    onStroke: (AnnotStroke) -> Unit = {},
    onPing: (Double, Double) -> Unit = { _, _ -> },
    nowMs: () -> Long = System::currentTimeMillis,
) {
    var now by remember { mutableLongStateOf(nowMs()) }
    val latest by rememberUpdatedState(annotations)
    LaunchedEffect(annotations) {
        now = nowMs()
        while (annotationsActive(latest, now)) {
            val before = now
            withFrameMillis { now = nowMs() }
            if (now == before) break // a frozen clock (screenshots): nothing will fade
        }
    }
    val videoNow by rememberUpdatedState(video)
    val colorNow by rememberUpdatedState(color)
    val input = if (!interactive) Modifier else Modifier.pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown()
            val box = VideoFit.Size(size.width.toDouble(), size.height.toDouble())
            fun norm(o: Offset) = CallAnnotate.normalizePoint(o.x.toDouble(), o.y.toDouble(), box, videoNow)
            val start = norm(down.position) ?: return@awaitEachGesture
            val id = "a" + System.currentTimeMillis().toString(36) + (0..999).random()
            val points = mutableListOf(start)
            val t0 = System.currentTimeMillis()
            var lastSent = 0L
            var moved = 0f
            fun send(done: Boolean) {
                onStroke(AnnotStroke(id, colorNow, CallAnnotate.ANNOT_WIDTH, CallAnnotate.simplifyPoints(points), done))
                lastSent = System.currentTimeMillis()
            }
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull() ?: break
                if (!ch.pressed) break
                ch.consume()
                moved = max(moved, hypot(ch.position.x - down.position.x, ch.position.y - down.position.y))
                norm(ch.position)?.let { points.add(it) }
                if (moved > 6 * density && System.currentTimeMillis() - lastSent > 40 && ch.positionChange() != Offset.Zero) send(false)
            }
            if (moved <= 6 * density && System.currentTimeMillis() - t0 < 400) onPing(start.first, start.second) else send(true)
        }
    }
    Canvas(modifier.then(input)) { drawAnnotations(annotations, video, now) }
}
