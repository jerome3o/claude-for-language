package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import dev.jeromeswannack.chineselearning.lab.core.ChatBubbles
import dev.jeromeswannack.chineselearning.lab.core.Js
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * Photo albums (docs/CHAT.md "Photo albums"): photos picked together are one message each but ONE
 * bubble — a collage (2 side by side, 3 = one big + two small, 4 = 2 × 2, 5+ = 2 × 2 with "+N"),
 * the time + ticks inside it on the last tile, the caption under it. A tile opens the viewer at that
 * photo: a HorizontalPager with "3 / 5", pinch / double-tap zoom, Share / Forward / Delete of the
 * photo on screen. Grouping is ChatBubbles.layoutBubbles (parity-tested with the web).
 */

/** The collage's width; heights are fixed per layout, so loading never moves the thread. */
val ALBUM_WIDTH = 264.dp
private val GAP = 2.dp

private fun albumHeight(tiles: Int): Dp = if (tiles == 2) 176.dp else 264.dp

/** When a photo of the album was sent (a pending one: when I queued it). */
private fun AlbumPhoto.createdAt(): String = message?.created_at ?: Js.toIsoString(pending!!.createdAtMs)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AlbumTile(photo: AlbumPhoto, more: Int, actions: ChatActions, modifier: Modifier, onOpen: () -> Unit, onMenu: () -> Unit) {
    val bitmap by produceState<ImageBitmap?>(null, photo.id) {
        value = runCatching {
            photo.message?.let { actions.loadImage(it, 720) } ?: photo.pending?.filePath?.let { actions.loadLocalImage(it, 720) }
        }.getOrNull()
    }
    val shown by animateFloatAsState(if (bitmap != null) 1f else 0f, spring(stiffness = Spring.StiffnessMediumLow), label = "tile")
    Box(
        modifier.background(Lab.colors.faint).combinedClickable(onClick = onOpen, onLongClick = onMenu, onClickLabel = "Open photo", onLongClickLabel = "Album actions")
            .testTag("chat-album-tile"),
        contentAlignment = Alignment.Center,
    ) {
        val b = bitmap
        if (b != null) Image(b, contentDescription = "Photo", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize().alpha(shown))
        else Text("📷", fontSize = 24.sp, modifier = Modifier.alpha(0.45f))
        if (more > 0) {
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                Text("+$more", color = Color.White, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        if (photo.pending != null && !photo.pending.delivered) {
            Text(
                if (photo.pending.failed) "!" else "🕓", fontSize = 11.sp, color = Color.White,
                modifier = Modifier.align(Alignment.TopStart).padding(6.dp).clip(RoundedCornerShape(8.dp)).background(Color.Black.copy(alpha = 0.45f)).padding(horizontal = 5.dp, vertical = 1.dp),
            )
        }
    }
}

/** The collage itself: [onOpen] gets the tapped photo's index. */
@Composable
fun AlbumCollage(photos: List<AlbumPhoto>, actions: ChatActions, onOpen: (Int) -> Unit, onMenu: () -> Unit) {
    val (tiles, more) = ChatBubbles.albumTiles(photos.size)
    val h = albumHeight(tiles)
    fun tile(i: Int, m: Modifier) = @Composable { AlbumTile(photos[i], if (i == tiles - 1) more else 0, actions, m, { onOpen(i) }, onMenu) }
    Box(Modifier.size(ALBUM_WIDTH, h).clip(RoundedCornerShape(14.dp)).testTag("chat-album")) {
        when (tiles) {
            2 -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(GAP)) {
                tile(0, Modifier.weight(1f).fillMaxSize())()
                tile(1, Modifier.weight(1f).fillMaxSize())()
            }
            // One big on the left, two small stacked on the right.
            3 -> Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(GAP)) {
                tile(0, Modifier.weight(3f).fillMaxSize())()
                Column(Modifier.weight(2f).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(GAP)) {
                    tile(1, Modifier.weight(1f).fillMaxWidth())()
                    tile(2, Modifier.weight(1f).fillMaxWidth())()
                }
            }
            else -> Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(GAP)) {
                for (r in 0 until 2) Row(Modifier.weight(1f).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(GAP)) {
                    for (c in 0 until 2) {
                        val i = r * 2 + c
                        if (i < tiles) tile(i, Modifier.weight(1f).fillMaxSize())() else Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

/**
 * An album row: the collage in one bubble (the reply quote on top, the caption under it, the meta in
 * the corner — on the last tile when there is no caption), reactions of its LAST photo over the
 * bubble's edge; a long press opens the album's menu, swipe right replies to it.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun AlbumBubbleRow(row: ChatRow.Album, ui: ChatUi, actions: ChatActions, onView: (ViewerTarget) -> Unit) {
    val mine = row.mine
    val c = chatColors()
    val layout = row.layout
    val shape = bubbleShape(mine, layout.firstInGroup, layout.lastInGroup)
    val bg = if (mine) c.mine else c.theirs
    val fg = if (mine) c.onMine else c.onTheirs
    val caption = row.caption?.content?.takeIf { it.isNotBlank() }
    val showMeta = layout.lastInGroup || layout.id in ui.timeShown || row.pending
    val meta = if (!showMeta) null else metaText(
        BubbleMeta(
            ChatLogic.formatTime(row.last.createdAt()), layout.tick,
            pinned = row.messages.any { !it.pinned_at.isNullOrEmpty() },
        ),
        if (mine) c.metaMine else c.metaTheirs, if (mine) Color.White else Lab.colors.accent,
    )
    val haptic = LocalHapticFeedback.current
    val ids = row.messages.map { it.id }
    val openMenu: () -> Unit = {
        if (ids.isNotEmpty() && ui.selection == null) {
            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
            actions.onOpenAlbumMenu(ids)
        }
    }
    val open: (Int) -> Unit = { i ->
        actions.onAlbumViewerOpen(row.photos.size, i)
        onView(ViewerTarget(null, null, album = row.photos, index = i))
    }
    val reply = row.photos.first().message?.reply_to
    val lastMsg = row.last.message
    val headMsg = row.head.message
    val bubble: @Composable () -> Unit = {
        ChatLongPress {
            Box(
                Modifier.clip(shape).background(if (caption == null && reply == null) Color.Transparent else bg)
                    .combinedClickable(onClick = { actions.onToggleTime(layout.id) }, onLongClick = openMenu, onLongClickLabel = "Album actions")
                    .testTag("chat-album-bubble")
                    .semantics { contentDescription = "${row.photos.size} photos" + (caption?.let { ": $it" } ?: "") },
            ) {
                Column(Modifier.widthIn(max = ALBUM_WIDTH + 6.dp).padding(3.dp)) {
                    reply?.let { r -> Box(Modifier.padding(start = 3.dp, end = 3.dp, top = 3.dp)) { ReplyQuote(r, mine, ui) { actions.onJumpTo(r.id) } } }
                    Box {
                        AlbumCollage(row.photos, actions, open, openMenu)
                        if (caption == null && meta != null) PhotoMeta(AnnotatedString(meta.text))
                    }
                    if (caption != null) Box(Modifier.width(ALBUM_WIDTH)) {
                        val reserve = rememberMetaWidth(meta)
                        ReservedText(AnnotatedString(caption), reserve, color = fg, fontSize = 17.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 9.dp, vertical = 6.dp))
                        MetaCorner(meta)
                    }
                }
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(top = groupGap(layout.firstInGroup)).testTag("chat-message"),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
    ) {
        Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
            SwipeToReply(enabled = ui.selection == null && headMsg != null, onReply = { actions.onReply(headMsg) }) {
                if (lastMsg != null) Reactions(lastMsg, mine, ui, actions, bubble) else bubble()
            }
            if (row.failed) {
                Text(
                    "Not sent · Tap to retry", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = Palette.Again,
                    modifier = Modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(8.dp))
                        .clickable { row.photos.mapNotNull { it.pending }.filter { it.failed }.forEach { actions.onRetryPending(it.clientId) } }
                        .padding(horizontal = 4.dp, vertical = 6.dp).testTag("chat-not-sent"),
                )
            }
        }
    }
}

/** One page of the viewer: the photo (cached / downloaded), pinch and double-tap zoom. */
@Composable
private fun AlbumPage(photo: AlbumPhoto, actions: ChatActions, onZoomed: (Boolean) -> Unit) {
    val bitmap by produceState<ImageBitmap?>(null, photo.id) {
        value = runCatching { photo.message?.let { actions.loadImage(it, 2400) } ?: photo.pending?.filePath?.let { actions.loadLocalImage(it, 2400) } }.getOrNull()
    }
    var zoom by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    LaunchedEffect(zoom > 1f) { onZoomed(zoom > 1f) }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val b = bitmap
        if (b == null) CircularProgressIndicator(color = Color.White)
        else Image(
            b, contentDescription = "Photo",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize()
                // Two fingers zoom; one finger pans only while zoomed in — otherwise the pager swipes.
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        do {
                            val event = awaitPointerEvent()
                            val fingers = event.changes.count { it.pressed }
                            if (fingers > 1 || zoom > 1f) {
                                zoom = (zoom * event.calculateZoom()).coerceIn(1f, 5f)
                                if (zoom > 1f) {
                                    val pan = event.calculatePan()
                                    offsetX += pan.x; offsetY += pan.y
                                } else { offsetX = 0f; offsetY = 0f }
                                event.changes.forEach { if (it.pressed) it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                    }
                }
                .pointerInput(Unit) { detectTapGestures(onDoubleTap = { zoom = if (zoom > 1f) 1f else 2.5f; offsetX = 0f; offsetY = 0f }) }
                .graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = offsetX; translationY = offsetY },
        )
    }
}

/**
 * The album viewer: full screen at the tapped photo, swipe left / right through the album, "3 / 5",
 * Share / Forward / Delete (mine) of the photo on screen; back / ✕ closes the viewer only.
 */
@Composable
fun AlbumViewer(photos: List<AlbumPhoto>, start: Int, ui: ChatUi, actions: ChatActions, onClose: () -> Unit) {
    if (photos.isEmpty()) return
    // A Dialog: the back gesture dismisses it — the viewer closes, the chat stays.
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        AlbumViewerContent(photos, start, ui, actions, onClose)
    }
}

/** The viewer's content (its own composable so screenshot tests can draw it without the dialog window). */
@Composable
fun AlbumViewerContent(photos: List<AlbumPhoto>, start: Int, ui: ChatUi, actions: ChatActions, onClose: () -> Unit) {
    run {
        val pager = rememberPagerState(initialPage = start.coerceIn(0, photos.size - 1)) { photos.size }
        var zoomed by remember { mutableStateOf(false) }
        val current = photos.getOrNull(pager.currentPage)
        val caption = photos.lastOrNull { it.content.isNotBlank() }?.content
        Box(Modifier.fillMaxSize().background(Color.Black).testTag("chat-album-viewer")) {
            HorizontalPager(pager, Modifier.fillMaxSize(), userScrollEnabled = !zoomed, key = { photos[it].id }) { page ->
                AlbumPage(photos[page], actions) { z -> if (page == pager.currentPage) zoomed = z }
            }
            Row(
                Modifier.fillMaxWidth().align(Alignment.TopCenter).background(Color.Black.copy(alpha = 0.35f)).statusBarsPadding().padding(start = 16.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    ChatBubbles.albumCounter(pager.currentPage, photos.size), color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f).testTag("chat-album-counter"),
                )
                val m = current?.message
                if (m != null) {
                    ViewerButton("📤", "Share photo") { actions.onSharePhoto(m) }
                    if (!ui.isAi) ViewerButton("↪️", "Forward this photo") { onClose(); actions.onForwardPhoto(m) }
                    if (m.sender_id == ui.myId) ViewerButton("🗑️", "Delete this photo") { onClose(); actions.onDeletePhoto(m) }
                }
                ViewerButton("✕", "Close photos", onClose)
            }
            caption?.let {
                Text(
                    it, color = Color.White, fontSize = 16.sp,
                    modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color.Black.copy(alpha = 0.55f)).navigationBarsPadding().padding(16.dp),
                )
            }
        }
    }
}

@Composable
private fun ViewerButton(icon: String, label: String, onClick: () -> Unit) {
    Box(
        Modifier.padding(horizontal = 2.dp).size(48.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.14f))
            .clickable(onClickLabel = label, onClick = onClick).semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) { Text(icon, fontSize = 18.sp, color = Color.White) }
}
