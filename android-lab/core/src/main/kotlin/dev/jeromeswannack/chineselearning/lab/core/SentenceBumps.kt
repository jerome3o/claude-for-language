package dev.jeromeswannack.chineselearning.lab.core

/**
 * The Coach's "⚡ Study … today" chip: which of the learner's notes a sentence offers to bump.
 * Port of shared/decks/sentence-bumps.ts (parity-tested through parity/fixtures/sentence-bumps.ts
 * → SentenceBumpsParityTest).
 *
 * One tap never silently bumps a pile of words:
 *   - the whole sentence (normalised like Paste a list: no spaces / punctuation) IS a note →
 *     [Result.exact]: "⚡ Study this today" bumps only that note;
 *   - otherwise the notes whose hanzi appears inside it → [Result.words]: "⚡ Study words from
 *     this today…" opens a picker with nothing ticked. Longer words first (then first position,
 *     then the hanzi), single characters last; a single character every occurrence of which sits
 *     inside a longer matched word is left out; one row per spelling (the first note given wins);
 *     at most [MAX_WORDS];
 *   - nothing matches → no chip.
 */
object SentenceBumps {
    const val MAX_WORDS = 20

    const val EXACT_LABEL = "⚡ Study this today"
    const val DONE_LABEL = "⚡ In today’s study"
    const val WORDS_LABEL = "⚡ Study words from this today…"
    const val SHEET_TITLE = "You already have these words"

    data class Result<N>(val exact: N?, val words: List<N>) {
        val isEmpty: Boolean get() = exact == null && words.isEmpty()
    }

    /** Port of sentenceBumps(). [hanzi] reads a note's spelling; [notes] in preference order. */
    fun <N> match(text: String, notes: List<N>, max: Int = MAX_WORDS, hanzi: (N) -> String): Result<N> {
        val whole = WordListParser.normalizeHanzi(text)
        if (whole.isEmpty()) return Result(null, emptyList())
        val byKey = LinkedHashMap<String, N>()
        for (n in notes) {
            val key = WordListParser.normalizeHanzi(hanzi(n))
            if (key.isNotEmpty() && key !in byKey) byKey[key] = n
        }
        byKey[whole]?.let { return Result(it, emptyList()) }

        data class Hit<N>(val key: String, val note: N, val first: Int)
        val hits = byKey.mapNotNull { (key, note) -> whole.indexOf(key).takeIf { it >= 0 }?.let { Hit(key, note, it) } }
        val covered = BooleanArray(whole.length)
        for (h in hits) {
            if (h.key.length < 2) continue
            var i = whole.indexOf(h.key)
            while (i >= 0) {
                for (j in i until i + h.key.length) covered[j] = true
                i = whole.indexOf(h.key, i + 1)
            }
        }
        fun partOfLonger(key: String): Boolean {
            var i = whole.indexOf(key)
            while (i >= 0) {
                if (!covered[i]) return false
                i = whole.indexOf(key, i + 1)
            }
            return true
        }
        val words = hits
            .filter { it.key.length >= 2 || !partOfLonger(it.key) }
            .sortedWith(compareByDescending<Hit<N>> { it.key.length }.thenBy { it.first }.thenBy { it.key })
            .take(maxOf(0, max))
            .map { it.note }
        return Result(null, words)
    }

    /** The picker's pinned button. Port of addToTodayLabel(). */
    fun addToTodayLabel(count: Int): String = if (count > 0) "⚡ Add $count to today" else "⚡ Add to today"
}
