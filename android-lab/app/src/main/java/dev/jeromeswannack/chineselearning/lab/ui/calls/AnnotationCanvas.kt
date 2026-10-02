package dev.jeromeswannack.chineselearning.lab.ui.calls

import android.graphics.Paint
import android.graphics.Typeface
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotStroke
import dev.jeromeswannack.chineselearning.lab.core.calls.AnnotText
import dev.jeromeswannack.chineselearning.lab.core.calls.CallAnnotate
import dev.jeromeswannack.chineselearning.lab.core.calls.ShownText
import dev.jeromeswannack.chineselearning.lab.core.calls.VideoFit
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private fun parse(hex: String): Color = Color(0xFF000000 or hex.removePrefix("#").toLong(16))
private fun argb(hex: String): Int = (0xFF000000 or hex.removePrefix("#").toLong(16)).toInt()

/** Pen or Text on a shared screen (round 4, web `AnnotTool`). */
enum class AnnotTool { PEN, TEXT }

/** Anything still animating at [now]? Kept strokes and texts don't animate (web AnnotationStore.active). */
fun annotationsActive(a: Annotations, now: Long): Boolean =
    (!a.persist && (a.strokes.values.any { CallAnnotate.strokeAlpha(it.doneAt, now) > 0 } || a.texts.values.any { CallAnnotate.textAlpha(it.doneAt, now) > 0 })) ||
        a.pings.any { CallAnnotate.pingProgress(it.at, now) != null }

/** My pen: the colour I picked, else my role's default — blue while I share, red on their screen (web CallPage `pen`). */
fun annotPen(chosen: String?, s: CallState): String = chosen ?: CallAnnotate.defaultAnnotColor(s.iShareScreen)

// ------------------------------------------------------------------ text boxes (round 4)

/** Where a text box sits (canvas px): for drawing it, picking it up, moving it and its ✕ (web `TextBoxes`). */
data class AnnotTextBox(val text: ShownText, val left: Float, val top: Float, val px: Float, val lines: List<String>, val width: Float, val pad: Float) {
    val lineHeight: Float get() = px * 1.25f
    val right: Float get() = left + width
    val bottom: Float get() = top + lineHeight * lines.size
    fun hit(x: Float, y: Float) = x >= left - pad && x <= right + pad && y >= top - pad && y <= bottom + pad
}

private val annotTypeface: Typeface by lazy {
    if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 600, false) else Typeface.DEFAULT_BOLD
}

private fun textPaint(px: Float) = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = annotTypeface; textSize = px }

/**
 * Lay the texts out as the web's drawAnnotations does: anchored top-left on the shared picture shown
 * whole (contain) in a [boxW]×[boxH] px box, sized by the PICTURE's shorter side (≥ 11 dp), one row
 * per line, line height 1.25. [hidden] = the one I'm typing in (the field shows it instead).
 */
fun layoutAnnotTexts(texts: Collection<ShownText>, boxW: Float, boxH: Float, video: VideoFit.Size?, density: Float, hidden: String? = null): List<AnnotTextBox> {
    val box = VideoFit.Size(boxW.toDouble(), boxH.toDouble())
    val pic = VideoFit.containRect(video, box)
    val picShort = max(1.0, min(pic.width, pic.height)).toFloat()
    return texts.mapNotNull { t ->
        if (t.text.id == hidden || t.text.text.isEmpty()) return@mapNotNull null
        val px = max(11f * density, t.text.size.toFloat() * picShort)
        val (x, y) = CallAnnotate.denormalizePoint(t.text.x to t.text.y, box, video)
        val lines = t.text.text.split('\n')
        val paint = textPaint(px)
        AnnotTextBox(t, x.toFloat(), y.toFloat(), px, lines, lines.maxOf { paint.measureText(it) }, 4f * density)
    }
}

/**
 * Draw laid-out texts on a native canvas (the call screen's Compose canvas and the over-other-apps
 * overlay share this): the writer's colour on a dark halo, fading unless kept. [lift] scales one box
 * (the one being dragged) about its top-left.
 */
fun drawAnnotTexts(canvas: android.graphics.Canvas, boxes: List<AnnotTextBox>, now: Long, persist: Boolean, density: Float, lift: Pair<String, Float>? = null) {
    for (b in boxes) {
        val alpha = CallAnnotate.textAlpha(b.text.doneAt, now, persist).toFloat()
        if (alpha <= 0f) continue
        val paint = textPaint(b.px)
        val ascent = paint.fontMetrics.ascent
        val scale = lift?.takeIf { it.first == b.text.text.id }?.second ?: 1f
        canvas.save()
        if (scale != 1f) canvas.scale(scale, scale, b.left, b.top)
        b.lines.forEachIndexed { i, line ->
            val baseline = b.top + i * b.lineHeight - ascent + (b.lineHeight - b.px) / 2
            paint.style = Paint.Style.STROKE
            paint.strokeJoin = Paint.Join.ROUND
            paint.strokeWidth = max(2.5f * density, b.px / 6f)
            paint.color = android.graphics.Color.BLACK
            paint.alpha = (178 * alpha).toInt()
            canvas.drawText(line, b.left, baseline, paint)
            paint.style = Paint.Style.FILL
            paint.color = argb(b.text.text.color)
            paint.alpha = (255 * alpha).toInt()
            canvas.drawText(line, b.left, baseline, paint)
        }
        canvas.restore()
    }
}

/** Draw every stroke, text and ping over the shared picture shown whole (contain) in this box. */
fun DrawScope.drawAnnotations(a: Annotations, video: VideoFit.Size?, now: Long, hiddenText: String? = null, lift: Pair<String, Float>? = null, selected: String? = null) {
    val box = VideoFit.Size(size.width.toDouble(), size.height.toDouble())
    val scale = min(size.width, size.height)
    for (s in a.strokes.values) {
        val alpha = CallAnnotate.strokeAlpha(s.doneAt, now, a.persist).toFloat()
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
    // Text boxes: sized by the shared picture's shorter side, so they look the same in any window.
    if (a.texts.isNotEmpty()) {
        val boxes = layoutAnnotTexts(a.texts.values, size.width, size.height, video, density, hiddenText)
        boxes.firstOrNull { it.text.text.id == selected }?.let { b ->
            // The selected one: a dashed frame in its colour (its ✕ sits on the corner).
            drawRoundRect(
                parse(b.text.text.color), Offset(b.left - b.pad, b.top - b.pad), androidx.compose.ui.geometry.Size(b.width + 2 * b.pad, b.bottom - b.top + 2 * b.pad),
                CornerRadius(6 * density), style = Stroke(2 * density, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6 * density, 4 * density))),
            )
        }
        drawIntoCanvas { drawAnnotTexts(it.nativeCanvas, boxes, now, a.persist, density, lift) }
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

/** The text field I'm typing in: where (0..1 of the picture), what, and the box as it was (Esc restores it). */
data class AnnotTextEditor(val id: String, val x: Double, val y: Double, val value: TextFieldValue, val before: AnnotText?)

private fun newTextId() = "t" + System.currentTimeMillis().toString(36) + (100..999).random().toString(36)

/** At most [CallAnnotate.MAX_ANNOT_TEXT_CHARS] characters (code points), as the room keeps them. */
private fun capText(v: TextFieldValue): TextFieldValue {
    val n = v.text.codePointCount(0, v.text.length)
    if (n <= CallAnnotate.MAX_ANNOT_TEXT_CHARS) return v
    val end = v.text.offsetByCodePoints(0, CallAnnotate.MAX_ANNOT_TEXT_CHARS)
    return TextFieldValue(v.text.substring(0, end), TextRange(min(v.selection.start, end), min(v.selection.end, end)))
}

private fun norm(o: Offset, box: VideoFit.Size, video: VideoFit.Size?) = CallAnnotate.normalizePoint(o.x.toDouble(), o.y.toDouble(), box, video)

/**
 * The drawings over a video of a shared screen — theirs, or my own while I share (web: AnnotationLayer.tsx).
 * With [interactive] and the Pen, a drag is a stroke and a quick tap a "look here" ping; points are
 * normalised to the shared picture. With the Text tool (round 4): a tap on the picture opens a text field
 * there (any keyboard, Gboard pinyin included); Enter / Done or a tap away finishes it (back too), Esc
 * cancels; what I type reaches the other person as I type (≤ ~7 a second, never mid-composition). A tap on
 * a text selects it (✕ deletes it for both), a drag moves it, a second tap edits it.
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
    tool: AnnotTool = AnnotTool.PEN,
    onText: (AnnotText) -> Unit = {},
    onTextDelete: (String) -> Unit = {},
    onTick: () -> Unit = {},
    nowMs: () -> Long = System::currentTimeMillis,
    /** Screenshots: a text field already open / a text already selected. */
    initialEditor: AnnotTextEditor? = null,
    initialSelected: String? = null,
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
    val onTextNow by rememberUpdatedState(onText)
    val onTextDeleteNow by rememberUpdatedState(onTextDelete)
    val onTickNow by rememberUpdatedState(onTick)
    val textMode = interactive && tool == AnnotTool.TEXT

    var editor by remember { mutableStateOf(initialEditor) }
    var selected by remember { mutableStateOf(initialSelected) }
    // A text being dragged: shown at its new place until the finger lifts (then sent), lifted with a spring.
    var dragging by remember { mutableStateOf<AnnotText?>(null) }
    var lifted by remember { mutableStateOf<String?>(null) }
    val lift by animateFloatAsState(if (dragging != null) 1.08f else 1f, spring(dampingRatio = 0.45f, stiffness = Spring.StiffnessMediumLow), label = "text-lift")
    val scope = rememberCoroutineScope()
    var liveJob by remember { mutableStateOf<Job?>(null) }
    var liveAt by remember { mutableLongStateOf(0L) }

    fun textOf(e: AnnotTextEditor, done: Boolean) =
        AnnotText(e.id, e.before?.color ?: colorNow, e.x, e.y, e.value.text, e.before?.size ?: CallAnnotate.ANNOT_TEXT_SIZE, done)

    /** Send what is typed (≤ ~7 updates a second, never mid-composition). */
    fun sendLive() {
        val e = editor ?: return
        if (e.value.composition != null || liveJob?.isActive == true) return
        liveJob = scope.launch {
            val wait = 150 - (System.currentTimeMillis() - liveAt)
            if (wait > 0) delay(wait)
            val cur = editor ?: return@launch
            if (cur.value.composition != null) return@launch
            liveAt = System.currentTimeMillis()
            if (cur.value.text.isNotEmpty() || cur.before != null) onTextNow(textOf(cur, false))
        }
    }

    /** Enter / tap away / back ([keep]) — or Esc (back as it was; a new one goes away). Empty = deleted. */
    fun finish(keep: Boolean) {
        val e = editor ?: return
        liveJob?.cancel()
        liveJob = null
        editor = null
        if (!keep) {
            if (e.before != null) onTextNow(e.before) else if (latest.texts.containsKey(e.id)) onTextDeleteNow(e.id)
            return
        }
        if (e.value.text.isBlank()) {
            onTextDeleteNow(e.id)
            return
        }
        onTextNow(textOf(e, true))
        onTickNow()
    }

    fun openEditor(e: AnnotTextEditor) {
        selected = null
        editor = e
    }

    // The tools close (Done) or switch to the pen: what I was typing is finished, nothing stays selected.
    LaunchedEffect(textMode) {
        if (!textMode) {
            finish(true)
            selected = null
        }
    }
    // A selected text someone deleted / cleared: nothing selected.
    LaunchedEffect(selected, annotations.texts.keys) {
        if (selected != null && selected !in annotations.texts) selected = null
    }
    BackHandler(enabled = editor != null) { finish(true) }

    BoxWithConstraints(modifier) {
        val density = LocalDensity.current.density
        val wPx = constraints.maxWidth.toFloat()
        val hPx = constraints.maxHeight.toFloat()
        // What is drawn: the dragged text at its new place.
        val shown = dragging?.let { d -> annotations.texts[d.id]?.let { annotations.copy(texts = annotations.texts + (d.id to it.copy(text = d))) } } ?: annotations
        val boxes = if (shown.texts.isEmpty()) emptyList() else layoutAnnotTexts(shown.texts.values, wPx, hPx, video, density, editor?.id)
        val boxesNow by rememberUpdatedState(boxes)

        val penInput = Modifier.pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown()
                val box = VideoFit.Size(size.width.toDouble(), size.height.toDouble())
                val start = norm(down.position, box, videoNow) ?: return@awaitEachGesture
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
                    norm(ch.position, box, videoNow)?.let { points.add(it) }
                    if (moved > 6 * density && System.currentTimeMillis() - lastSent > 40 && ch.positionChange() != Offset.Zero) send(false)
                }
                if (moved <= 6 * density && System.currentTimeMillis() - t0 < 400) onPing(start.first, start.second) else send(true)
            }
        }
        val textInput = Modifier.pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown()
                down.consume()
                // Tapping away finishes the text being typed.
                if (editor != null) {
                    finish(true)
                    return@awaitEachGesture
                }
                val box = VideoFit.Size(size.width.toDouble(), size.height.toDouble())
                val hit = boxesNow.lastOrNull { it.hit(down.position.x, down.position.y) }
                if (hit != null) {
                    val base = hit.text.text
                    val pic = VideoFit.containRect(videoNow, box)
                    var moved = false
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull() ?: break
                        if (!ch.pressed) break
                        ch.consume()
                        val dx = ch.position.x - down.position.x
                        val dy = ch.position.y - down.position.y
                        if (!moved && hypot(dx, dy) < 5 * density) continue
                        if (!moved) {
                            moved = true
                            lifted = base.id
                            onTickNow()
                        }
                        val (nx, ny) = CallAnnotate.moveAnnotText(base.x, base.y, dx / max(1.0, pic.width), dy / max(1.0, pic.height))
                        dragging = base.copy(x = nx, y = ny)
                    }
                    val d = dragging
                    dragging = null
                    when {
                        moved && d != null -> {
                            onTextNow(d.copy(done = true))
                            selected = base.id
                        }
                        // A second tap on the selected text: edit it.
                        selected == base.id -> openEditor(AnnotTextEditor(base.id, base.x, base.y, TextFieldValue(base.text, TextRange(base.text.length)), base.copy(done = true)))
                        else -> {
                            selected = base.id
                            onTickNow()
                        }
                    }
                    return@awaitEachGesture
                }
                if (selected != null) {
                    selected = null
                    return@awaitEachGesture
                }
                val p = norm(down.position, box, videoNow) ?: return@awaitEachGesture
                openEditor(AnnotTextEditor(newTextId(), p.first, max(0.0, p.second - 0.02), TextFieldValue(""), null))
            }
        }
        val input = when {
            !interactive -> Modifier
            tool == AnnotTool.TEXT -> textInput
            else -> penInput
        }
        Canvas(Modifier.fillMaxSize().then(input)) {
            drawAnnotations(shown, video, now, hiddenText = editor?.id, lift = lifted?.let { it to lift }, selected = if (textMode && editor == null && dragging == null) selected else null)
        }

        val e = editor
        if (textMode && e != null) {
            val boxSize = VideoFit.Size(wPx.toDouble(), hPx.toDouble())
            val pic = VideoFit.containRect(video, boxSize)
            val picShort = max(1.0, min(pic.width, pic.height)).toFloat()
            val (ex, ey) = CallAnnotate.denormalizePoint(e.x to e.y, boxSize, video)
            val px = max(11f * density, (e.before?.size ?: CallAnnotate.ANNOT_TEXT_SIZE).toFloat() * picShort)
            val ink = parse(e.before?.color ?: color)
            val localDensity = LocalDensity.current
            val fontSize = with(localDensity) { px.toSp() }
            val maxW = with(localDensity) { max(120 * density, wPx - ex.toFloat() - 8 * density).toDp() }
            val focus = remember(e.id) { FocusRequester() }
            val keyboard = LocalSoftwareKeyboardController.current
            var focused by remember(e.id) { mutableStateOf(false) }
            var shiftEnter by remember(e.id) { mutableStateOf(false) }
            LaunchedEffect(e.id) {
                runCatching { focus.requestFocus() }
                keyboard?.show()
            }
            // The field's text sits where the drawn text will be (its padding + border off the anchor).
            val inset = 6 * density
            BasicTextField(
                value = e.value,
                onValueChange = { raw ->
                    val cur = editor ?: return@BasicTextField
                    val v = capText(raw)
                    val newLine = v.text.count { it == '\n' } > cur.value.text.count { it == '\n' }
                    if (newLine && v.composition == null && !shiftEnter) {
                        // Enter finishes (web: Enter; Shift+Enter on a keyboard = a new line).
                        val at = v.selection.start - 1
                        val text = if (at >= 0 && at < v.text.length && v.text[at] == '\n') v.text.removeRange(at, at + 1) else cur.value.text
                        editor = cur.copy(value = TextFieldValue(text, TextRange(text.length)))
                        finish(true)
                        return@BasicTextField
                    }
                    shiftEnter = false
                    editor = cur.copy(value = v)
                    sendLive()
                },
                modifier = Modifier
                    .offset { IntOffset((ex - inset).roundToInt(), (ey - inset).roundToInt()) }
                    .widthIn(min = 120.dp, max = maxW)
                    .focusRequester(focus)
                    .onFocusChanged { f -> if (f.isFocused) focused = true else if (focused) finish(true) }
                    .onPreviewKeyEvent { k ->
                        if (k.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                        when {
                            k.key == Key.Escape -> { finish(false); true }
                            k.key == Key.Enter && k.isShiftPressed -> { shiftEnter = true; false }
                            k.key == Key.Enter -> { finish(true); true }
                            else -> false
                        }
                    }
                    .background(Color(0xE0111827), RoundedCornerShape(6.dp))
                    .drawBehind {
                        drawRoundRect(
                            ink, cornerRadius = CornerRadius(6 * density),
                            style = Stroke(2 * density, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6 * density, 4 * density))),
                        )
                    }
                    .padding(horizontal = 6.dp, vertical = 6.dp)
                    .testTag("annot-text-editor"),
                textStyle = TextStyle(color = ink, fontSize = fontSize, lineHeight = fontSize * 1.25f, fontWeight = FontWeight.SemiBold),
                cursorBrush = SolidColor(ink),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { finish(true) }),
                decorationBox = { inner ->
                    Box {
                        if (e.value.text.isEmpty()) Text("Type…", color = ink.copy(alpha = 0.6f), fontSize = fontSize, fontWeight = FontWeight.SemiBold)
                        inner()
                    }
                },
            )
        }
        // The selected text's ✕: deletes it for both people.
        val sel = selected?.takeIf { textMode && e == null && dragging == null }?.let { id -> boxes.firstOrNull { it.text.text.id == id } }
        if (sel != null) {
            val half = 22 * density
            Box(
                Modifier
                    .offset { IntOffset((sel.right + sel.pad - half).roundToInt(), (sel.top - sel.pad - half).roundToInt()) }
                    .size(44.dp)
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        val id = sel.text.text.id
                        selected = null
                        onTextDeleteNow(id)
                        onTickNow()
                    }
                    .semantics { contentDescription = "Delete this text" }
                    .testTag("annot-text-delete"),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(28.dp).background(Color(0xFFDC2626), CircleShape).border(2.dp, Color.White, CircleShape),
                    contentAlignment = Alignment.Center,
                ) { Text("✕", color = Color.White, fontSize = 13.sp) }
            }
        }
    }
}
