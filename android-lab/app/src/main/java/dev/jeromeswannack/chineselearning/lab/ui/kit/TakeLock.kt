package dev.jeromeswannack.chineselearning.lab.ui.kit

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import dev.jeromeswannack.chineselearning.lab.core.TakeLock
import dev.jeromeswannack.chineselearning.lab.ui.readers.ReadAloudStopFooter
import java.util.UUID

/**
 * The take lock's registry (web services/takeLock.ts; rules core [TakeLock], docs/STUDY_SESSION.md "While a take
 * is recording"): every voice take on screen reports its phase here, and any control that advances, submits,
 * rates, closes or navigates asks first — while a take records, the control stops the take instead (and does
 * nothing else); while the stopped take is checked, it waits.
 *
 * - [rememberVoiceDictation] registers every voice-first box / 🎤 practice take by itself; the study card's own
 *   recorder (read take, Say the answer) registers from StudyRoute; anything else calls [RegisterTake].
 * - [TakeLocks.guard] wraps a handler (✕, Cancel, a rating, Next …) — decided at TAP time.
 * - [TakeLockedActions] = a row of buttons that gives way to ONE red "■ Stop recording" while a take is under way.
 * - [TakeBackGuard] (ShellFrame): system back stops a recording take instead of leaving.
 */
object TakeLocks {
    data class Entry(val phase: String, val stop: () -> Unit, val ownBack: Boolean = false)

    private val entries = mutableStateMapOf<String, Entry>()

    /** All takes on screen merged: idle | recording | checking (snapshot state — composables recompose on it). */
    val phase: String get() = TakeLock.merge(entries.values.map { it.phase })
    /** The same over the takes whose back [TakeBackGuard] handles. */
    val backPhase: String get() = TakeLock.merge(entries.values.filter { !it.ownBack }.map { it.phase })
    val locked: Boolean get() = TakeLock.locked(phase)
    val recording: Boolean get() = phase == TakeLock.RECORDING

    fun set(id: String, entry: Entry?) {
        if (entry == null) entries.remove(id) else entries[id] = entry
    }

    /** Stop every take that records (kept and checked as usual). */
    fun stop(backOnly: Boolean = false) {
        entries.values.toList().forEach { e ->
            if (backOnly && e.ownBack) return@forEach
            if (TakeLock.phase(e.phase) == TakeLock.RECORDING) e.stop()
        }
    }

    /** What a tap does now: "run", "stop" (the take was stopped instead) or "wait" (being checked). */
    fun tap(): String {
        val g = TakeLock.guard(phase)
        if (g == "stop") stop()
        return g
    }

    /** [action], unless a take is under way: then a tap stops it (or waits for its check) and does nothing else. */
    fun guard(action: () -> Unit): () -> Unit = { if (tap() == "run") action() }

    /** Tests / previews: forget every take. */
    fun reset() = entries.clear()
}

/** Report a take from a composable: its phase as it changes; removed when it leaves composition. */
@Composable
fun RegisterTake(phase: String, ownBack: Boolean = false, stop: () -> Unit) {
    val id = remember { UUID.randomUUID().toString() }
    val currentStop = rememberUpdatedState(stop)
    // Written only when the phase changes (never on every recomposition: a screen that registers AND reads the
    // lock would otherwise recompose itself forever).
    val entry = remember(phase, ownBack) { TakeLocks.Entry(phase, { currentStop.value() }, ownBack) }
    DisposableEffect(id, entry) {
        TakeLocks.set(id, entry)
        onDispose { TakeLocks.set(id, null) }
    }
}

/**
 * [content] (a row of advancing buttons: Next, Continue, the ratings, Got it, Cancel …) — or, while a take is
 * under way, ONE red "■ Stop recording" in their place (a thumb aimed at Next stops the take), then a held
 * "Checking what you said…" (the reader's / sentence rows' footer, [ReadAloudStopFooter]).
 */
@Composable
fun TakeLockedActions(modifier: Modifier = Modifier, stopTag: String = TakeLockTags.STOP, content: @Composable () -> Unit) {
    val footer = TakeLock.footer(TakeLocks.phase)
    if (footer == null) {
        content()
        return
    }
    Box(modifier.fillMaxWidth()) {
        ReadAloudStopFooter(
            recording = footer == "stop",
            onStop = { TakeLocks.stop() },
            label = TakeLock.STOP_RECORDING,
            checkingLabel = TakeLock.CHECKING_LABEL,
            footerTag = TakeLockTags.FOOTER,
            stopTag = stopTag,
        )
    }
}

/**
 * System back while a take records (or is checked) stops it / waits instead of leaving. Composed only while
 * locked, so its callback is the newest one and wins over the screen's own BackHandler. In ShellFrame.
 */
@Composable
fun TakeBackGuard() {
    if (TakeLock.locked(TakeLocks.backPhase)) {
        BackHandler { TakeLocks.stop(backOnly = true) }
    }
}

object TakeLockTags {
    const val FOOTER = "take-lock-footer"
    const val STOP = "take-stop"
}
