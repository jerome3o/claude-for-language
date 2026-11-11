package dev.jeromeswannack.chineselearning.lab.core

/**
 * Practice per example sentence — a port of shared/study/sentenceHistory.ts, parity-tested
 * (parity/fixtures/sentence-history.ts → SentenceHistoryParityTest). docs/STUDY_SESSION.md "Sentence
 * practice history". Every 🎤 take on a sentence (round or answer-side row) and every "Stop showing this
 * sentence" / "Show again" is an event (synced by client id); [stats] folds a note's events per sentence.
 */
object SentenceHistory {
    const val CLUE_KEY = "clue"
    const val KNOWN_RIGHTS = 3
    const val MIN_VISIBLE = 4
    val HIDE_REASONS = listOf("weird", "wrong", "not_useful", "too_rare")
    val HIDE_REASON_LABEL = mapOf("weird" to "🤔 Weird", "wrong" to "❌ Wrong", "not_useful" to "🗑 Not useful", "too_rare" to "🦄 Too rare")
    const val COMING_NOTE = "✨ New sentences coming for this word"
    const val HIDE_TITLE = "Stop showing this sentence"
    const val HIDE_HINT = "It won’t come up in the Sentence round or the list again. Why?"
    const val HIDDEN_TOAST = "Sentence hidden"
    const val SHOW_AGAIN = "Show again"

    /** `SentencePracticeEvent` (kind attempt | hide | unhide). */
    data class Event(
        val id: String,
        val noteId: String,
        val sentenceKey: String,
        val kind: String,
        val mode: String? = null,
        val result: String? = null,
        val reason: String? = null,
        val at: String,
    )

    data class ModeStats(val attempts: Int = 0, val rights: Int = 0, val misses: Int = 0, val lastAt: String? = null)
    data class Hidden(val at: String, val reason: String?)
    /** `SentencePracticeMode`: read · translate (the rows' 🎤 and the round) · listen (Hard mode's "Sentences by ear"). */
    const val LISTEN = "listen"
    val MODES = listOf(SentencePractise.READ, SentencePractise.TRANSLATE, LISTEN)

    data class Stats(
        val read: ModeStats = ModeStats(),
        val translate: ModeStats = ModeStats(),
        val hidden: Hidden? = null,
        /** Understood by ear (Hard mode's "Sentences by ear"). */
        val listen: ModeStats = ModeStats(),
    ) {
        fun mode(m: String): ModeStats = when (m) {
            SentencePractise.TRANSLATE -> translate
            LISTEN -> listen
            else -> read
        }

        fun with(m: String, s: ModeStats): Stats = when (m) {
            SentencePractise.TRANSLATE -> copy(translate = s)
            LISTEN -> copy(listen = s)
            else -> copy(read = s)
        }
    }

    /** `sentenceHistoryKey`: `clue:<noteId>` → `clue`. */
    fun key(rowKey: String): String = if (rowKey.startsWith("clue:")) CLUE_KEY else rowKey

    /** `sentenceStats`: one note's events per sentence key (ids once, junk ignored, last hide / unhide decides). */
    fun stats(events: List<Event>, noteId: String): Map<String, Stats> {
        val out = LinkedHashMap<String, Stats>()
        val seen = HashSet<String>()
        val mine = events.filter { it.noteId == noteId }.sortedWith(compareBy<Event> { it.at }.thenBy { it.id })
        for (e in mine) {
            if (!seen.add(e.id)) continue
            val s = out[e.sentenceKey]
            when (e.kind) {
                "attempt" -> {
                    if (e.mode !in MODES) continue
                    if (e.result != "right" && e.result != "close" && e.result != "wrong") continue
                    val cur = s ?: Stats()
                    val m = cur.mode(e.mode!!)
                    val next = m.copy(
                        attempts = m.attempts + 1,
                        rights = m.rights + if (e.result == "right") 1 else 0,
                        misses = m.misses + if (e.result == "right") 0 else 1,
                        lastAt = if (m.lastAt == null || e.at > m.lastAt) e.at else m.lastAt,
                    )
                    out[e.sentenceKey] = cur.with(e.mode, next)
                }
                "hide" -> out[e.sentenceKey] = (s ?: Stats()).copy(hidden = Hidden(e.at, e.reason?.takeIf { it in HIDE_REASONS }))
                "unhide" -> out[e.sentenceKey] = (s ?: Stats()).copy(hidden = null)
            }
        }
        return out
    }

    /** `knownInMode` */
    fun known(stats: Stats?, mode: String): Boolean = (stats?.mode(mode)?.rights ?: 0) >= KNOWN_RIGHTS

    /** `compareLeastKnown`: negative = [a] is known less (comes first). */
    fun compareLeastKnown(a: ModeStats?, b: ModeStats?): Int {
        val x = a ?: ModeStats()
        val y = b ?: ModeStats()
        val xNever = if (x.attempts == 0) 0 else 1
        val yNever = if (y.attempts == 0) 0 else 1
        if (xNever != yNever) return xNever - yNever
        if (x.rights != y.rights) return x.rights - y.rights
        if (x.misses != y.misses) return y.misses - x.misses
        val xl = x.lastAt ?: ""
        val yl = y.lastAt ?: ""
        if (xl != yl) return if (xl < yl) -1 else 1
        return 0
    }

    /**
     * `isFreshSentence`: never practised in any mode — read, translate or listen (no take, right or wrong) — and
     * not hidden. The round asks fresh sentences first, so the word is practised in a sentence he hasn't seen in
     * a round before; one heard once by ear is used up like one read once (the fresh buffer refills).
     */
    fun isFresh(stats: Stats?): Boolean {
        if (stats == null) return true
        return stats.hidden == null && stats.read.attempts == 0 && stats.translate.attempts == 0 && stats.listen.attempts == 0
    }

    /**
     * `knownInAllModes`: known in every mode the sentence is practised in — the read slot by ear ([byEar]:
     * listen) or by eye (read), plus translate when it has English.
     */
    fun knownInAllModes(stats: Stats?, translation: Boolean, byEar: Boolean): Boolean {
        if (!known(stats, if (byEar) LISTEN else SentencePractise.READ)) return false
        return !translation || known(stats, SentencePractise.TRANSLATE)
    }

    /** `freshSentenceCount` */
    fun freshCount(sentences: List<SentenceRound.Sentence>, stats: Map<String, Stats>): Int =
        sentences.count { isFresh(stats[key(it.key)]) }

    /** `SENTENCE_FRESH_BUFFER`: the fresh sentences a word keeps waiting (about two rounds' worth). */
    const val FRESH_BUFFER = 8
    /** `SENTENCE_FRESH_LOW`: fewer fresh than this → more are made in the background. */
    const val FRESH_LOW = 6
    /** `SENTENCE_TOPUP_MIN` / `SENTENCE_TOPUP_MAX`: one top-up makes between these many sentences. */
    const val TOPUP_MIN = 3
    const val TOPUP_MAX = 8
    /** `SENTENCE_TOPUP_RETRY_MS`: a word asks for more at most this often. */
    const val TOPUP_RETRY_MS = 10 * 60_000L

    /** `freshTopUpCount`: how many one top-up should make with [fresh] fresh ones left (back up to the buffer). */
    fun freshTopUpCount(fresh: Int): Int = minOf(TOPUP_MAX, maxOf(TOPUP_MIN, FRESH_BUFFER - maxOf(0, fresh)))

    /** `moreSentencesWanted`'s answer: [reason] "few" | "fresh". */
    data class MoreWanted(val reason: String, val fresh: Int, val count: Int)

    /**
     * `moreSentencesWanted`: fewer than four left in rotation ("few"), or fewer than [FRESH_LOW] fresh ones left
     * ("fresh" — the buffer is refilled before it runs out). Hidden sentences don't count. null = enough.
     */
    fun moreWanted(sentences: List<SentenceRound.Sentence>, stats: Map<String, Stats>): MoreWanted? {
        val visible = sentences.filter { stats[key(it.key)]?.hidden == null }
        val fresh = freshCount(visible, stats)
        if (visible.size < MIN_VISIBLE) return MoreWanted("few", fresh, freshTopUpCount(fresh))
        if (fresh < FRESH_LOW) return MoreWanted("fresh", fresh, freshTopUpCount(fresh))
        return null
    }

    /** `wantsMoreSentences` */
    fun wantsMore(sentences: List<SentenceRound.Sentence>, stats: Map<String, Stats>): Boolean = moreWanted(sentences, stats) != null

    /** `sentencesComingShown`: show [COMING_NOTE] only when the round itself is short; a buffer refill is silent. */
    fun comingShown(want: MoreWanted?): Boolean = want != null && (want.reason == "few" || want.fresh < MIN_VISIBLE)

    /** `showHiddenLabel` */
    fun showHiddenLabel(count: Int) = "Show hidden ($count)"
}
