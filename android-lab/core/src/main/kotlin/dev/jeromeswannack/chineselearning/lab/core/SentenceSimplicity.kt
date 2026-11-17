package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of shared/study/sentenceSimplicity.ts — simple example sentences: at most [MAX_HAN] Han characters (or
 * the word's own + [WORD_ROOM]) and at most one clause break inside. "Listen in context" prefers simple
 * sentences among equally fresh ones ([ListenContext.pick]); the server drops new sentences that aren't.
 * Parity-tested in parity/fixtures/listen-context.ts.
 */
object SentenceSimplicity {
    const val MAX_HAN = 16
    const val WORD_ROOM = 8
    const val MAX_BREAKS = 1

    private fun isHan(cp: Int): Boolean = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN

    /** Port of hanCount (by code point). */
    fun hanCount(text: String?): Int {
        if (text == null) return 0
        var n = 0
        var i = 0
        while (i < text.length) {
            val cp = text.codePointAt(i)
            if (isHan(cp)) n++
            i += Character.charCount(cp)
        }
        return n
    }

    private val BREAKS = setOf("，", ",", "；", ";", "。", "！", "？", "!", "?")
    private val END = setOf("。", "！", "？", "!", "?", "…", "”", "\"", "」", "）", ")", "~", "～", ".")

    private fun codePoints(s: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val len = Character.charCount(cp)
            out += s.substring(i, i + len)
            i += len
        }
        return out
    }

    private fun isSpace(ch: String) = ch.length == 1 && NoteSearch.isJsWhitespace(ch[0])

    /** Port of clauseBreaks: ，；; anywhere, 。！？ only before the end. */
    fun clauseBreaks(text: String?): Int {
        val chars = codePoints(NoteSearch.jsTrim(text ?: ""))
        var end = chars.size
        while (end > 0 && (chars[end - 1] in END || isSpace(chars[end - 1]))) end--
        var n = 0
        for (i in 0 until end) if (chars[i] in BREAKS) n++
        return n
    }

    /** Port of simpleSentenceMaxHan. */
    fun maxHan(word: String?): Int = maxOf(MAX_HAN, hanCount(word) + WORD_ROOM)

    /** Port of simpleSentenceProblems: "too_long", "too_many_clauses". */
    fun problems(hanzi: String, word: String? = null): List<String> {
        val out = ArrayList<String>()
        if (hanCount(hanzi) > maxHan(word)) out += "too_long"
        if (clauseBreaks(hanzi) > MAX_BREAKS) out += "too_many_clauses"
        return out
    }

    /** Port of isSimpleSentence. */
    fun isSimple(hanzi: String, word: String? = null): Boolean = problems(hanzi, word).isEmpty()
}
