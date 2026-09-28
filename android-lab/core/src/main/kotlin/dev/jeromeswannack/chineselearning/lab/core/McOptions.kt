package dev.jeromeswannack.chineselearning.lab.core

/*
 * Multiple-choice option rules for the typing cards. Port of shared/cards/multipleChoice.ts
 * (isHanziOption, sanitizeMcRow, mcChoiceRowCount, isMcCompact, nextUnansweredRow) —
 * parity-tested (parity/fixtures/multiple-choice.ts → McOptionsParityTest).
 *
 * Distractors are Chinese characters only: a pinyin syllable ("xi" for 习) the model offered
 * as a "sound-alike" is dropped wherever options are read, so notes cached before the worker
 * filtered them are clean on the device too.
 */
object McOptions {
    data class Row(val correct: String, val options: List<String>)

    /** Past this many rows to pick the grid goes compact (still ≥ 44dp tiles). */
    const val COMPACT_AFTER_ROWS = 6

    // CJK Unified + Extension A, per UTF-16 unit — the ranges the TS regexes use (no `u` flag).
    private fun isHan(c: Char): Boolean = c in '一'..'鿿' || c in '㐀'..'䶿'
    private fun hasHan(s: String): Boolean = s.any(::isHan)
    private fun isLatin(c: Char): Boolean = c in 'a'..'z' || c in 'A'..'Z'

    /** `[...s].length`: code points. */
    private fun charCount(s: String): Int = s.codePointCount(0, s.length)

    /** JS String.prototype.trim: WhiteSpace + LineTerminator (Kotlin's trim differs on U+FEFF / U+0085). */
    private fun isJsSpace(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿' -> true
        else -> c in ' '..' '
    }
    private fun jsTrim(s: String): String = s.trim(::isJsSpace)

    /** Port of isHanziOption: Chinese characters only, as many as the answer character. */
    fun isHanziOption(option: String, correct: String): Boolean =
        option.isNotEmpty() && option.all(::isHan) && charCount(option) == charCount(correct)

    /** Port of sanitizeMcRow: character rows keep real character options, deduped, the correct one always offered. */
    fun sanitize(row: Row): Row {
        val correct = row.correct
        if (row.options.size <= 1 || !hasHan(correct)) return Row(correct, row.options.toList())
        val seen = HashSet<String>()
        val options = ArrayList<String>()
        for (raw in row.options) {
            val opt = jsTrim(raw)
            if (opt in seen) continue
            if (opt != correct && !isHanziOption(opt, correct)) continue
            seen += opt
            options += opt
        }
        if (correct !in seen) options += correct
        return Row(correct, options)
    }

    private fun isPickRow(row: Row): Boolean =
        row.options.size > 1 && !(row.correct.any(::isLatin) && !hasHan(row.correct))

    /** Port of mcChoiceRowCount. */
    fun choiceRowCount(rows: List<Row>): Int = rows.count(::isPickRow)

    /** Port of isMcCompact. */
    fun isCompact(rows: List<Row>): Boolean = choiceRowCount(rows) > COMPACT_AFTER_ROWS

    /** Port of nextUnansweredRow: the next still-unanswered pick row after [picked] (wrapping), or null. */
    fun nextUnansweredRow(rows: List<Row>, selections: List<String?>, picked: Int): Int? {
        val n = rows.size
        for (step in 1..n) {
            val i = (picked + step) % n
            if (isPickRow(rows[i]) && selections.getOrNull(i) == null) return i
        }
        return null
    }
}
