package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Hold it and show me what was different" — a port of shared/study/answerDifference.ts, parity-tested
 * (parity/fixtures/answer-difference.ts → AnswerDifferenceParityTest). docs/STUDY_SESSION.md "Right,
 * but said differently".
 *
 * In Hard mode's ladder (the question's own check and the Sentence round, in the study session and the
 * homework pass) an answer that is ACCEPTED but isn't the model / expected answer never goes on by
 * itself: it stays with "You said" vs the model answer (differences marked, pinyin of both, Claude's
 * tips / fix / alternative) and an explicit button on. Identical answers keep the quick ✓.
 */
object AnswerDifference {
    const val ACCEPTABLE = "acceptable"
    const val REWORDED = "reworded"
    const val HOMOPHONE = "homophone"
    const val ALTERNATIVE = "alternative"
    val REASONS = listOf(ACCEPTABLE, REWORDED, HOMOPHONE, ALTERNATIVE)

    /** `sameAnswerWords`: equal once punctuation, spaces, numbers ↔ hanzi and 两 / 二 are set aside. */
    fun sameWords(said: String, model: String): Boolean = AnswerKey.hanziAnswerKey(said) == AnswerKey.hanziAnswerKey(model)

    /**
     * `roundTakeDifference`: a Sentence round take right but not the model sentence → why; else null
     * (identical, not right, or a read take). [claude] = the answer check's verdict when there is one.
     */
    fun roundTake(mode: String, said: String, model: String, local: SpokenAnswerResult.State, claude: String?): String? {
        if (mode != SentencePractise.TRANSLATE) return null
        if (!claude.isNullOrEmpty()) {
            if (claude == "acceptable") return ACCEPTABLE
            if (claude == "correct") return if (sameWords(said, model)) null else REWORDED
            return null
        }
        if (local == SpokenAnswerResult.State.SOUND) return if (sameWords(said, model)) null else HOMOPHONE
        return null
    }

    /** `questionDifference`: Hard mode's question — a homophone or a listed alternative. */
    fun question(verdict: AnswerKey.Verdict?): String? = when (verdict) {
        AnswerKey.Verdict.SOUND -> HOMOPHONE
        AnswerKey.Verdict.ALTERNATIVE -> ALTERNATIVE
        else -> null
    }

    data class Lines(val said: List<SpokenAnswerResult.Cell>, val model: List<SpokenAnswerResult.Cell>)

    /** `differenceLines`: accepted → the differing characters `differs` on both lines; else his `wrong`, the model's `differs`. */
    fun lines(said: String, model: String, accepted: Boolean): Lines = Lines(
        SpokenAnswerResult.marks(said, model, if (accepted) SpokenAnswerResult.State.SOUND else SpokenAnswerResult.State.WRONG),
        SpokenAnswerResult.marks(model, said, SpokenAnswerResult.State.SOUND),
    )

    val TITLE = mapOf(
        ACCEPTABLE to "✓ Right — said differently from the model",
        REWORDED to "✓ Right — worded differently",
        HOMOPHONE to "✓ Sounded right — written differently",
        ALTERNATIVE to "✓ Right — the card writes it differently",
    )
    const val SAID = "You said"
    const val MODEL = "Model answer"
    const val CARD = "The card"
    const val HOLD_NOTE = "Have a look at the difference, then go on."
    const val CONTINUE = "Continue"
    /** `DIFFERENCE_SAY_AGAIN`: another take on an accepted round exercise (never takes the right back). */
    const val SAY_AGAIN = "Say it again"
}
