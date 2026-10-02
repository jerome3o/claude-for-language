package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Action
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.Role
import dev.jeromeswannack.chineselearning.lab.core.calls.CallLayout.TileId
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * One tile's content; [content] gets the tile's role (a floating camera is drawn compactly).
 * [onLongPress]: a long-press on the tile on the stage (round 4: the shared screen / the board → the
 * "board beside the screen" menu).
 */
class TileSpec(val label: String, val closable: Boolean = false, val onLongPress: (() -> Unit)? = null, val content: @Composable (Role) -> Unit)

/** Round 4: the room the text board leaves at its top for the faces box (core `layoutRects(…).textInsetTop`), for the TEXT tile's content. */
val LocalTextInsetTop = compositionLocalOf { 0.dp }

/** The split divider's touch target across its line (the drawn gap stays [CallLayout.DIVIDER]). */
internal val DIVIDER_TOUCH = 44.dp

private val SPRING = spring<IntOffset>(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow)
private val SIZE_SPRING = spring<androidx.compose.ui.unit.Dp>(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)
private val VIDEO_TILES = setOf(TileId.REMOTE, TileId.SELF, TileId.SCREEN, TileId.MATERIAL)

/**
 * The call's tiles (web components/calls/CallTiles.tsx, rules in core CallLayout): every tile is ONE
 * keyed composable moved by its rectangle, so a video renderer is never recreated (no blank flash)
 * and the board keeps its caret when the layout changes.
 *
 * - Double-tap a video tile (or tap its ⤢) to focus it; a rail tile focuses on a single tap.
 * - Split: drag the divider (a ≥ 44 dp handle). Phones split only a shared screen with a board
 *   (round 4): stacked in portrait, side by side in landscape.
 * - Round 4: a long-press on the shared screen / the board ([TileSpec.onLongPress]) opens the
 *   "board beside the screen" menu; the text board leaves [LocalTextInsetTop] for the faces box.
 * - Floating cameras: drag anywhere, they spring to the nearest corner; my own camera has a resize handle.
 * - Faces together (content on the stage): both cameras in ONE box — drag it and it springs to a corner
 *   (a light haptic), resize it with its grip, tap it for Speaker. The camera tiles stay the same
 *   composables (videos never restart); they just ride along with the box.
 * - Phones: swipe left / right on the stage to move between tiles.
 */
@Composable
fun CallTiles(
    layout: CallLayout.Layout,
    onAction: (Action) -> Unit,
    onReplace: (CallLayout.Layout) -> Unit,
    available: CallLayout.Availability,
    tiles: Map<TileId, TileSpec>,
    aspects: Map<TileId, Double>,
    modifier: Modifier = Modifier,
    onTick: () -> Unit = {},
    onSnap: () -> Unit = {},
) {
    BoxWithConstraints(modifier.testTag("call-tiles")) {
        val bw = floor(maxWidth.value.toDouble())
        val bh = floor(maxHeight.value.toDouble())
        val arr = CallLayout.arrangeTiles(layout, available, bw)
        val rects = CallLayout.layoutRects(layout, arr, bw, bh, aspects)
        val narrow = bw < CallLayout.NARROW_WIDTH
        val focusedTile = if (arr.mode == CallLayout.Mode.FOCUS) arr.stage.firstOrNull() else null
        // The faces box's drag: both faces ride along; on release it springs back to 0 while the box
        // springs to its (new) corner, so the move is continuous.
        val pairDrag = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
        rects.pair?.let { p -> PairFrame(p, rects.stage, layout, pairDrag, onAction, onTick, onSnap) }
        for (id in CallLayout.ALL_TILES) {
            val spec = tiles[id] ?: continue
            val r = rects.tiles.getValue(id)
            if (r.role == Role.HIDDEN) continue
            key(id) {
                CompositionLocalProvider(LocalTextInsetTop provides if (id == TileId.TEXT) rects.textInsetTop.dp else 0.dp) {
                TileFrame(
                    id, spec, r, rects.stage, focused = focusedTile == id, narrow = narrow, layout = layout, available = available,
                    onAction = onAction, onReplace = onReplace, onTick = onTick, onSnap = onSnap,
                    pairDrag = { pairDrag.value },
                )
                }
            }
        }
        rects.divider?.let { d -> SplitDivider(d, rects.stage, onAction) }
    }
}

@Composable
private fun TileFrame(
    id: TileId,
    spec: TileSpec,
    r: CallLayout.Rect,
    stage: CallLayout.Box,
    focused: Boolean,
    narrow: Boolean,
    layout: CallLayout.Layout,
    available: CallLayout.Availability,
    onAction: (Action) -> Unit,
    onReplace: (CallLayout.Layout) -> Unit,
    onTick: () -> Unit,
    onSnap: () -> Unit,
    pairDrag: () -> Offset = { Offset.Zero },
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val target = with(density) { IntOffset(r.x.dp.roundToPx(), r.y.dp.roundToPx()) }
    val pos = remember { Animatable(target, IntOffset.VectorConverter) }
    var drag by remember { mutableStateOf(Offset.Zero) }
    var dragging by remember { mutableStateOf(false) }
    var resizing by remember { mutableStateOf(false) }
    var settle by remember { mutableIntStateOf(0) }
    LaunchedEffect(target, settle) { if (!dragging) pos.animateTo(target, SPRING) }
    val animW by animateDpAsState(r.w.dp, SIZE_SPRING, label = "tile-w")
    val animH by animateDpAsState(r.h.dp, SIZE_SPRING, label = "tile-h")
    val w = if (resizing) r.w.dp else animW
    val h = if (resizing) r.h.dp else animH
    // Gesture callbacks read the latest values without restarting a gesture in progress.
    val rect by rememberUpdatedState(r)
    val stageBox by rememberUpdatedState(stage)
    val currentLayout by rememberUpdatedState(layout)
    val currentAvailable by rememberUpdatedState(available)
    val floating = r.role == Role.FLOATING
    val inPair = r.role == Role.PAIR
    val shape = RoundedCornerShape(if (inPair) 10.dp else if (floating) 14.dp else 16.dp)

    var m = Modifier
        .offset {
            val ride = if (inPair) pairDrag() else Offset.Zero
            pos.value + IntOffset((drag.x + ride.x).roundToInt(), (drag.y + ride.y).roundToInt())
        }
        .size(w, h)
        .zIndex(r.z.toFloat() + if (dragging) 10f else 0f)
        .clip(shape)
        .background(Color(0xFF1E232A))
        .testTag("tile-${id.wire}")
    if (floating) m = m.border(1.dp, Color(0x33FFFFFF), shape)
    // Floating: drag to a corner (it springs there), double-tap to focus.
    if (floating) m = m
        .pointerInput(id, "float-drag") {
            detectDragGestures(
                onDragStart = { dragging = true },
                onDragEnd = {
                    val now = pos.value + IntOffset(drag.x.roundToInt(), drag.y.roundToInt())
                    val s = stageBox
                    val cr = rect
                    val cx = (now.x / density.density + cr.w / 2 - s.x) / s.w
                    val cy = (now.y / density.density + cr.h / 2 - s.y) / s.h
                    val corner = CallLayout.snapCorner(cx, cy)
                    scope.launch {
                        pos.snapTo(now)
                        drag = Offset.Zero
                        dragging = false
                        settle++
                    }
                    onAction(if (id == TileId.SELF) Action.SelfCorner(corner) else Action.RemoteCorner(corner))
                    onSnap()
                },
                onDragCancel = {
                    val now = pos.value + IntOffset(drag.x.roundToInt(), drag.y.roundToInt())
                    scope.launch { pos.snapTo(now); drag = Offset.Zero; dragging = false; settle++ }
                },
                onDrag = { change, amount -> change.consume(); drag += amount },
            )
        }
    val doubleTap = floating || (r.role == Role.STAGE && id in VIDEO_TILES)
    val longPress = spec.onLongPress?.takeIf { r.role == Role.STAGE }
    val haptic = LocalHapticFeedback.current
    if (doubleTap || longPress != null) m = m.pointerInput(id, "taps", longPress != null) {
        detectTapGestures(
            onDoubleTap = if (doubleTap) { _ -> onAction(Action.Focus(id)); onTick() } else null,
            onLongPress = if (longPress != null) { _ -> haptic.performHapticFeedback(HapticFeedbackType.LongPress); longPress() } else null,
        )
    }
    // Phones: swipe left / right on the stage between tiles.
    if (narrow && r.role == Role.STAGE) m = m.pointerInput(id, "swipe") {
        var total = 0f
        var startedAt = 0L
        detectHorizontalDragGestures(
            onDragStart = { total = 0f; startedAt = System.currentTimeMillis() },
            onDragEnd = {
                if (abs(total) > 70.dp.toPx() && System.currentTimeMillis() - startedAt < 700) {
                    onReplace(CallLayout.swipeFocus(currentLayout, currentAvailable, if (total < 0) 1 else -1))
                    onTick()
                }
            },
            onHorizontalDrag = { change, dx -> total += dx; change.consume() },
        )
    }

    Box(m) {
        spec.content(r.role)
        // A rail tile: one tap focuses it (its content isn't interactive there).
        if (r.role == Role.RAIL) Box(
            Modifier.fillMaxSize().pointerInput(id, "rail") { detectTapGestures { onAction(Action.Focus(id)); onTick() } },
        )
        // Phones: one focused tile at a time — the 📝 / 💬 buttons and a swipe move on, no chrome over the floating camera.
        if (!floating && !inPair && !(narrow && r.role == Role.STAGE)) TileChrome(spec, r.role, focused, id, onAction, onTick, Modifier.align(Alignment.TopEnd))
        if (floating && id == TileId.SELF) ResizeHandle(
            layout.selfCorner, { layout.selfScale }, r.w, r.h, { onAction(Action.SelfScale(it)) },
            onResizing = { resizing = it }, modifier = Modifier.align(resizeAlignment(layout.selfCorner)), tag = "self-resize",
        )
    }
}

/**
 * The faces box (web .call-pair-bg + .call-pair): a dark rounded backdrop under the two faces and a
 * transparent hit layer over them — drag → spring to the nearest corner (+ a snap haptic), tap →
 * Speaker, a grip in the corner facing the stage's middle resizes it.
 */
@Composable
private fun PairFrame(
    p: CallLayout.PairBox,
    stage: CallLayout.Box,
    layout: CallLayout.Layout,
    pairDrag: Animatable<Offset, androidx.compose.animation.core.AnimationVector2D>,
    onAction: (Action) -> Unit,
    onTick: () -> Unit,
    onSnap: () -> Unit,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val target = with(density) { IntOffset(p.x.dp.roundToPx(), p.y.dp.roundToPx()) }
    val pos = remember { Animatable(target, IntOffset.VectorConverter) }
    LaunchedEffect(target) { pos.animateTo(target, SPRING) }
    val w by animateDpAsState(p.w.dp, SIZE_SPRING, label = "pair-w")
    val h by animateDpAsState(p.h.dp, SIZE_SPRING, label = "pair-h")
    val box by rememberUpdatedState(p)
    val stageBox by rememberUpdatedState(stage)
    val current by rememberUpdatedState(layout)
    val shape = RoundedCornerShape(14.dp)
    val at: androidx.compose.ui.unit.Density.() -> IntOffset = {
        val d = pairDrag.value
        pos.value + IntOffset(d.x.roundToInt(), d.y.roundToInt())
    }
    // The backdrop, under the faces (z 3).
    Box(Modifier.offset(at).size(w, h).zIndex(2f).clip(shape).background(Color(0xD1111827)).border(1.dp, Color(0x47FFFFFF), shape))
    // The hit layer, over the faces.
    Box(
        Modifier.offset(at).size(w, h).zIndex(5f).testTag("faces-pair")
            .semantics {
                role = androidx.compose.ui.semantics.Role.Button
                contentDescription = "Both cameras — drag to a corner, tap for the speaker view"
                onClick { onAction(Action.PairTap); true }
            }
            .pointerInput("pair-tap") { detectTapGestures(onTap = { onAction(Action.PairTap); onTick() }) }
            .pointerInput("pair-drag") {
                detectDragGestures(
                    onDrag = { change, amount ->
                        change.consume()
                        scope.launch { pairDrag.snapTo(pairDrag.value + amount) }
                    },
                    onDragEnd = {
                        val d = pairDrag.value
                        val b = box
                        val s = stageBox
                        val cx = (b.x + d.x / density.density + b.w / 2 - s.x) / s.w
                        val cy = (b.y + d.y / density.density + b.h / 2 - s.y) / s.h
                        onAction(Action.PairCorner(CallLayout.snapCorner(cx, cy)))
                        onSnap()
                        scope.launch { pairDrag.animateTo(Offset.Zero, spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow)) }
                    },
                    onDragCancel = { scope.launch { pairDrag.animateTo(Offset.Zero, spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow)) } },
                )
            },
    ) {
        ResizeHandle(
            p.corner, { current.pairScale }, p.w, p.h, { onAction(Action.PairScale(it)) },
            onResizing = {}, modifier = Modifier.align(resizeAlignment(p.corner)), tag = "pair-resize",
        )
    }
}

/** The handle sits in the corner facing the stage's middle (the tile grows away from its own corner). */
private fun resizeAlignment(c: CallLayout.Corner): Alignment = when (c) {
    CallLayout.Corner.BR -> Alignment.TopStart
    CallLayout.Corner.BL -> Alignment.TopEnd
    CallLayout.Corner.TR -> Alignment.BottomStart
    CallLayout.Corner.TL -> Alignment.BottomEnd
}

/** A resize grip for a floating box in [corner]: dragging away from that corner grows it ([onScale] gets the new scale). */
@Composable
private fun ResizeHandle(
    corner: CallLayout.Corner,
    scale: () -> Double,
    width: Double,
    height: Double,
    onScale: (Double) -> Unit,
    onResizing: (Boolean) -> Unit,
    modifier: Modifier,
    tag: String,
) {
    val density = LocalDensity.current
    val currentCorner by rememberUpdatedState(corner)
    val w by rememberUpdatedState(width)
    val h by rememberUpdatedState(height)
    val c = corner
    Box(
        modifier.size(32.dp).testTag(tag)
            .pointerInput(Unit) {
                var startScale = 1.0
                var total = Offset.Zero
                var w0 = 1.0
                var h0 = 1.0
                detectDragGestures(
                    onDragStart = { startScale = scale(); total = Offset.Zero; w0 = w; h0 = h; onResizing(true) },
                    onDragEnd = { onResizing(false) },
                    onDragCancel = { onResizing(false) },
                    onDrag = { change, amount ->
                        change.consume()
                        total += amount
                        val left = currentCorner == CallLayout.Corner.TL || currentCorner == CallLayout.Corner.BL
                        val top = currentCorner == CallLayout.Corner.TL || currentCorner == CallLayout.Corner.TR
                        // Dragging away from the tile's corner makes it bigger.
                        val dx = total.x / density.density * (if (left) 1 else -1)
                        val dy = total.y / density.density * (if (top) 1 else -1)
                        val grow = maxOf(dx / w0, dy / h0)
                        onScale(startScale * (1 + grow))
                    },
                )
            }
            .drawBehind {
                // A small quarter-circle grip in the inner corner.
                val left = c == CallLayout.Corner.BR || c == CallLayout.Corner.TR
                val top = c == CallLayout.Corner.BR || c == CallLayout.Corner.BL
                val cx = if (left) 0f else size.width
                val cy = if (top) 0f else size.height
                drawCircle(Color(0xD9FFFFFF), radius = 9.dp.toPx(), center = Offset(cx, cy))
            },
    )
}

@Composable
private fun TileChrome(spec: TileSpec, role: Role, focused: Boolean, id: TileId, onAction: (Action) -> Unit, onTick: () -> Unit, modifier: Modifier) {
    val paper = id == TileId.TEXT || id == TileId.DRAW || id == TileId.CHAT
    val bg = if (paper) Color(0xFFF3F4F6) else Color(0xB3111827)
    val fg = if (paper) Color(0xFF374151) else Color.White
    Row(modifier.padding(6.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
        // The name only where the tile doesn't already say it (the rail).
        if (role == Role.RAIL) Text(
            spec.label, color = fg, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.widthIn(max = 140.dp).clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 8.dp, vertical = 4.dp),
        )
        if (role == Role.STAGE && !focused) ChromeButton("⤢", "Focus ${spec.label}", bg, fg) { onAction(Action.Focus(id)); onTick() }
        if (role == Role.STAGE && spec.closable) ChromeButton("✕", "Close ${spec.label}", bg, fg) { onAction(Action.Close(id)); onTick() }
    }
}

@Composable
private fun ChromeButton(label: String, desc: String, bg: Color, fg: Color, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(bg)
            .bouncyClickable(role = androidx.compose.ui.semantics.Role.Button, onClick = onClick)
            .testTag("chrome-$desc"),
        contentAlignment = Alignment.Center,
    ) { Text(label, color = fg, fontSize = if (label == "⤢") 22.sp else 16.sp) }
}

@Composable
private fun SplitDivider(d: CallLayout.Divider, stage: CallLayout.Box, onAction: (Action) -> Unit) {
    val density = LocalDensity.current
    val stageBox by rememberUpdatedState(stage)
    val div by rememberUpdatedState(d)
    val row = d.dir == CallLayout.Dir.ROW
    // The touch target is ≥ 44 dp across the line; the gap drawn between the panes stays 12 dp.
    val pad = ((DIVIDER_TOUCH.value - CallLayout.DIVIDER) / 2).coerceAtLeast(0.0)
    Box(
        Modifier
            .offset { with(density) { IntOffset((d.x - if (row) pad else 0.0).dp.roundToPx(), (d.y - if (row) 0.0 else pad).dp.roundToPx()) } }
            .size(if (row) DIVIDER_TOUCH else d.w.dp, if (row) d.h.dp else DIVIDER_TOUCH)
            .zIndex(2f)
            .testTag("split-divider")
            .semantics { contentDescription = if (row) "Drag to resize the two panes" else "Drag to resize the two panes (up / down)" }
            .pointerInput(Unit) {
                var at = 0.0
                detectDragGestures(
                    onDragStart = { o ->
                        val p = pad
                        at = if (div.dir == CallLayout.Dir.ROW) div.x - p + o.x / density.density else div.y - p + o.y / density.density
                    },
                    onDrag = { change, amount ->
                        change.consume()
                        val s = stageBox
                        at += (if (div.dir == CallLayout.Dir.ROW) amount.x else amount.y) / density.density
                        onAction(Action.Ratio(if (div.dir == CallLayout.Dir.ROW) (at - s.x) / s.w else (at - s.y) / s.h))
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        // A grip pill on the line, so it reads as something to drag.
        Box(
            Modifier.size(if (row) 8.dp else 48.dp, if (row) 48.dp else 8.dp).clip(RoundedCornerShape(4.dp))
                .background(Color(0xFF374151)).border(1.dp, Color(0x66FFFFFF), RoundedCornerShape(4.dp)),
            contentAlignment = Alignment.Center,
        ) { Box(Modifier.size(if (row) 2.dp else 24.dp, if (row) 24.dp else 2.dp).clip(RoundedCornerShape(1.dp)).background(Color(0xCCFFFFFF))) }
    }
}

/** A small diagram of a preset (web .call-preset-icon). */
@Composable
fun PresetIcon(preset: CallLayout.PresetId, modifier: Modifier = Modifier, color: Color = Color(0xFF9CA3AF)) {
    Box(
        modifier.size(30.dp, 21.dp).border(2.dp, color, RoundedCornerShape(3.dp)).drawBehind {
            val s = 2.dp.toPx()
            val w = size.width
            val h = size.height
            when (preset) {
                CallLayout.PresetId.SPEAKER -> drawRect(color, Offset(w - s - 9.dp.toPx(), h - s - 6.dp.toPx()), androidx.compose.ui.geometry.Size(8.dp.toPx(), 5.dp.toPx()))
                CallLayout.PresetId.SCREEN -> drawRect(color, Offset(w - s - 9.dp.toPx(), s + 1.dp.toPx()), androidx.compose.ui.geometry.Size(8.dp.toPx(), 5.dp.toPx()))
                CallLayout.PresetId.BOARD -> drawRect(color, Offset(w - 10.dp.toPx(), 0f), androidx.compose.ui.geometry.Size(10.dp.toPx(), h))
                CallLayout.PresetId.SIDE -> drawRect(color, Offset(w / 2 - s / 2, 0f), androidx.compose.ui.geometry.Size(s, h))
                CallLayout.PresetId.GRID -> {
                    drawRect(color, Offset(w / 2 - s / 2, 0f), androidx.compose.ui.geometry.Size(s, h))
                    drawRect(color, Offset(0f, h / 2 - s / 2), androidx.compose.ui.geometry.Size(w, s))
                }
            }
        },
    )
}

/** Tiny helper so tile contents can pad their overlays away from the chrome. */
internal val ChromeClearance = 48.dp
