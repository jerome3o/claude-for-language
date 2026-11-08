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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.layout.onSizeChanged
import kotlinx.coroutines.flow.first
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
fun ConfettiRain(
    key: Any,
    colors: List<Color>,
    modifier: Modifier = Modifier.fillMaxSize(),
    count: Int = 170,
    /** Each time the rain starts (tests). */
    onRain: () -> Unit = {},
) {
    var particles by remember(key) { mutableStateOf<List<Particle>>(emptyList()) }
    var frame by remember(key) { mutableLongStateOf(0L) }
    var size by remember { mutableStateOf(Size.Zero) }
    // Once per key: wait for the first real size, then rain. (Keyed on the size too, it rained
    // again whenever the area resized — a take starting or ending in the Sentence round redrew
    // the "done" confetti on every extra sentence, right or wrong, Nov 2026.)
    LaunchedEffect(key) {
        snapshotFlow { size }.first { it != Size.Zero }
        onRain()
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

/**
 * A SMALL confetti burst from the centre of its area (a right answer's verdict) — not [ConfettiRain]'s
 * full-screen rain (Jerome: "a small confetti burst"). Fires once per [key]; ~0.9 s; pieces may fly a
 * little past the area (nothing clips it). The web's components/ConfettiBurst.tsx.
 */
@Composable
fun ConfettiBurst(key: Any, colors: List<Color>, modifier: Modifier = Modifier.fillMaxSize(), pieces: Int = 22) {
    val progress = remember(key) { Animatable(0f) }
    val seeds = remember(key) {
        val rnd = Random(key.hashCode())
        List(pieces) { i ->
            val angle = (i.toFloat() / pieces) * 2 * PI.toFloat() + (rnd.nextFloat() - 0.5f) * 0.5f
            arrayOf(angle, 0.6f + rnd.nextFloat() * 0.6f, (rnd.nextFloat() - 0.5f) * 540f, colors[i % colors.size], 12f + rnd.nextFloat() * 8f)
        }
    }
    LaunchedEffect(key) { progress.animateTo(1f, tween(900, easing = FastOutSlowInEasing)) }
    Canvas(modifier) {
        val p = progress.value
        if (p >= 1f) return@Canvas
        val cx = size.width / 2
        val cy = size.height / 2
        val reach = 150f
        for (s in seeds) {
            val angle = s[0] as Float
            val speed = s[1] as Float
            val spin = s[2] as Float
            val color = s[3] as Color
            val w = s[4] as Float
            val x = cx + cos(angle) * reach * speed * p * 1.5f
            val y = cy + sin(angle) * reach * speed * p - 40f * p + 140f * p * p
            val a = if (p < 0.7f) 1f else ((1f - p) / 0.3f).coerceIn(0f, 1f)
            rotate(spin * p, Offset(x, y)) {
                drawRect(color.copy(alpha = a), topLeft = Offset(x - w / 2, y - w * 0.8f), size = Size(w, w * 1.6f))
            }
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
