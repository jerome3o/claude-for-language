package dev.jeromeswannack.chineselearning.lab.ui.readers

import android.media.AudioAttributes
import android.media.MediaPlayer
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.BlockPlayback
import dev.jeromeswannack.chineselearning.lab.data.api.ReaderPageDto
import dev.jeromeswannack.chineselearning.lab.data.readers.ClipAnalysis
import dev.jeromeswannack.chineselearning.lab.data.readers.WAVE_BUCKETS
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/** A clip's samples that screenshot tests draw instead of decoding one. */
fun sampleClipAnalysis(durationMs: Int, blocks: List<AudioBlocks.Block>, peaks: List<Float>) = ClipAnalysis(durationMs, peaks, blocks)

/**
 * The web's ReaderAudioScrubber, for the in-session reader: the page's narration as a
 * waveform split into phrase BLOCKS at its pauses (ticks, the current block highlighted),
 * with a restart point (the anchor) that moves with the audio — core `BlockPlayback`, the
 * same rules as the web, parity-tested:
 * - play starts from the anchor; as each block finishes the anchor advances to the block
 *   now playing; stop, play again = the block he was in — or the previous one when he
 *   stopped within a second of crossing into a new block;
 * - tap a block to jump there, ⏮ / ⏭ step between blocks, drag for a free anchor (it wins
 *   until playback moves past its block).
 * One block (no pause found / undecodable clip) = the old scrubber. ↻ regenerates a bad
 * cached clip. Play sits on the right — the thumb side. [initial] seeds the state in
 * screenshots.
 */
@Composable
fun ReaderScrubber(page: ReaderPageDto, env: ReaderEnv, initial: BlockPlayback.State? = null) {
    val load = env.pageAudio
    var file by remember(page.id) { mutableStateOf<File?>(null) }
    var status by remember(page.id) { mutableStateOf("loading") }
    var analysis by remember(page.id) { mutableStateOf<ClipAnalysis?>(null) }
    var mediaDuration by remember(page.id) { mutableIntStateOf(0) }
    var play by remember(page.id) { mutableStateOf(initial ?: BlockPlayback.State()) }
    var head by remember(page.id) { mutableDoubleStateOf(initial?.anchorMs ?: 0.0) }
    var regenerating by remember(page.id) { mutableStateOf(false) }
    val player = remember(page.id) { arrayOfNulls<MediaPlayer>(1) }
    val scope = rememberCoroutineScope()

    val duration = analysis?.durationMs?.takeIf { it > 0 } ?: mediaDuration
    val blocks = analysis?.blocks?.takeIf { it.isNotEmpty() } ?: listOf(AudioBlocks.Block(0, Math.max(1, duration)))
    val multi = blocks.size > 1
    // Callbacks outlive a composition (the completion listener, the polling loop): read the latest blocks
    val currentBlocks by rememberUpdatedState(blocks)

    fun positionMs(): Double = player[0]?.let { p -> runCatching { p.currentPosition.toDouble() }.getOrNull() } ?: head

    fun dispatch(event: BlockPlayback.Event) {
        val r = BlockPlayback.reduce(play, event, currentBlocks)
        r.seekToMs?.let { ms -> player[0]?.let { p -> runCatching { p.seekTo(ms.toLong(), MediaPlayer.SEEK_CLOSEST) } }; head = ms }
        play = r.state
        if (!r.state.playing) head = r.state.anchorMs
    }

    fun release() { player[0]?.let { runCatching { it.release() } }; player[0] = null; play = play.copy(playing = false, crossedFromMs = null) }
    fun adopt(f: File?) {
        release()
        file = f
        analysis = null
        status = if (f == null) "unavailable" else "ready"
        head = play.anchorMs
        if (f != null) scope.launch { analysis = env.analyze(page, f) }
    }
    LaunchedEffect(page.id) { adopt(load?.invoke(page, false)) }
    DisposableEffect(page.id) { onDispose { release() } }
    LaunchedEffect(play.playing) {
        var last = -1
        while (play.playing) {
            player[0]?.let { p ->
                runCatching {
                    val pos = p.currentPosition.toDouble()
                    head = pos
                    val idx = AudioBlocks.indexAt(currentBlocks, pos)
                    if (idx != last) { last = idx; dispatch(BlockPlayback.Event.Tick(pos)) }
                }
            }
            delay(40)
        }
    }

    fun mp(): MediaPlayer? = player[0] ?: file?.let { f ->
        runCatching {
            MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                setDataSource(f.absolutePath)
                prepare()
                mediaDuration = this.duration
                setOnCompletionListener { dispatch(BlockPlayback.Event.Ended) }
            }
        }.getOrNull()?.also { player[0] = it }
    }
    fun start() {
        val p = mp() ?: return
        runCatching {
            p.seekTo(play.anchorMs.toLong(), MediaPlayer.SEEK_CLOSEST)
            p.start()
            dispatch(BlockPlayback.Event.Play)
            env.onTap()
        }
    }
    fun stop() {
        val pos = positionMs()
        runCatching { player[0]?.pause() }
        if (play.playing) dispatch(BlockPlayback.Event.Pause(pos)) else head = play.anchorMs
    }
    fun msAt(x: Float, width: Int): Double = if (width <= 0) 0.0 else (x / width).coerceIn(0f, 1f) * duration.toDouble()

    val ready = status == "ready"
    val active = BlockPlayback.activeIndex(play, blocks, head).coerceAtLeast(0)
    val barColor = if (analysis?.peaks != null) Color(0xFF94A3B8) else Lab.colors.cardBorder
    val accent = Lab.colors.accent
    val tick = Lab.colors.muted
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(
                Modifier.size(44.dp).bouncyClickable(!regenerating) {
                    if (!regenerating && load != null) {
                        regenerating = true
                        stop()
                        scope.launch {
                            val f = load(page, true)
                            regenerating = false
                            if (f != null) { play = BlockPlayback.State(); adopt(f) }
                        }
                    }
                }.clip(CircleShape).background(Lab.colors.faint).alpha(if (regenerating) 0.4f else 1f),
                contentAlignment = Alignment.Center,
            ) { Text("↻", fontSize = 20.sp, color = Lab.colors.muted) }
            Box(
                Modifier.weight(1f).height(56.dp).clip(RoundedCornerShape(12.dp)).background(Lab.colors.card)
                    .pointerInput(ready, multi, duration) {
                        if (ready) detectTapGestures { o ->
                            val ms = msAt(o.x, size.width)
                            if (multi) { dispatch(BlockPlayback.Event.Jump(AudioBlocks.indexAt(blocks, ms))); env.onTap() }
                            else dispatch(BlockPlayback.Event.Place(ms))
                        }
                    }
                    .pointerInput(ready, duration) { if (ready) detectHorizontalDragGestures { change, _ -> dispatch(BlockPlayback.Event.Place(msAt(change.position.x, size.width))) } },
                contentAlignment = Alignment.Center,
            ) {
                Canvas(Modifier.fillMaxSize()) {
                    val d = duration.toFloat()
                    val band = if (multi && d > 0) blocks[Math.min(active, blocks.size - 1)] else null
                    if (band != null) {
                        val x0 = band.startMs / d * size.width
                        val x1 = band.endMs / d * size.width
                        drawRoundRect(accent.copy(alpha = 0.10f), Offset(x0, 0f), Size(Math.max(2f, x1 - x0), size.height), CornerRadius(8.dp.toPx()))
                    }
                    val bars = analysis?.peaks ?: List(WAVE_BUCKETS) { 0.35f }
                    val gap = 1.dp.toPx()
                    val w = size.width / bars.size - gap
                    for ((i, v) in bars.withIndex()) {
                        val h = Math.max(2f, v * (size.height - 12f))
                        val mid = (i + 0.5f) / bars.size * d
                        val inBand = band != null && analysis?.peaks != null && mid >= band.startMs && mid < band.endMs
                        drawRoundRect(if (inBand) accent.copy(alpha = 0.75f) else barColor, Offset(i * (w + gap), (size.height - h) / 2), Size(w, h), CornerRadius(w / 2))
                    }
                    if (multi && d > 0) {
                        val tw = 1.5.dp.toPx()
                        val th = 7.dp.toPx()
                        for (b in blocks.drop(1)) {
                            val x = b.startMs / d * size.width
                            drawRect(tick, Offset(x - tw / 2, 0f), Size(tw, th))
                            drawRect(tick, Offset(x - tw / 2, size.height - th), Size(tw, th))
                        }
                    }
                    if (ready && d > 0) {
                        val hx = (head / d).toFloat().coerceIn(0f, 1f) * size.width
                        val ax = (play.anchorMs / d).toFloat().coerceIn(0f, 1f) * size.width
                        drawLine(accent.copy(alpha = 0.6f), Offset(hx, 4f), Offset(hx, size.height - 4f), strokeWidth = 2.dp.toPx())
                        drawCircle(Color.White, radius = 10.dp.toPx(), center = Offset(ax, size.height / 2))
                        drawCircle(accent, radius = 8.dp.toPx(), center = Offset(ax, size.height / 2))
                    }
                }
                if (status == "unavailable") Text("audio unavailable offline", fontSize = 12.sp, color = Lab.colors.muted)
            }
            Box(
                Modifier.size(56.dp).bouncyClickable(ready, 0.9f) { if (play.playing) stop() else start() }.clip(CircleShape)
                    .background(if (play.playing) Lab.colors.accent else Lab.colors.accentSoft).alpha(if (ready) 1f else 0.5f),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (play.playing) Icons.Filled.Stop else Icons.AutoMirrored.Filled.VolumeUp, if (play.playing) "Stop audio" else "Play audio from the selected point", Modifier.size(26.dp), tint = if (play.playing) Color.White else Lab.colors.accent)
            }
        }
        if (ready && multi) {
            // ⏮ Phrase n of N ⏭ — right-aligned so ⏭ sits under play (the thumb side)
            Row(
                Modifier.fillMaxWidth().padding(top = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                StepButton(Icons.Filled.SkipPrevious, "Previous phrase") { dispatch(BlockPlayback.Event.Step(-1, positionMs())); env.onTap() }
                Text(
                    "Phrase ${Math.min(active, blocks.size - 1) + 1} of ${blocks.size}",
                    fontSize = 13.sp, color = Lab.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.widthIn(min = 104.dp),
                )
                StepButton(Icons.Filled.SkipNext, "Next phrase") { dispatch(BlockPlayback.Event.Step(1, positionMs())); env.onTap() }
            }
        }
    }
}

@Composable
private fun StepButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    Box(
        Modifier.width(60.dp).height(44.dp).bouncyClickable(pressedScale = 0.9f, onClick = onClick).clip(CircleShape).background(Lab.colors.accentSoft),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, label, Modifier.size(24.dp), tint = Lab.colors.accent) }
}
