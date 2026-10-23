package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/**
 * Port of shared/lesson/judgeGap.ts (and the gap helpers of shared/lesson/types.ts): the two
 * per-sentence exercises — "Judge each sentence" (judge) and "Choose the word for the gap"
 * (gap_choice). Checked on the device against what the author wrote (no model), one point per
 * sentence. Parity-tested (JudgeGapParityTest ← parity/fixtures/lesson-judge-gap.ts).
 */
object JudgeGap {
    const val JUDGE_DEFAULT_QUESTION = "Correct or incorrect?"
    const val GAP_DEFAULT_QUESTION = "Choose the word for each gap"
    const val JUDGE_CORRECT_LABEL = "✓ Correct"
    const val JUDGE_INCORRECT_LABEL = "✗ Incorrect"

    /** GAP_MARKER — written "___"; any run of two or more underscores counts. */
    const val GAP_MARKER = "___"
    private val GAP = Regex("_{2,}")

    /** `gapCount`: how many gaps a sentence has (a valid one has exactly one). */
    fun gapCount(sentence: String): Int = GAP.findAll(sentence).count()

    /** `gapParts`: the text before and after the (first) gap; no gap → (sentence, ""). */
    fun gapParts(sentence: String): Pair<String, String> {
        val m = GAP.find(sentence) ?: return sentence to ""
        return sentence.substring(0, m.range.first) to sentence.substring(m.range.last + 1)
    }

    /** `fillGap`: the full sentence with [word] in the gap — what is shown and spoken after Check. */
    fun fillGap(sentence: String, word: String): String {
        if (gapCount(sentence) == 0) return sentence
        val (before, after) = gapParts(sentence)
        return before + word + after
    }

    /** `gapItemOptions`: a sentence's own options, else the exercise's shared ones. */
    fun optionsFor(ex: GapChoiceExercise, item: GapChoiceItem): List<String> = item.options ?: ex.options ?: emptyList()

    /** `judgeSpokenText`: a right sentence as written, a wrong one as its correction ("" without one). */
    fun spokenText(s: JudgeSentence): String = if (s.correct) s.hanzi else s.correction?.hanzi ?: ""

    /** `judgeResults`: per sentence, was it judged right? null = not judged yet. */
    fun judgeResults(ex: JudgeExercise, judged: List<Boolean?>): List<Boolean?> =
        ex.sentences.mapIndexed { i, s -> judged.getOrNull(i)?.let { it == s.correct } }

    /** `gapResults`: per sentence, was the answer picked? null = nothing picked yet. */
    fun gapResults(ex: GapChoiceExercise, picks: List<String?>): List<Boolean?> =
        ex.items.mapIndexed { i, item -> picks.getOrNull(i)?.takeIf { it.isNotEmpty() }?.let { JsJson.trim(it) == JsJson.trim(item.answer) } }

    /** `allAnswered`: Check opens once every sentence has an answer. */
    fun allAnswered(results: List<Boolean?>): Boolean = results.isNotEmpty() && results.all { it != null }

    /** `itemsScoreLine`: "✓ All 5 right" / "4 of 5 right". */
    fun scoreLine(results: List<Boolean?>): String {
        val total = results.size
        val right = results.count { it == true }
        if (total > 0 && right == total) return if (total == 1) "✓ Right" else "✓ All $total right"
        return "$right of $total right"
    }

    /** `judgeFeedback`: the line under a judged sentence after Check. */
    fun judgeFeedback(sentenceCorrect: Boolean, judgedRight: Boolean): String {
        val what = if (sentenceCorrect) "this sentence is correct" else "this sentence has a mistake"
        return if (judgedRight) "✓ Right — $what" else "✗ Not quite — $what"
    }

    /** `gapFeedback`: the line under a gapped sentence after Check. */
    fun gapFeedback(answer: String, pick: String?): String {
        val p = JsJson.trim(pick ?: "")
        if (p == JsJson.trim(answer)) return "✓ $answer"
        return if (p.isNotEmpty()) "✗ You chose $p — it’s $answer" else "✗ It’s $answer"
    }
}
