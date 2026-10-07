package dev.jeromeswannack.chineselearning.lab.core.explorer

/*
 * Port of shared/explorer/related.ts — "Related words" in the Word view: other words sharing a
 * character with this one, most common first, read from the character records' "Words with 字"
 * lists. Parity-tested (ExplorerParityTest).
 */

/** Port of `RelatedWord`: [shared] = the characters it shares, in the explored word's order. */
data class RelatedWord<W>(val word: W, val shared: List<String>, val rank: Int)

/** One character record's word list (`{ char, words }`). */
data class CharWordList<W>(val char: String, val words: List<W>)

object RelatedWords {
    /** Port of RELATED_WORDS_MAX. */
    const val MAX = 12

    /** Port of UNRANKED_RELATED: unranked words sort after ranked ones by their best list position. */
    const val UNRANKED = 10_000_000

    private class Acc<W>(val word: W, val shared: MutableSet<String>, var pos: Int)

    /**
     * Port of `relatedWords`: words from [records] other than [hanzi], each once, ordered by
     * [rankOf] (smaller = more common; null / ≤ 0 = unranked → by best list position), ties by
     * more shared characters, then the hanzi. At most [limit].
     */
    fun <W> relatedWords(
        hanzi: String,
        records: List<CharWordList<W>>,
        hanziOf: (W) -> String,
        rankOf: (String) -> Int?,
        limit: Int = MAX,
    ): List<RelatedWord<W>> {
        val chars = hanzi.codePoints().toArray().map { String(Character.toChars(it)) }
        val byWord = LinkedHashMap<String, Acc<W>>()
        for (rec in records) {
            if (rec.char !in chars) continue
            rec.words.forEachIndexed { pos, w ->
                val h = hanziOf(w)
                if (h == hanzi) return@forEachIndexed
                val cur = byWord[h]
                if (cur != null) {
                    cur.shared += rec.char
                    cur.pos = minOf(cur.pos, pos)
                } else byWord[h] = Acc(w, linkedSetOf(rec.char), pos)
            }
        }
        val out = byWord.values.map { a ->
            val r = rankOf(hanziOf(a.word))
            RelatedWord(
                a.word,
                chars.filterIndexed { i, c -> c in a.shared && chars.indexOf(c) == i },
                if (r != null && r > 0) r else UNRANKED + a.pos,
            )
        }
        val sorted = out.sortedWith { a, b ->
            val byRank = a.rank.compareTo(b.rank)
            if (byRank != 0) return@sortedWith byRank
            val byShared = b.shared.size.compareTo(a.shared.size)
            if (byShared != 0) return@sortedWith byShared
            hanziOf(a.word).compareTo(hanziOf(b.word))
        }
        return sorted.take(maxOf(0, limit))
    }
}
