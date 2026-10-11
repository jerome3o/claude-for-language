package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/lesson/spoken-check.ts — a mini lesson's written-Chinese answer that was SPOKEN
 * (the voice-first box): an unchanged transcript is checked like a spoken study answer
 * ([AnswerKey.checkSpoken]: right by sound, or said inside a sentence); typed / edited text stays
 * strict ([LessonAnswers.diffHanzi]). Parity-tested (parity/fixtures/lesson-spoken.ts → LessonSpokenParityTest).
 */
object LessonSpokenCheck {
    data class Result(val verdict: AnswerKey.Verdict?, val accepted: Boolean, val note: String?)

    /** `lessonSpokenCheck`. */
    fun check(answer: String, expected: String, alternatives: List<String> = emptyList(), source: String? = "typed"): Result {
        if (source != "spoken" || AnswerKey.jsTrim(answer).isEmpty()) return Result(null, false, null)
        val verdict = AnswerKey.checkSpoken(answer, expected, alternatives)
        val accepted = AnswerKey.isAccepted(verdict)
        val note = if (verdict == AnswerKey.Verdict.CONTAINS) "Said inside a sentence ✓ — ${AnswerKey.jsTrim(expected)}" else AnswerKey.spokenVerdictNote(verdict, expected)
        return Result(verdict, accepted, note)
    }

    /** `lessonAnswerCorrect`. */
    fun correct(strictCorrect: Boolean, spoken: Result): Boolean = strictCorrect || spoken.accepted

    /** `answerInputLabel`. */
    fun inputLabel(input: String?, typedLabel: String = "Typed"): String = when (input) {
        "spoken" -> "🎤 Said"
        "edited" -> "🎤 Said, then edited"
        else -> typedLabel
    }
}
