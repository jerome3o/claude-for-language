package dev.jeromeswannack.chineselearning.lab.ui.chat

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.AudioBlocks
import dev.jeromeswannack.chineselearning.lab.core.BlockPlayback
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.readers.ClipAnalysis
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlin.math.PI
import kotlin.math.sin

/*
 * Listening mode's hidden bubble (docs/CHAT.md "Listening mode"): the other person's received bubble
 * (same shape and grey), the text replaced by 🎧 + 24 bars + the duration and "Tap to listen · hold
 * to reveal". Tap plays (the bars dance, ▶ → ■), the 0.75× chip slows it, a long press reveals.
 *
 * In the chat, once the clip is on the phone the bars become its real waveform split into PARTS at
 * the pauses (the graded readers' phrase blocks): tap a part = play from it (the part playing is
 * highlighted), ▶ ⏸ / a tap elsewhere on the bubble = play / pause, drag along it = scrub.
 */

const val LISTENING_HINT = "Tap to listen · hold to reveal"
const val LISTENING_PARTS_HINT = "Tap a part to play it · hold to reveal"

/** The hidden bubble's inside (the bubble itself — shape, colour, gestures — is MessageBubbleRow's). */
@Composable
fun ListeningContent(m: ChatMessageDto, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions) =
    ListeningContent(
        m, meta, ui.listening, actions.onListeningSlow,
        parts = ListeningParts(
            onSeek = { ms, tap -> actions.onListenSeek(m, ms, tap) },
            onSeekDone = actions.onListenSeekDone,
            onHold = { actions.onReveal(m) },
        ),
    )

/** The waveform's gestures (the chat; Ask Claude's answers keep the plain bars). */
class ListeningParts(val onSeek: (ms: Double, tap: Boolean) -> Unit, val onSeekDone: () -> Unit, val onHold: () -> Unit)

/** The same inside for any hidden message (Ask Claude's answers: ui/study/AskClaudeSheet.kt). */
@Composable
fun ListeningContent(m: ChatMessageDto, meta: AnnotatedString?, l: ListeningUi, onSlow: () -> Unit, parts: ListeningParts? = null) {
    val c = chatColors()
    val playing = l.playing == m.id
    val loading = l.loading == m.id
    val fg = c.onTheirs
    val accent = Lab.colors.accent
    val bars = remember(m.id) { ChatListening.listeningBars(m.id).map { it.toFloat() } }
    val analysis = if (parts != null) l.analyses[m.id]?.takeIf { it.durationMs > 0 && it.blocks.isNotEmpty() } else null
    val hint = if (analysis != null) LISTENING_PARTS_HINT else LISTENING_HINT
    Column(Modifier.width(252.dp).padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 6.dp).semantics { contentDescription = "Hidden message. $hint" }) {
        m.reply_to?.let { r -> Text("↩ ${r.sender.name ?: ""}", fontSize = 12.sp, color = c.metaTheirs, maxLines = 1, modifier = Modifier.padding(bottom = 4.dp)) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(if (parts != null) 44.dp else 38.dp).clip(CircleShape).background(accent.copy(alpha = if (playing) 0.22f else 0.14f))
                    .semantics { contentDescription = if (playing) "Pause" else "Play" }
                    .testTag("chat-listening-play"),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    loading -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = accent)
                    parts != null -> Icon(
                        if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, Modifier.size(24.dp).testTag(if (playing) "chat-listening-pause-icon" else "chat-listening-play-icon"), tint = accent,
                    )
                    playing -> Text("■", color = accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    else -> Text("🎧", fontSize = 17.sp)
                }
            }
            Spacer(Modifier.width(8.dp))
            if (analysis != null && parts != null) {
                ListeningPartsWave(analysis, l.blockOf(m), playing, l.focus == m.id, l.clock, parts, accent, fg.copy(alpha = 0.32f), Modifier.weight(1f).height(44.dp))
            } else {
                ListeningBars(bars, playing, l.playNonce, accent, fg.copy(alpha = 0.32f), Modifier.weight(1f).height(30.dp).testTag(if (playing) "chat-listening-bars-playing" else "chat-listening-bars"))
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(analysis?.let { ChatListening.formatListeningDuration(it.durationMs / 1000.0) } ?: l.durationLabel(m), fontSize = 12.sp, color = c.metaTheirs, modifier = Modifier.testTag("chat-listening-duration"))
            Spacer(Modifier.width(6.dp))
            SlowChip(l.slow, onSlow)
            Spacer(Modifier.weight(1f))
            meta?.let { Text(it, fontSize = 11.sp, lineHeight = 13.sp, maxLines = 1) }
        }
        Text(hint, fontSize = 12.sp, color = c.metaTheirs, modifier = Modifier.padding(top = 2.dp).testTag("chat-listening-hint"))
    }
}

/** Bars drawn in the bubble: the clip's peaks squeezed to this many (one per ~4 dp). */
const val LISTENING_WAVE_BARS = 40

/** [peaks] reduced to [n] bars (max of each group), so they stay readable at 180 dp. */
fun squeezePeaks(peaks: List<Float>, n: Int = LISTENING_WAVE_BARS): List<Float> {
    if (peaks.isEmpty() || peaks.size <= n) return peaks
    return List(n) { i ->
        val a = i * peaks.size / n
        val b = Math.max(a + 1, (i + 1) * peaks.size / n)
        var m = 0f
        for (k in a until b) if (peaks[k] > m) m = peaks[k]
        m
    }
}

/**
 * The clip's waveform split into its parts (the readers' phrase blocks): a thin gap between parts,
 * the active part (the one playing, else the restart point's) in a soft accent band with its bars
 * lit, the head while it plays. Tap = play from the part there; drag = scrub (the restart point
 * follows the finger); long press = reveal.
 */
@Composable
fun ListeningPartsWave(
    a: ClipAnalysis, state: BlockPlayback.State, playing: Boolean, focused: Boolean, clock: ListeningClock,
    parts: ListeningParts, on: Color, off: Color, modifier: Modifier = Modifier,
) {
    val blocks = a.blocks
    val d = a.durationMs.toFloat()
    val bars = remember(a) { squeezePeaks(a.peaks ?: List(LISTENING_WAVE_BARS) { 0.4f }) }
    val head = if (focused && playing) clock.headMs else state.anchorMs
    val active = BlockPlayback.activeIndex(state, blocks, head).coerceIn(0, blocks.size - 1)
    val multi = blocks.size > 1
    val band = on.copy(alpha = 0.14f)
    fun msAt(x: Float, w: Int): Double = if (w <= 0) 0.0 else (x / w).coerceIn(0f, 1f) * a.durationMs.toDouble()
    Canvas(
        modifier
            .semantics { contentDescription = if (multi) "${blocks.size} parts. Part ${active + 1} of ${blocks.size}" else "Audio" }
            .testTag(if (playing) "chat-listening-parts-playing" else "chat-listening-parts")
            .pointerInput(a) {
                detectTapGestures(
                    onLongPress = { parts.onHold() },
                    onTap = { o -> parts.onSeek(msAt(o.x, size.width), true) },
                )
            }
            .pointerInput(a) {
                detectHorizontalDragGestures(
                    onDragEnd = { parts.onSeekDone() },
                    onDragCancel = { parts.onSeekDone() },
                ) { change, _ ->
                    change.consume()
                    parts.onSeek(msAt(change.position.x, size.width), false)
                }
            },
    ) {
        if (d <= 0f) return@Canvas
        val gapPx = 3.dp.toPx()
        val r = CornerRadius(6.dp.toPx())
        // Each part: a faint pill; the active one in the accent band.
        for ((i, b) in blocks.withIndex()) {
            val x0 = b.startMs / d * size.width + if (i > 0) gapPx / 2 else 0f
            val x1 = b.endMs / d * size.width - if (i < blocks.size - 1) gapPx / 2 else 0f
            val lit = (focused || playing) && i == active
            if (multi || lit) drawRoundRect(if (lit) band else off.copy(alpha = 0.10f), Offset(x0, 0f), Size(Math.max(2f, x1 - x0), size.height), r)
        }
        val n = bars.size
        if (n > 0) {
            val slot = size.width / n
            val w = Math.max(1.5f, slot * 0.55f)
            val ab = blocks[active]
            for ((i, v) in bars.withIndex()) {
                val mid = (i + 0.5f) / n * d
                val inActive = (focused || playing) && mid >= ab.startMs && mid < ab.endMs
                val h = Math.max(w, v.coerceIn(0f, 1f) * (size.height - 14.dp.toPx()))
                val x = i * slot + (slot - w) / 2
                drawRoundRect(if (inActive) on.copy(alpha = 0.85f) else off, Offset(x, (size.height - h) / 2), Size(w, h), CornerRadius(w / 2))
            }
        }
        if (focused || playing) {
            val hx = (head / d).toFloat().coerceIn(0f, 1f) * size.width
            drawLine(on, Offset(hx, 3.dp.toPx()), Offset(hx, size.height - 3.dp.toPx()), strokeWidth = 2.dp.toPx())
            if (!playing) drawCircle(on, radius = 4.dp.toPx(), center = Offset(hx, size.height - 4.dp.toPx()))
        }
    }
}

/** 0.75× — slow playback for hidden bubbles (remembered on the phone). */
@Composable
private fun SlowChip(on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.heightIn(min = 28.dp).clip(RoundedCornerShape(10.dp)).clickable(onClickLabel = if (on) "Normal speed" else "Slow playback", onClick = onClick).testTag("chat-listening-slow"),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "0.75×", fontSize = 11.sp, fontWeight = FontWeight.Bold,
            color = if (on) Color.White else Lab.colors.ink.copy(alpha = 0.75f),
            modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (on) Lab.colors.accent else Lab.colors.ink.copy(alpha = 0.09f)).padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}

/** The 24 bars; while playing they dance (a travelling wave over their own heights) in the accent colour. */
@Composable
fun ListeningBars(bars: List<Float>, playing: Boolean, nonce: Int, on: Color, off: Color, modifier: Modifier = Modifier) {
    val phase = if (playing) {
        val t = rememberInfiniteTransition(label = "listen-bars")
        t.animateFloat(0f, 1f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Restart), label = "phase").value
    } else 0f
    // A (re)start sweeps the colour in from the left.
    val sweep = remember(nonce, playing) { Animatable(if (playing) 0f else 1f) }
    LaunchedEffect(nonce, playing) { if (playing) sweep.animateTo(1f, tween(500, easing = FastOutSlowInEasing)) }
    Canvas(modifier) {
        val n = bars.size
        if (n == 0) return@Canvas
        val gap = 2.dp.toPx()
        val w = ((size.width - gap * (n - 1)) / n).coerceAtLeast(1f)
        val r = CornerRadius(w / 2, w / 2)
        bars.forEachIndexed { i, f ->
            val wave = if (playing) 0.65f + 0.35f * sin(2 * PI * (phase - i / n.toFloat() * 2)).toFloat().let { (it + 1f) / 2f } else 1f
            val h = (size.height * f.coerceIn(0f, 1f) * wave).coerceAtLeast(w)
            val x = i * (w + gap)
            val lit = playing && (i + 0.5f) / n <= sweep.value
            drawRoundRect(if (lit) on else off, Offset(x, (size.height - h) / 2), Size(w, h), r)
        }
    }
}

/** 👁 beside a hidden bubble: reveals it (the long press does the same). */
@Composable
fun RevealButton(onClick: () -> Unit) {
    Box(
        Modifier.padding(start = 4.dp).size(44.dp).clip(CircleShape).clickable(onClickLabel = "Reveal message", onClick = onClick).testTag("chat-listening-reveal"),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(Lab.colors.ink.copy(alpha = 0.07f)), contentAlignment = Alignment.Center) {
            Text("👁", fontSize = 15.sp)
        }
    }
}

/** A message revealed in this visit: blur 8 dp → 0 and a fade, 260 ms (docs/CHAT.md). */
@Composable
fun RevealIn(id: String, animate: Boolean, content: @Composable () -> Unit) {
    if (!animate) { content(); return }
    val p = remember(id) { Animatable(0f) }
    LaunchedEffect(id) { p.animateTo(1f, tween(260, easing = FastOutSlowInEasing)) }
    Box(Modifier.blur((8f * (1f - p.value)).dp).alpha(0.35f + 0.65f * p.value)) { content() }
}
