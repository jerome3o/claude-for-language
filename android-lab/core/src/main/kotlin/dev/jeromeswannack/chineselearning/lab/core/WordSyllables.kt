package dev.jeromeswannack.chineselearning.lab.core

import java.text.Normalizer

/*
 * Port of shared/pinyin/wordSyllables.ts — a word's pinyin, one syllable per character
 * (docs/LANGUAGE_EXPLORER.md "Pinyin per character"). Parity-tested (parity/fixtures/explorer.ts →
 * ExplorerParityTest): the explorer's Word view cuts a word's pinyin into exactly one syllable per
 * Han character (吴侬软语 "wúnóngkuǎnyǔ" → wú | nóng | kuǎn | yǔ, never a greedy wún | óng), and
 * with the device's readings replaces a syllable its character can never have by the device's own
 * reading (软 kuǎn → ruǎn); pinyin that can't be lined up gives way to the device's reading.
 */

/** Port of `DevicePinyin`: what the device knows about how characters are read. */
class DevicePinyin(
    /** Every reading one character can have (Lab: `Pinyin.readings` + the character records on the phone). */
    val readings: ((String) -> List<String>)? = null,
    /** The device's own pinyin of a text (Lab: `ToneChange.autoPinyin`). */
    val auto: ((String) -> String)? = null,
)

/** Port of `AlignedWordPinyin`: [spans] = [start, end) of each syllable in the NFC pinyin. */
data class AlignedWordPinyin(val syllables: List<String>, val spans: List<Pair<Int, Int>>, val misfits: List<Int>)

/** Port of `WordPinyinHow`. */
enum class WordPinyinHow(val wire: String) { AS_GIVEN("as_given"), CORRECTED("corrected"), DEVICE("device"), NONE("none") }

/** Port of `CheckedWordPinyin`. */
data class CheckedWordPinyin(val pinyin: String, val syllables: List<String>?, val how: WordPinyinHow)

object WordSyllables {
    private const val LETTER_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZüÜvVāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ"
    private const val MARKED_CHARS = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ"
    private const val VOWEL_START = "aoeiuüāáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜ"
    private const val APOSTROPHE_START = "aoeāáǎàōóǒòēéěè"
    private const val MAX_LEN = 7
    private val COLLOQUIAL = mapOf("一" to listOf("yāo"), "喂" to listOf("wéi"))

    private fun isLetter(c: Char) = LETTER_CHARS.indexOf(c) >= 0
    private fun nfc(s: String) = Normalizer.normalize(s, Normalizer.Form.NFC)
    private fun startsWithAny(s: String, set: String) = s.isNotEmpty() && set.indexOf(s[0]) >= 0

    /** Port of `hanChars`: the Han characters of a text, one string per code point. */
    fun hanChars(text: String): List<String> =
        text.codePoints().toArray().filter { Known.isHan(it) }.map { String(Character.toChars(it)) }

    /** Port of `readingFits`. */
    fun readingFits(chars: List<String>, i: Int, syllable: String, readings: List<String>): Boolean {
        val ch = chars[i]
        val base = ToneChange.toneless(syllable)
        if (ch == "一") return base == "yi" || base == "yao"
        if (ch == "不") return base == "bu"
        val known = (readings + (COLLOQUIAL[ch] ?: emptyList())).filter { ToneChange.isPinyinSyllable(it) }
        if (known.isEmpty()) return true
        val tone = ToneChange.syllableTone(syllable)
        if (known.any { ToneChange.toneless(it) == base && (tone == 5 || ToneChange.syllableTone(it) == tone) }) return true
        return i > 0 && chars[i - 1] == ch && tone == 1 && known.any { ToneChange.toneless(it) == base }
    }

    private class Pick(val text: String, val start: Int, val end: Int, val misfit: Boolean)
    private class Best(val cost: Int, val picks: List<Pick>)

    private fun onePiece(piece: String): Boolean =
        ToneChange.isPinyinSyllable(piece) && piece.count { MARKED_CHARS.indexOf(it) >= 0 } <= 1

    private fun isErhua(piece: String): Boolean {
        val base = ToneChange.toneless(piece)
        return base.length > 1 && base.endsWith("r") && base != "er" && ToneChange.isPinyinSyllable(piece.dropLast(1))
    }

    /** Port of `alignWordSyllables`. */
    fun align(chars: List<String>, pinyin: String, fits: ((Int, String) -> Boolean)? = null): AlignedWordPinyin? {
        val p = nfc(pinyin)
        if (chars.isEmpty() || p.any { it in '0'..'9' }) return null
        val tokens = ArrayList<Pair<Int, String>>()
        var i = 0
        while (i < p.length) {
            if (!isLetter(p[i])) {
                i++
                continue
            }
            var j = i
            while (j < p.length && isLetter(p[j])) j++
            tokens.add(i to p.substring(i, j))
            i = j
        }
        if (tokens.isEmpty()) return null

        val memo = HashMap<String, Best?>()
        fun go(t: Int, pos: Int, ci: Int): Best? {
            if (t == tokens.size) return if (ci == chars.size) Best(0, emptyList()) else null
            val (tokStart, tok) = tokens[t]
            if (pos == tok.length) return go(t + 1, 0, ci)
            if (ci >= chars.size) return null
            val key = "$t:$pos:$ci"
            if (memo.containsKey(key)) return memo[key]
            var best: Best? = null
            val at = tokStart + pos
            var len = minOf(MAX_LEN, tok.length - pos)
            while (len >= 1) {
                val piece = tok.substring(pos, pos + len)
                if (onePiece(piece)) {
                    val penalty = if (pos > 0 && startsWithAny(piece.lowercase(), VOWEL_START)) 1 else 0
                    val plainMisfit = fits != null && !fits(ci, piece)
                    val rest = go(t, pos + len, ci + 1)
                    if (rest != null) {
                        val cost = penalty + (if (plainMisfit) 2 else 0) + rest.cost
                        if (best == null || cost < best.cost) best = Best(cost, listOf(Pick(piece, at, at + len, plainMisfit)) + rest.picks)
                    }
                    if (ci + 1 < chars.size && chars[ci + 1] == "儿" && isErhua(piece)) {
                        val base = piece.dropLast(1)
                        val misfit = fits != null && !fits(ci, base)
                        val after = go(t, pos + len, ci + 2)
                        if (after != null) {
                            val cost = penalty + (if (misfit) 2 else 0) + after.cost
                            if (best == null || cost < best.cost) {
                                best = Best(
                                    cost,
                                    listOf(Pick(base, at, at + len - 1, misfit), Pick(piece.takeLast(1), at + len - 1, at + len, false)) + after.picks,
                                )
                            }
                        }
                    }
                }
                len--
            }
            memo[key] = best
            return best
        }
        val best = go(0, 0, 0) ?: return null
        return AlignedWordPinyin(
            best.picks.map { it.text },
            best.picks.map { it.start to it.end },
            best.picks.withIndex().filter { it.value.misfit }.map { it.index },
        )
    }

    /** Port of `deviceSyllables`. */
    fun deviceSyllables(chars: List<String>, auto: ((String) -> String)?): List<String>? {
        if (auto == null || chars.isEmpty()) return null
        val out = runCatching { auto(chars.joinToString("")) }.getOrElse { return null }
        val parts = nfc(out).trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        return if (parts.size == chars.size && parts.all { ToneChange.isPinyinSyllable(it) }) parts else null
    }

    /** Port of `joinWordSyllables`. */
    fun joinWordSyllables(syllables: List<String>): String =
        syllables.mapIndexed { i, s -> if (i > 0 && startsWithAny(s.lowercase(), APOSTROPHE_START)) "'$s" else s }.joinToString("")

    private fun keepCapital(like: String, word: String): String =
        if (like.isNotEmpty() && like[0] != like[0].lowercaseChar() && word.isNotEmpty()) word[0].uppercaseChar() + word.substring(1) else word

    /** Port of `checkWordPinyin`. */
    fun check(hanzi: String, pinyin: String?, device: DevicePinyin = DevicePinyin(), trust: Boolean = false): CheckedWordPinyin {
        val chars = hanChars(hanzi)
        val given = (pinyin ?: "").trim()
        if (chars.isEmpty()) return CheckedWordPinyin(given, null, if (given.isNotEmpty()) WordPinyinHow.AS_GIVEN else WordPinyinHow.NONE)
        val readings = device.readings
        val fits: ((Int, String) -> Boolean)? = readings?.let { r -> { i: Int, s: String -> readingFits(chars, i, s, r(chars[i])) } }
        fun fromDevice(): CheckedWordPinyin? =
            deviceSyllables(chars, device.auto)?.let { CheckedWordPinyin(joinWordSyllables(it), it, WordPinyinHow.DEVICE) }

        if (given.isEmpty()) return fromDevice() ?: CheckedWordPinyin("", null, WordPinyinHow.NONE)
        val aligned = align(chars, given, fits)
        if (aligned != null && (trust || aligned.misfits.isEmpty())) return CheckedWordPinyin(given, aligned.syllables, WordPinyinHow.AS_GIVEN)
        if (aligned == null) return (if (trust) null else fromDevice()) ?: CheckedWordPinyin(given, null, WordPinyinHow.AS_GIVEN)

        val dev = deviceSyllables(chars, device.auto) ?: return CheckedWordPinyin(given, aligned.syllables, WordPinyinHow.AS_GIVEN)
        if (aligned.misfits.size * 2 > chars.size) return CheckedWordPinyin(joinWordSyllables(dev), dev, WordPinyinHow.DEVICE)

        var out = nfc(given)
        val syllables = aligned.syllables.toMutableList()
        for (i in aligned.misfits.sortedByDescending { aligned.spans[it].first }) {
            val (start, end) = aligned.spans[i]
            var rep = keepCapital(out.substring(start, end), dev[i])
            if (start > 0 && isLetter(out[start - 1]) && startsWithAny(rep.lowercase(), APOSTROPHE_START)) rep = "'$rep"
            out = out.substring(0, start) + rep + out.substring(end)
            syllables[i] = dev[i]
        }
        return CheckedWordPinyin(out, syllables, WordPinyinHow.CORRECTED)
    }
}
