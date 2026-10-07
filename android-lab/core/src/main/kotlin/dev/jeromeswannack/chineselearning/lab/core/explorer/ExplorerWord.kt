package dev.jeromeswannack.chineselearning.lab.core.explorer

import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.ToneChange

/*
 * Port of shared/explorer/word.ts — the Word view's facts (docs/LANGUAGE_EXPLORER.md): the
 * word's pinyin / meaning merged from the sources the device has, each character with its
 * syllable and tone, and how common it is. Parity-tested (ExplorerParityTest).
 */

/** Bump when the word record shape or its build rules change (port of WORD_DICT_VERSION). */
const val WORD_DICT_VERSION = 1

/** Most words `GET /api/words?w=` answers in one call (port of WORD_BATCH_MAX). */
const val WORD_BATCH_MAX = 50

/** Port of `WordRecord` (shared/chars/types.ts): one entry of the word dictionary. */
data class WordRecord(
    val hanzi: String,
    val pinyin: String,
    val syllables: List<String>,
    val english: String,
    val senses: List<String>,
    val rank: Int?,
)

/** Port of `CharWord`: a word in a character record's "Words with 字" list. */
data class DictWord(val hanzi: String, val pinyin: String, val english: String)

/** Port of `WordChar`: [tone] 1–4, 5 = neutral, null = unknown syllable. */
data class WordChar(val char: String, val syllable: String?, val tone: Int?)

/** Port of `FrequencyTier`. */
enum class FrequencyTier(val wire: String) { TOP("top"), COMMON("common"), UNCOMMON("uncommon"), RARE("rare") }

data class FrequencyLabel(val text: String, val tier: FrequencyTier)

/** Port of `WordNoteLike`. */
data class WordNoteLike(val hanzi: String, val pinyin: String?, val english: String?)

/** Port of `WordSource`. */
enum class WordSource(val wire: String) { DICTIONARY("dictionary"), CHAR_DICT("char_dict"), YOUR_CARD("your_card"), CONTEXT("context"), NONE("none") }

/** Port of `ResolvedWord`. */
data class ResolvedWord(
    val hanzi: String,
    val pinyin: String,
    val english: String,
    val senses: List<String>,
    val syllables: List<String>?,
    val rank: Int?,
    val source: WordSource,
)

object ExplorerWord {
    /** Port of COMMON_WORD_RANK. */
    const val COMMON_WORD_RANK = 5000

    /** Port of NAMED_WORD_RANK. */
    const val NAMED_WORD_RANK = 30000

    /** Port of `wordChars`: each Han character with its syllable (from [syllables], else split from [pinyin]). */
    fun wordChars(hanzi: String, pinyin: String?, syllables: List<String>? = null): List<WordChar> {
        val chars = hanzi.codePoints().toArray().filter { Known.isHan(it) }.map { String(Character.toChars(it)) }
        var syl: List<String>? = if (syllables != null && syllables.size == chars.size) syllables else null
        if (syl == null && !pinyin.isNullOrEmpty()) {
            val split = ToneChange.pinyinSyllables(pinyin.trim())
            if (split != null && split.size == chars.size) syl = split
        }
        return chars.mapIndexed { i, ch ->
            val s = syl?.get(i)
            WordChar(ch, s, if (!s.isNullOrEmpty()) ToneChange.syllableTone(s) else null)
        }
    }

    /** "#2,915" — JS `toLocaleString('en-US')` for a positive integer. */
    private fun thousands(n: Int): String {
        val digits = n.toString()
        val sb = StringBuilder()
        for ((i, c) in digits.withIndex()) {
            if (i > 0 && (digits.length - i) % 3 == 0) sb.append(',')
            sb.append(c)
        }
        return sb.toString()
    }

    /** Port of `wordFrequencyLabel`: "#570 most common word" up to rank 30,000, else "Rare word". */
    fun wordFrequencyLabel(rank: Int?): FrequencyLabel {
        if (rank == null || rank < 1) return FrequencyLabel("Rare word", FrequencyTier.RARE)
        val tier = when {
            rank <= 1000 -> FrequencyTier.TOP
            rank <= COMMON_WORD_RANK -> FrequencyTier.COMMON
            rank <= NAMED_WORD_RANK -> FrequencyTier.UNCOMMON
            else -> FrequencyTier.RARE
        }
        if (rank > NAMED_WORD_RANK) return FrequencyLabel("Rare word", tier)
        return FrequencyLabel("#${thousands(rank)} most common word", tier)
    }

    /**
     * Port of `resolveWord`: dictionary first — the word dictionary's [record], else the entry in
     * a character record's word list, else the learner's own card, else the tapped place's hint.
     * [rank] (the shipped list) wins over the record's.
     */
    fun resolveWord(
        hanzi: String,
        record: WordRecord? = null,
        charWords: List<DictWord>? = null,
        notes: List<WordNoteLike>? = null,
        hintPinyin: String? = null,
        hintGloss: String? = null,
        rank: Int? = null,
    ): ResolvedWord {
        val r = rank ?: record?.rank
        if (record != null && record.hanzi == hanzi) {
            return ResolvedWord(hanzi, record.pinyin, record.english, record.senses.toList(), record.syllables.toList(), r, WordSource.DICTIONARY)
        }
        charWords?.firstOrNull { it.hanzi == hanzi }?.let {
            return ResolvedWord(hanzi, it.pinyin, it.english, emptyList(), null, r, WordSource.CHAR_DICT)
        }
        notes?.firstOrNull { it.hanzi.trim() == hanzi && (!it.pinyin.isNullOrEmpty() || !it.english.isNullOrEmpty()) }?.let {
            return ResolvedWord(hanzi, it.pinyin ?: "", it.english ?: "", emptyList(), null, r, WordSource.YOUR_CARD)
        }
        if (!hintPinyin.isNullOrEmpty() || !hintGloss.isNullOrEmpty()) {
            return ResolvedWord(hanzi, hintPinyin ?: "", hintGloss ?: "", emptyList(), null, r, WordSource.CONTEXT)
        }
        return ResolvedWord(hanzi, "", "", emptyList(), null, r, WordSource.NONE)
    }
}
