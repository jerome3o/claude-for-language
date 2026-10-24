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
    data class Stats(val read: ModeStats = ModeStats(), val translate: ModeStats = ModeStats(), val hidden: Hidden? = null) {
        fun mode(m: String): ModeStats = if (m == SentencePractise.TRANSLATE) translate else read
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
                    if (e.mode != SentencePractise.READ && e.mode != SentencePractise.TRANSLATE) continue
                    if (e.result != "right" && e.result != "close" && e.result != "wrong") continue
                    val cur = s ?: Stats()
                    val m = cur.mode(e.mode)
                    val next = m.copy(
                        attempts = m.attempts + 1,
                        rights = m.rights + if (e.result == "right") 1 else 0,
                        misses = m.misses + if (e.result == "right") 0 else 1,
                        lastAt = if (m.lastAt == null || e.at > m.lastAt) e.at else m.lastAt,
                    )
                    out[e.sentenceKey] = if (e.mode == SentencePractise.TRANSLATE) cur.copy(translate = next) else cur.copy(read = next)
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

    /** `wantsMoreSentences`: fewer than four in rotation, or every one left known in both modes. */
    fun wantsMore(sentences: List<SentenceRound.Sentence>, stats: Map<String, Stats>): Boolean {
        val visible = sentences.filter { stats[key(it.key)]?.hidden == null }
        if (visible.size < MIN_VISIBLE) return true
        return visible.all { s ->
            val st = stats[key(s.key)]
            known(st, SentencePractise.READ) && (NoteSearch.jsTrim(s.translation ?: "").isEmpty() || known(st, SentencePractise.TRANSLATE))
        }
    }

    /** `showHiddenLabel` */
    fun showHiddenLabel(count: Int) = "Show hidden ($count)"
}
