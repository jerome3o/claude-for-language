package dev.jeromeswannack.chineselearning.lab.ui.podcasts

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts
import dev.jeromeswannack.chineselearning.lab.core.podcasts.Podcasts.Reveal
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastEpisodeDto
import dev.jeromeswannack.chineselearning.lab.data.api.PodcastSegmentDto
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.coach.CoachNewWordsSheet
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsActions
import dev.jeromeswannack.chineselearning.lab.ui.coach.NewWordsSheetUi
import dev.jeromeswannack.chineselearning.lab.ui.kit.InlineNotice
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabCard
import dev.jeromeswannack.chineselearning.lab.ui.kit.LabScreenFrame
import dev.jeromeswannack.chineselearning.lab.ui.kit.LoadingState
import dev.jeromeswannack.chineselearning.lab.ui.kit.NoticeKind
import dev.jeromeswannack.chineselearning.lab.ui.kit.PrimaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.ScreenTitle
import dev.jeromeswannack.chineselearning.lab.ui.kit.SecondaryPill
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/*
 * The episode player (docs/PODCASTS.md, Lab app only for now): the transcript as segments of
 * ≈ 3–15 s. Listen first — ▶ plays just that segment and stops so you can think; each tap on a
 * segment uncovers one more line (the Chinese as word chips → the language explorer with its
 * + Add as card / ⚡ Study it today, then pinyin, then the English); "Keep playing" listens on
 * without stopping, following the transcript. ➕ Words adds the segment's new words as cards
 * (the Coach's picker); ⋯ makes a mini lesson from the stretch on screen.
 */

sealed interface EpisodeAudio {
    /** Not on the phone; [bytes] = its size when known. */
    data class Missing(val bytes: Long?) : EpisodeAudio
    data class Downloading(val fraction: Double) : EpisodeAudio
    data class Saved(val bytes: Long) : EpisodeAudio
    data class Failed(val message: String) : EpisodeAudio
}

data class EpisodeUi(
    val id: String,
    val episode: PodcastEpisodeDto? = null,
    val loading: Boolean = true,
    val error: String? = null,
    val online: Boolean = true,
    val audio: EpisodeAudio = EpisodeAudio.Missing(null),
    val current: Int = 0,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val slow: Boolean = false,
    /** Keep playing: no stop after each segment, the transcript follows the audio. */
    val auto: Boolean = false,
    /** What a segment shows before it is tapped (the "👁" chip). */
    val mode: Reveal = Reveal.LISTEN,
    /** Segments tapped open (or covered) on this visit. */
    val reveals: Map<Int, Reveal> = emptyMap(),
    /** Hanzi already in a deck (quieter chips). */
    val known: Set<String> = emptySet(),
    val lessonBusy: Boolean = false,
    val notice: String? = null,
    val newWords: NewWordsSheetUi? = null,
    /** Words of the current segment that are in none of his decks (➕ Words (N)). */
    val newWordCount: Int = 0,
) {
    val segments: List<PodcastSegmentDto> get() = episode?.segments.orEmpty()
    val speakers: Int get() = segments.mapNotNull { it.speaker }.toSet().size
    fun reveal(i: Int): Reveal = reveals[i] ?: mode
    val durationMs: Long get() = episode?.duration_ms ?: segments.lastOrNull()?.end_ms ?: 0
    val canPlay: Boolean get() = audio is EpisodeAudio.Saved
}

class EpisodeActions(
    val onBack: () -> Unit = {},
    val onPlay: (Int) -> Unit = {},
    val onToggle: () -> Unit = {},
    val onReplay: () -> Unit = {},
    val onPrev: () -> Unit = {},
    val onNext: () -> Unit = {},
    val onSeek: (Float) -> Unit = {},
    val onSlow: () -> Unit = {},
    val onAuto: () -> Unit = {},
    val onMode: () -> Unit = {},
    val onReveal: (Int) -> Unit = {},
    val onWord: (ReaderWordDto, String) -> Unit = { _, _ -> },
    val onWords: () -> Unit = {},
    val onDownload: () -> Unit = {},
    val onDeleteAudio: () -> Unit = {},
    val onForget: () -> Unit = {},
    val onRetry: () -> Unit = {},
    val onReload: () -> Unit = {},
    val onMakeLesson: () -> Unit = {},
    val onOpenLessons: () -> Unit = {},
    val newWords: NewWordsActions = NewWordsActions(),
)

object EpisodeTags {
    const val LIST = "podcast-segments"
    const val PLAY = "podcast-play"
    const val WORDS = "podcast-words"
    const val DOWNLOAD = "podcast-download"
    const val MENU = "podcast-menu"
    fun segment(i: Int) = "podcast-segment-$i"
    fun segmentPlay(i: Int) = "podcast-segment-play-$i"
}

@Composable
fun EpisodeScreen(ui: EpisodeUi, actions: EpisodeActions, listState: LazyListState = rememberLazyListState()) {
    val ep = ui.episode
    LabScreenFrame {
        Column(Modifier.fillMaxSize()) {
            var menu by remember { mutableStateOf(false) }
            ScreenTitle(ep?.title ?: "Episode", subtitle = ep?.podcast_title, onBack = actions.onBack) {
                if (ep != null) Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.testTag(EpisodeTags.MENU)) { Icon(Icons.Filled.MoreVert, "More", tint = Lab.colors.ink) }
                    DropdownMenu(menu, onDismissRequest = { menu = false }) {
                        if (ep.status == "ready") {
                            val from = ui.segments.getOrNull(Podcasts.lessonFrom(ui.current, ui.segments.size))?.start_ms
                            DropdownMenuItem(text = { Text("🎓 Make a mini lesson ${Podcasts.lessonFromLabel(from)}") }, enabled = ui.online && !ui.lessonBusy, onClick = { menu = false; actions.onMakeLesson() })
                        }
                        if (ui.audio is EpisodeAudio.Saved) {
                            DropdownMenuItem(text = { Text("🗑 Delete the audio from this phone (${Podcasts.size(ui.audio.bytes) ?: "0 MB"})") }, onClick = { menu = false; actions.onDeleteAudio() })
                        }
                        DropdownMenuItem(text = { Text("Remove from My episodes") }, onClick = { menu = false; actions.onForget() })
                    }
                }
            }
            Box(Modifier.weight(1f)) { Body(ui, actions, listState) }
            if (ep != null && Podcasts.isListenable(ep.status) && ui.segments.isNotEmpty()) PlayerBar(ui, actions)
        }
    }
    ui.newWords?.let { CoachNewWordsSheet(it, actions.newWords) }
    // Keep the playing / chosen segment in view.
    LaunchedEffect(ui.current, ui.segments.size) {
        if (ui.segments.isEmpty()) return@LaunchedEffect
        val target = ui.current + HEADER_ITEMS
        val visible = listState.layoutInfo.visibleItemsInfo
        val shown = visible.any { it.index == target && it.offset >= 0 && it.offset + it.size <= listState.layoutInfo.viewportEndOffset }
        if (!shown) runCatching { listState.animateScrollToItem(target, -120) }
    }
}

/** Items before the first segment in the list (the status / download / lesson cards). */
private const val HEADER_ITEMS = 1

@Composable
private fun Body(ui: EpisodeUi, actions: EpisodeActions, listState: LazyListState) {
    val ep = ui.episode
    if (ep == null) {
        if (ui.loading) LoadingState(text = "Opening the episode…")
        else Column(Modifier.padding(20.dp)) { InlineNotice(ui.error ?: "Couldn't open this episode.", kind = if (ui.online) NoticeKind.Error else NoticeKind.Offline, actionLabel = "Retry", onAction = actions.onReload) }
        return
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag(EpisodeTags.LIST),
        state = listState,
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        item(key = "head") { Header(ui, ep, actions) }
        itemsIndexed(ui.segments, key = { _, s -> "s${s.i}" }) { i, s ->
            SegmentCard(i, s, ui, actions)
        }
    }
}

@Composable
private fun Header(ui: EpisodeUi, ep: PodcastEpisodeDto, actions: EpisodeActions) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ui.notice?.let { InlineNotice(it, kind = NoticeKind.Info) }
        ui.error?.let { InlineNotice(it, kind = NoticeKind.Error) }
        if (!Podcasts.isListenable(ep.status)) {
            LabCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(if (ep.status == "failed") "😕" else "🎧", fontSize = 36.sp)
                    Text(Podcasts.statusLine(ep.status, ep.progress, ep.progress_done, ep.progress_total, ep.error), style = MaterialTheme.typography.titleMedium, color = Lab.colors.ink)
                    if (Podcasts.isWorking(ep.status)) {
                        Text(
                            "The episode is downloaded, transcribed and translated on the server — usually a few minutes. You can leave this screen; it carries on.",
                            style = MaterialTheme.typography.bodyMedium, color = Lab.colors.muted,
                        )
                        LinearProgressIndicator(Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp)), color = Lab.colors.accent, trackColor = Lab.colors.faint)
                    }
                    if (ep.status == "failed") PrimaryPill("↻ Try again", Modifier.height(48.dp), enabled = ui.online, onClick = actions.onRetry)
                }
            }
            return
        }
        if (ep.status == "translating") {
            InlineNotice(Podcasts.statusLine(ep.status, ep.progress, ep.progress_done, ep.progress_total, null), kind = NoticeKind.Info)
        }
        when (val a = ui.audio) {
            is EpisodeAudio.Missing -> LabCard {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Save the audio on this phone", style = MaterialTheme.typography.titleSmall, color = Lab.colors.ink)
                        Text(
                            listOfNotNull(Podcasts.size(a.bytes ?: ep.audio_bytes), "then it plays offline").joinToString(" · "),
                            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted,
                        )
                    }
                    PrimaryPill("⬇ Download", Modifier.height(44.dp).testTag(EpisodeTags.DOWNLOAD), enabled = ui.online, onClick = actions.onDownload)
                }
            }
            is EpisodeAudio.Downloading -> LabCard {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Downloading the audio… ${(a.fraction * 100).toInt()}%" + (Podcasts.size(ep.audio_bytes)?.let { " of $it" } ?: ""),
                        style = MaterialTheme.typography.bodyMedium, color = Lab.colors.ink,
                    )
                    LinearProgressIndicator(progress = { a.fraction.toFloat() }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)), color = Lab.colors.accent, trackColor = Lab.colors.faint)
                    Text("You can read and reveal the transcript meanwhile.", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
                }
            }
            is EpisodeAudio.Failed -> InlineNotice(a.message, kind = NoticeKind.Error, actionLabel = if (ui.online) "Retry" else null, onAction = actions.onDownload)
            is EpisodeAudio.Saved -> Unit
        }
        ep.lesson?.let { l ->
            when (l.status) {
                "generating" -> InlineNotice("Writing a mini lesson from this episode… it will be in Mini Lessons.", kind = NoticeKind.Info)
                "ready" -> InlineNotice("✓ Your mini lesson is ready.", kind = NoticeKind.Success, actionLabel = "Mini Lessons", onAction = actions.onOpenLessons)
                "failed" -> InlineNotice("The mini lesson couldn't be written: ${l.error ?: "unknown error"}", kind = NoticeKind.Error, actionLabel = if (ui.online) "Try again" else null, onAction = actions.onMakeLesson)
            }
        }
        Text(
            when (ui.mode) {
                Reveal.LISTEN -> "Listen first: ▶ plays one segment. Tap a segment to see the Chinese, again for pinyin, again for the English."
                else -> "Tap a segment to show more (or cover it again). Tap a word to look it up or add it as a card."
            },
            style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted, modifier = Modifier.padding(horizontal = 4.dp),
        )
    }
}

@Composable
private fun SegmentCard(i: Int, s: PodcastSegmentDto, ui: EpisodeUi, actions: EpisodeActions) {
    val current = i == ui.current
    val playingThis = current && ui.playing
    val reveal = ui.reveal(i)
    val border by animateColorAsState(if (current) Lab.colors.accent else Color.Transparent, label = "segBorder")
    val scale by animateFloatAsState(if (current) 1f else 0.985f, spring(dampingRatio = 0.6f), label = "segScale")
    Column(
        Modifier.fillMaxWidth().scale(scale).clip(RoundedCornerShape(18.dp)).background(Lab.colors.card)
            .border(2.dp, border, RoundedCornerShape(18.dp))
            .testTag(EpisodeTags.segment(i)),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 14.dp, end = 6.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                listOfNotNull("${i + 1}", Podcasts.clock(s.start_ms), Podcasts.speakerLabel(s.speaker, ui.speakers)).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium, color = if (current) Lab.colors.accent else Lab.colors.muted, modifier = Modifier.weight(1f),
            )
            Box(
                Modifier.size(44.dp).clip(CircleShape).background(if (playingThis) Lab.colors.accent else Lab.colors.accentSoft)
                    .bouncyClickable(enabled = ui.canPlay, pressedScale = 0.9f) { actions.onPlay(i) }
                    .semantics { contentDescription = if (playingThis) "Pause" else "Play segment ${i + 1}" }
                    .testTag(EpisodeTags.segmentPlay(i)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (playingThis) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, tint = if (playingThis) Color.White else Lab.colors.accent)
            }
        }
        Column(
            Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable { actions.onReveal(i) }.padding(start = 14.dp, end = 14.dp, bottom = 14.dp, top = 2.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (reveal == Reveal.LISTEN) {
                CoveredLines(s.text.length)
                Text("Tap to see the Chinese", style = MaterialTheme.typography.bodySmall, color = Lab.colors.muted)
            } else {
                SegmentChinese(s, showPinyin = reveal == Reveal.PINYIN || reveal == Reveal.ENGLISH, known = ui.known, onWord = actions.onWord)
                AnimatedVisibility(reveal == Reveal.ENGLISH, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                    Column {
                        HorizontalDivider(color = Lab.colors.faint, modifier = Modifier.padding(vertical = 4.dp))
                        Text(
                            s.english ?: "Translation coming…",
                            style = MaterialTheme.typography.bodyMedium, color = if (s.english == null) Lab.colors.muted else Lab.colors.ink,
                        )
                    }
                }
            }
        }
        if (current) {
            Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 10.dp, bottom = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SecondaryPill("↻ Again", Modifier.height(44.dp), enabled = ui.canPlay, horizontalPadding = 14.dp, fontSize = 14.sp, onClick = actions.onReplay)
                if (s.lang != "en") {
                    SecondaryPill(
                        if (ui.newWordCount > 0) "➕ Words (${ui.newWordCount})" else "➕ Words",
                        Modifier.height(44.dp).testTag(EpisodeTags.WORDS), horizontalPadding = 14.dp, fontSize = 14.sp, onClick = actions.onWords,
                    )
                }
            }
        }
    }
}

/** A covered segment: soft bars about as long as its text (listen first, read later). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoveredLines(chars: Int) {
    val bars = remember(chars) {
        val n = chars.coerceIn(4, 60)
        val widths = mutableListOf<Int>()
        var left = n
        var k = 0
        while (left > 0) {
            val w = minOf(left, listOf(3, 5, 2, 4, 6, 3)[k % 6])
            widths += w
            left -= w
            k++
        }
        widths
    }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (w in bars) Box(Modifier.width((w * 17).dp).height(16.dp).clip(RoundedCornerShape(8.dp)).background(Lab.colors.faint))
    }
}

/** The Chinese as word chips (made on the phone, data/text/DeviceWords) — a word → the explorer. */
@Composable
private fun SegmentChinese(s: PodcastSegmentDto, showPinyin: Boolean, known: Set<String>, onWord: (ReaderWordDto, String) -> Unit) {
    val words = remember(s.text) { DeviceWords.of(s.text) }
    ChineseWords(
        text = s.text,
        words = words,
        isMe = false,
        color = Lab.colors.ink,
        showPinyin = showPinyin,
        known = known,
        onChip = { k ->
            val ws = words ?: return@ChineseWords
            val offsets = ReaderWords.offsets(ws.map { it.text })
            onWord(ws[k], ReaderWords.sentenceAround(s.text, offsets[k], offsets[k] + ws[k].text.length))
        },
        fontSize = 21.sp,
        plain = {
            Column {
                Text(s.text, color = Lab.colors.ink, fontSize = 21.sp, lineHeight = 30.sp)
                if (showPinyin && s.pinyin != null) Text(s.pinyin, color = Lab.colors.accent, fontSize = 14.sp)
            }
        },
    )
}

@Composable
private fun PlayerBar(ui: EpisodeUi, actions: EpisodeActions) {
    Column(
        Modifier.fillMaxWidth().background(Lab.colors.card).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Timeline(ui, actions)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
            BarButton(Icons.Filled.SkipPrevious, "Previous segment", ui.current > 0, actions.onPrev)
            BarButton(Icons.Filled.Replay, "Play this segment again", ui.canPlay, actions.onReplay)
            Box(
                Modifier.size(64.dp).clip(CircleShape).background(if (ui.canPlay) Lab.colors.accent else Lab.colors.faint)
                    .bouncyClickable(enabled = ui.canPlay, pressedScale = 0.9f, onClick = actions.onToggle)
                    .semantics { contentDescription = if (ui.playing) "Pause" else "Play" }
                    .testTag(EpisodeTags.PLAY),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (ui.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(34.dp))
            }
            BarButton(Icons.Filled.SkipNext, "Next segment", ui.current < ui.segments.lastIndex, actions.onNext)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ToggleChip("🐢 0.75×", ui.slow, Modifier.weight(1f), actions.onSlow)
            ToggleChip("▶▶ Keep playing", ui.auto, Modifier.weight(1.3f), actions.onAuto)
            ToggleChip("👁 ${ui.mode.label}", ui.mode != Reveal.LISTEN, Modifier.weight(1.4f), actions.onMode)
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
private fun ToggleChip(label: String, on: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(if (on) Lab.colors.accent else Lab.colors.faint)
            .bouncyClickable(pressedScale = 0.96f, onClick = onClick).padding(horizontal = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (on) Color.White else Lab.colors.ink, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The whole episode as a bar with a tick per segment; tap or drag to go to the segment there. */
@Composable
private fun Timeline(ui: EpisodeUi, actions: EpisodeActions) {
    val total = ui.durationMs.coerceAtLeast(1)
    val segs = ui.segments
    val pos = if (ui.playing) ui.positionMs else segs.getOrNull(ui.current)?.start_ms ?: 0
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(Podcasts.clock(pos), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.width(52.dp))
        Box(
            Modifier.weight(1f).height(28.dp)
                .pointerInput(total) { detectTapGestures { o -> actions.onSeek((o.x / size.width).coerceIn(0f, 1f)) } }
                .pointerInput(total) { detectHorizontalDragGestures { change, _ -> actions.onSeek((change.position.x / size.width).coerceIn(0f, 1f)) } },
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.faint))
            Box(Modifier.fillMaxWidth((pos.toFloat() / total).coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(3.dp)).background(Lab.colors.accent))
            segs.getOrNull(ui.current)?.let { s ->
                val from = (s.start_ms.toFloat() / total).coerceIn(0f, 1f)
                Row(Modifier.fillMaxWidth()) {
                    if (from > 0f) Spacer(Modifier.weight(from))
                    Box(Modifier.width(4.dp).height(18.dp).clip(RoundedCornerShape(2.dp)).background(Palette.Gold))
                    if (from < 1f) Spacer(Modifier.weight((1f - from).coerceAtLeast(0.0001f)))
                }
            }
        }
        Text(Podcasts.clock(total), style = MaterialTheme.typography.labelSmall, color = Lab.colors.muted, modifier = Modifier.width(52.dp).padding(start = 8.dp))
    }
}
