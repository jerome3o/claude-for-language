package dev.jeromeswannack.chineselearning.lab.core.chinese

import dev.jeromeswannack.chineselearning.lab.core.FrequencyIndex
import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.ReaderWords
import dev.jeromeswannack.chineselearning.lab.core.ToneChange
import dev.jeromeswannack.chineselearning.lab.core.WordFrequency

/**
 * Port of shared/chinese/segment.ts — deterministic word segmentation (jieba's algorithm: a DAG
 * of every dictionary word in a run of Han characters + a few rules, then the DP for the
 * cheapest = most probable path) over the two word lists both apps ship
 * (shared/data/frequency/word-freq.txt + segment-words.txt, core resources). The segments
 * concatenate back to the text exactly. Parity-tested over a corpus (parity/fixtures/segment.ts
 * → SegmenterParityTest), so the Lab app's word chips are the web app's, chip for chip.
 *
 * Costs are integer milli-nats (`WORD_COST_BASE + round(1000 · ln(rank))`, StrictMath = the
 * fdlibm log V8 uses), so sums are exact and ties break the same way on both sides. ICU's word
 * break iterator was not used: its dictionary differs between Android versions and Node.
 */
object Segmenter {
    const val WORD_COST_BASE = 3300
    const val COMPOUND_EXTRA = 3500
    const val UNKNOWN_CHAR_RANK = 100_000
    const val NUMBER_RANK = 1_000
    const val REDUP_EXTRA = 700
    const val A_YI_A_EXTRA = 1_500
    const val ERHUA_EXTRA = 3_000
    const val MAX_WORD_LENGTH = 8

    const val NUMERALS = "零一二两三四五六七八九十百千万亿"
    const val MEASURE_WORDS = "个本只次天年岁块张位件条点种杯瓶碗双家辆篇句遍月号元斤米层节支首份部门封间座把台场顿趟周课"
    const val REDUP_STOP = "的了是不一在和吗呢吧啊也就都我你他她它很这那有"

    /** Port of `SegmentDictionary`. */
    class Dictionary(val costs: Map<String, Int>, val maxLength: Int)

    /** Port of `SegmentWords`. */
    class Words(val ranked: Map<String, Int>, val compounds: Set<String>)

    /** One segment (shared `ReaderWord`): gloss is always "". */
    data class Segment(val text: String, val pinyin: String = "", val gloss: String = "")

    /** Port of rankCost(). */
    fun rankCost(rank: Int): Int = WORD_COST_BASE + Math.round(1000.0 * StrictMath.log(maxOf(1, rank).toDouble())).toInt()

    private val UNKNOWN_CHAR_COST = rankCost(UNKNOWN_CHAR_RANK)
    private val NUMBER_COST = rankCost(NUMBER_RANK)

    private fun codePoints(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val n = Character.charCount(s.codePointAt(i))
            out.add(s.substring(i, i + n))
            i += n
        }
        return out
    }

    private fun cpLength(s: String): Int = s.codePointCount(0, s.length)

    /** JS `String.prototype.trim` whitespace (the same set as [isSpace] + line terminators). */
    private fun jsTrim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isSpace(s[a].code)) a++
        while (b > a && isSpace(s[b - 1].code)) b--
        return s.substring(a, b)
    }

    /** Port of parseSegmentWords(). */
    fun parseWords(text: String): Words {
        val ranked = LinkedHashMap<String, Int>(40_000)
        val compounds = LinkedHashSet<String>()
        var section = ""
        var rank = 0
        for (raw in text.split('\n')) {
            val line = jsTrim(raw)
            if (line == "#ranked" || line == "#compounds") { section = line; continue }
            if (line.isEmpty() || line.startsWith("#")) continue
            if (section == "#compounds") { compounds.add(line); continue }
            if (section != "#ranked") continue
            val tab = line.indexOf('\t')
            if (tab <= 0) continue
            val step = line.substring(tab + 1).toIntOrNull() ?: continue
            if (step < 0) continue
            rank += step
            val word = line.substring(0, tab)
            if (rank >= 1 && word !in ranked) ranked[word] = rank
        }
        return Words(ranked, compounds)
    }

    /** Port of buildSegmentDictionary(). */
    fun dictionary(listed: Map<String, Int>, extra: Words = Words(emptyMap(), emptySet())): Dictionary {
        val costs = HashMap<String, Int>(listed.size + extra.ranked.size + 16)
        var maxLength = 1
        fun add(word: String, cost: Int) {
            if (word in costs) return
            val len = cpLength(word)
            if (len < 1 || len > MAX_WORD_LENGTH) return
            costs[word] = cost
            if (len > maxLength) maxLength = len
        }
        // The list first: a word in both keeps the list's cost (like the TS).
        for ((w, r) in listed) add(w, rankCost(r) + if (w in extra.compounds) COMPOUND_EXTRA else 0)
        for ((w, r) in extra.ranked) add(w, rankCost(r))
        return Dictionary(costs, maxLength)
    }

    /**
     * The dictionary from the lists shipped as core resources (word-freq.txt via
     * [WordFrequency.shipped], segment-words.txt); loaded once, null if unreadable.
     */
    val shipped: Dictionary? by lazy {
        runCatching {
            val freq: FrequencyIndex = WordFrequency.shipped ?: return@runCatching null
            val stream = Segmenter::class.java.getResourceAsStream("/frequency/segment-words.txt") ?: return@runCatching null
            dictionary(freq.words, parseWords(stream.bufferedReader(Charsets.UTF_8).use { it.readText() }))
        }.getOrNull()
    }

    private fun singleCost(ch: String, dict: Dictionary): Int = dict.costs[ch] ?: UNKNOWN_CHAR_COST

    /** Port of ruleCandidates(): [length, cost] pairs from position [i]. */
    fun ruleCandidates(chars: List<String>, i: Int, dict: Dictionary): List<Pair<Int, Int>> {
        val out = ArrayList<Pair<Int, Int>>(4)
        val n = chars.size
        var j = i
        if (chars[j] == "第") j++
        val numStart = j
        while (j < n && j - numStart < MAX_WORD_LENGTH && NUMERALS.contains(chars[j])) j++
        if (j > numStart) {
            if (j - i >= 2) out.add(j - i to NUMBER_COST)
            if (j < n && MEASURE_WORDS.contains(chars[j])) out.add(j + 1 - i to NUMBER_COST)
        }
        val a = chars[i]
        if (!REDUP_STOP.contains(a)) {
            if (i + 3 < n && chars[i + 1] == a && chars[i + 2] == chars[i + 3] && chars[i + 2] != a) {
                dict.costs[a + chars[i + 2]]?.let { out.add(4 to it + REDUP_EXTRA) }
            }
            if (i + 1 < n && chars[i + 1] == a) out.add(2 to singleCost(a, dict) + REDUP_EXTRA)
            if (i + 2 < n) {
                val mid = chars[i + 1]
                if (chars[i + 2] == a && (mid == "一" || mid == "不") && !(i > 0 && chars[i - 1] == mid)) {
                    out.add(3 to singleCost(a, dict) + A_YI_A_EXTRA)
                }
            }
        }
        return out
    }

    /** Port of segmentHanRun(). */
    fun segmentHanRun(run: String, dict: Dictionary): List<String> {
        val chars = codePoints(run)
        val n = chars.size
        if (n == 0) return emptyList()
        val inf = Long.MAX_VALUE
        val best = LongArray(n + 1)
        val step = IntArray(n + 1) { 1 }
        val sb = StringBuilder()
        for (i in n - 1 downTo 0) {
            val maxLen = minOf(MAX_WORD_LENGTH + 2, n - i)
            val lookup = minOf(dict.maxLength, maxLen)
            val edge = LongArray(maxLen + 1) { inf }
            sb.setLength(0)
            for (len in 1..lookup) {
                sb.append(chars[i + len - 1])
                dict.costs[sb.toString()]?.let { edge[len] = it.toLong() }
            }
            for (len in lookup downTo 1) {
                if (edge[len] != inf && len + 1 <= maxLen && chars[i + len] == "儿") {
                    edge[len + 1] = minOf(edge[len + 1], edge[len] + ERHUA_EXTRA)
                }
            }
            if (edge[1] == inf) edge[1] = UNKNOWN_CHAR_COST.toLong()
            for ((len, c) in ruleCandidates(chars, i, dict)) {
                if (len <= maxLen && c < edge[len]) edge[len] = c.toLong()
            }
            var bestCost = inf
            var bestLen = 1
            for (len in maxLen downTo 1) {
                if (edge[len] == inf) continue
                val total = edge[len] + best[i + len]
                if (total < bestCost) { bestCost = total; bestLen = len }
            }
            best[i] = bestCost
            step[i] = bestLen
        }
        val out = ArrayList<String>()
        var i = 0
        while (i < n) {
            out.add(chars.subList(i, i + step[i]).joinToString(""))
            i += step[i]
        }
        return out
    }

    /** Port of isSpaceChar(): JS `\s`. */
    fun isSpace(c: Int): Boolean =
        (c in 0x09..0x0d) || c == 0x20 || c == 0xa0 || c == 0x1680 || (c in 0x2000..0x200a) ||
            c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff

    enum class Kind { HAN, LATIN, PUNCT, SPACE }

    private fun kindOf(ch: String): Kind {
        val cp = ch.codePointAt(0)
        return when {
            Known.isHan(cp) -> Kind.HAN
            isSpace(cp) -> Kind.SPACE
            ReaderWords.isTappable(ch) -> Kind.LATIN
            else -> Kind.PUNCT
        }
    }

    /** Port of textRuns(). */
    fun textRuns(text: String): List<Pair<Kind, String>> {
        val out = ArrayList<Pair<Kind, StringBuilder>>()
        for (ch in codePoints(text)) {
            val kind = kindOf(ch)
            val last = out.lastOrNull()
            if (last != null && last.first == kind) last.second.append(ch) else out.add(kind to StringBuilder(ch))
        }
        return out.map { it.first to it.second.toString() }
    }

    /**
     * Port of segmentChinese(): [pinyinOf] gives a Han run's pinyin, one syllable per character
     * separated by spaces (the app's [ToneChange.autoPinyin]); null = no pinyin.
     */
    fun segment(text: String, dict: Dictionary, pinyinOf: ((String) -> String)? = null): List<Segment> {
        val out = ArrayList<Segment>()
        for ((kind, run) in textRuns(text)) {
            if (kind != Kind.HAN) { out.add(Segment(run)); continue }
            val words = segmentHanRun(run, dict)
            val syllables = runSyllables(run, pinyinOf)
            var at = 0
            for (w in words) {
                val len = cpLength(w)
                out.add(Segment(w, syllables?.subList(at, at + len)?.joinToString("") ?: ""))
                at += len
            }
        }
        return out
    }

    /** The app's pinyin path: pinyin-pro port + the 一 / 不 tone changes. */
    val autoPinyin: (String) -> String = { ToneChange.autoPinyin(it) }

    private fun runSyllables(run: String, pinyinOf: ((String) -> String)?): List<String>? {
        if (pinyinOf == null) return null
        val raw = runCatching { pinyinOf(run) }.getOrNull() ?: return null
        val syllables = jsTrim(raw).split(Regex("[\\t\\n\\u000B\\u000C\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")).filter { it.isNotEmpty() }
        return if (syllables.size == cpLength(run)) syllables else null
    }

    /** The segment texts only. */
    fun texts(text: String, dict: Dictionary): List<String> = segment(text, dict).map { it.text }
}
