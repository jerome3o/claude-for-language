package dev.jeromeswannack.chineselearning.lab.core

/**
 * Hard mode — a port of shared/study/hardMode.ts, parity-tested (parity/fixtures/hard-mode.ts →
 * HardModeParityTest). docs/STUDY_SESSION.md "Hard mode".
 *
 * question → his answer checked AT ONCE (✓ Right / ✗ Not quite — 🔁 Try again, 👁 Show answer) →
 * once right, the Sentence round ([SentenceRound]) → the answer side. Giving up is a miss: the answer
 * side at once, no round, Good / Easy locked on this showing. Off · Red cards only (learning /
 * relearning) · All cards, per device (StudyPrefs.hardMode).
 */
object HardMode {
    const val OFF = "off"
    const val RED = "red"
    const val ALL = "all"
    val MODES = listOf(OFF, RED, ALL)
    const val DEFAULT = OFF

    /** `parseHardMode`: the old switch ('1' / '0', true) reads as All cards / Off. */
    fun parse(raw: String?): String = when (raw) {
        OFF, RED, ALL -> raw
        "1", "true" -> ALL
        else -> DEFAULT
    }

    /** `nextHardMode`: Off → Red cards only → All cards → Off. */
    fun next(mode: String): String = MODES[(MODES.indexOf(mode) + 1).mod(MODES.size)]

    /** `isRedCard`: learning or relearning (the header's red count; every card rated Again today). */
    fun isRedCard(queue: Int?): Boolean = queue == CardQueue.LEARNING || queue == CardQueue.RELEARNING

    /** `hardModeApplies` */
    fun applies(mode: String, cardType: String, queue: Int?): Boolean {
        if (mode == OFF || cardType !in SentencePractise.GATE_CARD_TYPES) return false
        return mode == ALL || isRedCard(queue)
    }

    /**
     * `hardModeQuestionResult`: "right" | "close" | "wrong" | "checking" | "unknown"; null = nothing tried.
     * [takeStatus]: null (no take) | "checking" | "unknown" | "done" (then [takeMatch] / [takeContains]).
     */
    fun questionResult(answerVerdict: AnswerKey.Verdict?, takeStatus: String? = null, takeMatch: Boolean = false, takeContains: Boolean = false): String? {
        if (answerVerdict != null) return when (answerVerdict) {
            AnswerKey.Verdict.WRONG -> "wrong"
            AnswerKey.Verdict.CLOSE -> "close"
            else -> "right"
        }
        return when (takeStatus) {
            null -> null
            "done" -> if (takeMatch || takeContains) "right" else "wrong"
            else -> takeStatus
        }
    }

    /** `hardModeRoundFollows` */
    fun roundFollows(result: String?, sentenceCount: Int?): Boolean =
        (result == "right" || result == "unknown") && (sentenceCount == null || sentenceCount > 0)

    const val RIGHT_BEAT_MS = 1500L

    data class Lock(val locked: Boolean, val label: String?, val blockedNote: String, val gaveUp: Boolean)

    /** `hardModeLock` */
    fun lock(gate: SentencePractise.Gate, gaveUp: Boolean, gateLabel: String?, gateBlockedNote: String): Lock =
        if (gaveUp) Lock(true, GAVE_UP_LINE, GAVE_UP_BLOCKED, true) else Lock(gate.locked, gateLabel, gateBlockedNote, false)

    // --- words ------------------------------------------------------------------------------------

    const val TITLE = "Hard mode"
    const val DESCRIPTION = "Your answer is checked first — try again until it’s right — then a round of harder sentence questions comes before the answer side."
    val OPTION = mapOf(OFF to "Off", RED to "Red cards only", ALL to "All cards")
    val OPTION_HINT = mapOf(OFF to "Straight to the answer, as usual", RED to "Only the cards you’re struggling with (the red ones)", ALL to "Every reading and meaning card")
    val CHIP = mapOf(OFF to "🎯 Off", RED to "🎯 Red", ALL to "🎯 All")
    fun chipLabel(mode: String) = "$TITLE: ${OPTION.getValue(mode)}"
    val RESULT = mapOf("right" to "✓ Right", "close" to "≈ Nearly", "wrong" to "✗ Not quite")
    const val CHECKING = "Checking what you said…"
    const val UNKNOWN = "Couldn’t check your answer"
    const val TRY_AGAIN = "Try again"
    const val SHOW_ANSWER = "Show answer"
    const val MISS_NOTE = "Showing the answer counts as a miss — Again or Hard."
    fun nextLabel(roundFollows: Boolean) = if (roundFollows) "Next: harder questions" else "See the answer"
    fun saidLine(said: String, spoken: Boolean) = "${if (spoken) "You said" else "Your answer"}: $said"
    const val GAVE_UP_LINE = "👁 You looked at the answer — Again or Hard this time"
    const val GAVE_UP_BLOCKED = "You looked at the answer before getting it right, so Good and Easy stay locked on this card — Again or Hard."
}
