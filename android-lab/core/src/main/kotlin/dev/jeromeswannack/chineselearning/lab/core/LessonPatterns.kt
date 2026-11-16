package dev.jeromeswannack.chineselearning.lab.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import dev.jeromeswannack.chineselearning.lab.core.spec.JsJson

/*
 * Port of shared/lesson/pattern.ts — grammar structures as "pattern cards" (docs/STUDY_SESSION.md
 * "Structure cards"): a note's `patterns` (fixed words + slots, meaning, examples mapped onto the
 * pieces), the deterministic parser that reads the same cards out of older free-text structure lines,
 * the example aligner and the colour roles. Parity-tested (LessonPatternsParityTest) against the TS.
 */

@Serializable
data class PatternPiece(
    val hanzi: String? = null,
    val pinyin: String? = null,
    val english: String? = null,
    val slot: String? = null,
    val zh: String? = null,
    val optional: Boolean? = null,
)

@Serializable
data class PatternExamplePart(val text: String = "", val piece: Int? = null)

@Serializable
data class PatternExample(
    val hanzi: String = "",
    val pinyin: String? = null,
    val english: String? = null,
    val parts: List<PatternExamplePart>? = null,
)

@Serializable
data class LessonPattern(
    val name: String? = null,
    val pieces: List<PatternPiece> = emptyList(),
    val meaning: String? = null,
    val examples: List<PatternExample>? = null,
    val note: String? = null,
    @SerialName("image_prompt") val imagePrompt: String? = null,
    @SerialName("image_url") val imageUrl: String? = null,
    /** "▶ Watch the intro": the voice-over, ≤ 6 lines of simple Chinese (LessonPatternIntro). */
    val intro: List<PatternIntroLine>? = null,
)

@Serializable
data class PatternIntroLine(val zh: String = "", val en: String? = null)

object LessonPatterns {
    // ------------------------------------------------------------ characters

    fun isHanChar(c: Char): Boolean = (c.code in 0x3400..0x9fff) || (c.code in 0xf900..0xfaff)

    private fun hasHan(s: String): Boolean = s.any(::isHanChar)

    private fun isLatinLetter(c: Char): Boolean = c in 'A'..'Z' || c in 'a'..'z'

    private const val SPACE_CHARS = " \t 　"
    private const val PUNCT_CHARS = "，,。.！!？?；;：:、…—–-（）()「」“”\"'‘’《》〈〉·～~"

    private fun isSpace(c: Char): Boolean = c in SPACE_CHARS
    private fun isPunctChar(c: Char): Boolean = c in PUNCT_CHARS || isSpace(c)

    /** Only punctuation / spaces (a "，" piece, the "。" after an example). */
    fun isPunctuation(text: String): Boolean = text.isNotEmpty() && text.all(::isPunctChar)

    private fun trimSpaces(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && (isSpace(s[a]) || s[a] == '\r')) a++
        while (b > a && (isSpace(s[b - 1]) || s[b - 1] == '\r')) b--
        return s.substring(a, b)
    }

    // ------------------------------------------------------------ roles / colours

    const val SLOT_TONES = 5

    fun isSlotPiece(p: PatternPiece): Boolean = p.slot != null && JsJson.trim(p.slot).isNotEmpty()

    /** "fixed" (every fixed word one colour), "punct" (plain) or "s0"…"s4" (each slot its own colour). */
    fun pieceTones(pieces: List<PatternPiece>): List<String> {
        var slot = 0
        return pieces.map { p ->
            when {
                isSlotPiece(p) -> "s${slot++ % SLOT_TONES}"
                isPunctuation(p.hanzi ?: "") -> "punct"
                else -> "fixed"
            }
        }
    }

    // ------------------------------------------------------------ slot classes

    private val ZH_TERMS: Map<String, Pair<String, String>> = mapOf(
        "名词" to ("Noun" to "noun"), "名词短语" to ("Noun phrase" to "noun"), "动词" to ("Verb" to "verb"), "动词短语" to ("Verb phrase" to "verb"),
        "形容词" to ("Adjective" to "adjective"), "形容词短语" to ("Adjective phrase" to "adjective"), "量词" to ("Measure word" to "measure"),
        "代词" to ("Pronoun" to "noun"), "人称代词" to ("Pronoun" to "noun"), "副词" to ("Adverb" to "other"), "介词" to ("Preposition" to "other"),
        "连词" to ("Conjunction" to "other"), "助词" to ("Particle" to "other"), "方位词" to ("Location word" to "other"), "疑问词" to ("Question word" to "other"),
        "能愿动词" to ("Modal verb" to "verb"), "离合词" to ("Separable verb" to "verb"), "趋向动词" to ("Direction verb" to "verb"),
        "主语" to ("Subject" to "subject"), "宾语" to ("Object" to "noun"), "谓语" to ("Predicate" to "verb"), "补语" to ("Complement" to "other"),
        "结果补语" to ("Result complement" to "other"), "趋向补语" to ("Direction complement" to "other"), "状语" to ("Adverbial" to "other"), "定语" to ("Attribute" to "other"),
        "数" to ("Number" to "number"), "数词" to ("Number" to "number"), "数字" to ("Number" to "number"), "数量" to ("Amount" to "number"), "数量词" to ("Amount" to "number"),
        "整十数" to ("Round number" to "number"), "个位数" to ("Single digit" to "number"), "整数" to ("Whole number" to "number"),
        "时间" to ("Time" to "other"), "时间词" to ("Time word" to "other"), "时间段" to ("Length of time" to "other"), "时段" to ("Length of time" to "other"), "时间点" to ("Point in time" to "other"),
        "地点" to ("Place" to "noun"), "地方" to ("Place" to "noun"), "处所" to ("Place" to "noun"), "人" to ("Person" to "noun"), "某人" to ("Someone" to "noun"),
        "东西" to ("Thing" to "noun"), "事情" to ("Thing" to "noun"), "事" to ("Thing" to "noun"), "结果" to ("Result" to "other"), "程度" to ("Degree" to "other"), "方向" to ("Direction" to "other"),
        "句子" to ("Clause" to "other"), "小句" to ("Clause" to "other"), "分句" to ("Clause" to "other"), "原因" to ("Reason" to "other"), "目的" to ("Purpose" to "other"),
        "动作" to ("Action" to "verb"), "情况" to ("Situation" to "other"), "问题" to ("Question" to "other"),
    )

    private val LATIN_TERMS: Map<String, Pair<String, String>> = mapOf(
        "v" to ("Verb" to "verb"), "verb" to ("Verb" to "verb"), "vp" to ("Verb phrase" to "verb"), "adj" to ("Adjective" to "adjective"), "adjective" to ("Adjective" to "adjective"),
        "n" to ("Noun" to "noun"), "noun" to ("Noun" to "noun"), "np" to ("Noun phrase" to "noun"), "o" to ("Object" to "noun"), "obj" to ("Object" to "noun"), "object" to ("Object" to "noun"),
        "s" to ("Subject" to "subject"), "subj" to ("Subject" to "subject"), "subject" to ("Subject" to "subject"), "sb" to ("Someone" to "noun"), "someone" to ("Someone" to "noun"),
        "sth" to ("Something" to "noun"), "something" to ("Something" to "noun"), "num" to ("Number" to "number"), "number" to ("Number" to "number"),
        "m" to ("Measure word" to "measure"), "mw" to ("Measure word" to "measure"), "measure" to ("Measure word" to "measure"), "measure word" to ("Measure word" to "measure"),
        "classifier" to ("Measure word" to "measure"), "place" to ("Place" to "noun"), "time" to ("Time" to "other"), "adv" to ("Adverb" to "other"),
    )

    private val NON_LETTERS = Regex("[^a-z]+")

    private fun englishClass(label: String): String? {
        val lower = label.lowercase()
        val words = lower.split(NON_LETTERS).filter { it.isNotEmpty() }
        fun has(vararg w: String) = words.any { it in w }
        return when {
            has("number", "digit", "amount") -> "number"
            has("measure", "classifier") -> "measure"
            has("adjective", "adj") -> "adjective"
            has("verb") || lower == "v" -> "verb"
            has("subject") -> "subject"
            has("noun", "object", "place", "person", "someone", "something", "thing") -> "noun"
            else -> null
        }
    }

    /** number · measure · adjective · verb · noun · subject · other. */
    fun slotClass(p: PatternPiece): String {
        for (term in splitAlternatives(p.zh ?: "")) ZH_TERMS[term]?.let { return it.second }
        for (term in splitAlternatives(p.slot ?: "")) {
            LATIN_TERMS[term.lowercase()]?.let { return it.second }
            ZH_TERMS[term]?.let { return it.second }
        }
        return englishClass(p.slot ?: "") ?: "other"
    }

    private val ALT_SPLIT = Regex("[／/|]")

    private fun splitAlternatives(s: String): List<String> = s.split(ALT_SPLIT).map(::trimSpaces).filter { it.isNotEmpty() }

    private const val NUMERAL_CHARS = "零〇一二两三四五六七八九十百千万亿几半0123456789"
    private fun isNumeral(c: Char): Boolean = c in NUMERAL_CHARS

    private val MEASURE_WORDS = listOf(
        "公斤", "公里", "个", "位", "本", "张", "只", "条", "件", "块", "岁", "年", "天", "斤", "次", "遍", "杯", "瓶", "碗", "双", "把", "支",
        "辆", "家", "层", "篇", "首", "部", "台", "份", "种", "点", "分", "秒", "毛", "角", "元", "米", "号", "周", "节", "套", "盒", "包",
        "口", "间", "座", "棵", "朵", "封", "顿", "场", "趟", "下", "页", "句", "课", "刻", "升", "克",
    )

    // ------------------------------------------------------------ aligning an example

    data class Aligned(val parts: List<PatternExamplePart>, val matched: Boolean, val score: Int)

    private fun fixedAlternatives(p: PatternPiece): List<String> {
        val text = p.hanzi ?: ""
        if (isPunctuation(text)) {
            val t = trimSpaces(text)
            if (t == "，" || t == ",") return listOf("，", ",")
            return if (t.isNotEmpty()) listOf(t) else emptyList()
        }
        return splitAlternatives(text)
    }

    private fun findFixed(text: String, alts: List<String>, from: Int, before: Int): Pair<Int, Int>? {
        var best: Pair<Int, Int>? = null
        for (a in alts) {
            if (a.isEmpty()) continue
            val at = text.indexOf(a, from)
            if (at < 0 || at >= before) continue
            if (best == null || at < best.first || (at == best.first && a.length > best.second)) best = at to a.length
        }
        return best
    }

    private val PREDICATE_MARKERS = listOf(
        "最近", "现在", "已经", "正在", "马上", "以后", "然后", "一起", "越来越", "可以", "里", "的", "很", "都", "也", "就", "还", "又", "更", "太", "真",
        "了", "是", "要", "会", "能", "想",
    )
    private val TOPIC_WORDS = listOf("天气", "我们", "你们", "他们", "她们", "大家", "天", "我", "你", "他", "她", "它")
    private const val FINAL_PARTICLES = "吗呢吧啊呀了"

    private fun afterLastPunct(s: String): Int {
        var i = s.length
        while (i > 0 && !isPunctChar(s[i - 1])) i--
        return i
    }

    private fun beforeFirstPunct(s: String): Int {
        var i = 0
        while (i < s.length && !isPunctChar(s[i])) i++
        return i
    }

    private fun numeralRunEnd(s: String, from: Int, to: Int): Int {
        var i = from
        while (i < to && isNumeral(s[i])) i++
        return i
    }

    private fun numeralRunStart(s: String, from: Int, to: Int): Int {
        var i = to
        while (i > from && isNumeral(s[i - 1])) i--
        return i
    }

    private fun measureAt(s: String, at: Int, to: Int): Int {
        for (m in MEASURE_WORDS) if (at + m.length <= to && s.startsWith(m, at)) return m.length
        return if (at < to) 1 else 0
    }

    private fun measureEndingAt(s: String, from: Int, end: Int): Int {
        for (m in MEASURE_WORDS) if (end - m.length >= from && s.startsWith(m, end - m.length)) return m.length
        return if (end > from) 1 else 0
    }

    private fun predicateStart(s: String, from: Int, end: Int): Int {
        var start = from
        for (m in PREDICATE_MARKERS) {
            val at = s.lastIndexOf(m, end - 1)
            if (at >= from && at + m.length < end && at + m.length > start) start = at + m.length
        }
        for (t in TOPIC_WORDS) {
            if (s.startsWith(t, start) && start + t.length < end) {
                start += t.length
                break
            }
        }
        return start
    }

    private fun slotFits(cls: String, text: String): Boolean {
        if (text.isEmpty()) return false
        if (cls == "number") return text.all(::isNumeral)
        if (cls == "measure") return text in MEASURE_WORDS
        return false
    }

    private class Span(val start: Int, val end: Int, val piece: Int)

    /** `alignPatternExample`: cut an example into the pattern's pieces (best effort). */
    fun alignExample(pieces: List<PatternPiece>, hanzi: String): Aligned {
        val plain = Aligned(if (hanzi.isNotEmpty()) listOf(PatternExamplePart(hanzi)) else emptyList(), false, 0)
        val isSlot = pieces.map(::isSlotPiece)
        val fixedIdx = pieces.indices.filter { !isSlot[it] }
        val required = fixedIdx.filter { pieces[it].optional != true }
        if (hanzi.isEmpty() || required.isEmpty()) return plain

        // Every placement of the required fixed words is tried (bounded); the best fit wins.
        var best: Pair<Aligned, Int>? = null
        var tries = 0
        val chosen = arrayOfNulls<Pair<Int, Int>>(required.size)
        fun search(r: Int, from: Int) {
            if (tries >= MAX_PLACEMENTS) return
            if (r == required.size) {
                tries++
                val pos = HashMap<Int, Pair<Int, Int>>()
                required.forEachIndexed { k, i -> pos[i] = chosen[k]!! }
                val got = alignAt(pieces, hanzi, isSlot, fixedIdx, pos)
                val b = best
                if (b == null || got.first.score > b.first.score || (got.first.score == b.first.score && got.second < b.second)) best = got
                return
            }
            val alts = fixedAlternatives(pieces[required[r]])
            var at = from
            for (n in 0 until MAX_OCCURRENCES) {
                val hit = findFixed(hanzi, alts, at, hanzi.length) ?: break
                chosen[r] = hit
                search(r + 1, hit.first + hit.second)
                at = hit.first + 1
            }
        }
        search(0, 0)
        return best?.first ?: plain
    }

    private const val MAX_OCCURRENCES = 4
    private const val MAX_PLACEMENTS = 64

    /** One placement of the required fixed words → the alignment and the text between the fixed words. */
    private fun alignAt(
        pieces: List<PatternPiece>,
        hanzi: String,
        isSlot: List<Boolean>,
        fixedIdx: List<Int>,
        pos: HashMap<Int, Pair<Int, Int>>,
    ): Pair<Aligned, Int> {
        for (i in fixedIdx) {
            if (pieces[i].optional != true) continue
            var prev = -1
            for (k in i - 1 downTo 0) if (pos.containsKey(k)) { prev = k; break }
            var next = -1
            for (k in i + 1 until pieces.size) if (pos.containsKey(k)) { next = k; break }
            val gapStart = if (prev >= 0) pos[prev]!!.first + pos[prev]!!.second else 0
            val gapEnd = if (next >= 0) pos[next]!!.first else hanzi.length
            val slotBefore = (prev + 1 until i).any { isSlot[it] }
            val slotAfter = (i + 1 until (if (next >= 0) next else pieces.size)).any { isSlot[it] }
            val alts = fixedAlternatives(pieces[i])
            var hit: Pair<Int, Int>? = null
            if (!slotAfter && next >= 0) {
                for (a in alts) if (a.isNotEmpty() && gapEnd - a.length >= gapStart && hanzi.startsWith(a, gapEnd - a.length)) { hit = (gapEnd - a.length) to a.length; break }
            } else if (!slotBefore && prev >= 0) {
                for (a in alts) if (a.isNotEmpty() && hanzi.startsWith(a, gapStart) && gapStart + a.length <= gapEnd) { hit = gapStart to a.length; break }
            } else {
                hit = findFixed(hanzi, alts, gapStart, gapEnd)
                if (hit != null && hit.first + hit.second > gapEnd) hit = null
            }
            if (hit != null) pos[i] = hit
        }

        val spans = ArrayList<Span>()
        var score = 0
        val anchors = pos.keys.sorted()
        for (i in anchors) {
            val (at, len) = pos[i]!!
            spans += Span(at, at + len, i)
            if (!isPunctuation(hanzi.substring(at, at + len))) score += 2 * len
        }
        fun add(start: Int, end: Int, piece: Int) {
            if (end <= start) return
            spans += Span(start, end, piece)
            if (slotFits(slotClass(pieces[piece]), hanzi.substring(start, end))) score += 1
        }
        fun slotsBetween(a: Int, b: Int): List<Int> = (a + 1 until b).filter { isSlot[it] }

        // Leading slots, cut from the right.
        run {
            val first = anchors[0]
            val slots = slotsBetween(-1, first)
            var end = pos[first]!!.first
            val lineStart = afterLastPunct(hanzi.substring(0, end))
            var k = slots.size - 1
            while (k >= 0 && end > lineStart) {
                val piece = slots[k]
                val cls = slotClass(pieces[piece])
                val start = when {
                    cls == "number" -> numeralRunStart(hanzi, lineStart, end)
                    cls == "measure" -> end - measureEndingAt(hanzi, lineStart, end)
                    k == 0 -> if (cls == "adjective" || cls == "verb") predicateStart(hanzi, lineStart, end) else lineStart
                    else -> break
                }
                if (start >= end) break
                add(start, end, piece)
                end = start
                k--
            }
        }
        // Middle slots, cut from the left.
        for (a in 0 until anchors.size - 1) {
            val slots = slotsBetween(anchors[a], anchors[a + 1])
            var start = pos[anchors[a]]!!.first + pos[anchors[a]]!!.second
            val end = pos[anchors[a + 1]]!!.first
            var k = 0
            while (k < slots.size && start < end) {
                val piece = slots[k]
                val cls = slotClass(pieces[piece])
                val left = slots.size - k
                val stop = when {
                    k == slots.size - 1 -> end
                    cls == "number" -> numeralRunEnd(hanzi, start, end)
                    cls == "measure" -> start + measureAt(hanzi, start, end)
                    end - start == left -> start + 1
                    else -> break
                }
                if (stop <= start) break
                add(start, stop, piece)
                start = stop
                k++
            }
        }
        // Trailing slots, cut from the left up to the punctuation.
        run {
            val last = anchors[anchors.size - 1]
            val slots = slotsBetween(last, pieces.size)
            var start = pos[last]!!.first + pos[last]!!.second
            var end = start + beforeFirstPunct(hanzi.substring(start))
            while (end > start + 1 && hanzi[end - 1] in FINAL_PARTICLES) end--
            if (end == start + 1 && hanzi[start] in FINAL_PARTICLES && slots.isNotEmpty()) end = start
            var k = 0
            while (k < slots.size && start < end) {
                val piece = slots[k]
                val cls = slotClass(pieces[piece])
                val stop = when {
                    k == slots.size - 1 -> end
                    cls == "number" -> numeralRunEnd(hanzi, start, end)
                    cls == "measure" -> start + measureAt(hanzi, start, end)
                    end - start == slots.size - k -> start + 1
                    else -> break
                }
                if (stop <= start) break
                add(start, stop, piece)
                start = stop
                k++
            }
        }

        val sorted = spans.sortedBy { it.start }
        val parts = ArrayList<PatternExamplePart>()
        fun pushPlain(text: String) {
            if (text.isEmpty()) return
            val prev = parts.lastOrNull()
            if (prev != null && prev.piece == null) parts[parts.size - 1] = PatternExamplePart(prev.text + text)
            else parts += PatternExamplePart(text)
        }
        var at = 0
        for (s in sorted) {
            if (s.start < at) continue
            pushPlain(hanzi.substring(at, s.start))
            val text = hanzi.substring(s.start, s.end)
            if (isPunctuation(text)) pushPlain(text) else parts += PatternExamplePart(text, s.piece)
            at = s.end
        }
        pushPlain(hanzi.substring(at))
        var middle = 0
        for (a in 0 until anchors.size - 1) middle += pos[anchors[a + 1]]!!.first - (pos[anchors[a]]!!.first + pos[anchors[a]]!!.second)
        return Aligned(parts, true, score) to middle
    }

    /** `validExampleParts`: the author's parts when they spell the example and point at real pieces. */
    fun validParts(example: PatternExample, pieceCount: Int): List<PatternExamplePart>? {
        val parts = example.parts ?: return null
        if (parts.isEmpty()) return null
        for (p in parts) if (p.piece != null && (p.piece < 0 || p.piece >= pieceCount)) return null
        return if (parts.joinToString("") { it.text } == example.hanzi) parts else null
    }

    /** `examplePartsFor`. */
    fun partsFor(pattern: LessonPattern, example: PatternExample): List<PatternExamplePart> =
        validParts(example, pattern.pieces.size) ?: alignExample(pattern.pieces, example.hanzi).parts

    // ------------------------------------------------------------ teaching text blocks

    data class Block(val kind: String, val text: String)

    private val WRONG_MARKS = listOf("✗", "✘", "×", "❌")
    private val RIGHT_MARKS = listOf("✓", "✔", "✅")

    private fun markOf(line: String, marks: List<String>): String? {
        for (m in marks) if (line.startsWith(m)) return trimSpaces(line.substring(m.length))
        return null
    }

    private fun isHeadingLine(line: String): Boolean {
        if (markOf(line, WRONG_MARKS) != null || markOf(line, RIGHT_MARKS) != null) return false
        if (hasHan(line)) {
            if (line.length > 8) return false
            return line.none(::isPunctChar)
        }
        if (line.length > 40) return false
        return line[line.length - 1] !in ".:,;"
    }

    /** `noteTextBlocks`: heading · text · wrong · right. */
    fun textBlocks(text: String?): List<Block> {
        val out = ArrayList<Block>()
        if (text.isNullOrEmpty()) return out
        val paragraphs = ArrayList<List<String>>()
        var cur = ArrayList<String>()
        for (raw in text.split("\n")) {
            val line = trimSpaces(raw)
            if (line.isEmpty()) {
                if (cur.isNotEmpty()) paragraphs += cur
                cur = ArrayList()
            } else cur += line
        }
        if (cur.isNotEmpty()) paragraphs += cur
        for (lines in paragraphs) {
            var start = 0
            if (lines.size >= 2 && isHeadingLine(lines[0])) {
                out += Block("heading", lines[0])
                start = 1
            }
            val buf = ArrayList<String>()
            fun flush() {
                if (buf.isNotEmpty()) out += Block("text", buf.joinToString("\n"))
                buf.clear()
            }
            for (i in start until lines.size) {
                val wrong = markOf(lines[i], WRONG_MARKS)
                val right = if (wrong == null) markOf(lines[i], RIGHT_MARKS) else null
                when {
                    wrong != null -> { flush(); out += Block("wrong", wrong) }
                    right != null -> { flush(); out += Block("right", right) }
                    else -> buf += lines[i]
                }
            }
            flush()
        }
        return out
    }

    // ------------------------------------------------------------ parsing free-text structures

    private const val NUMBER_MARKS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
    private const val MAX_RAW_PIECE = 14
    private val PLUS = Regex("[+＋]")

    private fun stripNumbering(line: String): Pair<String, String> {
        val t = trimSpaces(line)
        if (t.isNotEmpty() && t[0] in NUMBER_MARKS) return t[0].toString() to trimSpaces(t.substring(1))
        var i = 0
        while (i < t.length && t[i] in '0'..'9') i++
        if (i > 0 && i < t.length && t[i] in ".)、") return "" to trimSpaces(t.substring(i + 1))
        if (t.isNotEmpty() && t[0] in "-•·*" && t.length > 1 && isSpace(t[1])) return "" to trimSpaces(t.substring(1))
        return "" to t
    }

    private fun splitPlus(s: String): List<String> = s.split(PLUS).map(::trimSpaces)

    private class RawToken(val kind: String, val text: String)

    private fun tokenizePiece(raw: String): List<RawToken> {
        val out = ArrayList<RawToken>()
        var i = 0
        val buf = StringBuilder()
        fun flush() {
            val t = trimSpaces(buf.toString())
            if (t.isNotEmpty()) out += RawToken("text", t)
            buf.setLength(0)
        }
        while (i < raw.length) {
            val c = raw[i]
            if (c == '（' || c == '(') {
                val close = raw.indexOf(if (c == '（') '）' else ')', i + 1)
                val alt = raw.indexOf(if (c == '（') ')' else '）', i + 1)
                val end = if (close >= 0) close else alt
                if (end > i) {
                    flush()
                    val inner = trimSpaces(raw.substring(i + 1, end))
                    if (inner.isNotEmpty()) out += RawToken("optional", inner)
                    i = end + 1
                    continue
                }
            }
            if (c in "，,；;：:") {
                flush()
                out += RawToken("punct", if (c == ',') "，" else c.toString())
                i++
                continue
            }
            buf.append(c)
            i++
        }
        flush()
        return out
    }

    private fun scriptRuns(text: String): List<String> {
        val out = ArrayList<String>()
        val buf = StringBuilder()
        var latin: Boolean? = null
        for (c in text) {
            val isL = isLatinLetter(c)
            if (latin != null && isL != latin && buf.isNotEmpty()) {
                out += buf.toString()
                buf.setLength(0)
            }
            latin = isL
            buf.append(c)
        }
        if (buf.isNotEmpty()) out += buf.toString()
        return out
    }

    private fun zhTerm(t: String): Pair<String, String>? {
        ZH_TERMS[t]?.let { return it }
        if (t.length >= 2 && (t.endsWith("词") || t.endsWith("短语"))) return t to "other"
        return null
    }

    private fun pieceFromRun(run: String, optional: Boolean): PatternPiece {
        val opt = if (optional) true else null
        val alts = splitAlternatives(run)
        if (alts.isNotEmpty() && alts.all { isLatinLetter(it[0]) }) {
            return PatternPiece(slot = alts.joinToString(" / ") { LATIN_TERMS[it.lowercase()]?.first ?: it }, optional = opt)
        }
        if (alts.isNotEmpty() && alts.all { zhTerm(it) != null }) {
            return PatternPiece(slot = alts.joinToString(" / ") { zhTerm(it)!!.first }, zh = run, optional = opt)
        }
        return PatternPiece(hanzi = run, optional = opt)
    }

    private fun piecesOfToken(tok: RawToken): List<PatternPiece> {
        if (tok.kind == "punct") return listOf(PatternPiece(hanzi = tok.text))
        val optional = tok.kind == "optional"
        val runs = if (hasHan(tok.text) || tok.text.contains('／')) scriptRuns(tok.text) else listOf(tok.text)
        return runs.map { pieceFromRun(it, optional) }
    }

    private fun stripRemarks(s: String): String {
        val out = StringBuilder()
        var depth = 0
        for (c in s) {
            when {
                c == '(' || c == '（' -> depth++
                c == ')' || c == '）' -> depth = maxOf(0, depth - 1)
                depth == 0 -> out.append(c)
            }
        }
        var t = trimSpaces(out.toString())
        while (t.isNotEmpty() && t[t.length - 1] in "，,;；:：") t = trimSpaces(t.substring(0, t.length - 1))
        return t
    }

    data class ParsedLine(val marker: String, val pieces: List<PatternPiece>)

    /** `parsePatternLine`. */
    fun parsePatternLine(line: String, englishLine: String? = null): ParsedLine? {
        val (marker, rest) = stripNumbering(line)
        if (!hasHan(rest) || !PLUS.containsMatchIn(rest)) return null
        val last = rest[rest.length - 1]
        if (last == '。' || last == '.') return null
        val raws = splitPlus(rest)
        if (raws.size < 2 || raws.any { it.isEmpty() || it.length > MAX_RAW_PIECE }) return null
        val tokens = raws.map(::tokenizePiece)
        val en = if (englishLine != null && englishLine.isNotEmpty()) splitPlus(englishLine) else null
        val enTokens = if (en != null && en.size == raws.size) en.map(::tokenizePiece) else null
        val pieces = ArrayList<PatternPiece>()
        tokens.forEachIndexed { r, toks ->
            val eToks = enTokens?.get(r)
            val aligned = eToks != null && eToks.size == toks.size && eToks.indices.all { eToks[it].kind == toks[it].kind }
            val meaningful = toks.filter { it.kind != "punct" }
            toks.forEachIndexed { k, tok ->
                val made = piecesOfToken(tok)
                var english: String? = null
                if (aligned) english = if (eToks!![k].kind == "punct") null else stripRemarks(eToks[k].text).ifEmpty { eToks[k].text }
                else if (eToks != null && meaningful.size == 1 && meaningful[0] === tok) english = stripRemarks(en!![r])
                if (!english.isNullOrEmpty() && !hasHan(english) && made.size == 1) {
                    val p = made[0]
                    pieces += when {
                        isSlotPiece(p) -> p.copy(slot = english)
                        !isPunctuation(p.hanzi ?: "") -> p.copy(english = english)
                        else -> p
                    }
                } else pieces += made
            }
        }
        if (pieces.none { !isSlotPiece(it) && !isPunctuation(it.hanzi ?: "") && it.optional != true }) return null
        return ParsedLine(marker, pieces)
    }

    private fun isEnglishPatternLine(line: String): Boolean {
        if (!PLUS.containsMatchIn(line)) return false
        var latin = 0
        var han = 0
        for (c in line) {
            if (isLatinLetter(c)) latin++ else if (isHanChar(c)) han++
        }
        return latin > 2 * han
    }

    private fun meaningOf(line: String): String? {
        for (m in listOf("→", "⇒", "=>", "->", "=")) if (line.startsWith(m)) return trimSpaces(line.substring(m.length))
        return null
    }

    data class Example(val hanzi: String, val pinyin: String? = null, val english: String? = null, val parts: List<PatternExamplePart>)
    data class Card(val pattern: LessonPattern, val examples: List<Example>, val blocks: List<Block>)
    data class View(val source: String, val intro: List<Block>, val cards: List<Card>, val extras: List<LessonSentence>)

    data class ParsedCard(val pattern: LessonPattern, val blocks: List<Block>)
    data class ParsedText(val intro: List<Block>, val cards: List<ParsedCard>)

    /** `parseStructureText`. */
    fun parseStructureText(body: String): ParsedText? {
        val lines = body.split("\n")
        val intro = ArrayList<String>()
        val cards = ArrayList<Pair<LessonPattern, ArrayList<String>>>()
        var i = 0
        while (i < lines.size) {
            val line = trimSpaces(lines[i])
            val nextLine = if (i + 1 < lines.size) trimSpaces(lines[i + 1]) else ""
            val english = if (nextLine.isNotEmpty() && isEnglishPatternLine(nextLine)) nextLine else null
            val parsed = if (line.isNotEmpty()) parsePatternLine(line, english) else null
            if (parsed == null) {
                (if (cards.isNotEmpty()) cards.last().second else intro) += lines[i]
                i++
                continue
            }
            var meaning: String? = null
            i++
            if (english != null) i++
            while (i < lines.size && trimSpaces(lines[i]).isNotEmpty()) {
                val m = meaningOf(trimSpaces(lines[i])) ?: break
                if (meaning == null && m.isNotEmpty()) meaning = m
                i++
            }
            cards += LessonPattern(name = parsed.marker.ifEmpty { null }, pieces = parsed.pieces, meaning = meaning) to ArrayList()
        }
        if (cards.isEmpty()) return null
        return ParsedText(textBlocks(intro.joinToString("\n")), cards.map { ParsedCard(it.first, textBlocks(it.second.joinToString("\n"))) })
    }

    private fun clean(s: LessonSentence) = LessonSentence(s.hanzi, s.pinyin?.ifEmpty { null }, s.english?.ifEmpty { null })

    /** `structureNoteView`: the note's cards, or null = a plain note. */
    fun noteView(body: String?, sentences: List<LessonSentence>?, patterns: List<LessonPattern>?): View? {
        val sents = sentences.orEmpty().filter { JsJson.trim(it.hanzi).isNotEmpty() }.map(::clean)
        val pats = patterns.orEmpty().filter { it.pieces.isNotEmpty() }
        if (pats.isNotEmpty()) {
            return View(
                "spec",
                textBlocks(body),
                pats.map { p ->
                    Card(
                        p,
                        p.examples.orEmpty().filter { JsJson.trim(it.hanzi).isNotEmpty() }.map { e ->
                            Example(e.hanzi, e.pinyin?.ifEmpty { null }, e.english?.ifEmpty { null }, partsFor(p, e))
                        },
                        textBlocks(p.note),
                    )
                },
                sents,
            )
        }
        if (body.isNullOrEmpty()) return null
        val parsed = parseStructureText(body) ?: return null
        val examples = parsed.cards.map { ArrayList<Example>() }
        val extras = ArrayList<LessonSentence>()
        fun ex(s: LessonSentence, parts: List<PatternExamplePart>) = Example(s.hanzi, s.pinyin, s.english, parts)
        val aligned = sents.map { s -> parsed.cards.map { alignExample(it.pattern.pieces, s.hanzi) } }
        when {
            parsed.cards.size == 1 -> sents.forEachIndexed { i, s -> examples[0] += ex(s, aligned[i][0].parts) }
            sents.size == parsed.cards.size && aligned.indices.all { aligned[it][it].matched } ->
                sents.forEachIndexed { i, s -> examples[i] += ex(s, aligned[i][i].parts) }
            else -> sents.forEachIndexed { i, s ->
                var best = -1
                for (c in parsed.cards.indices) {
                    if (!aligned[i][c].matched) continue
                    if (best < 0 || aligned[i][c].score > aligned[i][best].score) best = c
                }
                if (best >= 0) examples[best] += ex(s, aligned[i][best].parts) else extras += s
            }
        }
        return View("parsed", parsed.intro, parsed.cards.mapIndexed { i, c -> Card(c.pattern, examples[i], c.blocks) }, extras)
    }

    /** `patternLine`: "除了 + [Noun] + (以外) + ， + [Subject] + 还 + [Verb]". */
    fun patternLine(pieces: List<PatternPiece>): String = pieces.map { p ->
        val t = if (isSlotPiece(p)) "[${trimSpaces(p.slot!!)}]" else trimSpaces(p.hanzi ?: "")
        if (p.optional == true) "($t)" else t
    }.filter { it.isNotEmpty() }.joinToString(" + ")

    /** `patternName`: its own name, else the fixed words with "…" where slots go. */
    fun patternName(pattern: LessonPattern): String {
        val own = trimSpaces(pattern.name ?: "")
        if (own.isNotEmpty() && !(own.length == 1 && own[0] in NUMBER_MARKS)) return own
        val out = StringBuilder()
        var gap = false
        for (p in pattern.pieces) {
            if (isSlotPiece(p) || p.optional == true) {
                gap = true
                continue
            }
            val t = trimSpaces(p.hanzi ?: "")
            if (t.isEmpty() || isPunctuation(t)) continue
            if (gap) out.append('…')
            out.append(t)
            gap = false
        }
        if (gap && out.isNotEmpty()) out.append('…')
        return out.toString()
    }

    /** `patternEditText`: the editor's one-line text, read back by [parsePatternLine]. */
    fun editText(pieces: List<PatternPiece>): String = pieces.map { p ->
        val t = trimSpaces(if (isSlotPiece(p)) (p.zh?.takeIf { trimSpaces(it).isNotEmpty() } ?: p.slot!!) else p.hanzi ?: "")
        if (p.optional == true && t.isNotEmpty()) "（$t）" else t
    }.filter { it.isNotEmpty() }.joinToString(" + ")

    /** `mergePieceDetails`: keep pinyin / glosses / labels across a re-read of the pattern text. */
    fun mergeDetails(next: List<PatternPiece>, prev: List<PatternPiece>): List<PatternPiece> {
        val used = HashSet<Int>()
        return next.map { p ->
            val at = prev.indices.firstOrNull { k ->
                val q = prev[k]
                if (k in used || isSlotPiece(q) != isSlotPiece(p)) false
                else if (!isSlotPiece(p)) (q.hanzi ?: "") == (p.hanzi ?: "")
                else if (!p.zh.isNullOrEmpty()) q.zh == p.zh else (q.slot ?: "") == (p.slot ?: "")
            } ?: return@map p
            used += at
            val q = prev[at]
            if (isSlotPiece(p)) p.copy(slot = q.slot)
            else p.copy(
                pinyin = if (!q.pinyin.isNullOrEmpty() && p.pinyin.isNullOrEmpty()) q.pinyin else p.pinyin,
                english = if (!q.english.isNullOrEmpty() && p.english.isNullOrEmpty()) q.english else p.english,
            )
        }
    }
}
