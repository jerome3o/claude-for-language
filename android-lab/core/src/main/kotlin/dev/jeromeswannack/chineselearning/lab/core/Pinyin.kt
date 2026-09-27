package dev.jeromeswannack.chineselearning.lab.core

/**
 * Port of `pinyin(text, { toneType: 'symbol', type: 'string' })` from pinyin-pro 3.28.0 —
 * the web editors' `toPinyin` (frontend/src/components/editor/fields.tsx) — so the Lab app
 * fills pinyin offline with exactly the web app's result.
 *
 * Only the default option path is ported: surname 'off', segmentit MaxProbability,
 * toneSandhi on, nonZh 'spaced', no `v`, no custom / traditional dictionaries, separator " ".
 * The steps mirror the library:
 *  1. `splitString` — code points (a valid surrogate pair is one character).
 *  2. `acTree.match` — every dictionary word ending at each position, longest first
 *     (a hash lookup per length gives the same list in the same order as the AC automaton).
 *  3. `maxProbability` — the DP choosing the segmentation, with the library's doubles
 *     (DICT 2e-8, Rule 1e-12, Unknown 1e-13) and its 1e-300 `checkDecimal` rescaling.
 *  4. `getPinyin` — a matched word takes its dictionary pinyin; any other character goes through
 *     `processSepecialPinyin` (々, 了 → liǎo, 一 / 不 tone sandhi, else DICT1's first reading).
 *  5. `type: 'string'` — every character's result joined with " " (non-Chinese kept as is).
 *
 * Dictionaries: resources/pinyin/pinyin-dict.txt, written by
 * android-lab/parity/extract-pinyin-dict.mjs from the library itself and loaded lazily once.
 * PinyinParityTest holds this port equal to the real library over a large corpus.
 */
object Pinyin {
    /** `pinyin(text, { toneType: 'symbol', type: 'string' })`, e.g. 一个 → "yí gè". */
    fun toPinyin(text: String): String = convert(text, toneless = false)

    /** `pinyin(text, { toneType: 'none', type: 'string' })`, e.g. 一个 → "yi ge". */
    fun toPinyinToneless(text: String): String = convert(text, toneless = true)

    /** Loads the dictionary now (it otherwise loads on first use). */
    fun preload() {
        dict
    }

    // ---- dictionary ----

    private class Word(val pinyins: List<String>, val probability: Double, val length: Int)

    private class Dict(
        /** DICT1 for one UTF-16 unit (FastDictFactory.NumberDICT). */
        val bmp: Array<String?>,
        /** DICT1 for longer keys — supplementary characters (FastDictFactory.StringDICT). */
        val wide: HashMap<String, String>,
        val words: HashMap<String, Word>,
        val minWord: Int,
        val maxWord: Int,
    )

    private val dict: Dict by lazy { load() }

    private const val PROB_DICT = 2e-8
    private const val PROB_RULE = 1e-12
    private const val PROB_UNKNOWN = 1e-13

    /** How long the dictionary took to load (ms), for the benchmark in PinyinParityTest. */
    @Volatile
    internal var loadMillis: Double = -1.0
        private set

    private fun load(): Dict {
        val t0 = System.nanoTime()
        val stream = Pinyin::class.java.getResourceAsStream("/pinyin/pinyin-dict.txt")
            ?: error("pinyin/pinyin-dict.txt missing from the classpath")
        val bmp = arrayOfNulls<String>(65536)
        val wide = HashMap<String, String>()
        val words = HashMap<String, Word>(8192)
        var minWord = Int.MAX_VALUE
        var maxWord = 0
        var section = ""
        stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
            for (line in lines) {
                if (line.isEmpty()) continue
                if (line[0] == '#') {
                    section = line
                    continue
                }
                val tab = line.indexOf('\t')
                when (section) {
                    "#chars" -> {
                        val pinyin = line.substring(0, tab)
                        var i = tab + 1
                        while (i < line.length) {
                            val c = line[i]
                            if (Character.isHighSurrogate(c) && i + 1 < line.length && Character.isLowSurrogate(line[i + 1])) {
                                wide[line.substring(i, i + 2)] = pinyin
                                i += 2
                            } else {
                                bmp[c.code] = pinyin
                                i += 1
                            }
                        }
                    }
                    "#words" -> {
                        val tab2 = line.indexOf('\t', tab + 1)
                        val zh = line.substring(0, tab)
                        val pinyin = line.substring(tab + 1, tab2)
                        val probability = when (line[tab2 + 1]) {
                            'D' -> PROB_DICT
                            'R' -> PROB_RULE
                            else -> error("bad pinyin word line: $line")
                        }
                        val length = zh.codePointCount(0, zh.length)
                        words[zh] = Word(pinyin.split(' '), probability, length)
                        if (length < minWord) minWord = length
                        if (length > maxWord) maxWord = length
                    }
                }
            }
        }
        loadMillis = (System.nanoTime() - t0) / 1e6
        return Dict(bmp, wide, words, minWord, maxWord)
    }

    /** FastDictFactory.get: one UTF-16 unit by char code, anything longer by string. */
    private fun dict1(d: Dict, s: String): String? = if (s.length > 1) d.wide[s] else d.bmp[s[0].code]

    /** getSingleWordPinyin: the first reading, else the character itself. */
    private fun single(d: Dict, s: String): String {
        val p = dict1(d, s) ?: return s
        val sp = p.indexOf(' ')
        return if (sp < 0) p else p.substring(0, sp)
    }

    // ---- conversion ----

    private class Match(val index: Int, val word: Word)

    private class Dp(var probability: Double, var decimal: Int, var patterns: Cons?, var concat: Match?)

    /** The DP's pattern list, newest (= leftmost) first: JS's `concat` + final `reverse()`. */
    private class Cons(val head: Match, val tail: Cons?)

    private fun convert(text: String, toneless: Boolean): String {
        if (text.isEmpty()) return ""
        val d = dict

        // splitString
        val chars = ArrayList<String>(text.length)
        val offsets = IntArray(text.length + 1) // offsets[k] = UTF-16 start of character k
        var i = 0
        while (i < text.length) {
            offsets[chars.size] = i
            val c = text[i]
            if (Character.isHighSurrogate(c) && i + 1 < text.length && Character.isLowSurrogate(text[i + 1])) {
                chars += text.substring(i, i + 2)
                i += 2
            } else {
                chars += c.toString()
                i += 1
            }
        }
        val n = chars.size
        offsets[n] = text.length

        // AC match: per end position, every word ending there, longest first.
        val matches = ArrayList<Match>()
        for (end in 0 until n) {
            var len = minOf(d.maxWord, end + 1)
            while (len >= d.minWord) {
                val start = end - len + 1
                val w = d.words[text.substring(offsets[start], offsets[end + 1])]
                if (w != null) matches += Match(start, w)
                len--
            }
        }

        val chosen = maxProbability(matches, n)

        // getPinyin
        val result = arrayOfNulls<String>(n)
        val isZh = BooleanArray(n)
        var mi = 0
        var k = 0
        while (k < n) {
            val m = chosen.getOrNull(mi)
            if (m != null && k == m.index) {
                if (m.word.length == 1) { // never true for the bundled dictionaries (all words ≥ 2)
                    val p = special(d, chars[k], chars.getOrNull(k - 1), chars.getOrNull(k + 1))
                    result[k] = p
                    isZh[k] = p != chars[k]
                    k++
                    mi++
                    continue
                }
                for (j in 0 until m.word.length) {
                    result[k + j] = m.word.pinyins.getOrNull(j) ?: ""
                    isZh[k + j] = true
                }
                k += m.word.length
                mi++
            } else {
                val p = special(d, chars[k], chars.getOrNull(k - 1), chars.getOrNull(k + 1))
                result[k] = p
                isZh[k] = p != chars[k]
                k++
            }
        }

        val out = StringBuilder(text.length * 4)
        for (j in 0 until n) {
            if (j > 0) out.append(' ')
            out.append(if (toneless && isZh[j]) withoutTone(result[j]!!) else result[j])
        }
        return out.toString()
    }

    /** maxProbability(patterns, length) — the default segmentation. */
    private fun maxProbability(patterns: List<Match>, length: Int): List<Match> {
        val dp = arrayOfNulls<Dp>(length)
        var patternIndex = patterns.size - 1
        var pattern = patterns.getOrNull(patternIndex)
        for (i in length - 1 downTo 0) {
            val suffix = if (i + 1 >= length) Dp(1.0, 0, null, null) else dp[i + 1]!!
            while (pattern != null && pattern.index + pattern.word.length - 1 == i) {
                val start = pattern.index
                // getPatternDecimal is 0 for Priority.Normal (the only priority on this path)
                val cur = Dp(pattern.word.probability * suffix.probability, suffix.decimal, suffix.patterns, pattern)
                checkDecimal(cur)
                dp[start] = better(dp[start], cur)
                patternIndex--
                pattern = patterns.getOrNull(patternIndex)
            }
            // NB the library starts the unknown-character DP at decimal 0, not the suffix's.
            val iDp = Dp(PROB_UNKNOWN * suffix.probability, 0, suffix.patterns, null)
            checkDecimal(iDp)
            val best = better(dp[i], iDp)
            dp[i] = best
            val concat = best.concat
            if (concat != null) {
                best.patterns = Cons(concat, best.patterns)
                best.concat = null
            }
        }
        val out = ArrayList<Match>()
        var c = dp[0]!!.patterns
        while (c != null) {
            out += c.head
            c = c.tail
        }
        return out
    }

    private fun checkDecimal(p: Dp) {
        if (p.probability < 1e-300) {
            p.probability *= 1e300
            p.decimal += 1
        }
    }

    /** getMaxProbability(a, b). */
    private fun better(a: Dp?, b: Dp): Dp = when {
        a == null -> b
        a.decimal < b.decimal -> a
        a.decimal == b.decimal -> if (a.probability > b.probability) a else b
        else -> b
    }

    private val SANDHI_IGNORE_BU = setOf("的", "而", "之", "后", "也", "还", "地")
    private val SANDHI_IGNORE_YI = setOf("的", "而", "之", "后", "也", "还", "是")

    /** processSepecialPinyin(cur, pre, next). */
    private fun special(d: Dict, cur: String, pre: String?, next: String?): String {
        // processReduplicationChar
        if (cur == "々") {
            val p = if (pre == null) null else dict1(d, pre)
            return if (p == null) "tóng" else p.substringBefore(' ')
        }
        // processToneSandhiLiao
        if (cur == "了" && (pre == null || dict1(d, pre) == null)) return "liǎo"
        // processToneSandhi
        if (cur != "一" && cur != "不") return single(d, cur)
        if (pre != null && pre == next && single(d, pre) != pre) return withoutTone(single(d, cur))
        if (next != null) {
            val ignore = if (cur == "不") SANDHI_IGNORE_BU else SANDHI_IGNORE_YI
            if (next !in ignore) {
                val nextPinyin = single(d, next)
                if (nextPinyin != next) {
                    val tone = toneNumber(nextPinyin) // Number("") and Number("0") are both 0
                    if (cur == "不") {
                        if (tone == 4) return "bú"
                    } else {
                        if (tone == 4) return "yí"
                        if (tone == 1 || tone == 2 || tone == 3) return "yì"
                    }
                }
            }
        }
        return single(d, cur)
    }

    private val TONE1 = arrayOf("ā", "ō", "ē", "ī", "ū", "ǖ", "n̄", "m̄", "ê̄")
    private val TONE2 = arrayOf("á", "ó", "é", "í", "ú", "ǘ", "ń", "ḿ", "ế")
    private val TONE3 = arrayOf("ǎ", "ǒ", "ě", "ǐ", "ǔ", "ǚ", "ň", "m̌", "ê̌")
    private val TONE4 = arrayOf("à", "ò", "è", "ì", "ù", "ǜ", "ǹ", "m̀", "ề")

    /** Number(getNumOfTone(syllable)) for ONE syllable (0 for neutral / unknown). */
    private fun toneNumber(s: String): Int = when {
        TONE1.any { s.contains(it) } -> 1
        TONE2.any { s.contains(it) } -> 2
        TONE3.any { s.contains(it) } -> 3
        TONE4.any { s.contains(it) } -> 4
        else -> 0
    }

    private val TONELESS = listOf(
        Regex("(ā|á|ǎ|à)") to "a",
        Regex("(ō|ó|ǒ|ò)") to "o",
        Regex("(ē|é|ě|è)") to "e",
        Regex("(ī|í|ǐ|ì)") to "i",
        Regex("(ū|ú|ǔ|ù)") to "u",
        Regex("(ǖ|ǘ|ǚ|ǜ)") to "ü",
        Regex("(n̄|ń|ň|ǹ)") to "n",
        Regex("(m̄|ḿ|m̌|m̀)") to "m",
        Regex("(ê̄|ế|ê̌|ề)") to "ê",
    )

    /** getPinyinWithoutTone. */
    private fun withoutTone(p: String): String {
        var s = p
        for ((re, plain) in TONELESS) s = re.replace(s, plain)
        return s
    }
}
