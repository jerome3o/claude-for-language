package dev.jeromeswannack.chineselearning.lab.core

import java.util.Locale

/**
 * The spoken answer's result on the back of a typing card and of 🎤 Say it practice: ONE compact
 * "You said" row under the card's own answer (docs/STUDY_SESSION.md "Say the answer") — a port of
 * shared/cards/spoken-result.ts, parity-tested (parity/fixtures/spoken-answer.ts →
 * SpokenAnswerParityTest): the verdict state, the chip's words and icon, which characters of the
 * transcript are marked (right / written differently / not in the answer / plain), whether ✎ Open
 * in Coach shows, and the sentence a screen reader reads for the whole row.
 */
object SpokenAnswerResult {
    enum class State { MATCH, SOUND, CONTAINS, CLOSE, WRONG }
    enum class Mark { RIGHT, DIFFERS, WRONG, PLAIN }

    data class Cell(val char: String, val mark: Mark)

    data class Result(
        val state: State,
        /** The verdict counts as right (the card's border, the rating sound). */
        val accepted: Boolean,
        /** The chip's words (with [icon], never colour alone). */
        val chip: String,
        /** check | approx | close */
        val icon: String,
        /** ✎ Open in Coach: everything but a plain match. */
        val coach: Boolean,
        /** The transcript (trimmed), one cell per code point. */
        val chars: List<Cell>,
    )

    fun stateName(s: State): String = s.name.lowercase(Locale.ROOT)
    fun markName(m: Mark): String = m.name.lowercase(Locale.ROOT)

    /** The chip's words per state (`SPOKEN_RESULT_CHIP`). */
    fun chip(s: State): String = when (s) {
        State.MATCH -> "Match"
        State.SOUND -> "Sounded right — written differently"
        State.CONTAINS -> "Contains the answer"
        State.CLOSE -> "Close — tones off"
        State.WRONG -> "Didn’t match"
    }

    /** The chip's icon per state (`SPOKEN_RESULT_ICON`): ✓ right, ≈ partly, ✕ didn't match. */
    fun icon(s: State): String = when (s) {
        State.MATCH, State.SOUND -> "check"
        State.CONTAINS, State.CLOSE -> "approx"
        State.WRONG -> "close"
    }

    fun state(verdict: AnswerKey.Verdict): State = when (verdict) {
        AnswerKey.Verdict.SOUND -> State.SOUND
        AnswerKey.Verdict.CONTAINS -> State.CONTAINS
        AnswerKey.Verdict.CLOSE -> State.CLOSE
        AnswerKey.Verdict.WRONG -> State.WRONG
        else -> State.MATCH // exact, punctuation_only, equivalent, alternative
    }

    /** `[\p{L}\p{Nd}]`: a character that can be right or wrong; the rest is plain. */
    private fun markable(cp: Int): Boolean = Character.isLetter(cp) || Character.getType(cp) == Character.DECIMAL_DIGIT_NUMBER.toInt()

    private fun codePoints(s: String): List<Int> = s.codePoints().toArray().toList()

    /** Which characters of the transcript the answer has too (longest common subsequence, by code point). */
    private fun commonWithAnswer(said: List<Int>, answer: List<Int>): BooleanArray {
        val n = said.size
        val m = answer.size
        val lcs = Array(n + 1) { IntArray(m + 1) }
        for (i in n - 1 downTo 0) {
            for (j in m - 1 downTo 0) {
                lcs[i][j] = if (said[i] == answer[j]) lcs[i + 1][j + 1] + 1 else maxOf(lcs[i + 1][j], lcs[i][j + 1])
            }
        }
        val hit = BooleanArray(n)
        var i = 0
        var j = 0
        while (i < n && j < m) {
            if (said[i] == answer[j]) { hit[i] = true; i++; j++ }
            else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
            else j++
        }
        return hit
    }

    /** The transcript's characters, each marked for its state (`spokenResultMarks`). */
    fun marks(transcript: String, correct: String, state: State): List<Cell> {
        val said = codePoints(AnswerKey.jsTrim(transcript))
        val hit = commonWithAnswer(said, codePoints(AnswerKey.jsTrim(correct)))
        return said.mapIndexed { k, cp ->
            val ch = String(Character.toChars(cp))
            val mark = when {
                !markable(cp) -> Mark.PLAIN
                state == State.MATCH || hit[k] -> Mark.RIGHT
                state == State.SOUND -> Mark.DIFFERS
                state == State.CONTAINS -> Mark.PLAIN
                else -> Mark.WRONG
            }
            Cell(ch, mark)
        }
    }

    /** Everything the "You said" row shows for a spoken answer with this verdict (`spokenResult`). */
    fun of(transcript: String, correct: String, verdict: AnswerKey.Verdict): Result {
        val s = state(verdict)
        return Result(s, AnswerKey.isAccepted(verdict), chip(s), icon(s), s != State.MATCH, marks(transcript, correct, s))
    }

    /** The whole row as one sentence for a screen reader (`spokenResultLabel`). */
    fun label(result: Result, correct: String, pinyin: String = ""): String {
        val said = result.chars.joinToString("") { it.char }.ifEmpty { "…" }
        val py = AnswerKey.jsTrim(pinyin)
        val head = "You said $said${if (py.isNotEmpty()) " ($py)" else ""}."
        fun marked(m: Mark) = result.chars.filter { it.mark == m }.joinToString("") { it.char }
        val answer = AnswerKey.jsTrim(correct)
        return when (result.state) {
            State.MATCH -> "$head Match."
            State.CONTAINS -> "$head Contains the answer, $answer."
            State.SOUND -> {
                val differs = marked(Mark.DIFFERS)
                "$head Sounded right — written differently${if (differs.isNotEmpty()) " ($differs)" else ""}; the card writes $answer."
            }
            State.CLOSE, State.WRONG -> {
                val wrong = marked(Mark.WRONG)
                val verdict = if (result.state == State.CLOSE) "Close — the tones are off." else "Didn’t match."
                "$head $verdict${if (wrong.isNotEmpty()) " Not in the answer: $wrong." else ""}"
            }
        }
    }
}
