package dev.jeromeswannack.chineselearning.lab.ui.audiolessons

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderWordDto
import dev.jeromeswannack.chineselearning.lab.data.text.DeviceWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.ChineseWords
import dev.jeromeswannack.chineselearning.lab.ui.chat.WordChipColors
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonMusic
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTimeline
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonFormats
import dev.jeromeswannack.chineselearning.lab.core.AudioLessonTranscriptRow
import dev.jeromeswannack.chineselearning.lab.data.api.AudioLessonDto
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable

data class AudioLessonPlayerUi(
    val lesson: AudioLessonDto? = null,
    val loadError: String? = null,
    /** Saving to this phone: fraction (0 while the size is unknown) and bytes so far. */
    val download: Double? = null,
    val downloadBytes: Long = 0,
    val savedOnPhone: Boolean = false,
    /** The file is in the player (the controls work). */
    val canPlay: Boolean = false,
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val speed: Double = 1.0,
    val timerMinutes: Int = 0,
    val timerLeftMs: Long = 0,
    val showTimer: Boolean = false,
    val showChapters: Boolean = false,
    /** null = the format's default (on for dialogue, off for sleep). */
    val showTranscript: Boolean? = null,
    val showWords: Boolean = false,
    /** The transcript's 拼 / EN toggles (remembered on this phone). */
    val showPinyin: Boolean = true,
    val showEnglish: Boolean = true,
    /** The soft music bed (docs/AUDIO_LESSONS.md "Music"): on by default for sleep, off for dialogue. */
    val musicOn: Boolean = false,
    val musicVolume: Double = AudioLessonMusic.DEFAULT_VOLUME,
    /** Hanzi already in a deck: quieter word chips in the transcript. */
    val known: Set<String> = emptySet(),
    /** Its companion mini lesson (null = none asked for) and whether a listen reached the end. */
    val companion: CompanionView? = null,
    val listened: Boolean = false,
    val companionBusy: Boolean = false,
    val online: Boolean = true,
) {
    val transcriptOn: Boolean get() = showTranscript ?: (lesson?.format != "sleep")
}

data class AudioLessonPlayerActions(
    val onBack: () -> Unit = {},
    val onToggle: () -> Unit = {},
    val onSeek: (Long) -> Unit = {},
    val onSkip: (Long) -> Unit = {},
    val onPreviousChapter: () -> Unit = {},
    val onNextChapter: () -> Unit = {},
    val onSpeed: () -> Unit = {},
    val onTimerSheet: () -> Unit = {},
    val onTimer: (Int) -> Unit = {},
    val onChapters: () -> Unit = {},
    val onTranscript: () -> Unit = {},
    val onPinyin: () -> Unit = {},
    val onEnglish: () -> Unit = {},
    val onWords: () -> Unit = {},
    val onMusic: () -> Unit = {},
    /** The music volume slider: (volume, the finger lifted). */
    val onMusicVolume: (Double, Boolean) -> Unit = { _, _ -> },
    /** A word chip in the transcript: (the word, the sentence it was tapped in) → the language explorer. */
    val onWord: (ReaderWordDto, String) -> Unit = { _, _ -> },
    /** The companion mini lesson: make it, unlock it, start it (`/lessons/:id/play?from=player`). */
    val onMakeCompanion: () -> Unit = {},
    val onUnlockCompanion: () -> Unit = {},
    val onStartCompanion: (String) -> Unit = {},
)

/**
 * `/audio-lessons/:id` — the web's AudioLessonPlayerPage: full screen and dark. Phone: one column
 * that follows the current transcript line; unfolded (≥ 640dp): the controls on the left, the
 * transcript beside them.
 */
@Composable
fun AudioLessonPlayerScreen(ui: AudioLessonPlayerUi, actions: AudioLessonPlayerActions) {
    val lesson = ui.lesson
    val bg = if (lesson?.format == "sleep") AlColors.playerSleep else AlColors.player
    Box(Modifier.fillMaxSize().background(bg).windowInsetsPadding(WindowInsets.safeDrawing), contentAlignment = Alignment.TopCenter) {
        if (lesson == null) {
            Column(Modifier.fillMaxWidth().widthIn(max = 720.dp).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                BackButton(actions.onBack)
                Text(ui.loadError ?: "Loading…", color = AlColors.text, fontSize = 17.sp)
            }
            return@Box
        }
        val rows = remember(lesson.transcript) { AudioLessonTimeline.transcriptRows(lesson.transcript) }
        val lineIdx = AudioLessonTimeline.transcriptIndexAt(lesson.transcript, ui.positionMs.toDouble())
        val currentRow = rows.indexOfFirst { lineIdx >= it.first && lineIdx <= it.last }
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= 640.dp
            if (wide && lesson.ready) {
                val transcriptState = rememberLazyListState()
                Row(Modifier.fillMaxSize().widthIn(max = 1100.dp).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Column(Modifier.weight(1f).fillMaxSize().padding(top = 8.dp)) {
                        PlayerTop(ui, actions)
                        LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            playerPanels(ui, actions)
                            words(ui, actions)
                        }
                    }
                    LazyColumn(Modifier.weight(1f).fillMaxSize(), state = transcriptState, contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        item { Text("📝 Transcript", color = AlColors.muted, fontSize = 14.sp, modifier = Modifier.padding(start = 12.dp, bottom = 4.dp)) }
                        transcript(rows, currentRow, actions, ui)
                    }
                    Follow(transcriptState, currentRow, offset = 1, enabled = ui.playing)
                }
            } else {
                val state = rememberLazyListState()
                // The controls stay put; the panels, transcript and words scroll under them.
                Column(Modifier.fillMaxSize().widthIn(max = 720.dp).padding(horizontal = 16.dp)) {
                    PlayerTop(ui, actions)
                    if (lesson.ready) {
                        LazyColumn(
                            Modifier.weight(1f).fillMaxWidth().padding(top = 8.dp),
                            state = state,
                            contentPadding = androidx.compose.foundation.layout.PaddingValues(top = 4.dp, bottom = 32.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            playerPanels(ui, actions)
                            if (ui.transcriptOn) transcript(rows, currentRow, actions, ui)
                            words(ui, actions)
                        }
                    }
                }
                // The timer and chapter items come before the transcript.
                val before = (if (ui.showTimer) 1 else 0) + (if (ui.showChapters) lesson.chapters.size else 0)
                Follow(state, currentRow, offset = before, enabled = ui.playing && ui.transcriptOn && lesson.ready)
            }
        }
    }
}

/** Keeps the current line in view while playing (the web's scrollIntoView, block: center). */
@Composable
private fun Follow(state: LazyListState, row: Int, offset: Int, enabled: Boolean) {
    LaunchedEffect(row, enabled) {
        if (!enabled || row < 0) return@LaunchedEffect
        val index = offset + row
        val visible = state.layoutInfo.visibleItemsInfo
        val viewport = state.layoutInfo.viewportEndOffset - state.layoutInfo.viewportStartOffset
        val item = visible.firstOrNull { it.index == index }
        if (item != null && item.offset > viewport / 4 && item.offset + item.size < viewport * 3 / 4) return@LaunchedEffect
        state.animateScrollToItem(index, scrollOffset = -viewport / 3)
    }
}

@Composable
private fun BackButton(onBack: () -> Unit) {
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
        Text("←", color = AlColors.bright, fontSize = 24.sp)
    }
}

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
@Composable
private fun PlayerTop(ui: AudioLessonPlayerUi, actions: AudioLessonPlayerActions) = Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
    val lesson = ui.lesson ?: return@Column
    run {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
            BackButton(actions.onBack)
            Spacer(Modifier.width(4.dp))
            Column(Modifier.weight(1f)) {
                val info = AudioLessonFormats.info(lesson.format)
                Text("${info.icon} ${info.kind}", color = AlColors.muted, fontSize = 13.sp)
                Text(lesson.title, color = AlColors.bright, fontSize = 21.sp, fontWeight = FontWeight.Bold, lineHeight = 26.sp)
            }
        }
    }
    if (!lesson.ready) {
        run {
            Text(
                if (lesson.status == "failed") lesson.error ?: "Something went wrong" else lesson.progress?.takeIf { it.isNotEmpty() } ?: "Being made…",
                color = AlColors.text,
                fontSize = 16.sp,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
        return@Column
    }
    val chapters = lesson.chapters
    val duration = lesson.duration_ms ?: 0L
    val chapterIdx = AudioLessonTimeline.chapterIndexAt(chapters, ui.positionMs.toDouble())
    run {
        Column(Modifier.fillMaxWidth().padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(chapters.getOrNull(chapterIdx)?.title.orEmpty(), color = AlColors.periwinkle, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            val dl = ui.download
            when {
                dl != null -> {
                    Text(
                        "Saving to this phone… " + (if (dl > 0) "${Math.round(dl * 100)}%" else AudioLessonTimeline.formatMb(ui.downloadBytes)),
                        color = AlColors.text,
                        fontSize = 14.sp,
                    )
                    ProgressBar(dl.toFloat(), track = Color.White.copy(alpha = 0.12f), fill = AlColors.periwinkle)
                }
                ui.savedOnPhone -> Text("✓ Saved on this phone · plays offline", color = AlColors.muted, fontSize = 13.sp)
            }
            ui.loadError?.let { Text(it, color = Color(0xFFFCA5A5), fontSize = 14.sp) }
            lesson.notice?.let { Text(it, color = AlColors.muted, fontSize = 13.sp) }
        }
    }
    Scrubber(ui.positionMs, duration, ui.canPlay, actions.onSeek)
    Controls(ui, actions)
    run {
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            NightChip(AudioLessonTimeline.speedLabel(ui.speed), compact = true, onClick = actions.onSpeed)
            NightChip(
                "🌙 " + when (ui.timerMinutes) {
                    0 -> "Sleep timer"
                    -1 -> "End of chapter"
                    else -> AudioLessonTimeline.formatClock(ui.timerLeftMs.toDouble())
                },
                selected = ui.timerMinutes != 0,
                compact = true,
                onClick = actions.onTimerSheet,
            )
            NightChip("☰ Chapters", selected = ui.showChapters, compact = true, onClick = actions.onChapters)
            NightChip("📝 Transcript", selected = ui.transcriptOn, compact = true, onClick = actions.onTranscript)
            if (ui.transcriptOn) {
                Box(Modifier.semantics { contentDescription = "Pinyin in the transcript" }) { NightChip("拼", selected = ui.showPinyin, compact = true, onClick = actions.onPinyin) }
                Box(Modifier.semantics { contentDescription = "English in the transcript" }) { NightChip("EN", selected = ui.showEnglish, compact = true, onClick = actions.onEnglish) }
            }
            Box(Modifier.semantics { contentDescription = if (ui.musicOn) "Music on" else "Music off" }) {
                NightChip(if (ui.musicOn) "🎵 Music" else "🎵 Music off", selected = ui.musicOn, compact = true, onClick = actions.onMusic)
            }
        }
    }
    AnimatedVisibility(ui.musicOn, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
        MusicVolume(ui.musicVolume, actions.onMusicVolume)
    }
}

/** The music's volume, under the chips while it is on (the web's `.al-music` row). */
@Composable
private fun MusicVolume(volume: Double, onVolume: (Double, Boolean) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val shown = dragging?.toDouble() ?: volume
    Row(
        Modifier.fillMaxWidth().widthIn(max = 420.dp).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp))
            .background(Color.White.copy(alpha = 0.05f)).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("🎵", fontSize = 15.sp)
        Slider(
            value = shown.toFloat(),
            onValueChange = { dragging = it; onVolume(it.toDouble(), false) },
            onValueChangeFinished = { dragging?.let { onVolume(it.toDouble(), true) }; dragging = null },
            valueRange = AudioLessonMusic.MIN_VOLUME.toFloat()..AudioLessonMusic.MAX_VOLUME.toFloat(),
            modifier = Modifier.weight(1f).semantics { contentDescription = "Music volume" },
            colors = SliderDefaults.colors(
                thumbColor = AlColors.periwinkle,
                activeTrackColor = AlColors.periwinkle,
                inactiveTrackColor = Color.White.copy(alpha = 0.15f),
            ),
        )
        Text(AudioLessonMusic.volumeLabel(shown), color = AlColors.muted, fontSize = 13.sp)
    }
}

@Composable
private fun Scrubber(positionMs: Long, durationMs: Long, enabled: Boolean, onSeek: (Long) -> Unit) {
    var dragging by remember { mutableStateOf<Float?>(null) }
    val shown = dragging?.toLong() ?: positionMs.coerceAtMost(durationMs)
    Column {
        Slider(
            value = shown.toFloat(),
            onValueChange = { dragging = it },
            onValueChangeFinished = { dragging?.let { onSeek(it.toLong()) }; dragging = null },
            valueRange = 0f..durationMs.coerceAtLeast(1).toFloat(),
            enabled = enabled,
            colors = SliderDefaults.colors(
                thumbColor = AlColors.periwinkle,
                activeTrackColor = AlColors.periwinkle,
                inactiveTrackColor = Color.White.copy(alpha = 0.15f),
                disabledThumbColor = AlColors.muted,
                disabledActiveTrackColor = AlColors.muted,
                disabledInactiveTrackColor = Color.White.copy(alpha = 0.1f),
            ),
        )
        Row(Modifier.fillMaxWidth()) {
            Text(AudioLessonTimeline.formatClock(shown.toDouble()), color = AlColors.muted, fontSize = 13.sp)
            Spacer(Modifier.weight(1f))
            Text("−" + AudioLessonTimeline.formatClock((durationMs - shown).toDouble()), color = AlColors.muted, fontSize = 13.sp)
        }
    }
}

@Composable
private fun Controls(ui: AudioLessonPlayerUi, actions: AudioLessonPlayerActions) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
        RoundControl("⏮", "Previous chapter", ui.canPlay, 52, onClick = actions.onPreviousChapter)
        RoundControl("↺ 10", "Back 10 seconds", ui.canPlay, 56, onClick = { actions.onSkip(-10_000) })
        RoundControl(if (ui.playing) "❚❚" else "▶", if (ui.playing) "Pause" else "Play", ui.canPlay, 76, primary = true, onClick = actions.onToggle)
        RoundControl("10 ↻", "Forward 10 seconds", ui.canPlay, 56, onClick = { actions.onSkip(10_000) })
        RoundControl("⏭", "Next chapter", ui.canPlay, 52, onClick = actions.onNextChapter)
    }
}

@Composable
private fun RoundControl(label: String, description: String, enabled: Boolean, size: Int, primary: Boolean = false, onClick: () -> Unit) {
    val bg by animateColorAsState(if (primary) AlColors.periwinkle else Color.White.copy(alpha = 0.08f), label = "ctl")
    Box(
        Modifier.size(size.dp).alpha(if (enabled) 1f else 0.4f).clip(CircleShape).background(bg)
            .bouncyClickable(enabled, pressedScale = 0.9f, onClick = onClick)
            .semanticsLabel(description),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (primary) AlColors.onPeriwinkle else AlColors.bright, fontSize = if (primary) 26.sp else 15.sp, fontWeight = FontWeight.SemiBold)
    }
}

private fun Modifier.semanticsLabel(text: String): Modifier = semantics { contentDescription = text }

@OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
private fun LazyListScope.playerPanels(ui: AudioLessonPlayerUi, actions: AudioLessonPlayerActions) {
    val lesson = ui.lesson ?: return
    item(key = "companion") {
        CompanionCard(ui.companion, ui.listened, ui.online, ui.companionBusy, actions.onMakeCompanion, actions.onUnlockCompanion, actions.onStartCompanion)
    }
    if (ui.showTimer) {
        item(key = "timer") {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.06f)).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("Sleep timer", color = AlColors.bright, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (m in AudioLessonTimeline.SLEEP_TIMER_CHOICES) NightChip(AudioLessonTimeline.sleepTimerLabel(m), selected = ui.timerMinutes == m) { actions.onTimer(m) }
                }
                Text("The last 30 seconds fade out. It keeps counting with the screen off.", color = AlColors.muted, fontSize = 13.sp)
            }
        }
    }
    if (ui.showChapters) {
        val current = AudioLessonTimeline.chapterIndexAt(lesson.chapters, ui.positionMs.toDouble())
        lesson.chapters.forEachIndexed { i, c ->
            item(key = "ch$i") {
                val on = i == current
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                        .background(if (on) AlColors.periwinkle.copy(alpha = 0.18f) else Color.Transparent)
                        .clickable { actions.onSeek(c.startMs) }.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${i + 1}. ${c.title}", color = if (on) AlColors.bright else AlColors.text, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Text(AudioLessonTimeline.formatClock(c.startMs.toDouble()), color = AlColors.muted, fontSize = 13.sp)
                }
            }
        }
    }
}

private fun LazyListScope.transcript(rows: List<AudioLessonTranscriptRow>, current: Int, actions: AudioLessonPlayerActions, ui: AudioLessonPlayerUi) {
    rows.forEachIndexed { i, row ->
        item(key = "t${row.first}") { TranscriptRowView(row, i == current, ui.showPinyin, ui.showEnglish, ui.known, actions.onWord) { actions.onSeek(row.startMs) } }
    }
}

/** The transcript's word chips on the dark player (the web's .al-line .chat-word). */
private val TranscriptChips = WordChipColors(
    tint = AlColors.periwinkle.copy(alpha = 0.10f),
    knownLine = Color(0xFF86EFAC).copy(alpha = 0.8f),
    pinyin = AlColors.periwinkle,
)

/**
 * One transcript row (dialogue, sleep and story alike). Its Chinese is word chips made on the
 * phone (data/text/DeviceWords: the deterministic segmenter, the chat / Ask Claude's
 * [ChineseWords]) — a word opens the language explorer; a tap anywhere else on the row seeks the
 * audio to it. Until the word lists load (or for a line with no Chinese) it is the plain text.
 */
@Composable
private fun TranscriptRowView(
    row: AudioLessonTranscriptRow,
    current: Boolean,
    showPinyin: Boolean,
    showEnglish: Boolean,
    known: Set<String>,
    onWord: (ReaderWordDto, String) -> Unit,
    onClick: () -> Unit,
) {
    val bg by animateColorAsState(if (current) AlColors.periwinkle.copy(alpha = 0.16f) else Color.Transparent, label = "row")
    val scale by animateFloatAsState(if (current) 1f else 0.985f, spring(dampingRatio = 0.6f), label = "rowScale")
    Row(Modifier.fillMaxWidth().scale(scale).clip(RoundedCornerShape(12.dp)).background(bg).clickable(onClick = onClick).testTag("al-transcript-row")) {
        Box(Modifier.width(3.dp).heightIn(min = 44.dp).background(if (current) AlColors.periwinkle else Color.Transparent))
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            val zh = row.lang == "zh"
            val color = if (current) AlColors.bright else if (zh) AlColors.text else AlColors.muted
            val fontSize = if (zh) 19.sp else 15.sp
            val words = DeviceWords.of(row.text)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f, fill = false)) {
                    ChineseWords(
                        text = row.text,
                        words = words,
                        isMe = false,
                        color = color,
                        showPinyin = false,
                        known = known,
                        onChip = { i ->
                            val ws = words ?: return@ChineseWords
                            val offsets = ReaderWords.offsets(ws.map { it.text })
                            onWord(ws[i], ReaderWords.sentenceAround(row.text, offsets[i], offsets[i] + ws[i].text.length))
                        },
                        fontSize = fontSize,
                        plain = { Text(row.text, color = color, fontSize = fontSize, lineHeight = if (zh) 26.sp else 21.sp) },
                        chipColors = TranscriptChips,
                    )
                }
                // Said several times in a row: "×3", line by line "×3 +1" (the web's .al-line-repeat).
                val (repeatText, repeatAria) = AudioLessonTimeline.repeatLabel(row.repeat, row.again)
                if (repeatText.isNotEmpty()) {
                    Text(repeatText, color = AlColors.muted, fontSize = 12.sp, modifier = Modifier.padding(start = 6.dp).semantics { contentDescription = repeatAria })
                }
            }
            if (showPinyin) row.pinyin?.let { Text(it, color = AlColors.periwinkle.copy(alpha = 0.85f), fontSize = 13.sp) }
            if (showEnglish) row.english?.let { Text(it, color = AlColors.muted, fontSize = 13.sp) }
        }
    }
}

private fun LazyListScope.words(ui: AudioLessonPlayerUi, actions: AudioLessonPlayerActions) {
    val words = ui.lesson?.words.orEmpty()
    if (words.isEmpty()) return
    item(key = "words") {
        Column(Modifier.fillMaxWidth().padding(top = 8.dp).clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.05f))) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(onClick = actions.onWords).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Words in this lesson (${words.size})", color = AlColors.text, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, modifier = Modifier.weight(1f))
                Text(if (ui.showWords) "▴" else "▾", color = AlColors.muted, fontSize = 16.sp)
            }
            AnimatedVisibility(ui.showWords, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                Column(Modifier.padding(start = 14.dp, end = 14.dp, bottom = 12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (w in words) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(w.hanzi, color = AlColors.bright, fontSize = 19.sp)
                            Spacer(Modifier.width(8.dp))
                            Column(Modifier.weight(1f)) {
                                Text(w.pinyin, color = AlColors.periwinkle, fontSize = 13.sp)
                                val status = when (w.status) {
                                    "known" -> " · you know it"
                                    "learning" -> " · learning"
                                    else -> ""
                                }
                                Text(w.english + status, color = AlColors.muted, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                }
            }
        }
    }
    item(key = "end") { Spacer(Modifier.height(24.dp)) }
}
