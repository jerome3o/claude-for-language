package dev.jeromeswannack.chineselearning.lab.core

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

    /** `spreadOrder`: the easiest, the hardest and evenly between first, then the rest easiest first. */
    fun spreadOrder(n: Int): List<Int> {
        if (n <= 0) return emptyList()
        val m = minOf(SIZE, n)
        val first = (0 until m).map { k -> if (m == 1) 0 else floor(k * (n - 1).toDouble() / (m - 1) + 0.5).toInt() }
        return first + (0 until n).filter { it !in first }
    }

    /** `pickRoundExercises`: [stats] = the note's practice history (core [SentenceHistory]); hidden sentences never come. */
    fun pick(sentences: List<Sentence>, stats: Map<String, SentenceHistory.Stats>? = null): List<Exercise> {
        fun statsOf(s: Sentence) = stats?.get(SentenceHistory.key(s.key))
        val visible = sentences.withIndex().filter { statsOf(it.value)?.hidden == null }
        val n = visible.size
        if (n == 0) return emptyList()
        val rank = spreadOrder(n).withIndex().associate { it.value to it.index }
        fun best(mode: String, used: Set<Int>, avoidTranslatable: Boolean = false): Int? {
            var pick: Int? = null
            for (pos in 0 until n) {
                if (pos in used) continue
                if (mode == SentencePractise.TRANSLATE && !hasTranslation(visible[pos].value)) continue
                if (avoidTranslatable && hasTranslation(visible[pos].value)) continue
                val p = pick
                if (p == null) { pick = pos; continue }
                val c = SentenceHistory.compareLeastKnown(statsOf(visible[pos].value)?.mode(mode), statsOf(visible[p].value)?.mode(mode))
                if (c < 0 || (c == 0 && rank.getValue(pos) < rank.getValue(p))) pick = pos
            }
            return pick
        }
        val used = HashSet<Int>()
        val picked = ArrayList<Pair<Int, String>>()
        val m = minOf(SIZE, n)
        for (k in 0 until m) {
            val want = if (k % 2 == 0) SentencePractise.READ else SentencePractise.TRANSLATE
            // A read slot leaves the sentences with English to the translate slots still to come when just enough.
            val translateSlotsLeft = (k + 1 until m).count { it % 2 == 1 }
            val translatableLeft = (0 until n).count { it !in used && hasTranslation(visible[it].value) }
            val spare = want == SentencePractise.READ && translateSlotsLeft > 0 && translatableLeft <= translateSlotsLeft
            var pos = (if (spare) best(want, used, true) else null) ?: best(want, used)
            var mode = want
            if (pos == null && want == SentencePractise.TRANSLATE) {
                pos = best(SentencePractise.READ, used)
                mode = SentencePractise.READ
            }
            if (pos == null) break
            used += pos
            picked += pos to mode
        }
        fun make(pos: Int, mode: String): Exercise {
            val (index, s) = visible[pos]
            return Exercise(exerciseId(mode, s.key), s.key, mode, index)
        }
        // One exercise per sentence (its English would answer the other): fewer sentences = fewer exercises.
        return picked.sortedBy { it.first }.map { make(it.first, it.second) }
    }

    /** `sentenceRoundOpens`: [sentenceCount] null = still loading. */
    fun opens(enabled: Boolean, cardType: String, sentenceCount: Int?): Boolean {
        if (!enabled || cardType !in SentencePractise.GATE_CARD_TYPES) return false
        return sentenceCount == null || sentenceCount > 0
    }

    /** `sentenceRoundProgress` */
    fun progress(exercises: List<Exercise>, rightIds: Collection<String>, sentenceKeys: Collection<String>? = null): Progress {
        val needed = minOf(SentencePractise.GATE_TARGET, exercises.map { it.key }.toSet().size)
        val ids = exercises.map { it.id }.toMutableSet()
        sentenceKeys?.forEach { ids += exerciseId(SentencePractise.READ, it); ids += exerciseId(SentencePractise.TRANSLATE, it) }
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

    // --- the round on the answer side (`roundRowMarks` …) -------------------------------------------

    /** `RoundLogEntry`: an exercise of the round as shown and its last judged take ("right" | "close" | "wrong" | null). */
    data class LogEntry(val id: String, val result: String? = null)

    /** `RoundRowMark`: outcome "right" | "close" | "wrong" | "untried". */
    data class RowMark(val key: String, val mode: String, val outcome: String, val label: String)

    /** `roundExerciseParts`: mode to key, null = not an exercise id. */
    fun exerciseParts(id: String): Pair<String, String>? {
        val at = id.indexOf(':')
        if (at <= 0) return null
        val mode = id.substring(0, at)
        if (mode != SentencePractise.READ && mode != SentencePractise.TRANSLATE) return null
        val key = id.substring(at + 1)
        return if (key.isEmpty()) null else mode to key
    }

    /** `roundRowLabel` */
    fun rowLabel(outcome: String): String = if (outcome == "untried") "In the round" else "In the round · ${RESULT.getValue(outcome)}"

    /** `roundRowMarks` */
    fun rowMarks(log: List<LogEntry>, rightIds: Collection<String>): List<RowMark> {
        val right = rightIds.toSet()
        val seen = HashSet<String>()
        val out = ArrayList<RowMark>()
        for (e in log) {
            val (mode, key) = exerciseParts(e.id) ?: continue
            if (!seen.add(key)) continue
            val outcome = if (e.id in right || e.result == "right") "right" else e.result ?: "untried"
            out += RowMark(key, mode, outcome, rowLabel(outcome))
        }
        return out
    }

    /** `orderKeysForRound` */
    fun orderKeys(keys: List<String>, marks: List<RowMark>): List<String> {
        val present = keys.toSet()
        val first = marks.map { it.key }.filter { it in present }
        val firstSet = first.toSet()
        return first + keys.filter { it !in firstSet }
    }

    /** `exercisesFromLog`: null = none left (pick afresh). */
    fun exercisesFromLog(sentences: List<Sentence>, ids: List<String>, hidden: (String) -> Boolean = { false }): List<Exercise>? {
        val index = sentences.withIndex().associate { it.value.key to it.index }
        val seen = HashSet<String>()
        val out = ArrayList<Exercise>()
        for (id in ids) {
            val (mode, key) = exerciseParts(id) ?: continue
            if (key in seen || key !in index || hidden(key)) continue
            seen += key
            out += Exercise(exerciseId(mode, key), key, mode, index.getValue(key))
        }
        return if (out.isEmpty()) null else out.sortedBy { it.index }
    }
}
