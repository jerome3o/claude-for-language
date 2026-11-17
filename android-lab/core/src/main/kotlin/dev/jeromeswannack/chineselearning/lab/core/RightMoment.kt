package dev.jeromeswannack.chineselearning.lab.core

/**
 * The "right" moment on the study card — port of shared/study/rightMoment.ts (parity-tested, `moments` in
 * parity/fixtures/hard-mode.ts). ONE moment everywhere a study-card answer is judged right: Hard mode's question,
 * each Sentence round exercise, a 🎤 take on a sentence row, a typed answer judged right on the answer side. A soft
 * green wash that settles to the green result surface ([ResultState]), a SMALL confetti burst, the StudyFeel. Small
 * each time; the round's last right exercise a little bigger. Reduce motion: no confetti, no animation.
 */
object RightMoment {
    const val QUESTION = "question"
    const val ROUND_EXERCISE = "round_exercise"
    const val SENTENCE_ROW = "sentence_row"
    const val TYPED_ANSWER = "typed_answer"
    val WHERE = listOf(QUESTION, ROUND_EXERCISE, SENTENCE_ROW, TYPED_ANSWER)

    const val PIECES = 12
    const val MS = 700
    const val DONE_PIECES = 20
    const val DONE_MS = 850

    data class Moment(val feel: String?, val confetti: Int, val durationMs: Int, val animate: Boolean)

    fun of(where: String, roundDone: Boolean = false, reduceMotion: Boolean = false, celebrated: Boolean = false): Moment {
        val done = where == ROUND_EXERCISE && roundDone
        val feel = when {
            where == QUESTION || where == TYPED_ANSWER -> HardMode.FEEL_SUCCESS
            done -> HardMode.FEEL_ROUND_DONE
            else -> HardMode.FEEL_ROUND_RIGHT
        }
        val pieces = if (done) DONE_PIECES else if (where == SENTENCE_ROW) PIECES - 2 else PIECES
        val ms = if (done) DONE_MS else MS
        if (celebrated) return Moment(null, 0, ms, false)
        if (reduceMotion) return Moment(feel, 0, ms, false)
        return Moment(feel, pieces, ms, true)
    }
}

/**
 * ONE look for every judged result — port of shared/study/resultState.ts (parity-tested, `resultStates`): four states
 * (right ✓ · close ≈ · wrong ✗ · pending …), one colour + one icon each, and ONE surface for all of them (a light 1dp
 * outline in the state colour at [SURFACE_BORDER], a faint tint at [SURFACE_TINT], [SURFACE_RADIUS] corners). The app's
 * `ResultSurface` (ui/study/ResultStateUi.kt) draws it everywhere a verdict is shown.
 */
object ResultState {
    const val RIGHT = "right"
    const val CLOSE = "close"
    const val WRONG = "wrong"
    const val PENDING = "pending"
    val STATES = listOf(RIGHT, CLOSE, WRONG, PENDING)
    val ICON = mapOf(RIGHT to "✓", CLOSE to "≈", WRONG to "✗", PENDING to "…")

    const val SURFACE_BORDER = 0.35f
    const val SURFACE_TINT = 0.08f
    const val SURFACE_BORDER_WIDTH = 1
    const val SURFACE_RADIUS = 10

    private val RIGHT_WORDS = setOf(
        "right", "match", "exact", "correct", "acceptable", "equivalent", "alternative", "punctuation_only",
        "sounds_right", "sounded_right", "sound", "homophone", "accepted", "got_it", "all_right",
    )
    private val CLOSE_WORDS = setOf("close", "contains", "almost", "nearly", "needs_work", "partial", "tones_off", "tone", "near")
    private val WRONG_WORDS = setOf("wrong", "miss", "missed", "incorrect", "didnt_match", "no_match", "failed", "missed_it")

    /** A verdict (any surface's word for it) → its state; anything unknown / waiting → pending. */
    fun of(verdict: String?): String {
        val v = verdict.orEmpty().trim().lowercase()
        return when (v) {
            in RIGHT_WORDS -> RIGHT
            in CLOSE_WORDS -> CLOSE
            in WRONG_WORDS -> WRONG
            else -> PENDING
        }
    }
}
