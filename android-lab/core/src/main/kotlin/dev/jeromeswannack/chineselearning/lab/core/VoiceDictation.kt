package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/voice/dictation.ts — the rules of a voice-first text box ("say it, or type it"):
 * voice is the default (typing one tap away), the study cards' row per phase (✏️ Type · 🎤 Say it →
 * ✕ Cancel · ⏹ Stop → 🔁 Retry · ✏️ Edit · ✓ Submit), typing with a reason when speaking is off, what
 * Submit sends and where it came from. The app's `VoiceTextField` (ui/kit) renders from it.
 * Parity-tested against the TypeScript (`parity/fixtures/voice-dictation.ts` → `VoiceDictationParityTest`).
 */
object VoiceDictation {
    /** DictationMode. */
    const val VOICE = "voice"
    const val TYPE = "type"

    /** DictationPhase: idle | listening | finishing | review | failed. */
    val PHASES: List<String> = listOf("idle", "listening", "finishing", "review", "failed")

    /** DictationFailure: failed | offline | empty. */
    val FAILURES: List<String> = listOf("failed", "offline", "empty")

    /** VOICE_BLOCKS: why speaking is off. */
    val BLOCKS: List<String> = listOf("offline", "denied", "no_mic", "unsupported", "mic_error")

    data class State(
        val mode: String = VOICE,
        val phase: String = "idle",
        val failure: String? = null,
        val blocked: String? = null,
    )

    data class Answer(val text: String, val source: String)

    /** initialDictationMode. */
    fun initialMode(defaultMode: String?, blocked: String?): String =
        if (blocked != null) TYPE else if (defaultMode == TYPE) TYPE else VOICE

    /** voiceButtonShown. */
    fun voiceButtonShown(blocked: String?): Boolean = blocked != "offline" && blocked != "unsupported"

    /** dictationControls: the row, left to right. */
    fun controls(s: State): List<String> {
        if (s.mode == TYPE || s.blocked != null) {
            return if (voiceButtonShown(s.blocked)) listOf("mic", "submit_typed") else listOf("submit_typed")
        }
        return when (s.phase) {
            "listening" -> listOf("cancel", "stop")
            "finishing" -> listOf("cancel", "finishing")
            "review" -> listOf("retake", "edit", "submit")
            "failed" -> if (s.failure == "empty") listOf("type", "retake") else listOf("retry_upload", "type", "retake")
            else -> listOf("type", "say")
        }
    }

    private val LATIN = Regex("[A-Za-z0-9\\u00C0-\\u024F]")

    /** joinDictation: a take joined onto text typed before it. */
    fun join(existing: String, transcript: String): String {
        val a = AnswerKey.jsTrim(existing)
        val b = AnswerKey.jsTrim(transcript)
        if (a.isEmpty()) return b
        if (b.isEmpty()) return a
        val last = a.substring(a.length - 1)
        val first = b.substring(0, 1)
        return if (LATIN.matches(last) && LATIN.matches(first)) "$a $b" else "$a$b"
    }

    /** dictationSource: spoken | edited | typed. */
    fun source(text: String, filled: String?): String = when {
        filled == null -> "typed"
        AnswerKey.jsTrim(text) == AnswerKey.jsTrim(filled) -> "spoken"
        else -> "edited"
    }

    /** dictationAnswer: what Submit sends, or null (Submit disabled). */
    fun answer(s: State, transcript: String, typed: String, filled: String?): Answer? {
        if (s.mode == VOICE && s.blocked == null) {
            if (s.phase != "review") return null
            val text = AnswerKey.jsTrim(transcript)
            return if (text.isEmpty()) null else Answer(text, "spoken")
        }
        val text = AnswerKey.jsTrim(typed)
        return if (text.isEmpty()) null else Answer(text, source(text, filled))
    }

    /** micErrorBlock. */
    fun micErrorBlock(name: String?): String = when (AnswerKey.jsTrim(name ?: "")) {
        "NotAllowedError", "PermissionDeniedError", "SecurityError", "denied" -> "denied"
        "NotFoundError", "DevicesNotFoundError", "OverconstrainedError", "no_mic" -> "no_mic"
        "unsupported", "NotSupportedError" -> "unsupported"
        else -> "mic_error"
    }

    /** voiceBlockReason. */
    fun blockReason(blocked: String): String = when (blocked) {
        "offline" -> "Offline — type your answer. Speaking needs a connection."
        "denied" -> "Microphone blocked — type your answer, or allow the microphone and tap 🎤."
        "no_mic" -> "No microphone found — type your answer."
        "unsupported" -> "Speaking isn’t available here — type your answer."
        else -> "Couldn’t open the microphone — type your answer, or tap 🎤 to try again."
    }

    /** DICTATION_COPY. */
    object Copy {
        const val SAY = "Say it"
        const val TYPE = "Type"
        const val CANCEL = "Cancel"
        const val STOP = "Stop"
        const val FINISHING = "Finishing…"
        const val RETAKE = "Retry"
        const val EDIT = "Edit"
        const val SUBMIT = "Submit"
        const val LISTENING = "Listening… say it"
        const val EMPTY = "Didn’t catch anything — tap Retry to try again, or type it."
        const val FAILED = "Couldn’t transcribe — tap to retry"
        const val FAILED_NOTE = "Or type your answer"
        const val OFFLINE = "You went offline — type it, or try again when you’re back online."
        const val MIC_LABEL = "Say it instead"

        /** In the TS object's order, for the parity test. */
        val ALL: Map<String, String> = linkedMapOf(
            "say" to SAY, "type" to TYPE, "cancel" to CANCEL, "stop" to STOP, "finishing" to FINISHING,
            "retake" to RETAKE, "edit" to EDIT, "submit" to SUBMIT, "listening" to LISTENING, "empty" to EMPTY,
            "failed" to FAILED, "failedNote" to FAILED_NOTE, "offline" to OFFLINE, "micLabel" to MIC_LABEL,
        )
    }

    /** dictationOutcome: the controller's result → `voice_input.used` outcome (null = not reported). */
    fun outcome(result: String): String? = when (result) {
        "submitted", "retaken", "failed", "empty", "cancelled" -> result
        "filled" -> "edit"
        else -> null
    }

    /** typedOutcome. */
    fun typedOutcome(source: String): String = when (source) {
        "typed" -> "typed"
        "edited" -> "edited"
        else -> "submitted"
    }

    /** dictationLanguageHints. */
    fun languageHints(lang: String?): List<String> = if (lang == "en") listOf("en", "zh") else listOf("zh", "en")
}
