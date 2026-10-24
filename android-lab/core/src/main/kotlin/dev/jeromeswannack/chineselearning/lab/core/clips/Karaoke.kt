package dev.jeromeswannack.chineselearning.lab.core.clips

import kotlin.math.max
import kotlin.math.min

/**
 * Port of shared/clips/karaoke.ts — 🎬 karaoke captions (docs/CLIPS.md "Karaoke captions"): a line
 * cut into words (the device segmenter's words for Chinese, one per character without; spaces for
 * English) and the clip's REAL audio duration shared out by syllables, with a pause at a comma / full
 * stop, after a lead-in and before a tail. Parity-tested (parity/fixtures/clips.ts → ClipsParityTest).
 */
object Karaoke {
    const val LEAD_MS = 120.0
    const val TAIL_MS = 220.0
    const val SHORT_PAUSE = 0.5
    const val LONG_PAUSE = 0.9

    /** kind: word | punct | space. */
    data class Piece(val text: String, val kind: String, val weight: Double)

    data class Token(val text: String, val kind: String, val weight: Double, val startMs: Long, val endMs: Long)

    private fun isHan(cp: Int): Boolean = Character.UnicodeScript.of(cp) == Character.UnicodeScript.HAN
    private fun isLetter(cp: Int): Boolean = Character.isLetter(cp)
    private fun isDigitAny(cp: Int): Boolean = Character.getType(cp).let { it == Character.DECIMAL_DIGIT_NUMBER.toInt() || it == Character.LETTER_NUMBER.toInt() || it == Character.OTHER_NUMBER.toInt() }
    private fun isLetterOrNumber(cp: Int) = isLetter(cp) || isDigitAny(cp)
    /** JavaScript's \s (with U+3000). */
    private fun isSpace(cp: Int): Boolean = cp == 0x20 || cp in 0x09..0x0D || cp == 0xA0 || cp == 0x1680 || cp in 0x2000..0x200A || cp == 0x2028 || cp == 0x2029 || cp == 0x202F || cp == 0x205F || cp == 0x3000 || cp == 0xFEFF
    private fun isLatinWord(cp: Int): Boolean = isLetterOrNumber(cp) || cp == '\''.code || cp == '’'.code || cp == '-'.code
    private const val VOWELS = "aeiouyAEIOUYāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüÜ"
    private const val SHORT = "，、；：,;:"
    private const val LONG = "。！？.!?…"

    private fun cps(s: String): List<Int> = s.codePoints().toArray().toList()
    private fun str(cps: List<Int>): String = String(cps.toIntArray(), 0, cps.size)

    /** Port of `karaokeSyllables`. */
    fun syllables(word: String): Int {
        val all = cps(word)
        val han = all.count { isHan(it) }
        // Han characters → spaces, then each space-separated part: digits + vowel groups (≥ 1 when it has letters).
        val latin = all.map { if (isHan(it)) ' '.code else it }
        var vowels = 0
        val parts = mutableListOf<MutableList<Int>>(mutableListOf())
        for (cp in latin) if (isSpace(cp)) parts.add(mutableListOf()) else parts.last().add(cp)
        for (part in parts) {
            if (part.isEmpty()) continue
            var groups = 0
            var inRun = false
            for (cp in part) {
                val v = cp < 0x10000 && VOWELS.indexOf(cp.toChar()) >= 0
                if (v && !inRun) groups++
                inRun = v
            }
            val digits = part.count { it in '0'.code..'9'.code }
            val letters = part.any { it !in '0'.code..'9'.code && isLetter(it) }
            vowels += digits + (if (letters) max(1, groups) else 0)
        }
        return max(1, han + vowels)
    }

    private fun pauseOf(text: String): Double = when {
        text.any { it in LONG } -> LONG_PAUSE
        text.any { it in SHORT } -> SHORT_PAUSE
        else -> 0.0
    }

    private fun piece(text: String): Piece {
        val c = cps(text)
        if (c.all { isSpace(it) }) return Piece(text, "space", 0.0)
        if (c.any { isHan(it) || isLetterOrNumber(it) }) return Piece(text, "word", syllables(text).toDouble())
        return Piece(text, "punct", pauseOf(text))
    }

    private fun fallbackPieces(text: String): List<Piece> {
        val out = mutableListOf<Piece>()
        val c = cps(text)
        var i = 0
        while (i < c.size) {
            val cp = c[i]
            when {
                isHan(cp) -> { out += piece(str(listOf(cp))); i++ }
                isLatinWord(cp) -> {
                    var j = i
                    while (j < c.size && isLatinWord(c[j]) && !isHan(c[j])) j++
                    out += piece(str(c.subList(i, j))); i = j
                }
                isSpace(cp) -> {
                    var j = i
                    while (j < c.size && isSpace(c[j])) j++
                    out += piece(str(c.subList(i, j))); i = j
                }
                else -> { out += piece(str(listOf(cp))); i++ }
            }
        }
        return out
    }

    /** Port of `karaokePieces`. */
    fun pieces(text: String, lang: String, words: List<String>?): List<Piece> {
        if (lang == "zh" && !words.isNullOrEmpty() && words.joinToString("") == text) return words.filter { it.isNotEmpty() }.map { piece(it) }
        return fallbackPieces(text)
    }

    /** Port of `karaokeTimeline`. */
    fun timeline(text: String, lang: String, durationMs: Double, words: List<String>? = null): List<Token> {
        val ps = pieces(text, lang, words)
        val first = ps.indexOfFirst { it.kind == "word" }
        val last = ps.indexOfLast { it.kind == "word" }
        val weights = ps.mapIndexed { i, p -> if (p.kind == "punct" && (i < first || i > last)) 0.0 else p.weight }
        val total = weights.sum()
        val duration = max(0.0, durationMs)
        val lead = min(LEAD_MS, duration / 4)
        val tail = min(TAIL_MS, duration / 4)
        val span = max(0.0, duration - lead - tail)
        var acc = 0.0
        return ps.mapIndexed { i, p ->
            val start = if (total > 0) lead + (acc / total) * span else lead
            acc += weights[i]
            val end = if (total > 0) lead + (acc / total) * span else lead
            Token(p.text, p.kind, weights[i], jsRound(start), jsRound(end))
        }
    }

    /** JavaScript's Math.round (half up). */
    private fun jsRound(x: Double): Long = kotlin.math.floor(x + 0.5).toLong()

    /** Port of `karaokeActive`. */
    fun active(timeline: List<Token>, positionMs: Double): Int {
        var at = -1
        for ((i, t) in timeline.withIndex()) {
            if (t.kind != "word") continue
            if (t.startMs <= positionMs) at = i else break
        }
        return at
    }

    /** Port of `karaokeStates`: past | active | next. */
    fun states(timeline: List<Token>, active: Int): List<String> =
        timeline.indices.map { i -> if (active < 0) "next" else if (i < active) "past" else if (i == active) "active" else "next" }
}
