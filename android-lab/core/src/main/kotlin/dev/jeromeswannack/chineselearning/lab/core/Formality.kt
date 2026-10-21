package dev.jeromeswannack.chineselearning.lab.core

import dev.jeromeswannack.chineselearning.lab.core.cards.AiWordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagLexicon
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTags
import dev.jeromeswannack.chineselearning.lab.core.cards.WordTagsAi

/*
 * Port of shared/decks/formality.ts — "Everyday words before formal ones" (NewCardOrder
 * `everydayFirst`): a note's class, everyday (0) < neutral (1) < formal (2), from the shipped
 * word-tag lexicon's register (the lexicon wins) and the note's AI word tags. Only WORD notes get
 * one; sentences are neutral; no lexicon → neutral. Parity-tested over the SHIPPED lexicon
 * (parity/fixtures/new-card-order.ts → NewCardOrderParityTest).
 */
object Formality {
    const val EVERYDAY = 0
    const val NEUTRAL = 1
    const val FORMAL = 2

    private val LEXICON_FORMAL = setOf("F", "L")
    private val LEXICON_NEVER_FORWARD = setOf("R", "D")
    private val LEXICON_EVERYDAY = setOf("C", "I", "S")

    /** Port of lexiconFormality(): null = the codes say nothing about formality. */
    fun lexiconFormality(codes: List<String>): Int? = when {
        codes.any { it in LEXICON_FORMAL } -> FORMAL
        codes.any { it in LEXICON_NEVER_FORWARD } -> NEUTRAL
        codes.any { it in LEXICON_EVERYDAY } -> EVERYDAY
        else -> null
    }

    /** Port of noteFormality(). */
    fun noteFormality(hanzi: String, lexicon: WordTagLexicon?, ai: AiWordTags?): Int {
        if (lexicon == null || Known.noteKind(hanzi) != NoteKind.Word) return NEUTRAL
        val codes = lexicon.words[WordTags.key(hanzi)]?.register.orEmpty()
        lexiconFormality(codes)?.let { return it }
        val register = if (codes.isEmpty()) WordTagsAi.visible(ai)?.register else null
        return when {
            register == "formal" || register == "literary" -> FORMAL
            register == "rude" -> NEUTRAL
            WordTagsAi.isEverydaySpeech(ai) -> EVERYDAY
            register == "informal" || register == "slang" -> EVERYDAY
            else -> NEUTRAL
        }
    }

    /** One note for [noteFormalityMap]: its hanzi and stored `word_tags` JSON (null = untagged). */
    data class Note(val id: String, val hanzi: String?, val wordTags: String?)

    /**
     * Port of noteFormalityMap(): note id → class, only the notes that aren't neutral (missing =
     * neutral), the AI verdict parsed only where the lexicon says nothing. Empty without a lexicon.
     */
    fun noteFormalityMap(notes: Iterable<Note>, lexicon: WordTagLexicon?): Map<String, Int> {
        if (lexicon == null) return emptyMap()
        val out = HashMap<String, Int>()
        for (n in notes) {
            val hanzi = n.hanzi ?: ""
            if (Known.noteKind(hanzi) != NoteKind.Word) continue
            val fromLexicon = lexiconFormality(lexicon.words[WordTags.key(hanzi)]?.register.orEmpty())
            val f = fromLexicon ?: if (n.wordTags.isNullOrEmpty()) NEUTRAL else noteFormality(hanzi, lexicon, WordTagsAi.parse(n.wordTags))
            if (f != NEUTRAL) out[n.id] = f
        }
        return out
    }
}
