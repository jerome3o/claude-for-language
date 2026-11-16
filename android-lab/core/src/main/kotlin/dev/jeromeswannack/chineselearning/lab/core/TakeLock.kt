package dev.jeromeswannack.chineselearning.lab.core

/**
 * The take lock — a port of shared/voice/takeLock.ts, parity-tested (parity/fixtures/take-lock.ts → TakeLockParityTest).
 *
 * While a voice take is RECORDING, nothing on screen may move the learner on: the screen's primary action (Check /
 * Next / Continue / Done / Skip) becomes the big red "■ Stop recording" in the same place — tapping it stops the take,
 * never advances; "Checking what you said…" while the take is judged; back / ✕ stop a recording take first. Jerome
 * (Nov 2026, a mini lesson): the tap meant to stop the recording pressed Next and skipped the exercise.
 *
 * Phases: "idle" | "recording" | "checking". Used by the mini-lesson player (app ui/kit/TakeLock.kt); neutral so any
 * other screen that records can use it.
 */
object TakeLock {
    const val IDLE = "idle"
    const val RECORDING = "recording"
    const val CHECKING = "checking"
    val PHASES = listOf(IDLE, RECORDING, CHECKING)

    /** One take's phase from its recorder's flags (recording wins). */
    fun phase(recording: Boolean, checking: Boolean): String = when {
        recording -> RECORDING
        checking -> CHECKING
        else -> IDLE
    }

    /** Several takes on one screen: recording > checking > idle. */
    fun combine(phases: Iterable<String>): String {
        var out = IDLE
        for (p in phases) {
            if (p == RECORDING) return RECORDING
            if (p == CHECKING) out = CHECKING
        }
        return out
    }

    /** What the primary action shows: "proceed" (itself) | "stop" | "checking". */
    fun footer(phase: String): String = when (phase) {
        RECORDING -> "stop"
        CHECKING -> "checking"
        else -> "proceed"
    }

    /** May the screen move on (advance, submit, skip) right now? */
    fun mayProceed(phase: String): Boolean = phase == IDLE

    /** Back / ✕: "leave", or "stop_take" first while recording. */
    fun leave(phase: String): String = if (phase == RECORDING) "stop_take" else "leave"

    const val STOP = "Stop recording"
    const val CHECKING_LINE = "Checking what you said…"
}
