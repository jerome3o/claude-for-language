package dev.jeromeswannack.chineselearning.lab.ui.watch

import android.graphics.BitmapFactory
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.LabApp
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.core.watch.Watch
import dev.jeromeswannack.chineselearning.lab.core.watch.Watch.Reveal
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchLineDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchListDto
import dev.jeromeswannack.chineselearning.lab.data.api.WatchVideoDto
import dev.jeromeswannack.chineselearning.lab.data.platform.Loadable
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreen
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.SectionHeader
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/*
 * 📺 Watch (追剧, docs/WATCH.md) — the screens, stateless (ViewModels in WatchNav.kt):
 *  - /watch: paste a YouTube link, "Find on YouTube" for his shows, My videos.
 *  - /watch/:id: YouTube's player (nothing drawn over it) with, below it (folded) or beside it
 *    (unfolded / landscape), the line being said as word chips, ⏮ 🔁 ⏭, the speed chip, 拼 / EN,
 *    "Pause after each line", "Listen first", and the transcript.
 */

// ================================================================ /watch

data class WatchListUi(
    val list: Loadable<WatchListDto> = Loadable(loading = true),
    val link: String = "",
    val linkError: String? = null,
    /** A message on arrival (a share that wasn't a YouTube link). */
    val notice: String? = null,
    val online: Boolean = true,
    val busy: Set<String> = emptySet(),
)

class WatchListActions(
    val onBack: (() -> Unit)? = null,
    val onLink: (String) -> Unit = {},
    val onOpenLink: () -> Unit = {},
    val onOpen: (String) -> Unit = {},
    val onShow: (Watch.Show) -> Unit = {},
    val onRetry: (String) -> Unit = {},
    val onRemove: (String) -> Unit = {},
    val onRefresh: () -> Unit = {},
    val onDismissNotice: () -> Unit = {},
)

object WatchTags {
    const val LINK = "watch-link"
    const val OPEN = "watch-open"
    const val TRANSCRIPT = "watch-transcript"
    const val CARD = "watch-card"
    const val VIDEO = "watch-video"
    fun video(id: String) = "watch-video-$id"
    fun line(i: Int) = "watch-line-$i"
}

@Composable
fun WatchListScreen(ui: WatchListUi, actions: WatchListActions, thumbnails: Map<String, ImageBitmap>? = null) {
    LabScreen(title = "📺 Watch", subtitle = "追剧 · Chinese TV with a transcript you can tap", onBack = actions.onBack) {
        ui.notice?.let { item(key = "notice") { InlineNotice(it, kind = NoticeKind.Warning, actionLabel = "OK", onAction = actions.onDismissNotice) } }
        item(key = "paste") { PasteCard(ui, actions) }
        val videos = ui.list.data?.videos.orEmpty()
        item(key = "mine-h") { SectionHeader("My videos") }
        when {
            videos.isNotEmpty() -> items(videos, key = { it.id }) { v ->
                VideoRow(v, busy = v.id in ui.busy, online = ui.online, actions = actions, preview = thumbnails?.get(v.id))
            }
            ui.list.loading && !ui.list.hasData -> item(key = "loading") { LoadingState(text = "Loading your videos…") }
            else -> item(key = "empty") {
                Text(
                    "Nothing yet. Paste a link above, or Share a video from the YouTube app → “Watch (Lab)”.",
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
                )
            }
        }
        if (ui.list.error != null && !ui.list.offline) item(key = "err") { InlineNotice(ui.list.error, kind = NoticeKind.Error, actionLabel = "Retry", onAction = actions.onRefresh) }
        if (ui.list.offline || !ui.online) item(key = "off") { InlineNotice("Offline — your videos' transcripts are readable; the videos need a connection.", kind = NoticeKind.Offline) }
        item(key = "shows-h") { SectionHeader("Find on YouTube") }
        items(Watch.SHOWS, key = { "show-${it.title}" }) { s -> ShowRow(s) { actions.onShow(s) } }
        item(key = "note") {
            Text(
                "Videos play in YouTube's own player. The transcript is made once per video (a few minutes for an episode) and is shared — someone else's video opens with its transcript at once.",
                style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
private fun PasteCard(ui: WatchListUi, actions: WatchListActions) {
    LabCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Paste a YouTube link", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
            OutlinedTextField(
                value = ui.link,
                onValueChange = actions.onLink,
                modifier = Modifier.fillMaxWidth().testTag(WatchTags.LINK),
                placeholder = { Text("youtube.com/watch?v=… or youtu.be/…") },
                singleLine = true,
                isError = ui.linkError != null,
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { actions.onOpenLink() }),
            )
            ui.linkError?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Palette.Again) }
            PrimaryPill("▶ Watch", Modifier.fillMaxWidth().height(48.dp).testTag(WatchTags.OPEN), enabled = ui.link.isNotBlank(), onClick = actions.onOpenLink)
        }
    }
}

@Composable
private fun ShowRow(s: Watch.Show, onClick: () -> Unit) {
    LabCard(Modifier.bouncyClickable(pressedScale = 0.98f, onClick = onClick)) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${s.title} · ${s.english} (${s.year})", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                Text(s.note, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            }
            Text("↗", color = Lab.colors.accent, fontSize = 20.sp, modifier = Modifier.padding(start = 8.dp))
        }
    }
}

@Composable
private fun VideoRow(v: WatchVideoDto, busy: Boolean, online: Boolean, actions: WatchListActions, preview: ImageBitmap?) {
    var menu by remember { mutableStateOf(false) }
    LabCard(Modifier.testTag(WatchTags.video(v.id)).bouncyClickable(pressedScale = 0.98f) { actions.onOpen(v.id) }) {
        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(128.dp)) {
                Thumbnail(v.id, Modifier.fillMaxWidth(), preview)
                v.duration_ms?.let {
                    Text(
                        Watch.clock(it), color = Color.White, fontSize = 11.sp,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(4.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xCC000000)).padding(horizontal = 4.dp, vertical = 1.dp),
                    )
                }
            }
            Column(Modifier.weight(1f).padding(start = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(v.title.ifBlank { "YouTube video" }, style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                v.channel?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                val frac = Watch.watchedFraction(v.position_ms, v.duration_ms)
                if (frac > 0) {
                    LinearProgressIndicator(
                        progress = { frac.toFloat() },
                        modifier = Modifier.fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)),
                        color = Palette.Again, trackColor = Lab.colors.faint,
                    )
                }
                Text(
                    v.statusLine, style = MaterialTheme.typography.labelSmall, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    color = when (v.status) { "failed" -> Palette.Again; "ready" -> Lab.colors.muted; else -> Lab.colors.accent },
                )
                if (v.status == "failed") {
                    SecondaryPill(if (busy) "Retrying…" else "↻ Retry", Modifier.height(40.dp), enabled = online && !busy, horizontalPadding = 14.dp, fontSize = 14.sp) { actions.onRetry(v.id) }
                }
            }
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(44.dp)) { Icon(Icons.Filled.MoreVert, "More", tint = Lab.colors.muted) }
                DropdownMenu(menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Remove from My videos") }, enabled = online, onClick = { menu = false; actions.onRemove(v.id) })
                }
            }
        }
    }
}

/** YouTube's public thumbnail (the only picture of a video we show), kept in the cache for offline. */
@Composable
fun Thumbnail(videoId: String, modifier: Modifier = Modifier, preview: ImageBitmap? = null) {
    val app = LocalContext.current.applicationContext as? LabApp
    val loaded by produceState<ImageBitmap?>(null, videoId, preview) {
        if (preview != null || app == null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(app.cacheDir, "watch-thumbs").apply { mkdirs() }
                val file = File(dir, "${videoId.replace(Regex("[^A-Za-z0-9_-]"), "_")}.jpg")
                if (!file.exists() || file.length() == 0L) app.repo.api.download(Watch.youtubeThumbnailUrl(videoId), file)
                BitmapFactory.decodeFile(file.absolutePath)?.asImageBitmap()
            }.getOrNull()
        }
    }
    val bitmap = preview ?: loaded
    Box(modifier.aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp)).background(Color(0xFF1F2937)), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Text("▶", color = Color.White.copy(alpha = 0.7f), fontSize = 20.sp)
    }
}

// ================================================================ /watch/:id

data class WatchPlayerUi(
    val id: String,
    val video: WatchVideoDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val online: Boolean = true,
    /** Where the player starts (null until known — the cached / fetched position). */
    val startMs: Long? = null,
    val ready: Boolean = false,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val playerTitle: String = "",
    val playerError: String? = null,
    /** The line jumped to or paused after (lines.ts `focus`). */
    val focus: Int? = null,
    val pinyin: Boolean = true,
    val english: Boolean = true,
    val pauseEachLine: Boolean = false,
    val listenFirst: Boolean = false,
    val speed: Double = 1.0,
    /** How much of the line card shows in listen-first mode (resets on each new line). */
    val reveal: Reveal = Reveal.LISTEN,
    val revealFor: Int = -1,
    val known: Set<String> = emptySet(),
    val retrying: Boolean = false,
) {
    val lines: List<WatchLineDto> get() = video?.lines.orEmpty()
    val spans: List<Watch.Span> get() = lines.map { Watch.Span(it.start_ms, it.end_ms) }
    val active: Int get() = Watch.activeLineIndex(spans, positionMs, focus, playing)
    /** The reveal of the line on screen (a line not tapped yet starts covered). */
    val cardReveal: Reveal get() = if (!listenFirst) Reveal.ENGLISH else if (revealFor == active) reveal else Reveal.LISTEN
    val title: String get() = video?.title?.takeIf { it.isNotBlank() } ?: playerTitle.ifBlank { "Watch" }
}

class WatchPlayerActions(
    val onBack: () -> Unit = {},
    val onPrev: () -> Unit = {},
    val onReplay: () -> Unit = {},
    val onNext: () -> Unit = {},
    val onToggle: () -> Unit = {},
    val onTapLine: (Int) -> Unit = {},
    val onSpeed: () -> Unit = {},
    val onPinyin: () -> Unit = {},
    val onEnglish: () -> Unit = {},
    val onPauseMode: () -> Unit = {},
    val onListenFirst: () -> Unit = {},
    val onReveal: () -> Unit = {},
    val onWord: (ReaderWordDto, String) -> Unit = { _, _ -> },
    val onRetry: () -> Unit = {},
    val onReload: () -> Unit = {},
    val onOpenOnYouTube: () -> Unit = {},
    val onRemove: () -> Unit = {},
)

/**
 * The player screen. [video] draws YouTube's player in the box it's given (a stand-in box in
 * screenshot tests — no YouTube frame is ever in the repo).
 */
@Composable
fun WatchPlayerScreen(
    ui: WatchPlayerUi,
    actions: WatchPlayerActions,
    listState: LazyListState = rememberLazyListState(),
    video: @Composable (Modifier) -> Unit = { m -> VideoStandIn(m) },
) {
    LabScreenFrame {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 640.dp || maxWidth > maxHeight
            Column(Modifier.fillMaxSize()) {
                var menu by remember { mutableStateOf(false) }
                ScreenTitle(ui.title, subtitle = ui.video?.channel, onBack = actions.onBack) {
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More", tint = Lab.colors.ink) }
                        DropdownMenu(menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Open on YouTube ↗") }, onClick = { menu = false; actions.onOpenOnYouTube() })
                            if (ui.video != null) DropdownMenuItem(text = { Text("Remove from My videos") }, enabled = ui.online, onClick = { menu = false; actions.onRemove() })
                        }
                    }
                }
                if (wide) {
                    Row(Modifier.fillMaxSize()) {
                        Column(Modifier.weight(0.58f).fillMaxHeight().verticalScroll(rememberScrollState()).padding(start = 12.dp, end = 6.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            VideoArea(ui, actions, video)
                            Controls(ui, actions)
                        }
                        Column(Modifier.weight(0.42f).fillMaxHeight().padding(start = 6.dp, end = 12.dp)) {
                            Transcript(ui, actions, listState, Modifier.fillMaxSize(), header = false)
                        }
                    }
                } else {
                    Column(Modifier.fillMaxSize()) {
                        VideoArea(ui, actions, video, Modifier.padding(horizontal = 0.dp))
                        Transcript(ui, actions, listState, Modifier.fillMaxSize(), header = true)
                    }
                }
            }
        }
    }
    // Keep the line on screen in view (the list's first item is the header on a phone).
    val active = ui.active
    LaunchedEffect(active, ui.lines.size) {
        if (active < 0) return@LaunchedEffect
        val target = itemIndexOfLine(ui, active) ?: return@LaunchedEffect
        val info = listState.layoutInfo
        val shown = info.visibleItemsInfo.any { it.index == target && it.offset >= 0 && it.offset + it.size <= info.viewportEndOffset }
        if (!shown) runCatching { listState.animateScrollToItem(target, -160) }
    }
}

/** The video's box: 16:9, ≥ 200 dp tall, nothing on top of it. Offline → says it needs a connection. */
@Composable
private fun VideoArea(ui: WatchPlayerUi, actions: WatchPlayerActions, video: @Composable (Modifier) -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val box = Modifier.fillMaxWidth().aspectRatio(16f / 9f).heightIn(min = 200.dp).background(Color.Black).testTag(WatchTags.VIDEO)
        when {
            !ui.online -> Box(box, contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    Text("📴", fontSize = 32.sp)
                    Text("The video needs a connection", color = Color.White, style = MaterialTheme.typography.titleSmall, textAlign = TextAlign.Center)
                    Text("The transcript below is on this phone.", color = Color.White.copy(alpha = 0.7f), style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
                }
            }
            ui.startMs == null -> Box(box)
            else -> video(box)
        }
        ui.playerError?.let {
            InlineNotice(it, Modifier.padding(horizontal = 12.dp), kind = NoticeKind.Error, actionLabel = "Open on YouTube", onAction = actions.onOpenOnYouTube)
        }
    }
}

/** A drawn stand-in for the player (screenshots / previews): a colour field with a clock. */
@Composable
fun VideoStandIn(modifier: Modifier, clock: String = "") {
    Box(modifier.background(Color(0xFF334155)), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("▶ YouTube player", color = Color.White.copy(alpha = 0.85f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            if (clock.isNotEmpty()) Text(clock, color = Color.White.copy(alpha = 0.6f), fontSize = 13.sp)
        }
    }
}

@Composable
private fun Controls(ui: WatchPlayerUi, actions: WatchPlayerActions) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        StatusNotices(ui, actions)
        LineCard(ui, actions)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
            val has = ui.lines.isNotEmpty()
            BarButton(Icons.Filled.SkipPrevious, "Previous line", has, actions.onPrev)
            BarButton(Icons.Filled.Replay, "Replay this line", has && ui.active >= 0, actions.onReplay)
            Box(
                Modifier.size(56.dp).clip(CircleShape).background(if (ui.ready && ui.online) Lab.colors.accent else Lab.colors.faint)
                    .bouncyClickable(enabled = ui.ready && ui.online, pressedScale = 0.9f, onClick = actions.onToggle)
                    .semantics { contentDescription = if (ui.playing) "Pause" else "Play" },
                contentAlignment = Alignment.Center,
            ) { Icon(if (ui.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(30.dp)) }
            BarButton(Icons.Filled.SkipNext, "Next line", has, actions.onNext)
            Chip(Watch.speedLabel(ui.speed), ui.speed != 1.0, Modifier.width(64.dp), actions.onSpeed)
        }
        Toggles(ui, actions)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Toggles(ui: WatchPlayerUi, actions: WatchPlayerActions) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Chip("拼", ui.pinyin, Modifier.width(52.dp), actions.onPinyin)
        Chip("EN", ui.english, Modifier.width(52.dp), actions.onEnglish)
        Chip("⏸ Pause after each line", ui.pauseEachLine, Modifier, actions.onPauseMode)
        Chip("👂 Listen first", ui.listenFirst, Modifier, actions.onListenFirst)
    }
}

@Composable
private fun StatusNotices(ui: WatchPlayerUi, actions: WatchPlayerActions) {
    val v = ui.video
    if (v == null) {
        if (ui.error != null) InlineNotice(ui.error, kind = if (ui.online) NoticeKind.Error else NoticeKind.Offline, actionLabel = if (ui.online) "Retry" else null, onAction = actions.onReload)
        else if (ui.loading) InlineNotice("Opening the transcript…", kind = NoticeKind.Info)
        else if (ui.online) InlineNotice("Getting the video ready… the transcript starts once it has loaded.", kind = NoticeKind.Info)
        return
    }
    when {
        v.status == "failed" -> InlineNotice(v.statusLine, kind = NoticeKind.Error, actionLabel = if (ui.online && !ui.retrying) "Retry" else null, onAction = actions.onRetry)
        v.working -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(v.statusLine, style = MaterialTheme.typography.bodyMedium, color = Lab.colors.accent, fontWeight = FontWeight.SemiBold)
            LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)), color = Lab.colors.accent, trackColor = Lab.colors.faint)
            Text("Watch meanwhile — lines appear as each part is done.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

/** The line on screen: word chips (→ the language explorer), pinyin, English; covered in listen-first mode. */
@Composable
private fun LineCard(ui: WatchPlayerUi, actions: WatchPlayerActions) {
    val i = ui.active
    val line = ui.lines.getOrNull(i)
    val reveal = ui.cardReveal
    LabCard(Modifier.testTag(WatchTags.CARD)) {
        Column(
            Modifier.fillMaxWidth().heightIn(min = 120.dp)
                .then(if (line != null && ui.listenFirst) Modifier.clickable(onClick = actions.onReveal) else Modifier)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (line == null) {
                Text(
                    when {
                        ui.lines.isEmpty() && ui.video?.working == true -> "The lines appear here as the transcript is made."
                        ui.lines.isEmpty() -> "No transcript lines yet."
                        else -> "The first line is at ${Watch.clock(ui.lines.first().start_ms)} — ⏭ jumps there."
                    },
                    style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                )
                return@Column
            }
            Text(
                listOfNotNull("Line ${i + 1} of ${ui.lines.size}", Watch.clock(line.start_ms), line.speaker).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium, color = Lab.colors.muted,
            )
            if (reveal == Reveal.LISTEN) {
                CoveredBars(line.zh.length)
                Text("👂 Listen — tap to see the Chinese", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                return@Column
            }
            val showPinyin = if (ui.listenFirst) reveal == Reveal.PINYIN || reveal == Reveal.ENGLISH else ui.pinyin
            val showEnglish = if (ui.listenFirst) reveal == Reveal.ENGLISH else ui.english
            LineChinese(line, showPinyin, ui.known, 22, actions.onWord)
            if (showEnglish) {
                HorizontalDivider(color = Lab.colors.faint)
                Text(line.english ?: "Translation coming…", style = MaterialTheme.typography.bodyLarge, color = if (line.english == null) Lab.colors.muted else Lab.colors.ink)
            }
            if (ui.listenFirst && reveal != Reveal.ENGLISH) Text("Tap for more", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
        }
    }
}

@Composable
private fun LineChinese(line: WatchLineDto, showPinyin: Boolean, known: Set<String>, size: Int, onWord: (ReaderWordDto, String) -> Unit) {
    val words = remember(line.zh) { DeviceWords.of(line.zh) }
    ChineseWords(
        text = line.zh,
        words = words,
        isMe = false,
        color = Lab.colors.ink,
        showPinyin = showPinyin,
        known = known,
        onChip = { k ->
            val ws = words ?: return@ChineseWords
            val offsets = ReaderWords.offsets(ws.map { it.text })
            onWord(ws[k], ReaderWords.sentenceAround(line.zh, offsets[k], offsets[k] + ws[k].text.length))
        },
        fontSize = size.sp,
        plain = {
            Column {
                Text(line.zh, color = Lab.colors.ink, fontSize = size.sp, lineHeight = (size * 1.4).sp)
                if (showPinyin && line.pinyin != null) Text(line.pinyin, color = Lab.colors.accent, fontSize = 14.sp)
            }
        },
    )
}

/** A covered line: soft bars about as long as its text (listen first, read later). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoveredBars(chars: Int) {
    val bars = remember(chars) {
        val widths = mutableListOf<Int>()
        var left = chars.coerceIn(3, 40)
        var k = 0
        while (left > 0) {
            val w = minOf(left, listOf(2, 4, 3, 5, 2, 3)[k % 6])
            widths += w; left -= w; k++
        }
        widths
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (w in bars) Box(Modifier.width((w * 18).dp).height(18.dp).clip(RoundedCornerShape(9.dp)).background(Lab.colors.faint))
    }
}

private sealed interface Row_ {
    data class Line(val i: Int, val line: WatchLineDto) : Row_
    data class Gap(val startMs: Long, val endMs: Long) : Row_
}

private fun rows(ui: WatchPlayerUi): List<Row_> {
    val out = ui.lines.mapIndexed { i, l -> Row_.Line(i, l) as Row_ } + ui.video?.gaps.orEmpty().map { Row_.Gap(it.start_ms, it.end_ms) }
    return out.sortedBy { when (it) { is Row_.Line -> it.line.start_ms; is Row_.Gap -> it.startMs } }
}

/** The list index of line [i] (header + gaps before it). */
private fun itemIndexOfLine(ui: WatchPlayerUi, i: Int): Int? {
    val k = rows(ui).indexOfFirst { it is Row_.Line && it.i == i }
    return if (k < 0) null else k + 1
}

@Composable
private fun Transcript(ui: WatchPlayerUi, actions: WatchPlayerActions, listState: LazyListState, modifier: Modifier, header: Boolean) {
    val active = ui.active
    val items = remember(ui.video) { rows(ui) }
    LazyColumn(
        modifier.testTag(WatchTags.TRANSCRIPT),
        state = listState,
        contentPadding = PaddingValues(start = if (header) 12.dp else 0.dp, end = if (header) 12.dp else 0.dp, top = 10.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        // The header item (controls on a phone) keeps line indexes stable: one item before the lines either way.
        item(key = "head") { if (header) Controls(ui, actions) else Spacer(Modifier.height(1.dp)) }
        items(items, key = { when (it) { is Row_.Line -> "l${it.i}"; is Row_.Gap -> "g${it.startMs}" } }) { r ->
            when (r) {
                is Row_.Gap -> Text(
                    "No transcript for ${Watch.clock(r.startMs)}–${Watch.clock(r.endMs)}",
                    style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Lab.colors.faint.copy(alpha = 0.5f)).padding(12.dp),
                )
                is Row_.Line -> LineRow(r.i, r.line, ui, current = r.i == active, covered = ui.listenFirst && active >= 0 && r.i >= active || ui.listenFirst && active < 0, onTap = { actions.onTapLine(r.i) })
            }
        }
        if (ui.lines.isEmpty() && ui.video?.gaps.isNullOrEmpty()) item(key = "none") {
            Text(
                if (ui.video?.working == true || ui.video == null) "The transcript shows up here, part by part." else "No transcript.",
                style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted, modifier = Modifier.padding(12.dp),
            )
        }
    }
}

@Composable
private fun LineRow(i: Int, line: WatchLineDto, ui: WatchPlayerUi, current: Boolean, covered: Boolean, onTap: () -> Unit) {
    val border by animateColorAsState(if (current) Lab.colors.accent else Color.Transparent, label = "watchLine")
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp))
            .background(if (current) Lab.colors.accentSoft else Lab.colors.card)
            .border(2.dp, border, RoundedCornerShape(14.dp))
            .clickable(onClick = onTap)
            .heightIn(min = 48.dp)
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .testTag(WatchTags.line(i)),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(Watch.clock(line.start_ms), style = MaterialTheme.typography.labelSmall, color = if (current) Lab.colors.accent else Lab.colors.muted, modifier = Modifier.width(44.dp).padding(top = 4.dp))
            Column(Modifier.weight(1f)) {
                if (covered) {
                    Box(Modifier.padding(vertical = 4.dp).width((line.zh.length.coerceIn(3, 16) * 16).dp).height(16.dp).clip(RoundedCornerShape(8.dp)).background(Lab.colors.faint))
                } else {
                    Text(line.zh, color = Lab.colors.ink, fontSize = 18.sp, lineHeight = 26.sp)
                    if (ui.pinyin && line.pinyin != null) Text(line.pinyin, color = Lab.colors.accent, fontSize = 13.sp)
                    if (ui.english && line.english != null) Text(line.english, color = Lab.colors.muted, fontSize = 14.sp)
                }
            }
        }
    }
}

@Composable
private fun BarButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp)) {
        Icon(icon, label, tint = if (enabled) Lab.colors.ink else Lab.colors.faint, modifier = Modifier.size(28.dp))
    }
}

@Composable
private fun Chip(label: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(if (on) Lab.colors.accent else Lab.colors.faint)
            .bouncyClickable(pressedScale = 0.96f, onClick = onClick).padding(horizontal = 12.dp)
            .semantics { contentDescription = "$label ${if (on) "on" else "off"}" },
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}
