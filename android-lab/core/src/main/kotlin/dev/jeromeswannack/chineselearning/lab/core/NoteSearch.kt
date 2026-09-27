package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer

/** Port of shared/decks/search.ts — the Decks tab's local card search (parity-tested). */
object NoteSearch {
    private val COMBINING = Regex("[̀-ͯ]")

    /** `stripTones`: lower-case and drop tone marks, so "yinhang" finds "yínháng". */
    fun stripTones(s: String): String = jsLower(COMBINING.replace(Normalizer.normalize(s, Normalizer.Form.NFD), ""))

    /** JS `toLowerCase()` (locale-independent, full Unicode mapping). */
    fun jsLower(s: String): String = s.lowercase(java.util.Locale.ROOT)

    /** The query as the web prepares it: trimmed, lower-cased. */
    fun prepare(raw: String): String = jsLower(jsTrim(raw))

    /**
     * `noteMatches(note, q, qStripped)`: hanzi, English and the card sentence by substring;
     * pinyin with or without tone marks. [q] is the prepared query.
     */
    fun matches(hanzi: String?, pinyin: String?, english: String?, sentenceClue: String?, q: String, qStripped: String = stripTones(q)): Boolean {
        if (q.isEmpty()) return false
        if (jsLower(hanzi.orEmpty()).contains(q)) return true
        if (jsLower(english.orEmpty()).contains(q)) return true
        val p = jsLower(pinyin.orEmpty())
        if (p.contains(q)) return true
        if (qStripped.isNotEmpty() && stripTones(p).contains(qStripped)) return true
        if (!sentenceClue.isNullOrEmpty() && jsLower(sentenceClue).contains(q)) return true
        return false
    }

    /** `String.prototype.trim` (JS whitespace + line terminators, incl. U+FEFF and U+3000). */
    fun jsTrim(s: String): String = s.trim { isJsWhitespace(it) }

    fun isJsWhitespace(c: Char): Boolean =
        c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' || c == ' ' ||
            c == ' ' || c in ' '..' ' || c == ' ' || c == ' ' || c == ' ' ||
            c == ' ' || c == '　' || c == '﻿'
}
