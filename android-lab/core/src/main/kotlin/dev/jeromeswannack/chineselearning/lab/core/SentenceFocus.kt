package dev.jeromeswannack.chineselearning.lab.core

/**
 * Natural example sentences only — a port of shared/study/sentenceFocus.ts, parity-tested
 * (parity/fixtures/sentence-round.ts `natural` → SentenceRoundParityTest). docs/STUDY_SESSION.md "Natural sentences".
 *
 * Until Nov 2026 the sentence-set generator HAD to write one sentence around a word sharing a character with the
 * target (focus `shared_character`) and one around an easily-confused / similar-sounding word (`contrast`); Jerome
 * found them contrived. Those rows stay stored but are never a round exercise, never count toward "enough
 * sentences" (the top-ups) and come after the natural ones in the card's list.
 */
object SentenceFocus {
    /** `CONTRIVED_SENTENCE_FOCUSES` */
    val CONTRIVED: List<String> = listOf("shared_character", "contrast")

    /** `isContrivedSentence` */
    fun isContrived(focus: String?): Boolean = focus != null && focus in CONTRIVED

    /** `naturalSentencesFirst`: the natural ones first, then the contrived ones, each group in its own order. */
    fun <T> naturalFirst(rows: List<T>, focusOf: (T) -> String?): List<T> =
        rows.filter { !isContrived(focusOf(it)) } + rows.filter { isContrived(focusOf(it)) }

    /** `naturalSentenceCount` */
    fun <T> naturalCount(rows: List<T>, focusOf: (T) -> String?): Int = rows.count { !isContrived(focusOf(it)) }
}
