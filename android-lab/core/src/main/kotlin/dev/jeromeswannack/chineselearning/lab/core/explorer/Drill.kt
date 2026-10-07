package dev.jeromeswannack.chineselearning.lab.core.explorer

/*
 * Port of shared/explorer/drill.ts — quick drills from the language explorer
 * (docs/LANGUAGE_EXPLORER.md "Mini drills"): 3–5 short questions built from what is on screen,
 * the word / character explored and its related words. Practice only: results go to analytics,
 * never to review events. Deterministic for a seed (mulberry32, bit-identical doubles), so it is
 * parity-tested against the TypeScript (parity/fixtures/explorer-drill.ts, DrillParityTest).
 */

/** Port of `DrillQuestionKind`. */
enum class DrillKind(val wire: String) {
    MEANING("meaning"), LISTEN("listen"), REVERSE("reverse"), TONE("tone"), WRITE("write");

    companion object { fun of(s: String) = entries.first { it.wire == s } }
}

/** Port of `DrillQuestion`. */
data class DrillQuestion(
    val kind: DrillKind,
    /** meaning / tone / write: the Chinese shown; listen: the text played; reverse: the English shown. */
    val prompt: String,
    /** tone: the word the character sits in (shown with the character marked). */
    val context: String? = null,
    /** Pinyin of the prompt, revealed after answering. */
    val pinyin: String? = null,
    /** Choices (empty for write). tone: "1".."5". */
    val options: List<String>,
    /** Index of the right option (-1 for write). */
    val answer: Int,
)

/** Port of `DrillTarget`. */
sealed interface DrillTarget {
    val wire: String

    data class Word(val word: DictWord, val syllables: List<String>? = null) : DrillTarget {
        override val wire: String get() = "word"
    }

    data class Char(val char: String) : DrillTarget {
        override val wire: String get() = "char"
    }
}

object Drill {
    const val MAX = 5
    const val MIN = 3
    /** Options per multiple-choice question (fewer when the pool is small, never under 3). */
    const val OPTIONS = 4

    /** Port of `seededRandom`: mulberry32, the same doubles as the TypeScript. */
    fun seededRandom(seed: Long): () -> Double {
        var a = seed.toInt() // `seed >>> 0`: the same 32 bits
        return {
            a += 0x6d2b79f5
            var t = a
            t = (t xor (t ushr 15)) * (t or 1)
            t = t xor (t + (t xor (t ushr 7)) * (t or 61))
            (t xor (t ushr 14)).toUInt().toDouble() / 4294967296.0
        }
    }

    /** Port of `shuffled`: Fisher–Yates with the given random source (a copy). */
    fun <T> shuffled(items: List<T>, rnd: () -> Double): List<T> {
        val out = items.toMutableList()
        for (i in out.size - 1 downTo 1) {
            val j = kotlin.math.floor(rnd() * (i + 1)).toInt()
            val tmp = out[i]; out[i] = out[j]; out[j] = tmp
        }
        return out
    }

    private class Choice(val options: List<String>, val answer: Int)

    /** The right answer plus up to OPTIONS - 1 distinct distractors, shuffled; null under 3 options. */
    private fun choice(right: String, distractors: List<String>, rnd: () -> Double): Choice? {
        val pool = shuffled(distractors.filter { it.isNotEmpty() && it != right }.distinct(), rnd).take(OPTIONS - 1)
        if (pool.size < 2) return null
        val options = shuffled(listOf(right) + pool, rnd)
        return Choice(options, options.indexOf(right))
    }

    /** JS `String.prototype.trim` (ECMAScript WhiteSpace + LineTerminator). */
    private fun jsTrim(s: String): String = s.trim { c ->
        c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' || c == ' ' || c == ' ' ||
            c in ' '..' ' || c == ' ' || c == ' ' || c == ' ' || c == ' ' || c == '　' || c == '﻿'
    }

    /** Port of `shortGloss`: the first sense ("bank; banking" → "bank"). */
    fun shortGloss(english: String): String = jsTrim(english.split(';')[0])

    /** JS `Array.prototype.slice(0, end)` (a negative end counts from the back). */
    private fun <T> sliceTo(xs: List<T>, end: Int): List<T> {
        val e = if (end < 0) maxOf(xs.size + end, 0) else minOf(end, xs.size)
        return xs.subList(0, e)
    }

    /**
     * Port of `buildDrill`: the drill for a Word view (target = the word) or a Character view
     * (target = the character; its first two words carry the word questions). [pool] = the related
     * words / "Words with 字" on screen. Order: meaning → listen → tone(s) → reverse → write, at
     * most [max]. Fewer than [MIN] questions possible → empty (the button is hidden).
     */
    fun buildDrill(target: DrillTarget, pool: List<DictWord>, seed: Long, max: Int = MAX): List<DrillQuestion> {
        val rnd = seededRandom(seed)
        val usable = pool.filter { it.hanzi.isNotEmpty() && it.english.isNotEmpty() }
        val focus: List<DictWord> = when (target) {
            is DrillTarget.Word -> listOf(target.word)
            is DrillTarget.Char -> usable.filter { target.char in it.hanzi }.take(2)
        }
        if (focus.isEmpty() || focus[0].english.isEmpty()) return emptyList()
        val focusSet = focus.map { it.hanzi }.toSet()
        val others = usable.filter { it.hanzi !in focusSet }
        // Identity, like the TypeScript's `w !== exclude`.
        fun glosses(exclude: DictWord) = (others + focus).filter { it !== exclude }.map { shortGloss(it.english) }
        fun hanzis(exclude: DictWord) = (others + focus).filter { it !== exclude }.map { it.hanzi }

        val out = ArrayList<DrillQuestion>()
        val first = focus[0]

        choice(shortGloss(first.english), glosses(first), rnd)?.let {
            out += DrillQuestion(DrillKind.MEANING, first.hanzi, pinyin = first.pinyin, options = it.options, answer = it.answer)
        }

        val heard = focus.getOrNull(1) ?: first
        choice(heard.hanzi, hanzis(heard), rnd)?.let {
            out += DrillQuestion(DrillKind.LISTEN, heard.hanzi, pinyin = heard.pinyin, options = it.options, answer = it.answer)
        }

        // Tones: the explored character in its first word, or each character of the word (max 2).
        val toneSource = if (target is DrillTarget.Word) target.word else first
        val chars = ExplorerWord.wordChars(toneSource.hanzi, toneSource.pinyin, (target as? DrillTarget.Word)?.syllables)
        val toneChars = (if (target is DrillTarget.Char) chars.filter { it.char == target.char } else chars).filter { it.tone != null }.take(2)
        for (c in toneChars) {
            out += DrillQuestion(DrillKind.TONE, c.char, context = toneSource.hanzi, pinyin = c.syllable, options = listOf("1", "2", "3", "4", "5"), answer = (c.tone ?: 5) - 1)
        }

        // Reverse: a related word on screen, English → which word?
        others.firstOrNull()?.let { back ->
            choice(back.hanzi, hanzis(back), rnd)?.let {
                out += DrillQuestion(DrillKind.REVERSE, shortGloss(back.english), pinyin = back.pinyin, options = it.options, answer = it.answer)
            }
        }

        val writeChar = when (target) {
            is DrillTarget.Char -> target.char
            is DrillTarget.Word -> target.word.hanzi.codePoints().toArray().firstOrNull()?.let { String(Character.toChars(it)) } ?: ""
        }
        out += DrillQuestion(DrillKind.WRITE, writeChar, options = emptyList(), answer = -1)

        val picked = if (out.size > max) sliceTo(out, max - 1) + out.last() else out
        return if (picked.size >= MIN) picked else emptyList()
    }

    /** Port of `drillScoreLine`: "4 / 5 — 很好！Nice". */
    fun scoreLine(correct: Int, total: Int): String {
        val ratio = if (total > 0) correct.toDouble() / total else 0.0
        val cheer = if (ratio == 1.0) "完美！Perfect" else if (ratio >= 0.6) "很好！Nice" else "加油！Keep going"
        return "$correct / $total — $cheer"
    }
}
