package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/**
 * Port of shared/lesson/feedback.ts — the feel of a mini-lesson answer screen (docs/STUDY_SESSION.md
 * "Mini lessons" → "Feedback"): which moments are felt (StudyFeel + a small confetti burst), the
 * "Claude is checking…" line, and what 🎤 Say it again practises per exercise type (practice only, never
 * scored). Parity-tested by LessonFeedbackParityTest (parity/fixtures/lesson-feedback.ts).
 */
object LessonFeedback {
    const val CLAUDE_CHECKING_LINE = "Claude is checking…"
    const val SAY_AGAIN_LABEL = "Say it again"
    const val SAY_AGAIN_NOTE = "Practice — doesn’t change your score"
    const val SAY_AGAIN_FIX_LABEL = "Say the corrected version"
    /** Over an open-ended exercise's own example: ANOTHER answer, not THE answer. */
    const val EXAMPLE_LABEL = "Another way to say it:"

    const val CHECKED_RIGHT = "checked_right"
    const val CHECKED_WRONG = "checked_wrong"
    const val MATCHED_ANSWER = "matched_answer"
    const val CLAUDE_RIGHT = "claude_right"
    const val CLAUDE_NOT_RIGHT = "claude_not_right"
    const val SAY_AGAIN_RIGHT = "say_again_right"
    const val SAY_AGAIN_MISS = "say_again_miss"
    val MOMENTS = listOf(CHECKED_RIGHT, CHECKED_WRONG, MATCHED_ANSWER, CLAUDE_RIGHT, CLAUDE_NOT_RIGHT, SAY_AGAIN_RIGHT, SAY_AGAIN_MISS)

    /** A moment's feel ([HardMode] FEEL_*) and whether the small confetti burst shows. */
    data class Feel(val feel: String?, val confetti: Boolean)

    /** Port of `lessonFeel`: one celebration per answer — Claude agreeing after the device matched adds nothing. */
    fun feel(moment: String, celebrated: Boolean = false): Feel = when (moment) {
        CHECKED_RIGHT, MATCHED_ANSWER -> Feel(HardMode.FEEL_SUCCESS, true)
        CLAUDE_RIGHT -> if (celebrated) Feel(null, false) else Feel(HardMode.FEEL_SUCCESS, true)
        SAY_AGAIN_RIGHT -> Feel(HardMode.FEEL_ROUND_RIGHT, true)
        else -> Feel(null, false)
    }

    /** Port of `claudeVerdictMoment`. */
    fun claudeVerdictMoment(verdict: String?): String? = when (verdict) {
        "correct", "acceptable" -> CLAUDE_RIGHT
        "almost", "wrong" -> CLAUDE_NOT_RIGHT
        else -> null
    }

    /** What 🎤 Say it again asks for; kind = answer | example. */
    data class Target(val hanzi: String, val pinyin: String?, val kind: String)

    private val HAN = Regex("\\p{IsHan}")

    private fun target(hanzi: String?, pinyin: String?, kind: String): Target? {
        val h = JsJson.trim(hanzi ?: "")
        if (h.isEmpty() || !HAN.containsMatchIn(h)) return null
        val p = JsJson.trim(pinyin ?: "")
        return Target(h, p.ifEmpty { null }, kind)
    }

    /** Port of `sayAgainTarget`. */
    fun sayAgainTarget(ex: LessonExercise): Target? = when (ex) {
        is ScrambleExercise -> target(ex.correctOrder.joinToString(""), null, "answer")
        is ChoiceExercise -> ex.options.getOrNull(ex.correct)?.let { target(it.hanzi, it.pinyin, "answer") }
        is TranslateExercise -> target(ex.referenceHanzi, ex.referencePinyin, "answer")
        is ListenChoiceExercise -> target(ex.audio.hanzi, ex.audio.pinyin, "answer")
        is ListenTranslateExercise -> target(ex.audio.hanzi, ex.audio.pinyin, "answer")
        is WriteTypedExercise -> target(ex.answer.hanzi, ex.answer.pinyin, "answer")
        is WriteHandwritingExercise -> target(ex.answer.hanzi, ex.answer.pinyin, "answer")
        is DictationExercise -> target(ex.audio.hanzi, ex.audio.pinyin, "answer")
        is DescribeImageExercise -> target(ex.referenceHanzi, ex.referencePinyin, "example")
        is SpeakExercise -> target(ex.example?.hanzi, ex.example?.pinyin, "example")
        is SentenceMakingExercise -> target(ex.example?.hanzi, ex.example?.pinyin, "example")
        is OralExpressionExercise -> target(ex.example?.hanzi, ex.example?.pinyin, "example")
        else -> null
    }

    /** One character as shown ([ch]: a code point), marked by the device's diff; punctuation / spaces always hit. */
    data class ShownChar(val ch: String, val hit: Boolean)

    /** Port of `markedChars`: the device's diff on the sentence AS WRITTEN (side = answer | model). */
    fun markedChars(answer: String, model: String, side: String): List<ShownChar> {
        val d = LessonAnswers.diffHanzi(answer, model)
        val marks = if (side == "answer") d.typed else d.expected
        val text = if (side == "answer") answer else model
        var k = 0
        return LessonAnswers.chars(text).map { ch ->
            val n = LessonAnswers.chars(LessonAnswers.normalizeHanzi(ch)).size
            if (n == 0) return@map ShownChar(ch, true)
            var hit = true
            repeat(n) { val m = marks.getOrNull(k++); if (m != null && !m.hit) hit = false }
            ShownChar(ch, hit)
        }
    }

    /** Port of `sayAgainFix`: Claude's corrected sentence, when it is new (not what he said, not already offered). */
    fun sayAgainFix(corrected: String?, said: String?, offered: String?): String? {
        val c = JsJson.trim(corrected ?: "")
        if (c.isEmpty() || !HAN.containsMatchIn(c)) return null
        val s = JsJson.trim(said ?: "")
        if (s.isNotEmpty() && LessonAnswers.isExactHanziMatch(s, c)) return null
        val o = JsJson.trim(offered ?: "")
        if (o.isNotEmpty() && LessonAnswers.isExactHanziMatch(o, c)) return null
        return c
    }
}
