package dev.jeromeswannack.chineselearning.lab.ui.fx

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

private class Particle(
    var x: Float, var y: Float, var vx: Float, var vy: Float,
    var rot: Float, val vrot: Float, val w: Float, val h: Float, val color: Color, val wobble: Float,
)

/**
 * Confetti with a little physics (gravity, drag, flutter), raining from the top.
 * Runs once per [key]; ~4 s. Mirrors the web's Confetti but fuller.
 */
@Composable
fun ConfettiRain(key: Any, colors: List<Color>, modifier: Modifier = Modifier.fillMaxSize(), count: Int = 170) {
    var particles by remember(key) { mutableStateOf<List<Particle>>(emptyList()) }
    var frame by remember(key) { mutableLongStateOf(0L) }
    var size by remember { mutableStateOf(Size.Zero) }
    LaunchedEffect(key, size) {
        if (size == Size.Zero) return@LaunchedEffect
        val rnd = Random(key.hashCode())
        particles = List(count) {
            Particle(
                x = rnd.nextFloat() * size.width,
                y = -rnd.nextFloat() * size.height * 0.6f,
                vx = (rnd.nextFloat() - 0.5f) * 240f,
                vy = 120f + rnd.nextFloat() * 260f,
                rot = rnd.nextFloat() * 360f,
                vrot = (rnd.nextFloat() - 0.5f) * 720f,
                w = 14f + rnd.nextFloat() * 14f,
                h = 8f + rnd.nextFloat() * 10f,
                color = colors[rnd.nextInt(colors.size)],
                wobble = rnd.nextFloat() * 6f,
            )
        }
        var last = 0L
        val start = withFrameNanos { it }
        while (true) {
            val now = withFrameNanos { it }
            val dt = if (last == 0L) 0.016f else ((now - last) / 1e9f).coerceAtMost(0.05f)
            last = now
            val t = (now - start) / 1e9f
            for (p in particles) {
                p.vy += 520f * dt
                p.vx *= (1f - 0.9f * dt)
                p.vy *= (1f - 0.6f * dt)
                p.x += (p.vx + sin(t * 4f + p.wobble) * 40f) * dt
                p.y += p.vy * dt
                p.rot += p.vrot * dt
            }
            frame = now
            if (t > 4.5f) { particles = emptyList(); break }
        }
    }
    Canvas(modifier.onSizeChanged { size = Size(it.width.toFloat(), it.height.toFloat()) }) {
        frame // read so the canvas redraws every frame
        for (p in particles) {
            if (p.y > this.size.height + 40) continue
            rotate(p.rot, Offset(p.x, p.y)) {
                drawRect(p.color, topLeft = Offset(p.x - p.w / 2, p.y - p.h / 2), size = Size(p.w, p.h * (0.6f + 0.4f * cos(p.rot / 30f))))
            }
        }
    }
}

/**
 * A radial burst of sparks from [origin] (fractions of the canvas), fired each time
 * [trigger] changes to a non-zero value. Used on a correct answer and on streak
 * milestones.
 */
@Composable
fun SparkBurst(trigger: Int, colors: List<Color>, origin: Offset = Offset(0.5f, 0.4f), sparks: Int = 26, modifier: Modifier = Modifier.fillMaxSize()) {
    val progress = remember { Animatable(1f) }
    val seeds = remember(trigger) {
        val rnd = Random(trigger * 7919 + 1)
        List(sparks) { Triple(rnd.nextFloat() * 2 * PI.toFloat(), 0.55f + rnd.nextFloat() * 0.6f, colors[rnd.nextInt(colors.size)]) }
    }
    LaunchedEffect(trigger) {
        if (trigger == 0) return@LaunchedEffect
        progress.snapTo(0f)
        progress.animateTo(1f, tween(750, easing = FastOutSlowInEasing))
    }
    Canvas(modifier) {
        val p = progress.value
        if (p >= 1f || trigger == 0) return@Canvas
        val cx = size.width * origin.x
        val cy = size.height * origin.y
        val reach = size.minDimension * 0.42f
        for ((angle, speed, color) in seeds) {
            val d = reach * speed * p
            val x = cx + cos(angle) * d
            val y = cy + sin(angle) * d + 60f * p * p
            val r = (1f - p) * 9f + 1.5f
            drawCircle(color.copy(alpha = (1f - p).coerceIn(0f, 1f)), radius = r, center = Offset(x, y))
        }
    }
}

/** Horizontal shake offset for a wrong answer: call [ShakeState.shake], read [ShakeState.offset]. */
class ShakeState {
    val offset = Animatable(0f)
    suspend fun shake() {
        for (x in listOf(-18f, 16f, -12f, 9f, -5f, 0f)) offset.animateTo(x, tween(45, easing = LinearEasing))
    }
}
