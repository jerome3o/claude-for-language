package dev.jeromeswannack.chineselearning.lab.ui.study

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import dev.jeromeswannack.chineselearning.lab.core.ResultState
import dev.jeromeswannack.chineselearning.lab.core.RightMoment
import dev.jeromeswannack.chineselearning.lab.fx.rememberStudyFeel
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/** The system's "Remove animations" (animator duration scale 0) = reduce motion. */
@Composable
fun rememberReduceMotion(): Boolean {
    val ctx = LocalContext.current
    return remember(ctx) {
        runCatching { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }.getOrDefault(false)
    }
}

/**
 * The "right" moment (core [RightMoment]; web components/study/RightMoment.tsx; docs/STUDY_SESSION.md "A right answer
 * you can see"), as a modifier on the thing that was right — which wears the green result surface ([resultSurface]):
 * a soft green wash flashes in and fades back to that surface, and a SMALL confetti burst flies from its middle, drawn
 * over it (never catching a tap). Put it BEFORE `resultSurface` in the chain, so the burst isn't clipped to the box. [feel] plays the moment's StudyFeel here too, where nothing else does — the Lab's
 * StudyFeel is the Vibrator ([dev.jeromeswannack.chineselearning.lab.fx.Haptics]) — plus the view's CONFIRM haptic as a
 * backup. Reduce motion: no burst, no wash. [key] = one showing of the result: it never fires twice for it.
 */
fun Modifier.rightMoment(
    where: String,
    key: Any,
    roundDone: Boolean = false,
    celebrated: Boolean = false,
    feel: Boolean = false,
): Modifier = composed {
    val reduce = rememberReduceMotion()
    val moment = remember(key) { RightMoment.of(where, roundDone = roundDone, reduceMotion = reduce, celebrated = celebrated) }
    val studyFeel = rememberStudyFeel()
    val view = LocalView.current
    val wash = remember(key) { Animatable(0f) }
    val burst = remember(key) { Animatable(if (moment.confetti > 0) 0f else 1f) }
    val tone = ResultColors.tone(ResultState.RIGHT)
    val seeds = remember(key) {
        val rnd = Random(key.hashCode())
        List(moment.confetti) { i ->
            val angle = (i.toFloat() / moment.confetti.coerceAtLeast(1)) * 2 * PI.toFloat() + (rnd.nextFloat() - 0.5f) * 0.5f
            floatArrayOf(angle, 0.6f + rnd.nextFloat() * 0.6f, (rnd.nextFloat() - 0.5f) * 540f, i.toFloat(), 4f + rnd.nextFloat() * 2f)
        }
    }
    LaunchedEffect(key) {
        if (feel && moment.feel != null) {
            studyFeel(moment.feel)
            runCatching { view.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM) }
        }
        if (moment.animate) {
            wash.animateTo(1f, tween(moment.durationMs * 3 / 10, easing = FastOutSlowInEasing))
            wash.animateTo(0f, tween(moment.durationMs * 7 / 10, easing = LinearEasing))
        }
    }
    LaunchedEffect(key) { if (moment.confetti > 0) burst.animateTo(1f, tween(moment.durationMs, easing = FastOutSlowInEasing)) }
    // No test tag of its own: it sits on the host's node, whose own tag (the exercise, "You said" …) must win.
    this
        .drawWithContent {
            val w = wash.value
            if (w > 0f) drawRoundRect(tone.copy(alpha = 0.24f * w), cornerRadius = androidx.compose.ui.geometry.CornerRadius(ResultState.SURFACE_RADIUS.dp.toPx()))
            drawContent()
            val p = burst.value
            if (p >= 1f) return@drawWithContent
            val cx = size.width / 2
            val cy = size.height / 2
            val reach = 64.dp.toPx()
            val rise = 12.dp.toPx()
            val fall = 44.dp.toPx()
            for (sd in seeds) {
                val x = cx + cos(sd[0]) * reach * sd[1] * p * 1.5f
                val y = cy + sin(sd[0]) * reach * sd[1] * p - rise * p + fall * p * p
                val a = if (p < 0.7f) 1f else ((1f - p) / 0.3f).coerceIn(0f, 1f)
                val c = Palette.Confetti[sd[3].toInt() % Palette.Confetti.size]
                val pw = sd[4].dp.toPx()
                rotate(sd[2] * p, Offset(x, y)) {
                    drawRect(c.copy(alpha = a), topLeft = Offset(x - pw / 2, y - pw * 0.8f), size = Size(pw, pw * 1.6f))
                }
            }
        }
}
