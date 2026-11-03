package dev.jeromeswannack.chineselearning.lab.core

/**
 * Hard mode — a port of shared/study/hardMode.ts, parity-tested (parity/fixtures/hard-mode.ts →
 * HardModeParityTest). docs/STUDY_SESSION.md "Hard mode".
 *
 * question → his answer checked AT ONCE (✓ Right / ✗ Not quite — 🔁 Try again, 👁 Show answer) →
 * once right, the Sentence round ([SentenceRound]; the listening card's: "say it in Chinese") → the
 * answer side. Giving up is a miss: the answer side at once, no round, Good / Easy GREYED on this
 * showing — a second tap still rates ([overrideTap]). Off · Red cards only (learning / relearning) ·
 * All cards, per device (StudyPrefs.hardMode). A right answer is felt ([questionFeel], fx/Haptics.success).
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

    /** `hardModeGiveUpInPlace`: 👁 Show answer → the answer in place on the question, then the round; no sentences → the answer side. */
    fun giveUpInPlace(sentenceCount: Int?): Boolean = sentenceCount == null || sentenceCount > 0

    const val RIGHT_BEAT_MS = 1500L

    /** `GoodEasyGate`: state "open" | "suggest_lower"; reason "gave_up" | "sentences" | null. */
    data class GoodEasy(val state: String, val reason: String?, val label: String?, val gaveUp: Boolean) {
        val suggestLower: Boolean get() = state == SUGGEST_LOWER
    }
    const val OPEN = "open"
    const val SUGGEST_LOWER = "suggest_lower"

    /** `goodEasyGate`: gave up → greyed whatever the sentences say; else the sentence gate. Never locked. */
    fun goodEasy(gate: SentencePractise.Gate, gaveUp: Boolean, gateLabel: String?): GoodEasy =
        if (gaveUp) GoodEasy(SUGGEST_LOWER, "gave_up", GAVE_UP_LINE, true)
        else GoodEasy(if (gate.locked) SUGGEST_LOWER else OPEN, if (gate.locked) "sentences" else null, gateLabel, false)

    /** `ratingNeedsOverride`: a greyed Good (2) / Easy (3) needs a second tap. */
    fun needsOverride(rating: Int, g: GoodEasy): Boolean = g.suggestLower && rating >= 2

    /** `suggestedRating`: Hard (1) while Good / Easy are greyed. */
    fun suggestedRating(g: GoodEasy): Int? = if (g.suggestLower) 1 else null

    const val OVERRIDE_MS = 3000L

    /** `OverrideArm` */
    data class Arm(val rating: Int, val at: Long)
    /** `OverrideTap` */
    data class Tap(val rate: Boolean, val override: Boolean, val armed: Arm?)

    /** `overrideTap`: first tap on a greyed rating arms it; the same rating again within [OVERRIDE_MS] rates. */
    fun overrideTap(needsOverride: Boolean, rating: Int, armed: Arm?, now: Long): Tap {
        if (!needsOverride) return Tap(rate = true, override = false, armed = null)
        if (armed != null && armed.rating == rating && now - armed.at >= 0 && now - armed.at <= OVERRIDE_MS) return Tap(rate = true, override = true, armed = null)
        return Tap(rate = false, override = false, armed = Arm(rating, now))
    }

    private val RATING_NAME = mapOf(0 to "Again", 1 to "Hard", 2 to "Good", 3 to "Easy")

    /** `overridePrompt`: "Tap again to rate Good anyway". */
    fun overridePrompt(rating: Int) = "Tap again to rate ${RATING_NAME[rating] ?: "it"} anyway"

    const val SUGGESTED = "suggested"
    const val TAP_TWICE = "tap twice"
    const val TAP_AGAIN = "tap again"

    // --- the feel -----------------------------------------------------------------------------------

    /** `StudyFeel` values. */
    const val FEEL_SUCCESS = "success"
    const val FEEL_ROUND_RIGHT = "round_right"
    const val FEEL_ROUND_DONE = "round_done"
    const val FEEL_NEARLY = "nearly"
    const val FEEL_MISS = "miss"

    /** `hardModeQuestionFeel` */
    fun questionFeel(result: String?): String? = when (result) {
        "right" -> FEEL_SUCCESS
        "close" -> FEEL_NEARLY
        "wrong" -> FEEL_MISS
        else -> null
    }

    /** `roundTakeFeel`: [done] = this take made the round's count. */
    fun roundTakeFeel(result: String, done: Boolean): String? = when (result) {
        "right" -> if (done) FEEL_ROUND_DONE else FEEL_ROUND_RIGHT
        "close" -> FEEL_NEARLY
        "wrong" -> FEEL_MISS
        else -> null
    }

    /** `STUDY_FEEL_VIBRATION` (the web's navigator.vibrate patterns; the Lab composes primitives, this is the fallback waveform). */
    val FEEL_VIBRATION: Map<String, List<Long>> = mapOf(
        FEEL_SUCCESS to listOf(40L, 70L, 60L),
        FEEL_ROUND_RIGHT to listOf(35L, 60L, 50L),
        FEEL_ROUND_DONE to listOf(40L, 60L, 40L, 60L, 110L),
        FEEL_NEARLY to listOf(25L),
        FEEL_MISS to listOf(30L, 80L, 30L),
    )

    // --- words ------------------------------------------------------------------------------------

    const val TITLE = "Hard mode"
    const val DESCRIPTION = "Your answer is checked first — try again until it’s right — then a round of harder sentence questions comes before the answer side."
    val OPTION = mapOf(OFF to "Off", RED to "Red cards only", ALL to "All cards")
    val OPTION_HINT = mapOf(OFF to "Straight to the answer, as usual", RED to "Only the cards you’re struggling with (the red ones)", ALL to "Every reading, meaning and listening card")
    val CHIP = mapOf(OFF to "🎯 Off", RED to "🎯 Red", ALL to "🎯 All")
    fun chipLabel(mode: String) = "$TITLE: ${OPTION.getValue(mode)}"
    val RESULT = mapOf("right" to "✓ Right", "close" to "≈ Nearly", "wrong" to "✗ Not quite")
    const val CHECKING = "Checking what you said…"
    const val UNKNOWN = "Couldn’t check your answer"
    const val TRY_AGAIN = "Try again"
    const val SHOW_ANSWER = "Show answer"
    const val MISS_NOTE = "Showing the answer counts as a miss — Again or Hard suggested."
    fun nextLabel(roundFollows: Boolean) = if (roundFollows) "Next: harder questions" else "See the answer"
    fun saidLine(said: String, spoken: Boolean) = "${if (spoken) "You said" else "Your answer"}: $said"
    const val GAVE_UP_LINE = "👁 You looked at the answer — Again or Hard suggested"
    const val REVEALED_TITLE = "👁 The answer"
    const val REVEALED_NOTE = "You looked, so this one counts as a miss — the sentences are still worth doing."
    /** `hardModeRevealedNextLabel` */
    fun revealedNextLabel(roundFollows: Boolean) = if (roundFollows) "Continue to the sentences" else "See the full answer"
    const val GAVE_UP_SKIP_NOTE = "You looked at the answer, so Again or Hard is suggested whatever the sentences say."
    /** `hardModeGaveUpCheer` */
    fun gaveUpCheer(got: Int, needed: Int) = "🎉 $got / $needed — nice recovery"
}
