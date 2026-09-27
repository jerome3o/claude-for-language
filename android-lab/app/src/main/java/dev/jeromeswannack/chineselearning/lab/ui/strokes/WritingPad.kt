package dev.jeromeswannack.chineselearning.lab.ui.strokes

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.CharStrokeData
import dev.jeromeswannack.chineselearning.lab.core.HintLevel
import dev.jeromeswannack.chineselearning.lab.core.StrokeData
import dev.jeromeswannack.chineselearning.lab.core.StrokePoint
import dev.jeromeswannack.chineselearning.lab.core.WritingGrade
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** What the pad does with the ink of a finished drawing (the web's `InkOutcome`). */
enum class InkOutcome { Accept, Reject, Ignore }

/** A stroke already written; revealed ones are painted in the "given" amber. */
@Immutable
data class PadStroke(val index: Int, val revealed: Boolean)

/** Help for the stroke being written: `START` = dot + arrow, `STROKE` = the stroke painted on a loop. */
@Immutable
data class PadHint(val index: Int, val level: HintLevel)

/** The pad's colours — the web's `--sp-*` tokens (strokes.css). */
object PadColors {
    val Ink = Color(0xFF1F2937)
    val Given = Color(0xFFD97706)
    val Hint = Color(0xFF2563EB)
    val Good = Color(0xFF16A34A)
    val Lime = Color(0xFF65A30D)
    val Bad = Color(0xFFDC2626)
    val Grid = Color(0x47DC2626)
    val GridBorder = Color(0x80DC2626)
    val Outline = Color(0xFFE5E7EB)
    val Demo = Color(0xFF374151)
    val Paper = Color(0xFFFFFFFF)

    fun grade(g: WritingGrade?): Color? = when (g) {
        WritingGrade.PERFECT -> Good
        WritingGrade.GOOD -> Lime
        WritingGrade.PRACTICE -> Given
        null -> null
    }
}

private const val VIEW = 1024f
private const val BRUSH_WIDTH = 190f
private const val INK_WIDTH = 42f
private const val DEMO_GAP_MS = 120

/** Port of the pad's `demoDuration`. */
internal fun demoDuration(length: Double): Int = (260 + length * 0.55).roundToInt()

/** When each stroke of the stroke-order demo starts and how long it takes (ms). */
internal fun demoTimeline(lengths: List<Double>): List<Pair<Int, Int>> {
    var t = 250
    return lengths.map { len ->
        val dur = demoDuration(len)
        (t to dur).also { t += dur + DEMO_GAP_MS }
    }
}

/** Parsed once per character: outlines and brushes as Compose paths in data space. */
private class PadGeometry(data: CharStrokeData) {
    val outlines: List<Path> = data.strokes.map { PathParser().parsePathString(it).toPath() }
    val brushes = data.medians.map { StrokeData.brushPath(it) }
    val brushPaths: List<Path> = brushes.map { b ->
        Path().apply { b.points.forEachIndexed { i, p -> if (i == 0) moveTo(p.x.toFloat(), p.y.toFloat()) else lineTo(p.x.toFloat(), p.y.toFloat()) } }
    }
    val starts = data.medians.map { StrokeData.strokeStart(it) }
    val timeline = demoTimeline(brushes.map { it.length })
    val demoTotal: Int = timeline.lastOrNull()?.let { it.first + it.second + 400 } ?: 0
}

/**
 * One character's writing surface — the native twin of the web's `StrokePad`: a 米字格 square,
 * the stroke data drawn in data space (1024 box, y up) and the learner's ink on top. Purely
 * presentational: the caller owns the quiz ([WritingController] does it for you) and says what
 * to show; each finished drawing comes back through [onStroke] in data space, and the return
 * value decides what happens to the ink (accepted strokes are replaced by the real stroke
 * painted in, rejected ink flashes red, shakes and fades).
 *
 * Finger or stylus, one pointer at a time (a resting palm doesn't start a second stroke), all
 * historical touch samples kept so fast strokes stay smooth.
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
@Composable
fun WritingPad(
    data: CharStrokeData,
    modifier: Modifier = Modifier,
    /** Grey outline of the whole character (trace mode, and behind the demo). */
    showOutline: Boolean = true,
    /** Strokes already written, in order. */
    completed: List<PadStroke> = emptyList(),
    /** Animate this one in (the stroke just accepted / revealed). */
    justCompleted: Int? = null,
    hint: PadHint? = null,
    /** Non-null → play the stroke-order animation (a new key restarts it). */
    demoKey: Long? = null,
    demoNumbers: Boolean = true,
    onDemoEnd: () -> Unit = {},
    /** Glow for a finished character. */
    celebrate: WritingGrade? = null,
    enabled: Boolean = true,
    onStroke: (List<StrokePoint>) -> InkOutcome = { InkOutcome.Ignore },
    onPenDown: () -> Unit = {},
    label: String = "Writing pad",
    /** Freeze looping animations at a representative frame (screenshots). */
    still: Boolean = false,
) {
    val geo = remember(data) { PadGeometry(data) }
    val measurer = rememberTextMeasurer()
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val currentOnStroke by rememberUpdatedState(onStroke)
    val currentOnPenDown by rememberUpdatedState(onPenDown)
    val currentEnabled by rememberUpdatedState(enabled)

    // Live ink (view pixels + data space), redrawn through a version counter.
    val inkView = remember { ArrayList<Offset>() }
    val inkData = remember { ArrayList<StrokePoint>() }
    var inkVersion by remember { mutableIntStateOf(0) }
    var rejected by remember { mutableStateOf<List<Offset>?>(null) }
    val rejectFade = remember { Animatable(1f) }
    val shake = remember { Animatable(0f) }

    // Demo timeline, in ms.
    val demoT = remember { Animatable(0f) }
    LaunchedEffect(demoKey, geo) {
        if (demoKey == null) return@LaunchedEffect
        demoT.snapTo(0f)
        if (still) {
            demoT.snapTo(geo.demoTotal * 0.55f)
            return@LaunchedEffect
        }
        demoT.animateTo(geo.demoTotal.toFloat(), tween(geo.demoTotal, easing = LinearEasing))
        onDemoEnd()
    }

    // The stroke that just landed: painted in fast (revealed: slower), with a green bloom.
    val snap = remember { Animatable(1f) }
    val glow = remember { Animatable(0f) }
    val justRevealed = completed.firstOrNull { it.index == justCompleted }?.revealed == true
    LaunchedEffect(justCompleted, completed.size) {
        if (justCompleted == null) return@LaunchedEffect
        snap.snapTo(0f)
        launch {
            glow.snapTo(if (justRevealed) 0f else 0.55f)
            glow.animateTo(0f, tween(650, easing = FastOutSlowInEasing))
        }
        snap.animateTo(1f, tween(if (justRevealed) 700 else 240, easing = CubicBezierEasing(0.2f, 0.7f, 0.3f, 1f)))
    }

    // Finished character: completed strokes flash green and settle; the frame glows.
    val settle = remember { Animatable(0f) }
    LaunchedEffect(celebrate) {
        if (celebrate == null) return@LaunchedEffect
        settle.snapTo(1f)
        settle.animateTo(0f, tween(500))
    }
    val glowColor = PadColors.grade(celebrate)
    val frame by animateColorAsState(glowColor ?: Lab.colors.cardBorder, label = "pad-frame")
    val pop = remember { Animatable(1f) }
    LaunchedEffect(celebrate) {
        if (celebrate == null) return@LaunchedEffect
        pop.snapTo(0.97f)
        pop.animateTo(1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow))
    }

    val loops = rememberInfiniteTransition(label = "pad-loops")
    val hintPhase by loops.animateFloat(0f, 1f, infiniteRepeatable(tween(1900, easing = LinearEasing)), label = "hint")
    val pulse by loops.animateFloat(1f, 1.22f, infiniteRepeatable(tween(600, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulse")

    val demoing = demoKey != null
    val completedMap = completed.associateBy { it.index }

    Box(
        modifier
            .widthIn(max = 440.dp)
            .fillMaxWidth()
            .aspectRatio(1f)
            .scale(pop.value)
            .clip(RoundedCornerShape(18.dp))
            .border(if (glowColor != null) 4.dp else 1.5.dp, frame, RoundedCornerShape(18.dp))
            .semantics { contentDescription = label },
    ) {
        Canvas(
            Modifier
                .fillMaxSize()
                .pointerInput(geo) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        if (!currentEnabled) return@awaitEachGesture
                        down.consume()
                        val s = size.width / VIEW
                        fun add(o: Offset) {
                            inkView += o
                            val vx = o.x / s
                            val vy = o.y / s
                            inkData += StrokePoint(vx.toDouble(), 900.0 - vy)
                        }
                        inkView.clear()
                        inkData.clear()
                        add(down.position)
                        inkVersion++
                        currentOnPenDown()
                        var cancelled = false
                        while (true) {
                            val event = awaitPointerEvent()
                            val ch = event.changes.firstOrNull { it.id == down.id }
                            if (ch == null) {
                                cancelled = true
                                break
                            }
                            ch.historical.forEach { add(it.position) }
                            add(ch.position)
                            ch.consume()
                            inkVersion++
                            if (!ch.pressed) break
                        }
                        val view = inkView.toList()
                        val pts = inkData.toList()
                        inkView.clear()
                        inkData.clear()
                        inkVersion++
                        if (cancelled) return@awaitEachGesture
                        if (currentOnStroke(pts) == InkOutcome.Reject && view.size > 1) {
                            rejected = view
                            scope.launch {
                                rejectFade.snapTo(1f)
                                launch {
                                    shake.snapTo(0f)
                                    for (x in listOf(10f, -8f, 6f, -4f, 0f)) shake.animateTo(x, tween(45))
                                }
                                delay(180)
                                rejectFade.animateTo(0f, tween(440))
                                rejected = null
                            }
                        }
                    }
                },
        ) {
            val s = size.width / VIEW
            drawRect(PadColors.Paper)
            drawGrid(s)

            withTransform({
                translate(top = 900f * s)
                scale(s, -s, pivot = Offset.Zero)
            }) {
                if (showOutline || demoing) geo.outlines.forEach { drawPath(it, PadColors.Outline) }

                if (demoing) {
                    geo.outlines.indices.forEach { i ->
                        val (delayMs, dur) = geo.timeline[i]
                        val p = ((demoT.value - delayMs) / dur).coerceIn(0f, 1f)
                        if (p > 0f) paintBrush(geo, i, easeInOut(p), PadColors.Demo)
                    }
                } else {
                    geo.outlines.forEachIndexed { i, outline ->
                        val c = completedMap[i] ?: return@forEachIndexed
                        val base = if (c.revealed) PadColors.Given else PadColors.Ink
                        val color = if (!c.revealed && settle.value > 0f) lerp(base, PadColors.Good, settle.value) else base
                        if (i == justCompleted && snap.value < 1f) {
                            paintBrush(geo, i, snap.value, color)
                        } else {
                            drawPath(outline, color)
                        }
                        if (i == justCompleted && glow.value > 0f) drawPath(outline, PadColors.Good.copy(alpha = glow.value))
                    }
                    if (hint != null && hint.level == HintLevel.STROKE && hint.index < geo.outlines.size) {
                        val ph = if (still) 0.6f else hintPhase
                        val progress = (ph / 0.55f).coerceAtMost(1f)
                        val alpha = when {
                            ph <= 0.55f -> 0.55f
                            ph <= 0.85f -> 0.55f - (ph - 0.55f) / 0.3f * 0.35f
                            else -> 0.2f - (ph - 0.85f) / 0.15f * 0.2f
                        }
                        paintBrush(geo, hint.index, progress, PadColors.Hint.copy(alpha = alpha.coerceIn(0f, 1f)))
                    }
                }
            }

            // Start dot + direction arrow (view space so the arrowhead isn't mirrored).
            if (!demoing && hint != null && hint.level != HintLevel.NONE && hint.index < geo.starts.size) {
                val st = geo.starts[hint.index]
                val sx = st.start.x.toFloat()
                val sy = 900f - st.start.y.toFloat()
                val dx = st.dir.x.toFloat()
                val dy = -st.dir.y.toFloat()
                val ex = sx + dx * 150
                val ey = sy + dy * 150
                val ax = -dy
                val ay = dx
                drawLine(PadColors.Hint, Offset(sx * s, sy * s), Offset(ex * s, ey * s), strokeWidth = 12 * s, cap = StrokeCap.Round)
                val head = Path().apply {
                    moveTo((ex + dx * 34) * s, (ey + dy * 34) * s)
                    lineTo((ex + ax * 26) * s, (ey + ay * 26) * s)
                    lineTo((ex - ax * 26) * s, (ey - ay * 26) * s)
                    close()
                }
                drawPath(head, PadColors.Hint)
                drawCircle(PadColors.Hint, 38 * s * (if (still) 1.1f else pulse), Offset(sx * s, sy * s))
            }

            if (demoing && demoNumbers) {
                geo.starts.forEachIndexed { i, st ->
                    if (demoT.value < geo.timeline[i].first) return@forEachIndexed
                    val a = ((demoT.value - geo.timeline[i].first) / 200f).coerceIn(0f, 1f)
                    val c = Offset(st.start.x.toFloat() * s, (900f - st.start.y.toFloat()) * s)
                    drawCircle(Color.White.copy(alpha = a), 34 * s, c)
                    drawCircle(PadColors.Bad.copy(alpha = a), 34 * s, c, style = Stroke(5 * s))
                    val layout = measurer.measure("${i + 1}", TextStyle(color = PadColors.Bad.copy(alpha = a), fontSize = (40 * s).toSp(), fontWeight = FontWeight.Bold))
                    drawText(layout, topLeft = Offset(c.x - layout.size.width / 2f, c.y - layout.size.height / 2f))
                }
            }

            rejected?.let { pts ->
                translateInk(shake.value) { drawInk(pts, PadColors.Bad.copy(alpha = rejectFade.value), s) }
            }
            if (inkVersion >= 0 && inkView.isNotEmpty()) drawInk(inkView, PadColors.Ink, s)
        }
    }
}

private fun lerp(a: Color, b: Color, t: Float) = androidx.compose.ui.graphics.lerp(a, b, t)

private fun easeInOut(t: Float) = CubicBezierEasing(0.42f, 0f, 0.58f, 1f).transform(t)

private fun DrawScope.drawGrid(s: Float) {
    val dash = PathEffect.dashPathEffect(floatArrayOf(18 * s, 14 * s))
    val w = size.width
    drawRect(PadColors.GridBorder, topLeft = Offset(6 * s, 6 * s), size = androidx.compose.ui.geometry.Size(w - 12 * s, w - 12 * s), style = Stroke(6 * s))
    val stroke = 3 * s
    drawLine(PadColors.Grid, Offset(0f, w / 2), Offset(w, w / 2), stroke, pathEffect = dash)
    drawLine(PadColors.Grid, Offset(w / 2, 0f), Offset(w / 2, w), stroke, pathEffect = dash)
    drawLine(PadColors.Grid, Offset(0f, 0f), Offset(w, w), stroke, pathEffect = dash)
    drawLine(PadColors.Grid, Offset(w, 0f), Offset(0f, w), stroke, pathEffect = dash)
}

/** Paint stroke [i] inside its outline up to [progress] of its brush (data-space transform active). */
private fun DrawScope.paintBrush(geo: PadGeometry, i: Int, progress: Float, color: Color) {
    val measure = PathMeasure()
    measure.setPath(geo.brushPaths[i], false)
    val seg = Path()
    val len = measure.length
    if (len <= 0f || progress <= 0f) return
    measure.getSegment(0f, len * progress, seg, true)
    clipPath(geo.outlines[i]) {
        drawPath(seg, color, style = Stroke(BRUSH_WIDTH, cap = StrokeCap.Butt, join = StrokeJoin.Round))
    }
}

private inline fun DrawScope.translateInk(dx: Float, block: DrawScope.() -> Unit) =
    withTransform({ translate(left = dx) }) { block() }

private fun DrawScope.drawInk(pts: List<Offset>, color: Color, s: Float) {
    if (pts.isEmpty()) return
    if (pts.size == 1) {
        drawCircle(color, INK_WIDTH * s / 2, pts[0])
        return
    }
    val p = Path().apply {
        moveTo(pts[0].x, pts[0].y)
        for (i in 1 until pts.size) lineTo(pts[i].x, pts[i].y)
    }
    drawPath(p, color, style = Stroke(INK_WIDTH * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
}
