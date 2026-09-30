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
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
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

/** One tile's content; [content] gets the tile's role (a floating camera is drawn compactly). */
class TileSpec(val label: String, val closable: Boolean = false, val content: @Composable (Role) -> Unit)

private val SPRING = spring<IntOffset>(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow)
private val SIZE_SPRING = spring<androidx.compose.ui.unit.Dp>(dampingRatio = 0.9f, stiffness = Spring.StiffnessMediumLow)
private val VIDEO_TILES = setOf(TileId.REMOTE, TileId.SELF, TileId.SCREEN)

/**
 * The call's tiles (web components/calls/CallTiles.tsx, rules in core CallLayout): every tile is ONE
 * keyed composable moved by its rectangle, so a video renderer is never recreated (no blank flash)
 * and the board keeps its caret when the layout changes.
 *
 * - Double-tap a video tile (or tap its ⤢) to focus it; a rail tile focuses on a single tap.
 * - Split: drag the divider.
 * - Floating cameras: drag anywhere, they spring to the nearest corner; my own camera has a resize handle.
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
        for (id in CallLayout.ALL_TILES) {
            val spec = tiles[id] ?: continue
            val r = rects.tiles.getValue(id)
            if (r.role == Role.HIDDEN) continue
            key(id) {
                TileFrame(
                    id, spec, r, rects.stage, focused = focusedTile == id, narrow = narrow, layout = layout, available = available,
                    onAction = onAction, onReplace = onReplace, onTick = onTick, onSnap = onSnap,
                )
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
    val shape = RoundedCornerShape(if (floating) 14.dp else 16.dp)

    var m = Modifier
        .offset { pos.value + IntOffset(drag.x.roundToInt(), drag.y.roundToInt()) }
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
    if (floating || (r.role == Role.STAGE && id in VIDEO_TILES)) m = m.pointerInput(id, "double-tap") {
        detectTapGestures(onDoubleTap = { onAction(Action.Focus(id)); onTick() })
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
        if (!floating && !(narrow && r.role == Role.STAGE)) TileChrome(spec, r.role, focused, id, onAction, onTick, Modifier.align(Alignment.TopEnd))
        if (floating && id == TileId.SELF) ResizeHandle(layout, r, onAction, onResizing = { resizing = it }, modifier = Modifier.align(resizeAlignment(layout.selfCorner)))
    }
}

/** The handle sits in the corner facing the stage's middle (the tile grows away from its own corner). */
private fun resizeAlignment(c: CallLayout.Corner): Alignment = when (c) {
    CallLayout.Corner.BR -> Alignment.TopStart
    CallLayout.Corner.BL -> Alignment.TopEnd
    CallLayout.Corner.TR -> Alignment.BottomStart
    CallLayout.Corner.TL -> Alignment.BottomEnd
}

@Composable
private fun ResizeHandle(layout: CallLayout.Layout, r: CallLayout.Rect, onAction: (Action) -> Unit, onResizing: (Boolean) -> Unit, modifier: Modifier) {
    val density = LocalDensity.current
    val current by rememberUpdatedState(layout)
    val rect by rememberUpdatedState(r)
    val c = layout.selfCorner
    Box(
        modifier.size(32.dp).testTag("self-resize")
            .pointerInput(Unit) {
                var startScale = 1.0
                var total = Offset.Zero
                var w0 = 1.0
                var h0 = 1.0
                detectDragGestures(
                    onDragStart = { startScale = current.selfScale; total = Offset.Zero; w0 = rect.w; h0 = rect.h; onResizing(true) },
                    onDragEnd = { onResizing(false) },
                    onDragCancel = { onResizing(false) },
                    onDrag = { change, amount ->
                        change.consume()
                        total += amount
                        val left = current.selfCorner == CallLayout.Corner.TL || current.selfCorner == CallLayout.Corner.BL
                        val top = current.selfCorner == CallLayout.Corner.TL || current.selfCorner == CallLayout.Corner.TR
                        // Dragging away from the tile's corner makes it bigger.
                        val dx = total.x / density.density * (if (left) 1 else -1)
                        val dy = total.y / density.density * (if (top) 1 else -1)
                        val grow = maxOf(dx / w0, dy / h0)
                        onAction(Action.SelfScale(startScale * (1 + grow)))
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
    Box(
        Modifier
            .offset { with(density) { IntOffset(d.x.dp.roundToPx(), d.y.dp.roundToPx()) } }
            .size(d.w.dp, d.h.dp)
            .zIndex(2f)
            .testTag("split-divider")
            .pointerInput(Unit) {
                var at = 0.0
                detectDragGestures(
                    onDragStart = { o -> at = if (div.dir == CallLayout.Dir.ROW) div.x + o.x / density.density else div.y + o.y / density.density },
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
        Box(Modifier.size(if (row) 4.dp else 40.dp, if (row) 40.dp else 4.dp).clip(RoundedCornerShape(2.dp)).background(Color(0x99FFFFFF)))
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
