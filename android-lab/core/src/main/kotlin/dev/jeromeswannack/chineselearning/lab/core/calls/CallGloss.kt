package dev.jeromeswannack.chineselearning.lab.core.calls

import java.text.Normalizer

/**
 * Tab-complete on the call's text board — port of shared/calls/gloss.ts (parity-tested,
 * parity/fixtures/calls-gloss.ts). WHEN the board offers ` - pīnyīn - meaning` after the caret and
 * WHAT gets inserted. Indexes are characters (code points), like the board's CRDT.
 */
object CallGloss {
    /** Typing must have stopped this long (and no IME composition open) before we ask. */
    const val DEBOUNCE_MS = 500L
    /** The glossed phrase is the trailing Chinese run, at most this many characters. */
    const val MAX_SEGMENT = 40
    const val SEPARATOR = " - "

    sealed interface Check {
        data class Ok(val segment: String, val start: Int, val end: Int) : Check
        /** composing | selection | no_chinese | already_glossed | not_at_line_end */
        data class Skip(val reason: String) : Check
    }

    /** Port of isHanChar(): CJK ideographs (unified, ext. A–F, compatibility) and 〇. */
    fun isHan(ch: String): Boolean {
        if (ch.isEmpty()) return false
        val cp = ch.codePointAt(0)
        return cp in 0x3400..0x4dbf || cp in 0x4e00..0x9fff || cp in 0xf900..0xfaff || cp in 0x20000..0x2fa1f || cp == 0x3007
    }

    private val PUNCT: Set<String> = CallTextDoc.splitChars("，。！？、；：“”‘’（）《》〈〉【】「」『』〔〕…—～·．﹏").toSet()
    private val CLAUSE_BREAK: Set<String> = CallTextDoc.splitChars("，。！？、；：…").toSet()

    fun isChinesePunct(ch: String): Boolean = ch in PUNCT

    /** JavaScript's `\s` / String.trim set (Java's `\s` is ASCII only). */
    fun isJsSpace(c: Char): Boolean = c == ' ' || c == '\t' || c == '\n' || c == '\u000b' || c == '\u000c' || c == '\r' ||
        c == ' ' || c == ' ' || c in ' '..' ' || c == ' ' || c == ' ' || c == ' ' ||
        c == ' ' || c == '　' || c == '﻿'

    private fun jsTrim(s: String): String = s.trim { isJsSpace(it) }

    /** Port of findGlossSegment(): selection in characters (equal for a caret). */
    fun findSegment(text: String, selStart: Int, selEnd: Int, composing: Boolean = false): Check {
        if (composing) return Check.Skip("composing")
        if (selStart != selEnd) return Check.Skip("selection")
        val chars = CallTextDoc.splitChars(text)
        val caret = selEnd.coerceIn(0, chars.size)

        var lineEnd = caret
        while (lineEnd < chars.size && chars[lineEnd] != "\n") lineEnd++
        val rest = chars.subList(caret, lineEnd).joinToString("")
        val restTrim = rest.trimStart { it == ' ' || it == '\t' || it == '　' }
        if (restTrim.startsWith("-") || restTrim.startsWith("–") || restTrim.startsWith("—")) return Check.Skip("already_glossed")
        if (jsTrim(restTrim).isNotEmpty()) return Check.Skip("not_at_line_end")

        var start = caret
        while (start > 0 && chars[start - 1] != "\n" && (isHan(chars[start - 1]) || isChinesePunct(chars[start - 1]))) start--
        while (start < caret && isChinesePunct(chars[start])) start++
        if (caret - start > MAX_SEGMENT) {
            var cut = caret - MAX_SEGMENT
            for (i in cut until caret - 1) {
                if (chars[i] in CLAUSE_BREAK) { cut = i + 1; break }
            }
            start = cut
            while (start < caret && isChinesePunct(chars[start])) start++
        }
        val seg = chars.subList(start, caret)
        if (seg.none { isHan(it) }) return Check.Skip("no_chinese")
        return Check.Ok(seg.joinToString(""), start, caret)
    }

    /** Port of oneLine(): JS `s.replace(/\s+/g, ' ').trim()`. */
    fun oneLine(s: String): String {
        val sb = StringBuilder()
        var space = false
        for (c in s) {
            if (isJsSpace(c)) space = true
            else {
                if (space && sb.isNotEmpty()) sb.append(' ')
                space = false
                sb.append(c)
            }
        }
        return sb.toString()
    }

    /** Port of formatGloss(): what Tab / the chip inserts after the Chinese — always one line. */
    fun format(pinyin: String, english: String): String = "$SEPARATOR${oneLine(pinyin)}$SEPARATOR${oneLine(english)}"

    /** Port of glossChipLabel(): "⇥ nǐ hǎo - hello". */
    fun chipLabel(pinyin: String, english: String): String = "⇥ ${oneLine(pinyin)}$SEPARATOR${oneLine(english)}"

    /** Port of glossCacheKey(). */
    fun cacheKey(segment: String): String = jsTrim(Normalizer.normalize(segment, Normalizer.Form.NFC))
}
