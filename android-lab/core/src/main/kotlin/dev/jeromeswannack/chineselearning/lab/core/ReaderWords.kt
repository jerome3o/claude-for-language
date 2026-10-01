package dev.jeromeswannack.chineselearning.lab.core

/**
 * Reader word chips — port of shared/reader/words.ts (the parts the phone needs; segmenting
 * happens on the server). A page's words concatenate to its text exactly; words that don't
 * (the page was edited since) are stale and never shown. Parity-tested in ReaderWordsParityTest
 * against parity/fixtures/reader-words.ts.
 */
object ReaderWords {
    /** `isTappableWord`: a segment holding a letter, digit or hanzi (JS `/[\p{L}\p{N}]/u`). */
    fun isTappable(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            when (Character.getType(cp)) {
                Character.UPPERCASE_LETTER.toInt(), Character.LOWERCASE_LETTER.toInt(), Character.TITLECASE_LETTER.toInt(),
                Character.MODIFIER_LETTER.toInt(), Character.OTHER_LETTER.toInt(),
                Character.DECIMAL_DIGIT_NUMBER.toInt(), Character.LETTER_NUMBER.toInt(), Character.OTHER_NUMBER.toInt() -> return true
            }
            i += Character.charCount(cp)
        }
        return false
    }

    /** `wordsMatchText`: a non-empty segmentation of exactly [text]. */
    fun matches(words: List<String>?, text: String): Boolean {
        if (words.isNullOrEmpty() || text.isEmpty()) return false
        val sb = StringBuilder()
        for (w in words) {
            if (w.isEmpty()) return false
            sb.append(w)
        }
        return sb.toString() == text
    }

    /** `wordOffsets`: each segment's start (UTF-16 units, like JS). */
    fun offsets(words: List<String>): List<Int> {
        var at = 0
        return words.map { w -> at.also { at += w.length } }
    }

    private fun isTerminal(c: Char) = c == '。' || c == '！' || c == '？' || c == '!' || c == '?' || c == '\n'
    private fun isSentenceEnd(c: Char) = c == '。' || c == '！' || c == '？' || c == '!' || c == '?'
    private fun isCloser(c: Char) = c == '”' || c == '"' || c == '』' || c == '」' || c == '’' || c == '\'' || c == '）' || c == ')'

    /** `sentenceAround`: the sentence of [text] holding [start, end) — what a word is explained in. */
    fun sentenceAround(text: String, start: Int, end: Int = start + 1): String {
        var from = start
        while (from > 0) {
            val prev = text[from - 1]
            if (isTerminal(prev)) break
            if (isCloser(prev) && from - 2 >= 0 && isSentenceEnd(text[from - 2])) break
            from--
        }
        var to = maxOf(end, start)
        while (to < text.length && !isTerminal(text[to])) to++
        if (to < text.length && text[to] != '\n') {
            to++
            while (to < text.length && isSentenceEnd(text[to])) to++
            if (to < text.length && isCloser(text[to])) to++
        }
        return jsTrim(text.substring(from, minOf(to, text.length)))
    }

    /** `String.prototype.trim`: ECMAScript WhiteSpace + LineTerminator. */
    private fun isJsSpace(c: Char) = c == '\t' || c == '\u000B' || c == '\u000C' || c == ' ' || c == '\u00A0' || c == '\uFEFF' ||
        c == '\n' || c == '\r' || c == '\u2028' || c == '\u2029' || Character.getType(c) == Character.SPACE_SEPARATOR.toInt()

    private fun jsTrim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isJsSpace(s[a])) a++
        while (b > a && isJsSpace(s[b - 1])) b--
        return s.substring(a, b)
    }
}
