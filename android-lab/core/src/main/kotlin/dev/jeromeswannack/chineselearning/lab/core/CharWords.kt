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

/** Port of OwnCard: a single character's own card (shared/chars/status.ts charOwnCards). */
data class OwnCard(val status: CharWordStatus, val noteIds: List<String>)

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

    /** Port of isSingleHan(): exactly one Han character — the only thing that can have an own card. */
    fun isSingleHan(text: String): Boolean = text.codePointCount(0, text.length) == 1 && Known.isHan(text.codePointAt(0))

    /**
     * Port of charOwnCards(): does the learner have a note that IS this character (性 itself, not
     * 性别)? Keyed by each entry of [chars]; anything that isn't one Han character is None.
     */
    fun ownCards(chars: List<String>, notes: List<CharStatusNote>, cards: List<CharStatusCard>): Map<String, OwnCard> {
        val out = LinkedHashMap<String, OwnCard>()
        for (c in chars) out[c] = OwnCard(CharWordStatus.None, emptyList())
        val single = chars.distinct().filter(::isSingleHan)
        for (r in rows(single, notes, cards, null) { it }) out[r.word] = OwnCard(r.status, r.noteIds)
        return out
    }

    private fun deckList(decks: List<String>): String {
        val names = decks.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        return if (names.isEmpty()) "your decks" else names.joinToString(", ")
    }

    /** Port of ownCardLine(): "✓ Known — you have 性 as a card in HSK 5" / "📚 You have 性 as a card in HSK 5" / "". */
    fun ownCardLine(char: String, status: CharWordStatus, decks: List<String>): String = when (status) {
        CharWordStatus.Known -> "✓ Known — you have $char as a card in ${deckList(decks)}"
        CharWordStatus.InDecks -> "📚 You have $char as a card in ${deckList(decks)}"
        CharWordStatus.None -> ""
    }

    /** Port of addOwnCardLabel(). */
    fun addOwnCardLabel(char: String): String = "+ Add $char as a card"

    /** Port of OWN_CARD_BADGE: the badge on a Word view character chip. */
    fun ownCardBadge(status: CharWordStatus): String = when (status) {
        CharWordStatus.Known -> "✓"
        CharWordStatus.InDecks -> "📚"
        CharWordStatus.None -> ""
    }

    /** Port of charChipLabel(): a Word view character chip's accessible label. */
    fun charChipLabel(char: String, syllable: String?, status: CharWordStatus): String {
        val base = "The character $char${if (!syllable.isNullOrEmpty()) ", $syllable" else ""}"
        return when (status) {
            CharWordStatus.Known -> "$base — you have it as a card, known"
            CharWordStatus.InDecks -> "$base — you have it as a card"
            CharWordStatus.None -> base
        }
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
