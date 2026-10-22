package dev.jeromeswannack.chineselearning.lab.core

/**
 * How big a piece of homework is — port of shared/homework/size.ts, parity-tested
 * (parity/fixtures/homework-size.ts → HomeworkSizeParityTest): "18 exercises · ~12 min",
 * "5 questions · ~4 min" (a revision), "12 words", "6 pages". The time is an estimate per
 * exercise type.
 */
object HomeworkSize {
    /** Port of EXERCISE_SECONDS. */
    val EXERCISE_SECONDS: Map<String, Int> = mapOf(
        "note" to 40,
        "scramble" to 30,
        "choice" to 20,
        "translate" to 50,
        "match" to 45,
        "describe_image" to 60,
        "speak" to 40,
        "listen_choice" to 20,
        "listen_translate" to 50,
        "sentence_making" to 75,
        "write_typed" to 35,
        "write_handwriting" to 60,
        "dictation" to 45,
        "oral_expression" to 60,
        "conversation" to 120,
    )

    const val DEFAULT_EXERCISE_SECONDS = 40

    /** Port of exerciseMinutes: rounded, at least 1 (no types = 0). */
    fun exerciseMinutes(types: List<String>): Int {
        if (types.isEmpty()) return 0
        var s = 0
        for (t in types) s += EXERCISE_SECONDS[t] ?: DEFAULT_EXERCISE_SECONDS
        return Math.max(1, Math.floor(s / 60.0 + 0.5).toInt())
    }

    private fun plural(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

    /** Port of lessonSizeLabel: "18 exercises · ~12 min". */
    fun lessonSizeLabel(types: List<String>): String =
        if (types.isEmpty()) "" else "${plural(types.size, "exercise", "exercises")} · ~${exerciseMinutes(types)} min"

    /** Port of revisionSizeLabel: "5 questions · ~4 min". */
    fun revisionSizeLabel(questions: Int, types: List<String>): String =
        if (questions <= 0) "" else "${plural(questions, "question", "questions")} · ~${exerciseMinutes(types)} min"

    /** Port of deckSizeLabel: "12 words". */
    fun deckSizeLabel(words: Int): String = if (words > 0) plural(words, "word", "words") else ""

    /** Port of readerSizeLabel: "6 pages". */
    fun readerSizeLabel(pages: Int): String = if (pages > 0) plural(pages, "page", "pages") else ""
}
