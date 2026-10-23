package dev.jeromeswannack.chineselearning.lab.core.calls

import java.text.Normalizer

/**
 * Tab-complete on the call's text board — port of shared/calls/gloss.ts (parity-tested,
 * parity/fixtures/calls-gloss.ts). WHEN the board offers ` - pīnyīn - meaning` after the caret
 * (after Chinese, direction "zh") or ` - 中文 - pīnyīn` (after an English word or short phrase,
 * direction "en") and WHAT gets inserted. Indexes are characters (code points), like the board's CRDT.
 */
object CallGloss {
    /** Typing must have stopped this long (and no IME composition open) before we ask. */
    const val DEBOUNCE_MS = 500L
    /** The glossed phrase is the trailing Chinese run, at most this many characters. */
    const val MAX_SEGMENT = 40
    const val SEPARATOR = " - "
    /** An English run: at most this many words… */
    const val MAX_EN_WORDS = 8
    /** …and characters… */
    const val MAX_EN_CHARS = 60
    /** …and at least this many Latin letters ("a" / "I" / "3" never, "OK" / "TV" yes). */
    const val MIN_EN_LETTERS = 2
    /** Port of GLOSS_CACHE_VERSION: part of every cache key, so glosses from older server rules are never reused. */
    const val CACHE_VERSION = 2

    const val ZH = "zh"
    const val EN = "en"

    sealed interface Check {
        /** [direction]: "zh" (Chinese typed → pinyin + meaning) or "en" (English typed → Chinese + pinyin). */
        data class Ok(val segment: String, val start: Int, val end: Int, val direction: String = ZH) : Check
        /** composing | selection | no_text | too_short | too_long | already_glossed | not_at_line_end */
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
    private val DASHES = setOf("-", "–", "—")
    private val SPACE_RUN = Regex("[ \t]+")

    /** Port of isLatinLetter(): ASCII letters only. */
    fun isLatinLetter(ch: String): Boolean = ch.length == 1 && (ch[0] in 'A'..'Z' || ch[0] in 'a'..'z')

    private fun isAsciiAlnum(ch: String): Boolean = ch.length == 1 && (ch[0] in 'A'..'Z' || ch[0] in 'a'..'z' || ch[0] in '0'..'9')

    private fun isEnglishRunChar(ch: String): Boolean =
        isAsciiAlnum(ch) || ch == " " || ch == "\t" || ch == "'" || ch == "’" || ch == "-"

    /** JS `/^(\p{Script=Latin}|\p{M})$/u`: an accented Latin letter or a combining mark. */
    private fun isAccentedLetterOrMark(ch: String): Boolean {
        if (ch.isEmpty() || ch.codePointCount(0, ch.length) != 1) return false
        val cp = ch.codePointAt(0)
        val type = Character.getType(cp)
        if (type == Character.NON_SPACING_MARK.toInt() || type == Character.COMBINING_SPACING_MARK.toInt() || type == Character.ENCLOSING_MARK.toInt()) return true
        return Character.UnicodeScript.of(cp) == Character.UnicodeScript.LATIN
    }

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

        if (caret > 0 && isAsciiAlnum(chars[caret - 1])) return findEnglishRun(chars, caret)

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
        if (seg.none { isHan(it) }) return Check.Skip("no_text")
        return Check.Ok(seg.joinToString(""), start, caret, ZH)
    }

    /** Port of findEnglishRun(): the character before the caret is an ASCII letter or digit. */
    private fun findEnglishRun(chars: List<String>, caret: Int): Check {
        var start = caret
        while (start > 0 && isEnglishRunChar(chars[start - 1])) start--
        for (i in start until caret) {
            if (chars[i] in DASHES && (i == start || chars[i - 1] == " " || chars[i - 1] == "\t")) return Check.Skip("already_glossed")
        }
        var b = start
        while (b > 0 && (chars[b - 1] == " " || chars[b - 1] == "\t" || chars[b - 1] == "　")) b--
        if (b > 0 && chars[b - 1] in DASHES) return Check.Skip("already_glossed")
        // Inside a word with accents — pinyin (xiǎng → "ng") or French — never English.
        if (start > 0 && isAccentedLetterOrMark(chars[start - 1])) return Check.Skip("no_text")
        while (start < caret && !isAsciiAlnum(chars[start])) start++
        val seg = chars.subList(start, caret)
        if (seg.count { isLatinLetter(it) } < MIN_EN_LETTERS) return Check.Skip("too_short")
        val text = seg.joinToString("")
        if (seg.size > MAX_EN_CHARS || text.split(SPACE_RUN).size > MAX_EN_WORDS) return Check.Skip("too_long")
        return Check.Ok(text, start, caret, EN)
    }

    /** Port of glossDirectionOf(): any Chinese character → "zh", else "en". */
    fun directionOf(text: String): String = if (CallTextDoc.splitChars(text).any { isHan(it) }) ZH else EN

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

    /** The non-empty parts, each after the separator (port of formatGloss(): an empty part is left out). */
    private fun formatParts(vararg parts: String): String = parts.map { oneLine(it) }.filter { it.isNotEmpty() }.joinToString("") { "$SEPARATOR$it" }
    private fun chipParts(vararg parts: String): String = "⇥ " + parts.map { oneLine(it) }.filter { it.isNotEmpty() }.joinToString(SEPARATOR)

    /** Port of formatGloss() after Chinese: what Tab / the chip inserts — always one line (" - nǐ hǎo" without a meaning). */
    fun format(pinyin: String, english: String): String = formatParts(pinyin, english)

    /** Port of glossChipLabel() after Chinese: "⇥ nǐ hǎo - hello". */
    fun chipLabel(pinyin: String, english: String): String = chipParts(pinyin, english)

    /** Port of formatGloss() after English ({ chinese, pinyin }): " - 苹果 - píngguǒ". */
    fun formatEn(chinese: String, pinyin: String): String = formatParts(chinese, pinyin)

    /** Port of glossChipLabel() after English: "⇥ 苹果 - píngguǒ". */
    fun chipLabelEn(chinese: String, pinyin: String): String = chipParts(chinese, pinyin)

    /** Port of glossCacheKey(): the text as sent to the server. */
    fun cacheKey(segment: String): String = jsTrim(Normalizer.normalize(segment, Normalizer.Form.NFC))

    /** Port of glossStoreKey(): what a gloss is cached under — rules version + direction + text. */
    fun storeKey(segment: String, direction: String): String = "v$CACHE_VERSION:$direction:${cacheKey(segment)}"

    // ---------- reliability: the device's own gloss, and how long to wait after a failure (ports)

    /** Port of GLOSS_LOCAL_AFTER_MS: a pinyin-only device gloss waits this long for the server's. */
    const val LOCAL_AFTER_MS = 900L
    const val RETRY_AFTER_FAILURE_MS = 3_000L
    const val RATE_LIMIT_WAIT_MS = 10_000L
    const val MAX_WAIT_MS = 30_000L
    const val LOCAL_MAX_WORDS = 8
    const val MAX_PINYIN_CHARS = 240

    /** Port of glossBackoffMs(): [status] null = a network failure / timeout. */
    fun backoffMs(status: Int?, retryAfterSeconds: Double? = null): Long {
        if (status == 429) {
            if (retryAfterSeconds != null && retryAfterSeconds.isFinite() && retryAfterSeconds > 0) {
                return minOf(MAX_WAIT_MS, maxOf(1_000L, Math.round(retryAfterSeconds * 1000)))
            }
            return RATE_LIMIT_WAIT_MS
        }
        if (status == null || status >= 500) return RETRY_AFTER_FAILURE_MS
        return 0L
    }

    /** Port of glossOutcomeForStatus(). */
    fun outcomeForStatus(status: Int?): String = when {
        status == null -> "offline"
        status == 429 -> "rate_limited"
        status == 503 -> "unavailable"
        else -> "failed"
    }

    /** A word of the segment as the device's segmenter cut it (port of GlossWord). */
    data class Word(val text: String, val pinyin: String)

    /** The device's gloss (port of Gloss with a possibly empty meaning). */
    data class Local(val pinyin: String, val english: String)

    private val PINYIN_PUNCT = mapOf("，" to ",", "、" to ",", "？" to "?", "！" to "!", "；" to ";", "：" to ":")

    private fun marks(chars: List<String>): String = chars.joinToString("") { PINYIN_PUNCT[it] ?: "" }

    /** Port of localGlossPinyin(). */
    fun localPinyin(words: List<Word>): String {
        val out = mutableListOf<String>()
        for (w in words) {
            val chars = CallTextDoc.splitChars(w.text)
            if (chars.any { isHan(it) }) {
                val p = oneLine(w.pinyin).replace(" ", "")
                if (p.isEmpty()) return ""
                out += p
            } else if (out.isNotEmpty()) {
                val m = marks(chars)
                if (m.isNotEmpty()) out[out.size - 1] = out.last() + m
            }
        }
        return out.joinToString(" ")
    }

    /** Port of glossLookupWord(). */
    fun lookupWord(words: List<Word>?): String? {
        if (words == null) return null
        val han = words.filter { w -> CallTextDoc.splitChars(w.text).any { isHan(it) } }
        return if (han.size == 1) han[0].text else null
    }

    private val SEP_DASH = Regex(" [-–—] ")
    private val TRAILING_STOP = Regex("[….。]+$")
    private val TRAILING_COMMA = Regex("[,;:]+$")

    /** Port of shortDictMeaning(). */
    fun shortDictMeaning(raw: String): String {
        var s = jsTrim(oneLine(raw.split(';')[0]).replace(SEP_DASH, ", ").replace(TRAILING_STOP, ""))
        val words = s.split(' ').filter { it.isNotEmpty() }
        if (words.size > LOCAL_MAX_WORDS) s = words.take(LOCAL_MAX_WORDS).joinToString(" ").replace(TRAILING_COMMA, "")
        if (s.isEmpty() || CallTextDoc.splitChars(s).any { isHan(it) }) return ""
        return s
    }

    /** Port of localGloss(): [dictPinyin] / [dictEnglish] = the dictionary entry of the segment's only word. */
    fun localGloss(words: List<Word>?, dictPinyin: String? = null, dictEnglish: String? = null): Local? {
        if (words.isNullOrEmpty()) return null
        val dp = if (!dictPinyin.isNullOrEmpty()) oneLine(dictPinyin) else ""
        val pinyin = if (dp.isNotEmpty() && CallTextDoc.splitChars(dp).none { isHan(it) }) dp + trailingMarks(words) else localPinyin(words)
        if (pinyin.isEmpty() || pinyin.length > MAX_PINYIN_CHARS) return null
        return Local(pinyin, shortDictMeaning(dictEnglish ?: ""))
    }

    private fun trailingMarks(words: List<Word>): String {
        var tail = ""
        for (i in words.indices.reversed()) {
            val chars = CallTextDoc.splitChars(words[i].text)
            if (chars.any { isHan(it) }) break
            tail = marks(chars) + tail
        }
        return tail
    }
}
