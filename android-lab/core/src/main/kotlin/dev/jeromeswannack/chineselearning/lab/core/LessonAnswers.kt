package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer
import kotlin.random.Random

/**
 * Answer checking for lesson exercises — ports of shared/lesson/answer-check.ts and the
 * pure helpers in frontend/src/components/lesson-exercises.tsx and utils/shuffle.ts.
 * Parity-tested against the TypeScript (LessonParityTest).
 */
object LessonAnswers {
    /**
     * JS `/[\s\p{P}\p{S}]/gu`. JS `\s` is spelled out (Java's is ASCII-only); `\p{P}` /
     * `\p{S}` are Unicode general categories in both engines.
     */
    private val IGNORED = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF\\p{P}\\p{S}]")

    /** `normalizeHanziAnswer`: NFKC, no whitespace / punctuation / symbols. */
    fun normalizeHanzi(s: String): String = IGNORED.replace(Normalizer.normalize(s, Normalizer.Form.NFKC), "")

    /** `isHanziAnswerCorrect`. */
    fun isHanziCorrect(answer: String, expected: String, alternatives: List<String> = emptyList()): Boolean {
        val a = normalizeHanzi(answer)
        if (a.isEmpty()) return false
        return (listOf(expected) + alternatives).any { normalizeHanzi(it) == a }
    }

    data class CharMark(val ch: String, val hit: Boolean)

    data class HanziDiff(val correct: Boolean, val accuracy: Double, val expected: List<CharMark>, val typed: List<CharMark>)

    /** `Array.from(s)`: code points as strings. */
    fun chars(s: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            out += s.substring(i, i + n)
            i += n
        }
        return out
    }

    /** `diffHanzi`: longest-common-subsequence marks against the closest accepted form. */
    fun diffHanzi(answer: String, expected: String, alternatives: List<String> = emptyList()): HanziDiff {
        val forms = (listOf(expected) + alternatives).map(::normalizeHanzi).filter { it.isNotEmpty() }
        val a = chars(normalizeHanzi(answer))
        var bestE: List<String> = emptyList()
        var bestHits: Pair<BooleanArray, BooleanArray> = BooleanArray(0) to BooleanArray(0)
        var bestLen = -1
        for (form in forms.ifEmpty { listOf("") }) {
            val e = chars(form)
            val table = lcsTable(a, e)
            val len = table[a.size][e.size]
            if (len > bestLen) {
                bestLen = len
                bestE = e
                bestHits = backtrack(table, a, e)
            }
        }
        return HanziDiff(
            correct = isHanziCorrect(answer, expected, alternatives),
            accuracy = if (bestE.isEmpty()) 0.0 else bestLen.toDouble() / bestE.size,
            expected = bestE.mapIndexed { i, ch -> CharMark(ch, bestHits.second[i]) },
            typed = a.mapIndexed { i, ch -> CharMark(ch, bestHits.first[i]) },
        )
    }

    private fun lcsTable(a: List<String>, b: List<String>): Array<IntArray> {
        val t = Array(a.size + 1) { IntArray(b.size + 1) }
        for (i in 1..a.size) for (j in 1..b.size) {
            t[i][j] = if (a[i - 1] == b[j - 1]) t[i - 1][j - 1] + 1 else Math.max(t[i - 1][j], t[i][j - 1])
        }
        return t
    }

    private fun backtrack(t: Array<IntArray>, a: List<String>, b: List<String>): Pair<BooleanArray, BooleanArray> {
        val ha = BooleanArray(a.size)
        val hb = BooleanArray(b.size)
        var i = a.size
        var j = b.size
        while (i > 0 && j > 0) {
            if (a[i - 1] == b[j - 1]) {
                ha[i - 1] = true; hb[j - 1] = true; i--; j--
            } else if (t[i - 1][j] >= t[i][j - 1]) i-- else j--
        }
        return ha to hb
    }

    /** `sentenceUsesWord`: punctuation-blind containment. */
    fun sentenceUsesWord(sentence: String, word: String): Boolean {
        val w = normalizeHanzi(word)
        return w.isNotEmpty() && normalizeHanzi(sentence).contains(w)
    }

    private val WS = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]")
    private fun joinTiles(tiles: List<String>) = WS.replace(tiles.joinToString(""), "")

    /** `checkScrambleOrder`: whitespace-insensitive, alternative orders accepted. */
    fun checkScrambleOrder(userOrder: List<String>, correctOrder: List<String>, altOrders: List<List<String>>? = null): Boolean {
        val user = joinTiles(userOrder)
        if (user == joinTiles(correctOrder)) return true
        return altOrders.orEmpty().any { user == joinTiles(it) }
    }

    /** The class `isExactHanziMatch` strips (lesson-exercises.tsx). */
    private val EXACT_STRIP = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF。，！？；：、．…,.!?;:'\"''\"\"()（）]")

    /** `isExactHanziMatch`: the translate exercise's green "Exact match" nudge. */
    fun isExactHanziMatch(answer: String, reference: String): Boolean {
        val a = EXACT_STRIP.replace(answer, "")
        return a.isNotEmpty() && a == EXACT_STRIP.replace(reference, "")
    }

    /** `isListenAnswerMatch`: the hanzi, or the English (case-insensitive). */
    fun isListenAnswerMatch(answer: String, audio: LessonSentence): Boolean {
        if (isExactHanziMatch(answer, audio.hanzi)) return true
        val english = audio.english ?: return false
        if (english.isEmpty()) return false
        val a = EXACT_STRIP.replace(answer.lowercase(), "")
        return a.isNotEmpty() && a == EXACT_STRIP.replace(english.lowercase(), "")
    }

    /** `shuffledIndexes`: Fisher-Yates over [0, count). */
    fun shuffledIndexes(count: Int, random: Random = Random.Default): List<Int> {
        val order = MutableList(count) { it }
        for (i in order.size - 1 downTo 1) {
            val j = random.nextInt(i + 1)
            val t = order[i]; order[i] = order[j]; order[j] = t
        }
        return order
    }

    /**
     * `scramblePoolOrder`: a shuffled tile order that is never itself an accepted answer
     * (repaired by scanning pairwise swaps), unless every order is.
     */
    fun scramblePoolOrder(tiles: List<String>, correctOrder: List<String>, altOrders: List<List<String>>? = null, random: Random = Random.Default): List<Int> {
        val answers = (listOf(correctOrder) + altOrders.orEmpty()).mapTo(HashSet(), ::joinTiles)
        fun isAnswer(o: List<Int>) = joinTiles(o.map { tiles[it] }) in answers
        val order = shuffledIndexes(tiles.size, random).toMutableList()
        if (!isAnswer(order)) return order
        for (i in 0 until order.size - 1) for (j in i + 1 until order.size) {
            var t = order[i]; order[i] = order[j]; order[j] = t
            if (!isAnswer(order)) return order
            t = order[i]; order[i] = order[j]; order[j] = t
        }
        return order
    }
}
