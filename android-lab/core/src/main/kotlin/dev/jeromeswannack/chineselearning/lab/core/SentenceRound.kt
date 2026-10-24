package dev.jeromeswannack.chineselearning.lab.core

import kotlin.math.abs
import kotlin.math.floor

/**
 * The Sentence round between a card's question and its answer — a port of
 * shared/study/sentenceRound.ts, parity-tested (parity/fixtures/sentence-round.ts →
 * SentenceRoundParityTest). docs/STUDY_SESSION.md "Sentence round".
 *
 * Four exercises (2 read + 2 translate, easiest → harder) from the card's sentences; any two said
 * right open the answer with Good / Easy unlocked (the gate counts the exercise ids). Each take is
 * judged by [SentencePractise] — practice only.
 */
object SentenceRound {
    const val SIZE = 4

    data class Sentence(val key: String, val hanzi: String, val translation: String?)
    data class Exercise(val id: String, val key: String, val mode: String, val index: Int)
    data class Progress(val needed: Int, val got: Int, val done: Boolean)

    /** `roundSentences`: the card's own sentence first unless the set has it, then the set. */
    fun sentences(clue: Sentence?, set: List<Sentence>): List<Sentence> {
        val out = ArrayList<Sentence>()
        if (clue != null && NoteSearch.jsTrim(clue.hanzi).isNotEmpty() && set.none { it.hanzi == clue.hanzi }) out += clue
        out += set
        return out
    }

    /** `roundExerciseId` */
    fun exerciseId(mode: String, key: String) = "$mode:$key"

    private fun hasTranslation(s: Sentence) = NoteSearch.jsTrim(s.translation ?: "").isNotEmpty()

    /** `pickRoundExercises` */
    fun pick(sentences: List<Sentence>): List<Exercise> {
        val n = sentences.size
        if (n == 0) return emptyList()
        val m = minOf(SIZE, n)
        val picks = (0 until m).map { k -> if (m == 1) 0 else floor(k * (n - 1).toDouble() / (m - 1) + 0.5).toInt() }
        val modes = MutableList(m) { k -> if (k % 2 == 0) SentencePractise.READ else SentencePractise.TRANSLATE }
        for (k in 0 until m) {
            if (modes[k] != SentencePractise.TRANSLATE || hasTranslation(sentences[picks[k]])) continue
            var best = -1
            for (j in 0 until m) {
                if (modes[j] != SentencePractise.READ || !hasTranslation(sentences[picks[j]])) continue
                if (best < 0 || abs(j - k) < abs(best - k) || (abs(j - k) == abs(best - k) && j > best)) best = j
            }
            if (best >= 0) modes[best] = SentencePractise.TRANSLATE
            modes[k] = SentencePractise.READ
        }
        val out = ArrayList<Exercise>()
        for (k in 0 until m) {
            val s = sentences[picks[k]]
            out += Exercise(exerciseId(modes[k], s.key), s.key, modes[k], picks[k])
        }
        for (k in 0 until m) {
            if (out.size >= SIZE) break
            val s = sentences[picks[k]]
            val other = if (modes[k] == SentencePractise.READ) SentencePractise.TRANSLATE else SentencePractise.READ
            if (other == SentencePractise.TRANSLATE && !hasTranslation(s)) continue
            val id = exerciseId(other, s.key)
            if (out.any { it.id == id }) continue
            out += Exercise(id, s.key, other, picks[k])
        }
        return out
    }

    /** `sentenceRoundOpens`: [sentenceCount] null = still loading. */
    fun opens(enabled: Boolean, cardType: String, sentenceCount: Int?): Boolean {
        if (!enabled || cardType !in SentencePractise.GATE_CARD_TYPES) return false
        return sentenceCount == null || sentenceCount > 0
    }

    /** `sentenceRoundProgress` */
    fun progress(exercises: List<Exercise>, rightIds: Collection<String>): Progress {
        val needed = minOf(SentencePractise.GATE_TARGET, exercises.map { it.key }.toSet().size)
        val ids = exercises.map { it.id }.toSet()
        val got = minOf(needed, rightIds.filter { it in ids }.toSet().size)
        return Progress(needed, got, needed > 0 && got >= needed)
    }

    // --- words ------------------------------------------------------------------------------------

    const val TITLE = "Sentence round"
    const val SKIP = "Skip to the answer"
    const val TRY_AGAIN = "Try again"
    const val SEE_ANSWER = "See the answer"
    const val SHOW_ENGLISH = "Show English"
    const val HIDE_ENGLISH = "Hide English"
    val PROMPT = mapOf(SentencePractise.READ to "📖 Read it aloud", SentencePractise.TRANSLATE to "🔁 Say it in Chinese")
    val RESULT = mapOf("right" to "✓ Right", "close" to "≈ Nearly", "wrong" to "✗ Not quite")

    /** `sentenceRoundCounter` */
    fun counter(p: Progress) = "${p.got} / ${p.needed}"

    /** `sentenceRoundIntro` */
    fun intro(p: Progress, exerciseCount: Int): String =
        if (p.needed == 1) (if (exerciseCount > 1) "Get any 1 of these $exerciseCount right" else "Get this one right")
        else "Get any ${p.needed} of these $exerciseCount right"

    /** `sentenceRoundCheer` */
    fun cheer(p: Progress): String =
        if (p.done) "🎉 ${p.got} / ${p.needed} — Good and Easy unlocked" else "🎉 Nice — ${p.got} / ${p.needed}"

    /** `sentenceRoundSkipNote` */
    fun skipNote(p: Progress): String {
        val left = maxOf(0, p.needed - p.got)
        if (left == 0) return "Good and Easy are unlocked."
        return "Good and Easy stay locked until ${if (left == 1) "1 more sentence is" else "$left more sentences are"} right — the sentences on the answer side still count."
    }
}
