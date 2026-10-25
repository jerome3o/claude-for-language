package dev.jeromeswannack.chineselearning.lab.core

/**
 * "Skip handwriting exercises" — port of shared/lesson/handwriting.ts, parity-tested (parity/fixtures/
 * handwriting.ts → HandwritingParityTest; docs/STUDY_SESSION.md "Skip handwriting").
 *
 * Jerome (Oct 2026): "it's teaching me how to write characters, and I don't actually want to write
 * characters". With the account switch on: write_handwriting exercises are left out of every run
 * ([LessonRun.steps] `skipHandwriting`), never scored or missed (earlier misses on them stop counting —
 * [handwritingKeys] → [LessonRevision.state] `ignore`); a handwritten dictation is typed; the attempt
 * carries a row per exercise left out ([skippedRows]) so the tutor's review says "skipped (handwriting off)".
 */
object Handwriting {
    /** Port of SKIPPED_HANDWRITING_LABEL. */
    const val SKIPPED_LABEL = "skipped (handwriting off)"

    /** Port of isHandwritingExercise. */
    fun isHandwriting(type: String): Boolean = type == "write_handwriting"

    /** Port of lessonHasHandwriting: an exercise left out, or a dictation written by hand. */
    fun lessonHasHandwriting(spec: CustomLessonSpec): Boolean = spec.sections.any { s ->
        s.exercises.any { ex -> isHandwriting(ex.type) || (ex is DictationExercise && ex.input == WritingInput.HANDWRITE) }
    }

    /** Port of handwritingKeys over the exercise types per section. */
    fun handwritingKeysOfTypes(sections: List<List<String>>): List<String> {
        val out = ArrayList<String>()
        sections.forEachIndexed { si, types -> types.forEachIndexed { i, t -> if (isHandwriting(t)) out += LessonRun.exerciseKey(si, i) } }
        return out
    }

    /** Port of handwritingKeys. */
    fun handwritingKeys(spec: CustomLessonSpec): List<String> = handwritingKeysOfTypes(spec.sections.map { s -> s.exercises.map { it.type } })

    /** Port of typedInsteadOfHandwriting: a handwritten dictation is typed. */
    fun typedInsteadOfHandwriting(ex: LessonExercise): LessonExercise =
        if (ex is DictationExercise && ex.input == WritingInput.HANDWRITE) ex.copy(input = WritingInput.TYPE) else ex

    /** Port of skippedHandwritingRows over the exercise types per section: [only] = a revision's keys (null = the whole lesson). */
    fun skippedRowsOfTypes(sections: List<List<String>>, only: List<String>? = null): List<ExerciseAttempt> {
        val wanted = only?.toHashSet()
        val out = ArrayList<ExerciseAttempt>()
        sections.forEachIndexed { si, types ->
            types.forEachIndexed { i, t ->
                if (!isHandwriting(t)) return@forEachIndexed
                if (wanted != null && LessonRun.exerciseKey(si, i) !in wanted) return@forEachIndexed
                out += ExerciseAttempt(section = si, index = i, type = t, correct = null, points = 0, maxPoints = 0, durationMs = 0, skipped = "handwriting")
            }
        }
        return out
    }

    /** Port of skippedHandwritingRows. */
    fun skippedRows(spec: CustomLessonSpec, only: List<String>? = null): List<ExerciseAttempt> =
        skippedRowsOfTypes(spec.sections.map { s -> s.exercises.map { it.type } }, only)
}
