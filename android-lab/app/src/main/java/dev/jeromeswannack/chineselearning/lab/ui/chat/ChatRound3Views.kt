package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dev.jeromeswannack.chineselearning.lab.core.ChatFiles
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.data.chat.ChatMediaSizing
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.RowDivider
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import java.io.File

/*
 * Chat round 2 — PR 3 (docs/CHAT.md "Round 2 — PR 3"): file and video bubbles, "↪ Forwarded",
 * the several-photos compose sheet, "Forward to…", Message info and the can't-open-it fallback.
 */

/** "↪ Forwarded" on top of a forwarded bubble. */
@Composable
fun ForwardedLabel(mine: Boolean, modifier: Modifier = Modifier) {
    val c = chatColors()
    Text(
        "↪ Forwarded", fontSize = 12.sp, fontStyle = FontStyle.Italic, fontWeight = FontWeight.Medium,
        color = if (mine) c.metaMine else c.metaTheirs, maxLines = 1,
        modifier = modifier.testTag("chat-forwarded"),
    )
}

/**
 * A document: the type's icon, the name (two lines at most), "840 KB · PDF". The bubble's tap
 * downloads and opens it; a spinner replaces the icon meanwhile, a failed download says so.
 */
@Composable
fun FileCard(name: String, bytes: Long, mine: Boolean, opening: Boolean, failed: Boolean, modifier: Modifier = Modifier) {
    val c = chatColors()
    val fg = if (mine) c.onMine else c.onTheirs
    Row(
        modifier.widthIn(min = 200.dp, max = 300.dp).semantics { contentDescription = "Open $name" }.testTag("chat-file"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(if (mine) Color.White.copy(alpha = 0.2f) else Lab.colors.ink.copy(alpha = 0.07f)),
            contentAlignment = Alignment.Center,
        ) {
            if (opening) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = fg)
            else Text(ChatFiles.fileIcon(name), fontSize = 22.sp)
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f, fill = false)) {
            Text(name, fontSize = 15.sp, lineHeight = 19.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                ChatFiles.meta(name, bytes) + if (failed) " · couldn’t download, tap to retry" else "",
                fontSize = 12.sp, color = if (mine) c.metaMine else c.metaTheirs, maxLines = 2,
            )
        }
    }
}

/**
 * A video clip sized by its shape (clamped 1:2 … 2:1): the first frame with ▶ and the length
 * until tapped, then the platform player (VideoView + MediaController) in place.
 */
@Composable
fun ChatVideo(
    key: String,
    width: Int,
    height: Int,
    durationMs: Long,
    playing: Boolean,
    loadFile: suspend () -> File?,
    loadPoster: suspend (path: String, key: String, maxSide: Int) -> ImageBitmap?,
) {
    val (w, h) = ChatMediaSizing.videoSize(width, height)
    val file by produceState<File?>(null, key) { value = runCatching { loadFile() }.getOrNull() }
    val poster by produceState<ImageBitmap?>(null, file) { value = file?.let { f -> runCatching { loadPoster(f.path, key, 720) }.getOrNull() } }
    Box(Modifier.size(w.dp, h.dp).background(Color(0xFF111114)).testTag("chat-video"), contentAlignment = Alignment.Center) {
        val f = file
        if (playing && f != null) {
            AndroidView(
                factory = { ctx ->
                    android.widget.VideoView(ctx).apply {
                        setVideoPath(f.path)
                        val controls = android.widget.MediaController(ctx)
                        controls.setAnchorView(this)
                        setMediaController(controls)
                        setOnPreparedListener { start() }
                    }
                },
                onRelease = { runCatching { it.stopPlayback() } },
                modifier = Modifier.fillMaxSize().testTag("chat-video-player"),
            )
        } else {
            poster?.let { Image(it, contentDescription = "Video", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
            Box(
                Modifier.size(52.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)).border(1.5.dp, Color.White.copy(alpha = 0.85f), CircleShape)
                    .semantics { contentDescription = if (f == null) "Loading the video" else "Play the video" },
                contentAlignment = Alignment.Center,
            ) {
                if (f == null) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                else Text("▶", color = Color.White, fontSize = 20.sp)
            }
            Text(
                "🎬 " + if (durationMs > 0) ChatRich.duration(durationMs) else "Video",
                color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.45f))
                    .padding(horizontal = 7.dp, vertical = 2.dp).testTag("chat-video-length"),
            )
        }
    }
}

/** The pictures about to go: one large, several as a grid with ✕ on each; the caption goes with the first. */
@Composable
fun PhotosComposeContent(
    photos: List<StagedPhoto>,
    online: Boolean,
    loadLocalImage: suspend (String, Int) -> ImageBitmap?,
    onRemove: (Int) -> Unit,
    onSend: (String) -> Unit,
    onCancel: () -> Unit,
) {
    var caption by rememberSaveable { mutableStateOf("") }
    Column(Modifier.padding(horizontal = 20.dp).testTag("chat-photo-sheet"), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            if (photos.size > 1) "Send ${photos.size} photos" else "Send a photo",
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, modifier = Modifier.fillMaxWidth(),
        )
        if (photos.size == 1) {
            val p = photos[0]
            val bitmap by produceState<ImageBitmap?>(null, p.path) { value = runCatching { loadLocalImage(p.path, 1080) }.getOrNull() }
            val (w, h) = ChatMediaSizing.bubbleSize(p.width, p.height, maxW = 320f, maxH = 380f)
            Box(Modifier.size(w.dp, h.dp).clip(RoundedCornerShape(16.dp)).background(Lab.colors.faint), contentAlignment = Alignment.Center) {
                bitmap?.let { Image(it, "Photo to send", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) } ?: Text("📷", fontSize = 32.sp)
            }
        } else {
            Column(Modifier.fillMaxWidth().testTag("chat-photo-grid"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                photos.withIndex().chunked(3).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { (i, p) ->
                            val bitmap by produceState<ImageBitmap?>(null, p.path) { value = runCatching { loadLocalImage(p.path, 360) }.getOrNull() }
                            Box(Modifier.weight(1f).height(112.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint).testTag("chat-photo-thumb")) {
                                bitmap?.let { Image(it, "Photo ${i + 1} of ${photos.size}", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize()) }
                                Box(
                                    Modifier.align(Alignment.TopEnd).size(44.dp).clickable(onClickLabel = "Remove photo ${i + 1}") { onRemove(i) }.testTag("chat-photo-remove"),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Box(Modifier.size(24.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.6f)), contentAlignment = Alignment.Center) {
                                        Text("✕", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                        // Keep the last row's tiles the same width as the others.
                        repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
        }
        OutlinedTextField(
            caption, { caption = it.take(2000) },
            placeholder = { Text(if (photos.size > 1) "Add a caption (goes with the first)" else "Add a caption (optional)") },
            maxLines = 3, modifier = Modifier.fillMaxWidth().testTag("chat-photo-caption"),
        )
        if (!online) Text("You're offline — they send when you're back online.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("Cancel", Modifier.weight(1f), onClick = onCancel)
            PrimaryPill(if (photos.size > 1) "Send ${photos.size}" else "Send", Modifier.weight(1f).height(52.dp).testTag("chat-photo-send")) { onSend(caption) }
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** "Forward to…": every conversation with a person, newest first, "· this chat" marked. */
@Composable
fun ForwardContent(f: ForwardUi, currentConversationId: String?, onPick: (ForwardTarget) -> Unit) {
    Column(Modifier.fillMaxWidth().testTag("chat-forward-sheet")) {
        Text(
            "Forward ${if (f.messageIds.size > 1) "${f.messageIds.size} messages" else "message"} to…",
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )
        val targets = f.targets
        when {
            targets == null && f.error == null -> Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Lab.colors.accent)
                Text("  Loading…", color = Lab.colors.muted)
            }
            targets == null -> InlineNotice(f.error!!, Modifier.padding(horizontal = 16.dp), kind = NoticeKind.Error)
            targets.isEmpty() -> Text("No other conversations yet.", color = Lab.colors.muted, modifier = Modifier.padding(20.dp))
            else -> targets.forEachIndexed { i, t ->
                if (i > 0) RowDivider()
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(onClickLabel = "Forward to ${t.label}") { onPick(t) }
                        .padding(horizontal = 20.dp, vertical = 8.dp).testTag("chat-forward-target"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    dev.jeromeswannack.chineselearning.lab.ui.connections.Avatar(t.label, null, size = 36.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(t.label, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val sub = listOfNotNull(t.sub, if (t.conversationId == currentConversationId) "this chat" else null).joinToString(" · ")
                        if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Text("↪️", fontSize = 18.sp, modifier = Modifier.alpha(0.7f))
                }
            }
        }
        if (targets != null && f.error != null) InlineNotice(f.error, Modifier.padding(16.dp), kind = NoticeKind.Offline)
        Spacer(Modifier.height(12.dp))
    }
}

/** Message info: the web's MessageInfoSheet rows. */
@Composable
fun MessageInfoContent(m: ChatMessageDto, rows: List<Pair<String, String>>) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("chat-info-sheet")) {
        Text("Message info", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Lab.colors.ink)
        val text = m.content.trim()
        if (text.isNotEmpty()) Text(
            if (text.length > 120) text.take(120) + "…" else text,
            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, maxLines = 3, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
        )
        rows.forEachIndexed { i, (k, v) ->
            if (i > 0) androidx.compose.material3.HorizontalDivider(color = Lab.colors.faint)
            Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(vertical = 8.dp).testTag("chat-info-row"), verticalAlignment = Alignment.CenterVertically) {
                Text(k, color = Lab.colors.muted, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(0.42f))
                Text(v, color = Lab.colors.ink, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.weight(0.58f))
            }
        }
        Spacer(Modifier.height(12.dp))
    }
}

/** No app opens it: Share… or save a copy. */
@Composable
fun FileFallbackContent(name: String, onShare: () -> Unit, onSave: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).testTag("chat-file-fallback"), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("No app on this phone opens “$name”.", style = MaterialTheme.typography.bodyLarge, color = Lab.colors.ink)
        Text("Share it to an app that can, or save a copy to your files.", style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SecondaryPill("Save a copy", Modifier.weight(1f), onClick = onSave)
            PrimaryPill("Share…", Modifier.weight(1f)) { onShare() }
        }
        Spacer(Modifier.height(8.dp))
    }
}
