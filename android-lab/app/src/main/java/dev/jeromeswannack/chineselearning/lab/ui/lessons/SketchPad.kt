package dev.jeromeswannack.chineselearning.lab.ui.lessons

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.HandwritingAnswer
import dev.jeromeswannack.chineselearning.lab.core.HandwritingStrokes
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab

/**
 * Free handwriting (the web's HandwritingPad / SketchPad): strokes captured as vectors
 * in dp, one 田字格 box per expected character (max 6). The learner compares with the
 * model and self-assesses; the tutor sees exactly what was written (StrokesView).
 * Also the offline fallback of the stroke-order pad.
 */
@Composable
fun SketchPad(target: String?, onChange: (HandwritingAnswer) -> Unit, modifier: Modifier = Modifier) {
    val strokes = remember { mutableStateListOf<List<Offset>>() }
    val current = remember { mutableStateListOf<Offset>() }
    val boxes = targetChars(target).size.coerceIn(1, 6)
    val density = LocalDensity.current
    val ink = Lab.colors.ink
    val grid = Lab.colors.cardBorder
    // The pad's size in dp (the strokes' coordinate space), set when it is laid out.
    val padSize = remember { intArrayOf(boxes * 150, 150) }
    fun report() {
        val flat = strokes.map { s -> s.flatMap { p -> with(density) { listOf(p.x.toDp().value.toInt(), p.y.toDp().value.toInt()) } } }
        onChange(HandwritingAnswer(engine = "sketch", strokes = HandwritingStrokes(padSize[0], padSize[1], flat)))
    }

    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val width = maxWidth
            val height = (width / boxes).coerceIn(150.dp, 240.dp)
            padSize[0] = width.value.toInt()
            padSize[1] = height.value.toInt()
            Box(
                Modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(18.dp)).background(Lab.colors.card).border(1.5.dp, grid, RoundedCornerShape(18.dp))
                    .pointerInput(Unit) {
                        detectDragGestures(
                            onDragStart = { current.clear(); current.add(it) },
                            onDrag = { change, _ ->
                                val last = current.lastOrNull()
                                if (last == null || (change.position - last).getDistance() >= 2 * density.density) current.add(change.position)
                            },
                            onDragEnd = { strokes.add(current.toList()); current.clear(); report() },
                            onDragCancel = { strokes.add(current.toList()); current.clear(); report() },
                        )
                    }
                    .pointerInput(Unit) { detectTapGestures { strokes.add(listOf(it)); report() } },
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    val boxW = size.width / boxes
                    val dash = PathEffect.dashPathEffect(floatArrayOf(10f, 10f))
                    for (b in 0 until boxes) {
                        val x0 = b * boxW
                        if (b > 0) drawLine(grid, Offset(x0, 0f), Offset(x0, size.height), strokeWidth = 2f)
                        drawLine(grid.copy(alpha = 0.6f), Offset(x0 + boxW / 2, 0f), Offset(x0 + boxW / 2, size.height), pathEffect = dash)
                        drawLine(grid.copy(alpha = 0.6f), Offset(x0, size.height / 2), Offset(x0 + boxW, size.height / 2), pathEffect = dash)
                    }
                    val stroke = Stroke(width = maxOf(4.dp.toPx(), minOf(boxW, size.height) / 22f), cap = StrokeCap.Round, join = StrokeJoin.Round)
                    for (s in strokes + listOf(current.toList())) drawPolyline(s, ink, stroke)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SecondaryPill("↶ Undo", Modifier.weight(1f), enabled = strokes.isNotEmpty()) { strokes.removeAt(strokes.size - 1); report() }
            SecondaryPill("Clear", Modifier.weight(1f), enabled = strokes.isNotEmpty()) { strokes.clear(); report() }
        }
    }
}

private fun androidx.compose.ui.graphics.drawscope.DrawScope.drawPolyline(points: List<Offset>, color: androidx.compose.ui.graphics.Color, stroke: Stroke) {
    if (points.isEmpty()) return
    val path = Path().apply {
        moveTo(points[0].x, points[0].y)
        if (points.size == 1) lineTo(points[0].x + 0.1f, points[0].y + 0.1f)
        for (p in points.drop(1)) lineTo(p.x, p.y)
    }
    drawPath(path, color, style = stroke)
}

/** Han characters in a target (punctuation gets no writing box) — `targetChars`. */
fun targetChars(target: String?): List<String> =
    target.orEmpty().codePoints().toArray().filter { Character.UnicodeScript.of(it) == Character.UnicodeScript.HAN }.map { String(Character.toChars(it)) }

/** `hasStrokes`: something was written. */
fun hasStrokes(hw: HandwritingAnswer?): Boolean = hw != null && ((hw.strokes?.strokes?.size ?: 0) > 0 || !hw.text.isNullOrEmpty())

/** `StrokesView`: re-draws captured strokes, scaled to fit. */
@Composable
fun StrokesView(strokes: HandwritingStrokes, label: String?, modifier: Modifier = Modifier, maxHeight: androidx.compose.ui.unit.Dp = 160.dp) {
    val ink = Lab.colors.ink
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        label?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted) }
        val ratio = strokes.height.toFloat() / maxOf(1, strokes.width)
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val h = (maxWidth * ratio).coerceIn(60.dp, maxHeight)
            Canvas(Modifier.fillMaxWidth().heightIn(min = h).height(h).clip(RoundedCornerShape(14.dp)).background(Lab.colors.faint)) {
                val scale = minOf(size.width / strokes.width, size.height / strokes.height)
                val dx = (size.width - strokes.width * scale) / 2
                val dy = (size.height - strokes.height * scale) / 2
                val stroke = Stroke(width = maxOf(3f, 5.dp.toPx() * scale.coerceAtMost(1.5f)), cap = StrokeCap.Round, join = StrokeJoin.Round)
                for (s in strokes.strokes) {
                    val pts = (0 until s.size / 2).map { Offset(dx + s[it * 2] * scale, dy + s[it * 2 + 1] * scale) }
                    drawPolyline(pts, ink, stroke)
                }
            }
        }
    }
}
