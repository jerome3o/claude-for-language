package dev.jeromeswannack.chineselearning.lab.core.add

import dev.jeromeswannack.chineselearning.lab.core.Known
import dev.jeromeswannack.chineselearning.lab.core.NoteSearch

/**
 * The learner's ＋ Add tab (docs/ADD_TAB.md) — port of shared/add/add.ts, parity-tested by
 * android-lab/parity/fixtures/add-tab.ts (AddTabParityTest): the content tiles, the word input's
 * kind, and photo → OCR: the Chinese of a read line, line order (the big central subtitle first),
 * hand-picked spans.
 */
object AddTab {
    // ---------------- content tiles ----------------

    const val READER = "reader"
    const val LESSON = "lesson"
    const val AUDIO = "audio"
    const val CLIPS = "clips"
    const val PICTURE_HUNT = "picture_hunt"
    const val DECK = "deck"
    const val ASK = "ask"

    data class Tile(val kind: String, val icon: String, val title: String, val subtitle: String, val placeholder: String, val submitLabel: String, val noun: String)

    val TILES: List<Tile> = listOf(
        Tile(READER, "📖", "Graded reader", "A short story at your level", "What should the story be about?", "Write it", "reader"),
        Tile(LESSON, "🎯", "Mini lesson", "Exercises on a topic or a grammar point", "What should the lesson practise?", "Make it", "mini lesson"),
        Tile(AUDIO, "🎧", "Audio lesson", "A dialogue, a sleep lesson or a story to listen to", "What situation should the dialogue be about?", "Make it", "audio lesson"),
        Tile(CLIPS, "🎬", "Clips", "Short videos on a topic", "What should the clips be about?", "Make it", "clip"),
        Tile(PICTURE_HUNT, "🖼", "Picture hunt", "Find the words in a picture", "What should the picture show?", "Draw it", "picture hunt"),
        Tile(DECK, "🃏", "Deck of cards", "New words on a topic", "What topic should the cards cover?", "Make it", "deck"),
        Tile(ASK, "✦", "Just ask Claude", "Anything at all", "Ask Claude anything…", "Ask", "chat"),
    )

    fun tile(kind: String): Tile? = TILES.firstOrNull { it.kind == kind }

    data class AudioFormat(val format: String, val label: String, val placeholder: String)

    val AUDIO_FORMATS: List<AudioFormat> = listOf(
        AudioFormat("dialogue", "Dialogue", "What situation should the dialogue be about?"),
        AudioFormat("sleep", "Sleep", "Paste or say a Chinese text — its new words, very slowly"),
        AudioFormat("story", "Story", "Paste or say a Chinese story to listen to and repeat"),
    )

    fun placeholder(kind: String, format: String = "dialogue"): String =
        if (kind == AUDIO) AUDIO_FORMATS.firstOrNull { it.format == format }?.placeholder ?: TILES[2].placeholder
        else tile(kind)?.placeholder.orEmpty()

    fun lang(kind: String, format: String = "dialogue"): String = if (kind == AUDIO && format != "dialogue") "zh" else "en"

    /** "✓ Making your reader…" / "✓ Your deck is ready" / "Couldn't make the clip — try again". */
    fun resultLine(kind: String, status: String): String {
        val noun = tile(kind)?.noun ?: "it"
        return when (status) {
            "failed" -> "Couldn't make the $noun — try again"
            "ready" -> "✓ Your $noun is ready"
            else -> "✓ Making your $noun…"
        }
    }

    fun ready(kind: String, text: String, format: String = "dialogue"): Boolean {
        val t = NoteSearch.jsTrim(text)
        if (kind == AUDIO && format != "dialogue") return hanCount(t) >= 4
        return t.codePointCount(0, t.length) >= 2
    }

    // ---------------- word input ----------------

    const val CHINESE = "chinese"
    const val OTHER = "other"
    const val EMPTY = "empty"

    fun classify(text: String): String {
        val t = NoteSearch.jsTrim(text)
        if (t.isEmpty()) return EMPTY
        return if (t.codePoints().anyMatch { Known.isHan(it) }) CHINESE else OTHER
    }

    fun hanCount(text: String): Int = text.codePoints().filter { Known.isHan(it) }.count().toInt()

    // ---------------- photo → OCR ----------------

    const val OCR_MAX_EDGE = 1280
    const val OCR_JPEG_QUALITY = 82
    const val OCR_MAX_BYTES = 4 * 1024 * 1024
    const val OCR_MAX_LINES = 12

    fun resizeDims(width: Double, height: Double, maxEdge: Int = OCR_MAX_EDGE): Pair<Int, Int> {
        val w = maxOf(1L, Math.round(width)).toInt()
        val h = maxOf(1L, Math.round(height)).toInt()
        val edge = maxOf(w, h)
        if (edge <= maxEdge) return w to h
        val scale = maxEdge.toDouble() / edge
        return maxOf(1L, Math.round(w * scale)).toInt() to maxOf(1L, Math.round(h * scale)).toInt()
    }

    /** A read line; [box] = [ymin, xmin, ymax, xmax] on a 0–1000 grid. */
    data class Line(val text: String, val box: List<Double>? = null, val main: Boolean = false)

    private val CJK_PUNCT: Set<Int> = "。，、！？：；“”‘’（）《》〈〉【】「」『』—…·～".codePoints().toArray().toSet()
    private val LEAD_STRIP: Set<Int> = "、，。：；".codePoints().toArray().toSet()
    private val TAIL_STRIP: Set<Int> = "、，：；".codePoints().toArray().toSet()

    private fun str(cp: Int) = String(Character.toChars(cp))

    /** JS `\s` (the regex class, with the u flag). */
    private fun isJsSpace(cp: Int): Boolean =
        cp == 0x09 || cp == 0x0a || cp == 0x0b || cp == 0x0c || cp == 0x0d || cp == 0x20 || cp == 0xa0 || cp == 0x1680 ||
            cp in 0x2000..0x200a || cp == 0x2028 || cp == 0x2029 || cp == 0x202f || cp == 0x205f || cp == 0x3000 || cp == 0xfeff

    /** Port of ocrChineseText. */
    fun chineseText(raw: String): String {
        val parts = ArrayList<String>()
        var gap = false
        raw.codePoints().forEach { cp ->
            val keep = Known.isHan(cp) || cp in CJK_PUNCT || cp in '0'.code..'9'.code || cp in 0xff10..0xff19
            if (keep) {
                if (gap && parts.isNotEmpty()) parts.add(" ")
                parts.add(str(cp))
                gap = false
            } else gap = true
        }
        val out = ArrayList<String>()
        for (i in parts.indices) {
            if (parts[i] == " ") {
                val prev = out.lastOrNull()
                val next = parts.getOrNull(i + 1)
                if (prev != null && next != null && Known.isHan(prev.codePointAt(0)) && Known.isHan(next.codePointAt(0))) continue
            }
            out.add(parts[i])
        }
        val text = NoteSearch.jsTrim(out.joinToString(""))
        val cps = text.codePoints().toArray()
        var lo = 0
        var hi = cps.size
        while (lo < hi && (isJsSpace(cps[lo]) || cps[lo] in LEAD_STRIP)) lo++
        while (hi > lo && (isJsSpace(cps[hi - 1]) || cps[hi - 1] in TAIL_STRIP)) hi--
        val trimmed = buildString { for (i in lo until hi) appendCodePoint(cps[i]) }
        return if (hanCount(trimmed) > 0) trimmed else ""
    }

    /** Port of cleanOcrBox. */
    fun cleanBox(box: List<Double?>?): List<Double>? {
        if (box == null || box.size != 4) return null
        val v = box.map { n -> if (n == null || n.isNaN() || n.isInfinite()) null else minOf(1000.0, maxOf(0.0, n)) }
        if (v.any { it == null }) return null
        val (y0, x0, y1, x1) = v.map { it!! }
        val ymin = minOf(y0, y1)
        val ymax = maxOf(y0, y1)
        val xmin = minOf(x0, x1)
        val xmax = maxOf(x0, x1)
        if (ymax - ymin <= 0 || xmax - xmin <= 0) return null
        return listOf(ymin, xmin, ymax, xmax)
    }

    private const val SQRT1_2 = 0.7071067811865476

    /** Port of ocrLineScore. */
    fun score(line: Line): Double {
        val main = if (line.main) 10.0 else 0.0
        val box = line.box?.let { cleanBox(it) } ?: return main + 0.5
        val (ymin, xmin, ymax, xmax) = box
        val height = (ymax - ymin) / 1000
        val cx = (xmin + xmax) / 2000
        val cy = (ymin + ymax) / 2000
        val dist = minOf(1.0, Math.hypot(cx - 0.5, cy - 0.5) / SQRT1_2)
        val length = minOf(hanCount(line.text), 8) * 0.02
        return main + height * 4 + (1 - dist) + length
    }

    /** Port of orderOcrLines: cleaned, deduped, most prominent first, at most [max]. */
    fun orderLines(lines: List<Line>, max: Int = OCR_MAX_LINES): List<Line> {
        val seen = HashSet<String>()
        data class K(val line: Line, val score: Double, val index: Int)
        val kept = ArrayList<K>()
        lines.forEachIndexed { index, raw ->
            val text = chineseText(raw.text)
            if (text.isEmpty() || !seen.add(text)) return@forEachIndexed
            val line = Line(text, raw.box?.let { cleanBox(it) }, raw.main)
            kept.add(K(line, score(line), index))
        }
        return kept.sortedWith(compareByDescending<K> { it.score }.thenBy { it.index }).take(maxOf(0, max)).map { it.line }
    }

    /** Port of ocrSpan: the characters from [a] to [b] (either order, clamped). */
    fun span(text: String, a: Int, b: Int): String {
        val chars = text.codePoints().toArray()
        if (chars.isEmpty()) return ""
        val lo = maxOf(0, minOf(a, b))
        val hi = minOf(chars.size - 1, maxOf(a, b))
        if (lo > hi) return ""
        return buildString { for (i in lo..hi) appendCodePoint(chars[i]) }
    }

    fun foundLine(count: Int): String = when {
        count <= 0 -> "No Chinese found in this photo — try again closer up."
        count == 1 -> "Tap a word to look it up"
        else -> "$count lines of Chinese — tap a word to look it up"
    }
}
