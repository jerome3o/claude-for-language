package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/study/listenContext.ts — "Listen in context", the QUESTION side of a
 * listening card (audio → hanzi): the note's sentences as audio-only rows (the card's own
 * sentence first, then the set), then "▶ The word", which first asks "Try the sentences
 * first?" while no sentence has been heard. Parity-tested (parity/fixtures/listen-context.ts).
 */
object ListenContext {
    /** LISTEN_CONTEXT_MIN_SENTENCES: fewer than this → the background top-up asks for more. */
    const val MIN_SENTENCES = 5
    /** LISTEN_CONTEXT_MORE_TARGET: "+ More sentences" aims for about this many in total. */
    const val MORE_TARGET = 8
    const val GENERATE_MIN = 3
    const val GENERATE_MAX = 10

    data class Sentence(val id: String, val hanzi: String, val translation: String? = null, val audioUrl: String? = null, val position: Int? = null, val focus: String? = null, val isCard: Boolean = false)

    /** One row. The hanzi is carried for the device voice — NEVER shown on the question. */
    data class Row(
        val key: String,
        val sentenceId: String,
        val hanzi: String,
        val translation: String?,
        val audioUrl: String?,
        val fromCard: Boolean,
        /** A set row written around a look-alike ([SentenceFocus.isContrived]): listed last, never counted. */
        val contrived: Boolean = false,
    )

    enum class RowState(val wire: String) { READY("ready"), FETCH("fetch"), UNAVAILABLE("unavailable") }

    sealed interface Autoplay {
        data class Sentence(val index: Int) : Autoplay
        data object Word : Autoplay
        data object None : Autoplay
    }

    enum class WordTap { PLAY, PROMPT }

    private fun blankToNull(s: String?): String? = s?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() }

    private fun isCard(s: Sentence) = s.isCard || s.id.endsWith(CardSentence.SUFFIX)

    /**
     * Port of listenContextRows: the note's rows (the card's own one included, [CardSentence.withCardSentence]) —
     * the card's sentence first, then the set by position, natural ones first.
     */
    fun rows(sentences: List<Sentence>): List<Row> =
        sentences.withIndex()
            .sortedWith(
                compareBy<IndexedValue<Sentence>> { if (isCard(it.value)) 0 else 1 }
                    .thenBy { if (SentenceFocus.isContrived(it.value.focus)) 1 else 0 }
                    .thenBy { it.value.position ?: it.index }.thenBy { it.index },
            )
            .map { (_, s) ->
                Row(
                    s.id, s.id, s.hanzi, blankToNull(s.translation), s.audioUrl?.takeIf { it.isNotEmpty() },
                    fromCard = isCard(s), contrived = !isCard(s) && SentenceFocus.isContrived(s.focus),
                )
            }

    /** Port of listenRowState. */
    fun rowState(audioUrl: String?, online: Boolean, cached: Boolean): RowState = when {
        !audioUrl.isNullOrEmpty() -> if (online || cached) RowState.READY else RowState.UNAVAILABLE
        !online -> RowState.UNAVAILABLE
        else -> RowState.FETCH
    }

    fun isPlayable(state: RowState) = state != RowState.UNAVAILABLE

    /** Port of listenAutoplay: the first ready sentence, else the word. */
    fun autoplay(enabled: Boolean, states: List<RowState>): Autoplay {
        if (!enabled) return Autoplay.None
        val i = states.indexOf(RowState.READY)
        return if (i >= 0) Autoplay.Sentence(i) else Autoplay.Word
    }

    /** Port of wordTapAction. */
    fun wordTap(sentencesPlayed: Int, playableSentences: Int, playedWordAnyway: Boolean): WordTap =
        if (sentencesPlayed > 0 || playableSentences == 0 || playedWordAnyway) WordTap.PLAY else WordTap.PROMPT

    /** Port of listenNaturalCount: the rows the top-ups count (contrived ones never make "enough"). */
    fun naturalCount(rows: List<Row>): Int = rows.count { !it.contrived }

    /** Port of needsSentenceTopUp. */
    fun needsTopUp(total: Int) = total < MIN_SENTENCES

    /** Port of topUpCount. */
    fun topUpCount(total: Int) = clampCount(MIN_SENTENCES - total)

    /** Port of moreSentencesCount. */
    fun moreCount(total: Int) = clampCount(MORE_TARGET - total)

    private fun clampCount(n: Int) = minOf(GENERATE_MAX, maxOf(GENERATE_MIN, n))

    // --- Fresh sentences every showing (pickListenRows) -------------------------------------------

    /** LISTEN_CONTEXT_SHOWN: sentences one showing offers. */
    const val SHOWN = 4
    /** LISTEN_CONTEXT_FRESH_LOW: a showing leaving fewer unheard than this asks for more. */
    const val FRESH_LOW = 4
    /** LISTEN_CONTEXT_FRESH_BUFFER: …enough to get back to about this many. */
    const val FRESH_BUFFER = 8

    /** Port of listenHash: FNV-1a over the UTF-16 code units, as an unsigned 32-bit number. */
    fun hash(text: String): Long {
        var h = 0x811c9dc5.toInt()
        for (c in text) {
            h = h xor c.code
            h *= 0x01000193
        }
        return h.toLong() and 0xffffffffL
    }

    /** mulberry32, unsigned 32-bit outputs (the TS `prng`). */
    private class Prng(seed: Long) {
        private var a = seed.toInt()
        fun next(): Long {
            a += 0x6d2b79f5
            var t = a
            t = (t xor (t ushr 15)) * (t or 1)
            t = t xor (t + (t xor (t ushr 7)) * (t or 61))
            return (t xor (t ushr 14)).toLong() and 0xffffffffL
        }
    }

    /** Port of seededShuffle (Fisher–Yates). */
    fun <T> shuffle(items: List<T>, seed: String): List<T> {
        val out = items.toMutableList()
        val prng = Prng(hash(seed))
        for (i in out.size - 1 downTo 1) {
            val j = (prng.next() % (i + 1)).toInt()
            val t = out[i]
            out[i] = out[j]
            out[j] = t
        }
        return out
    }

    /** Port of ListenPick. */
    data class Pick(val rows: List<Row>, val fresh: Int, val heardBefore: Int, val unheardLeft: Int)

    /**
     * Port of pickListenRows: the natural, visible sentences (contrived ones only when nothing else), never heard
     * in context first, then fewest heard; simple before long; heard longest ago; a seeded tie-break; never the
     * previous showing's exact set when there are more; shuffled with the showing's seed.
     */
    fun pick(
        rows: List<Row>,
        stats: Map<String, SentenceHistory.Stats>,
        seed: String,
        word: String? = null,
        previous: List<String>? = null,
        count: Int = SHOWN,
    ): Pick {
        val n = maxOf(0, count)
        fun statOf(r: Row) = stats[SentenceHistory.key(r.key)]
        fun heardCount(r: Row) = statOf(r)?.heard?.count ?: 0
        val visible = rows.filter { statOf(it)?.hidden == null }
        val natural = visible.filter { !it.contrived }
        val candidates = natural.ifEmpty { visible }
        data class Ranked(val row: Row, val heard: Int, val long: Int, val last: String, val tie: Long)
        val ranked = candidates
            .map { Ranked(it, heardCount(it), if (SentenceSimplicity.isSimple(it.hanzi, word)) 0 else 1, statOf(it)?.heard?.lastAt ?: "", hash("$seed|${it.key}")) }
            .sortedWith(compareBy<Ranked> { it.heard }.thenBy { it.long }.thenBy { it.last }.thenBy { it.tie }.thenBy { it.row.key })
            .map { it.row }
        val chosen = ranked.take(n).toMutableList()
        val prev = previous.orEmpty()
        if (ranked.size > chosen.size && chosen.isNotEmpty() && prev.size == chosen.size && chosen.all { it.key in prev }) {
            chosen[chosen.size - 1] = ranked[chosen.size]
        }
        val shown = shuffle(chosen, seed)
        val fresh = shown.count { heardCount(it) == 0 }
        val shownKeys = shown.map { it.key }.toHashSet()
        val unheardLeft = natural.count { heardCount(it) == 0 && it.key !in shownKeys }
        return Pick(shown, fresh, shown.size - fresh, unheardLeft)
    }

    /** Port of listenTopUpWant: reason "fresh" + how many, or null when enough unheard sentences wait. */
    fun topUpWant(unheardLeft: Int): SentenceHistory.MoreWanted? {
        if (unheardLeft >= FRESH_LOW) return null
        val count = minOf(SentenceHistory.TOPUP_MAX, maxOf(SentenceHistory.TOPUP_MIN, FRESH_BUFFER - maxOf(0, unheardLeft)))
        return SentenceHistory.MoreWanted("fresh", unheardLeft, count)
    }

    /** Port of listenShownProps (analytics `study.listen_context_shown`). */
    fun shownProps(pick: Pick): Map<String, Any> = mapOf("shown" to pick.rows.size, "fresh" to pick.fresh, "heard_before" to pick.heardBefore)

    /** Port of listenShownRows: the picked keys in order with current data, then rows added during the showing. */
    fun shownRows(rows: List<Row>, shownKeys: List<String>, added: List<String> = emptyList()): List<Row> {
        val byKey = rows.associateBy { it.key }
        val seen = HashSet<String>()
        return (shownKeys + added).mapNotNull { k -> byKey[k]?.takeIf { seen.add(k) } }
    }

    /** Port of listenContextProps (analytics `study.listen_context`). */
    fun props(sentencesPlayed: Int, promptShown: Boolean, playedWordAnyway: Boolean): Map<String, Any> = mapOf(
        "sentences_played" to sentencesPlayed,
        "word_first_prompt_shown" to promptShown,
        "played_word_anyway" to playedWordAnyway,
    )

    /** Port of listenRowLabel. */
    fun rowLabel(index: Int, played: Boolean) = "Sentence ${index + 1}" + if (played) ", played" else ""

    /** Port of LISTEN_CONTEXT_COPY. */
    object Copy {
        const val HEADING = "Listen in context"
        const val WORD = "The word"
        const val MORE = "+ More sentences"
        const val GENERATING = "Writing more sentences…"
        const val MORE_FAILED = "Could not write more sentences. Try again in a moment."
        const val UNAVAILABLE = "Not downloaded"
        const val PROMPT_TITLE = "Try the sentences first?"
        const val PROMPT_BODY = "Hearing the word in context helps."
        const val PROMPT_ANYWAY = "Play the word anyway"
        const val PROMPT_SENTENCE = "Play a sentence"
        const val NO_SENTENCES = "No example sentences yet."
        /** The dot on a sentence never heard in context before (until it is played). */
        const val NEW_SENTENCE = "New sentence"
        /** EN on the card's own sentence when the note has no English and it can't be fetched now. */
        const val TRANSLATION_OFFLINE = "Translation needs a connection"
    }
}
