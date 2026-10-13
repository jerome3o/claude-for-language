package dev.jeromeswannack.chineselearning.lab.ui.calls

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.jeromeswannack.chineselearning.lab.core.calls.CallChime
import dev.jeromeswannack.chineselearning.lab.core.calls.CallTimer
import dev.jeromeswannack.chineselearning.lab.ui.theme.Lab
import dev.jeromeswannack.chineselearning.lab.ui.kit.bouncyClickable

/**
 * The call timer (core CallTimer, web components/calls/CallTimerPill.tsx) and the presence toasts
 * (core CallChime): a pill "⏱ 4:59" in the top bar both people see; the tutor (solo: the caller)
 * opens a sheet to set a countdown (1 / 2 / 3 / 5 / 10 min or a typed length) or a stopwatch and to
 * start / pause / reset it; the student's sheet is read-only. At zero the pill flashes and "⏱ Time's
 * up" shows; "Minghui joined" / "… left" show as toasts.
 */
data class TimerActions(
    val onAction: (CallTimer.Action) -> Unit = {},
    val onDismissTimeUp: () -> Unit = {},
    val onDismissToast: (Long) -> Unit = {},
    val onSounds: (Boolean) -> Unit = {},
    /** The room's clock on this phone (CallController.roomNow). */
    val roomNow: () -> Long = System::currentTimeMillis,
    /** ⋯ → ⏱ Timer (the screen opens the sheet). */
    val onOpenTimer: () -> Unit = {},
)

/** Ticks the room's clock while [running] (4× a second), else reads it once. */
@Composable
private fun rememberRoomNow(roomNow: () -> Long, running: Boolean, key: Any?): Long {
    var now by remember { mutableLongStateOf(roomNow()) }
    LaunchedEffect(running, key) {
        now = roomNow()
        while (running) {
            kotlinx.coroutines.delay(250)
            now = roomNow()
        }
    }
    return now
}

/** The top bar's pill: the time (or ⏱ alone for the tutor before a timer is set). Nothing for the student without a timer. */
@Composable
fun CallTimerPill(timer: CallTimer.Timer?, runsTimer: Boolean, flashing: Boolean, roomNow: () -> Long, modifier: Modifier = Modifier, onClick: () -> Unit) {
    if (timer == null && !runsTimer) return
    val now = rememberRoomNow(roomNow, timer?.running == true || flashing, timer)
    val done = timer != null && CallTimer.timerDone(timer, now)
    val flash = rememberInfiniteTransition(label = "timer-flash")
    val pulse by flash.animateFloat(0f, 1f, infiniteRepeatable(tween(500), RepeatMode.Reverse), label = "timer-pulse")
    val bg by animateColorAsState(
        when {
            timer == null -> Color(0x14FFFFFF)
            done && flashing -> androidx.compose.ui.graphics.lerp(Color(0xFFB91C1C), Color(0xFFF59E0B), pulse)
            done -> Color(0xFFB91C1C)
            else -> Color(0x2EF59E0B)
        },
        label = "timer-bg",
    )
    Row(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(bg)
            .border(1.dp, if (timer == null) Color(0x33FFFFFF) else Color(0x73FDE68A), RoundedCornerShape(999.dp))
            .semantics { contentDescription = timer?.let { CallTimer.timerAria(it, now) } ?: "Timer" }
            .bouncyClickable(onClick = onClick)
            .testTag("call-timer-pill")
            .heightIn(min = 36.dp)
            .padding(horizontal = 10.dp, vertical = 7.dp)
            .alpha(if (timer != null && !timer.running && !done) 0.75f else 1f),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text("⏱", fontSize = 14.sp)
        if (timer != null) Text(
            if (done) CallTimer.TIMER_UP_LABEL else CallTimer.timerLabel(timer, now),
            color = if (done) Color.White else Color(0xFFFEF3C7), fontSize = 14.sp, fontWeight = FontWeight.Bold,
            style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"),
        )
    }
}

/** The sheet behind the pill: the time big, who set it, and (the tutor) the controls / a new timer. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ColumnScope.CallTimerSheet(timer: CallTimer.Timer?, runsTimer: Boolean, myUserId: String, actions: TimerActions, close: () -> Unit, initialSetup: Boolean = false) {
    var setup by remember { mutableStateOf(initialSetup || timer == null) }
    var countdown by remember { mutableStateOf(true) }
    var custom by remember { mutableStateOf("") }
    val now = rememberRoomNow(actions.roomNow, timer?.running == true, timer)
    val act: (CallTimer.Action) -> Unit = { a -> actions.onAction(a); if (a is CallTimer.Action.Set) { setup = false; close() } }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (timer != null && !(runsTimer && setup)) {
            val done = CallTimer.timerDone(timer, now)
            Text(
                CallTimer.timerLabel(timer, now), fontSize = 56.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center,
                color = if (done) Color(0xFFDC2626) else Lab.colors.ink, style = androidx.compose.ui.text.TextStyle(fontFeatureSettings = "tnum"),
                modifier = Modifier.fillMaxWidth().testTag("call-timer-big"),
            )
            Text(CallTimer.timerByLine(timer, myUserId, now), color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            if (runsTimer) FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (timer.running && !done) TimerButton("⏸ Pause", primary = true, tag = "timer-pause") { act(CallTimer.Action.Pause) }
                else TimerButton(if (done) "▶ Again" else "▶ Start", primary = true, tag = "timer-start") { act(CallTimer.Action.Start) }
                TimerButton("↺ Reset", tag = "timer-reset") { act(CallTimer.Action.Reset) }
                TimerButton("New timer", tag = "timer-new") { setup = true }
                TimerButton("✕ Remove", tag = "timer-clear") { act(CallTimer.Action.Clear); close() }
            } else Text("Only your tutor can start or stop it.", color = Lab.colors.muted, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        }
        if (runsTimer && (setup || timer == null)) {
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(999.dp)).background(Lab.colors.muted.copy(alpha = 0.12f)).padding(3.dp)) {
                for (cd in listOf(true, false)) {
                    Text(
                        if (cd) CallTimer.TIMER_COUNTDOWN_LABEL else CallTimer.TIMER_STOPWATCH_LABEL,
                        fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, color = if (countdown == cd) Lab.colors.ink else Lab.colors.muted,
                        modifier = Modifier.weight(1f).clip(RoundedCornerShape(999.dp)).background(if (countdown == cd) Lab.colors.card else Color.Transparent)
                            .bouncyClickable { countdown = cd }.testTag(if (cd) "timer-mode-countdown" else "timer-mode-stopwatch").padding(vertical = 10.dp),
                    )
                }
            }
            if (countdown) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (m in CallTimer.TIMER_PRESET_MINUTES) {
                        Text(
                            CallTimer.minutesLabel(m * 60_000L), fontWeight = FontWeight.Bold, fontSize = 14.sp, textAlign = TextAlign.Center, color = Lab.colors.ink,
                            modifier = Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).border(1.dp, Lab.colors.muted.copy(alpha = 0.35f), RoundedCornerShape(12.dp))
                                .bouncyClickable { act(CallTimer.Action.Set(CallTimer.Mode.COUNTDOWN, m * 60_000L, start = true)) }
                                .testTag("timer-preset-$m").heightIn(min = 48.dp).padding(vertical = 14.dp),
                        )
                    }
                }
                val ms = CallTimer.parseTimerInput(custom)
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        custom, { custom = it }, Modifier.weight(1f).testTag("timer-custom"), singleLine = true,
                        placeholder = { Text("Other: 7 or 1:30") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { if (ms != null) act(CallTimer.Action.Set(CallTimer.Mode.COUNTDOWN, ms, start = true)) }),
                    )
                    TimerButton(if (ms != null) "▶ ${CallTimer.minutesLabel(ms)}" else "▶ Start", primary = true, enabled = ms != null, tag = "timer-custom-start") {
                        if (ms != null) act(CallTimer.Action.Set(CallTimer.Mode.COUNTDOWN, ms, start = true))
                    }
                }
            } else TimerButton("▶ Start the stopwatch", primary = true, tag = "timer-stopwatch-start", modifier = Modifier.fillMaxWidth()) {
                act(CallTimer.Action.Set(CallTimer.Mode.STOPWATCH, start = true))
            }
            Text("Both of you see it; a soft bell rings at zero.", color = Lab.colors.muted, fontSize = 12.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            if (timer != null) Text("‹ Back to the timer", color = Lab.colors.accent, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().bouncyClickable { setup = false }.padding(10.dp))
        }
    }
}

@Composable
private fun TimerButton(label: String, primary: Boolean = false, enabled: Boolean = true, tag: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        label, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center,
        color = if (primary) Color.White else Lab.colors.ink,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (primary) Lab.colors.accent.copy(alpha = if (enabled) 1f else 0.45f) else Lab.colors.muted.copy(alpha = 0.14f))
            .bouncyClickable(enabled = enabled, onClick = onClick)
            .testTag(tag)
            .heightIn(min = 44.dp)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

/** "⏱ Time's up" and "👋 Minghui joined" / "🚪 … left" over the stage, newest last. */
@Composable
fun CallToasts(timeUp: BoardNotice?, toasts: List<PresenceToast>, modifier: Modifier = Modifier, onDismissTimeUp: () -> Unit = {}, onDismiss: (Long) -> Unit = {}) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AnimatedVisibility(timeUp != null, enter = fadeIn() + slideInVertically { -it }, exit = fadeOut() + slideOutVertically { -it }) {
            val n = remember(timeUp?.id) { timeUp } ?: return@AnimatedVisibility
            Toast(n.text, Color(0xF2B91C1C), "timer-up-toast", onDismissTimeUp)
        }
        for (t in toasts) {
            Toast(
                "${if (t.kind == CallChime.Kind.JOIN) "👋" else "🚪"} ${t.text}",
                if (t.kind == CallChime.Kind.JOIN) Color(0xEB065F46) else Color(0xE0111827),
                "presence-toast-${t.kind.wire}",
            ) { onDismiss(t.id) }
        }
    }
}

@Composable
private fun Toast(text: String, bg: Color, tag: String, onClick: () -> Unit) {
    Text(
        text, color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.widthIn(max = 360.dp).clip(RoundedCornerShape(999.dp)).background(bg).bouncyClickable(onClick = onClick).testTag(tag).padding(horizontal = 16.dp, vertical = 9.dp),
    )
}
