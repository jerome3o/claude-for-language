package dev.jeromeswannack.chineselearning.lab.ui.progress

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.HeatDay
import dev.jeromeswannack.chineselearning.lab.core.MasteryCounts
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.delay

/** The web's mastery colours (SharedDeckProgressPage.css): mastered · familiar · learning · new. */
object MasteryColors {
    val Mastered = Palette.Good
    val Familiar = Palette.Easy
    val Learning = Palette.Hard
    val New: Color @Composable get() = Lab.colors.faint
}

/**
 * The streak card's 30-day heatmap (oldest left): green cells, deeper for more reviews
 * (the web's `rgba(34,197,94, max(0.25, count/max))`), each springing in one after another.
 */
@Composable
fun StreakHeatmap(days: List<HeatDay>, maxCount: Int, modifier: Modifier = Modifier, cellGap: Dp = 3.dp) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(cellGap)) {
        days.forEachIndexed { i, day ->
            val scale = remember { Animatable(0.3f) }
            LaunchedEffect(Unit) {
                delay(i * 18L)
                scale.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
            }
            val empty = Lab.colors.faint
            val color = if (day.count == 0) empty else Palette.Good.copy(alpha = maxOf(0.25f, day.count.toFloat() / maxCount))
            Box(
                Modifier
                    .weight(1f)
                    .height(22.dp)
                    .graphicsLayer { scaleX = scale.value; scaleY = scale.value }
                    .clip(RoundedCornerShape(4.dp))
                    .background(color)
                    .semantics { contentDescription = "${day.date}: ${day.count} reviews" },
            )
        }
    }
}

/** One day's bar: reviews, split into Good/Easy (green) and Again/Hard (red). */
data class BarDay(val date: String, val reviews: Int, val correct: Int, val label: String)

/**
 * Reviews a day for the last 30 days as rounded bars that grow in on a spring. Tap a bar
 * to select it ([onSelect] with its index); the selected bar is full colour, the rest dim.
 */
@Composable
fun ReviewsBarChart(days: List<BarDay>, selected: Int?, onSelect: (Int) -> Unit, modifier: Modifier = Modifier, height: Dp = 150.dp) {
    val grow = remember { Animatable(0f) }
    LaunchedEffect(days.size) { grow.animateTo(1f, spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessVeryLow)) }
    val max = maxOf(1, days.maxOfOrNull { it.reviews } ?: 0)
    val wrongColor = Palette.Again.copy(alpha = 0.75f)
    val trackColor = Lab.colors.faint
    val gridColor = Lab.colors.cardBorder
    Canvas(
        modifier
            .fillMaxWidth()
            .height(height)
            .pointerInput(days.size) {
                detectTapGestures { pos ->
                    if (days.isEmpty()) return@detectTapGestures
                    val i = (pos.x / (size.width / days.size.toFloat())).toInt().coerceIn(0, days.size - 1)
                    onSelect(i)
                }
            }
            .semantics { contentDescription = "Reviews per day, last ${days.size} days" },
    ) {
        if (days.isEmpty()) return@Canvas
        val slot = size.width / days.size
        val barW = slot * 0.66f
        val radius = CornerRadius(barW / 2.4f, barW / 2.4f)
        // Faint guide lines at a half and the top.
        for (f in listOf(0.5f, 1f)) {
            val y = size.height * (1 - f)
            drawLine(gridColor, Offset(0f, y), Offset(size.width, y), strokeWidth = 1.dp.toPx())
        }
        days.forEachIndexed { i, d ->
            val x = i * slot + (slot - barW) / 2
            val dim = selected != null && selected != i
            if (d.reviews == 0) {
                drawRoundRect(trackColor, Offset(x, size.height - 3.dp.toPx()), Size(barW, 3.dp.toPx()), CornerRadius(2f, 2f))
                return@forEachIndexed
            }
            // Later bars start a little later: a wave from left to right.
            val t = ((grow.value * 1.35f) - i * (0.35f / days.size)).coerceIn(0f, 1f)
            val h = size.height * d.reviews / max * t
            val top = size.height - h
            val alpha = if (dim) 0.35f else 1f
            drawRoundRect(wrongColor.copy(alpha = wrongColor.alpha * alpha), Offset(x, top), Size(barW, h), radius)
            val gh = h * d.correct / d.reviews
            if (gh > 0f) drawRoundRect(Palette.Good.copy(alpha = alpha), Offset(x, size.height - gh), Size(barW, gh), radius)
        }
    }
}

/**
 * Cards by mastery as a ring (mastered → familiar → learning, the rest track) whose arcs
 * sweep in; the centre holds [center].
 */
@Composable
fun MasteryRing(counts: MasteryCounts, modifier: Modifier = Modifier, size: Dp = 132.dp, stroke: Dp = 16.dp, center: @Composable () -> Unit = {}) {
    val sweep = rememberAppear(1100)
    val track = MasteryColors.New
    Box(modifier.size(size), contentAlignment = androidx.compose.ui.Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val w = stroke.toPx()
            val arcSize = Size(this.size.width - w, this.size.height - w)
            val topLeft = Offset(w / 2, w / 2)
            drawArc(track, 0f, 360f, false, topLeft, arcSize, style = Stroke(w))
            if (counts.total == 0) return@Canvas
            var start = -90f
            for ((n, color) in listOf(counts.mastered to MasteryColors.Mastered, counts.familiar to MasteryColors.Familiar, counts.learning to MasteryColors.Learning)) {
                val angle = 360f * n / counts.total * sweep.value
                if (angle > 0.5f) drawArc(color, start, angle, false, topLeft, arcSize, style = Stroke(w, cap = StrokeCap.Butt))
                start += angle
            }
        }
        center()
    }
}

/** A deck's mastery as one rounded bar: mastered · familiar · learning, the rest empty. Grows in. */
@Composable
fun MasteryBar(counts: MasteryCounts, modifier: Modifier = Modifier, height: Dp = 10.dp) {
    val grow = rememberAppear(900)
    val track = MasteryColors.New
    Canvas(modifier.fillMaxWidth().height(height).clip(RoundedCornerShape(50))) {
        drawRect(track)
        if (counts.total == 0) return@Canvas
        var x = 0f
        for ((n, color) in listOf(counts.mastered to MasteryColors.Mastered, counts.familiar to MasteryColors.Familiar, counts.learning to MasteryColors.Learning)) {
            val w = size.width * n / counts.total * grow.value
            if (w > 0f) drawRect(color, Offset(x, 0f), Size(w, size.height))
            x += w
        }
    }
}

/** A number that counts up from 0 to [value] when it first shows, and eases to a new value. */
@Composable
fun CountUpText(value: Int, style: TextStyle, color: Color, modifier: Modifier = Modifier, format: (Int) -> String = { "%,d".format(it) }) {
    val shown = remember { Animatable(0f) }
    LaunchedEffect(value) { shown.animateTo(value.toFloat(), tween(750)) }
    Text(format(shown.value.toInt()), style = style, color = color, modifier = modifier)
}

/** 0 → 1 once, when the composable first appears (charts drawing themselves in). */
@Composable
fun rememberAppear(durationMs: Int): Animatable<Float, *> {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { a.animateTo(1f, tween(durationMs, easing = androidx.compose.animation.core.FastOutSlowInEasing)) }
    return a
}
