package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer

/**
 * Port of shared/pinyin/toneChange.ts — the textbook tone changes of 一 and 不 in written
 * pinyin, the ONE rule every automatic pinyin path runs (web: `autoPinyin`, the worker's
 * Claude pinyin, the word checker). Parity-tested (parity/fixtures/tone-change.ts →
 * ToneChangeParityTest).
 *
 * 一 stays yī alone / at a word's end / as a number, ordinal or date; yí before a 4th tone,
 * yì before 1st–3rd; neutral yi in A一A. 不 is bú before a 4th tone, otherwise bù; neutral bu
 * in A不A. A written neutral is left alone; nothing else changes. Pinyin that can't be lined
 * up with the characters comes back as is.
 */
object ToneChange {
    /** Port of `YI_BU_CONVENTION`. */
    const val YI_BU_CONVENTION =
        "一 and 不 are written with their tone changes: 一 is yī alone, at the end of a word, as a number, ordinal or in dates (第一, 十一, 一月一日); yí before a 4th tone (一个 yí gè, 一样 yíyàng), yì before a 1st / 2nd / 3rd tone (一天 yì tiān, 一年 yì nián, 一起 yìqǐ); neutral yi in reduplicated verbs (看一看 kàn yi kàn). 不 is bú before a 4th tone (不是 bú shì, 不对 bú duì), otherwise bù (不好 bù hǎo); neutral bu in A不A questions (要不要 yào bu yào). No other tone changes: third tones stay as written (nǐ hǎo)."

    /**
     * The pinyin the app writes by itself for Chinese text (editors' 拼音 fill, Paste a list,
     * word pinyin): the pinyin-pro port, then the 一 / 不 tone changes. Port of
     * frontend/src/utils/autoPinyin.ts `autoPinyin(text)`.
     */
    fun autoPinyin(text: String): String {
        if (text.isEmpty()) return ""
        return applyYiBuToneChanges(text, Pinyin.toPinyin(text))
    }

    // ---- tables ----

    private val MARKS: Map<Char, Pair<Char, Int>> = buildMap {
        for ((base, marks) in listOf('a' to "āáǎà", 'e' to "ēéěè", 'i' to "īíǐì", 'o' to "ōóǒò", 'u' to "ūúǔù", 'ü' to "ǖǘǚǜ")) {
            marks.forEachIndexed { i, m -> put(m, base to (i + 1)) }
        }
    }

    private val DIGITS = "零〇一二三四五六七八九十".map { it.toString() }.toSet()
    private val BIG_NUMBERS = "百千万亿".map { it.toString() }.toSet()

    /** Port of `YI_WORD_FINAL`: characters after which 一 ends a word and stays yī. */
    val YI_WORD_FINAL: Set<String> = "第统唯之初专单划归逐万合纯期".map { it.toString() }.toSet()
    private val YI_ORDINAL_NEXT = "楼号月".map { it.toString() }.toSet()

    private const val LETTER_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZüÜvVāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ'"
    private fun isLetter(c: Char) = LETTER_CHARS.indexOf(c) >= 0

    /** JS `/^\p{Script=Han}$/u` on one code point string. */
    internal fun isHan(ch: String): Boolean {
        if (ch.isEmpty()) return false
        val cp = ch.codePointAt(0)
        return Character.charCount(cp) == ch.length && Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN
    }

    private fun nfc(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC)

    /** Code points of a string as strings (JS `[...s]` / `Array.from(s)`). */
    internal fun codePoints(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            out.add(s.substring(i, i + n))
            i += n
        }
        return out
    }

    /** Port of `syllableTone`: 1–4 from the mark, 5 = neutral. */
    fun syllableTone(syllable: String): Int {
        for (ch in codePoints(nfc(syllable).lowercase())) {
            if (ch.length == 1) MARKS[ch[0]]?.let { return it.second }
        }
        return 5
    }

    private fun plain(syllable: String): String {
        val sb = StringBuilder()
        for (ch in codePoints(nfc(syllable).lowercase())) {
            val m = if (ch.length == 1) MARKS[ch[0]] else null
            if (m != null) sb.append(m.first) else sb.append(ch)
        }
        return sb.toString().replace('v', 'ü')
    }

    // ---- syllable segmentation ----

    private val INITIALS = listOf("zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s", "y", "w")
    private val FINALS = setOf(
        "a", "o", "e", "i", "u", "ü", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng", "ong", "er",
        "ia", "ie", "iao", "iu", "ian", "in", "iang", "ing", "iong",
        "ua", "uo", "uai", "ui", "uan", "un", "uang", "ueng", "ue", "üe", "üan", "ün",
    )

    private fun isSyllable(s: String): Boolean {
        if (s.isEmpty()) return false
        val core = if (s.endsWith("r") && s.length > 2 && s !in FINALS && !s.endsWith("er")) s.substring(0, s.length - 1) else s
        for (ini in INITIALS) if (core.startsWith(ini) && core.substring(ini.length) in FINALS) return true
        return core in FINALS || core == "ê" || core == "r"
    }

    private fun segmentLengths(run: String): List<Int>? {
        val s = plain(run)
        val memo = HashMap<Int, List<Int>?>()
        fun go(i: Int): List<Int>? {
            if (i == s.length) return emptyList()
            if (memo.containsKey(i)) return memo[i]
            var best: List<Int>? = null
            val skip = if (i < s.length && s[i] == '\'') 1 else 0
            val start = i + skip
            var len = minOf(7, s.length - start)
            while (len >= 1) {
                if (isSyllable(s.substring(start, start + len))) {
                    val rest = go(start + len)
                    if (rest != null) {
                        best = listOf(skip + len) + rest
                        break
                    }
                }
                len--
            }
            memo[i] = best
            return best
        }
        return go(0)
    }

    private class Syl(val start: Int, val end: Int, val text: String)

    private fun syllablesOf(pinyin: String): List<Syl>? {
        if (pinyin.any { it in '0'..'9' }) return null
        val out = ArrayList<Syl>()
        var i = 0
        while (i < pinyin.length) {
            if (!isLetter(pinyin[i]) || pinyin[i] == '\'') {
                i++
                continue
            }
            var j = i
            while (j < pinyin.length && isLetter(pinyin[j])) j++
            val run = pinyin.substring(i, j)
            val lengths = segmentLengths(run) ?: return null
            var k = i
            for (len in lengths) {
                // JS `slice` clamps; a length computed on a differently-sized lowercase can overrun.
                val raw = jsSlice(pinyin, k, k + len)
                val lead = if (raw.startsWith("'")) 1 else 0
                out.add(Syl(k + lead, k + len, raw.substring(lead)))
                k += len
            }
            i = j
        }
        return out
    }

    /**
     * Port of `pinyinSyllables`: the syllables of tone-marked pinyin ("dǎoháng" → ["dǎo", "háng"]),
     * or null when it is not plain tone-marked pinyin (tone numbers, unknown syllables).
     */
    fun pinyinSyllables(pinyin: String): List<String>? = syllablesOf(nfc(pinyin))?.map { it.text }

    private fun jsSlice(s: String, from: Int, to: Int): String {
        val a = from.coerceIn(0, s.length)
        val b = to.coerceIn(0, s.length)
        return if (b <= a) "" else s.substring(a, b)
    }

    private fun withTone(base: String, tone: Int, like: String): String {
        val vowels = if (base == "yi") "īíǐì" else "ūúǔù"
        val word = base[0].toString() + (if (tone in 1..4) vowels[tone - 1] else base[1])
        val first = if (like.isEmpty()) "" else codePoints(like)[0]
        return if (first.isNotEmpty() && first != first.lowercase()) word[0].uppercase() + word.substring(1) else word
    }

    private fun targetTone(chars: List<String>, tones: List<Int?>, i: Int): Int? {
        val ch = chars[i]
        val prev = if (i > 0) chars[i - 1] else ""
        val next = if (i + 1 < chars.size) chars[i + 1] else ""
        val nextHan = next != "" && isHan(next)
        val prevHan = prev != "" && isHan(prev)
        val nextTone: Int? = if (!nextHan) null else if (next == "一") 1 else if (next == "不") 4 else tones[i + 1]
        if (ch == "一") {
            if (!nextHan) return 1
            if (prev in YI_WORD_FINAL || prev in DIGITS || prev in BIG_NUMBERS) return 1
            if (next != "两" && next in DIGITS) return 1
            if (next in YI_ORDINAL_NEXT || (next == "年" && chars.getOrNull(i + 2) == "级")) return 1
            if ((next == "日" || next == "号") && prev == "月") return 1
            if (prevHan && prev == next && prev !in DIGITS) return 5
            if (nextTone == 4) return 2
            if (nextTone == 1 || nextTone == 2 || nextTone == 3) return 4
            if (nextTone == 5 && next == "个") return 2
            return null
        }
        if (!nextHan) return 4
        if (prevHan && prev == next) return 5
        if (nextTone == 4) return 2
        if (nextTone == 1 || nextTone == 2 || nextTone == 3) return 4
        return null
    }

    /** Port of `applyYiBuToneChanges(hanzi, pinyin)`. */
    fun applyYiBuToneChanges(hanzi: String, pinyin: String): String {
        if (hanzi.isEmpty() || pinyin.isEmpty() || (hanzi.indexOf('一') < 0 && hanzi.indexOf('不') < 0)) return pinyin
        val n = nfc(pinyin)
        val syls = syllablesOf(n) ?: return pinyin
        val chars = codePoints(nfc(hanzi))
        var hanIdx = chars.indices.filter { isHan(chars[it]) }
        if (hanIdx.size != syls.size) {
            val withoutEr = hanIdx.filter { !(chars[it] == "儿" && it > 0 && isHan(chars[it - 1])) }
            if (withoutEr.size != hanIdx.size && withoutEr.size == syls.size) hanIdx = withoutEr else return pinyin
        }
        val sylAt = HashMap<Int, Syl>()
        hanIdx.forEachIndexed { k, ci -> sylAt[ci] = syls[k] }
        if (chars.any { c -> c.any { it in 'A'..'Z' || it in 'a'..'z' } }) return pinyin
        val tones: List<Int?> = chars.indices.map { i -> sylAt[i]?.let { syllableTone(it.text) } }

        val edits = ArrayList<Pair<Syl, String>>()
        chars.forEachIndexed { i, ch ->
            if (ch != "一" && ch != "不") return@forEachIndexed
            val syl = sylAt[i] ?: return@forEachIndexed
            val base = if (ch == "一") "yi" else "bu"
            if (plain(syl.text) != base) return@forEachIndexed
            if (tones[i] == 5) return@forEachIndexed
            val tone = targetTone(chars, tones, i)
            if (tone == null || tone == tones[i]) return@forEachIndexed
            edits.add(syl to withTone(base, tone, syl.text))
        }
        if (edits.isEmpty()) return pinyin
        var out = n
        for ((syl, text) in edits.sortedByDescending { it.first.start }) {
            out = jsSlice(out, 0, syl.start) + text + out.substring(minOf(syl.end, out.length))
        }
        return out
    }
}
