package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/voice/takeLock.ts — the take lock (docs/STUDY_SESSION.md "While a take is recording"):
 * while a voice take records, nothing on the screen may advance, submit, rate, close or navigate. The
 * footer's primary action becomes a red "■ Stop recording" in the same place, ratings and other advancing
 * buttons are disabled, back / ✕ stop the take first; while the stopped take is checked they stay held.
 * Parity-tested (parity/fixtures/take-lock.ts → TakeLockParityTest).
 */
object TakeLock {
    const val IDLE = "idle"
    const val RECORDING = "recording"
    const val CHECKING = "checking"

    /** `takeLockPhase`: any recorder's own phase → idle | recording | checking. */
    fun phase(phase: String?): String = when ((phase ?: "").trim()) {
        "listening", "recording", "starting" -> RECORDING
        "finishing", "checking", "transcribing" -> CHECKING
        else -> IDLE
    }

    /** `mergeTakePhases`: recording wins over checking, checking over idle. */
    fun merge(phases: Iterable<String?>): String {
        var out = IDLE
        for (p in phases) {
            when (phase(p)) {
                RECORDING -> return RECORDING
                CHECKING -> out = CHECKING
            }
        }
        return out
    }

    /** `takeLocked`. */
    fun locked(phase: String?): Boolean = phase(phase) != IDLE

    /** `takeFooter`: "stop" while recording, "checking" while judged, null = the footer as usual. */
    fun footer(phase: String?): String? = when (phase(phase)) {
        RECORDING -> "stop"
        CHECKING -> "checking"
        else -> null
    }

    /** `takeGuard`: what a tap on an advancing control does — "run", "stop" the take instead, or "wait". */
    fun guard(phase: String?): String = when (phase(phase)) {
        RECORDING -> "stop"
        CHECKING -> "wait"
        else -> "run"
    }

    const val STOP_RECORDING = "Stop recording"
    const val CHECKING_LABEL = "Checking what you said…"
    const val LOCKED_HINT = "Stop the recording first"
}
