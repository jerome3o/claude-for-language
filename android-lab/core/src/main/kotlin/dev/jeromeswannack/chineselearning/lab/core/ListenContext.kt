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

    data class Clue(val hanzi: String?, val translation: String? = null, val audioUrl: String? = null)
    data class Sentence(val id: String, val hanzi: String, val translation: String? = null, val audioUrl: String? = null, val position: Int? = null)

    /** One row. The hanzi is carried for the device voice — NEVER shown on the question. */
    data class Row(
        val key: String,
        val sentenceId: String?,
        val hanzi: String,
        val translation: String?,
        val audioUrl: String?,
        val fromCard: Boolean,
    )

    enum class RowState(val wire: String) { READY("ready"), FETCH("fetch"), DEVICE("device"), UNAVAILABLE("unavailable") }

    sealed interface Autoplay {
        data class Sentence(val index: Int) : Autoplay
        data object Word : Autoplay
        data object None : Autoplay
    }

    enum class WordTap { PLAY, PROMPT }

    /** Port of clueRowKey. */
    fun clueRowKey(noteId: String) = "clue:$noteId"

    private fun blankToNull(s: String?): String? = s?.let { AnswerKey.jsTrim(it) }?.takeIf { it.isNotEmpty() }

    /** Port of listenContextRows: the card's sentence first (unless the set repeats it), then the set by position. */
    fun rows(noteId: String, clue: Clue?, sentences: List<Sentence>): List<Row> {
        val out = ArrayList<Row>()
        val clueHanzi = clue?.hanzi?.takeIf { AnswerKey.jsTrim(it).isNotEmpty() }
        if (clueHanzi != null && sentences.none { it.hanzi == clueHanzi }) {
            out += Row(clueRowKey(noteId), null, clueHanzi, blankToNull(clue.translation), clue.audioUrl?.takeIf { it.isNotEmpty() }, fromCard = true)
        }
        sentences.withIndex()
            .sortedWith(compareBy<IndexedValue<Sentence>> { it.value.position ?: it.index }.thenBy { it.index })
            .forEach { (_, s) ->
                out += Row(s.id, s.id, s.hanzi, blankToNull(s.translation), s.audioUrl?.takeIf { it.isNotEmpty() }, fromCard = false)
            }
        return out
    }

    /** Port of listenRowState. */
    fun rowState(audioUrl: String?, sentenceId: String?, online: Boolean, cached: Boolean): RowState = when {
        !audioUrl.isNullOrEmpty() -> if (online || cached) RowState.READY else RowState.UNAVAILABLE
        !online -> RowState.UNAVAILABLE
        sentenceId != null -> RowState.FETCH
        else -> RowState.DEVICE
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

    /** Port of needsSentenceTopUp. */
    fun needsTopUp(total: Int) = total < MIN_SENTENCES

    /** Port of topUpCount. */
    fun topUpCount(total: Int) = clampCount(MIN_SENTENCES - total)

    /** Port of moreSentencesCount. */
    fun moreCount(total: Int) = clampCount(MORE_TARGET - total)

    private fun clampCount(n: Int) = minOf(GENERATE_MAX, maxOf(GENERATE_MIN, n))

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
    }
}
