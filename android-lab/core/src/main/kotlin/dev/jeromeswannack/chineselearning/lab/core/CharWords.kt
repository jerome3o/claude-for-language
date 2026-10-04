package dev.jeromeswannack.chineselearning.lab.core

/*
 * The character sheet's "Words with 字" list (docs/STUDY_SESSION.md "Character sheet").
 * Port of shared/chars/status.ts, parity-tested in CharWordsParityTest against vectors from
 * the TypeScript (parity/fixtures/char-words.ts).
 *
 * - known: a note with the same spelling ([Known.noteKey]) has a mature card — Review with
 *   stability > 21 days ([Mastery.level] == Mastered).
 * - in_decks: they have the word but no card of it is mature yet.
 * - none: no note with that spelling.
 *
 * Order: the word(s) of the card on screen first, then the dictionary's frequency order.
 */

/** Bump when the record shape or the build rules change: devices refetch their cache (CHAR_DICT_VERSION). */
const val CHAR_DICT_VERSION = 1

/** Most characters `GET /api/chars?c=` answers in one call (CHAR_BATCH_MAX). */
const val CHAR_BATCH_MAX = 100

enum class CharWordStatus(val wire: String) {
    Known("known"),
    InDecks("in_decks"),
    None("none"),
    ;

    companion object {
        fun fromWire(s: String): CharWordStatus = entries.first { it.wire == s }
    }
}

data class CharStatusNote(val id: String, val hanzi: String)

/** [queue]: 0 NEW, 1 LEARNING, 2 REVIEW, 3 RELEARNING. */
data class CharStatusCard(val noteId: String, val queue: Int, val stability: Double)

data class CharWordRow<W>(
    val word: W,
    val status: CharWordStatus,
    /** The learner's notes with this spelling (any deck), in input order. */
    val noteIds: List<String>,
    /** The card on screen is (or contains) this word. */
    val current: Boolean,
)

object CharWords {
    /** Port of CHAR_STATUS_LABEL. */
    fun label(status: CharWordStatus): String = when (status) {
        CharWordStatus.Known -> "✓ Known"
        CharWordStatus.InDecks -> "📚 In your decks"
        CharWordStatus.None -> ""
    }

    /** Port of wordInCard(): the word's spelling occurs in the card's hanzi. */
    fun wordInCard(wordHanzi: String, cardHanzi: String?): Boolean {
        if (cardHanzi.isNullOrEmpty()) return false
        val w = Known.noteKey(wordHanzi)
        return w.isNotEmpty() && Known.noteKey(cardHanzi).contains(w)
    }

    /** Port of charWordRows(). */
    fun <W> rows(
        words: List<W>,
        notes: List<CharStatusNote>,
        cards: List<CharStatusCard>,
        cardHanzi: String?,
        hanziOf: (W) -> String,
    ): List<CharWordRow<W>> {
        val wanted = words.map { Known.noteKey(hanziOf(it)) }.filter { it.isNotEmpty() }.toSet()
        val notesByKey = LinkedHashMap<String, MutableList<String>>()
        val keyOfNote = HashMap<String, String>()
        for (n in notes) {
            val k = Known.noteKey(n.hanzi)
            if (k.isEmpty() || k !in wanted) continue
            keyOfNote[n.id] = k
            val list = notesByKey[k]
            if (list != null) {
                if (n.id !in list) list += n.id
            } else notesByKey[k] = mutableListOf(n.id)
        }
        val knownKeys = HashSet<String>()
        for (c in cards) {
            val k = keyOfNote[c.noteId] ?: continue
            if (Mastery.level(c.queue, c.stability) == MasteryLevel.Mastered) knownKeys += k
        }
        val seen = HashSet<String>()
        val rows = ArrayList<CharWordRow<W>>()
        for (word in words) {
            val k = Known.noteKey(hanziOf(word))
            if (k.isEmpty() || !seen.add(k)) continue
            val ids = notesByKey[k].orEmpty()
            rows += CharWordRow(
                word = word,
                status = when {
                    k in knownKeys -> CharWordStatus.Known
                    ids.isNotEmpty() -> CharWordStatus.InDecks
                    else -> CharWordStatus.None
                },
                noteIds = ids.toList(),
                current = wordInCard(hanziOf(word), cardHanzi),
            )
        }
        return rows.filter { it.current } + rows.filter { !it.current }
    }

    /** Port of charWordsSummary(): "3 of 20 known · 2 in your decks". */
    fun summary(statuses: List<CharWordStatus>): String {
        val known = statuses.count { it == CharWordStatus.Known }
        val inDecks = statuses.count { it == CharWordStatus.InDecks }
        val parts = mutableListOf("$known of ${statuses.size} known")
        if (inDecks > 0) parts += "$inDecks in your decks"
        return parts.joinToString(" · ")
    }
}
