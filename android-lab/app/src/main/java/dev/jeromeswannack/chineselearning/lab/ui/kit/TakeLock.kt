package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.TakeLock
import dev.jeromeswannack.chineselearning.lab.data.analytics.Analytics
import dev.jeromeswannack.chineselearning.lab.ui.theme.Palette

/**
 * The take lock in the app (rules: core [TakeLock] = shared/voice/takeLock.ts; web components/voice/TakeLock.tsx):
 * while a voice take RECORDS, the screen's primary action row is ONE big red "■ Stop recording" that stops the take
 * and never advances; "Checking what you said…" while the take is judged; back / ✕ stop the take first.
 *
 * A screen that locks provides a [TakeLockState] through [LocalTakeLock] (the mini-lesson player). Every recorder
 * reports its take with [ReportTake] — [rememberVoiceDictation] (every voice box and 🎤 Say it again) and the
 * speaking answer do it already — and every action row asks [TakeLockState.footer] (the lessons' `ActionRow`).
 * Outside a provider nothing changes.
 */
class TakeLockState(private val screen: String = "lesson") {
    private class Entry(val phase: String, val stop: () -> Unit)
    private val takes = mutableStateMapOf<Any, Entry>()

    /** Every take on the screen, combined (recording > checking > idle). */
    val phase: String get() = TakeLock.combine(takes.values.map { it.phase })
    val footer: String get() = TakeLock.footer(phase)
    fun mayProceed(): Boolean = TakeLock.mayProceed(phase)

    fun report(key: Any, phase: String, stop: () -> Unit) {
        val cur = takes[key]
        if (cur == null || cur.phase != phase || cur.stop !== stop) takes[key] = Entry(phase, stop)
    }

    fun remove(key: Any) {
        takes.remove(key)
    }

    /** Stops every take that is recording; via = footer | leave | back | advance (analytics). */
    fun stop(via: String = "footer") {
        val recording = takes.values.filter { it.phase == TakeLock.RECORDING }
        recording.forEach { it.stop() }
        if (recording.isNotEmpty()) Analytics.track("voice.take_lock_stop", mapOf("via" to via, "screen" to screen))
    }

    /** ✕ / leave: stops a recording take instead, else [leave]. */
    fun guardLeave(leave: () -> Unit) {
        if (TakeLock.leave(phase) == "stop_take") stop("leave") else leave()
    }
}

val LocalTakeLock = compositionLocalOf<TakeLockState?> { null }

/** A recorder reports its take ([TakeLock.phase]); nothing happens outside a provider. */
@Composable
fun ReportTake(phase: String, stop: () -> Unit) {
    val lock = LocalTakeLock.current ?: return
    val key = remember { Any() }
    val onStop by rememberUpdatedState(stop)
    val stopper = remember { { onStop() } }
    LaunchedEffect(lock, phase) { lock.report(key, phase, stopper) }
    DisposableEffect(lock) { onDispose { lock.remove(key) } }
}

object TakeLockTags {
    const val STOP = "take-lock-stop"
    const val MUTED = "take-lock-muted"
}

/**
 * The action row's face while a take is under way: "■ Stop recording" (red, pulsing) or a quiet, untappable
 * "Checking what you said…" — the reader's read-aloud footer / the sentence rows' stop bar, inline.
 */
@Composable
fun TakeLockStopButton(recording: Boolean, onStop: () -> Unit, modifier: Modifier = Modifier) {
    val pulse = rememberInfiniteTransition(label = "takeLock")
    val glow by pulse.animateFloat(0f, if (recording) 1f else 0f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "glow")
    val red = Palette.Again
    val label = if (recording) TakeLock.STOP else TakeLock.CHECKING_LINE
    Row(
        modifier.fillMaxWidth().height(54.dp)
            .border(if (recording) (glow * 4f).dp else 0.dp, red.copy(alpha = 0.35f * (1f - glow * 0.5f)), RoundedCornerShape(27.dp))
            .clip(RoundedCornerShape(27.dp))
            .background(if (recording) red else red.copy(alpha = 0.16f))
            .bouncyClickable(recording, 0.97f, role = Role.Button, onClick = onStop)
            .semantics { contentDescription = label }
            .testTag(TakeLockTags.STOP),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (recording) {
            Box(Modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(Color.White))
            Spacer(Modifier.width(10.dp))
            Text(label, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        } else {
            CircularProgressIndicator(Modifier.size(18.dp), color = red, strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text(label, color = red, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }
    }
}
