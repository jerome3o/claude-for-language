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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.chat.ChatListening
import dev.jeromeswannack.chineselearning.lab.data.api.ChatMessageDto
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import kotlin.math.PI
import kotlin.math.sin

/*
 * Listening mode's hidden bubble (docs/CHAT.md "Listening mode"): the other person's received bubble
 * (same shape and grey), the text replaced by 🎧 + 24 bars + the duration and "Tap to listen · hold
 * to reveal". Tap plays (the bars dance, ▶ → ■), the 0.75× chip slows it, a long press reveals.
 */

const val LISTENING_HINT = "Tap to listen · hold to reveal"

/** The hidden bubble's inside (the bubble itself — shape, colour, gestures — is MessageBubbleRow's). */
@Composable
fun ListeningContent(m: ChatMessageDto, meta: AnnotatedString?, ui: ChatUi, actions: ChatActions) {
    val c = chatColors()
    val l = ui.listening
    val playing = l.playing == m.id
    val loading = l.loading == m.id
    val fg = c.onTheirs
    val accent = Lab.colors.accent
    val bars = remember(m.id) { ChatListening.listeningBars(m.id).map { it.toFloat() } }
    Column(Modifier.width(252.dp).padding(start = 10.dp, end = 10.dp, top = 8.dp, bottom = 6.dp).semantics { contentDescription = "Hidden message. $LISTENING_HINT" }) {
        m.reply_to?.let { r -> Text("↩ ${r.sender.name ?: ""}", fontSize = 12.sp, color = c.metaTheirs, maxLines = 1, modifier = Modifier.padding(bottom = 4.dp)) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(38.dp).clip(CircleShape).background(accent.copy(alpha = if (playing) 0.22f else 0.14f)).testTag("chat-listening-play"),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    loading -> CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = accent)
                    playing -> Text("■", color = accent, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    else -> Text("🎧", fontSize = 17.sp)
                }
            }
            Spacer(Modifier.width(8.dp))
            ListeningBars(bars, playing, l.playNonce, accent, fg.copy(alpha = 0.32f), Modifier.weight(1f).height(30.dp).testTag(if (playing) "chat-listening-bars-playing" else "chat-listening-bars"))
        }
        Row(Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(l.durationLabel(m), fontSize = 12.sp, color = c.metaTheirs, modifier = Modifier.testTag("chat-listening-duration"))
            Spacer(Modifier.width(6.dp))
            SlowChip(l.slow, actions.onListeningSlow)
            Spacer(Modifier.weight(1f))
            meta?.let { Text(it, fontSize = 11.sp, lineHeight = 13.sp, maxLines = 1) }
        }
        Text(LISTENING_HINT, fontSize = 12.sp, color = c.metaTheirs, modifier = Modifier.padding(top = 2.dp).testTag("chat-listening-hint"))
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
