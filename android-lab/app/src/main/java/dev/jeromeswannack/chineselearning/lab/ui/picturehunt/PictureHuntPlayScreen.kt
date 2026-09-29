package dev.jeromeswannack.chineselearning.lab.ui.picturehunt

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.HuntObject
import dev.jeromeswannack.chineselearning.lab.core.HuntRegion
import dev.jeromeswannack.chineselearning.lab.core.PictureHuntGeometry
import dev.jeromeswannack.chineselearning.lab.ui.fx.ConfettiRain
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabBottomSheet
import dev.jeromeswannack.chineselearning.lab.ui.kit.MarkdownText
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/** The play screen is dark whatever the theme (the web's .ph-play), so the picture stands out. */
private object HuntColors {
    val bg = Color(0xFF0B1120)
    val panel = Color(0xFF111A2E)
    val ink = Color(0xFFF8FAFC)
    val muted = Color(0xFFCBD5E1)
    val faint = Color(0xFF1E293B)
    val foundStroke = Color(0xFF4ADE80)
    val foundFill = Color(0x2E22C55E)
    val freshStroke = Color(0xFFFDE047)
    val freshFill = Color(0x8CFACC15)
    val hint = Color(0xFFFBBF24)
    val missedStroke = Color(0xFFFB923C)
    val missedFill = Color(0x1FF97316)
    val foundChip = Color(0xFF16A34A)
    val missedChip = Color(0xFFEA580C)
    val low = Color(0xFFFCA5A5)
}

data class PictureHuntPlayUi(
    val title: String = "",
    val objects: List<HuntObject> = emptyList(),
    val image: ImageBitmap? = null,
    /** Width / height of the picture (from the hunt, else the decoded image). */
    val aspect: Float = 4f / 3f,
    val state: HuntPlayState = HuntPlayState(),
    val input: TextFieldValue = TextFieldValue(""),
    val online: Boolean = true,
    /** The object sheet (tap on the picture / a chip). */
    val inspect: HuntObject? = null,
    val loading: Boolean = false,
    val loadError: String? = null,
)

data class PictureHuntPlayActions(
    val onClose: () -> Unit = {},
    val onInput: (TextFieldValue) -> Unit = {},
    val onSubmit: () -> Unit = {},
    val onHint: () -> Unit = {},
    val onGiveUp: () -> Unit = {},
    val onPlayAgain: () -> Unit = {},
    val onInspect: (HuntObject?) -> Unit = {},
    val onSpeak: (String) -> Unit = {},
    val onAddCard: (HuntObject) -> Unit = {},
)

/** `/picture-hunt/:id` — the web's PictureHuntPlayPage (immersive: no tab bar). */
@Composable
fun PictureHuntPlayScreen(ui: PictureHuntPlayUi, actions: PictureHuntPlayActions) {
    Box(
        Modifier.fillMaxSize().background(HuntColors.bg)
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom))
            .imePadding(),
    ) {
        if (ui.loadError != null || (ui.objects.isEmpty() && !ui.loading)) {
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(ui.loadError ?: "This hunt isn't ready yet.", color = HuntColors.ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium)
                PrimaryPill("Back to picture hunts", Modifier.height(52.dp), onClick = actions.onClose)
            }
            return@Box
        }
        if (ui.objects.isEmpty()) {
            Text("Loading…", color = HuntColors.muted, modifier = Modifier.align(Alignment.Center))
            return@Box
        }
        val s = ui.state
        Column(Modifier.fillMaxSize()) {
            TopBar(ui, actions)
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 640.dp
                if (wide) {
                    Row(Modifier.fillMaxSize().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Column(Modifier.weight(1.45f).fillMaxHeight().verticalScroll(rememberScrollState())) { PictureColumn(ui, actions) }
                        Column(Modifier.weight(1f).widthIn(max = 460.dp).fillMaxHeight().verticalScroll(rememberScrollState())) { SidePanel(ui, actions) }
                    }
                } else {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 10.dp)) {
                        PictureColumn(ui, actions)
                        SidePanel(ui, actions)
                    }
                }
            }
        }
        if (s.end == HuntEnd.ALL) ConfettiRain(key = "hunt-${s.found.size}-${s.end}", colors = Palette.Confetti)
    }
    ui.inspect?.let { ObjectSheet(it, it.id in ui.state.foundSet, ui.online, actions) }
}

@Composable
private fun TopBar(ui: PictureHuntPlayUi, actions: PictureHuntPlayActions) {
    val s = ui.state
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(start = 6.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = actions.onClose), contentAlignment = Alignment.Center) {
            Text("✕", color = HuntColors.muted, fontSize = 20.sp)
        }
        Text(ui.title, Modifier.weight(1f), color = HuntColors.ink, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (s.phase == HuntPhase.PLAYING) {
            Text(
                "⏱ ${PictureHuntGame.formatClock(s.remainingSeconds)}",
                color = if (s.remainingSeconds < 30) HuntColors.low else HuntColors.muted,
                fontSize = 15.sp,
                fontWeight = FontWeight.Medium,
            )
        }
        Text(
            "${s.found.size} / ${ui.objects.size}",
            Modifier.clip(RoundedCornerShape(50)).background(HuntColors.foundChip).padding(horizontal = 12.dp, vertical = 6.dp),
            color = Color.White,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
        )
    }
}

@Composable
private fun PictureColumn(ui: PictureHuntPlayUi, actions: PictureHuntPlayActions) {
    var zoom by remember { mutableFloatStateOf(1f) }
    val s = ui.state
    HuntPicture(
        image = ui.image,
        aspect = ui.aspect,
        objects = ui.objects,
        found = s.foundSet,
        lastFound = s.lastFound.takeIf { s.phase == HuntPhase.PLAYING },
        hintedId = s.hint?.objectId.takeIf { s.phase == HuntPhase.PLAYING },
        reveal = s.phase == HuntPhase.REVEAL,
        online = ui.online,
        zoom = zoom,
        onZoom = { zoom = it },
        onTap = { x, y ->
            val candidates = if (s.phase == HuntPhase.REVEAL) ui.objects else ui.objects.filter { it.id in s.foundSet }
            PictureHuntGeometry.objectAt(candidates, x, y)?.let { actions.onInspect(it) }
        },
    )
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
        ZoomButton("−", enabled = zoom > MIN_ZOOM) { zoom = (zoom - 0.5f).coerceAtLeast(MIN_ZOOM) }
        Text(
            if (zoom == 1f) "Pinch or tap + to zoom" else "%.1f×".format(zoom),
            Modifier.padding(horizontal = 12.dp),
            color = HuntColors.muted,
            fontSize = 13.sp,
        )
        ZoomButton("+", enabled = zoom < MAX_ZOOM) { zoom = (zoom + 0.5f).coerceAtMost(MAX_ZOOM) }
    }
}

@Composable
private fun ZoomButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(44.dp).clip(CircleShape).background(HuntColors.faint).clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (enabled) HuntColors.ink else HuntColors.muted.copy(alpha = 0.35f), fontSize = 20.sp) }
}

private const val MIN_ZOOM = 1f
private const val MAX_ZOOM = 3f

/**
 * The picture with its overlay: found outlines (green, the newest glowing), the hinted object
 * (dashed amber, marching), reveal mode's missed ones (orange) and hanzi labels at
 * [PictureHuntGeometry.labelAnchor]. Pinch to zoom (1–3×), drag to pan when zoomed, tap = the
 * normalised point, hit-tested by the caller.
 */
@Composable
fun HuntPicture(
    image: ImageBitmap?,
    aspect: Float,
    objects: List<HuntObject>,
    found: Set<String>,
    lastFound: String?,
    hintedId: String?,
    reveal: Boolean,
    online: Boolean,
    zoom: Float,
    onZoom: (Float) -> Unit,
    onTap: (Double, Double) -> Unit,
    modifier: Modifier = Modifier,
) {
    var offset by remember { mutableStateOf(Offset.Zero) }
    var box by remember { mutableStateOf(Size.Zero) }
    fun clamp(o: Offset, z: Float): Offset {
        val mx = (z - 1f) * box.width / 2f
        val my = (z - 1f) * box.height / 2f
        return Offset(o.x.coerceIn(-mx, mx), o.y.coerceIn(-my, my))
    }
    LaunchedEffect(zoom) { offset = clamp(offset, zoom) }
    val transform = rememberTransformableState { zoomChange, pan, _ ->
        val z = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
        onZoom(z)
        offset = clamp(offset + pan, z)
    }
    // The newest find glows yellow → green (the web's ph-glow), the hint's dashes march.
    val glow = remember { Animatable(0f) }
    LaunchedEffect(lastFound) {
        if (lastFound != null) {
            glow.snapTo(1f)
            glow.animateTo(0f, tween(1200))
        }
    }
    val dash by rememberInfiniteTransition(label = "dash").animateFloat(0f, 14f, infiniteRepeatable(tween(1000, easing = LinearEasing), RepeatMode.Restart), label = "phase")
    val density = LocalDensity.current

    Box(
        modifier.fillMaxWidth().aspectRatio(aspect.coerceIn(0.4f, 3f)).clip(RoundedCornerShape(14.dp)).clipToBounds().background(HuntColors.faint)
            .layout { m, c -> val p = m.measure(c); box = Size(p.width.toFloat(), p.height.toFloat()); layout(p.width, p.height) { p.place(0, 0) } }
            .transformable(transform),
    ) {
        Box(
            Modifier.fillMaxSize()
                .graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = offset.x; translationY = offset.y }
                .pointerInput(objects, found, reveal) {
                    detectTapGestures { p -> onTap((p.x / size.width).toDouble(), (p.y / size.height).toDouble()) }
                },
        ) {
            if (image != null) {
                Image(image, null, Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
            } else {
                Text(
                    if (online) "Loading the picture…" else "The picture isn't on this device yet",
                    Modifier.align(Alignment.Center).padding(16.dp),
                    color = HuntColors.muted,
                    textAlign = TextAlign.Center,
                )
            }
            Canvas(Modifier.fillMaxSize()) {
                val strokeScale = 1f / zoom
                for (obj in objects) {
                    val isFound = obj.id in found
                    val style = when {
                        isFound && obj.id == lastFound -> ShapeStyle(lerp(HuntColors.foundStroke, HuntColors.freshStroke, glow.value), lerp(HuntColors.foundFill, HuntColors.freshFill, glow.value), 3.5f, null)
                        isFound -> ShapeStyle(HuntColors.foundStroke, HuntColors.foundFill, 3f, null)
                        obj.id == hintedId -> ShapeStyle(HuntColors.hint, Color.Transparent, 3f, PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx() * strokeScale, 6.dp.toPx() * strokeScale), -dash.dp.toPx() * strokeScale))
                        reveal -> ShapeStyle(HuntColors.missedStroke, HuntColors.missedFill, 2f, null)
                        else -> null
                    } ?: continue
                    for (r in obj.regions) drawRegion(r, style, strokeScale)
                }
            }
            // Labels: the hanzi above (or below) the first region's box.
            for (obj in objects) {
                val isFound = obj.id in found
                if (!isFound && !reveal) continue
                val region = obj.regions.firstOrNull() ?: continue
                val anchor = PictureHuntGeometry.labelAnchor(region)
                Text(
                    obj.hanzi,
                    Modifier
                        .layout { m, c ->
                            val p = m.measure(c.copy(minWidth = 0, minHeight = 0))
                            val x = (anchor.x * box.width).toFloat() - p.width / 2f
                            val y = (anchor.y * box.height).toFloat() - if (anchor.above) p.height + with(density) { 2.dp.toPx() } else -with(density) { 2.dp.toPx() }
                            layout(0, 0) { p.place(x.toInt(), y.toInt()) }
                        }
                        .graphicsLayer { scaleX = 1f / zoom; scaleY = 1f / zoom; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, if (anchor.above) 1f else 0f) }
                        .clip(RoundedCornerShape(6.dp))
                        .background(if (isFound) HuntColors.foundChip else HuntColors.missedChip)
                        .padding(horizontal = 5.dp, vertical = 2.dp),
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    lineHeight = 14.sp,
                    maxLines = 1,
                )
            }
        }
    }
}

private data class ShapeStyle(val stroke: Color, val fill: Color, val widthDp: Float, val effect: PathEffect?)

private fun lerp(a: Color, b: Color, t: Float): Color = androidx.compose.ui.graphics.lerp(a, b, t.coerceIn(0f, 1f))

private fun DrawScope.drawRegion(r: HuntRegion, style: ShapeStyle, strokeScale: Float) {
    val w = size.width
    val h = size.height
    val path = Path()
    val poly = r.polygon
    if (poly != null && poly.size >= 3) {
        path.moveTo((poly[0][0] * w).toFloat(), (poly[0][1] * h).toFloat())
        for (i in 1 until poly.size) path.lineTo((poly[i][0] * w).toFloat(), (poly[i][1] * h).toFloat())
        path.close()
    } else {
        val b = r.box
        val rr = 0.008f * w
        path.addRoundRect(
            androidx.compose.ui.geometry.RoundRect(
                (b.x * w).toFloat(), (b.y * h).toFloat(), ((b.x + b.w) * w).toFloat(), ((b.y + b.h) * h).toFloat(),
                androidx.compose.ui.geometry.CornerRadius(rr, rr),
            ),
        )
    }
    if (style.fill.alpha > 0f) drawPath(path, style.fill, style = Fill)
    drawPath(path, style.stroke, style = Stroke(width = style.widthDp.dp.toPx() * strokeScale, join = StrokeJoin.Round, pathEffect = style.effect))
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SidePanel(ui: PictureHuntPlayUi, actions: PictureHuntPlayActions) {
    val s = ui.state
    Column(Modifier.fillMaxWidth().padding(top = 4.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (s.phase == HuntPhase.PLAYING) {
            val focus = remember { FocusRequester() }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = ui.input,
                    onValueChange = actions.onInput,
                    modifier = Modifier.weight(1f).focusRequester(focus),
                    placeholder = { Text("Type what you see… 杯子", color = HuntColors.muted.copy(alpha = 0.6f)) },
                    singleLine = true,
                    textStyle = MaterialTheme.typography.titleMedium.copy(color = HuntColors.ink),
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Text, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { actions.onSubmit() }),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedContainerColor = HuntColors.panel,
                        unfocusedContainerColor = HuntColors.panel,
                        focusedBorderColor = HuntColors.foundStroke,
                        unfocusedBorderColor = HuntColors.faint,
                        cursorColor = HuntColors.foundStroke,
                    ),
                )
                PrimaryPill("Check", Modifier.height(56.dp), color = HuntColors.foundChip, onClick = actions.onSubmit)
            }
            val fb = s.feedback
            Text(
                fb?.text ?: if (s.hint == null) "Every thing you name lights up on the picture." else "",
                color = when (fb?.tone) {
                    "found" -> HuntColors.foundStroke
                    "close" -> HuntColors.hint
                    "miss" -> HuntColors.low
                    else -> HuntColors.muted
                },
                fontWeight = if (fb?.tone == "found") FontWeight.SemiBold else FontWeight.Normal,
                fontSize = 15.sp,
            )
            s.hint?.let {
                Text(
                    "💡 ${it.text}",
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(HuntColors.hint.copy(alpha = 0.12f))
                        .border(1.dp, HuntColors.hint.copy(alpha = 0.45f), RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                    color = Color(0xFFFDE68A),
                    fontSize = 17.sp,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DarkPill("💡 Hint", Modifier.weight(1f), enabled = s.found.size < ui.objects.size, onClick = actions.onHint)
                DarkPill("🏳 Give up", Modifier.weight(1f), onClick = actions.onGiveUp)
            }
        } else {
            val total = ui.objects.size
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(HuntColors.panel).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("${s.found.size} / $total found", color = HuntColors.ink, fontWeight = FontWeight.Bold, fontSize = 26.sp)
                val sub = when (s.end) {
                    HuntEnd.ALL -> "全部找到了！Everything found."
                    HuntEnd.TIME -> "Time's up."
                    else -> "Here's everything."
                } + " " + when {
                    s.newBest -> "🏆 New best!"
                    s.best > 0 -> "Best ${s.best} / $total."
                    else -> ""
                }
                Text(sub.trim(), color = HuntColors.muted, fontSize = 15.sp)
                Text("Tap anything on the picture to hear it and add it as a card.", color = HuntColors.muted.copy(alpha = 0.8f), fontSize = 13.sp)
                PrimaryPill("↻ Play again", Modifier.fillMaxWidth().height(52.dp), color = HuntColors.foundChip, onClick = actions.onPlayAgain)
            }
        }
        val chips = if (s.phase == HuntPhase.REVEAL) ui.objects.sortedByDescending { it.id in s.foundSet }
        else s.found.reversed().mapNotNull { id -> ui.objects.firstOrNull { it.id == id } }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            for (obj in chips) {
                val isFound = obj.id in s.foundSet
                val c = if (isFound) HuntColors.foundChip else HuntColors.missedChip
                Column(
                    Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(10.dp)).background(c.copy(alpha = if (isFound) 0.25f else 0.18f))
                        .border(1.dp, c, RoundedCornerShape(10.dp)).bouncyClickable { actions.onInspect(obj) }.padding(horizontal = 10.dp, vertical = 4.dp),
                ) {
                    Text(obj.hanzi, color = HuntColors.ink, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(obj.pinyin, color = HuntColors.ink.copy(alpha = 0.85f), fontSize = 11.sp)
                }
            }
        }
    }
}

@Composable
private fun DarkPill(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(50)).background(HuntColors.faint).bouncyClickable(enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = if (enabled) HuntColors.ink else HuntColors.muted.copy(alpha = 0.4f), fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
}

/** The tap-to-inspect sheet: names, sound, and + Add as card. */
@Composable
private fun ObjectSheet(obj: HuntObject, found: Boolean, online: Boolean, actions: PictureHuntPlayActions) {
    LabBottomSheet(onDismiss = { actions.onInspect(null) }) {
        ObjectSheetContent(obj, found, online, actions)
    }
}

@Composable
fun ObjectSheetContent(obj: HuntObject, found: Boolean, online: Boolean, actions: PictureHuntPlayActions) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(obj.hanzi, fontSize = 48.sp, color = Lab.colors.ink, lineHeight = 54.sp)
                Text(obj.pinyin, style = MaterialTheme.typography.titleLarge, color = Lab.colors.accent)
                Text(obj.english, style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
            }
            Box(
                Modifier.size(56.dp).clip(CircleShape).background(Lab.colors.accent).bouncyClickable { actions.onSpeak(obj.hanzi) },
                contentAlignment = Alignment.Center,
            ) { Text("▶", color = Color.White, fontSize = 22.sp) }
        }
        Text(
            if (found) "✓ You found this one" else "Not found this time",
            color = if (found) Palette.Good else Palette.Hard,
            fontWeight = FontWeight.SemiBold,
        )
        if (obj.alternatives.isNotEmpty()) {
            Text(buildString { append("Also: "); append(obj.alternatives.joinToString("、")) }, color = Lab.colors.ink, fontSize = 15.sp)
        }
        obj.sentenceClue?.takeIf { it.isNotBlank() }?.let { clue ->
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).bouncyClickable { actions.onSpeak(clue) }.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text("▶ $clue", color = Lab.colors.ink, fontSize = 17.sp)
                obj.sentenceCluePinyin?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.accent, fontSize = 13.sp) }
                obj.sentenceClueTranslation?.takeIf { it.isNotBlank() }?.let { Text(it, color = Lab.colors.muted, fontSize = 13.sp) }
            }
        }
        obj.funFacts?.takeIf { it.isNotBlank() }?.let { MarkdownText(it, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("Close", Modifier.weight(1f)) { actions.onInspect(null) }
            PrimaryPill("+ Add as card", Modifier.weight(1f).height(48.dp), enabled = online) { actions.onAddCard(obj) }
        }
        if (!online) InlineNotice("Adding a card needs a connection.", kind = NoticeKind.Offline)
        Spacer(Modifier.width(1.dp))
    }
}

/** Keep a TextFieldValue's cursor at the end after the text is replaced. */
internal fun TextFieldValue.selectAll(): TextFieldValue = copy(selection = TextRange(0, text.length))
